'use strict';
/**
 * Marketing OS —— 独立路由表。
 *
 * 本工程自带路由表：鉴权绑定本系统身份（`mos_sid` + 本库 users），与外部系统零耦合。
 * 设计沿用已验证的骨架：CSRF 双层校验、声明式 brand scope、统一错误出口。
 */
const { sendJson, sendError, httpError, parseCookies } = require('../util');
const security = require('../security');
const { getConfig } = require('../config');
const identity = require('./adapters/identity');
const { principalOf } = require('./rbac');

const routes = [];

function compile(pattern) {
  const keys = [];
  const source = pattern
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) { keys.push(seg.slice(1)); return '([^/]+)'; }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { regex: new RegExp('^' + source + '/?$'), keys };
}

function add(method, pattern, handler, options) {
  const { regex, keys } = compile(pattern);
  routes.push({
    method: method.toUpperCase(),
    pattern,
    regex,
    keys,
    handler,
    auth: !options || options.auth !== false,
    rateLimit: (options && options.rateLimit) || null
  });
}

const get = (p, h, o) => add('GET', p, h, o);
const post = (p, h, o) => add('POST', p, h, o);
const put = (p, h, o) => add('PUT', p, h, o);
const del = (p, h, o) => add('DELETE', p, h, o);

function match(method, pathname) {
  let pathMatched = false;
  for (const route of routes) {
    const m = route.regex.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (route.method !== method) continue;
    const params = {};
    route.keys.forEach((key, i) => { params[key] = decodeURIComponent(m[i + 1]); });
    return { route, params };
  }
  if (pathMatched) throw httpError(405, '请求方法不被支持', 'METHOD_NOT_ALLOWED');
  return null;
}

/** 极简内存限流（按 IP + 路径），防止暴力破解与刷接口 */
const hits = new Map();
function rateLimitOk(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { hits.set(key, arr); return false; }
  arr.push(now);
  hits.set(key, arr);
  return true;
}

/** 解析 MOS 会话令牌：默认只认 Cookie；Bearer 仅当显式开启（CI/集成） */
function mosTokenInfo(ctx) {
  const cfg = getConfig();
  const cookies = parseCookies(ctx.req);
  const cookieToken = cookies[identity.COOKIE_NAME] ? String(cookies[identity.COOKIE_NAME]).trim() : '';

  if (process.env.MOS_BEARER_API === '1') {
    const h = ctx.req.headers['x-mos-token'] || '';
    if (h) return { token: String(h).trim(), source: 'bearer' };
    const auth = ctx.req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) return { token: auth.slice(7).trim(), source: 'bearer' };
    if (ctx.query && ctx.query.token) return { token: String(ctx.query.token), source: 'bearer' };
  }
  if (cookieToken) return { token: cookieToken, source: 'cookie' };
  return { token: '', source: 'none' };
}

async function dispatch(ctx) {
  const found = match(ctx.method, ctx.pathname);
  if (!found) {
    sendError(ctx.res, 404, '接口不存在：' + ctx.method + ' ' + ctx.pathname, 'NOT_FOUND');
    return;
  }
  const { route, params } = found;
  ctx.params = params;

  const cfg = getConfig();
  const stateChanging = security.isStateChanging(ctx.method);

  // 第一层：Origin / Referer（浏览器跨站状态变更必带 Origin）
  if (stateChanging) {
    const originCheck = security.checkOrigin(ctx.req, cfg);
    if (!originCheck.ok) {
      sendError(ctx.res, 403, '请求来源校验未通过（CSRF 防护）', 'CSRF_ORIGIN_REJECTED');
      return;
    }
  }

  const info = mosTokenInfo(ctx);
  ctx.req._mosToken = info.token;
  ctx.authSource = info.source;

  // 第二层：双提交 CSRF（仅 Cookie 凭据需要）
  if (stateChanging && info.source === 'cookie') {
    const cookies = parseCookies(ctx.req);
    if (!cfg.auth || cfg.auth.csrfCookieName) {
      const csrf = security.checkCsrfToken(ctx.req, cookies, cfg);
      if (!csrf.ok) {
        // 未登录的登录请求本身不需要 CSRF（尚未持有令牌）
        const isLogin = /\/auth\/login$/.test(ctx.pathname);
        if (!isLogin) {
          sendError(ctx.res, 403, '请求校验令牌无效或缺失，请刷新页面后重试', 'CSRF_TOKEN_INVALID');
          return;
        }
      }
    }
  }

  if (route.rateLimit) {
    const key = ctx.pathname + '|' + (ctx.ip || 'unknown');
    if (!rateLimitOk(key, route.rateLimit.max, route.rateLimit.windowMs)) {
      sendError(ctx.res, 429, '请求过于频繁，请稍后再试', 'RATE_LIMITED');
      return;
    }
  }

  const session = identity.resolveSession(ctx.req);
  ctx.user = session.user;
  ctx.principal = session.user ? principalOf(require('./store').getDb(), session.user) : null;

  if (route.auth && !ctx.user) {
    sendError(ctx.res, 401, '登录状态已失效，请重新登录', 'UNAUTHORIZED');
    return;
  }
  // 强制改密：除改密/登出/自助信息/元数据外，一律拦截
  if (route.auth && ctx.principal && ctx.principal.mustChangePassword
    && !/\/auth\/(change-password|logout|me|csrf)$/.test(ctx.pathname)
    && ctx.pathname !== '/api/mos/meta') {
    sendError(ctx.res, 403, '首次登录需先修改密码', 'PASSWORD_CHANGE_REQUIRED');
    return;
  }

  const result = await route.handler(ctx);
  if (result === undefined) return;
  sendJson(ctx.res, 200, result);
}

module.exports = { add, get, post, put, del, dispatch, routes };
