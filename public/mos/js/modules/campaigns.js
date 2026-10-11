/* W03-02 / W06-01 / W06-02 Campaigns —— 项目 Brief、Plan/Topic/Task 关联与进度。 */
import { api, withBrand } from '../api.js';
import { esc, toast, openDrawer, openModal, loadingHtml, stateBlock, statusBadge, demoBadge, fmtDate } from '../ui.js';

let ctxRef = null; let hostEl = null;
let stateFilter = '';

const STATES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'];

function head(ctx) {
  return '<div class="page-head"><div class="crumb">Marketing Center / Campaigns</div>'
    + '<div class="ph-row"><h1>Campaigns</h1>'
    + '<div class="ph-actions"><button class="btn btn-sm btn-primary" id="newCamp">新建 Campaign</button></div></div>'
    + '<div class="ph-desc">品牌空间隔离：' + esc(ctx.brand) + ' 的 Campaign 不与其他品牌混用。'
    + 'Campaign 可与多个月度计划、多个 Master Topic 多对多关联，且**禁止跨品牌**关联。</div></div>';
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
  try { data = await api.get(withBrand('/api/mos/campaigns', ctx.brand, { state: stateFilter })); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', { title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: render }] });
    setBody(s.html); s.bind(bodyEl()); return;
  }

  let html = '<div class="filters">'
    + '<select id="cs"><option value="">全部状态</option>' + STATES.map((s) => '<option value="' + s + '"' + (stateFilter === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>'
    + '<button class="btn btn-sm" id="cgo">筛选</button>'
    + '<span class="pill">共 ' + data.total + '</span></div>';

  html += '<div class="card"><div class="card-head"><h2>Campaign 列表</h2></div>';
  if (!data.items.length) {
    html += '<div class="card-body">' + stateBlock('empty', { title: '该品牌尚无 Campaign', desc: '创建 Campaign 后可关联 Master Topic 与月度计划。' }).html + '</div>';
  } else {
    html += '<div class="table-wrap"><table class="tbl"><thead><tr>'
      + '<th>编号</th><th>标题</th><th>状态</th><th>窗口</th><th>计划</th><th>Topic</th><th>任务</th><th>负责人</th><th></th></tr></thead><tbody>';
    for (const c of data.items) {
      html += '<tr><td class="mono">' + esc(c.code) + '</td>'
        + '<td>' + esc(c.title) + ' ' + demoBadge(c.demo) + '</td>'
        + '<td>' + statusBadge(c.state) + '</td>'
        + '<td class="small muted">' + esc(fmtDate(c.startAt)) + ' ~ ' + esc(fmtDate(c.endAt)) + '</td>'
        + '<td>' + c.plans.length + '</td>'
        + '<td>' + c.topics.length + '</td>'
        + '<td>' + c.taskCount + '</td>'
        + '<td class="small">' + esc(c.ownerName) + '</td>'
        + '<td class="actions"><button class="btn btn-sm" data-open="' + esc(c.id) + '">打开</button></td></tr>';
    }
    html += '</tbody></table></div>';
  }
  html += '</div>';
  setBody(html);

  hostEl.querySelector('#cgo').addEventListener('click', () => { stateFilter = hostEl.querySelector('#cs').value; render(); });
  hostEl.querySelector('#newCamp').addEventListener('click', newCampDialog);
  hostEl.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openCamp(b.dataset.open)));
}

function newCampDialog() {
  openModal({
    title: '新建 Campaign',
    okText: '创建（DRAFT）',
    body: '<label class="field"><span>标题</span><input id="ncT" type="text"></label>'
      + '<label class="field"><span>开始时间</span><input id="ncS" type="date"></label>'
      + '<label class="field"><span>结束时间</span><input id="ncE" type="date"></label>'
      + '<label class="field"><span>项目 Brief</span><textarea id="ncB" placeholder="目标、受众、约束、禁用宣称等"></textarea></label>'
      + '<div class="hint">不得在其中承诺未经核准的费用、可用国家、发卡能力或收益（10 §2 S04 边界）。</div>',
    onOk: async (b) => {
      try {
        await api.post(withBrand('/api/mos/campaigns', ctxRef.brand), {
          title: b.querySelector('#ncT').value,
          startAt: b.querySelector('#ncS').value || null,
          endAt: b.querySelector('#ncE').value || null,
          brief: b.querySelector('#ncB').value
        });
        toast('Campaign 已创建', 'ok'); render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

async function openCamp(id) {
  const dr = openDrawer({ title: 'Campaign' });
  const draw = async () => {
    const d = await api.get('/api/mos/campaigns/' + id);
    renderCamp(dr, d.campaign);
  };
  dr.reload = draw;
  try { await draw(); } catch (err) { dr.body.innerHTML = '<div class="callout danger">' + esc(err.message) + '</div>'; }
}

function renderCamp(dr, c) {
  let html = '';
  html += '<div class="row between"><strong>' + esc(c.title) + '</strong> ' + demoBadge(c.demo) + '<div>' + statusBadge(c.state) + '</div></div>';
  html += '<div class="small muted mono" style="margin-top:4px">' + esc(c.code) + ' · ' + esc(c.brandCode) + ' · 负责人 ' + esc(c.ownerName) + '</div>';
  html += '<div class="divider"></div>';

  html += '<h3>项目 Brief</h3>';
  html += '<div class="callout info" style="white-space:pre-wrap">' + esc(c.brief || '（未填写）') + '</div>';

  html += '<div class="row" style="gap:6px;flex-wrap:wrap">';
  for (const s of STATES) {
    if (s === c.state) continue;
    html += '<button class="btn btn-sm" data-cstate="' + s + '">置为 ' + esc(s) + '</button>';
  }
  html += '</div>';

  html += '<div class="divider"></div>';
  html += '<div class="row between"><h3>关联月度计划（' + c.plans.length + '）</h3>'
    + (c.can.manage ? '<button class="btn btn-sm" id="lnkPlan">关联计划</button>' : '') + '</div>';
  html += c.plans.length
    ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>计划号</th><th>标题</th><th>状态</th></tr></thead><tbody>'
      + c.plans.map((p) => '<tr><td class="mono">' + esc(p.code) + '</td><td>' + esc(p.title) + '</td><td>' + statusBadge(p.status) + '</td></tr>').join('')
      + '</tbody></table></div>'
    : '<div class="hint">未关联月度计划（跨月 Campaign 可用多个计划链接，不重复创建 Campaign）。</div>';

  html += '<div class="divider"></div>';
  html += '<div class="row between"><h3>关联 Master Topic（' + c.topics.length + '）</h3>'
    + (c.can.manage ? '<button class="btn btn-sm" id="lnkTopic">关联 Topic</button>' : '') + '</div>';
  html += c.topics.length
    ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>标题</th><th>栏目</th><th>状态</th><th></th></tr></thead><tbody>'
      + c.topics.map((t) => '<tr><td>' + esc(t.title) + '</td><td class="mono">' + esc(t.pillarCode) + '</td><td>' + statusBadge(t.state) + '</td>'
        + '<td class="actions">' + (c.can.manage ? '<button class="btn-link" data-unlink="' + esc(t.id) + '">解除</button>' : '') + '</td></tr>').join('')
      + '</tbody></table></div>'
    : '<div class="hint">未关联 Topic。</div>';

  html += '<div class="divider"></div>';
  html += '<div class="row between"><h3>交付清单</h3><span class="pill">内容任务 ' + c.taskCount + '</span></div>';
  html += '<div class="hint">任务级交付清单与发布登记在 BUILD-02 交付。</div>';

  dr.body.innerHTML = html;

  dr.body.querySelectorAll('[data-cstate]').forEach((b) => b.addEventListener('click', async () => {
    try { await api.put('/api/mos/campaigns/' + c.id, { state: b.dataset.cstate }); toast('Campaign 状态已更新', 'ok'); await dr.reload(); render(); }
    catch (err) { toast(err.message, 'err'); }
  }));

  const lp = dr.body.querySelector('#lnkPlan');
  if (lp) lp.addEventListener('click', async () => {
    let plans;
    try { plans = await api.get(withBrand('/api/mos/plans', ctxRef.brand, { pageSize: 200 })); } catch (_) { plans = { items: [] }; }
    if (!plans.items.length) { toast('当前品牌没有可关联的计划', 'err'); return; }
    openModal({
      title: '关联月度计划', okText: '关联',
      body: '<label class="field"><span>计划</span><select id="lpS">'
        + plans.items.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.code) + ' · ' + esc(p.title) + '</option>').join('')
        + '</select></label><div class="hint">仅可选择同一品牌（' + esc(c.brandCode) + '）的计划。</div>',
      onOk: async (b) => {
        try { await api.post('/api/mos/campaigns/' + c.id + '/link-plan', { planId: b.querySelector('#lpS').value }); toast('已关联计划', 'ok'); await dr.reload(); render(); }
        catch (err) { toast(err.message, 'err'); return false; }
      }
    });
  });

  const lt = dr.body.querySelector('#lnkTopic');
  if (lt) lt.addEventListener('click', async () => {
    let topics;
    try { topics = await api.get(withBrand('/api/mos/topics', ctxRef.brand, { pageSize: 200 })); } catch (_) { topics = { items: [] }; }
    if (!topics.items.length) { toast('当前品牌没有可关联的 Topic', 'err'); return; }
    openModal({
      title: '关联 Master Topic', okText: '关联',
      body: '<label class="field"><span>Topic</span><select id="ltS">'
        + topics.items.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>').join('')
        + '</select></label><div class="hint">跨品牌关联会被服务端拒绝（BRAND_MISMATCH）。</div>',
      onOk: async (b) => {
        try { await api.post('/api/mos/campaigns/' + c.id + '/link-topic', { topicId: b.querySelector('#ltS').value }); toast('已关联 Topic', 'ok'); await dr.reload(); render(); }
        catch (err) { toast(err.message, 'err'); return false; }
      }
    });
  });

  dr.body.querySelectorAll('[data-unlink]').forEach((b) => b.addEventListener('click', async () => {
    try { await api.del('/api/mos/campaigns/' + c.id + '/link-topic/' + b.dataset.unlink); toast('已解除关联', 'ok'); await dr.reload(); render(); }
    catch (err) { toast(err.message, 'err'); }
  }));
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
