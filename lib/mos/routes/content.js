'use strict';
/**
 * Marketing OS —— ContentVersion（W04-01 内容编辑器 / 03 §2.2 版本冻结）。
 *
 * 核心不变量（本文件存在的唯一理由）：
 *   1. **送审版本不可覆盖**：进入 LOCKED_FOR_REVIEW 后正文与引用资产一律只读；
 *      任何实质变化只能通过 `revise` 派生**新版本**（03 §2.2 Guard）。
 *   2. **批准绑定 Manifest**：冻结时固化 manifestHash；审批时重新计算比对，
 *      不一致 → 409（SEC-02）。
 *   3. **版本号单调递增**，旧版本保留，只被标记 SUPERSEDED，绝不删除。
 *   4. 版本状态与任务状态**相互独立**（02 §4）：本文件只做被允许的联动，不互相覆盖。
 */
const { get, post, put } = require('../router');
const { getDb, save, atomicMutation } = require('../store');
const { httpError } = require('../../util');
const {
  CONTENT_VERSION_TRANSITIONS, RISK_REQUIRES_PROFESSIONAL_REVIEW, TASK_TRANSITIONS, dictValid
} = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid, contentVersionCode } = require('../ids');
const manifest = require('../manifest');
const reviewlib = require('../reviewlib');
const helpers = require('./helpers');

/** 可编辑状态：只有 DRAFT。REVISION_REQUIRED 必须派生新版本（见文件头不变量 1）。 */
const EDITABLE_STATES = ['DRAFT'];
const REVISABLE_STATES = ['LOCKED_FOR_REVIEW', 'REVISION_REQUIRED', 'APPROVED'];

function taskOf(db, v) {
  return db.content_tasks.find((t) => t.id === v.contentTaskId) || null;
}

function serialize(db, v, principal, opts) {
  const o = opts || {};
  const task = taskOf(db, v);
  const cases = reviewlib.casesFor(db, v.id);

  const out = {
    id: v.id,
    brandCode: v.brandCode,
    contentTaskId: v.contentTaskId,
    taskCode: task ? task.code : '',
    taskTitle: task ? task.title : '',
    number: v.number,
    code: v.code,
    title: v.title,
    format: v.format,
    /** 正文仅在可读场景返回；已批准版本仍可读（只读），不可改 */
    body: v.body,
    bodyChars: String(v.body || '').length,
    textHash: manifest.textHash(v),
    manifestHash: v.manifestHash || '',
    /** 冻结时的清单快照：审批人看到的"批准对象" */
    manifestPayload: v.manifestPayload || null,
    channelIds: (v.channelIds || []).slice(),
    refAssetIds: (v.refAssetIds || []).slice(),
    evidenceRefIds: (v.evidenceRefIds || []).slice(),
    disclosures: (v.disclosures || []).slice(),
    locale: v.locale || 'zh-CN',
    pillarCode: v.pillarCode, narrativeCode: v.narrativeCode, riskGrade: v.riskGrade,
    authorId: v.authorId,
    authorName: (db.users.find((u) => u.id === v.authorId) || {}).displayName || '',
    state: v.state,
    lockedAt: v.lockedAt || null, lockedBy: v.lockedBy || '',
    approvedAt: v.approvedAt || null, approvedBy: v.approvedBy || '',
    supersedesId: v.supersedesId || null,
    supersededById: v.supersededById || null,
    createdAt: v.createdAt, updatedAt: v.updatedAt, rowVersion: v.rowVersion || 1,
    demo: !!v.demo,
    allowedTransitions: CONTENT_VERSION_TRANSITIONS[v.state] || [],
    editable: EDITABLE_STATES.indexOf(v.state) !== -1,
    revisable: REVISABLE_STATES.indexOf(v.state) !== -1,
    /** 审核链摘要（详情页展开；列表页只给计数） */
    reviewSummary: {
      total: cases.length,
      open: cases.filter(reviewlib.isOpen).length,
      professional: cases.filter((c) => c.type === 'PROFESSIONAL_REVIEW').map((c) => c.state),
      publication: cases.filter((c) => c.type === 'PUBLICATION_APPROVAL').map((c) => c.state)
    },
    can: {
      edit: rbac.can(principal, 'content.edit', v.brandCode) && EDITABLE_STATES.indexOf(v.state) !== -1,
      submit: rbac.can(principal, 'content.submit', v.brandCode) && v.state === 'DRAFT',
      revise: rbac.can(principal, 'content.edit', v.brandCode) && REVISABLE_STATES.indexOf(v.state) !== -1
    }
  };
  if (!o.withBody) delete out.body;
  if (!o.withManifest) { delete out.manifestPayload; }
  return out;
}

function findVersion(db, id) {
  const v = db.content_versions.find((x) => x.id === id);
  if (!v) throw httpError(404, '内容版本不存在', 'VERSION_NOT_FOUND');
  return v;
}

/* ==================== 查询 ==================== */

get('/api/mos/content-versions', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.content_versions.filter((v) => v.brandCode === brandCode);
  if (ctx.query.taskId) rows = rows.filter((v) => v.contentTaskId === String(ctx.query.taskId));
  if (ctx.query.state) rows = rows.filter((v) => v.state === String(ctx.query.state).toUpperCase());
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const paged = helpers.paginate(rows, ctx.query);
  return {
    ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((v) => serialize(db, v, ctx.principal))
  };
});

get('/api/mos/content-versions/:id', async (ctx) => {
  const db = getDb();
  const v = findVersion(db, ctx.params.id);
  rbac.assertBrand(ctx.principal, v.brandCode);

  const decisions = (db.review_decisions || [])
    .filter((d) => d.subjectId === v.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  const cases = reviewlib.casesFor(db, v.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  const assets = (v.refAssetIds || []).map((id) => {
    const a = db.working_assets.find((x) => x.id === id);
    return a ? {
      id: a.id, fileName: a.fileName, mime: a.mime, sha256: a.sha256, bytes: a.bytes,
      origin: a.origin, mock: !!a.mock, createdAt: a.createdAt
    } : { id, missing: true };
  });
  const evidence = (v.evidenceRefIds || []).map((id) => {
    const e = db.evidence_references.find((x) => x.id === id);
    if (!e) return { id, missing: true };
    const si = e.sourceItemId ? db.source_items.find((x) => x.id === e.sourceItemId) : null;
    return {
      id: e.id, claimLocator: e.claimLocator, verificationState: e.verificationState,
      sourceTitle: si ? si.title : '', sourceUrl: si ? si.canonicalUrl : '',
      sourceTier: si ? si.tier : '', publishedAt: si ? si.publishedAt : null
    };
  });
  const channels = (v.channelIds || []).map((id) => {
    const c = db.channels.find((x) => x.id === id);
    return c ? { id: c.id, platform: c.platform, handle: c.handle, state: c.state } : { id, missing: true };
  });

  return {
    ok: true,
    version: serialize(db, v, ctx.principal, { withBody: true, withManifest: true }),
    cases, decisions, assets, evidence, channels
  };
});

/* ==================== 创建 / 编辑 ==================== */

post('/api/mos/content-versions', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'content.edit', brandCode, { ip: ctx.ip, objectType: 'content_version' });

  const task = db.content_tasks.find((t) => t.id === String(body.taskId || ''));
  if (!task) throw httpError(400, '内容任务不存在', 'TASK_NOT_FOUND');
  rbac.assertSameBrand(task.brandCode, brandCode);
  if (['IN_REVIEW', 'READY', 'COMPLETED', 'CANCELLED'].indexOf(task.status) !== -1) {
    throw httpError(409, '任务当前状态为 ' + task.status + '，如需修改请基于既有版本派生新版本',
      'TASK_NOT_EDITABLE');
  }

  return atomicMutation(() => {
  const existing = db.content_versions.filter((v) => v.contentTaskId === task.id);
  const number = existing.reduce((m, v) => Math.max(m, Number(v.number) || 0), 0) + 1;

  const now = new Date().toISOString();
  const v = {
    id: uid('cv'),
    brandCode: task.brandCode,
    contentTaskId: task.id,
    number,
    code: contentVersionCode(task.code, number),
    title: String(body.title || task.title || '').slice(0, 200),
    body: String(body.body || ''),
    format: 'MARKDOWN',
    pillarCode: task.pillarCode,
    narrativeCode: task.narrativeCode,
    riskGrade: task.riskGrade,
    channelIds: [],
    refAssetIds: [],
    evidenceRefIds: [],
    disclosures: [],
    locale: 'zh-CN',
    manifestHash: '',
    manifestPayload: null,
    state: 'DRAFT',
    authorId: ctx.user.id,
    supersedesId: null,
    supersededById: null,
    demo: false,
    createdAt: now, createdBy: ctx.user.id, updatedAt: now, updatedBy: ctx.user.id, rowVersion: 1
  };
  db.content_versions.push(v);

  // 任务联动：IDEA/PLANNED → IN_PRODUCTION（有草稿即进入制作中）
  let taskTransition = null;
  if (['IDEA', 'PLANNED'].indexOf(task.status) !== -1
    && (TASK_TRANSITIONS[task.status] || []).indexOf('IN_PRODUCTION') !== -1) {
    taskTransition = { from: task.status, to: 'IN_PRODUCTION' };
    task.status = 'IN_PRODUCTION';
    task.updatedAt = now;
    task.updatedBy = ctx.user.id;
    task.rowVersion = Number(task.rowVersion || 1) + 1;
  }

  appendAudit({ actorId: ctx.user.id, brandCode: v.brandCode, eventType: 'content_version.created',
    objectType: 'content_version', objectId: v.id, newState: 'DRAFT', ip: ctx.ip,
    metadata: { code: v.code, taskCode: task.code, taskTransition } });
  if (taskTransition) {
    appendAudit({ actorId: ctx.user.id, brandCode: task.brandCode, eventType: 'content_task.transition',
      objectType: 'content_task', objectId: task.id, oldState: taskTransition.from, newState: 'IN_PRODUCTION',
      ip: ctx.ip, metadata: { note: '创建内容版本后自动进入制作中' } });
  }

  return { ok: true, version: serialize(db, v, ctx.principal, { withBody: true }) };
  });
});

put('/api/mos/content-versions/:id', async (ctx) => {
  const db = getDb();
  const v = findVersion(db, ctx.params.id);
  rbac.assertBrand(ctx.principal, v.brandCode);
  rbac.assertCan(ctx.principal, 'content.edit', v.brandCode, { ip: ctx.ip, objectType: 'content_version', objectId: v.id });

  // 不变量 1：冻结/已批准版本不可改写（SEC-02）
  if (EDITABLE_STATES.indexOf(v.state) === -1) {
    appendAudit({ actorId: ctx.user.id, brandCode: v.brandCode, eventType: 'content_version.edit_denied',
      objectType: 'content_version', objectId: v.id, outcome: 'denied', ip: ctx.ip,
      metadata: { state: v.state, reason: 'VERSION_IMMUTABLE' } });
    throw httpError(409,
      '当前版本状态为 ' + v.state + '，已冻结或已批准的内容不可直接修改；请基于该版本派生新版本后修改。',
      'VERSION_IMMUTABLE');
  }

  const body = ctx.body || {};
  const patch = {};
  if (body.title !== undefined) {
    const t = String(body.title).trim();
    if (!t) throw httpError(400, '标题不能为空', 'MISSING_TITLE');
    patch.title = t.slice(0, 200);
  }
  if (body.body !== undefined) patch.body = String(body.body);
  if (body.locale !== undefined) patch.locale = String(body.locale || 'zh-CN').slice(0, 20);

  const arrayFields = {
    channelIds: 'channels',
    refAssetIds: 'working_assets',
    evidenceRefIds: 'evidence_references'
  };
  for (const field of Object.keys(arrayFields)) {
    if (body[field] === undefined) continue;
    if (!Array.isArray(body[field])) throw httpError(400, field + ' 必须是数组', 'BAD_FIELD');
    const list = Array.from(new Set(body[field].map((x) => String(x))));
    if (list.length > 50) throw httpError(400, field + ' 数量过多', 'TOO_MANY');
    for (const id of list) {
      const row = db[arrayFields[field]].find((x) => x.id === id);
      if (!row) throw httpError(400, field + ' 中存在无效引用：' + id, 'BAD_REFERENCE');
      // 品牌一致性（02 §3）：不允许把别的品牌资产/渠道挂到本版本
      if (row.brandCode && row.brandCode !== v.brandCode) {
        throw httpError(404, '引用资源不存在', 'BRAND_MISMATCH');
      }
    }
    patch[field] = list;
  }
  if (body.disclosures !== undefined) {
    if (!Array.isArray(body.disclosures)) throw httpError(400, 'disclosures 必须是数组', 'BAD_FIELD');
    patch.disclosures = body.disclosures.map((d) => String(d).slice(0, 300)).slice(0, 20);
  }

  return atomicMutation(() => {
  const changed = helpers.applyUpdate(v, patch, ctx.user.id, body.rowVersion);
  if (changed) {
      appendAudit({ actorId: ctx.user.id, brandCode: v.brandCode, eventType: 'content_version.updated',
      objectType: 'content_version', objectId: v.id, ip: ctx.ip,
      metadata: { fields: Object.keys(patch), bodyChars: String(v.body || '').length, textHash: manifest.textHash(v) } });
  }
  return { ok: true, version: serialize(db, v, ctx.principal, { withBody: true }), changed };
  });
});

/* ==================== 冻结送审 ==================== */

post('/api/mos/content-versions/:id/lock', async (ctx) => {
  const db = getDb();
  const v = findVersion(db, ctx.params.id);
  rbac.assertBrand(ctx.principal, v.brandCode);
  rbac.assertCan(ctx.principal, 'content.submit', v.brandCode, { ip: ctx.ip, objectType: 'content_version', objectId: v.id });

  if (v.state !== 'DRAFT') {
    throw httpError(409, '只有 DRAFT 版本可以送审；当前为 ' + v.state, 'NOT_DRAFT');
  }
  if (!String(v.body || '').trim()) {
    throw httpError(400, '正文为空，不能送审', 'EMPTY_BODY');
  }

  helpers.applyUpdate(v, {}, ctx.user.id, ctx.body && ctx.body.rowVersion);

  return atomicMutation(() => {
  const task = taskOf(db, v);
  const now = new Date().toISOString();

  // 固化 Manifest（不变量 2）
  const m = manifest.build(db, v);
  v.manifestHash = m.hash;
  v.manifestPayload = m.payload;
  v.state = 'LOCKED_FOR_REVIEW';
  v.lockedAt = now;
  v.lockedBy = ctx.user.id;
  v.updatedAt = now;
  v.updatedBy = ctx.user.id;
  v.rowVersion = Number(v.rowVersion || 1) + 1;

  // 审核链（03 §2.2 / §3 矩阵）：
  //   - PROFESSIONAL_REVIEW：G2、G3 强制；G0/G1 可按内容需要显式要求
  //   - PUBLICATION_APPROVAL：一律需要（V0.1 不允许自动发布，必须有人类决策）
  const requireProfessional = RISK_REQUIRES_PROFESSIONAL_REVIEW.indexOf(v.riskGrade) !== -1
    || (ctx.body && ctx.body.requireProfessional === true);
  const created = [];
  if (requireProfessional) {
    created.push(reviewlib.openCase(db, {
      type: 'PROFESSIONAL_REVIEW', brandCode: v.brandCode, subjectType: 'content_version',
      subjectId: v.id, versionHash: v.manifestHash, riskGrade: v.riskGrade,
      submittedBy: ctx.user.id, note: ctx.body ? ctx.body.note : '',
      requirements: v.riskGrade === 'G3' ? ['G3 内容需提升授权的发布审核'] : [],
      demo: !!v.demo
    }));
  }
  created.push(reviewlib.openCase(db, {
    type: 'PUBLICATION_APPROVAL', brandCode: v.brandCode, subjectType: 'content_version',
    subjectId: v.id, versionHash: v.manifestHash, riskGrade: v.riskGrade,
    submittedBy: ctx.user.id, note: ctx.body ? ctx.body.note : '',
    requirements: v.riskGrade === 'G3' ? ['G3 内容需提升授权的发布审核'] : [],
    demo: !!v.demo
  }));

  // 任务联动：→ IN_REVIEW
  let taskTransition = null;
  if (task && ['IDEA', 'PLANNED', 'IN_PRODUCTION'].indexOf(task.status) !== -1) {
    taskTransition = { from: task.status, to: 'IN_REVIEW' };
    task.status = 'IN_REVIEW';
    task.updatedAt = now;
    task.updatedBy = ctx.user.id;
    task.rowVersion = Number(task.rowVersion || 1) + 1;
  }

  appendAudit({ actorId: ctx.user.id, brandCode: v.brandCode, eventType: 'content_version.locked',
    objectType: 'content_version', objectId: v.id, oldState: 'DRAFT', newState: 'LOCKED_FOR_REVIEW',
    ip: ctx.ip, metadata: { code: v.code, riskGrade: v.riskGrade, manifestHash: v.manifestHash,
      textHash: m.payload.textHash, cases: created.map((c) => c.type), requireProfessional } });
  if (taskTransition) {
    appendAudit({ actorId: ctx.user.id, brandCode: task.brandCode, eventType: 'content_task.transition',
      objectType: 'content_task', objectId: task.id, oldState: taskTransition.from, newState: 'IN_REVIEW',
      ip: ctx.ip, metadata: { note: '内容版本送审' } });
  }

  return {
    ok: true,
    version: serialize(db, v, ctx.principal, { withBody: true, withManifest: true }),
    createdCases: created.map((c) => ({ id: c.id, type: c.type, state: c.state, riskGrade: c.riskGrade }))
  };
  });
});

/* ==================== 派生新版本 ==================== */

post('/api/mos/content-versions/:id/revise', async (ctx) => {
  const db = getDb();
  const v = findVersion(db, ctx.params.id);
  rbac.assertBrand(ctx.principal, v.brandCode);
  rbac.assertCan(ctx.principal, 'content.edit', v.brandCode, { ip: ctx.ip, objectType: 'content_version', objectId: v.id });

  if (REVISABLE_STATES.indexOf(v.state) === -1) {
    throw httpError(409, '当前状态 ' + v.state + ' 不可派生新版本', 'NOT_REVISABLE');
  }
  const task = taskOf(db, v);
  if (!task) throw httpError(409, '内容任务不存在，无法派生版本', 'TASK_NOT_FOUND');

  const existing = db.content_versions.filter((x) => x.contentTaskId === task.id);
  const number = existing.reduce((m, x) => Math.max(m, Number(x.number) || 0), 0) + 1;
  const now = new Date().toISOString();

  const nv = {
    id: uid('cv'),
    brandCode: v.brandCode,
    contentTaskId: task.id,
    number,
    code: contentVersionCode(task.code, number),
    title: v.title,
    body: v.body,
    format: v.format,
    pillarCode: v.pillarCode, narrativeCode: v.narrativeCode, riskGrade: v.riskGrade,
    channelIds: (v.channelIds || []).slice(),
    refAssetIds: (v.refAssetIds || []).slice(),
    evidenceRefIds: (v.evidenceRefIds || []).slice(),
    disclosures: (v.disclosures || []).slice(),
    locale: v.locale || 'zh-CN',
    manifestHash: '',
    manifestPayload: null,
    state: 'DRAFT',
    authorId: ctx.user.id,
    supersedesId: v.id,
    supersededById: null,
    reviseReason: String((ctx.body && ctx.body.reason) || '').slice(0, 500),
    demo: false,
    createdAt: now, createdBy: ctx.user.id, updatedAt: now, updatedBy: ctx.user.id, rowVersion: 1
  };
  db.content_versions.push(nv);

  // 旧版本 → SUPERSEDED，且关闭其未终结审核单（审批不对失效目标继续挂起）
  const allowed = CONTENT_VERSION_TRANSITIONS[v.state] || [];
  if (allowed.indexOf('SUPERSEDED') !== -1) {
    v.state = 'SUPERSEDED';
    v.supersededById = nv.id;
    v.updatedAt = now;
    v.updatedBy = ctx.user.id;
    v.rowVersion = Number(v.rowVersion || 1) + 1;
  }
  const cancelled = reviewlib.cancelOpenCases(db, v.id, ctx.principal, '版本已被新版本取代：' + nv.code);

  // 任务回到制作中（新草稿需要继续编辑）
  let taskTransition = null;
  if (task.status !== 'IN_PRODUCTION' && (TASK_TRANSITIONS[task.status] || []).indexOf('IN_PRODUCTION') !== -1) {
    taskTransition = { from: task.status, to: 'IN_PRODUCTION' };
    task.status = 'IN_PRODUCTION';
    task.updatedAt = now;
    task.updatedBy = ctx.user.id;
    task.rowVersion = Number(task.rowVersion || 1) + 1;
  }

  save();
  appendAudit({ actorId: ctx.user.id, brandCode: v.brandCode, eventType: 'content_version.revised',
    objectType: 'content_version', objectId: nv.id, newState: 'DRAFT', ip: ctx.ip,
    metadata: { code: nv.code, supersedes: v.code, cancelledCases: cancelled.length,
      reason: nv.reviseReason, taskTransition } });
  if (taskTransition) {
    appendAudit({ actorId: ctx.user.id, brandCode: task.brandCode, eventType: 'content_task.transition',
      objectType: 'content_task', objectId: task.id, oldState: taskTransition.from, newState: 'IN_PRODUCTION',
      ip: ctx.ip, metadata: { note: '派生新内容版本' } });
  }

  return {
    ok: true,
    version: serialize(db, nv, ctx.principal, { withBody: true }),
    superseded: serialize(db, v, ctx.principal),
    cancelledCases: cancelled.length
  };
});

/** 字典校验辅助（供前端下拉使用；便于内容编辑器渲染 C/N/V/F/M） */
get('/api/mos/content-dictionaries', async (ctx) => {
  const brandCode = helpers.resolveBrand(ctx);
  return { ok: true, brandCode, dictionaries: helpers.dictionaries() };
});

/** 供其他模块复用的导出（避免循环依赖时重复实现） */
module.exports = { serialize, findVersion, EDITABLE_STATES, REVISABLE_STATES };
