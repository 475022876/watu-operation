'use strict';
/**
 * V0.1.2 Phase C —— 编辑域：批准入池 / 批准并安排（幂等 Saga）/ 日周月同源视图。
 *
 * 执行包 03 §原子性派工要求：
 *   - 批准入池：有审核权限 → 正式 Master Topic（state=APPROVED_UNSCHEDULED），绝不平行建第二套 Topic；
 *   - 批准并安排：一个事务性业务操作 = 批准候选 + 选定/新建 Monthly Plan + 唯一 Topic
 *     + PlanItem（每平台交付物一个，挂同一计划）+ 每平台独立 ContentTask + 证据引用；
 *     **不得出现审批成功但派工缺半**。当前 JSON 单文件存储的事务等价物：
 *       1) 全部校验先行（fail-fast，未触碰任何集合前拒绝）；
 *       2) 内存中完成全部对象变更后**一次性 save()**（原子落盘）——
 *          进程在 save() 前崩溃 = 全部未发生（天然回滚）；save() 本身原子替换。
 *   - 幂等：idempotencyKey 必填并全局唯一；重放返回首次结果快照，不重复建 Topic/任务/事项。
 *
 * 审批分离（03 §权限 / 04）：选题审批 ≠ 内容审核 ≠ 发布审核 ≠ library.asset.approve.final。
 */
const { get, post } = require('../router');
const { getDb, save } = require('../store');
const { httpError, todayStr } = require('../../util');
const { dictValid } = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid, taskCode, planCode } = require('../ids');

const nowIso = () => new Date().toISOString();
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ---------------- 公共：由 Proposal 建正式 Topic + 证据引用 ---------------- */

function buildTopicFromProposal(db, p, ctx, narrativeCode, state) {
  const t = {
    id: uid('topic'),
    brandCode: p.brandCode,
    title: p.suggestedTitleEN,
    pillarCode: p.primaryCategory,
    narrativeCode,
    riskGrade: p.riskGrade,
    evidenceStatus: 'MISSING',
    summary: String(p.summaryZH || '').slice(0, 4000),
    ownerId: ctx.user.id,
    state,
    // 溯源：正式 Topic 回链候选选题与研究报告（不复制研究域对象，只引用）
    sourceProposalId: p.id,
    sourceReportId: p.reportId || null,
    demo: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdBy: ctx.user.id,
    rowVersion: 1
  };
  db.master_topics.push(t);
  return t;
}

/**
 * 研究发现 → Topic 证据引用。只有可回溯到真实 SourceItem 的发现才能建立
 * evidence_reference（No Evidence No Claim）；其余如实计入 skipped，不伪造证据。
 */
function linkEvidence(db, p, topicId) {
  let linked = 0;
  let skipped = 0;
  const seen = new Set();
  for (const fid of (p.sourceFindingIds || [])) {
    const f = (db.research_findings || []).find((x) => x.id === fid);
    if (!f || !f.sourceItemId) { skipped += 1; continue; }
    const si = (db.source_items || []).find((s) => s.id === f.sourceItemId);
    if (!si || (si.brandCode && si.brandCode !== p.brandCode)) { skipped += 1; continue; }
    if (seen.has(f.sourceItemId)) continue;
    seen.add(f.sourceItemId);
    db.evidence_references.push({
      id: uid('ev'),
      sourceItemId: f.sourceItemId,
      topicId,
      contentVersionId: null,
      claimLocator: String(f.statement || '').slice(0, 500),
      verificationState: f.verificationState === 'VERIFIED' ? 'VERIFIED' : 'UNVERIFIED',
      demo: !!si.demo,
      createdAt: nowIso()
    });
    linked += 1;
  }
  return { linked, skipped };
}

function failFast(body, db, p) {
  // —— 在触碰任何集合之前完成全部校验（Saga fail-fast）——
  const workDate = String(body.workDate || '').trim();
  if (!DATE_RE.test(workDate)) throw httpError(400, '工作日期需为 YYYY-MM-DD', 'BAD_DATE');
  const narrativeCode = String(body.narrativeCode || 'N01').toUpperCase();
  if (!dictValid('narratives', narrativeCode)) throw httpError(400, '叙事编码非法（N01-N05）', 'BAD_NARRATIVE');

  const deliverables = Array.isArray(body.deliverables) ? body.deliverables : [];
  if (!deliverables.length) throw httpError(400, '批准并安排至少需要 1 个平台交付物（或改用「批准入池」）', 'NO_DELIVERABLES');
  if (deliverables.length > 10) throw httpError(400, '单次派工平台交付物最多 10 个', 'TOO_MANY_DELIVERABLES');
  const seenPlatform = new Set();
  for (const d of deliverables) {
    const platform = String((d && d.platform) || '').toUpperCase();
    if (!dictValid('platforms', platform)) throw httpError(400, '平台非法：' + (platform || '(空)'), 'BAD_PLATFORM');
    if (seenPlatform.has(platform)) throw httpError(400, '平台重复：' + platform, 'DUPLICATE_PLATFORM');
    seenPlatform.add(platform);
    // 派工必填（03 §）：真实员工账号、交付类型、制作期限
    if (!d.ownerId || !db.users.find((u) => u.id === d.ownerId && u.status === 'active')) {
      throw httpError(400, '平台 ' + platform + ' 缺少真实负责人（ownerId 必须是在职用户）', 'BAD_ASSIGNEE');
    }
    if (!d.productionDue || !DATE_RE.test(String(d.productionDue))) {
      throw httpError(400, '平台 ' + platform + ' 缺少制作期限（productionDue，YYYY-MM-DD）', 'BAD_PRODUCTION_DUE');
    }
  }

  let plan = null;
  if (body.planId) {
    plan = db.monthly_plans.find((x) => x.id === body.planId);
    if (!plan) throw httpError(404, '指定计划不存在', 'PLAN_NOT_FOUND');
    if (plan.brandCode !== p.brandCode) throw httpError(400, '不可跨品牌挂接计划', 'BRAND_MISMATCH');
    if (plan.status === 'CANCELLED' || plan.status === 'CLOSED') {
      throw httpError(400, '计划已 ' + plan.status + '，不可挂接新事项', 'PLAN_NOT_EDITABLE');
    }
  }
  return { workDate, narrativeCode, deliverables, plan };
}

function resolvePlan(db, p, ctx, plan, workDate) {
  if (plan) return { plan, autoCreated: false };
  const year = Number(workDate.slice(0, 4));
  const month = Number(workDate.slice(5, 7));
  const candidates = db.monthly_plans
    .filter((x) => x.brandCode === p.brandCode && x.year === year && x.month === month
      && x.status !== 'CANCELLED' && x.status !== 'CLOSED')
    .sort((a, b) => (b.version - a.version));
  if (candidates.length) return { plan: candidates[0], autoCreated: false };
  // 无既有计划 → Saga 内新建 v1（标题自动生成，审计注明来源）
  const version = 1;
  const created = {
    id: uid('plan'),
    brandCode: p.brandCode,
    year, month, version,
    code: planCode(p.brandCode, year, month, version),
    title: p.brandCode + ' ' + year + '-' + String(month).padStart(2, '0') + ' 月度计划（由「批准并安排」自动创建）',
    objectives: [],
    status: 'DRAFT',
    budgetPolicyId: null,
    ownerId: ctx.user.id,
    supersedesId: null,
    reviewNote: '',
    demo: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    createdBy: ctx.user.id,
    rowVersion: 1
  };
  db.monthly_plans.push(created);
  appendAudit({
    actorId: ctx.user.id, brandCode: p.brandCode, eventType: 'plan.created', objectType: 'monthly_plan',
    objectId: created.id, ip: ctx.ip, metadata: { autoBySaga: true, proposalId: p.id, year, month, version }
  });
  return { plan: created, autoCreated: true };
}

/* ---------------- 1. 批准入池（APPROVED_UNSCHEDULED） ---------------- */

post('/api/mos/topic-proposals/:id/approve-to-pool', async (ctx) => {
  const body = ctx.body || {};
  const db = getDb();
  const p = (db.topic_proposals || []).find((x) => x.id === ctx.params.id);
  if (!p) throw httpError(404, '候选选题不存在', 'PROPOSAL_NOT_FOUND');
  rbac.assertBrand(ctx.principal, p.brandCode);
  rbac.assertCan(ctx.principal, 'editorial.approve', p.brandCode);

  const key = body.idempotencyKey ? String(body.idempotencyKey) : null;
  if (p.dispatch && p.dispatch.idempotencyKey && key && p.dispatch.idempotencyKey === key) {
    return { ok: true, replay: true, dispatch: p.dispatch };
  }
  if (p.status !== 'PENDING_EDITORIAL_REVIEW') {
    throw httpError(409, '仅 PENDING_EDITORIAL_REVIEW 可批准（当前 ' + p.status
      + (p.status === 'AI_RECOMMENDED' ? '，请先提交审核）' : '）'), 'BAD_TRANSITION');
  }

  const narrativeCode = String(body.narrativeCode || 'N01').toUpperCase();
  if (!dictValid('narratives', narrativeCode)) throw httpError(400, '叙事编码非法（N01-N05）', 'BAD_NARRATIVE');

  const topic = buildTopicFromProposal(db, p, ctx, narrativeCode, 'APPROVED_UNSCHEDULED');
  const ev = linkEvidence(db, p, topic.id);
  if (ev.linked > 0 && topic.evidenceStatus === 'MISSING') topic.evidenceStatus = 'PARTIAL';

  const priorStatus = p.status;
  p.status = 'APPROVED';
  p.reviewerId = ctx.user.id;
  p.reviewedAt = nowIso();
  p.reviewComments = String(body.comments || '');
  p.topicId = topic.id;
  p.rowVersion += 1;
  p.dispatch = {
    kind: 'POOL', idempotencyKey: key, topicId: topic.id,
    evidenceLinked: ev.linked, evidenceSkipped: ev.skipped, at: nowIso(), by: ctx.user.id
  };

  appendAudit({
    actorId: ctx.user.id, brandCode: p.brandCode, eventType: 'proposal.decision',
    objectType: 'topic_proposal', objectId: p.id, oldState: priorStatus, newState: 'APPROVED',
    metadata: { action: 'APPROVE_TO_POOL', comments: p.reviewComments, topicId: topic.id }
  });
  appendAudit({
    actorId: ctx.user.id, brandCode: p.brandCode, eventType: 'editorial.approve_to_pool',
    objectType: 'master_topic', objectId: topic.id,
    metadata: { proposalId: p.id, evidenceLinked: ev.linked, evidenceSkipped: ev.skipped }
  });
  save();
  return {
    ok: true, replay: false,
    topic: { id: topic.id, title: topic.title, state: topic.state, pillarCode: topic.pillarCode, narrativeCode, riskGrade: topic.riskGrade },
    evidence: { linked: ev.linked, skipped: ev.skipped },
    note: 'Topic 已入池（APPROVED_UNSCHEDULED）。研究证据中无法回溯到真实来源条目的部分如实跳过（evidence.skipped），未伪造任何证据。'
  };
});

/* ---------------- 2. 批准并安排（幂等 Saga） ---------------- */

post('/api/mos/topic-proposals/:id/approve-and-schedule', async (ctx) => {
  const body = ctx.body || {};
  const db = getDb();
  const p = (db.topic_proposals || []).find((x) => x.id === ctx.params.id);
  if (!p) throw httpError(404, '候选选题不存在', 'PROPOSAL_NOT_FOUND');
  rbac.assertBrand(ctx.principal, p.brandCode);
  rbac.assertCan(ctx.principal, 'editorial.approve', p.brandCode);

  const key = String(body.idempotencyKey || '').trim();
  if (!key) throw httpError(400, '缺少 idempotencyKey（防双击/重试重复派工）', 'MISSING_IDEMPOTENCY_KEY');
  // 全局幂等重放：任意 proposal 命中同一 key → 返回首次结果快照，零新增对象
  const replaySrc = (db.topic_proposals || []).find((x) => x.dispatch && x.dispatch.idempotencyKey === key);
  if (replaySrc) {
    return { ok: true, replay: true, proposalId: replaySrc.id, dispatch: replaySrc.dispatch };
  }
  if (p.status !== 'PENDING_EDITORIAL_REVIEW') {
    throw httpError(409, '仅 PENDING_EDITORIAL_REVIEW 可批准并安排（当前 ' + p.status
      + (p.status === 'AI_RECOMMENDED' ? '，请先提交审核）' : '）'), 'BAD_TRANSITION');
  }

  // —— fail-fast 校验（未触碰任何集合）——
  const { workDate, narrativeCode, deliverables, plan: givenPlan } = failFast(body, db, p);

  // —— Saga 执行：内存变更 → 一次性落盘 ——
  const { plan, autoCreated } = resolvePlan(db, p, ctx, givenPlan, workDate);
  const topic = buildTopicFromProposal(db, p, ctx, narrativeCode, 'PLANNED');
  const ev = linkEvidence(db, p, topic.id);
  if (ev.linked > 0 && topic.evidenceStatus === 'MISSING') topic.evidenceStatus = 'PARTIAL';

  const tasks = [];
  const planItems = [];
  for (const d of deliverables) {
    const platform = String(d.platform).toUpperCase();
    const code = taskCode(db);
    const task = {
      id: uid('task'),
      brandCode: p.brandCode,
      code,
      title: String(d.title || '').trim() || (p.suggestedTitleEN + ' · ' + platform),
      type: String(d.type || (platform === 'X' ? 'POST' : 'ARTICLE')).toUpperCase(),
      platform,
      pillarCode: p.primaryCategory,
      narrativeCode,
      riskGrade: p.riskGrade,
      ownerId: d.ownerId,
      campaignId: null,
      topicId: topic.id,
      status: 'PLANNED',
      productionDue: String(d.productionDue),
      reviewDue: d.reviewDue || null,
      plannedPublishAt: null,
      demo: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: ctx.user.id,
      rowVersion: 1
    };
    db.content_tasks.push(task);
    tasks.push(task);
    const item = {
      id: uid('pi'),
      planId: plan.id,
      title: task.title,
      priority: String(body.priority || 'P1').toUpperCase(),
      workDate,
      contentTaskId: task.id,
      adHoc: !!body.adHoc,
      demo: false,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: ctx.user.id,
      rowVersion: 1
    };
    db.plan_items.push(item);
    planItems.push(item);
  }
  // 全部任务已派给真实负责人 → Topic 推进为 ASSIGNED（03 §Topic 状态机）
  topic.state = 'ASSIGNED';
  topic.updatedAt = nowIso();

  const priorStatus = p.status;
  p.status = 'APPROVED';
  p.reviewerId = ctx.user.id;
  p.reviewedAt = nowIso();
  p.reviewComments = String(body.comments || '');
  p.topicId = topic.id;
  p.rowVersion += 1;
  p.dispatch = {
    kind: 'SCHEDULE', idempotencyKey: key, topicId: topic.id, planId: plan.id,
    taskIds: tasks.map((t) => t.id), planItemIds: planItems.map((i) => i.id),
    workDate, autoPlan: autoCreated, evidenceLinked: ev.linked, evidenceSkipped: ev.skipped,
    at: nowIso(), by: ctx.user.id,
    // 重放快照（幂等返回首次结果，不再读库重建）
    result: {
      topicId: topic.id, topicState: topic.state,
      tasks: tasks.map((t) => ({ id: t.id, code: t.code, platform: t.platform, ownerId: t.ownerId, status: t.status })),
      planId: plan.id, planCode: plan.code, workDate
    }
  };

  appendAudit({
    actorId: ctx.user.id, brandCode: p.brandCode, eventType: 'proposal.decision',
    objectType: 'topic_proposal', objectId: p.id, oldState: priorStatus, newState: 'APPROVED',
    metadata: { action: 'APPROVE_AND_SCHEDULE', comments: p.reviewComments, topicId: topic.id, idempotencyKey: key }
  });
  appendAudit({
    actorId: ctx.user.id, brandCode: p.brandCode, eventType: 'editorial.saga_completed',
    objectType: 'master_topic', objectId: topic.id,
    metadata: {
      proposalId: p.id, planId: plan.id, workDate, idempotencyKey: key,
      taskIds: tasks.map((t) => t.id), planItemIds: planItems.map((i) => i.id),
      evidenceLinked: ev.linked, evidenceSkipped: ev.skipped
    }
  });
  save();
  return {
    ok: true, replay: false,
    topic: { id: topic.id, title: topic.title, state: topic.state },
    plan: { id: plan.id, code: plan.code, year: plan.year, month: plan.month, autoCreated },
    tasks: tasks.map((t) => ({ id: t.id, code: t.code, platform: t.platform, ownerId: t.ownerId, status: t.status })),
    planItems: planItems.map((i) => ({ id: i.id, workDate: i.workDate, contentTaskId: i.contentTaskId })),
    evidence: { linked: ev.linked, skipped: ev.skipped },
    note: 'Saga 完成：Topic + ' + tasks.length + ' 个平台任务 + ' + planItems.length
      + ' 个计划事项原子创建。负责人将在其工作台「我的任务」中看到任务（站内通知即任务列表，无站外推送）。'
  };
});

/* ---------------- 3. 日 / 周 / 月同源视图 ---------------- */

/** 与 planning 模块同源：只有同一组 MonthPlan / PlanItem / Task，视图只是过滤与聚合 */
function rangeFor(mode, dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) throw httpError(400, '日期非法（YYYY-MM-DD）', 'BAD_DATE');
  if (mode === 'day') {
    return { from: dateStr, to: dateStr };
  }
  if (mode === 'week') {
    const day = d.getUTCDay() || 7; // 周一=1 … 周日=7
    const from = new Date(d.getTime() - (day - 1) * 86400000);
    const to = new Date(from.getTime() + 6 * 86400000);
    return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
  }
  const from = dateStr.slice(0, 8) + '01';
  const endDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from, to: endDate.toISOString().slice(0, 10) };
}

get('/api/mos/editorial/views', async (ctx) => {
  const brandCode = String(ctx.query.brand || '').toUpperCase();
  if (!brandCode) throw httpError(400, '缺少品牌', 'MISSING_BRAND');
  rbac.assertBrand(ctx.principal, brandCode);
  const db = getDb();
  const mode = ['day', 'week', 'month'].indexOf(String(ctx.query.mode || 'month')) !== -1
    ? String(ctx.query.mode) : 'month';
  const dateStr = DATE_RE.test(String(ctx.query.date || '')) ? String(ctx.query.date) : todayStr();
  const range = rangeFor(mode, dateStr);

  const planIds = new Set(db.monthly_plans.filter((x) => x.brandCode === brandCode).map((x) => x.id));
  const inRange = (s) => s >= range.from && s <= range.to;

  // 同一数据源：plan_items（挂同品牌计划）→ content_tasks；排期单独列出（排期 ≠ 已发布）
  const items = db.plan_items
    .filter((i) => planIds.has(i.planId) && inRange(i.workDate))
    .map((i) => {
      const t = db.content_tasks.find((x) => x.id === i.contentTaskId);
      return {
        planItemId: i.id, planId: i.planId, workDate: i.workDate, title: i.title,
        priority: i.priority, adHoc: !!i.adHoc,
        task: t ? { id: t.id, code: t.code, platform: t.platform, status: t.status,
          ownerId: t.ownerId, topicId: t.topicId, productionDue: t.productionDue || null } : null
      };
    });
  const byStatus = {};
  for (const it of items) {
    const s = (it.task && it.task.status) || 'NO_TASK';
    byStatus[s] = (byStatus[s] || 0) + 1;
  }
  const scheduled = (db.publishing_schedules || [])
    .filter((s) => s.brandCode === brandCode && s.scheduledAt && inRange(String(s.scheduledAt).slice(0, 10)))
    .map((s) => ({ id: s.id, contentTaskId: s.contentTaskId, scheduledAt: s.scheduledAt, status: s.status }));

  return {
    ok: true, mode, range, brandCode,
    counts: { total: items.length, byStatus, scheduled: scheduled.length },
    items, scheduled,
    note: '日/周/月为同一 MonthPlan/PlanItem/Task 数据源的过滤视图；时间以 UTC 日期过滤，展示层负责时区换算。'
  };
});
