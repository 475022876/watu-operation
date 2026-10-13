'use strict';
/**
 * Provider 统一契约（04 §6 / 整改 A-05）。
 *
 * 契约面（文本与图像 Provider 共用同一套字段名）：
 *   - `status()`    —— 同步、离线：只读取配置，报告 provider/mode/configured/hasServerKey/mock。
 *   - `health()`    —— 可用性探针：未配置 → NOT_CONFIGURED（不发起任何出站）；
 *                      已配置 → 报告 configured 与（可选）真实探测结果。
 *   - `invoke()`    —— 统一调用入口（文本 summarize/draft、图像 generate 都从这里走）。
 *   - `timeout`     —— 单次调用硬超时（AbortSignal），超时归类为 PROVIDER_TIMEOUT。
 *   - `rateLimit`   —— 从响应头解析的限流信息（未提供则如实为 null，不臆测）。
 *   - `costReceipt` —— 仅记录**供应商回执中真实存在**的费用/用量；
 *                      无回执一律 `amount:null, confirmed:false`（绝不做换汇/单价推算，04 §5）。
 *   - `errorCode`   —— 结构化失败码（见 ERROR_CODES），供运维判断是否可重试。
 *
 * 诚实性红线（本文件是"不得伪造"的落点）：
 *   1. 未配置密钥 → 一律返回 NOT_CONFIGURED，**不产生任何内容、不发起任何出站**。
 *   2. 失败 → 原样上报 HTTP 状态与供应商错误信息，绝不伪造成成功。
 *   3. 密钥**只在服务端**：本模块所有对外返回都不含 apiKey 字段。
 */
const { getMosConfig } = require('./config');

/** 结构化失败码（文本/图像共用；稳定取值，供日志与运维判断 retryable） */
const ERROR_CODES = {
  NOT_CONFIGURED: 'PROVIDER_NOT_CONFIGURED',
  UNKNOWN_MODE: 'PROVIDER_UNKNOWN_MODE',
  BLOCKED_DATA_CLASS: 'PROVIDER_BLOCKED_DATA_CLASS',
  TIMEOUT: 'PROVIDER_TIMEOUT',
  RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  HTTP_ERROR: 'PROVIDER_HTTP_ERROR',
  BAD_REQUEST: 'PROVIDER_BAD_REQUEST',
  NETWORK_ERROR: 'PROVIDER_NETWORK_ERROR',
  EMPTY_RESPONSE: 'PROVIDER_EMPTY_RESPONSE',
  BUDGET_EXCEEDED: 'PROVIDER_BUDGET_EXCEEDED'
};

/** 可自动重试的失败码（有界重试；其余需人工介入） */
const RETRYABLE = [
  ERROR_CODES.TIMEOUT, ERROR_CODES.RATE_LIMITED,
  ERROR_CODES.HTTP_ERROR, ERROR_CODES.NETWORK_ERROR
];

function isRetryable(code) {
  return RETRYABLE.indexOf(String(code || '')) !== -1;
}

/** HTTP 状态 → 结构化失败码 */
function classifyHttp(status) {
  const s = Number(status) || 0;
  if (s === 429) return ERROR_CODES.RATE_LIMITED;
  if (s >= 500) return ERROR_CODES.HTTP_ERROR;
  if (s >= 400) return ERROR_CODES.BAD_REQUEST;
  return ERROR_CODES.HTTP_ERROR;
}

/** 异常对象 → 结构化失败码（AbortError / timeout 归为 TIMEOUT） */
function classifyError(err) {
  const name = String((err && err.name) || '');
  const msg = String((err && err.message) || '');
  if (name === 'AbortError' || name === 'TimeoutError' || /abort|timed?\s*out|timeout/i.test(msg)) {
    return ERROR_CODES.TIMEOUT;
  }
  return ERROR_CODES.NETWORK_ERROR;
}

/** 读取响应头（兼容 fetch Headers 与普通对象） */
function headerGet(headers, key) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    const v = headers.get(key);
    return v === undefined ? null : v;
  }
  const lower = String(key).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === lower) return headers[k];
  }
  return null;
}

/**
 * 从响应头解析限流信息。
 * 只回填供应商**真实提供**的字段；缺失一律 null（不臆测配额）。
 */
function parseRateLimit(headers) {
  const num = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    limit: num(headerGet(headers, 'x-ratelimit-limit-requests') || headerGet(headers, 'x-ratelimit-limit')),
    remaining: num(headerGet(headers, 'x-ratelimit-remaining-requests') || headerGet(headers, 'x-ratelimit-remaining')),
    resetAt: headerGet(headers, 'x-ratelimit-reset-requests') || headerGet(headers, 'x-ratelimit-reset') || null,
    retryAfterSec: num(headerGet(headers, 'retry-after'))
  };
}

/**
 * 从供应商响应体提取费用回执。
 * 契约：只认供应商**显式回执**（如 json.cost / json.usage.cost）；否则 amount=null。
 */
function costReceipt(json) {
  const j = json || {};
  const cand = (j.cost && typeof j.cost === 'object') ? j.cost
    : ((j.usage && j.usage.cost && typeof j.usage.cost === 'object') ? j.usage.cost : null);
  if (cand && cand.amount !== undefined && cand.amount !== null) {
    return {
      amount: Number(cand.amount),
      currency: String(cand.currency || ''),
      confirmed: true,
      source: 'provider-receipt'
    };
  }
  return { amount: null, currency: '', confirmed: false, source: 'provider-absent' };
}

/** 单次调用的硬超时包装（AbortController；Node 18+ 全局 fetch 支持 signal） */
async function fetchWithTimeout(url, opts, timeoutMs) {
  const ms = Number(timeoutMs) > 0 ? Number(timeoutMs) : 30000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }));
    return res;
  } finally {
    clearTimeout(timer);
  }
}

/** 各 Provider 的 mode/密钥配置读取（密钥只在服务端；对外绝不回传） */
function providerConfig(kind) {
  const cfg = getMosConfig();
  if (kind === 'text') {
    const mode = String(cfg.integrations.textProvider || 'none').toLowerCase();
    const apiKey = (cfg.text && cfg.text.apiKey) || process.env.MOS_TEXT_API_KEY || '';
    return {
      kind: 'text', mode, apiKey, hasServerKey: !!apiKey,
      baseUrl: (cfg.text && cfg.text.baseUrl) || '',
      model: (cfg.text && cfg.text.model) || '',
      timeoutMs: (cfg.text && cfg.text.timeoutMs) || 30000
    };
  }
  const mode = String(cfg.integrations.imageProvider || 'none').toLowerCase();
  const apiKey = (cfg.image && cfg.image.apiKey) || process.env.MOS_IMAGE_API_KEY || '';
  return {
    kind: 'image', mode, apiKey, hasServerKey: !!apiKey,
    baseUrl: (cfg.image && cfg.image.baseUrl) || '',
    model: (cfg.image && cfg.image.model) || '',
    timeoutMs: (cfg.image && cfg.image.timeoutMs) || 60000
  };
}

/**
 * 构造一个统一的契约结果对象（所有 Provider 返回值都收敛到这里）。
 * @param {object} o { state, provider, mock, errorCode, note, usage, costReceipt, rateLimit, rawStatus }
 */
function contractResult(o) {
  const r = o || {};
  const errorCode = r.errorCode || '';
  return {
    state: String(r.state || 'FAILED'),
    provider: String(r.provider || ''),
    mock: !!r.mock,
    errorCode,
    retryable: errorCode ? isRetryable(errorCode) : false,
    note: String(r.note || ''),
    usage: r.usage || {},
    costReceipt: r.costReceipt || costReceipt(null),
    rateLimit: r.rateLimit || parseRateLimit(null),
    rawStatus: String(r.rawStatus || '')
  };
}

/**
 * 通用可用性探针。
 * @param {object} p providerConfig(...) 结果
 * @param {object} caps 能力声明 { supportsLiveProbe:boolean, probe?:async fn }
 */
async function healthOf(p, caps) {
  const base = {
    provider: p.kind + ':' + p.mode,
    mode: p.mode,
    configured: p.mode !== 'none' && !!p.mode && (p.mode !== 'openai' && p.mode !== 'deepseek' ? true : p.hasServerKey),
    hasServerKey: p.hasServerKey,
    timeoutMs: p.timeoutMs,
    state: 'NOT_CONFIGURED',
    note: ''
  };
  if (p.mode === 'none' || !p.mode) {
    base.state = 'NOT_CONFIGURED';
    base.note = '尚未配置模型：未发起任何出站调用（01 §4）。';
    return base;
  }
  if (p.mode === 'mock') {
    base.configured = true;
    base.state = 'MOCK';
    base.note = 'MOCK 适配器：确定性本地产出，不调用任何供应商。';
    return base;
  }
  if (!p.hasServerKey) {
    base.state = 'NOT_CONFIGURED';
    base.note = '已选择真实供应商但**未配置服务端密钥** → 保持 NOT_CONFIGURED（绝不伪造输出）。';
    return base;
  }
  base.state = 'CONFIGURED';
  base.note = '已配置服务端密钥（密钥不下发浏览器）。可用性取决于账号配额，未验证前不声称可生产使用。';
  if (caps && caps.supportsLiveProbe && typeof caps.probe === 'function') {
    try {
      const probe = await caps.probe();
      base.live = probe;
      base.state = probe && probe.ok ? 'HEALTHY' : 'UNHEALTHY';
      base.note = (probe && probe.note) || base.note;
    } catch (err) {
      base.state = 'UNHEALTHY';
      base.errorCode = classifyError(err);
      base.note = '真实探测失败：' + String((err && err.message) || err).slice(0, 200);
    }
  }
  return base;
}

module.exports = {
  ERROR_CODES, RETRYABLE, isRetryable,
  classifyHttp, classifyError, parseRateLimit, costReceipt,
  fetchWithTimeout, providerConfig, contractResult, healthOf
};
