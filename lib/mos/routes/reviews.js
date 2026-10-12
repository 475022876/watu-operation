'use strict';
/**
 * Marketing OS —— 审核链（W08-01 My Reviews / W08-02 Review History / 03 §1-§5）。
 *
 * 三条链分开、权能不同，**禁止一个万能 approved 标志**：
 *   PROFESSIONAL_REVIEW  → content.professional_review
 *   PUBLICATION_APPROVAL → content.publish_approve（G3 另需提升授权角色，可配置）
 *   ASSET_ADMISSION      → asset.review（BUILD-03，本文件仅提供统一读接口）
 *
 * 服务端强制（前端禁用控件不等于安全，03 §5）：
 *   - 职责分离：Creator 不能审批自己创建的内容版本（03 §4）
 *   - Manifest Guard：审批时重算 manifest，与冻结值不一致 → 409（SEC-02）
 *   - 顺序 Guard：发布审核通过前，同版本的专业审核必须已完成
 *   - 提升授权：G3 的发布审核需 `mos.publishingApprovalElevatedRoles` 中的角色
 */
const { get, post } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const {
  REVIEW_CASE_TRANSITIONS, REVIEW_ACTIONS, CONTENT_VERSION_TRANSITIONS,
  RISK_REQUIRES_ELEVATED, TASK_TRANSITIONS, ADMISSION_TRANSITIONS
} = require('../dict');
const { getMosConfig } = require('../config');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const manifest = require('../manifest');
const reviewlib = require('../reviewlib');
const library = require('../adapters/library');
const helpers = require('./helpers');

const PERM_BY_TYPE = {
  PROFESSIONAL_REVIEW: 'content.professional_review',
  PUBLICATION_APPROVAL: 'content.publish_approve',
  /**
   * A-16 修复（BUILD-03）：资产入库**最终审批**是 03 §2.4 定义的**独立特权**，
   * 不是 `asset.review`（预检/复核）。`asset.review` 只负责 `/precheck`，
   * 不能用于最终入库裁决；`MOS_ADMIN` 也不自动持有本权限。
   */
  ASSET_ADMISSION: 'library.asset.approve.final'
};

const ACTION_TO_STATE = {
  START_REVIEW: 'IN_REVIEW',
  APPROVE: 'APPROVED',
  REQUEST_REVISION: 'REVISION_REQUIRED',
  REJECT: 'REJECTED',
  CANCEL: 'CANCELLED'
};

/** 该主体对该审核单是否有裁决权（含职责分离与提升授权判断） */
function decideCapability(db, c, principal) {
  const out = { allowed: false, reasons: [] };
  if (!principal) { out.reasons.push('未登录'); return out; }
  const perm = PERM_BY_TYPE[c.type];
  if (!perm) { out.reasons.push('该审核类型尚未启用：' + c.type); return out; }
  if (['APPROVED', 'REJECTED', 'CANCELLED'].indexOf(c.state) !== -1) {
    out.reasons.push('审核已终结');
    return out;
  }
  if (!rbac.can(principal, perm, c.brandCode)) {
    out.reasons.push('缺少权限：' + perm);
    return out;
  }

  // 职责分离（03 §4）：Creator 不能审批自己创建的内容版本
  const v = c.subjectType === 'content_version' ? db.content_versions.find((x) => x.id === c.subjectId) : null;
  if (v && v.authorId === principal.id) {
    out.reasons.push('职责分离：不能审批自己创建的内容版本');
    return out;
  }
  // 职责分离同样适用于资产入库（BUILD-03）：提交人不能审批自己的入库申请
  const adm = c.subjectType === 'asset_admission'
    ? (db.asset_admissions || []).find((x) => x.id === c.subjectId) : null;
  if (adm) {
    if (adm.submittedBy === principal.id) {
      out.reasons.push('职责分离：不能审批自己提交的入库申请');
      return out;
    }
    if (['PRECHECK', 'REVIEWING'].indexOf(adm.state) !== -1) {
      out.reasons.push('该申请尚未提交最终审批（当前 ' + adm.state + '）');
      return out;
    }
    if (adm.state !== 'FINAL_APPROVAL_PENDING') {
      out.reasons.push('该申请当前状态 ' + adm.state + ' 不接受最终裁决');
      return out;
    }
  }

  // G3 提升授权（03 §2.2，签字链可配置）
  if (c.type === 'PUBLICATION_APPROVAL' && RISK_REQUIRES_ELEVATED.indexOf(c.riskGrade) !== -1) {
    const cfg = getMosConfig();
    const elevated = (cfg.publishingApprovalElevatedRoles || []).map((x) => String(x).toUpperCase());
    const mine = (principal.roleCodes || []).map((x) => String(x).toUpperCase());
    const hit = mine.filter((r) => elevated.indexOf(r) !== -1);
    if (!hit.length) {
      out.reasons.push('G3 内容需提升授权的发布审核角色（' + elevated.join(' / ') + '）');
      return out;
    }
    out.elevated = hit;
  }

  out.allowed = true;
  return out;
}

function serialize(db, c, principal, opts) {
  const o = opts || {};
  const cap = decideCapability(db, c, principal);
  const subject = c.subjectType === 'content_version'
    ? db.content_versions.find((x) => x.id === c.subjectId) : null;
  const admission = c.subjectType === 'asset_admission'
    ? (db.asset_admissions || []).find((x) => x.id === c.subjectId) : null;
  const authorId = subject ? subject.authorId : (admission ? admission.submittedBy : '');
  const author = db.users.find((u) => u.id === authorId);
  const submitter = db.users.find((u) => u.id === c.submittedBy);

  const out = {
    id: c.id, type: c.type, brandCode: c.brandCode,
    subjectType: c.subjectType, subjectId: c.subjectId,
    versionHash: c.versionHash, policyVersion: c.policyVersion, riskGrade: c.riskGrade,
    state: c.state, requirements: (c.requirements || []).slice(),
    submittedBy: c.submittedBy, submitterName: submitter ? submitter.displayName : '',
    submittedAt: c.submittedAt, decidedAt: c.decidedAt || null,
    decidedBy: c.decidedBy || '', note: c.note || '',
    subject: subject ? {
      id: subject.id, code: subject.code, title: subject.title, state: subject.state,
      riskGrade: subject.riskGrade, contentTaskId: subject.contentTaskId,
      brandCode: subject.brandCode, authorId: subject.authorId,
      authorName: author ? author.displayName : '',
      manifestHash: subject.manifestHash || '',
      /** 供 UI 显示"批准的到底是哪一版" */
      currentManifestHash: subject.manifestHash || ''
    } : (admission ? {
      /** 资产入库申请：以「资产内容指纹 + 分类 + 元数据」作为批准绑定对象（SEC-02 类比） */
      id: admission.id, code: admission.id,
      title: ((admission.submissionMetadata || {}).title) || '（未命名资产）',
      state: admission.state, riskGrade: '', contentTaskId: null,
      brandCode: admission.brandCode, authorId: admission.submittedBy,
      authorName: author ? author.displayName : '',
      manifestHash: c.versionHash || '',
      currentManifestHash: require('./admissions').bindingHash(admission),
      workingAssetId: admission.workingAssetId,
      assetSha256: admission.assetSha256,
      categoryCode: admission.categoryCode,
      finalApprovalStatus: admission.finalApprovalStatus,
      syncStatus: admission.syncStatus,
      assetMock: !!((db.working_assets || []).find((x) => x.id === admission.workingAssetId) || {}).mock
    } : null),
    decisions: (db.review_decisions || []).filter((d) => d.caseId === c.id)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((d) => ({
        id: d.id, action: d.action, actorId: d.actorId, actorName: d.actorName,
        remarks: d.remarks, actingAuthority: d.actingAuthority || [],
        previousState: d.previousState, createdAt: d.createdAt
      })),
    allowedActions: (REVIEW_CASE_TRANSITIONS[c.state] || []).map((s) =>
      Object.keys(ACTION_TO_STATE).find((a) => ACTION_TO_STATE[a] === s)).filter(Boolean),
    canDecide: cap.allowed,
    decideBlockedReasons: cap.reasons,
    demo: !!c.demo,
    createdAt: c.createdAt, updatedAt: c.updatedAt, rowVersion: c.rowVersion || 1
  };
  if (!o.withDecisions) delete out.decisions;
  return out;
}

/* ==================== 查询 ==================== */

get('/api/mos/review-cases', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.review_cases.filter((c) => c.brandCode === brandCode);
  if (ctx.query.type) rows = rows.filter((c) => c.type === String(ctx.query.type).toUpperCase());
  if (ctx.query.state) rows = rows.filter((c) => c.state === String(ctx.query.state).toUpperCase());
  if (ctx.query.subjectId) rows = rows.filter((c) => c.subjectId === String(ctx.query.subjectId));
  if (ctx.query.open === '1') rows = rows.filter(reviewlib.isOpen);
  const serialized = rows
    .slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .map((c) => serialize(db, c, ctx.principal));
  const filtered = ctx.query.mine === '1' ? serialized.filter((c) => c.canDecide) : serialized;
  const paged = helpers.paginate(filtered, ctx.query);
  return {
    ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total, items: paged.items,
    /** 按审核类型分组的计数（W08-01「按审核类型分组」） */
    summary: {
      professional: { open: serialized.filter((c) => c.type === 'PROFESSIONAL_REVIEW' && ['SUBMITTED', 'IN_REVIEW'].indexOf(c.state) !== -1).length },
      publication: { open: serialized.filter((c) => c.type === 'PUBLICATION_APPROVAL' && ['SUBMITTED', 'IN_REVIEW'].indexOf(c.state) !== -1).length },
      admission: { open: serialized.filter((c) => c.type === 'ASSET_ADMISSION' && ['SUBMITTED', 'IN_REVIEW'].indexOf(c.state) !== -1).length }
    }
  };
});

get('/api/mos/review-cases/:id', async (ctx) => {
  const db = getDb();
  const c = db.review_cases.find((x) => x.id === ctx.params.id);
  if (!c) throw httpError(404, '审核单不存在', 'CASE_NOT_FOUND');
  rbac.assertBrand(ctx.principal, c.brandCode);

  const v = c.subjectType === 'content_version' ? db.content_versions.find((x) => x.id === c.subjectId) : null;
  let subjectSnapshot = null;
  if (v) {
    const m = manifest.build(db, v);
    subjectSnapshot = {
      id: v.id, code: v.code, title: v.title, body: v.body, state: v.state,
      riskGrade: v.riskGrade, pillarCode: v.pillarCode, narrativeCode: v.narrativeCode,
      channelIds: (v.channelIds || []).slice(),
      disclosures: (v.disclosures || []).slice(),
      manifestHash: v.manifestHash || '',
      manifestPayload: v.manifestPayload || null,
      /** 关键：当前实时重算值 vs 冻结值 —— 不一致就是 SEC-02 命中 */
      manifestNow: m.hash,
      manifestMatches: !!(v.manifestHash && v.manifestHash === m.hash),
      textHash: m.payload.textHash,
      assets: (v.refAssetIds || []).map((id) => {
        const a = db.working_assets.find((x) => x.id === id);
        return a ? { id: a.id, fileName: a.fileName, mime: a.mime, sha256: a.sha256, mock: !!a.mock }
          : { id, missing: true };
      }),
      evidence: (v.evidenceRefIds || []).map((id) => {
        const e = db.evidence_references.find((x) => x.id === id);
        return e ? { id: e.id, claimLocator: e.claimLocator, verificationState: e.verificationState } : { id, missing: true };
      })
    };
  } else if (c.subjectType === 'asset_admission') {
    const adm = (db.asset_admissions || []).find((x) => x.id === c.subjectId);
    if (adm) {
      const asset = (db.working_assets || []).find((x) => x.id === adm.workingAssetId);
      const admissions = require('./admissions');
      const now = admissions.bindingHash(adm);
      subjectSnapshot = {
        id: adm.id, code: adm.id,
        title: ((adm.submissionMetadata || {}).title) || '（未命名资产）',
        state: adm.state, categoryCode: adm.categoryCode,
        brandCode: adm.brandCode,
        finalApprovalStatus: adm.finalApprovalStatus, syncStatus: adm.syncStatus,
        precheck: adm.precheck || null,
        submissionMetadata: adm.submissionMetadata || {},
        manifestHash: c.versionHash || '',
        manifestNow: now,
        /** 关键：内容指纹变了 → 原批准不可用（与 SEC-02 同一口径） */
        manifestMatches: !!(c.versionHash && c.versionHash === now),
        assetDigestNow: asset ? asset.sha256 : '',
        assetDigestFrozen: adm.assetSha256,
        assets: asset ? [{
          id: asset.id, fileName: asset.fileName, mime: asset.mime, sha256: asset.sha256, mock: !!asset.mock
        }] : [{ id: adm.workingAssetId, missing: true }],
        evidence: []
      };
    }
  }

  return {
    ok: true,
    case: serialize(db, c, ctx.principal, { withDecisions: true }),
    subjectSnapshot,
    policyNote: '审批仅对冻结的 Manifest 有效；下方 manifestNow 为服务端实时重算值，与冻结值不一致时审批会被拒绝（SEC-02）。'
  };
});

get('/api/mos/review-history', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = (db.review_decisions || []).filter((d) => d.brandCode === brandCode);
  if (ctx.query.subjectId) rows = rows.filter((d) => d.subjectId === String(ctx.query.subjectId));
  if (ctx.query.type) rows = rows.filter((d) => d.type === String(ctx.query.type).toUpperCase());
  if (ctx.query.caseId) rows = rows.filter((d) => d.caseId === String(ctx.query.caseId));
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const paged = helpers.paginate(rows, ctx.query);
  return {
    ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items,
    note: '审核决策 append-only：历史不会被改写（02 §2）。'
  };
});

/* ==================== 裁决 ==================== */

post('/api/mos/review-cases/:id/decision', async (ctx) => {
  const db = getDb();
  const c = db.review_cases.find((x) => x.id === ctx.params.id);
  if (!c) throw httpError(404, '审核单不存在', 'CASE_NOT_FOUND');
  rbac.assertBrand(ctx.principal, c.brandCode);

  const body = ctx.body || {};
  const action = String(body.action || '').toUpperCase();
  if (REVIEW_ACTIONS.indexOf(action) === -1) throw httpError(400, '未知的审核动作：' + action, 'BAD_ACTION');
  const target = ACTION_TO_STATE[action];

  const cap = decideCapability(db, c, ctx.principal);
  if (!cap.allowed) {
    appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'review.decision.denied',
      objectType: 'review_case', objectId: c.id, outcome: 'denied', ip: ctx.ip,
      metadata: { action, reasons: cap.reasons } });
    throw httpError(403, cap.reasons.join('；') || '无权裁决该审核单', 'FORBIDDEN');
  }

  const allowed = REVIEW_CASE_TRANSITIONS[c.state] || [];
  if (allowed.indexOf(target) === -1) {
    throw httpError(409, '当前审核状态 ' + c.state + ' 不允许动作 ' + action, 'ILLEGAL_TRANSITION');
  }

  const remarks = String(body.remarks || '').trim();
  if (['REQUEST_REVISION', 'REJECT', 'CANCEL'].indexOf(action) !== -1 && !remarks) {
    throw httpError(400, '退回/驳回/取消必须填写原因', 'REMARKS_REQUIRED');
  }

  /* ---------- Guard 1：Manifest 未变（SEC-02） ---------- */
  const v = c.subjectType === 'content_version' ? db.content_versions.find((x) => x.id === c.subjectId) : null;
  if (v) {
    if (c.versionHash !== v.manifestHash) {
      appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'review.manifest.mismatch',
        objectType: 'review_case', objectId: c.id, outcome: 'denied', ip: ctx.ip,
        metadata: { caseHash: c.versionHash, versionHashNow: v.manifestHash } });
      throw httpError(409, '该审核单绑定的版本与当前版本不一致，请重新送审', 'MANIFEST_CHANGED');
    }
    const ver = manifest.verify(db, v);
    if (!ver.ok) {
      appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'review.manifest.mismatch',
        objectType: 'review_case', objectId: c.id, outcome: 'denied', ip: ctx.ip,
        metadata: { expected: ver.expected, actual: ver.actual } });
      throw httpError(409,
        '批准对象已发生变化（正文或引用资产被改动），原审核不可用于新内容；请重新送审。',
        'MANIFEST_CHANGED');
    }
  }

  /* ---------- Guard 2：发布审核前，专业审核必须已完成 ---------- */
  if (c.type === 'PUBLICATION_APPROVAL' && action === 'APPROVE' && v) {
    const profCases = reviewlib.casesFor(db, v.id, 'PROFESSIONAL_REVIEW');
    if (profCases.length && !profCases.every((x) => x.state === 'APPROVED')) {
      throw httpError(409, '同版本的专业（金融事实）审核尚未通过，不能执行发布审批', 'PROFESSIONAL_REVIEW_PENDING');
    }
  }

  /* ---------- Guard 3：资产入库申请的批准绑定（SEC-02 类比，BUILD-03） ----------
   * 资产内容指纹（sha256）+ 分类 + 提交元数据构成批准对象；其中任何一项变化
   * 都必须重新预检与重新审批 —— 防止"批的是 A 图，入库的是 B 图"。
   */
  const adm = c.subjectType === 'asset_admission'
    ? (db.asset_admissions || []).find((x) => x.id === c.subjectId) : null;
  if (adm) {
    const admissions = require('./admissions');
    const nowHash = admissions.bindingHash(adm);
    if (c.versionHash !== nowHash) {
      appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'review.manifest.mismatch',
        objectType: 'review_case', objectId: c.id, outcome: 'denied', ip: ctx.ip,
        metadata: { caseHash: c.versionHash, versionHashNow: nowHash, subjectType: 'asset_admission' } });
      throw httpError(409,
        '该入库申请绑定的资产或元数据已发生变化，原审批不可用于新内容；请重新预检与提交。',
        'ASSET_CHANGED');
    }
  }

  /* ---------- 执行状态迁移 ---------- */
  const prev = c.state;
  c.state = target;
  c.decidedAt = new Date().toISOString();
  c.decidedBy = ctx.user.id;
  c.updatedAt = new Date().toISOString();
  c.rowVersion = Number(c.rowVersion || 1) + 1;

  const actingAuthority = cap.elevated && cap.elevated.length ? cap.elevated.slice() : (ctx.principal.roleCodes || []).slice();
  const decision = reviewlib.appendDecision(db, c, ctx.user, action, remarks, actingAuthority);
  // 决策记录里补上迁移后的状态，便于历史页直接展示
  decision.newState = target;

  /* ---------- 目标联动 ---------- */
  const effects = [];
  let taskTransition = null;
  if (v) {
    const move = (to) => {
      const allowedV = CONTENT_VERSION_TRANSITIONS[v.state] || [];
      if (allowedV.indexOf(to) !== -1) {
        const from = v.state;
        v.state = to;
        v.updatedAt = new Date().toISOString();
        v.updatedBy = ctx.user.id;
        v.rowVersion = Number(v.rowVersion || 1) + 1;
        if (to === 'APPROVED') { v.approvedAt = v.updatedAt; v.approvedBy = ctx.user.id; }
        effects.push('content_version:' + from + '→' + to);
        return true;
      }
      return false;
    };

    if (action === 'APPROVE' && c.type === 'PUBLICATION_APPROVAL') {
      move('APPROVED');
    }
    if ((action === 'REQUEST_REVISION' || action === 'REJECT') && c.type !== 'ASSET_ADMISSION') {
      move('REVISION_REQUIRED');
    }

    const task = db.content_tasks.find((t) => t.id === v.contentTaskId);
    if (task) {
      if (v.state === 'APPROVED') {
        if (task.status !== 'READY' && (TASK_TRANSITIONS[task.status] || []).indexOf('READY') !== -1) {
          taskTransition = { from: task.status, to: 'READY' };
        }
      } else if (v.state === 'REVISION_REQUIRED') {
        const allowedT = TASK_TRANSITIONS[task.status] || [];
        if (allowedT.indexOf('IN_PRODUCTION') !== -1) taskTransition = { from: task.status, to: 'IN_PRODUCTION' };
      }
      if (taskTransition) {
        task.status = taskTransition.to;
        task.updatedAt = new Date().toISOString();
        task.updatedBy = ctx.user.id;
        task.rowVersion = Number(task.rowVersion || 1) + 1;
        effects.push('content_task:' + taskTransition.from + '→' + taskTransition.to);
      }
    }
  }

  /* ---------- 目标联动：资产入库（BUILD-03 第三条链） ---------- */
  if (adm) {
    const admissions = require('./admissions');
    const step = (to) => {
      if ((ADMISSION_TRANSITIONS[adm.state] || []).indexOf(to) === -1) return false;
      const from = adm.state;
      adm.state = to;
      adm.updatedAt = new Date().toISOString();
      adm.updatedBy = ctx.user.id;
      adm.rowVersion = Number(adm.rowVersion || 1) + 1;
      effects.push('asset_admission:' + from + '→' + to);
      return true;
    };

    if (action === 'APPROVE') {
      // 前置：最终授权的实际验证来源（Mock 只能得到 MOCK_APPROVED，不可作为正式批准）
      const verify = await library.verifyFinalAuthorization(ctx.principal, String(body.approvalRef || c.id));
      const mode = admissions.markApproved(db, adm, ctx.user, body.approvalRef);
      effects.push('final_approval:' + adm.finalApprovalStatus + '(' + mode + '/' + verify.result + ')');
      step('FINAL_APPROVAL_GRANTED');
    } else if (action === 'REQUEST_REVISION' || action === 'REJECT') {
      admissions.markRejected(db, adm, ctx.user, remarks);
      step('REJECTED');
    } else if (action === 'CANCEL') {
      admissions.markRejected(db, adm, ctx.user, '审核单被取消：' + remarks);
      step('REJECTED');
    }
  }

  save();
  appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'review.decision',
    objectType: 'review_case', objectId: c.id, oldState: prev, newState: target, ip: ctx.ip,
    metadata: { type: c.type, action, subjectId: c.subjectId, riskGrade: c.riskGrade,
      actingAuthority, effects, remarks: remarks.slice(0, 200) } });
  if (taskTransition && v) {
    appendAudit({ actorId: ctx.user.id, brandCode: v.brandCode, eventType: 'content_task.transition',
      objectType: 'content_task', objectId: v.contentTaskId, oldState: taskTransition.from,
      newState: taskTransition.to, ip: ctx.ip, metadata: { note: '审核结果联动' } });
  }

  return {
    ok: true,
    case: serialize(db, c, ctx.principal, { withDecisions: true }),
    effects,
    decisionId: decision.id
  };
});

module.exports = { serialize, decideCapability, PERM_BY_TYPE };
