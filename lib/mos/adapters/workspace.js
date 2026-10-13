'use strict';
/**
 * EnterpriseWorkspaceAdapter —— 企业资料库（Enterprise Workspace）受控调用方适配器（A-06）。
 *
 * 契约权威：Enterprise Workspace V1.1.7 的 `INTEGRATION_API_CONTRACT.md` +
 * `lib/integration/{service-accounts,tickets}.js` + `lib/routes/integrations.js`。
 * 逐字节对齐实现集中在 `lib/mos/workspace-contract.js`。
 *
 * 诚实性红线（与 A-06 原文一致）：
 *   - **没有可用服务时只交付可测适配器和 Mock，禁止声称联调成功。**
 *     本适配器在无凭据时 `status().configured === false`，**任何**方法返回
 *     `INTEGRATION_NOT_CONFIGURED` 且**不发起任何出站请求**。
 *   - **服务账户无最终审批权**：本适配器**不提供** `finalDecision()`；该方法存在但恒返回
 *     `FINAL_DECISION_REQUIRES_SESSION`（结构性边界，可被自检断言）。
 *   - 私钥只在服务端：`status()` 只报布尔与主机名，**绝不**回传 PEM / 票据 / 签名。
 */
const fs = require('node:fs');
const crypto = require('node:crypto');
const { getMosConfig } = require('../config');
const wc = require('../workspace-contract');

const PROVIDER_ID = 'mos.workspace';

/** 读取配置并装载私钥（返回对象**不含**任何可作为机密的字段） */
function load() {
  const cfg = getMosConfig();
  const w = cfg.workspace || {};
  const baseUrl = String(w.baseUrl || '').replace(/\/$/, '');
  const keyId = String(w.keyId || '');
  let pem = String(w.privateKeyPem || '');
  const keyPath = String(w.privateKeyPath || '');
  let keyLoadError = '';
  if (!pem && keyPath) {
    try { pem = fs.readFileSync(keyPath, 'utf8'); } catch (err) { keyLoadError = String(err && err.message || err); }
  }
  let key = null;
  if (pem) {
    try { key = crypto.createPrivateKey(pem); } catch (err) { keyLoadError = '私钥 PEM 解析失败：' + String(err && err.message || err); }
  }
  const hasPrivateKey = !!key;
  const configured = !!(w.enabled === true && baseUrl && keyId && hasPrivateKey);
  return {
    enabled: w.enabled === true,
    baseUrl, keyId, key, hasPrivateKey, keyLoadError,
    ticket: String(w.ticket || ''),
    timeoutMs: Number(w.timeoutMs) > 0 ? Number(w.timeoutMs) : 15000,
    correlationIdPrefix: String(w.correlationIdPrefix || 'mos'),
    configured,
    // 只暴露主机名（不含用户凭据）；供运维核对，不构成机密
    baseUrlHost: (() => { try { return new URL(baseUrl).host; } catch (_) { return ''; } })(),
    baseUrlScheme: (() => { try { return new URL(baseUrl).protocol.replace(':', ''); } catch (_) { return ''; } })()
  };
}

/** 离线状态（**绝不发起出站**，**绝不回传密钥/票据**） */
function status() {
  const l = load();
  const missing = [];
  if (!l.baseUrl) missing.push('baseUrl');
  if (!l.keyId) missing.push('keyId');
  if (!l.hasPrivateKey) missing.push('privateKey');
  return {
    provider: PROVIDER_ID,
    enabled: l.enabled,
    configured: l.configured,
    baseUrlHost: l.baseUrlHost,
    baseUrlScheme: l.baseUrlScheme,
    hasKeyId: !!l.keyId,
    hasPrivateKey: l.hasPrivateKey,
    ticketPresent: !!l.ticket,
    timeoutMs: l.timeoutMs,
    contractVersion: wc.CONTRACT_VERSION,
    workspaceAppVersion: wc.WORKSPACE_APP_VERSION,
    privateKeyError: l.keyLoadError || '',
    missing,
    note: l.configured
      ? '已配置服务账户凭据（私钥只在服务端）。**未声称联调成功**：是否可用以真实 /health 探测为准。'
      : '尚未配置企业资料库集成（默认关闭）→ 不发起任何出站、不返回任何资产结果（fail closed）。'
  };
}

/** 统一"未配置"结果（所有业务方法在未配置时返回它，**零出站**） */
function notConfigured(op) {
  return {
    ok: false,
    state: 'INTEGRATION_NOT_CONFIGURED',
    errorCode: 'INTEGRATION_NOT_CONFIGURED',
    retryable: false,
    httpStatus: 0,
    data: null,
    note: '企业资料库集成未配置，' + op + ' 未执行（无任何出站请求）。'
  };
}

/**
 * 统一请求：签名（Ed25519）+ 受限票据 + 封套解析。
 * @param {string} method GET|POST
 * @param {string} pathname 契约路径（**不含** query）
 * @param {object} o { body, query, ticket, kind:'service'|'session' }
 */
async function request(method, pathname, o) {
  const opts = o || {};
  const l = load();
  if (!l.configured) return notConfigured(method + ' ' + pathname);
  if (typeof pathname !== 'string' || pathname.indexOf('?') !== -1) {
    return { ok: false, state: 'BAD_PATHNAME', errorCode: 'BAD_PATHNAME', retryable: false, data: null,
      note: 'pathname 不得为空或包含 query（契约 §1.1）。' };
  }
  const ticket = String(opts.ticket !== undefined ? opts.ticket : l.ticket || '');
  const bodyStr = (opts.body === undefined || opts.body === null) ? '' : JSON.stringify(opts.body);
  // 契约 §1.1：GET / 无体请求 body 视作空 → sha256('')；签名与发送使用**同一份字节**
  const sendBody = method.toUpperCase() === 'GET' ? '' : bodyStr;

  let signed;
  try {
    signed = wc.signedHeaders({
      keyId: l.keyId, privateKey: l.key, method: method.toUpperCase(),
      pathname, bodyStr: sendBody
    });
  } catch (err) {
    return { ok: false, state: 'SIGN_FAILED', errorCode: 'SIGN_FAILED', retryable: false, data: null,
      note: '本地签名失败：' + String(err && err.message || err).slice(0, 200) };
  }

  const headers = Object.assign({}, signed.headers);
  if (sendBody) headers['Content-Type'] = 'application/json';
  if (ticket) headers['x-vfib-ticket'] = ticket;
  headers['x-vfib-correlation-id'] = l.correlationIdPrefix + '-' + crypto.randomBytes(6).toString('hex');

  let url = l.baseUrl + pathname;
  const q = opts.query || {};
  const qs = Object.keys(q).filter((k) => q[k] !== undefined && q[k] !== null && q[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(q[k]))).join('&');
  if (qs) url += '?' + qs;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), l.timeoutMs);
  let res = null;
  let text = '';
  try {
    res = await fetch(url, {
      method: method.toUpperCase(),
      headers,
      body: method.toUpperCase() === 'GET' ? undefined : sendBody,
      signal: ctrl.signal,
      redirect: 'error'   // 集成端点不应重定向；出现即视为异常，避免签名跨跳转泄漏
    });
    text = await res.text();
  } catch (err) {
    clearTimeout(timer);
    const aborted = String(err && err.name) === 'AbortError';
    return {
      ok: false,
      state: aborted ? 'TIMEOUT' : 'NETWORK_ERROR',
      errorCode: aborted ? 'WORKSPACE_TIMEOUT' : 'WORKSPACE_NETWORK_ERROR',
      retryable: true, httpStatus: 0, data: null,
      note: (aborted ? '调用企业资料库超时（' + l.timeoutMs + 'ms）' : '调用企业资料库失败：')
        + String(err && err.message || '').slice(0, 200)
    };
  } finally {
    clearTimeout(timer);
  }

  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  const parsed = wc.parseEnvelope(res.status, json);
  return Object.assign(parsed, {
    state: parsed.ok ? 'OK' : (parsed.errorCode || 'HTTP_' + res.status),
    requestIdHeader: res.headers && typeof res.headers.get === 'function' ? (res.headers.get('x-request-id') || '') : '',
    bodyPreview: parsed.ok ? '' : String(text || '').slice(0, 300)
  });
}

/* ==================== 端点封装（与契约 §4.1 一一对应） ==================== */

async function health() {
  const st = status();
  if (!st.configured) {
    return Object.assign(notConfigured('health 探测'), { health: 'NOT_CONFIGURED' });
  }
  const r = await request('GET', wc.ENDPOINTS.HEALTH.path, {});
  return Object.assign(r, {
    health: r.ok ? 'HEALTHY' : (r.errorCode === 'INTEGRATION_DISABLED' ? 'DISABLED' : 'UNHEALTHY')
  });
}

/** 签发**服务票据**（会剔除 admission.final.decision；契约 §1.2） */
async function issueServiceTicket(input) {
  const o = input || {};
  const requested = Array.isArray(o.scopes) ? o.scopes.map(String) : [];
  const grantable = wc.serviceGrantable(requested);
  const stripped = requested.filter((s) => grantable.indexOf(s) === -1);
  const r = await request('POST', wc.ENDPOINTS.TICKETS.path, {
    body: { userId: o.userId, brandId: o.brandId, purpose: o.purpose || 'mos-integration', scopes: grantable }
  });
  return Object.assign(r, { requestedScopes: requested, grantedScopes: grantable, strippedScopes: stripped });
}

/** 复用员工侧检索链路（先筛后搜）；snippet 逐文档判定，可能被扣留（契约 §6.2） */
async function knowledgeSearch(input) {
  const o = input || {};
  return request('POST', wc.ENDPOINTS.KNOWLEDGE_SEARCH.path, {
    body: { query: String(o.query || ''), brandId: o.brandId, limit: o.limit }
  });
}

/** 仅返回「可复用 + 有效 + 对该主体授权」的资产元数据 */
async function assetsSearch(input) {
  const o = input || {};
  return request('POST', wc.ENDPOINTS.ASSETS_SEARCH.path, {
    body: { query: String(o.query || ''), brandId: o.brandId, limit: o.limit }
  });
}

/** 资产解析（不可探测：不存在/无权/非营销资产 → 同一 404 NOT_FOUND） */
async function getAsset(id, input) {
  const o = input || {};
  return request('GET', wc.ENDPOINTS.ASSET_GET.path.replace(':id', encodeURIComponent(String(id || ''))), {
    query: { version: o.version, brandId: o.brandId }
  });
}

/** 提交准入申请（幂等键；**申请 ≠ 资产**） */
async function createAdmission(input) {
  const o = input || {};
  return request('POST', wc.ENDPOINTS.ADMISSION_CREATE.path, {
    body: {
      idempotencyKey: o.idempotencyKey, originObjectId: o.originObjectId,
      contentHash: o.contentHash, brandId: o.brandId,
      title: o.title, classification: o.classification, fileName: o.fileName
    }
  });
}

/** 推进 submit → precheck → review → 请求最终审批（**必须带 reviews[]**） */
async function submitAdmission(id, input) {
  const o = input || {};
  return request('POST', wc.ENDPOINTS.ADMISSION_SUBMIT.path.replace(':id', encodeURIComponent(String(id || ''))), {
    body: { reviews: Array.isArray(o.reviews) ? o.reviews : [] }
  });
}

/** 推送母版（base64 内嵌）；审批未完成时如实返回 409 FINAL_APPROVAL_REQUIRED */
async function pushArtifact(id, input) {
  const o = input || {};
  return request('POST', wc.ENDPOINTS.ADMISSION_ARTIFACT.path.replace(':id', encodeURIComponent(String(id || ''))), {
    body: { fileName: o.fileName, contentBase64: o.contentBase64 }
  });
}

async function getAdmission(id) {
  return request('GET', wc.ENDPOINTS.ADMISSION_GET.path.replace(':id', encodeURIComponent(String(id || ''))), {});
}

async function getSkill(id, input) {
  const o = input || {};
  return request('GET', wc.ENDPOINTS.SKILL_GET.path.replace(':id', encodeURIComponent(String(id || ''))), {
    query: { version: o.version, brandId: o.brandId }
  });
}

/** 增量事件轮询（游标为单调 seq；truncated=true 显式标志） */
async function changes(input) {
  const o = input || {};
  return request('GET', wc.ENDPOINTS.CHANGES.path, {
    query: { cursor: o.cursor === undefined ? 0 : o.cursor, limit: o.limit, brandId: o.brandId }
  });
}

/**
 * **结构性边界**：最终审批决策**只能**由本人会话票据完成，服务账户**永不可**。
 * 本方法刻意恒返回拒绝，确保「服务侧无法产生 final decision」可被自检断言。
 */
async function finalDecision() {
  return {
    ok: false, state: 'FINAL_DECISION_REQUIRES_SESSION',
    errorCode: 'TICKET_KIND_MISMATCH', retryable: false, httpStatus: 0, data: null,
    note: '最终审批决策必须由用户在 Workspace 侧以**本人会话票据**完成；'
      + '服务账户票据不含也不会获得 admission.final.decision（契约 §1.2 双重闭合）。本适配器不提供该能力。'
  };
}

/** 能力声明（供 UI/运维展示；不夸大） */
function capabilities() {
  const st = status();
  return {
    configured: st.configured,
    contractVersion: wc.CONTRACT_VERSION,
    readEndpoints: ['knowledge.search', 'assets.search', 'assets.read', 'skills.read', 'changes.read'],
    writeEndpoints: ['admissions.write'],
    finalDecisionByServiceAccount: false,   // 恒为 false：服务账户无最终审批权
    publishedContentArchive: false,         // Published Content 归档仅在 Marketing OS（契约 §8）
    notProvided: wc.NOT_PROVIDED,
    note: '适配层已实现并通过离线契约自检；**真实联调未发生**（无可用服务/凭据时保持 NOT_CONFIGURED）。'
  };
}

module.exports = {
  PROVIDER_ID, load, status, health, capabilities,
  request,
  issueServiceTicket, knowledgeSearch, assetsSearch, getAsset,
  createAdmission, submitAdmission, pushArtifact, getAdmission, getSkill, changes,
  finalDecision,
  contract: wc
};
