'use strict';
/**
 * Marketing OS —— append-only 审计事件（02 §2 audit_events / 03 §1）。
 *
 * 原则：
 *   - 只追加，不修改、不删除既有事件；
 *   - 记录 actor / brand / event_type / object_type / object_id / 状态迁移 / correlation_id / 时间；
 *   - metadata **脱敏**：不得写入口令、令牌、密钥、正文全文、客户数据。
 */
const { getDb, save } = require('./store');
const { uid } = require('./ids');

/** 明令禁止出现在 metadata 的键（命中即丢弃，避免误写敏感值） */
const FORBIDDEN_KEYS = /^(password|passwd|pwd|token|secret|apiKey|key|cookie|session|salt|hash|authorization)$/i;
/** 单值长度上限，避免把整篇正文塞进审计 */
const MAX_VALUE_LEN = 300;

function sanitize(value, depth) {
  const d = depth || 0;
  if (d > 4) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_VALUE_LEN ? value.slice(0, MAX_VALUE_LEN) + '…' : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, d + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      if (FORBIDDEN_KEYS.test(k)) { out[k] = '[redacted]'; continue; }
      out[k] = sanitize(value[k], d + 1);
    }
    return out;
  }
  return String(value);
}

/**
 * 追加一条审计事件。
 * @param {object} evt { actorId, brandCode, eventType, objectType, objectId,
 *                       oldState, newState, correlationId, metadata, ip }
 */
function appendAudit(evt) {
  const db = getDb();
  const event = {
    id: uid('aud'),
    actorId: evt.actorId || '',
    brandCode: evt.brandCode || '',
    eventType: evt.eventType || 'unknown',
    objectType: evt.objectType || '',
    objectId: evt.objectId || '',
    oldState: evt.oldState === undefined ? null : evt.oldState,
    newState: evt.newState === undefined ? null : evt.newState,
    correlationId: evt.correlationId || '',
    outcome: evt.outcome || 'ok',
    ip: evt.ip || '',
    metadata: sanitize(evt.metadata || {}),
    timestamp: new Date().toISOString()
  };
  db.audit_events.push(event);
  if (db.audit_events.length > 20000) db.audit_events.splice(0, db.audit_events.length - 20000);
  save();
  return event;
}

/** 审计事件查询（服务端按品牌范围过滤由调用方完成） */
function listAudit(db, filter) {
  const f = filter || {};
  return db.audit_events
    .filter((e) => {
      if (f.brandCode && e.brandCode !== f.brandCode) return false;
      if (f.objectType && e.objectType !== f.objectType) return false;
      if (f.objectId && e.objectId !== f.objectId) return false;
      if (f.eventType && e.eventType !== f.eventType) return false;
      if (f.actorId && e.actorId !== f.actorId) return false;
      return true;
    })
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

module.exports = { appendAudit, listAudit, sanitize };
