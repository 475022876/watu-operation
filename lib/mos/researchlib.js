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

const REPORT_MODES = ['TRUSTED_DAILY', 'WEB_RESEARCH', 'DEEP_RESEARCH'];
/**
 * 报告状态（V0.1.3 Phase B 增量，**只增不改**）：
 *  - 既有：PENDING / RUNNING / COMPLETED / FAILED / BLOCKED
 *  - 新增：`AI_RESEARCH_COMPLETE`（真实检索 + 真实模型结构化分析完成）
 *          `RETRIEVAL_ONLY`（**降级**：只有检索与证据，未做模型分析——绝不可标为 AI_RESEARCH_COMPLETE）
 */
const REPORT_STATUS = ['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED', 'RETRIEVAL_ONLY', 'AI_RESEARCH_COMPLETE'];
/** 报告「完成度」严格取值：只有 AI_RESEARCH_COMPLETE 才算模型分析完成 */
const REPORT_COMPLETION = ['BLOCKED', 'RETRIEVAL_ONLY', 'AI_RESEARCH_COMPLETE'];
const FINDING_KINDS = ['FACT', 'INTERPRETATION', 'RECOMMENDATION'];
const FINDING_VERIFICATION = ['UNVERIFIED', 'NEEDS_VERIFICATION', 'VERIFIED'];
/** 证据可用性（真实抓取结果，不臆造） */
const EVIDENCE_AVAILABILITY = ['AVAILABLE', 'NOT_FOUND', 'HTTP_ERROR', 'BLOCKED', 'UNAVAILABLE', 'UNSUPPORTED_TYPE'];
/** 异步研究作业状态与阶段（执行包 02 §后台异步工作） */
const JOB_STATUS = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'BLOCKED', 'CANCELLED'];
const JOB_STAGES = ['QUEUED', 'SEARCHING', 'FETCHING', 'VERIFYING', 'ANALYZING', 'DONE', 'CANCELLED', 'FAILED', 'BLOCKED'];
/** 冲突检测是否真的执行过（不得假装已交叉验证） */
const CONFLICT_DETECTION = ['NOT_PERFORMED', 'MODEL_ASSISTED', 'HEURISTIC'];
/** 证据缺口状态（执行包 02 §搜索返回≠证据有效） */
const GAP_KINDS = ['NOT_FOUND', 'DATE_UNKNOWN', 'SINGLE_SOURCE', 'CONFLICT', 'TIME_SENSITIVE', 'STALE'];

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

/**
 * 归一化并**强约束**一条 finding（执行包 02 §LLM研究输出契约）：
 *  - `kind` 必须在 FINDING_KINDS 内，否则降级为 INTERPRETATION（不静默保留非法值）；
 *  - `kind==='FACT'` 但**没有有效证据** → 降级为 `INTERPRETATION` 并标 `needsVerification`，
 *    **绝不允许**无来源的 FACT 流出（更不允许据此声称 Verified）；
 *  - 未知 `evidenceIds` 一律剔除并记录 note（不造引用）。
 *
 * @param {object} raw 模型/人工给出的 finding
 * @param {Set<string>|string[]} validEvidenceIds 本报告真实存在的证据 id
 * @returns {{finding:object, notes:string[], downgraded:boolean}}
 */
function normalizeFinding(raw, validEvidenceIds) {
  const r = raw || {};
  const valid = validEvidenceIds instanceof Set ? validEvidenceIds : new Set(validEvidenceIds || []);
  const notes = [];
  let kind = String(r.kind || '').toUpperCase();
  if (FINDING_KINDS.indexOf(kind) === -1) {
    notes.push('kind 非法（' + String(r.kind) + '）→ 降级为 INTERPRETATION');
    kind = 'INTERPRETATION';
  }
  const wanted = Array.isArray(r.evidenceIds) ? r.evidenceIds.map(String) : [];
  const evidenceIds = wanted.filter((id) => valid.has(id));
  const dropped = wanted.filter((id) => !valid.has(id));
  if (dropped.length) notes.push('剔除不存在的证据引用 ' + dropped.length + ' 条（不得造引用）');

  let downgraded = false;
  if (kind === 'FACT' && evidenceIds.length === 0) {
    notes.push('FACT 无有效来源 → 降级为 INTERPRETATION 并要求核验（02 §FACT 必须挂来源）');
    kind = 'INTERPRETATION';
    downgraded = true;
  }
  const needsVerification = r.needsVerification !== undefined
    ? !!r.needsVerification
    : (kind !== 'FACT' || evidenceIds.length === 0);
  const verificationState = findingVerification(
    { verificationState: kind === 'FACT' && evidenceIds.length > 0 ? 'UNVERIFIED' : 'NEEDS_VERIFICATION' },
    evidenceIds.length
  );
  return {
    finding: {
      statement: String(r.statement || '').slice(0, 1000),
      kind,
      evidenceIds,
      confidenceRationale: String(r.confidenceRationale || '').slice(0, 600),
      needsVerification,
      verificationState
    },
    notes, downgraded
  };
}

/** 时间敏感表述（监管/牌照/费用/利率/储备等）→ 需加入重新核验提醒（02 §时间敏感监管事实） */
const TIME_SENSITIVE_RE = /(监管|牌照|许可|审批|生效|法规|罚款|处罚|制裁|利率|费率|手续费|年费|资本充足|储备|牌照申请|regulat|licen|approv|sanction|penalt|interest rate|fee|reserve|capital requirement|effective from)/i;
function timeSensitive(text) { return TIME_SENSITIVE_RE.test(String(text || '')); }

/**
 * 候选选题（执行包 02 §候选选题契约）→ 本域 TopicProposal 入参映射。
 * 映射是**显式**的（不隐式丢字段）：headlineEn→suggestedTitleEN、summaryZh→summaryZH、
 * brand→brandCode、optionalSecondaryCategories→secondaryCategories、rationale→whyRecommended、
 * audience→audiences、riskLevel→riskGrade、evidenceIds→sourceFindingIds、factCheckNeeds/reportVersion 新增保留。
 */
function proposalInputFromOpportunity(op, ctx) {
  const o = op || {};
  const c = ctx || {};
  return {
    brandCode: String(o.brand || c.brandCode || '').toUpperCase(),
    reportId: c.reportId || null,
    suggestedTitleEN: String(o.headlineEn || '').trim(),
    summaryZH: String(o.summaryZh || '').trim(),
    primaryCategory: String(o.primaryCategory || '').toUpperCase(),
    secondaryCategories: Array.isArray(o.optionalSecondaryCategories) ? o.optionalSecondaryCategories : [],
    angle: o.angle || null,
    audiences: Array.isArray(o.audience) ? o.audience : (o.audience ? [o.audience] : []),
    channels: Array.isArray(o.channels) ? o.channels.map((x) => String(x).toUpperCase()) : [],
    deliverables: Array.isArray(o.deliverables) ? o.deliverables : [],
    sourceFindingIds: Array.isArray(o.evidenceIds) ? o.evidenceIds.map(String) : [],
    riskGrade: String(o.riskLevel || 'G1').toUpperCase(),
    whyRecommended: o.rationale || null,
    factCheckNeeds: Array.isArray(o.factCheckNeeds) ? o.factCheckNeeds : [],
    reportVersion: c.reportVersion || null,
    needsVerification: !!o.needsVerification,
    announcementAuthorized: !!o.announcementAuthorized,
    officialEvidenceRef: o.officialEvidenceRef || null,
    source: 'AI'
  };
}

/** 作业序列化（进度/阶段/日志尾部；**不泄露密钥**——job 中本就不存密钥） */
function serializeJob(db, job) {
  const report = job.reportId ? (db.research_reports || []).find((r) => r.id === job.reportId) : null;
  return Object.assign({}, job, {
    report: report ? { id: report.id, code: report.code, status: report.status, completion: report.completion || null } : null,
    logTail: (job.log || []).slice(-12)
  });
}

module.exports = {
  REPORT_MODES, REPORT_STATUS, REPORT_COMPLETION, FINDING_KINDS, FINDING_VERIFICATION,
  EVIDENCE_AVAILABILITY, JOB_STATUS, JOB_STAGES, CONFLICT_DETECTION, GAP_KINDS,
  PROPOSAL_STATUS, PROPOSAL_TRANSITIONS, CATEGORIES, RISKS, CHANNELS,
  SPECIAL01_NOTES, checkCategory, findingVerification, evidenceDigest,
  serializeReport, serializeProposal, diffEdits,
  normalizeFinding, timeSensitive, proposalInputFromOpportunity, serializeJob
};
