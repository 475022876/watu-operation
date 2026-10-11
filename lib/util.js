'use strict';
/**
 * 通用工具：HTTP 请求体读取、响应封装、文件流式落盘、MIME 识别等。
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg'
};

/** 可被 AI 直接读取文本内容的扩展名 */
const TEXT_LIKE = new Set(['.txt', '.md', '.markdown', '.csv', '.json', '.log', '.xml', '.html', '.htm', '.js', '.css', '.yml', '.yaml', '.ini', '.conf']);

/* ==================== SEC-10 上传安全 ====================
 * 白名单扩展名：禁止可执行脚本（exe/js/html/bat/sh 等）与默认压缩包（zip/rar/7z）。
 * 允许：办公文档、纯文本、图片。
 */
const UPLOAD_ALLOWED_EXTS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.log', '.xml',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'
]);

/** 常见类型魔数：命中白名单但内容不匹配时拒绝（扩展名伪装校验） */
const MAGIC_SIGNATURES = [
  { test: (b) => b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, exts: ['.pdf'] },
  { test: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47, exts: ['.png'] },
  { test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff, exts: ['.jpg', '.jpeg'] },
  { test: (b) => b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46, exts: ['.gif'] },
  { test: (b) => b.length >= 4 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46, exts: ['.webp'] },
  { test: (b) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07), exts: ['.docx', '.xlsx', '.pptx'] },
  { test: (b) => b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0, exts: ['.doc', '.xls', '.ppt'] },
  { test: (b) => b.length >= 2 && b[0] === 0x4d && b[1] === 0x5a, exts: [] }, // MZ = Windows 可执行：任何扩展名都拒绝
  { test: (b) => b.length >= 4 && b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46, exts: [] } // ELF
];

/**
 * V1.1.2 AUD-11：声明为「有固定签名的二进制类型」时，必须命中对应签名，
 * 否则拒绝 —— 防止把脚本/压缩包改名为 .png/.docx 之类的伪装上传。
 * 纯文本类（txt/md/csv/json/log/xml）无固定签名，不做强制。
 */
const SIGNATURE_REQUIRED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt'];

/** 上传扩展名是否在白名单内 */
function uploadExtAllowed(name) {
  return UPLOAD_ALLOWED_EXTS.has(extOf(name));
}

/** 基于文件头部字节的伪装检测：返回 null 表示通过，否则返回拒绝原因 */
function uploadMagicIssue(ext, head) {
  const buf = Buffer.from(head || []);
  if (!buf.length) return null;
  let declaredTypeMatched = false;
  for (const sig of MAGIC_SIGNATURES) {
    if (sig.test(buf)) {
      if (sig.exts.length === 0 || !sig.exts.includes(ext)) {
        return '文件内容与声明的类型不符，已拒绝（安全策略）';
      }
      declaredTypeMatched = true;
    }
  }
  if (SIGNATURE_REQUIRED_EXTS.includes(ext) && !declaredTypeMatched) {
    return '文件内容缺少 ' + ext + ' 应有的文件签名，已拒绝（安全策略）';
  }
  // 声明为图片但内容像脚本/HTML 的简单防御
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(ext)) {
    const text = buf.toString('utf8', 0, Math.min(256, buf.length)).toLowerCase();
    if (text.includes('<script') || text.includes('<?php')) return '图片文件中包含脚本内容，已拒绝（安全策略）';
  }
  return null;
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function nowISO() {
  return new Date().toISOString();
}

function extOf(name) {
  const i = String(name || '').lastIndexOf('.');
  return i > 0 ? String(name).slice(i).toLowerCase() : '';
}

function mimeOf(name) {
  return MIME_TYPES[extOf(name)] || 'application/octet-stream';
}

function isTextLike(name) {
  return TEXT_LIKE.has(extOf(name));
}

/** 去掉路径分隔符与控制字符，防止目录穿越 */
function sanitizeName(name) {
  let out = String(name == null ? '' : name).replace(/[\\/]/g, '_').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (out === '' || out === '.' || out === '..') out = '未命名文件';
  if (out.length > 180) out = out.slice(0, 180);
  return out;
}

/** 保证目录内文件名不重复：a.txt -> a(1).txt */
function uniqueName(existingNames, name) {
  const set = new Set(existingNames);
  if (!set.has(name)) return name;
  const ext = extOf(name);
  const base = ext ? name.slice(0, name.length - ext.length) : name;
  let i = 1;
  let candidate = `${base}(${i})${ext}`;
  while (set.has(candidate)) {
    i += 1;
    candidate = `${base}(${i})${ext}`;
  }
  return candidate;
}

/** RFC 5987 兼容的中文文件名下载头 */
function contentDisposition(name, inline) {
  const safe = sanitizeName(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload == null ? {} : payload), 'utf8');
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendError(res, status, message, code) {
  sendJson(res, status, { ok: false, error: message || '请求失败', code: code || undefined });
}

function httpError(status, message, code) {
  const err = new Error(message || '请求失败');
  err.status = status;
  if (code) err.code = code;
  return err;
}

/** 读取请求体并限制大小（默认 4MB，仅用于 JSON 接口） */
function readBody(req, limitBytes) {
  const limit = limitBytes || 4 * 1024 * 1024;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(httpError(413, '请求体超过限制', 'PAYLOAD_TOO_LARGE'));
        try { req.destroy(); } catch (_) { /* ignore */ }
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (err) => fail(err));
    req.on('aborted', () => fail(httpError(400, '请求已中断')));
  });
}

async function readJson(req, limitBytes) {
  const buf = await readBody(req, limitBytes);
  if (!buf.length) return {};
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch (_) {
    throw httpError(400, 'JSON 格式错误', 'BAD_JSON');
  }
}

/**
 * 将请求体以流方式落盘（用于文件上传，避免把大文件读进内存）。
 * 超过限制会中断请求并删除半成品文件。
 */
function streamToFile(req, destPath, limitBytes) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(destPath);
    let size = 0;
    let settled = false;

    const cleanup = () => {
      try { ws.destroy(); } catch (_) { /* ignore */ }
      fs.promises.unlink(destPath).catch(() => { /* ignore */ });
    };

    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        fail(httpError(413, '文件超过大小限制', 'FILE_TOO_LARGE'));
        try { req.destroy(); } catch (_) { /* ignore */ }
      }
    });
    req.on('error', fail);
    req.on('aborted', () => fail(httpError(400, '上传已中断')));
    ws.on('error', fail);
    ws.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve(size);
    });

    req.pipe(ws);
  });
}

function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return num + ' B';
  if (num < 1024 * 1024) return (num / 1024).toFixed(1) + ' KB';
  if (num < 1024 * 1024 * 1024) return (num / 1024 / 1024).toFixed(1) + ' MB';
  return (num / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

/** 以服务器本地时区输出 YYYY-MM-DD（跨月跨年由 Date 自行处理） */
function localDateStr(date) {
  const d = date ? new Date(date) : new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 本地时区「今天」 */
function todayStr() {
  return localDateStr(new Date());
}

/** 在 YYYY-MM-DD 上加减天数，用于跨月/跨年边界计算 */
function shiftDateStr(dateStr, days) {
  const base = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  base.setDate(base.getDate() + Number(days || 0));
  return localDateStr(base);
}

/* ==================== Cookie 解析 ====================
 * 注意：Cookie 的**构造**统一在 lib/security.js（与可信代理 / CSRF 判定放在一起，
 * 避免出现两套 Cookie 策略）。此处只负责解析。
 */

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const key = part.slice(0, i).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch (_) { out[key] = part.slice(i + 1).trim(); }
  }
  return out;
}

module.exports = {
  MIME_TYPES,
  uid,
  nowISO,
  extOf,
  mimeOf,
  isTextLike,
  sanitizeName,
  uniqueName,
  contentDisposition,
  sendJson,
  sendError,
  httpError,
  readBody,
  readJson,
  streamToFile,
  formatBytes,
  localDateStr,
  todayStr,
  shiftDateStr,
  // Cookie 解析
  parseCookies,
  // 上传安全
  uploadExtAllowed,
  uploadMagicIssue
};
