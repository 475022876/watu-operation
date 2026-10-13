'use strict';
/**
 * Enterprise Workspace 集成契约（A-06 / 规格 04 §Phase3「企业资料库适配契约及权限」）。
 *
 * 本文件是 **Marketing OS 侧**对《Marketing OS ↔ Enterprise Workspace 受控集成接口契约》
 * 的**逐字节对齐实现**，来源为 Enterprise Workspace 最新源码：
 *   - `INTEGRATION_API_CONTRACT.md`（契约 V1.0，应用版本 V1.1.7）
 *   - `lib/integration/service-accounts.js`（`canonicalString()` / `sha256Hex()` / SCOPES）
 *   - `lib/integration/tickets.js`（票据 SCOPES / SESSION_ONLY_SCOPES）
 *   - `lib/routes/integrations.js`（端点与封套 `respond()`）
 *
 * 立场（不可妥协）：
 *   - Marketing OS 是**受控调用方**：只能经本契约端点操作，且**任何**资产进入正式复用状态的
 *     唯一通道是 Workspace 侧的**独立最终审批**。
 *   - **服务账户永不可能**取得 `admission.final.decision`（`serviceGrantable()` 剔除 +
 *     端点强制 `kind === 'session'` 双重闭合）。本模块**不提供**任何服务侧最终审批入口。
 *   - 未配置凭据时一律 `NOT_CONFIGURED`（fail closed），**绝不伪造**任何资料库结果或联调结论。
 */
const crypto = require('node:crypto');

/** 契约版本（与 Workspace `policy.POLICY_VERSION` 对齐；每个响应回带） */
const CONTRACT_VERSION = '1.0';
/** 兼容的 Workspace 应用版本（信息性，仅用于文档与展示） */
const WORKSPACE_APP_VERSION = '1.1.7';

/** 统一前缀 */
const PREFIX = '/api/integrations/marketing';

/** 端点清单（与 `lib/routes/integrations.js` 注册表一致，含文档 §4.1 未列出的 skills） */
const ENDPOINTS = {
  HEALTH: { method: 'GET', path: PREFIX + '/health', serviceScope: null, ticketScope: null, ticketKind: null },
  TICKETS: { method: 'POST', path: PREFIX + '/tickets', serviceScope: 'tickets.issue', ticketScope: null, ticketKind: null },
  KNOWLEDGE_SEARCH: { method: 'POST', path: PREFIX + '/knowledge/search', serviceScope: 'knowledge.search', ticketScope: 'knowledge.search', ticketKind: 'service' },
  ASSETS_SEARCH: { method: 'POST', path: PREFIX + '/assets/search', serviceScope: 'assets.search', ticketScope: 'assets.search', ticketKind: 'service' },
  ASSET_GET: { method: 'GET', path: PREFIX + '/assets/:id', serviceScope: 'assets.read', ticketScope: 'assets.read', ticketKind: 'service' },
  ADMISSION_CREATE: { method: 'POST', path: PREFIX + '/admissions', serviceScope: 'admissions.write', ticketScope: 'admissions.write', ticketKind: 'service' },
  ADMISSION_SUBMIT: { method: 'POST', path: PREFIX + '/admissions/:id/submit', serviceScope: 'admissions.write', ticketScope: 'admissions.write', ticketKind: 'service' },
  ADMISSION_ARTIFACT: { method: 'POST', path: PREFIX + '/admissions/:id/artifact', serviceScope: 'admissions.write', ticketScope: 'admissions.write', ticketKind: 'service' },
  ADMISSION_GET: { method: 'GET', path: PREFIX + '/admissions/:id', serviceScope: 'admissions.read', ticketScope: 'admissions.read', ticketKind: 'service' },
  ADMISSION_FINAL_DECISION: { method: 'POST', path: PREFIX + '/admissions/:id/final-decision', serviceScope: 'admissions.read', ticketScope: 'admission.final.decision', ticketKind: 'session' },
  SKILL_GET: { method: 'GET', path: PREFIX + '/skills/:id', serviceScope: 'skills.read', ticketScope: 'skills.read', ticketKind: 'service' },
  CHANGES: { method: 'GET', path: PREFIX + '/changes', serviceScope: 'changes.read', ticketScope: 'changes.read', ticketKind: 'service' }
};

/** 服务账户 scope（`service-accounts.js SCOPES`） */
const SERVICE_SCOPES = [
  'knowledge.search', 'assets.search', 'assets.read', 'admissions.write',
  'admissions.read', 'skills.read', 'changes.read', 'tickets.issue'
];
/** 票据 scope（`tickets.js SCOPES`） */
const TICKET_SCOPES = [
  'knowledge.search', 'assets.search', 'assets.read', 'admissions.write',
  'admissions.read', 'skills.read', 'changes.read', 'admission.final.decision'
];
/** **仅本人会话**可取得的票据范围：服务账户**永远**拿不到（双重闭合的第一重） */
const SESSION_ONLY_TICKET_SCOPES = ['admission.final.decision'];

/** 错误码总表（契约 §3；调用方请判 `code`，不要判 message 措辞） */
const ERROR_CODES = {
  // 第一层：服务身份
  INTEGRATION_DISABLED: { http: 503, layer: 'service', retryable: false },
  NO_SERVICE_ACCOUNT: { http: 503, layer: 'service', retryable: false },
  MISSING_SIGNATURE: { http: 401, layer: 'service', retryable: false },
  BAD_SERVICE_ACCOUNT: { http: 401, layer: 'service', retryable: false },
  BAD_TIMESTAMP: { http: 401, layer: 'service', retryable: false },
  TIMESTAMP_OUT_OF_WINDOW: { http: 401, layer: 'service', retryable: false },
  ACCOUNT_KEY_UNUSABLE: { http: 503, layer: 'service', retryable: false },
  BAD_SIGNATURE_FORMAT: { http: 401, layer: 'service', retryable: false },
  BAD_SIGNATURE: { http: 401, layer: 'service', retryable: false },
  NONCE_REPLAY: { http: 401, layer: 'service', retryable: false },
  RATE_LIMITED: { http: 429, layer: 'service', retryable: true },
  // 第二层：票据
  TICKET_MISSING: { http: 401, layer: 'ticket', retryable: false },
  TICKET_MALFORMED: { http: 401, layer: 'ticket', retryable: false },
  TICKET_BAD_SIGNATURE: { http: 401, layer: 'ticket', retryable: false },
  TICKET_BAD_PAYLOAD: { http: 401, layer: 'ticket', retryable: false },
  TICKET_BAD_VERSION: { http: 401, layer: 'ticket', retryable: false },
  TICKET_EXPIRED: { http: 401, layer: 'ticket', retryable: true },
  TICKET_NO_USER: { http: 401, layer: 'ticket', retryable: false },
  TICKET_NO_BRAND: { http: 401, layer: 'ticket', retryable: false },
  TICKET_KIND_MISMATCH: { http: 403, layer: 'ticket', retryable: false },
  TICKET_ACCOUNT_MISMATCH: { http: 403, layer: 'ticket', retryable: false },
  TICKET_USER_INACTIVE: { http: 403, layer: 'ticket', retryable: false },
  SCOPE_NOT_GRANTED: { http: 403, layer: 'ticket', retryable: false },
  // 业务与策略
  BRAND_MISMATCH: { http: 403, layer: 'business', retryable: false },
  BRAND_NOT_ALLOWED: { http: 403, layer: 'business', retryable: false },
  FINAL_APPROVAL_FORBIDDEN: { http: 403, layer: 'business', retryable: false },
  NOT_REUSABLE_FOR_SUBJECT: { http: 403, layer: 'business', retryable: false },
  NOT_FOUND: { http: 404, layer: 'business', retryable: false },
  VERSION_NOT_FOUND: { http: 404, layer: 'business', retryable: false },
  ASSET_GONE: { http: 410, layer: 'business', retryable: false },
  ASSET_IMMUTABLE: { http: 409, layer: 'business', retryable: false },
  ADMISSION_INCONSISTENT: { http: 409, layer: 'business', retryable: false },
  FINAL_APPROVAL_REQUIRED: { http: 409, layer: 'business', retryable: true },
  REVIEW_REQUIRED: { http: 409, layer: 'business', retryable: false },
  ASSET_CONFLICT: { http: 409, layer: 'business', retryable: false },
  BAD_STATE: { http: 409, layer: 'business', retryable: false },
  BAD_TRANSITION: { http: 409, layer: 'business', retryable: false },
  MARKETING_ASSET_LOCKED: { http: 403, layer: 'business', retryable: false },
  MISSING_QUERY: { http: 400, layer: 'request', retryable: false },
  QUERY_TOO_LONG: { http: 400, layer: 'request', retryable: false },
  MISSING_USER: { http: 400, layer: 'request', retryable: false },
  MISSING_BRAND: { http: 400, layer: 'request', retryable: false },
  BAD_CURSOR: { http: 400, layer: 'request', retryable: false },
  MISSING_CONTENT: { http: 400, layer: 'request', retryable: false },
  BAD_CONTENT: { http: 400, layer: 'request', retryable: false },
  BAD_REVIEWER: { http: 400, layer: 'request', retryable: false },
  FILE_TOO_LARGE: { http: 413, layer: 'request', retryable: false },
  EXT_NOT_ALLOWED: { http: 415, layer: 'request', retryable: false },
  MAGIC_MISMATCH: { http: 415, layer: 'request', retryable: false }
};

/** 封套顶层键（契约 §2：**所有**端点、成功与失败同一形状） */
const ENVELOPE_KEYS = ['ok', 'data', 'error', 'request_id', 'policy_version'];

/** sha256 hex（契约：哈希**原始字节**，不是重新序列化后的 JSON 文本） */
function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf === undefined || buf === null ? Buffer.alloc(0) : buf).digest('hex');
}
/** 计算请求体哈希（契约 §1.1：GET/无体 = sha256('')；字符串按 UTF-8 取原始字节） */
function bodyHashOf(bodyStr) {
  const s = bodyStr === undefined || bodyStr === null ? '' : String(bodyStr);
  return sha256Hex(Buffer.from(s, 'utf8'));
}
/** `sha256('')` 的常量值（契约 §1.1 第 1 点，用于自检断言） */
const EMPTY_BODY_HASH = bodyHashOf('');

/**
 * 规范化待签串（逐字节对齐 Workspace `service-accounts.canonicalString()`）。
 * `pathname` **不含** query string。
 */
function canonicalString(keyId, method, pathname, timestamp, nonce, bodyHash) {
  return ['v1', String(keyId), String(method).toUpperCase(), String(pathname),
    String(timestamp), String(nonce), String(bodyHash)].join('\n');
}

/**
 * 生成服务签名头（Ed25519，对 canonicalString 的 UTF-8 字节签名；base64 输出）。
 * @param {object} o { keyId, privateKey(PEM|KeyObject), method, pathname, bodyStr, timestamp, nonce }
 * @returns {{headers:object, canonical:string, bodyHash:string, nonce:string, timestamp:string}}
 */
function signedHeaders(o) {
  const keyId = String(o.keyId || '');
  if (!keyId) throw new Error('缺少 keyId');
  if (!o.privateKey) throw new Error('缺少 Ed25519 私钥');
  const method = String(o.method || 'GET').toUpperCase();
  const pathname = String(o.pathname || '');
  if (pathname.indexOf('?') !== -1) {
    // 契约 §1.1 第 2 点：pathname 不含 query。此处直接报错而不是静默截断，避免调用方误以为已签 query。
    throw new Error('canonicalString 的 pathname 不得包含 query string：' + pathname);
  }
  const timestamp = String(o.timestamp !== undefined ? o.timestamp : Math.floor(Date.now() / 1000));
  const nonce = String(o.nonce || crypto.randomBytes(12).toString('hex'));
  const bodyStr = o.bodyStr === undefined || o.bodyStr === null ? '' : String(o.bodyStr);
  const bodyHash = bodyHashOf(bodyStr);
  const canonical = canonicalString(keyId, method, pathname, timestamp, nonce, bodyHash);
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), o.privateKey).toString('base64');
  return {
    headers: {
      'x-vfib-key-id': keyId,
      'x-vfib-timestamp': timestamp,
      'x-vfib-nonce': nonce,
      'x-vfib-signature': signature
    },
    canonical, bodyHash, nonce, timestamp
  };
}

/** 本地校验签名（自检用；与服务端 `crypto.verify(null, ...)` 完全同构） */
function verifySigned(keyId, method, pathname, timestamp, nonce, bodyStr, signatureB64, publicKey) {
  const canonical = canonicalString(keyId, method, pathname, timestamp, nonce, bodyHashOf(bodyStr));
  try {
    return crypto.verify(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(String(signatureB64), 'base64'));
  } catch (_) { return false; }
}

/** 封套形状校验：所有端点成功/失败都必须满足（契约 §2） */
function isEnvelope(json) {
  if (!json || typeof json !== 'object') return false;
  if (typeof json.ok !== 'boolean') return false;
  for (const k of ['data', 'error', 'request_id', 'policy_version']) {
    if (!Object.prototype.hasOwnProperty.call(json, k)) return false;
  }
  if (!json.request_id || !json.policy_version) return false;
  // 失败时 data 恒为 null（绝不在错误响应里夹带业务数据）
  if (json.ok === false && json.data !== null) return false;
  if (json.ok === true && json.error !== null) return false;
  return true;
}

/** 从封套解析出结构化结果 */
function parseEnvelope(httpStatus, json) {
  const ok = !!(json && json.ok === true);
  const error = (json && json.error) || null;
  const code = error && error.code ? String(error.code) : '';
  const meta = ERROR_CODES[code];
  return {
    ok,
    httpStatus: Number(httpStatus) || 0,
    data: ok ? (json ? json.data : null) : null,
    errorCode: code,
    errorMessage: error && error.message ? String(error.message) : '',
    errorLayer: meta ? meta.layer : (ok ? '' : 'unknown'),
    retryable: meta ? !!meta.retryable : false,
    requestId: (json && json.request_id) || '',
    policyVersion: (json && json.policy_version) || '',
    envelopeValid: isEnvelope(json)
  };
}

/** 服务账户能否申请某票据范围（服务账户**永不含** final 决定权） */
function serviceGrantable(scopes) {
  return (scopes || []).map(String).filter((s) => SESSION_ONLY_TICKET_SCOPES.indexOf(s) === -1);
}

/* ---------------- 变更事件流（契约 §7） ---------------- */
const EVENT_TYPES = [
  'policy.version.changed', 'admission.state.changed', 'asset.revoked',
  'asset.deprecated', 'permission.changed', 'service.account.changed'
];
const CHANGES_MAX_RETAINED = 5000;
const CHANGES_POLL_HINT_SECONDS = 60;

/** 准入状态机（契约 §5.1，仅用于展示与断言；状态迁移权威在 Workspace 侧） */
const ADMISSION_STATES = [
  'DRAFT', 'SUBMITTED', 'PRECHECK', 'REVIEWING', 'REVISION_REQUIRED',
  'FINAL_APPROVAL_PENDING', 'FINAL_APPROVED', 'ADMISSION_PENDING',
  'SYNC_FAILED', 'ADMITTED', 'REJECTED', 'REVOKED', 'DEPRECATED'
];

/** 明确「不做」的边界（契约 §8）：这些能力在 Workspace 侧**已验证不存在** */
const NOT_PROVIDED = [
  'publishedContentArchive',   // Published Content 归档仅在 Marketing OS
  'publish', 'archive'
];

module.exports = {
  CONTRACT_VERSION, WORKSPACE_APP_VERSION, PREFIX,
  ENDPOINTS, SERVICE_SCOPES, TICKET_SCOPES, SESSION_ONLY_TICKET_SCOPES,
  ERROR_CODES, ENVELOPE_KEYS,
  sha256Hex, bodyHashOf, EMPTY_BODY_HASH,
  canonicalString, signedHeaders, verifySigned,
  isEnvelope, parseEnvelope,
  serviceGrantable,
  EVENT_TYPES, CHANGES_MAX_RETAINED, CHANGES_POLL_HINT_SECONDS,
  ADMISSION_STATES, NOT_PROVIDED
};
