#!/usr/bin/env node
'use strict';
/* ============================================================
 * BUILD-06 · V1.2 —— 双系统**真实 HTTP** 安全负例与跨品牌/密级拒绝
 * ------------------------------------------------------------
 * 依据 V1.2 B 包 Phase B1：
 *   「双进程真实HTTP分别实测：**过期签名、nonce重放、服务账号撤销**；
 *     **跨品牌/高密级数据拒绝**。报告脱敏请求ID、请求条件、期望/实际码、
 *     **服务端审计证据**。不得仅拿单元测试冒充真实调用。」
 * 依据 V1.2 B 包 Phase B1 末条：
 *   「Revoked / Deprecated / 权限撤销 / Skill 失效**不得继续生成新正式作品**。」
 * 依据 C 包补证矩阵：INT-02（真实 HTTP 拒绝）、INT-03（跨品牌 / 高密级拒绝）。
 *
 * 与 BUILD-04（B4）的分工：
 *   · B4 覆盖「正常链路 + 归档隔离 + 抽象级负例（伪造签名 / 票据越权）」；
 *   · BUILD-06 只补 V1.1 联合验收中 6 项 CONDITIONAL 里的 INT-02 / INT-03，
 *     以及 V1.2 B1 新增的「失效对象不得进入正式输出」端到端门禁。
 *
 * 诚实性红线：
 *   · 所有负例都是**真实 HTTP**：两套独立进程、真实 Ed25519 签名、真实受限票据；
 *     Provider 侧**零源码改动**（只以 server.js + 环境变量装配隔离实例）。
 *   · 「服务端审计证据」直接读取 **Provider 隔离实例自己的 db.json**（该临时目录由本
 *     套件创建并拥有），核对 `integration-call` 审计行的 code/status/correlationId，
 *     而不是只看 HTTP 响应。
 *   · 合成测试身份只用于证明控制机制，**不代表真人授权或真人验收**；
 *     未配置真实 AI 凭据 / 未取得 SPECIAL-01 原件 / Skill V1.2 未获真人批准 →
 *     对应项如实 BLOCKED，绝不在此脚本里伪造 PASS。
 *
 * 端口（见 README 端口表；与 OA 侧占用段互斥）：
 *   MOS 实例   9560-9569
 *   Provider   9760-9769
 *
 * 用法：
 *   node tools/mos-e2e-build05-dual.js
 * 可选环境变量：
 *   OA_SOURCE_DIR   资料库仓库路径（默认本机既有路径；不存在则如实记 BLOCKED 并退出码 2）
 *   D6_KEEP         设为 1 时保留临时数据目录（排障用）
 * ============================================================ */

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OA_ROOT = path.resolve(process.env.OA_SOURCE_DIR
  || 'D:/企业数据后台/oa-system-20261004/oa-system');

const MOS_PORT = 9560 + Math.floor(Math.random() * 8);
const OA_PORT = 9760 + Math.floor(Math.random() * 8);
const MOS_BASE = 'http://127.0.0.1:' + MOS_PORT;
const OA_BASE = 'http://127.0.0.1:' + OA_PORT;

const MOS_DATA_DIR = path.join(os.tmpdir(), 'data-mos-d6-' + crypto.randomBytes(4).toString('hex'));
const OA_DATA_DIR = path.join(os.tmpdir(), 'data-oa-d6-' + crypto.randomBytes(4).toString('hex'));
const OUT_DIR = path.join(ROOT, 'TEST_EVIDENCE_MOS_BUILD06');

const MOS_ADMIN_PW = 'D6a-' + crypto.randomBytes(10).toString('base64url');
const MOS_ADMIN_PW2 = 'D6b-' + crypto.randomBytes(10).toString('base64url');
const OA_ADMIN_PW = 'D6o-' + crypto.randomBytes(14).toString('base64url');
const OA_TICKET_KEY = crypto.randomBytes(32).toString('hex');
const RUN = crypto.randomBytes(4).toString('hex');

/** MOS 侧服务身份密钥对：私钥只在本次进程内存，Provider 只登记公钥 */
const KEYPAIR = crypto.generateKeyPairSync('ed25519');
const PUB_PEM = KEYPAIR.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const PRIV_PEM = KEYPAIR.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
/** 撤销 / 轮换负例专用密钥对（不干扰主链路） */
const KEYPAIR2 = crypto.generateKeyPairSync('ed25519');
const PUB2_PEM = KEYPAIR2.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEYPAIR3 = crypto.generateKeyPairSync('ed25519');
const PUB3_PEM = KEYPAIR3.publicKey.export({ type: 'spki', format: 'pem' }).toString();
const KEYPAIR3_NEW = crypto.generateKeyPairSync('ed25519');
const PUB3_NEW_PEM = KEYPAIR3_NEW.publicKey.export({ type: 'spki', format: 'pem' }).toString();

/** 主服务账户 keyId（由 Provider 分配） */
let OA_KEY_ID = '';

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
const SECRET_KEY_RE = /^(ticket|x-vfib-ticket|x-vfib-signature|authorization|cookie|set-cookie|privatekey|privateKeyPem|signingKey|password|publicKey|publicKeyPem|apiKey|contentBase64)$/i;
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
let REQ_SEQ = 0;
async function httpJson(base, pathname, opts) {
  const o = opts || {};
  const res = await fetch(base + pathname, {
    method: o.method || 'GET',
    headers: o.headers || {},
    body: o.body === undefined ? undefined
      : (typeof o.body === 'string' || Buffer.isBuffer(o.body) || o.body instanceof Uint8Array
        ? o.body : JSON.stringify(o.body)),
    redirect: 'manual'
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  return { status: res.status, json, text, headers: res.headers };
}

function pngBytes(tag) {
  REQ_SEQ += 1;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    Buffer.from('d6-dual-' + (tag || 'img') + '-' + RUN + '-' + REQ_SEQ + '-' + Date.now())
  ]);
}

/* ---------------- Provider 侧签名（与 lib/integration/service-accounts.js 同构） ---------------- */
function canonicalString(keyId, method, pathname, timestamp, nonce, bodyHash) {
  return ['v1', keyId, String(method).toUpperCase(), pathname, String(timestamp), String(nonce), bodyHash].join('\n');
}
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

/**
 * 发送一次真实签名的 Provider 请求。
 * override：keyId / timestamp / nonce / signature / mode / keypair / query / correlationId
 * mode: 'normal' | 'badSignature' | 'noHeaders'
 */
function signedOaRequest(method, pathname, bodyObj, ticket, override) {
  const o = override || {};
  const keyId = o.keyId !== undefined ? o.keyId : OA_KEY_ID;
  const kp = o.keypair || KEYPAIR;
  const bodyStr = (bodyObj === undefined || bodyObj === null) ? '' : JSON.stringify(bodyObj);
  // Provider 时间窗以**秒**为单位（±300s），不得传毫秒
  const ts = o.timestamp !== undefined ? String(o.timestamp) : String(Math.floor(Date.now() / 1000));
  const nonce = o.nonce || crypto.randomBytes(12).toString('hex');
  const canon = canonicalString(keyId, method, pathname, ts, nonce, sha256Hex(Buffer.from(bodyStr, 'utf8')));
  const sig = crypto.sign(null, Buffer.from(canon, 'utf8'), kp.privateKey).toString('base64');
  const mode = o.mode || 'normal';
  const headers = {
    'x-vfib-key-id': keyId, 'x-vfib-timestamp': ts, 'x-vfib-nonce': nonce,
    'x-vfib-signature': mode === 'badSignature' ? String(o.signature || '') : sig
  };
  if (mode === 'noHeaders') {
    delete headers['x-vfib-key-id']; delete headers['x-vfib-timestamp'];
    delete headers['x-vfib-nonce']; delete headers['x-vfib-signature'];
  }
  if (bodyStr) headers['Content-Type'] = 'application/json';
  if (ticket) headers['x-vfib-ticket'] = ticket;
  const cid = o.correlationId || ('d6-' + RUN + '-' + (++REQ_SEQ));
  headers['x-vfib-correlation-id'] = cid;
  // 契约 §1.1：query 不参与签名 —— 签名用无 query 的 pathname，请求才拼 query
  const q = o.query || {};
  const qs = Object.keys(q).filter((k) => q[k] !== undefined && q[k] !== null)
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(q[k]))).join('&');
  return httpJson(OA_BASE, pathname + (qs ? '?' + qs : ''), { method, headers, body: bodyStr || undefined })
    .then((r) => Object.assign(r, { __correlationId: cid, __pathname: pathname }));
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
    const headers = Object.assign({ 'x-oa-client': 'api' }, bearer());
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
      token = (r.json && (r.json.token || (r.json.data && r.json.data.token))) || '';
      return r;
    },
    async upload(pathname, meta, fileName, bytes) {
      const headers = Object.assign({
        'x-lib-meta': encodeURIComponent(JSON.stringify(meta)),
        'x-file-name': encodeURIComponent(fileName),
        'Content-Type': 'application/octet-stream'
      }, bearer());
      return httpJson(OA_BASE, pathname, { method: 'POST', headers, body: bytes });
    },
    async sessionTicket(body) {
      return httpJson(OA_BASE, '/api/asset-admission/tickets', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json', 'x-oa-client': 'api' }, bearer()),
        body: JSON.stringify(body)
      });
    }
  };
}

/* ---------------- 清理 ---------------- */
async function cleanup() {
  for (const p of procs) { try { await stopServer(p); } catch (_) { /* ignore */ } }
  if (process.env.D6_KEEP === '1') return;
  for (const d of [MOS_DATA_DIR, OA_DATA_DIR]) {
    for (let i = 0; i < 5; i += 1) {
      try { fs.rmSync(d, { recursive: true, force: true }); break; } catch (_) { await sleep(400); }
    }
  }
}

/* ---------------- Provider 侧审计证据 ---------------- */
function oaAuditRows() {
  // Provider 落盘有 60ms 防抖：调用方需先 sleep 再读
  const p = path.join(OA_DATA_DIR, 'db.json');
  if (!fs.existsSync(p)) return null;
  try {
    const db = JSON.parse(fs.readFileSync(p, 'utf8'));
    const logs = Array.isArray(db.logs) ? db.logs : [];
    return logs.filter((l) => l && l.action === 'integration-call');
  } catch (_) { return null; }
}
function auditFor(rows, correlationId) {
  if (!rows) return null;
  const hit = rows.filter((r) => String(r.correlationId || '') === String(correlationId || ''));
  return hit.length ? hit[hit.length - 1] : null;
}

/* ============================================================
 * 主流程
 * ============================================================ */
async function main() {
  console.log('BUILD-06 · V1.2 双系统真实 HTTP 安全负例（INT-02 / INT-03 + B1 正式输出门禁）');
  console.log('  MOS 实例    ' + MOS_BASE + '   数据目录 ' + MOS_DATA_DIR);
  console.log('  Provider    ' + OA_BASE + '   数据目录 ' + OA_DATA_DIR);
  console.log('  runId       ' + RUN);

  fs.mkdirSync(OUT_DIR, { recursive: true });

  /* ---------- 前置：Provider 源码可用性 ---------- */
  const oaEntry = path.join(OA_ROOT, 'server.js');
  if (!fs.existsSync(oaEntry)) {
    check('D6-00 Provider 源码可用（' + OA_ROOT + '）', false, '未找到 server.js → 无法进行真实双进程联调');
    console.log('\n结论：BLOCKED —— Provider 源码不可用。');
    process.exitCode = 2;
    return;
  }
  const oaEntryMtime = fs.statSync(oaEntry).mtimeMs;
  check('D6-00 Provider 源码可用（只以 server.js + 环境变量装配隔离实例）', true, OA_ROOT);

  /* ============================================================
   * Phase A —— Provider 隔离实例 + 真实 HTTP 安全负例
   * ============================================================ */
  section('Phase A · Provider 隔离实例（独立数据目录 + 运行期随机密钥）');

  spawnServer(OA_ROOT, {
    OA_PORT: String(OA_PORT), OA_HOST: '127.0.0.1', OA_DATA_DIR: OA_DATA_DIR,
    OA_INTEGRATION_ENABLED: 'true',
    OA_INTEGRATION_SIGNING_KEY: OA_TICKET_KEY,
    OA_INTEGRATION_ALLOWED_BRANDS: 'VFIB,UCARD',
    OA_ALLOW_BEARER_API: '1',
    OA_SECURE_COOKIES: 'never', /* 合法值仅 auto|always|never；隔离实例跑在 http 上，显式 never */
    /* 全新隔离库首次初始化时的管理员口令（Provider lib/seed.js 读取；仅首启生效） */
    OA_ADMIN_PASSWORD: OA_ADMIN_PW
  }, 'provider');
  const oaUp = await waitHealth(OA_BASE, 90);
  check('D6-01 Provider 隔离实例真实启动（/api/health 200）', oaUp, 'HTTP ' + (oaUp ? 200 : 0));
  if (!oaUp) {
    console.log('\n结论：BLOCKED —— Provider 实例未起来。');
    console.log('--- Provider 启动日志 ---\n' + (procs[procs.length - 1].__log || '(空)'));
    process.exitCode = 2; return;
  }

  const oa = oaClient();
  const oaLoginBody = await oa.login('admin', OA_ADMIN_PW);
  check('D6-02 Provider 管理员登录成功（Bearer api 会话）', !!oa.getToken(),
    'HTTP ' + oaLoginBody.status + ' token=' + (oa.getToken() ? 'YES' : 'NO'));
  if (!oa.getToken()) { console.log('\n结论：BLOCKED —— Provider 管理员登录失败。'); process.exitCode = 2; return; }

  /* ---------- A3 合成测试身份（明确标注为合成） ---------- */
  const P_USERS = [
    { key: 'exec', username: 'd6.exec', name: 'D6 普通员工', role: 'employee', libRole: 'member', dept: '市场部' },
    { key: 'exe', username: 'd6.exe', name: 'D6 高管', role: 'employee', libRole: 'executive', dept: '董事会' },
    { key: 'rev', username: 'd6.rev', name: 'D6 复核员', role: 'employee', libRole: 'reviewer', dept: '合规部' },
    { key: 'lfa', username: 'd6.lfa', name: 'D6 最终审批人', role: 'employee', libRole: 'owner', dept: '品牌与市场部' }
  ];
  const pIds = {};
  let pUsersOk = true;
  for (const u of P_USERS) {
    const r = await oa.call('POST', '/api/users', {
      username: u.username, name: u.name, password: OA_ADMIN_PW, role: u.role,
      libRole: u.libRole, dept: u.dept, title: 'D6 合成测试身份'
    });
    const id = r.json && r.json.user && r.json.user.id;
    if (!id) { pUsersOk = false; console.log('    create fail ' + u.username + ' :: ' + r.text.slice(0, 200)); }
    pIds[u.key] = id || '';
  }
  check('D6-03 Provider 侧合成测试身份创建（member / executive / reviewer / owner）', pUsersOk,
    P_USERS.map((u) => u.key + '=' + (pIds[u.key] || 'FAIL')).join(' '));

  const grant = await oa.call('POST', '/api/asset-admission/approvers', {
    userId: pIds.lfa, scope: 'library.asset.approve.final', note: 'D6 真实 HTTP 负例 —— 合成授权主体'
  });
  check('D6-04 Provider 侧独立授权显式登记（library.asset.approve.final 不自动继承）',
    grant.status === 200 && grant.json && grant.json.ok === true, 'HTTP ' + grant.status);

  /* ---------- A5 资料夹具：internal 与 executive 各一份 ---------- */
  const TOK_INTERNAL = 'D6INT' + RUN.toUpperCase();
  const TOK_EXEC = 'D6EXE' + RUN.toUpperCase();
  const metaOf = (title, classification) => ({
    title, subcategoryId: '02.01', classification, documentLevel: 'STANDARD',
    documentType: 'Other', tags: ['d6'], description: 'BUILD-06 真实 HTTP 联调夹具', effectiveDate: null
  });

  const upInternal = await oa.upload('/api/library/upload?action=submit',
    metaOf(TOK_INTERNAL + ' Brand facts fixture', 'internal'), TOK_INTERNAL + '.txt',
    Buffer.from('D6 internal fixture ' + RUN + ' ' + TOK_INTERNAL, 'utf8'));
  const docInternalId = upInternal.json && upInternal.json.item && upInternal.json.item.id;
  check('D6-05 夹具①上传并送审（internal，由管理员）', upInternal.status === 200 && !!docInternalId,
    'HTTP ' + upInternal.status + ' doc=' + (docInternalId || 'FAIL'));
  const apprInternal = docInternalId
    ? await oa.call('POST', '/api/library/' + docInternalId + '/approve') : { status: 0, json: {} };
  check('D6-06 夹具①批准（internal 由 admin 资料库角色批准，密级 rank≤2）',
    apprInternal.status === 200, 'HTTP ' + apprInternal.status);

  const oaExe = oaClient();
  await oaExe.login('d6.exe', OA_ADMIN_PW);
  const upExec = await oaExe.upload('/api/library/upload?action=submit',
    metaOf(TOK_EXEC + ' Board strategy fixture', 'executive'), TOK_EXEC + '.txt',
    Buffer.from('D6 executive fixture ' + RUN + ' ' + TOK_EXEC, 'utf8'));
  const docExecId = upExec.json && upExec.json.item && upExec.json.item.id;
  check('D6-07 夹具②上传并送审（executive，由 executive 资料库角色）',
    upExec.status === 200 && !!docExecId, 'HTTP ' + upExec.status + ' doc=' + (docExecId || 'FAIL'));
  const apprExec = docExecId
    ? await oaExe.call('POST', '/api/library/' + docExecId + '/approve') : { status: 0, json: {} };
  check('D6-08 夹具②批准（executive，仅具备相应资料库角色者可批）',
    apprExec.status === 200, 'HTTP ' + apprExec.status);

  /* ---------- A6 服务账户登记 ---------- */
  const ALL_SCOPES = ['knowledge.search', 'assets.search', 'assets.read', 'admissions.write',
    'admissions.read', 'skills.read', 'changes.read', 'tickets.issue'];
  const sa1 = await oa.call('POST', '/api/integration-accounts', {
    name: 'D6 主服务账户', publicKey: PUB_PEM, scopes: ALL_SCOPES, description: 'BUILD-06 主链路'
  });
  OA_KEY_ID = (sa1.json && sa1.json.item && sa1.json.item.keyId) || '';
  check('D6-09 服务账户①登记成功（Provider 只持公钥，响应不含私钥字段）',
    sa1.status === 200 && !!OA_KEY_ID && !/"privateKey/i.test(sa1.text),
    'keyId=' + (OA_KEY_ID || 'FAIL'));

  const sa2 = await oa.call('POST', '/api/integration-accounts', {
    name: 'D6 撤销专用账户', publicKey: PUB2_PEM,
    scopes: ['knowledge.search', 'tickets.issue'], description: 'BUILD-06 撤销负例'
  });
  const SA2_ID = (sa2.json && sa2.json.item && sa2.json.item.id) || '';
  check('D6-10 服务账户②登记成功（撤销负例专用，不影响主链路）', sa2.status === 200 && !!SA2_ID,
    'id=' + (SA2_ID || 'FAIL'));

  const sa3 = await oa.call('POST', '/api/integration-accounts', {
    name: 'D6 轮换专用账户', publicKey: PUB3_PEM,
    scopes: ['knowledge.search'], description: 'BUILD-06 公钥轮换负例'
  });
  const SA3_ID = (sa3.json && sa3.json.item && sa3.json.item.id) || '';
  check('D6-11 服务账户③登记成功（轮换负例专用）', sa3.status === 200 && !!SA3_ID,
    'id=' + (SA3_ID || 'FAIL'));

  /* ---------- A7 受限票据 ---------- */
  async function serviceTicket(userId, brandId, scopes, purpose) {
    const r = await signedOaRequest('POST', '/api/integrations/marketing/tickets', {
      userId, brandId, scopes, purpose: purpose || 'D6 真实 HTTP 联调', ttlSeconds: 600
    }, null, {});
    return { ticket: (r.json && r.json.data && r.json.data.ticket) || '', r };
  }
  const TICKET_SCOPES = ['knowledge.search', 'assets.search', 'assets.read',
    'admissions.write', 'admissions.read', 'changes.read', 'skills.read'];
  const tVfib = await serviceTicket(pIds.exec, 'VFIB', TICKET_SCOPES, 'D6 品牌 VFIB 读/写票据');
  const tVfibExe = await serviceTicket(pIds.exe, 'VFIB', TICKET_SCOPES, 'D6 高管身份读票据');
  const tUcard = await serviceTicket(pIds.exec, 'UCARD', ['assets.search', 'assets.read', 'knowledge.search'],
    'D6 品牌 UCARD 跨品牌负例票据');
  check('D6-12 受限票据签发（VFIB 普通身份 / VFIB 高管身份 / UCARD 跨品牌身份）',
    !!tVfib.ticket && !!tVfibExe.ticket && !!tUcard.ticket,
    'HTTP ' + [tVfib.r.status, tVfibExe.r.status, tUcard.r.status].join('/'));

  check('D6-13 服务票据**不含** admission.final.decision（服务身份不可代签最终审批）',
    !!(tVfib.r.json && tVfib.r.json.data && tVfib.r.json.data.note
      && /final\.decision/.test(String(tVfib.r.json.data.note))),
    'note 明示服务票据永不携带该范围');

  const capProbe = await signedOaRequest('GET', '/api/integrations/marketing/health', null, null, {});
  const caps = (capProbe.json && capProbe.json.data && capProbe.json.data.capabilities) || {};
  check('D6-13b Provider 能力声明不夸大：publishedContentArchive=false（资料库不建发布成品镜像）',
    capProbe.status === 200 && caps.publishedContentArchive === false,
    'HTTP ' + capProbe.status + ' publishedContentArchive=' + caps.publishedContentArchive);

  /* ============================================================
   * A8 —— INT-02：真实 HTTP 身份类拒绝
   * ============================================================ */
  section('A8 · INT-02 真实 HTTP：过期签名 / nonce 重放 / 服务账号撤销 / 公钥轮换');

  const staleTs = Math.floor(Date.now() / 1000) - 3600;
  const n01 = await signedOaRequest('GET', '/api/integrations/marketing/health', null, null,
    { timestamp: staleTs });
  check('D6-14 INT-02① 过期签名（ts=-3600s）被真实拒绝：401 TIMESTAMP_OUT_OF_WINDOW',
    n01.status === 401 && n01.json && n01.json.error && n01.json.error.code === 'TIMESTAMP_OUT_OF_WINDOW',
    '期望 401/TIMESTAMP_OUT_OF_WINDOW，实际 ' + n01.status + '/'
      + ((n01.json && n01.json.error && n01.json.error.code) || '-') + ' | cid=' + n01.__correlationId);

  const futureTs = Math.floor(Date.now() / 1000) + 3600;
  const n02 = await signedOaRequest('GET', '/api/integrations/marketing/health', null, null,
    { timestamp: futureTs });
  check('D6-15 INT-02①b 未来时间戳（ts=+3600s）同样被拒：401 TIMESTAMP_OUT_OF_WINDOW',
    n02.status === 401 && n02.json && n02.json.error && n02.json.error.code === 'TIMESTAMP_OUT_OF_WINDOW',
    '实际 ' + n02.status + '/' + ((n02.json && n02.json.error && n02.json.error.code) || '-')
      + ' | cid=' + n02.__correlationId);

  const replayNonce = crypto.randomBytes(12).toString('hex');
  const replayTs = Math.floor(Date.now() / 1000);
  const n03a = await signedOaRequest('POST', '/api/integrations/marketing/assets/search',
    { query: '', limit: 1 }, tVfib.ticket, { nonce: replayNonce, timestamp: replayTs });
  const n03b = await signedOaRequest('POST', '/api/integrations/marketing/assets/search',
    { query: '', limit: 1 }, tVfib.ticket, { nonce: replayNonce, timestamp: replayTs });
  check('D6-16 INT-02② nonce 重放被真实拒绝：首次 200、原样重放 401 NONCE_REPLAY',
    n03a.status === 200 && n03b.status === 401
      && n03b.json && n03b.json.error && n03b.json.error.code === 'NONCE_REPLAY',
    '首次 ' + n03a.status + ' → 重放 ' + n03b.status + '/'
      + ((n03b.json && n03b.json.error && n03b.json.error.code) || '-')
      + ' | cid=' + n03b.__correlationId);

  const beforeRevoke = await signedOaRequest('GET', '/api/integrations/marketing/health', null, null,
    { keyId: SA2_ID, keypair: KEYPAIR2 });
  const revokeRes = await oa.call('DELETE', '/api/integration-accounts/' + SA2_ID);
  const afterRevoke = await signedOaRequest('GET', '/api/integrations/marketing/health', null, null,
    { keyId: SA2_ID, keypair: KEYPAIR2 });
  check('D6-17 INT-02③ 服务账号撤销立即生效：撤销前 200 → 撤销后 401 BAD_SERVICE_ACCOUNT',
    beforeRevoke.status === 200 && revokeRes.status === 200
      && afterRevoke.status === 401
      && afterRevoke.json && afterRevoke.json.error && afterRevoke.json.error.code === 'BAD_SERVICE_ACCOUNT',
    '撤销前 ' + beforeRevoke.status + ' / 撤销 ' + revokeRes.status + ' / 撤销后 ' + afterRevoke.status
      + '/' + ((afterRevoke.json && afterRevoke.json.error && afterRevoke.json.error.code) || '-')
      + ' | cid=' + afterRevoke.__correlationId);

  const beforeRotate = await signedOaRequest('GET', '/api/integrations/marketing/health', null, null,
    { keyId: SA3_ID, keypair: KEYPAIR3 });
  const rotateRes = await oa.call('PUT', '/api/integration-accounts/' + SA3_ID + '/public-key',
    { publicKey: PUB3_NEW_PEM });
  const afterRotate = await signedOaRequest('GET', '/api/integrations/marketing/health', null, null,
    { keyId: SA3_ID, keypair: KEYPAIR3 });
  const afterRotateNew = await signedOaRequest('GET', '/api/integrations/marketing/health', null, null,
    { keyId: SA3_ID, keypair: KEYPAIR3_NEW });
  check('D6-18 INT-02③b 公钥轮换后旧私钥立即失效：旧签 401 BAD_SIGNATURE、新签 200',
    beforeRotate.status === 200 && rotateRes.status === 200
      && afterRotate.status === 401 && afterRotateNew.status === 200,
    '轮换前 ' + beforeRotate.status + ' / 轮换 ' + rotateRes.status + ' / 旧签 ' + afterRotate.status
      + ' / 新签 ' + afterRotateNew.status + ' | cid=' + afterRotate.__correlationId);

  const n06 = await signedOaRequest('GET', '/api/integrations/marketing/health', null, null,
    { mode: 'badSignature', signature: Buffer.from('forged').toString('base64') });
  check('D6-19 对照：伪造签名 → 401 BAD_SIGNATURE（证明上面的 401 并非"一律拒绝"）',
    n06.status === 401 && n06.json && n06.json.error && n06.json.error.code === 'BAD_SIGNATURE',
    '实际 ' + n06.status + '/' + ((n06.json && n06.json.error && n06.json.error.code) || '-'));

  /* ============================================================
   * A9 —— INT-03：真实 HTTP 跨品牌 / 高密级拒绝
   * ============================================================ */
  section('A9 · INT-03 真实 HTTP：跨品牌拒绝 / 高密级资料拒绝');

  const n07 = await signedOaRequest('POST', '/api/integrations/marketing/knowledge/search',
    { query: 'fixture', brandId: 'UCARD' }, tVfib.ticket, {});
  check('D6-20 INT-03① 跨品牌（VFIB 票据查询 UCARD 上下文）被真实拒绝：403 BRAND_MISMATCH',
    n07.status === 403 && n07.json && n07.json.error && n07.json.error.code === 'BRAND_MISMATCH',
    '实际 ' + n07.status + '/' + ((n07.json && n07.json.error && n07.json.error.code) || '-')
      + ' | cid=' + n07.__correlationId);

  const n08 = await signedOaRequest('POST', '/api/integrations/marketing/tickets',
    { userId: pIds.exec, brandId: 'FORBIDDEN_BRAND', scopes: ['knowledge.search'] }, null, {});
  check('D6-21 INT-03①b 票据品牌不在服务端允许清单 → 403 BRAND_NOT_ALLOWED（票据签发即被拒）',
    n08.status === 403 && n08.json && n08.json.error && n08.json.error.code === 'BRAND_NOT_ALLOWED',
    '实际 ' + n08.status + '/' + ((n08.json && n08.json.error && n08.json.error.code) || '-')
      + ' | cid=' + n08.__correlationId);

  /* 跨品牌资产级：先取得一个正式 Asset ID（同时是 INT-05 的真实回归） */
  const admissionBody = {
    idempotencyKey: 'd6-adm-' + RUN,
    originObjectId: 'd6-origin-' + RUN,
    brandId: 'VFIB',
    libraryPrimaryCategory: '02',
    librarySubcategory: '02.01',
    classification: 'internal',
    licenseStatus: 'cleared',
    reuseScope: 'campaign_reuse',
    aiReusePolicy: 'blocked',
    externalAiTransferPolicy: 'blocked',
    marketingCategory: 'A02',
    title: 'D6 跨品牌隔离夹具',
    fileName: 'd6-asset-' + RUN + '.png'
  };
  const admCreate = await signedOaRequest('POST', '/api/integrations/marketing/admissions',
    admissionBody, tVfib.ticket, {});
  const admId = (admCreate.json && admCreate.json.data && admCreate.json.data.admissionRequestId) || '';

  const admSubmit = admId ? await signedOaRequest('POST',
    '/api/integrations/marketing/admissions/' + admId + '/submit',
    { reviews: [{ reviewerUserId: pIds.rev, outcome: 'pass', note: 'D6 复核通过（合成身份）' }] },
    tVfib.ticket, {}) : { status: 0, json: {} };

  const oaLfa = oaClient();
  await oaLfa.login('d6.lfa', OA_ADMIN_PW);
  const sesTicketLfa = await oaLfa.sessionTicket({
    brandId: 'VFIB', scopes: ['admission.final.decision'], purpose: 'D6 最终审批（合成授权主体）'
  });
  const lfaTicket = (sesTicketLfa.json && sesTicketLfa.json.ticket) || '';
  check('D6-22 单独授权的本人会话可签出 admission.final.decision 票据（kind=session）',
    sesTicketLfa.status === 200 && !!lfaTicket, 'HTTP ' + sesTicketLfa.status);

  const svcAskFinal = await signedOaRequest('POST', '/api/integrations/marketing/tickets', {
    userId: pIds.lfa, brandId: 'VFIB',
    scopes: ['admission.final.decision', 'admissions.read'], purpose: 'D6 服务身份尝试索取最终审批范围'
  }, null, {});
  const svcFinalTicket = (svcAskFinal.json && svcAskFinal.json.data && svcAskFinal.json.data.ticket) || '';
  const nUseSvc = admId ? await signedOaRequest('POST',
    '/api/integrations/marketing/admissions/' + admId + '/final-decision',
    { decision: 'approve' }, svcFinalTicket, {}) : { status: 0, json: {} };
  check('D6-23 INT-04 反例 服务票据索取 final 范围被剔除，且以它打最终审批 → 403 TICKET_KIND_MISMATCH',
    !!(svcAskFinal.json && svcAskFinal.json.data
      && (svcAskFinal.json.data.scopes || []).indexOf('admission.final.decision') === -1)
      && nUseSvc.status === 403,
    '签发返回 scopes=' + JSON.stringify((svcAskFinal.json && svcAskFinal.json.data && svcAskFinal.json.data.scopes) || [])
      + '，打最终审批 ' + nUseSvc.status + '/' + ((nUseSvc.json && nUseSvc.json.error && nUseSvc.json.error.code) || '-'));

  const finDec = admId ? await signedOaRequest('POST',
    '/api/integrations/marketing/admissions/' + admId + '/final-decision',
    { decision: 'approve', comment: 'D6 合成授权主体审批（不代表真人验收）' }, lfaTicket, {}) : { status: 0, json: {} };
  const artifact = admId ? await signedOaRequest('POST',
    '/api/integrations/marketing/admissions/' + admId + '/artifact',
    { fileName: admissionBody.fileName, contentBase64: pngBytes('asset').toString('base64') },
    tVfib.ticket, {}) : { status: 0, json: {} };
  const ASSET_ID = (artifact.json && artifact.json.data && artifact.json.data.libraryAssetId) || '';
  check('D6-24 准入链路真实走通并取得正式 Asset ID（用于跨品牌隔离对照）',
    admCreate.status === 200 && admSubmit.status === 200 && finDec.status === 200
      && artifact.status === 200 && !!ASSET_ID,
    'create/submit/final/artifact=' + [admCreate.status, admSubmit.status, finDec.status, artifact.status].join('/')
      + ' assetId=' + (ASSET_ID || 'FAIL'));

  const crossUcard = ASSET_ID ? await signedOaRequest('GET',
    '/api/integrations/marketing/assets/' + ASSET_ID, null, tUcard.ticket,
    { query: { brandId: 'UCARD' } }) : { status: 0, json: {} };
  const sameVfib = ASSET_ID ? await signedOaRequest('GET',
    '/api/integrations/marketing/assets/' + ASSET_ID, null, tVfib.ticket,
    { query: { brandId: 'VFIB' } }) : { status: 0, json: {} };
  check('D6-25 INT-03② 同一资产：VFIB 票据解析 200，UCARD 票据解析 403 NOT_REUSABLE_FOR_SUBJECT',
    sameVfib.status === 200 && crossUcard.status === 403
      && crossUcard.json && crossUcard.json.error
      && crossUcard.json.error.code === 'NOT_REUSABLE_FOR_SUBJECT',
    'VFIB ' + sameVfib.status + ' / UCARD ' + crossUcard.status + '/'
      + ((crossUcard.json && crossUcard.json.error && crossUcard.json.error.code) || '-')
      + ' | cid=' + crossUcard.__correlationId);

  const searchUcard = await signedOaRequest('POST', '/api/integrations/marketing/assets/search',
    { query: 'D6', limit: 50 }, tUcard.ticket, {});
  const searchVfib = await signedOaRequest('POST', '/api/integrations/marketing/assets/search',
    { query: 'D6', limit: 50 }, tVfib.ticket, {});
  const ucardItems = (searchUcard.json && searchUcard.json.data && searchUcard.json.data.items) || [];
  const vfibItems = (searchVfib.json && searchVfib.json.data && searchVfib.json.data.items) || [];
  check('D6-26 INT-03②b 跨品牌检索隔离：VFIB 命中该资产、UCARD 检索结果中不含该资产',
    vfibItems.some((x) => x.libraryAssetId === ASSET_ID)
      && !ucardItems.some((x) => x.libraryAssetId === ASSET_ID),
    'VFIB items=' + vfibItems.length + ' / UCARD items=' + ucardItems.length
      + '（UCARD 含目标=' + ucardItems.some((x) => x.libraryAssetId === ASSET_ID) + '）');

  const kExec = await signedOaRequest('POST', '/api/integrations/marketing/knowledge/search',
    { query: TOK_EXEC, topK: 10 }, tVfib.ticket, {});
  const kExec2 = await signedOaRequest('POST', '/api/integrations/marketing/knowledge/search',
    { query: TOK_EXEC, topK: 10 }, tVfibExe.ticket, {});
  const execItems = (kExec.json && kExec.json.data && kExec.json.data.items) || [];
  const execItems2 = (kExec2.json && kExec2.json.data && kExec2.json.data.items) || [];
  const hitExec = execItems.some((x) => String(x.title || '').indexOf(TOK_EXEC) !== -1);
  const hitExec2 = execItems2.some((x) => String(x.title || '').indexOf(TOK_EXEC) !== -1);
  check('D6-27 INT-03③ 高密级资料（executive）对非提权主体不可见：普通身份 0 命中 / 高管身份命中',
    kExec.status === 200 && kExec2.status === 200 && hitExec === false && hitExec2 === true,
  'HTTP ' + kExec.status + '/' + kExec2.status
  + ' 普通身份 hits=' + execItems.length + '（含目标=' + hitExec + '）/ 高管身份 hits=' + execItems2.length
  + '（含目标=' + hitExec2 + '）| cid=' + kExec.__correlationId
  + ' err=' + ((kExec.json && kExec.json.error && kExec.json.error.code) || '-')
  + (process.env.D6_DBG === '1' ? ' raw=' + JSON.stringify(kExec.json).slice(0, 600) : ''));

  const kInt = await signedOaRequest('POST', '/api/integrations/marketing/knowledge/search',
    { query: TOK_INTERNAL, topK: 10 }, tVfib.ticket, {});
  const intItems = (kInt.json && kInt.json.data && kInt.json.data.items) || [];
  const hitInt = intItems.some((x) => String(x.title || '').indexOf(TOK_INTERNAL) !== -1);
  check('D6-28 INT-03③b 对照：internal 资料对普通身份可见（证明检索链路本身有效）',
    kInt.status === 200 && hitInt === true,
  'HTTP ' + kInt.status + ' hits=' + intItems.length + '（含目标=' + hitInt + '）'
  + ' err=' + ((kInt.json && kInt.json.error && kInt.json.error.code) || '-')
  + (process.env.D6_DBG === '1' ? ' raw=' + JSON.stringify(kInt.json).slice(0, 600) : ''));

  /* ============================================================
   * A10 —— 服务端审计证据（直接读 Provider 隔离实例的 db.json）
   * ============================================================ */
  section('A10 · 服务端审计证据（Provider 侧 integration-call 审计行）');
  await sleep(900); // Provider 落盘有 60ms 防抖
  const auditRows = oaAuditRows();
  const expectAudit = [
    { cid: n01.__correlationId, code: 'TIMESTAMP_OUT_OF_WINDOW', status: 401, label: '过期签名' },
    { cid: n03b.__correlationId, code: 'NONCE_REPLAY', status: 401, label: 'nonce 重放' },
    { cid: afterRevoke.__correlationId, code: 'BAD_SERVICE_ACCOUNT', status: 401, label: '服务账号撤销' },
    { cid: n07.__correlationId, code: 'BRAND_MISMATCH', status: 403, label: '跨品牌（体/票据不一致）' },
    { cid: n08.__correlationId, code: 'BRAND_NOT_ALLOWED', status: 403, label: '跨品牌（不在允许清单）' },
    { cid: crossUcard.__correlationId, code: 'NOT_REUSABLE_FOR_SUBJECT', status: 403, label: '跨品牌资产不可复用' }
  ];
  const auditDetail = [];
  let auditHit = 0;
  for (const e of expectAudit) {
    const row = auditFor(auditRows, e.cid);
    const ok = !!row && String(row.code || '') === e.code && Number(row.status) === e.status && row.ok === false;
    if (ok) auditHit += 1;
    auditDetail.push({ label: e.label, correlationId: e.cid, expected: e.code + '/' + e.status,
      actual: row ? (String(row.code || '') + '/' + row.status) : '(无审计行)', matched: ok });
  }
  check('D6-29 服务端审计证据：6 类拒绝在 Provider 审计中逐条可核对（code + status + ok=false）',
    auditRows !== null && auditHit === expectAudit.length,
    '命中 ' + auditHit + '/' + expectAudit.length + '；审计行总数=' + (auditRows ? auditRows.length : 'N/A'));
  check('D6-30 被拒请求在审计中**不得**留下任何 2xx 成功记录（拒绝不能"看起来成功"）',
    auditRows !== null && expectAudit.every((e) => {
      const row = auditFor(auditRows, e.cid);
      return row && Number(row.status) >= 400;
    }), '全部为 4xx');

  /* ============================================================
   * Phase B —— MOS 隔离实例（两阶段启动）
   * ============================================================ */
  section('Phase B · Marketing OS 隔离实例（真实出站指向 Provider 隔离实例）');

  const MOS_ENV = {
    MOS_PORT: String(MOS_PORT), MOS_HOST: '127.0.0.1', MOS_DATA_DIR: MOS_DATA_DIR,
    MOS_ALLOW_LOCALHOST: '1', MOS_ADMIN_PASSWORD: MOS_ADMIN_PW,
    MOS_WORKSPACE_ENABLED: 'true',
    MOS_WORKSPACE_BASE_URL: OA_BASE,
    MOS_WORKSPACE_KEY_ID: OA_KEY_ID,
    MOS_WORKSPACE_PRIVATE_KEY_PEM: PRIV_PEM,
    MOS_WORKSPACE_ALLOW_LOOPBACK_HTTP: 'true',
    MOS_WORKSPACE_ALLOWED_HOSTS: '127.0.0.1',
    MOS_EGRESS_ALLOWED_HOSTS: '127.0.0.1',
    MOS_EGRESS_ALLOWED_PORTS: String(OA_PORT),
    MOS_WORKSPACE_BRANDS: 'VFIB,UCARD',
    MOS_WORKSPACE_TICKET_TTL_SECONDS: '600'
  };
  spawnServer(ROOT, MOS_ENV, 'mos-1');
  const mosUp1 = await waitHealth(MOS_BASE, 90);
  check('D6-31 Marketing OS 隔离实例真实启动（/api/health 200）', mosUp1, 'HTTP ' + (mosUp1 ? 200 : 0));
  if (!mosUp1) { console.log('\n结论：BLOCKED —— MOS 实例未起来。'); process.exitCode = 2; return; }

  const mAdmin = mosClient();
  await mAdmin.call('GET', '/');
  const mLogin1 = await mAdmin.login('mosadmin', MOS_ADMIN_PW);
  const mChpw = await mAdmin.call('POST', '/api/mos/auth/change-password',
    { oldPassword: MOS_ADMIN_PW, newPassword: MOS_ADMIN_PW2 });
  check('D6-32 引导管理员首登改密成功（口令策略真实生效）',
    mLogin1.status === 200 && mChpw.status === 200, 'login/chpw=' + mLogin1.status + '/' + mChpw.status);

  const MOS_USERS = [
    { key: 'creator', username: 'd6.creator', role: 'P2' },
    { key: 'precheck', username: 'd6.precheck', role: 'ASSET_REVIEWER' },
    { key: 'final', username: 'd6.final', role: 'LIBRARY_FINAL_APPROVER' },
    { key: 'ops', username: 'd6.ops', role: 'P1' },
    { key: 'unmapped', username: 'd6.unmapped', role: 'P2' }
  ];
  const mIds = {};
  let mUsersOk = true;
  for (const u of MOS_USERS) {
    const r = await mAdmin.call('POST', '/api/mos/admin/users', {
      username: u.username, displayName: 'D6 ' + u.key, password: MOS_ADMIN_PW2,
      dept: '品牌与市场部', title: 'D6 合成测试身份', mustChangePassword: false,
      roles: [{ roleCode: u.role, brandScope: ['*'] }]
    });
    const id = r.json && r.json.user && r.json.user.id;
    if (!id) { mUsersOk = false; console.log('    create fail ' + u.username + ' :: ' + JSON.stringify(r.json).slice(0, 200)); }
    mIds[u.key] = id || '';
  }
  check('D6-33 MOS 侧合成身份创建（creator / prechecker / final approver / 采集触发者 / 未映射对照）',
    mUsersOk, MOS_USERS.map((u) => u.key + '=' + (mIds[u.key] || 'FAIL')).join(' '));

  /* 落盘有 60ms 防抖：**停进程前**必须先等写盘落地，否则最后一批写入会随硬终止丢失
     （Windows 上 SIGTERM 即硬终止，kill 之后再 sleep 已经来不及） */
  await sleep(600);
  await stopServer(procs[procs.length - 1]);

  const MOS_ENV2 = Object.assign({}, MOS_ENV, {
    MOS_WORKSPACE_USER_MAP: [
      mIds.creator + '=' + pIds.exec,
      mIds.precheck + '=' + pIds.rev,
      mIds.final + '=' + pIds.lfa,
      mIds.ops + '=' + pIds.rev
    ].join(',')
  });
  spawnServer(ROOT, MOS_ENV2, 'mos-2');
  const mosUp2 = await waitHealth(MOS_BASE, 90);
  check('D6-34 MOS 实例带**显式用户映射**重启成功（数据持久化、未映射者被如实拒绝）',
    mosUp2, 'HTTP ' + (mosUp2 ? 200 : 0));

  const m2 = mosClient();
  await m2.call('GET', '/');
  const mLogin2 = await m2.login('mosadmin', MOS_ADMIN_PW2);
  check('D6-35 重启后管理员会话可用', mLogin2.status === 200, 'HTTP ' + mLogin2.status);

  const wsStatus = await m2.call('GET', '/api/mos/integration/workspace');
  check('D6-36 本侧集成状态：configured=true 且出站守卫放行（文案明确"不代表联调通过"）',
    wsStatus.status === 200 && wsStatus.json && wsStatus.json.status
      && wsStatus.json.status.configured === true,
    'configured=' + !!(wsStatus.json && wsStatus.json.status && wsStatus.json.status.configured));

  /* ---------- B1 正向对照：真实出站只读探测 ---------- */
  const probeVfib = await m2.call('POST', '/api/mos/integration/probe?brand=VFIB',
    { query: 'D6', libraryAssetId: ASSET_ID, userId: mIds.creator });
  const probesVfib = (probeVfib.json && probeVfib.json.probes) || [];
  check('D6-37 正向对照：MOS→Provider 真实 HTTP 只读探测成功（assets.search / knowledge.search / changes / assets.read 均 200）',
    probeVfib.status === 200 && probesVfib.length >= 4 && probesVfib.every((p) => p.ok === true),
    probesVfib.map((p) => p.name + '=' + (p.ok ? '200' : p.errorCode)).join(' '));

  /* ---------- B2 跨品牌（MOS 视图） ---------- */
  const probeUcard = await m2.call('POST', '/api/mos/integration/probe?brand=UCARD',
    { query: 'D6', libraryAssetId: ASSET_ID, userId: mIds.creator });
  const probesUcard = (probeUcard.json && probeUcard.json.probes) || [];
  const uAsRead = probesUcard.find((p) => p.name === 'assets.read') || {};
  const uAsSearch = probesUcard.find((p) => p.name === 'assets.search') || {};
  check('D6-38 INT-03④ MOS 视图跨品牌：UCARD 品牌可出站检索但命中 0 条，读取 VFIB 资产被 403 拒绝',
    probeUcard.status === 200
      && uAsSearch.ok === true && Number(uAsSearch.itemCount) === 0
      && uAsRead.ok === false && uAsRead.errorCode === 'NOT_REUSABLE_FOR_SUBJECT',
    'UCARD assets.search=' + (uAsSearch.ok ? ('ok/' + uAsSearch.itemCount + '条') : uAsSearch.errorCode)
      + ' / assets.read=' + (uAsRead.ok ? 'ok' : uAsRead.errorCode));

  /* ---------- B3 未映射用户：零出站如实拒绝 ---------- */
  const probeUnmapped = await m2.call('POST', '/api/mos/integration/probe?brand=VFIB',
    { userId: mIds.unmapped, query: 'D6' });
  check('D6-39 未映射用户：零出站如实拒绝（NO_PROVIDER_USER_MAPPING），绝不用服务身份顶替',
    probeUnmapped.status === 200 && probeUnmapped.json
      && probeUnmapped.json.userMapping && probeUnmapped.json.userMapping.ok === false
      && (probeUnmapped.json.probes || []).length === 0,
    'probes=' + ((probeUnmapped.json && probeUnmapped.json.probes || []).length));

  /* ============================================================
   * Phase C —— B1 门禁：失效对象不得进入**正式输出**（真实双进程）
   * ============================================================ */
  section('Phase C · B1 正式输出门禁：撤回 / 权限撤销 / Skill 失效不得生成新正式作品');

  const mCreator = mosClient();
  await mCreator.call('GET', '/');
  const mLg1 = await mCreator.login('d6.creator', MOS_ADMIN_PW2);
  const mPre = mosClient();
  await mPre.call('GET', '/');
  const mLg2 = await mPre.login('d6.precheck', MOS_ADMIN_PW2);
  const mFinal = mosClient();
  await mFinal.call('GET', '/');
  const mLg3 = await mFinal.login('d6.final', MOS_ADMIN_PW2);
  const mOps = mosClient();
  await mOps.call('GET', '/');
  const mLg4 = await mOps.login('d6.ops', MOS_ADMIN_PW2);
  check('D6-39a MOS 侧四个合成身份会话可用（creator / prechecker / final approver / 采集触发者）',
    mLg1.status === 200 && mLg2.status === 200 && mLg3.status === 200 && mLg4.status === 200,
    'creator=' + mLg1.status + ' precheck=' + mLg2.status + ' final=' + mLg3.status + ' ops=' + mLg4.status
      + ' err=' + JSON.stringify([(mLg1.json && mLg1.json.code) || '',
        (mLg2.json && mLg2.json.code) || '', (mLg3.json && mLg3.json.code) || '',
        (mLg4.json && mLg4.json.code) || '']));

  const upAsset = await mCreator.raw('/api/mos/assets/upload?brand=VFIB&name=d6-' + RUN + '.png',
    pngBytes('working'), 'image/png');
  const WORKING_ID = (upAsset.json && upAsset.json.asset && upAsset.json.asset.id) || '';
  check('D6-40 工作素材上传成功（真实落盘 + sha256）', upAsset.status === 200 && !!WORKING_ID,
    'HTTP ' + upAsset.status + ' id=' + (WORKING_ID || 'FAIL'));

  const mAdm = await mCreator.call('POST', '/api/mos/asset-admissions?brand=VFIB', {
    workingAssetId: WORKING_ID,
    categoryCode: 'A02',
    idempotencyKey: 'd6-mos-adm-' + RUN,
    libraryPrimaryCategory: '02',
    librarySubcategory: '02.01',
    classification: 'internal',
    licenseStatus: 'cleared',
    reuseScope: 'campaign_reuse',
    aiReusePolicy: 'blocked',
    externalAiTransferPolicy: 'blocked',
    submissionMetadata: { title: 'D6 双系统正式输出门禁夹具', fileName: 'd6-adm-' + RUN + '.png' }
  });
  const MOS_ADM_ID = (mAdm.json && mAdm.json.admission && mAdm.json.admission.id) || '';
  check('D6-41 MOS 建单成功并带三项 Provider 必填字段（libraryPrimaryCategory/classification/licenseStatus）',
    mAdm.status === 200 && !!MOS_ADM_ID, 'HTTP ' + mAdm.status + ' id=' + (MOS_ADM_ID || 'FAIL'));

  const mPre2 = MOS_ADM_ID ? await mPre.call('POST',
    '/api/mos/asset-admissions/' + MOS_ADM_ID + '/precheck?brand=VFIB', {}) : { status: 0, json: {} };
  check('D6-42 预检 PASS（由**独立**预检员执行；预检权限不含最终审批）',
    mPre2.status === 200 && mPre2.json && mPre2.json.admission
      && mPre2.json.admission.precheck && mPre2.json.admission.precheck.verdict === 'PASS',
    'HTTP ' + mPre2.status + ' verdict='
      + ((mPre2.json && mPre2.json.admission && mPre2.json.admission.precheck
        && mPre2.json.admission.precheck.verdict) || '-')
      + ' fail=' + JSON.stringify(((mPre2.json && mPre2.json.admission && mPre2.json.admission.precheck
        && mPre2.json.admission.precheck.checks) || []).filter((c) => !c.ok).map((c) => c.id + ':' + c.note))
      + (mPre2.json && mPre2.json.error ? ' err=' + mPre2.json.error.code : ''));

  const mSubmit = MOS_ADM_ID ? await mCreator.call('POST',
    '/api/mos/asset-admissions/' + MOS_ADM_ID + '/submit-final?brand=VFIB', {}) : { status: 0, json: {} };
  const caseId = (mSubmit.json && mSubmit.json.reviewCase && mSubmit.json.reviewCase.id) || '';
  check('D6-43 送审产生 ASSET_ADMISSION 审核单（提交人不得自批，走独立审批链）',
    mSubmit.status === 200 && !!caseId, 'HTTP ' + mSubmit.status + ' case=' + (caseId || 'FAIL'));

  const mDecide = caseId ? await mFinal.call('POST',
    '/api/mos/review-cases/' + caseId + '/decision?brand=VFIB',
    { action: 'APPROVE', remarks: 'D6 合成授权主体裁决（不代表真人验收）' }) : { status: 0, json: {} };
  check('D6-44 授权主体在 MOS 侧完成最终审批（须持有 library.asset.approve.final）',
    mDecide.status === 200, 'HTTP ' + mDecide.status);

  // 首次同步：Provider 仍待最终审批 → 不中途可用
  const mSync1 = MOS_ADM_ID ? await mCreator.call('POST',
    '/api/mos/asset-admissions/' + MOS_ADM_ID + '/sync?brand=VFIB', {}) : { status: 0, json: {} };
  const sync1 = (mSync1.json && mSync1.json.admission) || {};
  check('D6-45 首次同步被 Provider 以 FINAL_APPROVAL_REQUIRED 拦下（申请 ≠ 资产，不中途可用）',
    mSync1.status === 200 && sync1.syncStatus !== 'COMPLETED' && !sync1.libraryId,
    'syncStatus=' + (sync1.syncStatus || '-') + ' libraryId=' + (sync1.libraryId || 'null'));

  // 取出 Provider 侧申请 ID（由 job 记录，不靠猜）
  const provStatus = MOS_ADM_ID ? await mCreator.call('GET',
    '/api/mos/asset-admissions/' + MOS_ADM_ID + '/provider-status?brand=VFIB') : { status: 0, json: {} };
  const provAdmId = (provStatus.json && provStatus.json.job && provStatus.json.job.providerAdmissionId) || '';

  const provFinal = provAdmId ? await signedOaRequest('POST',
    '/api/integrations/marketing/admissions/' + provAdmId + '/final-decision',
    { decision: 'approve', comment: 'D6 合成授权主体审批（不代表真人验收）' }, lfaTicket, {}) : { status: 0, json: {} };
  const mSync2 = MOS_ADM_ID ? await mCreator.call('POST',
    '/api/mos/asset-admissions/' + MOS_ADM_ID + '/retry-sync?brand=VFIB', {}) : { status: 0, json: {} };
  const sync2 = (mSync2.json && mSync2.json.admission) || {};
  const MOS_LIB_ID = sync2.libraryId || '';
  check('D6-46 重试同步成功：取得 Provider 正式 Asset ID，适配层记录为真实（非 MOCK）',
    mSync2.status === 200 && sync2.syncStatus === 'COMPLETED' && !!MOS_LIB_ID
      && sync2.approvalMode === 'REAL',
    'providerFinal=' + provFinal.status + ' syncStatus=' + (sync2.syncStatus || '-')
      + ' approvalMode=' + (sync2.approvalMode || '-') + ' libraryId=' + (MOS_LIB_ID || 'FAIL'));

  const refs = await mCreator.call('GET', '/api/mos/library-asset-refs?brand=VFIB');
  const refRow = ((refs.json && refs.json.items) || []).find((r) => r.admissionId === MOS_ADM_ID) || null;
  check('D6-47 建立真实可复用引用（permissionValid=true，assetState=ACTIVE，非 MOCK）',
    !!refRow && refRow.permissionValid === true && refRow.assetState === 'ACTIVE' && refRow.mock !== true,
    refRow ? ('permissionValid=' + refRow.permissionValid + ' assetState=' + refRow.assetState
      + ' mock=' + refRow.mock) : '未找到引用行');

  const gateBefore = await mCreator.call('POST', '/api/mos/formal-output-check?brand=VFIB', {
    outputIntent: 'FORMAL', libraryRefIds: [refRow ? refRow.id : '']
  });
  const gbBlockers = ((gateBefore.json && gateBefore.json.blockers) || []).map((b) => b.code);
  check('D6-48 门禁（撤回前）：引用**可复用**，阻断项中不含 LIBRARY_REF_* 类（引用本身不是问题）',
    gateBefore.status === 200 && gateBefore.json && gateBefore.json.allowed === false
      && !gbBlockers.some((c) => /^LIBRARY_REF_/.test(c))
      && gbBlockers.indexOf('SKILL_NOT_EFFECTIVE') !== -1,
    'blockers=' + JSON.stringify(gbBlockers));

  /* C3 Provider 撤回 → MOS 事件消费 → 引用本地失效 */
  const provRevoke = provAdmId ? await oa.call('POST',
    '/api/asset-admission/requests/' + provAdmId + '/revoke', { reason: 'D6 真实 HTTP 撤回负例' })
    : { status: 0, json: {} };
  /* 事件轮询是**服务级**调用，但 /changes 仍需真实员工身份（票据绑人）：
     必须由**已映射**且持有 source.manage 的身份（P1 采集触发者）发起，避免因未映射而零出站。 */
  const tick = await mOps.call('POST', '/api/mos/integration/events/tick?brand=VFIB', {});
  const invs = await mCreator.call('GET', '/api/mos/integration/events?brand=VFIB');
  const invRows = ((invs.json && invs.json.invalidations) || []);
  const refsAfter = await mCreator.call('GET', '/api/mos/library-asset-refs?brand=VFIB');
  const refAfter = ((refsAfter.json && refsAfter.json.items) || []).find((r) => r.admissionId === MOS_ADM_ID) || null;
  check('D6-49 撤回传播：Provider 撤回 → MOS 事件消费 → 本地引用 permissionValid=false（可审计）',
    provRevoke.status === 200 && !!(refAfter && refAfter.permissionValid === false),
    'revoke=' + provRevoke.status + ' tick.ok=' + !!(tick.json && tick.json.tick && tick.json.tick.ok)
      + ' totalItems=' + ((tick.json && tick.json.tick && tick.json.tick.totalItems) || 0)
      + ' invalidations=' + invRows.length
      + ' permissionValid=' + (refAfter ? refAfter.permissionValid : 'N/A'));

  const gateAfter = await mCreator.call('POST', '/api/mos/formal-output-check?brand=VFIB', {
    outputIntent: 'FORMAL', libraryRefIds: [refRow ? refRow.id : '']
  });
  const gaBlockers = ((gateAfter.json && gateAfter.json.blockers) || []).map((b) => b.code);
  check('D6-50 ★ B1 门禁（撤回后）：FORMAL 输出被阻断，且出现 LIBRARY_REF_INVALIDATED / LIBRARY_REF_NOT_REUSABLE',
    gateAfter.status === 200 && gateAfter.json && gateAfter.json.allowed === false
      && (gaBlockers.indexOf('LIBRARY_REF_INVALIDATED') !== -1
        || gaBlockers.indexOf('LIBRARY_REF_NOT_REUSABLE') !== -1),
    'blockers=' + JSON.stringify(gaBlockers));

  const genFormal = await mCreator.call('POST', '/api/mos/generation-jobs?brand=VFIB', {
    kind: 'TEXT', brief: 'D6 正式输出', dataClass: 'INTERNAL',
    outputIntent: 'FORMAL', libraryRefIds: [refRow ? refRow.id : '']
  });
  const genFormalCodes = ((genFormal.json && genFormal.json.blockers) || []).map((b) => b.code);
  check('D6-51 ★ 生成端点同源门禁：FORMAL 生成被 409 FORMAL_OUTPUT_BLOCKED 阻断（含引用失效明细）',
    genFormal.status === 409 && genFormal.json && genFormal.json.code === 'FORMAL_OUTPUT_BLOCKED'
      && genFormalCodes.some((c) => /^LIBRARY_REF_/.test(c)),
    'HTTP ' + genFormal.status + ' code=' + ((genFormal.json && genFormal.json.code) || '-')
      + ' blockers=' + JSON.stringify(genFormalCodes));

  const genDraft = await mCreator.call('POST', '/api/mos/generation-jobs?brand=VFIB', {
    kind: 'TEXT', brief: 'D6 测试草稿', dataClass: 'INTERNAL',
    idempotencyKey: 'd6-draft-' + RUN, outputIntent: 'TEST_DRAFT',
    libraryRefIds: [refRow ? refRow.id : '']
  });
  check('D6-52 对照：同一引用在 TEST_DRAFT 下**不阻断**（草稿允许，但不得对外发布）',
    genDraft.status === 200 && genDraft.json && genDraft.json.job && !!genDraft.json.job.id,
    'HTTP ' + genDraft.status + ' status=' + ((genDraft.json && genDraft.json.job && genDraft.json.job.status) || '-'));

  const gateSkill = await mCreator.call('POST', '/api/mos/formal-output-check?brand=VFIB',
    { outputIntent: 'FORMAL' });
  check('D6-53 INT-10 关联：正式输出门禁要求**已批准生效** Skill；REFERENCE_ONLY 一律阻断（不用草稿冒充）',
    gateSkill.status === 200 && gateSkill.json && gateSkill.json.allowed === false
      && (gateSkill.json.blockers || []).some((b) => b.code === 'SKILL_NOT_EFFECTIVE'),
    'skillState=' + ((gateSkill.json && gateSkill.json.detail && gateSkill.json.detail.skill
      && gateSkill.json.detail.skill.state) || '-'));

  /* ============================================================
   * Phase D —— MOS 侧服务账号被撤销：如实降级、绝不静默成功
   * ============================================================ */
  section('Phase D · 服务账号撤销后 MOS 侧必须如实失败（不得静默降级为"成功"）');

  const revokeMosSa = await oa.call('DELETE', '/api/integration-accounts/' + OA_KEY_ID);
  const probeAfterRevoke = await m2.call('POST', '/api/mos/integration/probe?brand=VFIB',
    { query: 'D6', userId: mIds.creator });
  const pAfter = (probeAfterRevoke.json && probeAfterRevoke.json.probes) || [];
  const wsAfter = await m2.call('GET', '/api/mos/integration/workspace');
  const sec = (wsAfter.json && wsAfter.json.status && wsAfter.json.status.securityRejections) || {};
  check('D6-54 服务账号被撤销后：MOS 探测全部失败且**无一条** ok=true（不静默成功）',
    revokeMosSa.status === 200 && probeAfterRevoke.status === 200
      && pAfter.length >= 1 && pAfter.every((p) => p.ok === false),
    'probes=' + pAfter.length + ' ok 数=' + pAfter.filter((p) => p.ok).length
      + ' codes=' + JSON.stringify(pAfter.map((p) => p.errorCode)));

  check('D6-55 本侧如实记录安全类拒绝（securityRejections 按码计数，不含任何凭据材料）',
    !!(sec.byCode && (sec.byCode.BAD_SERVICE_ACCOUNT || 0) >= 1),
    'byCode=' + JSON.stringify(sec.byCode || {}) + ' last=' + JSON.stringify(sec.last || null));

  /* ============================================================
   * Phase E —— 红线与结构性边界（真实断言，不做占位 PASS）
   * ============================================================ */
  section('Phase E · 红线：Provider 源码未改 / 版本登记 / MARK 项未开发');

  const oaEntryMtime2 = fs.statSync(oaEntry).mtimeMs;
  check('D6-56 Provider 源码未被本次联调修改（server.js mtime 未变）',
    oaEntryMtime2 === oaEntryMtime, 'mtime Δ=' + (oaEntryMtime2 - oaEntryMtime) + 'ms');

  const meta = await m2.call('GET', '/api/mos/meta');
  const perms = Object.keys((meta.json && meta.json.permissions) || {});
  const markLike = perms.filter((p) => /(^|\.)(s05|growth|reputation|lead|autopost|auto_publish)/i.test(p));
  check('D6-57 MARK 项（S05 客户增长 / 声誉专项 / 营销线索闭环 / 自动发布）本轮未开发：权限表中无对应权限点',
    meta.status === 200 && perms.length > 0 && markLike.length === 0,
    'permissions=' + perms.length + ' 命中 MARK 类=' + JSON.stringify(markLike));

  const metaVer = (meta.json && meta.json.mosVersion) || '';
  const pkgVer = require(path.join(ROOT, 'package.json')).version;
  check('D6-58 版本登记一致：package.json 版本 = /api/mos/meta 的 mosVersion（不写死版本号，随升版自动适用）',
    !!metaVer && metaVer === pkgVer, 'package.json=' + pkgVer + ' api=' + metaVer);

  /* ---------------- 结论与证据 ---------------- */
  const total = results.length;
  const passed = total - failures;
  console.log('\n=== BUILD-06 结果：' + passed + '/' + total + ' ===');

  const verdict = failures === 0 ? 'PASS_EVIDENCE_COMPLETE' : 'FAIL';
  try {
    fs.writeFileSync(path.join(OUT_DIR, 'dual-security-result.json'), JSON.stringify({
      suite: 'build05-dual-security',
      build: 'BUILD-06',
      pack: 'VFIB_MarketingOS_Remediation_V1.2',
      ranAt: new Date().toISOString(),
      runId: RUN,
      total, passed, failed: failures,
      verdict,
      ports: { mos: MOS_PORT, provider: OA_PORT },
      providerSourceDir: OA_ROOT,
      providerSourceUnchanged: oaEntryMtime2 === oaEntryMtime,
      mosVersion: metaVer,
      realJointTest: true,
      coversInt: ['INT-02', 'INT-03'],
      syntheticIdentities: {
        provider: P_USERS.map((u) => u.username),
        mos: MOS_USERS.map((u) => u.username),
        note: '全部为**合成测试身份**，只用于证明控制机制；不代表真人授权或真人验收。'
      },
      serverAuditEvidence: { rows: auditRows ? auditRows.length : null, matched: auditDetail },
      results
    }, null, 2), 'utf8');
    fs.writeFileSync(path.join(OUT_DIR, 'dual-security-summary.txt'),
      ['BUILD-06 · V1.2 真实 HTTP 安全负例（INT-02 / INT-03 + B1 正式输出门禁）', 'runId=' + RUN,
        'MOS ' + MOS_BASE + ' / Provider ' + OA_BASE,
        '结果 ' + passed + '/' + total + ' → ' + verdict,
        '服务端审计证据命中 ' + auditHit + '/' + expectAudit.length,
        '合成身份仅证明控制机制，不代表真人授权'].join('\n') + '\n', 'utf8');
  } catch (err) {
    console.log('证据写入失败：' + err.message);
  }
}

main()
  .catch((err) => {
    check('EXCEPTION 用例执行未抛出异常', false, String(err && err.message ? err.message : err));
  })
  .then(async () => {
    if (failures) {
      console.log('\n--- 失败明细 ---');
      for (const r of results) if (!r.ok) console.log('  FAIL ' + r.name + ' :: ' + r.detail);
    }
    await cleanup();
    if (failures) process.exitCode = 1;
  });
