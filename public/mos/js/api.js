/* Marketing OS —— 前端 API 客户端。
 * 会话凭据只存在于服务端 HttpOnly Cookie（mos_sid），前端不持有令牌。
 * 状态变更请求带 x-mos-csrf 双提交令牌（服务端由 lib/security.js 校验）。
 *
 * V0.1.3 Phase C：错误文案走统一错误码映射（执行包 05 §统一状态/错误码映射）。
 * `err.message` 按当前语言返回员工可读文案；服务端原文保留在 `err.rawMessage`
 * （日志/排查用，永不翻译），因此既有 100+ 处 `err.message` 调用点无需逐个改造。
 */
import { errorLabel } from './i18n.js';

const CSRF_COOKIE = 'mos_csrf';
const CSRF_HEADER = 'x-mos-csrf';
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    /** 服务端原始文案（不翻译；用于日志、排查与测试断言） */
    this.rawMessage = message;
    Object.defineProperty(this, 'message', {
      configurable: true,
      enumerable: false,
      get() { return errorLabel(code, message); }
    });
  }
}

function readCookie(name) {
  try {
    for (const part of String(document.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i === -1) continue;
      if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
    }
  } catch (_) { /* ignore */ }
  return '';
}

export function csrfToken() { return readCookie(CSRF_COOKIE); }

function applyCsrf(method, headers) {
  if (SAFE.has(String(method || 'GET').toUpperCase())) return headers;
  const t = csrfToken();
  if (t) headers[CSRF_HEADER] = t;
  return headers;
}

let refreshing = null;
function refreshCsrf() {
  if (!refreshing) {
    refreshing = fetch('/api/mos/auth/me', { method: 'GET', credentials: 'same-origin' })
      .catch(() => null).finally(() => { refreshing = null; });
  }
  return refreshing;
}

async function parse(res) {
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (_) { /* 非 JSON */ }
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || null;
    const code = (json && json.code) || ('HTTP_' + res.status);
    throw new ApiError(msg, res.status, code);
  }
  return json;
}

export async function request(path, options) {
  const opts = options || {};
  const method = opts.method || 'GET';

  const send = () => {
    const headers = applyCsrf(method, Object.assign({}, opts.headers || {}));
    const init = { method, headers, credentials: 'same-origin' };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init);
  };

  let res;
  try {
    res = await send();
  } catch (_) {
    throw new ApiError('无法连接服务器，请确认服务已启动', 0, 'NETWORK_ERROR');
  }

  if (res.status === 403 && !SAFE.has(String(method).toUpperCase())) {
    const probe = await res.clone().text().catch(() => '');
    if (probe.indexOf('CSRF') !== -1) {
      await refreshCsrf();
      res = await send();
    }
  }

  return parse(res);
}

export const api = {
  get: (p, o) => request(p, Object.assign({ method: 'GET' }, o)),
  post: (p, body, o) => request(p, Object.assign({ method: 'POST', body: body || {} }, o)),
  put: (p, body, o) => request(p, Object.assign({ method: 'PUT', body: body || {} }, o)),
  del: (p, o) => request(p, Object.assign({ method: 'DELETE' }, o))
};

/** 品牌参数拼接 */
export function withBrand(path, brand, extra) {
  const qs = new URLSearchParams();
  if (brand) qs.set('brand', brand);
  for (const k of Object.keys(extra || {})) {
    if (extra[k] !== undefined && extra[k] !== null && extra[k] !== '') qs.set(k, extra[k]);
  }
  const s = qs.toString();
  return path + (s ? (path.indexOf('?') === -1 ? '?' : '&') + s : '');
}
