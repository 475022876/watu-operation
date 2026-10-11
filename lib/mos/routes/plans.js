'use strict';
/**
 * 月度计划与 PlanItem（W03-01 Monthly Planning）+ 统一日历（W05-01 的 BUILD-01 子集）。
 *
 * 状态机（03 §2.1）：DRAFT -> SUBMITTED -> APPROVED -> ACTIVE -> CLOSED，可 REVISION_REQUIRED / CANCELLED。
 * 关键口径：
 *   - 「批准月度计划」需要 plan.approve 权限（03 §2.1：仅获授权的 P1/管理角色）；
 *   - 批准后**重大修改生成新版本**（保留原计划版本），不得静默覆盖；
 *   - 周视图只是 PlanItem 的过滤，**不复制**月计划；
 *   - 日历统一使用 PlanItem / content_task 的计划日期，不做第二套排期对象。
 */
const { get, post, put, del } = require('../router');
const { getDb, save } = require('../store');
const { httpError, todayStr } = require('../../util');
const { PLAN_TRANSITIONS, dictValid, TASK_STATUSES } = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid, planCode } = require('../ids');
const helpers = require('./helpers');

const PRIORITIES = ['P0', 'P1', 'P2'];

function serializePlan(db, plan, principal) {
  const items = db.plan_items.filter((i) => i.planId === plan.id);
  const campaigns = db.monthly_campaign_links
    .filter((l) => l.planId === plan.id)
    .map((l) => {
      const c = db.campaigns.find((x) => x.id === l.campaignId);
      return c ? { id: c.id, title: c.title, state: c.state, code: c.code } : null;
    }).filter(Boolean);
  return {
    id: plan.id,
    code: plan.code,
    brandCode: plan.brandCode,
    year: plan.year,
    month: plan.month,
    version: plan.version,
    title: plan.title,
    objectives: plan.objectives || [],
    status: plan.status,
    ownerId: plan.ownerId,
    ownerName: nameOf(db, plan.ownerId),
    supersedesId: plan.supersedesId || null,
    reviewNote: plan.reviewNote || '',
    itemCount: items.length,
    campaigns,
    demo: !!plan.demo,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
    rowVersion: plan.rowVersion || 1,
    can: {
      update: rbac.can(principal, 'plan.update', plan.brandCode),
      approve: rbac.can(principal, 'plan.approve', plan.brandCode)
    }
  };
}

function nameOf(db, userId) {
  const u = db.users.find((x) => x.id === userId);
  return u ? u.displayName : '（未知）';
}

function serializeItem(db, item) {
  return {
    id: item.id,
    planId: item.planId,
    title: item.title,
    priority: item.priority,
    workDate: item.workDate,
    contentTaskId: item.contentTaskId || null,
    contentTaskTitle: item.contentTaskId ? ((db.content_tasks.find((t) => t.id === item.contentTaskId) || {}).title || '') : '',
    adHoc: !!item.adHoc,
    demo: !!item.demo,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    rowVersion: item.rowVersion || 1
  };
}

/* ---------------- 计划列表 / 详情 ---------------- */

get('/api/mos/plans', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  const year = ctx.query.year ? Number(ctx.query.year) : null;
  const month = ctx.query.month ? Number(ctx.query.month) : null;
  let rows = db.monthly_plans.filter((p) => p.brandCode === brandCode);
  if (year) rows = rows.filter((p) => p.year === year);
  if (month) rows = rows.filter((p) => p.month === month);
  rows = rows.slice().sort((a, b) => (b.year - a.year) || (b.month - a.month) || (b.version - a.version));
  const paged = helpers.paginate(rows, ctx.query);
  return {
    ok: true,
    brandCode,
    page: paged.page,
    pageSize: paged.pageSize,
    total: paged.total,
    items: paged.items.map((p) => serializePlan(db, p, ctx.principal))
  };
});

get('/api/mos/plans/:id', async (ctx) => {
  const db = getDb();
  const plan = db.monthly_plans.find((p) => p.id === ctx.params.id);
  if (!plan) throw httpError(404, '计划不存在', 'PLAN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, plan.brandCode);
  const items = db.plan_items.filter((i) => i.planId === plan.id).sort((a, b) => (a.workDate < b.workDate ? -1 : 1));
  return {
    ok: true,
    plan: serializePlan(db, plan, ctx.principal),
    items: items.map((i) => serializeItem(db, i)),
    allowedTransitions: PLAN_TRANSITIONS[plan.status] || []
  };
});

/* ---------------- 创建 / 修改 ---------------- */

post('/api/mos/plans', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'plan.create', brandCode, { ip: ctx.ip, objectType: 'monthly_plan' });

  const year = Number(body.year);
  const month = Number(body.month);
  if (!year || year < 2020 || year > 2100) throw httpError(400, '年份非法', 'BAD_YEAR');
  if (!month || month < 1 || month > 12) throw httpError(400, '月份非法（1-12）', 'BAD_MONTH');
  const title = String(body.title || '').trim();
  if (!title) throw httpError(400, '请填写计划标题', 'MISSING_TITLE');
  const objectives = Array.isArray(body.objectives)
    ? body.objectives.map((o) => String(o).trim()).filter(Boolean).slice(0, 20) : [];

  // 唯一约束（02 §2）：品牌 + 月份 + version 唯一
  const version = 1;
  if (db.monthly_plans.some((p) => p.brandCode === brandCode && p.year === year && p.month === month && p.version === version)) {
    throw httpError(409, '该品牌该月已存在 v' + version + ' 计划；如为重大修订，请基于既有计划创建新版本', 'PLAN_VERSION_EXISTS');
  }

  const plan = {
    id: uid('plan'),
    brandCode,
    year,
    month,
    version,
    code: planCode(brandCode, year, month, version),
    title,
    objectives,
    status: 'DRAFT',
    budgetPolicyId: null,
    ownerId: ctx.user.id,
    supersedesId: body.supersedesId ? String(body.supersedesId) : null,
    reviewNote: '',
    demo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: ctx.user.id,
    rowVersion: 1
  };
  db.monthly_plans.push(plan);
  save();
  appendAudit({
    actorId: ctx.user.id, brandCode, eventType: 'plan.created', objectType: 'monthly_plan',
    objectId: plan.id, newState: 'DRAFT', ip: ctx.ip, metadata: { code: plan.code }
  });
  return { ok: true, plan: serializePlan(db, plan, ctx.principal) };
});

put('/api/mos/plans/:id', async (ctx) => {
  const db = getDb();
  const plan = db.monthly_plans.find((p) => p.id === ctx.params.id);
  if (!plan) throw httpError(404, '计划不存在', 'PLAN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, plan.brandCode);
  rbac.assertCan(ctx.principal, 'plan.update', plan.brandCode, { ip: ctx.ip, objectType: 'monthly_plan', objectId: plan.id });
  if (plan.status === 'CLOSED' || plan.status === 'CANCELLED') {
    throw httpError(409, '已关闭或已作废的计划不可修改', 'PLAN_NOT_EDITABLE');
  }
  const body = ctx.body || {};
  const patch = {};
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (!t) throw httpError(400, '标题不能为空', 'MISSING_TITLE');
    patch.title = t;
  }
  if (body.objectives !== undefined) {
    patch.objectives = Array.isArray(body.objectives) ? body.objectives.map((o) => String(o).trim()).filter(Boolean).slice(0, 20) : [];
  }
  const changed = helpers.applyUpdate(plan, patch, ctx.user.id, body.rowVersion);
  if (changed) {
    save();
    appendAudit({
      actorId: ctx.user.id, brandCode: plan.brandCode, eventType: 'plan.updated', objectType: 'monthly_plan',
      objectId: plan.id, ip: ctx.ip, metadata: { fields: Object.keys(patch) }
    });
  }
  return { ok: true, plan: serializePlan(db, plan, ctx.principal), changed };
});

/** 状态迁移（服务端 guard） */
post('/api/mos/plans/:id/transition', async (ctx) => {
  const db = getDb();
  const plan = db.monthly_plans.find((p) => p.id === ctx.params.id);
  if (!plan) throw httpError(404, '计划不存在', 'PLAN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, plan.brandCode);

  const action = String((ctx.body && ctx.body.action) || '').toUpperCase();
  const map = {
    SUBMIT: 'SUBMITTED', APPROVE: 'APPROVED', REVISION: 'REVISION_REQUIRED',
    ACTIVATE: 'ACTIVE', CLOSE: 'CLOSED', CANCEL: 'CANCELLED', BACK_TO_DRAFT: 'DRAFT'
  };
  const target = map[action];
  if (!target) throw httpError(400, '不支持的迁移动作：' + action, 'BAD_ACTION');

  // 授权先于状态判定：无权限者统一 403，不应从状态机报错中反推对象当前状态
  if (target === 'APPROVED') {
    // 批准是独立权限点（不随 P1 自动获得），拒绝时以 scene 标注具体场景
    rbac.assertCan(ctx.principal, 'plan.approve', plan.brandCode,
      { ip: ctx.ip, objectType: 'monthly_plan', objectId: plan.id, scene: 'plan.approve.denied' });
  } else {
    rbac.assertCan(ctx.principal, 'plan.update', plan.brandCode, { ip: ctx.ip, objectType: 'monthly_plan', objectId: plan.id });
  }

  const allowed = (PLAN_TRANSITIONS[plan.status] || []).indexOf(target) !== -1;
  if (!allowed) throw httpError(409, '当前状态 ' + plan.status + ' 不允许迁移到 ' + target, 'ILLEGAL_TRANSITION');

  const from = plan.status;
  plan.status = target;
  plan.updatedAt = new Date().toISOString();
  plan.updatedBy = ctx.user.id;
  plan.rowVersion = Number(plan.rowVersion || 1) + 1;
  if (target === 'SUBMITTED') plan.submittedAt = new Date().toISOString();
  if (target === 'APPROVED') { plan.approvedAt = new Date().toISOString(); plan.approvedBy = ctx.user.id; }
  if (ctx.body && ctx.body.note) plan.reviewNote = String(ctx.body.note).slice(0, 1000);
  save();
  appendAudit({
    actorId: ctx.user.id, brandCode: plan.brandCode, eventType: 'plan.transition', objectType: 'monthly_plan',
    objectId: plan.id, oldState: from, newState: target, ip: ctx.ip, metadata: { note: ctx.body ? ctx.body.note : '' }
  });
  return { ok: true, plan: serializePlan(db, plan, ctx.principal) };
});

/* ---------------- PlanItem ---------------- */

post('/api/mos/plans/:id/items', async (ctx) => {
  const db = getDb();
  const plan = db.monthly_plans.find((p) => p.id === ctx.params.id);
  if (!plan) throw httpError(404, '计划不存在', 'PLAN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, plan.brandCode);
  rbac.assertCan(ctx.principal, 'plan.update', plan.brandCode, { ip: ctx.ip, objectType: 'plan_item' });

  const body = ctx.body || {};
  const title = String(body.title || '').trim();
  if (!title) throw httpError(400, '请填写事项标题', 'MISSING_TITLE');
  const priority = String(body.priority || 'P1').toUpperCase();
  if (PRIORITIES.indexOf(priority) === -1) throw httpError(400, '优先级只能是 P0/P1/P2', 'BAD_PRIORITY');
  const workDate = String(body.workDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) throw httpError(400, '工作日期需为 YYYY-MM-DD', 'BAD_DATE');

  // 关联任务必须同品牌（02 §3 品牌一致性）
  let contentTaskId = body.contentTaskId ? String(body.contentTaskId) : null;
  if (contentTaskId) {
    const task = db.content_tasks.find((t) => t.id === contentTaskId);
    if (!task) throw httpError(400, '关联内容任务不存在', 'TASK_NOT_FOUND');
    if (task.brandCode !== plan.brandCode) throw httpError(400, '不可跨品牌关联内容任务（VFIB 计划不能挂 U CARD 任务）', 'BRAND_MISMATCH');
  }

  const item = {
    id: uid('pi'),
    planId: plan.id,
    title,
    priority,
    workDate,
    contentTaskId,
    adHoc: !!body.adHoc,
    demo: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: ctx.user.id,
    rowVersion: 1
  };
  db.plan_items.push(item);
  save();
  appendAudit({
    actorId: ctx.user.id, brandCode: plan.brandCode, eventType: 'plan_item.created', objectType: 'plan_item',
    objectId: item.id, ip: ctx.ip, metadata: { planId: plan.id, workDate, adHoc: item.adHoc }
  });
  return { ok: true, item: serializeItem(db, item) };
});

put('/api/mos/plan-items/:id', async (ctx) => {
  const db = getDb();
  const item = db.plan_items.find((i) => i.id === ctx.params.id);
  if (!item) throw httpError(404, '事项不存在', 'ITEM_NOT_FOUND');
  const plan = db.monthly_plans.find((p) => p.id === item.planId);
  if (!plan) throw httpError(404, '所属计划不存在', 'PLAN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, plan.brandCode);
  rbac.assertCan(ctx.principal, 'plan.update', plan.brandCode, { ip: ctx.ip, objectType: 'plan_item', objectId: item.id });

  const body = ctx.body || {};
  const patch = {};
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (!t) throw httpError(400, '标题不能为空', 'MISSING_TITLE');
    patch.title = t;
  }
  if (body.priority !== undefined) {
    const p = String(body.priority).toUpperCase();
    if (PRIORITIES.indexOf(p) === -1) throw httpError(400, '优先级非法', 'BAD_PRIORITY');
    patch.priority = p;
  }
  if (body.workDate !== undefined) {
    const d = String(body.workDate).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw httpError(400, '工作日期非法', 'BAD_DATE');
    patch.workDate = d;
  }
  const changed = helpers.applyUpdate(item, patch, ctx.user.id, body.rowVersion);
  if (changed) {
    save();
    appendAudit({
      actorId: ctx.user.id, brandCode: plan.brandCode, eventType: 'plan_item.updated', objectType: 'plan_item',
      objectId: item.id, ip: ctx.ip, metadata: { fields: Object.keys(patch) }
    });
  }
  return { ok: true, item: serializeItem(db, item), changed };
});

del('/api/mos/plan-items/:id', async (ctx) => {
  const db = getDb();
  const item = db.plan_items.find((i) => i.id === ctx.params.id);
  if (!item) throw httpError(404, '事项不存在', 'ITEM_NOT_FOUND');
  const plan = db.monthly_plans.find((p) => p.id === item.planId);
  if (!plan) throw httpError(404, '所属计划不存在', 'PLAN_NOT_FOUND');
  rbac.assertBrand(ctx.principal, plan.brandCode);
  rbac.assertCan(ctx.principal, 'plan.update', plan.brandCode, { ip: ctx.ip, objectType: 'plan_item', objectId: item.id });
  db.plan_items = db.plan_items.filter((i) => i.id !== item.id);
  save();
  appendAudit({
    actorId: ctx.user.id, brandCode: plan.brandCode, eventType: 'plan_item.deleted', objectType: 'plan_item',
    objectId: item.id, ip: ctx.ip, metadata: { planId: plan.id }
  });
  return { ok: true };
});

/* ---------------- 统一日历（月/周/列表同一数据源） ---------------- */

get('/api/mos/calendar', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  const view = String(ctx.query.view || 'month').toLowerCase();
  const anchor = String(ctx.query.anchor || todayStr()).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw httpError(400, 'anchor 需为 YYYY-MM-DD', 'BAD_ANCHOR');

  let from;
  let to;
  const base = new Date(anchor + 'T00:00:00');
  if (view === 'week') {
    const dow = (base.getDay() + 6) % 7; // 周一为 0
    const start = new Date(base); start.setDate(base.getDate() - dow);
    const end = new Date(start); end.setDate(start.getDate() + 6);
    from = start; to = end;
  } else if (view === 'month') {
    from = new Date(base.getFullYear(), base.getMonth(), 1);
    to = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  } else {
    from = new Date(base.getFullYear(), base.getMonth(), 1);
    to = new Date(base.getFullYear(), base.getMonth() + 3, 0);
  }
  const iso = (d) => d.toISOString().slice(0, 10);
  const fromStr = iso(from);
  const toStr = iso(to);

  const plans = db.monthly_plans.filter((p) => p.brandCode === brandCode);
  const planIds = new Set(plans.map((p) => p.id));
  const planById = {};
  for (const p of plans) planById[p.id] = p;

  const entries = [];
  for (const item of db.plan_items) {
    if (!planIds.has(item.planId)) continue;
    if (item.workDate < fromStr || item.workDate > toStr) continue;
    const plan = planById[item.planId];
    entries.push({
      kind: 'PLAN_ITEM',
      id: item.id,
      date: item.workDate,
      title: item.title,
      priority: item.priority,
      adHoc: !!item.adHoc,
      planId: item.planId,
      planCode: plan ? plan.code : '',
      planStatus: plan ? plan.status : '',
      contentTaskId: item.contentTaskId || null
    });
  }
  // 内容任务的计划日期（production_due / review_due / planned_publish_at）
  for (const t of db.content_tasks) {
    if (t.brandCode !== brandCode) continue;
    const marks = [
      { field: 'productionDue', label: '制作截止' },
      { field: 'reviewDue', label: '审核截止' },
      { field: 'plannedPublishAt', label: '计划发布' }
    ];
    for (const mk of marks) {
      const d = String(t[mk.field] || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
      if (d < fromStr || d > toStr) continue;
      entries.push({
        kind: 'TASK_DATE',
        id: t.id + ':' + mk.field,
        taskId: t.id,
        date: d,
        title: t.title,
        field: mk.field,
        fieldLabel: mk.label,
        status: t.status,
        topicId: t.topicId || null,
        campaignId: t.campaignId || null
      });
    }
  }

  entries.sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)));
  return {
    ok: true, brandCode, view, anchor, from: fromStr, to: toStr,
    entries,
    note: '日历只反映**计划日期**；实际发布时间以发布登记为准（05 §1 / 03 §2.3）。'
  };
});

void TASK_STATUSES;
void dictValid;
