'use strict';
/**
 * Marketing OS —— 发布与归档（W05-01/02/04、05 §1/§3/§4）。
 *
 * 三条不可动摇的规则：
 *   1. **未批准内容不能进入 Ready**：`READY` 要求 contentVersion.state === 'APPROVED'（SEC-04）。
 *      审核未完成时只能建 DRAFT / BLOCKED 排期用于计划。
 *   2. **到期不自动发布**：本文件**没有任何定时器**；`PUBLISHED` 只能由人工登记产生
 *      （「禁止把发布时间到期自动标记 PUBLISHED」，00 §3）。
 *   3. **发布快照不可覆盖**：登记时把正文与引用资产**物理复制**进 `published/<id>/`，
 *      此后项目里再改文件也不会影响归档；更正/撤回一律追加事件，不改写旧快照（05 §4）。
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { get, post, put } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const { PATHS } = require('../../config');
const {
  SCHEDULE_STATES, SCHEDULE_TRANSITIONS, PUBLICATION_TRANSITIONS, dictValid
} = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid } = require('../ids');
const helpers = require('./helpers');

/* ==================== 排期 ==================== */

function versionOf(db, id) {
  return db.content_versions.find((v) => v.id === id) || null;
}
function channelOf(db, id) {
  return db.channels.find((c) => c.id === id) || null;
}

function serializeSchedule(db, s) {
  const v = versionOf(db, s.contentVersionId);
  const c = channelOf(db, s.channelId);
  const task = v ? db.content_tasks.find((t) => t.id === v.contentTaskId) : null;
  const pub = db.publication_records.find((p) => p.scheduleId === s.id && p.status !== 'REMOVED');
  return {
    id: s.id, brandCode: s.brandCode,
    contentVersionId: s.contentVersionId,
    versionCode: v ? v.code : '（版本已删除）',
    versionState: v ? v.state : '',
    versionTitle: v ? v.title : '',
    taskId: task ? task.id : null,
    taskCode: task ? task.code : '',
    channelId: s.channelId,
    channelLabel: c ? (c.platform + ' · ' + c.handle) : '（渠道已删除）',
    channelState: c ? c.state : '',
    platform: c ? c.platform : '',
    plannedAt: s.plannedAt,
    timezone: s.timezone || 'Asia/Shanghai',
    state: s.state,
    blockedReason: s.blockedReason || '',
    revision: s.revision || 1,
    publicationId: pub ? pub.id : null,
    publicationStatus: pub ? pub.status : null,
    allowedTransitions: SCHEDULE_TRANSITIONS[s.state] || [],
    createdAt: s.createdAt, updatedAt: s.updatedAt, rowVersion: s.rowVersion || 1,
    demo: !!s.demo
  };
}

/** 排期是否可进入 READY（版本已批准 + 渠道启用） */
function readyGate(db, s) {
  const v = versionOf(db, s.contentVersionId);
  const c = channelOf(db, s.channelId);
  if (!v) return { ok: false, reason: '内容版本不存在' };
  if (v.state !== 'APPROVED') {
    return { ok: false, reason: '内容版本尚未通过审批（当前 ' + v.state + '）：未批准内容不能进入 Ready（SEC-04）' };
  }
  if (!c) return { ok: false, reason: '渠道不存在' };
  if (c.state !== 'ENABLED') return { ok: false, reason: '渠道已停用，不能排期' };
  return { ok: true, reason: '' };
}

get('/api/mos/publishing/schedules', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.publishing_schedules.filter((s) => s.brandCode === brandCode);
  if (ctx.query.state) rows = rows.filter((s) => s.state === String(ctx.query.state).toUpperCase());
  if (ctx.query.channelId) rows = rows.filter((s) => s.channelId === String(ctx.query.channelId));
  if (ctx.query.versionId) rows = rows.filter((s) => s.contentVersionId === String(ctx.query.versionId));
  rows = rows.slice().sort((a, b) => String(a.plannedAt).localeCompare(String(b.plannedAt)));
  const paged = helpers.paginate(rows, ctx.query);
  return {
    ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((s) => serializeSchedule(db, s)),
    queue: {
      ready: rows.filter((s) => s.state === 'READY').length,
      scheduled: rows.filter((s) => s.state === 'SCHEDULED').length,
      blocked: rows.filter((s) => s.state === 'BLOCKED').length,
      draft: rows.filter((s) => s.state === 'DRAFT').length,
      cancelled: rows.filter((s) => s.state === 'CANCELLED').length
    },
    note: '到期不会自动发布；只有人工登记真实 URL/证据后才会产生 Published Archive 记录（05 §3）。'
  };
});

/** 日历聚合：Month / Week / List 都读这一个接口（05 §1：日历只是排期的不同视图） */
get('/api/mos/publishing/calendar', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  const from = String(ctx.query.from || '').slice(0, 10);
  const to = String(ctx.query.to || '').slice(0, 10);
  let rows = db.publishing_schedules.filter((s) => s.brandCode === brandCode);
  if (from) rows = rows.filter((s) => String(s.plannedAt).slice(0, 10) >= from);
  if (to) rows = rows.filter((s) => String(s.plannedAt).slice(0, 10) <= to);

  const byDate = {};
  for (const s of rows) {
    const d = String(s.plannedAt).slice(0, 10);
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(serializeSchedule(db, s));
  }
  const dayList = Object.keys(byDate).sort().map((d) => ({ date: d, items: byDate[d] }));

  // 计划侧（PlanItem）与排期共享日历：一并返回，便于月视图叠加显示
  const planItems = db.plan_items.filter((i) => {
    const p = db.monthly_plans.find((x) => x.id === i.planId);
    if (!p || p.brandCode !== brandCode) return false;
    if (from && String(i.workDate) < from) return false;
    if (to && String(i.workDate) > to) return false;
    return true;
  }).map((i) => ({ id: i.id, title: i.title, workDate: i.workDate, priority: i.priority,
    adHoc: !!i.adHoc, contentTaskId: i.contentTaskId || null }));

  return {
    ok: true, brandCode,
    range: { from: from || null, to: to || null },
    days: dayList,
    total: rows.length,
    planItems,
    legend: '排期状态色仅作辅助，必须同时显示文字状态（07 §6：警告不用颜色独自表达）。',
    note: '拖动日历只改变**计划时间**，不会修改 actual_publish_at（05 §7）。'
  };
});

post('/api/mos/publishing/schedules', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'publication.schedule', brandCode, { ip: ctx.ip, objectType: 'publishing_schedule' });

  const v = versionOf(db, String(body.contentVersionId || ''));
  if (!v) throw httpError(400, '内容版本不存在', 'VERSION_NOT_FOUND');
  rbac.assertSameBrand(v.brandCode, brandCode);

  const channelIds = Array.isArray(body.channelIds) ? body.channelIds.map(String)
    : (body.channelId ? [String(body.channelId)] : []);
  if (!channelIds.length) throw httpError(400, '请至少选择一个渠道', 'MISSING_CHANNEL');
  if (channelIds.length > 20) throw httpError(400, '渠道数量过多', 'TOO_MANY_CHANNELS');

  const plannedAt = String(body.plannedAt || '').slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(plannedAt)) {
    throw httpError(400, '计划发布时间格式非法（YYYY-MM-DD 或 YYYY-MM-DDTHH:mm）', 'BAD_DATE');
  }

  const created = [];
  for (const cid of channelIds) {
    const c = channelOf(db, cid);
    if (!c) throw httpError(400, '渠道不存在：' + cid, 'CHANNEL_NOT_FOUND');
    rbac.assertSameBrand(c.brandCode, brandCode);
    const now = new Date().toISOString();
    const gate = readyGate(db, { contentVersionId: v.id, channelId: cid });
    const s = {
      id: uid('ps'),
      brandCode,
      contentVersionId: v.id,
      channelId: cid,
      plannedAt,
      timezone: String(body.timezone || 'Asia/Shanghai').slice(0, 60),
      // 05 §3：未完成审核的排期只能是 BLOCKED，不可变 READY
      state: gate.ok ? 'READY' : 'BLOCKED',
      blockedReason: gate.ok ? '' : gate.reason,
      revision: 1,
      demo: false,
      createdAt: now, createdBy: ctx.user.id, updatedAt: now, updatedBy: ctx.user.id, rowVersion: 1
    };
    db.publishing_schedules.push(s);
    created.push(s);
  }
  save();
  for (const s of created) {
    appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'publishing_schedule.created',
      objectType: 'publishing_schedule', objectId: s.id, newState: s.state, ip: ctx.ip,
      metadata: { versionCode: v.code, channelId: s.channelId, plannedAt, blockedReason: s.blockedReason } });
  }
  return {
    ok: true,
    schedules: created.map((s) => serializeSchedule(db, s)),
    note: created.every((s) => s.state === 'READY')
      ? '排期已进入 Ready。'
      : '存在未批准的版本：排期被标记为 Blocked，须先完成审批。'
  };
});

put('/api/mos/publishing/schedules/:id', async (ctx) => {
  const db = getDb();
  const s = db.publishing_schedules.find((x) => x.id === ctx.params.id);
  if (!s) throw httpError(404, '排期不存在', 'SCHEDULE_NOT_FOUND');
  rbac.assertBrand(ctx.principal, s.brandCode);

  const body = ctx.body || {};
  const prevState = s.state;
  const effects = [];

  // 1) 改期：只动计划时间，绝不触碰 actual_publish_at（05 §7）
  if (body.plannedAt !== undefined) {
    rbac.assertCan(ctx.principal, 'publication.schedule', s.brandCode,
      { ip: ctx.ip, objectType: 'publishing_schedule', objectId: s.id });
    const at = String(body.plannedAt).slice(0, 19);
    if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(at)) {
      throw httpError(400, '计划发布时间格式非法', 'BAD_DATE');
    }
    if (at !== s.plannedAt) {
      s.plannedAt = at;
      s.revision = Number(s.revision || 1) + 1;
      effects.push('plannedAt→' + at);
    }
  }
  if (body.timezone !== undefined) s.timezone = String(body.timezone).slice(0, 60);

  // 2) 状态迁移
  if (body.state !== undefined) {
    const target = String(body.state).toUpperCase();
    if (SCHEDULE_STATES.indexOf(target) === -1) throw httpError(400, '排期状态非法', 'BAD_STATE');
    const allowed = SCHEDULE_TRANSITIONS[s.state] || [];
    if (allowed.indexOf(target) === -1) {
      throw httpError(409, '当前排期状态 ' + s.state + ' 不允许迁移到 ' + target, 'ILLEGAL_TRANSITION');
    }
    if (target === 'SCHEDULED') {
      rbac.assertCan(ctx.principal, 'publication.schedule', s.brandCode,
        { ip: ctx.ip, objectType: 'publishing_schedule', objectId: s.id });
    } else {
      rbac.assertCan(ctx.principal, 'publication.schedule', s.brandCode,
        { ip: ctx.ip, objectType: 'publishing_schedule', objectId: s.id });
    }
    if (target === 'READY') {
      const gate = readyGate(db, s);
      if (!gate.ok) {
        appendAudit({ actorId: ctx.user.id, brandCode: s.brandCode, eventType: 'publishing_schedule.ready_denied',
          objectType: 'publishing_schedule', objectId: s.id, outcome: 'denied', ip: ctx.ip,
          metadata: { reason: gate.reason } });
        throw httpError(409, gate.reason, 'NOT_APPROVED');
      }
      s.blockedReason = '';
    }
    if (target === 'SCHEDULED') {
      const pub = db.publication_records.find((p) => p.scheduleId === s.id && p.status !== 'REMOVED');
      if (pub) throw httpError(409, '该排期已有发布记录，不能再回到 Scheduled', 'ALREADY_PUBLISHED');
    }
    s.state = target;
    effects.push(prevState + '→' + target);
  }

  const changed = helpers.applyUpdate(s, {}, ctx.user.id, ctx.body ? ctx.body.rowVersion : undefined);
  void changed;
  save();
  if (effects.length) {
    appendAudit({ actorId: ctx.user.id, brandCode: s.brandCode, eventType: 'publishing_schedule.updated',
      objectType: 'publishing_schedule', objectId: s.id, oldState: prevState, newState: s.state, ip: ctx.ip,
      metadata: { effects } });
  }
  return { ok: true, schedule: serializeSchedule(db, s), effects };
});

/* ==================== 人工发布登记 + 不可覆盖快照 ==================== */

/**
 * 生成发布快照：把正文与引用资产**物理复制**到 published/<publicationId>/
 * 复制而非引用，是"归档不受项目后续修改影响"的实现基础（E2E-04）。
 */
function createSnapshot(db, pub, v, channel) {
  const dirRel = 'published/' + pub.id;
  const dirAbs = path.join(PATHS.uploadDir, dirRel);
  fs.mkdirSync(dirAbs, { recursive: true });
  const rows = [];

  const push = (kind, relParts, buf, extra) => {
    const rel = dirRel + '/' + relParts;
    fs.writeFileSync(path.join(PATHS.uploadDir, rel), buf);
    const row = Object.assign({
      id: uid('pa'),
      publicationId: pub.id,
      brandCode: pub.brandCode,
      objectKey: rel,
      sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      bytes: buf.length,
      kind,
      manifestHash: pub.manifestHash,
      immutable: true,
      preservedAt: new Date().toISOString()
    }, extra || {});
    rows.push(row);
    return row;
  };

  push('TEXT_SNAPSHOT', 'content.md', Buffer.from(String(v.body || ''), 'utf8'),
    { mime: 'text/markdown; charset=utf-8', fileName: v.code + '.md' });

  push('MANIFEST', 'manifest.json', Buffer.from(JSON.stringify({
    publicationId: pub.id,
    brandCode: pub.brandCode,
    contentVersionId: v.id,
    contentVersionCode: v.code,
    contentVersionState: v.state,
    textHash: pub.textHash,
    manifestHash: pub.manifestHash,
    approvedAt: v.approvedAt || null,
    approvedBy: v.approvedBy || '',
    channel: channel ? { id: channel.id, platform: channel.platform, handle: channel.handle, url: channel.url } : null,
    actualAt: pub.actualAt,
    url: pub.url,
    operatorId: pub.operatorId,
    evidenceRef: pub.evidenceRef || '',
    disclosures: (v.disclosures || []).slice(),
    locale: v.locale || 'zh-CN',
    preservedAt: new Date().toISOString(),
    note: '本清单为发布时点的冻结记录；后续任何修改都只能通过 correction/replacement/removal 事件追加。'
  }, null, 2), 'utf8'), { mime: 'application/json; charset=utf-8', fileName: 'manifest.json' });

  for (const aid of (v.refAssetIds || [])) {
    const a = db.working_assets.find((x) => x.id === aid);
    if (!a) continue;
    const abs = path.join(PATHS.uploadDir, a.objectKey);
    let buf;
    try { buf = fs.readFileSync(abs); } catch (_) { continue; }
    push('ASSET', 'assets/' + path.basename(a.objectKey), buf,
      { mime: a.mime, fileName: a.fileName, sourceAssetId: a.id });
  }

  return rows;
}

post('/api/mos/publications', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const schedule = db.publishing_schedules.find((s) => s.id === String(body.scheduleId || ''));
  if (!schedule) throw httpError(400, '排期不存在', 'SCHEDULE_NOT_FOUND');
  rbac.assertBrand(ctx.principal, schedule.brandCode);
  rbac.assertCan(ctx.principal, 'publication.record', schedule.brandCode,
    { ip: ctx.ip, objectType: 'publication_record', objectId: schedule.id });

  if (schedule.state !== 'SCHEDULED') {
    throw httpError(409, '只有 SCHEDULED 状态的排期可以登记实际发布（当前 ' + schedule.state + '）', 'NOT_SCHEDULED');
  }
  // 重复发布动作不得重复生成归档（05 §7）
  const dup = db.publication_records.find((p) => p.scheduleId === schedule.id && p.status !== 'REMOVED');
  if (dup) throw httpError(409, '该排期已有发布记录（' + dup.id + '），未重复生成归档', 'DUPLICATE_PUBLICATION');

  const v = versionOf(db, schedule.contentVersionId);
  if (!v) throw httpError(409, '内容版本不存在，无法归档', 'VERSION_NOT_FOUND');
  if (v.state !== 'APPROVED') {
    throw httpError(409, '未批准内容不能登记发布（当前 ' + v.state + '）', 'NOT_APPROVED');
  }

  const url = String(body.url || '').trim();
  const evidenceRef = String(body.evidenceRef || '').trim();
  // 05 §3 / §7：必须提供真实 URL 或可审核替代证据，不允许伪造 URL
  if (!url && !evidenceRef) {
    throw httpError(400, '必须填写真实发布 URL，或提供可审核的替代证据说明', 'MISSING_PROOF');
  }
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
    throw httpError(400, '发布 URL 格式非法（须为 http/https 链接）', 'BAD_URL');
  }
  const actualAt = String(body.actualAt || '').slice(0, 19);
  if (!/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$/.test(actualAt)) {
    throw httpError(400, '实际发布时间格式非法', 'BAD_DATE');
  }

  const channel = channelOf(db, schedule.channelId);
  const now = new Date().toISOString();
  const pub = {
    id: uid('pub'),
    brandCode: schedule.brandCode,
    scheduleId: schedule.id,
    contentVersionId: v.id,
    channelId: schedule.channelId,
    actualAt,
    url,
    operatorId: ctx.user.id,
    evidenceRef,
    status: 'PUBLISHED',
    notes: String(body.notes || '').slice(0, 1000),
    textHash: require('../manifest').textHash(v),
    manifestHash: v.manifestHash || '',
    approvedAt: v.approvedAt || null,
    approvedBy: v.approvedBy || '',
    demo: false,
    createdAt: now
  };
  db.publication_records.push(pub);

  const artifacts = createSnapshot(db, pub, v, channel);
  for (const a of artifacts) db.published_artifacts.push(a);

  save();
  appendAudit({ actorId: ctx.user.id, brandCode: pub.brandCode, eventType: 'publication.recorded',
    objectType: 'publication_record', objectId: pub.id, newState: 'PUBLISHED', ip: ctx.ip,
    metadata: { versionCode: v.code, channelId: pub.channelId, url: pub.url, actualAt,
      artifacts: artifacts.length, manifestHash: pub.manifestHash } });

  return {
    ok: true,
    publication: serializePublication(db, pub),
    artifacts: artifacts.map((a) => ({ id: a.id, kind: a.kind, fileName: a.fileName, sha256: a.sha256, bytes: a.bytes })),
    note: '发布快照已物理复制归档，不可覆盖；后续变更只能追加 correction/replacement/removal（05 §4）。'
  };
});

function serializePublication(db, p) {
  const v = versionOf(db, p.contentVersionId);
  const c = channelOf(db, p.channelId);
  const artifacts = db.published_artifacts.filter((a) => a.publicationId === p.id)
    .map((a) => ({ id: a.id, kind: a.kind, fileName: a.fileName, bytes: a.bytes, sha256: a.sha256, objectKey: a.objectKey }));
  const corrections = db.publication_corrections.filter((x) => x.publicationId === p.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const metrics = db.publication_metrics.filter((x) => x.publicationId === p.id);
  const task = v ? db.content_tasks.find((t) => t.id === v.contentTaskId) : null;
  const operator = db.users.find((u) => u.id === p.operatorId);
  return {
    id: p.id, brandCode: p.brandCode, scheduleId: p.scheduleId,
    contentVersionId: p.contentVersionId,
    versionCode: v ? v.code : '（版本已删除）',
    versionTitle: v ? v.title : '',
    taskCode: task ? task.code : '',
    channelId: p.channelId,
    channelLabel: c ? (c.platform + ' · ' + c.handle) : '（渠道已删除）',
    platform: c ? c.platform : '',
    actualAt: p.actualAt, url: p.url, evidenceRef: p.evidenceRef || '',
    operatorId: p.operatorId, operatorName: operator ? operator.displayName : '',
    status: p.status,
    textHash: p.textHash, manifestHash: p.manifestHash,
    approvedAt: p.approvedAt || null, approvedBy: p.approvedBy || '',
    /** 归档正文只读：从快照文件读取，绝不回读项目中的工作副本 */
    artifacts, corrections, metrics,
    notes: p.notes || '',
    /** 复用为新内容 ≠ 获得 Approved 资产资格（05 §4） */
    reuseNote: 'Reuse as New Content 只会在 Marketing OS 创建新草稿，需重新审核事实与使用权，不获得 Approved 资产资格。',
    createdAt: p.createdAt
  };
}

get('/api/mos/publications', async (ctx) => {
  const db = getDb();
  const brandCode = helpers.resolveBrand(ctx);
  let rows = db.publication_records.filter((p) => p.brandCode === brandCode);
  if (ctx.query.status) rows = rows.filter((p) => p.status === String(ctx.query.status).toUpperCase());
  if (ctx.query.channelId) rows = rows.filter((p) => p.channelId === String(ctx.query.channelId));
  const kw = String(ctx.query.q || '').trim().toLowerCase();
  if (kw) {
    rows = rows.filter((p) => {
      const v = versionOf(db, p.contentVersionId);
      return String(p.url).toLowerCase().indexOf(kw) !== -1
        || (v && (String(v.title).toLowerCase().indexOf(kw) !== -1 || String(v.code).toLowerCase().indexOf(kw) !== -1));
    });
  }
  rows = rows.slice().sort((a, b) => (String(a.actualAt) < String(b.actualAt) ? 1 : -1));
  const paged = helpers.paginate(rows, ctx.query);
  return {
    ok: true, brandCode, page: paged.page, pageSize: paged.pageSize, total: paged.total,
    items: paged.items.map((p) => serializePublication(db, p)),
    note: 'Published Archive 是 Marketing OS 内的独立权威归档；已发布内容**不会**自动进入企业资料库（00 §1）。'
  };
});

get('/api/mos/publications/:id', async (ctx) => {
  const db = getDb();
  const p = db.publication_records.find((x) => x.id === ctx.params.id);
  if (!p) throw httpError(404, '发布记录不存在', 'PUBLICATION_NOT_FOUND');
  rbac.assertBrand(ctx.principal, p.brandCode);

  // 归档正文从快照文件读取（只读）
  const textArt = db.published_artifacts.find((a) => a.publicationId === p.id && a.kind === 'TEXT_SNAPSHOT');
  let archivedBody = null;
  if (textArt) {
    try { archivedBody = fs.readFileSync(path.join(PATHS.uploadDir, textArt.objectKey), 'utf8'); }
    catch (_) { archivedBody = null; }
  }
  const decisions = (db.review_decisions || []).filter((d) => d.subjectId === p.contentVersionId);
  return {
    ok: true,
    publication: serializePublication(db, p),
    archivedBody,
    archivedBodyAvailable: archivedBody !== null,
    approvalTrail: decisions.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    note: '归档快照不可编辑；如需更正请追加 correction/removal 事件（保留原档）。'
  };
});

post('/api/mos/publications/:id/corrections', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const p = db.publication_records.find((x) => x.id === ctx.params.id);
  if (!p) throw httpError(404, '发布记录不存在', 'PUBLICATION_NOT_FOUND');
  rbac.assertBrand(ctx.principal, p.brandCode);
  rbac.assertCan(ctx.principal, 'publication.record', p.brandCode,
    { ip: ctx.ip, objectType: 'publication_record', objectId: p.id });

  const kind = String(body.kind || '').toUpperCase();
  if (!dictValid('correctionKinds', kind)) {
    throw httpError(400, '更正类型非法（CORRECTION / REPLACEMENT / REMOVAL）', 'BAD_KIND');
  }
  const reason = String(body.reason || '').trim();
  if (!reason) throw httpError(400, '必须填写更正/撤回原因', 'MISSING_REASON');

  const targetStatus = kind === 'REMOVAL' ? 'REMOVED' : 'CORRECTED';
  const allowed = PUBLICATION_TRANSITIONS[p.status] || [];
  if (allowed.indexOf(targetStatus) === -1) {
    throw httpError(409, '发布记录当前状态 ' + p.status + ' 不允该操作', 'ILLEGAL_TRANSITION');
  }

  const newPublicationId = body.newPublicationId ? String(body.newPublicationId) : null;
  if (newPublicationId && !db.publication_records.some((x) => x.id === newPublicationId)) {
    throw httpError(400, '替换目标发布记录不存在', 'PUBLICATION_NOT_FOUND');
  }

  const prev = p.status;
  p.status = targetStatus;
  const corr = {
    id: uid('pc'),
    publicationId: p.id,
    brandCode: p.brandCode,
    kind, reason: reason.slice(0, 1000),
    newPublicationId,
    previousStatus: prev,
    createdBy: ctx.user.id,
    createdAt: new Date().toISOString()
  };
  db.publication_corrections.push(corr);
  save();
  appendAudit({ actorId: ctx.user.id, brandCode: p.brandCode, eventType: 'publication.corrected',
    objectType: 'publication_record', objectId: p.id, oldState: prev, newState: targetStatus, ip: ctx.ip,
    metadata: { kind, reason: corr.reason.slice(0, 200), newPublicationId } });

  return {
    ok: true,
    correction: corr,
    publication: serializePublication(db, p),
    note: '原发布快照保持不变；本次更正作为追加事件永久保留（05 §4）。'
  };
});

post('/api/mos/publications/:id/metrics', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const p = db.publication_records.find((x) => x.id === ctx.params.id);
  if (!p) throw httpError(404, '发布记录不存在', 'PUBLICATION_NOT_FOUND');
  rbac.assertBrand(ctx.principal, p.brandCode);
  rbac.assertCan(ctx.principal, 'analytics.read', p.brandCode,
    { ip: ctx.ip, objectType: 'publication_metric', objectId: p.id });

  const metric = String(body.metric || '').trim();
  if (!metric) throw httpError(400, '请填写指标名', 'MISSING_METRIC');
  const amount = Number(body.amount);
  if (!Number.isFinite(amount)) throw httpError(400, '指标数值非法', 'BAD_AMOUNT');
  const sourceKind = String(body.sourceKind || 'MANUAL').toUpperCase();
  if (!dictValid('metricSourceKinds', sourceKind)) {
    throw httpError(400, '指标来源非法（MANUAL / API / IMPORT）', 'BAD_SOURCE');
  }
  const asOf = String(body.asOf || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) throw httpError(400, 'asOf 需为 YYYY-MM-DD（指标必须带时间）', 'BAD_DATE');

  const m = {
    id: uid('pm'),
    publicationId: p.id,
    brandCode: p.brandCode,
    metric: metric.slice(0, 80),
    amount,
    sourceKind,
    asOf,
    proofRef: String(body.proofRef || '').slice(0, 500),
    createdBy: ctx.user.id,
    createdAt: new Date().toISOString()
  };
  db.publication_metrics.push(m);
  save();
  appendAudit({ actorId: ctx.user.id, brandCode: p.brandCode, eventType: 'publication.metric.recorded',
    objectType: 'publication_metric', objectId: m.id, ip: ctx.ip,
    metadata: { publicationId: p.id, metric: m.metric, amount, sourceKind, asOf } });
  return { ok: true, metric: m, note: '指标必须带来源与统计时点；未接入的平台指标一律显示缺失，不用占位数字填充。' };
});

module.exports = { serializeSchedule, serializePublication, readyGate, createSnapshot };
