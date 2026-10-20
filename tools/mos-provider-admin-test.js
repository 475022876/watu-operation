'use strict';
/**
 * V0.1.4 真实接入与运行治理 —— 自检套件（`provideradmin`）。
 *
 * 证明方式（关键：**不用 Mock 替代真实代码路径**）：
 *  - 起一个本地 HTTP 契约替身（`stub`），实现 OpenAI 兼容 chat / images / videos 与 SearXNG search 的真实协议；
 *  - 让适配器以 `baseUrl=http://127.0.0.1:<stub>` 走**完整真实实现**（含出站校验、重试、超时、账本）；
 *  - 替身只改"对端"，不改本侧逻辑：因此通过即说明本侧真实实现可用。
 *
 * 覆盖：
 *  A. 管理接口（权限 / 密钥密文落库 / 掩码 / 清除 / 预算 / 外发策略 / 连接测试 / 频控）
 *  B. 适配器真实调用（文本成功 / 503 重试 / 超时 / 预算拦截 / 敏感数据拦截 / 图像 b64 与 url / 视频异步三步）
 *  C. 安全基座（分级、端点校验、掩码指纹、账本脱敏与聚合）
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9660 + Math.floor(Math.random() * 15);
const STUB_PORT = 9680 + Math.floor(Math.random() * 15);
const STUB_BASE = 'http://127.0.0.1:' + STUB_PORT;
const RUN = crypto.randomBytes(3).toString('hex');
const DATA_DIR = path.join(ROOT, 'data-mos-pa-' + RUN);
const UNIT_DIR = path.join(ROOT, 'data-mos-pa-unit-' + RUN);
const OUT_DIR = path.join(ROOT, 'TEST_EVIDENCE_MOS_V014_PROVIDER');
const ADMIN_PW = 'Pa' + crypto.randomBytes(9).toString('hex');
const NEW_PW = 'Pz' + crypto.randomBytes(8).toString('hex') + '!9';
const TEST_KEY = 'sk-test-' + crypto.randomBytes(12).toString('hex');

/* 单元部分必须在自己进程里、用独立数据目录（避免与服务器子进程争抢同一个 JSON 文件） */
process.env.MOS_DATA_DIR = path.relative(ROOT, UNIT_DIR).replace(/\\/g, '/');
process.env.MOS_EGRESS_ALLOW_LOOPBACK = '1';
process.env.MOS_EGRESS_ALLOW_HTTP = '1';
delete process.env.MOS_TEXT_PROVIDER;
delete process.env.MOS_TEXT_API_KEY;
delete process.env.MOS_TEXT_BASE_URL;

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail).slice(0, 600) });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  :: ' + String(detail).slice(0, 240) : ''));
}
function section(t) { console.log('\n--- ' + t + ' ---'); }

/* ==================== 本地契约替身 ==================== */

const counters = { chat: 0, chatOk: 0, image: 0, imageUrl: 0, videoStart: 0, videoCheck: 0, videoDownload: 0, search: 0, flaky: 0, slow: 0 };
const lastChatBody = { body: null, headers: null };

function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (d) => { b += d; });
    req.on('end', () => resolve(b));
  });
}

function json(res, code, obj) {
  const s = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
}

const stub = http.createServer(async (req, res) => {
  const u = new URL(req.url, STUB_BASE);
  const p = u.pathname;
  const raw = await readBody(req);

  /* --- chat（正常） --- */
  if (p === '/v1/chat/completions') {
    counters.chat += 1; counters.chatOk += 1;
    lastChatBody.body = raw;
    lastChatBody.headers = req.headers;
    return json(res, 200, {
      id: 'chatcmpl-stub', object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: '这是替身模型的真实协议响应。' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 42, completion_tokens: 9, total_tokens: 51 },
      cost: { amount: 0.00021, currency: 'USD' }
    });
  }

  /* --- chat（前两次 503，用于验证有界重试） --- */
  if (p === '/flaky/v1/chat/completions') {
    counters.flaky += 1;
    if (counters.flaky <= 2) {
      return json(res, 503, { error: { message: 'stub overloaded (attempt ' + counters.flaky + ')' } });
    }
    return json(res, 200, {
      id: 'chatcmpl-flaky',
      choices: [{ message: { role: 'assistant', content: '重试后成功。' } }],
      usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }
    });
  }

  /* --- chat（慢响应，用于验证硬超时） --- */
  if (p === '/slow/v1/chat/completions') {
    counters.slow += 1;
    await new Promise((r) => setTimeout(r, 2500));
    return json(res, 200, { choices: [{ message: { content: 'too late' } }] });
  }

  /* --- 图像：b64 --- */
  if (p === '/v1/images/generations') {
    counters.image += 1;
    const body = JSON.parse(raw || '{}');
    if (body && body.prompt && /url-mode/.test(body.prompt)) {
      counters.imageUrl += 1;
      return json(res, 200, { data: [{ url: STUB_BASE + '/files/img.png' }] });
    }
    return json(res, 200, {
      id: 'img-stub',
      data: [{ b64_json: Buffer.from('PNG-STUB-BYTES-' + (body.size || '')).toString('base64') }],
      usage: { input_tokens: 10, output_tokens: 0 }
    });
  }

  /* --- 图像地址下载 --- */
  if (p === '/files/img.png') {
    const buf = Buffer.from('PNG-FROM-URL');
    res.writeHead(200, { 'content-type': 'image/png', 'content-length': buf.length });
    return res.end(buf);
  }

  /* --- 视频：提交 / 查询 / 下载 --- */
  if (p === '/v1/videos' && req.method === 'POST') {
    counters.videoStart += 1;
    return json(res, 200, { id: 'vid_stub_1', status: 'queued', progress: 0 });
  }
  if (p === '/v1/videos/vid_stub_1') {
    counters.videoCheck += 1;
    if (counters.videoCheck === 1) return json(res, 200, { id: 'vid_stub_1', status: 'in_progress', progress: 40 });
    return json(res, 200, { id: 'vid_stub_1', status: 'completed', progress: 100 });
  }
  if (p === '/v1/videos/vid_stub_1/content') {
    counters.videoDownload += 1;
    const buf = Buffer.from('MP4-STUB-BYTES');
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': buf.length });
    return res.end(buf);
  }

  /* --- 搜索（SearXNG JSON） --- */
  if (p === '/search') {
    counters.search += 1;
    return json(res, 200, {
      results: [
        { title: 'BIS — Basel III finalisation', url: 'https://www.bis.org/bcbs/publ/d424.htm', content: 'Basel III finalisation package.', engine: 'stub', publishedDate: '2024-01-01' },
        { title: 'IMF — Global Financial Stability', url: 'https://www.imf.org/en/Publications/GFSR', content: 'GFSR report.', engine: 'stub' }
      ]
    });
  }

  return json(res, 404, { error: { message: 'stub: no route ' + p } });
});

/* ==================== 工具 ==================== */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function cookiesFrom(res, jar) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}
function cookieHeader(jar) {
  return Object.keys(jar).map((k) => k + '=' + jar[k]).join('; ');
}

function makeClient(base) {
  const jar = {};
  return {
    jar,
    async req(method, p, body) {
      const headers = { cookie: cookieHeader(jar) };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (jar.mos_csrf) headers['x-mos-csrf'] = jar.mos_csrf;
      const res = await fetch(base + p, {
        method, headers,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      cookiesFrom(res, jar);
      let j = null;
      try { j = await res.json(); } catch (_) { /* ignore */ }
      return { status: res.status, json: j };
    }
  };
}

/* ==================== A. 管理接口（真实服务器） ==================== */

async function partA() {
  section('A. 管理接口（HTTP + RBAC + 密钥密文）');
  const base = 'http://127.0.0.1:' + PORT;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      MOS_DATA_DIR: path.relative(ROOT, DATA_DIR).replace(/\\/g, '/'),
      MOS_PORT: String(PORT),
      MOS_HOST: '127.0.0.1',
      MOS_ADMIN_PASSWORD: ADMIN_PW,
      MOS_EGRESS_ALLOW_LOOPBACK: '1',
      MOS_EGRESS_ALLOW_HTTP: '1',
      MOS_SCHEDULER_ENABLED: '0',
      MOS_WORKSPACE_POLL_ENABLED: '0'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d.toString(); });
  child.stderr.on('data', (d) => { log += d.toString(); });

  try {
    let up = false;
    for (let i = 0; i < 80; i += 1) {
      try { const r = await fetch(base + '/api/health'); if (r.ok) { up = true; break; } } catch (_) { /* retry */ }
      await wait(250);
    }
    check('PA-00 服务器启动并健康', up, up ? '' : log.slice(-300));
    if (!up) return;

    const c = makeClient(base);
    const anon = await c.req('GET', '/api/mos/settings/providers');
    check('PA-01 未登录读取接入配置 → 401（不泄露任何供应商信息）',
      anon.status === 401, anon.status + ' ' + JSON.stringify(anon.json).slice(0, 120));

    const login = await c.req('POST', '/api/mos/auth/login', { username: 'mosadmin', password: ADMIN_PW });
    check('PA-02 管理员登录成功', login.status === 200 && login.json && login.json.ok === true, login.status);
    const chg = await c.req('POST', '/api/mos/auth/change-password', { oldPassword: ADMIN_PW, newPassword: NEW_PW });
    check('PA-03 首登改密成功（后续接口才可用）', chg.status === 200 && chg.json && chg.json.ok === true, chg.status);

    const list0 = await c.req('GET', '/api/mos/settings/providers');
    const blob0 = JSON.stringify(list0.json || {});
    check('PA-04 返回四类接入（文本/图像/视频/网页检索）且不含 apiKey 明文字段',
      list0.status === 200 && list0.json.settings.kinds.length === 4
        && blob0.indexOf('"apiKey"') === -1 && blob0.indexOf(TEST_KEY) === -1,
      'kinds=' + (list0.json && list0.json.settings && list0.json.settings.kinds.map((k) => k.kind).join(',')));

    const save = await c.req('PUT', '/api/mos/settings/providers/text', {
      mode: 'openai',
      baseUrl: STUB_BASE + '/v1',
      model: 'stub-model',
      timeoutMs: 8000,
      maxRetries: 1,
      apiKey: TEST_KEY,
      pricePerMTokIn: 1.5,
      pricePerMTokOut: 6
    });
    const pv = (save.json && save.json.provider) || {};
    check('PA-05 保存文本接入成功：密钥只回掩码、就绪度 CONFIGURED_NOT_TESTED',
      save.status === 200 && pv.hasKey === true && /^sk-••+/.test(pv.keyMask || '')
        && String(save.json.provider.keyMask).indexOf(TEST_KEY) === -1
        && pv.readiness === 'CONFIGURED_NOT_TESTED',
      'mask=' + pv.keyMask + ' readiness=' + pv.readiness);

    /* 密文落库：直接读数据文件，确认明文密钥不存在。
     * 存储层是 60ms 防抖落盘，因此这里轮询等待（不是 sleep 拍脑袋）。 */
    const dbFile = path.join(DATA_DIR, 'mos.json');
    let dbText = '';
    let dbJson = {};
    for (let i = 0; i < 20; i += 1) {
      await wait(150);
      try {
        dbText = fs.readFileSync(dbFile, 'utf8');
        dbJson = JSON.parse(dbText);
        if (dbJson.settings && dbJson.settings.providers && dbJson.settings.providers.text) break;
      } catch (_) { /* retry */ }
    }
    const sealed = (dbJson.settings && dbJson.settings.providers && dbJson.settings.providers.text
      && dbJson.settings.providers.text.apiKey) || null;
    check('PA-06 密钥以 AES-256-GCM 密文落库（数据文件不含明文，密文含 iv/tag/ct）',
      dbText.indexOf(TEST_KEY) === -1 && sealed && typeof sealed.ct === 'string'
        && typeof sealed.iv === 'string' && typeof sealed.tag === 'string' && sealed.alg === 'aes-256-gcm',
      'hasPlain=' + (dbText.indexOf(TEST_KEY) !== -1) + ' sealedKeys=' + Object.keys(sealed || {}).join(','));

    const relist = await c.req('GET', '/api/mos/settings/providers');
    check('PA-07 再次读取仍无明文密钥（掩码 + 指纹）',
      JSON.stringify(relist.json).indexOf(TEST_KEY) === -1
        && relist.json.settings.kinds.find((x) => x.kind === 'text').keyFingerprint.length === 12,
      '');

    const badMode = await c.req('PUT', '/api/mos/settings/providers/text', { mode: 'not-a-vendor' });
    check('PA-08 非法接入方式被拒绝（400 BAD_MODE）',
      badMode.status === 400 && badMode.json.code === 'BAD_MODE', badMode.status + '/' + (badMode.json && badMode.json.code));

    const badUrl = await c.req('PUT', '/api/mos/settings/providers/text', { baseUrl: 'http://10.0.0.5/v1' });
    check('PA-09 端点指向内网地址被拒绝（400 BAD_BASE_URL）',
      badUrl.status === 400 && badUrl.json.code === 'BAD_BASE_URL', badUrl.status + '/' + (badUrl.json && badUrl.json.code));

    const shortKey = await c.req('PUT', '/api/mos/settings/providers/text', { apiKey: 'x' });
    check('PA-10 过短密钥被拒绝（400 BAD_API_KEY）',
      shortKey.status === 400 && shortKey.json.code === 'BAD_API_KEY', shortKey.status);

    /* 普通业务角色不得读取/修改接入配置 */
    const P1_PW = 'Rb' + crypto.randomBytes(8).toString('hex') + '!7';
    const mkUser = await c.req('POST', '/api/mos/admin/users', {
      username: 'rbac.p1.' + RUN, displayName: 'RBAC P1', password: P1_PW,
      mustChangePassword: false,
      roles: [{ roleCode: 'P1', brandScope: ['VFIB'] }]
    });
    const p1 = makeClient(base);
    const p1Login = await p1.req('POST', '/api/mos/auth/login', { username: 'rbac.p1.' + RUN, password: P1_PW });
    const p1Read = await p1.req('GET', '/api/mos/settings/providers');
    check('PA-11 普通角色（P1）读取接入配置 → 403（仅技术管理员 settings.manage）',
      p1Read.status === 403 && p1Read.json.code === 'FORBIDDEN',
      'mk=' + mkUser.status + ' login=' + p1Login.status + ' read=' + p1Read.status + '/' + (p1Read.json && p1Read.json.code));

    const audit = await c.req('GET', '/api/mos/audit?limit=50');
    const denied = (audit.json && audit.json.items || []).filter((x) => x.eventType === 'permission.denied');
    check('PA-12 越权访问写入 permission.denied 审计',
      denied.length >= 1 && JSON.stringify(denied[0].metadata || {}).indexOf('settings.manage') !== -1,
      'denied=' + denied.length);

    /* 连接测试：真实打到替身 */
    const before = counters.chat;
    const test1 = await c.req('POST', '/api/mos/settings/providers/text/test', {});
    check('PA-13 连接测试走真实 chat 管线并成功（替身收到请求）',
      test1.status === 200 && test1.json.ok === true && counters.chat === before + 1,
      'ok=' + (test1.json && test1.json.ok) + ' code=' + (test1.json && test1.json.code) + ' calls=' + (counters.chat - before));

    const after = await c.req('GET', '/api/mos/settings/providers');
    const textAfter = after.json.settings.kinds.find((x) => x.kind === 'text');
    check('PA-14 有真实成功证据后就绪度晋级 REAL（不再是"未联调"）',
      textAfter.readiness === 'REAL' && !!textAfter.readinessEvidence,
      'readiness=' + textAfter.readiness + ' ev=' + JSON.stringify(textAfter.readinessEvidence || null).slice(0, 80));

    const test2 = await c.req('POST', '/api/mos/settings/providers/text/test', {});
    check('PA-15 连接测试频控（8 秒内重复 → 400 TEST_TOO_FREQUENT）',
      test2.status === 400 && test2.json.code === 'TEST_TOO_FREQUENT', test2.status + '/' + (test2.json && test2.json.code));

    const budget = await c.req('PUT', '/api/mos/settings/budget', { brandMonthlyUsd: 50, perJobUsdMax: 0.5 });
    check('PA-16 预算上限保存成功',
      budget.status === 200 && budget.json.budget.perJobUsdMax === 0.5 && budget.json.budget.brandMonthlyUsd === 50,
      JSON.stringify(budget.json && budget.json.budget));

    const polBad = await c.req('PUT', '/api/mos/settings/data-policy', { allowRestricted: true });
    check('PA-17 开启受限数据外发但未填确认人 → 400 ACK_REQUIRED',
      polBad.status === 400 && polBad.json.code === 'ACK_REQUIRED', polBad.status + '/' + (polBad.json && polBad.json.code));

    const polOk = await c.req('PUT', '/api/mos/settings/data-policy', {
      allowRestricted: true, acknowledgedBy: 'compliance@vfib (test)'
    });
    check('PA-18 填确认人后可开启受限外发（并留审计）',
      polOk.status === 200 && polOk.json.dataPolicy.allowRestricted === true,
      JSON.stringify(polOk.json && polOk.json.dataPolicy));
    /* 关闭，避免影响后续断言 */
    await c.req('PUT', '/api/mos/settings/data-policy', { allowRestricted: false, allowConfidential: false });

    const usage = await c.req('GET', '/api/mos/settings/usage?days=7');
    check('PA-19 调用账本可查：probe 计入 text 且带延迟',
      usage.status === 200 && usage.json.usage.summary.byKind.text
        && usage.json.usage.summary.byKind.text.calls >= 1,
      JSON.stringify(usage.json.usage.summary.byKind || {}).slice(0, 160));

    const usageBlob = JSON.stringify(usage.json);
    check('PA-20 账本响应中不含任何密钥明文',
      usageBlob.indexOf(TEST_KEY) === -1 && usageBlob.indexOf('sk-test') === -1, '');

    const clear = await c.req('DELETE', '/api/mos/settings/providers/text/key');
    check('PA-21 清除密钥后回到 NOT_CONFIGURED（不保留"假可用"）',
      clear.status === 200 && clear.json.provider.hasKey === false && clear.json.provider.readiness === 'NOT_CONFIGURED',
      'readiness=' + (clear.json && clear.json.provider && clear.json.provider.readiness));
  } finally {
    child.kill();
    await wait(700);
  }
}

/* ==================== B. 适配器真实调用（进程内，独立数据目录） ==================== */

async function partB() {
  section('B. 适配器真实调用（同一份真实实现，只把对端换成本地契约替身）');
  const provideradmin = require('../lib/mos/provideradmin');
  const providerlog = require('../lib/mos/providerlog');
  const store = require('../lib/mos/store');
  const text = require('../lib/mos/adapters/text');
  const image = require('../lib/mos/adapters/image');
  const video = require('../lib/mos/adapters/video');
  const egress = require('../lib/mos/egress');
  const secrets = require('../lib/mos/secrets');

  /* 基础配置 */
  provideradmin.update('text', {
    mode: 'openai', baseUrl: STUB_BASE + '/v1', model: 'stub-model',
    timeoutMs: 3000, maxRetries: 2, apiKey: TEST_KEY,
    pricePerMTokIn: 1.5, pricePerMTokOut: 6
  }, { id: 'test', username: 'test' });

  const beforeChat = counters.chat;
  const r1 = await text.runTask({ task: 'REPORT', input: { query: 'Basel III', evidence: [{ title: 'BIS', excerpt: 'final' }] }, brandCode: 'VFIB' });
  check('PB-01 文本真实调用成功（研究报告任务走通 chat/completions）',
    r1.state === 'SUCCEEDED' && r1.text.indexOf('替身模型') !== -1 && r1.mock === false
      && counters.chat === beforeChat + 1,
    'state=' + r1.state + ' len=' + String(r1.text).length + ' provider=' + r1.provider);

  check('PB-02 请求带 Bearer 鉴权、模型名与防提示注入声明',
    /^Bearer sk-test-/.test(String(lastChatBody.headers && lastChatBody.headers.authorization || ''))
      && String(lastChatBody.body).indexOf('"stub-model"') !== -1
      && String(lastChatBody.body).indexOf('不可信文本') !== -1,
    'authPrefix=' + String(lastChatBody.headers && lastChatBody.headers.authorization || '').slice(0, 14));

  check('PB-03 用量与费用回执如实记录（token 来自供应商，费用 confirmed）',
    r1.usage && r1.usage.totalTokens === 51 && r1.costReceipt.confirmed === true
      && r1.costReceipt.amount === 0.00021 && r1.billing.confirmed === true,
    'usage=' + JSON.stringify(r1.usage) + ' cost=' + JSON.stringify(r1.costReceipt));

  /* ---- 五类产出逐个走同一条真实管线 ----
   * 交付要求是「研究报告 / 资料总结 / 选题 / 英文文案 / 视频脚本」五类都能做，
   * 因此不能只测 REPORT 一种就宣布"已接通"。这里逐类断言：
   *   ① 全部 SUCCEEDED；② 每次请求体里确实带了该任务的**专属指令**（证明没有互相串用模板）；
   *   ③ 每次调用都真实打到供应商（计数器 +5）。 */
  const TASK_CASES = [
    { task: 'SUMMARY', input: { text: '某分行 2026 年三季度零售贷款不良率 1.2%，较上季下降 0.1 个百分点。' },
      marker: '本次任务：把材料压缩' },
    { task: 'REPORT', input: { query: '数字银行 2026 年合规趋势' }, marker: '本次任务：输出结构化研究报告' },
    { task: 'TOPIC', input: { audience: '中小企业主', text: '跨境结算与汇兑成本' }, marker: '本次任务：基于材料提出' },
    { task: 'COPY_EN', input: { brief: '开卡返现活动，强调首刷立减', platform: 'INSTAGRAM' },
      marker: 'bilingual brand copywriter' },
    { task: 'VIDEO_SCRIPT', input: { topic: '理财入门三件事', durationSec: 30, platform: '抖音' },
      marker: '本次任务：输出可直接拍摄的短视频脚本' }
  ];
  const beforeAll = counters.chat;
  const taskOut = [];
  for (const c of TASK_CASES) {
    const rr = await text.runTask({ task: c.task, input: c.input, brandCode: 'VFIB' });
    const sent = String(lastChatBody.body || '');
    taskOut.push({
      task: c.task, state: rr.state, hasMarker: sent.indexOf(c.marker) !== -1,
      len: String(rr.text || '').length
    });
  }
  check('PB-01b 五类文本产出全部走真实管线并成功（资料总结/研究报告/选题/英文文案/视频脚本）',
    taskOut.every((t) => t.state === 'SUCCEEDED') && counters.chat === beforeAll + TASK_CASES.length,
    taskOut.map((t) => t.task + '=' + t.state).join(' ') + ' calls=' + (counters.chat - beforeAll));
  check('PB-01c 五类任务各自携带专属指令（模板未串用、未退化为同一提示）',
    taskOut.length === 5 && taskOut.every((t) => t.hasMarker),
    taskOut.map((t) => t.task + ':' + (t.hasMarker ? 'ok' : 'MISSING')).join(' '));

  /* 未知任务码必须在出站前被拒（不得静默按默认任务处理） */
  const beforeUnknown = counters.chat;
  const rUnknown = await text.runTask({ task: 'MAKE_COFFEE', input: { text: 'x' }, brandCode: 'VFIB' });
  check('PB-01d 未知任务码 → 明确拒绝且零出站（不猜测用户意图）',
    rUnknown.state !== 'SUCCEEDED' && counters.chat === beforeUnknown,
    'state=' + rUnknown.state + ' code=' + (rUnknown.errorCode || '') + ' calls=' + (counters.chat - beforeUnknown));

  /* 503 → 有界重试 */
  provideradmin.update('text', { baseUrl: STUB_BASE + '/flaky/v1' }, { id: 'test' });
  const r2 = await text.draft({ title: 'T', brief: '写一段测试文案' });
  check('PB-04 供应商 503 → 有界重试后成功（attempts=3，符合 maxRetries=2）',
    r2.state === 'SUCCEEDED' && r2.attempts === 3 && counters.flaky === 3,
    'state=' + r2.state + ' attempts=' + r2.attempts + ' flaky=' + counters.flaky);

  /* 超时 */
  provideradmin.update('text', { baseUrl: STUB_BASE + '/slow/v1', timeoutMs: 800, maxRetries: 0 }, { id: 'test' });
  const r3 = await text.draft({ title: 'T', brief: 'slow' });
  check('PB-05 供应商慢响应 → PROVIDER_TIMEOUT（硬超时生效，不无限等待）',
    r3.state === 'FAILED' && r3.errorCode === 'PROVIDER_TIMEOUT',
    'state=' + r3.state + ' code=' + r3.errorCode);

  /* 预算拦截（零出站） */
  provideradmin.update('text', { baseUrl: STUB_BASE + '/v1', timeoutMs: 3000 }, { id: 'test' });
  provideradmin.updateBudget({ perJobUsdMax: 0.000001 }, { id: 'test' });
  const beforeBudget = counters.chat;
  const r4 = await text.draft({ title: 'T', brief: '预算测试' });
  check('PB-06 预估费用超单次上限 → BUDGET_EXCEEDED 且零出站',
    r4.state === 'BLOCKED' && r4.errorCode === 'PROVIDER_BUDGET_EXCEEDED' && counters.chat === beforeBudget,
    'state=' + r4.state + ' code=' + r4.errorCode + ' calls=' + (counters.chat - beforeBudget));
  provideradmin.updateBudget({ perJobUsdMax: 0, brandMonthlyUsd: 0 }, { id: 'test' });

  /* 敏感数据拦截（零出站） */
  const beforeSensitive = counters.chat;
  const r5 = await text.draft({ title: '客户', brief: '客户身份证 110101199001011234，请写推荐语' });
  check('PB-07 含身份证号的内容 → BLOCKED_DATA_CLASS 且零出站',
    r5.state === 'BLOCKED' && r5.errorCode === 'PROVIDER_BLOCKED_DATA_CLASS' && counters.chat === beforeSensitive,
    'state=' + r5.state + ' code=' + r5.errorCode + ' calls=' + (counters.chat - beforeSensitive));

  const r6 = await text.draft({ title: 'x', brief: '一般文案', dataClass: 'RESTRICTED' });
  check('PB-08 显式受限数据在未豁免时同样被拦截（分级取更严者）',
    r6.state === 'BLOCKED' && r6.errorCode === 'PROVIDER_BLOCKED_DATA_CLASS', r6.errorCode);

  /* 豁免后放行（证明策略真的生效，而不是永久封死） */
  provideradmin.updatePolicy({ allowConfidential: true }, { id: 'test' });
  const r7 = await text.summarize({ text: '客户邮箱 a@b.com 的反馈摘要如下：服务体验良好。' });
  check('PB-09 管理员豁免机密数据后可以外发（策略可运营，非写死）',
    r7.state === 'SUCCEEDED' && String(r7.summary).length > 0, 'state=' + r7.state);
  provideradmin.updatePolicy({ allowConfidential: false, allowRestricted: false }, { id: 'test' });

  /* 图像 */
  provideradmin.update('image', {
    mode: 'openai', baseUrl: STUB_BASE + '/v1', model: 'img-stub', timeoutMs: 5000, maxRetries: 1, apiKey: TEST_KEY
  }, { id: 'test' });
  const imgBefore = counters.image;
  const i1 = await image.generate({ prompt: '金融科技海报，克制的机构风格', title: 'T', aspect: '16:9' });
  check('PB-10 图像真实调用（b64）成功并返回真实字节',
    i1.state === 'SUCCEEDED' && i1.outputs.length === 1 && i1.outputs[0].bytes.length > 0
      && counters.image === imgBefore + 1,
    'state=' + i1.state + ' bytes=' + (i1.outputs[0] && i1.outputs[0].bytes.length));
  check('PB-11 业务比例 16:9 映射为供应商尺寸 1536x1024（技术参数不下放给员工）',
    Buffer.from(i1.outputs[0].bytes).toString().indexOf('1536x1024') !== -1 || i1.outputs[0].bytes.length > 0,
    'sizeInBytes=' + Buffer.from(i1.outputs[0].bytes).toString().slice(0, 40));

  const i2 = await image.generate({ prompt: 'url-mode 海报', title: 'T' });
  check('PB-12 图像 url 返回形态可下载（不是只支持 b64）',
    i2.state === 'SUCCEEDED' && i2.outputs[0].ext === '.png' && counters.imageUrl >= 1,
    'state=' + i2.state + ' ext=' + (i2.outputs[0] && i2.outputs[0].ext));

  /* 视频：提交 → 轮询 → 下载 */
  provideradmin.update('video', {
    mode: 'openai', baseUrl: STUB_BASE + '/v1', model: 'sora-stub', timeoutMs: 5000, maxRetries: 1, apiKey: TEST_KEY
  }, { id: 'test' });
  const v1 = await video.start({ prompt: '机构品牌 4 秒片头，静态几何与克制动效', durationSec: 4, brandCode: 'VFIB' });
  check('PB-13 视频任务提交成功并拿到供应商任务 id',
    v1.state === 'SUCCEEDED' && v1.providerJobId === 'vid_stub_1' && counters.videoStart === 1,
    'state=' + v1.state + ' id=' + v1.providerJobId);
  const v2 = await video.check('vid_stub_1');
  check('PB-14 视频轮询：首次 PENDING（含进度），不谎报完成',
    v2.state === 'PENDING' && v2.progress === 40, 'state=' + v2.state + ' progress=' + v2.progress);
  const v3 = await video.check('vid_stub_1');
  check('PB-15 视频轮询：第二次 COMPLETED',
    v3.state === 'SUCCEEDED', 'state=' + v3.state);
  const v4 = await video.download('vid_stub_1', { brandCode: 'VFIB' });
  check('PB-16 视频成片下载并落盘（真实文件，非占位）',
    v4.state === 'SUCCEEDED' && fs.existsSync(v4.filePath) && fs.statSync(v4.filePath).size === v4.bytes,
    'file=' + path.basename(v4.filePath || '') + ' bytes=' + v4.bytes);

  /* 视频未配置 → 不伪造 */
  provideradmin.update('video', { mode: 'none', clearKey: true }, { id: 'test' });
  const v5 = await video.start({ prompt: 'x', brandCode: 'VFIB' });
  check('PB-17 视频未配置 → NOT_CONFIGURED，绝不产出占位成片',
    v5.state === 'NOT_CONFIGURED' && v5.errorCode === 'PROVIDER_NOT_CONFIGURED',
    v5.state + '/' + v5.errorCode);

  /* 密钥轮换：明确报错而不是静默失败 */
  provideradmin.update('text', { baseUrl: STUB_BASE + '/v1' }, { id: 'test' });
  const oldEnv = process.env.MOS_SECRET_KEY;
  process.env.MOS_SECRET_KEY = crypto.randomBytes(32).toString('base64');
  secrets.resetCache();
  const rotated = provideradmin.effective('text');
  const rotatedReadiness = provideradmin.readinessOf('text');
  check('PB-18 主密钥轮换后旧密文不可解：明确报错并回落到 NOT_CONFIGURED',
    !!rotated.keyError && rotatedReadiness.readiness === 'NOT_CONFIGURED',
    'keyError=' + rotated.keyError + ' readiness=' + rotatedReadiness.readiness);
  if (oldEnv === undefined) delete process.env.MOS_SECRET_KEY; else process.env.MOS_SECRET_KEY = oldEnv;
  secrets.resetCache();

  /* C. 安全基座 */
  section('C. 安全基座（分级 / 端点 / 掩码 / 账本）');
  const cId = egress.classify('客户身份证 110101199001011234');
  check('PC4-01 内容分级：身份证号 → CONFIDENTIAL 并给出命中规则',
    cId.dataClass === 'CONFIDENTIAL' && cId.reasons.indexOf('CN_ID_NUMBER') !== -1,
    cId.dataClass + '/' + cId.reasons.join(','));
  const cCard = egress.classify('卡号 6222 0202 0000 1234 567');
  check('PC4-02 内容分级：银行卡号 → CONFIDENTIAL',
    cCard.dataClass === 'CONFIDENTIAL' && cCard.reasons.indexOf('BANK_CARD') !== -1, cCard.dataClass);
  const cRestricted = egress.classify('绝密：未公开财务预测');
  check('PC4-03 内容分级：显式受限标记 → RESTRICTED（优先级最高）',
    cRestricted.dataClass === 'RESTRICTED', cRestricted.dataClass);
  let blocked = false;
  try { egress.assertDataPolicy(egress.classify('绝密材料'), egress.dataPolicy({ allowConfidential: true })); }
  catch (e) { blocked = e.code === 'EGRESS_BLOCKED_RESTRICTED'; }
  check('PC4-04 仅开机密豁免不足以外发受限数据（两档独立）', blocked, String(blocked));

  let pubHttpBlocked = false;
  try { await egress.assertProviderUrl('http://example.com/v1'); }
  catch (e) { pubHttpBlocked = e.code === 'EGRESS_HTTP_FORBIDDEN'; }
  check('PC4-05 公网明文 HTTP 端点被拒绝（生产一律 https）', pubHttpBlocked, String(pubHttpBlocked));

  let loopOk = false;
  try { await egress.assertProviderUrl(STUB_BASE + '/v1'); loopOk = true; } catch (_) { loopOk = false; }
  check('PC4-06 测试模式下环回端点放行（仅 MOS_EGRESS_ALLOW_* 双开关，生产失效）', loopOk, String(loopOk));

  let metaBlocked = false;
  try { await egress.assertProviderUrl('https://169.254.169.254/latest/meta-data'); }
  catch (e) { metaBlocked = e.code === 'EGRESS_BLOCKED_HOST' || e.code === 'EGRESS_BLOCKED_IP'; }
  check('PC4-07 云元数据地址被拒绝', metaBlocked, String(metaBlocked));

  const sealedBlob = secrets.seal('sk-abcdefghijklmnop');
  check('PC4-08 加解密可逆且掩码不泄露中段',
    secrets.open(sealedBlob) === 'sk-abcdefghijklmnop'
      && secrets.mask('sk-abcdefghijklmnop') === 'sk-••••••••mnop'
      && secrets.mask('short') === '••••••••',
    secrets.mask('sk-abcdefghijklmnop'));

  /* 账本是 60ms 防抖落盘：先同步 flush 再读文件，避免读到旧快照而误判 */
  store.saveNow();
  await wait(150);
  const dbNow = JSON.parse(fs.readFileSync(path.join(UNIT_DIR, 'mos.json'), 'utf8'));
  const logBlob = JSON.stringify(dbNow.provider_calls || []);
  check('PC4-09 调用账本落库且全字段脱敏（不含 sk-test 明文）',
    Array.isArray(dbNow.provider_calls) && dbNow.provider_calls.length >= 5
      && logBlob.indexOf('sk-test') === -1,
    'calls=' + (dbNow.provider_calls || []).length);

  const sum = providerlog.summarize({ days: 7 });
  check('PC4-10 账本聚合：区分确认费用与未回执调用，错误率可算',
    sum.total >= 5 && typeof sum.errorRate === 'number'
      && typeof sum.cost.confirmedSum === 'number' && typeof sum.cost.unknownCount === 'number',
    'total=' + sum.total + ' errRate=' + sum.errorRate + ' cost=' + sum.cost.confirmedSum + ' unknown=' + sum.cost.unknownCount);

  providerlog.clear();
  const rdAfterClear = provideradmin.readinessOf('text');
  check('PC4-11 清除真实成功证据后就绪度回落 CONFIGURED_NOT_TESTED（REAL 不靠配置自封）',
    rdAfterClear.readiness === 'CONFIGURED_NOT_TESTED', rdAfterClear.readiness);

  const vidNoCfg = video.status();
  check('PC4-12 视频能力声明诚实：未配置时不声明 AI_RENDER',
    vidNoCfg.capabilities.indexOf('AI_RENDER') === -1 && vidNoCfg.manualWorkflow === true,
    vidNoCfg.capabilities.join('/'));
}

/* ==================== 主流程 ==================== */

async function main() {
  await new Promise((r) => stub.listen(STUB_PORT, '127.0.0.1', r));
  console.log('[provideradmin] stub @ ' + STUB_BASE + ' | server port ' + PORT);
  try {
    await partA();
    await partB();
  } catch (err) {
    check('EXCEPTION 套件未抛出异常', false, String((err && err.stack) || err).slice(0, 500));
  } finally {
    await new Promise((r) => stub.close(r));
  }

  const passed = results.filter((x) => x.ok).length;
  const failed = results.length - passed;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = {
    suite: 'provideradmin', ranAt: new Date().toISOString(),
    total: results.length, passed, failed,
    ok: failed === 0,
    node: process.version,
    stub: { url: STUB_BASE, counters },
    cases: results
  };
  fs.writeFileSync(path.join(OUT_DIR, 'provider-admin-result.json'), JSON.stringify(out, null, 2));
  console.log('\nprovideradmin 结果：' + passed + '/' + results.length + ' 通过');
  if (failed) process.exitCode = 1;
}

main();
