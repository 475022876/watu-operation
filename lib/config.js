'use strict';
/**
 * VFIB Marketing OS —— 独立工程配置（单一来源）。
 *
 * 本工程为**独立仓库**，不引用任何外部系统（原企业 OA / 企业资料库）的代码与配置。
 * 覆盖优先级：内置默认 < config.json < 环境变量（MOS_*）。
 *
 * 与业务集成的开关**不在这里**，而在 lib/mos/config.js 的 integrations 矩阵 ——
 * 那份矩阵是 Mock/Real 的唯一权威来源，这份只负责进程级参数（端口 / 目录 / 网络安全）。
 */
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const PATHS = {
  root: ROOT,
  dataDir: path.join(ROOT, 'data'),
  uploadDir: path.join(ROOT, 'data', 'uploads'),
  publicDir: path.join(ROOT, 'public'),
  configFile: path.join(ROOT, 'config.json')
};

const DEFAULT = {
  appVersion: '0.1.0',
  port: 8090,
  host: '127.0.0.1',
  /** 本机回环是否放行（本地开发默认为真；生产应配合 allowedNetworks 收紧） */
  allowLocalhost: true,
  /** 可信反代；留空 = 忽略全部 X-Forwarded-* 头（最安全） */
  trustedProxies: [],
  /** 客户端 CIDR 白名单；留空 = 不在此层限制 */
  allowedNetworks: [],
  auth: {
    cookieName: 'mos_sid',
    csrfCookieName: 'mos_csrf',
    csrfHeader: 'x-mos-csrf',
    secureCookies: 'auto', // auto | always | never
    allowedOrigins: []
  }
};

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mergeDeep(base, extra) {
  const out = isPlainObject(base) ? Object.assign({}, base) : {};
  if (!isPlainObject(extra)) return out;
  for (const key of Object.keys(extra)) {
    const val = extra[key];
    if (val === undefined || val === null) continue;
    if (isPlainObject(val) && isPlainObject(base[key])) out[key] = mergeDeep(base[key], val);
    else out[key] = val;
  }
  return out;
}

function splitList(value) {
  if (value === undefined || value === null) return [];
  return String(value).split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}

let cached = null;

function getConfig() {
  if (cached) return cached;

  let fromFile = {};
  if (fs.existsSync(PATHS.configFile)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(PATHS.configFile, 'utf8'));
    } catch (err) {
      console.error('[config] config.json 解析失败，已忽略该文件：' + err.message);
    }
  }

  const cfg = mergeDeep(DEFAULT, fromFile);

  // 环境变量覆盖（部署与隔离自检用）
  if (process.env.MOS_PORT) cfg.port = Number(process.env.MOS_PORT) || cfg.port;
  if (process.env.MOS_HOST) cfg.host = process.env.MOS_HOST;
  if (process.env.MOS_DATA_DIR) {
    const dir = path.isAbsolute(process.env.MOS_DATA_DIR)
      ? process.env.MOS_DATA_DIR
      : path.join(ROOT, process.env.MOS_DATA_DIR);
    PATHS.dataDir = dir;
    PATHS.uploadDir = path.join(dir, 'uploads');
  }
  if (process.env.MOS_ALLOW_LOCALHOST !== undefined) {
    cfg.allowLocalhost = /^(1|true|yes|on)$/i.test(String(process.env.MOS_ALLOW_LOCALHOST).trim());
  }
  if (process.env.MOS_TRUSTED_PROXIES !== undefined) {
    cfg.trustedProxies = splitList(process.env.MOS_TRUSTED_PROXIES);
  }
  if (process.env.MOS_ALLOWED_CLIENT_CIDRS !== undefined) {
    cfg.allowedNetworks = splitList(process.env.MOS_ALLOWED_CLIENT_CIDRS);
  }
  if (process.env.MOS_ALLOWED_NETWORKS !== undefined) {
    cfg.allowedNetworks = splitList(process.env.MOS_ALLOWED_NETWORKS);
  }
  if (process.env.MOS_SECURE_COOKIES !== undefined) {
    cfg.auth.secureCookies = String(process.env.MOS_SECURE_COOKIES).trim();
  }
  if (process.env.MOS_ALLOWED_ORIGINS !== undefined) {
    cfg.auth.allowedOrigins = splitList(process.env.MOS_ALLOWED_ORIGINS);
  }

  cached = cfg;
  return cfg;
}

/** 供测试 / 热更新使用 */
function resetConfigCache() {
  cached = null;
}

function ensureDirs() {
  for (const dir of [PATHS.dataDir, PATHS.uploadDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { ROOT, PATHS, DEFAULT, getConfig, resetConfigCache, ensureDirs, mergeDeep, splitList };
