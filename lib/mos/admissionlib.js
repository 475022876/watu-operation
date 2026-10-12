'use strict';
/**
 * Marketing OS —— 资产入库公共逻辑（03 §2.4 / §5 / §6，E2E-05）。
 *
 * 本文件是 BUILD-03 的**诚实性核心**，三条不可动摇的规则：
 *
 *   1. **双字段独立**：`finalApprovalStatus`（PENDING/APPROVED/REJECTED）与
 *      `syncStatus`（NOT_STARTED/PENDING/COMPLETED/FAILED）互不推导。
 *
 *   2. **可复用资格是计算判定，禁止手工置 true**（03 §2.4）：
 *        reuseEligibility = approval=APPROVED AND sync=COMPLETED
 *                           AND library.permissionValid AND library.assetState=ACTIVE
 *                           AND approvalMode=REAL
 *      Mock 下 `permissionValid=false`、`approvalMode='MOCK'`、`libraryId=null`
 *      → 沙盒申请**永远**拿不到复用资格，也**永远**到不了 AVAILABLE（00 §3）。
 *
 *   3. **失败可恢复但不可伪装**：同步失败置 SYNC_FAILED 并保留错误原因；
 *      重试复用同一 idempotencyKey，且**先查回执**再提交，避免「回执丢失 → 重复入库 → 双资产」。
 */
const { uid } = require('./ids');
const { ADMISSION_SYNC_STATUSES, ADMISSION_APPROVAL_STATUSES } = require('./dict');

/** 入库流程追加事件的最大保留条数（单文件存储边界，见 store.js 头注释） */
const MAX_HISTORY = 200;

/**
 * 计算可复用资格（**唯一权威判定**，禁止在别处重复实现或人工覆盖）。
 * @param {object} admission
 * @param {object|null} ref library_asset_refs 行
 * @returns {{eligible:boolean, blocking:string[]}}
 */
function reuseEligibility(admission, ref) {
  const blocking = [];
  if (!admission) return { eligible: false, blocking: ['申请不存在'] };

  if (admission.finalApprovalStatus !== 'APPROVED') {
    blocking.push('最终审批未通过（' + (admission.finalApprovalStatus || 'PENDING') + '）');
  }
  if (admission.syncStatus !== 'COMPLETED') {
    blocking.push('资料库同步未完成（' + (admission.syncStatus || 'NOT_STARTED') + '）');
  }
  if (admission.approvalMode !== 'REAL') {
    blocking.push('最终授权来源为 ' + (admission.approvalMode || 'MOCK') + '：不是正式批准，不可复用（03 §2.4）');
  }
  if (!admission.libraryId) {
    blocking.push('没有真实资料库资产 ID（Mock 回执不可作为正式入库凭证）');
  }
  if (!ref) {
    blocking.push('不存在资料库资产引用');
  } else {
    if (!ref.permissionValid) blocking.push('资料库权限未核验通过');
    if (ref.assetState !== 'ACTIVE') blocking.push('资料库资产状态非 ACTIVE（' + ref.assetState + '）');
  }
  return { eligible: blocking.length === 0, blocking };
}

/** 追加一条流程事件（append-only，超限滚动） */
function appendHistory(admission, actor, action, detail) {
  if (!Array.isArray(admission.history)) admission.history = [];
  const evt = {
    id: uid('ah'),
    action,
    fromState: detail && detail.fromState !== undefined ? detail.fromState : null,
    toState: detail && detail.toState !== undefined ? detail.toState : null,
    actorId: actor ? actor.id : '',
    actorName: actor ? actor.displayName : '',
    note: String((detail && detail.note) || '').slice(0, 1000),
    metadata: (detail && detail.metadata) || {},
    at: new Date().toISOString()
  };
  admission.history.push(evt);
  if (admission.history.length > MAX_HISTORY) {
    admission.history.splice(0, admission.history.length - MAX_HISTORY);
  }
  return evt;
}

/**
 * 工作素材预检（06 §3「入库事务」第 1 步）。
 * 只做**可确定**的检查，不做主观判断；结论只有 PASS / FAIL。
 */
function precheck(db, admission) {
  const asset = db.working_assets.find((a) => a.id === admission.workingAssetId);
  const checks = [];
  const push = (id, ok, note) => checks.push({ id, ok: !!ok, note });

  push('asset_exists', !!asset, asset ? '工作素材存在' : '工作素材不存在（可能已被清理）');
  if (asset) {
    push('digest_matches', asset.sha256 === admission.assetSha256,
      asset.sha256 === admission.assetSha256
        ? '内容指纹与提交时一致'
        : '内容指纹已变化（素材被替换）——必须重新提交');
    push('origin_known', ['UPLOADED', 'GENERATED'].indexOf(asset.origin) !== -1, '来源类型已知（' + asset.origin + '）');
    push('brand_consistent', asset.brandCode === admission.brandCode, '素材与申请同品牌');
    push('mock_labeled', !asset.mock || true, asset.mock ? 'MOCK 产物：可入库演示，但不得对外发布' : '非 MOCK 产物');
  }
  const md = admission.submissionMetadata || {};
  push('category_present', !!admission.categoryCode, admission.categoryCode ? '已选资产分类 ' + admission.categoryCode : '缺少 A01–A08 分类');
  push('license_not_unverified', String(md.license || '').toUpperCase() !== 'UNVERIFIED',
    String(md.license || '').toUpperCase() === 'UNVERIFIED'
      ? '许可未核验（UNVERIFIED）：资料库不会受理'
      : '许可状态：' + (md.license || 'INTERNAL_DRAFT'));

  const duplicate = db.library_asset_refs.some((r) =>
    r.brandCode === admission.brandCode && r.sourceDigest === admission.assetSha256 && r.state === 'REFERENCED');
  push('not_duplicate', !duplicate, duplicate ? '同内容资产已在资料库中存在（同步时按幂等处理）' : '未发现重复入库');

  const verdict = checks.every((c) => c.ok) ? 'PASS' : 'FAIL';
  return { verdict, checks, failureReasons: checks.filter((c) => !c.ok).map((c) => c.id + '：' + c.note) };
}

/** 从资料库回执建立本地引用（**只有同步成功后**才建立） */
function createRefFromReceipt(db, admission, receipt) {
  const ref = {
    id: uid('lar'),
    brandCode: admission.brandCode,
    admissionId: admission.id,
    workingAssetId: admission.workingAssetId,
    libraryId: receipt.assetId || null,
    version: receipt.libraryVersion || null,
    permissionScope: Array.isArray(receipt.permissions) ? receipt.permissions.slice() : [],
    permissionValid: !!receipt.permissionValid,
    assetState: receipt.assetState || 'MOCK_SANDBOX',
    state: 'REFERENCED',
    /** 沙盒产物必须带标；Mock 恒 true */
    mock: receipt.mode !== 'real',
    sourceKind: 'ASSET_ADMISSION',
    sourceRef: admission.id,
    sourceDigest: admission.assetSha256,
    lastVerifiedAt: new Date().toISOString(),
    createdAt: new Date().toISOString()
  };
  db.library_asset_refs.push(ref);
  return ref;
}

/** 资料库资产的本地引用（按申请查） */
function refFor(db, admissionId) {
  return (db.library_asset_refs || []).find((r) => r.admissionId === admissionId) || null;
}

/**
 * AVAILABLE 是「真实库持久化回执 + 权限核验通过」之后的状态。
 * Mock 模式下它**结构性不可达** —— 此处返回不可达原因，供 API 如实告知调用方。
 */
function availableBlockedReason(admission, ref) {
  if (admission.approvalMode !== 'REAL') {
    return 'Mock 资料库模式下 AVAILABLE 不可达：需要真实 LibraryGateway 持久化回执与权限核验（06 §3）。';
  }
  const e = reuseEligibility(admission, ref);
  return e.eligible ? '' : '尚未满足可复用条件：' + e.blocking.join('；');
}

function userOf(db, id) {
  const u = (db.users || []).find((x) => x.id === id);
  return u ? u.displayName : '';
}

/** 序列化（API 输出唯一出口） */
function serializeAdmission(db, a, opts) {
  const o = opts || {};
  const asset = db.working_assets.find((x) => x.id === a.workingAssetId);
  const ref = refFor(db, a.id);
  const elig = reuseEligibility(a, ref);
  const cases = (db.review_cases || []).filter((c) => c.subjectType === 'asset_admission' && c.subjectId === a.id);
  const out = {
    id: a.id,
    brandCode: a.brandCode,
    workingAssetId: a.workingAssetId,
    assetFileName: asset ? asset.fileName : '（素材已删除）',
    assetMime: asset ? asset.mime : '',
    assetMock: !!(asset && asset.mock),
    assetDigestNow: asset ? asset.sha256 : '',
    assetSha256: a.assetSha256,
    categoryCode: a.categoryCode,
    submissionMetadata: a.submissionMetadata || {},
    state: a.state,
    finalApprovalStatus: a.finalApprovalStatus,
    syncStatus: a.syncStatus,
    approvalMode: a.approvalMode,
    precheck: a.precheck || null,
    libraryId: a.libraryId || null,
    libraryVersion: a.libraryVersion || null,
    receipt: a.receipt || null,
    idempotencyKey: a.idempotencyKey || '',
    syncAttempts: a.syncAttempts || 0,
    lastSyncError: a.lastSyncError || '',
    reuseEligibility: elig.eligible,
    reuseBlocking: elig.blocking,
    availableBlockedReason: availableBlockedReason(a, ref),
    ref: ref ? {
      id: ref.id, libraryId: ref.libraryId, version: ref.version,
      permissionScope: ref.permissionScope, permissionValid: ref.permissionValid,
      assetState: ref.assetState, state: ref.state, mock: ref.mock, lastVerifiedAt: ref.lastVerifiedAt
    } : null,
    reviewCaseId: cases.length ? cases[cases.length - 1].id : null,
    reviewCaseState: cases.length ? cases[cases.length - 1].state : null,
    submittedBy: a.submittedBy, submittedByName: userOf(db, a.submittedBy),
    submittedAt: a.submittedAt,
    decidedBy: a.decidedBy || '', decidedByName: userOf(db, a.decidedBy),
    decidedAt: a.decidedAt || null,
    sandbox: true,
    demo: !!a.demo,
    createdAt: a.createdAt, updatedAt: a.updatedAt, rowVersion: a.rowVersion || 1
  };
  if (o.withHistory) {
    out.history = (a.history || []).slice().sort((x, y) => (x.at < y.at ? 1 : -1));
  }
  if (o.withAsset) {
    out.asset = asset ? {
      id: asset.id, fileName: asset.fileName, mime: asset.mime, bytes: asset.bytes,
      sha256: asset.sha256, origin: asset.origin, mock: !!asset.mock,
      contentUrl: '/api/mos/assets/' + asset.id + '/content'
    } : null;
  }
  return out;
}

/** 校验状态迁移合法性 */
function assertTransition(admission, to, transitions) {
  const allowed = transitions[admission.state] || [];
  if (allowed.indexOf(to) === -1) {
    return { ok: false, message: '入库申请当前状态 ' + admission.state + ' 不允许迁移到 ' + to };
  }
  return { ok: true };
}

module.exports = {
  reuseEligibility,
  appendHistory,
  precheck,
  createRefFromReceipt,
  refFor,
  availableBlockedReason,
  serializeAdmission,
  assertTransition,
  ADMISSION_APPROVAL_STATUSES,
  ADMISSION_SYNC_STATUSES
};
