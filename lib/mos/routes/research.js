'use strict';
/**
 * V0.1.2 Phase B —— AI 情报研究与候选选题路由（执行包 02 / 03）。
 *
 * 双来源引擎：
 *   A. TRUSTED_DAILY：从**真实采集**的 source_items 汇编（ingest 是 real 的 → 本路径可 REAL）；
 *   B. WEB_RESEARCH：websearch 适配层当前 BLOCKED（无凭据）→ 报告记 BLOCKED，**零伪造发现**。
 *
 * 安全（02 §风险与失败条件）：
 *   - 全部端点 rbac 品牌范围 + 权限校验（默认拒绝 + 越权审计）；
 *   - 外部内容一律不可信：标题/摘要仅作数据存储与展示转义（前端 esc），不进入任何指令通道；
 *   - 无证据的关键事实强制 NEEDS_VERIFICATION；C06/C01/C03 缺正式依据 → needsVerification=true。
 */
const { get, post } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid, sha256 } = require('../ids');
const helpers = require('./helpers');
const websearch = require('../adapters/websearch');
const researchlib = require('../researchlib');
const engine = require('../research-engine');

function nowIso() { return new Date().toISOString(); }

function assertBrand(ctx, brandCode) {
  if (!brandCode) throw httpError(400, '缺少品牌', 'MISSING_BRAND');
  rbac.assertBrand(ctx.principal, brandCode);
}

function researchCode(db) {
  const n = (db.seq.research = (db.seq.research || 0) + 1);
  return 'RS-' + String(n).padStart(4, '0');
}

function proposalCode(db) {
  const n = (db.seq.proposal = (db.seq.proposal || 0) + 1);
  return 'TP-' + String(n).padStart(4, '0');
}

/* ==================== A. 每日情报汇编（TRUSTED_DAILY，真实来源） ==================== */

get('/api/mos/research/provider-status', async (ctx) => {
  return { ok: true, webSearch: websearch.providerStatus() };
});

/** 供应商就绪视图（06 §真实Provider判定：REAL / CONFIGURED_NOT_TESTED / NOT_CONFIGURED /
 *  NOT_IMPLEMENTED / BLOCKED；升级过程不得把 BLOCKED 隐去）。 */
get('/api/mos/research/providers', async (ctx) => {
  const db = getDb();
  return {
    ok: true,
    providers: engine.providersView(db),
    budget: engine.budgetState(db, (ctx.principal.brandCodes || [])[0] || 'VFIB')
  };
});

/** 从真实采集条目汇编当日报告（有则汇编、无则如实空报告；绝不编造） */
post('/api/mos/research/daily', async (ctx) => {
  const body = ctx.body || {};
  assertBrand(ctx, body.brandCode);
  rbac.assertCan(ctx.principal, 'research.create', body.brandCode);

  const db = getDb();
  const days = Math.min(Math.max(Number(body.days) || 1, 1), 14);
  const since = Date.now() - days * 24 * 3600 * 1000;
  const items = (db.source_items || []).filter((it) => it.brandCode === body.brandCode
    && Date.parse(it.fetchedAt || it.createdAt || '') >= since);
  // 证据的「来源机构名」取自来源登记表（source_items 本身不冗余机构名；
  // 回退顺序：登记名 → 条目自带名 → 来源等级）
  const srcNameById = {};
  for (const s of (db.source_registry || [])) srcNameById[s.id] = s.name || '';

  const report = {
    id: uid('rsr'), code: researchCode(db), brandScope: [body.brandCode],
    requesterId: ctx.user.id, mode: 'TRUSTED_DAILY',
    query: body.query || '可信来源每日汇编', timeWindow: { days },
    status: 'COMPLETED', provider: 'source_ingest(real)', model: null, costUsd: 0,
    blockedReason: null, startedAt: nowIso(), completedAt: nowIso(),
    findingIds: [], topicProposalIds: [], auditRef: null,
    demo: false, createdAt: nowIso(), rowVersion: 1
  };
  db.research_reports.push(report);

  for (const it of items) {
    // SourceEvidence：来自真实采集条目（URL/机构/发布日/抓取日/内容哈希）
    const ev = {
      id: uid('sev'), url: it.canonicalUrl,
      sourceName: srcNameById[it.sourceId] || it.sourceName || it.tier || '',
      title: it.title || '', publishedAt: it.publishedAt || null,
      retrievedAt: it.fetchedAt || nowIso(), quote: String(it.summary || '').slice(0, 400),
      accessState: it.licenseState === 'FULLTEXT_OK' ? 'PUBLIC' : 'UNKNOWN',
      contentHash: it.contentDigest || sha256(String(it.canonicalUrl) + '|' + String(it.title || '')),
      availability: 'AVAILABLE', sourceId: it.sourceId, createdAt: nowIso()
    };
    db.source_evidence.push(ev);
    const f = {
      id: uid('fnd'), reportId: report.id, statement: String(it.summary || it.title || '').slice(0, 500),
      kind: 'FACT', evidenceIds: [ev.id],
      verificationState: researchlib.findingVerification({ verificationState: 'UNVERIFIED' }, 1),
      asOf: it.publishedAt || null, conflictNote: null, sourceItemId: it.id, createdAt: nowIso()
    };
    db.research_findings.push(f);
    report.findingIds.push(f.id);
  }

  appendAudit({
    actorId: ctx.user.id, brandCode: body.brandCode, eventType: 'research.daily_completed',
    objectType: 'research_report', objectId: report.id,
    metadata: { mode: 'TRUSTED_DAILY', findings: report.findingIds.length, days }
  });
  save();
  return { ok: true, report: researchlib.serializeReport(db, report) };
});

/* ==================== B. Web Research（真实检索管线；未配置 → BLOCKED，零伪造） ==================== */

/**
 * 同步入口（保留既有契约：一次请求内完成并返回报告）。
 * 未配置检索 Provider → 报告 `BLOCKED`（零出站、零伪造发现），reason 含 NOT_CONFIGURED。
 */
post('/api/mos/research/web', async (ctx) => {
  const body = ctx.body || {};
  assertBrand(ctx, body.brandCode);
  rbac.assertCan(ctx.principal, 'research.create', body.brandCode);
  const query = String(body.query || '').trim();
  if (!query) throw httpError(400, '缺少研究主题', 'MISSING_QUERY');

  const created = engine.createJob(ctx, Object.assign({}, body, {
    query, reportMode: 'WEB_RESEARCH', blockedEvent: 'research.web_blocked'
  }));
  await engine.runJob(created.job.id);
  const db = getDb();
  const report = db.research_reports.find((r) => r.id === created.job.reportId);
  const job = db.research_jobs.find((j) => j.id === created.job.id);
  return { ok: true, report: researchlib.serializeReport(db, report), job: researchlib.serializeJob(db, job) };
});

/* ---------- 后台异步研究作业（执行包 02 §后台异步工作） ---------- */

/** 启动研究：**立即返回 jobId**；页面轮询进度、可取消、幂等重试、受预算门禁约束。 */
post('/api/mos/research/jobs', async (ctx) => {
  const body = ctx.body || {};
  assertBrand(ctx, body.brandCode);
  rbac.assertCan(ctx.principal, 'research.create', body.brandCode);
  const created = engine.createJob(ctx, body);
  if (!created.deduplicated) engine.startJobAsync(created.job.id);
  return { ok: true, job: created.job, report: created.report, deduplicated: created.deduplicated };
});

get('/api/mos/research/jobs', async (ctx) => {
  const brandCode = ctx.query.brand ? String(ctx.query.brand).toUpperCase() : null;
  if (brandCode) rbac.assertBrand(ctx.principal, brandCode);
  const db = getDb();
  const scoped = brandCode ? [brandCode] : ctx.principal.brandCodes;
  const status = ctx.query.status ? String(ctx.query.status).toUpperCase() : null;
  let items = (db.research_jobs || []).filter((j) => scoped.indexOf(j.brandCode) !== -1);
  if (status) items = items.filter((j) => j.status === status);
  items = items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 100).map((j) => researchlib.serializeJob(db, j));
  return { ok: true, items };
});

get('/api/mos/research/jobs/:id', async (ctx) => {
  const db = getDb();
  const j = (db.research_jobs || []).find((x) => x.id === ctx.params.id);
  if (!j) throw httpError(404, '研究作业不存在', 'JOB_NOT_FOUND');
  rbac.assertBrand(ctx.principal, j.brandCode);
  return { ok: true, job: researchlib.serializeJob(db, j) };
});

post('/api/mos/research/jobs/:id/cancel', async (ctx) => {
  const db = getDb();
  const j = (db.research_jobs || []).find((x) => x.id === ctx.params.id);
  if (!j) throw httpError(404, '研究作业不存在', 'JOB_NOT_FOUND');
  rbac.assertBrand(ctx.principal, j.brandCode);
  rbac.assertCan(ctx.principal, 'research.create', j.brandCode);
  engine.cancelJob(db, j, ctx.user.id);
  return { ok: true, job: researchlib.serializeJob(db, j) };
});

post('/api/mos/research/jobs/:id/retry', async (ctx) => {
  const db = getDb();
  const j = (db.research_jobs || []).find((x) => x.id === ctx.params.id);
  if (!j) throw httpError(404, '研究作业不存在', 'JOB_NOT_FOUND');
  rbac.assertBrand(ctx.principal, j.brandCode);
  rbac.assertCan(ctx.principal, 'research.create', j.brandCode);
  engine.retryJob(db, j, ctx.user.id);
  engine.startJobAsync(j.id);
  return { ok: true, job: researchlib.serializeJob(db, j) };
});

get('/api/mos/research/reports', async (ctx) => {
  const brandCode = ctx.query.brand ? String(ctx.query.brand).toUpperCase() : null;
  if (brandCode) rbac.assertBrand(ctx.principal, brandCode);
  const db = getDb();
  const scoped = brandCode ? [brandCode] : ctx.principal.brandCodes;
  const items = (db.research_reports || [])
    .filter((r) => scoped.indexOf((r.brandScope || [])[0]) !== -1)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 100)
    .map((r) => researchlib.serializeReport(db, r));
  return { ok: true, items, webSearch: websearch.providerStatus() };
});

get('/api/mos/research/reports/:id', async (ctx) => {
  const db = getDb();
  const r = (db.research_reports || []).find((x) => x.id === ctx.params.id);
  if (!r) throw httpError(404, '研究报告不存在', 'REPORT_NOT_FOUND');
  rbac.assertBrand(ctx.principal, (r.brandScope || [])[0]);
  return { ok: true, report: researchlib.serializeReport(db, r) };
});

/**
 * 把报告里的候选选题（editorialOpportunities，执行包 02 §候选选题契约）**物化**为 TopicProposal。
 * AI 只能生成候选：状态一律 `AI_RECOMMENDED`，**必须经上级审核**才能成为正式选题（04 §人机审核）。
 */
post('/api/mos/research/reports/:id/proposals', async (ctx) => {
  const db = getDb();
  const r = (db.research_reports || []).find((x) => x.id === ctx.params.id);
  if (!r) throw httpError(404, '研究报告不存在', 'REPORT_NOT_FOUND');
  rbac.assertBrand(ctx.principal, (r.brandScope || [])[0]);
  rbac.assertCan(ctx.principal, 'research.create', (r.brandScope || [])[0]);

  const body = ctx.body || {};
  const ops = Array.isArray(r.editorialOpportunities) ? r.editorialOpportunities : [];
  if (!ops.length) {
    throw httpError(409, '该报告没有候选选题可物化（可能为 BLOCKED / RETRIEVAL_ONLY 降级报告）', 'NO_OPPORTUNITIES');
  }
  const picked = Array.isArray(body.indices) && body.indices.length
    ? body.indices.map((i) => ops[Number(i)]).filter(Boolean)
    : ops.slice(0, Number(body.limit) > 0 ? Number(body.limit) : 3);

  const created = [];
  const skipped = [];
  for (const op of picked) {
    const input = researchlib.proposalInputFromOpportunity(op, {
      brandCode: (r.brandScope || [])[0], reportId: r.id, reportVersion: r.rowVersion || 1
    });
    try {
      created.push(proposalRow(db, ctx, input, 'AI'));
    } catch (err) {
      skipped.push({ headlineEn: input.suggestedTitleEN, reason: String(err && err.message || err).slice(0, 160) });
    }
  }
  if (!created.length) {
    throw httpError(409, '候选选题校验全部未通过：' + skipped.map((s) => s.reason).join('；'), 'BAD_PROPOSAL');
  }
  save();
  return {
    ok: true,
    items: created.map((p) => researchlib.serializeProposal(db, p, ctx.principal)),
    skipped
  };
});

/** 来源更新/撤回 → 标记研究需刷新（02 §来源更新/撤回后标记研究需要刷新） */
post('/api/mos/research/reports/:id/refresh-check', async (ctx) => {
  const db = getDb();
  const r = (db.research_reports || []).find((x) => x.id === ctx.params.id);
  if (!r) throw httpError(404, '研究报告不存在', 'REPORT_NOT_FOUND');
  rbac.assertBrand(ctx.principal, (r.brandScope || [])[0]);
  const res = engine.refreshCheck(db, r);
  appendAudit({
    actorId: ctx.user.id, brandCode: (r.brandScope || [])[0], eventType: 'research.refresh_checked',
    objectType: 'research_report', objectId: r.id,
    metadata: { refreshState: res.refreshState, stale: res.stale.length, reverifyDue: res.reverifyDue.length }
  });
  save();
  return { ok: true, ...res };
});

/* ==================== 候选选题（TopicProposal） ==================== */

function validateProposalInput(body) {
  const errors = [];
  const title = String(body.suggestedTitleEN || '').trim();
  if (!title) errors.push('suggestedTitleEN 必填');
  const summary = String(body.summaryZH || '').trim();
  if (!summary) errors.push('summaryZH 必填');
  const cat = researchlib.checkCategory(body.primaryCategory, {
    announcementAuthorized: !!body.announcementAuthorized, officialEvidenceRef: body.officialEvidenceRef
  });
  if (!cat.ok) errors.push(cat.notes[0]);
  if (body.riskGrade && researchlib.RISKS.indexOf(body.riskGrade) === -1) errors.push('riskGrade 必须是 G0—G3');
  for (const c of (body.channels || [])) {
    if (researchlib.CHANNELS.indexOf(c) === -1) errors.push('未知渠道：' + c);
  }
  return { errors, cat, title, summary };
}

/**
 * 落库一条候选选题（**人工创建与 AI 物化共用同一条校验与写入路径**，避免两套规则漂移）。
 * @param {object} db
 * @param {object} ctx
 * @param {object} body 见 validateProposalInput
 * @param {'AI'|'EMPLOYEE'} source
 */
function proposalRow(db, ctx, body, source) {
  const v = validateProposalInput(body);
  if (v.errors.length) throw httpError(400, '候选选题校验失败：' + v.errors.join('；'), 'BAD_PROPOSAL');
  if (body.reportId) {
    const rep = (db.research_reports || []).find((r) => r.id === body.reportId);
    if (!rep) throw httpError(404, '关联研究报告不存在', 'REPORT_NOT_FOUND');
  }
  const src = source === 'EMPLOYEE' ? 'EMPLOYEE' : 'AI';
  const p = {
    id: uid('tpp'), code: proposalCode(db), reportId: body.reportId || null,
    brandCode: body.brandCode, suggestedTitleEN: v.title, summaryZH: v.summary,
    angle: body.angle || null, primaryCategory: body.primaryCategory,
    secondaryCategories: Array.isArray(body.secondaryCategories) ? body.secondaryCategories : [],
    audiences: Array.isArray(body.audiences) ? body.audiences : [],
    keyMessages: Array.isArray(body.keyMessages) ? body.keyMessages : [],
    channels: Array.isArray(body.channels) ? body.channels : [],
    deliverables: Array.isArray(body.deliverables) ? body.deliverables : [],
    sourceFindingIds: Array.isArray(body.sourceFindingIds) ? body.sourceFindingIds : [],
    riskGrade: body.riskGrade || 'G1', needsVerification: !!v.cat.needsVerification || !!body.needsVerification,
    whyRecommended: body.whyRecommended || null,
    special01Notes: v.cat.notes, announcementAuthorized: !!body.announcementAuthorized,
    officialEvidenceRef: body.officialEvidenceRef || null,
    // V0.1.3 候选选题契约增量（执行包 02）：事实核验清单 + 报告版本（可回溯到具体报告版本）
    factCheckNeeds: Array.isArray(body.factCheckNeeds) ? body.factCheckNeeds : [],
    reportVersion: body.reportVersion || null,
    status: src === 'AI' ? 'AI_RECOMMENDED' : 'PENDING_EDITORIAL_REVIEW',
    source: src, aiGenerated: src === 'AI',
    reviewerId: null, reviewedAt: null, reviewComments: null, editDiff: [],
    revision: 0, createdById: ctx.user.id, createdAt: nowIso(), rowVersion: 1
  };
  db.topic_proposals.push(p);
  if (p.reportId) {
    const rep = db.research_reports.find((r) => r.id === p.reportId);
    if (rep) rep.topicProposalIds.push(p.id);
  }
  appendAudit({
    actorId: ctx.user.id, brandCode: p.brandCode, eventType: 'proposal.created',
    objectType: 'topic_proposal', objectId: p.id,
    metadata: { source: src, status: p.status, primaryCategory: p.primaryCategory, reportId: p.reportId, reportVersion: p.reportVersion }
  });
  return p;
}

post('/api/mos/topic-proposals', async (ctx) => {
  const body = ctx.body || {};
  assertBrand(ctx, body.brandCode);
  rbac.assertCan(ctx.principal, 'research.create', body.brandCode);

  const db = getDb();
  const source = body.source === 'EMPLOYEE' ? 'EMPLOYEE' : 'AI';
  const p = proposalRow(db, ctx, body, source);
  save();
  return { ok: true, proposal: researchlib.serializeProposal(db, p, ctx.principal) };
});

get('/api/mos/topic-proposals', async (ctx) => {
  const brandCode = ctx.query.brand ? String(ctx.query.brand).toUpperCase() : null;
  if (brandCode) rbac.assertBrand(ctx.principal, brandCode);
  const db = getDb();
  const scoped = brandCode ? [brandCode] : ctx.principal.brandCodes;
  const status = ctx.query.status ? String(ctx.query.status).toUpperCase() : null;
  let items = (db.topic_proposals || []).filter((p) => scoped.indexOf(p.brandCode) !== -1);
  if (status) items = items.filter((p) => p.status === status);
  items = items.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, 200)
    .map((p) => researchlib.serializeProposal(db, p, ctx.principal));
  return { ok: true, items };
});

get('/api/mos/topic-proposals/:id', async (ctx) => {
  const db = getDb();
  const p = (db.topic_proposals || []).find((x) => x.id === ctx.params.id);
  if (!p) throw httpError(404, '候选选题不存在', 'PROPOSAL_NOT_FOUND');
  rbac.assertBrand(ctx.principal, p.brandCode);
  return { ok: true, proposal: researchlib.serializeProposal(db, p, ctx.principal) };
});

/** AI_RECOMMENDED → PENDING_EDITORIAL_REVIEW（提交审核） */
post('/api/mos/topic-proposals/:id/submit', async (ctx) => {
  const db = getDb();
  const p = (db.topic_proposals || []).find((x) => x.id === ctx.params.id);
  if (!p) throw httpError(404, '候选选题不存在', 'PROPOSAL_NOT_FOUND');
  rbac.assertBrand(ctx.principal, p.brandCode);
  rbac.assertCan(ctx.principal, 'research.create', p.brandCode);
  const allowed = researchlib.PROPOSAL_TRANSITIONS[p.status] || [];
  if (allowed.indexOf('PENDING_EDITORIAL_REVIEW') === -1) {
    throw httpError(409, '当前状态不允许提交审核：' + p.status, 'BAD_TRANSITION');
  }
  p.status = 'PENDING_EDITORIAL_REVIEW';
  p.rowVersion += 1;
  appendAudit({
    actorId: ctx.user.id, brandCode: p.brandCode, eventType: 'proposal.submitted',
    objectType: 'topic_proposal', objectId: p.id, oldState: 'AI_RECOMMENDED',
    newState: p.status, metadata: {}
  });
  save();
  return { ok: true, proposal: researchlib.serializeProposal(db, p, ctx.principal) };
});

/** P1 一屏审核决策（03 §一屏审核；编辑 diff 落审计；**不代替** library.asset.approve.final） */
post('/api/mos/topic-proposals/:id/decision', async (ctx) => {
  const body = ctx.body || {};
  const db = getDb();
  const p = (db.topic_proposals || []).find((x) => x.id === ctx.params.id);
  if (!p) throw httpError(404, '候选选题不存在', 'PROPOSAL_NOT_FOUND');
  rbac.assertBrand(ctx.principal, p.brandCode);
  rbac.assertCan(ctx.principal, 'editorial.approve', p.brandCode);

  const decision = String(body.decision || '').toUpperCase();
  const allowed = researchlib.PROPOSAL_TRANSITIONS[p.status] || [];
  if (allowed.indexOf(decision) === -1) {
    throw httpError(409, '非法状态迁移：' + p.status + ' → ' + decision, 'BAD_TRANSITION');
  }
  const priorStatus = p.status;
  const before = {
    suggestedTitleEN: p.suggestedTitleEN, angle: p.angle, primaryCategory: p.primaryCategory,
    channels: p.channels, deliverables: p.deliverables, riskGrade: p.riskGrade
  };
  const edits = body.edits || {};
  // 上级可修改标题/角度/栏目/平台/交付物（03 §一屏审核）；修改后重过 SPECIAL-01 校验
  if (edits.suggestedTitleEN !== undefined && !String(edits.suggestedTitleEN).trim()) {
    throw httpError(400, '标题不得为空', 'BAD_EDIT');
  }
  for (const k of Object.keys(edits)) {
    if (['suggestedTitleEN', 'angle', 'primaryCategory', 'channels', 'deliverables', 'riskGrade'].indexOf(k) !== -1) {
      p[k] = edits[k];
    }
  }
  const v = researchlib.checkCategory(p.primaryCategory, {
    announcementAuthorized: p.announcementAuthorized, officialEvidenceRef: p.officialEvidenceRef
  });
  if (!v.ok) throw httpError(400, v.notes[0], 'BAD_CATEGORY');
  p.special01Notes = v.notes;
  p.needsVerification = !!v.needsVerification || !!p.needsVerification;

  p.status = decision;
  p.reviewerId = ctx.user.id;
  p.reviewedAt = nowIso();
  p.reviewComments = String(body.comments || '');
  p.editDiff = researchlib.diffEdits(before, edits);
  if (decision === 'REVISION_REQUESTED') p.revision += 1;
  p.rowVersion += 1;

  appendAudit({
    actorId: ctx.user.id, brandCode: p.brandCode, eventType: 'proposal.decision',
    objectType: 'topic_proposal', objectId: p.id, oldState: priorStatus,
    newState: decision, metadata: { comments: p.reviewComments, editDiff: p.editDiff, needsVerification: p.needsVerification }
  });
  save();
  return { ok: true, proposal: researchlib.serializeProposal(db, p, ctx.principal) };
});
