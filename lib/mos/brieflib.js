'use strict';
/**
 * S04 Marketing Brief 领域逻辑（A-02）—— 结构化 Brief 的归一化与**产品宣称核验**。
 *
 * 设计口径（与 reuseEligibility 一致）：核验状态由**服务端计算**，客户端不可写。
 *   - 每条产品宣称必须关联「已核准知识 / 证据 / 资料库条目」；
 *   - MOCK 知识库、未接通资料库、未核验证据一律判定 UNVERIFIED；
 *   - 只要存在未核验宣称，`readyForOfficialUse=false` → 不得用于正式输出；
 *   - 绝不把 Mock 结果当作正式核准（02 §4 / 04 §2 边界）。
 *
 * 该模块独立成 lib（而非放在 route 文件）以便：单元测试直接调用、多入口复用同一份规则。
 */
const { MARKETING_BRIEF_TEMPLATES } = require('./dict');
const admissionlib = require('./admissionlib');

const CLAIM_SOURCE_KINDS = ['KNOWLEDGE', 'EVIDENCE', 'LIBRARY'];

function asStringArray(v, max) {
  const arr = Array.isArray(v) ? v : (typeof v === 'string' ? String(v).split('\n') : []);
  return arr.map((s) => String(s).trim()).filter(Boolean).slice(0, max || 20);
}

/** 单条引用的核验判定（claims 与 productRefs 共用） */
function verifyRef(db, kind, id) {
  if (CLAIM_SOURCE_KINDS.indexOf(kind) === -1) {
    return { verification: 'UNVERIFIED', reason: '引用类型非法（须为 knowledge / evidence / library）' };
  }
  if (kind === 'EVIDENCE') {
    const e = db.evidence_references.find((x) => x.id === id);
    if (e && e.verificationState === 'VERIFIED') return { verification: 'VERIFIED', reason: '' };
    return { verification: 'UNVERIFIED', reason: e ? ('引用证据未通过核验（' + e.verificationState + '）') : '引用证据不存在' };
  }
  if (kind === 'LIBRARY') {
    const r = (db.library_asset_refs || []).find((x) => x.id === id);
    const adm = r ? (db.asset_admissions || []).find((x) => x.id === r.admissionId) : null;
    const elig = r ? admissionlib.reuseEligibility(adm, r) : { eligible: false, blocking: ['资料库条目不存在'] };
    if (r && elig.eligible) return { verification: 'VERIFIED', reason: '' };
    return { verification: 'UNVERIFIED', reason: '资料库条目不可复用：' + ((elig.blocking || []).join('；') || 'MOCK 下恒为不可用') };
  }
  // KNOWLEDGE：企业知识库为 MOCK，无法确认核准来源
  return { verification: 'UNVERIFIED', reason: '知识库为 MOCK（企业知识未接通），无法确认核准来源' };
}

function evaluateClaims(db, claims) {
  const out = [];
  for (const c of (claims || [])) {
    const text = String((c && c.text) || '').trim().slice(0, 1000);
    if (!text) continue;
    const kind = String((c && c.sourceKind) || '').toUpperCase();
    const ref = String((c && c.sourceRef) || '').trim();
    let v;
    if (!ref) v = { verification: 'UNVERIFIED', reason: '未关联已核准知识/来源（须指向 knowledge / evidence / library 条目）' };
    else v = verifyRef(db, kind, ref);
    out.push({ text, sourceKind: kind || null, sourceRef: ref || null, verification: v.verification, reason: v.reason });
  }
  return out;
}

function evaluateRefs(db, refs) {
  const out = [];
  for (const r of (refs || [])) {
    const kind = String((r && r.sourceKind) || '').toUpperCase();
    const refId = String((r && r.refId) || '').trim();
    if (!refId) continue;
    const v = verifyRef(db, kind, refId);
    out.push({ refId, sourceKind: kind, label: String((r && r.label) || '').slice(0, 200), verification: v.verification, reason: v.reason });
  }
  return out;
}

function defaultMarketingBrief(brandCode) {
  const t = MARKETING_BRIEF_TEMPLATES[brandCode] || null;
  return {
    templateCode: t ? t.templateCode : '',
    objectives: t ? t.objectives.slice() : [],
    audience: t ? t.audience : '',
    coreMessage: '',
    productClaims: [],
    productRefs: [],
    regionComplianceNote: t ? t.regionComplianceNote : '',
    executors: [], startAt: null, endAt: null,
    claimSummary: { total: 0, verified: 0, unverified: 0 },
    refSummary: { total: 0, verified: 0, unverified: 0 },
    readyForOfficialUse: true,
    isTemplate: true
  };
}

function normalizeMarketingBrief(db, input, brandCode) {
  const b = (input && typeof input === 'object') ? input : {};
  const base = defaultMarketingBrief(brandCode);
  const claims = evaluateClaims(db, Array.isArray(b.productClaims) ? b.productClaims.slice(0, 30) : []);
  const unverified = claims.filter((c) => c.verification !== 'VERIFIED').length;
  const refs = evaluateRefs(db, Array.isArray(b.productRefs) ? b.productRefs.slice(0, 30) : []);
  const refsUnverified = refs.filter((r) => r.verification !== 'VERIFIED').length;
  return {
    templateCode: b.templateCode !== undefined ? String(b.templateCode).slice(0, 60) : base.templateCode,
    objectives: b.objectives !== undefined ? asStringArray(b.objectives).map((s) => s.slice(0, 500)) : base.objectives,
    audience: b.audience !== undefined ? String(b.audience).slice(0, 4000) : base.audience,
    coreMessage: b.coreMessage !== undefined ? String(b.coreMessage).slice(0, 4000) : base.coreMessage,
    productClaims: claims,
    productRefs: refs,
    regionComplianceNote: b.regionComplianceNote !== undefined ? String(b.regionComplianceNote).slice(0, 4000) : base.regionComplianceNote,
    executors: b.executors !== undefined ? asStringArray(b.executors).map((s) => s.slice(0, 200)) : base.executors,
    startAt: b.startAt !== undefined ? (b.startAt ? String(b.startAt).slice(0, 10) : null) : base.startAt,
    endAt: b.endAt !== undefined ? (b.endAt ? String(b.endAt).slice(0, 10) : null) : base.endAt,
    claimSummary: { total: claims.length, verified: claims.length - unverified, unverified },
    refSummary: { total: refs.length, verified: refs.length - refsUnverified, unverified: refsUnverified },
    /** 服务端计算：存在未核验宣称 → 不得用于正式输出（Mock/未接通来源一律 UNVERIFIED） */
    readyForOfficialUse: unverified === 0,
    isTemplate: false
  };
}

module.exports = {
  CLAIM_SOURCE_KINDS,
  asStringArray,
  verifyRef,
  evaluateClaims,
  evaluateRefs,
  defaultMarketingBrief,
  normalizeMarketingBrief
};
