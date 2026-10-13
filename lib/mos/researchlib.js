'use strict';
/**
 * V0.1.2 Phase B —— AI 情报研究域（执行包 02 / 03）。
 *
 * 模型边界（05 §数据迁移兼容：先证明现有模型不能承载再新增）：
 *  - 现有 `source_items`（真实采集条目）与 `evidence_references`（Topic 证据）**不承载**
 *    「研究报告 + 逐条证据绑定 + 候选选题」这一前置阶段 → 新增 4 个轻量集合；
 *  - 候选选题（TopicProposal）获批后才由 Phase C 建立正式 `master_topics`——
 *    **绝不建第二套平行正式 Topic**；一个事件不重复建多条正式 Topic（相似度提示，不强行合并）。
 *
 * 诚实性：
 *  - Finding 未经核验**不得**声明 VERIFIED；无证据的关键事实必须 NEEDS_VERIFICATION；
 *  - SPECIAL-01 栏目适配按正式 V1.1 手册既有判定，无规定处保留「待确认」，不自创规范。
 */
const { sha256 } = require('./ids');

const REPORT_MODES = ['TRUSTED_DAILY', 'WEB_RESEARCH'];
const REPORT_STATUS = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED'];
const FINDING_KINDS = ['FACT', 'INTERPRETATION', 'RECOMMENDATION'];
const FINDING_VERIFICATION = ['UNVERIFIED', 'NEEDS_VERIFICATION', 'VERIFIED'];

/** Proposal 状态机（03 §状态机；修订重提保留版本与原批准信息） */
const PROPOSAL_STATUS = ['AI_RECOMMENDED', 'PENDING_EDITORIAL_REVIEW', 'APPROVED', 'REVISION_REQUESTED', 'ON_HOLD', 'REJECTED'];
const PROPOSAL_TRANSITIONS = {
  AI_RECOMMENDED: ['PENDING_EDITORIAL_REVIEW'],
  PENDING_EDITORIAL_REVIEW: ['APPROVED', 'REVISION_REQUESTED', 'ON_HOLD', 'REJECTED'],
  REVISION_REQUESTED: ['PENDING_EDITORIAL_REVIEW'],
  ON_HOLD: ['PENDING_EDITORIAL_REVIEW'],
  APPROVED: [],
  REJECTED: []
};

const CATEGORIES = ['C01', 'C02', 'C03', 'C04', 'C05', 'C06'];
const RISKS = ['G0', 'G1', 'G2', 'G3'];
const CHANNELS = ['LINKEDIN', 'X', 'YOUTUBE', 'FACEBOOK', 'NEWSLETTER'];

/** SPECIAL-01 栏目约束（02 §SPECIAL-01规则约束；正文说明供审核人参考，判定不替代人工） */
const SPECIAL01_NOTES = {
  C01: 'C01 Inside VFIB：不得由外部新闻虚构 VFIB 内部动态——引用须来自企业正式已核实依据。',
  C02: 'C02 Banking Explained：通俗且准确的金融解释；概念不得简化到失真。',
  C03: 'C03 Banking in Action：实际功能/界面必须有企业正式已核实依据；未开放功能必须标注。',
  C04: 'C04 Institutional Solutions：不得把目标能力写成已提供服务；资格条件不得省略。',
  C05: 'C05 Digital Finance Insights：研究与行业洞察；区分事实与观点。',
  C06: 'C06 VFIB Newsroom：必须经正式公告授权方可发布。'
};

/** 栏目适配校验：返回 {ok, notes[], needsVerification} */
function checkCategory(primaryCategory, opts) {
  const notes = [];
  if (CATEGORIES.indexOf(primaryCategory) === -1) {
    return { ok: false, notes: ['主栏目必须是 C01—C06（收到：' + String(primaryCategory || '(空)') + '）'], needsVerification: true };
  }
  let needsVerification = false;
  const note = SPECIAL01_NOTES[primaryCategory];
  if (note) notes.push(note);
  if (primaryCategory === 'C06' && !(opts && opts.announcementAuthorized)) {
    needsVerification = true;
    notes.push('C06 需正式公告授权：当前未提供授权依据 → 保持待核验，不得作为可发布候选。');
  }
  if ((primaryCategory === 'C01' || primaryCategory === 'C03') && !(opts && opts.officialEvidenceRef)) {
    needsVerification = true;
    notes.push('该栏目要求企业正式已核实依据：当前未提供 evidenceRef → 保持待核验。');
  }
  return { ok: true, notes, needsVerification };
}

/** 事实→证据绑定核验：关键事实无证据 → NEEDS_VERIFICATION（不得伪造 VERIFIED） */
function findingVerification(f, evidenceCount) {
  if (f.verificationState === 'VERIFIED' && (!evidenceCount || evidenceCount < 1)) {
    return 'NEEDS_VERIFICATION'; // 无证据不得 VERIFIED（fail-closed）
  }
  if (f.verificationState === 'VERIFIED') return 'VERIFIED';
  if (!evidenceCount || evidenceCount < 1) return 'NEEDS_VERIFICATION';
  return f.verificationState || 'UNVERIFIED';
}

/** 来源证据内容指纹（可用性/许可变化时可比对） */
function evidenceDigest(ev) {
  return sha256([ev.url, ev.title, ev.publishedAt || '', ev.quote || ''].join('\n'));
}

function serializeReport(db, r) {
  const findings = (db.research_findings || []).filter((f) => f.reportId === r.id);
  return Object.assign({}, r, {
    findings: findings.map((f) => Object.assign({}, f, {
      evidence: (db.source_evidence || []).filter((e) => (f.evidenceIds || []).indexOf(e.id) !== -1)
        .map((e) => Object.assign({}, e, { digest: e.digest || evidenceDigest(e) }))
    })),
    findingCount: findings.length,
    proposalCount: (db.topic_proposals || []).filter((p) => p.reportId === r.id).length
  });
}

function serializeProposal(db, p, principal) {
  const findings = (db.research_findings || []).filter((f) => (p.sourceFindingIds || []).indexOf(f.id) !== -1);
  const report = p.reportId ? (db.research_reports || []).find((r) => r.id === p.reportId) : null;
  return Object.assign({}, p, {
    special01: checkCategory(p.primaryCategory, { announcementAuthorized: p.announcementAuthorized, officialEvidenceRef: p.officialEvidenceRef }),
    report: report ? { id: report.id, code: report.code, mode: report.mode, status: report.status, query: report.query } : null,
    findings: findings.map((f) => ({
      id: f.id, statement: f.statement, kind: f.kind, verificationState: f.verificationState,
      evidenceIds: f.evidenceIds, asOf: f.asOf || null,
      evidence: (db.source_evidence || []).filter((e) => (f.evidenceIds || []).indexOf(e.id) !== -1)
    })),
    canDecide: !!(principal && principal.permsByBrand
      && (function () {
        const set = principal.permsByBrand['*'];
        const scoped = principal.permsByBrand[p.brandCode];
        return ((set && set.has('editorial.approve')) || (scoped && scoped.has('editorial.approve')));
      })())
  });
}

/** 人工改动 diff（03 §一屏审核：后端记录原 AI 建议与人工改动 diff） */
function diffEdits(original, edits) {
  const out = [];
  for (const k of ['suggestedTitleEN', 'angle', 'primaryCategory', 'channels', 'deliverables', 'riskGrade']) {
    if (edits && edits[k] !== undefined && JSON.stringify(edits[k]) !== JSON.stringify(original[k])) {
      out.push({ field: k, from: original[k], to: edits[k] });
    }
  }
  return out;
}

module.exports = {
  REPORT_MODES, REPORT_STATUS, FINDING_KINDS, FINDING_VERIFICATION,
  PROPOSAL_STATUS, PROPOSAL_TRANSITIONS, CATEGORIES, RISKS, CHANNELS,
  SPECIAL01_NOTES, checkCategory, findingVerification, evidenceDigest,
  serializeReport, serializeProposal, diffEdits
};
