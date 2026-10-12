'use strict';
/**
 * Marketing OS —— 审核单公共逻辑（03 §1/§2/§3）。
 *
 * 三条链**共用一张 review_cases 表**，但权能与流程由 `type` 决定（01 §3：禁止一个万能 approved 标志）：
 *   PROFESSIONAL_REVIEW —— 金融事实专业审核（PROFESSIONAL_REVIEWER / content.professional_review）
 *   PUBLICATION_APPROVAL —— 发布审核（PUBLISHING_APPROVER·P3 / content.publish_approve）
 *   ASSET_ADMISSION —— 正式资料库入库（BUILD-03）
 *
 * 不可动摇的口径：
 *   - 审批只对**冻结的 Subject Version / Manifest** 有效；
 *   - `review_decisions` **append-only**，任何决策都不得回改；
 *   - 职责分离：Creator 不能审批自己的内容（03 §4）。
 */
const { uid } = require('./ids');
const { REVIEW_CASE_STATES } = require('./dict');

/** 审批策略版本：策略调整时必须改这个值，使旧批准与旧策略可区分（02 §2 review_cases.policy_version） */
const APPROVAL_POLICY_VERSION = 'MOS-POLICY-2026.10-v1';

/** 未终结的审核状态 */
const OPEN_STATES = ['SUBMITTED', 'IN_REVIEW'];

function isOpen(c) {
  return !!c && OPEN_STATES.indexOf(c.state) !== -1;
}
function isTerminal(c) {
  return !!c && REVIEW_CASE_STATES.indexOf(c.state) !== -1 && OPEN_STATES.indexOf(c.state) === -1;
}

/**
 * 开一张审核单。
 * @param {object} db
 * @param {object} spec { type, brandCode, subjectType, subjectId, versionHash, riskGrade,
 *                        policyVersion?, submittedBy, note? }
 */
function openCase(db, spec) {
  const now = new Date().toISOString();
  const c = {
    id: uid('rc'),
    type: spec.type,
    brandCode: spec.brandCode,
    subjectType: spec.subjectType,
    subjectId: spec.subjectId,
    /** 目标冻结指纹：审批只对这个哈希有效 */
    versionHash: spec.versionHash || '',
    policyVersion: spec.policyVersion || APPROVAL_POLICY_VERSION,
    riskGrade: spec.riskGrade || '',
    state: 'SUBMITTED',
    submittedBy: spec.submittedBy || '',
    submittedAt: now,
    /** 需要显著提示的额外条件（如 G3 需要提升授权），由 UI 原样展示 */
    requirements: spec.requirements || [],
    note: spec.note || '',
    decidedAt: null,
    decidedBy: '',
    createdAt: now,
    updatedAt: now,
    rowVersion: 1,
    demo: !!spec.demo
  };
  db.review_cases.push(c);
  return c;
}

/** 追加一条决策（append-only） */
function appendDecision(db, c, actor, action, remarks, actingAuthority) {
  const d = {
    id: uid('rd'),
    caseId: c.id,
    type: c.type,
    brandCode: c.brandCode,
    subjectType: c.subjectType,
    subjectId: c.subjectId,
    versionHash: c.versionHash,
    actorId: actor ? actor.id : '',
    actorName: actor ? actor.displayName : '',
    action,
    remarks: String(remarks || '').slice(0, 2000),
    actingAuthority: actingAuthority || [],
    previousState: c.state,
    createdAt: new Date().toISOString()
  };
  db.review_decisions.push(d);
  return d;
}

/** 某目标下的全部审核单（可按类型过滤） */
function casesFor(db, subjectId, type) {
  return (db.review_cases || []).filter((c) =>
    c.subjectId === subjectId && (!type || c.type === type));
}

/** 某目标下指定类型是否已全部批准（用于发布审核的前置 Guard） */
function allApproved(db, subjectId, type) {
  const list = casesFor(db, subjectId, type);
  return list.length > 0 && list.every((c) => c.state === 'APPROVED');
}

/** 是否存在未终结的指定类型审核单 */
function hasOpen(db, subjectId, type) {
  return casesFor(db, subjectId, type).some(isOpen);
}

/**
 * 取消某目标下全部未终结审核单（例如版本被新版本取代时）。
 * 取消也写决策记录，保留完整历史。
 */
function cancelOpenCases(db, subjectId, actor, reason) {
  const cancelled = [];
  for (const c of casesFor(db, subjectId)) {
    if (!isOpen(c)) continue;
    appendDecision(db, c, actor, 'CANCEL', reason || '目标已被取代，审核单关闭', []);
    c.state = 'CANCELLED';
    c.decidedAt = new Date().toISOString();
    c.decidedBy = actor ? actor.id : '';
    c.updatedAt = new Date().toISOString();
    c.rowVersion = Number(c.rowVersion || 1) + 1;
    cancelled.push(c);
  }
  return cancelled;
}

module.exports = {
  APPROVAL_POLICY_VERSION,
  OPEN_STATES,
  isOpen,
  isTerminal,
  openCase,
  appendDecision,
  casesFor,
  allApproved,
  hasOpen,
  cancelOpenCases
};
