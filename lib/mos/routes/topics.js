'use strict';
/**
 * Master Topic（W03-03 Master Topics）。
 *
 * 链路（10 §1）：Knowledge → Topic → Assets → Distribution → Reuse。
 * 关键口径：
 *   - pillarCode / narrativeCode 必须命中字典（C01-C06 / N01-N05）；
 *   - riskGrade ∈ G0-G3，决定后续专业审核/发布审核要求（03 §2.2 / §3）；
 *   - Evidence 必须可回溯到 SourceItem（04 §3：No Evidence No Claim）；
 *   - 一个 Topic 可产生多个 ContentTask。
 */
const { get, post, put, del } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const { dictValid } = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid, nextSeq, pad4, taskCode } = require('../ids');
const helpers = require('./helpers');
// M-03：Deliverables 复用 tasks 路由的 ContentTask 序列化器（同一对象、同一形状）
const tasksRoute = require('./tasks');

const TOPIC_STATES = ['DRAFT', 'RESEARCHING', 'ACTIVE', 'ARCHIVED'];
const EVIDENCE_STATES = ['MISSING', 'PARTIAL', 'SUFFICIENT'];

function serialize(db, t, principal, withEvidence) {
  const out = {
    id: t.id, brandCode: t.brandCode, title: t.title,
    pillarCode: t.pillarCode, narrativeCode: t.narrativeCode, riskGrade: t.riskGrade,
    evidenceStatus: t.evidenceStatus, summary: t.summary, ownerId: t.ownerId,
    ownerName: (db.users.find((u) => u.id === t.ownerId) || {}).displayName || '（未知）',
    state: t.state,
    taskCount: db.content_tasks.filter((x) => x.topicId === t.id).length,
    campaignCount: db.campaign_topic_links.filter((l) => l.topicId === t.id).length,
    evidenceCount: db.evidence_references.filter((e) => e.topicId === t.id).length,
    demo: !!t.demo, createdAt: t.createdAt, updatedAt: t.updatedAt, rowVersion: t.rowVersion || 1,
    can: { manage: rbac.can(principal, 'topic.manage', t.brandCode) }
  };
  if (withEvidence) {
    out.evidence = db.evidence_references.filter((e) => e.topicId === t.id).map((e) => {
      const si = db.source_items.find((s) => s.id === e.sourceItemId);
      const src = si ? db.source_registry.find((s) => s.id === si.sourceId) : null;
      return {
        id: e.id,
        sourceItemId: e.sourceItemId,
        title: si ? si.title : '（来源条目缺失）',
        canonicalUrl: si ? si.canonicalUrl : '',
        publishedAt: si ? si.publishedAt : null,
        fetchedAt: si ? si.fetchedAt : null,
        licenseState: si ? si.licenseState : '',
        sourceName: src ? src.name : '',
        tier: si ? si.tier : '',
        claimLocator: e.claimLocator,
        verificationState: e.verificationState,
        demo: !!e.demo
      };
    });
  }
  return out;
}

get('/api/mos/topics', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.master_topics.filter((t) => t.brandCode === brandCode);
  if (ctx.query.pillar) rows = rows.filter((t) => t.pillarCode === ctx.query.pillar);
  if (ctx.query.state) rows = rows.filter((t) => t.state === String(ctx.query.state).toUpperCase());
  const kw = String(ctx.query.q || '').trim().toLowerCase();
  if (kw) rows = rows.filter((t) => t.title.toLowerCase().indexOf(kw) !== -1 || String(t.summary || '').toLowerCase().indexOf(kw) !== -1);
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const paged = helpers.paginate(rows, ctx.query);
  return { ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((t) => serialize(db, t, ctx.principal, false)) };
});

get('/api/mos/topics/:id', async (ctx) => {
  const db = getDb();
  const t = db.master_topics.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, 'Topic 不存在', 'TOPIC_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);
  const tasks = db.content_tasks.filter((x) => x.topicId === t.id)
    .map((x) => tasksRoute.serialize(db, x, ctx.principal));
  return { ok: true, topic: serialize(db, t, ctx.principal, true), tasks };
});

post('/api/mos/topics', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'topic.manage', brandCode, { ip: ctx.ip, objectType: 'master_topic' });

  const title = String(body.title || '').trim();
  if (!title) throw httpError(400, '请填写 Topic 标题', 'MISSING_TITLE');
  const pillarCode = String(body.pillarCode || '').toUpperCase();
  const narrativeCode = String(body.narrativeCode || '').toUpperCase();
  const riskGrade = String(body.riskGrade || 'G1').toUpperCase();
  const state = String(body.state || 'DRAFT').toUpperCase();
  if (!dictValid('pillars', pillarCode)) throw httpError(400, '栏目编码非法（需 C01-C06）', 'BAD_PILLAR');
  if (!dictValid('narratives', narrativeCode)) throw httpError(400, '叙事编码非法（需 N01-N05）', 'BAD_NARRATIVE');
  if (!dictValid('riskGrades', riskGrade)) throw httpError(400, '风险等级非法（需 G0-G3）', 'BAD_RISK');
  if (TOPIC_STATES.indexOf(state) === -1) throw httpError(400, 'Topic 状态非法', 'BAD_STATE');

  const t = {
    id: uid('topic'),
    brandCode,
    title,
    pillarCode,
    narrativeCode,
    riskGrade,
    evidenceStatus: 'MISSING',
    summary: String(body.summary || '').slice(0, 4000),
    ownerId: ctx.user.id,
    state,
    demo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: ctx.user.id,
    rowVersion: 1
  };
  db.master_topics.push(t);
  save();
  appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'topic.created', objectType: 'master_topic',
    objectId: t.id, newState: t.state, ip: ctx.ip, metadata: { pillarCode, narrativeCode, riskGrade } });
  return { ok: true, topic: serialize(db, t, ctx.principal, true) };
});

put('/api/mos/topics/:id', async (ctx) => {
  const db = getDb();
  const t = db.master_topics.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, 'Topic 不存在', 'TOPIC_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);
  rbac.assertCan(ctx.principal, 'topic.manage', t.brandCode, { ip: ctx.ip, objectType: 'master_topic', objectId: t.id });

  const body = ctx.body || {};
  const patch = {};
  if (body.title !== undefined) {
    const v = String(body.title).trim();
    if (!v) throw httpError(400, '标题不能为空', 'MISSING_TITLE');
    patch.title = v;
  }
  if (body.summary !== undefined) patch.summary = String(body.summary).slice(0, 4000);
  if (body.pillarCode !== undefined) {
    const v = String(body.pillarCode).toUpperCase();
    if (!dictValid('pillars', v)) throw httpError(400, '栏目编码非法', 'BAD_PILLAR');
    patch.pillarCode = v;
  }
  if (body.narrativeCode !== undefined) {
    const v = String(body.narrativeCode).toUpperCase();
    if (!dictValid('narratives', v)) throw httpError(400, '叙事编码非法', 'BAD_NARRATIVE');
    patch.narrativeCode = v;
  }
  if (body.riskGrade !== undefined) {
    const v = String(body.riskGrade).toUpperCase();
    if (!dictValid('riskGrades', v)) throw httpError(400, '风险等级非法', 'BAD_RISK');
    patch.riskGrade = v;
  }
  if (body.state !== undefined) {
    const v = String(body.state).toUpperCase();
    if (TOPIC_STATES.indexOf(v) === -1) throw httpError(400, 'Topic 状态非法', 'BAD_STATE');
    patch.state = v;
  }
  if (body.evidenceStatus !== undefined) {
    const v = String(body.evidenceStatus).toUpperCase();
    if (EVIDENCE_STATES.indexOf(v) === -1) throw httpError(400, '证据状态非法', 'BAD_EVIDENCE_STATE');
    patch.evidenceStatus = v;
  }
  const changed = helpers.applyUpdate(t, patch, ctx.user.id, body.rowVersion);
  if (changed) {
    save();
    appendAudit({ actorId: ctx.user.id, brandCode: t.brandCode, eventType: 'topic.updated', objectType: 'master_topic',
      objectId: t.id, ip: ctx.ip, metadata: { fields: Object.keys(patch) } });
  }
  return { ok: true, topic: serialize(db, t, ctx.principal, true), changed };
});

/* ---------------- 证据引用（No Evidence No Claim） ---------------- */

post('/api/mos/topics/:id/evidence', async (ctx) => {
  const db = getDb();
  const t = db.master_topics.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, 'Topic 不存在', 'TOPIC_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);
  rbac.assertCan(ctx.principal, 'topic.manage', t.brandCode, { ip: ctx.ip, objectType: 'master_topic', objectId: t.id });

  const body = ctx.body || {};
  const sourceItemId = String(body.sourceItemId || '');
  const si = db.source_items.find((s) => s.id === sourceItemId);
  if (!si) throw httpError(400, '来源条目不存在（Evidence 必须可回溯到 SourceItem）', 'SOURCE_ITEM_NOT_FOUND');
  if (si.brandCode && si.brandCode !== t.brandCode) {
    throw httpError(400, '不可跨品牌引用来源条目', 'BRAND_MISMATCH');
  }
  if (db.evidence_references.some((e) => e.topicId === t.id && e.sourceItemId === sourceItemId)) {
    return { ok: true, alreadyLinked: true };
  }
  const ev = {
    id: uid('ev'),
    sourceItemId,
    topicId: t.id,
    contentVersionId: null,
    claimLocator: String(body.claimLocator || '').slice(0, 500),
    verificationState: String(body.verificationState || 'UNVERIFIED').toUpperCase(),
    demo: !!si.demo,
    createdAt: new Date().toISOString()
  };
  db.evidence_references.push(ev);
  // 自动推进证据状态（仅从 MISSING → PARTIAL；SUFFICIENT 需人工确认）
  if (t.evidenceStatus === 'MISSING') { t.evidenceStatus = 'PARTIAL'; t.updatedAt = new Date().toISOString(); }
  save();
  appendAudit({ actorId: ctx.user.id, brandCode: t.brandCode, eventType: 'topic.evidence.added', objectType: 'master_topic',
    objectId: t.id, ip: ctx.ip, metadata: { sourceItemId } });
  return { ok: true, topic: serialize(db, t, ctx.principal, true) };
});

del('/api/mos/topics/:id/evidence/:evId', async (ctx) => {
  const db = getDb();
  const t = db.master_topics.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, 'Topic 不存在', 'TOPIC_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);
  rbac.assertCan(ctx.principal, 'topic.manage', t.brandCode, { ip: ctx.ip, objectType: 'master_topic', objectId: t.id });
  const before = db.evidence_references.length;
  db.evidence_references = db.evidence_references.filter((e) => !(e.id === ctx.params.evId && e.topicId === t.id));
  if (db.evidence_references.length !== before) {
    // 证据被移除 → 状态回落（不允许保留"证据充足"的假象）
    const remain = db.evidence_references.filter((e) => e.topicId === t.id).length;
    t.evidenceStatus = remain ? 'PARTIAL' : 'MISSING';
    t.updatedAt = new Date().toISOString();
    save();
    appendAudit({ actorId: ctx.user.id, brandCode: t.brandCode, eventType: 'topic.evidence.removed', objectType: 'master_topic',
      objectId: t.id, ip: ctx.ip, metadata: { evidenceId: ctx.params.evId, newEvidenceStatus: t.evidenceStatus } });
  }
  return { ok: true, topic: serialize(db, t, ctx.principal, true) };
});

/* ---------------- 由一个 Topic 产生内容任务 ---------------- */

post('/api/mos/topics/:id/create-task', async (ctx) => {
  const db = getDb();
  const t = db.master_topics.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, 'Topic 不存在', 'TOPIC_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);
  rbac.assertCan(ctx.principal, 'topic.manage', t.brandCode, { ip: ctx.ip, objectType: 'master_topic', objectId: t.id });

  const body = ctx.body || {};
  const title = String(body.title || (t.title + ' · 内容任务')).trim();
  const platform = String(body.platform || 'LINKEDIN').toUpperCase();
  if (!dictValid('platforms', platform)) throw httpError(400, '平台非法', 'BAD_PLATFORM');
  const riskGrade = String(body.riskGrade || t.riskGrade || 'G1').toUpperCase();
  if (!dictValid('riskGrades', riskGrade)) throw httpError(400, '风险等级非法', 'BAD_RISK');

  let campaignId = body.campaignId ? String(body.campaignId) : null;
  if (campaignId) {
    const c = db.campaigns.find((x) => x.id === campaignId);
    if (!c) throw httpError(400, 'Campaign 不存在', 'CAMPAIGN_NOT_FOUND');
    if (c.brandCode !== t.brandCode) throw httpError(400, '不可跨品牌关联 Campaign', 'BRAND_MISMATCH');
  }

  const code = taskCode(db);
  const task = {
    id: uid('task'),
    brandCode: t.brandCode,
    code,
    title,
    type: String(body.type || 'ARTICLE').toUpperCase(),
    platform,
    pillarCode: t.pillarCode,
    narrativeCode: t.narrativeCode,
    riskGrade,
    ownerId: ctx.user.id,
    campaignId,
    topicId: t.id,
    status: 'PLANNED',
    productionDue: body.productionDue || null,
    reviewDue: body.reviewDue || null,
    plannedPublishAt: body.plannedPublishAt || null,
    demo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: ctx.user.id,
    rowVersion: 1
  };
  db.content_tasks.push(task);
  save();
  appendAudit({ actorId: ctx.user.id, brandCode: t.brandCode, eventType: 'content_task.created', objectType: 'content_task',
    objectId: task.id, newState: 'PLANNED', ip: ctx.ip, metadata: { fromTopic: t.id, code } });
  return { ok: true, task: { id: task.id, code: task.code, title: task.title, status: task.status, topicId: task.topicId } };
});

/**
 * 复用视图（Reuse）：历史内容与已授权资产引用。
 *
 * 审计修正（BUILD-03 A-25）：BUILD-01/02 时代本接口的 `contentVersions` / `publications`
 * 是**硬编码空数组 + 「BUILD-02 填充」注释**，属于「看起来可用、实际空壳」的展示型接口，
 * 违背「所有页面必须具备真实操作」的要求。现改为按真实链路聚合：
 *   MasterTopic → ContentTask(topicId) → ContentVersion(contentTaskId) → PublicationRecord(contentVersionId)
 *
 * 仍未接通的部分**如实标注**：企业资料库未接通（06 §1），已授权资产检索恒空并带 `integrationMode`。
 */
get('/api/mos/topics/:id/reuse', async (ctx) => {
  const db = getDb();
  const t = db.master_topics.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, 'Topic 不存在', 'TOPIC_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);

  const tasks = db.content_tasks.filter((x) => x.topicId === t.id);
  const taskIds = new Set(tasks.map((x) => x.id));
  const versions = (db.content_versions || []).filter((v) => taskIds.has(v.contentTaskId));
  const versionIds = new Set(versions.map((v) => v.id));
  const pubs = (db.publication_records || []).filter((p) => versionIds.has(p.contentVersionId));

  return {
    ok: true,
    topicId: t.id,
    counts: {
      tasks: tasks.length,
      contentVersions: versions.length,
      publications: pubs.length,
      libraryAssets: 0
    },
    // 只返回可安全外显的字段（不含正文全文与内部哈希）
    contentVersions: versions
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 100)
      .map((v) => ({
        id: v.id, code: v.code, number: v.number, title: v.title, state: v.state,
        riskGrade: v.riskGrade, supersededById: v.supersededById || null, createdAt: v.createdAt || ''
      })),
    publications: pubs
      .slice()
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      .slice(0, 100)
      .map((p) => ({
        id: p.id, contentVersionId: p.contentVersionId, channelId: p.channelId,
        status: p.status, url: p.url || '', actualAt: p.actualAt || '', createdAt: p.createdAt || ''
      })),
    /** 企业资料库未接通（06 §1）：此处**恒为空**，不伪造已授权资产 */
    libraryAssets: [],
    libraryIntegrationMode: 'mock',
    libraryNote: '企业资料库未接通：已授权 LibraryAsset 检索恒为空（06 §1 / 08 SEC-09）。',
    note: '复用仅引用历史记录；「Reuse as New Content」所产生的新草稿仍需重新审查事实与使用权（05 §4）。'
  };
});

void nextSeq; void pad4;
