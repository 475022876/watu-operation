/* W03-01 Monthly Planning —— 月度计划 / PlanItem / 统一日历（月·周·列表同一数据源）。 */
import { api, withBrand } from '../api.js';
import { esc, toast, openDrawer, openModal, confirmDialog, loadingHtml, stateBlock, statusBadge, demoBadge, fmtDate } from '../ui.js';

let ctxRef = null; let hostEl = null;
let view = 'list';          // list | calendar
let calView = 'month';      // month | week | list
let anchor = new Date().toISOString().slice(0, 10);
let yearFilter = '';
let monthFilter = '';

function head(ctx) {
  return '<div class="page-head"><div class="crumb">Planning Center / Monthly Planning</div>'
    + '<div class="ph-row"><h1>Monthly Planning</h1>'
    + '<div class="ph-actions">'
    + '<button class="btn btn-sm' + (view === 'list' ? ' btn-primary' : '') + '" data-v="list">计划列表</button>'
    + '<button class="btn btn-sm' + (view === 'calendar' ? ' btn-primary' : '') + '" data-v="calendar">统一日历</button>'
    + '</div></div>'
    + '<div class="ph-desc">目标 / Editorial Plan / Review 三个维度集中在计划内；周视图只是 PlanItem 过滤，**不复制**月计划（01 §3）。</div></div>';
}

async function render() {
  const ctx = ctxRef;
  hostEl.innerHTML = head(ctx) + '<div id="mosPlanBody">' + loadingHtml() + '</div>';
  bindTabs();
  if (view === 'list') await renderList();
  else await renderCalendar();
}

function bindTabs() {
  hostEl.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => { view = b.dataset.v; render(); }));
}

/** 数据区容器：加载骨架只出现一次，数据到达后整体替换（避免骨架残留） */
function bodyEl() {
  return hostEl.querySelector('#mosPlanBody') || hostEl;
}
function setBody(html) {
  const el = bodyEl();
  el.innerHTML = html;
}

/* ---------------- 计划列表 ---------------- */

async function renderList() {
  const ctx = ctxRef;
  let data;
  const extra = {};
  if (yearFilter) extra.year = yearFilter;
  if (monthFilter) extra.month = monthFilter;
  try { data = await api.get(withBrand('/api/mos/plans', ctx.brand, extra)); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', { title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: renderList }] });
    setBody(s.html); s.bind(bodyEl()); return;
  }

  let html = '';
  html += '<div class="filters">'
    + '<input type="number" id="fy" placeholder="年 (2026)" value="' + esc(yearFilter) + '" style="max-width:120px">'
    + '<input type="number" id="fm" placeholder="月 (1-12)" value="' + esc(monthFilter) + '" style="max-width:110px">'
    + '<button class="btn btn-sm" id="fgo">筛选</button>'
    + '<button class="btn btn-sm" id="fclr">清除</button>'
    + '<span style="margin-left:auto"></span>'
    + '<button class="btn btn-sm btn-primary" id="newPlan">新建月度计划</button>'
    + '</div>';

  html += '<div class="card"><div class="card-head"><h2>月度计划</h2><div class="ch-actions"><span class="badge badge-neutral">' + data.total + '</span></div></div>';
  if (!data.items.length) {
    html += '<div class="card-body">' + stateBlock('empty', { title: '该品牌尚无月度计划', desc: '点击「新建月度计划」创建 DRAFT 计划，随后提交审批。' }).html + '</div>';
  } else {
    html += '<div class="table-wrap"><table class="tbl"><thead><tr>'
      + '<th>计划号</th><th>标题</th><th>状态</th><th>事项</th><th>Campaign</th><th>负责人</th><th>更新时间</th><th></th>'
      + '</tr></thead><tbody>';
    for (const p of data.items) {
      html += '<tr><td class="mono">' + esc(p.code) + '</td>'
        + '<td>' + esc(p.title) + ' ' + demoBadge(p.demo) + '</td>'
        + '<td>' + statusBadge(p.status) + '</td>'
        + '<td>' + p.itemCount + '</td>'
        + '<td>' + p.campaigns.length + '</td>'
        + '<td>' + esc(p.ownerName) + '</td>'
        + '<td class="small muted">' + esc(fmtDate(p.updatedAt)) + '</td>'
        + '<td class="actions"><button class="btn btn-sm" data-open="' + esc(p.id) + '">打开</button></td></tr>';
    }
    html += '</tbody></table></div>';
  }
  html += '</div>';

  setBody(html);

  const go = () => { yearFilter = hostEl.querySelector('#fy').value.trim(); monthFilter = hostEl.querySelector('#fm').value.trim(); render(); };
  hostEl.querySelector('#fgo').addEventListener('click', go);
  hostEl.querySelector('#fclr').addEventListener('click', () => { yearFilter = ''; monthFilter = ''; render(); });
  hostEl.querySelector('#newPlan').addEventListener('click', newPlanDialog);
  hostEl.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openPlan(b.dataset.open)));
}

function newPlanDialog() {
  const now = new Date();
  openModal({
    title: '新建月度计划',
    okText: '创建（DRAFT）',
    body: '<div class="hint">创建后状态为草稿；提交审批需要 plan.update，批准需要 plan.approve 独立权限。</div>'
      + '<label class="field"><span>年份</span><input id="npY" type="number" value="' + now.getFullYear() + '"></label>'
      + '<label class="field"><span>月份</span><input id="npM" type="number" min="1" max="12" value="' + (now.getMonth() + 1) + '"></label>'
      + '<label class="field"><span>标题</span><input id="npT" type="text" placeholder="例如：2026 年 11 月品牌传播与内容计划"></label>'
      + '<label class="field"><span>目标（每行一条）</span><textarea id="npO" placeholder="每行一个目标"></textarea></label>',
    onOk: async (b) => {
      const objectives = String(b.querySelector('#npO').value || '').split('\n').map((s) => s.trim()).filter(Boolean);
      try {
        await api.post(withBrand('/api/mos/plans', ctxRef.brand), {
          year: Number(b.querySelector('#npY').value),
          month: Number(b.querySelector('#npM').value),
          title: b.querySelector('#npT').value,
          objectives
        });
        toast('月度计划已创建', 'ok'); render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

/* ---------------- 计划详情 ---------------- */

async function openPlan(id) {
  const ctx = ctxRef;
  let data;
  try { data = await api.get('/api/mos/plans/' + id); }
  catch (err) { toast(err.message, 'err'); return; }

  const dr = openDrawer({ title: '计划 ' + (data.plan.code || '') });
  renderPlanDetail(dr, data);

  async function reload() {
    const d = await api.get('/api/mos/plans/' + id);
    renderPlanDetail(dr, d);
  }
  dr.reload = reload;
}

function renderPlanDetail(dr, data) {
  const p = data.plan;
  const allowed = data.allowedTransitions || [];
  const canUpdate = p.can.update;
  const canApprove = p.can.approve;

  const trBtn = (status, label, primary) => {
    const ok = allowed.indexOf(status) !== -1;
    const permitted = status === 'APPROVED' ? canApprove : canUpdate;
    if (!ok) return '';
    return '<button class="btn btn-sm' + (primary ? ' btn-primary' : '') + '" data-tr="' + status + '"' + (permitted ? '' : ' disabled title="缺少权限"') + '>' + esc(label) + '</button>';
  };

  let html = '';
  html += '<div class="row between"><div class="stack">'
    + '<div><strong>' + esc(p.title) + '</strong> ' + demoBadge(p.demo) + '</div>'
    + '<div class="small muted mono">' + esc(p.code) + ' · v' + p.version + ' · ' + esc(p.brandCode) + ' · 负责人 ' + esc(p.ownerName) + '</div>'
    + '</div><div>' + statusBadge(p.status) + '</div></div>';

  html += '<div class="divider"></div>';
  html += '<div class="row" style="gap:6px;flex-wrap:wrap">'
    + trBtn('SUBMITTED', '提交审批', false)
    + trBtn('APPROVED', '批准计划', true)
    + trBtn('REVISION_REQUIRED', '退回修订', false)
    + trBtn('ACTIVE', '置为生效', false)
    + trBtn('CLOSED', '关闭', false)
    + trBtn('CANCELLED', '作废', false)
    + '</div>';
  if (!allowed.length) html += '<div class="hint">当前状态无可执行的迁移。</div>';
  if (p.reviewNote) html += '<div class="callout info" style="margin-top:10px">审批意见：' + esc(p.reviewNote) + '</div>';

  html += '<div class="divider"></div>';
  html += '<h3>目标</h3>';
  html += (p.objectives && p.objectives.length)
    ? '<ul style="margin:6px 0 0 18px;font-size:13px">' + p.objectives.map((o) => '<li>' + esc(o) + '</li>').join('') + '</ul>'
    : '<div class="hint">未填写目标。</div>';

  html += '<div class="divider"></div>';
  html += '<div class="row between"><h3>PlanItem（' + data.items.length + '）</h3>'
    + (canUpdate ? '<button class="btn btn-sm" id="addItem">新增事项</button>' : '') + '</div>';
  if (!data.items.length) {
    html += '<div class="hint">该计划还没有事项。事项会与内容任务一起出现在统一日历中。</div>';
  } else {
    html += '<div class="table-wrap"><table class="tbl"><thead><tr><th>日期</th><th>事项</th><th>优先级</th><th>关联任务</th><th></th></tr></thead><tbody>';
    for (const it of data.items) {
      html += '<tr><td class="mono">' + esc(it.workDate) + '</td>'
        + '<td>' + esc(it.title) + (it.adHoc ? ' <span class="badge badge-neutral">AD_HOC</span>' : '') + '</td>'
        + '<td><span class="pill">' + esc(it.priority) + '</span></td>'
        + '<td class="small">' + esc(it.contentTaskTitle || '—') + '</td>'
        + '<td class="actions">' + (canUpdate ? '<button class="btn-link" data-ditem="' + esc(it.id) + '">删除</button>' : '') + '</td></tr>';
    }
    html += '</tbody></table></div>';
  }

  dr.body.innerHTML = html;

  dr.body.querySelectorAll('[data-tr]').forEach((b) => b.addEventListener('click', async () => {
    const status = b.dataset.tr;
    const needNote = status === 'REVISION_REQUIRED' || status === 'CANCELLED' || status === 'CLOSED';
    const actions = { SUBMITTED: 'SUBMIT', APPROVED: 'APPROVE', REVISION_REQUIRED: 'REVISION', ACTIVE: 'ACTIVATE', CLOSED: 'CLOSE', CANCELLED: 'CANCEL' };
    let note = '';
    if (needNote) note = window.prompt('请填写意见/原因（将写入审计事件）', '') || '';
    if (status === 'CANCELLED' && !(await confirmDialog('作废计划', '作废后该计划不可再修改。确定继续？', '作废'))) return;
    try {
      await api.post('/api/mos/plans/' + p.id + '/transition', { action: actions[status], note });
      toast('状态已更新为 ' + status, 'ok');
      await dr.reload();
      render();
    } catch (err) { toast(err.message, 'err'); }
  }));

  const addBtn = dr.body.querySelector('#addItem');
  if (addBtn) addBtn.addEventListener('click', () => addItemDialog(p, dr));
  dr.body.querySelectorAll('[data-ditem]').forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('删除事项', '确定删除该 PlanItem？该操作会写入审计事件。', '删除'))) return;
    try { await api.del('/api/mos/plan-items/' + b.dataset.ditem); toast('已删除', 'ok'); await dr.reload(); render(); }
    catch (err) { toast(err.message, 'err'); }
  }));
}

function addItemDialog(plan, dr) {
  openModal({
    title: '新增 PlanItem',
    okText: '添加',
    body: '<label class="field"><span>标题</span><input id="aiT" type="text"></label>'
      + '<label class="field"><span>工作日期</span><input id="aiD" type="date" value="' + esc(anchor) + '"></label>'
      + '<label class="field"><span>优先级</span><select id="aiP"><option value="P1">P1</option><option value="P0">P0</option><option value="P2">P2</option></select></label>'
      + '<label class="field"><span>标记为临时内容（AD_HOC）</span><select id="aiA"><option value="0">否</option><option value="1">是</option></select></label>',
    onOk: async (b) => {
      try {
        await api.post('/api/mos/plans/' + plan.id + '/items', {
          title: b.querySelector('#aiT').value,
          workDate: b.querySelector('#aiD').value,
          priority: b.querySelector('#aiP').value,
          adHoc: b.querySelector('#aiA').value === '1'
        });
        toast('事项已添加', 'ok');
        await dr.reload();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

/* ---------------- 统一日历 ---------------- */

async function renderCalendar() {
  const ctx = ctxRef;
  let data;
  try { data = await api.get(withBrand('/api/mos/calendar', ctx.brand, { view: calView, anchor })); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', { title: '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: renderCalendar }] });
    setBody(s.html); s.bind(bodyEl()); return;
  }

  const shift = (n) => {
    const d = new Date(anchor + 'T00:00:00');
    if (calView === 'month') d.setMonth(d.getMonth() + n);
    else if (calView === 'week') d.setDate(d.getDate() + n * 7);
    else d.setMonth(d.getMonth() + n);
    anchor = d.toISOString().slice(0, 10);
    render();
  };

  let html = '<div class="filters">'
    + '<button class="btn btn-sm" data-cv="month">月</button>'
    + '<button class="btn btn-sm" data-cv="week">周</button>'
    + '<button class="btn btn-sm" data-cv="list">列表</button>'
    + '<button class="btn btn-sm" id="prev">← 上一段</button>'
    + '<input type="date" id="anc" value="' + esc(anchor) + '" style="max-width:160px">'
    + '<button class="btn btn-sm" id="next">下一段 →</button>'
    + '<button class="btn btn-sm" id="today">今天</button>'
    + '<span class="pill">' + esc(data.from) + ' ~ ' + esc(data.to) + '</span>'
    + '<span class="pill">' + data.entries.length + ' 项</span>'
    + '</div>';

  if (calView === 'list') {
    html += '<div class="card"><div class="card-head"><h2>日历（列表）</h2></div><div class="card-body">'
      + (data.entries.length
        ? data.entries.map((e) => '<div class="cal-list-row"><span class="mono" style="width:96px">' + esc(e.date) + '</span>'
          + '<span class="badge ' + (e.kind === 'PLAN_ITEM' ? 'badge-info' : 'badge-warn') + '">' + esc(e.kind === 'PLAN_ITEM' ? '计划事项' : '任务节点') + '</span>'
          + '<span>' + esc(e.title) + '</span>'
          + '<span class="muted small" style="margin-left:auto">' + esc(e.kind === 'PLAN_ITEM' ? (e.planCode || '') : (e.fieldLabel || '')) + '</span></div>').join('')
        : stateBlock('empty', { title: '该时间段没有计划事项或任务节点' }).html)
      + '</div></div>';
  } else {
    const byDate = {};
    for (const e of data.entries) { (byDate[e.date] = byDate[e.date] || []).push(e); }
    const start = new Date(data.from + 'T00:00:00');
    const end = new Date(data.to + 'T00:00:00');
    const days = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      days.push(iso);
    }
    const today = new Date().toISOString().slice(0, 10);

    html += '<div class="card"><div class="card-head"><h2>日历（' + esc(calView === 'week' ? '周' : '月') + '）</h2>'
      + '<div class="ch-actions"><span class="small muted">点击条目查看所属计划/任务</span></div></div><div class="card-body">';
    html += '<div class="cal-week-head"><div>一</div><div>二</div><div>三</div><div>四</div><div>五</div><div>六</div><div>日</div></div>';
    html += '<div class="cal-grid">';
    for (const day of days) {
      const entries = byDate[day] || [];
      html += '<div class="cal-cell' + (day === today ? ' today' : '') + '">'
        + '<div class="cal-date"><span>' + esc(day.slice(8, 10)) + '</span><span>' + (entries.length || '') + '</span></div>'
        + entries.map((e) => '<div class="cal-entry ' + (e.kind === 'PLAN_ITEM' ? (e.adHoc ? 'k-adhoc' : 'k-plan') : 'k-task')
          + '" data-entry="' + esc(e.id) + '" title="' + esc(e.title) + '">'
          + (e.kind === 'PLAN_ITEM' ? '▦ ' : '✎ ') + esc(String(e.title).slice(0, 14)) + '</div>').join('')
        + '</div>';
    }
    html += '</div></div></div>';
  }

  html += '<div class="callout info">' + esc(data.note) + '</div>';
  setBody(html);

  hostEl.querySelectorAll('[data-cv]').forEach((b) => b.addEventListener('click', () => { calView = b.dataset.cv; render(); }));
  hostEl.querySelector('#prev').addEventListener('click', () => shift(-1));
  hostEl.querySelector('#next').addEventListener('click', () => shift(1));
  hostEl.querySelector('#today').addEventListener('click', () => { anchor = new Date().toISOString().slice(0, 10); render(); });
  hostEl.querySelector('#anc').addEventListener('change', (e) => { anchor = e.target.value; render(); });
  hostEl.querySelectorAll('[data-entry]').forEach((el) => el.addEventListener('click', () => {
    const e = data.entries.find((x) => x.id === el.dataset.entry);
    if (!e) return;
    openModal({
      title: e.kind === 'PLAN_ITEM' ? '计划事项' : '任务节点',
      hideOk: true,
      body: '<dl class="kv"><dt>标题</dt><dd>' + esc(e.title) + '</dd>'
        + '<dt>日期</dt><dd class="mono">' + esc(e.date) + '</dd>'
        + (e.kind === 'PLAN_ITEM'
          ? '<dt>所属计划</dt><dd class="mono">' + esc(e.planCode || '') + '</dd><dt>计划状态</dt><dd>' + statusBadge(e.planStatus) + '</dd>'
          : '<dt>节点</dt><dd>' + esc(e.fieldLabel || '') + '</dd><dt>任务状态</dt><dd>' + statusBadge(e.status) + '</dd>')
        + '</dl><div class="hint">日历仅反映**计划日期**；实际发布时间以发布登记为准。</div>'
    });
  }));
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
