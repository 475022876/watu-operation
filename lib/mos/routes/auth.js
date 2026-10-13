'use strict';
/**
 * MOS 认证路由：登录 / 登出 / 当前主体 / 改密 / CSRF 下发。
 * 凭据载体只有 HttpOnly Cookie `mos_sid`，令牌**绝不**出现在响应体。
 */
const { get, post, put } = require('../router');
const { getDb } = require('../store');
const { getConfig } = require('../../config');
const security = require('../../security');
const { httpError } = require('../../util');
const identity = require('../adapters/identity');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const helpers = require('./helpers');

function setAuthCookies(ctx, token) {
  const cfg = getConfig();
  const secure = security.useSecureCookie(cfg, ctx.secure);
  const csrf = security.newCsrfToken();
  const maxAge = 12 * 3600;
  ctx.res.setHeader('Set-Cookie', [
    security.sessionCookie(cfg, token, maxAge, secure),
    security.csrfCookie(cfg, csrf, maxAge, secure)
  ]);
}

function clearAuthCookies(ctx) {
  const cfg = getConfig();
  const secure = security.useSecureCookie(cfg, ctx.secure);
  ctx.res.setHeader('Set-Cookie', [
    security.clearSessionCookie(cfg, secure),
    security.clearCsrfCookie(cfg, secure)
  ]);
}

/** 后端能力与主体信息（前端首次加载调用，同时下发 CSRF 令牌） */
get('/api/mos/auth/me', async (ctx) => {
  if (!ctx.user) {
    // 未登录：仍下发一个 CSRF 令牌，便于随后的登录 POST 通过双提交校验
    const cfg = getConfig();
    const secure = security.useSecureCookie(cfg, ctx.secure);
    const csrf = security.newCsrfToken();
    ctx.res.setHeader('Set-Cookie', [security.csrfCookie(cfg, csrf, 12 * 3600, secure)]);
    return { ok: true, authenticated: false };
  }
  return {
    ok: true,
    authenticated: true,
    user: {
      id: ctx.principal.id,
      username: ctx.principal.username,
      displayName: ctx.principal.displayName,
      demo: ctx.principal.demo,
      mustChangePassword: ctx.principal.mustChangePassword,
      roles: ctx.principal.roles,
      brandCodes: ctx.principal.brandCodes,
      prefs: userPrefs(ctx.user)
    },
    brands: rbac.visibleBrands(ctx.principal),
    integrations: helpers.integrationStatus()
  };
}, { auth: false });

/** 读取用户偏好（缺省回落：locale=null=未设置 → 前端按组织默认 zh-CN） */
function userPrefs(user) {
  const db = getDb();
  const u = (db.users || []).find((x) => x.id === user.id);
  return Object.assign({ locale: null, lastTaskId: null }, (u && u.prefs) || {});
}

const LOCALE_RE = /^(zh-CN|en-US)$/;

/** V0.1.2 Phase A：保存个人界面偏好（语言）。服务端持久化，重登录仍有效（05 双语规范）。 */
put('/api/mos/auth/preferences', async (ctx) => {
  const body = ctx.body || {};
  const locale = body.locale === undefined ? undefined : String(body.locale);
  if (locale !== undefined && !LOCALE_RE.test(locale)) {
    throw httpError(400, '不支持的语言：' + locale + '（仅 zh-CN / en-US）', 'BAD_LOCALE');
  }
  const db = getDb();
  const u = (db.users || []).find((x) => x.id === ctx.user.id);
  if (!u) throw httpError(404, '用户不存在', 'USER_NOT_FOUND');
  u.prefs = Object.assign({ locale: null, lastTaskId: null }, u.prefs || {});
  if (locale !== undefined) u.prefs.locale = locale;
  appendAudit({
    actorId: ctx.user.id, eventType: 'user.prefs.updated', objectType: 'user', objectId: ctx.user.id,
    metadata: { locale: locale === undefined ? '(unchanged)' : locale }
  });
  return { ok: true, prefs: u.prefs };
});

post('/api/mos/auth/login', async (ctx) => {
  const body = ctx.body || {};
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) throw httpError(400, '请填写账号与密码', 'MISSING_CREDENTIALS');

  const result = identity.authenticate(username, password, ctx.ip);
  if (result.error) throw httpError(401, result.error, result.code || 'AUTH_FAILED');

  const token = identity.createSession(result.user, { ip: ctx.ip, userAgent: ctx.req.headers['user-agent'] || '' });
  setAuthCookies(ctx, token);
  return { ok: true, mustChangePassword: !!result.user.mustChangePassword, displayName: result.user.displayName };
}, { auth: false, rateLimit: { max: 20, windowMs: 10 * 60 * 1000 } });

post('/api/mos/auth/logout', async (ctx) => {
  identity.destroySession(ctx.req._mosToken);
  appendAudit({ actorId: ctx.user ? ctx.user.id : '', eventType: 'auth.logout', objectType: 'user', objectId: ctx.user ? ctx.user.id : '', metadata: {} });
  clearAuthCookies(ctx);
  return { ok: true };
});

post('/api/mos/auth/change-password', async (ctx) => {
  const body = ctx.body || {};
  const res = identity.changePassword(ctx.user.id, String(body.oldPassword || ''), String(body.newPassword || ''));
  if (res.error) throw httpError(400, res.error, res.code || 'CHANGE_FAILED');
  return { ok: true };
});

/** 明确公开的运行时标识（未登录即可读取；用于登录页显示版本） */
get('/api/mos/identity/status', async (ctx) => {
  return {
    ok: true,
    gateway: 'identity',
    mode: identity.MOCK ? 'mock' : 'real',
    mock: identity.MOCK,
    mosVersion: require('../config').MOS_VERSION,
    environment: 'sandbox'
  };
}, { auth: false });
