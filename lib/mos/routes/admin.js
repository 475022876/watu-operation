'use strict';
/**
 * 身份与角色管理（技术管理，仅 MOS_ADMIN）。
 *
 * 说明：BUILD-01 需要最小可用的角色分配能力，才能验证 RBAC 与品牌隔离（Gate A）。
 * 这不是"员工管理业务模块"，而是 Mock 身份源自身的维护入口；
 * 接入真实 OIDC/SSO 后，本路由应被真实 IdP 的管理面取代。
 * 注意：MOS_ADMIN **不包含** library.asset.approve.final（见 dict.js 注释）。
 */
const { get, post } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const { ROLES } = require('../dict');
const identity = require('../adapters/identity');
const { appendAudit } = require('../audit');
const helpers = require('./helpers');

function requireAdmin(ctx) {
  if (!ctx.principal || ctx.principal.roleCodes.indexOf('MOS_ADMIN') === -1) {
    appendAudit({ actorId: ctx.principal ? ctx.principal.id : '', eventType: 'admin.denied', outcome: 'denied',
      ip: ctx.ip, metadata: { path: ctx.pathname, reason: 'not_admin' } });
    throw httpError(403, '仅系统管理员可执行该操作', 'FORBIDDEN');
  }
}

function serializeUser(db, u) {
  const roles = db.user_roles.filter((r) => r.userId === u.id)
    .map((r) => ({ roleCode: r.roleCode, roleLabel: (ROLES[r.roleCode] || {}).label || r.roleCode, brandScope: r.brandScope }));
  return {
    id: u.id, username: u.username, displayName: u.displayName, dept: u.dept, title: u.title,
    status: u.status, demo: !!u.demo, mustChangePassword: !!u.mustChangePassword,
    roles, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt
  };
}

get('/api/mos/admin/users', async (ctx) => {
  requireAdmin(ctx);
  const db = getDb();
  return { ok: true, items: db.users.map((u) => serializeUser(db, u)) };
});

post('/api/mos/admin/users', async (ctx) => {
  requireAdmin(ctx);
  const body = ctx.body || {};
  const res = identity.upsertUser({
    username: body.username,
    displayName: body.displayName,
    password: body.password,
    dept: body.dept,
    title: body.title,
    demo: !!body.demo,
    mustChangePassword: body.mustChangePassword
  }, ctx.user.id);
  if (res.error) throw httpError(400, res.error, res.code || 'CREATE_FAILED');

  if (Array.isArray(body.roles)) {
    for (const r of body.roles) {
      const code = String(r.roleCode || r);
      const scope = Array.isArray(r.brandScope) ? r.brandScope : ['*'];
      const g = identity.grantRole(res.user.id, code, scope, ctx.user.id);
      if (g.error) {
        // 角色非法：回滚已创建的账号，避免留下半成品（不为赶进度留脏数据）
        const db = getDb();
        db.users = db.users.filter((u) => u.id !== res.user.id);
        db.user_roles = db.user_roles.filter((x) => x.userId !== res.user.id);
        save();
        throw httpError(400, '角色授权失败并已回滚：' + g.error, g.code || 'GRANT_FAILED');
      }
    }
  }
  const db = getDb();
  return { ok: true, user: serializeUser(db, db.users.find((u) => u.id === res.user.id)) };
});

post('/api/mos/admin/users/:id/roles', async (ctx) => {
  requireAdmin(ctx);
  const db = getDb();
  const user = db.users.find((u) => u.id === ctx.params.id);
  if (!user) throw httpError(404, '账号不存在', 'USER_NOT_FOUND');
  const body = ctx.body || {};
  const roleCode = String(body.roleCode || '').toUpperCase();
  const res = identity.grantRole(user.id, roleCode, body.brandScope, ctx.user.id);
  if (res.error) throw httpError(400, res.error, res.code || 'GRANT_FAILED');
  return { ok: true, user: serializeUser(getDb(), user) };
});

post('/api/mos/admin/users/:id/roles/revoke', async (ctx) => {
  requireAdmin(ctx);
  const db = getDb();
  const user = db.users.find((u) => u.id === ctx.params.id);
  if (!user) throw httpError(404, '账号不存在', 'USER_NOT_FOUND');
  const roleCode = String((ctx.body && ctx.body.roleCode) || '').toUpperCase();
  identity.revokeRole(user.id, roleCode, ctx.user.id);
  return { ok: true, user: serializeUser(getDb(), user) };
});

get('/api/mos/admin/roles', async (ctx) => {
  requireAdmin(ctx);
  return { ok: true, roles: helpers.roleCatalogue(), permissions: helpers.PERMISSIONS };
});

/** 审计事件查询（技术管理） */
get('/api/mos/audit', async (ctx) => {
  requireAdmin(ctx);
  const { listAudit } = require('../audit');
  const db = getDb();
  const limit = Math.min(500, Math.max(1, Number(ctx.query.limit) || 100));
  const rows = listAudit(db, {
    brandCode: ctx.query.brand ? String(ctx.query.brand).toUpperCase() : '',
    objectType: ctx.query.objectType || '',
    objectId: ctx.query.objectId || '',
    eventType: ctx.query.eventType || ''
  });
  return {
    ok: true,
    total: rows.length,
    items: rows.slice(0, limit),
    note: '审计事件 append-only，且 metadata 已脱敏（02 §2）。'
  };
});
