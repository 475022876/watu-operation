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
const provideradmin = require('./provideradmin');

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
  return require('./provider-http').request(url, opts, timeoutMs);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

/** 退避时长：优先用供应商的 Retry-After，否则指数退避（有上限，绝不死循环） */
function backoffMs(rateLimit, attempt, baseDelayMs, capDelayMs) {
  const cap = Number(capDelayMs) || 8000;
  const sec = rateLimit && rateLimit.retryAfterSec;
  if (Number.isFinite(sec) && sec >= 0) return Math.min(sec * 1000, cap);
  const base = Number(baseDelayMs) || 400;
  const n = Math.max(1, Number(attempt) || 1);
  return Math.min(base * Math.pow(2, n - 1), cap);
}

/**
 * 有界重试执行器。
 *
 * 语义（与 04 §6 一致，不做"无限重试"也不做"失败即静默"）：
 *  - 只有 `retryable` 的失败码才重试（TIMEOUT / RATE_LIMITED / HTTP_ERROR / NETWORK_ERROR）；
 *  - 尝试次数 = 1 + maxRetries，**上限 3 次重试**（配置层已钳制）；
 *  - 每次重试前按 Retry-After 或指数退避等待；最终返回值带 `attempts`，供账本如实记录。
 *
 * @param {(attempt:number)=>Promise<object>} fn 返回契约结果对象（含 errorCode / rateLimit）
 * @param {{maxRetries?:number, baseDelayMs?:number, capDelayMs?:number, shouldRetry?:Function}} opts
 */
async function withRetry(fn, opts) {
  const o = opts || {};
  const maxRetries = Math.min(Math.max(Number(o.maxRetries) || 0, 0), 3);
  let attempt = 0;
  let last = null;
  while (attempt <= maxRetries) {
    attempt += 1;
    /* eslint-disable no-await-in-loop */
    last = await fn(attempt);
    if (!last || !last.errorCode || !isRetryable(last.errorCode) || attempt > maxRetries) {
      if (last && typeof last === 'object') last.attempts = attempt;
      return last;
    }
    if (typeof o.shouldRetry === 'function' && !o.shouldRetry(last)) {
      last.attempts = attempt;
      return last;
    }
    await sleep(backoffMs(last.rateLimit, attempt, o.baseDelayMs, o.capDelayMs));
  }
  if (last) last.attempts = attempt;
  return last;
}

/** 从响应体提取 token 用量（OpenAI / Anthropic / Gemini 三种命名都认；缺失一律 null） */
function usageOf(json) {
  const j = json || {};
  const u = j.usage || j.usageMetadata || {};
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  const prompt = n(u.prompt_tokens !== undefined ? u.prompt_tokens : (u.input_tokens !== undefined ? u.input_tokens : u.promptTokenCount));
  const completion = n(u.completion_tokens !== undefined ? u.completion_tokens : (u.output_tokens !== undefined ? u.output_tokens : u.candidatesTokenCount));
  const total = n(u.total_tokens !== undefined ? u.total_tokens : u.totalTokenCount)
    || (prompt !== null || completion !== null ? (prompt || 0) + (completion || 0) : null);
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

/**
 * 各 Provider 的 mode/密钥配置读取。
 *
 * **唯一权威来源是 `provideradmin.effective(kind)`**（环境变量 > 管理页加密配置 > config.json），
 * 这样"管理页保存"与"适配器实际调用"不会各读一套配置而产生漂移（v0.1.4 修复点）。
 * 密钥只在服务端内存中存在，对外绝不回传。
 */
function providerConfig(kind) {
  const e = provideradmin.effective(kind === 'image' || kind === 'text' || kind === 'video' || kind === 'websearch'
    ? kind : 'text');
  return {
    kind: e.kind,
    mode: e.mode,
    apiKey: e.apiKey,
    hasServerKey: e.hasKey,
    keyFingerprint: e.keyFingerprint,
    baseUrl: e.baseUrl,
    model: e.model,
    timeoutMs: e.timeoutMs,
    maxRetries: e.maxRetries,
    maxResults: e.maxResults,
    cx: e.cx,
    pricePerMTokIn: e.pricePerMTokIn,
    pricePerMTokOut: e.pricePerMTokOut
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
  const needsKey = (() => {
    try { return !!provideradmin.effective(p.kind).needsKey; } catch (_) { return p.mode === 'openai' || p.mode === 'deepseek'; }
  })();
  const base = {
    provider: p.kind + ':' + p.mode,
    mode: p.mode,
    configured: p.mode !== 'none' && !!p.mode && (!needsKey || p.hasServerKey),
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
  fetchWithTimeout, providerConfig, contractResult, healthOf,
  sleep, backoffMs, withRetry, usageOf
};
