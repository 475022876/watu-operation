'use strict';
/**
 * Marketing OS —— 情报采集公共引擎（A-01）。
 *
 * 为什么要有这个文件：手工「执行采集」（`POST /api/mos/sources/:id/ingest`）与
 * 自动调度（`lib/mos/scheduler.js`）**必须走同一条代码路径**。
 * 若各写一份，那么「哪些来源可抓、失败怎么记、去重怎么做」就会出现两套业务规则
 * —— 正是整改主控 M-01/D-01 明令禁止的「分别维护审批/规则判断」。
 *
 * 采集的硬约束（全部在本文件与 `adapters/source.js` 内强制，不依赖调用方自觉）：
 *   1. **白名单**：出站主机必须在 `mos.egress.allowedHosts` 内（`assertEgressAllowed`）；
 *   2. **许可**：`licensePolicy=UNVERIFIED` 不得抓全文；许可收紧时同步撤销 `allowFullText`；
 *   3. **状态**：`DISABLED` 一律拒绝；`PENDING_VERIFICATION` 未经核验不得真实抓取（fail closed）；
 *   4. **幂等**：同一调度桶（bucket）只执行一次；条目级按 canonicalUrl + digest 去重；
 *   5. **作业留痕**：每次执行（含跳过/失败）都落一条 `ingest_jobs` 记录，
 *      带开始/结束/状态/失败理由/下次时间 —— 进程重启后不会「凭空补发」历史任务。
 *
 * 诚实性：任何一步失败都如实写 `failureCode` / `failureReason`，
 *   **绝不**把抓取失败写成成功，也绝不生成占位情报条目（00 §3 / 02 §5）。
 */
const { uid, sha256 } = require('./ids');
const { getMosConfig } = require('./config');
const sourceAdapter = require('./adapters/source');
const textAdapter = require('./adapters/text');

/** 作业状态（持久化，UI/API 直接展示） */
const JOB_STATUSES = ['RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'BLOCKED'];
/** 触发来源 */
const JOB_TRIGGERS = ['MANUAL', 'SCHEDULED'];

/**
 * 失败分类（自审修正 B05-01）。
 *
 * 原实现用两份**白名单**（永久码 / 瞬时码）判定，结果 `adapters/source.js` 实际会返回的
 * 十余个码里有一半不在名单上（如 `UPSTREAM_STATUS`、`SCHEME_NOT_ALLOWED`、
 * `CREDENTIALS_IN_URL`、`REDIRECT_BLOCKED`…），一旦出现未列出的码：
 *   · 策略类永久失败（如 URL 内嵌凭据）会被当成瞬时失败**无限重试**；
 *   · 而瞬时失败也可能被误判为永久失败。
 * 现在改为**显式永久名单 + 默认按瞬时处理 + 连续失败次数上限**三重约束：
 *   未知码 → 可重试（不放大误判为「永不重试」），但连续失败达 `scheduler.maxFailures`
 *   即停止自动重试并把来源置 ERROR 交人工处理 —— 因此**不存在无限重试**。
 */

/** 需要人工修正配置/白名单才能恢复的**永久**失败（不自动重试） */
const PERMANENT_FAILURE_CODES = [
  'SSRF_BLOCKED', 'HOST_NOT_ALLOWLISTED', 'PORT_NOT_ALLOWED',
  'SCHEME_NOT_ALLOWED', 'PROTOCOL_NOT_ALLOWED', 'CREDENTIALS_IN_URL',
  'BAD_URL', 'BAD_HOST', 'REDIRECT_BAD_URL', 'REDIRECT_BLOCKED',
  'MANUAL_ONLY', 'NO_ENDPOINT', 'NO_EGRESS_ALLOWLIST',
  'SOURCE_DISABLED', 'SOURCE_ERROR', 'SOURCE_PENDING_VERIFICATION', 'INTEGRATION_PENDING'
];
/** 已知的**瞬时**失败（进入指数退避；未列出的码同样按瞬时处理） */
const TRANSIENT_FAILURE_CODES = [
  'FETCH_FAILED', 'NETWORK_ERROR', 'TIMEOUT', 'UPSTREAM_STATUS', 'REDIRECT',
  'TOO_MANY_REDIRECTS', 'PARSE_FAILED', 'DNS_FAILED', 'DNS_EMPTY',
  'RESPONSE_TOO_LARGE', 'UNSUPPORTED_ENCODING'
];

function isPermanent(code) {
  return PERMANENT_FAILURE_CODES.indexOf(String(code || '')) !== -1;
}
function isTransient(code) {
  return !isPermanent(code);
}

/** 计算指数退避毫秒：base * 2^(n-1)，上限 capMs */
function backoffMs(attempt, baseMs, capMs) {
  const n = Math.max(1, Number(attempt) || 1);
  const base = Math.max(1000, Number(baseMs) || 5 * 60 * 1000);
  const cap = Math.max(base, Number(capMs) || 6 * 60 * 60 * 1000);
  return Math.min(cap, base * Math.pow(2, n - 1));
}

/** 调度桶键：同一来源在同一个间隔窗口内只执行一次（跨重启也成立） */
function bucketKey(sourceId, intervalMs, nowMs) {
  const iv = Math.max(60 * 1000, Number(intervalMs) || 60 * 60 * 1000);
  return String(sourceId) + ':' + String(Math.floor((Number(nowMs) || Date.now()) / iv));
}

function noteOf(text, kind, sourceItemId) {
  return { text, kind, sourceItemId: sourceItemId || '', at: new Date().toISOString() };
}

/** 该来源是否允许被**自动**调度（手工触发不受这些条件限制，但受第 3 条状态约束） */
function schedulableReason(source, cfg) {
  const s = source || {};
  if (!s.id) return '来源不存在';
  if (s.status !== 'ACTIVE') return '状态为 ' + s.status + '（只有 ACTIVE 可自动调度）';
  const method = String(s.method || 'MANUAL').toUpperCase();
  if (method === 'MANUAL') return '采集方式为 MANUAL（人工登记来源不自动抓取）';
  const freq = String(s.frequency || 'MANUAL').toUpperCase();
  if (freq === 'MANUAL' || freq === 'OFF' || freq === 'NONE') return '频率为 ' + freq + '（未开启自动采集）';
  const allow = (cfg.egress.allowedHosts || []).map((h) => String(h).toLowerCase());
  if (!allow.length) return '出站白名单为空（fail closed，拒绝一切真实出站）';
  if (allow.indexOf(String(s.domain || '').toLowerCase()) === -1) {
    return '域名 ' + s.domain + ' 不在出站白名单内';
  }
  return '';
}

/** 该来源当前是否到期（nextRunAt 为空或已过） */
function isDue(source, nowMs) {
  if (!source || !source.nextRunAt) return true;
  const t = Date.parse(source.nextRunAt);
  if (!Number.isFinite(t)) return true;
  return t <= (Number(nowMs) || Date.now());
}

/** 建立一条作业记录（RUNNING） */
function createJob(db, source, trigger, actorId, dedupeKey) {
  const job = {
    id: uid('ijob'),
    sourceId: source.id,
    sourceName: source.name || '',
    brandCode: source.brandCode,
    trigger: JOB_TRIGGERS.indexOf(trigger) === -1 ? 'MANUAL' : trigger,
    status: 'RUNNING',
    dedupeKey: dedupeKey || '',
    attempt: Number(source.scheduleFailures || 0) + 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    durationMs: null,
    fetched: 0,
    inserted: 0,
    skipped: 0,
    failureCode: '',
    failureReason: '',
    nextRunAt: null,
    backoffMs: 0,
    /** null = 未判定（成功/跳过）；true/false = 本次失败是否可自动重试 */
    retryable: null,
    actorId: actorId || '',
    note: '',
    demo: false
  };
  if (!Array.isArray(db.ingest_jobs)) db.ingest_jobs = [];
  db.ingest_jobs.push(job);
  // 单文件存储边界：作业记录滚动保留（避免无限增长）
  const MAX = 500;
  if (db.ingest_jobs.length > MAX) db.ingest_jobs.splice(0, db.ingest_jobs.length - MAX);
  return job;
}

/** 结束一条作业记录 */
function finishJob(job, patch) {
  const p = patch || {};
  Object.assign(job, p);
  job.finishedAt = new Date().toISOString();
  const t0 = Date.parse(job.startedAt);
  job.durationMs = Number.isFinite(t0) ? Math.max(0, Date.now() - t0) : null;
  return job;
}

/**
 * 执行一次采集（**唯一**权威实现）。
 *
 * @param {object} db
 * @param {object} source source_registry 行
 * @param {object} opts
 *   - actorId    操作者（调度触发时为空）
 *   - trigger    'MANUAL' | 'SCHEDULED'
 *   - force      手工触发时允许对 PENDING_VERIFICATION 来源强制抓取（默认 false）
 *   - dedupeKey  幂等键；已存在同键**非失败**作业时直接返回 skipped
 *   - summarize  是否调用文本 Provider 生成 AI 摘要（默认 true）
 *   - now        当前时间毫秒（测试可注入）
 * @returns {Promise<object>} 结果（含 job 快照）
 */
async function runIngest(db, source, opts) {
  const cfg = getMosConfig();
  const o = opts || {};
  const trigger = JOB_TRIGGERS.indexOf(o.trigger) === -1 ? 'MANUAL' : o.trigger;
  const nowMs = Number(o.now) || Date.now();

  // 幂等：同 dedupeKey 已有「未失败」作业 → 不再重复抓取（跨重启同样成立）
  if (o.dedupeKey) {
    const dup = (db.ingest_jobs || []).find((j) => j.dedupeKey === o.dedupeKey
      && (j.status === 'SUCCEEDED' || j.status === 'RUNNING' || j.status === 'SKIPPED'));
    if (dup) {
      return {
        ok: true, status: 'DEDUPLICATED', inserted: 0, skipped: 0,
        message: '同一调度周期（' + o.dedupeKey + '）已有作业记录（' + dup.status + '），本次跳过。',
        job: dup, deduplicated: true
      };
    }
  }

  const job = createJob(db, source, trigger, o.actorId, o.dedupeKey);
  /**
   * 调度基准时钟（自审修正 B05-02）。
   * `nextRunAt` 是**调度决策**，必须与 `isDue()` 使用同一个时钟，否则注入时间/时钟回拨场景下
   * 「刚写入的退避时间已过期」会导致立即重试（测试中确实复现：退避被直接击穿）。
   * 审计时间戳（startedAt/finishedAt/lastErrorAt）仍取真实时间，保持可审计。
   */
  const baseMs = Number(o.now) || Date.now();

  // ---- 前置门禁（fail closed） ----
  if (source.status === 'DISABLED') {
    finishJob(job, {
      status: 'BLOCKED', failureCode: 'SOURCE_DISABLED', retryable: false,
      failureReason: '该来源已停用，不能采集',
      note: '来源已停用：需在来源登记中重新启用后才能采集'
    });
    return {
      ok: false, status: 'SOURCE_DISABLED', inserted: 0, skipped: 0,
      message: '该来源已停用，不能采集', retryable: false, job
    };
  }
  if (source.status !== 'ACTIVE' && !(o.force === true && trigger === 'MANUAL')) {
    // 失败码必须与**真实状态**一致：ERROR（出站/失败熔断）与待核验是两回事，
    // 混用一个码会让运维看到错误的处置指引（自审修正 B05-03）。
    const code = source.status === 'ERROR'
      ? 'SOURCE_ERROR'
      : ('SOURCE_PENDING_VERIFICATION');
    const message = source.status === 'ERROR'
      ? ('该来源已被置为 ERROR（' + (source.lastError || '出站被拒或连续失败达上限')
        + '）：未执行真实抓取，请人工核查后重新启用。')
      : ('该来源许可/白名单尚待核验（status=' + source.status
        + '）：未执行真实抓取。核验完成后将其置为 ACTIVE 再采集。');
    finishJob(job, {
      status: 'BLOCKED', failureCode: code, retryable: false,
      failureReason: message,
      note: '前置门禁拦截（fail closed）：不产生任何出站请求'
    });
    return {
      ok: false, status: code, inserted: 0, skipped: 0,
      message, retryable: false, job
    };
  }

  // ---- 抓取 ----
  const result = await sourceAdapter.fetchSourceItems(source, {});
  if (!result.ok) {
    const code = result.code || 'FETCH_FAILED';
    const cfgSched = (cfg.scheduler || {});
    const maxFailures = Math.max(1, Number(cfgSched.maxFailures) || 5);
    const permanentByCode = isPermanent(code);
    const priorFailures = Number(source.scheduleFailures || 0);
    const failures = permanentByCode ? priorFailures : priorFailures + 1;
    // 连续失败达上限 → 停止自动重试（避免无限重试放大故障）
    const exhausted = !permanentByCode && failures >= maxFailures;
    const retryable = !permanentByCode && !exhausted;
    const wait = retryable ? backoffMs(failures, cfgSched.backoffBaseMs, cfgSched.backoffCapMs) : 0;
    const nextRunAt = retryable ? new Date(baseMs + wait).toISOString() : null;

    source.lastErrorAt = new Date().toISOString();
    source.lastError = code + ': ' + (result.reason || '');
    source.scheduleFailures = failures;
    source.nextRunAt = nextRunAt;
    // 出站被策略拒绝，或连续失败达上限：来源不可再被自动调度，交人工处理
    if (permanentByCode || exhausted) source.status = 'ERROR';
    if (typeof o.onChanged === 'function') o.onChanged();

    finishJob(job, {
      status: 'FAILED', failureCode: code, failureReason: result.reason || '抓取失败',
      attempt: failures || 1, backoffMs: wait, nextRunAt, retryable,
      note: permanentByCode
        ? '永久性失败：不自动重试（需人工修正来源配置或出站白名单）'
        : (exhausted
          ? '连续失败达上限（' + maxFailures + ' 次）：已停止自动重试并把来源置 ERROR，交人工核查'
          : '瞬时失败：按退避重试（第 ' + failures + '/' + maxFailures + ' 次）')
    });
    return {
      ok: false, status: code, inserted: 0, skipped: 0,
      message: result.reason || '采集未完成',
      nextRunAt, retryable,
      integration: sourceAdapter.status(),
      job
    };
  }

  // ---- 落库（URL/digest 去重 + 许可判定） ----
  const persisted = sourceAdapter.persistItems(db, source, result, { uid, sha256 });
  source.lastOkAt = new Date().toISOString();
  source.lastError = '';
  source.scheduleFailures = 0;
  source.nextRunAt = null;   // 成功即清空退避

  // ---- AI 摘要（未配置模型 → 明确 NOT_CONFIGURED，绝不伪造） ----
  const textStatus = textAdapter.status();
  if (o.summarize !== false && textStatus.configured && persisted.items.length) {
    for (const item of persisted.items) {
      const sum = await textAdapter.summarize({
        text: item.summary || item.title, title: item.title,
        trustLevel: 'untrusted_external', brandCode: source.brandCode
      });
      item.aiSummary = sum.summary || '';
      item.aiSummaryState = sum.state;
      item.aiSummaryProvider = sum.provider;
    }
  }
  if (typeof o.onChanged === 'function') o.onChanged();

  finishJob(job, {
    status: 'SUCCEEDED', fetched: (result.items || []).length,
    inserted: persisted.inserted, skipped: persisted.skipped,
    nextRunAt: null, backoffMs: 0,
    note: textStatus.configured ? 'AI 摘要已处理' : '未配置模型：未生成 AI 摘要（NOT_CONFIGURED）'
  });

  return {
    ok: true, status: 'INGESTED',
    fetched: (result.items || []).length,
    inserted: persisted.inserted,
    skipped: persisted.skipped,
    items: persisted.items,
    aiSummaryState: textStatus.configured ? 'PROCESSED' : 'NOT_CONFIGURED',
    aiSummaryNote: textStatus.configured ? '' : '尚未配置模型：未生成 AI 摘要（01 §4）。',
    integration: sourceAdapter.status(),
    job
  };
}

/** 作业记录序列化（API 输出） */
function serializeJob(db, j) {
  return {
    id: j.id, sourceId: j.sourceId, sourceName: j.sourceName || '',
    brandCode: j.brandCode, trigger: j.trigger, status: j.status,
    dedupeKey: j.dedupeKey || '', attempt: j.attempt || 1,
    startedAt: j.startedAt, finishedAt: j.finishedAt || null, durationMs: j.durationMs,
    fetched: j.fetched || 0, inserted: j.inserted || 0, skipped: j.skipped || 0,
    failureCode: j.failureCode || '', failureReason: j.failureReason || '',
    nextRunAt: j.nextRunAt || null, backoffMs: j.backoffMs || 0,
    note: j.note || '', actorId: j.actorId || '',
    // retryable 采用**作业落库时**的判定（含「连续失败达上限即停」的结果），
    // 不再由序列化时重新推断 —— 否则运维看到的可重试性与调度器实际行为会不一致。
    retryable: j.retryable === undefined ? (j.failureCode ? isTransient(j.failureCode) : false) : !!j.retryable,
    permanent: j.failureCode ? isPermanent(j.failureCode) : false
  };
}

module.exports = {
  JOB_STATUSES,
  JOB_TRIGGERS,
  PERMANENT_FAILURE_CODES,
  TRANSIENT_FAILURE_CODES,
  isPermanent,
  isTransient,
  backoffMs,
  bucketKey,
  schedulableReason,
  isDue,
  createJob,
  finishJob,
  runIngest,
  serializeJob,
  noteOf
};
