/* All Tasks —— 共享 ContentTask 综合视图（M-03 / F-06）。
 *
 * 收敛说明：原 Planning Center 的 "Content Tasks" 页收敛为跨中心共享的 **All Tasks** 综合视图。
 * 任务对象与 API 只有一份（lib/mos/routes/tasks.js）；Campaign Deliverables、
 * Master Topic Deliverables、Workspace 与 My Work 都引用**同一个 ContentTask**。
 * 支持深链接：`#/tasks?campaignId=…` / `#/tasks?topicId=…` / `#/tasks?create=1`，
 * 从上下文进入时创建按钮会**预填品牌与关联 ID**（02 §2 / M-03）。
 */
import { api, withBrand } from '../api.js';
import {
  esc, loadingHtml, stateBlock, toast, openModal, dictOptions
} from '../ui.js';
import {
  TASK_STATUSES, fetchTasks, taskTable, bindTaskRows, openCreateTaskDialog
} from '../components/taskkit.js';

let ctxRef = null; let hostEl = null;
let f = { q: '', status: '', platform: '', mine: false, campaignId: '', topicId: '' };
let relation = { campaignTitle: '', topicTitle: '' };

function head(ctx) {
  return '<div class="page-head"><div class="crumb">Planning Center / All Tasks</div>'
    + '<div class="ph-row"><h1>All Tasks</h1>'
    + '<div class="ph-actions">'
    + '<button class="btn btn-sm" id="newAdhoc">新建临时任务（AD_HOC）</button>'
    + '<button class="btn btn-sm btn-primary" id="newTask">新建任务</button>'
    + '</div></div>'
    + '<div class="ph-desc">共享 ContentTask 综合视图：Campaign Deliverables、Master Topic Deliverables、'
    + 'Workspace 与本页使用**同一对象与同一 API**。任务可关联 0/1 Campaign 与 0/1 Topic；状态迁移由服务端强制。'
    + '品牌上下文：' + esc(ctx.brand) + '。内容编辑器与版本冻结在「Creative Studio → 内容编辑器」交付。</div></div>';
}

function bodyEl() { return hostEl.querySelector('#mosBody') || hostEl; }
function setBody(html) { bodyEl().innerHTML = html; }

function relationContextHtml() {
  const chips = [];
  if (f.campaignId) chips.push('Campaign：' + esc(relation.campaignTitle || f.campaignId));
  if (f.topicId) chips.push('Topic：' + esc(relation.topicTitle || f.topicId));
  if (!chips.length) return '';
  return '<div class="callout info">已按上下文过滤：' + chips.join(' · ')
    + ' <button class="btn-link" id="clrRel">清除关联过滤</button></div>';
}

async function render() {
  const ctx = ctxRef;
  hostEl.innerHTML = head(ctx) + '<div id="mosBody">' + loadingHtml() + '</div>';
  let data;
  try { data = await fetchTasks(ctx.brand, f); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', {
      title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message,
      actions: [{ label: '重试', primary: true, onClick: render }]
    });
    setBody(s.html); s.bind(bodyEl()); return;
  }
  const d = (ctx.meta && ctx.meta.dictionaries) || {};

  let html = relationContextHtml();
  html += '<div class="filters">'
    + '<input type="search" id="fq" placeholder="编号/标题" value="' + esc(f.q) + '" aria-label="搜索任务">'
    + '<select id="fs" aria-label="状态"><option value="">全部状态</option>' + TASK_STATUSES.map((s) =>
      '<option value="' + s + '"' + (f.status === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>'
    + '<select id="fp" aria-label="平台">' + dictOptions(d.platforms, f.platform, '全部平台') + '</select>'
    + '<label class="row" style="gap:5px"><input type="checkbox" id="fm"' + (f.mine ? ' checked' : '') + '> 仅我的</label>'
    + '<button class="btn btn-sm" id="fgo">筛选</button>'
    + '<span class="pill">共 ' + data.total + '</span></div>';

  html += '<div class="card"><div class="card-head"><h2>任务列表（All Tasks）</h2>'
    + '<div class="ch-actions"><span class="small muted">同一 ContentTask 对象 · 多入口同源</span></div></div>'
    + '<div class="card-body tight">'
    + taskTable(data.items || [], { emptyTitle: '没有符合条件的任务', emptyDesc: '可在 Master Topic 中由选题生成任务，或在 Campaign Deliverables 中按 Campaign 创建。' })
    + '</div></div>';
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
  const clr = hostEl.querySelector('#clrRel');
  if (clr) clr.addEventListener('click', () => { f.campaignId = ''; f.topicId = ''; relation = {}; render(); });
  hostEl.querySelector('#newTask').addEventListener('click', () => openCreateTaskDialog({
    brand: ctx.brand, meta: ctx.meta,
    prefill: { campaignId: f.campaignId, campaignTitle: relation.campaignTitle, topicId: f.topicId, topicTitle: relation.topicTitle },
    onCreated: render
  }));
  hostEl.querySelector('#newAdhoc').addEventListener('click', newAdhocDialog);
  bindTaskRows(hostEl, render);
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

/** 解析深链接上下文（campaignId / topicId / create） */
async function applyParams(ctx) {
  const p = (ctx && ctx.params) || {};
  if (p.campaignId) f.campaignId = String(p.campaignId);
  if (p.topicId) f.topicId = String(p.topicId);
  try {
    if (f.campaignId) {
      const d = await api.get('/api/mos/campaigns/' + f.campaignId).catch(() => null);
      relation.campaignTitle = d && d.campaign ? d.campaign.title : '';
    }
    if (f.topicId) {
      const d = await api.get('/api/mos/topics/' + f.topicId).catch(() => null);
      relation.topicTitle = d && d.topic ? d.topic.title : '';
    }
  } catch (_) { /* 上下文获取失败不阻断 */ }
  if (p.create === '1') {
    await openCreateTaskDialog({
      brand: ctx.brand, meta: ctx.meta,
      prefill: { campaignId: f.campaignId, campaignTitle: relation.campaignTitle, topicId: f.topicId, topicTitle: relation.topicTitle },
      onCreated: render
    });
  }
}

export default {
  async mount(host, ctx) {
    ctxRef = ctx; hostEl = host;
    f = { q: '', status: '', platform: '', mine: false, campaignId: '', topicId: '' };
    relation = {};
    await applyParams(ctx);
    await render();
  },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
