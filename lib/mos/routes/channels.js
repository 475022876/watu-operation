'use strict';
/**
 * Marketing OS —— Channel Registry（W05-03 / 05 §2）。
 *
 * 硬边界：
 *   - **业务库不存任何社媒密码/令牌**（05 §2）。本文件对 password/token/secret/oauth 之类的
 *     字段一律**显式拒绝**，而不是"忽略"——静默忽略会让操作者以为已经保存了。
 *   - V0.1 **不自动发布**：渠道只登记"人工发布"方式，`publishMode` 恒为 MANUAL。
 *   - 渠道属于品牌：跨品牌引用一律 404（防枚举）。
 */
const { get, post, put } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const { dictValid, CHANNEL_STATES } = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid } = require('../ids');
const helpers = require('./helpers');

/** 禁止出现在渠道记录中的敏感键（明文凭据） */
const FORBIDDEN_KEYS = ['password', 'passwd', 'pwd', 'token', 'secret', 'apikey', 'api_key',
  'oauth', 'accesstoken', 'access_token', 'refreshtoken', 'cookie', 'credential', 'session'];

function rejectSecrets(body) {
  const hit = Object.keys(body || {}).filter((k) => FORBIDDEN_KEYS.indexOf(String(k).toLowerCase()) !== -1);
  if (hit.length) {
    throw httpError(400,
      '渠道记录中禁止保存凭据字段（' + hit.join(', ') + '）。V0.1 一律人工发布，业务库不存社媒密码（05 §2）。',
      'SECRET_NOT_ALLOWED');
  }
}

function serialize(db, c) {
  const owner = db.users.find((u) => u.id === c.ownerId);
  const scheduleCount = db.publishing_schedules.filter((s) => s.channelId === c.id).length;
  return {
    id: c.id, brandCode: c.brandCode, platform: c.platform, handle: c.handle, url: c.url,
    label: c.label || '', state: c.state, publishMode: 'MANUAL',
    ownerId: c.ownerId, ownerName: owner ? owner.displayName : '',
    lastVerifiedAt: c.lastVerifiedAt || null,
    scheduleCount,
    demo: !!c.demo, createdAt: c.createdAt, updatedAt: c.updatedAt, rowVersion: c.rowVersion || 1
  };
}

get('/api/mos/channels', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.channels.filter((c) => c.brandCode === brandCode);
  if (ctx.query.state) rows = rows.filter((c) => c.state === String(ctx.query.state).toUpperCase());
  if (ctx.query.platform) rows = rows.filter((c) => c.platform === String(ctx.query.platform).toUpperCase());
  rows = rows.slice().sort((a, b) => (a.platform + a.handle < b.platform + b.handle ? -1 : 1));
  return {
    ok: true, brandCode, total: rows.length, items: rows.map((c) => serialize(db, c)),
    note: 'V0.1 不自动发布：渠道仅登记人工发布方式，且**不保存任何密码/令牌**（05 §2）。'
  };
});

post('/api/mos/channels', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  rejectSecrets(body);
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'publication.schedule', brandCode, { ip: ctx.ip, objectType: 'channel' });

  const platform = String(body.platform || '').toUpperCase();
  if (!dictValid('platforms', platform)) throw httpError(400, '平台非法（LINKEDIN / X / YOUTUBE / FACEBOOK）', 'BAD_PLATFORM');
  const handle = String(body.handle || '').trim();
  if (!handle) throw httpError(400, '请填写官方账号标识', 'MISSING_HANDLE');
  const url = String(body.url || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) throw httpError(400, '公开 URL 必须是 https 链接', 'BAD_URL');

  if (db.channels.some((c) => c.brandCode === brandCode && c.platform === platform
    && String(c.handle).toLowerCase() === handle.toLowerCase())) {
    throw httpError(409, '该品牌下同平台同账号已登记', 'CHANNEL_EXISTS');
  }

  const ownerId = body.ownerId ? String(body.ownerId) : ctx.user.id;
  if (!db.users.some((u) => u.id === ownerId)) throw httpError(400, '负责人不存在', 'OWNER_NOT_FOUND');

  const now = new Date().toISOString();
  const c = {
    id: uid('ch'), brandCode, platform, handle, url,
    label: String(body.label || '').slice(0, 120),
    state: 'ENABLED',                     // 05 §2：enabled
    publishMode: 'MANUAL',
    ownerId,
    lastVerifiedAt: now,
    demo: false,
    createdAt: now, createdBy: ctx.user.id, updatedAt: now, updatedBy: ctx.user.id, rowVersion: 1
  };
  db.channels.push(c);
  save();
  appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'channel.created', objectType: 'channel',
    objectId: c.id, newState: 'ENABLED', ip: ctx.ip, metadata: { platform, handle } });
  return { ok: true, channel: serialize(db, c) };
});

put('/api/mos/channels/:id', async (ctx) => {
  const db = getDb();
  const c = db.channels.find((x) => x.id === ctx.params.id);
  if (!c) throw httpError(404, '渠道不存在', 'CHANNEL_NOT_FOUND');
  rbac.assertBrand(ctx.principal, c.brandCode);

  const body = ctx.body || {};
  rejectSecrets(body);
  rbac.assertCan(ctx.principal, 'publication.schedule', c.brandCode, { ip: ctx.ip, objectType: 'channel', objectId: c.id });

  const patch = {};
  if (body.handle !== undefined) {
    const v = String(body.handle).trim();
    if (!v) throw httpError(400, '账号标识不能为空', 'MISSING_HANDLE');
    patch.handle = v;
  }
  if (body.url !== undefined) {
    const v = String(body.url).trim();
    if (!/^https:\/\/[^\s]+$/i.test(v)) throw httpError(400, '公开 URL 必须是 https 链接', 'BAD_URL');
    patch.url = v;
  }
  if (body.label !== undefined) patch.label = String(body.label).slice(0, 120);
  if (body.ownerId !== undefined) {
    const v = String(body.ownerId);
    if (!db.users.some((u) => u.id === v)) throw httpError(400, '负责人不存在', 'OWNER_NOT_FOUND');
    patch.ownerId = v;
  }
  if (body.state !== undefined) {
    const v = String(body.state).toUpperCase();
    if (CHANNEL_STATES.indexOf(v) === -1) throw httpError(400, '渠道状态非法', 'BAD_STATE');
    patch.state = v;
  }
  if (body.state === 'ENABLED') patch.lastVerifiedAt = new Date().toISOString();

  const prevState = c.state;
  const changed = helpers.applyUpdate(c, patch, ctx.user.id, body.rowVersion);
  if (changed) {
    save();
    appendAudit({ actorId: ctx.user.id, brandCode: c.brandCode, eventType: 'channel.updated',
      objectType: 'channel', objectId: c.id, oldState: prevState, newState: c.state, ip: ctx.ip,
      metadata: { fields: Object.keys(patch) } });
  }
  return { ok: true, channel: serialize(db, c), changed };
});

module.exports = { serialize, rejectSecrets };
