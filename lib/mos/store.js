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
const { buildSeed } = require('./seed');

/** 数据 schema 版本（本工程独立演进） */
const MOS_SCHEMA_VERSION = 1;

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
  /** BUILD-02/03 预置空集合（不建业务逻辑，仅占位以固定 schema 形状） */
  content_versions: [],
  review_cases: [],
  review_decisions: [],
  working_assets: [],
  generation_jobs: [],

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
 * 当前为 v1（首版）；后续版本在此追加分支，**只增不改**既有字段语义。
 */
function migrate(database) {
  let changed = false;

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

module.exports = { getDb, load, save, saveNow, reset, MOS_SCHEMA_VERSION, BASE_SHAPE };
