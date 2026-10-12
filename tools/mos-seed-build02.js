#!/usr/bin/env node
'use strict';
/**
 * BUILD-02 演示集合补种工具（Skill 登记 / 创意模板 / 渠道登记）。
 *
 * 为什么需要它：
 *   schema v1 → v2 的**升级路径**会补种这三个集合（store.migrate），但若某个库在补种逻辑
 *   上线**之前**就已经迁移到 v2（三集合为空），此后就再也不会被自动补种了（migrate 有意
 *   不在已 v2 的库上复活数据，避免用户清空后又被静默写回）。本工具用于显式补齐这种库。
 *
 * 安全约束：
 *   - 只补 `skill_versions` / `creative_templates` / `channels` 三个集合，且**仅在集合为空时**；
 *     任何非空集合一律跳过并说明，绝不覆盖既有登记数据。
 *   - 补入的记录全部带 `demo:true`，不包含任何已批准资产、发布记录或真实监管结论。
 *   - 必须**先停服**：store 在内存中持有 db，运行中的进程会在下次落盘时覆盖本次修改。
 *   - 写盘采用 唯一临时名 + rename 原子替换，并在覆盖前生成 `.bak-<时间戳>` 备份。
 *
 * 用法：
 *   node tools/mos-seed-build02.js [--data-dir <目录>] [--dry-run] [--force]
 */

const fs = require('node:fs');
const path = require('node:path');
const { buildBuild02Seed } = require('../lib/mos/seed');

const COLLECTIONS = ['skill_versions', 'creative_templates', 'channels'];

function parseArgs(argv) {
  let dataDir = null;
  let dryRun = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--data-dir') { dataDir = argv[++i]; }
    else if (a === '--dry-run') { dryRun = true; }
    else if (a === '--force') { force = true; }
    else if (a === '--help' || a === '-h') {
      console.log('用法: node tools/mos-seed-build02.js [--data-dir <目录>] [--dry-run] [--force]');
      process.exit(0);
    } else {
      console.error('未知参数：' + a);
      process.exit(2);
    }
  }
  return { dataDir, dryRun, force };
}

function main() {
  const { dataDir, dryRun, force } = parseArgs(process.argv.slice(2));
  const dir = path.resolve(dataDir || process.env.MOS_DATA_DIR || path.join(__dirname, '..', 'data'));
  const file = path.join(dir, 'mos.json');

  if (!fs.existsSync(file)) {
    console.error('[seed-build02] 找不到数据文件：' + file);
    process.exit(1);
  }

  let db;
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error('[seed-build02] 数据文件解析失败：' + err.message);
    process.exit(1);
  }

  const version = Number(db.mosSchemaVersion) || 0;
  if (version < 2 && !force) {
    console.error('[seed-build02] 该库 schemaVersion=' + version + '（< 2），请先由服务启动触发 v1→v2 迁移'
      + '（会自动补种），或加 --force 强制补种。');
    process.exit(1);
  }

  const plan = [];
  const seed = buildBuild02Seed();
  for (const key of COLLECTIONS) {
    const rows = seed[key] || [];
    const existing = Array.isArray(db[key]) ? db[key] : null;
    if (existing === null) {
      plan.push({ key, action: 'CREATE', count: rows.length });
    } else if (existing.length > 0) {
      plan.push({ key, action: 'SKIP', count: existing.length, reason: '集合非空，拒绝覆盖' });
    } else {
      plan.push({ key, action: 'FILL', count: rows.length });
    }
  }

  console.log('[seed-build02] 数据文件：' + file);
  console.log('[seed-build02] schemaVersion=' + version + '，计划：');
  for (const p of plan) {
    console.log('  - ' + p.key + ' : ' + p.action + ' (' + p.count + ')'
      + (p.reason ? ' —— ' + p.reason : ''));
  }

  const todo = plan.filter((p) => p.action !== 'SKIP');
  if (!todo.length) {
    console.log('[seed-build02] 三个集合均已非空，无需补种。');
    return;
  }
  if (dryRun) {
    console.log('[seed-build02] --dry-run：未写入任何内容。');
    return;
  }

  for (const p of plan) {
    if (p.action === 'SKIP') continue;
    db[p.key] = seed[p.key];
  }

  // 备份 → 唯一临时名写入 → 原子替换
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const backup = file + '.bak-' + stamp;
  fs.copyFileSync(file, backup);

  const tmp = file + '.' + process.pid + '.seedtmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, file);

  console.log('[seed-build02] 已补种：' + todo.map((p) => p.key).join(', '));
  console.log('[seed-build02] 备份：' + backup);
  console.log('[seed-build02] 提示：请重启服务使内存中的 db 重新加载。');
}

main();
