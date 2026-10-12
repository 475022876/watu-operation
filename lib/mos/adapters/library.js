'use strict';
/**
 * MockLibraryGateway —— 企业资料库入库/检索占位（06 §1/§2、03 §2.4）。
 *
 * ⚠ MOCK 声明（本文件是整个原型最重要的诚实性边界之一）：
 *   - 真实企业资料库 API **尚未审计接通**；
 *   - 因此本适配器返回的受理回执/资产 ID 一律带 `MOCK_` 前缀与 `mode:'mock'`；
 *   - **绝不允许**将 Mock 结果标记为正式 `APPROVED` / `AVAILABLE`（00 §3 严格禁止）；
 *   - `verifyFinalAuthorization` 在 Mock 下只能返回 `MOCK_APPROVED`，不能生成正式可复用标记；
 *   - `searchApproved` 在 Mock 下**恒为空**，不伪造任何"正式已批准资产"。
 *
 * 契约（06 §2）：
 *   searchApproved / resolveAsset / submitAdmission / getAdmissionStatus / verifyFinalAuthorization
 *
 * 幂等（03 §5）：同 idempotencyKey 重复提交必须返回**同一**回执，绝不产生双资产；
 * 同一份内容（sha256）走不同幂等键提交时，返回**既有**回执并标 `deduplicated`。
 * 注意：本文件的回执表在**进程内**；跨重启的幂等由 MOS 侧持久化的 receipt 保证
 *       （见 `lib/mos/admissionlib.js`，A-20）。
 */

/** 进程内幂等表：idempotencyKey -> receipt（真实实现应由资料库侧持久化） */
const receipts = new Map();
/** 内容指纹 -> receipt（防「同一资产重复入库」产生双资产，03 §6） */
const byDigest = new Map();
/** 已注入过瞬时故障的幂等键（故障注入仅用于验证失败恢复，见下方 faultMode） */
const faultedKeys = new Set();

const MODE = 'mock';

/**
 * 故障注入开关（**仅 Mock 网关**，默认关闭）：
 *   `MOS_LIBRARY_MOCK_FAULT=once-per-key` → 每个幂等键的**首次**提交返回 SYNC_FAILED
 *   （`MOCK_TRANSIENT_TIMEOUT`），后续同键提交正常成功。
 *
 * 用途：03 §5 明确要求验证「同步失败 → 保留原 idempotency_key → 人工/作业恢复 → 不产生双资产」，
 * 而真实资料库未接通时无法自然制造瞬时超时。该开关只在 Mock 下生效，且**瞬时故障不入回执缓存**，
 * 因此重试语义与真实环境一致。生产（real）模式下该值被忽略。
 */
function faultMode() {
  return String(process.env.MOS_LIBRARY_MOCK_FAULT || 'none').trim().toLowerCase();
}

function status() {
  return {
    gateway: 'library',
    mode: MODE,
    sandbox: true,
    message: '企业资料库真实接口尚未审计接通（06 §1）；入库回执为 MOCK，不可用于生产。'
  };
}

async function searchApproved(query, scope) {
  // Mock 下不返回任何"正式批准资产" —— 避免把模拟结果冒充企业正式资产（00 §3）
  return {
    mode: MODE,
    sandbox: true,
    query: query || '',
    brandCode: scope && scope.brandCode ? scope.brandCode : '',
    items: [],
    note: 'MOCK：不返回真实已批准资产；真实库接通前检索结果为空。'
  };
}

async function resolveAsset(id) {
  return { mode: MODE, sandbox: true, error: 'MOCK 资料库未接通，无法解析资产', id };
}

function makeReceiptId(key) {
  return 'MOCK_RCPT_' + String(key).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
}

function makeAssetId(key) {
  return 'MOCK_ASSET_' + String(key).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);
}

/**
 * 提交入库申请（幂等）。
 *
 * 失败条件（**真实存在的合规前置**，不是测试后门）：
 *   - 缺少 `categoryCode`（A01–A08 必填分类，10 §1）
 *   - `license` 为 `UNVERIFIED`：版权/来源未核验，资料库不得接收（06 §5）
 *   - 缺少 `assetSha256`：无法做去重与版本绑定（02 §2）
 *
 * @param {object} request { brandCode, admissionId, assetSha256, categoryCode, license, title, sourceRef }
 * @param {string} idempotencyKey
 * @returns {Promise<object>} receipt
 */
async function submitAdmission(request, idempotencyKey) {
  const key = String(idempotencyKey || '');
  if (!key) throw new Error('submitAdmission 需要 idempotencyKey（03 §5）');
  if (receipts.has(key)) return receipts.get(key); // 幂等：同键重复提交返回同一回执

  const req = request || {};
  const digest = String(req.assetSha256 || '').trim();

  // 故障注入（仅 Mock，默认关闭）：模拟资料库超时 —— **不缓存**，重试同键即可成功
  if (faultMode() === 'once-per-key' && !faultedKeys.has(key)) {
    faultedKeys.add(key);
    return {
      mode: MODE, sandbox: true,
      receiptId: makeReceiptId(key),
      idempotencyKey: key,
      assetId: null, libraryVersion: null, permissions: [],
      permissionValid: false, assetState: 'MOCK_SANDBOX',
      state: 'SYNC_FAILED',
      errorCode: 'MOCK_TRANSIENT_TIMEOUT',
      error: 'MOCK 注入的瞬时超时（用于验证失败恢复；同幂等键重试即成功）',
      transient: true,
      at: new Date().toISOString()
    };
  }

  const fail = (errorCode, error) => {
    const r = {
      mode: MODE, sandbox: true,
      receiptId: makeReceiptId(key),
      idempotencyKey: key,
      assetId: null,
      libraryVersion: null,
      permissions: [],
      permissionValid: false,
      assetState: 'MOCK_SANDBOX',
      state: 'SYNC_FAILED',
      errorCode,
      error,
      at: new Date().toISOString()
    };
    receipts.set(key, r);
    return r;
  };

  if (!digest) return fail('MISSING_DIGEST', '缺少内容指纹（assetSha256），无法登记入库');
  if (!String(req.categoryCode || '').trim()) return fail('MISSING_CATEGORY', '缺少 A01–A08 资产分类，资料库拒绝受理');
  if (String(req.license || '').toUpperCase() === 'UNVERIFIED') {
    return fail('LICENSE_UNVERIFIED',
      '版权/来源许可未核验（UNVERIFIED）：资料库不得接收该资产；请先补齐许可信息后重试');
  }

  // 去重：同一份内容已入库 → 返回既有回执，不再产生第二个资产（03 §6）
  const existing = byDigest.get(digest);
  if (existing) {
    const dup = Object.assign({}, existing, {
      deduplicated: true,
      requestedByKey: key,
      note: 'MOCK：该内容指纹已受理过，返回既有回执（重复同步不产生双资产）。'
    });
    receipts.set(key, dup);
    return dup;
  }

  const receipt = {
    mode: MODE,
    sandbox: true,
    receiptId: makeReceiptId(key),
    idempotencyKey: key,
    /** MOCK 资产 ID：带 MOCK_ 前缀，**不是**正式资料库 ID（08 E2E-05） */
    assetId: makeAssetId(key),
    libraryVersion: 'MOCK-v1',
    permissions: ['MOCK_READ'],
    /** 关键：Mock 权限**不可视为有效**，因此复用资格计算判定恒为 false */
    permissionValid: false,
    assetState: 'MOCK_SANDBOX',
    state: 'SYNC_COMPLETED',
    errorCode: '',
    error: '',
    note: 'MOCK 同步成功仅为流程演示；真实入库需 LibraryGateway 持久化回执并核验权限后方可标记 AVAILABLE。',
    at: new Date().toISOString()
  };
  receipts.set(key, receipt);
  byDigest.set(digest, Object.assign({}, receipt, { idempotencyKey: key }));
  return receipt;
}

async function getAdmissionStatus(receiptId) {
  for (const r of receipts.values()) {
    if (r.receiptId === receiptId) return r;
  }
  return { mode: MODE, sandbox: true, receiptId, state: 'NOT_FOUND', note: 'MOCK 资料库无该回执' };
}

/**
 * 最终入库授权校验。Mock 下**只能**返回 MOCK_APPROVED。
 * 真实环境由资料库/可信 IAM 验证签名后返回 APPROVED。
 */
async function verifyFinalAuthorization(principal, approvalId) {
  return {
    mode: MODE,
    sandbox: true,
    result: 'MOCK_APPROVED',
    /** 是否可作为"正式批准"使用 —— Mock 恒 false（03 §2.4） */
    formalApproved: false,
    approvalId: approvalId || '',
    principalId: principal ? principal.id : '',
    note: 'MOCK_APPROVED ≠ APPROVED：不得据此生成正式可复用标记（03 §2.4）。'
  };
}

/** 仅测试/维护：清空进程内回执表 */
function _resetForTest() {
  receipts.clear();
  byDigest.clear();
  faultedKeys.clear();
}

module.exports = {
  status, searchApproved, resolveAsset, submitAdmission, getAdmissionStatus, verifyFinalAuthorization,
  faultMode, _resetForTest
};
