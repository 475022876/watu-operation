'use strict';
/**
 * Provider 调用账本（V0.1.4 真实接入 · 日志与错误处理 / 费用控制）。
 *
 * 为什么单开一个集合而不是复用 `audit_events`：
 *  - 审计关注"谁在什么时候做了什么业务动作"，保留期与合规口径不同；
 *  - 调用账本关注"每次外部调用花了多少、失败几次、耗时多少"，量级大（滚动保留 2000 条），
 *    且需要按供应商/模型/品牌做聚合。
 *
 * 三条硬约束：
 *  1. **只记事实**：失败就记失败与原始错误码，不做"重试后成功就抹掉失败"的美化。
 *  2. **费用只用回执**：`cost.amount` 仅在供应商真实回执时非空；否则 `confirmed:false` 且不参与求和。
 *  3. **全字段脱敏**：落库前统一过 `secrets.redact()`，密钥类内容不可能进入日志。
 */
const { getDb, save } = require('./store');
const { uid } = require('./ids');
const secrets = require('./secrets');

const MAX_ENTRIES = 2000;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 记录一次调用。
 * @param {object} e
 *  { kind, op, provider, model, state, errorCode, retryable, httpStatus, latencyMs, attempts,
 *    usage:{promptTokens,completionTokens,totalTokens}, cost:{amount,currency,confirmed},
 *    actorId, brandCode, requestId, dataClass, note }
 */
function record(e) {
  const x = e || {};
  const db = getDb();
  if (!Array.isArray(db.provider_calls)) db.provider_calls = [];

  const usage = x.usage || {};
  const cost = x.cost || {};
  const entry = {
    id: uid('pcall'),
    at: new Date().toISOString(),
    kind: String(x.kind || ''),
    op: String(x.op || ''),
    provider: String(x.provider || ''),
    model: String(x.model || ''),
    state: String(x.state || 'FAILED'),
    errorCode: String(x.errorCode || ''),
    retryable: !!x.retryable,
    httpStatus: x.httpStatus === undefined || x.httpStatus === null ? null : Number(x.httpStatus),
    latencyMs: num(x.latencyMs),
    attempts: num(x.attempts) || 1,
    usage: {
      promptTokens: num(usage.promptTokens),
      completionTokens: num(usage.completionTokens),
      totalTokens: num(usage.totalTokens)
    },
    cost: {
      amount: num(cost.amount),
      currency: String(cost.currency || ''),
      confirmed: !!cost.confirmed
    },
    actorId: String(x.actorId || ''),
    brandCode: String(x.brandCode || ''),
    requestId: String(x.requestId || ''),
    dataClass: String(x.dataClass || ''),
    note: secrets.redactText(String(x.note || '')).slice(0, 400)
  };

  db.provider_calls.push(entry);
  if (db.provider_calls.length > MAX_ENTRIES) {
    db.provider_calls = db.provider_calls.slice(-MAX_ENTRIES);
  }
  save();
  return entry;
}

function list(filter) {
  const f = filter || {};
  const db = getDb();
  let items = Array.isArray(db.provider_calls) ? db.provider_calls.slice() : [];
  if (f.kind) items = items.filter((x) => x.kind === f.kind);
  if (f.brandCode) items = items.filter((x) => x.brandCode === f.brandCode);
  if (f.since) items = items.filter((x) => x.at >= f.since);
  items.sort((a, b) => (a.at < b.at ? 1 : -1));
  const limit = Math.min(Math.max(Number(f.limit) || 50, 1), 500);
  return items.slice(0, limit);
}

function percentile(arr, p) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[i];
}

/**
 * 聚合统计。
 * @param {{days?:number, brandCode?:string}} opts
 */
function summarize(opts) {
  const o = opts || {};
  const days = Math.min(Math.max(Number(o.days) || 30, 1), 365);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const db = getDb();
  let items = (Array.isArray(db.provider_calls) ? db.provider_calls : []).filter((x) => x.at >= since);
  if (o.brandCode) items = items.filter((x) => x.brandCode === o.brandCode);

  const byKind = {};
  const byProvider = {};
  const latencies = [];
  let ok = 0;
  let failed = 0;
  let retried = 0;
  let costConfirmed = 0;
  let costUnknown = 0;
  const currency = new Set();

  for (const x of items) {
    const k = x.kind || 'unknown';
    if (!byKind[k]) byKind[k] = { calls: 0, ok: 0, failed: 0, tokens: 0, costConfirmed: 0, costUnknown: 0 };
    const b = byKind[k];
    b.calls += 1;
    if (x.state === 'SUCCEEDED' || x.state === 'MOCK') { b.ok += 1; ok += 1; } else { b.failed += 1; failed += 1; }
    if ((x.attempts || 1) > 1) retried += 1;
    const tk = (x.usage && x.usage.totalTokens) || 0;
    b.tokens += tk;
    if (x.cost && x.cost.confirmed && x.cost.amount !== null) {
      b.costConfirmed += x.cost.amount;
      costConfirmed += x.cost.amount;
      if (x.cost.currency) currency.add(x.cost.currency);
    } else if (x.state === 'SUCCEEDED') {
      b.costUnknown += 1;
      costUnknown += 1;
    }
    if (typeof x.latencyMs === 'number') latencies.push(x.latencyMs);

    const pk = (x.provider || '') + (x.model ? '/' + x.model : '');
    if (!byProvider[pk]) byProvider[pk] = { calls: 0, ok: 0, failed: 0 };
    byProvider[pk].calls += 1;
    if (x.state === 'SUCCEEDED' || x.state === 'MOCK') byProvider[pk].ok += 1;
    else byProvider[pk].failed += 1;
  }

  const total = items.length;
  return {
    days,
    since,
    total,
    ok,
    failed,
    retried,
    errorRate: total ? Number((failed / total).toFixed(4)) : 0,
    latency: {
      p50: percentile(latencies, 50),
      p95: percentile(latencies, 95),
      max: latencies.length ? Math.max.apply(null, latencies) : null
    },
    cost: {
      confirmedSum: Number(costConfirmed.toFixed(4)),
      currency: Array.from(currency)[0] || '',
      unknownCount: costUnknown,
      note: 'confirmedSum 仅累加供应商回执中明确给出的金额；未回执的调用计入 unknownCount，绝不按单价推算。'
    },
    byKind,
    byProvider,
    recent: items.slice(0, 20)
  };
}

/** 是否已有**真实成功**证据（用于就绪度从 CONFIGURED_NOT_TESTED 晋级 REAL） */
function successEvidence(kind, opts) {
  const o = opts || {};
  const days = Number(o.days) || 30;
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const db = getDb();
  const items = (Array.isArray(db.provider_calls) ? db.provider_calls : [])
    .filter((x) => x.at >= since && x.kind === kind && x.state === 'SUCCEEDED');
  const hit = o.fingerprint
    ? items.find((x) => (x.note || '').indexOf('kf=' + o.fingerprint) !== -1)
    : items[0];
  return hit ? { at: hit.at, provider: hit.provider, model: hit.model, id: hit.id } : null;
}

function clear() {
  const db = getDb();
  db.provider_calls = [];
  save();
}

module.exports = { MAX_ENTRIES, record, list, summarize, successEvidence, clear };
