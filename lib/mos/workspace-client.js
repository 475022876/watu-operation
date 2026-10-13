'use strict';
/**
 * WorkspaceClient —— 企业资料库（Enterprise Workspace）**双重身份**调用客户端。
 *
 * 与 `adapters/workspace.js` 的分工：
 *   · `adapters/workspace.js`  —— **纯契约面**：签名、封套解析、12 个端点的逐一封装（无状态）。
 *   · 本文件                    —— **编排面**：票据生命周期、有界重试、出站收敛、脱敏、
 *                                 准入三步推送与失败补偿、缓存失效登记（有状态）。
 *
 * 来源：B 包 `01_CONSUMER_TASKS.md` B2/B3/B4 + C 包 `02_AUTH_EVENTS_ERRORS.md` +
 *       供应商 `SERVICE_AUTH_HANDOFF.md`（`PROVIDER_AUTH_SOURCE.md`）。
 *
 * ---- 不可妥协的四条 ----
 *  1. **服务身份 ≠ 最终批准身份。** 服务票据经 `serviceGrantable()` 永久剔除
 *     `admission.final.decision`，因此本客户端**结构性无法**代签最终审批（`finalDecision()`
 *     在适配器层恒拒绝）。服务端另有 `TICKET_ACCOUNT_MISMATCH` 兜底。
 *  2. **机密不进日志、不进浏览器、不落盘。** 票据密文只存在于**进程内存**；
 *     落盘的只有非机密元数据（keyId/品牌/用户/范围/签发与到期时间/状态），用于审计对账。
 *  3. **票据与签发它的服务账户绑定**（`SERVICE_AUTH_HANDOFF.md` §2.5）。
 *     缓存键含 keyId，**绝不**跨服务账户复用票据。
 *  4. **fail closed。** 未配置 → 零出站；网络不可用 → 拒绝新的权威授权调用，
 *     **绝不**静默沿用本地缓存的「上一次 Approved」结论。
 */
const crypto = require('node:crypto');
const { getMosConfig, isProductionMode } = require('./config');
const wc = require('./workspace-contract');
const adapter = require('./adapters/workspace');

/**
 * 解析「MOS 用户 → 资料库真实用户」（B2/B4 共用的事实来源）。
 *
 * 顺序：`workspace.userMap[mosUserId]` → `workspace.serviceUserId` 兜底 → **如实拒绝**。
 * 绝不猜测、绝不用服务账户身份顶替真实员工（契约要求票据承载**真实员工**）。
 *
 * @returns {{ok:boolean, userId:string, source:string, note?:string}}
 */
function resolveProviderUser(mosUserId) {
  const w = cfg();
  const map = w.userMap || {};
  const mapped = map[String(mosUserId || '')];
  if (mapped) return { ok: true, userId: String(mapped), source: 'userMap' };
  if (w.serviceUserId) return { ok: true, userId: String(w.serviceUserId), source: 'serviceUserId' };
  return { ok: false, userId: '', source: '',
    note: '未配置「MOS 用户 → 资料库真实用户」映射（workspace.userMap / workspace.serviceUserId）。'
      + 'Provider 要求票据承载**真实员工**身份，本侧拒绝用服务身份替代用户身份。' };
}

/* ==================== 出站收敛（SSRF 面） ==================== */

const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost', '[::1]'];

function parseBaseUrl(baseUrl) {
  try { const u = new URL(String(baseUrl)); return { ok: true, u, host: u.hostname.toLowerCase(), protocol: u.protocol.replace(':', '') }; }
  catch (_) { return { ok: false, host: '', protocol: '', u: null }; }
}

/**
 * 出站守卫。**baseUrl 属运维配置**（不接受用户输入），但仍做一次收敛：
 *   · 主机必须命中 `workspace.allowedHosts`；或
 *   · 主机为回环且**显式**开启 `allowLoopbackHttp`，且**非生产模式**。
 * 生产模式下回环明文一律拒绝（可被自检断言）。
 */
function egressGuard() {
  const w = (getMosConfig().workspace || {});
  const p = parseBaseUrl(w.baseUrl);
  const allowed = (w.allowedHosts || []).map((h) => String(h).toLowerCase());
  const isLoopback = LOOPBACK_HOSTS.indexOf(p.host) !== -1;
  const prod = isProductionMode();

  if (!p.ok) return { ok: false, reason: 'baseUrl 无法解析', host: '', protocol: '' };
  if (p.protocol === 'http' && !isLoopback) {
    return { ok: false, reason: '非回环主机必须使用 https（集成接口不得明文出网）', host: p.host, protocol: p.protocol };
  }
  if (isLoopback && p.protocol === 'http') {
    if (prod) return { ok: false, reason: '生产模式禁止回环明文 HTTP（MOS_WORKSPACE_ALLOW_LOOPBACK_HTTP 在生产失效）', host: p.host, protocol: p.protocol };
    if (w.allowLoopbackHttp !== true) {
      return { ok: false, reason: '未显式开启 allowLoopbackHttp，拒绝回环明文出站（默认 fail closed）', host: p.host, protocol: p.protocol };
    }
    return { ok: true, reason: '回环明文（仅隔离测试）', host: p.host, protocol: p.protocol, loopback: true };
  }
  if (allowed.indexOf(p.host) === -1) {
    return { ok: false, reason: '主机不在 workspace.allowedHosts 白名单内（留空=一律拒绝）', host: p.host, protocol: p.protocol };
  }
  return { ok: true, reason: '主机在白名单内', host: p.host, protocol: p.protocol };
}

/* ==================== 脱敏 ==================== */

const SECRET_KEY_RE = /^(ticket|x-vfib-ticket|x-vfib-signature|authorization|cookie|set-cookie|privateKey|privateKeyPem|signingKey|password|apiKey|contentBase64)$/i;
/** 递归脱敏：任何看起来像凭据的值一律替换。用于审计与交付证据。 */
function redact(value, depth) {
  const d = depth || 0;
  if (d > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((x) => redact(x, d + 1));
  const out = {};
  for (const k of Object.keys(value)) {
    const v = value[k];
    if (SECRET_KEY_RE.test(k)) { out[k] = v ? 'REDACTED' : ''; continue; }
    if (typeof v === 'string' && /^[A-Za-z0-9_-]{40,}\.[A-Za-z0-9_-]{20,}$/.test(v)) { out[k] = 'REDACTED_TICKET'; continue; }
    out[k] = redact(v, d + 1);
  }
  return out;
}

/** 审计元数据：只允许非机密字段进入 */
function auditMeta(o) {
  return redact(o || {}, 0);
}

/* ==================== V1.2 / B1：服务身份与授权类拒绝的可观测性 ====================
 *
 * 为什么需要它：
 *   V1.2 B1 要求「双进程真实 HTTP 分别实测：过期签名、nonce 重放、服务账号撤销；
 *   跨品牌/高密级数据拒绝」，并要求给出**服务端审计证据**。
 *   Provider 侧的证据来自其 `integration-call` 审计行（可由 Provider 运维读取）；
 *   本侧同样必须能回答「上一个被拒的请求是什么码、什么时候、哪个端点」——
 *   否则运维只能看到一句模糊的「调用失败」，无法区分「配置错误」与「被 Provider 正确拒绝」。
 *
 * 诚实性边界：
 *   · 只统计**拒绝类**码（身份/票据/品牌/范围/限流），不统计业务码；
 *   · 只保留计数 + 最后一个事件的非机密字段，**不含票据密文、不含任何签名材料**；
 *   · 计数是**进程内**的，重启清零 —— 如实标注，不伪造历史。
 */
const SECURITY_REJECTION_CODES = [
  'MISSING_SIGNATURE', 'BAD_SIGNATURE', 'BAD_SIGNATURE_FORMAT', 'BAD_TIMESTAMP',
  'TIMESTAMP_OUT_OF_WINDOW', 'NONCE_REPLAY', 'BAD_SERVICE_ACCOUNT', 'ACCOUNT_KEY_UNUSABLE',
  'INTEGRATION_DISABLED', 'NO_SERVICE_ACCOUNT', 'SERVICE_SCOPE_NOT_GRANTED', 'SCOPE_NOT_GRANTED',
  'BRAND_NOT_ALLOWED', 'BRAND_MISMATCH', 'TICKET_MISSING', 'TICKET_MALFORMED',
  'TICKET_BAD_SIGNATURE', 'TICKET_BAD_PAYLOAD', 'TICKET_BAD_VERSION', 'TICKET_EXPIRED',
  'TICKET_NO_USER', 'TICKET_NO_BRAND', 'TICKET_KIND_MISMATCH', 'TICKET_ACCOUNT_MISMATCH',
  'TICKET_USER_INACTIVE', 'RATE_LIMITED', 'USER_NOT_FOUND', 'NO_PROVIDER_USER_MAPPING'
];

const securityOutcomes = { total: 0, byCode: {}, last: null };

/** 记录一次拒绝类结果（非拒绝类直接忽略） */
function noteSecurityOutcome(result) {
  if (!result) return;
  const code = String(result.errorCode || '');
  if (!code || SECURITY_REJECTION_CODES.indexOf(code) === -1) return;
  securityOutcomes.total += 1;
  securityOutcomes.byCode[code] = (securityOutcomes.byCode[code] || 0) + 1;
  securityOutcomes.last = {
    code,
    httpStatus: Number(result.httpStatus || 0),
    endpoint: String(result.endpoint || result.label || ''),
    requestId: String(result.requestId || result.requestIdHeader || ''),
    at: new Date().toISOString()
  };
}

/** 拒绝类统计快照（进程内） */
function securityStatus() {
  return {
    total: securityOutcomes.total,
    byCode: Object.assign({}, securityOutcomes.byCode),
    last: securityOutcomes.last ? Object.assign({}, securityOutcomes.last) : null,
    scope: 'process-local（重启清零；不含任何凭据材料）'
  };
}

/* ==================== 票据缓存（密文只在内存） ==================== */

/** Map<ticketKey, {ticket, keyId, brandId, userId, scopes, issuedAt, expiresAt, purpose}> */
const TICKET_SECRETS = new Map();
/** Map<ticketKey, Promise> —— 并发刷新单飞 */
const INFLIGHT = new Map();

function ticketKey(keyId, userId, brandId) {
  return [keyId, brandId, userId].join('|');
}

function scopeSignature(scopes) {
  return (scopes || []).map(String).slice().sort().join(',');
}

/** 落盘的**非机密**票据元数据（供审计对账；不含票据密文） */
function metaStore() {
  const store = require('./store');
  const db = store.getDb();
  if (!Array.isArray(db.library_tickets)) db.library_tickets = [];
  return { store, db, rows: db.library_tickets };
}

function upsertTicketMeta(rec) {
  const { db, rows, store } = metaStore();
  const i = rows.findIndex((r) => r.ticketKey === rec.ticketKey);
  if (i === -1) rows.push(rec); else rows[i] = Object.assign(rows[i], rec);
  if (rows.length > 200) rows.splice(0, rows.length - 200);
  store.save();
  return rec;
}

function markTicketMeta(ticketKeyStr, patch) {
  const { rows, store } = metaStore();
  const r = rows.find((x) => x.ticketKey === ticketKeyStr);
  if (r) { Object.assign(r, patch); store.save(); }
  return r || null;
}

/** 读取缓存票据（含「剩余有效期是否足够」判定） */
function cachedTicket(keyId, userId, brandId) {
  const k = ticketKey(keyId, userId, brandId);
  const rec = TICKET_SECRETS.get(k);
  if (!rec) return null;
  const w = getMosConfig().workspace || {};
  const skew = Number(w.ticketRefreshSkewSeconds || 60);
  const remain = (new Date(rec.expiresAt).getTime() - Date.now()) / 1000;
  return Object.assign({}, rec, { remainingSeconds: Math.round(remain), usable: remain > skew });
}

/** 使某票据失效（撤销 / 401 回退） */
function dropTicket(keyId, userId, brandId, reason) {
  const k = ticketKey(keyId, userId, brandId);
  const had = TICKET_SECRETS.delete(k);
  markTicketMeta(k, { status: 'DROPPED', droppedAt: new Date().toISOString(), dropReason: String(reason || '').slice(0, 200) });
  return had;
}

function dropAllTickets(reason) {
  const n = TICKET_SECRETS.size;
  TICKET_SECRETS.clear();
  const { rows, store } = metaStore();
  for (const r of rows) { r.status = 'DROPPED'; r.dropReason = String(reason || '').slice(0, 200); }
  void store;
  return n;
}

/* ==================== 配置与状态 ==================== */

function cfg() {
  return getMosConfig().workspace || {};
}

/** 已配置（enabled + baseUrl + keyId + 私钥 + 出站守卫通过） */
function isConfigured() {
  const a = adapter.status();
  if (!a.configured) return false;
  return egressGuard().ok === true;
}

function status() {
  const a = adapter.status();
  const g = egressGuard();
  const w = cfg();
  const { rows } = metaStore();
  return {
    provider: 'mos.workspace.client',
    configured: isConfigured(),
    adapterConfigured: a.configured,
    egress: { ok: g.ok, reason: g.reason, host: g.host, protocol: g.protocol },
    baseUrlHost: a.baseUrlHost,
    hasKeyId: a.hasKeyId,
    hasPrivateKey: a.hasPrivateKey,
    contractVersion: wc.CONTRACT_VERSION,
    workspaceAppVersion: wc.WORKSPACE_APP_VERSION,
    openapiSha256: wc.OPENAPI_SHA256,
    brands: (w.brands || []).slice(),
    ticketScopes: (w.ticketScopes || []).slice(),
    pollEnabled: w.pollEnabled === true,
    pollIntervalSeconds: Number(w.pollIntervalSeconds || 60),
    retry: Object.assign({}, w.retry || {}),
    /** 票据只报数量与到期时间，**绝不回传密文** */
    ticketCache: {
      liveCount: TICKET_SECRETS.size,
      metaRows: rows.length,
      entries: rows.slice(-10).map((r) => ({
        ticketKey: r.ticketKey, brandId: r.brandId, userId: r.userId,
        scopes: (r.scopes || []).slice(), issuedAt: r.issuedAt, expiresAt: r.expiresAt,
        status: r.status, refreshCount: r.refreshCount || 0
      }))
    },
    finalDecisionByServiceAccount: false,
    /** V1.2 / B1：服务身份与授权类拒绝的进程内统计（真实 HTTP 负例的运维面证据） */
    securityRejections: securityStatus(),
    note: isConfigured()
      ? '已配置并可通过出站守卫。**未声称联调成功** —— 是否可用以真实 /health 探测与端到端测试为准。'
      : '未配置或未通过出站守卫 → 一律零出站、fail closed。'
  };
}

/* ==================== 票据签发 / 刷新 / 撤销 ==================== */

/**
 * 确保拿到一枚可用票据（缓存优先；过期或临期则刷新）。
 *
 * 并发语义：同一 (keyId,brand,user) 同时刷新时**只发一次**出站（单飞），
 * 其余调用等待同一 Promise —— 避免「并发刷新」把服务端 nonce/origin 打乱。
 */
async function ensureTicket(input) {
  const o = input || {};
  const w = cfg();
  if (!isConfigured()) {
    const a = adapter.status();
    return {
      ok: false, errorCode: 'INTEGRATION_NOT_CONFIGURED', retryable: false, ticket: '',
      note: a.configured ? ('出站守卫拒绝：' + egressGuard().reason) : '企业资料库集成未配置（零出站）。'
    };
  }
  const a = adapter.status();
  const keyId = String(getMosConfig().workspace.keyId || '');
  const brandId = String(o.brandId || '');
  const userId = String(o.userId || '');
  if (!brandId) return { ok: false, errorCode: 'MISSING_BRAND', retryable: false, ticket: '', note: '缺少品牌上下文' };
  if (!userId) return { ok: false, errorCode: 'MISSING_USER', retryable: false, ticket: '', note: '缺少真实用户（服务账户不能替代用户身份）' };
  if (Array.isArray(w.brands) && w.brands.length && w.brands.indexOf(brandId) === -1) {
    return { ok: false, errorCode: 'BRAND_NOT_ALLOWED', retryable: false, ticket: '',
      note: '品牌 ' + brandId + ' 不在 workspace.brands 白名单内（本侧主动拒绝，未出站）' };
  }
  void a;

  const cached = cachedTicket(keyId, userId, brandId);
  if (cached && cached.usable && o.force !== true) {
    return { ok: true, ticket: cached.ticket, cached: true, refreshed: false, expiresAt: cached.expiresAt,
      remainingSeconds: cached.remainingSeconds, scopes: cached.scopes.slice(), note: '命中内存票据缓存' };
  }

  const k = ticketKey(keyId, userId, brandId);
  if (INFLIGHT.has(k)) {
    const shared = await INFLIGHT.get(k);
    return Object.assign({}, shared, { coalesced: true, note: (shared.note || '') + '（并发刷新已合流）' });
  }

  const p = (async () => {
    const scopes = Array.isArray(o.scopes) && o.scopes.length ? o.scopes : (w.ticketScopes || []);
    const grantable = wc.serviceGrantable(scopes);
    const stripped = scopes.filter((s) => grantable.indexOf(s) === -1);
    const r = await adapter.issueServiceTicket({
      userId, brandId, purpose: o.purpose || 'mos-integration', scopes: grantable
    });
    if (!r.ok) {
      markTicketMeta(k, { status: 'ISSUE_FAILED', lastError: r.errorCode || '', at: new Date().toISOString() });
      return { ok: false, errorCode: r.errorCode || 'TICKET_ISSUE_FAILED', retryable: !!r.retryable,
        httpStatus: r.httpStatus, ticket: '', strippedScopes: stripped,
        note: '换取票据失败：' + (r.errorCode || '') + ' ' + (r.errorMessage || '') };
    }
    const data = r.data || {};
    const ticket = String(data.ticket || '');
    const expiresAt = data.expiresAt ? new Date(data.expiresAt).toISOString()
      : new Date(Date.now() + Number(w.ticketTtlSeconds || 300) * 1000).toISOString();
    const grantedScopes = Array.isArray(data.scopes) ? data.scopes.map(String) : grantable;
    TICKET_SECRETS.set(k, {
      ticket, keyId, brandId, userId, scopes: grantedScopes,
      issuedAt: new Date().toISOString(), expiresAt, purpose: String(o.purpose || '').slice(0, 200)
    });
    const prev = (metaStore().rows.find((x) => x.ticketKey === k) || {}).refreshCount || 0;
    upsertTicketMeta({
      ticketKey: k, keyId, brandId, userId, scopes: grantedScopes,
      issuedAt: new Date().toISOString(), expiresAt, status: 'ACTIVE',
      purpose: String(o.purpose || '').slice(0, 200), refreshCount: prev + 1,
      strippedScopes: stripped, note: String(data.note || '').slice(0, 200)
    });
    return { ok: true, ticket, cached: false, refreshed: true, expiresAt,
      remainingSeconds: Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000),
      scopes: grantedScopes, strippedScopes: stripped, note: '已由服务账户为真实用户换取受限票据' };
  })();

  INFLIGHT.set(k, p);
  try { return await p; } finally { INFLIGHT.delete(k); }
}

/* ==================== 有界重试 ==================== */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 判定一个结果是否可重试（依赖契约错误码表；未识别码**默认不可重试**，fail safe） */
function classify(result) {
  if (!result) return { retryable: false, layer: 'unknown', code: '' };
  const code = String(result.errorCode || '');
  const meta = wc.ERROR_CODES[code];
  if (result.httpStatus === 0) return { retryable: true, layer: 'transport', code: code || 'NETWORK' };
  if (meta) return { retryable: !!meta.retryable, layer: meta.layer, code };
  // 未在契约表中出现：宁可少重试（fail safe），也不做无界重试
  if (result.httpStatus === 429) return { retryable: true, layer: 'service', code: code || 'RATE_LIMITED' };
  if (result.httpStatus >= 500) return { retryable: true, layer: 'service', code: code || 'HTTP_' + result.httpStatus };
  return { retryable: false, layer: 'unknown', code: code || 'HTTP_' + result.httpStatus };
}

/** 有界指数退避（每次尝试都重新签名并换 nonce —— 契约 §1.3 第 4 点） */
async function withRetry(label, fn) {
  const w = cfg();
  const r = w.retry || {};
  const maxAttempts = Math.max(1, Number(r.maxAttempts || 3));
  const base = Math.max(10, Number(r.baseDelayMs || 300));
  const cap = Math.max(base, Number(r.capDelayMs || 4000));
  const attempts = [];
  let last = null;
  for (let i = 1; i <= maxAttempts; i += 1) {
    last = await fn(i);
    const cls = classify(last);
    attempts.push({ attempt: i, httpStatus: last && last.httpStatus, code: cls.code, retryable: cls.retryable });
    if (last && last.ok) return Object.assign({}, last, { attempts, attemptsUsed: i, label });
    if (!cls.retryable) return Object.assign({}, last, { attempts, attemptsUsed: i, label, exhausted: false, notRetryable: true });
    if (i < maxAttempts) await sleep(Math.min(cap, base * Math.pow(2, i - 1)));
  }
  return Object.assign({}, last, { attempts, attemptsUsed: maxAttempts, label, exhausted: true });
}

/* ==================== 带票据的调用（含 401 刷新回退） ==================== */

/**
 * 调用一个需要票据的端点。
 *
 * 401 回退策略（B2 要求「401/403 回退与重新身份校验路径」）：
 *   · `TICKET_*` / `SCOPE_NOT_GRANTED` 类 401/403 → **丢弃票据、重新换取一次**，再试一次；
 *     （Provider 未配置签名密钥时票据在服务端重启后必然失效，属**可恢复事件**，
 *       见 `PROVIDER_BLOCKERS.md` P2-1 —— 不得当作服务故障。）
 *   · 签名/账户类 401（`BAD_SIGNATURE` / `BAD_SERVICE_ACCOUNT` / `NONCE_REPLAY` …）→ **不重试**，
 *     立即上报（重试毫无意义，且会掩盖配置错误）。
 *   · 受限于**一次**重新校验，避免凭据错误时形成刷新风暴。
 */
async function callWithTicket(endpointName, input) {
  const o = input || {};
  const ep = wc.ENDPOINTS[endpointName];
  if (!ep) return { ok: false, errorCode: 'UNKNOWN_ENDPOINT', retryable: false, note: '未知端点 ' + endpointName };
  if (!isConfigured()) {
    return { ok: false, errorCode: 'INTEGRATION_NOT_CONFIGURED', retryable: false, httpStatus: 0, data: null,
      note: '企业资料库集成未配置或未通过出站守卫（零出站）。' };
  }

  const needTicket = !!ep.ticketScope;
  let ticket = String(o.ticket || '');
  let ticketInfo = null;
  if (needTicket && !ticket) {
    const t = await ensureTicket({ userId: o.userId, brandId: o.brandId, purpose: o.purpose, scopes: o.scopes });
    if (!t.ok) { noteSecurityOutcome(Object.assign({ endpoint: endpointName }, t)); return Object.assign({ ok: false, data: null, httpStatus: 0 }, t); }
    ticket = t.ticket;
    ticketInfo = t;
  }

  const pathname = String(ep.path).replace(/:id/g, encodeURIComponent(String(o.id || '')));
  const invoke = () => adapter.request(ep.method, pathname, {
    body: o.body, query: o.query, ticket
  });

  let r = await withRetry(endpointName, invoke);

  /* ---- 票据类失败 → 丢弃 + 重新换票 + 只重试一次 ---- */
  const code = String(r.errorCode || '');
  const ticketFailure = /^TICKET_/.test(code) || code === 'SCOPE_NOT_GRANTED' || code === 'SERVICE_SCOPE_NOT_GRANTED';
  if (!r.ok && ticketFailure && needTicket && o.ticket === undefined) {
    const a = adapter.status();
    const keyId = String(cfg().keyId || '');
    dropTicket(keyId, o.userId, o.brandId, '调用返回 ' + code + '，判定为票据失效，重新换取');
    const again = await ensureTicket({ userId: o.userId, brandId: o.brandId, purpose: o.purpose, scopes: o.scopes, force: true });
    if (again.ok) {
      ticket = again.ticket;
      ticketInfo = Object.assign({}, again, { revalidatedAfter: code });
      const r2 = await withRetry(endpointName + '#revalidate', () => adapter.request(ep.method, pathname, {
        body: o.body, query: o.query, ticket
      }));
      r = Object.assign({}, r2, { revalidated: true, firstErrorCode: code });
    } else {
      r = Object.assign({}, r, { revalidateFailed: true, revalidateErrorCode: again.errorCode });
    }
    void a;
  }

  noteSecurityOutcome(Object.assign({ endpoint: endpointName }, r));
  return Object.assign({}, r, {
    endpoint: endpointName,
    ticketMeta: ticketInfo && ticketInfo.ok
      ? { cached: !!ticketInfo.cached, refreshed: !!ticketInfo.refreshed, expiresAt: ticketInfo.expiresAt,
        remainingSeconds: ticketInfo.remainingSeconds, scopes: (ticketInfo.scopes || []).slice(),
        strippedScopes: ticketInfo.strippedScopes || [] }
      : null
  });
}

/* ==================== 业务封装 ==================== */

function health() {
  return Promise.resolve(adapter.health()).then((r) => { noteSecurityOutcome(r); return r; });
}

/**
 * 检索类端点的**请求体构造**（契约 §3/§4 的字段名逐一对应）。
 *
 * ⚠ 易踩坑：Provider 的两个检索端点都以 **POST body** 取参
 *   （`body.query` / `body.topK` / `body.limit` / `body.offset`），
 *   url query 只用于 GET 类端点（如 `/changes` 的 cursor/limit）。
 *   早期实现把语义参数直接摊在调用参数里，导致请求体为空 ——
 *   `assets/search` 因参数全可选而"看起来成功"（恒空结果），
 *   `knowledge/search` 则直接 400 `MISSING_QUERY`。二者都属**静默失配**，已修正为显式构体。
 */
function searchKnowledgeBody(o) {
  const oo = o || {};
  const b = { query: String(oo.query || '') };
  if (oo.brandId !== undefined) b.brandId = oo.brandId;
  const topK = oo.topK === undefined ? oo.limit : oo.topK;
  if (topK !== undefined && topK !== null) b.topK = Number(topK);
  if (oo.filters && typeof oo.filters === 'object') b.filters = oo.filters;
  return b;
}

function searchAssetsBody(o) {
  const oo = o || {};
  const b = { query: String(oo.query || '') };
  if (oo.brandId !== undefined) b.brandId = oo.brandId;
  if (oo.limit !== undefined && oo.limit !== null) b.limit = Number(oo.limit);
  if (oo.offset !== undefined && oo.offset !== null) b.offset = Number(oo.offset);
  if (oo.categoryId) b.categoryId = String(oo.categoryId);
  if (oo.subcategoryId) b.subcategoryId = String(oo.subcategoryId);
  if (oo.marketingCategory) b.marketingCategory = String(oo.marketingCategory);
  return b;
}

function searchKnowledge(o) {
  const oo = o || {};
  return callWithTicket('KNOWLEDGE_SEARCH', Object.assign({}, oo, {
    scopes: oo.scopes || ['knowledge.search'],
    // url query 不参与本端点（检索参数一律走 POST body）
    query: undefined,
    body: oo.body && typeof oo.body === 'object' ? oo.body : searchKnowledgeBody(oo)
  }));
}

function searchAssets(o) {
  const oo = o || {};
  return callWithTicket('ASSETS_SEARCH', Object.assign({}, oo, {
    scopes: oo.scopes || ['assets.search'],
    query: undefined,
    body: oo.body && typeof oo.body === 'object' ? oo.body : searchAssetsBody(oo)
  }));
}
function getAsset(id, o) { return callWithTicket('ASSET_GET', Object.assign({ id }, o || {})); }
function getSkill(id, o) { return callWithTicket('SKILL_GET', Object.assign({ id }, o || {})); }
function createAdmission(o) { return callWithTicket('ADMISSION_CREATE', o); }
function submitAdmission(id, o) { return callWithTicket('ADMISSION_SUBMIT', Object.assign({ id }, o || {})); }
function pushArtifact(id, o) { return callWithTicket('ADMISSION_ARTIFACT', Object.assign({ id }, o || {})); }
function getAdmission(id, o) { return callWithTicket('ADMISSION_GET', Object.assign({ id }, o || {})); }

/** 增量事件轮询（游标单调 seq；truncated 须触发全量重验） */
function listChanges(o) {
  const oo = o || {};
  return callWithTicket('CHANGES', {
    userId: oo.userId, brandId: oo.brandId, purpose: oo.purpose,
    scopes: ['changes.read'],
    query: { cursor: oo.cursor === undefined ? 0 : oo.cursor, limit: oo.limit || cfg().pollLimit || 200 }
  });
}

/**
 * 取资产母版字节（供入库推送使用）。
 *
 * 注意：契约**刻意不暴露**下载 URL / 文件路径（`fileAccess: 'not-exposed'`），
 * 因此这里不提供任何「下载母版」能力 —— 需要母版字节时只能由业务方在
 * 生成阶段保留原件（本侧 `working_assets` 即承担该角色）。
 */
function assetBytesAvailable() {
  return { ok: false, errorCode: 'FILE_ACCESS_NOT_EXPOSED',
    note: 'Provider 解析接口刻意不暴露文件路径/下载地址（fileAccess=not-exposed）。母版字节只能由本侧在生成阶段留存。' };
}

/* ==================== 最终审批（结构性边界） ==================== */

/**
 * **结构性边界**：服务账户**永不**能产生最终审批。
 * 这里再次显式声明，并在调用时如实返回 403 语义，供自检断言与交付证据引用。
 */
function finalDecision() {
  return {
    ok: false, errorCode: 'TICKET_KIND_MISMATCH', httpStatus: 403, retryable: false, data: null,
    note: '最终审批必须由**本人会话票据**在 Workspace 侧完成；服务账户票据经 serviceGrantable() '
      + '永久剔除 admission.final.decision，故本客户端结构性无法代签（契约 §1.2 双重闭合）。'
  };
}

/* ==================== 缓存失效登记（B3） ==================== */

/**
 * 失效登记类型（白名单，未知类型一律拒绝）。
 *
 * `asset.not_found` 的来源是 **D-09.3 的第二种视角**：Provider 对**非治理身份**解析已撤回资产时
 * 返回 `404 NOT_FOUND`（与非营销资产、无权资产不可区分），而治理身份返回 `410 ASSET_GONE`。
 * 两者**都必须**导致「不可再使用」，但**不得混为一谈** —— 否则审计里会把
 * 「本票据无权看见」误记成「资产已被撤回」。故单列一类。
 */
const INVALIDATION_KINDS = ['asset.revoked', 'asset.deprecated', 'asset.not_found',
  'skill.version.changed', 'permission.changed'];

/** 登记一条失效（来自变更事件）；幂等：同一 (kind,targetId) 只保留最新一条 */
function invalidate(kind, targetId, detail) {
  const store = require('./store');
  const db = store.getDb();
  if (!Array.isArray(db.library_invalidations)) db.library_invalidations = [];
  const k = String(kind); const id = String(targetId || '');
  if (INVALIDATION_KINDS.indexOf(k) === -1) return { ok: false, note: '未知失效类型 ' + k };
  const existing = db.library_invalidations.find((x) => x.kind === k && x.targetId === id);
  const rec = {
    id: existing ? existing.id : require('./ids').uid('inv'),
    kind: k, targetId: id, at: new Date().toISOString(),
    detail: auditMeta(detail || {}), seq: (detail && detail.seq) || null, brandId: (detail && detail.brandId) || ''
  };
  if (existing) Object.assign(existing, rec); else db.library_invalidations.push(rec);
  if (db.library_invalidations.length > 2000) db.library_invalidations.splice(0, db.library_invalidations.length - 2000);
  store.save();
  return { ok: true, invalidation: rec };
}

/** 某个资产/Skill 是否已被判定失效（新调用必须据此拒绝，不得沿用缓存） */
function isInvalidated(kind, targetId) {
  const store = require('./store');
  const db = store.getDb();
  return (db.library_invalidations || []).some((x) => x.kind === kind && x.targetId === String(targetId || ''));
}

/** 全量重建：清空由事件累积的失效登记（用于 truncated 后的对账重建） */
function clearInvalidations(reason) {
  const store = require('./store');
  const db = store.getDb();
  const n = (db.library_invalidations || []).length;
  db.library_invalidations = [];
  if (!Array.isArray(db.settings)) { db.settings = db.settings || {}; }
  db.settings.lastInvalidationReset = { at: new Date().toISOString(), cleared: n, reason: String(reason || '').slice(0, 200) };
  store.save();
  return { ok: true, cleared: n };
}

/* ==================== 准入三步推送（B4） ==================== */

/**
 * 把一份本地准入申请推送到 Provider（真实 HTTP）。
 *
 * 三步语义（与 Provider 契约严格一致）：
 *   ① `POST /admissions`                —— 幂等键建单；`申请 ≠ 资产`（isReusable 恒 false）
 *   ② `POST /admissions/:id/submit`     —— **必须带真实复核人** `reviews[]`；不得「提交即通过」
 *   ③ `POST /admissions/:id/artifact`   —— 前置条件：**已完成独立最终审批**；否则 409
 *
 * **本方法在 ③ 之前不会伪造任何「已审批」状态**：若 Provider 侧尚未完成最终审批
 * （由真实授权人在 Workspace 治理端以本人会话完成），③ 会如实返回
 * `FINAL_APPROVAL_REQUIRED` —— 这正是「服务身份不可代签」的运行时体现。
 *
 * @returns {{ok:boolean, stage:string, ...}} `stage` ∈ create|submit|artifact
 */
async function pushAdmission(input) {
  const o = input || {};
  const admission = o.admission;
  const log = [];
  const idem = String(admission && admission.idempotencyKey || '');
  if (!isConfigured()) {
    return { ok: false, stage: 'preflight', errorCode: 'INTEGRATION_NOT_CONFIGURED', log,
      note: '未配置或未通过出站守卫：未发起任何出站请求。' };
  }
  const body = admissionlibToProviderBody(admission, o);

  /* 出站前同构预校验（零出站即拒）：Provider 预检的硬条件必须先在本侧满足，
   * 否则会白白把申请推进到 Provider 侧的 REVISION_REQUIRED（不可由 submit 端点恢复）。 */
  if (!body.fileName) {
    return { ok: false, stage: 'preflight', errorCode: 'MISSING_FILE_NAME', log,
      missing: ['fileName'],
      note: '缺少 fileName：Provider 预检会直接判 REVISION_REQUIRED。请由工作素材的真实文件名补齐后重试（未发起任何出站请求）。' };
  }
  /* D-06.5：`reuseScope` 缺省 none 会被 Provider 预检判「无复用意义」→ REVISION_REQUIRED，
   * 且该状态无重提入口（B-4）→ 申请永久卡死。必须在**出站前**拦下。 */
  const rs = require('./admissionlib').reuseScopeUsable(admission);
  if (!rs.ok) {
    return { ok: false, stage: 'preflight', errorCode: rs.reason, log,
      missing: ['reuseScope'], note: rs.note };
  }

  /* ① 建单 */
  const c = await createAdmission({
    userId: o.userId, brandId: o.brandId, purpose: o.purpose || ('资产准入：' + (body.title || '')),
    scopes: ['admissions.write'], body
  });
  log.push({ stage: 'create', ok: !!c.ok, httpStatus: c.httpStatus, code: c.errorCode || '', requestId: c.requestId || '' });
  if (!c.ok) return { ok: false, stage: 'create', errorCode: c.errorCode, httpStatus: c.httpStatus, log, requestId: c.requestId, note: c.note };

  const providerAdmissionId = (c.data || {}).admissionRequestId;
  if (!providerAdmissionId) {
    return { ok: false, stage: 'create', errorCode: 'NO_ADMISSION_ID', log, note: 'Provider 未返回 admissionRequestId' };
  }

  /* ② 提交（带真实复核记录） */
  const reviews = Array.isArray(o.reviews) ? o.reviews : [];
  const s = await submitAdmission(providerAdmissionId, {
    userId: o.userId, brandId: o.brandId, purpose: o.purpose,
    scopes: ['admissions.write'], body: { reviews }
  });
  log.push({ stage: 'submit', ok: !!s.ok, httpStatus: s.httpStatus, code: s.errorCode || '',
    state: (s.data || {}).state || '',
    /* Provider 在 REVISION_REQUIRED 时会给出**可执行的**阻断原因（precheck.problems），
     * 原样带回，便于运营排查 —— 不要丢弃，也不要二次解释。 */
    problems: (s.data || {}).problems || [],
    submitSteps: (s.data || {}).steps || [] });
  if (!s.ok) {
    return { ok: false, stage: 'submit', errorCode: s.errorCode, httpStatus: s.httpStatus, log,
      providerAdmissionId, providerState: '', note: s.note };
  }

  /* ② 的**诚实分支**：Provider 的 submit 端点对「不可由本端点推进」的状态（如预检未过的
   * `REVISION_REQUIRED`）仍返回 HTTP 200 —— 此时状态**没有**推进。若不识别，就会把
   * 「预检未过」误报成「等待最终审批」，让运营以为只差一步人工审批。此处显式拦截：
   * 带回 Provider 给出的 `problems`，**不再发起第③步**（避免无意义出站与误判）。 */
  const submitState = String((s.data || {}).state || '');
  const SUBMIT_BLOCKING_STATES = ['REVISION_REQUIRED', 'REJECTED', 'REVOKED', 'DEPRECATED'];
  if (SUBMIT_BLOCKING_STATES.indexOf(submitState) !== -1) {
    const problems = (s.data || {}).problems || [];
    return {
      ok: false, stage: 'submit', errorCode: 'PROVIDER_' + submitState,
      httpStatus: s.httpStatus, providerAdmissionId, providerState: submitState,
      providerProblems: problems, submitSteps: (s.data || {}).steps || [], log,
      note: 'Provider 侧申请未进入待最终审批（state=' + submitState + '）：'
        + (problems.length ? problems.join('；') : 'Provider 未给出具体原因')
        + '。请按 Provider 给出的问题修正后，以**新的 idempotencyKey** 重新提交'
        + '（同一幂等键会原样返回既有申请，无法用于修正）。'
    };
  }

  /* ③ 推送母版（前置条件：Provider 侧已完成独立最终审批） */
  const art = await pushArtifact(providerAdmissionId, {
    userId: o.userId, brandId: o.brandId, purpose: o.purpose,
    scopes: ['admissions.write'],
    body: { fileName: body.fileName, contentBase64: o.contentBase64 }
  });
  const artData = art.data || {};
  log.push({ stage: 'artifact', ok: !!art.ok, httpStatus: art.httpStatus, code: art.errorCode || '',
    isReusable: !!artData.isReusable, libraryAssetId: artData.libraryAssetId || '' });

  return {
    ok: !!(art.ok && artData.isReusable),
    stage: 'artifact',
    providerAdmissionId,
    providerState: artData.state || (s.data || {}).state || '',
    isReusable: !!artData.isReusable,
    libraryAssetId: artData.libraryAssetId || null,
    libraryVersionId: artData.libraryVersionId || null,
    libraryDocumentId: artData.libraryDocumentId || null,
    contentHash: artData.contentHash || null,
    failureReason: artData.failureReason || '',
    retryable: !!artData.retryable,
    httpStatus: art.httpStatus,
    errorCode: art.errorCode || '',
    log,
    idempotencyKey: idem,
    note: !art.ok
      ? ('母版推送未完成：' + (art.errorCode || '') + ' ' + (art.errorMessage || '')
        + (art.errorCode === 'FINAL_APPROVAL_REQUIRED'
          ? '（Provider 侧尚未完成**本人会话**最终审批 —— 服务账户不可代签）' : ''))
      : (artData.isReusable
        ? '入库成功：已取得正式 Asset ID。'
        : ('入库校验未通过（' + (artData.failureReason || '') + '），状态保持 SYNC_FAILED，可按同一幂等键重试或转人工对账。'))
  };
}

/** 内部：把本地申请映射为 Provider AdmissionInput（延迟 require 避免循环依赖） */
function admissionlibToProviderBody(admission, o) {
  const admissionlib = require('./admissionlib');
  const md = (admission && admission.submissionMetadata) || {};
  const body = admissionlib.toProviderAdmissionInput(admission, o);
  // 文件名缺省取工作素材文件名
  if (!body.fileName && md.fileName) body.fileName = String(md.fileName).slice(0, 180);
  return body;
}

/* ==================== 失败补偿：先查状态，不重复建单 ==================== */

/**
 * 查询某份申请的 Provider 侧状态（失败补偿入口）。
 * 语义（契约 §2 「无法确定提交结果 → 先查询状态，不能直接生成新的申请」）：
 * 只能按**已知的** providerAdmissionId 查询；**绝不**凭幂等键猜一个 ID 去建新单。
 */
async function queryAdmissionState(providerAdmissionId, o) {
  const oo = o || {};
  if (!providerAdmissionId) {
    return { ok: false, errorCode: 'NO_ADMISSION_ID', note: '没有 Provider 申请 ID：无法查询。禁止另建新单来「重试」。' };
  }
  return getAdmission(providerAdmissionId, { userId: oo.userId, brandId: oo.brandId, purpose: oo.purpose, scopes: ['admissions.read'] });
}

module.exports = {
  /* 状态与配置 */
  isConfigured, status, egressGuard, cfg, resolveProviderUser,
  /* 票据生命周期 */
  ensureTicket, cachedTicket, dropTicket, dropAllTickets, ticketKey, scopeSignature,
  /* 调用 */
  callWithTicket, withRetry, classify,
  /* 业务 */
  health, searchKnowledge, searchAssets, getAsset, getSkill, listChanges,
  createAdmission, submitAdmission, pushArtifact, getAdmission,
  pushAdmission, queryAdmissionState, assetBytesAvailable, finalDecision,
  /* 失效登记 */
  INVALIDATION_KINDS, invalidate, isInvalidated, clearInvalidations,
  /* 工具 */
  redact, parseBaseUrl, INVALIDATION_KINDS_LIST: INVALIDATION_KINDS,
  /* V1.2 / B1：拒绝类可观测性 */
  SECURITY_REJECTION_CODES, noteSecurityOutcome, securityStatus
};
