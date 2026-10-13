'use strict';
/**
 * EventConsumer —— 变更事件消费者（B 包 01_CONSUMER_TASKS.md **B3**）。
 *
 * 职责：把 Provider 的 `/changes` 增量事件流变成**可持久化、可续传、幂等、可失效**的
 * 本地状态，从而使「撤回/停用/权限变更/Skill 版本变更」在营销侧**立即失效缓存**。
 *
 * ---- 六条硬约束（逐条对应 B3 原文）----
 *  ① **独立轮询作业**：不与业务请求耦合，由本模块自己的定时器驱动（默认**关闭**）。
 *  ② **持久化 seq 游标**：`db.library_event_cursors`，进程重启后续传，不从 0 重放。
 *  ③ **断线重试**：轮询失败按有界退避重试；连续失败进入 `degraded` 并触发 fail closed。
 *  ④ **事件幂等**：按 (brandId, seq) 去重，重复投递不重复产生副作用。
 *  ⑤ **按品牌处理**：品牌隔离事件只作用于该品牌的本地缓存；全局类事件作用于全部品牌。
 *  ⑥ **truncated 全量重验**：`truncated=true` 时**不能只依赖增量** —— 清空由事件累积的
 *     失效登记、把游标重置到 `oldestCursor`，并对该品牌做一次全量对账（重新拉取资产/Skill 现状）。
 *
 * ---- fail closed（不可妥协）----
 *   · 轮询不可达 → 该品牌 `authoritativeUsable = false`；
 *     此时**新的权威授权调用必须拒绝**，绝不静默沿用「上一次 Approved」结论。
 *   · 60 秒只是**建议轮询间隔**，不是已验收的撤回时延 SLA（C 包 02 节）——
 *     因此关键新调用一律**重新验证权限**（见 `assertUsable()`）。
 */
const { getMosConfig } = require('./config');
const store = require('./store');
const client = require('./workspace-client');
const { uid } = require('./ids');

const OWNER_ID = 'mos-event-consumer';
const LOCK_KEY = 'eventPollLock';
const MAX_PROCESSED_SEQ = 2000;
const MAX_CURSOR_ROWS = 64;

let state = { running: false, timer: null, lastTickAt: '', lastTickResult: null, ticks: 0 };

/* ==================== 游标持久化 ==================== */

function db0() { return store.getDb(); }

function cursorRows() {
  const db = db0();
  if (!Array.isArray(db.library_event_cursors)) db.library_event_cursors = [];
  return db.library_event_cursors;
}

function cursorRow(brandId) {
  const rows = cursorRows();
  let r = rows.find((x) => x.brandId === brandId);
  if (!r) {
    r = {
      id: uid('cur'), brandId, cursor: 0, nextCursor: 0, lastSeq: 0,
      processedSeqs: [], truncatedCount: 0, polls: 0, failures: 0,
      consecutiveFailures: 0, degraded: false, lastPollAt: '', lastEventAt: '',
      /* D-02 fail-safe：收到未识别事件类型 → 置位「需全量对账」（不清空既有登记） */
      reconcileRequired: false, reconcileReason: '', reconcileRequiredAt: '',
      reconcileRequiredSeq: 0, unhandledTypes: [], lastReconcileAt: '',
      lastErrorCode: '', lastErrorAt: '', lastFullResyncAt: '', createdAt: new Date().toISOString()
    };
    rows.push(r);
    if (rows.length > MAX_CURSOR_ROWS) rows.splice(0, rows.length - MAX_CURSOR_ROWS);
  }
  return r;
}

/** 已配置集成的品牌清单（游标只为这些品牌维护） */
function configuredBrands() {
  const w = getMosConfig().workspace || {};
  const brands = (w.brands || []).map(String).filter(Boolean);
  if (brands.length) return brands;
  // 未显式配置白名单时：回退到本侧实际存在的品牌（仅用于建立游标，不改变出站守卫）
  return (db0().brands || []).map((b) => b.code).filter(Boolean);
}

/* ==================== 单实例锁（与采集调度同构） ==================== */

function lockOf() { return db0().settings ? db0().settings[LOCK_KEY] : null; }

function lockIsStale(lock, staleMinutes) {
  if (!lock || !lock.heartbeatAt) return true;
  const t = Date.parse(lock.heartbeatAt);
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) > staleMinutes * 60 * 1000;
}

function acquireLock() {
  const db = db0();
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  const staleMinutes = 10;
  const existing = lockOf();
  if (existing && existing.ownerId !== OWNER_ID && !lockIsStale(existing, staleMinutes)) {
    return { ok: false, code: 'LOCK_HELD_BY_OTHER_INSTANCE', lock: existing };
  }
  db.settings[LOCK_KEY] = {
    ownerId: OWNER_ID, pid: process.pid,
    acquiredAt: (existing && existing.ownerId === OWNER_ID && existing.acquiredAt) || new Date().toISOString(),
    heartbeatAt: new Date().toISOString()
  };
  store.save();
  return { ok: true, lock: db.settings[LOCK_KEY] };
}

function heartbeatLock() {
  const db = db0();
  if (db.settings && db.settings[LOCK_KEY] && db.settings[LOCK_KEY].ownerId === OWNER_ID) {
    db.settings[LOCK_KEY].heartbeatAt = new Date().toISOString();
    store.save();
  }
}

function releaseLock() {
  const db = db0();
  if (db.settings && db.settings[LOCK_KEY] && db.settings[LOCK_KEY].ownerId === OWNER_ID) {
    delete db.settings[LOCK_KEY];
    store.save();
  }
}

/* ==================== 事件 → 失效 ==================== */

/** 从事件 data 中尽力取出目标 ID（事件只带 ID 级字段，不携带标题/正文） */
function targetIdOf(data) {
  const d = data || {};
  return String(d.libraryAssetId || d.assetId || d.documentId || d.skillId || d.id || '');
}

/**
 * 处理单条事件（**幂等**：同一 (brandId,seq) 重复投递不再产生副作用）。
 * @returns {{applied:boolean, reason:string, effects:string[]}}
 */
function applyEvent(brandId, evt) {
  const row = cursorRow(brandId);
  const seq = Number(evt && evt.seq);
  if (!Number.isFinite(seq)) return { applied: false, reason: 'NO_SEQ', effects: [] };
  if (row.processedSeqs.indexOf(seq) !== -1) {
    return { applied: false, reason: 'DUPLICATE_SEQ', effects: [] };
  }
  const type = String(evt.type || '');
  const data = evt.data || {};
  const effects = [];

  switch (type) {
    case 'asset.revoked':
    case 'asset.deprecated': {
      const id = targetIdOf(data);
      if (id) {
        client.invalidate(type, id, { brandId, seq, type });
        invalidateLocalRefs(brandId, id, type);
        effects.push(type + ':' + id);
      }
      break;
    }
    case 'skill.version.changed': {
      const id = targetIdOf(data);
      if (id) {
        client.invalidate('skill.version.changed', id, { brandId, seq, version: data.version || '' });
        effects.push('skill.version.changed:' + id);
      }
      break;
    }
    case 'permission.changed': {
      // 权限矩阵变动：票据上的 scope 可能已变 → 全部丢弃，强制重新换票
      const n = client.dropAllTickets('权限变更事件 seq=' + seq);
      invalidateBrandRefs(brandId, 'permission.changed');
      client.invalidate('permission.changed', brandId, { brandId, seq });
      effects.push('permission.changed:droppedTickets=' + n);
      break;
    }
    case 'service_account.changed': {
      // 服务账户登记/轮换/撤销：本侧票据可能已失效（票据与签发账户绑定）
      const n = client.dropAllTickets('服务账户变更事件 seq=' + seq);
      effects.push('service_account.changed:droppedTickets=' + n);
      break;
    }
    case 'policy.version.changed': {
      effects.push('policy.version.changed:' + String(data.policyVersion || data.version || ''));
      break;
    }
    case 'admission.state.changed': {
      effects.push('admission.state.changed:' + String(data.admissionRequestId || ''));
      break;
    }
    default:
      /* **D-02 消费方正式约定**：事件类型是**冻结枚举**，新增/改名属契约变更。
       * 遇到未识别类型**不得静默忽略** —— 必须视为「契约外变更」并触发**一次全量对账**，
       * 与 `truncated=true` 走同一条 fail-safe 路径（D-09.4）。
       * 但**不**因此清空既有失效登记：未知事件不代表既有结论作废，而是"当前认知不完整"，
       * 故只置位重验标记 + 登记可审计条目，由轮询/运维侧执行全量重验。 */
      {
        markReconcileNeeded(brandId, seq, type);
        effects.push('unhandled:' + type + ':reconcile_required');
      }
  }

  row.processedSeqs.push(seq);
  if (row.processedSeqs.length > MAX_PROCESSED_SEQ) {
    row.processedSeqs.splice(0, row.processedSeqs.length - MAX_PROCESSED_SEQ);
  }
  row.lastSeq = Math.max(row.lastSeq, seq);
  row.lastEventAt = new Date().toISOString();
  store.save();
  return { applied: true, reason: 'APPLIED', effects };
}

/**
 * 未识别事件类型 → 置位「需全量对账」（D-02 / D-09.4 fail-safe）。
 *
 * 与 `truncated=true` 的区别：`truncated` 意味着**事件窗口**不完整，必须清空事件累积的
 * 失效登记并重放；未知类型只意味着**认知**不完整（可能有我们未实现的契约变更），
 * 因此只置位 + 留痕，不擅自作废既有结论。
 */
function markReconcileNeeded(brandId, seq, type) {
  const row = cursorRow(brandId);
  row.reconcileRequired = true;
  row.reconcileReason = 'UNKNOWN_EVENT_TYPE:' + String(type || '').slice(0, 80);
  row.reconcileRequiredAt = new Date().toISOString();
  row.reconcileRequiredSeq = Number(seq) || 0;
  row.unhandledTypes = (row.unhandledTypes || []).concat([String(type || '')]).slice(-20);
  store.save();
  return { ok: true };
}

/** 全量对账完成 → 清除置位（由运维/轮询侧在真正重验所有资产后调用） */
function clearReconcileNeeded(brandId, reason) {
  const row = cursorRow(brandId);
  row.reconcileRequired = false;
  row.reconcileReason = '';
  row.lastReconcileAt = new Date().toISOString();
  row.lastReconcileNote = String(reason || '').slice(0, 200);
  store.save();
  return { ok: true, brandId };
}

/** 把本地引用标记为失效（撤回/停用后**不得**再被新调用复用） */
function invalidateLocalRefs(brandId, libraryId, reason) {
  const db = db0();
  let n = 0;
  for (const r of (db.library_asset_refs || [])) {
    if (r.brandCode !== brandId) continue;
    if (String(r.libraryId || '') !== String(libraryId)) continue;
    if (r.state === 'INVALIDATED') continue;
    r.state = 'INVALIDATED';
    r.permissionValid = false;
    r.assetState = 'REVOKED';
    r.invalidatedAt = new Date().toISOString();
    r.invalidateReason = String(reason);
    n += 1;
  }
  if (n) store.save();
  return n;
}

function invalidateBrandRefs(brandId, reason) {
  const db = db0();
  let n = 0;
  for (const r of (db.library_asset_refs || [])) {
    if (r.brandCode !== brandId || r.state === 'INVALIDATED') continue;
    r.state = 'INVALIDATED';
    r.permissionValid = false;
    r.invalidatedAt = new Date().toISOString();
    r.invalidateReason = String(reason);
    n += 1;
  }
  if (n) store.save();
  return n;
}

/* ==================== 轮询 ==================== */

/**
 * 轮询一个品牌一次。
 * `truncated=true` → 全量重验（B3 第 6 条）：清空事件累积的失效登记 + 游标重置到 oldestCursor。
 */
async function pollBrand(brandId, opts) {
  const o = opts || {};
  const row = cursorRow(brandId);
  const w = getMosConfig().workspace || {};
  /* 用户身份：`o.userId`（MOS user.id）→ 资料库真实用户。未映射 / 未配置 → 零出站如实失败。
   * 绝不用匿名或服务身份顶替：Provider 的票据是**绑人**的，冒用会污染审计轨迹。 */
  const who = client.resolveProviderUser(o.userId);
  if (!who.ok) {
    row.failures += 1;
    row.consecutiveFailures += 1;
    row.lastErrorCode = 'NO_PROVIDER_USER_MAPPING';
    row.lastErrorAt = new Date().toISOString();
    if (row.consecutiveFailures >= 2) row.degraded = true;
    store.save();
    return { ok: false, brandId, errorCode: 'NO_PROVIDER_USER_MAPPING',
      consecutiveFailures: row.consecutiveFailures, degraded: row.degraded,
      note: who.note || '未配置「MOS 用户 → 资料库真实用户」映射：未发起任何轮询出站。' };
  }
  const from = o.cursor === undefined ? row.cursor : Number(o.cursor);
  const r = await client.listChanges({
    brandId,
    cursor: Number.isFinite(from) ? from : 0,
    limit: Number(w.pollLimit || 200),
    userId: who.userId,
    purpose: o.purpose || '变更事件轮询'
  });
  row.polls += 1;
  row.lastPollAt = new Date().toISOString();

  if (!r.ok) {
    row.failures += 1;
    row.consecutiveFailures += 1;
    row.lastErrorCode = r.errorCode || 'POLL_FAILED';
    row.lastErrorAt = new Date().toISOString();
    // 连续失败 → 进入 degraded，触发 fail closed
    if (row.consecutiveFailures >= 2) row.degraded = true;
    store.save();
    return { ok: false, brandId, errorCode: row.lastErrorCode, httpStatus: r.httpStatus,
      consecutiveFailures: row.consecutiveFailures, degraded: row.degraded, note: r.note || '' };
  }

  row.consecutiveFailures = 0;
  row.degraded = false;
  row.lastErrorCode = '';
  const data = r.data || {};
  const items = Array.isArray(data.items) ? data.items : [];
  const effects = [];
  let applied = 0;
  for (const evt of items) {
    const res = applyEvent(brandId, evt);
    if (res.applied) { applied += 1; effects.push.apply(effects, res.effects); }
  }

  const truncated = data.truncated === true;
  if (truncated) {
    // 全量重验：增量已不可信
    row.truncatedCount += 1;
    row.lastFullResyncAt = new Date().toISOString();
    client.clearInvalidations('truncated=true，游标落后于保留窗口，执行全量重验');
    row.processedSeqs = [];
    row.cursor = Number.isFinite(Number(data.oldestCursor)) ? Number(data.oldestCursor) : Number(data.nextCursor || row.cursor);
    /* 这里就是一次真正的全量对账 —— 顺带清掉「未识别事件类型」置位的重验标记 */
    clearReconcileNeeded(brandId, 'truncated=true 触发全量重验');
  } else if (Number.isFinite(Number(data.nextCursor))) {
    row.cursor = Number(data.nextCursor);
  }
  row.nextCursor = Number.isFinite(Number(data.nextCursor)) ? Number(data.nextCursor) : row.cursor;
  store.save();

  return {
    ok: true, brandId, items: items.length, applied, effects: effects.slice(0, 50),
    truncated, cursor: row.cursor, nextCursor: row.nextCursor,
    hasMore: data.hasMore === true, eventTypes: Array.from(new Set(items.map((e) => e.type))),
    reconcileRequired: row.reconcileRequired === true,
    reconcileReason: row.reconcileReason || '',
    requestId: r.requestId || ''
  };
}

/** 轮询一轮（所有已配置品牌） */
async function tick(opts) {
  const o = opts || {};
  const w = getMosConfig().workspace || {};
  const now = o.now ? new Date(o.now) : new Date();
  if (!client.isConfigured()) {
    return { ok: false, skipped: true, reason: 'INTEGRATION_NOT_CONFIGURED',
      note: '企业资料库集成未配置或未通过出站守卫：未发起任何轮询出站。', at: now.toISOString() };
  }
  const brands = Array.isArray(o.brands) && o.brands.length ? o.brands : configuredBrands();
  const lock = acquireLock();
  if (!lock.ok) return { ok: false, skipped: true, reason: lock.code, note: '另一实例持有轮询锁', at: now.toISOString() };
  heartbeatLock();

  const results = [];
  for (const b of brands) {
    try { results.push(await pollBrand(b, o)); }
    catch (err) {
      results.push({ ok: false, brandId: b, errorCode: 'POLL_EXCEPTION', note: String(err && err.message || err).slice(0, 200) });
    }
  }
  state.ticks += 1;
  state.lastTickAt = now.toISOString();
  const out = {
    ok: results.every((r) => r.ok), at: now.toISOString(),
    intervalSeconds: Number(w.pollIntervalSeconds || 60),
    brands: results,
    totalItems: results.reduce((n, r) => n + (r.items || 0), 0),
    truncatedBrands: results.filter((r) => r.truncated).map((r) => r.brandId)
  };
  state.lastTickResult = out;
  heartbeatLock();
  return out;
}

/* ==================== fail closed：权威可用性判定 ==================== */

/**
 * 该品牌当前的**权威可用性**。任何「新的权威授权调用 / 复用既有 Approved 缓存」
 * 之前都必须过这一关。
 *
 * @returns {{usable:boolean, reason:string, requireRevalidate:boolean}}
 */
function authoritativeUsable(brandId) {
  if (!client.isConfigured()) {
    return { usable: false, reason: 'INTEGRATION_NOT_CONFIGURED', requireRevalidate: true,
      note: '资料库集成未配置：不得执行任何权威授权动作。' };
  }
  const row = cursorRow(brandId);
  if (row.degraded) {
    return { usable: false, reason: 'EVENT_STREAM_DEGRADED', requireRevalidate: true,
      note: '变更事件流已连续失败 ' + row.consecutiveFailures + ' 次（' + row.lastErrorCode + '）：'
        + '按 fail closed 原则，拒绝新的权威授权调用，也不得沿用本地缓存的「上一次 Approved」结论。' };
  }
  return { usable: true, reason: 'OK', requireRevalidate: true,
    note: '权威可用。注意：60s 轮询仅是**建议间隔**，不是撤回时延 SLA —— '
      + '关键新调用仍须向 Provider **重新验证**授权（见 verifyAssetUsable）。' };
}

/**
 * 使用既有可复用资产前的**重新验证**（B3「新创作使用/下载必须重新验证授权」）。
 * 不依赖轮询缓存：直接向 Provider 解析该资产当前状态。
 */
async function verifyAssetUsable(brandId, libraryAssetId, opts) {
  const o = opts || {};
  const gate = authoritativeUsable(brandId);
  if (!gate.usable) return Object.assign({ ok: false, usable: false }, gate);
  if (client.isInvalidated('asset.revoked', libraryAssetId)
    || client.isInvalidated('asset.deprecated', libraryAssetId)
    || client.isInvalidated('asset.not_found', libraryAssetId)) {
    return { ok: false, usable: false, reason: 'INVALIDATED_LOCALLY',
      note: '该资产已被变更事件标记为撤回/停用/不可见：**不得**再用于新创作或下载。' };
  }
  /* 用户身份必须映射到**资料库真实用户**：o.userId 是 MOS 侧 user.id，
   * 直接发给 Provider 会得到 404 USER_NOT_FOUND（且会被误读成"资产不存在"）。
   * 未配置映射时如实拒绝，绝不用服务身份顶替。 */
  const who = client.resolveProviderUser(o.userId);
  if (!who.ok) {
    return { ok: false, usable: false, reason: 'NO_PROVIDER_USER_MAPPING',
      note: who.note || '未配置「MOS 用户 → 资料库真实用户」映射：零出站拒绝。' };
  }
  const r = await client.getAsset(libraryAssetId, {
    brandId, userId: who.userId, purpose: o.purpose || '使用前重新验证', scopes: ['assets.read']
  });
  if (r.ok) {
    return { ok: true, usable: (r.data || {}).isReusable === true, reason: 'PROVIDER_VERIFIED',
      data: r.data, httpStatus: r.httpStatus, requestId: r.requestId };
  }
  const gone = r.errorCode === 'ASSET_GONE';
  if (gone) client.invalidate('asset.revoked', libraryAssetId, { brandId, source: 'verifyAssetUsable' });
  /* D-09.3：Provider 对**非治理身份**解析已撤回资产返回 404（与非营销/无权资产不可区分）。
   * 该视角下正确语义是「视为不存在」——同样必须立即失效，但**单独登记**，
   * 不得与治理视角的 410 混记，否则审计会失真。 */
  if (r.errorCode === 'NOT_FOUND') {
    client.invalidate('asset.not_found', libraryAssetId, { brandId, source: 'verifyAssetUsable', httpStatus: r.httpStatus });
  }
  return { ok: false, usable: false, reason: r.errorCode || 'PROVIDER_REJECTED',
    httpStatus: r.httpStatus, errorCode: r.errorCode, note: r.note || '' };
}

/* ==================== 启停 ==================== */

function start() {
  const w = getMosConfig().workspace || {};
  if (w.pollEnabled !== true) {
    return { started: false, ok: false, reason: 'POLL_DISABLED',
      note: '事件轮询默认关闭（需 MOS_WORKSPACE_POLL_ENABLED=1 或 config.json 显式开启）。' };
  }
  if (state.running) return { started: false, ok: false, reason: 'ALREADY_RUNNING', note: '已在运行。' };
  const intervalMs = Math.max(5, Number(w.pollIntervalSeconds || 60)) * 1000;
  state.timer = setInterval(() => {
    tick({}).catch((err) => console.error('[mos-event] 轮询异常：' + (err && err.message ? err.message : err)));
  }, intervalMs);
  if (state.timer.unref) state.timer.unref();
  state.running = true;
  return { started: true, ok: true, intervalSeconds: intervalMs / 1000,
    note: '按品牌持久化游标轮询 /changes；truncated 触发全量重验；失败即 fail closed。' };
}

function stop() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  state.running = false;
  releaseLock();
  return { ok: true };
}

function status() {
  const w = getMosConfig().workspace || {};
  const rows = (db0().library_event_cursors) || [];
  return {
    provider: 'mos.event-consumer',
    running: state.running,
    enabled: w.pollEnabled === true,
    intervalSeconds: Number(w.pollIntervalSeconds || 60),
    ticks: state.ticks,
    lastTickAt: state.lastTickAt,
    lastTickResult: state.lastTickResult,
    clientConfigured: client.isConfigured(),
    cursors: rows.map((r) => ({
      brandId: r.brandId, cursor: r.cursor, lastSeq: r.lastSeq,
      polls: r.polls, failures: r.failures, consecutiveFailures: r.consecutiveFailures,
      degraded: r.degraded, truncatedCount: r.truncatedCount,
      reconcileRequired: r.reconcileRequired === true,
      reconcileReason: r.reconcileReason || '',
      unhandledTypes: (r.unhandledTypes || []).slice(-10),
      lastReconcileAt: r.lastReconcileAt || '',
      lastPollAt: r.lastPollAt, lastErrorCode: r.lastErrorCode,
      lastFullResyncAt: r.lastFullResyncAt
    })),
    note: '轮询间隔 60s 是 Provider **建议值**，不是已验收的撤回时延 SLA；'
      + '关键新调用一律走 verifyAssetUsable() 重新验证授权。'
      + '收到未识别事件类型（契约外变更）会置位 reconcileRequired 并要求一次全量对账，不静默忽略。'
  };
}

module.exports = {
  tick, pollBrand, applyEvent, start, stop, status,
  authoritativeUsable, verifyAssetUsable,
  cursorRow, configuredBrands, invalidateLocalRefs, invalidateBrandRefs,
  markReconcileNeeded, clearReconcileNeeded,
  OWNER_ID, LOCK_KEY
};
