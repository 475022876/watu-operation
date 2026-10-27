'use strict';
/**
 * Marketing OS —— 创作服务（W04-02 Visual Studio / 04 §1/§5/§6）。
 *
 * 本文件承担四件事：
 *   1. Skill / 模板读取（只读投影，写权限留给资料库流程）
 *   2. Prompt 预览（Brand Rule Engine 的显式输出，供人工确认后再生成）
 *   3. WorkingAsset：上传（魔数校验）与生成产物落盘（sha256 指纹）
 *   4. GenerationJob：幂等、预算、prompt 快照、成本/币种、基础 QA
 *
 * 不可妥协：
 *   - 预算耗尽 / 未配置预算 → `BUDGET_EXCEEDED`，**不产生任何调用**
 *     （「耗尽返回 BUDGET_EXCEEDED，需获授权提高」，04 §5）
 *   - 未批准 Skill → 正式输出被拒绝（见 lib/mos/skill.js）
 *   - 产物一律真实落盘；MOCK 产物带显著标记，绝不当成真实模型结果（09 §5）
 *   - QA 结论永远是「需人工判断」，不伪称 100% 合格（04 §2）
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { get, post } = require('../router');
const { getDb, save } = require('../store');
const { httpError, streamToFile, uploadExtAllowed, uploadMagicIssue, extOf, mimeOf } = require('../../util');
const { PATHS } = require('../../config');
const { getMosConfig } = require('../config');
const { uid, sha256 } = require('../ids');
const { dictValid } = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const skill = require('../skill');
const formalguard = require('../formalguard');
const imageProvider = require('../adapters/image');
const textProvider = require('../adapters/text');
const provideradmin = require('../provideradmin');
const helpers = require('./helpers');

/** 生成产物允许的落盘扩展名（不允许 .html/.js 等可执行内容，见 util 上传白名单口径） */
function generatedExtAllowed(ext) {
  const cfg = getMosConfig();
  const list = (cfg.uploads && cfg.uploads.allowedGeneratedExts) || ['.svg', '.png'];
  return list.indexOf(ext) !== -1;
}

function assetDir(brandCode) {
  return path.join(PATHS.uploadDir, 'assets', String(brandCode).replace(/[^A-Za-z0-9_-]/g, '_'));
}

/**
 * 落盘一个工作素材并登记元数据。
 * @param {object} db
 * @param {object} spec { brandCode, bytes, ext, mime, origin, ownerId, taskId, campaignId,
 *                        topicId, fileName, mock, license, promptSnapshot, jobId, demo }
 */
function saveAsset(db, spec) {
  const id = uid('wa');
  const ext = spec.ext;
  const dir = assetDir(spec.brandCode);
  fs.mkdirSync(dir, { recursive: true });
  const rel = 'assets/' + path.basename(dir) + '/' + id + ext;
  const abs = path.join(PATHS.uploadDir, rel);
  fs.writeFileSync(abs, spec.bytes);
  const digest = crypto.createHash('sha256').update(spec.bytes).digest('hex');

  const row = {
    id,
    brandCode: spec.brandCode,
    projectRef: {
      taskId: spec.taskId || null,
      campaignId: spec.campaignId || null,
      topicId: spec.topicId || null
    },
    objectKey: rel,
    fileName: String(spec.fileName || (id + ext)).slice(0, 180),
    sha256: digest,
    mime: spec.mime || mimeOf('x' + ext),
    bytes: spec.bytes.length,
    origin: spec.origin,
    license: spec.license || 'INTERNAL_DRAFT',
    visibility: 'PRIVATE',   // 02 §2：默认 PRIVATE
    ownerId: spec.ownerId,
    mock: !!spec.mock,
    generationJobId: spec.jobId || null,
    promptSnapshot: spec.promptSnapshot || null,
    demo: !!spec.demo,
    createdAt: new Date().toISOString(),
    createdBy: spec.ownerId
  };
  db.working_assets.push(row);
  return row;
}

function serializeAsset(a, db) {
  const job = a.generationJobId ? (db.generation_jobs || []).find((j) => j.id === a.generationJobId) : null;
  return {
    id: a.id, brandCode: a.brandCode, fileName: a.fileName, mime: a.mime, bytes: a.bytes,
    sha256: a.sha256, origin: a.origin, license: a.license, visibility: a.visibility,
    mock: !!a.mock, projectRef: a.projectRef || {}, ownerId: a.ownerId,
    generationJobId: a.generationJobId || null,
    provider: job ? job.provider : '',
    createdAt: a.createdAt, demo: !!a.demo,
    contentUrl: '/api/mos/assets/' + a.id + '/content'
  };
}

/* ==================== Skill / 模板 ==================== */

get('/api/mos/skills', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  const list = skill.listSkills(db, brandCode);
  return {
    ok: true, brandCode,
    items: list,
    usability: skill.resolveSkill(db, brandCode),
    note: '未 APPROVED 的 Skill 不得用于正式品牌输出；测试草稿会被显式标注。'
  };
});

get('/api/mos/templates', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  const items = skill.listTemplates(db, brandCode, {
    platform: ctx.query.platform ? String(ctx.query.platform).toUpperCase() : '',
    mode: ctx.query.mode ? String(ctx.query.mode).toUpperCase() : ''
  });
  return {
    ok: true, brandCode, items,
    note: items.length ? '模板版本已锁定，生成记录中会保存 template_version。'
      : '该品牌尚无可用的已登记模板（不得套用其他品牌模板）。'
  };
});

/** Prompt 预览：把「参数 → 受控提示词」的过程显式暴露给操作者确认 */
post('/api/mos/prompt-preview', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  const built = skill.buildPrompt(db, {
    brandCode,
    skillCode: body.skillCode,
    mode: body.mode ? String(body.mode).toUpperCase() : '',
    platform: body.platform ? String(body.platform).toUpperCase() : '',
    templateCode: body.templateCode ? String(body.templateCode).toUpperCase() : '',
    aspect: body.aspect || '',
    display: body.display ? String(body.display).toUpperCase() : '',
    pillarCode: body.pillarCode ? String(body.pillarCode).toUpperCase() : '',
    narrativeCode: body.narrativeCode ? String(body.narrativeCode).toUpperCase() : '',
    visualCode: body.visualCode ? String(body.visualCode).toUpperCase() : '',
    riskGrade: body.riskGrade ? String(body.riskGrade).toUpperCase() : '',
    brief: body.brief,
    outputIntent: body.outputIntent
  });
  return {
    ok: true, brandCode, blocked: built.blocked, blockReason: built.blockReason,
    prompt: built.prompt, effectiveRuleHash: built.effectiveRuleHash,
    ruleSnapshot: built.ruleSnapshot,
    dictionaries: {
      modes: helpers.dictionaries().modes,
      aspects: helpers.dictionaries().aspects,
      displays: helpers.dictionaries().displays,
      visuals: helpers.dictionaries().visuals
    }
  };
});

/**
 * **正式输出门禁检查**（V1.2 / B1）—— 只判定，不产出、不出站、不落盘。
 *
 * 用途：
 *   · 操作者在真正提交生成前，先看清「这次输出能不能算正式作品」；
 *   · 运维/联调可在**不产生任何副作用**的前提下验证门禁（尤其是「引用已被撤回」的判定）。
 *
 * 与 `POST /api/mos/generation-jobs` 共用同一份 `formalguard.evaluate()` —— 不存在两套规则。
 */
post('/api/mos/formal-output-check', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'content.edit', brandCode, { ip: ctx.ip, objectType: 'formal_output_gate' });

  const task = body.taskId ? (db.content_tasks.find((t) => t.id === String(body.taskId)) || null) : null;
  if (body.taskId && !task) throw httpError(400, '内容任务不存在', 'TASK_NOT_FOUND');
  if (task) rbac.assertSameBrand(task.brandCode, brandCode);

  const gate = formalguard.evaluate(db, {
    brandCode,
    task,
    skillCode: body.skillCode,
    outputIntent: body.outputIntent,
    libraryRefIds: Array.isArray(body.libraryRefIds) ? body.libraryRefIds : []
  });

  return {
    ok: true, brandCode,
    intent: gate.intent, formal: gate.formal, allowed: gate.allowed,
    blockers: gate.blockers, advisories: gate.advisories,
    detail: gate.detail,
    note: gate.intent === null
      ? '未识别的输出意图：按未授权处理（fail-closed），正式生成会被阻断。'
      : (gate.formal
        ? (gate.allowed ? '门禁通过：该请求可作为正式输出。' : '门禁阻断：该请求**不得**作为正式输出。')
        : '非正式输出（测试草稿）：advisories 中的提示不阻断，但草稿不得对外发布。')
  };
});

/* ==================== 工作素材 ==================== */

get('/api/mos/assets', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.working_assets.filter((a) => a.brandCode === brandCode);
  if (ctx.query.taskId) rows = rows.filter((a) => (a.projectRef || {}).taskId === String(ctx.query.taskId));
  if (ctx.query.origin) rows = rows.filter((a) => a.origin === String(ctx.query.origin).toUpperCase());
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const paged = helpers.paginate(rows, ctx.query);
  return {
    ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((a) => serializeAsset(a, db))
  };
});

/**
 * 上传工作素材：**原始字节流**（Content-Type 为文件自身类型或 application/octet-stream）。
 * 安全（06 §5 / SEC-10）：扩展名白名单 → 魔数校验 → 体积上限 → 落盘为私有文件。
 */
post('/api/mos/assets/upload', async (ctx) => {
  const db = getDb();
  const cfg = getMosConfig();
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'asset.create', brandCode, { ip: ctx.ip, objectType: 'working_asset' });

  const rawName = String(ctx.query.name || '').trim();
  if (!rawName) throw httpError(400, '缺少文件名（name 参数）', 'MISSING_NAME');
  const ext = extOf(rawName);
  if (!ext) throw httpError(400, '文件必须有扩展名', 'BAD_EXT');
  if (!uploadExtAllowed(rawName)) {
    throw httpError(400, '不支持的文件类型：' + ext + '（仅允许办公文档、纯文本与图片）', 'EXT_NOT_ALLOWED');
  }

  const taskId = ctx.query.taskId ? String(ctx.query.taskId) : null;
  if (taskId) {
    const t = db.content_tasks.find((x) => x.id === taskId);
    if (!t) throw httpError(400, '内容任务不存在', 'TASK_NOT_FOUND');
    rbac.assertSameBrand(t.brandCode, brandCode);
  }

  const maxBytes = Number((cfg.uploads && cfg.uploads.maxBytes) || 20 * 1024 * 1024);
  const tmp = path.join(PATHS.uploadDir, 'tmp-' + uid('up') + ext);
  fs.mkdirSync(PATHS.uploadDir, { recursive: true });
  let size = 0;
  try {
    size = await streamToFile(ctx.req, tmp, maxBytes);
  } catch (err) {
    throw err;
  }
  if (!size) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    throw httpError(400, '上传内容为空', 'EMPTY_UPLOAD');
  }

  // 魔数校验：扩展名伪装一律拒绝（防把脚本/压缩包改名成 .png）
  const fd = fs.openSync(tmp, 'r');
  const head = Buffer.alloc(256);
  const read = fs.readSync(fd, head, 0, 256, 0);
  fs.closeSync(fd);
  const issue = uploadMagicIssue(ext, head.slice(0, read));
  if (issue) {
    try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
    appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'working_asset.upload.rejected',
      objectType: 'working_asset', outcome: 'denied', ip: ctx.ip, metadata: { ext, reason: issue, bytes: size } });
    throw httpError(400, issue, 'MAGIC_MISMATCH');
  }

  const bytes = fs.readFileSync(tmp);
  try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }

  const asset = saveAsset(db, {
    brandCode, bytes, ext, mime: ctx.req.headers['content-type'] && ctx.req.headers['content-type'] !== 'application/octet-stream'
      ? String(ctx.req.headers['content-type']).split(';')[0] : mimeOf('x' + ext),
    origin: 'UPLOADED', ownerId: ctx.user.id, taskId,
    campaignId: ctx.query.campaignId || null,
    topicId: ctx.query.topicId || null,
    fileName: rawName,
    license: 'INTERNAL_DRAFT'
  });
  save();
  appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'working_asset.uploaded',
    objectType: 'working_asset', objectId: asset.id, ip: ctx.ip,
    metadata: { fileName: asset.fileName, bytes: asset.bytes, mime: asset.mime, sha256: asset.sha256 } });
  return { ok: true, asset: serializeAsset(asset, db) };
});

/** 读取素材内容（受鉴权 + 品牌范围约束；不做裸路径暴露） */
get('/api/mos/assets/:id/content', async (ctx) => {
  const db = getDb();
  const a = db.working_assets.find((x) => x.id === ctx.params.id);
  if (!a) throw httpError(404, '素材不存在', 'ASSET_NOT_FOUND');
  rbac.assertBrand(ctx.principal, a.brandCode);

  const abs = path.join(PATHS.uploadDir, a.objectKey);
  const rel = path.relative(path.resolve(PATHS.uploadDir), path.resolve(abs));
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw httpError(403, '非法路径', 'FORBIDDEN');

  let buf;
  try { buf = fs.readFileSync(abs); } catch (_) {
    throw httpError(404, '素材文件缺失（可能已被清理）', 'ASSET_FILE_MISSING');
  }
  ctx.res.writeHead(200, {
    'Content-Type': a.mime || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': 'private, max-age=60',
    'X-Content-Type-Options': 'nosniff',
    // SVG 作为可承载脚本的格式，一律以最严格策略下发（即使本系统生成的 SVG 不含脚本）
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    'Content-Disposition': 'inline; filename="' + String(a.fileName || a.id).replace(/[^\x20-\x7e]/g, '_') + '"'
  });
  ctx.res.end(buf);
  return null; // 已直接写出响应
});

/* ==================== 生成作业 ==================== */

/** 品牌当月已确认花费（只累计有确认金额的记录，不凭空推算，04 §5） */
function monthSpend(db, brandCode) {
  const now = new Date();
  const ym = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
  return db.generation_jobs
    .filter((j) => j.brandCode === brandCode && String(j.createdAt || '').slice(0, 7) === ym)
    .reduce((s, j) => s + (j.cost && typeof j.cost.amount === 'number' && j.cost.confirmed ? j.cost.amount : 0), 0);
}

function budgetCheck(db, brandCode, estimated) {
  const cfg = getMosConfig();
  const perJob = Number((cfg.budget && cfg.budget.perJobUsdMax) || 0);
  const monthly = Number((cfg.budget && cfg.budget.brandMonthlyUsd) || 0);
  const spent = monthSpend(db, brandCode);
  const est = Number(estimated) || 0;

  if (perJob <= 0 && monthly <= 0) {
    return {
      ok: est <= 0, spent, perJob, monthly,
      reason: est <= 0 ? '' : '未配置任何 AI 预算：只允许零成本（MOCK）调用；如需真实模型请先配置预算额度'
    };
  }
  if (perJob > 0 && est > perJob) {
    return { ok: false, spent, perJob, monthly, reason: '超出单任务预算上限 $' + perJob };
  }
  if (monthly <= 0 && est > 0) {
    return { ok: false, spent, perJob, monthly, reason: '未配置品牌月度预算，不允许产生费用' };
  }
  if (monthly > 0 && spent + est > monthly) {
    return { ok: false, spent, perJob, monthly,
      reason: '超出品牌月度预算：已用 $' + spent.toFixed(2) + ' + 本次 $' + est.toFixed(2) + ' > $' + monthly };
  }
  return { ok: true, spent, perJob, monthly, reason: '' };
}

/** 基础 QA（04 §2）：只做可确定的检查，结论永远是「需人工判断」 */
function runQa(providerResult, assetRows) {
  const checks = [];
  checks.push({ id: 'output_present', ok: assetRows.length > 0, note: assetRows.length ? '已产出并落盘' : '没有产出' });
  checks.push({
    id: 'mime_allowed',
    ok: assetRows.every((a) => generatedExtAllowed(extOf(a.fileName))),
    note: '产物扩展名在允许集合内'
  });
  checks.push({
    id: 'mock_labeled',
    ok: !providerResult.mock || assetRows.every((a) => a.mock),
    note: providerResult.mock ? 'MOCK 产物已带标记，不得用于对外发布' : '非 MOCK 产物'
  });
  return {
    checks,
    verdict: 'NEEDS_HUMAN_REVIEW',
    backgroundCheck: {
      state: providerResult.mock ? 'DECLARED_NEUTRAL_WHITE' : 'NOT_ANALYZED',
      note: providerResult.mock
        ? 'MOCK 产物背景为中性命白（#FCFBF7），无黄偏；真实产物服务端未做像素级色彩分析，须人工判断。'
        : '服务端未对真实产物做像素级留白/偏黄分析，须人工判断（04 §2：不得伪称 100% 色彩保证）。'
    },
    note: '基础 QA 只覆盖"能不能用"的硬性条件；是否"合格"必须由人工判断。'
  };
}

post('/api/mos/generation-jobs', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'model.invoke', brandCode, { ip: ctx.ip, objectType: 'generation_job' });

  const kind = String(body.kind || 'IMAGE').toUpperCase();
  if (['IMAGE', 'TEXT'].indexOf(kind) === -1) throw httpError(400, 'kind 只能是 IMAGE 或 TEXT', 'BAD_KIND');

  // AI 外发数据分级（06 §5）：Public / Internal / Restricted。RESTRICTED 默认拒发。
  const dataClass = String(body.dataClass || 'INTERNAL').toUpperCase();
  if (!dictValid('dataClasses', dataClass)) {
    throw httpError(400, '未知的数据分级：' + dataClass + '（PUBLIC / INTERNAL / RESTRICTED）', 'BAD_DATA_CLASS');
  }
  const dataClassDef = require('../dict').DATA_CLASSES.find((x) => x.code === dataClass);

  const task = body.taskId ? db.content_tasks.find((t) => t.id === String(body.taskId)) : null;
  if (body.taskId && !task) throw httpError(400, '内容任务不存在', 'TASK_NOT_FOUND');
  if (task) rbac.assertSameBrand(task.brandCode, brandCode);

  // 幂等：同一 idempotencyKey + 品牌 只执行一次（04 §1 / 03 §5）
  const idem = String(body.idempotencyKey || '').trim();
  if (idem) {
    const dup = db.generation_jobs.find((j) => j.brandCode === brandCode && j.idempotencyKey === idem);
    if (dup) {
      return { ok: true, deduplicated: true, job: serializeJob(db, dup),
        note: '幂等命中：同一 idempotencyKey 已存在作业，未重复执行。' };
    }
  }

  const cfg = getMosConfig();
  /* 作业快照的 provider/model 取「接入页生效配置」（provideradmin.effective，env>加密库>config.json），
   * 不再读 config.json 静态 integrations 字段——否则接入页保存后，作业仍显示 mos.text:none、模型为空。 */
  const eff = provideradmin.effective(kind === 'IMAGE' ? 'image' : 'text');
  const providerMode = String(eff.mode || 'none').toLowerCase();

  /* ---- V1.2 / B1：正式输出门禁（先于任何出站与落盘） ----
   * 「Revoked / Deprecated / 权限撤销 / Skill 失效不得继续生成新正式作品」。
   * 该判定对 **TEXT 与 IMAGE 一视同仁**：旧实现只有 IMAGE 走 buildPrompt，
   * TEXT 的 outputIntent 从未被校验 —— 正式文字作品因此可能越过 Skill 门禁。 */
  const gate = formalguard.evaluate(db, {
    brandCode,
    task,
    skillCode: body.skillCode,
    outputIntent: body.outputIntent,
    libraryRefIds: Array.isArray(body.libraryRefIds) ? body.libraryRefIds : []
  });
  if (!gate.allowed) {
    appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'generation.blocked',
      objectType: 'generation_job', outcome: 'denied', ip: ctx.ip,
      metadata: { kind, stage: 'formal_guard', outputIntent: gate.intent,
        blockers: gate.blockers.map((b) => b.code) } });
    throw httpError(409,
      '正式输出被门禁阻断：' + gate.blockers.map((b) => b.code).join('、')
        + '；' + gate.blockers.map((b) => b.note).join(' '),
      'FORMAL_OUTPUT_BLOCKED', { blockers: gate.blockers, intent: gate.intent });
  }
  // 未识别意图 / 空意图：fail-closed，不得按最宽松处理（与 skill.normalizeIntent 同源）
  if (gate.intent === null) {
    throw httpError(409,
      '未识别的输出意图 outputIntent=' + JSON.stringify(body.outputIntent)
        + '（仅支持 FORMAL 正式输出 / TEST_DRAFT 测试草稿）；按未授权处理，已阻断。',
      'FORMAL_OUTPUT_BLOCKED', { intent: null });
  }

  // 提示词快照（IMAGE 走 Brand Rule Engine；TEXT 直接记录 Brief）
  let built = null;
  if (kind === 'IMAGE') {
    built = skill.buildPrompt(db, {
      brandCode,
      skillCode: body.skillCode,
      mode: body.mode ? String(body.mode).toUpperCase() : '',
      platform: body.platform ? String(body.platform).toUpperCase() : (task ? task.platform : ''),
      templateCode: body.templateCode ? String(body.templateCode).toUpperCase() : '',
      aspect: body.aspect || '',
      display: body.display ? String(body.display).toUpperCase() : '',
      pillarCode: body.pillarCode ? String(body.pillarCode).toUpperCase() : (task ? task.pillarCode : ''),
      narrativeCode: body.narrativeCode ? String(body.narrativeCode).toUpperCase() : (task ? task.narrativeCode : ''),
      visualCode: body.visualCode ? String(body.visualCode).toUpperCase() : '',
      riskGrade: body.riskGrade ? String(body.riskGrade).toUpperCase() : (task ? task.riskGrade : ''),
      brief: body.brief,
      outputIntent: body.outputIntent
    });
    if (built.blocked) {
      appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'generation.blocked',
        objectType: 'generation_job', outcome: 'denied', ip: ctx.ip,
        metadata: { kind, reason: built.blockReason, outputIntent: body.outputIntent || 'TEST_DRAFT' } });
      throw httpError(409, built.blockReason, 'SKILL_NOT_APPROVED');
    }
  }
  if (body.mode && !dictValid('modes', String(body.mode).toUpperCase())) throw httpError(400, '模式非法', 'BAD_MODE');
  if (body.aspect && !dictValid('aspects', body.aspect)) throw httpError(400, '画幅非法', 'BAD_ASPECT');

  const template = body.templateId ? skill.resolveTemplate(db, String(body.templateId)) : null;
  if (body.templateId && !template) throw httpError(400, '模板不存在', 'TEMPLATE_NOT_FOUND');
  if (template && template.brandCode !== brandCode) throw httpError(404, '模板不存在', 'BRAND_MISMATCH');

  const now = new Date().toISOString();
  const job = {
    id: uid('gj'),
    brandCode,
    taskId: task ? task.id : null,
    kind,
    /** AI 外发数据分级（06 §5）：RESTRICTED 会被上面的闸门阻断，绝不外发 */
    dataClass,
    provider: kind === 'IMAGE' ? (imageProvider.PROVIDER_ID + ':' + providerMode) : ('mos.text:' + providerMode),
    modelId: eff.model || '',
    skillVersionId: built && built.ruleSnapshot.skillVersion ? built.ruleSnapshot.skillVersion.id : null,
    templateVersionId: template ? (template.id + '@v' + template.version) : null,
    promptSnapshot: kind === 'IMAGE'
      ? { effectiveRuleHash: built.effectiveRuleHash, resolvedPrompt: built.prompt, ruleSnapshot: built.ruleSnapshot }
      : { brief: String(body.brief || '').slice(0, 4000) },
    referenceIds: Array.isArray(body.referenceIds) ? body.referenceIds.map(String).slice(0, 20) : [],
    status: 'QUEUED',
    providerJobId: '',
    providerUsage: {},
    cost: { amount: 0, currency: 'USD', confirmed: true },
    estimatedCostUsd: Number(body.estimatedCostUsd) || 0,
    currency: 'USD',
    qaResult: null,
    outputAssetIds: [],
    mock: providerMode === 'mock',
    errorCode: '',
    errorMessage: '',
    idempotencyKey: idem,
    requestedBy: ctx.user.id,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    demo: false
  };
  db.generation_jobs.push(job);

  // ---------- 数据分级闸门（06 §5）：在任何外部调用之前，RESTRICTED 一律拒发 ----------
  if (!dataClassDef.sendAllowed) {
    job.status = 'BLOCKED';
    job.errorCode = 'DATA_CLASS_RESTRICTED';
    job.errorMessage = '数据分级 ' + dataClass + '：' + dataClassDef.label
      + '。受限资料默认不允许外发模型（06 §5）。';
    job.finishedAt = new Date().toISOString();
    job.providerJobId = '';       // 明确：未发生任何外部调用
    save();
    appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'generation.blocked',
      objectType: 'generation_job', objectId: job.id, outcome: 'denied', ip: ctx.ip,
      metadata: { kind, reason: job.errorCode, dataClass } });
    return {
      ok: true, job: serializeJob(db, job), providerState: 'BLOCKED',
      note: job.errorMessage
    };
  }

  // ---------- 预算闸门（在任何外部调用之前） ----------
  const budget = budgetCheck(db, brandCode, job.estimatedCostUsd);
  if (!budget.ok) {
    job.status = 'BUDGET_EXCEEDED';
    job.errorCode = 'BUDGET_EXCEEDED';
    job.errorMessage = budget.reason;
    job.finishedAt = new Date().toISOString();
    save();
    appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'generation.budget_exceeded',
      objectType: 'generation_job', objectId: job.id, outcome: 'denied', ip: ctx.ip,
      metadata: { kind, reason: budget.reason, spent: budget.spent, perJob: budget.perJob, monthly: budget.monthly } });
    return { ok: true, job: serializeJob(db, job), budget, note: budget.reason };
  }

  job.status = 'RUNNING';
  job.startedAt = new Date().toISOString();

  // ---------- 调用 Provider ----------
  let providerResult;
  if (kind === 'IMAGE') {
    const aspect = String(body.aspect || '16:9');
    const dims = { '1:1': [1024, 1024], '4:5': [1024, 1280], '16:9': [1280, 720], '9:16': [720, 1280] }[aspect] || [1280, 720];
    providerResult = await imageProvider.generate({
      taskId: task ? task.id : null, actorId: ctx.user.id, dataClass, libraryRefIds: body.libraryRefIds, refAssetIds: body.refAssetIds,
      prompt: built.prompt,
      title: (task ? task.title : (body.title || '未命名')),
      brandCode,
      brandName: (db.brands.find((b) => b.code === brandCode) || {}).name || brandCode,
      platform: built.ruleSnapshot.platform,
      aspect,
      width: dims[0],
      height: dims[1],
      skillState: built.ruleSnapshot.skillVersion ? built.ruleSnapshot.skillVersion.state : 'MISSING_NOT_APPROVED',
      effectiveRuleHash: built.effectiveRuleHash
    });
  } else {
    providerResult = await textProvider.draft({
      taskId: task ? task.id : null, brandCode, actorId: ctx.user.id, dataClass, libraryRefIds: body.libraryRefIds, refAssetIds: body.refAssetIds,
      title: task ? task.title : (body.title || '未命名草稿'),
      brief: String(body.brief || ''),
      platform: task ? task.platform : (body.platform || ''),
      pillarCode: task ? task.pillarCode : (body.pillarCode || ''),
      narrativeCode: task ? task.narrativeCode : (body.narrativeCode || ''),
      riskGrade: task ? task.riskGrade : (body.riskGrade || ''),
      // 数据分级 → 适配器信任级别（06 §5）。RESTRICTED 已在闸门处阻断，此处为纵深防御。
      trustLevel: dataClass === 'PUBLIC' ? 'untrusted_external'
        : (dataClass === 'RESTRICTED' ? 'internal_restricted' : 'internal_draft')
    });
  }

  job.providerJobId = String((providerResult.usage && providerResult.usage.providerJobId) || '').slice(0, 200);
  job.providerUsage = providerResult.usage || {};
  job.cost = {
    amount: providerResult.billing && typeof providerResult.billing.amount === 'number' ? providerResult.billing.amount : null,
    currency: (providerResult.billing && providerResult.billing.currency) || '',
    confirmed: !!(providerResult.billing && providerResult.billing.confirmed)
  };
  job.currency = job.cost.currency || 'USD';
  job.mock = !!providerResult.mock;
  job.rawStatus = providerResult.rawStatus;
  job.providerNote = providerResult.note || '';

  const outputs = [];
  if (providerResult.state === 'MOCK' || providerResult.state === 'SUCCEEDED') {
    if (kind === 'IMAGE') {
      for (const out of providerResult.outputs || []) {
        if (!generatedExtAllowed(out.ext)) continue;
        const a = saveAsset(db, {
          brandCode, bytes: out.bytes, ext: out.ext, mime: out.mime,
          origin: 'GENERATED', ownerId: ctx.user.id,
          taskId: task ? task.id : null,
          fileName: (task ? task.code : 'GEN') + '-' + job.id.slice(-6) + out.ext,
          mock: !!providerResult.mock,
          promptSnapshot: { effectiveRuleHash: built.effectiveRuleHash, resolvedPrompt: built.prompt },
          jobId: job.id
        });
        outputs.push(a);
        job.outputAssetIds.push(a.id);
      }
    } else {
      // 文案草稿：可选直接写入某个 DRAFT 版本
      if (body.applyToVersionId) {
        const v = db.content_versions.find((x) => x.id === String(body.applyToVersionId));
        if (!v) throw httpError(400, '目标内容版本不存在', 'VERSION_NOT_FOUND');
        rbac.assertSameBrand(v.brandCode, brandCode);
        if (v.state !== 'DRAFT') {
          throw httpError(409, '只能把 AI 草稿写入 DRAFT 版本（当前 ' + v.state + '）', 'VERSION_IMMUTABLE');
        }
        v.body = String(providerResult.text || '');
        v.updatedAt = new Date().toISOString();
        v.updatedBy = ctx.user.id;
        v.rowVersion = Number(v.rowVersion || 1) + 1;
        job.appliedToVersionId = v.id;
      }
      job.outputText = String(providerResult.text || '');
    }
    job.status = 'SUCCEEDED';
  } else if (providerResult.state === 'NOT_CONFIGURED') {
    job.status = 'NOT_CONFIGURED';
    job.errorCode = 'NOT_CONFIGURED';
    job.errorMessage = providerResult.note || '';
  } else if (providerResult.state === 'BLOCKED') {
    job.status = 'BLOCKED';
    job.errorCode = 'SENSITIVE_BLOCKED';
    job.errorMessage = providerResult.note || '';
  } else {
    job.status = 'FAILED';
    job.errorCode = providerResult.state || 'FAILED';
    job.errorMessage = providerResult.note || '';
  }
  job.finishedAt = new Date().toISOString();
  job.qaResult = job.status === 'SUCCEEDED' ? runQa(providerResult, outputs) : null;
  if (outputs.length) {
    job.outputAssetIds = outputs.map((a) => a.id);
  }

  save();
  appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'generation.job.finished',
    objectType: 'generation_job', objectId: job.id, newState: job.status, ip: ctx.ip,
    metadata: { kind, provider: job.provider, mock: job.mock, cost: job.cost,
      outputs: job.outputAssetIds.length, qaVerdict: job.qaResult ? job.qaResult.verdict : '',
      effectiveRuleHash: built ? built.effectiveRuleHash : '' } });

  return {
    ok: true,
    job: serializeJob(db, job),
    outputs: outputs.map((a) => serializeAsset(a, db)),
    budget,
    providerState: providerResult.state
  };
});

function serializeJob(db, j) {
  const outputs = (j.outputAssetIds || []).map((id) => {
    const a = db.working_assets.find((x) => x.id === id);
    return a ? serializeAsset(a, db) : { id, missing: true };
  });
  return {
    id: j.id, brandCode: j.brandCode, taskId: j.taskId, kind: j.kind,
    dataClass: j.dataClass || 'INTERNAL',
    provider: j.provider, modelId: j.modelId || '',
    skillVersionId: j.skillVersionId || null, templateVersionId: j.templateVersionId || null,
    promptSnapshot: j.promptSnapshot || null,
    status: j.status, mock: !!j.mock,
    providerJobId: j.providerJobId || '', providerUsage: j.providerUsage || {},
    cost: j.cost || null, currency: j.currency || '',
    estimatedCostUsd: j.estimatedCostUsd || 0,
    qaResult: j.qaResult || null,
    outputAssetIds: (j.outputAssetIds || []).slice(),
    outputs,
    outputText: j.appliedToVersionId ? undefined : (j.outputText || undefined),
    appliedToVersionId: j.appliedToVersionId || null,
    errorCode: j.errorCode || '', errorMessage: j.errorMessage || '',
    providerNote: j.providerNote || '', rawStatus: j.rawStatus || '',
    idempotencyKey: j.idempotencyKey || '',
    requestedBy: j.requestedBy,
    createdAt: j.createdAt, startedAt: j.startedAt, finishedAt: j.finishedAt
  };
}

get('/api/mos/generation-jobs', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.generation_jobs.filter((j) => j.brandCode === brandCode);
  if (ctx.query.taskId) rows = rows.filter((j) => j.taskId === String(ctx.query.taskId));
  if (ctx.query.kind) rows = rows.filter((j) => j.kind === String(ctx.query.kind).toUpperCase());
  if (ctx.query.status) rows = rows.filter((j) => j.status === String(ctx.query.status).toUpperCase());
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const paged = helpers.paginate(rows, ctx.query);
  return {
    ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((j) => serializeJob(db, j)),
    spend: { monthToDateUsd: monthSpend(db, brandCode), currency: 'USD' },
    capability: {
      image: imageProvider.capabilities(),
      imageStatus: imageProvider.status(),
      textStatus: textProvider.status(),
      // A-05：Provider 统一契约（health/status/timeout/rateLimit/costReceipt/errorCode）对外可见
      imageHealth: await imageProvider.health(),
      textHealth: await textProvider.health()
    },
    note: '费用只记录供应商**实际回执**；无回执一律留空，不做换汇推算（04 §5）。'
  };
});

get('/api/mos/generation-jobs/:id', async (ctx) => {
  const db = getDb();
  const j = db.generation_jobs.find((x) => x.id === ctx.params.id);
  if (!j) throw httpError(404, '生成作业不存在', 'JOB_NOT_FOUND');
  rbac.assertBrand(ctx.principal, j.brandCode);
  return { ok: true, job: serializeJob(db, j) };
});

module.exports = { serializeAsset, serializeJob, saveAsset, monthSpend, budgetCheck, runQa, generatedExtAllowed };
