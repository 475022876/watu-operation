'use strict';
/**
 * 请求来源判定与 CSRF 防护（V1.1.3 P0-01 / P0-02）。
 *
 * 三条不可动摇的原则：
 *   1. **socket 对端地址是唯一不可伪造的事实**。转发头（X-Forwarded-For / -Proto）
 *      只有在直连对端命中 TRUSTED_PROXY_CIDRS 时才被参考；未配置可信代理时**一律忽略**。
 *   2. **不做字符串前缀匹配**。地址与网段比较全部走 lib/net.js 的逐位比较。
 *   3. **fail closed**。畸形转发链 / 畸形配置不会被"猜一个"或"静默关闭限制"，
 *      而是直接拒绝请求或在启动阶段拒绝启动。
 *
 * 部署拓扑假设（必须与实际一致，见 DEPLOYMENT_PRODUCTION_V1.1.3.md）：
 *   client → [可选：CDN/WAF] → [反向代理：终结 TLS] → 本进程
 *   - 终结 TLS 的是**反向代理**，因此本进程内 `socket.encrypted` 为 false；
 *     只有在 peer 可信时才依据 X-Forwarded-Proto 判定 HTTPS。
 *   - 访问控制策略由**本进程**（应用层）与入口网络层（VPN / Zero Trust / 安全组）共同施加。
 */
const crypto = require('node:crypto');
const net = require('./net');
const { getConfig } = require('./config');
const { httpError } = require('./util');

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const SECURE_COOKIE_MODES = new Set(['auto', 'always', 'never']);

function isStateChanging(method) {
  return STATE_CHANGING.has(String(method || '').toUpperCase());
}

function peerAddress(req) {
  return (req.socket && req.socket.remoteAddress) || '';
}

/* ==================== 启动期配置校验（fail closed） ==================== */

/**
 * 校验并预编译网络安全配置。
 * 返回 { trustedProxyRules, allowedClientRules, errors }。
 * 调用方若发现 errors 非空，**必须拒绝启动**（不得静默降级为"不限制"）。
 */
function validateNetworkConfig(cfg) {
  const errors = [];
  const trusted = net.parseCidrList(cfg.trustedProxies || []);
  const allowed = net.parseCidrList(cfg.allowedNetworks || []);

  for (const e of trusted.errors) errors.push('trustedProxies 规则非法：「' + e.value + '」（' + e.error + '）');
  for (const e of allowed.errors) errors.push('allowedNetworks 规则非法：「' + e.value + '」（' + e.error + '）');

  const auth = cfg.auth || {};
  if (auth.secureCookies !== undefined && !SECURE_COOKIE_MODES.has(String(auth.secureCookies))) {
    errors.push('auth.secureCookies 只能是 auto / always / never，当前为「' + auth.secureCookies + '」');
  }

  return { trustedProxyRules: trusted.rules, allowedClientRules: allowed.rules, errors };
}

/* ==================== 客户端地址解析 ==================== */

/**
 * 解析生效客户端地址。
 * @returns {{ ip:string, source:'socket'|'forwarded', peer:string, forwardedPresent:boolean,
 *             forwardedIgnored:boolean, chain:string[] }}
 * 抛 400（BAD_FORWARDED_HEADER）：可信代理送来的转发链畸形/歧义。
 */
function resolveClient(req, trustedProxyRules) {
  const peerRaw = peerAddress(req);
  const peer = net.parseIp(peerRaw);
  const peerText = net.normalizeIp(peerRaw) || String(peerRaw || '');
  const xff = req.headers['x-forwarded-for'];
  const forwardedPresent = xff !== undefined;

  const peerTrusted = !!(peer && trustedProxyRules && trustedProxyRules.length
    && net.ipInList(trustedProxyRules, peer));

  if (!peerTrusted) {
    // 未配置可信代理，或直连对端本身不可信：忽略全部转发头（防伪造）
    return {
      ip: peerText,
      peer: peerText,
      source: 'socket',
      forwardedPresent,
      forwardedIgnored: forwardedPresent,
      chain: []
    };
  }

  if (!forwardedPresent) {
    return { ip: peerText, peer: peerText, source: 'socket', forwardedPresent: false, forwardedIgnored: false, chain: [] };
  }

  const raw = String(xff);
  const parts = raw.split(',');
  const chain = [];
  for (const part of parts) {
    const token = part.trim();
    if (!token) throw httpError(400, '请求来源信息格式非法', 'BAD_FORWARDED_HEADER');
    const parsed = net.parseIp(token);
    if (!parsed) throw httpError(400, '请求来源信息格式非法', 'BAD_FORWARDED_HEADER');
    chain.push({ text: net.normalizeIp(token), parsed });
  }
  if (!chain.length) throw httpError(400, '请求来源信息格式非法', 'BAD_FORWARDED_HEADER');

  // 从右往左跳过可信代理，第一个不可信跳即真实客户端
  let candidate = { text: peerText, parsed: peer };
  let i = chain.length - 1;
  while (candidate.parsed && net.ipInList(trustedProxyRules, candidate.parsed) && i >= 0) {
    candidate = chain[i];
    i -= 1;
  }

  return {
    ip: candidate.text,
    peer: peerText,
    source: 'forwarded',
    forwardedPresent: true,
    forwardedIgnored: false,
    chain: chain.map((c) => c.text)
  };
}

/** 请求是否经 HTTPS（仅当 peer 可信时才采信 X-Forwarded-Proto） */
function resolveSecure(req, trustedProxyRules) {
  if (req.socket && req.socket.encrypted === true) return true;

  const peer = net.parseIp(peerAddress(req));
  const peerTrusted = !!(peer && trustedProxyRules && trustedProxyRules.length
    && net.ipInList(trustedProxyRules, peer));
  if (!peerTrusted) return false; // 不可信对端送来的 X-Forwarded-Proto 一律不采信

  const raw = req.headers['x-forwarded-proto'];
  if (raw === undefined) return false;
  const parts = String(raw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return false;
  const nearest = parts[parts.length - 1]; // 最靠近本进程的一段由直接上游代理写入
  if (nearest !== 'http' && nearest !== 'https') {
    throw httpError(400, '请求协议信息格式非法', 'BAD_FORWARDED_HEADER');
  }
  return nearest === 'https';
}

/** 是否应给 Cookie 加 Secure */
function useSecureCookie(cfg, secureRequest) {
  const mode = String((cfg.auth && cfg.auth.secureCookies) || 'auto');
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  return !!secureRequest;
}

/* ==================== Origin / Referer 校验 ==================== */

function hostOf(req) {
  return String(req.headers.host || '').trim().toLowerCase();
}

function sameHost(a, b) {
  return !!a && !!b && a === b;
}

/**
 * 校验 Origin / Referer。
 * 返回值 { ok:boolean, reason?:string, seen:string }。
 * 浏览器发起的跨站状态变更请求**必定**带 Origin（或至少带 Referer），因此：
 *   - Origin 存在 → 必须与 Host 同源（或命中 allowedOrigins）
 *   - Origin 缺失但 Referer 存在 → 校验 Referer 的 host
 *   - 两者都缺失 → 视为非浏览器客户端，交给 CSRF token 层处理（不因此拒绝）
 */
function checkOrigin(req, cfg) {
  const host = hostOf(req);
  const allowed = Array.isArray(cfg.auth && cfg.auth.allowedOrigins) ? cfg.auth.allowedOrigins : [];
  const origin = req.headers.origin;

  const matchOrigin = (value) => {
    let u;
    try { u = new URL(String(value)); } catch (_) { return { ok: false, reason: 'origin-unparsable' }; }
    const h = String(u.host || '').toLowerCase();
    if (sameHost(h, host)) return { ok: true };
    if (allowed.some((a) => String(a).trim().toLowerCase() === String(value).trim().toLowerCase())) return { ok: true };
    if (allowed.some((a) => { try { return String(new URL(String(a)).host).toLowerCase() === h; } catch (_) { return false; } })) return { ok: true };
    return { ok: false, reason: 'origin-mismatch' };
  };

  if (origin !== undefined && String(origin).trim() !== '' && String(origin).trim() !== 'null') {
    const r = matchOrigin(origin);
    return { ok: r.ok, reason: r.reason, seen: 'origin' };
  }
  if (origin !== undefined && String(origin).trim() === 'null') {
    // 沙盒 iframe / file:// 等来源：跨站场景下必须拒绝
    return { ok: false, reason: 'origin-null', seen: 'origin' };
  }

  const referer = req.headers.referer;
  if (referer) {
    const r = matchOrigin(referer);
    return { ok: r.ok, reason: r.reason, seen: 'referer' };
  }

  return { ok: true, reason: 'no-origin-header', seen: 'none' };
}

/* ==================== CSRF 双提交令牌 ==================== */

function newCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

/** 恒定时间比较，避免令牌被逐字节试探 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (!ba.length || ba.length !== bb.length) return false;
  try { return crypto.timingSafeEqual(ba, bb); } catch (_) { return false; }
}

/**
 * 校验双提交 CSRF 令牌：Cookie 中的 mos_csrf 必须与请求头 x-mos-csrf 一致。
 * @param cookies 已解析的 Cookie 对象
 */
function checkCsrfToken(req, cookies, cfg) {
  const cookieName = (cfg.auth && cfg.auth.csrfCookieName) || 'mos_csrf';
  const headerName = ((cfg.auth && cfg.auth.csrfHeader) || 'x-mos-csrf').toLowerCase();
  const cookieValue = cookies[cookieName];
  const headerValue = req.headers[headerName];
  if (!cookieValue || !headerValue) return { ok: false, reason: 'csrf-token-missing' };
  if (typeof headerValue !== 'string') return { ok: false, reason: 'csrf-token-duplicated' };
  if (!safeEqual(cookieValue, headerValue)) return { ok: false, reason: 'csrf-token-mismatch' };
  return { ok: true };
}

/* ==================== Cookie 构造 ==================== */

function buildCookie(name, value, opts) {
  const o = opts || {};
  const parts = [name + '=' + encodeURIComponent(String(value == null ? '' : value)), 'Path=' + (o.path || '/')];
  if (o.httpOnly) parts.push('HttpOnly');
  parts.push('SameSite=' + (o.sameSite || 'Strict'));
  parts.push('Max-Age=' + Math.max(0, Math.floor(o.maxAge || 0)));
  if (o.secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * 会话 Cookie：HttpOnly（JS 不可读）+ SameSite=Strict（+ HTTPS 时 Secure）。
 * 这是浏览器唯一的会话凭据载体 —— 令牌**绝不**出现在响应体 / localStorage。
 */
function sessionCookie(cfg, token, maxAgeSeconds, secure) {
  const name = (cfg.auth && cfg.auth.cookieName) || 'mos_sid';
  return buildCookie(name, token, { httpOnly: true, sameSite: 'Strict', maxAge: maxAgeSeconds, secure: !!secure });
}

function clearSessionCookie(cfg, secure) {
  const name = (cfg.auth && cfg.auth.cookieName) || 'mos_sid';
  return buildCookie(name, '', { httpOnly: true, sameSite: 'Strict', maxAge: 0, secure: !!secure });
}

/**
 * CSRF 双提交 Cookie：必须**可被同源 JS 读取**（因此不能 HttpOnly），
 * 攻击者无法读取跨站 Cookie 的值，也就无法伪造 x-mos-csrf 头。
 */
function csrfCookie(cfg, token, maxAgeSeconds, secure) {
  const name = (cfg.auth && cfg.auth.csrfCookieName) || 'mos_csrf';
  return buildCookie(name, token, { httpOnly: false, sameSite: 'Strict', maxAge: maxAgeSeconds, secure: !!secure });
}

function clearCsrfCookie(cfg, secure) {
  const name = (cfg.auth && cfg.auth.csrfCookieName) || 'mos_csrf';
  return buildCookie(name, '', { httpOnly: false, sameSite: 'Strict', maxAge: 0, secure: !!secure });
}

module.exports = {
  STATE_CHANGING,
  isStateChanging,
  peerAddress,
  validateNetworkConfig,
  resolveClient,
  resolveSecure,
  useSecureCookie,
  checkOrigin,
  checkCsrfToken,
  newCsrfToken,
  safeEqual,
  buildCookie,
  sessionCookie,
  clearSessionCookie,
  csrfCookie,
  clearCsrfCookie
};
