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
let f = { page:1,q: '', status: '', platform: '', mine: false, campaignId: '', topicId: '' };
let relation = { campaignTitle: '', topicTitle: '' };

function head(ctx) {
  return '<div class="page-head"><div class="crumb">工作台 / 全部任务</div>'
    + '<div class="ph-row"><h1>全部任务</h1>'
    + '<div class="ph-actions">'
    + '<button class="btn btn-sm" id="newAdhoc">临时任务</button>'
    + '<button class="btn btn-sm btn-primary" id="newTask">新建任务</button>'
    + '</div></div>'
    + '<div class="ph-desc">找到要处理的工作，查看要求、制作作品并跟进审核。品牌：' + esc(ctx.brand) + '</div></div>';
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
  try { data = await fetchTasks(ctx.brand, {...f,pageSize:30}); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', {
      title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message,
      actions: [{ label: '重试', primary: true, onClick: render }]
    });
    setBody(s.html); s.bind(bodyEl()); return;
  }
  const d = (ctx.meta && ctx.meta.dictionaries) || {};

  let html = relationContextHtml();
  html += '<div class="filters"><select id="fperiod" aria-label="工作时间">' + [['','全部时间'],['today','今日'],['week','本周'],['month','本月'],['future','未来'],['overdue','逾期'],['urgent','紧急'],['reminders','提醒']].map(([v,l]) => '<option value="'+v+'"'+(f.period===v?' selected':'')+'>'+l+'</option>').join('')+'</select></div>';
  html += '<div class="filters">'
    + '<input type="search" id="fq" placeholder="编号/标题" value="' + esc(f.q) + '" aria-label="搜索任务">'
    + '<select id="fs" aria-label="状态"><option value="">全部状态</option>' + [...TASK_STATUSES,'REVISION_REQUIRED','APPROVED'].map((s) =>
      '<option value="' + s + '"' + ((f.status === s || f.workState === s) ? ' selected' : '') + '>' + esc(({REVISION_REQUIRED:'待修改',APPROVED:'已批准',IDEA:'待开始',PLANNED:'已安排',IN_PRODUCTION:'制作中',IN_REVIEW:'审核中',READY:'待发布',COMPLETED:'已完成',ON_HOLD:'暂缓',CANCELLED:'已取消'})[s] || s) + '</option>').join('') + '</select>'
    + '<select id="fp" aria-label="平台">' + dictOptions(d.platforms, f.platform, '全部平台') + '</select>'
    + '<label class="row" style="gap:5px"><input type="checkbox" id="fm"' + (f.mine ? ' checked' : '') + '> 仅我的</label>'
    + '<button class="btn btn-sm" id="fgo">筛选</button>'
    + '<span class="pill">共 ' + data.total + '</span></div>';

  html += '<div class="card"><div class="card-head"><h2>待处理的工作</h2>'
    + '<div class="ch-actions"><span class="small muted">点击“继续处理”即可开始</span></div></div>'
    + '<div class="card-body tight">'
    + taskTable(data.items || [], { compact:true, emptyTitle: '没有符合条件的任务', emptyDesc: '可以调整筛选条件，或新建任务安排工作。' })
    + '</div></div>';
  html += '<div class="row" style="gap:12px;margin-top:16px"><button class="btn" id="taskPrev"'+((f.page||1)===1?' disabled':'')+'>上一页</button><span>'+ (f.page||1) +' / '+Math.max(1,Math.ceil(data.total/30))+'</span><button class="btn" id="taskNext"'+((f.page||1)*30>=data.total?' disabled':'')+'>下一页</button></div>';
  setBody(html);
  hostEl.querySelector('#taskPrev').onclick=()=>{f.page--;render();};
  hostEl.querySelector('#taskNext').onclick=()=>{f.page++;render();};

  const go = () => {
    f.page = 1;
    f.period = hostEl.querySelector('#fperiod').value;
    f.q = hostEl.querySelector('#fq').value.trim();
    const state=hostEl.querySelector('#fs').value;
    f.workState=['REVISION_REQUIRED','APPROVED'].includes(state)?state:'';
    f.status=f.workState?'':state;
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
    onCreated: task => ctx.navigate('task-detail',{task:task.id})
  }));
  hostEl.querySelector('#newAdhoc').addEventListener('click', newAdhocDialog);
  bindTaskRows(hostEl, render, ctx.navigate);
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
    f.period = ctx.params.period || '';
    f.mine = ctx.params.mine === '1';
    await render();
  },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
