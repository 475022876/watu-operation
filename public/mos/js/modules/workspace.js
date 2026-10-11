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

  // 我的任务
  html += '<div class="card"><div class="card-head"><h2>我的未完成任务</h2>'
    + '<div class="ch-actions"><span class="badge badge-neutral">' + tasks.length + '</span></div></div>';
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

  html += '</div>';

  // 审核队列（BUILD-03 前明确为"未接入"，不伪造待办）
  html += '<div class="card"><div class="card-head"><h2>我的审核队列</h2></div><div class="card-body">'
    + stateBlock('pending', { title: '审核待办将在 BUILD-03 接入', desc: data.emptyHints && data.emptyHints.reviews }).html
    + '</div></div>';

  hostEl.innerHTML = html;

  hostEl.querySelectorAll('[data-open-plan]').forEach((b) => b.addEventListener('click', () => ctx.navigate('planning')));
  hostEl.querySelectorAll('[data-task-act]').forEach((b) => b.addEventListener('click', () => taskAction(b.dataset.taskId, b.dataset.taskAct)));
}

function nextActionBtn(t) {
  const map = {
    IDEA: { act: 'PLANNED', label: '标记已计划' },
    PLANNED: { act: 'IN_PRODUCTION', label: '开始制作' },
    IN_PRODUCTION: { act: 'IN_REVIEW', label: '送审(冻结版本待 BUILD-02)' },
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
