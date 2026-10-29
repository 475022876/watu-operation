'use strict';
const { httpError } = require('../util');
const rbac = require('./rbac');
const TERMINAL = ['COMPLETED', 'CANCELLED'];
function fields(db, body, brand) {
  const patch = {};
  if (body.requirements !== undefined) {
    if (typeof body.requirements !== 'string' || body.requirements.length > 12000) throw httpError(400, '任务要求不得超过12000字符', 'BAD_REQUIREMENTS');
    patch.requirements = body.requirements.trim();
  }
  if (body.priority !== undefined) {
    if (!['NORMAL', 'URGENT'].includes(body.priority)) throw httpError(400, '优先级非法', 'BAD_PRIORITY');
    patch.priority = body.priority;
  }
  if (body.startAt !== undefined) {
    const v = body.startAt || null;
    if (v && (!/^\d{4}-\d{2}-\d{2}$/.test(v) || !Number.isFinite(new Date(v).getTime()) || new Date(v).toISOString().slice(0, 10) !== v)) throw httpError(400, '开始日期非法', 'BAD_DATE');
    patch.startAt = v;
  }
  if (body.ownerId !== undefined) {
    const owner = db.users.find(u => u.id === body.ownerId && u.status === 'active');
    if (!owner || !rbac.can(rbac.principalOf(db, owner), 'content.edit', brand)) throw httpError(403, '负责人没有该品牌内容制作权限', 'ASSIGNEE_NOT_ELIGIBLE');
    patch.ownerId = owner.id;
  }
  return patch;
}
function dateInPeriod(task, period, now = new Date()) {
  if (!period) return true;
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'urgent') return task.priority === 'URGENT' && !TERMINAL.includes(task.status);
  const raw = task.productionDue || task.startAt || task.createdAt;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw || '') ? new Date(Number(raw.slice(0,4)), Number(raw.slice(5,7))-1, Number(raw.slice(8,10))) : new Date(raw);
  if (!Number.isFinite(date.getTime())) return false;
  const next = new Date(day); next.setDate(next.getDate() + 1);
  if (period === 'today') return date >= day && date < next;
  if (period === 'week') { const start = new Date(day); start.setDate(start.getDate() - (start.getDay() + 6) % 7); const end = new Date(start); end.setDate(end.getDate() + 7); return date >= start && date < end; }
  if (period === 'month') return date.getFullYear() === day.getFullYear() && date.getMonth() === day.getMonth();
  if (period === 'overdue') return !!task.productionDue && date < day && !TERMINAL.includes(task.status);
  if (period === 'future') return !!task.startAt && new Date(task.startAt) >= next && !TERMINAL.includes(task.status);
  if (period === 'urgent') return task.priority === 'URGENT' && !TERMINAL.includes(task.status);
  throw httpError(400, '时间筛选非法', 'BAD_PERIOD');
}
function workState(db,task){
  if(['COMPLETED','CANCELLED'].includes(task.status))return task.status;
  const latest=(db.content_versions||[]).filter(v=>v.contentTaskId===task.id).reduce((a,v)=>!a||v.number>a.number?v:a,null);
  return latest?.state==='REVISION_REQUIRED'?'REVISION_REQUIRED':latest?.state==='APPROVED'?'APPROVED':task.status;
}
module.exports = { fields, dateInPeriod, workState };
