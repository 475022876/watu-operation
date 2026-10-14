'use strict';
/**
 * V0.1.3 Phase A —— 一站式任务工作空间（执行包 01 §任务空间 / 03 §一个内容任务的可视布局）。
 *
 * 设计口径（对现有模块**只读复用**，不复制业务规则）：
 *   - `GET /api/mos/tasks/:id/studio`：一次返回任务空间所需的全部上下文
 *     （Brief / 已审研究与来源 / 上级备注 / 版本 / 配图 / 视频 / 交付物清单 / 下一步建议），
 *     前端因此**无需跨模块跳转**即可完成正文、图片、视频脚本与审核提交。
 *   - `GET /api/mos/tasks/:id/submit-check`：**服务端**计算提交审核前的检查项
 *     （来源 / 平台规范 / 品牌许可 / 风险级别 / 必需交付物 / 待核实），前端只做展示。
 *   - `POST /api/mos/tasks/:id/variant`：由已审研究一键创建**其他平台的独立任务**
 *     （自动继承 Brief/栏目/叙事/风险/研究与来源；**不自动批准**，需各自走审核）。
 *   - `POST /api/mos/tasks/:id/basis`：无研究来源任务（官方通知 / 内部已批准产品事实 / 临时任务）
 *     登记**业务依据**，使「无 AI / 无研究」路径同样可审核交付（01 §员工应看到的路径 · 末条）。
 *
 * 权限：全部端点先 `rbac.assertBrand`（品牌范围）再 `assertCan`（默认拒绝 + 越权审计）。
 * 诚实性：交付物清单按真实对象推导；缺什么就报什么，不用 UI 掩盖 BLOCKED。
 */
const { get, post } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid, taskCode } = require('../ids');
const helpers = require('./helpers');
const skill = require('../skill');
const tasksRoute = require('./tasks');

const VIDEO_READY_STATES = ['STORYBOARD', 'SUBTITLE', 'FINAL_UPLOADED'];

function nowIso() { return new Date().toISOString(); }

function loadTask(db, ctx, opts) {
  const t = db.content_tasks.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, '任务不存在', 'TASK_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);
  if (opts && opts.write) {
    rbac.assertCan(ctx.principal, 'content.edit', t.brandCode,
      { ip: ctx.ip, objectType: 'content_task', objectId: t.id });
  }
  return t;
}

/** 已审研究依据：Topic → 候选选题 → 研究报告 → 发现（只引用，不复制对象） */
function researchBasis(db, task) {
  if (!task.topicId) return null;
  const topic = (db.master_topics || []).find((x) => x.id === task.topicId);
  if (!topic) return null;
  const proposal = topic.sourceProposalId
    ? (db.topic_proposals || []).find((p) => p.id === topic.sourceProposalId) : null;
  const report = topic.sourceReportId
    ? (db.research_reports || []).find((r) => r.id === topic.sourceReportId) : null;
  const findings = proposal
    ? (db.research_findings || []).filter((f) => (proposal.sourceFindingIds || []).indexOf(f.id) !== -1) : [];
  const evIds = findings.reduce((acc, f) => acc.concat(f.evidenceIds || []), []);
  const evidence = (db.source_evidence || []).filter((e) => evIds.indexOf(e.id) !== -1);
  return {
    topicId: topic.id, topicTitle: topic.title, pillarCode: topic.pillarCode,
    proposalId: proposal ? proposal.id : null,
    proposalStatus: proposal ? proposal.status : null,
    reviewedAt: proposal ? proposal.reviewedAt : null,
    reviewComments: proposal ? proposal.reviewComments : null,
    needsVerification: proposal ? !!proposal.needsVerification : false,
    special01Notes: proposal ? (proposal.special01Notes || []) : [],
    report: report ? { id: report.id, code: report.code, mode: report.mode, status: report.status, query: report.query } : null,
    findings: findings.map((f) => ({
      id: f.id, statement: f.statement, kind: f.kind, verificationState: f.verificationState, asOf: f.asOf || null,
      evidence: (f.evidenceIds || []).map((id) => {
        const e = evidence.find((x) => x.id === id);
        return e ? { id: e.id, url: e.url, title: e.title, sourceName: e.sourceName, publishedAt: e.publishedAt } : { id, missing: true };
      })
    })),
    evidenceCount: evidence.length
  };
}

/** 交付物清单：按真实对象推导（文字/图片/视频） */
function deliverables(db, task) {
  const versions = (db.content_versions || []).filter((v) => v.contentTaskId === task.id);
  const latest = versions.slice().sort((a, b) => (b.number || 0) - (a.number || 0))[0] || null;
  const assets = (db.working_assets || []).filter((a) => (a.projectRef || {}).taskId === task.id);
  const images = assets.filter((a) => /^image\//.test(String(a.mime || '')));
  const video = (db.video_artifacts || []).find((x) => x.taskId === task.id) || null;
  const isVideoPlatform = task.platform === 'YOUTUBE';

  return {
    TEXT: {
      key: 'TEXT', label: '文字正文', required: true,
      done: !!(latest && String(latest.body || '').trim()),
      detail: latest ? ('v' + latest.number + ' · ' + String(latest.body || '').length + ' 字') : '尚未创建版本'
    },
    IMAGE: {
      key: 'IMAGE', label: '配图 / 视觉', required: !isVideoPlatform,
      done: images.length > 0,
      detail: images.length ? (images.length + ' 张已上传/生成') : '尚未准备配图（可手工上传，无需 AI）'
    },
    VIDEO: {
      key: 'VIDEO', label: '视频脚本与分镜', required: isVideoPlatform,
      done: !!(video && VIDEO_READY_STATES.indexOf(video.state) !== -1),
      detail: video ? ('当前阶段 ' + video.state + ' · 分镜 ' + (video.storyboard || []).length + ' 条') : '尚未建立视频工作区'
    }
  };
}

/** 下一步建议（员工视角；单一主按钮的来源） */
function nextActions(db, task, del, versions, video, principal) {
  const latest = versions.slice().sort((a, b) => (b.number || 0) - (a.number || 0))[0] || null;
  const out = [];
  const canEdit = rbac.can(principal, 'content.edit', task.brandCode);
  const canSubmit = rbac.can(principal, 'content.submit', task.brandCode);
  if (!latest) {
    out.push({ key: 'start', label: '开始制作（新建草稿）', primary: true, tab: 'TEXT' });
    return out;
  }
  if (latest.editable) {
    if (!del.TEXT.done && canEdit) out.push({ key: 'write', label: '撰写正文', primary: true, tab: 'TEXT' });
    if (del.IMAGE.required && !del.IMAGE.done && canEdit) out.push({ key: 'image', label: '准备配图', primary: !del.TEXT.done, tab: 'IMAGE' });
    if (del.VIDEO.required && !del.VIDEO.done && canEdit) out.push({ key: 'video', label: '编写视频脚本与分镜', primary: false, tab: 'VIDEO' });
    if (del.TEXT.done && canSubmit) out.push({ key: 'submit', label: '提交审核', primary: true, tab: 'REVIEW' });
  }
  if (latest.state === 'LOCKED_FOR_REVIEW') {
    out.push({ key: 'await', label: '等待审核结果', primary: false, tab: 'REVIEW' });
  }
  if (latest.state === 'REVISION_REQUIRED') {
    out.push({ key: 'revise', label: '按审核意见派生新版本', primary: true, tab: 'TEXT' });
  }
  if (latest.state === 'APPROVED') {
    out.push({ key: 'publish', label: '转发布管理排期', primary: true, tab: 'REVIEW' });
  }
  return out;
}

/* ==================== 1. 任务空间聚合 ==================== */

get('/api/mos/tasks/:id/studio', async (ctx) => {
  const db = getDb();
  const t = loadTask(db, ctx);
  const versions = (db.content_versions || []).filter((v) => v.contentTaskId === t.id)
    .sort((a, b) => (b.number || 0) - (a.number || 0))
    .map((v) => ({
      id: v.id, number: v.number, code: v.code, title: v.title, state: v.state,
      bodyChars: String(v.body || '').length, editable: ['DRAFT', 'REVISION_REQUIRED'].indexOf(v.state) !== -1,
      updatedAt: v.updatedAt, rowVersion: v.rowVersion || 1
    }));
  const video = (db.video_artifacts || []).find((x) => x.taskId === t.id) || null;
  const del = deliverables(db, t);
  const usability = skill.resolveSkill(db, t.brandCode);

  /* 技术参数集中到 advanced，默认不进入员工首屏（01 §UI减法原则 2） */
  const advanced = {
    providerStatus: helpers.integrationStatus(),
    skill: { state: usability && usability.state, skillCode: usability && usability.skillCode,
      version: usability && usability.version, reason: usability && usability.reason }
  };

  return {
    ok: true,
    task: tasksRoute.serialize(db, t, ctx.principal),
    brief: {
      code: t.code, title: t.title, platform: t.platform, type: t.type,
      pillarCode: t.pillarCode, narrativeCode: t.narrativeCode, riskGrade: t.riskGrade,
      productionDue: t.productionDue || null, reviewDue: t.reviewDue || null,
      plannedPublishAt: t.plannedPublishAt || null,
      ownerId: t.ownerId,
      ownerName: (db.users.find((u) => u.id === t.ownerId) || {}).displayName || '—',
      supervisorNotes: (t.supervisorNotes || []).slice(-10)
    },
    research: researchBasis(db, t),
    businessBasis: t.businessBasis || null,
    versions,
    video: video ? {
      id: video.id, state: video.state, videoType: video.videoType, motionCode: video.motionCode,
      shots: (video.storyboard || []).length, subtitles: (video.subtitles || []).length,
      keyframes: (video.keyframeAssetIds || []).length, finalAssetId: video.finalAssetId || null
    } : null,
    deliverables: del,
    nextActions: nextActions(db, t, del, versions, video, ctx.principal),
    advanced
  };
});

/* ==================== 2. 提交审核前检查（服务端判定） ==================== */

get('/api/mos/tasks/:id/submit-check', async (ctx) => {
  const db = getDb();
  const t = loadTask(db, ctx);
  const versions = (db.content_versions || []).filter((v) => v.contentTaskId === t.id);
  const latest = versions.slice().sort((a, b) => (b.number || 0) - (a.number || 0))[0] || null;
  const del = deliverables(db, t);
  const usability = skill.resolveSkill(db, t.brandCode);
  const research = researchBasis(db, t);

  const evIds = latest ? (latest.evidenceRefIds || []) : [];
  const topicEvidence = (db.evidence_references || []).filter((e) => e.topicId === t.topicId);
  const hasSource = evIds.length > 0 || topicEvidence.length > 0 || !!t.businessBasis;
  const risky = ['G2', 'G3'].indexOf(t.riskGrade) !== -1;
  const skillOk = !!(usability && usability.state === 'APPROVED');

  const items = [
    {
      key: 'source', label: '事实来源 / 业务依据', required: true,
      status: hasSource ? 'PASS' : 'FAIL',
      detail: hasSource
        ? (evIds.length || topicEvidence.length
          ? ('已关联 ' + (evIds.length + topicEvidence.length) + ' 条来源证据')
          : '已登记业务依据：' + String((t.businessBasis || {}).note || '').slice(0, 60))
        : '缺少来源：请先在「研究与来源」挂载证据，或登记业务依据（官方通知 / 内部已批准产品事实）'
    },
    {
      key: 'body', label: '正文内容', required: true,
      status: del.TEXT.done ? 'PASS' : 'FAIL',
      detail: del.TEXT.detail
    },
    {
      key: 'platform', label: '平台必需交付物', required: true,
      status: (del.VIDEO.required ? del.VIDEO.done : true) ? 'PASS' : 'FAIL',
      detail: del.VIDEO.required ? del.VIDEO.detail : '平台 ' + t.platform + ' 无需视频交付物'
    },
    {
      key: 'brand', label: '品牌许可（正式输出）', required: false,
      status: skillOk ? 'PASS' : 'WARN',
      detail: skillOk
        ? ('品牌 Skill v' + (usability.version || '—') + ' 已 APPROVED')
        : ('品牌 Skill 当前为 ' + ((usability && usability.state) || 'MISSING')
          + '：可提交**草稿/测试**内容审核，但不得作为正式品牌输出。' + ((usability && usability.reason) || ''))
    },
    {
      key: 'verification', label: '待核实项', required: false,
      status: research && research.needsVerification ? 'WARN' : 'PASS',
      detail: research && research.needsVerification
        ? '该选题含待核验事实（栏目约束 / 证据不足）：审核将要求补充依据'
        : '无待核验标记'
    },
    {
      key: 'risk', label: '风险级别', required: false,
      status: risky ? 'WARN' : 'PASS',
      detail: risky ? (t.riskGrade + '：将强制进入专业（金融事实）审核 + 发布审批')
        : (t.riskGrade + '：常规发布审批')
    }
  ];
  return {
    ok: true,
    taskId: t.id, versionId: latest ? latest.id : null,
    blocking: items.filter((i) => i.required && i.status === 'FAIL').map((i) => i.key),
    items
  };
});

/* ==================== 3. 一键创建平台变体（同一已审研究） ==================== */

const VARIANT_PLATFORMS = ['LINKEDIN', 'X', 'YOUTUBE', 'FACEBOOK', 'NEWSLETTER'];

post('/api/mos/tasks/:id/variant', async (ctx) => {
  const db = getDb();
  const t = loadTask(db, ctx, { write: true });
  const body = ctx.body || {};
  const platform = String(body.platform || '').toUpperCase();
  if (VARIANT_PLATFORMS.indexOf(platform) === -1) {
    throw httpError(400, '平台非法：' + platform, 'BAD_PLATFORM');
  }

  const key = String(body.idempotencyKey || '').trim();
  if (!key) throw httpError(400, '缺少 idempotencyKey', 'MISSING_IDEMPOTENCY_KEY');
  const idemKey = ['variant', t.id, platform, key].join(':');
  const dup = db.content_tasks.find((x) => x.variantIdemKey === idemKey);
  if (dup) {
    return { ok: true, deduplicated: true, task: tasksRoute.serialize(db, dup, ctx.principal) };
  }

  // 多平台变体必须绑定**同一已审研究**；无研究则要求业务依据已登记（不得凭空造题）
  if (!t.topicId && !t.businessBasis) {
    throw httpError(409,
      '该任务既无关联研究主题、也未登记业务依据：请先登记业务依据再创建其他平台变体',
      'NO_RESEARCH_BASIS');
  }

  const variant = {
    id: uid('task'), brandCode: t.brandCode, code: taskCode(db),
    title: t.title, type: platform === 'YOUTUBE' ? 'VIDEO_SCRIPT' : (platform === 'X' ? 'THREAD' : t.type || 'ARTICLE'),
    platform, pillarCode: t.pillarCode, narrativeCode: t.narrativeCode, riskGrade: t.riskGrade,
    ownerId: t.ownerId, campaignId: t.campaignId || null, topicId: t.topicId || null,
    status: 'IDEA',
    productionDue: body.productionDue || t.productionDue || null,
    reviewDue: t.reviewDue || null, plannedPublishAt: body.plannedPublishAt || t.plannedPublishAt || null,
    // 溯源：变体回链主任务与已审研究（不复制研究对象）
    variantOfTaskId: t.id, variantIdemKey: idemKey,
    supervisorNotes: (t.supervisorNotes || []).slice(),
    demo: false, createdAt: nowIso(), updatedAt: nowIso(), createdBy: ctx.user.id, rowVersion: 1
  };
  db.content_tasks.push(variant);
  appendAudit({
    actorId: ctx.user.id, brandCode: t.brandCode, eventType: 'content_task.variant.created',
    objectType: 'content_task', objectId: variant.id, newState: 'IDEA', ip: ctx.ip,
    metadata: { fromTaskId: t.id, platform, topicId: t.topicId || null, idempotencyKey: key }
  });
  save();
  return { ok: true, deduplicated: false, task: tasksRoute.serialize(db, variant, ctx.principal) };
});

/* ==================== 4. 业务依据登记（无研究任务路径） ==================== */

const BASIS_KINDS = ['OFFICIAL_NOTICE', 'INTERNAL_APPROVED_FACT', 'AD_HOC'];

post('/api/mos/tasks/:id/basis', async (ctx) => {
  const db = getDb();
  const t = loadTask(db, ctx, { write: true });
  const body = ctx.body || {};
  const kind = String(body.kind || '').toUpperCase();
  if (BASIS_KINDS.indexOf(kind) === -1) {
    throw httpError(400, '依据类型非法（OFFICIAL_NOTICE / INTERNAL_APPROVED_FACT / AD_HOC）', 'BAD_BASIS_KIND');
  }
  const note = String(body.note || '').trim();
  if (!note) throw httpError(400, '请填写业务依据说明', 'MISSING_NOTE');
  const ref = body.ref ? String(body.ref).slice(0, 500) : null;

  t.businessBasis = {
    kind, note: note.slice(0, 2000), ref,
    recordedBy: ctx.user.id, recordedAt: nowIso(),
    // 内部已批准事实 / 官方通知仍须经发布审批；据实标注，不因登记而豁免审核
    requiresReview: true
  };
  t.updatedAt = nowIso();
  t.rowVersion = Number(t.rowVersion || 1) + 1;
  appendAudit({
    actorId: ctx.user.id, brandCode: t.brandCode, eventType: 'content_task.basis_recorded',
    objectType: 'content_task', objectId: t.id, ip: ctx.ip, metadata: { kind, hasRef: !!ref }
  });
  save();
  return { ok: true, task: tasksRoute.serialize(db, t, ctx.principal) };
});

/** 上级备注（审核人在任务内留言，供员工在任务空间直接看到） */
post('/api/mos/tasks/:id/notes', async (ctx) => {
  const db = getDb();
  const t = db.content_tasks.find((x) => x.id === ctx.params.id);
  if (!t) throw httpError(404, '任务不存在', 'TASK_NOT_FOUND');
  rbac.assertBrand(ctx.principal, t.brandCode);
  const body = ctx.body || {};
  const text = String(body.text || '').trim();
  if (!text) throw httpError(400, '备注内容不能为空', 'MISSING_NOTE');

  t.supervisorNotes = (t.supervisorNotes || []).concat([{
    id: uid('note'), text: text.slice(0, 2000), authorId: ctx.user.id,
    authorName: (db.users.find((u) => u.id === ctx.user.id) || {}).displayName || '',
    createdAt: nowIso()
  }]).slice(-50);
  t.updatedAt = nowIso();
  appendAudit({
    actorId: ctx.user.id, brandCode: t.brandCode, eventType: 'content_task.note_added',
    objectType: 'content_task', objectId: t.id, ip: ctx.ip, metadata: {}
  });
  save();
  return { ok: true, task: tasksRoute.serialize(db, t, ctx.principal) };
});
