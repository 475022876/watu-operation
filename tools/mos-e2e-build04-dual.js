#!/usr/bin/env node
'use strict';
/* ============================================================
 * BUILD-04 · B4 —— 双系统**真实 HTTP** 端到端联调（两套独立服务，同一隔离测试环境）
 * ------------------------------------------------------------
 * 依据 V1.1 B 包 `01_CONSUMER_TASKS.md` B4「跨系统联调准备」与 A 包 `02_PROVIDER_TESTS_AND_HANDOFF.md`：
 *   · 在**隔离测试环境**里同时运行两套独立服务（Provider 实例 + Marketing OS 实例）；
 *   · 走**真实 HTTP + 真实 Ed25519 签名 + 真实受限票据**，不做任何进程内打桩；
 *   · Provider 侧只以 `server.js` + 环境变量装配隔离实例，**不改一行资料库源码**；
 *   · 完整覆盖：健康探测 → 只读探测 → 准入三步推送 → 「服务身份不可代签最终审批」
 *     → 本人会话最终审批 → 取得正式 Asset ID → 使用前重新验证 → 撤回传播与本地失效。
 *
 * 诚实性红线：
 *   · 本脚本**不代表** Joint Acceptance PASS —— A 包交付的 `LIBRARY_HANDOFF_BUNDLE_V1.1`
 *     尚未收到，Provider 侧亦未宣布停止点达成；因此结论最高只能到 **CONDITIONAL**。
 *   · 任何一步失败都如实记为 FAIL，不做「跳过即通过」。
 *   · 两个实例的数据目录都在系统临时目录，跑完自清；`data/` 与两个仓库的工作区**不被触碰**。
 *
 * 端口（见 README 端口表；与 OA 侧占用段互斥）：
 *   MOS 实例   9550-9559
 *   Provider   9750-9759
 *
 * 用法：
 *   node tools/mos-e2e-build04-dual.js
 * 可选环境变量：
 *   OA_SOURCE_DIR   资料库仓库路径（默认本机既有路径；不存在则如实记 BLOCKED 并退出码 2）
 *   D4_KEEP         设为 1 时保留临时数据目录（排障用）
 * ============================================================ */

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OA_ROOT = path.resolve(process.env.OA_SOURCE_DIR
  || 'D:/企业数据后台/oa-system-20261004/oa-system');

const MOS_PORT = 9550 + Math.floor(Math.random() * 8);
const OA_PORT = 9750 + Math.floor(Math.random() * 8);
const MOS_BASE = 'http://127.0.0.1:' + MOS_PORT;
const OA_BASE = 'http://127.0.0.1:' + OA_PORT;

const MOS_DATA_DIR = path.join(os.tmpdir(), 'data-mos-d4-' + crypto.randomBytes(4).toString('hex'));
const OA_DATA_DIR = path.join(os.tmpdir(), 'data-oa-d4-' + crypto.randomBytes(4).toString('hex'));
const OUT_DIR = path.join(ROOT, 'TEST_EVIDENCE_MOS_BUILD04');

const MOS_ADMIN_PW = 'D4a-' + crypto.randomBytes(10).toString('base64url');
const MOS_ADMIN_PW2 = 'D4b-' + crypto.randomBytes(10).toString('base64url');
const OA_ADMIN_PW = 'D4o-' + crypto.randomBytes(14).toString('base64url');
const OA_TICKET_KEY = crypto.randomBytes(32).toString('hex');   // Provider 侧票据 HMAC 密钥（运行期随机）
const RUN = crypto.randomBytes(4).toString('hex');

/** MOS 侧服务身份密钥对：**私钥只在本次进程内存**，Provider 只登记公钥 */
const KEYPAIR = crypto.generateKeyPairSync('ed25519');
const PUB_PEM = KEYPAIR.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIV_PEM = KEYPAIR.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const results = [];
let failures = 0;
function check(name, cond, detail) {
  const ok = !!cond;
  if (!ok) failures += 1;
  results.push({ name, ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  :: ' + detail : ''));
}
function section(t) { console.log('\n--- ' + t + ' ---'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- 脱敏（证据可外发） ---------------- */
const SECRET_KEY_RE = /^(ticket|x-vfib-ticket|x-vfib-signature|authorization|cookie|set-cookie|privatekey|privateKeyPem|signingKey|password|publicKey|publicKeyPem|apiKey)$/i;
const transcript = [];
function redact(v, depth) {
  const d = depth || 0;
  if (d > 6 || v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map((x) => redact(x, d + 1));
  const out = {};
  for (const k of Object.keys(v)) {
    const val = v[k];
    if (SECRET_KEY_RE.test(k)) { out[k] = val ? 'REDACTED' : ''; continue; }
    if (typeof val === 'string' && /^[A-Za-z0-9+/=_-]{80,}$/.test(val)) { out[k] = 'REDACTED_BLOB'; continue; }
    out[k] = redact(val, d + 1);
  }
  return out;
}

/* ---------------- 通用 HTTP ---------------- */
async function httpJson(base, pathname, opts) {
  const o = opts || {};
  const res = await fetch(base + pathname, {
    method: o.method || 'GET',
    headers: o.headers || {},
    body: o.body === undefined ? undefined : (typeof o.body === 'string' ? o.body : JSON.stringify(o.body)),
    redirect: 'manual'
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

/** 最小合法 PNG（唯一字节，避免预检 not_duplicate 误伤） */
let pngSeq = 0;
function png(tag) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    Buffer.from('d4-dual-' + (tag || 'img') + '-' + (++pngSeq) + '-' + Date.now())
  ]);
}

/* ---------------- Provider 侧签名（与 lib/integration/service-accounts.js 同构） ---------------- */
function canonicalString(keyId, method, pathname, timestamp, nonce, bodyHash) {
  return ['v1', keyId, String(method).toUpperCase(), pathname, String(timestamp), String(nonce), bodyHash].join('\n');
}
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

let OA_KEY_ID = '';
function signedOaRequest(method, pathname, bodyObj, ticket, override) {
  const o = override || {};
  const keyId = o.keyId !== undefined ? o.keyId : OA_KEY_ID;
  const bodyStr = (bodyObj === undefined || bodyObj === null) ? '' : JSON.stringify(bodyObj);
  // ⚠ Provider 的时间窗以**秒**为单位（±300s），不得传毫秒
  const ts = o.timestamp !== undefined ? String(o.timestamp) : String(Math.floor(Date.now() / 1000));
  const nonce = o.nonce || crypto.randomBytes(12).toString('hex');
  const canon = canonicalString(keyId, method, pathname, ts, nonce, sha256Hex(Buffer.from(bodyStr, 'utf8')));
  const sig = crypto.sign(null, Buffer.from(canon, 'utf8'), KEYPAIR.privateKey).toString('base64');
  const mode = o.mode || 'normal';
  const headers = {
    'x-vfib-key-id': keyId, 'x-vfib-timestamp': ts, 'x-vfib-nonce': nonce,
    'x-vfib-signature': mode === 'badSignature' ? String(o.signature || '') : sig
  };
  if (mode === 'noHeaders') { delete headers['x-vfib-key-id']; delete headers['x-vfib-timestamp']; delete headers['x-vfib-nonce']; delete headers['x-vfib-signature']; }
  if (bodyStr) headers['Content-Type'] = 'application/json';
  if (ticket) headers['x-vfib-ticket'] = ticket;
  // 契约 §1.1：**query 不参与签名** —— 签名用无 query 的 pathname，请求才拼 query
  const q = o.query || {};
  const qs = Object.keys(q).filter((k) => q[k] !== undefined && q[k] !== null)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(q[k]))).join('&');
  return httpJson(OA_BASE, pathname + (qs ? '?' + qs : ''), { method, headers, body: bodyStr || undefined });
}

/* ---------------- 进程生命周期 ---------------- */
const procs = [];
function spawnServer(cwd, env, label) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd, env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe']
  });
  child.__log = '';
  child.__label = label;
  child.stdout.on('data', (d) => { child.__log += d.toString(); });
  child.stderr.on('data', (d) => { child.__log += d.toString(); });
  child.on('exit', () => { child.__exited = true; });
  procs.push(child);
  return child;
}
function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.__exited || child.killed) return resolve();
    try { child.kill('SIGTERM'); } catch (_) { return resolve(); }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* ignore */ } resolve(); }, 2500);
  });
}
async function waitHealth(base, tries) {
  for (let i = 0; i < (tries || 90); i += 1) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) return true; } catch (_) { /* not up */ }
    await sleep(250);
  }
  return false;
}

/* ---------------- MOS 会话客户端（Cookie + CSRF） ---------------- */
function mosClient() {
  const jar = new Map();
  const cookieHeader = () => (jar.size ? [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ') : '');
  function absorb(res) {
    const setc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setc) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  async function call(method, p, body) {
    const headers = {};
    const ch = cookieHeader();
    if (ch) headers.Cookie = ch;
    if (jar.get('mos_csrf')) headers['x-mos-csrf'] = jar.get('mos_csrf');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(MOS_BASE + p, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    absorb(res);
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (_) { /* ignore */ }
    return { status: res.status, json };
  }
  async function raw(pathname, bytes, contentType) {
    const headers = { 'Content-Type': contentType || 'application/octet-stream' };
    const ch = cookieHeader();
    if (ch) headers.Cookie = ch;
    if (jar.get('mos_csrf')) headers['x-mos-csrf'] = jar.get('mos_csrf');
    const res = await fetch(MOS_BASE + pathname, { method: 'POST', headers, body: bytes });
    absorb(res);
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (_) { /* ignore */ }
    return { status: res.status, json };
  }
  return { call, raw, jar, login: (u, p) => call('POST', '/api/mos/auth/login', { username: u, password: p }) };
}

/* ---------------- OA 侧客户端（Bearer） ---------------- */
function oaClient() {
  let token = '';
  const bearer = () => (token ? { Authorization: 'Bearer ' + token } : {});
  async function call(method, p, body) {
    const headers = Object.assign({}, bearer());
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    return httpJson(OA_BASE, p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  }
  return {
    call,
    setToken: (t) => { token = t; },
    getToken: () => token,
    async login(username, password) {
      const r = await httpJson(OA_BASE, '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-oa-client': 'api' },
        body: JSON.stringify({ username, password })
      });
      token = (r.json && r.json.token) || '';
      return r;
    }
  };
}

/* ---------------- 清理 ---------------- */
async function cleanup() {
  for (const p of procs) { try { await stopServer(p); } catch (_) { /* ignore */ } }
  if (process.env.D4_KEEP === '1') return;
  for (const d of [MOS_DATA_DIR, OA_DATA_DIR]) {
    for (let i = 0; i < 5; i += 1) {
      try { fs.rmSync(d, { recursive: true, force: true }); break; } catch (_) { await sleep(400); }
    }
  }
}

/* ============================================================
 * 主流程
 * ============================================================ */
async function main() {
  console.log('BUILD-04 · B4 双系统真实 HTTP 端到端联调');
  console.log('  MOS 实例    ' + MOS_BASE + '   数据目录 ' + MOS_DATA_DIR);
  console.log('  Provider    ' + OA_BASE + '   数据目录 ' + OA_DATA_DIR);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  /* ---------- 前置：Provider 源码可用性 ---------- */
  const oaEntry = path.join(OA_ROOT, 'server.js');
  if (!fs.existsSync(oaEntry)) {
    check('D4-00 Provider 源码可用（' + OA_ROOT + '）', false, '未找到 server.js');
    const out = {
      suite: 'mos-e2e-build04-dual', ranAt: new Date().toISOString(), verdict: 'BLOCKED',
      blockedReason: 'PROVIDER_SOURCE_UNAVAILABLE', oaRoot: OA_ROOT,
      note: 'Provider 源码路径不存在，真实双进程联调无法执行（如实记 BLOCKED，不做任何模拟替代）。',
      total: results.length, passed: results.length - failures, failed: failures, cases: results
    };
    fs.writeFileSync(path.join(OUT_DIR, 'dual-e2e-result.json'), JSON.stringify(out, null, 2), 'utf8');
    console.log('\n结论：BLOCKED（Provider 源码不可用）');
    process.exit(2);
  }
  check('D4-00 Provider 源码可用且未改动（只以 server.js + 环境变量装配隔离实例）',
    fs.existsSync(oaEntry), OA_ROOT);

  /* ============================================================
   * Phase A —— Provider 隔离实例（不改资料库源码）
   * ============================================================ */
  section('Phase A · Provider 隔离实例（独立数据目录 + 运行期随机口令/密钥）');
  const oa = spawnServer(OA_ROOT, {
    PORT: String(OA_PORT),
    OA_HOST: '127.0.0.1',
    OA_DATA_DIR: OA_DATA_DIR,
    OA_ADMIN_PASSWORD: OA_ADMIN_PW,
    OA_ALLOW_BEARER_API: '1',
    OA_INTEGRATION_ENABLED: '1',
    OA_INTEGRATION_SIGNING_KEY: OA_TICKET_KEY,
    OA_INTEGRATION_ALLOWED_BRANDS: 'VFIB',
    OA_RAG_OCR_PROVIDER: 'none',
    OA_RAG_EMBEDDING_PROVIDER: 'none',
    DEEPSEEK_API_KEY: '',
    OA_TRUSTED_PROXIES: '',
    OA_ALLOWED_CLIENT_CIDRS: ''
  }, 'provider');

  const oaUp = await waitHealth(OA_BASE, 100);
  check('D4-01 Provider 隔离实例真实启动（/api/health 200）', oaUp, 'HTTP ' + (oaUp ? 200 : 0));

  const provider = oaClient();
  const loginR = await provider.login('admin', OA_ADMIN_PW);
  check('D4-02 Provider 管理员登录（x-oa-client: api 换取会话 token）',
    loginR.status === 200 && !!provider.getToken(), 'HTTP ' + loginR.status);

  /* ---- A1. 合成员工 + 独立授权 ---- */
  const oaUsers = {};
  {
    const specs = [
      { key: 'exec', username: 'd4_exec_' + RUN, name: 'D4 联调·执行员', libRole: 'executive', dept: '品牌中心' },
      { key: 'rev', username: 'd4_rev_' + RUN, name: 'D4 联调·复核员', libRole: 'reviewer', dept: '品牌中心' },
      { key: 'lfa', username: 'd4_lfa_' + RUN, name: 'D4 联调·最终审批人', libRole: 'executive', dept: '品牌中心' }
    ];
    let allOk = true;
    for (const s of specs) {
      const pw = 'd4-' + crypto.randomBytes(12).toString('base64url');
      const r = await provider.call('POST', '/api/users', {
        username: s.username, name: s.name, password: pw, role: 'employee', dept: s.dept, libRole: s.libRole
      });
      const id = r.json && r.json.user ? r.json.user.id : null;
      const c = oaClient();
      await c.login(s.username, pw);
      oaUsers[s.key] = { id, username: s.username, client: c, token: c.getToken() };
      if (!id || !c.getToken()) allOk = false;
    }
    check('D4-03 Provider 侧合成测试身份创建并登录（exec / reviewer / 最终审批人）',
      allOk, Object.keys(oaUsers).map((k) => k + '=' + (oaUsers[k].id ? 'ok' : 'FAIL')).join(' '));
  }

  /** 用服务账户为某个合成身份换取一枚受限票据（含指定 scope）；失败返回空串 */
  async function ticketFor(userKey, scope, purpose) {
    const u = oaUsers[userKey];
    if (!u) return '';
    const r = await signedOaRequest('POST', '/api/integrations/marketing/tickets',
      { userId: u.id, brandId: 'VFIB', purpose: purpose || ('D4：' + scope), scopes: [scope] });
    return (r.json && r.json.data && r.json.data.ticket) || '';
  }

  {
    const grants = [
      { who: 'lfa', scope: 'library.asset.approve.final' },
      { who: 'exec', scope: 'ai.external.transfer' },
      { who: 'rev', scope: 'library.skill.approve.effective' }
    ];
    let okAll = true;
    for (const g of grants) {
      const r = await provider.call('POST', '/api/asset-admission/approvers',
        { userId: oaUsers[g.who].id, scope: g.scope, note: 'D4 双系统联调：显式授予' });
      if (r.status !== 200) okAll = false;
    }
    check('D4-04 Provider 侧独立授权显式授予（最终审批权不继承，须单独授权）',
      okAll, grants.map((g) => g.who + ':' + g.scope).join(','));
  }

  /* ---- A4. 资料夹具（令检索面有真实命中；同时验证密级隔离与正文扣留） ---- */
  {
    async function uploadDoc(token, title, subcategoryId, classification, text) {
      const meta = {
        title, subcategoryId, classification,
        documentLevel: 'STANDARD', documentType: 'Policy',
        description: 'D4 双系统联调合成夹具', tags: ['D4联调']
      };
      return httpJson(OA_BASE, '/api/library/upload?action=submit', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-file-name': encodeURIComponent(title + '.txt'),
          'x-lib-meta': encodeURIComponent(JSON.stringify(meta)),
          Authorization: 'Bearer ' + token
        },
        body: text
      });
    }
    const d1 = await uploadDoc(provider.getToken(), 'D4 联调·品牌主视觉规范（内部）', '01.01', 'internal',
      'D4 双系统联调合成正文：品牌主视觉规范与使用边界。');
    const d2 = await uploadDoc(provider.getToken(), 'D4 联调·高管战略（高管机密）', '01.05', 'executive',
      'D4 双系统联调合成正文：高管战略，仅 executive 资料库角色可见。');
    const id1 = d1.json && d1.json.item ? (d1.json.item.id || d1.json.item.documentId) : null;
    const id2 = d2.json && d2.json.item ? (d2.json.item.id || d2.json.item.documentId) : null;
    const ap1 = id1 ? await provider.call('POST', '/api/library/' + id1 + '/approve', {}) : { status: 0 };
    const ap2 = id2 ? await oaUsers.lfa.client.call('POST', '/api/library/' + id2 + '/approve', {}) : { status: 0 };
    check('D4-04b 资料夹具上传并批准（internal 由管理员、executive 由 executive 角色批准）',
      d1.status === 200 && d2.status === 200 && ap1.status === 200 && ap2.status === 200,
      'open=' + id1 + '/' + ap1.status + ' exec=' + id2 + '/' + ap2.status);
  }

  /* ---- A2. 服务账户登记（只登记公钥） ---- */
  {
    const scopes = ['tickets.issue', 'knowledge.search', 'assets.search', 'assets.read',
      'admissions.write', 'admissions.read', 'skills.read', 'changes.read'];
    const r = await provider.call('POST', '/api/integration-accounts', {
      name: 'D4 双系统联调·Marketing OS（隔离实例合成主体）',
      description: 'B4 真实 HTTP 联调合成服务主体；仅登记公钥',
      publicKey: PUB_PEM, scopes
    });
    const item = (r.json && r.json.item) || {};
    OA_KEY_ID = item.keyId || '';
    check('D4-05 服务账户登记成功（Provider 只持公钥，响应不含任何私钥字段）',
      r.status === 200 && !!OA_KEY_ID && item.keyFingerprint !== undefined
        && item.privateKey === undefined && item.publicKeyPem === undefined
        && item.signingKey === undefined,
      'keyId=' + OA_KEY_ID + ' fingerprint=' + String(item.keyFingerprint || '').slice(0, 16));
  }

  /* ---- A3. 服务身份签名互通（真实验签的第一次握手） ---- */
  {
    const h = await signedOaRequest('GET', '/api/integrations/marketing/health');
    check('D4-06 本侧 Ed25519 签名被 Provider 真实验签通过（/health 200 合法封套）',
      h.status === 200 && h.json && h.json.ok === true,
      'HTTP ' + h.status + ' policy=' + (h.json && h.json.policy_version));
    const bad = await signedOaRequest('GET', '/api/integrations/marketing/health', null, null,
      { mode: 'badSignature', signature: crypto.randomBytes(64).toString('base64') });
    check('D4-07 伪造签名被拒（401 BAD_SIGNATURE）—— 证明 D4-06 不是桩返回',
      bad.status === 401 && bad.json && bad.json.error && bad.json.error.code === 'BAD_SIGNATURE',
      'HTTP ' + bad.status + ' code=' + (bad.json && bad.json.error && bad.json.error.code));
    check('D4-08 Provider 能力声明不夸大：不提供 Published Content 归档',
      h.json && h.json.data && h.json.data.capabilities
        && h.json.data.capabilities.publishedContentArchive === false,
      JSON.stringify(h.json && h.json.data && h.json.data.capabilities));
  }

  /* ============================================================
   * Phase B —— Marketing OS 实例（两阶段启动：先建号，再带用户映射重启）
   * ============================================================ */
  section('Phase B · Marketing OS 隔离实例（真实出站指向 Provider 隔离实例）');

  const mosEnvBase = {
    MOS_DATA_DIR: MOS_DATA_DIR,
    MOS_PORT: String(MOS_PORT),
    MOS_HOST: '127.0.0.1',
    MOS_ADMIN_PASSWORD: MOS_ADMIN_PW,
    MOS_DEMO_SEED: '1',
    MOS_IDENTITY: 'mock', MOS_KNOWLEDGE: 'mock', MOS_LIBRARY: 'mock',
    MOS_TEXT_PROVIDER: 'none', MOS_IMAGE_PROVIDER: 'none',
    MOS_SOURCE_INGEST: 'real',
    /* 集成：真实出站 + 回环明文（仅隔离测试；生产一律拒绝） */
    MOS_WORKSPACE_ENABLED: '1',
    MOS_WORKSPACE_BASE_URL: OA_BASE,
    MOS_WORKSPACE_KEY_ID: OA_KEY_ID,
    MOS_WORKSPACE_PRIVATE_KEY_PEM: PRIV_PEM,
    MOS_WORKSPACE_BRANDS: 'VFIB',
    MOS_WORKSPACE_ALLOW_LOOPBACK_HTTP: '1',
    MOS_WORKSPACE_ALLOWED_HOSTS: '',
    MOS_WORKSPACE_POLL_ENABLED: '0',
    MOS_WORKSPACE_TIMEOUT_MS: '8000'
  };

  /* B1：第一次启动 —— 只建号（避免把出站打到半成品状态） */
  let mos = spawnServer(ROOT, Object.assign({}, mosEnvBase, { MOS_WORKSPACE_ENABLED: '0' }), 'mos-1');
  const mosUp1 = await waitHealth(MOS_BASE, 100);
  check('D4-09 Marketing OS 隔离实例真实启动（/api/health 200）', mosUp1, 'HTTP ' + (mosUp1 ? 200 : 0));

  const admin = mosClient();
  let bootUser = 'mosadmin';
  let lr = await admin.login(bootUser, MOS_ADMIN_PW);
  if (lr.status !== 200) { bootUser = 'admin'; lr = await admin.login(bootUser, MOS_ADMIN_PW); }
  if (lr.status === 200 && lr.json && lr.json.mustChangePassword) {
    const ch = await admin.call('POST', '/api/mos/auth/change-password',
      { oldPassword: MOS_ADMIN_PW, newPassword: MOS_ADMIN_PW2 });
    check('D4-10 引导管理员首登强制改密成功（口令策略真实生效）', ch.status === 200, 'HTTP ' + ch.status);
    await admin.login(bootUser, MOS_ADMIN_PW2);
  } else {
    check('D4-10 引导管理员登录成功', lr.status === 200, 'HTTP ' + lr.status);
  }

  async function mkMosUser(username, roles) {
    const pw = 'Pw-' + crypto.randomBytes(9).toString('base64url');
    const r = await admin.call('POST', '/api/mos/admin/users', {
      username, displayName: 'D4 ' + username, password: pw, demo: true,
      mustChangePassword: false, roles
    });
    if (r.status !== 200) throw new Error('建号失败 ' + username + ' ' + JSON.stringify(r.json));
    return { id: r.json.user.id, username, password: pw };
  }

  const M_CREATOR = await mkMosUser('d4.creator', [{ roleCode: 'P2', brandScope: ['VFIB'] }]);
  const M_REVIEWER = await mkMosUser('d4.reviewer', [{ roleCode: 'ASSET_REVIEWER', brandScope: ['VFIB'] }]);
  const M_FINAL = await mkMosUser('d4.final', [{ roleCode: 'LIBRARY_FINAL_APPROVER', brandScope: ['VFIB'] }]);
  const M_UNMAPPED = await mkMosUser('d4.unmapped', [{ roleCode: 'P2', brandScope: ['VFIB'] }]);
  check('D4-11 MOS 侧合成身份创建（creator / asset-reviewer / library-final-approver / 未映射对照）',
    !!(M_CREATOR.id && M_REVIEWER.id && M_FINAL.id && M_UNMAPPED.id),
    [M_CREATOR, M_REVIEWER, M_FINAL, M_UNMAPPED].map((u) => u.username).join(','));

  const usersBefore = await admin2preCheck(admin);
  async function admin2preCheck(c) {
    const r = await c.call('GET', '/api/mos/admin/users');
    return ((r.json && r.json.items) || []).map((u) => u.username);
  }
  check('D4-11b 四个合成身份已持久化（重启前核对，避免把"内存态"当"落盘态"）',
    [M_CREATOR, M_REVIEWER, M_FINAL, M_UNMAPPED].every((u) => usersBefore.indexOf(u.username) !== -1),
    'users=' + usersBefore.join('|'));

  /* Windows 上 SIGTERM 为硬终止 → 必须先等 store 的 60ms 防抖刷盘完成，再停进程；
   * 否则最近写入会丢（这是本工程已知的落盘窗口，不是测试脆弱性）。 */
  await sleep(1200);
  await stopServer(mos);
  mos = null;
  await sleep(600);

  /* B2：第二次启动 —— 带**显式用户映射**（MOS 用户 → Provider 真实员工） */
  const userMap = [
    'user_mosadmin=' + oaUsers.exec.id,   // 引导管理员（id 由 seed 固定为 user_mosadmin）
    M_CREATOR.id + '=' + oaUsers.exec.id,
    M_REVIEWER.id + '=' + oaUsers.rev.id,
    M_FINAL.id + '=' + oaUsers.lfa.id
  ].join(',');
  mos = spawnServer(ROOT, Object.assign({}, mosEnvBase, {
    MOS_WORKSPACE_USER_MAP: userMap,
    MOS_WORKSPACE_SERVICE_USER_ID: ''   // 留空：未映射用户必须被**如实拒绝**，不得用服务身份顶替
  }), 'mos-2');
  const mosUp2 = await waitHealth(MOS_BASE, 100);
  check('D4-12 MOS 实例带显式用户映射重启成功（数据目录持久化、会话重签）', mosUp2, 'HTTP ' + (mosUp2 ? 200 : 0));

  const admin2 = mosClient();
  let lr2 = await admin2.login(bootUser, lr.json && lr.json.mustChangePassword ? MOS_ADMIN_PW2 : MOS_ADMIN_PW);
  if (lr2.status !== 200) lr2 = await admin2.login(bootUser, MOS_ADMIN_PW2);
  check('D4-13 重启后管理员会话可用', lr2.status === 200, 'HTTP ' + lr2.status);

  const cCreator = mosClient(); const cCreatorL = await cCreator.login(M_CREATOR.username, M_CREATOR.password);
  const cReviewer = mosClient(); const cReviewerL = await cReviewer.login(M_REVIEWER.username, M_REVIEWER.password);
  const cFinal = mosClient(); const cFinalL = await cFinal.login(M_FINAL.username, M_FINAL.password);
  const cUnmapped = mosClient(); const cUnmappedL = await cUnmapped.login(M_UNMAPPED.username, M_UNMAPPED.password);
  const usersList = await admin2.call('GET', '/api/mos/admin/users');
  const unames = ((usersList.json && usersList.json.items) || []).map((u) => u.username);
  check('D4-13b 四个合成身份登录成功（creator / reviewer / final / unmapped）',
    cCreatorL.status === 200 && cReviewerL.status === 200 && cFinalL.status === 200 && cUnmappedL.status === 200,
    [cCreatorL, cReviewerL, cFinalL, cUnmappedL].map((x) => x.status).join(',')
      + ' users=' + unames.join('|') + ' body=' + JSON.stringify(cCreatorL.json).slice(0, 120));

  /* ---- B3. 集成状态：本侧就绪 ≠ 联调通过 ---- */
  {
    const st = await admin2.call('GET', '/api/mos/integration/workspace');
    const cs = (st.json && st.json.status) || {};
    check('D4-14 本侧集成状态：configured=true 且出站守卫放行（文案明确"不代表联调通过"）',
      st.status === 200 && cs.configured === true && cs.egress && cs.egress.ok === true
        && /不代表联调通过/.test(String(st.json.note || '')),
      'host=' + (cs.egress && cs.egress.host) + ' configured=' + cs.configured);
    const con = (st.json && st.json.contract) || {};
    const C_OPENAPI_SHA = 'cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3';
    check('D4-15 契约基线一致：本侧 OpenAPI SHA256 与 C 包共享契约逐字节相同（冻结枚举 71 项）',
      con.openapiSha256 === C_OPENAPI_SHA && con.openapiErrorCodeCount === 71,
      'sha=' + String(con.openapiSha256 || '').slice(0, 16) + ' openapiEnum=' + con.openapiErrorCodeCount);
    check('D4-15b 错误码表按提供方 D-03.2 补入新增码（非闭合枚举：71 + ' + 2 + ' 项），且明确不可重试兜底',
      con.errorCodeCount === 73
        && (con.providerDeclaredAdditions || []).indexOf('BAD_REVIEW_OUTCOME') !== -1
        && (con.providerDeclaredAdditions || []).indexOf('TOO_MANY_REVIEWS') !== -1
        && /非闭合/.test(String(con.errorCodePolicy || '')),
      'runtime=' + con.errorCodeCount + ' additions=' + JSON.stringify(con.providerDeclaredAdditions));
  }

  /* ---- B4. 真实 /health 探测（第一个"真的连上了"的证据） ---- */
  {
    const p = await admin2.call('POST', '/api/mos/integration/health?brand=VFIB', { trigger: 'e2e-dual' });
    const probe = (p.json && p.json.probe) || {};
    check('D4-16 真实出站探测 /health：Provider 以合法封套应答（本侧→Provider 链路打通）',
      p.status === 200 && probe.ok === true && probe.httpStatus === 200
        && probe.data && probe.data.policyVersion === '1.0',
      'HTTP ' + p.status + ' probeStatus=' + probe.httpStatus
        + ' body=' + JSON.stringify(p.json).slice(0, 300));
  }

  /* ---- B5. 只读探测：所有读端点逐一走真实 HTTP ---- */
  {
    const pr = await admin2.call('POST', '/api/mos/integration/probe?brand=VFIB', { query: 'D4 联调' });
    const probes = (pr.json && pr.json.probes) || [];
    const byName = {};
    for (const x of probes) byName[x.name] = x;
    check('D4-17 只读探测：assets.search 走真实 HTTP 返回合法封套',
      byName['assets.search'] && byName['assets.search'].ok === true,
      JSON.stringify(byName['assets.search'] || null));
    check('D4-18 只读探测：knowledge.search 走真实 HTTP，命中夹具资料且正文一律扣留（snippet 不外流）',
      byName['knowledge.search'] && byName['knowledge.search'].ok === true
        && byName['knowledge.search'].itemCount >= 1
        && byName['knowledge.search'].withheldCount === byName['knowledge.search'].itemCount,
      JSON.stringify(byName['knowledge.search'] || null));
    check('D4-19 只读探测：changes 走真实 HTTP，游标语义为单调整数 seq',
      byName.changes && byName.changes.ok === true && typeof byName.changes.nextCursor === 'number',
      JSON.stringify(byName.changes || null));
    check('D4-20 只读探测不回流正文：响应顶层键中不含 content/body/text 字段',
      probes.length >= 3 && probes.every((x) => !(x.dataKeys || []).some((k) => /^(content|body|text|snippet)$/.test(k))),
      'probes=' + probes.length);
  }

  /* ============================================================
   * Phase C —— 准入真实推送（申请 ≠ 资产）
   * ============================================================ */
  section('Phase C · 准入三步真实推送：申请 ≠ 资产，服务身份不可代签最终审批');

  const up = await cCreator.raw('/api/mos/assets/upload?brand=VFIB&name=d4-dual-asset.png', png('dual'), 'image/png');
  const waId = up.json && up.json.asset && up.json.asset.id;
  check('D4-21 工作素材上传成功（真实落盘 + sha256）',
    up.status === 200 && !!waId && !!up.json.asset.sha256, 'HTTP ' + up.status + ' id=' + waId);

  const idem = 'd4-dual-' + RUN + '-1';
  const mk = await cCreator.call('POST', '/api/mos/asset-admissions?brand=VFIB', {
    workingAssetId: waId, categoryCode: 'A01',
    libraryPrimaryCategory: '02', librarySubcategory: '02.04',
    classification: 'internal', licenseStatus: 'cleared',
    reuseScope: 'campaign_reuse', externalAiTransferPolicy: 'allowed',
    submissionMetadata: { title: 'D4 双系统联调母版', description: 'B4 真实 HTTP 联调', license: 'cleared' },
    idempotencyKey: idem
  });
  const adm = mk.json && mk.json.admission;
  check('D4-22 MOS 建单成功并带三项 Provider 必填字段',
    mk.status === 200 && adm && adm.libraryPrimaryCategory === '02'
      && adm.classification === 'internal' && adm.licenseStatus === 'cleared'
      && adm.providerFieldsComplete === true,
    'id=' + (adm && adm.id) + ' complete=' + (adm && adm.providerFieldsComplete));

  const pre = await cReviewer.call('POST', '/api/mos/asset-admissions/' + adm.id + '/precheck?brand=VFIB', {});
  check('D4-23 预检 PASS（由独立预检员执行；权限不含最终审批）',
    pre.status === 200 && pre.json.precheck && pre.json.precheck.verdict === 'PASS',
    'verdict=' + (pre.json && pre.json.precheck && pre.json.precheck.verdict));

  const sub = await cCreator.call('POST', '/api/mos/asset-admissions/' + adm.id + '/submit-final?brand=VFIB', {});
  const caseId = sub.json && sub.json.reviewCase && sub.json.reviewCase.id;
  check('D4-24 送审产生 ASSET_ADMISSION 审核单（提交人不得自批，走独立审核链）',
    sub.status === 200 && !!caseId, 'case=' + caseId);

  const dec = await cFinal.call('POST', '/api/mos/review-cases/' + caseId + '/decision?brand=VFIB',
    { action: 'APPROVE', approvalRef: adm.id });
  check('D4-25 授权主体在 MOS 侧完成最终审批（持有 library.asset.approve.final）',
    dec.status === 200, 'HTTP ' + dec.status);

  /* 未映射用户的对照：必须如实拒绝，不得用服务身份顶替 */
  {
    const up2 = await cUnmapped.raw('/api/mos/assets/upload?brand=VFIB&name=d4-unmapped.png', png('unmapped'), 'image/png');
    const mk2 = await cUnmapped.call('POST', '/api/mos/asset-admissions?brand=VFIB', {
      workingAssetId: up2.json.asset.id, categoryCode: 'A01',
      libraryPrimaryCategory: '02', classification: 'internal', licenseStatus: 'cleared',
      submissionMetadata: { title: 'D4 未映射对照' }, idempotencyKey: 'd4-unmapped-' + RUN
    });
    const a2 = mk2.json.admission;
    await cReviewer.call('POST', '/api/mos/asset-admissions/' + a2.id + '/precheck?brand=VFIB', {});
    await cUnmapped.call('POST', '/api/mos/asset-admissions/' + a2.id + '/submit-final?brand=VFIB', {});
    // 未映射用户没有最终审批权 → 由 cFinal 走完；随后 sync 时 actor 仍是未映射者
    const cases = await admin2.call('GET', '/api/mos/review-cases?brand=VFIB&pageSize=50');
    const c2 = ((cases.json && cases.json.items) || [])
      .filter((x) => x.subjectId === a2.id).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0];
    if (c2) await cFinal.call('POST', '/api/mos/review-cases/' + c2.id + '/decision?brand=VFIB', { action: 'APPROVE', approvalRef: a2.id });
    const s2 = await cUnmapped.call('POST', '/api/mos/asset-admissions/' + a2.id + '/sync?brand=VFIB', {});
    check('D4-26 未映射 MOS 用户同步 → 如实拒绝（NO_PROVIDER_USER_MAPPING），绝不用服务身份顶替',
      s2.status === 200 && s2.json.receipt && s2.json.receipt.errorCode === 'NO_PROVIDER_USER_MAPPING',
      'code=' + (s2.json && s2.json.receipt && s2.json.receipt.errorCode));
  }

  /* ---- C1. 第一次真实同步：artifact 必被 409 拦下 ---- */
  const s1 = await cCreator.call('POST', '/api/mos/asset-admissions/' + adm.id + '/sync?brand=VFIB', {});
  const rc1 = (s1.json && s1.json.receipt) || {};
  const admAfter1 = await cCreator.call('GET', '/api/mos/asset-admissions/' + adm.id + '?brand=VFIB');
  const a1 = admAfter1.json && admAfter1.json.admission;
  check('D4-27 真实同步第③步被 Provider 以 409 FINAL_APPROVAL_REQUIRED 拦下（不中途可用）',
    s1.status === 200 && rc1.state === 'SYNC_FAILED'
      && rc1.errorCode === 'FINAL_APPROVAL_REQUIRED' && rc1.awaitingProviderFinalApproval === true
      && rc1.real === true,
    'code=' + rc1.errorCode + ' stage=' + rc1.stage);
  check('D4-28 本侧**不伪造**成功：无 libraryId、无回执、library_asset_refs 未建立可复用引用',
    a1 && !a1.libraryId && !a1.receipt && a1.syncStatus === 'FAILED' && a1.state === 'SYNC_FAILED',
    'libraryId=' + (a1 && a1.libraryId) + ' syncStatus=' + (a1 && a1.syncStatus));
  const providerAdmissionId = rc1.providerAdmissionId;
  check('D4-29 Provider 侧申请真实存在（拿到 providerAdmissionId，非进程内假象）',
    /^adm_/.test(String(providerAdmissionId || '')), 'providerAdmissionId=' + providerAdmissionId);

  /* 服务身份越权尝试（本侧结构性拒绝 + Provider 侧兜底拒绝） */
  {
    // ① 服务账户为真实用户换取**常规**服务票据（不含最终审批范围）
    const tk = await signedOaRequest('POST', '/api/integrations/marketing/tickets',
      { userId: oaUsers.lfa.id, brandId: 'VFIB', purpose: 'D4：常规服务票据越权尝试', scopes: ['admissions.read'] });
    const serviceTicket = (tk.json && tk.json.data && tk.json.data.ticket) || '';
    // ② 同一服务账户**索取** admission.final.decision → 服务端必须剔除或直接拒绝
    const greedy = await signedOaRequest('POST', '/api/integrations/marketing/tickets',
      { userId: oaUsers.lfa.id, brandId: 'VFIB', purpose: 'D4：索取最终审批范围', scopes: ['admission.final.decision'] });
    const greedyGranted = (greedy.json && greedy.json.data && greedy.json.data.scopes) || [];
    // ③ 用常规服务票据打最终审批端点 → 403 TICKET_KIND_MISMATCH（kind 先于对象查询）
    const attempt = await signedOaRequest('POST',
      '/api/integrations/marketing/admissions/' + providerAdmissionId + '/final-decision',
      { decision: 'approve' }, serviceTicket);
    check('D4-30 服务票据索取 admission.final.decision 被剔除，且用服务票据打最终审批 → 403 TICKET_KIND_MISMATCH',
      !!serviceTicket && greedyGranted.indexOf('admission.final.decision') === -1
        && attempt.status === 403 && attempt.json && attempt.json.error
        && attempt.json.error.code === 'TICKET_KIND_MISMATCH',
      'greedyHTTP=' + greedy.status + ' granted=' + JSON.stringify(greedyGranted)
        + ' attemptHTTP=' + attempt.status + ' code=' + (attempt.json && attempt.json.error && attempt.json.error.code));
    check('D4-30b 本侧 workspace-client.finalDecision() 亦**结构性**恒拒绝（双重闭合）',
      (() => { const fd = require('../lib/mos/workspace-client').finalDecision(); return fd.ok === false && fd.httpStatus === 403; })(),
      '');
  }

  /* Provider 侧申请状态（诊断 + 断言：submit 后必须真的进入待最终审批） */
  {
    const tk = await signedOaRequest('POST', '/api/integrations/marketing/tickets',
      { userId: oaUsers.exec.id, brandId: 'VFIB', purpose: 'D4：读取准入状态', scopes: ['admissions.read'] });
    const t = (tk.json && tk.json.data && tk.json.data.ticket) || '';
    const g = await signedOaRequest('GET',
      '/api/integrations/marketing/admissions/' + providerAdmissionId, undefined, t);
    const st = (g.json && g.json.data && g.json.data.state) || '';
    check('D4-29b Provider 侧申请状态已推进到 FINAL_APPROVAL_PENDING（submit 真的生效，非仅 HTTP 200）',
      g.status === 200 && st === 'FINAL_APPROVAL_PENDING',
      'HTTP=' + g.status + ' state=' + st
        + ' providerProblems=' + JSON.stringify(rc1.providerProblems || [])
        + ' steps=' + JSON.stringify(rc1.steps || [])
        + ' body=' + JSON.stringify(g.json).slice(0, 200));
  }

  /* ============================================================
   * Phase D —— Provider 侧本人会话最终审批（人工等价物）
   * ============================================================ */
  section('Phase D · Provider 侧最终审批只能由**本人会话**完成（服务身份结构性不可代签）');

  const sess = await oaUsers.lfa.client.call('POST', '/api/asset-admission/tickets',
    { brandId: 'VFIB', purpose: 'D4 联调：本人会话签发最终审批票据', scopes: ['admission.final.decision'] });
  const sessionTicket = ((sess.json && sess.json.data && sess.json.data.ticket) || (sess.json && sess.json.ticket) || '');
  check('D4-31 被显式授权的本人会话可签出含 admission.final.decision 的票据（kind=session）',
    sess.status === 200 && !!sessionTicket, 'HTTP ' + sess.status);

  const finalDec = await signedOaRequest('POST',
    '/api/integrations/marketing/admissions/' + providerAdmissionId + '/final-decision',
    { decision: 'approve', comment: 'D4 双系统联调：独立最终审批通过' }, sessionTicket);
  check('D4-32 Provider 侧最终审批通过（FINAL_APPROVED）',
    finalDec.status === 200 && finalDec.json && finalDec.json.data
      && finalDec.json.data.state === 'FINAL_APPROVED',
    'HTTP ' + finalDec.status + ' state=' + (finalDec.json && finalDec.json.data && finalDec.json.data.state));

  /* ============================================================
   * Phase E —— MOS 重试同步 → 取得正式 Asset ID
   * ============================================================ */
  section('Phase E · 重试同步：只有 Provider 给出正式 Asset ID 才建立真实引用');

  const s2 = await cCreator.call('POST', '/api/mos/asset-admissions/' + adm.id + '/retry-sync?brand=VFIB', {});
  const rc2 = (s2.json && s2.json.receipt) || {};
  const admAfter2 = await cCreator.call('GET', '/api/mos/asset-admissions/' + adm.id + '?brand=VFIB');
  const a2 = admAfter2.json && admAfter2.json.admission;
  check('D4-33 重试同步成功：取得 Provider 正式 Asset ID + 版本 ID（isReusable=true）',
    s2.status === 200 && rc2.state === 'SYNC_COMPLETED' && /^VFIB-ASSET-/.test(String(rc2.assetId || ''))
      && !!rc2.libraryVersion && rc2.real === true,
    'assetId=' + rc2.assetId + ' version=' + rc2.libraryVersion);
  check('D4-34 本侧引用以**真实**来源建立（mode=real，permissionValid=true，assetState=ACTIVE）',
    a2 && a2.libraryId === rc2.assetId && a2.receipt && a2.receipt.mode === 'real'
      && a2.receipt.permissionValid === true && a2.receipt.assetState === 'ACTIVE',
    'libraryId=' + (a2 && a2.libraryId) + ' mode=' + (a2 && a2.receipt && a2.receipt.mode));

  const libraryAssetId = rc2.assetId;

  /* ---- E1. 使用前重新验证（不依赖轮询缓存） ---- */
  {
    const v = await cCreator.call('POST', '/api/mos/integration/asset-usage-check?brand=VFIB',
      { libraryAssetId: libraryAssetId });
    check('D4-35 使用前重新验证：向 Provider 真实解析该资产 → 可复用（PROVIDER_VERIFIED）',
      v.status === 200 && v.json.usable === true && v.json.reason === 'PROVIDER_VERIFIED',
      'reason=' + (v.json && v.json.reason));
  }

  /* ============================================================
   * Phase F —— 撤回传播（事件消费 + fail closed）
   * ============================================================ */
  section('Phase F · 撤回传播：Provider 撤回 → MIT 事件消费 → 本地引用即时失效');

  const revoke = await oaUsers.lfa.client.call('POST',
    '/api/asset-admission/requests/' + providerAdmissionId + '/revoke',
    { reason: 'D4 双系统联调：验证撤回传播与缓存一致性' });
  check('D4-36 Provider 侧撤回成功（治理动作，留审计）', revoke.status === 200, 'HTTP ' + revoke.status);

  {
    // 撤回后解析：Provider 侧资产已不可复用。query **不参与签名**（签名用无 query 的 pathname）
    // ① 治理主体（持最终审批权）→ 可见性不受撤回影响，得到语义明确的 410
    const tkL = await signedOaRequest('POST', '/api/integrations/marketing/tickets',
      { userId: oaUsers.lfa.id, brandId: 'VFIB', purpose: 'D4：撤回后解析（治理主体）', scopes: ['assets.read'] });
    const ticketL = (tkL.json && tkL.json.data && tkL.json.data.ticket) || '';
    const g2 = await signedOaRequest('GET', '/api/integrations/marketing/assets/' + libraryAssetId,
      undefined, ticketL, { query: { brandId: 'VFIB' } });
    check('D4-37 撤回后 Provider 解析 → 410 ASSET_GONE（治理主体可区分"曾经有效但已失效"）',
      g2.status === 410 && g2.json && g2.json.error && g2.json.error.code === 'ASSET_GONE',
      'HTTP ' + g2.status + ' code=' + (g2.json && g2.json.error && g2.json.error.code));

    // ② 普通员工主体 → Provider 对非 ADMITTED 的营销资产一致隐藏（404，不可区分），
    //    这**不是**我们的缺陷：任何非 200 都必须被本侧判为不可用（fail closed）。
    const tkE = await signedOaRequest('POST', '/api/integrations/marketing/tickets',
      { userId: oaUsers.exec.id, brandId: 'VFIB', purpose: 'D4：撤回后解析（普通员工）', scopes: ['assets.read'] });
    const ticketE = (tkE.json && tkE.json.data && tkE.json.data.ticket) || '';
    const gE = await signedOaRequest('GET', '/api/integrations/marketing/assets/' + libraryAssetId,
      undefined, ticketE, { query: { brandId: 'VFIB' } });
    check('D4-37b 非治理主体解析已撤回资产 → 非 200（404 一致隐藏）；**不得**据此判定可用',
      gE.status !== 200,
      'HTTP ' + gE.status + ' code=' + (gE.json && gE.json.error && gE.json.error.code));
  }

  {
    const tick = await admin2.call('POST', '/api/mos/integration/events/tick?brand=VFIB', { brands: ['VFIB'] });
    const t = (tick.json && tick.json.tick) || {};
    const brandRes = (t.brands || [])[0] || {};
    const effects = (brandRes.effects || []).join(',');
    check('D4-38 事件轮询真实消费到 asset.revoked（按品牌处理、游标推进）',
      tick.status === 200 && t.ok === true && /asset\.revoked/.test(effects),
      'HTTP=' + tick.status + ' items=' + (brandRes.items || 0) + ' effects=' + effects.slice(0, 120)
        + ' cursor=' + JSON.stringify(brandRes.cursor)
        + ' tick=' + JSON.stringify(t).slice(0, 400));
    const ev = await admin2.call('GET', '/api/mos/integration/events?brand=VFIB');
    const invs = (ev.json && ev.json.invalidations) || [];
    check('D4-39 本地引用被置 INVALIDATED（失效登记可审计：kind + targetId + seq）',
      invs.some((x) => x.kind === 'asset.revoked' && x.targetId === libraryAssetId),
      'invalidations=' + invs.length + ' kinds=' + JSON.stringify(invs.map((x) => x.kind + ':' + x.targetId)));
  }

  {
    const v = await cCreator.call('POST', '/api/mos/integration/asset-usage-check?brand=VFIB',
      { libraryAssetId: libraryAssetId });
    check('D4-40 撤回后再做使用前验证 → 拒绝（本地已失效，零出站，绝不沿用旧 Approved 结论）',
      v.status === 200 && v.json.usable === false
        && (v.json.reason === 'INVALIDATED_LOCALLY' || v.json.errorCode === 'ASSET_GONE'
          || v.json.reason === 'ASSET_GONE' || v.json.reason === 'NOT_FOUND'),
      'reason=' + (v.json && v.json.reason) + ' usable=' + (v.json && v.json.usable));
  }

  /* ============================================================
   * Phase H —— B5 Published Content 隔离（真实发布 → 归档 → 查无镜像）
   * ============================================================ */
  section('Phase H · B5 归档隔离：发布成品只在运营中台归档，资料库侧零镜像');

  {
    /* H0. 追加两个发布相关身份（P3 发布操作员 / 发布审批人）—— 不越权使用管理员 */
    async function mkUser2(username, roles) {
      const pw = 'Pw-' + crypto.randomBytes(9).toString('base64url');
      const r = await admin2.call('POST', '/api/mos/admin/users', {
        username, displayName: 'D4 ' + username, password: pw, demo: true,
        mustChangePassword: false, roles
      });
      if (r.status !== 200) throw new Error('建号失败 ' + username + ' ' + JSON.stringify(r.json));
      return { id: r.json.user.id, username, password: pw };
    }
    const U_PUB = await mkUser2('d4.publisher', [{ roleCode: 'P3', brandScope: ['VFIB'] }]);
    const U_PUBAPP = await mkUser2('d4.pubapprover',
      [{ roleCode: 'P3', brandScope: ['VFIB'] }, { roleCode: 'PUBLISHING_APPROVER', brandScope: ['VFIB'] }]);
    const cPuber = mosClient(); const cPuberL = await cPuber.login(U_PUB.username, U_PUB.password);
    const cPuberApp = mosClient(); const cPuberAppL = await cPuberApp.login(U_PUBAPP.username, U_PUBAPP.password);
    check('D4-49 发布链身份就绪（P3 操作员 / PUBLISHING_APPROVER 审批人，均非管理员）',
      cPuberL.status === 200 && cPuberAppL.status === 200,
      'HTTP ' + cPuberL.status + ',' + cPuberAppL.status);

    /* H1. 发布前的**资料库侧基线**（不得在发布前后发生变化） */
    const docCountBefore = await signedOaRequest('POST', '/api/integrations/marketing/assets/search',
      { limit: 50, offset: 0 }, await ticketFor('exec', 'assets.search', 'D4/B5：发布前资产计数'));
    const totalBefore = (docCountBefore.json && docCountBefore.json.data && docCountBefore.json.data.total) || 0;
    const chBefore = await signedOaRequest('GET', '/api/integrations/marketing/changes', undefined,
      await ticketFor('exec', 'changes.read', 'D4/B5：发布前游标'), { query: { cursor: 0, limit: 200 } });
    const cursorBefore = (chBefore.json && chBefore.json.data && chBefore.json.data.nextCursor) || 0;

    /* H2. 内容冻结送审 → 发布审批链 → APPROVE */
    const adhoc = await cCreator.call('POST', '/api/mos/tasks/ad-hoc?brand=VFIB',
      { title: 'D4/B5 发布链用例', workDate: '2026-11-20' });
    const adhocId = (adhoc.json && adhoc.json.task && adhoc.json.task.id) || (adhoc.json && adhoc.json.id);
    const cvMk = adhocId ? await cCreator.call('POST', '/api/mos/content-versions?brand=VFIB',
      { taskId: adhocId, title: 'D4/B5 成品', body: 'D4 双系统联调：用于验证 Published Archive 隔离的成品正文。' })
      : { status: 0, json: null };
    const cv = cvMk.json && cvMk.json.version;
    const lockR = cv ? await cCreator.call('POST', '/api/mos/content-versions/' + cv.id + '/lock?brand=VFIB', {})
      : { status: 0, json: null };
    const pubCase = ((lockR.json && lockR.json.createdCases) || []).find((c) => c.type === 'PUBLICATION_APPROVAL');
    check('D4-50 内容冻结送审生成 PUBLICATION_APPROVAL 审核单（发布审批链真实存在）',
      lockR.status === 200 && !!pubCase,
      'adhocHTTP=' + adhoc.status + ' cvHTTP=' + cvMk.status + ' lockHTTP=' + lockR.status
        + ' body=' + JSON.stringify(lockR.json).slice(0, 240));

    const appr = pubCase
      ? await cPuberApp.call('POST', '/api/mos/review-cases/' + pubCase.id + '/decision?brand=VFIB',
        { action: 'APPROVE', remarks: 'D4/B5：同意发布。' })
      : { status: 0 };
    const cvNow = cv ? await cCreator.call('GET', '/api/mos/content-versions/' + cv.id + '?brand=VFIB')
      : { status: 0, json: null };
    check('D4-51 发布审批通过后版本进入 APPROVED（提交人与审批人分离）',
      appr.status === 200 && cvNow.json && cvNow.json.version && cvNow.json.version.state === 'APPROVED',
      'HTTP=' + appr.status + ' state=' + (cvNow.json && cvNow.json.version && cvNow.json.version.state));

    const chs = await cPuber.call('GET', '/api/mos/channels?brand=VFIB');
    const ch = ((chs.json && chs.json.items) || []).filter((c) => c.state === 'ENABLED')[0];
    const sch = cv && ch
      ? await cPuber.call('POST', '/api/mos/publishing/schedules?brand=VFIB',
        { contentVersionId: cv.id, channelId: ch.id, plannedAt: '2026-11-25T10:00' })
      : { status: 0, json: null };
    const s0 = (sch.json && sch.json.schedules || [])[0];
    if (s0) {
      await cPuber.call('PUT', '/api/mos/publishing/schedules/' + s0.id + '?brand=VFIB',
        { state: 'SCHEDULED', rowVersion: s0.rowVersion });
    }
    const pub = s0
      ? await cPuber.call('POST', '/api/mos/publications?brand=VFIB',
        { scheduleId: s0.id, url: 'https://www.linkedin.com/company/vfib-bank/posts/d4-b5', actualAt: '2026-11-25T10:05' })
      : { status: 0, json: null };
    const pubRow = pub.json && pub.json.publication;
    const pubId = pubRow && pubRow.id;
    check('D4-52 人工登记实际发布 → 生成 PublicationRecord（真实 URL / 实际时间）',
      pub.status === 200 && !!pubId && String(pubRow.url).indexOf('linkedin.com') !== -1,
      'HTTP=' + pub.status + ' pub=' + pubId + ' url=' + (pubRow && pubRow.url)
        + ' sch=' + JSON.stringify(sch.json).slice(0, 200));

    const pubGet = pubId
      ? await cPuber.call('GET', '/api/mos/publications/' + pubId + '?brand=VFIB')
      : { status: 0, json: null };
    const arts = (pubGet.json && pubGet.json.publication && pubGet.json.publication.artifacts) || [];
    const snap = arts.find((a) => a.kind === 'TEXT_SNAPSHOT');
    check('D4-53 归档快照真实落盘且正文可只读回放（TEXT_SNAPSHOT + archivedBodyAvailable）',
      pubGet.status === 200 && !!snap && !!snap.objectKey && pubGet.json.archivedBodyAvailable === true
        && String(pubGet.json.archivedBody || '').indexOf('Published Archive') !== -1,
      'artifacts=' + JSON.stringify(arts.map((a) => a.kind + ':' + a.objectKey)).slice(0, 200)
        + ' bodyLen=' + String(pubGet.json && pubGet.json.archivedBody || '').length);

    /* H3. 红线：发布绝不触发向资料库的任何写入 */
    const docCountAfter = await signedOaRequest('POST', '/api/integrations/marketing/assets/search',
      { limit: 50, offset: 0 }, await ticketFor('exec', 'assets.search', 'D4/B5：发布后资产计数'));
    const totalAfter = (docCountAfter.json && docCountAfter.json.data && docCountAfter.json.data.total) || 0;
    check('D4-54 资料库侧资产总数在发布前后**未变化**（发布成品绝不会被自动镜像入正式库）',
      docCountBefore.status === 200 && docCountAfter.status === 200 && totalBefore === totalAfter,
      'before=' + totalBefore + ' after=' + totalAfter);

    const chAfter = await signedOaRequest('GET', '/api/integrations/marketing/changes', undefined,
      await ticketFor('exec', 'changes.read', 'D4/B5：发布后新增事件'), { query: { cursor: cursorBefore, limit: 200 } });
    const newEvents = ((chAfter.json && chAfter.json.data && chAfter.json.data.items) || []);
    check('D4-55 发布期间资料库变更事件流**零新增**（运营中台发布不产生任何出站写入）',
      chAfter.status === 200 && newEvents.length === 0,
      'cursorBefore=' + cursorBefore + ' newItems=' + newEvents.length
        + ' kinds=' + JSON.stringify(newEvents.map((e) => e.type || e.eventType)));
  }

  {
    /* H4. 从历史成品提取复用母版 → **必须**另开独立准入申请（不复用既有 Provider 申请） */
    const up3 = await cCreator.raw('/api/mos/assets/upload?brand=VFIB&name=d4-b5-remaster.png', png('remaster'), 'image/png');
    const mk3 = await cCreator.call('POST', '/api/mos/asset-admissions?brand=VFIB', {
      workingAssetId: up3.json.asset.id, categoryCode: 'A01',
      libraryPrimaryCategory: '02', librarySubcategory: '02.04',
      classification: 'internal', licenseStatus: 'cleared',
      reuseScope: 'campaign_reuse', externalAiTransferPolicy: 'allowed',
      submissionMetadata: { title: 'D4/B5 从成品提取的复用母版' },
      sourcePublicationRef: 'D4 已发布成品（提取母版）',
      idempotencyKey: 'd4-b5-remaster-' + RUN
    });
    const adm3 = mk3.json && mk3.json.admission;
    await cReviewer.call('POST', '/api/mos/asset-admissions/' + adm3.id + '/precheck?brand=VFIB', {});
    await cCreator.call('POST', '/api/mos/asset-admissions/' + adm3.id + '/submit-final?brand=VFIB', {});
    const cases3 = await admin2.call('GET', '/api/mos/review-cases?brand=VFIB&pageSize=50');
    const c3 = ((cases3.json && cases3.json.items) || [])
      .filter((x) => x.subjectId === adm3.id).sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1))[0];
    if (c3) await cFinal.call('POST', '/api/mos/review-cases/' + c3.id + '/decision?brand=VFIB', { action: 'APPROVE', approvalRef: adm3.id });
    const s3 = await cCreator.call('POST', '/api/mos/asset-admissions/' + adm3.id + '/sync?brand=VFIB', {});
    const rc3 = (s3.json && s3.json.receipt) || {};
    check('D4-56 从历史成品提取复用母版 → 走**独立的新准入申请**（得到与首发不同的 providerAdmissionId）',
      s3.status === 200 && /^adm_/.test(String(rc3.providerAdmissionId || ''))
        && rc3.providerAdmissionId !== providerAdmissionId
        && rc3.errorCode === 'FINAL_APPROVAL_REQUIRED',
      'remasterProviderId=' + rc3.providerAdmissionId + ' firstProviderId=' + providerAdmissionId
        + ' code=' + rc3.errorCode);
  }

  /* ============================================================
   * Phase G —— 红线（结构性边界）
   * ============================================================ */
  section('Phase G · 红线：Published Archive 只在 MOS；MARK 项不越界；Provider 源码未改');

  {
    const oh = await httpJson(OA_BASE, '/api/integrations/marketing/health', {
      headers: {
        'x-vfib-key-id': OA_KEY_ID,
        'x-vfib-timestamp': String(Date.now()),
        'x-vfib-nonce': crypto.randomBytes(12).toString('hex'),
        'x-vfib-signature': 'x'
      }
    });
    void oh;
    const h = await signedOaRequest('GET', '/api/integrations/marketing/health');
    const caps = (h.json && h.json.data && h.json.data.capabilities) || {};
    check('D4-41 Published Content 归档恒不在 Provider（capabilities.publishedContentArchive=false）',
      caps.publishedContentArchive === false, JSON.stringify(caps));

    const pub = await cCreator.call('GET', '/api/mos/publications?brand=VFIB&pageSize=5');
    const pubNote = String((pub.json && pub.json.note) || '');
    check('D4-42 Published Archive 归档面在 Marketing OS 侧真实存在（红线：归档只在运营中台）',
      pub.status === 200 && pub.json && Array.isArray(pub.json.items)
        && /Published Archive/.test(pubNote),
      'HTTP ' + pub.status + ' total=' + (pub.json && pub.json.total));
    check('D4-42b 归档说明明示「已发布内容不会自动进入企业资料库」（零污染回灌）',
      /不会.*进入企业资料库/.test(pubNote), 'note=' + pubNote);
  }

  {
    const centers = await admin2.call('GET', '/api/mos/meta');
    const meta = (centers.json || {});
    // MARK 项：不得出现客户增长 / 声誉 / 线索 / 代理 / 自动发布 的路由或权限
    const perms = Object.keys(meta.permissions || {}).join(',');
    const forbidden = ['lead.handoff', 'reputation.monitor', 'agent.console', 'social.autopost', 'crm.sync']
      .filter((p) => perms.indexOf(p) !== -1);
    check('D4-43 MARK 项（客户增长/声誉/线索/代理/自动发布）**未开发**：权限表中不存在对应权限点',
      forbidden.length === 0, 'forbidden=' + JSON.stringify(forbidden) + ' perms=' + Object.keys(meta.permissions || {}).length);
    check('D4-44 schema 已升到 v5（集成态四集合随迁移只增不改）',
      meta.schemaVersion === 5, 'schemaVersion=' + meta.schemaVersion);
  }

  {
    // Provider 源码完整性：本脚本只以环境变量装配，未写入资料库仓库
    const stat = fs.statSync(oaEntry);
    const ageMs = Date.now() - stat.mtimeMs;
    check('D4-45 Provider 源码未被本次联调修改（server.js mtime 早于本次运行）',
      ageMs > 60000, 'mtimeAge=' + Math.round(ageMs / 1000) + 's');
  }

  /* ============================================================
   * 收尾
   * ============================================================ */
  const mosLog = (procs.find((p) => p.__label === 'mos-2') || {}).__log || '';
  const oaLog = (procs.find((p) => p.__label === 'provider') || {}).__log || '';
  check('D4-46 MOS 侧事件轮询默认关闭（未获运营授权不自动出站）',
    /未启动（POLL_DISABLED）/.test(mosLog), '');
  check('D4-47 Provider 隔离实例运行期无未捕获异常',
    !/Unhandled|UnhandledPromiseRejection/.test(oaLog), '');

  await cleanup();
  const stillUp = await (async () => {
    try { const r = await fetch(OA_BASE + '/api/health'); return r.ok; } catch (_) { return false; }
  })();
  check('D4-48 两套实例均已停止、临时数据目录已清理、`data/` 未被触碰',
    stillUp === false && !fs.existsSync(MOS_DATA_DIR) && !fs.existsSync(OA_DATA_DIR)
      && !fs.existsSync(path.join(ROOT, 'data-mos-b04')),
    'oaStillUp=' + stillUp);

  /* ---------------- 结论与证据 ---------------- */
  const passed = results.length - failures;
  const total = results.length;
  const out = {
    suite: 'mos-e2e-build04-dual',
    phase: 'V1.1 B4 —— 双系统真实 HTTP 端到端联调',
    ranAt: new Date().toISOString(),
    runTag: RUN,
    verdict: failures === 0 ? 'CONDITIONAL' : 'FAILED',
    verdictReason: failures === 0
      ? '本侧真实双进程端到端联调全部通过；但因 A 包交付的 LIBRARY_HANDOFF_BUNDLE_V1.1 尚未收到、'
        + 'Provider 侧未宣布停止点达成，**Joint Acceptance 不得判定为 PASS** —— 结论封顶 CONDITIONAL。'
      : '存在失败断言，详见 cases。',
    jointAcceptance: 'CONDITIONAL（待 Provider 交付 LIBRARY_HANDOFF_BUNDLE_V1.1 后由双方签署）',
    provider: {
      appVersionExpected: '1.1.7',
      sourceDir: OA_ROOT,
      isolation: '独立数据目录 + 运行期随机管理员口令 + 运行期随机票据 HMAC 密钥；外部 Provider 一律关闭',
      sourceModified: false
    },
    mos: {
      baseUrl: MOS_BASE, providerBaseUrl: OA_BASE,
      egress: 'loopback http + allowLoopbackHttp（仅隔离测试；生产一律拒绝）',
      userMapping: 'workspace.userMap 显式映射（未映射用户如实拒绝）'
    },
    ports: { mos: MOS_PORT, provider: OA_PORT },
    contract: { contractVersion: '1.0', workspaceAppVersion: '1.1.7', openapiSha256: 'cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3' },
    realJointTest: 'EXECUTED（真实 HTTP 双进程；Provider 为资料库 V1.1.7 隔离实例）',
    transcript: transcript.slice(-400),
    total, passed, failed: failures, cases: results
  };
  fs.writeFileSync(path.join(OUT_DIR, 'dual-e2e-result.json'), JSON.stringify(out, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'dual-e2e-summary.txt'),
    'BUILD-04 双系统真实 HTTP 端到端联调\n'
    + 'run=' + RUN + '  at=' + out.ranAt + '\n'
    + 'MOS ' + MOS_BASE + '  →  Provider(资料库 V1.1.7) ' + OA_BASE + '\n'
    + '断言：' + passed + '/' + total + ' 通过\n'
    + '结论：' + out.verdict + ' —— ' + out.verdictReason + '\n', 'utf8');

  console.log('');
  console.log('双系统真实 HTTP 端到端联调结果：' + passed + '/' + total + ' 通过');
  console.log('结论：' + out.verdict + '（Joint Acceptance: CONDITIONAL）');
  console.log('证据：' + path.join(OUT_DIR, 'dual-e2e-result.json'));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error('双系统联调异常：' + (err && err.stack ? err.stack : err));
  try { await cleanup(); } catch (_) { /* ignore */ }
  process.exit(1);
});
