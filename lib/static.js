'use strict';
/**
 * 静态资源服务：仅暴露 public 目录，做目录穿越防护。
 * 不引用任何 CDN —— 所有静态资源本地化，离线（无外网出口）环境也能完整运行。
 */
const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('./config');
const { mimeOf, sendError } = require('./util');

function safeJoin(rootDir, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const normalized = path.posix.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const target = path.join(rootDir, normalized);
  const rootResolved = path.resolve(rootDir);
  const targetResolved = path.resolve(target);
  if (targetResolved !== rootResolved && !targetResolved.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return targetResolved;
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath;
  if (rel === '/' || rel === '') rel = '/index.html';

  // 简单路由美化：/app -> /app.html
  if (!path.extname(rel)) {
    const asHtml = rel.replace(/\/$/, '') + '.html';
    const candidate = safeJoin(PATHS.publicDir, asHtml);
    if (candidate && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) rel = asHtml;
  }

  const filePath = safeJoin(PATHS.publicDir, rel);
  if (!filePath) {
    sendError(res, 403, '非法路径', 'FORBIDDEN');
    return;
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      if (rel === '/index.html') {
        sendError(res, 500, '未找到前端资源，请确认 public 目录完整', 'MISSING_PUBLIC');
        return;
      }
      sendError(res, 404, '资源不存在', 'NOT_FOUND');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html' || ext === '.htm';
    const headers = {
      'Content-Type': mimeOf(filePath),
      'Content-Length': stat.size,
      // HTML 不缓存，保证版本更新即时生效；其余资源短缓存
      'Cache-Control': isHtml ? 'no-cache, no-store, must-revalidate' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff'
    };

    res.writeHead(200, headers);
    if (req.method === 'HEAD') { res.end(); return; }

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => { try { res.destroy(); } catch (_) { /* ignore */ } });
    stream.pipe(res);
  });
}

module.exports = { serveStatic, safeJoin };
