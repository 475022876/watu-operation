'use strict';
/**
 * Marketing OS —— 独立数据存储层。
 *
 * 独立成库（ADR-002：从企业 OA 仓库剥离为本工程）：
 *   - 单一数据文件 `<数据目录>/mos.json`，独立 schema 版本（mosSchemaVersion）；
 *   - 落盘策略：唯一临时名 + **回调内同步 renameSync** 原子替换 + 写入序号防回退
 *     （用异步 rename 会让在途旧快照覆盖新快照，详见 docs/BUILD-01_TEST_REPORT.md §7）；
 *   - 单进程 Node 事件循环内写入天然串行。
 *
 * 规模边界：单表单万级、数十~数百人规模原型足够；上生产需替换为真实数据库实现
 * （保持本模块导出接口不变）。
 */
const fs = require('node:fs');
const path = require('node:path');
const { getMosConfig } = require('./config');
const { buildSeed, buildBuild02Seed } = require('./seed');

/** 数据 schema 版本（本工程独立演进）
 *  v1 → BUILD-01（基础 + 策划）
 *  v2 → BUILD-02（AI 创作 + 传播）—— 只增不改：仅新增集合，既有字段语义不变。
 *  v3 → BUILD-03（入库网关 + 分析 + 安全收口）—— **不新增顶级集合**：
 *       `asset_admissions` / `library_asset_refs` 在 v2 已预置为空数组，本版仅固定其字段形状
 *       并对既有集合补形状。因此 v2→v3 是「版本号推进 + 形状补全」，对既有数据零改写风险。
 *  v4 → V0.1 整改 Phase 3（A-01 轻量来源调度）—— 新增 1 个集合 `ingest_jobs`
 *       （采集作业记录：开始/结束/状态/失败理由/下次时间/幂等桶键）+ 使用既有 `settings`
 *       存放单实例调度锁。**只增不改**：既有集合字段与语义零改动。
 *       因此 v3→v4 是「新增空集合 + 版本号推进」，对既有业务数据零改写（可确定性回滚）。
 *  v5 → V1.1 三包整改（真实 Provider 接入状态）：新增 `library_tickets` / `library_event_cursors`
 *       / `library_invalidations` / `library_admission_jobs` 四个集合（只增不改）。
 *  v6 → V0.1.2 Phase A：`users[].prefs`（用户界面偏好；字段级新增，不动既有字段）。
 *  v7 → V0.1.2 Phase B：新增研究域 5 集合（只增不改）。
 *  v8 → V0.1.4：新增 `provider_calls`（Provider 调用账本，滚动 2000 条）。
 *       供应商配置与预算存放在既有 `settings` 的自由对象里（`settings.providers` /
 *       `settings.providerBudget` / `settings.egressPolicy`），**不新增集合形状**。
 *       因此 v7→v8 是「新增一个空集合 + 版本号推进」，对既有业务数据零改写。
 */
const MOS_SCHEMA_VERSION = 8;

const BASE_SHAPE = {
  mosSchemaVersion: MOS_SCHEMA_VERSION,
  /** 品牌（VFIB / UCARD，来自 dict.BRANDS） */
  brands: [],
  /** MOS 本地隔离测试身份（MockIdentityGateway 的事实来源） */
  users: [],
  /** 角色授权：{ id, userId, roleCode, brandScope:['VFIB','UCARD']|['*'] }  —— 可叠加、按品牌独立 */
  user_roles: [],
  /** 会话（Cookie `mos_sid`，HttpOnly） */
  sessions: [],

  /* ---- BUILD-01 领域对象 ---- */
  monthly_plans: [],
  plan_items: [],
  campaigns: [],
  monthly_campaign_links: [],
  master_topics: [],
  campaign_topic_links: [],
  content_tasks: [],
  source_registry: [],
  source_items: [],
  evidence_references: [],

  /* ---- BUILD-02 领域对象（AI 创作 + 传播）---- */
  /** 品牌 Skill 版本登记（未 APPROVED 不得用于正式输出，04 §2） */
  skill_versions: [],
  /** 创意模板（版本锁定，04 §2） */
  creative_templates: [],
  /** 内容版本（冻结后不可覆盖，02 §2 / 03 §2.2） */
  content_versions: [],
  /** 审核单（3 种类型共用一张表，但详情权能由 type 决定，01 §3） */
  review_cases: [],
  /** 审核决策（append-only，02 §2） */
  review_decisions: [],
  /** 工作素材（PRIVATE 默认，02 §2） */
  working_assets: [],
  /** 生成作业（含 prompt 快照 / 成本 / 币种 / QA，04 §1） */
  generation_jobs: [],
  /** 视频工作区产物（脚本/分镜/字幕/关键帧，04 §2） */
  video_artifacts: [],
  /** 官方渠道登记（**不存密码**，05 §2） */
  channels: [],
  /** 发布排期（修改只影响排期，02 §4） */
  publishing_schedules: [],
  /** 实际发布记录（仅人工登记后创建，02 §4 / 05 §3） */
  publication_records: [],
  /** 发布快照（不可覆盖，05 §4） */
  published_artifacts: [],
  /** 更正/替换/撤回事件（追加式，05 §4） */
  publication_corrections: [],
  /** 渠道表现指标（带来源与时间，02 §2 / 05 §4） */
  publication_metrics: [],

  /** BUILD-03 领域对象（入库网关 + 分析）—— v2 已预置空数组，v3 起正式启用 */
  /** 资产入库申请：finalApprovalStatus 与 syncStatus **相互独立**，可复用资格为计算判定（03 §2.4） */
  asset_admissions: [],
  /** 资料库可复用资产引用（Mock 条目一律 MOCK_ 前缀 + permissionValid=false） */
  library_asset_refs: [],

  /* ---- v4 领域对象（V0.1 整改 Phase 3：A-01 轻量来源调度）---- */
  /**
   * 采集作业记录（含 SKIPPED/BLOCKED）。
   * 存在意义：让「已执行过的调度周期」可持久化判定，从而
   *   **进程重启后不会凭空补发大量采集任务**（04 §3 / 02 §5）。
   * 滚动保留最近 500 条（单文件存储边界）。
   */
  ingest_jobs: [],

  /* ---- v7 领域对象（V0.1.2 Phase B：AI 情报研究域；05 §先证明现有模型不能承载再新增）---- */
  /** 研究报告（TRUSTED_DAILY / WEB_RESEARCH；BLOCKED 时不得伪造发现） */
  research_reports: [],
  /** 研究发现（FACT/INTERPRETATION/RECOMMENDATION；无证据不得 VERIFIED） */
  research_findings: [],
  /** 来源证据（URL/哈希/许可/抓取日；每一关键事实映射 1+ 具体证据） */
  source_evidence: [],
  /** 候选选题（AI_RECOMMENDED→…→APPROVED；获批后才建正式 Master Topic，绝不平行建题） */
  topic_proposals: [],
  /** 研究作业记录（WEB_SEARCH 等通道调用；BLOCKED/失败原因如实留痕） */
  research_jobs: [],

  /* ---- v8 领域对象（V0.1.4：真实 Provider 接入与运行治理）---- */
  /**
   * Provider 调用账本（滚动保留 2000 条）。
   * 只记事实：失败即失败；费用只在供应商真实回执时计入，未回执记 unknownCount，**不按单价推算**。
   * 所有字段落库前经过 `secrets.redact()`，密钥不可能进入日志。
   */
  provider_calls: [],
  /**
   * AI 视频渲染作业（异步任务式供应商：提交 → 轮询 → 下载）。
   * 与 `video_artifacts`（手工脚本/分镜/成片）**分离**：渲染作业失败或未完成时，
   * 不得改动手工产物状态；成片下载成功后才由人工决定是否挂到任务的 finalAssetId。
   */
  video_render_jobs: [],

  /* ---- v5 领域对象（V1.1 三包整改 B2/B3：真实 Provider 接入状态）---- */
  /**
   * 受限用户票据缓存（服务账户为真实用户换取）。
   * 关键约束（Provider `SERVICE_AUTH_HANDOFF.md` §2.5）：票据与**签发它的服务账户绑定**，
   * 因此缓存键必须包含 keyId，**不得**在多个服务账户之间复用同一票据。
   */
  library_tickets: [],
  /** 变更事件轮询游标（按品牌持久化，重启续传；`truncated` 触发全量重验） */
  library_event_cursors: [],
  /** 由变更事件推导出的**缓存失效登记**（资产撤回/停用、Skill 版本变更、权限变更） */
  library_invalidations: [],
  /**
   * 正式资产入库作业记录（幂等提交 / 有界重试 / 失败查询）。
   * 一个本地准入申请对应至多一条；`idempotencyKey` 在整条生命周期内**保持不变**。
   */
  library_admission_jobs: [],

  /** append-only 审计事件 */
  audit_events: [],
  /** 业务编码自增序号 */
  seq: {},
  settings: {},
  /** 首次初始化时输出一次的管理员初始口令（落盘后立即删除） */
  _initialPasswordOnce: null
};

let db = null;
let dirty = false;
let writing = false;
let again = false;
let timer = null;
let writeSeq = 0;
let appliedSeq = 0;

function dataFile() {
  return getMosConfig().dataFile;
}

function tmpPathFor(seq) {
  return dataFile() + '.' + process.pid + '.' + seq + '.tmp';
}

function cleanupStaleTmp() {
  const file = dataFile();
  const dir = path.dirname(file);
  const base = path.basename(file) + '.';
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  const now = Date.now();
  for (const name of names) {
    if (name.indexOf(base) !== 0 || !/\.tmp$/.test(name)) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      if (now - st.mtimeMs > 60000) fs.unlinkSync(path.join(dir, name));
    } catch (_) { /* 忽略 */ }
  }
}

function emptyShape() {
  const out = {};
  for (const key of Object.keys(BASE_SHAPE)) {
    const v = BASE_SHAPE[key];
    out[key] = Array.isArray(v) ? [] : (v && typeof v === 'object' ? Object.assign({}, v) : v);
  }
  out.mosSchemaVersion = MOS_SCHEMA_VERSION;
  return out;
}

function persistSync() {
  const seq = ++writeSeq;
  const tmp = tmpPathFor(seq);
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, dataFile());
  appliedSeq = seq;
}

function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = null; flush(); }, 60);
  if (timer.unref) timer.unref();
}

function flush() {
  if (writing) { again = true; return; }
  if (!dirty) return;
  writing = true;
  dirty = false;
  again = false;

  const snapshot = JSON.stringify(db, null, 2);
  const seq = ++writeSeq;
  const tmp = tmpPathFor(seq);

  fs.writeFile(tmp, snapshot, 'utf8', (err) => {
    writing = false;
    if (err) {
      console.error('[mos-store] 数据写入失败：' + err.message);
      dirty = true;
      schedule();
      return;
    }
    if (seq < appliedSeq) { // 已有更新的快照落地：丢弃本次，绝不回退
      fs.unlink(tmp, () => { /* ignore */ });
      if (dirty || again) { dirty = true; schedule(); }
      return;
    }
    // 关键：用「同步 rename」把校验与替换收口为原子动作。
    // 若沿用异步 rename，则可能出现：本回调先通过 seq 校验并排队 rename，随后
    // 停服 saveNow() 同步写入更新快照，最后排队的旧 rename 落地 → 旧快照覆盖新快照（丢数据）。
    try {
      fs.renameSync(tmp, dataFile());
      if (seq > appliedSeq) appliedSeq = seq;
    } catch (renameErr) {
      console.error('[mos-store] 原子替换失败：' + renameErr.message);
    }
    if (dirty || again) { dirty = true; schedule(); }
  });
}

/**
 * 迁移：保证「首次初始化」与「历史库升级」得到完全一致的形状。
 *
 * v1 → v2（BUILD-02）：**只增不改**。新增 skill_versions / creative_templates /
 *   content_versions / review_cases / review_decisions / working_assets / generation_jobs /
 *   video_artifacts / channels / publishing_schedules / publication_records /
 *   published_artifacts / publication_corrections / publication_metrics /
 *   asset_admissions / library_asset_refs 共 16 个集合并补为空数组；
 *   既有集合（品牌/用户/计划/Campaign/Topic/任务/来源/证据/审计）**字段与语义零改动**。
 * 回滚：停服后还原 `data/mos.json.bak-*` 备份，或删除上述新增集合字段（v1 代码可继续读）。
 * v2 → v3（BUILD-03）：**不新增顶级集合**（asset_admissions / library_asset_refs 已在 v2 预置），
 *   仅靠通用形状补全把两个集合的确切形状固定下来；不需要补种演示数据
 *   （08 §6：不预置任何"已批准资产"）。因此本步对既有数据零改写。
 * v3 → v4（V0.1 整改 Phase 3）：**新增 1 个空集合** `ingest_jobs`（采集作业记录）。
 *   仅由通用形状补全完成，不补种任何演示作业；既有集合零改写。
 *   回滚：停服后删除 `data/mos.json` 的 `ingest_jobs` 字段并把 `mosSchemaVersion` 改回 3
 *   （或整体还原 `data/mos.json.bak-*` 备份）—— 旧版代码不读该集合，可直接运行。
 * v4 → v5（V1.1 三包整改 B2/B3）：**新增 4 个空集合**
 *   `library_tickets` / `library_event_cursors` / `library_invalidations` / `library_admission_jobs`；
 *   并对既有 `asset_admissions` 行做**保守字段回填**（B1 第 4 条）：
 *     · `libraryPrimaryCategory = null`（缺省不猜，需人工选择七大资料区之一）
 *     · `classification = null`          （**绝不猜测降级**；需人工选择密级）
 *     · `licenseStatus = 'unknown'`      （历史自由文本 `INTERNAL_DRAFT` 等**一律不映射为 cleared**）
 *     · `licenseLegacyText` 保留原始文本以便人工核定，`needsManualReview = true`
 *   **回滚**：停服后还原 `data/mos.json.bak-*`；或把 `mosSchemaVersion` 改回 4 并删除上述
 *   4 个集合字段（v4 代码不读它们，可继续运行；回填后的准入字段是**新增**字段，不影响 v4 读取）。
 * 后续版本在此追加分支，**只增不改**既有字段语义。
 */
function migrate(database) {
  let changed = false;
  const priorVersion = Number(database.mosSchemaVersion) || 0;

  for (const key of Object.keys(BASE_SHAPE)) {
    const want = BASE_SHAPE[key];
    if (Array.isArray(want)) {
      if (!Array.isArray(database[key])) { database[key] = []; changed = true; }
    } else if (want && typeof want === 'object' && !Array.isArray(want)) {
      if (!database[key] || typeof database[key] !== 'object' || Array.isArray(database[key])) {
        database[key] = Object.assign({}, want);
        changed = true;
      }
    } else if (database[key] === undefined) {
      database[key] = want;
      changed = true;
    }
  }

  // v1 → v2 演示数据补种：只在「确实是从旧库升上来」且开启 demoSeed 且集合为空时补入。
  // 已经在 v2 的库不触碰 —— 否则用户主动清空渠道后会被静默复活（见 BUILD-02 自检 A-10）。
  // 说明：渠道必须存在且 ENABLED，排期/发布页才可操作，故升级路径需要与全新初始化对齐。
  if (priorVersion > 0 && priorVersion < 2) {
    const cfg = getMosConfig();
    if (cfg.demoSeed) {
      const seed = buildBuild02Seed();
      for (const key of ['skill_versions', 'creative_templates', 'channels']) {
        const want = seed[key];
        if (Array.isArray(want) && want.length && Array.isArray(database[key]) && database[key].length === 0) {
          database[key] = want;
          changed = true;
        }
      }
    }
  }

  if (Number(database.mosSchemaVersion) < MOS_SCHEMA_VERSION) {
    database.mosSchemaVersion = MOS_SCHEMA_VERSION;
    changed = true;
  }

  /* v4 → v5 保守字段回填（B1 第 4 条「历史迁移规则」）。
   * 原则：**宁可标记待人工核定，也不猜测**。
   *   · 许可：自由文本绝不映射为 `cleared`；一律 `unknown` 并保留原文供人工核定。
   *   · 密级：不猜测（留 null），避免把受限资料误降到 internal。
   *   · 资料区：不猜测（留 null），资料区语义只有 Provider 有权威。
   * 幂等：只对**尚未带 v5 字段标记**的行执行一次。 */
  if (priorVersion > 0 && priorVersion < 5 && Array.isArray(database.asset_admissions)) {
    for (const a of database.asset_admissions) {
      if (!a || typeof a !== 'object') continue;
      if (a.admissionFieldsSchema >= 5) continue;
      const legacyLicense = String((a.submissionMetadata && a.submissionMetadata.license) || '').trim();
      a.libraryPrimaryCategory = a.libraryPrimaryCategory || null;
      a.librarySubcategory = a.librarySubcategory || null;
      a.classification = a.classification || null;
      a.licenseStatus = a.licenseStatus || 'unknown';
      a.licenseLegacyText = a.licenseLegacyText || (legacyLicense ? legacyLicense.toUpperCase() : '');
      a.reuseScope = a.reuseScope || 'none';
      a.aiReusePolicy = a.aiReusePolicy || 'blocked';
      a.externalAiTransferPolicy = a.externalAiTransferPolicy || 'blocked';
      a.needsManualReview = true;
      a.manualReviewReasons = ['libraryPrimaryCategory 待人工选择', 'classification 待人工核定',
        'licenseStatus 由历史自由文本保守转为 unknown，待人工核定'];
      a.admissionFieldsSchema = 5;
      a.updatedAt = a.updatedAt || new Date().toISOString();
      changed = true;
    }
  }

  /* v5 → v6（V0.1.2 Phase A）：用户偏好字段（i18n locale / 继续上次工作）。
   * 只增不改：仅给缺 prefs 的用户补一个空对象，绝不覆盖既有取值；
   * locale 缺省 null = 未设置（前端回落 zh-CN 组织默认）。幂等：有 prefs 即跳过。 */
  if (priorVersion > 0 && priorVersion < 6 && Array.isArray(database.users)) {
    for (const u of database.users) {
      if (!u || typeof u !== 'object') continue;
      if (u.prefs && typeof u.prefs === 'object') continue;
      u.prefs = { locale: null, lastTaskId: null };
      changed = true;
    }
  }

  /* v6 → v7（V0.1.2 Phase B）：研究域 4 集合。
   * load() 已用 BASE_SHAPE 兜底补齐空集合；此处仅为**显式审计点**（幂等，无字段改写）。 */
  if (priorVersion > 0 && priorVersion < 7) {
    for (const k of ['research_reports', 'research_findings', 'source_evidence', 'topic_proposals', 'research_jobs']) {
      if (!Array.isArray(database[k])) { database[k] = []; changed = true; }
    }
  }

  return changed;
}

function validateDatabase(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || !Number.isInteger(parsed.mosSchemaVersion) || parsed.mosSchemaVersion < 1
    || parsed.mosSchemaVersion > MOS_SCHEMA_VERSION) throw new Error('UNSUPPORTED_SCHEMA');
  // Do not silently replace corrupt schema8 collections with empty arrays.
  if (parsed.mosSchemaVersion === MOS_SCHEMA_VERSION) {
    for (const [key, shape] of Object.entries(BASE_SHAPE)) {
      if (Array.isArray(shape) && !Array.isArray(parsed[key])) throw new Error('INVALID_COLLECTION');
      if (shape && typeof shape === 'object' && !Array.isArray(shape)
        && (!parsed[key] || typeof parsed[key] !== 'object' || Array.isArray(parsed[key]))) throw new Error('INVALID_OBJECT');
    }
  }
}
function load() {
  const cfg = getMosConfig();
  const dir = path.dirname(cfg.dataFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(cfg.dataFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cfg.dataFile, 'utf8'));
      validateDatabase(parsed);
      db = Object.assign(emptyShape(), parsed);
      delete db._initialPasswordOnce;
      delete db._demoCredentialsOnce;
      // Existing valid schema8 loads are read-only; older supported schemas retain
      // the legacy migration function, never used on production by Phase2 tests.
      if (parsed.mosSchemaVersion < MOS_SCHEMA_VERSION && migrate(db)) persistSync();
      console.log('[mos-store] 已加载 Marketing OS 数据库：' + cfg.dataFile);
      return db;
    } catch (_) {
      db = null;
      const error = new Error('Marketing OS 数据库读取或完整性检查失败，已安全阻断；原文件保持不变，请按授权恢复流程处理。');
      error.code = 'MOS_DATABASE_LOAD_BLOCKED';
      throw error;
    }
  }
  cleanupStaleTmp();

  db = buildSeed();
  migrate(db);
  // 引导口令与 DEMO 凭据只在内存中打印一次，**绝不落盘**（SEC：不落日志、不落数据文件）
  if (db._initialPasswordOnce) {
    console.log('');
    console.log('  ============================================================');
    console.log('  Marketing OS 引导账号：mosadmin');
    const creds = db._demoCredentialsOnce || [];
    const adminCred = creds.find((c) => c.username === 'mosadmin');
    console.log('  初始密码（仅显示这一次，请立即抄写）：' + (adminCred ? adminCred.password : db._initialPasswordOnce));
    console.log('  首次登录后将强制要求修改密码。');
    console.log('  ============================================================');
    console.log('');
  }
  if (Array.isArray(db._demoCredentialsOnce) && db._demoCredentialsOnce.length) {
    console.log('  ------------------------------------------------------------');
    console.log('  【DEMO 演示账号】仅用于沙盒演示，生产环境请勿启用：');
    for (const c of db._demoCredentialsOnce) {
      console.log('    ' + c.username + '  /  ' + c.password + '   （' + c.note + '）');
    }
    console.log('  ------------------------------------------------------------');
    console.log('');
  }
  delete db._initialPasswordOnce;
  delete db._demoCredentialsOnce;
  persistSync();
  console.log('[mos-store] 首次运行，已生成 Marketing OS 数据库');
  return db;
}

function getDb() {
  if (!db) load();
  return db;
}

function save() {
  dirty = true;
  schedule();
}

function saveNow() {
  if (!db) return;
  dirty = false;
  if (timer) { clearTimeout(timer); timer = null; }
  try { persistSync(); } catch (err) { console.error('[mos-store] 同步落盘失败：' + err.message); }
}

// H03: adapted from remediation 1f0f1f0. Only explicitly wrapped synchronous
// business operations are transactional; other save() paths retain legacy semantics.
let mutationActive = false;
function atomicMutation(fn) {
  if (mutationActive || typeof fn !== 'function' || fn.constructor.name === 'AsyncFunction') {
    throw new Error('SYNCHRONOUS_TRANSACTION_REQUIRED');
  }
  const target = getDb();
  const before = JSON.stringify(target);
  const wasDirty = dirty;
  mutationActive = true;
  try {
    const result = fn();
    if (result && typeof result.then === 'function') throw new Error('ASYNC_TRANSACTION_NOT_ALLOWED');
    persistSync(); // A successful HTTP response may follow only after rename succeeds.
    dirty = false;
    if (timer) { clearTimeout(timer); timer = null; }
    return result;
  } catch (err) {
    for (const key of Object.keys(target)) delete target[key];
    Object.assign(target, JSON.parse(before));
    dirty = wasDirty;
    if (timer) { clearTimeout(timer); timer = null; }
    if (wasDirty) schedule();
    throw err;
  } finally {
    mutationActive = false;
  }
}

/** 测试/维护用：丢弃内存态（下次 getDb 重新读取） */
function reset() {
  db = null;
  dirty = false;
}

module.exports = { getDb, load, save, saveNow, atomicMutation, reset, migrate, MOS_SCHEMA_VERSION, BASE_SHAPE };
