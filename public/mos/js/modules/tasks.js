/* Content Tasks —— 内容任务列表、状态机流转、独立临时任务（AD_HOC）。 */
import { api, withBrand } from '../api.js';
import { esc, toast, openModal, loadingHtml, stateBlock, statusBadge, gradeBadge, platformLabel, demoBadge, dictOptions, fmtDate, fmtDateTime } from '../ui.js';

let ctxRef = null; let hostEl = null;
let f = { q: '', status: '', platform: '', mine: false };

const STATUSES = ['IDEA', 'PLANNED', 'IN_PRODUCTION', 'IN_REVIEW', 'READY', 'COMPLETED', 'ON_HOLD', 'CANCELLED'];

function head(ctx) {
  return '<div class="page-head"><div class="crumb">Planning Center / Content Tasks</div>'
    + '<div class="ph-row"><h1>Content Tasks</h1>'
    + '<div class="ph-actions">'
    + '<button class="btn btn-sm" id="newAdhoc">新建临时任务（AD_HOC）</button>'
    + '<button class="btn btn-sm btn-primary" id="newTask">新建任务</button>'
    + '</div></div>'
    + '<div class="ph-desc">任务可关联 0/1 个 Campaign 与 0/1 个 Topic；状态迁移由服务端强制。内容编辑器与版本冻结在 BUILD-02 交付。</div></div>';
}

/** 数据区容器：加载骨架只出现一次，数据到达后整体替换（避免骨架残留） */
function bodyEl() {
  return hostEl.querySelector('#mosBody') || hostEl;
}
function setBody(html) {
  const el = bodyEl();
  el.innerHTML = html;
}

async function render() {
  const ctx = ctxRef;
  hostEl.innerHTML = head(ctx) + '<div id="mosBody">' + loadingHtml() + '</div>';
  let data;
  try { data = await api.get(withBrand('/api/mos/tasks', ctx.brand, { q: f.q, status: f.status, platform: f.platform, mine: f.mine ? 1 : '' })); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', { title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: render }] });
    setBody(s.html); s.bind(bodyEl()); return;
  }
  const d = (ctx.meta && ctx.meta.dictionaries) || {};

  let html = '<div class="filters">'
    + '<input type="search" id="fq" placeholder="编号/标题" value="' + esc(f.q) + '">'
    + '<select id="fs"><option value="">全部状态</option>' + STATUSES.map((s) => '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>'
    + '<select id="fp">' + dictOptions(d.platforms, f.platform, '全部平台') + '</select>'
    + '<label class="row" style="gap:5px"><input type="checkbox" id="fm"' + (f.mine ? ' checked' : '') + '> 仅我的</label>'
    + '<button class="btn btn-sm" id="fgo">筛选</button>'
    + '<span class="pill">共 ' + data.total + '</span></div>';

  html += '<div class="card"><div class="card-head"><h2>任务列表</h2></div>';
  if (!data.items.length) {
    html += '<div class="card-body">' + stateBlock('empty', { title: '没有符合条件的任务', desc: '可在 Master Topic 中由选题生成任务，或点击右上角新建。' }).html + '</div>';
  } else {
    html += '<div class="table-wrap"><table class="tbl"><thead><tr>'
      + '<th>编号</th><th>标题</th><th>平台</th><th>风险</th><th>状态</th><th>制作截止</th><th>计划发布</th><th>负责人</th><th></th></tr></thead><tbody>';
    for (const t of data.items) {
      html += '<tr><td class="mono">' + esc(t.code) + '</td>'
        + '<td>' + esc(t.title) + ' ' + demoBadge(t.demo) + '</td>'
        + '<td>' + esc(platformLabel(t.platform)) + '</td>'
        + '<td>' + gradeBadge(t.riskGrade) + '</td>'
        + '<td>' + statusBadge(t.status) + '</td>'
        + '<td class="mono small">' + esc(fmtDate(t.productionDue)) + '</td>'
        + '<td class="mono small">' + esc(fmtDate(t.plannedPublishAt)) + '</td>'
        + '<td class="small">' + esc(t.ownerName) + '</td>'
        + '<td class="actions"><button class="btn btn-sm" data-open="' + esc(t.id) + '">详情</button></td></tr>';
    }
    html += '</tbody></table></div>';
  }
  html += '</div>';
  setBody(html);

  const go = () => {
    f.q = hostEl.querySelector('#fq').value.trim();
    f.status = hostEl.querySelector('#fs').value;
    f.platform = hostEl.querySelector('#fp').value;
    f.mine = hostEl.querySelector('#fm').checked;
    render();
  };
  hostEl.querySelector('#fgo').addEventListener('click', go);
  hostEl.querySelector('#fq').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  hostEl.querySelector('#newTask').addEventListener('click', newTaskDialog);
  hostEl.querySelector('#newAdhoc').addEventListener('click', newAdhocDialog);
  hostEl.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openTask(b.dataset.open)));
}

function newTaskDialog() {
  const d = (ctxRef.meta && ctxRef.meta.dictionaries) || {};
  openModal({
    title: '新建内容任务',
    okText: '创建（IDEA）',
    body: '<label class="field"><span>标题</span><input id="ktT" type="text"></label>'
      + '<label class="field"><span>平台</span><select id="ktP">' + dictOptions(d.platforms, 'LINKEDIN', null) + '</select></label>'
      + '<label class="field"><span>栏目</span><select id="ktC">' + dictOptions(d.pillars, 'C01', null) + '</select></label>'
      + '<label class="field"><span>叙事</span><select id="ktN">' + dictOptions(d.narratives, 'N01', null) + '</select></label>'
      + '<label class="field"><span>风险等级</span><select id="ktG">' + dictOptions(d.riskGrades, 'G1', null) + '</select></label>'
      + '<label class="field"><span>制作截止</span><input id="ktD" type="date"></label>'
      + '<label class="field"><span>计划发布</span><input id="ktPub" type="date"></label>',
    onOk: async (b) => {
      try {
        await api.post(withBrand('/api/mos/tasks', ctxRef.brand), {
          title: b.querySelector('#ktT').value,
          platform: b.querySelector('#ktP').value,
          pillarCode: b.querySelector('#ktC').value,
          narrativeCode: b.querySelector('#ktN').value,
          riskGrade: b.querySelector('#ktG').value,
          productionDue: b.querySelector('#ktD').value || null,
          plannedPublishAt: b.querySelector('#ktPub').value || null
        });
        toast('任务已创建', 'ok'); render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

function newAdhocDialog() {
  openModal({
    title: '新建临时任务（AD_HOC）',
    okText: '创建',
    body: '<div class="hint">临时内容不依赖月度计划，仍进入同一套任务与日历（05 §1）。</div>'
      + '<label class="field"><span>标题</span><input id="ahT" type="text"></label>'
      + '<label class="field"><span>工作日期</span><input id="ahD" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></label>',
    onOk: async (b) => {
      try {
        await api.post(withBrand('/api/mos/tasks/ad-hoc', ctxRef.brand), {
          title: b.querySelector('#ahT').value, workDate: b.querySelector('#ahD').value
        });
        toast('临时任务已创建', 'ok'); render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

async function openTask(id) {
  let data;
  try { data = await api.get('/api/mos/tasks/' + id); }
  catch (err) { toast(err.message, 'err'); return; }
  const t = data.task;

  const m = { title: '任务 ' + t.code, okText: '关闭' };
  const mo = openModal({
    title: m.title,
    okText: m.okText,
    body: '<dl class="kv"><dt>标题</dt><dd>' + esc(t.title) + ' ' + demoBadge(t.demo) + '</dd>'
      + '<dt>平台</dt><dd>' + esc(platformLabel(t.platform)) + '</dd>'
      + '<dt>状态</dt><dd>' + statusBadge(t.status) + '</dd>'
      + '<dt>风险等级</dt><dd>' + gradeBadge(t.riskGrade) + '</dd>'
      + '<dt>Topic</dt><dd>' + esc(t.topicTitle || '—') + '</dd>'
      + '<dt>Campaign</dt><dd>' + esc(t.campaignTitle || '—') + '</dd>'
      + '<dt>制作截止</dt><dd class="mono">' + esc(fmtDate(t.productionDue)) + '</dd>'
      + '<dt>审核截止</dt><dd class="mono">' + esc(fmtDate(t.reviewDue)) + '</dd>'
      + '<dt>计划发布</dt><dd class="mono">' + esc(fmtDate(t.plannedPublishAt)) + '</dd>'
      + '<dt>创建</dt><dd class="small muted">' + esc(fmtDateTime(t.createdAt)) + '</dd>'
      + '</dl>'
      + '<div class="divider"></div>'
      + '<div class="row" style="flex-wrap:wrap">' + (t.allowedTransitions || []).map((s) =>
        '<button class="btn btn-sm" data-tt="' + esc(s) + '">迁移到 ' + esc(s) + '</button>').join('') + '</div>'
      + '<div class="hint">进入 IN_REVIEW / READY 需要 content.submit 权限；BUILD-02 会在此挂载版本冻结与专业/发布审核。</div>'
  });

  mo.body.querySelectorAll('[data-tt]').forEach((b) => b.addEventListener('click', async () => {
    try { await api.post('/api/mos/tasks/' + id + '/transition', { status: b.dataset.tt }); toast('状态已更新为 ' + b.dataset.tt, 'ok'); mo.close(); render(); }
    catch (err) { toast(err.message, 'err'); }
  }));
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
