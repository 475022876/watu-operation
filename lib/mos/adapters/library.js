'use strict';
/**
 * MockLibraryGateway —— 企业资料库入库/检索占位（06 §1/§2、03 §2.4）。
 *
 * ⚠ MOCK 声明（本文件是整个原型最重要的诚实性边界之一）：
 *   - 真实企业资料库 API **尚未审计接通**；
 *   - 因此本适配器返回的受理回执/资产 ID 一律带 `MOCK_` 前缀与 `mode:'mock'`；
 *   - **绝不允许**将 Mock 结果标记为正式 `APPROVED` / `AVAILABLE`（00 §3 严格禁止）；
 *   - `verifyFinalAuthorization` 在 Mock 下只能返回 `MOCK_APPROVED`，不能生成正式可复用标记。
 *
 * 契约（06 §2）：
 *   searchApproved / resolveAsset / submitAdmission / getAdmissionStatus / verifyFinalAuthorization
 * 幂等（03 §5）：同 idempotencyKey 重复提交必须返回**同一**回执，绝不产生双资产。
 */

/** 进程内幂等表：idempotencyKey -> receipt（真实实现应由资料库侧持久化） */
const receipts = new Map();

function status() {
  return {
    gateway: 'library',
    mode: 'mock',
    sandbox: true,
    message: '企业资料库真实接口尚未审计接通（06 §1）；入库回执为 MOCK，不可用于生产。'
  };
}

async function searchApproved(query, scope) {
  // Mock 下不返回任何"正式批准资产" —— 避免把模拟结果冒充企业正式资产（00 §3）
  return {
    mode: 'mock',
    sandbox: true,
    query: query || '',
    brandCode: scope && scope.brandCode ? scope.brandCode : '',
    items: [],
    note: 'MOCK：不返回真实已批准资产；真实库接通前检索结果为空。'
  };
}

async function resolveAsset(id) {
  return { mode: 'mock', sandbox: true, error: 'MOCK 资料库未接通，无法解析资产', id };
}

/**
 * 提交入库申请（幂等）。
 * @returns {Promise<{mode:'mock', sandbox:boolean, receiptId:string, assetId:string|null, state:string}>}
 */
async function submitAdmission(request, idempotencyKey) {
  const key = String(idempotencyKey || '');
  if (!key) throw new Error('submitAdmission 需要 idempotencyKey（03 §5）');
  if (receipts.has(key)) return receipts.get(key); // 幂等：重复提交返回同一回执

  const receipt = {
    mode: 'mock',
    sandbox: true,
    receiptId: 'MOCK_RCPT_' + key.slice(0, 12),
    assetId: null,          // MOCK 不生成正式资产 ID
    libraryVersion: null,
    state: 'MOCK_SYNC_COMPLETED',
    permissions: [],
    note: 'MOCK 同步成功仅为流程演示；真实入库需 LibraryGateway 持久化回执方可标记 AVAILABLE。',
    at: new Date().toISOString()
  };
  receipts.set(key, receipt);
  return receipt;
}

async function getAdmissionStatus(receiptId) {
  for (const r of receipts.values()) {
    if (r.receiptId === receiptId) return r;
  }
  return { mode: 'mock', sandbox: true, receiptId, state: 'NOT_FOUND', note: 'MOCK 资料库无该回执' };
}

/**
 * 最终入库授权校验。Mock 下**只能**返回 MOCK_APPROVED。
 * 真实环境由资料库/可信 IAM 验证签名后返回 APPROVED。
 */
async function verifyFinalAuthorization(principal, approvalId) {
  return {
    mode: 'mock',
    sandbox: true,
    result: 'MOCK_APPROVED',
    approvalId: approvalId || '',
    principalId: principal ? principal.id : '',
    note: 'MOCK_APPROVED ≠ APPROVED：不得据此生成正式可复用标记（03 §2.4）。'
  };
}

module.exports = { status, searchApproved, resolveAsset, submitAdmission, getAdmissionStatus, verifyFinalAuthorization };
