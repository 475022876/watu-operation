/* Publishing Center —— 发布中心（05 §1–§7）。
 *
 * 四个视图共用一个数据源：Calendar / Queue / Channels / Archive。
 *   Calendar 与 Queue 只是**同一份排期的不同视图**（05 §1），不存在第二套数据。
 *
 * 真实操作与持久化：
 *   - 排期创建/改期/状态推进全部落库；改期只动 plannedAt，绝不触碰 actualAt（05 §7）。
 *   - **无任何定时器**：到期不会自动发布。PUBLISHED 只能通过人工登记真实 URL/证据产生。
 *   - 发布时服务端把正文与清单**物理快照**到 data/uploads/published/<id>/，归档不可编辑；
 *     更正/下架是 append-only 事件，原档保留。
 */
import { api, withBrand } from '../api.js';
import {
  esc, toast, openModal, confirmDialog, loadingHtml, stateBlock, statusBadge, gradeBadge,
  platformLabel, demoBadge, fmtDateTime, fmtDate, relTime
} from '../ui.js';

let ctxRef = null; let hostEl = null;
let tab = 'calendar';
let schedules = []; let queue = {}; let channels = []; let pubs = [];
let versions = []; let calDays = []; let planItems = [];
let calMonth = new Date(); calMonth.setDate(1);
let loading = false;

function bodyEl() { return hostEl.querySelector('#mosBody') || hostEl; }
function setBody(html) { bodyEl().innerHTML = html; }

function renderError(err, retry) {
  const kind = err.status === 403 || err.status === 404 ? 'denied' : 'error';
  const s = stateBlock(kind, { title: err.status === 403 ? '权限不足' : '加载失败', desc: err.message,
    actions: retry ? [{ label: '重试', primary: true, onClick: retry }] : [] });
  setBody(s.html); s.bind(bodyEl());
}

function head() {
  return '<div class="page-head"><div class="crumb">发布中心 / 发布管理</div>'
    + '<div class="ph-row"><h1>发布中心</h1>'
    + '<div class="ph-actions"><button class="btn btn-sm" id="pbRefresh">刷新</button></div></div>'
    + '<div class="ph-desc"><b>系统不会自动发布。</b>到期只会提示，'
    + '只有在人工登记真实 URL 或证据引用后才产生 Published Archive 记录（05 §3）。'
    + '拖动日历只改变计划时间，不会修改实际发布时间。</div></div>';
}

async function render() {
  if (loading) return;
  loading = true;
  hostEl.innerHTML = head() + '<div id="mosBody">' + loadingHtml() + '</div>';
  try {
    const [sch, ch, pb, cv] = await Promise.all([
      api.get(withBrand('/api/mos/publishing/schedules', ctxRef.brand, { pageSize: 200 })),
      api.get(withBrand('/api/mos/channels', ctxRef.brand, {})),
      api.get(withBrand('/api/mos/publications', ctxRef.brand, { pageSize: 200 })),
      api.get(withBrand('/api/mos/content-versions', ctxRef.brand, { state: 'APPROVED', pageSize: 200 }))
    ]);
    schedules = sch.items || []; queue = sch.queue || {};
    channels = ch.items || [];
    pubs = pb.items || [];
    versions = cv.items || [];
    if (tab === 'calendar') await loadCalendar();
  } catch (err) { loading = false; renderError(err, render); return; }
  loading = false;
  paint();
  const r = hostEl.querySelector('#pbRefresh');
  if (r) r.addEventListener('click', render);
}

function monthRange(d) {
  const y = d.getFullYear(), m = d.getMonth();
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const p = (n) => String(n).padStart(2, '0');
  return { from: y + '-' + p(m + 1) + '-01', to: y + '-' + p(m + 1) + '-' + p(last.getDate()), first, last };
}

async function loadCalendar() {
  const r = monthRange(calMonth);
  const res = await api.get(withBrand('/api/mos/publishing/calendar', ctxRef.brand, { from: r.from, to: r.to }));
  calDays = res.days || []; planItems = res.planItems || [];
}

function paint() {
  let h = '<div class="tabs">'
    + [['calendar', '日历'], ['queue', '发布队列'], ['channels', '渠道登记'], ['archive', 'Published Archive']]
      .map(([k, l]) => '<button data-tab="' + k + '" class="' + (tab === k ? 'on' : '') + '">' + esc(l) + '</button>').join('')
    + '</div>';
  h += '<div class="filters">'
    + '<span class="pill">排期 ' + schedules.length + '</span>'
    + '<span class="badge badge-ok">READY ' + (queue.ready || 0) + '</span>'
    + '<span class="badge badge-info">SCHEDULED ' + (queue.scheduled || 0) + '</span>'
    + '<span class="badge badge-warn">BLOCKED ' + (queue.blocked || 0) + '</span>'
    + '<span class="badge badge-neutral">DRAFT ' + (queue.draft || 0) + '</span>'
    + '<span class="pill">已发布 ' + pubs.length + '</span></div>';
  h += '<div id="pbView">' + loadingHtml() + '</div>';
  setBody(h);

  hostEl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
    tab = b.dataset.tab;
    if (tab === 'calendar') { try { await loadCalendar(); } catch (_) { /* ignore */ } }
    paint();
  }));

  const v = hostEl.querySelector('#pbView');
  if (tab === 'calendar') v.innerHTML = viewCalendar();
  else if (tab === 'queue') v.innerHTML = viewQueue();
  else if (tab === 'channels') v.innerHTML = viewChannels();
  else v.innerHTML = viewArchive();
  bindView();
}

/* ---------- 日历视图 ---------- */

function viewCalendar() {
  const r = monthRange(calMonth);
  const entries = {};
  for (const d of calDays) entries[d.date] = d.items;
  const planByDate = {};
  for (const p of planItems) { if (!planByDate[p.workDate]) planByDate[p.workDate] = []; planByDate[p.workDate].push(p); }

  let h = '<div class="card"><div class="card-head">'
    + '<button class="btn btn-sm" id="calPrev">← 上月</button>'
    + '<h2 style="margin:0">' + calMonth.getFullYear() + ' 年 ' + (calMonth.getMonth() + 1) + ' 月</h2>'
    + '<button class="btn btn-sm" id="calNext">下月 →</button></div><div class="card-body">';
  h += '<div class="cal-grid cal-week-head">' + ['一', '二', '三', '四', '五', '六', '日'].map((d) => '<div>' + d + '</div>').join('') + '</div>';
  h += '<div class="cal-grid">';
  const firstDow = (r.first.getDay() + 6) % 7;  // 周一为第一列
  for (let i = 0; i < firstDow; i++) h += '<div class="cal-cell empty"></div>';
  const today = new Date().toISOString().slice(0, 10);
  for (let day = 1; day <= r.last.getDate(); day++) {
    const p = (n) => String(n).padStart(2, '0');
    const date = r.first.getFullYear() + '-' + p(r.first.getMonth() + 1) + '-' + p(day);
    const items = entries[date] || [];
    const plans = planByDate[date] || [];
    h += '<div class="cal-cell' + (date === today ? ' today' : '') + '"><div class="cal-date">' + day + '</div>';
    for (const s of items) {
      h += '<div class="cal-entry k-task" data-sch="' + esc(s.id) + '" title="' + esc(s.versionCode + ' · ' + s.channelLabel) + '">'
        + '<b>' + esc(platformLabel(s.platform)) + '</b> ' + esc(statusLabelShort(s.state))
        + '<br><span class="mono" style="font-size:10.5px">' + esc(s.versionCode) + '</span></div>';
    }
    for (const pl of plans) {
      h += '<div class="cal-entry k-plan ce-plan">' + esc(pl.title) + (pl.adHoc ? ' · AD_HOC' : '') + '</div>';
    }
    h += '</div>';
  }
  h += '</div></div>';
  h += '<div class="card-body tight"><div class="small muted">排期状态色仅作辅助，文字状态同时显示（07 §6）。'
    + '灰色条目为月度计划（PlanItem），与排期共享同一日历。</div></div></div>';
  return h;
}

function statusLabelShort(s) {
  return { DRAFT: '草稿', BLOCKED: '受阻', READY: '待发布', SCHEDULED: '已排期', CANCELLED: '已取消', PUBLISHED: '已发布' }[s] || s;
}

/* ---------- 队列视图 ---------- */

function versionOptions(selected) {
  return '<option value="">选择已批准版本…</option>' + versions.map((v) =>
    '<option value="' + esc(v.id) + '"' + (selected === v.id ? ' selected' : '') + '>'
    + esc(v.code + ' · ' + (v.title || '（无标题）')) + '</option>').join('');
}
function channelOptions(selected) {
  return channels.filter((c) => c.state === 'ENABLED').map((c) =>
    '<option value="' + esc(c.id) + '"' + (selected === c.id ? ' selected' : '') + '>'
    + esc(platformLabel(c.platform) + ' · ' + c.handle) + '</option>').join('');
}

function viewQueue() {
  let h = '<div class="card"><div class="card-head"><h2>发布队列</h2>'
    + '<button class="btn btn-sm btn-primary" id="schNew">新建排期</button></div>';
  if (!schedules.length) {
    h += '<div class="card-body">' + stateBlock('empty', {
      title: '还没有排期', desc: '排期只能引用**已批准**的内容版本，且渠道必须为启用状态（SEC-04）。'
    }).html + '</div></div>';
    return h;
  }
  h += '<div class="card-body tight" style="padding:0">';
  h += '<div class="queue-row head"><div>计划时间</div><div>内容版本 / 任务</div><div>渠道</div><div>状态</div><div></div></div>';
  h += schedules.map((s) => '<div class="queue-row">'
    + '<div class="mono small">' + esc(fmtDateTime(s.plannedAt)) + '<br><span class="muted">' + esc(s.timezone) + '</span></div>'
    + '<div>' + esc(s.versionCode) + ' <span class="muted small">' + esc(s.versionTitle || '') + '</span>'
    + (s.blockedReason ? '<div class="diff-warn small">' + esc(s.blockedReason) + '</div>' : '') + '</div>'
    + '<div class="small">' + esc(platformLabel(s.platform)) + '<br><span class="muted">' + esc(s.channelLabel) + '</span></div>'
    + '<div>' + statusBadge(s.state)
    + (s.publicationId ? '<div class="small"><span class="badge badge-ok">已登记发布</span></div>' : '') + '</div>'
    + '<div class="actions">'
    + ((s.allowedTransitions || []).includes('READY') ? '<button class="btn btn-sm" data-act="READY" data-id="' + esc(s.id) + '">标记 Ready</button> ' : '')
    + ((s.allowedTransitions || []).includes('SCHEDULED') ? '<button class="btn btn-sm" data-act="SCHEDULED" data-id="' + esc(s.id) + '">进入排期</button> ' : '')
    + (s.state === 'SCHEDULED' && !s.publicationId ? '<button class="btn btn-sm btn-primary" data-pub="' + esc(s.id) + '">登记实际发布</button> ' : '')
    + '<button class="btn btn-sm" data-edit="' + esc(s.id) + '">改期</button>'
    + '</div></div>').join('');
  h += '</div></div>';
  return h;
}

/* ---------- 渠道视图 ---------- */

function viewChannels() {
  let h = '<div class="card"><div class="card-head"><h2>渠道登记</h2>'
    + '<button class="btn btn-sm btn-primary" id="chNew">登记渠道</button></div>';
  if (!channels.length) {
    h += '<div class="card-body">' + stateBlock('empty', { title: '还没有渠道登记', desc: '只登记官方账号标识与公开 URL。' }).html + '</div></div>';
    return h;
  }
  h += '<div class="card-body" style="padding:0"><div class="table-wrap"><table class="tbl"><thead><tr>'
    + '<th>平台</th><th>账号</th><th>用途</th><th>状态</th><th>发布方式</th><th>最近核验</th><th></th></tr></thead><tbody>';
  for (const c of channels) {
    h += '<tr><td>' + esc(platformLabel(c.platform)) + '</td>'
      + '<td class="mono small">' + esc(c.handle) + '</td>'
      + '<td>' + esc(c.label || '—') + ' ' + demoBadge(c.demo) + '<br>'
      + '<a class="small" href="' + esc(c.url) + '" target="_blank" rel="noopener">' + esc(String(c.url).slice(0, 46)) + '</a></td>'
      + '<td>' + statusBadge(c.state) + '</td>'
      + '<td><span class="badge badge-neutral">' + esc(c.publishMode) + '</span></td>'
      + '<td class="small mono">' + esc(fmtDateTime(c.lastVerifiedAt)) + '</td>'
      + '<td class="actions"><button class="btn btn-sm" data-ch="' + esc(c.id) + '">编辑</button></td></tr>';
  }
  h += '</tbody></table></div></div></div>';
  h += '<div class="hint" style="margin-top:10px">渠道只保存官方标识与公开 URL；密码 / 令牌 / OAuth 凭据一律被服务端拒绝（SECRET_NOT_ALLOWED）。'
    + 'V0.1 发布方式固定为 MANUAL —— 系统不代持任何平台凭据，也不会自动发帖。</div>';
  return h;
}

/* ---------- 归档视图 ---------- */

function viewArchive() {
  let h = '<div class="card"><div class="card-head"><h2>发布归档（Published Archive）</h2><span class="pill">' + pubs.length + '</span></div>';
  if (!pubs.length) {
    h += '<div class="card-body">' + stateBlock('empty', {
      title: '还没有发布记录', desc: '发布记录只能由人工登记产生：需要真实 URL 或证据引用。'
    }).html + '</div></div>';
    return h;
  }
  h += '<div class="card-body" style="padding:0"><div class="table-wrap"><table class="tbl"><thead><tr>'
    + '<th>实际发布</th><th>内容版本</th><th>渠道</th><th>链接</th><th>状态</th><th></th></tr></thead><tbody>';
  for (const p of pubs) {
    h += '<tr><td class="mono small">' + esc(fmtDateTime(p.actualAt)) + '</td>'
      + '<td>' + esc(p.versionCode) + '<br><span class="muted small">' + esc(p.versionTitle || '') + '</span></td>'
      + '<td class="small">' + esc(platformLabel(p.platform)) + '<br><span class="muted">' + esc(p.channelLabel) + '</span></td>'
      + '<td><a class="small" href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(String(p.url).slice(0, 40)) + '</a></td>'
      + '<td>' + statusBadge(p.status) + (p.corrections && p.corrections.length ? '<div class="small"><span class="badge badge-warn">更正 ' + p.corrections.length + '</span></div>' : '') + '</td>'
      + '<td class="actions"><button class="btn btn-sm" data-open-pub="' + esc(p.id) + '">档案详情</button></td></tr>';
  }
  h += '</tbody></table></div></div></div>';
  h += '<div class="hint" style="margin-top:10px">Published Archive 是 Marketing OS 内的独立权威归档；已发布内容<b>不会</b>自动进入企业资料库（00 §1）。</div>';
  return h;
}

/* ---------- 事件绑定 ---------- */

function bindView() {
  const prev = hostEl.querySelector('#calPrev'); if (prev) prev.addEventListener('click', async () => { calMonth.setMonth(calMonth.getMonth() - 1); await loadCalendar(); paint(); });
  const next = hostEl.querySelector('#calNext'); if (next) next.addEventListener('click', async () => { calMonth.setMonth(calMonth.getMonth() + 1); await loadCalendar(); paint(); });
  hostEl.querySelectorAll('[data-sch]').forEach((e) => e.addEventListener('click', () => openScheduleCard(e.dataset.sch)));

  const sn = hostEl.querySelector('#schNew'); if (sn) sn.addEventListener('click', newScheduleDialog);
  hostEl.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => setScheduleState(b.dataset.id, b.dataset.act)));
  hostEl.querySelectorAll('[data-pub]').forEach((b) => b.addEventListener('click', () => registerPublication(b.dataset.pub)));
  hostEl.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => editSchedule(b.dataset.edit)));
  hostEl.querySelectorAll('[data-ch]').forEach((b) => b.addEventListener('click', () => editChannel(b.dataset.ch)));
  hostEl.querySelectorAll('[data-open-pub]').forEach((b) => b.addEventListener('click', () => openPublication(b.dataset.openPub)));
  const cn = hostEl.querySelector('#chNew'); if (cn) cn.addEventListener('click', newChannelDialog);
}

/* ---------- 操作 ---------- */

function newScheduleDialog() {
  if (!versions.length) { toast('当前品牌没有已批准的内容版本，不能排期（SEC-04）', 'err'); return; }
  if (!channels.filter((c) => c.state === 'ENABLED').length) { toast('没有启用中的渠道，请先登记渠道', 'err'); return; }
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  openModal({
    title: '新建排期', okText: '创建（DRAFT）',
    body: '<div class="hint">排期只能引用已批准版本与启用渠道；创建后处于 DRAFT，需显式标记 Ready 才能进入排期。</div>'
      + '<label class="field"><span>内容版本（仅已批准）</span><select id="nsV">' + versionOptions('') + '</select></label>'
      + '<label class="field"><span>渠道（仅启用中）</span><select id="nsC">' + channelOptions('') + '</select></label>'
      + '<label class="field"><span>计划时间</span><input id="nsT" type="datetime-local" value="' + now.toISOString().slice(0, 16) + '"></label>',
    onOk: async (b) => {
      const vid = b.querySelector('#nsV').value, cid = b.querySelector('#nsC').value;
      if (!vid || !cid) { toast('请选择版本与渠道', 'err'); return false; }
      try {
        await api.post(withBrand('/api/mos/publishing/schedules', ctxRef.brand), {
          contentVersionId: vid, channelId: cid, plannedAt: b.querySelector('#nsT').value
        });
        toast('排期已创建', 'ok');
        await render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

async function setScheduleState(id, state) {
  const s = schedules.find((x) => x.id === id);
  if (state === 'READY') {
    const ok = await confirmDialog('标记为 Ready？', 'Ready 表示内容与渠道都已就绪，可以进入排期。若版本未批准或渠道停用，服务端会拒绝（SEC-04）。', '标记 Ready');
    if (!ok) return;
  }
  try {
    await api.put(withBrand('/api/mos/publishing/schedules/' + id, ctxRef.brand), { state, rowVersion: s ? s.rowVersion : undefined });
    toast('状态已更新为 ' + state, 'ok');
    await render();
  } catch (err) { toast(err.message, 'err'); }
}

async function editSchedule(id) {
  const s = schedules.find((x) => x.id === id);
  if (!s) return;
  const local = String(s.plannedAt).slice(0, 16);
  openModal({
    title: '改期', okText: '保存计划时间',
    body: '<div class="hint">改期只修改<b>计划时间</b>，不会影响任何实际发布时间（05 §7）。</div>'
      + '<label class="field"><span>计划时间</span><input id="esT" type="datetime-local" value="' + esc(local) + '"></label>',
    onOk: async (b) => {
      try {
        await api.put(withBrand('/api/mos/publishing/schedules/' + id, ctxRef.brand), {
          plannedAt: b.querySelector('#esT').value, rowVersion: s.rowVersion
        });
        toast('已改期', 'ok');
        await render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

function openScheduleCard(id) {
  const s = schedules.find((x) => x.id === id);
  if (!s) return;
  openModal({
    title: '排期 ' + s.versionCode, okText: '关闭',
    body: '<dl class="kv">'
      + '<dt>内容版本</dt><dd>' + esc(s.versionCode) + ' ' + statusBadge(s.versionState) + '</dd>'
      + '<dt>标题</dt><dd>' + esc(s.versionTitle || '—') + '</dd>'
      + '<dt>渠道</dt><dd>' + esc(s.channelLabel) + ' ' + statusBadge(s.channelState) + '</dd>'
      + '<dt>计划时间</dt><dd class="mono">' + esc(fmtDateTime(s.plannedAt)) + ' <span class="muted small">' + esc(s.timezone) + '</span></dd>'
      + '<dt>状态</dt><dd>' + statusBadge(s.state) + '</dd>'
      + '<dt>修订号</dt><dd class="mono">' + s.revision + '</dd>'
      + (s.blockedReason ? '<dt>受阻原因</dt><dd class="diff-warn">' + esc(s.blockedReason) + '</dd>' : '')
      + (s.publicationId ? '<dt>发布记录</dt><dd class="mono small">' + esc(s.publicationId) + '</dd>' : '')
      + '</dl>'
  });
}

function registerPublication(scheduleId) {
  const s = schedules.find((x) => x.id === scheduleId);
  const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  openModal({
    title: '登记实际发布', okText: '登记并归档',
    body: '<div class="hint">必须提供真实 URL 或证据引用。登记瞬间，服务端会把正文、清单与引用资产'
      + '<b>物理快照</b>到归档目录，此后不可编辑。</div>'
      + '<label class="field"><span>发布 URL</span><input id="rpU" type="url" placeholder="https://…"></label>'
      + '<label class="field"><span>证据引用（可选，替代 URL）</span><input id="rpE" type="text" placeholder="截图编号 / 归档编号"></label>'
      + '<label class="field"><span>实际发布时间</span><input id="rpT" type="datetime-local" value="' + now.toISOString().slice(0, 16) + '"></label>'
      + '<label class="field"><span>备注</span><input id="rpN" type="text" placeholder="操作说明（可选）"></label>',
    onOk: async (b) => {
      const url = b.querySelector('#rpU').value.trim();
      const ev = b.querySelector('#rpE').value.trim();
      if (!url && !ev) { toast('必须提供真实 URL 或证据引用', 'err'); return false; }
      try {
        await api.post(withBrand('/api/mos/publications', ctxRef.brand), {
          scheduleId, url, evidenceRef: ev,
          actualAt: b.querySelector('#rpT').value,
          notes: b.querySelector('#rpN').value, rowVersion: s ? s.rowVersion : undefined
        });
        toast('已登记发布并生成归档快照', 'ok');
        await render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

async function openPublication(id) {
  let d;
  try { d = await api.get(withBrand('/api/mos/publications/' + id, ctxRef.brand)); }
  catch (err) { toast(err.message, 'err'); return; }
  const p = d.publication;
  const m = openModal({
    title: '发布档案 ' + p.versionCode, okText: '关闭',
    body: '<div class="small muted">归档快照不可编辑；如需更正请追加事件（原档保留）。</div>'
      + '<dl class="kv">'
      + '<dt>实际发布</dt><dd class="mono">' + esc(fmtDateTime(p.actualAt)) + '</dd>'
      + '<dt>渠道</dt><dd>' + esc(p.channelLabel) + '</dd>'
      + '<dt>URL</dt><dd><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(p.url) + '</a></dd>'
      + '<dt>操作人</dt><dd>' + esc(p.operatorName || p.operatorId) + '</dd>'
      + '<dt>状态</dt><dd>' + statusBadge(p.status) + '</dd>'
      + '<dt>正文哈希</dt><dd class="mono small">' + esc(String(p.textHash || '').slice(0, 20)) + '</dd>'
      + '<dt>清单哈希</dt><dd class="mono small">' + esc(String(p.manifestHash || '').slice(0, 20)) + '</dd>'
      + '<dt>归档文件</dt><dd class="small" data-notranslate>' + esc((p.artifacts || []).map((a) => a.kind + ':' + a.fileName).join(', ') || '—') + '</dd>'
      + '</dl>'
      + (p.archivedBodyAvailable === false ? '<div class="block-note">归档正文文件不可读（可能已被外部清理）。</div>' : '')
      + (d.archivedBody ? '<div class="divider"></div><div class="small muted">归档正文（只读快照）</div>'
        + '<pre class="mono small" style="white-space:pre-wrap;background:var(--muted);padding:9px;border-radius:7px;max-height:220px;overflow:auto">' + esc(d.archivedBody) + '</pre>' : '')
      + '<div class="divider"></div><div class="row" style="gap:6px;flex-wrap:wrap">'
      + '<button class="btn btn-sm" id="pubCorr">追加更正</button>'
      + '<button class="btn btn-sm" id="pubMetric">登记指标</button></div>'
      + '<div class="hint">' + esc(p.reuseNote || '') + '</div>'
  });
  m.body.querySelector('#pubCorr').addEventListener('click', () => { m.close(); correctionDialog(id); });
  m.body.querySelector('#pubMetric').addEventListener('click', () => { m.close(); metricDialog(id); });
}

function correctionDialog(id) {
  openModal({
    title: '追加更正事件', okText: '提交',
    body: '<div class="hint">更正 / 替换 / 下架均为 append-only 事件，原归档快照保留。</div>'
      + '<label class="field"><span>类型</span><select id="coK">'
      + '<option value="CORRECTION">CORRECTION 更正说明</option>'
      + '<option value="REPLACEMENT">REPLACEMENT 替换为新的发布记录</option>'
      + '<option value="REMOVAL">REMOVAL 下架</option></select></label>'
      + '<label class="field"><span>原因（必填）</span><textarea id="coR" class="ed-body" style="min-height:90px"></textarea></label>',
    onOk: async (b) => {
      const reason = b.querySelector('#coR').value.trim();
      if (!reason) { toast('必须填写原因', 'err'); return false; }
      try {
        await api.post(withBrand('/api/mos/publications/' + id + '/corrections', ctxRef.brand), {
          kind: b.querySelector('#coK').value, reason
        });
        toast('已追加更正事件', 'ok');
        await render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

function metricDialog(id) {
  const today = new Date().toISOString().slice(0, 10);
  const d = (ctxRef.meta && ctxRef.meta.dictionaries) || {};
  openModal({
    title: '登记发布指标', okText: '提交',
    body: '<div class="hint">V0.1 不做平台 API 拉取，指标一律为人工登记并标注来源与截止时间。</div>'
      + '<label class="field"><span>指标名</span><input id="meM" type="text" placeholder="impressions / likes / clicks"></label>'
      + '<label class="field"><span>数值</span><input id="meA" type="number" step="1"></label>'
      + '<label class="field"><span>来源</span><select id="meS">' + dictOptions(d.metricSourceKinds, 'MANUAL', null) + '</select></label>'
      + '<label class="field"><span>截止日期</span><input id="meD" type="date" value="' + today + '"></label>',
    onOk: async (b) => {
      try {
        await api.post(withBrand('/api/mos/publications/' + id + '/metrics', ctxRef.brand), {
          metric: b.querySelector('#meM').value.trim(),
          amount: Number(b.querySelector('#meA').value),
          sourceKind: b.querySelector('#meS').value,
          asOf: b.querySelector('#meD').value
        });
        toast('指标已登记', 'ok');
        await render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

function newChannelDialog() {
  openModal({
    title: '登记渠道', okText: '登记',
    body: '<div class="hint">只登记官方账号标识与公开 URL。<b>不要</b>在此填写任何密码或令牌 —— 服务端会直接拒绝。</div>'
      + '<label class="field"><span>平台</span><select id="ncP">'
      + '<option value="LINKEDIN">LinkedIn</option><option value="X">X</option>'
      + '<option value="YOUTUBE">YouTube</option><option value="FACEBOOK">Facebook</option></select></label>'
      + '<label class="field"><span>账号标识</span><input id="ncH" type="text" placeholder="@account"></label>'
      + '<label class="field"><span>公开 URL（必须 https）</span><input id="ncU" type="url" placeholder="https://…"></label>'
      + '<label class="field"><span>用途说明</span><input id="ncL" type="text"></label>',
    onOk: async (b) => {
      try {
        await api.post(withBrand('/api/mos/channels', ctxRef.brand), {
          platform: b.querySelector('#ncP').value,
          handle: b.querySelector('#ncH').value.trim(),
          url: b.querySelector('#ncU').value.trim(),
          label: b.querySelector('#ncL').value.trim()
        });
        toast('渠道已登记', 'ok');
        await render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

function editChannel(id) {
  const c = channels.find((x) => x.id === id);
  if (!c) return;
  openModal({
    title: '编辑渠道', okText: '保存',
    body: '<dl class="kv"><dt>平台</dt><dd>' + esc(platformLabel(c.platform)) + '</dd></dl>'
      + '<label class="field"><span>账号标识</span><input id="ecH" type="text" value="' + esc(c.handle) + '"></label>'
      + '<label class="field"><span>公开 URL</span><input id="ecU" type="url" value="' + esc(c.url) + '"></label>'
      + '<label class="field"><span>用途说明</span><input id="ecL" type="text" value="' + esc(c.label || '') + '"></label>'
      + '<label class="field"><span>状态</span><select id="ecS">'
      + '<option value="ENABLED"' + (c.state === 'ENABLED' ? ' selected' : '') + '>ENABLED 启用</option>'
      + '<option value="DISABLED"' + (c.state === 'DISABLED' ? ' selected' : '') + '>DISABLED 停用</option></select></label>',
    onOk: async (b) => {
      try {
        await api.put(withBrand('/api/mos/channels/' + id, ctxRef.brand), {
          handle: b.querySelector('#ecH').value.trim(),
          url: b.querySelector('#ecU').value.trim(),
          label: b.querySelector('#ecL').value.trim(),
          state: b.querySelector('#ecS').value,
          rowVersion: c.rowVersion
        });
        toast('渠道已保存', 'ok');
        await render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
