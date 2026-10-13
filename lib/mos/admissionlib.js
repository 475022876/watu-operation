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
const wc = require('./workspace-contract');

/** 入库流程追加事件的最大保留条数（单文件存储边界，见 store.js 头注释） */
const MAX_HISTORY = 200;

/** 三项 Provider 必填字段的本地键名（与 `wc.ADMISSION_REQUIRED_FIELDS` 子集对齐） */
const PROVIDER_REQUIRED_ENTITY_FIELDS = ['libraryPrimaryCategory', 'classification', 'licenseStatus'];

/**
 * 归一化并校验三项 Provider 必填字段（B1）。
 *
 * **安全语义（不可放宽）**：
 *   · `licenseStatus` 只接受 Provider 枚举；任何自由文本一律 **不映射**，转 `unknown` 并标记待人工核定；
 *   · `classification` 只接受四级密级；**不提供默认值**（拒绝「猜测降级」）；
 *   · `libraryPrimaryCategory` 只接受七大资料区编号；编号一律引用，**不自创**。
 *
 * @returns {{ok:boolean, missing:string[], errors:string[], value:object}}
 */
function normalizeProviderFields(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const missing = [];
  const errors = [];
  const value = {};

  const primary = String(src.libraryPrimaryCategory || '').trim();
  if (!primary) missing.push('libraryPrimaryCategory');
  else if (wc.LIBRARY_PRIMARY_CATEGORIES.indexOf(primary) === -1) {
    errors.push('libraryPrimaryCategory 必须是七大资料区之一（' + wc.LIBRARY_PRIMARY_CATEGORIES.join('/') + '）');
  }
  value.libraryPrimaryCategory = primary || null;

  let sub = String(src.librarySubcategory || '').trim();
  if (sub) {
    const cat = wc.LIBRARY_CATEGORIES.find((c) => c.id === sub.split('.')[0]);
    const okSub = !!(cat && cat.subs.some((x) => x[0] === sub));
    if (!okSub) { errors.push('librarySubcategory 不是有效的二级目录'); sub = ''; }
    else if (primary && sub.split('.')[0] !== primary) {
      errors.push('librarySubcategory 必须位于所选的 libraryPrimaryCategory 下');
      sub = '';
    }
  }
  value.librarySubcategory = sub || null;

  const cls = String(src.classification || '').trim();
  if (!cls) missing.push('classification');
  else if (wc.CLASSIFICATIONS.indexOf(cls) === -1) {
    errors.push('classification 必须是四级密级之一（' + wc.CLASSIFICATIONS.join('/') + '）');
  }
  value.classification = cls || null;

  const licRaw = String(src.licenseStatus === undefined || src.licenseStatus === null ? '' : src.licenseStatus).trim().toLowerCase();
  let licenseNeedsManualReview = false;
  let lic = licRaw;
  if (!licRaw) { missing.push('licenseStatus'); }
  else if (wc.LICENSE_STATUSES.indexOf(licRaw) === -1) {
    // 自由文本（如 INTERNAL_DRAFT）**绝不被"猜"成 cleared**：保守转 unknown + 待人工核定。
    errors.push('licenseStatus 只接受 ' + wc.LICENSE_STATUSES.join('/')
      + '；自由文本「' + String(src.licenseStatus).slice(0, 40) + '」已保守转为 unknown，需人工核定');
    lic = 'unknown';
    licenseNeedsManualReview = true;
  }
  value.licenseStatus = lic || null;
  value.licenseNeedsManualReview = licenseNeedsManualReview;

  const pick = (key, allowed, dflt) => {
    const v = String(src[key] === undefined || src[key] === null ? dflt : src[key]).trim().toLowerCase();
    if (allowed.indexOf(v) === -1) errors.push(key + ' 必须是 ' + allowed.join('/'));
    return v;
  };
  value.reuseScope = pick('reuseScope', wc.REUSE_SCOPES, 'none');
  value.aiReusePolicy = pick('aiReusePolicy', wc.AI_REUSE_POLICIES, 'blocked');
  value.externalAiTransferPolicy = pick('externalAiTransferPolicy', wc.EXTERNAL_AI_TRANSFER_POLICIES, 'blocked');

  return { ok: missing.length === 0 && errors.length === 0, missing, errors, value };
}

/** 三项字段是否齐备且可用（供「可否提交最终审批 / 可否推送正式库」判定） */
function providerFieldsComplete(admission) {
  const missing = [];
  if (!admission || !admission.libraryPrimaryCategory) missing.push('libraryPrimaryCategory');
  if (!admission || !admission.classification) missing.push('classification');
  if (!admission || !admission.licenseStatus) missing.push('licenseStatus');
  return { complete: missing.length === 0, missing };
}

/**
 * **D-06.5 ①（提供方实测纠正，本侧必须遵守）**：`reuseScope` 缺省 `none` **不可接受**。
 *
 * Provider `asset-admission.runPrecheck()` 把 `reuseScope === 'none'` 判为「无复用意义」→
 * 申请直接落 `REVISION_REQUIRED`，而 `/admissions/:id/submit` **没有重提分支**（B-4）→
 * 该申请**永远无法**推进到最终审批。因此 `none` 必须在**出站前**就被拦下，
 * 且不能靠"改字段后重提同一申请"补救（原假设错误，见 CONSUMER_CONTRACT_DIFF D-06）。
 *
 * @returns {{ok:boolean, reason:string, note:string}}
 */
function reuseScopeUsable(admission) {
  const v = String((admission && admission.reuseScope) || '').trim().toLowerCase();
  if (v && v !== 'none' && wc.REUSE_SCOPES.indexOf(v) !== -1) return { ok: true, reason: '', note: '' };
  if (!v) {
    return { ok: false, reason: 'MISSING_REUSE_SCOPE',
      note: '缺少 reuseScope。Provider 预检把缺省 none 判为「无复用意义」并落 REVISION_REQUIRED，'
        + '而该状态无重提入口 —— 申请会永久卡死。请显式选择非 none 的复用范围（'
        + wc.REUSE_SCOPES.join('/') + '）。' };
  }
  if (v === 'none') {
    return { ok: false, reason: 'REUSE_SCOPE_NONE',
      note: 'reuseScope="none" 不可用于正式资产准入：Provider 预检会判「无复用意义」并落 '
        + 'REVISION_REQUIRED（D-06.5）。如确无复用意图，请勿建立准入申请。' };
  }
  return { ok: false, reason: 'BAD_REUSE_SCOPE',
    note: 'reuseScope 取值非法：' + v + '（可选 ' + wc.REUSE_SCOPES.join('/') + '）' };
}

/**
 * **D-06.4 ②**：`licenseStatus ∈ {expired, unknown}` 会被 Provider 预检阻断入库
 * （「不可作为正式复用资产」→ `REVISION_REQUIRED`）。这不是错误，而是**刻意的人工确认闸门**：
 * `unknown` = 「必须先补齐许可信息」，绝不是「先放着」。
 *
 * @returns {{blocking:boolean, note:string}} `blocking=true` 表示该申请**注定无法完成准入**
 */
function licenseAdmissionGate(admission) {
  const v = String((admission && admission.licenseStatus) || '').trim().toLowerCase();
  if (v === 'expired' || v === 'unknown') {
    return { blocking: true,
      note: '许可状态为 ' + v + '：Provider 预检将判定「不可作为正式复用资产」并落 REVISION_REQUIRED，'
        + '该申请**无法完成准入**。必须补齐许可信息后再提交（' + v + ' 是人工确认闸门，不是占位值）。' };
  }
  return { blocking: false, note: '' };
}

/**
 * 构造 Provider `AdmissionInput`（逐字段映射到权威 OpenAPI schema）。
 *
 * 注意：**不发送 `originSystem`** —— Provider 路由在入库前无条件覆写为 `marketing_os`，
 * 且 C 包 01 节明确 Consumer 不得伪造自报（详见 workspace-contract 同名字段注释）。
 */
function toProviderAdmissionInput(admission, opts) {
  const o = opts || {};
  const md = admission.submissionMetadata || {};
  const brandId = o.brandId || admission.brandCode;
  const out = {
    idempotencyKey: String(admission.idempotencyKey || '').slice(0, 120),
    originObjectId: String(o.originObjectId || admission.workingAssetId || admission.id).replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 120),
    originVersionId: String(o.originVersionId || admission.originVersionId || 'V1.0').slice(0, 120),
    brandId,
    libraryPrimaryCategory: admission.libraryPrimaryCategory,
    classification: admission.classification,
    licenseStatus: admission.licenseStatus,
    reuseScope: admission.reuseScope || 'none',
    aiReusePolicy: admission.aiReusePolicy || 'blocked',
    externalAiTransferPolicy: admission.externalAiTransferPolicy || 'blocked',
    title: String(md.title || '').slice(0, 180),
    note: String(o.note || '').slice(0, 500)
  };
  if (admission.librarySubcategory) out.librarySubcategory = admission.librarySubcategory;
  if (admission.categoryCode) out.marketingCategory = admission.categoryCode;
  if (admission.assetSha256) out.contentHash = admission.assetSha256;
  /* 文件名是 Provider 预检的**硬条件**（`asset-admission.runPrecheck`：`!req.fileName`
   * → `REVISION_REQUIRED`）。申请自身没记文件名时，由调用方以**工作素材的真实文件名**
   * 补齐（`opts.fileName`）—— 绝不编造占位名，缺失则由调用方零出站如实拒绝。 */
  const fn = md.fileName || o.fileName;
  if (fn) out.fileName = String(fn).slice(0, 180);
  return out;
}

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

  /* ---- B1：三项 Provider 必填字段必须在本地就齐备且未被猜测 ---- */
  const fields = providerFieldsComplete(admission);
  push('library_primary_category', !!admission.libraryPrimaryCategory,
    admission.libraryPrimaryCategory
      ? '资料区 ' + admission.libraryPrimaryCategory
      : '缺少 libraryPrimaryCategory（七大资料区 01–07，须人工选择，不得猜测）');
  push('classification_declared', !!admission.classification,
    admission.classification
      ? '密级 ' + admission.classification
      : '缺少 classification（四级密级，须人工核定，不得猜测降级）');
  push('license_status_declared', !!admission.licenseStatus,
    admission.licenseStatus
      ? '许可状态 ' + admission.licenseStatus
      : '缺少 licenseStatus（' + wc.LICENSE_STATUSES.join('/') + '）');
  push('license_not_guessed', !admission.licenseNeedsManualReview,
    admission.licenseNeedsManualReview
      ? '许可由历史自由文本「' + (admission.licenseLegacyText || '') + '」保守转为 unknown，须人工核定后才可入库'
      : '许可状态已明示，非猜测值');
  push('no_manual_review_flag', !admission.needsManualReview,
    admission.needsManualReview
      ? '该申请为历史迁移数据，需人工补齐字段：' + (admission.manualReviewReasons || []).join('；')
      : '字段完整，无需人工补齐');
  if (!fields.complete) {
    // 明确汇总，避免调用方只看单项 check 而漏判
    push('provider_fields_complete', false, 'Provider 必填字段缺失：' + fields.missing.join('、'));
  } else {
    push('provider_fields_complete', true, '三项 Provider 必填字段齐备');
  }

  /* ---- D-06.5：reuseScope 不得为 none / 缺失（否则 Provider 预检必然卡死申请） ---- */
  const rs = reuseScopeUsable(admission);
  push('reuse_scope_usable', rs.ok, rs.ok ? '复用范围 ' + admission.reuseScope + ' 可用于正式准入' : rs.note);

  /* ---- D-06.4：licenseStatus=expired/unknown 会被 Provider 预检阻断，须提前告知 ---- */
  const licGate = licenseAdmissionGate(admission);
  push('license_admissible', !licGate.blocking,
    licGate.blocking ? licGate.note : '许可状态可进入正式准入');

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
    /* ---- B1：Provider 必填字段与保守迁移标记（对外如实暴露，不做美化） ---- */
    libraryPrimaryCategory: a.libraryPrimaryCategory || null,
    librarySubcategory: a.librarySubcategory || null,
    classification: a.classification || null,
    licenseStatus: a.licenseStatus || null,
    licenseLegacyText: a.licenseLegacyText || '',
    licenseNeedsManualReview: !!a.licenseNeedsManualReview,
    reuseScope: a.reuseScope || 'none',
    aiReusePolicy: a.aiReusePolicy || 'blocked',
    externalAiTransferPolicy: a.externalAiTransferPolicy || 'blocked',
    needsManualReview: !!a.needsManualReview,
    manualReviewReasons: (a.manualReviewReasons || []).slice(),
    providerFieldsComplete: providerFieldsComplete(a).complete,
    providerFieldsMissing: providerFieldsComplete(a).missing,
    originObjectId: a.originObjectId || '',
    libraryJobId: a.libraryJobId || null,
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
  /* ---- B1：Provider 字段层 ---- */
  PROVIDER_REQUIRED_ENTITY_FIELDS,
  normalizeProviderFields,
  providerFieldsComplete,
  reuseScopeUsable,
  licenseAdmissionGate,
  toProviderAdmissionInput,
  ADMISSION_APPROVAL_STATUSES,
  ADMISSION_SYNC_STATUSES
};
