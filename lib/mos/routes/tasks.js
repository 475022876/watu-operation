'use strict';
/**
 * ContentTask（W01-01 My Work / W03 内容任务）。
 *
 * 状态机（03 §2.2）：IDEA -> PLANNED -> IN_PRODUCTION -> IN_REVIEW -> READY -> COMPLETED
 * 服务端强制迁移合法性（TASK_TRANSITIONS）；非法迁移 409。
 * 一个 Task 可关联 0 或 1 个 Campaign、0 或 1 个 Topic（02 §3），均须同品牌。
 */
const { get, post, put } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const { TASK_TRANSITIONS, TASK_STATUSES, dictValid } = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid, taskCode } = require('../ids');
const helpers = require('./helpers');

const TYPES = ['ARTICLE', 'THREAD', 'CAROUSEL', 'VIDEO_SCRIPT', 'POST', 'NEWSLETTER'];

function serialize(db, t, principal) {
  const owner = db.users.find((u) => u.id === t.ownerId);
  const topic = t.topicId ? db.master_topics.find((x) => x.id === t.topicId) : null;
  const campaign = t.campaignId ? db.campaigns.find((x) => x.id === t.campaignId) : null;
  return {
    id: t.id, code: t.code, brandCode: t.brandCode, title: t.title, type: t.type, platform: t.platform,
    pillarCode: t.pillarCode, narrativeCode: t.narrativeCode, riskGrade: t.riskGrade,
    ownerId: t.ownerId, ownerName: owner ? owner.displayName : '（未知）',
    campaignId: t.campaignId || null, campaignTitle: campaign ? campaign.title : '',
    topicId: t.topicId || null, topicTitle: topic ? topic.title : '',
    status: t.status,
    productionDue: t.productionDue || null,
    reviewDue: t.reviewDue || null,
    plannedPublishAt: t.plannedPublishAt || null,
    versionCount: db.content_versions ? db.content_versions.filter((v) => v.contentTaskId === t.id).length : 0,
    demo: !!t.demo, createdAt: t.createdAt, updatedAt: t.updatedAt, rowVersion: t.rowVersion || 1,
    allowedTransitions: TASK_TRANSITIONS[t.status] || [],
    can: {
      edit: rbac.can(principal, 'content.edit', t.brandCode),
      submit: rbac.can(principal, 'content.submit', t.brandCode)
    }
  };
}

get('/api/mos/tasks', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.content_tasks.filter((t) => t.brandCode === brandCode);
  if (ctx.query.status) {
    const s = String(ctx.query.status).toUpperCase();
    if (TASK_STATUSES.indexOf(s) === -1) throw httpError(400, '状态非法', 'BAD_STATUS');
    rows = rows.filter((t) => t.status === s);
  }
  if (ctx.query.platform) rows = rows.filter((t) => t.platform === String(ctx.query.platform).toUpperCase());
  if (ctx.query.mine === '1') rows = rows.filter((t) => t.ownerId === ctx.user.id);
  const kw = String(ctx.query.q || '').trim().toLowerCase();
  if (kw) rows = rows.filter((t) => t.title.toLowerCase().indexOf(kw) !== -1 || String(t.code).toLowerCase().indexOf(kw) !== -1);
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const paged = helpers.paginate(rows, ctx.query);
  return { ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((t) => serialize(db, t, ctx.principal)) };
});

get('/api/mos/tasks/:id', async (ctx) => {
  const db = getDb();
  const t = db.content_tasks.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, '任务不存在', 'TASK_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);
  const planItems = db.plan_items.filter((i) => i.contentTaskId === t.id);
  return { ok: true, task: serialize(db, t, ctx.principal), planItems };
});

post('/api/mos/tasks', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'content.edit', brandCode, { ip: ctx.ip, objectType: 'content_task' });

  const title = String(body.title || '').trim();
  if (!title) throw httpError(400, '请填写任务标题', 'MISSING_TITLE');
  const platform = String(body.platform || 'LINKEDIN').toUpperCase();
  if (!dictValid('platforms', platform)) throw httpError(400, '平台非法', 'BAD_PLATFORM');
  const type = String(body.type || 'ARTICLE').toUpperCase();
  if (TYPES.indexOf(type) === -1) throw httpError(400, '任务类型非法', 'BAD_TYPE');
  const pillarCode = String(body.pillarCode || 'C01').toUpperCase();
  if (!dictValid('pillars', pillarCode)) throw httpError(400, '栏目编码非法', 'BAD_PILLAR');
  const narrativeCode = String(body.narrativeCode || 'N01').toUpperCase();
  if (!dictValid('narratives', narrativeCode)) throw httpError(400, '叙事编码非法', 'BAD_NARRATIVE');
  const riskGrade = String(body.riskGrade || 'G1').toUpperCase();
  if (!dictValid('riskGrades', riskGrade)) throw httpError(400, '风险等级非法', 'BAD_RISK');

  let campaignId = body.campaignId ? String(body.campaignId) : null;
  let topicId = body.topicId ? String(body.topicId) : null;
  if (campaignId) {
    const c = db.campaigns.find((x) => x.id === campaignId);
    if (!c) throw httpError(400, 'Campaign 不存在', 'CAMPAIGN_NOT_FOUND');
    if (c.brandCode !== brandCode) throw httpError(400, '不可跨品牌关联 Campaign', 'BRAND_MISMATCH');
  }
  if (topicId) {
    const t = db.master_topics.find((x) => x.id === topicId);
    if (!t) throw httpError(400, 'Topic 不存在', 'TOPIC_NOT_FOUND');
    if (t.brandCode !== brandCode) throw httpError(400, '不可跨品牌关联 Topic', 'BRAND_MISMATCH');
  }

  const task = {
    id: uid('task'),
    brandCode,
    code: taskCode(db),
    title, type, platform, pillarCode, narrativeCode, riskGrade,
    ownerId: ctx.user.id,
    campaignId, topicId,
    status: 'IDEA',
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
  appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'content_task.created', objectType: 'content_task',
    objectId: task.id, newState: 'IDEA', ip: ctx.ip, metadata: { code: task.code, platform } });
  return { ok: true, task: serialize(db, task, ctx.principal) };
});

/** 独立创建的临时任务（AD_HOC）：不依赖月度计划（05 §1） */
post('/api/mos/tasks/ad-hoc', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'content.edit', brandCode, { ip: ctx.ip, objectType: 'content_task' });
  const title = String(body.title || '').trim();
  if (!title) throw httpError(400, '请填写任务标题', 'MISSING_TITLE');
  const workDate = String(body.workDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) throw httpError(400, '工作日期需为 YYYY-MM-DD', 'BAD_DATE');

  const task = {
    id: uid('task'), brandCode, code: taskCode(db),
    title, type: 'POST', platform: String(body.platform || 'LINKEDIN').toUpperCase(),
    pillarCode: 'C01', narrativeCode: 'N01', riskGrade: 'G1',
    ownerId: ctx.user.id, campaignId: null, topicId: null,
    status: 'PLANNED', adHoc: true,
    productionDue: workDate, reviewDue: null, plannedPublishAt: workDate,
    demo: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    createdBy: ctx.user.id, rowVersion: 1
  };
  db.content_tasks.push(task);
  save();
  appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'content_task.ad_hoc.created', objectType: 'content_task',
    objectId: task.id, newState: 'PLANNED', ip: ctx.ip, metadata: { code: task.code, workDate } });
  return { ok: true, task: serialize(db, task, ctx.principal) };
});

put('/api/mos/tasks/:id', async (ctx) => {
  const db = getDb();
  const t = db.content_tasks.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, '任务不存在', 'TASK_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);
  rbac.assertCan(ctx.principal, 'content.edit', t.brandCode, { ip: ctx.ip, objectType: 'content_task', objectId: t.id });

  const body = ctx.body || {};
  const patch = {};
  if (body.title !== undefined) {
    const v = String(body.title).trim();
    if (!v) throw httpError(400, '标题不能为空', 'MISSING_TITLE');
    patch.title = v;
  }
  if (body.platform !== undefined) {
    const v = String(body.platform).toUpperCase();
    if (!dictValid('platforms', v)) throw httpError(400, '平台非法', 'BAD_PLATFORM');
    patch.platform = v;
  }
  if (body.riskGrade !== undefined) {
    const v = String(body.riskGrade).toUpperCase();
    if (!dictValid('riskGrades', v)) throw httpError(400, '风险等级非法', 'BAD_RISK');
    patch.riskGrade = v;
  }
  for (const key of ['productionDue', 'reviewDue', 'plannedPublishAt']) {
    if (body[key] !== undefined) {
      const v = body[key] ? String(body[key]).slice(0, 10) : null;
      if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw httpError(400, key + ' 需为 YYYY-MM-DD', 'BAD_DATE');
      patch[key] = v;
    }
  }
  const changed = helpers.applyUpdate(t, patch, ctx.user.id, body.rowVersion);
  if (changed) {
    save();
    appendAudit({ actorId: ctx.user.id, brandCode: t.brandCode, eventType: 'content_task.updated', objectType: 'content_task',
      objectId: t.id, ip: ctx.ip, metadata: { fields: Object.keys(patch) } });
  }
  return { ok: true, task: serialize(db, t, ctx.principal), changed };
});

/** 状态迁移（服务端强制） */
post('/api/mos/tasks/:id/transition', async (ctx) => {
  const db = getDb();
  const t = db.content_tasks.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, '任务不存在', 'TASK_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);

  const target = String((ctx.body && ctx.body.status) || '').toUpperCase();
  if (TASK_STATUSES.indexOf(target) === -1) throw httpError(400, '状态非法', 'BAD_STATUS');

  // 授权先于状态判定：无权限者统一 403，避免从状态机报错反推对象状态
  // 进入 IN_REVIEW / READY 需要送审权限（BUILD-02 会在此挂载 ReviewCase 创建）
  if (target === 'IN_REVIEW' || target === 'READY') {
    rbac.assertCan(ctx.principal, 'content.submit', t.brandCode, { ip: ctx.ip, objectType: 'content_task', objectId: t.id });
  } else {
    rbac.assertCan(ctx.principal, 'content.edit', t.brandCode, { ip: ctx.ip, objectType: 'content_task', objectId: t.id });
  }

  const allowed = (TASK_TRANSITIONS[t.status] || []);
  if (allowed.indexOf(target) === -1) {
    throw httpError(409, '当前状态 ' + t.status + ' 不允许迁移到 ' + target, 'ILLEGAL_TRANSITION');
  }

  const from = t.status;
  t.status = target;
  t.updatedAt = new Date().toISOString();
  t.updatedBy = ctx.user.id;
  t.rowVersion = Number(t.rowVersion || 1) + 1;
  save();
  appendAudit({ actorId: ctx.user.id, brandCode: t.brandCode, eventType: 'content_task.transition', objectType: 'content_task',
    objectId: t.id, oldState: from, newState: target, ip: ctx.ip, metadata: { note: ctx.body ? ctx.body.note : '' } });
  return { ok: true, task: serialize(db, t, ctx.principal) };
});

/** My Work（W01-01）：我负责的任务 + 我的下一步动作 */
get('/api/mos/my-work', async (ctx) => {
  const db = getDb();
  const brandCode = ctx.query.brand ? String(ctx.query.brand).toUpperCase() : null;
  if (brandCode) rbac.assertBrand(ctx.principal, brandCode);

  const visibleBrands = ctx.principal.brandCodes;
  const inScope = (b) => visibleBrands.indexOf(b) !== -1;
  const scoped = brandCode ? [brandCode] : visibleBrands;

  const mineTasks = db.content_tasks.filter((t) => inScope(t.brandCode) && t.ownerId === ctx.user.id
    && scoped.indexOf(t.brandCode) !== -1 && ['IDEA', 'PLANNED', 'IN_PRODUCTION', 'IN_REVIEW'].indexOf(t.status) !== -1)
    .map((t) => serialize(db, t, ctx.principal));

  const myPlans = db.monthly_plans.filter((p) => inScope(p.brandCode) && scoped.indexOf(p.brandCode) !== -1
    && p.ownerId === ctx.user.id && ['DRAFT', 'REVISION_REQUIRED'].indexOf(p.status) !== -1)
    .map((p) => ({ id: p.id, code: p.code, title: p.title, status: p.status, brandCode: p.brandCode }));

  // 待我审核（BUILD-02）：真实 ReviewCase 队列，按"我是否有裁决权"过滤
  // （03 §4 职责分离与提升授权由 decideCapability 判定，前端隐藏控件不具备授权意义）
  const reviewsRoute = require('./reviews');
  const pendingReviews = db.review_cases
    .filter((c) => inScope(c.brandCode) && scoped.indexOf(c.brandCode) !== -1
      && ['SUBMITTED', 'IN_REVIEW'].indexOf(c.state) !== -1)
    .map((c) => reviewsRoute.serialize(db, c, ctx.principal))
    .filter((c) => c.canDecide);

  return {
    ok: true,
    scope: { brandCode: brandCode || 'ALL', brands: scoped },
    tasks: mineTasks,
    draftPlans: myPlans,
    pendingReviews,
    // 明确的空态原因，避免"看起来没数据"（01 §4）
    emptyHints: {
      tasks: mineTasks.length ? '' : '当前没有指派给你的未完成任务。可从「月度计划」创建事项，或在「内容任务」中新建任务。',
      reviews: pendingReviews.length ? ''
        : '当前没有需要你裁决的审核单。审核队列只会显示你有权处理（且非你本人创建）的条目。'
    }
  };
});

/** Active Projects（W01-02）：我可见品牌下的活动 Campaign/Topic */
get('/api/mos/active-projects', async (ctx) => {
  const db = getDb();
  const brands = ctx.principal.brandCodes;
  const campaigns = db.campaigns.filter((c) => brands.indexOf(c.brandCode) !== -1 && c.state === 'ACTIVE')
    .map((c) => ({ id: c.id, code: c.code, title: c.title, brandCode: c.brandCode, state: c.state,
      taskCount: db.content_tasks.filter((t) => t.campaignId === c.id).length }));
  const topics = db.master_topics.filter((t) => brands.indexOf(t.brandCode) !== -1 && ['RESEARCHING', 'ACTIVE'].indexOf(t.state) !== -1)
    .map((t) => ({ id: t.id, title: t.title, brandCode: t.brandCode, state: t.state, pillarCode: t.pillarCode,
      evidenceStatus: t.evidenceStatus, taskCount: db.content_tasks.filter((x) => x.topicId === t.id).length }));
  return { ok: true, campaigns, topics };
});
