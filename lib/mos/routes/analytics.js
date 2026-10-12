'use strict';
/**
 * Marketing OS —— Analytics 真实聚合（W07-01~04 / 00 §4 / 08 §Gate C）。
 *
 * 范围**严格限定**在主控 00 §4 的「内容、渠道、计划执行、AI 成本、审核周期」：
 * 不做 CAC、不做获客漏斗、不做行为归因（MARK-S05 明令不在 V0.1）。
 *
 * 诚实性硬规则（08 §Gate C「无真实数据时显示缺失」）：
 *   - 全部数字由服务端对**本库真实记录**聚合得出，不使用任何占位/示例数字；
 *   - 没有数据来源的指标一律 `available:false` 并给出 `missing` 原因，
 *     **绝不用 0 冒充「表现很好」**；
 *   - 费用只统计供应商**实际回执**（`cost.confirmed`），不做换汇推算（04 §5）；
 *   - MOCK 数据（生成作业 / 沙盒资产）单独计数并显著标注，不混入真实表现。
 */
const { get } = require('../router');
const { getDb } = require('../store');
const rbac = require('../rbac');
const { getMosConfig } = require('../config');
const helpers = require('./helpers');

const DAY = 86400000;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function hoursBetween(a, b) {
  const t1 = Date.parse(a);
  const t2 = Date.parse(b);
  if (Number.isNaN(t1) || Number.isNaN(t2)) return null;
  return (t2 - t1) / 3600000;
}
function avg(nums) {
  if (!nums.length) return null;
  return nums.reduce((s, x) => s + x, 0) / nums.length;
}
function countBy(list, fn) {
  const out = {};
  for (const x of list) {
    const k = fn(x) || '（未设置）';
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
/** 缺失态：没有数据来源时**不返回数字**，只返回原因 */
function missing(reason) {
  return { available: false, value: null, missing: [reason] };
}

/* ==================== W07-01 Content ==================== */
function contentSection(db, brandCode) {
  const tasks = db.content_tasks.filter((t) => t.brandCode === brandCode);
  const versions = db.content_versions.filter((v) => v.brandCode === brandCode);
  const topics = db.master_topics.filter((t) => t.brandCode === brandCode);
  const campaigns = db.campaigns.filter((c) => c.brandCode === brandCode);
  const pubs = db.publication_records.filter((p) => p.brandCode === brandCode);
  const out = {
    available: tasks.length > 0 || versions.length > 0,
    tasks: {
      total: tasks.length,
      byStatus: countBy(tasks, (t) => t.status),
      byPillar: countBy(tasks, (t) => t.pillarCode),
      byPlatform: countBy(tasks, (t) => t.platform),
      byType: countBy(tasks, (t) => t.type)
    },
    versions: {
      total: versions.length,
      byState: countBy(versions, (v) => v.state),
      byRiskGrade: countBy(versions, (v) => v.riskGrade)
    },
    topics: {
      total: topics.length,
      byPillar: countBy(topics, (t) => t.pillarCode),
      withEvidence: topics.filter((t) => (db.evidence_references || []).some((e) => e.topicId === t.id)).length
    },
    campaigns: { total: campaigns.length, byState: countBy(campaigns, (c) => c.state) },
    published: { total: pubs.length, byStatus: countBy(pubs, (p) => p.status) },
    missing: []
  };
  if (!tasks.length) out.missing.push('该品牌暂无内容任务，任务维度统计不可用');
  if (!versions.length) out.missing.push('该品牌暂无内容版本，产出维度统计不可用');
  if (out.available === false) out.available = false;
  else out.available = true;
  return out;
}

/* ==================== W07-02 Channels ==================== */
function channelsSection(db, brandCode) {
  const channels = db.channels.filter((c) => c.brandCode === brandCode);
  const pubs = db.publication_records.filter((p) => p.brandCode === brandCode);
  const metrics = db.publication_metrics.filter((m) => m.brandCode === brandCode);

  const rows = channels.map((c) => {
    const cp = pubs.filter((p) => p.channelId === c.id);
    const cm = metrics.filter((m) => cp.some((p) => p.id === m.publicationId));
    return {
      id: c.id, platform: c.platform, handle: c.handle, label: c.label || '',
      state: c.state, publishMode: c.publishMode || 'MANUAL',
      publications: cp.length,
      lastPublishedAt: cp.length ? cp.map((p) => p.actualAt).sort().slice(-1)[0] : null,
      metricRecords: cm.length
    };
  }).sort((a, b) => b.publications - a.publications);

  // 指标（05 §4：必须带来源与时间）
  const byMetric = {};
  for (const m of metrics) {
    if (!byMetric[m.metric]) byMetric[m.metric] = { metric: m.metric, records: 0, sum: 0, sourceKinds: {}, latestAsOf: '' };
    const b = byMetric[m.metric];
    b.records += 1;
    b.sum += Number(m.amount) || 0;
    b.sourceKinds[m.sourceKind] = (b.sourceKinds[m.sourceKind] || 0) + 1;
    if (!b.latestAsOf || m.asOf > b.latestAsOf) b.latestAsOf = m.asOf;
  }

  const missingList = [];
  if (!channels.length) missingList.push('该品牌尚未登记任何渠道');
  if (!pubs.length) missingList.push('尚无实际发布记录，渠道表现无数据来源');
  if (!metrics.length) {
    missingList.push('未录入任何渠道指标；平台指标 API 未接通（00 §4），因此不显示阅读/互动等数字');
  }

  return {
    available: channels.length > 0,
    channels: rows,
    /** 渠道指标按**录入记录**聚合，每条都带来源与统计时点 */
    metrics: {
      available: metrics.length > 0,
      /** 无数据时不返回空对象冒充 0 表现，而是明确 reason */
      reason: metrics.length ? '' : '无指标数据来源（平台 API 未接通，且尚无人工/导入记录）',
      byMetric: Object.keys(byMetric).map((k) => byMetric[k]).sort((a, b) => b.records - a.records),
      totalRecords: metrics.length
    },
    /** 社媒自动化明确不在范围内：发布只能人工登记 */
    publishMode: 'MANUAL_ONLY',
    missing: missingList
  };
}

/* ==================== W07-03 Operations ==================== */
function operationsSection(db, brandCode) {
  const plans = db.monthly_plans.filter((p) => p.brandCode === brandCode);
  const planIds = plans.map((p) => p.id);
  const items = db.plan_items.filter((i) => planIds.indexOf(i.planId) !== -1);
  const tasks = db.content_tasks.filter((t) => t.brandCode === brandCode);
  const cases = db.review_cases.filter((c) => c.brandCode === brandCode);
  const schedules = db.publishing_schedules.filter((s) => s.brandCode === brandCode);
  const pubs = db.publication_records.filter((p) => p.brandCode === brandCode);

  const done = tasks.filter((t) => ['READY', 'COMPLETED'].indexOf(t.status) !== -1).length;
  const today = todayIso();

  // 审核耗时（W07-03「审核耗时」）
  const byType = {};
  for (const c of cases) {
    if (!c.decidedAt) continue;
    const h = hoursBetween(c.submittedAt, c.decidedAt);
    if (h === null) continue;
    if (!byType[c.type]) byType[c.type] = { type: c.type, samples: 0, hours: [] };
    byType[c.type].samples += 1;
    byType[c.type].hours.push(h);
  }
  const reviewCycle = {
    available: Object.keys(byType).length > 0,
    reason: Object.keys(byType).length ? '' : '尚无已裁决的审核单，无法统计审核周期',
    byType: Object.keys(byType).map((k) => ({
      type: k, samples: byType[k].samples,
      avgHours: Number(avg(byType[k].hours).toFixed(2)),
      maxHours: Number(Math.max.apply(null, byType[k].hours).toFixed(2))
    })),
    openCases: cases.filter((c) => ['SUBMITTED', 'IN_REVIEW'].indexOf(c.state) !== -1).length
  };

  // 延期（制作截止已过但未完成；排期已过计划时间但未发布）
  const overdueTasks = tasks.filter((t) => t.productionDue && String(t.productionDue).slice(0, 10) < today
    && ['READY', 'COMPLETED', 'CANCELLED'].indexOf(t.status) === -1);
  const overdueSchedules = schedules.filter((s) => s.plannedAt && String(s.plannedAt).slice(0, 10) < today
    && s.state !== 'CANCELLED'
    && !pubs.some((p) => p.scheduleId === s.id && p.status !== 'REMOVED'));

  const missingList = [];
  if (!plans.length) missingList.push('该品牌暂无月度计划，计划执行维度不可用');
  if (!cases.length) missingList.push('尚无审核记录，审核耗时不可用');

  return {
    available: plans.length > 0 || tasks.length > 0,
    plans: { total: plans.length, byStatus: countBy(plans, (p) => p.status) },
    planItems: { total: items.length, adHoc: items.filter((i) => i.adHoc).length },
    execution: {
      available: tasks.length > 0,
      tasks: tasks.length,
      readyOrDone: done,
      completionRate: tasks.length ? Number((done / tasks.length).toFixed(4)) : null,
      byStatus: countBy(tasks, (t) => t.status)
    },
    reviewCycle,
    overdue: {
      available: true,
      tasks: overdueTasks.length,
      schedules: overdueSchedules.length,
      items: overdueTasks.slice(0, 20).map((t) => ({ id: t.id, code: t.code, title: t.title, due: t.productionDue, status: t.status }))
    },
    missing: missingList
  };
}

/* ==================== W07-04 AI & Cost ==================== */
function aiCostSection(db, brandCode) {
  const jobs = db.generation_jobs.filter((j) => j.brandCode === brandCode);
  const cfg = getMosConfig();

  const durations = jobs.map((j) => hoursBetween(j.startedAt, j.finishedAt)).filter((h) => h !== null);

  // 费用：只认供应商实际回执（confirmed），不换汇、不推算（04 §5）
  const byCurrency = {};
  let unconfirmed = 0;
  for (const j of jobs) {
    const c = j.cost || {};
    const confirmed = !!c.confirmed && typeof c.amount === 'number';
    if (!confirmed) { unconfirmed += 1; continue; }
    const cur = c.currency || 'UNKNOWN';
    if (!byCurrency[cur]) byCurrency[cur] = { currency: cur, amount: 0, jobs: 0 };
    byCurrency[cur].amount = Number((byCurrency[cur].amount + c.amount).toFixed(6));
    byCurrency[cur].jobs += 1;
  }

  const succeeded = jobs.filter((j) => j.status === 'SUCCEEDED').length;
  const finished = jobs.filter((j) => ['SUCCEEDED', 'FAILED', 'BLOCKED', 'NOT_CONFIGURED', 'BUDGET_EXCEEDED'].indexOf(j.status) !== -1).length;

  const missingList = [];
  if (!jobs.length) missingList.push('该品牌暂无生成作业，AI 成本维度不可用');
  if (jobs.length && Object.keys(byCurrency).length === 0) {
    missingList.push('没有任何供应商确认费用（全部作业无计费回执）——按 04 §5 不显示估算金额');
  }

  return {
    available: jobs.length > 0,
    jobs: {
      total: jobs.length,
      mock: jobs.filter((j) => j.mock).length,
      byStatus: countBy(jobs, (j) => j.status),
      byKind: countBy(jobs, (j) => j.kind),
      byProvider: countBy(jobs, (j) => j.provider),
      successRate: finished ? Number((succeeded / finished).toFixed(4)) : null,
      avgHours: durations.length ? Number(avg(durations).toFixed(3)) : null,
      durationSamples: durations.length
    },
    cost: {
      available: Object.keys(byCurrency).length > 0,
      reason: Object.keys(byCurrency).length ? '' : '无可核费用：供应商未返回计费回执',
      byCurrency: Object.keys(byCurrency).map((k) => byCurrency[k]),
      jobsWithoutConfirmedCost: unconfirmed,
      note: '只统计供应商确认金额；不做汇率换算，不估算（04 §5）。'
    },
    budget: {
      brandMonthlyUsd: Number((cfg.budget && cfg.budget.brandMonthlyUsd) || 0),
      perJobUsdMax: Number((cfg.budget && cfg.budget.perJobUsdMax) || 0),
      note: '预算为 0 表示未配置：只允许零成本调用（04 §5）。'
    },
    providers: helpers.integrationStatus(),
    missing: missingList
  };
}

/* ==================== 路由 ==================== */

get('/api/mos/analytics', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'analytics.read', brandCode, { ip: ctx.ip, objectType: 'analytics' });

  const want = String(ctx.query.section || 'all').toLowerCase();
  const allowed = ['content', 'channels', 'operations', 'aicost', 'all'];
  if (allowed.indexOf(want) === -1) {
    const { httpError } = require('../../util');
    throw httpError(400, '未知的分析分段：' + want, 'BAD_SECTION');
  }

  const sections = {};
  if (want === 'all' || want === 'content') sections.content = contentSection(db, brandCode);
  if (want === 'all' || want === 'channels') sections.channels = channelsSection(db, brandCode);
  if (want === 'all' || want === 'operations') sections.operations = operationsSection(db, brandCode);
  if (want === 'all' || want === 'aicost') sections.aiCost = aiCostSection(db, brandCode);

  const allMissing = [];
  for (const key of Object.keys(sections)) {
    for (const m of (sections[key].missing || [])) allMissing.push(key + '：' + m);
  }

  return {
    ok: true,
    brandCode,
    environment: 'sandbox',
    generatedAt: new Date().toISOString(),
    /** 聚合口径与边界，前端原样展示，避免被读成"真实业务表现" */
    scopeNote: '仅覆盖主控 00 §4 允许的范围：内容 / 渠道 / 计划执行 / AI 成本 / 审核周期。'
      + '不含 CAC、获客漏斗、行为归因（MARK-S05 不在 V0.1）。',
    sections,
    missing: allMissing,
    dataVolume: {
      contentTasks: db.content_tasks.filter((t) => t.brandCode === brandCode).length,
      contentVersions: db.content_versions.filter((v) => v.brandCode === brandCode).length,
      reviewCases: db.review_cases.filter((c) => c.brandCode === brandCode).length,
      publications: db.publication_records.filter((p) => p.brandCode === brandCode).length,
      publicationMetrics: db.publication_metrics.filter((m) => m.brandCode === brandCode).length,
      generationJobs: db.generation_jobs.filter((j) => j.brandCode === brandCode).length
    }
  };
});

module.exports = { contentSection, channelsSection, operationsSection, aiCostSection };
