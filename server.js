'use strict';
/**
 * VFIB Marketing OS V0.1 —— 生产部署入口（独立工程）。
 *
 * 设计原则（与 00 主控规格一致）：
 *   1. **零第三方依赖**：仅使用 Node 内置模块，无 npm 源的环境也能直接运行。
 *   2. **数据自持**：业务数据全部落在本机 data 目录（data/mos.json），不写入任何第三方存储。
 *   3. **出站可控**：默认无外发；仅「情报采集」能力会出站，且受域名白名单 + DNS/IP 拦截约束。
 *   4. **访问控制由后端强制**：能力判定不依赖前端隐藏（见 lib/mos/rbac.js）。
 *   5. **诚实性**：未接通的集成分离标注为 MOCK，绝不伪造成功（见 lib/mos/config.js 的 integrations）。
 */
const http = require('node:http');
const os = require('node:os');
const { getConfig, ensureDirs, PATHS } = require('./lib/config');
const { serveStatic } = require('./lib/static');
const { readJson, sendError, sendJson } = require('./lib/util');
const security = require('./lib/security');
const net = require('./lib/net');

const mosRouter = require('./lib/mos/router');
require('./lib/mos/routes');
const mosConfig = require('./lib/mos/config');
const mosStore = require('./lib/mos/store');

const cfg = getConfig();
const VERSION = cfg.appVersion;

/* ---------------- 启动期安全配置校验（fail closed） ----------------
 * 配置里出现非法 CIDR / 非法 Cookie 策略时**拒绝启动**，而不是静默忽略该条规则。
 * 静默忽略等于悄悄把「限制」变成「不限制」。
 */
const NET = security.validateNetworkConfig(cfg);
if (NET.errors.length) {
  console.error('\n[启动失败] 网络安全配置非法，已拒绝启动（fail closed）：');
  for (const e of NET.errors) console.error('  · ' + e);
  console.error('  请修正 config.json 的 trustedProxies / allowedNetworks / auth.secureCookies，');
  console.error('  或对应的 MOS_TRUSTED_PROXIES / MOS_ALLOWED_CLIENT_CIDRS / MOS_SECURE_COOKIES 后重试。\n');
  process.exit(1);
}
const TRUSTED_PROXY_RULES = NET.trustedProxyRules;
const ALLOWED_CLIENT_RULES = NET.allowedClientRules;

/* ---------------- 访问来源校验 ---------------- */

/**
 * 判定生效客户端地址是否被允许。
 * 刻意不使用字符串前缀比较 —— 全部走 lib/net.js 的逐位 CIDR 匹配；无法解析的地址一律拒绝。
 */
function isClientAllowed(ipText) {
  const live = getConfig();
  const ip = net.parseIp(ipText);
  if (!ip) return false;
  if (net.isLoopbackIp(ip) && live.allowLocalhost !== false) return true;
  if (!ALLOWED_CLIENT_RULES.length) return true; // 未配置白名单 = 不在此层限制
  return ALLOWED_CLIENT_RULES.some((rule) => net.cidrContains(rule, ip));
}

/* ---------------- 安全响应头 ---------------- */

function securityHeaders(req, res, secure) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  // 受控部署：禁止任何外部资源加载，从策略上杜绝对外部 CDN 的依赖
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'"
  );
  // HSTS 只在**确认**为 HTTPS 时下发（secure 由 security.resolveSecure 计算，防伪造头误判）
  if (secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

/* ---------------- 静态资源：/ 与 /mos 都指向系统外壳 ---------------- */

const SHELL = '/mos.html';

function normalizeStaticPath(pathname) {
  if (pathname === '/' || pathname === '' || pathname === '/mos' || pathname === '/mos/') return SHELL;
  return pathname;
}

/* ---------------- 请求处理 ---------------- */

async function handleRequest(req, res) {
  let client;
  let secure;
  try {
    client = security.resolveClient(req, TRUSTED_PROXY_RULES);
    secure = security.resolveSecure(req, TRUSTED_PROXY_RULES);
  } catch (err) {
    sendError(res, err.status || 400, err.message || '请求来源信息非法', err.code || 'BAD_FORWARDED_HEADER');
    return;
  }

  securityHeaders(req, res, secure);

  if (!isClientAllowed(client.ip)) {
    console.warn('[access] 已拒绝非白名单来源：' + client.ip);
    sendError(res, 403, '当前网络不在系统允许的访问范围内（访问来源白名单限制）', 'IP_NOT_ALLOWED');
    return;
  }

  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch (_) {
    sendError(res, 400, '请求地址不合法', 'BAD_URL');
    return;
  }

  const pathname = url.pathname;
  const query = {};
  url.searchParams.forEach((value, key) => { query[key] = value; });

  if (pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      status: 'UP',
      version: VERSION,
      mosVersion: mosConfig.MOS_VERSION,
      serverTime: new Date().toISOString()
    });
    return;
  }

  if (pathname.startsWith('/api/')) {
    const ctx = {
      req, res,
      method: req.method,
      pathname,
      query,
      params: {},
      user: null,
      body: null,
      ip: client.ip,
      client,
      secure
    };
    try {
      const contentType = String(req.headers['content-type'] || '');
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && /application\/json/i.test(contentType)) {
        ctx.body = await readJson(req, 4 * 1024 * 1024);
      }
      await mosRouter.dispatch(ctx);
    } catch (err) {
      const status = err && err.status ? err.status : 500;
      const message = err && err.message ? err.message : '服务器内部错误';
      if (status >= 500) console.error('[api] ' + req.method + ' ' + pathname + ' -> ' + (err && err.stack ? err.stack : message));
      if (!res.headersSent) sendError(res, status, message, err && err.code);
      else { try { res.end(); } catch (_) { /* ignore */ } }
    }
    return;
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    serveStatic(req, res, normalizeStaticPath(pathname));
    return;
  }

  sendError(res, 405, '请求方法不被支持', 'METHOD_NOT_ALLOWED');
}

/* ---------------- 启动 ---------------- */

function lanAddresses() {
  const out = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const info of interfaces[name] || []) {
      if (info.family === 'IPv4' && !info.internal) out.push({ name, address: info.address });
    }
  }
  return out;
}

function banner(actualPort) {
  const live = getConfig();
  const mosCfg = mosConfig.getMosConfig();

  const innerWidth = 58;
  const dispW = (s) => Array.from(String(s)).reduce((n, ch) =>
    n + (/[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1), 0);
  const boxRow = (content) => '  │' + content + ' '.repeat(Math.max(0, innerWidth - dispW(content))) + '│';
  const rule = (l, r) => '  ' + l + '─'.repeat(innerWidth) + r;

  const lines = [];
  lines.push('');
  lines.push(rule('┌', '┐'));
  lines.push(boxRow('   VFIB Marketing OS'));
  lines.push(boxRow('   智能品牌传播与市场运营中台   v' + mosCfg.mosVersion));
  lines.push(rule('└', '┘'));
  lines.push('');
  lines.push('  本地访问：http://127.0.0.1:' + actualPort);
  for (const item of lanAddresses()) {
    lines.push('  局域网访问：http://' + item.address + ':' + actualPort + '  （' + item.name + '）');
  }
  lines.push('');
  lines.push('  数据目录：' + PATHS.dataDir);
  lines.push('  数据文件：' + mosCfg.dataFile);
  {
    let line = '已禁用（config.json → mos.enabled=false）';
    if (mosCfg.enabled) {
      try {
        const db = mosStore.getDb();
        line = '已启用 schema v' + mosStore.MOS_SCHEMA_VERSION + ' · ' + db.brands.length + ' 品牌 · '
          + db.users.length + ' 身份';
      } catch (_) { line = '初始化异常'; }
    }
    lines.push('  Marketing OS：' + line);
  }
  lines.push('  集成状态：identity=' + mosCfg.integrations.identity
    + ' knowledge=' + mosCfg.integrations.knowledge
    + ' library=' + mosCfg.integrations.library);
  lines.push('            sourceIngest=' + mosCfg.integrations.sourceIngest
    + ' text=' + mosCfg.integrations.textProvider
    + ' image=' + mosCfg.integrations.imageProvider
    + '（mock/real 详见 docs/MOCK_REAL_MATRIX.md）');
  lines.push('  访问白名单：' + ((live.allowedNetworks || []).length
    ? live.allowedNetworks.join(' , ')
    : '未限制（生产建议配置 IP 白名单 / VPN / Zero Trust）'));
  lines.push('  可信代理  ：' + ((live.trustedProxies || []).length
    ? live.trustedProxies.join(' , ') + '（仅这些对端的转发头被采信）'
    : '未配置 —— 忽略全部 X-Forwarded-* 头（最安全）'));
  lines.push('  会话 Cookie：' + live.auth.cookieName + '（HttpOnly + SameSite=Strict'
    + (live.auth.secureCookies === 'always' ? ' + Secure（强制）' : '') + '）');
  lines.push('');
  lines.push('  按 Ctrl+C 停止服务');
  lines.push('');
  console.log(lines.join('\n'));
}

function start() {
  ensureDirs();

  const mosCfg = mosConfig.getMosConfig();
  if (mosCfg.enabled) {
    mosStore.load(); // 首次初始化会打印引导口令与 DEMO 凭据（仅一次，不落盘）
  } else {
    console.log('[mos] 已禁用（config.json → mos.enabled=false）');
  }

  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error('[fatal] 未捕获异常：' + (err && err.stack ? err.stack : err));
      if (!res.headersSent) sendError(res, 500, '服务器内部错误', 'INTERNAL_ERROR');
      else { try { res.end(); } catch (_) { /* ignore */ } }
    });
  });

  server.requestTimeout = 0;
  server.headersTimeout = 60000;
  server.keepAliveTimeout = 30000;

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error('\n[启动失败] 端口 ' + cfg.port + ' 已被占用。');
      console.error('请修改 config.json 中的 port，或设置 MOS_PORT 环境变量后重试。\n');
    } else {
      console.error('[启动失败] ' + err.message);
    }
    process.exit(1);
  });

  server.listen(cfg.port, cfg.host, () => banner(server.address().port));

  const shutdown = (signal) => {
    console.log('\n[exit] 收到 ' + signal + '，正在保存数据并关闭服务...');
    try { mosStore.saveNow(); } catch (_) { /* ignore */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    console.error('[uncaughtException] ' + (err && err.stack ? err.stack : err));
    try { mosStore.saveNow(); } catch (_) { /* ignore */ }
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection] ' + (reason && reason.stack ? reason.stack : reason));
  });
}

start();
