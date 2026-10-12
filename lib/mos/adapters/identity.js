'use strict';
/**
 * MockIdentityGateway —— 本地隔离测试身份（06 §1）。
 *
 * ⚠ MOCK 声明：本适配器**不是**企业 OA/SSO 的真实身份源。接口形态按 06 §2 的
 *   `IdentityGateway` 契约设计，未来接入真实 OIDC/SSO 时**只替换本文件**，
 *   上层（rbac / routes）不改。
 *
 * 隔离要点：
 *   - 独立会话 Cookie `mos_sid`（HttpOnly），本工程自有，不与任何外部系统共享；
 *   - 独立会话表在 `mos.json`；
 *   - 密码用既有 scrypt 方案（lib/password.js），不存明文。
 */
const { getDb, save, saveNow } = require('../store');
const { getMosConfig } = require('../config');
const { hashPassword, verifyPassword, randomToken } = require('../../password');
const { uid } = require('../ids');
const { appendAudit } = require('../audit');
const { principalOf } = require('../rbac');

const MOCK = true;
const COOKIE_NAME = 'mos_sid';
const SESSION_HOURS = 12;
const MAX_LOGIN_FAILS_PER_ACCOUNT = 10;
const MAX_LOGIN_FAILS_PER_IP = 40;
const WINDOW_MS = 15 * 60 * 1000;

function pruneSessions(db) {
  const now = Date.now();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.expiresAt > now);
  return before !== db.sessions.length;
}

function createSession(user, meta) {
  const db = getDb();
  pruneSessions(db);
  const now = Date.now();
  const token = randomToken(32);
  db.sessions.push({
    token,
    userId: user.id,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + SESSION_HOURS * 3600 * 1000,
    ip: (meta && meta.ip) || '',
    userAgent: (meta && meta.userAgent) || ''
  });
  const mine = db.sessions.filter((s) => s.userId === user.id);
  if (mine.length > 8) {
    mine.sort((a, b) => b.createdAt - a.createdAt);
    const drop = new Set(mine.slice(8).map((s) => s.token));
    db.sessions = db.sessions.filter((s) => !drop.has(s.token));
  }
  /**
   * 安全关键写入：会话**立即同步落盘**，不走 60ms 合并窗口。
   * 原因（BUILD-03 实测 A-26）：合并窗口内的写入在进程被**硬终止**时会丢失，
   * 而 Windows 上 `kill('SIGTERM')` 即硬终止（SIGTERM 处理器不会执行）。
   * 登录/登出是低频且安全相关的状态，必须立即持久化：
   *   - 登录后丢会话 → 用户刚登录就掉线；
   *   - 登出后丢写 → 已注销的会话在重启后"复活"（更严重）。
   */
  saveNow();
  return token;
}

function destroySession(token) {
  if (!token) return;
  const db = getDb();
  const before = db.sessions.length;
  db.sessions = db.sessions.filter((s) => s.token !== token);
  if (db.sessions.length !== before) saveNow(); // 注销必须立刻持久化，否则会话可能"复活"
}

/**
 * 解析请求会话。
 * @returns {{ user:object|null, source:'cookie'|'none' }}
 */
function resolveSession(req) {
  const db = getDb();
  const token = req._mosToken || '';
  if (!token) return { user: null, source: 'none' };
  const session = db.sessions.find((s) => s.token === token);
  if (!session) return { user: null, source: 'none' };
  if (session.expiresAt <= Date.now()) {
    destroySession(token);
    return { user: null, source: 'none' };
  }
  const user = db.users.find((u) => u.id === session.userId && u.status === 'active');
  if (!user) return { user: null, source: 'none' };
  session.lastSeenAt = Date.now();
  return { user, source: 'cookie' };
}

/** 失败计数（基于审计事件，天然持久化） */
function recentFailures(db, key, now) {
  return (db.audit_events || []).filter((e) =>
    e.eventType === 'auth.login.failed' && e.metadata && e.metadata.failKey === key
    && (now - new Date(e.timestamp).getTime()) < WINDOW_MS).length;
}

/**
 * 校验账号口令。
 * @returns {{ user?:object, error?:string, code?:string }}
 */
function authenticate(username, password, ip) {
  const db = getDb();
  const uname = String(username || '').trim();
  const now = Date.now();

  if (recentFailures(db, 'acct:' + uname, now) >= MAX_LOGIN_FAILS_PER_ACCOUNT) {
    appendAudit({ eventType: 'auth.login.blocked', outcome: 'denied', ip: ip || '', metadata: { failKey: 'acct:' + uname, reason: 'ACCOUNT_LOCKED' } });
    return { error: '尝试次数过多，请 15 分钟后再试', code: 'TOO_MANY_ATTEMPTS' };
  }
  if (recentFailures(db, 'ip:' + (ip || 'unknown'), now) >= MAX_LOGIN_FAILS_PER_IP) {
    appendAudit({ eventType: 'auth.login.blocked', outcome: 'denied', ip: ip || '', metadata: { failKey: 'ip:' + (ip || 'unknown'), reason: 'IP_LOCKED' } });
    return { error: '当前网络登录尝试过多，请稍后再试', code: 'TOO_MANY_ATTEMPTS' };
  }

  const user = db.users.find((u) => String(u.username).toLowerCase() === uname.toLowerCase());
  if (!user || !verifyPassword(password, user.salt, user.passwordHash)) {
    appendAudit({ eventType: 'auth.login.failed', outcome: 'denied', ip: ip || '', metadata: { failKey: 'acct:' + uname } });
    appendAudit({ eventType: 'auth.login.failed', outcome: 'denied', ip: ip || '', metadata: { failKey: 'ip:' + (ip || 'unknown') } });
    return { error: '账号或密码不正确', code: 'BAD_CREDENTIALS' };
  }
  if (user.status !== 'active') {
    return { error: '账号已被停用', code: 'ACCOUNT_DISABLED' };
  }
  user.lastLoginAt = new Date().toISOString();
  save();
  appendAudit({ actorId: user.id, eventType: 'auth.login.succeeded', outcome: 'ok', ip: ip || '', metadata: { username: user.username } });
  return { user };
}

/**
 * IdentityGateway 契约方法（06 §2）：当前用户主体。
 * 真实接入时改由 IdP 校验 token 并返回同构 principal。
 */
function currentUser(req) {
  const r = resolveSession(req);
  if (!r.user) return null;
  return principalOf(getDb(), r.user);
}

/** 契约方法：动作鉴权（rbac.check 的别名，供未来 IdP 侧策略替换） */
function check(principal, action, scope) {
  const { can } = require('../rbac');
  return can(principal, action, scope && scope.brandCode);
}

function changePassword(userId, oldPassword, newPassword) {
  const db = getDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { error: '账号不存在' };
  if (!verifyPassword(oldPassword, user.salt, user.passwordHash)) return { error: '当前密码不正确', code: 'BAD_OLD_PASSWORD' };
  const np = String(newPassword || '');
  if (np.length < 8) return { error: '新密码至少 8 位', code: 'WEAK_PASSWORD' };
  const h = hashPassword(np);
  user.salt = h.salt;
  user.passwordHash = h.hash;
  user.mustChangePassword = false;
  user.passwordChangedAt = new Date().toISOString();
  save();
  appendAudit({ actorId: user.id, eventType: 'auth.password.changed', objectType: 'user', objectId: user.id, metadata: {} });
  return { ok: true };
}

/** 创建/更新演示身份（MOS_ADMIN 使用；仅本地 Mock 身份源） */
function upsertUser(input, actorId) {
  const db = getDb();
  const username = String(input.username || '').trim();
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) return { error: '账号名只允许 3-40 位字母、数字、点、下划线、连字符' };
  if (db.users.some((u) => String(u.username).toLowerCase() === username.toLowerCase())) {
    return { error: '账号名已存在', code: 'USERNAME_TAKEN' };
  }
  const initial = String(input.password || '');
  if (initial.length < 8) return { error: '初始密码至少 8 位', code: 'WEAK_PASSWORD' };
  const h = hashPassword(initial);
  const user = {
    id: uid('user'),
    username,
    displayName: String(input.displayName || username).slice(0, 60),
    externalIdentityId: 'local:' + username,
    dept: String(input.dept || '').slice(0, 40),
    title: String(input.title || '').slice(0, 40),
    status: 'active',
    demo: !!input.demo,
    salt: h.salt,
    passwordHash: h.hash,
    mustChangePassword: input.mustChangePassword !== false,
    createdAt: new Date().toISOString(),
    lastLoginAt: null
  };
  db.users.push(user);
  save();
  appendAudit({ actorId: actorId || '', eventType: 'user.created', objectType: 'user', objectId: user.id, metadata: { username: user.username } });
  return { user };
}

/** 授予角色（品牌范围） */
function grantRole(userId, roleCode, brandScope, actorId) {
  const db = getDb();
  const { ROLES, BRAND_CODES } = require('../dict');
  if (!ROLES[roleCode]) return { error: '角色不存在', code: 'ROLE_NOT_FOUND' };
  const user = db.users.find((u) => u.id === userId);
  if (!user) return { error: '账号不存在', code: 'USER_NOT_FOUND' };
  const scope = Array.isArray(brandScope) && brandScope.length
    ? brandScope.filter((s) => s === '*' || BRAND_CODES.indexOf(s) !== -1)
    : ['*'];
  if (!scope.length) return { error: '品牌范围非法', code: 'BAD_SCOPE' };
  const existing = db.user_roles.find((r) => r.userId === userId && r.roleCode === roleCode);
  if (existing) {
    existing.brandScope = scope;
  } else {
    db.user_roles.push({ id: uid('ur'), userId, roleCode, brandScope: scope, grantedAt: new Date().toISOString() });
  }
  save();
  appendAudit({ actorId: actorId || '', eventType: 'user.role.granted', objectType: 'user', objectId: userId, metadata: { roleCode, brandScope: scope } });
  return { ok: true };
}

function revokeRole(userId, roleCode, actorId) {
  const db = getDb();
  const before = db.user_roles.length;
  db.user_roles = db.user_roles.filter((r) => !(r.userId === userId && r.roleCode === roleCode));
  if (db.user_roles.length !== before) {
    save();
    appendAudit({ actorId: actorId || '', eventType: 'user.role.revoked', objectType: 'user', objectId: userId, metadata: { roleCode } });
  }
  return { ok: true };
}

module.exports = {
  MOCK,
  COOKIE_NAME,
  pruneSessions,
  createSession,
  destroySession,
  resolveSession,
  authenticate,
  currentUser,
  check,
  changePassword,
  upsertUser,
  grantRole,
  revokeRole
};
