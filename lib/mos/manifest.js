'use strict';
/**
 * Marketing OS —— 审批 Manifest（02 §3 / 03 §2.2 Guard）。
 *
 * 为什么不能只哈希正文：
 *   「仅 hash 正文不足以覆盖替换图片风险」（02 §3 原文）。因此批准对象是一个**清单**：
 *
 *     content_version_id + 正文哈希 + 引用资产(含各自 sha256) + 渠道 + 语言 + 必要披露 + 风险等级
 *
 *   冻结时固化 `manifestHash`，审批时**重新计算并比对**；任何一项变化 → 409，
 *   旧批准不可复用（SEC-02）。
 *
 * 不纳入清单的字段（必须排除，否则「改个标题就会让批准失效」的伪安全会掩盖真风险）：
 *   updatedAt / updatedBy / rowVersion / 备注 / 负责人显示名等**非实质**字段。
 */
const { sha256, stableStringify } = require('./ids');

/**
 * 构建 manifest。
 * @param {object} db
 * @param {object} version content_versions 行
 * @returns {{ hash:string, payload:object }}
 */
function build(db, version) {
  const assets = (version.refAssetIds || []).slice().sort().map((id) => {
    const a = (db.working_assets || []).find((x) => x.id === id);
    if (!a) return { id, missing: true };
    return { id: a.id, sha256: a.sha256, mime: a.mime, origin: a.origin };
  });

  const payload = {
    contentVersionId: version.id,
    contentTaskId: version.contentTaskId,
    brandCode: version.brandCode,
    textHash: sha256(version.body || ''),
    assets,
    channelIds: (version.channelIds || []).slice().sort(),
    locale: version.locale || 'zh-CN',
    disclosures: (version.disclosures || []).slice().sort(),
    riskGrade: version.riskGrade || ''
  };

  return { hash: sha256(stableStringify(payload)), payload };
}

/** 单独计算正文哈希（冻结时同时落库，便于 UI 展示版本指纹） */
function textHash(version) {
  return sha256(version && version.body ? version.body : '');
}

/** 重新计算并与冻结值比对；返回 { ok, expected, actual } */
function verify(db, version) {
  const now = build(db, version);
  const expected = version.manifestHash || '';
  return { ok: !!expected && expected === now.hash, expected, actual: now.hash, payload: now.payload };
}

/** 供 UI 展示的短指纹 */
function shortHash(h, n) {
  const s = String(h || '');
  if (!s) return '—';
  const len = n || 12;
  return s.slice(0, len) + (s.length > len ? '…' : '');
}

module.exports = { build, textHash, verify, shortHash };
