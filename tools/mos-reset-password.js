#!/usr/bin/env node
'use strict';
/**
 * Marketing OS —— 口令重置维护工具（离线使用，必须先停服）。
 *
 * 为什么需要它：
 *   初始口令只在首次初始化时打印一次，且**不落盘**（scrypt 单向哈希，不可逆推）。
 *   一旦那一次终端输出丢失，只能重置——本脚本让你在**保留全部业务数据**的前提下
 *   重新写入指定账号的口令，而不是删除 data/mos.json 重新初始化。
 *
 * 用法：
 *   node tools/mos-reset-password.js <账号> <新口令> [<账号> <新口令> ...]
 *   node tools/mos-reset-password.js --data-dir <目录> mosadmin <新口令>
 *   node tools/mos-reset-password.js --rename <旧账号>:<新账号> [<账号> <新口令> ...]
 *
 * 行为：
 *   - 直接读写 <数据目录>/mos.json，**不启动服务**（务必先停服，否则内存态会覆盖本次修改）；
 *   - 复用 lib/password.js 的 scrypt 方案，与线上写入完全一致；
 *   - 写入采用「唯一临时名 + 同步 rename」原子替换，失败不破坏原文件；
 *   - 自动吊销被重置账号的既有会话，并为其写一条审计事件；
 *   - 只打印账号名与结果，**绝不打印口令哈希**。
 *
 * 改名（--rename）：
 *   - **只改登录名，用户 ID 与全部角色授权（user_roles）保持不变**，因此权限不会丢失；
 *   - 同步更新 externalIdentityId（`local:<账号>`），避免本地身份映射与实际账号脱节；
 *   - 旧账号名随后立即失效；被改名账号的既有会话一并吊销；
 *   - 新账号名需满足与新建账号相同的规则：3-40 位字母/数字/点/下划线/连字符，且不得与他人重名；
 *   - 改名**先于**口令重置执行，因此可写 `--rename mosadmin:admin admin <新口令>`。
 */
const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('../lib/password');

function fatal(msg) {
  console.error('[mos-reset-password] ' + msg);
  process.exit(1);
}

/** 与 lib/mos/adapters/identity.js upsertUser() 保持同一套账号名规则 */
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;

function parseArgs(argv) {
  let dataDir = null;
  const pairs = [];
  const renames = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--data-dir') {
      dataDir = argv[i + 1];
      i += 1;
    } else if (a === '--rename') {
      renames.push(argv[i + 1]);
      i += 1;
    } else if (a === '-h' || a === '--help') {
      console.log('用法: node tools/mos-reset-password.js [--data-dir <目录>] [--rename <旧账号>:<新账号>]... <账号> <新口令> [...]');
      process.exit(0);
    } else {
      pairs.push(a);
    }
  }
  return { dataDir, pairs, renames };
}

/** 改名：保留 id 与角色授权，仅改登录名与本地身份映射 */
function applyRename(db, spec) {
  const raw = String(spec || '');
  const sep = raw.indexOf(':');
  const from = sep === -1 ? raw.trim() : raw.slice(0, sep).trim();
  const to = sep === -1 ? '' : raw.slice(sep + 1).trim();
  if (!from || !to) return { from, to, ok: false, reason: '写法应为 <旧账号>:<新账号>' };
  if (!USERNAME_RE.test(to)) {
    return { from, to, ok: false, reason: '新账号名需为 3-40 位字母/数字/点/下划线/连字符' };
  }
  const user = db.users.find((u) => String(u.username).toLowerCase() === from.toLowerCase());
  if (!user) return { from, to, ok: false, reason: '旧账号不存在' };
  if (from.toLowerCase() === to.toLowerCase()) return { from, to, ok: true, noop: true };
  const taken = db.users.find((u) => u !== user && String(u.username).toLowerCase() === to.toLowerCase());
  if (taken) return { from, to, ok: false, reason: '新账号名已被占用（' + taken.username + '）' };

  const before = user.username;
  user.username = to;
  if (typeof user.externalIdentityId === 'string' && user.externalIdentityId.indexOf('local:') === 0) {
    user.externalIdentityId = 'local:' + to;   // 本地 Mock 身份映射随账号名同步
  }
  const beforeSessions = (db.sessions || []).length;
  db.sessions = (db.sessions || []).filter((s) => s.userId !== user.id);   // 旧名会话失效
  db.audit_events = db.audit_events || [];
  db.audit_events.push({
    id: 'aud_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    timestamp: new Date().toISOString(),
    actorId: '',
    eventType: 'auth.username.renamed',
    objectType: 'user',
    objectId: user.id,
    outcome: 'ok',
    metadata: { from: before, to, via: 'tools/mos-reset-password.js', revokedSessions: beforeSessions - db.sessions.length }
  });
  return { from: before, to, ok: true, revokedSessions: beforeSessions - db.sessions.length };
}

function main() {
  const { dataDir, pairs, renames } = parseArgs(process.argv.slice(2));
  if (!pairs.length && !renames.length) {
    fatal('没有任何操作：需要成对的 <账号> <新口令>，或用 --rename <旧账号>:<新账号>。加 --help 看用法。');
  }
  if (pairs.length % 2 !== 0) {
    fatal('参数数量不对：需要成对的 <账号> <新口令>（可多组）。加 --help 看用法。');
  }
  const dir = path.resolve(dataDir || process.env.MOS_DATA_DIR || path.join(__dirname, '..', 'data'));
  const file = path.join(dir, 'mos.json');
  if (!fs.existsSync(file)) fatal('找不到数据文件：' + file);

  let db;
  try {
    db = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    fatal('数据文件解析失败：' + err.message);
  }
  if (!Array.isArray(db.users)) fatal('数据文件缺少 users 数组，拒绝操作。');

  // ---- 改名先行（这样随后的口令重置可直接用新账号名） ----
  const renameResults = [];
  for (const spec of renames) {
    const r = applyRename(db, spec);
    renameResults.push(r);
    if (!r.ok) fatal('改名失败（' + r.from + ' → ' + r.to + '）：' + r.reason + '。未写入文件。');
  }

  const requests = [];
  for (let i = 0; i < pairs.length; i += 2) {
    const username = String(pairs[i]).trim();
    const password = String(pairs[i + 1]);
    if (password.length < 8) fatal('新口令至少 8 位（account=' + username + '）');
    requests.push({ username, password });
  }

  const results = [];
  for (const r of requests) {
    const user = db.users.find((u) => String(u.username).toLowerCase() === r.username.toLowerCase());
    if (!user) { results.push({ username: r.username, ok: false, reason: '账号不存在' }); continue; }
    const h = hashPassword(r.password);
    user.salt = h.salt;
    user.passwordHash = h.hash;
    user.mustChangePassword = false;                 // 由运维显式重置，视为已完成首登改密
    user.passwordChangedAt = new Date().toISOString();
    const before = (db.sessions || []).length;
    db.sessions = (db.sessions || []).filter((s) => s.userId !== user.id);  // 吊销既有会话
    db.audit_events = db.audit_events || [];
    db.audit_events.push({
      id: 'aud_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      timestamp: new Date().toISOString(),
      actorId: '',
      eventType: 'auth.password.reset',
      objectType: 'user',
      objectId: user.id,
      outcome: 'ok',
      metadata: { username: user.username, via: 'tools/mos-reset-password.js', revokedSessions: before - db.sessions.length }
    });
    results.push({ username: user.username, ok: true, revokedSessions: before - db.sessions.length });
  }

  if (!results.some((r) => r.ok) && !renameResults.some((r) => r.ok && !r.noop)) {
    for (const r of results) console.error('[mos-reset-password] ' + r.username + ' 失败:' + r.reason);
    fatal('没有任何账号被更新，未写入文件。');
  }

  const tmp = file + '.' + process.pid + '.reset.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, file);

  console.log('[mos-reset-password] 已更新：' + file);
  for (const r of renameResults) {
    if (r.noop) console.log('  = ' + r.from + '  →  ' + r.to + '  （同名，跳过）');
    else console.log('  ⤳ ' + r.from + '  →  ' + r.to + '  已改名（保留 ID 与角色授权，吊销会话 ' + r.revokedSessions + ' 个）');
  }
  for (const r of results) {
    if (r.ok) console.log('  ✔ ' + r.username + '  口令已重置（吊销会话 ' + r.revokedSessions + ' 个）');
    else console.log('  ✗ ' + r.username + '  跳过：' + r.reason);
  }
}

main();
