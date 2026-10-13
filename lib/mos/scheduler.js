'use strict';
/**
 * Marketing OS —— 轻量情报采集调度器（A-01）。
 *
 * 设计目标（对应 02 §5 / 04 §3、整改 A-01）：
 *   · **默认关闭**（`mos.scheduler.enabled=false`）：未获得运营授权时不自动出站；
 *   · **cron-like 间隔**：按分钟级固定间隔巡检「到期来源」，不引入 cron 依赖（零依赖约束）；
 *   · **持久化任务记录**：每次执行（含跳过/失败）落 `ingest_jobs`，带开始/结束/状态/
 *     失败理由/下一次时间 —— 见 `lib/mos/ingest.js`；
 *   · **幂等去重**：同一来源在同一时间桶（bucket）内只执行一次，**跨进程重启同样成立**
 *     （桶键持久化在作业记录里），因此重启后不会「凭空补发大量任务」；
 *   · **失败退避**：瞬时失败按指数退避写入 `source.nextRunAt`；永久失败（白名单/SSRF/协议）
 *     不自动重试并停用该来源；
 *   · **开关与锁**：`mos.scheduler.enabled` 总开关 + `db.settings.ingestLock` 单实例锁；
 *   · **仅授权 allowlist 来源**：`ingest.schedulableReason()` 逐条判定，
 *     域名不在白名单 / 未 ACTIVE / 频率 MANUAL 的来源**不会**被调度。
 *
 * ⚠ 单实例限制（明确声明，不隐瞒）：
 *   本项目使用**单文件 JSON** 存储（见 `store.js` 头注释），**只支持单实例运行**。
 *   调度器因此使用「数据库内锁记录 + 心跳」防止**第二个实例**同时采集：
 *   当锁的持有者仍存活（心跳未过期）时，本实例拒绝执行并如实上报 `LOCK_HELD_BY_OTHER_INSTANCE`。
 *   多实例横向扩展属生产化议题（P2，需先替换为真实数据库），本轮**不假装支持**。
 */
const store = require('./store');
const { getMosConfig } = require('./config');
const { uid } = require('./ids');
const ingest = require('./ingest');

/** 本进程启动标识（防止同 pid 复用造成锁误判） */
const BOOT_ID = uid('boot').slice(-10);
const OWNER_ID = String(process.pid) + '-' + BOOT_ID;

/** 模块状态（不持久化；锁与作业记录才持久化） */
const state = {
  started: false,
  enabled: false,
  timer: null,
  intervalMinutes: 0,
  lastTickAt: null,
  lastTickSummary: null,
  tickCount: 0,
  lastError: '',
  lockHeld: false
};

function schedCfg() {
  const cfg = getMosConfig();
  const s = cfg.scheduler || {};
  return {
    enabled: s.enabled === true,
    intervalMinutes: Math.max(1, Number(s.intervalMinutes) || 60),
    maxPerTick: Math.max(1, Math.min(20, Number(s.maxPerTick) || 3)),
    lockStaleMinutes: Math.max(2, Number(s.lockStaleMinutes) || 10)
  };
}

/* ==================== 单实例锁 ==================== */

function lockOf(db) {
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  return db.settings.ingestLock || null;
}

function lockIsStale(lock, staleMinutes) {
  if (!lock || !lock.heartbeatAt) return true;
  const t = Date.parse(lock.heartbeatAt);
  if (!Number.isFinite(t)) return true;
  return (Date.now() - t) > staleMinutes * 60 * 1000;
}

/**
 * 尝试取得调度锁。
 * @returns {{ok:boolean, code?:string, lock?:object}}
 */
function acquireLock(db) {
  const { lockStaleMinutes } = schedCfg();
  const existing = lockOf(db);
  if (existing && existing.ownerId !== OWNER_ID && !lockIsStale(existing, lockStaleMinutes)) {
    return { ok: false, code: 'LOCK_HELD_BY_OTHER_INSTANCE', lock: existing };
  }
  const lock = {
    ownerId: OWNER_ID,
    pid: process.pid,
    bootId: BOOT_ID,
    note: '单文件存储只支持单实例；该锁用于阻止第二个实例同时采集。',
    acquiredAt: (existing && existing.ownerId === OWNER_ID && existing.acquiredAt) || new Date().toISOString(),
    heartbeatAt: new Date().toISOString()
  };
  db.settings.ingestLock = lock;
  state.lockHeld = true;
  return { ok: true, lock };
}

function heartbeat(db) {
  const lock = lockOf(db);
  if (lock && lock.ownerId === OWNER_ID) {
    lock.heartbeatAt = new Date().toISOString();
    state.lockHeld = true;
  }
}

function releaseLock(db) {
  const lock = lockOf(db);
  if (lock && lock.ownerId === OWNER_ID) {
    db.settings.ingestLock = null;
    state.lockHeld = false;
    try { store.saveNow(); } catch (_) { /* ignore */ }
    return true;
  }
  state.lockHeld = false;
  return false;
}

/* ==================== 调度执行 ==================== */

/**
 * 执行一轮巡检（可由定时器或手工 API 触发，两者行为完全一致）。
 * @param {object} opts { now, maxPerTick, trigger }
 * @returns {Promise<object>} 本轮摘要
 */
async function tick(opts) {
  const o = opts || {};
  const cfg = schedCfg();
  const nowMs = Number(o.now) || Date.now();
  const trigger = 'SCHEDULED';
  const db = store.getDb();

  if (!db.source_registry || !db.source_registry.length) {
    const summary = { at: new Date(nowMs).toISOString(), considered: 0, ran: 0, skipped: 0, results: [], codes: [] };
    state.lastTickAt = summary.at;
    state.lastTickSummary = summary;
    return summary;
  }

  const lock = acquireLock(db);
  if (!lock.ok) {
    const summary = {
      at: new Date(nowMs).toISOString(), considered: 0, ran: 0, skipped: 0, results: [],
      codes: ['LOCK_HELD_BY_OTHER_INSTANCE'],
      message: '另一个实例正在调度（单文件存储不支持多实例并发采集）。'
    };
    state.lastTickAt = summary.at;
    state.lastTickSummary = summary;
    return summary;
  }

  const limit = Math.max(1, Math.min(20, Number(o.maxPerTick) || cfg.maxPerTick));
  const results = [];
  let ran = 0;
  let skipped = 0;

  const sources = db.source_registry.slice().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  for (const s of sources) {
    if (ran >= limit) break;
    const reason = ingest.schedulableReason(s, getMosConfig());
    if (reason) { skipped += 1; continue; }
    if (!ingest.isDue(s, nowMs)) { skipped += 1; continue; }

    const dedupeKey = ingest.bucketKey(s.id, cfg.intervalMinutes * 60 * 1000, nowMs);
    const r = await ingest.runIngest(db, s, {
      actorId: '', trigger, dedupeKey, now: nowMs
    });
    if (r.deduplicated) {
      skipped += 1;
      continue;
    }
    ran += 1;
    results.push({
      sourceId: s.id, sourceName: s.name, ok: !!r.ok,
      status: r.status, inserted: r.inserted || 0, skipped: r.skipped || 0,
      nextRunAt: (r.job && r.job.nextRunAt) || s.nextRunAt || null,
      failureCode: (r.job && r.job.failureCode) || '',
      message: r.message || ''
    });
  }

  heartbeat(db);
  store.save();
  // 作业记录（尤其 dedupeKey）必须**立即落盘**：否则崩溃后重启会重跑同一时间桶
  try { store.saveNow(); } catch (err) { state.lastError = String(err && err.message); }

  const summary = {
    at: new Date(nowMs).toISOString(),
    considered: sources.length,
    ran, skipped, results,
    lockOwner: OWNER_ID,
    codes: results.filter((x) => !x.ok).map((x) => x.failureCode || x.status)
  };
  state.lastTickAt = summary.at;
  state.lastTickSummary = summary;
  state.tickCount += 1;
  return summary;
}

/** 启动定时器（默认关闭；只在 server.js 启动期调用） */
function start() {
  const cfg = schedCfg();
  state.enabled = cfg.enabled;
  state.intervalMinutes = cfg.intervalMinutes;
  if (!cfg.enabled) {
    state.started = false;
    return { started: false, reason: 'DISABLED', note: '调度器默认关闭（mos.scheduler.enabled=false）；未获得运营授权时不自动出站。' };
  }
  if (state.timer) return { started: true, reason: 'ALREADY_RUNNING' };

  const periodMs = cfg.intervalMinutes * 60 * 1000;
  state.timer = setInterval(() => {
    tick({}).catch((err) => { state.lastError = String(err && err.stack ? err.stack : err); });
  }, periodMs);
  if (state.timer.unref) state.timer.unref();
  state.started = true;

  // 启动后首个巡检延后一个小周期执行 —— 避免「重启即立刻打满出站」
  const first = setTimeout(() => {
    tick({}).catch((err) => { state.lastError = String(err && err.stack ? err.stack : err); });
  }, Math.min(periodMs, 60 * 1000));
  if (first.unref) first.unref();

  return {
    started: true, reason: 'STARTED', intervalMinutes: cfg.intervalMinutes,
    note: '采集调度已启用：仅对 ACTIVE + 非 MANUAL 频率 + 在出站白名单内的来源执行。'
  };
}

/** 停止定时器并释放锁（停服时调用） */
function stop() {
  if (state.timer) { clearInterval(state.timer); state.timer = null; }
  state.started = false;
  try {
    const db = store.getDb();
    return releaseLock(db);
  } catch (_) { return false; }
}

/** 运行时开关（供 API 调用；会持久化到 config.json 之外的内存态 + 锁记录） */
function setEnabled(enabled) {
  const cfg = getMosConfig();
  if (!cfg.scheduler) cfg.scheduler = {};
  cfg.scheduler.enabled = !!enabled;
  state.enabled = !!enabled;
  return !!enabled ? start() : (stop(), { started: false, reason: 'STOPPED' });
}

/** 调度总览（API/UI 展示，含单实例限制声明） */
function status() {
  const cfg = schedCfg();
  let lock = null;
  let lockOwnerSelf = false;
  try {
    const db = store.getDb();
    lock = lockOf(db);
    lockOwnerSelf = !!(lock && lock.ownerId === OWNER_ID);
  } catch (_) { /* 未初始化 */ }
  return {
    scheduler: 'source-ingest',
    configured: cfg.enabled,
    running: !!state.timer,
    intervalMinutes: cfg.intervalMinutes,
    maxPerTick: cfg.maxPerTick,
    tickCount: state.tickCount,
    lastTickAt: state.lastTickAt,
    lastTickSummary: state.lastTickSummary,
    lastError: state.lastError,
    lock: lock ? {
      ownerId: lock.ownerId, pid: lock.pid, acquiredAt: lock.acquiredAt,
      heartbeatAt: lock.heartbeatAt, isSelf: lockOwnerSelf,
      staleThresholdMinutes: cfg.lockStaleMinutes
    } : null,
    singleInstanceOnly: true,
    note: '调度器默认关闭；单文件存储只支持单实例，第二实例会被锁拒绝并在作业摘要中如实上报。'
      + '自动采集仅针对 ACTIVE + 非 MANUAL 频率 + 出站白名单内的来源。'
  };
}

/** 到期来源预览（供 UI 在开启前告知「将会发生什么」，不产生任何出站） */
function duePreview(nowMs) {
  const db = store.getDb();
  const cfg = schedCfg();
  const now = Number(nowMs) || Date.now();
  return (db.source_registry || []).map((s) => {
    const reason = ingest.schedulableReason(s, getMosConfig());
    return {
      sourceId: s.id, name: s.name, domain: s.domain, brandCode: s.brandCode,
      status: s.status, frequency: s.frequency, method: s.method,
      nextRunAt: s.nextRunAt || null,
      due: !reason && ingest.isDue(s, now),
      schedulable: !reason,
      reason: reason || '',
      scheduleFailures: Number(s.scheduleFailures || 0)
    };
  });
}

module.exports = {
  OWNER_ID,
  start, stop, tick, status, setEnabled, duePreview,
  acquireLock, releaseLock, heartbeat, lockIsStale,
  _state: state
};
