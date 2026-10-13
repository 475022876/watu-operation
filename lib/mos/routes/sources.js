'use strict';
/**
 * Intelligence：来源登记 + 最小采集器 + 情报流 + 由情报创建 Topic（W03-04）。
 *
 * 流程（04 §3）：登记 → 白名单/许可判定 → Fetch/RSS/API → Parse（数据非命令）
 *   → canonical URL/hash 去重 → 来源溯源 → AI 摘要（未配置即明确缺失） → 人工验证/建 Topic。
 *
 * 诚实性：抓取失败/未配置/被 SSRF 阻断时，返回明确的降级状态（INTEGRATION_PENDING 等），
 *   **绝不伪造"采集成功"**（00 §3 / 09 §5）。
 */
const { get, post, put } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const { dictValid, SOURCE_TIERS, SOURCE_METHODS, LICENSE_STATES } = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid } = require('../ids');
const sourceAdapter = require('../adapters/source');
const ingest = require('../ingest');
const scheduler = require('../scheduler');
const helpers = require('./helpers');

const SA_ALLOWED_STATUS = ['ACTIVE', 'PENDING_VERIFICATION', 'DISABLED', 'ERROR'];
const ipv4Re = /^(\d{1,3}\.){3}\d{1,3}$/;

function serializeSource(db, s, principal) {
  const itemCount = db.source_items.filter((i) => i.sourceId === s.id).length;
  const owner = db.users.find((u) => u.id === s.ownerId);
  return {
    id: s.id, brandCode: s.brandCode, domain: s.domain, name: s.name, tier: s.tier, method: s.method,
    endpoint: s.endpoint || '', licensePolicy: s.licensePolicy, licenseNote: s.licenseNote || '',
    country: s.country || '', frequency: s.frequency, retryPolicy: s.retryPolicy,
    retentionDays: s.retentionDays, allowFullText: !!s.allowFullText,
    ownerId: s.ownerId, ownerName: owner ? owner.displayName : '（未知）',
    status: s.status, itemCount,
    lastOkAt: s.lastOkAt || null, lastErrorAt: s.lastErrorAt || null, lastError: s.lastError || '',
    // 调度相关（A-01）：如实展示「是否会被自动采集」及其原因
    nextRunAt: s.nextRunAt || null,
    scheduleFailures: Number(s.scheduleFailures || 0),
    schedulable: !ingest.schedulableReason(s, require('../config').getMosConfig()),
    schedulableReason: ingest.schedulableReason(s, require('../config').getMosConfig()),
    jobCount: (db.ingest_jobs || []).filter((j) => j.sourceId === s.id).length,
    // 白名单核验状态：是否在出站白名单内（直接决定能否真实抓取）
    egressAllowlisted: (require('../config').getMosConfig().egress.allowedHosts || [])
      .map((h) => String(h).toLowerCase()).indexOf(String(s.domain || '').toLowerCase()) !== -1,
    demo: !!s.demo, createdAt: s.createdAt, updatedAt: s.updatedAt, rowVersion: s.rowVersion || 1,
    can: { manage: rbac.can(principal, 'source.manage', s.brandCode) }
  };
}

function serializeItem(db, it) {
  const src = db.source_registry.find((s) => s.id === it.sourceId);
  const topicRefs = db.evidence_references.filter((e) => e.sourceItemId === it.id).map((e) => e.topicId);
  return {
    id: it.id, sourceId: it.sourceId, sourceName: src ? src.name : '（来源已删除）',
    brandCode: it.brandCode, canonicalUrl: it.canonicalUrl, title: it.title,
    publishedAt: it.publishedAt, fetchedAt: it.fetchedAt, language: it.language || '', tier: it.tier,
    summary: it.summary || '', licenseState: it.licenseState, contentDigest: it.contentDigest,
    rawStored: !!it.rawStored, relevance: it.relevance,
    aiSummary: it.aiSummary || '', aiSummaryState: it.aiSummaryState || 'NOT_CONFIGURED',
    usedByTopics: topicRefs,
    demo: !!it.demo, createdAt: it.createdAt
  };
}

/* ---------------- 来源登记 ---------------- */

get('/api/mos/sources', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.source_registry.filter((s) => s.brandCode === brandCode);
  if (ctx.query.status) rows = rows.filter((s) => s.status === String(ctx.query.status).toUpperCase());
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return { ok: true, brandCode, items: rows.map((s) => serializeSource(db, s, ctx.principal)) };
});

post('/api/mos/sources', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'source.manage', brandCode, { ip: ctx.ip, objectType: 'source_registry' });

  const name = String(body.name || '').trim();
  if (!name) throw httpError(400, '请填写来源名称', 'MISSING_NAME');
  const domain = String(body.domain || '').trim().toLowerCase();
  // 正式来源应填域名；同时接受 localhost / IPv4 字面量（仅供本地端到端验证与内网采集器测试）
  const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain);
  const isLocal = domain === 'localhost' || ipv4Re.test(domain);
  if (!isDomain && !isLocal) throw httpError(400, '域名格式非法', 'BAD_DOMAIN');
  const tier = String(body.tier || 'S4').toUpperCase();
  if (!dictValid('sourceTiers', tier)) throw httpError(400, '来源等级非法（S1-S4）', 'BAD_TIER');
  const method = String(body.method || 'MANUAL').toUpperCase();
  if (!dictValid('sourceMethods', method)) throw httpError(400, '采集方式非法', 'BAD_METHOD');
  const licensePolicy = String(body.licensePolicy || 'UNVERIFIED').toUpperCase();
  if (!dictValid('licenseStates', licensePolicy)) throw httpError(400, '许可状态非法', 'BAD_LICENSE');

  // 许可安全默认：只有 OPEN / LICENSED 才允许保存全文
  const allowFullText = !!body.allowFullText && (licensePolicy === 'OPEN' || licensePolicy === 'LICENSED');

  const s = {
    id: uid('src'),
    brandCode,
    domain,
    name,
    tier,
    method,
    endpoint: String(body.endpoint || '').trim().slice(0, 500),
    licensePolicy,
    licenseNote: String(body.licenseNote || '').slice(0, 1000),
    country: String(body.country || '').slice(0, 8),
    frequency: String(body.frequency || 'MANUAL').toUpperCase(),
    retryPolicy: String(body.retryPolicy || 'EXP_BACKOFF_3').toUpperCase(),
    retentionDays: Math.max(1, Math.min(3650, Number(body.retentionDays) || 180)),
    allowFullText,
    ownerId: ctx.user.id,
    status: 'PENDING_VERIFICATION',   // 新登记来源默认**待核验**，不得默认可用
    lastOkAt: null, lastErrorAt: null, lastError: '',
    demo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: ctx.user.id,
    rowVersion: 1
  };
  db.source_registry.push(s);
  save();
  appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'source.created', objectType: 'source_registry',
    objectId: s.id, newState: 'PENDING_VERIFICATION', ip: ctx.ip, metadata: { domain, tier, method, licensePolicy } });
  return { ok: true, source: serializeSource(db, s, ctx.principal) };
});

put('/api/mos/sources/:id', async (ctx) => {
  const db = getDb();
  const s = db.source_registry.find((x) => x.id === ctx.params.id);
  if (!s) throw httpError(404, '来源不存在', 'SOURCE_NOT_FOUND');
  rbac.assertBrand(ctx.principal, s.brandCode);
  rbac.assertCan(ctx.principal, 'source.manage', s.brandCode, { ip: ctx.ip, objectType: 'source_registry', objectId: s.id });

  const body = ctx.body || {};
  const patch = {};
  if (body.name !== undefined) {
    const v = String(body.name).trim();
    if (!v) throw httpError(400, '名称不能为空', 'MISSING_NAME');
    patch.name = v;
  }
  if (body.endpoint !== undefined) patch.endpoint = String(body.endpoint).trim().slice(0, 500);
  if (body.licensePolicy !== undefined) {
    const v = String(body.licensePolicy).toUpperCase();
    if (!dictValid('licenseStates', v)) throw httpError(400, '许可状态非法', 'BAD_LICENSE');
    patch.licensePolicy = v;
    // 许可收紧时同步撤销全文保存
    if (v !== 'OPEN' && v !== 'LICENSED') patch.allowFullText = false;
  }
  if (body.licenseNote !== undefined) patch.licenseNote = String(body.licenseNote).slice(0, 1000);
  if (body.status !== undefined) {
    const v = String(body.status).toUpperCase();
    if (SA_ALLOWED_STATUS.indexOf(v) === -1) throw httpError(400, '来源状态非法', 'BAD_STATUS');
    patch.status = v;
  }
  if (body.allowFullText !== undefined) {
    const next = !!body.allowFullText;
    const policy = patch.licensePolicy || s.licensePolicy;
    if (next && policy !== 'OPEN' && policy !== 'LICENSED') {
      throw httpError(400, '许可状态为 ' + policy + ' 时不允许保存全文（合规要求）', 'LICENSE_BLOCK');
    }
    patch.allowFullText = next;
  }
  const changed = helpers.applyUpdate(s, patch, ctx.user.id, body.rowVersion);
  if (changed) {
    save();
    appendAudit({ actorId: ctx.user.id, brandCode: s.brandCode, eventType: 'source.updated', objectType: 'source_registry',
      objectId: s.id, ip: ctx.ip, metadata: { fields: Object.keys(patch) } });
  }
  return { ok: true, source: serializeSource(db, s, ctx.principal), changed };
});

/* ---------------- 采集（最小可用） ---------------- */

/**
 * 手工执行一次采集。
 *
 * 说明（A-01）：实际逻辑已收敛到 `lib/mos/ingest.js` 的 `runIngest()` ——
 * 与自动调度**完全同一条代码路径**，避免出现两套「哪些来源可抓/失败怎么记」的规则。
 * 本路由只负责：鉴权、组装审计、把结果序列化。
 */
post('/api/mos/sources/:id/ingest', async (ctx) => {
  const db = getDb();
  const s = db.source_registry.find((x) => x.id === ctx.params.id);
  if (!s) throw httpError(404, '来源不存在', 'SOURCE_NOT_FOUND');
  rbac.assertBrand(ctx.principal, s.brandCode);
  rbac.assertCan(ctx.principal, 'source.manage', s.brandCode, { ip: ctx.ip, objectType: 'source_registry', objectId: s.id });

  // 保持既有 API 契约（BUILD-01 起 E2E-01j 断言 409）：停用来源的手工采集按 409 拒绝。
  // runIngest() 内部同样有该门禁（供调度路径复用），此处是显式的 HTTP 语义层。
  if (s.status === 'DISABLED') throw httpError(409, '该来源已停用，不能采集', 'SOURCE_DISABLED');

  const force = !!(ctx.body && ctx.body.force === true);
  const result = await ingest.runIngest(db, s, {
    actorId: ctx.user.id, trigger: 'MANUAL', force, onChanged: () => { save(); }
  });
  save();

  if (!result.ok) {
    appendAudit({
      actorId: ctx.user.id, brandCode: s.brandCode, eventType: 'source.ingest.failed', objectType: 'source_registry',
      objectId: s.id, outcome: 'failed', ip: ctx.ip,
      metadata: { code: result.status, reason: result.message, jobId: result.job && result.job.id }
    });
    return {
      ok: false,
      status: result.status || 'INTEGRATION_PENDING',
      inserted: 0, skipped: 0,
      message: result.message || '采集未完成',
      nextRunAt: result.nextRunAt || null,
      retryable: result.retryable === true,
      job: result.job ? ingest.serializeJob(db, result.job) : null,
      integration: result.integration || sourceAdapter.status()
    };
  }

  appendAudit({
    actorId: ctx.user.id, brandCode: s.brandCode, eventType: 'source.ingest.ok', objectType: 'source_registry',
    objectId: s.id, ip: ctx.ip,
    metadata: { inserted: result.inserted, skipped: result.skipped, fetched: result.fetched, jobId: result.job && result.job.id }
  });

  return {
    ok: true,
    status: 'INGESTED',
    fetched: result.fetched,
    inserted: result.inserted,
    skipped: result.skipped,
    items: (result.items || []).map((i) => serializeItem(db, i)),
    aiSummaryState: result.aiSummaryState,
    aiSummaryNote: result.aiSummaryNote || '',
    job: result.job ? ingest.serializeJob(db, result.job) : null,
    integration: result.integration || sourceAdapter.status()
  };
});

/* ---------------- 采集作业与调度（A-01） ---------------- */

/** 采集作业记录（含跳过/失败；分页） */
get('/api/mos/ingest/jobs', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = (db.ingest_jobs || []).filter((j) => j.brandCode === brandCode);
  if (ctx.query.sourceId) rows = rows.filter((j) => j.sourceId === ctx.query.sourceId);
  if (ctx.query.status) {
    const st = String(ctx.query.status).toUpperCase();
    rows = rows.filter((j) => j.status === st);
  }
  rows = rows.slice().sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const paged = helpers.paginate(rows, ctx.query);
  return {
    ok: true, brandCode,
    page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((j) => ingest.serializeJob(db, j)),
    note: '作业记录为 append-only 的采集留痕（滚动保留最近 500 条）：失败与跳过同样记录，不粉饰。'
  };
});

/** 调度器总览（含单实例限制声明与到期预览）；到期预览**不产生任何出站** */
get('/api/mos/ingest/scheduler', async (ctx) => {
  helpers.resolveBrand(ctx);   // 品牌鉴权（无权限品牌返回 404）
  const db = getDb();
  return {
    ok: true,
    scheduler: scheduler.status(),
    due: scheduler.duePreview().filter((x) => x.brandCode === String(ctx.query.brand || '').toUpperCase()
      || rbac.can(ctx.principal, 'brand.read', x.brandCode)),
    limits: require('../config').getMosConfig().scheduler
  };
});

/** 开启/关闭调度（需要 source.manage）。默认关闭，只有显式开启才会自动出站。 */
post('/api/mos/ingest/scheduler', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'source.manage', brandCode, { ip: ctx.ip, objectType: 'scheduler' });
  const body = ctx.body || {};
  if (typeof body.enabled !== 'boolean') throw httpError(400, '请提供布尔值 enabled', 'BAD_ENABLED');
  const r = scheduler.setEnabled(body.enabled);
  save();
  appendAudit({
    actorId: ctx.user.id, brandCode, eventType: 'ingest.scheduler.toggled', objectType: 'settings',
    objectId: 'scheduler', newState: body.enabled ? 'ENABLED' : 'DISABLED', ip: ctx.ip,
    metadata: { result: r }
  });
  return { ok: true, enabled: !!body.enabled, result: r, scheduler: scheduler.status() };
});

/**
 * 手工执行一轮巡检（等同于定时器触发的那一轮）。
 * 用途：开启前先验证「会采哪些来源、结果如何」，无需等待定时器。
 */
post('/api/mos/ingest/scheduler/tick', async (ctx) => {
  helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'source.manage', helpers.resolveBrand(ctx), { ip: ctx.ip, objectType: 'scheduler' });
  const summary = await scheduler.tick({});
  save();
  appendAudit({
    actorId: ctx.user.id, brandCode: helpers.resolveBrand(ctx), eventType: 'ingest.scheduler.tick',
    objectType: 'settings', objectId: 'scheduler', ip: ctx.ip,
    metadata: { ran: summary.ran, skipped: summary.skipped, codes: summary.codes }
  });
  return { ok: true, summary, scheduler: scheduler.status() };
});

/* ---------------- 情报流 ---------------- */

get('/api/mos/source-items', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.source_items.filter((i) => i.brandCode === brandCode);
  if (ctx.query.sourceId) rows = rows.filter((i) => i.sourceId === ctx.query.sourceId);
  const kw = String(ctx.query.q || '').trim().toLowerCase();
  if (kw) rows = rows.filter((i) => String(i.title).toLowerCase().indexOf(kw) !== -1 || String(i.summary || '').toLowerCase().indexOf(kw) !== -1);
  rows = rows.slice().sort((a, b) => {
    const av = a.publishedAt || a.fetchedAt || a.createdAt;
    const bv = b.publishedAt || b.fetchedAt || b.createdAt;
    return av < bv ? 1 : -1;
  });
  const paged = helpers.paginate(rows, ctx.query);
  return { ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((i) => serializeItem(db, i)) };
});

get('/api/mos/source-items/:id', async (ctx) => {
  const db = getDb();
  const it = db.source_items.find((x) => x.id === ctx.params.id);
  if (!it) throw httpError(404, '情报条目不存在', 'SOURCE_ITEM_NOT_FOUND');
  rbac.assertBrand(ctx.principal, it.brandCode);
  return { ok: true, item: serializeItem(db, it), fullText: it.rawStored ? (it.fullText || '') : '' };
});

/** 由情报条目创建 Master Topic（E2E-01 的关键衔接） */
post('/api/mos/source-items/:id/create-topic', async (ctx) => {
  const db = getDb();
  const it = db.source_items.find((x) => x.id === ctx.params.id);
  if (!it) throw httpError(404, '情报条目不存在', 'SOURCE_ITEM_NOT_FOUND');
  rbac.assertBrand(ctx.principal, it.brandCode);
  rbac.assertCan(ctx.principal, 'topic.manage', it.brandCode, { ip: ctx.ip, objectType: 'master_topic' });

  const body = ctx.body || {};
  const title = String(body.title || it.title || '').trim();
  if (!title) throw httpError(400, '请填写 Topic 标题', 'MISSING_TITLE');
  const pillarCode = String(body.pillarCode || 'C01').toUpperCase();
  const narrativeCode = String(body.narrativeCode || 'N01').toUpperCase();
  const riskGrade = String(body.riskGrade || 'G1').toUpperCase();
  if (!dictValid('pillars', pillarCode)) throw httpError(400, '栏目编码非法', 'BAD_PILLAR');
  if (!dictValid('narratives', narrativeCode)) throw httpError(400, '叙事编码非法', 'BAD_NARRATIVE');
  if (!dictValid('riskGrades', riskGrade)) throw httpError(400, '风险等级非法', 'BAD_RISK');

  const t = {
    id: uid('topic'),
    brandCode: it.brandCode,
    title,
    pillarCode,
    narrativeCode,
    riskGrade,
    evidenceStatus: 'PARTIAL',
    summary: String(body.summary === undefined ? (it.summary || '') : body.summary).slice(0, 4000),
    ownerId: ctx.user.id,
    state: 'RESEARCHING',
    demo: !!it.demo,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: ctx.user.id,
    rowVersion: 1
  };
  db.master_topics.push(t);
  // 建立溯源证据：Topic 必可回溯 SourceItem
  db.evidence_references.push({
    id: uid('ev'),
    sourceItemId: it.id,
    topicId: t.id,
    contentVersionId: null,
    claimLocator: '（由情报直接建题：整体引用）',
    verificationState: 'UNVERIFIED',
    demo: !!it.demo,
    createdAt: new Date().toISOString()
  });
  save();
  appendAudit({ actorId: ctx.user.id, brandCode: it.brandCode, eventType: 'topic.created_from_source', objectType: 'master_topic',
    objectId: t.id, newState: t.state, ip: ctx.ip, metadata: { sourceItemId: it.id } });
  return { ok: true, topicId: t.id, topicTitle: t.title, sourceItemId: it.id };
});
