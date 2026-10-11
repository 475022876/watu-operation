'use strict';
/**
 * Marketing OS —— 标识符与编码工具。
 *
 * 设计约束（02_DOMAIN_DATA_MODEL §1）：
 *   - 所有主键采用 UUID/ULID 风格唯一 ID（本实现用 时间序 base36 + 随机熵，避免引入依赖）；
 *   - 时间一律 UTC ISO-8601 存储，展示层按用户时区换算；
 *   - 面向人的业务编码（计划号 / 任务号）单独生成，不承担主键职责。
 */
const crypto = require('node:crypto');

/** 唯一 ID：<prefix>_<时间序>_<随机熵> —— 时间序保证插入顺序可读，随机熵保证不可猜。 */
function uid(prefix) {
  const t = Date.now().toString(36);
  const r = crypto.randomBytes(6).toString('hex');
  return (prefix || 'id') + '_' + t + '_' + r;
}

/** 业务编码序号（按月/按品牌自增，仅用于展示） */
function nextSeq(db, key) {
  if (!db.seq || typeof db.seq !== 'object') db.seq = {};
  db.seq[key] = (Number(db.seq[key]) || 0) + 1;
  return db.seq[key];
}

/** 4 位补零 */
function pad4(n) {
  return String(n).padStart(4, '0');
}

/** 月计划业务编码：VFIB-2026-10-v1 */
function planCode(brandCode, year, month, version) {
  return brandCode + '-' + year + '-' + String(month).padStart(2, '0') + '-v' + (version || 1);
}

/** 内容任务业务编码：MOS-TASK-0001（全局自增） */
function taskCode(db) {
  return 'MOS-TASK-' + pad4(nextSeq(db, 'contentTask'));
}

/** 内容版本编码：MOS-TASK-0001-v3 */
function contentVersionCode(taskCodeText, number) {
  return taskCodeText + '-v' + number;
}

/** 内容指纹（用于版本冻结 / 审批 manifest 哈希的基础材料，非最终 manifest） */
function sha256(text) {
  return crypto.createHash('sha256').update(String(text == null ? '' : text), 'utf8').digest('hex');
}

/** 稳定 JSON 序列化（键排序），用于生成可复现的内容哈希 */
function stableStringify(value) {
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(walk);
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = walk(v[k]);
    return out;
  };
  return JSON.stringify(walk(value));
}

/** 内容版本哈希：正文 + 引用资产版本 + 渠道/语言 → canonical digest（02 §3） */
function contentHash(payload) {
  return sha256(stableStringify(payload));
}

module.exports = { uid, nextSeq, pad4, planCode, taskCode, contentVersionCode, sha256, stableStringify, contentHash };
