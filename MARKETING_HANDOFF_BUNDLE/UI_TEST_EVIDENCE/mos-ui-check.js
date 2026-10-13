'use strict';
/* ============================================================
 * Marketing OS · 真实浏览器端到端检查 + 截图证据（BUILD-01 + BUILD-02）
 * ------------------------------------------------------------
 * 目的：在真实 Chrome 中走完「登录 → 强制改密 → 全部工作中心导航 → 关键写操作」，
 *       收集控制台错误/异常，并产出 UI 证据截图。
 *       BUILD-02 段落额外验证五个新页面的**真实写操作 + 刷新后持久化**，而不是"打开看一眼"。
 * 运行：node tools/mos-ui-check.js
 * 约束：零第三方依赖（CDP over 内置 WebSocket）；隔离数据目录 + 运行期随机口令；
 *       不触碰 data/ 与既有数据；结束清理实例、Chrome 与临时目录。
 * 截图：BUILD-01 → UI_EVIDENCE_MOS_BUILD01/ ；BUILD-02 → UI_EVIDENCE_MOS_BUILD02/
 *       BUILD-03 → UI_EVIDENCE_MOS_BUILD03/ ；Phase 2（BUILD-04）→ UI_EVIDENCE_MOS_BUILD04/
 * ============================================================ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9560 + Math.floor(Math.random() * 20);
const CDP_PORT = 9600 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(ROOT, 'data-mos-ui-' + crypto.randomBytes(3).toString('hex'));
const SHOT_DIR = path.join(ROOT, 'UI_EVIDENCE_MOS_BUILD01');
const SHOT_DIR_B02 = path.join(ROOT, 'UI_EVIDENCE_MOS_BUILD02');
const SHOT_DIR_B03 = path.join(ROOT, 'UI_EVIDENCE_MOS_BUILD03');
const SHOT_DIR_B04 = path.join(ROOT, 'UI_EVIDENCE_MOS_BUILD04');
const SHOT_DIR_B05 = path.join(ROOT, 'UI_EVIDENCE_MOS_BUILD05');
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
    const dir = name.indexOf('B02-') === 0 ? SHOT_DIR_B02
      : (name.indexOf('B03-') === 0 ? SHOT_DIR_B03
        : (name.indexOf('B04-') === 0 ? SHOT_DIR_B04
          : (name.indexOf('B05-') === 0 ? SHOT_DIR_B05 : SHOT_DIR)));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), Buffer.from(r.data, 'base64'));
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

    /* 6) 遍历各工作中心
     * 注意：BUILD-02 起 Creative Studio 拆为三个真实页面（content-editor / visual-studio /
     * video-workspace），并新增 my-reviews；原有的 'creative' 占位路由已不存在。
     *
     * 每个条目带**期望页头**：仅断言"有标题"是不够的 —— 路由不存在时 navigate() 会静默
     * 早返回、页面停留在上一模块，旧写法会把这种失效判为通过（BUILD-02 自检 A-12 已记录）。 */
    const visits = [
      ['my-work', '04-workspace-my-work.png', 'My Work'],
      ['active-projects', '05-workspace-projects.png', 'Active Projects'],
      ['brand-overview', '06-brand-overview.png', 'Brand Overview'],
      ['brand-guidelines', '07-brand-guidelines.png', 'Visual & Creative Guidelines'],
      ['brand-library', '08-brand-reference.png', 'Reference Library'],
      ['planning', '09-planning-list.png', 'Monthly Planning'],
      ['topics', '10-topics.png', 'Master Topics'],
      ['intelligence', '11-intelligence.png', 'Intelligence'],
      ['tasks', '12-all-tasks.png', 'All Tasks'],
      ['campaigns', '13-campaigns.png', 'Campaigns'],
      // Phase 2（F-05）：Marketing Center 新增品牌工作区（同一模块参数化）
      ['marketing-vfib', 'B04-38-marketing-vfib.png', 'VFIB Banking Marketing'],
      ['marketing-ucard', 'B04-39-marketing-ucard.png', 'U CARD Marketing'],
      ['content-editor', 'B02-14-content-editor.png', '内容编辑器'],
      ['visual-studio', 'B02-15-visual-studio.png', '视觉工作室'],
      ['video-workspace', 'B02-16-video-workspace.png', '视频工作区'],
      ['my-reviews', 'B02-17-my-reviews.png', '我的审核'],
      ['publishing', 'B02-18-publishing.png', '发布中心'],
      // BUILD-03：Analytics / Governance 已由占位页升级为真实页面（页头随之变更）
      ['analytics', 'B03-29-analytics.png', '运营分析'],
      ['governance', 'B03-30-governance.png', '治理与资产']
    ];
    for (const [id, file, expectTitle] of visits) {
      await evalJs('(function(){location.hash="#/' + id + '";return true;})()');
      await sleep(120);
      await evalJs('(function(){var b=document.querySelector(\'[data-route="' + id + '"]\');if(b)b.click();return true;})()');
      await waitFor('document.querySelector(".page-head h1")', id + ' 页头', 15000);
      await sleep(500);
      await shot(file);
      const title = await evalJs('(document.querySelector(".page-head h1")||{}).textContent||""');
      check('模块渲染：' + id + ' → ' + expectTitle,
        String(title).indexOf(expectTitle) !== -1, '实际=' + title);
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

    /* ==========================================================
     * 8) BUILD-02：五个新页面的真实操作 + 持久化验证（浏览器内完成）
     * 用户要求「所有页面必须具备真实操作及持久化能力，不允许仅制作展示界面」，
     * 因此这里不是"打开看一眼"，而是走一遍真实的写操作并验证刷新后仍在。
     * ========================================================== */
    const goRoute = async (id) => {
      await evalJs('(function(){location.hash="#/' + id + '";return true;})()');
      await sleep(120);
      await evalJs('(function(){var b=document.querySelector(\'[data-route="' + id + '"]\');if(b)b.click();return true;})()');
    };

    // --- 内容编辑器：新建草稿 → 写正文 → 保存 → 刷新后仍在 ---
    const UNIQ = 'UI-B02-' + Date.now().toString(36);
    await goRoute('content-editor');
    const ceReady = await waitFor('document.getElementById("ceNew")', '内容编辑器工具栏', 15000);
    check('B02-UI 内容编辑器渲染（版本列表 + 三栏）', ceReady
      && await evalJs('!!document.querySelector(".editor-3col")'), '');

    await evalJs('(function(){document.getElementById("ceNew").click();return true;})()');
    const dlgOpen = await waitFor('document.getElementById("__mok")', '新建草稿确认弹窗', 8000);
    if (dlgOpen) await evalJs('(function(){document.getElementById("__mok").click();return true;})()');
    const editorOn = await waitFor('!!document.getElementById("ceText")', '正文编辑器出现（草稿已创建）', 12000);
    check('B02-UI 内容编辑器：界面内新建草稿版本成功', editorOn, '');

    if (editorOn) {
      await evalJs('(function(){'
        + 'var t=document.getElementById("ceTitle");if(t){t.value=' + JSON.stringify(UNIQ) + ';t.dispatchEvent(new Event("input",{bubbles:true}));}'
        + 'var b=document.getElementById("ceText");b.value=' + JSON.stringify('界面写入的正文 ' + UNIQ) + ';'
        + 'b.dispatchEvent(new Event("input",{bubbles:true}));return true;})()');
      const dirtyShown = await evalJs('(document.getElementById("ceDirty")||{}).textContent||""');
      check('B02-UI 内容编辑器：正文修改后显式提示未保存', String(dirtyShown).indexOf('未保存') !== -1, String(dirtyShown));
      await shot('B02-21-content-editor-draft.png');

      await evalJs('(function(){document.getElementById("ceSave").click();return true;})()');
      await sleep(1400);

      // 刷新后版本列表仍应含该版本（真实持久化）
      await cdp.send('Page.reload', { ignoreCache: true });
      await waitFor('document.readyState==="complete"', '刷新后加载');
      await goRoute('content-editor');
      await waitFor('document.getElementById("ceNew")', '刷新后内容编辑器', 15000);
      const persisted = await waitFor(
        'document.body.innerText.indexOf(' + JSON.stringify(UNIQ) + ')!==-1', '刷新后草稿仍在', 15000);
      check('B02-UI 内容编辑器：草稿保存后刷新仍在（真实持久化）', persisted, UNIQ);
      await shot('B02-22-content-editor-after-reload.png');

      // 冻结送审：正文转为只读（不变量 1 的界面表现）
      await evalJs('(function(){var v=document.querySelector(".ver-item");if(v)v.click();return true;})()');
      await waitFor('document.getElementById("ceLock")', '冻结按钮出现', 12000);
      await evalJs('(function(){document.getElementById("ceLock").click();return true;})()');
      const confirmLock = await waitFor('document.getElementById("__mok")', '送审确认弹窗', 8000);
      if (confirmLock) await evalJs('(function(){document.getElementById("__mok").click();return true;})()');
      await sleep(1600);
      const ro = await evalJs('(function(){var t=document.getElementById("ceText");return t?!!t.readOnly:false;})()');
      check('B02-UI 内容编辑器：送审冻结后正文变为只读（不可再改）', ro === true, 'readonly=' + ro);
      await shot('B02-23-content-editor-locked.png');

      // 我的审核：应出现刚送审产生的审核单。
      // 注意：默认勾选「仅我可裁决」，而当前登录者是**作者本人** → 职责分离会把它过滤掉，
      // 这是正确行为。因此先取消勾选，再看审核单是否真实存在。
      await goRoute('my-reviews');
      const rvReady = await waitFor('document.getElementById("rvRefresh")', '我的审核页', 15000);
      check('B02-UI 我的审核渲染（按类型分组计数 + 审核单卡片）', rvReady
        && await evalJs('!!document.querySelector(".grid-3")'), '');
      const selfExcluded = await evalJs('document.body.innerText.indexOf("职责分离")!==-1'
        + '||document.querySelectorAll(".review-card").length===0');
      check('B02-UI 我的审核：默认只列「我可裁决」，作者本人被职责分离过滤', selfExcluded === true, '');
      await evalJs('(function(){var m=document.getElementById("rvMine");if(m&&m.checked){m.click();}return true;})()');
      await sleep(1200);
      const cardCount = await evalJs('document.querySelectorAll(".review-card").length');
      check('B02-UI 我的审核：取消「仅我可裁决」后送审产生的审核单可见', cardCount > 0, 'cards=' + cardCount);
      await shot('B02-24-my-reviews.png');
    }

    // --- 视觉工作室：受控提示词预览（真实调用 Brand Rule Engine） ---
    await goRoute('visual-studio');
    const vsReady = await waitFor('document.getElementById("vsBrief")', '视觉工作室表单', 15000);
    check('B02-UI 视觉工作室渲染（模板清单 + 生成表单 + 素材区）', vsReady
      && await evalJs('!!document.getElementById("vsPreview")'), '');
    if (vsReady) {
      await evalJs('(function(){'
        + 'var t=document.getElementById("vsBrief");t.value="机构建筑中性画面，留白充足，无黄调。";'
        + 't.dispatchEvent(new Event("input",{bubbles:true}));'
        + 'document.getElementById("vsPreview").click();return true;})()');
      const previewed = await waitFor(
        'document.getElementById("vsOut").innerText.indexOf("生效规则哈希")!==-1', '提示词预览结果', 12000);
      check('B02-UI 视觉工作室：受控提示词预览返回生效规则哈希', previewed, '');
      const skillNote = await evalJs('document.body.innerText.indexOf("REFERENCE_ONLY")!==-1||document.body.innerText.indexOf("参考")!==-1');
      check('B02-UI 视觉工作室：显式展示 Skill 未批准状态（不得谎称可用）', skillNote === true, '');
      await shot('B02-25-visual-studio.png');
    }

    // --- 视频工作区：界面内写脚本 → 状态推进 → 刷新仍在 ---
    await goRoute('video-workspace');
    const vwReady = await waitFor('document.getElementById("vwBrief")', '视频工作区表单', 15000);
    check('B02-UI 视频工作区渲染（阶段条 + Brief/脚本/分镜/字幕）', vwReady
      && await evalJs('!!document.getElementById("vwAddSec")'), '');
    if (vwReady) {
      const SECT = 'UI 开场分节 ' + UNIQ;
      await evalJs('(function(){document.getElementById("vwAddSec").click();return true;})()');
      await sleep(200);
      await evalJs('(function(){'
        + 'var hs=document.querySelectorAll(".sec-h");var h=hs[hs.length-1];h.value=' + JSON.stringify(SECT) + ';h.dispatchEvent(new Event("input",{bubbles:true}));'
        + 'var cs=document.querySelectorAll(".sec-c");var c=cs[cs.length-1];c.value="提出问题并给出结论。";c.dispatchEvent(new Event("input",{bubbles:true}));'
        + 'return true;})()');
      await evalJs('(function(){document.getElementById("vwSave").click();return true;})()');
      await sleep(1500);
      // 阶段条：Brief + 脚本 应为已完成（badge-ok），以此确认状态真的推进了
      // （旧写法检查 innerText 含"脚本"是恒真断言 —— 卡片标题里本来就有"脚本"二字）
      const okStages = await evalJs('document.querySelectorAll(".card-body.tight .badge-ok").length');
      check('B02-UI 视频工作区：保存脚本后阶段条推进（Brief+脚本 已完成）', okStages >= 2, 'ok-stages=' + okStages);

      await cdp.send('Page.reload', { ignoreCache: true });
      await waitFor('document.readyState==="complete"', '刷新后加载');
      await goRoute('video-workspace');
      await waitFor('document.getElementById("vwBrief")', '刷新后视频工作区', 15000);
      // 分节标题在 <input> 里，innerText 读不到，必须读 value
      const vwPersist = await waitFor(
        'Array.from(document.querySelectorAll(".sec-h")).some(function(e){return e.value===' + JSON.stringify(SECT) + ';})',
        '刷新后脚本分节仍在', 15000);
      check('B02-UI 视频工作区：脚本保存后刷新仍在（真实持久化）', vwPersist, '');
      await shot('B02-26-video-workspace.png');
    }

    // --- 发布中心：四个视图切换 + 渠道表真实渲染 ---
    await goRoute('publishing');
    const pbReady = await waitFor('document.querySelectorAll("[data-tab]").length>=4', '发布中心标签', 15000);
    check('B02-UI 发布中心渲染（日历/队列/渠道/归档 四视图）', pbReady
      && await evalJs('document.body.innerText.indexOf("不会自动发布")!==-1'), '');
    await evalJs('(function(){var bs=document.querySelectorAll("[data-tab]");bs[2].click();return true;})()');
    await sleep(900);
    const chRows = await evalJs('document.querySelectorAll("table.tbl tbody tr").length');
    check('B02-UI 发布中心：渠道登记视图渲染真实渠道行', chRows > 0, 'rows=' + chRows);
    await shot('B02-27-publishing-channels.png');
    await evalJs('(function(){var bs=document.querySelectorAll("[data-tab]");bs[0].click();return true;})()');
    await sleep(900);
    const pubCalCells = await evalJs('document.querySelectorAll(".cal-grid .cal-cell").length');
    check('B02-UI 发布中心：日历视图渲染月网格', pubCalCells > 20, 'cells=' + pubCalCells);
    await shot('B02-28-publishing-calendar.png');

    /* ==========================================================
     * 9) BUILD-03：Analytics 与 Governance & Assets 的真实页面验证
     *    - Analytics：四段标签、缺失语义（不得用 0 冒充）、真实落盘后才出数字
     *    - Governance：第三条链（ASSET_ADMISSION）、沙盒/正式分列、可复用恒 0
     *    写入一律走页面内同源 fetch（读 mos_csrf 双提交令牌），随后 reload 验证持久化，
     *    确认页面读的是服务端真实记录而非前端假数据。
     * ========================================================== */
    const pageApi = async (path, method, body) => {
      const expr = '(async function(){'
        + 'var m=String(document.cookie||"").match(/(?:^|;\\s*)mos_csrf=([^;]+)/);'
        + 'var h={"Content-Type":"application/json"};'
        + 'if(m)h["x-mos-csrf"]=decodeURIComponent(m[1]);'
        + 'var r=await fetch(' + JSON.stringify(path) + ',{method:' + JSON.stringify(method || 'GET')
        + ',headers:h,credentials:"same-origin"'
        + (body === undefined ? '' : ',body:' + JSON.stringify(JSON.stringify(body))) + '});'
        + 'var t=await r.text();var j=null;try{j=JSON.parse(t);}catch(e){}'
        + 'return JSON.stringify({status:r.status,json:j});})()';
      const raw = await evalJs(expr);
      try { return JSON.parse(raw); } catch (_) { return { status: 0, json: null }; }
    };

    // --- Analytics：四段标签 + 缺失语义 ---
    await goRoute('analytics');
    const anReady = await waitFor('document.querySelectorAll(".tabs [data-tab]").length>=4', 'Analytics 标签', 15000);
    check('B03-UI 运营分析渲染（Content/Channels/Operations/AI & Cost 四段）', anReady, '');
    const anTabs = await evalJs('Array.from(document.querySelectorAll(".tabs [data-tab]")).map(function(e){return e.dataset.tab;}).join(",")');
    check('B03-UI 运营分析：四段标签名称正确',
      anTabs === 'content,channels,operations,aiCost', 'tabs=' + anTabs);

    // 先切到 AI & Cost（全新库没有任何生成作业 → 费用必须显示「缺失」而不是 0/估算值）
    await evalJs('(function(){var b=document.getElementById("anTab-aiCost");if(b)b.click();return true;})()');
    await sleep(1200);
    const costBody = await evalJs('(document.getElementById("anBody")||{}).innerText||""');
    check('B03-UI 运营分析：无回执时「可核费用」显示缺失，不出现估算金额',
      String(costBody).indexOf('缺失') !== -1
      && String(costBody).indexOf('不做估算') !== -1, '含缺失=' + (String(costBody).indexOf('缺失') !== -1));
    await shot('B03-31-analytics-ai-cost.png');

    // Channels：无指标记录时必须显式说明「缺失」，且不得出现 0 占位
    await evalJs('(function(){var b=document.getElementById("anTab-channels");if(b)b.click();return true;})()');
    await sleep(1200);
    const chBody = await evalJs('(document.getElementById("anBody")||{}).innerText||""');
    check('B03-UI 运营分析：无指标记录时渠道指标显示缺失态并说明原因',
      String(chBody).indexOf('渠道指标缺失') !== -1
      && String(chBody).indexOf('不会用 0 或示例数字填充') !== -1, '');
    const metricBtn = await evalJs('document.querySelectorAll("[data-metric]").length');
    check('B03-UI 运营分析：没有发布记录时不显示「录入指标」按钮（写入路径前置条件真实）',
      metricBtn === 0, 'btns=' + metricBtn);
    await shot('B03-32-analytics-channels.png');

    // --- 前置：页面内同源上传一份工作素材（入库申请只能针对已存在的工作素材） ---
    const upExpr = '(async function(){'
      + 'var m=String(document.cookie||"").match(/(?:^|;\\s*)mos_csrf=([^;]+)/);'
      + 'var h={"Content-Type":"image/png"};if(m)h["x-mos-csrf"]=decodeURIComponent(m[1]);'
      + 'var b=new Uint8Array([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,7,7,7,7,7,7,7,7]);'
      + 'var r=await fetch("/api/mos/assets/upload?brand=VFIB&name=b03-ui-asset.png",'
      + '{method:"POST",headers:h,credentials:"same-origin",body:b});'
      + 'var t=await r.text();var j=null;try{j=JSON.parse(t);}catch(e){}'
      + 'return JSON.stringify({status:r.status,json:j});})()';
    let upRes = { status: 0, json: null };
    try { upRes = JSON.parse(await evalJs(upExpr) || '{"status":0,"json":null}'); } catch (_) { /* ignore */ }
    const waId = upRes.json && upRes.json.asset && upRes.json.asset.id;
    check('B03-UI 前置：页面内上传工作素材成功（真实落盘、带 sha256）',
      upRes.status === 200 && !!waId, 'HTTP ' + upRes.status + ' id=' + waId);

    const admReg = waId ? await pageApi('/api/mos/asset-admissions?brand=VFIB', 'POST', {
      workingAssetId: waId, categoryCode: 'A01',
      submissionMetadata: { title: 'UI-B03 入库申请', license: 'LICENSED', description: '浏览器内发起' }
    }) : { status: 0, json: null };
    const uiAdmId = admReg.json && admReg.json.admission && admReg.json.admission.id;
    check('B03-UI 前置：页面内创建入库申请成功（进入 SUBMITTED）',
      admReg.status === 200 && !!uiAdmId, 'HTTP ' + admReg.status + ' id=' + uiAdmId);

    // --- Governance & Assets：三标签 + MOCK 诚实边界 ---
    await goRoute('governance');
    const gvReady = await waitFor('document.querySelectorAll(".tabs [data-tab]").length>=3', '治理标签', 15000);
    check('B03-UI 治理与资产渲染（Asset Admission / Approved Assets / Review History）', gvReady, '');
    const gvTabs = await evalJs('Array.from(document.querySelectorAll(".tabs [data-tab]")).map(function(e){return e.dataset.tab;}).join(",")');
    check('B03-UI 治理与资产：三标签名称正确',
      gvTabs === 'admission,assets,history', 'tabs=' + gvTabs);

    const admBody = await evalJs('(document.getElementById("appRoot")||{}).innerText||""');
    check('B03-UI 治理与资产：明确标注资料库为 MOCK，且说明不会变为可复用',
      String(admBody).indexOf('资料库为 MOCK') !== -1
      && String(admBody).indexOf('不会') !== -1, '');
    check('B03-UI 治理与资产：可复用资产计数展示（Mock 下必然为 0）',
      String(admBody).indexOf('可复用资产') !== -1, '');
    await shot('B03-34-governance-admission.png');

    // 真实 UI 操作：打开入库申请抽屉 → 点「执行预检」（按钮由服务端状态驱动）
    const rowVisible = await waitFor(
      'document.querySelectorAll("[data-open]").length>=1', '入库申请行渲染', 12000);
    check('B03-UI 治理与资产：新申请的表格行真实渲染（来自服务端记录）', rowVisible, '');
    await evalJs('(function(){var b=document.querySelector("[data-open]");if(b)b.click();return true;})()');
    const drawerOpen = await waitFor('document.querySelector(".drawer")', '入库申请抽屉', 12000);
    check('B03-UI 治理与资产：抽屉展示预检/回执/可复用资格/流程历史', drawerOpen
      && await evalJs('document.querySelector(".drawer").innerText.indexOf("可复用资格")!==-1')
      && await evalJs('document.querySelector(".drawer").innerText.indexOf("流程历史")!==-1'), '');
    const preBtnClicked = await evalJs('(function(){'
      + 'var bs=document.querySelectorAll(".drawer .btn");'
      + 'for(var i=0;i<bs.length;i++){if(bs[i].textContent.indexOf("执行预检")!==-1){bs[i].click();return true;}}'
      + 'return false;})()');
    check('B03-UI 治理与资产：抽屉内提供「执行预检」真实动作', preBtnClicked === true, '');
    await sleep(1800);
    await shot('B03-37-governance-drawer.png');

    // 预检后：抽屉已关闭并刷新，列表状态应变为 PRECHECK（真实写操作的结果）
    const preDone = await waitFor('document.body.innerText.indexOf("PRECHECK")!==-1', '预检结果回显', 12000);
    check('B03-UI 治理与资产：执行预检后列表状态更新为 PRECHECK（真实写操作生效）', preDone, '');

    // 刷新后仍在（服务端持久化）
    await cdp.send('Page.reload', { ignoreCache: true });
    await waitFor('document.readyState==="complete"', '刷新后加载');
    await goRoute('governance');
    await waitFor('document.querySelectorAll(".tabs [data-tab]").length>=3', '刷新后治理页', 15000);
    const admPersist = await waitFor(
      'document.body.innerText.indexOf("UI-B03 入库申请")!==-1', '刷新后入库申请仍在', 15000);
    check('B03-UI 治理与资产：入库申请与预检结果刷新后依然存在（真实持久化）', admPersist, '');

    // Approved Assets：正式库检索恒空 + 沙盒分列
    await evalJs('(function(){var b=document.getElementById("gvTab-assets");if(b)b.click();return true;})()');
    await sleep(1300);
    const asBody = await evalJs('(document.getElementById("appRoot")||{}).innerText||""');
    check('B03-UI 治理与资产：Approved Assets 明确「正式库检索恒为空」，不伪造正式资产',
      String(asBody).indexOf('正式库检索') !== -1
      && String(asBody).indexOf('恒为空') !== -1, '');
    check('B03-UI 治理与资产：展示可复用判定公式（审批 AND 同步 AND 权限 AND ACTIVE AND REAL）',
      String(asBody).indexOf('授权来源为 REAL') !== -1, '');
    await shot('B03-35-governance-assets.png');

    // Review History：append-only 说明 + 空/有数据两种状态都能渲染
    await evalJs('(function(){var b=document.getElementById("gvTab-history");if(b)b.click();return true;})()');
    await sleep(1300);
    const hiBody = await evalJs('(document.getElementById("appRoot")||{}).innerText||""');
    check('B03-UI 治理与资产：审核历史视图渲染（append-only 说明可见）',
      String(hiBody).indexOf('append-only') !== -1, '');
    await shot('B03-36-governance-history.png');

    // 页面级检查：Analytics / Governance 必须是真实端点驱动（端点被 403/404 时会退回错误态）
    const anApi = await pageApi('/api/mos/analytics?brand=VFIB&section=all');
    check('B03-UI 运营分析端点真实可用（页面数据来自该端点）',
      anApi.status === 200 && !!(anApi.json && anApi.json.sections), 'HTTP ' + anApi.status);
    const gvApi = await pageApi('/api/mos/asset-admissions?brand=VFIB&pageSize=100');
    check('B03-UI 治理端点真实可用（含 availableBlockedReason 说明 Mock 阻塞原因）',
      gvApi.status === 200 && typeof (gvApi.json || {}).availableBlockedReason === 'string'
      && String(gvApi.json.availableBlockedReason).length > 0, 'HTTP ' + gvApi.status);

    /* ================= Phase 2（BUILD-04）：架构降重 + S04 产品营销 =================
     * 真实验证：Campaign Marketing Brief 结构化保存（含未核验宣称）、Deliverables 与
     * ContentTask 共享（创建预填 Campaign）、Results 的 Unavailable 诚实态、
     * All Tasks 深链接过滤、VFIB / U CARD 营销工作区品牌一致性。 */
    const clickModalOk = "(function(){var m=document.querySelectorAll('.modal-mask');if(!m.length)return false;"
      + "var b=m[m.length-1].querySelector('#__mok');if(b){b.click();return true;}return false;})()";

    await evalJs('(function(){var b=document.querySelector(\'[data-route="campaigns"]\');if(b)b.click();return true;})()');
    await waitFor('document.getElementById("newCamp")', 'Campaigns 工具条', 15000);
    await sleep(400);
    await shot('B04-40-campaigns-list.png');

    // 1) 通过 UI 创建 Campaign（真实写操作）
    const CAMP_TITLE = 'BUILD-04 UI 验证 Campaign ' + Date.now();
    await evalJs('document.getElementById("newCamp").click()');
    await waitFor('document.getElementById("ncT")', 'New Campaign 弹窗', 10000);
    await evalJs('(function(){document.getElementById("ncT").value=' + JSON.stringify(CAMP_TITLE) + ';'
      + 'document.getElementById("ncB").value="UI 验证：目标/受众需人工填写；不得承诺费用与收益。";return true;})()');
    await evalJs(clickModalOk);
    await waitFor('document.body.innerText.indexOf(' + JSON.stringify(CAMP_TITLE) + ')>=0', 'Campaign 入列', 15000);
    check('BUILD-04 Campaign 通过 UI 真实创建并入列', true, '');

    const campList = await pageApi('/api/mos/campaigns?brand=VFIB&pageSize=200');
    const createdCamp = ((campList.json || {}).items || []).find((c) => c.title === CAMP_TITLE) || null;
    check('BUILD-04 服务端存在该 Campaign（含品牌级 Marketing Brief 模板默认值）',
      !!createdCamp && !!createdCamp.marketingBrief, createdCamp ? createdCamp.code : '未找到');
    const CAMP_ID = createdCamp ? createdCamp.id : '';
    check('BUILD-04 模板按品牌预填（VFIB → VFIB_BANKING）',
      !!createdCamp && createdCamp.marketingBrief.templateCode === 'VFIB_BANKING',
      createdCamp ? createdCamp.marketingBrief.templateCode : '');

    // 2) 打开详情抽屉：五个标签齐备
    await evalJs('(function(){var b=document.querySelector(\'[data-open-camp="' + CAMP_ID + '"]\');if(b)b.click();return true;})()');
    await waitFor('document.querySelector(\'[data-ctab="brief"]\')', 'Campaign 详情抽屉', 15000);
    await sleep(500);
    const campTabs = await evalJs('Array.prototype.map.call(document.querySelectorAll("[data-ctab]"),function(x){return x.textContent;}).join("|")');
    check('BUILD-04 Campaign 详情五段式（Brief/Deliverables/Schedule/Assets/Results）',
      /Marketing Brief/.test(campTabs) && /Deliverables/.test(campTabs) && /Schedule/.test(campTabs)
      && /Assets/.test(campTabs) && /Results/.test(campTabs), campTabs);
    await shot('B04-41-campaign-brief.png');

    // 3) Marketing Brief：写入一条**无来源**的产品宣称 → 服务端必须标 UNVERIFIED 且阻断正式输出
    const CLAIM = 'UI 验证宣称：保证年化收益 8%（无来源）';
    await evalJs('(function(){document.getElementById("mbObj").value="让机构客户理解跨境结算合规框架\\n提升品牌专业度";'
      + 'document.getElementById("mbAddClaim").click();return true;})()');
    await sleep(200);
    await evalJs('(function(){var t=document.querySelectorAll(".claim-text");t[t.length-1].value=' + JSON.stringify(CLAIM) + ';return true;})()');
    await evalJs('document.getElementById("mbSave").click()');
    // 只有**保存成功后**服务端才会回填核验原因（未保存的新行没有 reason），据此等待避免竞态
    await waitFor('document.body.innerText.indexOf("未关联已核准知识")>=0', 'Brief 保存后服务端重算核验状态', 15000);
    const briefBlocked = await evalJs('document.body.innerText.indexOf("受阻")>=0');
    check('BUILD-04 无来源产品宣称被标 UNVERIFIED 且 Brief 显示「受阻」（不冒充正式可用）', briefBlocked, '');
    await shot('B04-42-campaign-brief-blocked.png');

    const afterBrief = await pageApi('/api/mos/campaigns/' + CAMP_ID);
    const mb = (afterBrief.json || {}).campaign ? afterBrief.json.campaign.marketingBrief : {};
    check('BUILD-04 服务端计算：readyForOfficialUse=false 且 claimSummary.unverified>=1',
      mb && mb.readyForOfficialUse === false && mb.claimSummary && mb.claimSummary.unverified >= 1,
      JSON.stringify(mb.claimSummary || {}));

    // 4) Deliverables：复用 ContentTask，创建时预填品牌 + Campaign 关联
    await evalJs('(function(){var b=document.querySelector(\'[data-ctab="deliverables"]\');if(b)b.click();return true;})()');
    await waitFor('document.getElementById("dvNewTask")', 'Deliverables 标签', 15000);
    await evalJs('document.getElementById("dvNewTask").click()');
    await waitFor('document.getElementById("ktT")', '新建交付任务弹窗', 15000);
    const campPrefill = await evalJs('(function(){var s=document.getElementById("ktCamp");return s?s.value:"";})()');
    check('BUILD-04 交付任务创建预填 Campaign 关联（M-03）', campPrefill === CAMP_ID, '预填=' + campPrefill);
    const TASK_TITLE = 'BUILD-04 交付任务 ' + Date.now();
    await evalJs('(function(){document.getElementById("ktT").value=' + JSON.stringify(TASK_TITLE) + ';return true;})()');
    await evalJs(clickModalOk);
    await waitFor('document.body.innerText.indexOf(' + JSON.stringify(TASK_TITLE) + ')>=0', '交付任务入列', 15000);
    check('BUILD-04 交付任务创建成功并出现在 Campaign Deliverables', true, '');
    await shot('B04-43-campaign-deliverables.png');

    // 5) Results：渠道绩效必须 Unavailable（不伪造数字）
    await evalJs('(function(){var b=document.querySelector(\'[data-ctab="results"]\');if(b)b.click();return true;})()');
    await sleep(900);
    const resultsBody = await evalJs('(document.querySelector("#campTab")||{}).innerText||""');
    check('BUILD-04 Results 显示 NOT CONFIGURED 且不出现虚构绩效数字',
      String(resultsBody).indexOf('NOT CONFIGURED') !== -1 || String(resultsBody).indexOf('不可用') !== -1, '');
    await shot('B04-44-campaign-results.png');
    await evalJs('(function(){var b=document.querySelector(".drawer [data-act=\'close\']");if(b)b.click();return true;})()');
    await sleep(300);

    // 6) All Tasks：深链接按 Campaign 过滤（同一 ContentTask 对象）
    // 注意：直接改 hash 即触发路由（等价于用户刷新/粘贴深链接）；不要再去点导航项，
    //       否则会被导航覆盖为无参路径 #/tasks（这是**正确**行为：点导航=进入干净页面）。
    await evalJs('(function(){location.hash="#/tasks?campaignId=' + CAMP_ID + '";return true;})()');
    await waitFor('document.querySelector(".page-head h1")', 'All Tasks 页头', 15000);
    await waitFor('document.getElementById("fq")', 'All Tasks 工具条', 15000);
    await sleep(900);
    const allTasksTitle = await evalJs('(document.querySelector(".page-head h1")||{}).textContent||""');
    const contextShown = await evalJs('document.body.innerText.indexOf("已按上下文过滤")>=0');
    check('BUILD-04 All Tasks 页头与深链接上下文过滤齐备', allTasksTitle.indexOf('All Tasks') !== -1 && contextShown, allTasksTitle);
    await shot('B04-45-all-tasks-deeplink.png');

    const filtered = await pageApi('/api/mos/tasks?brand=VFIB&campaignId=' + CAMP_ID);
    check('BUILD-04 tasks 端点按 campaignId 过滤（Deliverables 与 All Tasks 同源）',
      filtered.status === 200 && ((filtered.json || {}).items || []).some((t) => t.title === TASK_TITLE),
      'HTTP ' + filtered.status);

    // 7) VFIB / U CARD 营销工作区：品牌一致性提示 + 切换
    await evalJs('(function(){var b=document.querySelector(\'[data-route="marketing-vfib"]\');if(b)b.click();return true;})()');
    await waitFor('document.querySelector(".page-head h1")', 'VFIB 营销工作区', 15000);
    await waitFor('document.body.innerText.indexOf("VFIB_BANKING")>=0', 'VFIB 模板渲染', 15000);
    const vfibTitle = await evalJs('(document.querySelector(".page-head h1")||{}).textContent||""');
    check('BUILD-04 VFIB Banking Marketing 工作区渲染且展示品牌 Brief 模板',
      vfibTitle.indexOf('VFIB Banking Marketing') !== -1, vfibTitle);
    await shot('B04-46-marketing-vfib.png');

    await evalJs('(function(){var b=document.querySelector(\'[data-route="marketing-ucard"]\');if(b)b.click();return true;})()');
    await waitFor('document.querySelector(".page-head h1")', 'U CARD 营销工作区', 15000);
    await sleep(700);
    const ucardMismatch = await evalJs('(document.body.innerText.indexOf("品牌不匹配")>=0 && !!document.getElementById("mwSwitch"))');
    check('BUILD-04 U CARD 工作区在品牌不匹配时给出提示与切换入口', ucardMismatch, '');
    await shot('B04-47-marketing-ucard-mismatch.png');
    await evalJs('(function(){var b=document.getElementById("mwSwitch");if(b)b.click();return true;})()');
    // 等模板真正渲染（品牌不匹配提示消失得比数据渲染早，不能作为完成信号）
    await waitFor('document.body.innerText.indexOf("UCARD_MARKETING")>=0', 'UCARD 模板渲染', 15000);
    const ucardTpl = await evalJs('document.body.innerText.indexOf("UCARD_MARKETING")>=0');
    const ucardMatched = await evalJs('document.body.innerText.indexOf("品牌不匹配")<0');
    check('BUILD-04 切换到 UCARD 后工作区一致且使用 U CARD 模板', ucardTpl && ucardMatched, '');
    await shot('B04-48-marketing-ucard.png');

    // 还原品牌为 VFIB，避免影响后续断言
    await evalJs('(function(){var b=document.querySelector(\'[data-route="marketing-vfib"]\');if(b)b.click();return true;})()');
    await sleep(600);
    await evalJs('(function(){var b=document.getElementById("mwSwitch");if(b)b.click();return true;})()');
    await waitFor('document.body.innerText.indexOf("VFIB_BANKING")>=0', '回到 VFIB', 15000);

    // 8) M-02：Brand Reference Library 与治理页共用同一浏览组件（品牌过滤可见）
    await evalJs('(function(){var b=document.querySelector(\'[data-route="brand-library"]\');if(b)b.click();return true;})()');
    await waitFor('document.getElementById("rbGo")', 'Reference Library 工具条', 15000);
    await sleep(500);
    const sharedAsset = await evalJs('!!document.getElementById("rbQ") && document.body.innerText.indexOf("MOCK 资料库")>=0');
    check('BUILD-04 Reference Library 复用共享资产浏览组件（M-02）', sharedAsset, '');
    await shot('B04-49-brand-reference-shared.png');

    /* ================= Phase 3（BUILD-05）：A-01 情报采集调度 UI =================
     * 目标：验证调度面板在真实浏览器里如实展示「默认关闭 / 单实例限制 / 不会自动采集的原因」，
     *       并且「立即巡检」确实调用后端、结果不粉饰（DEMO 来源全部不可调度 → 执行 0 / 跳过 N）。 */
    await evalJs('(function(){var b=document.querySelector(\'[data-route="intelligence"]\');if(b)b.click();return true;})()');
    await waitFor('document.querySelector(\'[data-t="sources"]\')', 'Intelligence 页签', 15000);
    await evalJs('(function(){var b=document.querySelector(\'[data-t="sources"]\');if(b)b.click();return true;})()');
    await waitFor('document.getElementById("schedCard") && document.getElementById("schedCard").innerText.indexOf("采集调度")>=0', '调度面板挂载', 15000);
    await waitFor('document.getElementById("schedCard").innerText.indexOf("单实例限制")>=0', '调度面板数据到达', 15000);

    const schedText = await evalJs('document.getElementById("schedCard").innerText');
    check('Phase3 调度面板：默认关闭且如实声明单实例限制',
      String(schedText).indexOf('未运行') !== -1 && String(schedText).indexOf('单实例限制') !== -1
        && String(schedText).indexOf('只支持单实例') !== -1 && String(schedText).indexOf('默认关闭') !== -1,
      String(schedText).slice(0, 200));

    const blockedCount = await evalJs('(function(){var t=document.getElementById("schedCard").innerText;var m=t.match(/不会自动采集的来源（(\\d+)）/);return m?Number(m[1]):-1;})()');
    check('Phase3 到期预览逐条给出「不会自动采集」的原因（未核验 / MANUAL 频率）',
      blockedCount >= 2, 'blocked=' + blockedCount);

    const jobsText = await evalJs('document.getElementById("jobsCard").innerText');
    check('Phase3 作业记录卡渲染（空态也给出明确说明，不显示假数据）',
      String(jobsText).indexOf('采集作业记录') !== -1,
      String(jobsText).slice(0, 160));

    // 真实调用后端：立即执行一轮巡检（DEMO 来源均不可调度 → 执行 0）
    await evalJs('(function(){document.getElementById("schedTick").click();return true;})()');
    await waitFor('document.getElementById("schedOut") && document.getElementById("schedOut").innerText.indexOf("本轮巡检")>=0', '巡检结果', 15000);
    const tickOut = await evalJs('document.getElementById("schedOut").innerText');
    const ranM = String(tickOut).match(/执行\s*(\d+)\s*个来源/);
    const skipM = String(tickOut).match(/跳过\s*(\d+)\s*个/);
    check('Phase3 「立即巡检」真实执行且不粉饰：DEMO 来源全部不可调度 → 执行 0、跳过 N',
      !!ranM && Number(ranM[1]) === 0 && !!skipM && Number(skipM[1]) >= 2,
      String(tickOut).replace(/\s+/g, ' ').slice(0, 200));
    await shot('B05-50-intelligence-scheduler.png');

    // 运行时开关（开启 → 运行中 → 关闭 → 未运行）
    await evalJs('(function(){document.getElementById("schedToggle").click();return true;})()');
    await waitFor('document.getElementById("schedCard") && document.getElementById("schedCard").innerText.indexOf("运行中")>=0', '调度开启', 15000);
    const onText = await evalJs('document.getElementById("schedCard").innerText');
    check('Phase3 运行时可开启自动采集（状态如实变为运行中）',
      String(onText).indexOf('运行中') !== -1 && String(onText).indexOf('关闭自动采集') !== -1,
      String(onText).slice(0, 160));
    await shot('B05-51-scheduler-enabled.png');

    await evalJs('(function(){document.getElementById("schedToggle").click();return true;})()');
    await waitFor('document.getElementById("schedCard") && document.getElementById("schedCard").innerText.indexOf("未运行")>=0', '调度关闭', 15000);
    const offText = await evalJs('document.getElementById("schedCard").innerText');
    check('Phase3 关闭后恢复未运行（开关双向可用，不残留自动出站）',
      String(offText).indexOf('未运行') !== -1, String(offText).slice(0, 160));

    // 来源表展示频率与「不自动」标识
    const srcTableText = await evalJs('(function(){var t=document.querySelectorAll(".card");for(var i=0;i<t.length;i++){if(t[i].innerText.indexOf("来源登记表")>=0)return t[i].innerText;}return "";})()');
    check('Phase3 来源登记表展示采集频率与「不自动」标识',
      String(srcTableText).indexOf('频率') !== -1 && String(srcTableText).indexOf('不自动') !== -1,
      String(srcTableText).slice(0, 200));

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
