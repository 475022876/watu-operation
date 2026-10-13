'use strict';
/**
 * Campaign（W03-02 Campaigns / W06-01 / W06-02）。
 *
 * 关系（02 §3）：
 *   - MonthlyPlan ↔ Campaign **多对多**（monthly_campaign_links），跨月 Campaign 用多个计划链接，**不重复创建 Campaign**；
 *   - Campaign ↔ MasterTopic **多对多**（campaign_topic_links），**禁止跨品牌**；
 *   - U CARD 的 Campaign 属于 U CARD 品牌空间，与 VFIB Campaign 完全隔离。
 */
const { get, post, put, del } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid, nextSeq, pad4 } = require('../ids');
const { TASK_STATUSES, MARKETING_BRIEF_TEMPLATES } = require('../dict');
const brieflib = require('../brieflib');
const helpers = require('./helpers');

const CAMPAIGN_STATES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'];

/* ==================== S04 Marketing Brief（A-02） ====================
 * 结构化 Marketing Brief 直接嵌入 Campaign（不另建重复记录）。
 * 归一化与「产品宣称核验」逻辑统一放在 lib/mos/brieflib.js，本文件只负责接线。
 */
function progressOf(db, c) {
  const tasks = db.content_tasks.filter((t) => t.campaignId === c.id);
  const by = (list) => tasks.filter((t) => list.indexOf(t.status) !== -1).length;
  return {
    tasks: tasks.length,
    notStarted: by(['IDEA', 'PLANNED']),
    inProduction: by(['IN_PRODUCTION', 'IN_REVIEW']),
    ready: by(['READY']),
    completed: by(['COMPLETED']),
    onHold: by(['ON_HOLD']),
    cancelled: by(['CANCELLED'])
  };
}

function serialize(db, c, principal) {
  const plans = db.monthly_campaign_links.filter((l) => l.campaignId === c.id)
    .map((l) => db.monthly_plans.find((p) => p.id === l.planId))
    .filter(Boolean)
    .map((p) => ({ id: p.id, code: p.code, title: p.title, status: p.status }));
  const topics = db.campaign_topic_links.filter((l) => l.campaignId === c.id)
    .map((l) => db.master_topics.find((t) => t.id === l.topicId))
    .filter(Boolean)
    .map((t) => ({ id: t.id, title: t.title, state: t.state, pillarCode: t.pillarCode }));
  const taskCount = db.content_tasks.filter((t) => t.campaignId === c.id).length;
  const owner = db.users.find((u) => u.id === c.ownerId);
  const brief = c.marketingBrief || brieflib.defaultMarketingBrief(c.brandCode);
  return {
    id: c.id, code: c.code, brandCode: c.brandCode, title: c.title, brief: c.brief,
    marketingBrief: brief,
    ownerId: c.ownerId, ownerName: owner ? owner.displayName : '（未知）',
    startAt: c.startAt, endAt: c.endAt, state: c.state,
    plans, topics, taskCount, progress: progressOf(db, c),
    demo: !!c.demo, createdAt: c.createdAt, updatedAt: c.updatedAt, rowVersion: c.rowVersion || 1,
    can: { manage: rbac.can(principal, 'campaign.manage', c.brandCode) }
  };
}

get('/api/mos/campaigns', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.campaigns.filter((c) => c.brandCode === brandCode);
  const state = ctx.query.state ? String(ctx.query.state).toUpperCase() : '';
  if (state) rows = rows.filter((c) => c.state === state);
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const paged = helpers.paginate(rows, ctx.query);
  return { ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((c) => serialize(db, c, ctx.principal)) };
});

get('/api/mos/campaigns/:id', async (ctx) => {
  const db = getDb();
  const c = db.campaigns.find((x) => x.id === ctx.params.id);
  if (!c) throw httpError(404, 'Campaign 不存在', 'CAMPAIGN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, c.brandCode);
  return { ok: true, campaign: serialize(db, c, ctx.principal) };
});

post('/api/mos/campaigns', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'campaign.manage', brandCode, { ip: ctx.ip, objectType: 'campaign' });

  const title = String(body.title || '').trim();
  if (!title) throw httpError(400, '请填写 Campaign 标题', 'MISSING_TITLE');
  const startAt = body.startAt ? new Date(body.startAt) : null;
  const endAt = body.endAt ? new Date(body.endAt) : null;
  if (startAt && Number.isNaN(startAt.getTime())) throw httpError(400, '开始时间非法', 'BAD_DATE');
  if (endAt && Number.isNaN(endAt.getTime())) throw httpError(400, '结束时间非法', 'BAD_DATE');
  if (startAt && endAt && endAt < startAt) throw httpError(400, '结束时间不能早于开始时间', 'BAD_RANGE');

  const seq = nextSeq(db, 'campaign:' + brandCode);
  const c = {
    id: uid('camp'),
    brandCode,
    code: 'CMP-' + brandCode + '-' + pad4(seq),
    title,
    brief: String(body.brief || '').slice(0, 8000),
    marketingBrief: brieflib.normalizeMarketingBrief(db, body.marketingBrief, brandCode),
    ownerId: ctx.user.id,
    startAt: startAt ? startAt.toISOString() : null,
    endAt: endAt ? endAt.toISOString() : null,
    state: 'DRAFT',
    demo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: ctx.user.id,
    rowVersion: 1
  };
  db.campaigns.push(c);
  save();
  appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'campaign.created', objectType: 'campaign',
    objectId: c.id, newState: 'DRAFT', ip: ctx.ip, metadata: { code: c.code } });
  return { ok: true, campaign: serialize(db, c, ctx.principal) };
});

put('/api/mos/campaigns/:id', async (ctx) => {
  const db = getDb();
  const c = db.campaigns.find((x) => x.id === ctx.params.id);
  if (!c) throw httpError(404, 'Campaign 不存在', 'CAMPAIGN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, c.brandCode);
  rbac.assertCan(ctx.principal, 'campaign.manage', c.brandCode, { ip: ctx.ip, objectType: 'campaign', objectId: c.id });

  const body = ctx.body || {};
  const patch = {};
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (!t) throw httpError(400, '标题不能为空', 'MISSING_TITLE');
    patch.title = t;
  }
  if (body.brief !== undefined) patch.brief = String(body.brief).slice(0, 8000);
  if (body.marketingBrief !== undefined) patch.marketingBrief = brieflib.normalizeMarketingBrief(db, body.marketingBrief, c.brandCode);
  if (body.startAt !== undefined) patch.startAt = body.startAt ? new Date(body.startAt).toISOString() : null;
  if (body.endAt !== undefined) patch.endAt = body.endAt ? new Date(body.endAt).toISOString() : null;
  if (body.state !== undefined) {
    const s = String(body.state).toUpperCase();
    if (CAMPAIGN_STATES.indexOf(s) === -1) throw httpError(400, 'Campaign 状态非法', 'BAD_STATE');
    patch.state = s;
  }
  const changed = helpers.applyUpdate(c, patch, ctx.user.id, body.rowVersion);
  if (changed) {
    save();
    appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'campaign.updated', objectType: 'campaign',
      objectId: c.id, ip: ctx.ip, metadata: { fields: Object.keys(patch) } });
  }
  return { ok: true, campaign: serialize(db, c, ctx.principal), changed };
});

/* ---------------- S04：Marketing Brief 模板 + Campaign 进展/结果 ---------------- */

/** 当前品牌的 Marketing Brief 模板（A-02：按品牌切换模板，不预置任何产品宣称） */
get('/api/mos/marketing/brief-templates', async (ctx) => {
  const brandCode = helpers.resolveBrand(ctx);
  const t = MARKETING_BRIEF_TEMPLATES[brandCode] || null;
  return {
    ok: true, brandCode,
    templates: t ? [t] : [],
    template: t,
    note: '模板只提供目标 / 受众 / 合规提醒等框架字段；产品宣称须逐条关联已核准知识或来源（服务端计算核验状态）。'
  };
});

/** Campaign 进展与结果（F-05）：只聚合中台真实数据，缺失来源显式 Unavailable，不做 0 填充或估算 */
get('/api/mos/campaigns/:id/results', async (ctx) => {
  const db = getDb();
  const c = db.campaigns.find((x) => x.id === ctx.params.id);
  if (!c) throw httpError(404, 'Campaign 不存在', 'CAMPAIGN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, c.brandCode);

  const tasks = db.content_tasks.filter((t) => t.campaignId === c.id);
  const byStatus = {};
  for (const s of TASK_STATUSES) byStatus[s] = tasks.filter((t) => t.status === s).length;

  const versionIds = new Set();
  for (const t of tasks) {
    for (const v of db.content_versions) if (v.contentTaskId === t.id) versionIds.add(v.id);
  }
  const pubs = db.publication_records.filter((p) => versionIds.has(p.contentVersionId));
  const pubByStatus = {};
  for (const p of pubs) pubByStatus[p.status] = (pubByStatus[p.status] || 0) + 1;
  const metrics = db.publication_metrics.filter((m) => pubs.some((p) => p.id === m.publicationId));

  return {
    ok: true, campaignId: c.id, brandCode: c.brandCode, code: c.code,
    available: true, missing: [],
    tasks: { total: tasks.length, byStatus },
    publications: {
      total: pubs.length, byStatus: pubByStatus,
      latest: pubs.slice().sort((a, b) => (String(a.actualAt) < String(b.actualAt) ? 1 : -1)).slice(0, 5)
        .map((p) => ({ id: p.id, status: p.status, url: p.url || '', actualAt: p.actualAt || null, channelId: p.channelId }))
    },
    performance: {
      available: false,
      sampleSize: metrics.length,
      missing: ['渠道表现指标（曝光/阅读/互动）需要真实渠道 API 或人工登记；当前渠道集成为 MOCK/未接通（06 §1 / F-10）'],
      note: '不以模拟数字冒充真实绩效。'
    },
    note: '本视图只聚合中台真实存在的数据；缺失来源显式标注 Unavailable，不进行 0 填充或估算。'
  };
});

/* ---------------- 关联：Plan / Topic ---------------- */

post('/api/mos/campaigns/:id/link-plan', async (ctx) => {
  const db = getDb();
  const c = db.campaigns.find((x) => x.id === ctx.params.id);
  if (!c) throw httpError(404, 'Campaign 不存在', 'CAMPAIGN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, c.brandCode);
  rbac.assertCan(ctx.principal, 'campaign.manage', c.brandCode, { ip: ctx.ip, objectType: 'campaign', objectId: c.id });

  const planId = String((ctx.body && ctx.body.planId) || '');
  const plan = db.monthly_plans.find((p) => p.id === planId);
  if (!plan) throw httpError(404, '计划不存在', 'PLAN_NOT_FOUND');
  // 品牌一致性（02 §3）
  if (plan.brandCode !== c.brandCode) throw httpError(400, '不可跨品牌关联月度计划', 'BRAND_MISMATCH');
  if (db.monthly_campaign_links.some((l) => l.planId === planId && l.campaignId === c.id)) {
    return { ok: true, alreadyLinked: true };
  }
  db.monthly_campaign_links.push({ id: uid('mcl'), planId, campaignId: c.id, createdAt: new Date().toISOString() });
  save();
  appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'campaign.link.plan', objectType: 'campaign',
    objectId: c.id, ip: ctx.ip, metadata: { planId } });
  return { ok: true, campaign: serialize(db, c, ctx.principal) };
});

post('/api/mos/campaigns/:id/unlink-plan', async (ctx) => {
  const db = getDb();
  const c = db.campaigns.find((x) => x.id === ctx.params.id);
  if (!c) throw httpError(404, 'Campaign 不存在', 'CAMPAIGN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, c.brandCode);
  rbac.assertCan(ctx.principal, 'campaign.manage', c.brandCode, { ip: ctx.ip, objectType: 'campaign', objectId: c.id });
  const planId = String((ctx.body && ctx.body.planId) || '');
  db.monthly_campaign_links = db.monthly_campaign_links.filter((l) => !(l.planId === planId && l.campaignId === c.id));
  save();
  appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'campaign.unlink.plan', objectType: 'campaign',
    objectId: c.id, ip: ctx.ip, metadata: { planId } });
  return { ok: true, campaign: serialize(db, c, ctx.principal) };
});

post('/api/mos/campaigns/:id/link-topic', async (ctx) => {
  const db = getDb();
  const c = db.campaigns.find((x) => x.id === ctx.params.id);
  if (!c) throw httpError(404, 'Campaign 不存在', 'CAMPAIGN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, c.brandCode);
  rbac.assertCan(ctx.principal, 'campaign.manage', c.brandCode, { ip: ctx.ip, objectType: 'campaign', objectId: c.id });

  const topicId = String((ctx.body && ctx.body.topicId) || '');
  const topic = db.master_topics.find((t) => t.id === topicId);
  if (!topic) throw httpError(404, 'Topic 不存在', 'TOPIC_NOT_FOUND');
  // 关键：**禁止跨品牌关联**（02 §3、E2E-02）
  if (topic.brandCode !== c.brandCode) {
    throw httpError(400, '不可跨品牌关联 Master Topic（' + c.brandCode + ' Campaign 不能挂 ' + topic.brandCode + ' Topic）', 'BRAND_MISMATCH');
  }
  if (db.campaign_topic_links.some((l) => l.campaignId === c.id && l.topicId === topicId)) {
    return { ok: true, alreadyLinked: true };
  }
  db.campaign_topic_links.push({ id: uid('ctl'), campaignId: c.id, topicId, createdAt: new Date().toISOString() });
  save();
  appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'campaign.link.topic', objectType: 'campaign',
    objectId: c.id, ip: ctx.ip, metadata: { topicId } });
  return { ok: true, campaign: serialize(db, c, ctx.principal) };
});

del('/api/mos/campaigns/:id/link-topic/:topicId', async (ctx) => {
  const db = getDb();
  const c = db.campaigns.find((x) => x.id === ctx.params.id);
  if (!c) throw httpError(404, 'Campaign 不存在', 'CAMPAIGN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, c.brandCode);
  rbac.assertCan(ctx.principal, 'campaign.manage', c.brandCode, { ip: ctx.ip, objectType: 'campaign', objectId: c.id });
  db.campaign_topic_links = db.campaign_topic_links.filter((l) => !(l.campaignId === c.id && l.topicId === ctx.params.topicId));
  save();
  appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'campaign.unlink.topic', objectType: 'campaign',
    objectId: c.id, ip: ctx.ip, metadata: { topicId: ctx.params.topicId } });
  return { ok: true, campaign: serialize(db, c, ctx.principal) };
});

/** 供其它入口复用（序列化器统一形状；Brief 规则本身在 lib/mos/brieflib.js） */
module.exports = { serialize, CAMPAIGN_STATES };
