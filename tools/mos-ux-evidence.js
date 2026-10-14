'use strict';
/* ============================================================
 * Marketing OS · 真实浏览器「员工操作路径」证据采集（V0.1.3）
 * ------------------------------------------------------------
 * 目的（执行包 01 §可量化体验验收 / 06 §验收矩阵 UX-01..04）：
 *   在真实 Chrome 中按员工视角走完关键路径，逐步记录：
 *     - 每一步的**主要确认动作**数（表单输入不计点击）
 *     - 页面是否仍停留在同一任务上下文（模块 id 是否被切走）
 *     - 每一步截图（UI_EVIDENCE/<PHASE>/）
 *   产出 steps.json（步骤/耗时/动作计数）供 FINAL_ACCEPTANCE 引用。
 *
 * 运行：MOS_UX_PHASE=0 node tools/mos-ux-evidence.js
 *       MOS_UX_PHASE=A node tools/mos-ux-evidence.js
 * 约束：零第三方依赖（CDP over 内置 WebSocket）；隔离数据目录；不触碰 data/。
 * ============================================================ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PHASE = String(process.env.MOS_UX_PHASE || '0').toUpperCase();
const PORT = 9700 + Math.floor(Math.random() * 40);
const CDP_PORT = 9800 + Math.floor(Math.random() * 90);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(ROOT, 'data-mos-ux-' + crypto.randomBytes(3).toString('hex'));
const SHOT_DIR = path.join(ROOT, 'UI_EVIDENCE', 'PHASE' + PHASE);

const ADMIN_PW = 'MosUX-' + crypto.randomBytes(9).toString('base64url');
const ADMIN_NEW_PW = 'MosUX-' + crypto.randomBytes(9).toString('base64url');
const P1_PW = 'MosUX-' + crypto.randomBytes(9).toString('base64url');
const P2_PW = 'MosUX-' + crypto.randomBytes(9).toString('base64url');
const P3_PW = 'MosUX-' + crypto.randomBytes(9).toString('base64url');

const CHROME_CANDIDATES = [
  process.env.MOS_CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  path.join(os.homedir(), 'AppData/Local/Google/Chrome/Application/chrome.exe'),
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const steps = [];
function step(o) {
  steps.push(o);
  console.log('  · ' + (o.label || '') + (o.note ? '  :: ' + o.note : ''));
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

/* ---------------- Node 侧 HTTP（带 cookie + CSRF） ---------------- */

function makeClient() {
  let cookies = {};
  const jar = () => Object.keys(cookies).map((k) => k + '=' + cookies[k]).join('; ');
  const call = async (method, p, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookies.mos_csrf) headers['x-mos-csrf'] = cookies.mos_csrf;
    if (jar()) headers.Cookie = jar();
    const res = await fetch(BASE + p, {
      method, headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setC = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setC) {
      const [pair] = String(c).split(';');
      const i = pair.indexOf('=');
      if (i > 0) cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* ignore */ }
    return { status: res.status, json, cookies: Object.assign({}, cookies) };
  };
  return { call, jar, cookiesRef: () => cookies };
}

/* ---------------- 主流程 ---------------- */

async function main() {
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      MOS_DATA_DIR: path.relative(ROOT, DATA_DIR).replace(/\\/g, '/'),
      MOS_PORT: String(PORT),
      MOS_ADMIN_PASSWORD: ADMIN_PW,
      MOS_TEXT_PROVIDER: 'mock',
      MOS_IMAGE_PROVIDER: 'mock',
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

  /* ---- 准备账号：admin 改密 + 三个员工账号 ---- */
  const admin = makeClient();
  let r = await admin.call('POST', '/api/mos/auth/login', { username: 'mosadmin', password: ADMIN_PW });
  if (!r.json || !r.json.ok) throw new Error('admin 登录失败：' + JSON.stringify(r.json));
  if (r.json.mustChangePassword) {
    r = await admin.call('POST', '/api/mos/auth/change-password', { oldPassword: ADMIN_PW, newPassword: ADMIN_NEW_PW });
    if (!r.json || !r.json.ok) throw new Error('admin 改密失败：' + JSON.stringify(r.json));
  }
  const mk = async (username, roleCode, brandScope, password) => {
    const res = await admin.call('POST', '/api/mos/admin/users', {
      username, displayName: 'UX·' + username, password, mustChangePassword: false,
      roles: [{ roleCode, brandScope }]
    });
    if (res.status !== 200) throw new Error('创建 ' + username + ' 失败：' + JSON.stringify(res.json));
    return res.json.user;
  };
  await mk('ux.p1', 'P1', ['VFIB'], P1_PW);
  await mk('ux.p2', 'P2', ['VFIB'], P2_PW);
  await mk('ux.p3', 'P3', ['VFIB'], P3_PW);

  /* ---- 启动 Chrome ---- */
  const chromePath = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chromePath) { console.error('未找到 Chrome/Edge'); server.kill('SIGTERM'); process.exit(2); }
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mos-ux-prof-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--no-proxy-server', '--disable-extensions', '--window-size=1680,1050',
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  let cdpVersion = null;
  for (let i = 0; i < 80; i += 1) {
    try { cdpVersion = await httpJson('http://127.0.0.1:' + CDP_PORT + '/json/version'); break; } catch (_) { /* retry */ }
    await sleep(250);
  }
  if (!cdpVersion) throw new Error('Chrome DevTools 端口不可用');
  console.log('Chrome: ' + cdpVersion.Browser);

  const target = await httpJson('http://127.0.0.1:' + CDP_PORT + '/json/new?about:blank', 'PUT');
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.ready;

  const consoleErrors = [];
  cdp.on((msg) => {
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      consoleErrors.push((msg.params.args || []).map((a) => a.value || a.description || '').join(' '));
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails || {};
      consoleErrors.push('[exception] ' + ((d.exception && (d.exception.description || d.exception.value)) || d.text || ''));
    }
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 1050, deviceScaleFactor: 1, mobile: false });

  const shot = async (name) => {
    const res = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(SHOT_DIR, name), Buffer.from(res.data, 'base64'));
  };
  const evalJs = async (expr) => {
    const res = await cdp.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (res.exceptionDetails) throw new Error('页面执行异常：' + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails.text));
    return res.result ? res.result.value : undefined;
  };
  const waitFor = async (expr, label, timeoutMs) => {
    const t0 = Date.now();
    const limit = timeoutMs || 15000;
    while (Date.now() - t0 < limit) {
      const v = await evalJs('(function(){ try { return !!(' + expr + '); } catch(e) { return false; } })()');
      if (v) return true;
      await sleep(200);
    }
    step({ label: '等待超时：' + label });
    return false;
  };

  /** 注入某账号的会话 cookie 并重载应用 */
  const loginAs = async (username, password) => {
    const c = makeClient();
    const res = await c.call('POST', '/api/mos/auth/login', { username, password });
    if (!res.json || !res.json.ok) throw new Error(username + ' 登录失败：' + JSON.stringify(res.json));
    await cdp.send('Network.enable');
    for (const k of Object.keys(res.cookies)) {
      await cdp.send('Network.setCookie', { name: k, value: res.cookies[k], url: BASE + '/', httpOnly: false });
    }
    // 更新真实 HttpOnly 会话 cookie（login 返回的 mos_sid 已在 setCookie 中）
    await cdp.send('Page.navigate', { url: BASE + '/mos' });
    await waitFor('document.readyState==="complete"', '页面加载');
    await waitFor('document.getElementById("appRoot") && !document.getElementById("appRoot").hidden', '进入应用');
    await sleep(500);
    return res.cookies;
  };

  const gotoModule = async (moduleId) => {
    await evalJs('location.hash = "#/' + moduleId + '"');
    await sleep(900);
  };
  const currentModule = async () => evalJs('(location.hash || "").replace(/^#\\//, "").split("?")[0]');

  try {
    /* ============ 场景 1：五大主导航逐一截图 ============ */
    await loginAs('ux.p1', P1_PW);
    const NAV = ['my-work', 'intelligence', 'planning', 'tasks', 'content-editor', 'visual-studio', 'video-workspace', 'publishing', 'analytics', 'my-reviews'];
    let i = 0;
    for (const m of NAV) {
      i += 1;
      await gotoModule(m);
      const was = await waitFor('document.querySelector("#content h1, #content .page-head h1")', m + ' 渲染');
      const title = await evalJs('(document.querySelector("#content .page-head h1")||{}).textContent || ""');
      const nBtn = await evalJs('document.querySelectorAll("#content button").length');
      await shot('nav-' + String(i).padStart(2, '0') + '-' + m + '.png');
      step({ label: '导航 ' + m, module: await currentModule(), title: String(title).trim(), buttons: nBtn, ok: !!was });
    }

    /* ============ 场景 2：P2 从工作台 → 打开任务 → 进入编辑（UX-02 基线） ============ */
    await loginAs('ux.p2', P2_PW);
    await shot('p2-01-landing.png');
    const landingModule = await currentModule();
    step({ label: 'P2 登录落地页', module: landingModule, ok: landingModule === 'my-work' });

    // 动作计数：从落地页到「可在任务里编辑正文」
    let clicks = 0;
    // 1) 主导航 → 内容制作 分组（点分组标题或子项）
    await evalJs('(function(){var b=document.querySelector(\'[data-route="content-editor"]\'); if(b) b.click(); return !!b;})()');
    clicks += 1;
    await sleep(1200);
    const afterNav = await currentModule();
    await shot('p2-02-after-nav.png');
    step({ label: 'P2 点击「内容编辑器」导航', clicks, module: afterNav, ok: afterNav === 'content-editor' });

    const hasEditor = await waitFor('document.querySelector("#ceText")', '正文编辑器出现');
    await shot('p2-03-editor.png');
    step({ label: 'P2 进入正文编辑', clicks, editorVisible: !!hasEditor });

    /* ============ 场景 3：任务内四标签是否跳出任务（Phase A 整改点基线） ============ */
    const tabs = [
      { ws: 'visual', label: '图片与视频 Visuals & Video' },
      { ws: 'review', label: '审核与交付 Review & Delivery' }
    ];
    for (const t of tabs) {
      await gotoModule('content-editor');
      await waitFor('document.querySelector(\'[data-ws="' + t.ws + '"]\')', 'tab ' + t.ws);
      const before = await currentModule();
      await evalJs('(function(){var b=document.querySelector(\'[data-ws="' + t.ws + '"]\'); if(b) b.click(); return !!b;})()');
      await sleep(1200);
      const after = await currentModule();
      await shot('p2-04-tab-' + t.ws + '.png');
      step({
        label: '任务内点击「' + t.label + '」', before, after,
        jumpedOut: before !== after, ok: before === after
      });
    }

    /* ============ 场景 4：P3 发布闭环入口可见性 ============ */
    await loginAs('ux.p3', P3_PW);
    await gotoModule('publishing');
    await waitFor('document.querySelector("#content .page-head h1")', 'publishing 渲染');
    await shot('p3-01-publishing.png');
    step({ label: 'P3 打开发布管理', module: await currentModule(), ok: true });

    /* ---- 写出步骤日志 ---- */
    const out = {
      phase: PHASE,
      generatedAt: new Date().toISOString(),
      chrome: cdpVersion.Browser,
      base: BASE,
      steps,
      consoleErrors,
      counts: {
        jumpOutTabs: steps.filter((s) => s.jumpedOut === true).length,
        p2ActionsToEditor: steps.filter((s) => s.label && s.label.indexOf('P2 进入正文编辑') !== -1).map((s) => s.clicks)[0]
      }
    };
    fs.writeFileSync(path.join(SHOT_DIR, 'steps.json'), JSON.stringify(out, null, 2));
    console.log('\n证据目录：' + SHOT_DIR);
    console.log('台账：' + steps.length + ' 步；控制台错误 ' + consoleErrors.length + ' 条');
  } finally {
    try { cdp.close(); } catch (_) { /* ignore */ }
    try { chrome.kill('SIGKILL'); } catch (_) { /* ignore */ }
    await sleep(600);
    try { server.kill('SIGTERM'); } catch (_) { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    if (consoleErrors.length) console.log('控制台错误（前 5）：\n' + consoleErrors.slice(0, 5).join('\n'));
    void serverLog;
  }
}

main().catch((err) => { console.error('证据采集失败：', err && err.stack || err); process.exit(1); });
