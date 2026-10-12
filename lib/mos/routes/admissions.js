'use strict';
/**
 * Marketing OS —— 资产入库网关（W08-03 Asset Admission / 03 §2.4 / 06 §3 / E2E-05）。
 *
 * 流程（03 §2.4）：
 *   WORKING → SUBMITTED → PRECHECK → REVIEWING → FINAL_APPROVAL_PENDING
 *           → (FINAL_APPROVAL_GRANTED | REJECTED)
 *           → LIBRARY_SYNC_PENDING → (SYNC_COMPLETED | SYNC_FAILED) → AVAILABLE
 *
 * 权限拆分（**A-16 修复**，03 §2.4）：
 *   - 提交 / 预检 / 同步：`asset.submit`、`asset.review`
 *   - **最终入库审批**：`library.asset.approve.final` —— 独立特权，
 *     不随 P1 / P2 / MOS_ADMIN 自动获得，且**只能**通过 ASSET_ADMISSION 审核链执行。
 *
 * 不可妥协：
 *   - Mock 下 `AVAILABLE` **结构性不可达**（缺真实回执 + 权限核验），API 如实说明原因；
 *   - 可复用资格是**计算判定**（admissionlib.reuseEligibility），任何接口都不接受手工设置；
 *   - 同步失败必须留痕且不可复用；重试**先查回执**再提交，绝不产生双资产（SEC-08）。
 */
const { get, post } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const {
  ADMISSION_TRANSITIONS, ADMISSION_STATES, dictValid
} = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid, contentHash } = require('../ids');
const library = require('../adapters/library');
const reviewlib = require('../reviewlib');
const admissionlib = require('../admissionlib');
const helpers = require('./helpers');

/** 品牌当前资料库模式（Mock / real），作为 approvalMode 的事实来源 */
function libraryMode() {
  return String(require('../config').getMosConfig().integrations.library || 'mock').toLowerCase();
}

function findAdmission(db, id) {
  const a = db.asset_admissions.find((x) => x.id === id);
  if (!a) throw httpError(404, '入库申请不存在', 'ADMISSION_NOT_FOUND');
  return a;
}

/** 审批绑定哈希：资产指纹 + 分类 + 提交元数据（类比 content_version 的 manifest，SEC-02） */
function bindingHash(admission) {
  return contentHash({
    admissionId: admission.id,
    workingAssetId: admission.workingAssetId,
    assetSha256: admission.assetSha256,
    categoryCode: admission.categoryCode,
    metadata: admission.submissionMetadata || {}
  });
}

function advance(db, a, actor, path, note) {
  const events = [];
  for (const to of path) {
    const t = admissionlib.assertTransition(a, to, ADMISSION_TRANSITIONS);
    if (!t.ok) throw httpError(409, t.message, 'ILLEGAL_TRANSITION');
    const from = a.state;
    a.state = to;
    a.updatedAt = new Date().toISOString();
    a.updatedBy = actor.id;
    a.rowVersion = Number(a.rowVersion || 1) + 1;
    events.push(admissionlib.appendHistory(a, actor, 'STATE', { fromState: from, toState: to, note: note || '' }));
  }
  return events;
}

/* ==================== 查询 ==================== */

get('/api/mos/asset-admissions', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'library.asset.read', brandCode, { ip: ctx.ip, objectType: 'asset_admission' });

  let rows = db.asset_admissions.filter((a) => a.brandCode === brandCode);
  if (ctx.query.state) {
    const s = String(ctx.query.state).toUpperCase();
    if (ADMISSION_STATES.indexOf(s) === -1) throw httpError(400, '状态非法', 'BAD_STATE');
    rows = rows.filter((a) => a.state === s);
  }
  if (ctx.query.finalApprovalStatus) {
    rows = rows.filter((a) => a.finalApprovalStatus === String(ctx.query.finalApprovalStatus).toUpperCase());
  }
  if (ctx.query.syncStatus) {
    rows = rows.filter((a) => a.syncStatus === String(ctx.query.syncStatus).toUpperCase());
  }
  if (ctx.query.mine === '1') rows = rows.filter((a) => a.submittedBy === ctx.user.id);
  const kw = String(ctx.query.q || '').trim().toLowerCase();
  if (kw) {
    rows = rows.filter((a) => {
      const md = a.submissionMetadata || {};
      return String(md.title || '').toLowerCase().indexOf(kw) !== -1
        || String(a.categoryCode || '').toLowerCase().indexOf(kw) !== -1
        || String(a.id).toLowerCase().indexOf(kw) !== -1;
    });
  }
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const paged = helpers.paginate(rows, ctx.query);

  const all = db.asset_admissions.filter((a) => a.brandCode === brandCode);
  return {
    ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((a) => admissionlib.serializeAdmission(db, a)),
    summary: {
      total: all.length,
      pendingApproval: all.filter((a) => a.state === 'FINAL_APPROVAL_PENDING').length,
      syncing: all.filter((a) => a.state === 'LIBRARY_SYNC_PENDING').length,
      failed: all.filter((a) => a.state === 'SYNC_FAILED').length,
      reusable: all.filter((a) => admissionlib.reuseEligibility(a, admissionlib.refFor(db, a.id)).eligible).length
    },
    integration: library.status(),
    /** 诚实性提示：Mock 下 AVAILABLE 不可达，可复用数量必然为 0 */
    availableBlockedReason: libraryMode() === 'real' ? '' : admissionlib.availableBlockedReason({ approvalMode: 'MOCK' }, null),
    note: '可复用资格（reuseEligibility）由服务端按 03 §2.4 公式**计算**得出，不接受人工设置。'
  };
});

get('/api/mos/asset-admissions/:id', async (ctx) => {
  const db = getDb();
  const a = findAdmission(db, ctx.params.id);
  rbac.assertBrand(ctx.principal, a.brandCode);
  rbac.assertCan(ctx.principal, 'library.asset.read', a.brandCode, { ip: ctx.ip, objectType: 'asset_admission', objectId: a.id });

  const cases = (db.review_cases || [])
    .filter((c) => c.subjectType === 'asset_admission' && c.subjectId === a.id)
    .sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));
  const decisions = (db.review_decisions || []).filter((d) => d.subjectId === a.id)
    .sort((x, y) => (x.createdAt < y.createdAt ? 1 : -1));

  return {
    ok: true,
    admission: admissionlib.serializeAdmission(db, a, { withHistory: true, withAsset: true }),
    reviewCase: cases.length ? require('./reviews').serialize(db, cases[0], ctx.principal, { withDecisions: true }) : null,
    decisions,
    bindingHash: bindingHash(a),
    integration: library.status(),
    note: '最终入库审批走 ASSET_ADMISSION 审核链，需独立特权 library.asset.approve.final（03 §2.4）。'
  };
});

/* ==================== 提交 ==================== */

post('/api/mos/asset-admissions', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'asset.submit', brandCode, { ip: ctx.ip, objectType: 'asset_admission' });

  const assetId = String(body.workingAssetId || '').trim();
  if (!assetId) throw httpError(400, '请选择要入库的工作素材（workingAssetId）', 'MISSING_ASSET');
  const asset = db.working_assets.find((x) => x.id === assetId);
  if (!asset) throw httpError(400, '工作素材不存在', 'ASSET_NOT_FOUND');
  rbac.assertSameBrand(asset.brandCode, brandCode);

  const categoryCode = String(body.categoryCode || '').trim().toUpperCase();
  if (!categoryCode) throw httpError(400, '请选择资产分类（A01–A08）', 'MISSING_CATEGORY');
  if (!dictValid('assetCategories', categoryCode)) {
    throw httpError(400, '资产分类非法：' + categoryCode, 'BAD_CATEGORY');
  }

  const mdIn = body.submissionMetadata || {};
  const md = {
    title: String(mdIn.title || asset.fileName || '').slice(0, 200),
    description: String(mdIn.description || '').slice(0, 2000),
    /** 许可：默认 INTERNAL_DRAFT；UNVERIFIED 会被预检与资料库双重拒绝 */
    license: String(mdIn.license || 'INTERNAL_DRAFT').toUpperCase().slice(0, 60),
    sourceRef: String(mdIn.sourceRef || '').slice(0, 500),
    tags: Array.isArray(mdIn.tags) ? mdIn.tags.map((t) => String(t).slice(0, 40)).slice(0, 20) : []
  };

  const idem = String(body.idempotencyKey || '').trim();
  if (idem) {
    const dup = db.asset_admissions.find((a) => a.brandCode === brandCode && a.idempotencyKey === idem);
    if (dup) {
      return {
        ok: true, deduplicated: true,
        admission: admissionlib.serializeAdmission(db, dup, { withHistory: true }),
        note: '幂等命中：同一 idempotencyKey 已存在入库申请，未重复创建。'
      };
    }
  }

  const now = new Date().toISOString();
  const a = {
    id: uid('adm'),
    brandCode,
    workingAssetId: asset.id,
    assetSha256: asset.sha256,
    categoryCode,
    submissionMetadata: md,
    state: 'WORKING',
    finalApprovalStatus: 'PENDING',
    syncStatus: 'NOT_STARTED',
    /** 最终授权来源：Mock 模式记录为 MOCK，真实环境由 LibraryGateway 验证后置 REAL */
    approvalMode: 'MOCK',
    precheck: null,
    libraryId: null,
    libraryVersion: null,
    receipt: null,
    syncAttempts: 0,
    lastSyncError: '',
    idempotencyKey: idem || uid('admkey'),
    history: [],
    submittedBy: ctx.user.id,
    submittedAt: now,
    decidedBy: '',
    decidedAt: null,
    demo: false,
    createdAt: now,
    updatedAt: now,
    rowVersion: 1
  };
  db.asset_admissions.push(a);
  admissionlib.appendHistory(a, ctx.user, 'CREATE', { fromState: null, toState: 'WORKING', note: '从工作素材创建入库申请' });
  advance(db, a, ctx.user, ['SUBMITTED'], '提交入库申请');

  save();
  appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'asset_admission.submitted',
    objectType: 'asset_admission', objectId: a.id, newState: a.state, ip: ctx.ip,
    metadata: { workingAssetId: asset.id, categoryCode, sha256: asset.sha256, mock: !!asset.mock } });

  return { ok: true, admission: admissionlib.serializeAdmission(db, a, { withHistory: true }) };
});

/* ==================== 预检（asset.review） ==================== */

post('/api/mos/asset-admissions/:id/precheck', async (ctx) => {
  const db = getDb();
  const a = findAdmission(db, ctx.params.id);
  rbac.assertBrand(ctx.principal, a.brandCode);
  rbac.assertCan(ctx.principal, 'asset.review', a.brandCode,
    { ip: ctx.ip, objectType: 'asset_admission', objectId: a.id });

  if (a.state !== 'SUBMITTED' && a.state !== 'PRECHECK') {
    throw httpError(409, '当前状态 ' + a.state + ' 不能执行预检（仅 SUBMITTED / PRECHECK）', 'ILLEGAL_STATE');
  }

  const result = admissionlib.precheck(db, a);
  a.precheck = Object.assign({}, result, {
    checkedBy: ctx.user.id, checkedByName: ctx.user.displayName,
    checkedAt: new Date().toISOString()
  });

  if (a.state === 'SUBMITTED') advance(db, a, ctx.user, ['PRECHECK'], '执行入库预检');
  else { a.updatedAt = new Date().toISOString(); a.rowVersion = Number(a.rowVersion || 1) + 1; }
  admissionlib.appendHistory(a, ctx.user, 'PRECHECK', { fromState: a.state, toState: a.state,
    note: '预检结论：' + result.verdict + (result.failureReasons.length ? '（' + result.failureReasons.join('；') + '）' : '') });

  save();
  appendAudit({ actorId: ctx.user.id, brandCode: a.brandCode,
    eventType: result.verdict === 'PASS' ? 'asset_admission.precheck.passed' : 'asset_admission.precheck.failed',
    objectType: 'asset_admission', objectId: a.id, outcome: result.verdict === 'PASS' ? 'ok' : 'denied', ip: ctx.ip,
    metadata: { checks: result.checks.map((c) => c.id + '=' + (c.ok ? 'ok' : 'fail')), reasons: result.failureReasons } });

  return {
    ok: true,
    admission: admissionlib.serializeAdmission(db, a, { withHistory: true }),
    precheck: a.precheck,
    note: result.verdict === 'PASS'
      ? '预检通过：可提交最终入库审批。'
      : '预检未通过：必须先补齐问题，再重新预检；未通过的申请不能提交最终审批。'
  };
});

/* ==================== 提交最终审批（开第三条审核链） ==================== */

post('/api/mos/asset-admissions/:id/submit-final', async (ctx) => {
  const db = getDb();
  const a = findAdmission(db, ctx.params.id);
  rbac.assertBrand(ctx.principal, a.brandCode);
  rbac.assertCan(ctx.principal, 'asset.submit', a.brandCode,
    { ip: ctx.ip, objectType: 'asset_admission', objectId: a.id });

  if (!a.precheck || a.precheck.verdict !== 'PASS') {
    throw httpError(409, '预检未通过，不能提交最终入库审批', 'PRECHECK_REQUIRED');
  }
  const path = a.state === 'PRECHECK' ? ['REVIEWING', 'FINAL_APPROVAL_PENDING']
    : (a.state === 'REVIEWING' ? ['FINAL_APPROVAL_PENDING'] : null);
  if (!path) throw httpError(409, '当前状态 ' + a.state + ' 不能提交最终审批', 'ILLEGAL_STATE');

  advance(db, a, ctx.user, path, '提交最终入库审批');

  // 开 ASSET_ADMISSION 审核单：最终审批**只能**通过审核链执行
  const c = reviewlib.openCase(db, {
    type: 'ASSET_ADMISSION',
    brandCode: a.brandCode,
    subjectType: 'asset_admission',
    subjectId: a.id,
    versionHash: bindingHash(a),
    riskGrade: '',
    submittedBy: ctx.user.id,
    requirements: [
      '最终入库许可是独立特权：需要 library.asset.approve.final',
      'Mock 资料库下同步成功也只能得到 MOCK 资产，不可标记可用'
    ],
    note: '资产入库最终审批（03 §2.4）'
  });
  admissionlib.appendHistory(a, ctx.user, 'REVIEW_CASE_OPENED', { fromState: a.state, toState: a.state,
    note: '已开 ASSET_ADMISSION 审核单 ' + c.id });

  save();
  appendAudit({ actorId: ctx.user.id, brandCode: a.brandCode, eventType: 'asset_admission.awaiting_final',
    objectType: 'asset_admission', objectId: a.id, newState: a.state, ip: ctx.ip,
    metadata: { caseId: c.id, bindingHash: c.versionHash } });

  return {
    ok: true,
    admission: admissionlib.serializeAdmission(db, a, { withHistory: true }),
    reviewCase: require('./reviews').serialize(db, c, ctx.principal, { withDecisions: true }),
    note: '最终审批请在 My Reviews / 本页对 ASSET_ADMISSION 审核单裁决；需 library.asset.approve.final。'
  };
});

/* ==================== 同步（幂等） ==================== */

/** 由 reviews.js 在 ASSET_ADMISSION 裁决通过后调用（保持单一权威动作） */
function markApproved(db, admission, actor, approvalRef) {
  const mode = libraryMode() === 'real' ? 'REAL' : 'MOCK';
  admission.finalApprovalStatus = 'APPROVED';
  admission.approvalMode = mode;
  admission.decidedBy = actor.id;
  admission.decidedAt = new Date().toISOString();
  admission.approvalRef = String(approvalRef || '').slice(0, 200);
  admissionlib.appendHistory(admission, actor, 'FINAL_APPROVAL_GRANTED', {
    fromState: admission.state, toState: admission.state,
    note: '最终审批通过（授权来源：' + mode + '）'
  });
  return mode;
}

function markRejected(db, admission, actor, remarks) {
  admission.finalApprovalStatus = 'REJECTED';
  admission.decidedBy = actor.id;
  admission.decidedAt = new Date().toISOString();
  admission.rejectReason = String(remarks || '').slice(0, 1000);
  admissionlib.appendHistory(admission, actor, 'REJECTED', {
    fromState: admission.state, toState: admission.state, note: '最终审批驳回：' + (remarks || '')
  });
}

async function runSync(db, a, actor, ip) {
  const t = admissionlib.assertTransition(a, 'LIBRARY_SYNC_PENDING', ADMISSION_TRANSITIONS);
  if (!t.ok) throw httpError(409, t.message, 'ILLEGAL_TRANSITION');
  advance(db, a, actor, ['LIBRARY_SYNC_PENDING'], a.syncStatus === 'FAILED' ? '失败重试' : '提交资料库同步');
  a.syncStatus = 'PENDING';
  a.syncAttempts = Number(a.syncAttempts || 0) + 1;

  // 重试前先按回执查询：确认上一次是否其实已经成功（03 §5「同步成功响应丢失」）
  let reconciled = null;
  if (a.receipt && a.receipt.receiptId) {
    const st = await library.getAdmissionStatus(a.receipt.receiptId);
    if (st && st.state === 'SYNC_COMPLETED') reconciled = st;
  }

  const receipt = reconciled || await library.submitAdmission({
    brandCode: a.brandCode,
    admissionId: a.id,
    assetSha256: a.assetSha256,
    categoryCode: a.categoryCode,
    license: (a.submissionMetadata || {}).license,
    title: (a.submissionMetadata || {}).title,
    sourceRef: (a.submissionMetadata || {}).sourceRef
  }, a.idempotencyKey);

  a.receipt = receipt;
  const okSync = receipt.state === 'SYNC_COMPLETED';

  if (!okSync) {
    a.syncStatus = 'FAILED';
    a.lastSyncError = receipt.errorCode || 'SYNC_FAILED';
    a.updatedAt = new Date().toISOString();
    a.rowVersion = Number(a.rowVersion || 1) + 1;
    const from = a.state;
    a.state = 'SYNC_FAILED';
    admissionlib.appendHistory(a, actor, 'SYNC_FAILED', {
      fromState: from, toState: 'SYNC_FAILED', note: receipt.error || '资料库同步失败',
      metadata: { errorCode: receipt.errorCode, receiptId: receipt.receiptId }
    });
    save();
    appendAudit({ actorId: actor.id, brandCode: a.brandCode, eventType: 'asset_admission.sync.failed',
      objectType: 'asset_admission', objectId: a.id, newState: 'SYNC_FAILED', outcome: 'denied', ip,
      metadata: { errorCode: receipt.errorCode, error: receipt.error, attempt: a.syncAttempts } });
    return { ok: true, synced: false, admission: a, receipt };
  }

  a.syncStatus = 'COMPLETED';
  a.lastSyncError = '';
  a.libraryId = receipt.assetId || null;
  a.libraryVersion = receipt.libraryVersion || null;
  a.updatedAt = new Date().toISOString();
  a.rowVersion = Number(a.rowVersion || 1) + 1;

  let ref = admissionlib.refFor(db, a.id);
  if (!ref) ref = admissionlib.createRefFromReceipt(db, a, receipt);

  const from = a.state;
  a.state = 'SYNC_COMPLETED';
  admissionlib.appendHistory(a, actor, 'SYNC_COMPLETED', {
    fromState: from, toState: 'SYNC_COMPLETED',
    note: '资料库回执：' + receipt.receiptId + '（' + receipt.state + '）',
    metadata: { receiptId: receipt.receiptId, assetId: receipt.assetId, deduplicated: !!receipt.deduplicated }
  });

  // 只有真正满足可复用条件（含真实回执 + 权限核验）才进入 AVAILABLE —— Mock 下到不了
  const elig = admissionlib.reuseEligibility(a, ref);
  let reachedAvailable = false;
  if (elig.eligible) {
    a.state = 'AVAILABLE';
    reachedAvailable = true;
    admissionlib.appendHistory(a, actor, 'AVAILABLE', {
      fromState: 'SYNC_COMPLETED', toState: 'AVAILABLE', note: '满足可复用条件，标记 AVAILABLE'
    });
  } else {
    admissionlib.appendHistory(a, actor, 'AVAILABLE_BLOCKED', {
      fromState: 'SYNC_COMPLETED', toState: 'SYNC_COMPLETED',
      note: admissionlib.availableBlockedReason(a, ref)
    });
  }

  save();
  appendAudit({ actorId: actor.id, brandCode: a.brandCode, eventType: 'asset_admission.sync.completed',
    objectType: 'asset_admission', objectId: a.id, newState: a.state, ip,
    metadata: { receiptId: receipt.receiptId, libraryId: a.libraryId, mock: receipt.mode !== 'real',
      reuseEligible: elig.eligible, reachedAvailable, attempt: a.syncAttempts } });

  return { ok: true, synced: true, admission: a, receipt, reuseEligibility: elig, reachedAvailable };
}

post('/api/mos/asset-admissions/:id/sync', async (ctx) => {
  const db = getDb();
  const a = findAdmission(db, ctx.params.id);
  rbac.assertBrand(ctx.principal, a.brandCode);
  rbac.assertCan(ctx.principal, 'asset.submit', a.brandCode,
    { ip: ctx.ip, objectType: 'asset_admission', objectId: a.id });

  if (a.finalApprovalStatus !== 'APPROVED') {
    throw httpError(409, '最终审批未通过，不能提交资料库同步（当前 ' + a.finalApprovalStatus + '）', 'NOT_APPROVED');
  }
  if (a.state !== 'FINAL_APPROVAL_GRANTED' && a.state !== 'SYNC_COMPLETED') {
    throw httpError(409, '当前状态 ' + a.state + ' 不能提交同步', 'ILLEGAL_STATE');
  }
  if (a.state === 'SYNC_COMPLETED') {
    return {
      ok: true, deduplicated: true,
      admission: admissionlib.serializeAdmission(db, a, { withHistory: true }),
      note: '该申请已同步完成，未重复调用资料库（幂等）。'
    };
  }

  const r = await runSync(db, a, ctx.user, ctx.ip);
  return {
    ok: true,
    admission: admissionlib.serializeAdmission(db, a, { withHistory: true }),
    receipt: r.receipt,
    reuseEligibility: r.reuseEligibility || null,
    note: r.synced
      ? (r.reachedAvailable ? '已满足可复用条件。' : admissionlib.availableBlockedReason(a, admissionlib.refFor(db, a.id)))
      : ('资料库同步失败：' + (r.receipt.error || ''))
  };
});

post('/api/mos/asset-admissions/:id/retry-sync', async (ctx) => {
  const db = getDb();
  const a = findAdmission(db, ctx.params.id);
  rbac.assertBrand(ctx.principal, a.brandCode);
  rbac.assertCan(ctx.principal, 'asset.submit', a.brandCode,
    { ip: ctx.ip, objectType: 'asset_admission', objectId: a.id });

  if (a.syncStatus !== 'FAILED' && a.state !== 'SYNC_FAILED') {
    throw httpError(409, '只有同步失败的申请可以重试（当前 state=' + a.state + ', syncStatus=' + a.syncStatus + '）', 'NOT_FAILED');
  }
  // 重试前先跑一次预检，避免带着已修复/未修复的问题反复撞击资料库
  const pre = admissionlib.precheck(db, a);
  a.precheck = Object.assign({}, pre, {
    checkedBy: ctx.user.id, checkedByName: ctx.user.displayName, checkedAt: new Date().toISOString()
  });
  if (pre.verdict !== 'PASS') {
    save();
    appendAudit({ actorId: ctx.user.id, brandCode: a.brandCode, eventType: 'asset_admission.retry.rejected',
      objectType: 'asset_admission', objectId: a.id, outcome: 'denied', ip: ctx.ip,
      metadata: { reasons: pre.failureReasons } });
    return {
      ok: true, retried: false,
      admission: admissionlib.serializeAdmission(db, a, { withHistory: true }),
      note: '重试前预检仍未通过，未调用资料库：' + pre.failureReasons.join('；')
    };
  }

  // 失败恢复：状态机**本就允许** SYNC_FAILED → LIBRARY_SYNC_PENDING（见 ADMISSION_TRANSITIONS）。
  // 早期实现先把状态回退到 PRECHECK，而 PRECHECK 不在 LIBRARY_SYNC_PENDING 的前置集合里，
  // 导致重试必然 ILLEGAL_TRANSITION 409 —— 已修正为保持 SYNC_FAILED，由 runSync 依法迁移。
  const from = a.state;
  admissionlib.appendHistory(a, ctx.user, 'RETRY', {
    fromState: from, toState: from, note: '同步失败重试（复用同一幂等键 idempotencyKey）'
  });
  const r = await runSync(db, a, ctx.user, ctx.ip);
  return {
    ok: true, retried: true,
    admission: admissionlib.serializeAdmission(db, a, { withHistory: true }),
    receipt: r.receipt,
    note: r.synced ? '重试同步成功（复用同一幂等键，未产生第二个资产）。'
      : ('重试仍然失败：' + (r.receipt.error || ''))
  };
});

/* ==================== 可复用资产引用（W08-04 Approved Assets） ==================== */

get('/api/mos/library-asset-refs', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'library.asset.read', brandCode, { ip: ctx.ip, objectType: 'library_asset_ref' });

  const q = String(ctx.query.q || '').trim();
  let rows = (db.library_asset_refs || []).filter((r) => r.brandCode === brandCode);
  if (ctx.query.state) rows = rows.filter((r) => r.state === String(ctx.query.state).toUpperCase());
  if (q) {
    const kw = q.toLowerCase();
    rows = rows.filter((r) => String(r.libraryId || '').toLowerCase().indexOf(kw) !== -1
      || String(r.sourceRef || '').toLowerCase().indexOf(kw) !== -1);
  }
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  // 正式资料库检索（Mock 下恒空）—— 与本地沙盒条目**分列**，避免混淆
  const gw = await library.searchApproved(q, { brandCode });

  const items = rows.map((r) => {
    const a = (db.asset_admissions || []).find((x) => x.id === r.admissionId);
    const elig = admissionlib.reuseEligibility(a, r);
    return {
      id: r.id, brandCode: r.brandCode, admissionId: r.admissionId,
      libraryId: r.libraryId || null, version: r.version || null,
      permissionScope: (r.permissionScope || []).slice(),
      permissionValid: !!r.permissionValid,
      assetState: r.assetState, state: r.state,
      mock: !!r.mock,
      sourceKind: r.sourceKind || 'ASSET_ADMISSION',
      sourceRef: r.sourceRef || '',
      lastVerifiedAt: r.lastVerifiedAt || null,
      reuseEligibility: elig.eligible,
      reuseBlocking: elig.blocking,
      createdAt: r.createdAt
    };
  });

  return {
    ok: true, brandCode, query: q,
    integration: library.status(),
    /** 正式库检索结果：Mock 下为空数组（不伪造正式资产） */
    gateway: { mode: gw.mode, sandbox: !!gw.sandbox, total: (gw.items || []).length, items: gw.items || [], note: gw.note },
    items,
    counts: {
      total: items.length,
      mockOnly: items.filter((i) => i.mock).length,
      reusable: items.filter((i) => i.reuseEligibility).length
    },
    note: '沙盒条目（MOCK 前缀）**不具备复用资格**：真实资料库未接通前，reuseEligibility 恒为 false（00 §3 / 03 §2.4）。'
  };
});

module.exports = {
  serializeAdmission: admissionlib.serializeAdmission,
  bindingHash,
  markApproved,
  markRejected,
  runSync
};
