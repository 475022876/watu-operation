/* W03-03 Master Topics —— Research / Narrative / Deliverables / Reuse。 */
import { api, withBrand } from '../api.js';
import { esc, toast, openDrawer, openModal, loadingHtml, stateBlock, statusBadge, gradeBadge, demoBadge, dictOptions, fmtDate } from '../ui.js';
import { taskTable, bindTaskRows, openCreateTaskDialog } from '../components/taskkit.js';

let ctxRef = null; let hostEl = null;
let filters = { q: '', pillar: '', state: '' };

function head(ctx) {
  return '<div class="page-head"><div class="crumb">计划中心 / 专题内容包</div>'
    + '<div class="ph-row"><h1>专题内容包</h1>'
    + '<div class="ph-actions"><button class="btn btn-sm btn-primary" id="newTopic">新建 Topic</button></div></div>'
    + '<div class="ph-desc">链路：Knowledge → Topic → Assets → Distribution → Reuse。证据必须可回溯到情报来源（No Evidence No Claim）。</div></div>';
}

const TOPIC_STATES = ['DRAFT', 'RESEARCHING', 'ACTIVE', 'ARCHIVED'];

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
  try { data = await api.get(withBrand('/api/mos/topics', ctx.brand, { q: filters.q, pillar: filters.pillar, state: filters.state })); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', { title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: render }] });
    setBody(s.html); s.bind(bodyEl()); return;
  }
  const d = (ctx.meta && ctx.meta.dictionaries) || {};

  let html = '<div class="filters">'
    + '<input type="search" id="tq" placeholder="搜索标题/摘要" value="' + esc(filters.q) + '">'
    + '<select id="tp">' + dictOptions(d.pillars, filters.pillar, '全部栏目') + '</select>'
    + '<select id="ts"><option value="">全部状态</option>'
    + TOPIC_STATES.map((s) => '<option value="' + s + '"' + (filters.state === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>'
    + '<button class="btn btn-sm" id="tgo">筛选</button>'
    + '<span class="pill">共 ' + data.total + '</span>'
    + '</div>';

  html += '<div class="card"><div class="card-head"><h2>Topic 列表</h2></div>';
  if (!data.items.length) {
    html += '<div class="card-body">' + stateBlock('empty', { title: '没有符合条件的 Topic', desc: '可以从「Intelligence」由情报直接建题，或点击右上角新建。' }).html + '</div>';
  } else {
    html += '<div class="table-wrap"><table class="tbl"><thead><tr>'
      + '<th>标题</th><th>栏目</th><th>叙事</th><th>风险</th><th>证据</th><th>状态</th><th>任务</th><th>负责人</th><th></th></tr></thead><tbody>';
    for (const t of data.items) {
      html += '<tr><td>' + esc(t.title) + ' ' + demoBadge(t.demo) + '</td>'
        + '<td class="mono">' + esc(t.pillarCode) + '</td>'
        + '<td class="mono">' + esc(t.narrativeCode) + '</td>'
        + '<td>' + gradeBadge(t.riskGrade) + '</td>'
        + '<td>' + statusBadge(t.evidenceStatus) + '</td>'
        + '<td>' + statusBadge(t.state) + '</td>'
        + '<td>' + t.taskCount + '</td>'
        + '<td class="small">' + esc(t.ownerName) + '</td>'
        + '<td class="actions"><button class="btn btn-sm" data-open="' + esc(t.id) + '">打开</button></td></tr>';
    }
    html += '</tbody></table></div>';
  }
  html += '</div>';
  setBody(html);

  const go = () => { filters.q = hostEl.querySelector('#tq').value.trim(); filters.pillar = hostEl.querySelector('#tp').value; filters.state = hostEl.querySelector('#ts').value; render(); };
  hostEl.querySelector('#tgo').addEventListener('click', go);
  hostEl.querySelector('#tq').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  hostEl.querySelector('#newTopic').addEventListener('click', newTopicDialog);
  hostEl.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openTopic(b.dataset.open)));
}

function newTopicDialog() {
  const d = (ctxRef.meta && ctxRef.meta.dictionaries) || {};
  openModal({
    title: '新建 Master Topic',
    okText: '创建',
    body: '<label class="field"><span>标题</span><input id="ntT" type="text"></label>'
      + '<label class="field"><span>栏目（C01–C06）</span><select id="ntP">' + dictOptions(d.pillars, 'C01', null) + '</select></label>'
      + '<label class="field"><span>叙事（N01–N05）</span><select id="ntN">' + dictOptions(d.narratives, 'N01', null) + '</select></label>'
      + '<label class="field"><span>风险等级</span><select id="ntG">' + dictOptions(d.riskGrades, 'G1', null) + '</select></label>'
      + '<label class="field"><span>摘要</span><textarea id="ntS"></textarea></label>'
      + '<div class="hint">字典标签若显示「待核验」，表示 SPECIAL-01 未提供、标签待业务确认；编码校验本身已生效。</div>',
    onOk: async (b) => {
      try {
        await api.post(withBrand('/api/mos/topics', ctxRef.brand), {
          title: b.querySelector('#ntT').value,
          pillarCode: b.querySelector('#ntP').value,
          narrativeCode: b.querySelector('#ntN').value,
          riskGrade: b.querySelector('#ntG').value,
          summary: b.querySelector('#ntS').value
        });
        toast('Topic 已创建', 'ok'); render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

async function openTopic(id) {
  let data;
  try { data = await api.get('/api/mos/topics/' + id); }
  catch (err) { toast(err.message, 'err'); return; }
  const dr = openDrawer({ title: 'Master Topic' });
  const draw = async () => {
    const d = await api.get('/api/mos/topics/' + id);
    renderTopic(dr, d);
  };
  dr.reload = draw;
  renderTopic(dr, data);
}

function renderTopic(dr, data) {
  const t = data.topic;
  const canManage = t.can.manage;
  let html = '';

  html += '<div class="row between"><strong>' + esc(t.title) + '</strong> ' + demoBadge(t.demo) + '<div>' + statusBadge(t.state) + '</div></div>';
  html += '<div class="small muted mono" style="margin-top:4px">' + esc(t.brandCode) + ' · ' + esc(t.pillarCode) + ' / ' + esc(t.narrativeCode) + ' · 风险 ' + esc(t.riskGrade) + ' · 负责人 ' + esc(t.ownerName) + '</div>';
  html += '<div class="divider"></div>';
  html += '<dl class="kv"><dt>证据状态</dt><dd>' + statusBadge(t.evidenceStatus) + '</dd>'
    + '<dt>摘要</dt><dd>' + esc(t.summary || '—') + '</dd>'
    + '<dt>更新时间</dt><dd>' + esc(fmtDate(t.updatedAt)) + '</dd></dl>';

  html += '<div class="divider"></div>';
  html += '<div class="row between"><h3>Research / 证据（' + (t.evidence || []).length + '）</h3>'
    + (canManage ? '<button class="btn btn-sm" id="addEv">引用情报</button>' : '') + '</div>';
  if (!t.evidence || !t.evidence.length) {
    html += '<div class="callout warn">尚无证据引用。金融事实类内容在无来源时**不得**生成正式报道（04 §4）。</div>';
  } else {
    for (const e of t.evidence) {
      html += '<div class="src-item" style="margin-bottom:8px">'
        + '<div class="src-h"><span class="src-t">' + esc(e.title) + '</span>' + statusBadge(e.verificationState) + demoBadge(e.demo) + '</div>'
        + '<div class="small muted">' + esc(e.sourceName || '') + ' · ' + esc(e.tier || '') + ' · 许可 ' + esc(e.licenseState || '') + '</div>'
        + '<div class="small"><a href="' + esc(e.canonicalUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(String(e.canonicalUrl).slice(0, 90)) + '</a></div>'
        + '<div class="small muted">采集 ' + esc(fmtDate(e.fetchedAt)) + ' · 发布 ' + esc(fmtDate(e.publishedAt)) + (e.claimLocator ? ' · ' + esc(e.claimLocator) : '') + '</div>'
        + (canManage ? '<div style="margin-top:4px"><button class="btn-link" data-del-ev="' + esc(e.id) + '">移除</button></div>' : '')
        + '</div>';
    }
  }

  html += '<div class="divider"></div>';
  html += '<div class="row between"><h3>Narrative / 叙事框架</h3></div>';
  html += '<dl class="kv"><dt>栏目</dt><dd class="mono">' + esc(t.pillarCode) + '</dd>'
    + '<dt>叙事</dt><dd class="mono">' + esc(t.narrativeCode) + '</dd>'
    + '<dt>风险等级</dt><dd>' + gradeBadge(t.riskGrade) + '</dd></dl>'
    + '<div class="hint">N/V/M 标签若显示「待核验」，表示 SPECIAL-01 未提供、待业务核验（不臆造官方名）。</div>';

  html += '<div class="divider"></div>';
  html += '<div class="row between"><h3>Deliverables / 内容任务（' + data.tasks.length + '）</h3>'
    + (canManage ? '<button class="btn btn-sm btn-primary" id="mkTask">生成内容任务</button>' : '') + '</div>';
  html += '<div class="hint">与「All Tasks」「Campaign Deliverables」为**同一 ContentTask 对象**（M-03）。'
    + (canManage ? '' : '') + '</div>';
  html += '<div style="margin-top:6px">' + taskTable(data.tasks || [], {
    emptyTitle: '还没有内容任务', emptyDesc: '可由本 Topic 直接生成，或在 All Tasks 中新建。'
  }) + '</div>';

  html += '<div class="divider"></div>';
  html += '<div class="row between"><h3>Reuse</h3><button class="btn btn-sm" id="reuseBtn">查看可复用历史</button></div>';
  html += '<div id="reuseBox"></div>';

  dr.body.innerHTML = html;

  if (canManage) {
    dr.body.querySelector('#addEv').addEventListener('click', () => addEvidenceDialog(t, dr));
    dr.body.querySelector('#mkTask').addEventListener('click', () => openCreateTaskDialog({
      brand: t.brandCode, meta: ctxRef.meta,
      prefill: { topicId: t.id, topicTitle: t.title, title: t.title + ' · 内容任务', pillarCode: t.pillarCode, narrativeCode: t.narrativeCode, riskGrade: t.riskGrade },
      onCreated: async () => { await dr.reload(); render(); }
    }));
    dr.body.querySelectorAll('[data-del-ev]').forEach((b) => b.addEventListener('click', async () => {
      try { await api.del('/api/mos/topics/' + t.id + '/evidence/' + b.dataset.delEv); toast('已移除证据', 'ok'); await dr.reload(); render(); }
      catch (err) { toast(err.message, 'err'); }
    }));
  }
  bindTaskRows(dr.body, async () => { await dr.reload(); render(); });
  dr.body.querySelector('#reuseBtn').addEventListener('click', async () => {
    const box = dr.body.querySelector('#reuseBox');
    box.innerHTML = loadingHtml();
    try {
      const r = await api.get('/api/mos/topics/' + t.id + '/reuse');
      const c = r.counts || {};
      let h = '<div class="callout mock">' + esc(r.note) + '</div>';

      h += '<div class="row" style="gap:8px;flex-wrap:wrap;margin:8px 0">'
        + '<span class="pill">内容任务 ' + (c.tasks || 0) + '</span>'
        + '<span class="pill">内容版本 ' + (c.contentVersions || 0) + '</span>'
        + '<span class="pill">已发布 ' + (c.publications || 0) + '</span>'
        + '<span class="badge badge-mock">已授权资产 ' + (r.libraryIntegrationMode || 'mock') + '</span></div>';

      h += '<h3 style="margin:8px 0 4px">历史内容版本</h3>';
      h += r.contentVersions.length
        ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>版本</th><th>标题</th><th>状态</th><th>风险</th></tr></thead><tbody>'
          + r.contentVersions.map((v) => '<tr><td class="mono small">' + esc(v.code) + '</td>'
            + '<td class="small">' + esc(v.title) + (v.supersededById ? ' <span class="muted">（已被取代）</span>' : '') + '</td>'
            + '<td class="small">' + esc(v.state) + '</td><td class="small">' + esc(v.riskGrade) + '</td></tr>').join('')
          + '</tbody></table></div>'
        : stateBlock('empty', { title: '该 Topic 暂无内容版本', desc: '本 Topic 尚未产生 ContentVersion；建立内容任务并创建版本后即在此出现。' }).html;

      h += '<h3 style="margin:12px 0 4px">已登记发布</h3>';
      h += r.publications.length
        ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>发布记录</th><th>状态</th><th>发布时间</th><th>URL</th></tr></thead><tbody>'
          + r.publications.map((p) => '<tr><td class="mono small">' + esc(p.id) + '</td>'
            + '<td class="small">' + esc(p.status) + '</td><td class="small mono">' + esc(p.actualAt) + '</td>'
            + '<td class="small">' + (p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">链接</a>' : '—') + '</td></tr>').join('')
          + '</tbody></table></div>'
        : stateBlock('empty', { title: '该 Topic 暂无发布记录', desc: '发布为人工登记（系统不自动发布）；登记后在此可见。' }).html;

      h += '<h3 style="margin:12px 0 4px">已授权资料库资产</h3>'
        + stateBlock('pending', { title: '资料库未接通', desc: r.libraryNote }).html;

      box.innerHTML = h;
    } catch (err) { box.innerHTML = '<div class="callout danger">' + esc(err.message) + '</div>'; }
  });
}

async function addEvidenceDialog(t, dr) {
  let items;
  try { items = await api.get(withBrand('/api/mos/source-items', ctxRef.brand, { pageSize: 100 })); }
  catch (err) { toast(err.message, 'err'); return; }
  const opts = (items.items || []).map((i) => '<option value="' + esc(i.id) + '">' + esc(i.title.slice(0, 70)) + ' · ' + esc(i.sourceName) + '</option>').join('');
  openModal({
    title: '引用情报作为证据',
    okText: '建立引用',
    body: (items.items && items.items.length
      ? '<label class="field"><span>来源条目</span><select id="evS">' + opts + '</select></label>'
      : '<div class="callout warn">当前没有可引用的情报条目。请先在 Intelligence 中登记来源并采集。</div>')
      + '<label class="field"><span>论断定位（claim locator）</span><input id="evL" type="text" placeholder="例如：第 3 段「储备披露频率」"></label>',
    onOk: async (b) => {
      const sel = b.querySelector('#evS');
      if (!sel) return false;
      try {
        await api.post('/api/mos/topics/' + t.id + '/evidence', { sourceItemId: sel.value, claimLocator: b.querySelector('#evL').value });
        toast('证据已引用', 'ok'); await dr.reload(); render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
