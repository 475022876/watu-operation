'use strict';
/* ============================================================
 * Marketing OS BUILD-01 · 真实浏览器端到端检查 + 截图证据
 * ------------------------------------------------------------
 * 目的：在真实 Chrome 中走完「登录 → 强制改密 → 8 个工作中心导航 → 关键操作」，
 *       收集控制台错误/异常，并产出 UI 证据截图。
 * 运行：node tools/mos-ui-check.js
 * 约束：零第三方依赖（CDP over 内置 WebSocket）；隔离数据目录 + 运行期随机口令；
 *       不触碰 data/ 与既有数据；结束清理实例、Chrome 与临时目录。
 * ============================================================ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8400 + Math.floor(Math.random() * 400);
const CDP_PORT = 9300 + Math.floor(Math.random() * 400);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(ROOT, 'data-mos-ui-' + crypto.randomBytes(3).toString('hex'));
const SHOT_DIR = path.join(ROOT, 'UI_EVIDENCE_MOS_BUILD01');
const OUT_DIR = path.join(ROOT, 'TEST_EVIDENCE_MOS_BUILD01');

const ADMIN_PW = 'MosUI-' + crypto.randomBytes(9).toString('base64url');
const NEW_PW = 'MosUI-' + crypto.randomBytes(9).toString('base64url');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  :: ' + detail : ''));
}

/* ---------------- 最小 CDP 客户端 ---------------- */

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    this.ready = new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res());
      this.ws.addEventListener('error', (e) => rej(new Error('CDP 连接失败：' + (e && e.message))));
    });
    this.ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers) h(msg);
      }
    });
  }
  on(fn) { this.handlers.push(fn); }
  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('CDP 超时：' + method)); }
      }, 30000);
    });
  }
  close() { try { this.ws.close(); } catch (_) { /* ignore */ } }
}

async function httpJson(url, method) {
  const res = await fetch(url, method ? { method } : undefined);
  return res.json();
}

/* ---------------- 主流程 ---------------- */

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  /* 1) 启动服务器（隔离数据目录） */
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      MOS_DATA_DIR: path.relative(ROOT, DATA_DIR).replace(/\\/g, '/'),
      MOS_PORT: String(PORT),
      MOS_ADMIN_PASSWORD: ADMIN_PW,
      MOS_TEXT_PROVIDER: 'mock',
      MOS_EGRESS_ALLOW_LOOPBACK: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  server.stdout.on('data', (d) => { serverLog += d.toString(); });
  server.stderr.on('data', (d) => { serverLog += d.toString(); });

  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (_) { /* retry */ }
    await sleep(250);
  }

  /* 2) 启动 Chrome */
  const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chromePath) { console.error('未找到 Chrome/Edge，跳过 UI 检查'); server.kill('SIGTERM'); process.exit(2); }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mos-ui-prof-'));
  const chrome = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-proxy-server',
    '--disable-extensions',
    '--window-size=1680,1050',
    '--remote-debugging-port=' + CDP_PORT,
    '--user-data-dir=' + profile,
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let cdpVersion = null;
  for (let i = 0; i < 80; i += 1) {
    try { cdpVersion = await httpJson('http://127.0.0.1:' + CDP_PORT + '/json/version'); break; } catch (_) { /* retry */ }
    await sleep(250);
  }
  check('Chrome DevTools 端口可用', !!cdpVersion, cdpVersion ? cdpVersion['Browser'] : 'timeout');

  const target = await httpJson('http://127.0.0.1:' + CDP_PORT + '/json/new?about:blank', 'PUT');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.ready;

  const consoleErrors = [];
  const pageErrors = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      pageErrors.push((d.exception && (d.exception.description || d.exception.value)) || d.text || 'unknown');
    } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
      consoleErrors.push('[log] ' + msg.params.entry.text + ' ' + (msg.params.entry.url || ''));
    }
  });

  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });

  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(r.data, 'base64'));
  };
  const evalJs = async (expr) => {
    const r = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('页面执行异常：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails.text));
    return r.result ? r.result.value : undefined;
  };
  const waitFor = async (expr, label, timeoutMs) => {
    const t0 = Date.now();
    const limit = timeoutMs || 12000;
    while (Date.now() - t0 < limit) {
      const v = await evalJs('(function(){ try { return !!(' + expr + '); } catch(e) { return false; } })()');
      if (v) return true;
      await sleep(200);
    }
    check('等待条件：' + label, false, '超时 ' + limit + 'ms');
    return false;
  };

  try {
    /* 3) 打开 MOS 外壳 */
    await cdp.send('Page.navigate', { url: BASE + '/mos' });
    await waitFor('document.readyState==="complete"', '页面加载');
    check('登录门可见', await waitFor('!document.getElementById("gate").hidden', '登录门'), '');
    await shot('01-login.png');

    /* 4) 登录 */
    await evalJs('(function(){document.getElementById("loginUser").value="mosadmin";document.getElementById("loginPass").value=' + JSON.stringify(ADMIN_PW) + ';document.getElementById("loginForm").requestSubmit();return true;})()');
    const pwdGate = await waitFor('!document.getElementById("pwdGate").hidden', '强制改密门');
    check('首登触发强制改密', pwdGate, '');
    if (pwdGate) await shot('02-force-password.png');

    /* 5) 改密并进入 */
    await evalJs('(function(){document.getElementById("pwdOld").value=' + JSON.stringify(ADMIN_PW) + ';document.getElementById("pwdNew").value=' + JSON.stringify(NEW_PW) + ';document.getElementById("pwdForm").requestSubmit();return true;})()');
    const appOn = await waitFor('!document.getElementById("appRoot").hidden', '应用外壳出现');
    check('改密后进入应用外壳', appOn, '');
    await waitFor('document.querySelectorAll(".nav-item").length>=14', '侧边导航渲染');
    await waitFor('document.querySelector(".page-head h1")', 'My Work 页头渲染');
    await shot('03-my-work.png');

    const navCount = await evalJs('document.querySelectorAll(".nav-item").length');
    check('侧边导航包含 8 个工作中心条目', navCount >= 14, 'nav-item=' + navCount);

    const centers = await evalJs('Array.from(document.querySelectorAll(".nav-group-label")).map(function(e){return e.textContent;}).join("|")');
    check('工作中心名称齐全（含 Marketing Center，非 Growth Center）',
      ['Workspace', 'Brand Center', 'Planning Center', 'Creative Studio', 'Publishing Center', 'Marketing Center', 'Analytics Center', 'Governance & Assets'].every((c) => String(centers).indexOf(c) !== -1),
      centers);
    check('不存在 Growth Center', String(centers).indexOf('Growth') === -1, '');

    const integrationBarText = await evalJs('document.getElementById("integrationBar").textContent');
    check('集成状态提示条显示 MOCK/未接通', String(integrationBarText).indexOf('MOCK') !== -1 && String(integrationBarText).indexOf('未接通') !== -1, String(integrationBarText).slice(0, 120));

    /* 6) 遍历各工作中心 */
    const visits = [
      ['my-work', '04-workspace-my-work.png'],
      ['active-projects', '05-workspace-projects.png'],
      ['brand-overview', '06-brand-overview.png'],
      ['brand-guidelines', '07-brand-guidelines.png'],
      ['brand-library', '08-brand-reference.png'],
      ['planning', '09-planning-list.png'],
      ['topics', '10-topics.png'],
      ['intelligence', '11-intelligence.png'],
      ['tasks', '12-content-tasks.png'],
      ['campaigns', '13-campaigns.png'],
      ['creative', '14-creative-stage.png'],
      ['publishing', '15-publishing-stage.png'],
      ['analytics', '16-analytics-stage.png'],
      ['governance', '17-governance-stage.png']
    ];
    for (const [id, file] of visits) {
      await evalJs('(function(){location.hash="#/' + id + '";return true;})()');
      await sleep(120);
      await evalJs('(function(){var b=document.querySelector(\'[data-route="' + id + '"]\');if(b)b.click();return true;})()');
      await waitFor('document.querySelector(".page-head h1")', id + ' 页头', 15000);
      await sleep(500);
      await shot(file);
      const title = await evalJs('(document.querySelector(".page-head h1")||{}).textContent||""');
      check('模块渲染：' + id, !!title, title);
    }

    /* 7) 规划：月视图日历 */
    await evalJs('(function(){var b=document.querySelector(\'[data-route="planning"]\');if(b)b.click();return true;})()');
    await waitFor('document.getElementById("newPlan")', '计划列表工具条', 15000);
    await evalJs('(function(){var b=Array.prototype.find.call(document.querySelectorAll("[data-v]"),function(x){return x.dataset.v==="calendar";});if(b)b.click();return true;})()');
    await sleep(900);
    const calCells = await evalJs('document.querySelectorAll(".cal-cell").length');
    check('统一日历渲染出日期格', calCells > 20, 'cells=' + calCells);
    await shot('18-planning-calendar.png');

    const weekBtn = await evalJs('(function(){var b=Array.prototype.find.call(document.querySelectorAll("[data-cv]"),function(x){return x.dataset.cv==="week";});if(b){b.click();return true;}return false;})()');
    await sleep(700);
    check('日历可切换周视图', weekBtn, '');
    await shot('19-planning-calendar-week.png');

    /* 8) 情报：来源登记 + 采集降级提示 */
    await evalJs('(function(){var b=document.querySelector(\'[data-route="intelligence"]\');if(b)b.click();return true;})()');
    await waitFor('document.querySelector(\'[data-t="sources"]\')', '情报页工具条', 15000);
    await evalJs('(function(){var b=document.querySelector(\'[data-t="sources"]\');if(b)b.click();return true;})()');
    await waitFor('document.getElementById("newSrc")', '来源工具条', 15000);
    await sleep(600);
    await shot('20-intelligence-sources.png');

    // 打开一个来源，确认"白名单/采集"操作区可见
    await evalJs('(function(){var b=document.querySelector("[data-src]");if(b)b.click();return true;})()');
    await waitFor('document.querySelector(\'[data-act="ingest"]\')', '来源详情抽屉', 10000);
    await sleep(400);
    await shot('21-intelligence-source-detail.png');
    const ingestVisible = await evalJs('!!document.querySelector(\'[data-act="ingest"]\')');
    check('来源详情提供采集入口（失败会如实降级）', ingestVisible, '');
    await evalJs('(function(){var b=document.querySelector(\'.drawer [data-act="close"]\');if(b)b.click();return true;})()');
    await sleep(300);

    /* 9) 页面级真实操作 + 刷新持久化（不接受「只做展示界面」） */
    const PLAN_TITLE = 'UI 持久化验证计划 2027-03';
    await evalJs('(function(){var b=document.querySelector(\'[data-route="planning"]\');if(b)b.click();return true;})()');
    await waitFor('document.getElementById("newPlan") || document.querySelector(\'[data-v]\')', 'Planning 页', 15000);
    await evalJs('(function(){var b=Array.prototype.find.call(document.querySelectorAll("[data-v]"),function(x){return x.dataset.v==="list";});if(b)b.click();return true;})()');
    await waitFor('document.getElementById("newPlan")', '计划列表工具条', 15000);
    await evalJs('(function(){document.getElementById("newPlan").click();return true;})()');
    await waitFor('document.getElementById("npT")', '新建计划弹窗', 8000);
    await evalJs('(function(){'
      + 'document.getElementById("npY").value="2027";'
      + 'document.getElementById("npM").value="3";'
      + 'document.getElementById("npT").value=' + JSON.stringify(PLAN_TITLE) + ';'
      + 'document.getElementById("npO").value="验证目标一\\n验证目标二";'
      + 'document.getElementById("__mok").click();return true;})()');
    const planCreated = await waitFor('document.body.innerText.indexOf(' + JSON.stringify(PLAN_TITLE) + ')!==-1', '新建计划回显到列表', 12000);
    check('UI 真实操作：页面新建月度计划后列表回显', planCreated, '');
    await shot('22-planning-created-by-ui.png');

    // 刷新页面：会话与数据都必须还在（服务端持久化，不得用 localStorage 冒充）
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor('document.readyState==="complete"', '刷新后加载');
    const backIn = await waitFor('!document.getElementById("appRoot").hidden', '刷新后仍保持登录态', 15000);
    check('刷新后仍处于已登录态（会话服务端持久化）', backIn, '');
    const planPersist = await waitFor('document.body.innerText.indexOf(' + JSON.stringify(PLAN_TITLE) + ')!==-1', '刷新后计划仍在', 15000);
    check('刷新不丢：新建的月度计划刷新后依然存在', planPersist, '');
    await shot('23-planning-after-reload.png');

    // 情报：页面登记来源 → 刷新仍在
    const SRC_NAME = 'UI 验证来源 ' + new Date().toISOString().slice(0, 10);
    await evalJs('(function(){var b=document.querySelector(\'[data-route="intelligence"]\');if(b)b.click();return true;})()');
    await waitFor('document.querySelector(\'[data-t="sources"]\')', '情报工具条', 15000);
    await evalJs('(function(){var b=document.querySelector(\'[data-t="sources"]\');if(b)b.click();return true;})()');
    await waitFor('document.getElementById("newSrc")', '来源工具条', 15000);
    await evalJs('(function(){document.getElementById("newSrc").click();return true;})()');
    await waitFor('document.getElementById("nsN")', '登记来源弹窗', 8000);
    await evalJs('(function(){'
      + 'document.getElementById("nsN").value=' + JSON.stringify(SRC_NAME) + ';'
      + 'document.getElementById("nsD").value="bis.org";'
      + 'document.getElementById("nsE").value="";'
      + 'document.getElementById("__mok").click();return true;})()');
    const srcCreated = await waitFor('document.body.innerText.indexOf(' + JSON.stringify(SRC_NAME) + ')!==-1', '新来源回显到列表', 12000);
    check('UI 真实操作：页面登记情报来源并回显（默认待核验）', srcCreated, '');
    await shot('24-intelligence-created-by-ui.png');

    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor('document.readyState==="complete"', '刷新后加载');
    await waitFor('document.querySelector(\'[data-t="sources"]\') || document.querySelector(\'[data-route="intelligence"]\')', '刷新后情报页', 15000);
    await evalJs('(function(){var b=document.querySelector(\'[data-route="intelligence"]\');if(b)b.click();return true;})()');
    await waitFor('document.querySelector(\'[data-t="sources"]\')', '刷新后情报工具条', 15000);
    await evalJs('(function(){var b=document.querySelector(\'[data-t="sources"]\');if(b)b.click();return true;})()');
    const srcPersist = await waitFor('document.body.innerText.indexOf(' + JSON.stringify(SRC_NAME) + ')!==-1', '刷新后来源仍在', 15000);
    check('刷新不丢：登记的来源刷新后依然存在', srcPersist, '');
    await shot('25-intelligence-after-reload.png');

    check('无页面级未捕获异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
    check('无控制台 error 输出', consoleErrors.length === 0, consoleErrors.slice(0, 5).join(' | '));
  } catch (err) {
    check('UI 检查流程异常', false, err.message);
    try { await shot('99-error.png'); } catch (_) { /* ignore */ }
  }

  cdp.close();
  try { chrome.kill('SIGKILL'); } catch (_) { /* ignore */ }
  try { server.kill('SIGTERM'); } catch (_) { /* ignore */ }
  await sleep(800);
  try { server.kill('SIGKILL'); } catch (_) { /* ignore */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* ignore */ }

  const failed = results.filter((r) => !r.ok);
  console.log('\nUI 检查：' + (results.length - failed.length) + '/' + results.length + ' 通过');
  console.log('截图目录：' + SHOT_DIR);
  if (failed.length) {
    console.log('--- 服务端日志尾部 ---\n' + serverLog.slice(-2000));
  }
  fs.writeFileSync(path.join(OUT_DIR, 'ui-check-result.json'), JSON.stringify({
    suite: 'mos-ui',
    at: new Date().toISOString(),
    passed: results.length - failed.length,
    failed: failed.length,
    total: results.length,
    results
  }, null, 2), 'utf8');
  process.exit(failed.length ? 1 : 0);
}

main();
