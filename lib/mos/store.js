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
 */
const MOS_SCHEMA_VERSION = 3;

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
  return changed;
}

function load() {
  const cfg = getMosConfig();
  const dir = path.dirname(cfg.dataFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  cleanupStaleTmp();

  if (fs.existsSync(cfg.dataFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(cfg.dataFile, 'utf8'));
      db = Object.assign(emptyShape(), parsed);
      // 防御：早期版本若误将一次性凭据落盘，此处立即清除，避免再次写出
      delete db._initialPasswordOnce;
      delete db._demoCredentialsOnce;
      if (migrate(db)) persistSync();
      console.log('[mos-store] 已加载 Marketing OS 数据库：' + cfg.dataFile);
      return db;
    } catch (err) {
      const backup = cfg.dataFile + '.broken-' + Date.now();
      console.error('[mos-store] mos.json 解析失败（' + err.message + '），已备份为 ' + backup + ' 并重建');
      try { fs.renameSync(cfg.dataFile, backup); } catch (_) { /* ignore */ }
    }
  }

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

/** 测试/维护用：丢弃内存态（下次 getDb 重新读取） */
function reset() {
  db = null;
  dirty = false;
}

module.exports = { getDb, load, save, saveNow, reset, migrate, MOS_SCHEMA_VERSION, BASE_SHAPE };
