'use strict';
/**
 * 密钥安全存储（V0.1.4 真实接入）。
 *
 * 目标（用户要求 4：密钥安全）：
 *  1. **静态加密**：所有供应商 API Key / 私钥在 `data/mos.json` 中只以 AES-256-GCM 密文存在，
 *     任何时刻都不落明文；即使数据文件被复制/上传，也无法直接读出密钥。
 *  2. **单一主密钥**：优先级 `MOS_SECRET_KEY`（环境变量，生产唯一推荐）> `data/.mos-secret.key`
 *     （首次自动生成，权限 0600，仅供本地/隔离环境）。两者都没有时才生成，并**明确告警**。
 *  3. **只出不进**：对外（API/UI）只给掩码 `sk-••••••••1a2b` 与指纹，**绝不回传明文**。
 *  4. **日志脱敏**：`redact()` 递归处理对象，并对字符串里的 `sk-*` / `Bearer *` /
 *     `?key=` / PEM 私钥做正则擦除——避免错误信息把密钥带进审计日志。
 *
 * 诚实性：本模块不声称"加密后绝对安全"。主密钥若与被加密数据同机同目录（本地兜底模式），
 * 攻击者若已获得文件系统读权限仍可解密。生产必须使用环境变量注入，见 `docs/PROVIDER_INTEGRATION_GUIDE.md`。
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('../config');

const ALGO = 'aes-256-gcm';
const KEY_BYTES = 32;
const ENV_NAME = 'MOS_SECRET_KEY';
const KEY_FILE_NAME = '.mos-secret.key';
const KDF_SALT = 'mos-provider-secrets-v1';

let cachedKey = null;
let cachedMeta = null;

function keyFilePath() {
  return path.join(PATHS.dataDir, KEY_FILE_NAME);
}

/** 解析密钥材料：32 字节原始值（base64 / hex / base64url）或任意口令（scrypt 派生） */
function parseKeyMaterial(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;

  // hex（64 字符）
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  // base64 / base64url（43-44 字符，解码后 32 字节）
  try {
    const b = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (b.length === KEY_BYTES) return b;
  } catch (_) { /* 继续按口令处理 */ }

  // 任意口令：scrypt 确定性派生（同一口令必然得到同一密钥，便于运维在容器间复用）
  return crypto.scryptSync(s, KDF_SALT, KEY_BYTES, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
}

/**
 * 取主密钥。
 * @returns {{key:Buffer, source:'env'|'file'|'generated', filePath:string, warning:string}}
 */
function masterKey() {
  if (cachedKey) return Object.assign({ key: cachedKey }, cachedMeta);

  const fromEnv = process.env[ENV_NAME];
  if (fromEnv && String(fromEnv).trim()) {
    const key = parseKeyMaterial(fromEnv);
    if (!key) throw new Error('MOS_SECRET_KEY 无法解析');
    cachedKey = key;
    cachedMeta = {
      source: 'env', filePath: '',
      warning: '',
      keyFingerprint: fingerprintOf(key)
    };
    return Object.assign({ key }, cachedMeta);
  }

  const file = keyFilePath();
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    const key = parseKeyMaterial(raw);
    if (!key) throw new Error('主密钥文件无法解析：' + file);
    cachedKey = key;
    cachedMeta = {
      source: 'file', filePath: file,
      warning: '主密钥来自本地文件（data/.mos-secret.key）：仅适用于本地/隔离环境，'
        + '生产部署请改用环境变量 ' + ENV_NAME + ' 注入，避免密钥与密文同处一地。',
      keyFingerprint: fingerprintOf(key)
    };
    return Object.assign({ key }, cachedMeta);
  }

  // 首次生成（仅本地兜底）
  const key = crypto.randomBytes(KEY_BYTES);
  fs.mkdirSync(PATHS.dataDir, { recursive: true });
  fs.writeFileSync(file, key.toString('hex'), { encoding: 'utf8', mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (_) { /* Windows 部分文件系统不支持，忽略 */ }
  cachedKey = key;
  cachedMeta = {
    source: 'generated', filePath: file,
    warning: '已自动生成主密钥文件 ' + file + '（权限 0600）。生产部署请改用环境变量 '
      + ENV_NAME + ' 注入，并把该文件排除在备份/同步之外。',
    keyFingerprint: fingerprintOf(key)
  };
  return Object.assign({ key }, cachedMeta);
}

function fingerprintOf(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

/** 主密钥状态（给运维看；不含密钥本身，仅指纹） */
function status() {
  try {
    const m = masterKey();
    return {
      configured: true,
      source: m.source,
      keyFingerprint: m.keyFingerprint,
      filePath: m.filePath,
      fromEnv: m.source === 'env',
      warning: m.warning
    };
  } catch (err) {
    return {
      configured: false, source: 'unavailable', keyFingerprint: '',
      filePath: '', fromEnv: false, warning: String((err && err.message) || err)
    };
  }
}

/**
 * 加密一个秘密字符串。
 * @returns {{v:number, alg:string, iv:string, tag:string, ct:string, kf:string}|null}
 */
function seal(plain) {
  const s = String(plain == null ? '' : plain);
  if (!s) return null;
  const m = masterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, m.key, iv);
  const ct = Buffer.concat([cipher.update(s, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: ALGO,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
    kf: m.keyFingerprint
  };
}

/**
 * 解密。主密钥与密文不匹配（换过密钥）时抛出可识别错误，**不返回空值糊弄调用方**。
 */
function open(blob) {
  if (!blob) return '';
  if (typeof blob === 'string') return blob; // 兼容历史明文（迁移期只读）
  if (!isSealed(blob)) throw new Error('密钥密文格式非法');
  const m = masterKey();
  if (blob.kf && blob.kf !== m.keyFingerprint) {
    const e = new Error('主密钥与密文不匹配（密钥已轮换）：请重新录入该供应商的密钥');
    e.code = 'SECRET_KEY_MISMATCH';
    throw e;
  }
  try {
    const decipher = crypto.createDecipheriv(ALGO, m.key, Buffer.from(blob.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    const e = new Error('密钥解密失败（密文损坏或主密钥已变更）：请重新录入');
    e.code = 'SECRET_DECRYPT_FAILED';
    throw e;
  }
}

function isSealed(v) {
  return !!v && typeof v === 'object' && typeof v.ct === 'string' && typeof v.iv === 'string'
    && typeof v.tag === 'string';
}

/**
 * 掩码：只保留前 3 位与后 4 位，中间固定 8 个圆点。
 * 短于 12 位的密钥一律全掩码（避免通过掩码反推）。
 */
function mask(secret) {
  const s = String(secret == null ? '' : secret);
  if (!s) return '';
  if (s.length < 12) return '••••••••';
  return s.slice(0, 3) + '••••••••' + s.slice(-4);
}

/** 指纹：用于在 UI 上确认"换了哪一把钥匙"，不可反推 */
function fingerprint(secret) {
  const s = String(secret == null ? '' : secret);
  if (!s) return '';
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
}

const SECRET_KEY_NAMES = /^(apikey|api_key|key|token|secret|password|passwd|privatekey|private_key|privatekeypem|authorization|access_token|refresh_token)$/i;

/**
 * 递归脱敏：对象里名为 apiKey/token/privateKey* 的字段一律替换为掩码；
 * 字符串内部的 sk-* / Bearer 令牌 / ?key= / PEM 私钥做正则擦除。
 * 用途：写审计日志、错误信息、调用日志前的统一关口。
 */
function redact(value, depth) {
  const d = depth === undefined ? 0 : depth;
  if (d > 6) return '[depth-limit]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, d + 1));
  if (typeof value === 'object') {
    if (isSealed(value)) return '[encrypted]';
    const out = {};
    for (const k of Object.keys(value)) {
      if (SECRET_KEY_NAMES.test(k) && value[k]) out[k] = mask(typeof value[k] === 'string' ? value[k] : '••••••••');
      else out[k] = redact(value[k], d + 1);
    }
    return out;
  }
  return String(value);
}

function redactText(text) {
  let s = String(text == null ? '' : text);
  s = s.replace(/(sk-[A-Za-z0-9_-]{6,})/g, (m) => mask(m));
  s = s.replace(/(Bearer\s+)([A-Za-z0-9._~+\/-]{8,}=*)/gi, '$1••••••••');
  s = s.replace(/([?&](?:key|api_key|apikey|token|access_token|subscription-token)=)([^&\s"']+)/gi,
    (m, p1) => p1 + '••••••••');
  s = s.replace(/(-----BEGIN [A-Z ]*PRIVATE KEY-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----)/g,
    '$1••••••••$2');
  return s;
}

/** 供测试：清空缓存（切换 MOS_SECRET_KEY 后必须调用） */
function resetCache() {
  cachedKey = null;
  cachedMeta = null;
}

module.exports = {
  ENV_NAME, KEY_FILE_NAME, ALGO,
  masterKey, status, seal, open, isSealed,
  mask, fingerprint, redact, redactText, resetCache, keyFilePath
};
