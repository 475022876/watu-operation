'use strict';
const { get, post } = require('../router');
const { getDb, atomicMutation } = require('../store');
const rbac = require('../rbac');
const { httpError } = require('../../util');
const { appendAudit } = require('../audit');
const helpers = require('./helpers');
function taskFor(ctx) {
  const db = getDb(), task = db.content_tasks.find(t => t.id === ctx.params.id);
  if (!task) throw httpError(404, '任务不存在', 'TASK_NOT_FOUND');
  rbac.assertBrand(ctx.principal, task.brandCode);
  return { db, task };
}
function canRemind(ctx, task) {
  return (ctx.principal.roles || []).some(r => ['MOS_ADMIN', 'P1', 'P3'].includes(r.roleCode) && (r.brandScope.includes('*') || r.brandScope.includes(task.brandCode)));
}
get('/api/mos/task-workspace/people', async ctx => {
  const db = getDb(), brand = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'content.edit', brand);
  return { ok: true, items: db.users.filter(u => u.status === 'active' && rbac.can(rbac.principalOf(db, u), 'content.edit', brand)).map(u => ({ id: u.id, displayName: u.displayName })) };
});
get('/api/mos/tasks/:id/workspace', async ctx => {
  const { db, task } = taskFor(ctx);
  const versions = db.content_versions.filter(v => v.contentTaskId === task.id);
  const cases = db.review_cases.filter(c => c.brandCode === task.brandCode && versions.some(v => v.id === c.subjectId));
  const caseIds = new Set(cases.map(c => c.id));
  return { ok: true, requirements: task.requirements || '', canRemind: canRemind(ctx, task),
    versions: versions.map(v => ({ id: v.id, code: v.code, title: v.title, state: v.state })),
    files: db.working_assets.filter(a => a.brandCode === task.brandCode && (a.taskId === task.id || versions.some(v => (v.refAssetIds || []).includes(a.id)))).map(a => ({ id: a.id, fileName: a.fileName, contentUrl: '/api/mos/assets/' + a.id + '/content' })),
    reviews: cases.map(c => ({ id: c.id, type: c.type, state: c.state })),
    feedback: db.review_decisions.filter(d => caseIds.has(d.caseId)).map(d => ({ action: d.action, actorName: d.actorName, comment: d.remarks || d.comments || d.comment || d.reason || '', createdAt: d.createdAt })),
    reminders: db.audit_events.filter(a => a.brandCode === task.brandCode && a.objectId === task.id && a.eventType === 'task.reminded').slice(-20).map(a => ({ id: a.id, createdAt: a.createdAt, actorName: (db.users.find(u => u.id === a.actorId) || {}).displayName || '' }))
  };
});
post('/api/mos/tasks/:id/remind', async ctx => {
  const { task } = taskFor(ctx);
  if (!canRemind(ctx, task)) throw httpError(403, '仅品牌管理员或负责人角色可催办', 'FORBIDDEN');
  if (['COMPLETED', 'CANCELLED'].includes(task.status)) throw httpError(409, '已结束任务不能催办', 'TASK_CLOSED');
  return atomicMutation(() => {
    appendAudit({ actorId: ctx.user.id, brandCode: task.brandCode, objectType: 'content_task', objectId: task.id, eventType: 'task.reminded', ip: ctx.ip, metadata: { recipientId: task.ownerId } });
    return { ok: true, note: '已记录站内催办，可在任务详情查看；不会发送邮件或外部消息。' };
  });
});
