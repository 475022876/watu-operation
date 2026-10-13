/* W01-01 My Work —— 我负责的任务、草稿计划与下一步动作。 */
import { api, withBrand } from '../api.js';
import { esc, toast, openModal, loadingHtml, stateBlock, statusBadge, gradeBadge, platformLabel, demoBadge, fmtDate } from '../ui.js';

let ctxRef = null;
let hostEl = null;

function headHtml(ctx) {
  return '<div class="page-head"><div class="crumb">Workspace / My Work</div>'
    + '<div class="ph-row"><h1>My Work</h1>'
    + '<span class="small muted">' + esc(ctx.me.displayName) + ' · 品牌 '
    + esc(ctx.brand || '—') + '</span></div>'
    + '<div class="ph-desc">按 owner 与角色授权展示：我负责的任务、我起草的计划，以及明确的下一步动作。</div></div>';
}

async function render() {
  const ctx = ctxRef;
  hostEl.innerHTML = headHtml(ctx) + loadingHtml();
  let data;
  try {
    data = await api.get(withBrand('/api/mos/my-work', ctx.brand));
  } catch (err) {
    const s = stateBlock(err.status === 403 || err.status === 404 ? 'denied' : 'error', {
      title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message,
      actions: [{ label: '重试', primary: true, onClick: render }]
    });
    hostEl.innerHTML = headHtml(ctx) + s.html; s.bind(hostEl); return;
  }

  const tasks = data.tasks || [];
  const plans = data.draftPlans || [];

  let html = headHtml(ctx);

  html += '<div class="grid grid-2">';

  // 我的任务（M-03：与 All Tasks / Campaign Deliverables 为同一 ContentTask 对象）
  html += '<div class="card"><div class="card-head"><h2>我的未完成任务</h2>'
    + '<div class="ch-actions"><span class="badge badge-neutral">' + tasks.length + '</span>'
    + '<button class="btn btn-sm" data-go-tasks="1">打开 All Tasks</button></div></div>';
  if (!tasks.length) {
    html += '<div class="card-body">' + stateBlock('empty', { title: '当前没有指派给你的未完成任务', desc: data.emptyHints && data.emptyHints.tasks }).html + '</div>';
  } else {
    html += '<div class="card-body tight">' + tasks.map((t) => ''
      + '<div class="list-item"><div class="li-main">'
      + '<div class="li-title"><span class="mono muted small">' + esc(t.code) + '</span> ' + esc(t.title) + ' ' + demoBadge(t.demo) + '</div>'
      + '<div class="li-sub">' + statusBadge(t.status) + ' ' + gradeBadge(t.riskGrade)
      + ' <span class="pill">' + esc(platformLabel(t.platform)) + '</span>'
      + (t.topicTitle ? ' <span class="muted">Topic：' + esc(t.topicTitle) + '</span>' : '')
      + '</div>'
      + '<div class="li-sub">制作截止 ' + esc(fmtDate(t.productionDue)) + ' · 计划发布 ' + esc(fmtDate(t.plannedPublishAt)) + '</div>'
      + '</div><div class="li-actions">'
      + nextActionBtn(t)
      + '</div></div>').join('') + '</div>';
  }
  html += '</div>';

  // 我的草稿计划
  html += '<div class="card"><div class="card-head"><h2>待我推进的计划</h2>'
    + '<div class="ch-actions"><span class="badge badge-neutral">' + plans.length + '</span></div></div>';
  if (!plans.length) {
    html += '<div class="card-body">' + stateBlock('empty', { title: '没有需要你推进的月度计划草稿', desc: '草稿或需修订状态的计划会出现在这里。' }).html + '</div>';
  } else {
    html += '<div class="card-body tight">' + plans.map((p) => '<div class="list-item"><div class="li-main">'
      + '<div class="li-title"><span class="mono muted small">' + esc(p.code) + '</span> ' + esc(p.title) + '</div>'
      + '<div class="li-sub">' + statusBadge(p.status) + ' · 品牌 ' + esc(p.brandCode) + '</div>'
      + '</div><div class="li-actions"><button class="btn btn-sm" data-open-plan="' + esc(p.id) + '">打开</button></div></div>').join('') + '</div>';
  }
  html += '</div>';

  // 审核队列：BUILD-03 起接入真实 ReviewCase（专业 / 发布 / 入库三条链统一入口）
  const reviews = data.pendingReviews || [];
  html += '<div class="card"><div class="card-head"><h2>我的审核队列</h2>'
    + '<div class="ch-actions"><span class="badge badge-neutral">' + reviews.length + '</span>'
    + '<button class="btn btn-sm" data-go-reviews="1">打开 My Reviews</button></div></div>';
  if (!reviews.length) {
    html += '<div class="card-body">' + stateBlock('empty', {
      title: '没有待你裁决的审核单',
      desc: (data.emptyHints && data.emptyHints.reviews) || '当前没有需要你裁决的专业 / 发布 / 入库审核单。'
    }).html + '</div>';
  } else {
    html += '<div class="card-body tight">' + reviews.slice(0, 8).map((r) => '<div class="list-item"><div class="li-main">'
      + '<div class="li-title">' + esc(r.type) + ' · ' + esc((r.subject && r.subject.title) || r.subjectId || '') + '</div>'
      + '<div class="li-sub"><span class="badge badge-info">' + esc(r.state) + '</span>'
      + ' <span class="mono small muted">' + esc(r.id) + '</span></div>'
      + '</div><div class="li-actions"><button class="btn btn-sm" data-go-reviews="1">去裁决</button></div></div>').join('')
      + '</div>';
  }
  html += '</div>';

  html += '</div>';

  hostEl.innerHTML = html;

  hostEl.querySelectorAll('[data-go-reviews]').forEach((b) => b.addEventListener('click', () => ctx.navigate('my-reviews')));
  hostEl.querySelectorAll('[data-go-tasks]').forEach((b) => b.addEventListener('click', () => ctx.navigate('tasks')));
  hostEl.querySelectorAll('[data-open-plan]').forEach((b) => b.addEventListener('click', () => ctx.navigate('planning')));
  hostEl.querySelectorAll('[data-task-act]').forEach((b) => b.addEventListener('click', () => taskAction(b.dataset.taskId, b.dataset.taskAct)));
}

function nextActionBtn(t) {
  const map = {
    IDEA: { act: 'PLANNED', label: '标记已计划' },
    PLANNED: { act: 'IN_PRODUCTION', label: '开始制作' },
    IN_PRODUCTION: { act: 'IN_REVIEW', label: '送审（到内容编辑器冻结版本）' },
    IN_REVIEW: { act: 'READY', label: '标记审核通过' }
  };
  const m = map[t.status];
  if (!m) return '';
  return '<button class="btn btn-sm btn-primary" data-task-act="' + esc(m.act) + '" data-task-id="' + esc(t.id) + '">' + esc(m.label) + '</button>';
}

async function taskAction(taskId, status) {
  try {
    await api.post('/api/mos/tasks/' + taskId + '/transition', { status });
    toast('任务状态已更新', 'ok');
    render();
  } catch (err) { toast(err.message, 'err'); }
}

export default {
  async mount(host, ctx) {
    ctxRef = ctx; hostEl = host;
    await render();
  },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
void openModal;
