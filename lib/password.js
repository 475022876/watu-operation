'use strict';
/**
 * 密码哈希：scrypt + 随机盐 + 定时安全比较。
 * 不存明文、不用可逆加密，符合基本安全要求。
 */
const crypto = require('node:crypto');

const KEY_LEN = 64;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, KEY_LEN).toString('hex');
  return { salt, hash };
}

function verifyPassword(plain, salt, expectedHash) {
  if (!salt || !expectedHash) return false;
  let actual;
  try {
    actual = crypto.scryptSync(String(plain), salt, KEY_LEN);
  } catch (_) {
    return false;
  }
  const expected = Buffer.from(String(expectedHash), 'hex');
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function randomToken(bytes) {
  return crypto.randomBytes(bytes || 32).toString('hex');
}

/** 生成一个便于人工抄写的初始密码 */
function randomPassword(len) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const buf = crypto.randomBytes(len || 10);
  for (let i = 0; i < (len || 10); i += 1) out += chars[buf[i] % chars.length];
  return out;
}

module.exports = { hashPassword, verifyPassword, randomToken, randomPassword };
