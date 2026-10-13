/* W03-04 Intelligence —— Feed / Sources / Create Topic。
 * 关键诚实性：采集失败、被 SSRF 阻断、来源未核验时必须显示明确状态，绝不伪造"采集成功"。 */
import { api, withBrand } from '../api.js';
import { esc, toast, openDrawer, openModal, loadingHtml, stateBlock, statusBadge, demoBadge, dictOptions, fmtDateTime, fmtDate } from '../ui.js';

let ctxRef = null; let hostEl = null;
let tab = 'feed';       // feed | sources
let q = '';
let sourceFilter = '';
/** 最近一次手工巡检结果（跨卡片重渲染保留，避免结果刚显示就被刷新冲掉） */
let lastTickHtml = '';

function head(ctx) {
  return '<div class="page-head"><div class="crumb">计划中心 / 情报资讯</div>'
    + '<div class="ph-row"><h1>情报资讯</h1>'
    + '<div class="ph-actions"><button class="btn btn-sm' + (tab === 'feed' ? ' btn-primary' : '') + '" data-t="feed">情报流</button>'
    + '<button class="btn btn-sm' + (tab === 'sources' ? ' btn-primary' : '') + '" data-t="sources">来源登记</button></div></div>'
    + '<div class="ph-desc">外部内容一律按**不可信数据**处理；抓取受主机白名单与 SSRF 判定约束，失败即降级且如实展示。</div></div>';
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
  hostEl.querySelectorAll('[data-t]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.t; render(); }));
  if (tab === 'feed') await renderFeed(); else await renderSources();
}

/* ---------------- 情报流 ---------------- */

async function renderFeed() {
  const ctx = ctxRef;
  let data;
  try { data = await api.get(withBrand('/api/mos/source-items', ctx.brand, { q, sourceId: sourceFilter, pageSize: 100 })); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', { title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: renderFeed }] });
    setBody(s.html); s.bind(bodyEl()); return;
  }
  let srcs = { items: [] };
  try { srcs = await api.get(withBrand('/api/mos/sources', ctx.brand)); } catch (_) { /* ignore */ }

  let html = '<div class="filters">'
    + '<input type="search" id="iq" placeholder="搜索标题/摘要" value="' + esc(q) + '">'
    + '<select id="isrc"><option value="">全部来源</option>' + (srcs.items || []).map((s) =>
      '<option value="' + esc(s.id) + '"' + (sourceFilter === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select>'
    + '<button class="btn btn-sm" id="igo">筛选</button>'
    + '<span class="pill">共 ' + data.total + ' 条</span></div>';

  if (!data.items.length) {
    html += '<div class="card"><div class="card-body">' + stateBlock('empty', {
      title: '暂无情报条目',
      desc: '当前品牌还没有采集到条目。请到「来源登记」核验并启用一个来源，然后执行采集；采集结果会出现在这里。'
    }).html + '</div></div>';
  } else {
    html += '<div class="card"><div class="card-head"><h2>情报条目</h2></div><div class="card-body tight">';
    for (const it of data.items) {
      html += '<div class="list-item"><div class="li-main">'
        + '<div class="li-title">' + esc(it.title) + ' ' + demoBadge(it.demo) + '</div>'
        + '<div class="li-sub">' + esc(it.sourceName) + ' · ' + esc(it.tier) + ' · 发布 ' + esc(fmtDate(it.publishedAt))
        + ' · 采集 ' + esc(fmtDate(it.fetchedAt)) + ' · 许可 <span class="pill">' + esc(it.licenseState) + '</span></div>'
        + '<div class="li-sub">' + esc(String(it.summary || '').slice(0, 160)) + '</div>'
        + '<div class="li-sub">AI 摘要：' + (it.aiSummary ? esc(it.aiSummary) : '<span class="muted">' + esc(aiStateLabel(it.aiSummaryState)) + '</span>') + '</div>'
        + '</div><div class="li-actions">'
        + '<a class="btn btn-sm" href="' + esc(it.canonicalUrl) + '" target="_blank" rel="noopener noreferrer">原文链接</a>'
        + '<button class="btn btn-sm btn-primary" data-mktopic="' + esc(it.id) + '">建 Topic</button>'
        + '</div></div>';
    }
    html += '</div></div>';
  }
  html += '<div class="callout warn">许可合规：许可状态为 METADATA_ONLY / UNVERIFIED 的来源只保存元数据与链接（不含全文）。'
    + '收费媒体（Reuters/FT/Bloomberg 等）必须核对授权，禁止绕过付费墙（04 §3）。</div>';

  setBody(html);
  const go = () => { q = hostEl.querySelector('#iq').value.trim(); sourceFilter = hostEl.querySelector('#isrc').value; render(); };
  hostEl.querySelector('#igo').addEventListener('click', go);
  hostEl.querySelector('#iq').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  hostEl.querySelectorAll('[data-mktopic]').forEach((b) => b.addEventListener('click', () => makeTopicDialog(b.dataset.mktopic)));
}

function aiStateLabel(s) {
  return {
    NOT_CONFIGURED: '尚未配置模型（未生成）',
    MOCK: 'MOCK 摘要（非模型输出）',
    OK: '已生成',
    PROVIDER_ERROR: '模型调用失败',
    INTEGRATION_PENDING: '计划在后续阶段接入',
    BLOCKED: '按策略禁止外发'
  }[s] || s || '未生成';
}

function makeTopicDialog(itemId) {
  const d = (ctxRef.meta && ctxRef.meta.dictionaries) || {};
  openModal({
    title: '由情报创建 Master Topic',
    okText: '创建并建立溯源',
    body: '<div class="hint">创建后会自动建立该 Topic → SourceItem 的证据引用（可回溯）。</div>'
      + '<label class="field"><span>Topic 标题</span><input id="mkT" type="text"></label>'
      + '<label class="field"><span>栏目</span><select id="mkC">' + dictOptions(d.pillars, 'C01', null) + '</select></label>'
      + '<label class="field"><span>叙事</span><select id="mkN">' + dictOptions(d.narratives, 'N01', null) + '</select></label>'
      + '<label class="field"><span>风险等级</span><select id="mkG">' + dictOptions(d.riskGrades, 'G1', null) + '</select></label>',
    onOk: async (b) => {
      try {
        const r = await api.post('/api/mos/source-items/' + itemId + '/create-topic', {
          title: b.querySelector('#mkT').value,
          pillarCode: b.querySelector('#mkC').value,
          narrativeCode: b.querySelector('#mkN').value,
          riskGrade: b.querySelector('#mkG').value
        });
        toast('Topic 已创建：' + r.topicTitle, 'ok');
        ctxRef.navigate('topics');
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

/* ---------------- 来源登记 ---------------- */

async function renderSources() {
  const ctx = ctxRef;
  let data;
  try { data = await api.get(withBrand('/api/mos/sources', ctx.brand)); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', { title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: renderSources }] });
    setBody(s.html); s.bind(bodyEl()); return;
  }
  const d = (ctx.meta && ctx.meta.dictionaries) || {};

  let html = '<div class="filters"><button class="btn btn-sm btn-primary" id="newSrc">登记来源</button>'
    + '<span class="pill">共 ' + data.items.length + ' 个来源</span>'
    + '<span class="badge badge-warn">新登记来源默认为「待核验」，不会自动抓取</span></div>';

  // A-01：调度面板（默认关闭；先展示「将会采哪些来源」，不做任何出站）
  html += '<div class="card" id="schedCard"><div class="card-head"><h2>采集调度（A-01）</h2>'
    + '<span class="pill">默认关闭</span></div><div class="card-body">' + loadingHtml() + '</div></div>';

  // A-01：作业记录（含失败/跳过，不粉饰）
  html += '<div class="card" id="jobsCard"><div class="card-head"><h2>采集作业记录</h2></div>'
    + '<div class="card-body">' + loadingHtml() + '</div></div>';

  html += '<div class="card"><div class="card-head"><h2>来源登记表</h2></div>';
  if (!data.items.length) {
    html += '<div class="card-body">' + stateBlock('empty', { title: '尚未登记任何来源' }).html + '</div>';
  } else {
    html += '<div class="table-wrap"><table class="tbl"><thead><tr>'
      + '<th>名称</th><th>域名</th><th>等级</th><th>方式</th><th>频率</th><th>许可</th><th>状态</th><th>白名单</th><th>条目</th><th>下次采集</th><th></th></tr></thead><tbody>';
    for (const s of data.items) {
      html += '<tr><td>' + esc(s.name) + ' ' + demoBadge(s.demo) + '</td>'
        + '<td class="mono small">' + esc(s.domain) + '</td>'
        + '<td>' + esc(s.tier) + '</td>'
        + '<td>' + esc(s.method) + '</td>'
        + '<td><span class="pill">' + esc(s.frequency || 'MANUAL') + '</span>'
        + (s.schedulable ? '' : '<div class="small muted">不自动</div>') + '</td>'
        + '<td><span class="pill">' + esc(s.licensePolicy) + '</span></td>'
        + '<td>' + statusBadge(s.status) + '</td>'
        + '<td>' + (s.egressAllowlisted ? '<span class="badge badge-ok">在名单</span>' : '<span class="badge badge-warn">未列入</span>') + '</td>'
        + '<td>' + s.itemCount + '</td>'
        + '<td class="small muted">' + (s.nextRunAt ? esc(fmtDateTime(s.nextRunAt)) : (s.schedulable ? '下次巡检' : '—'))
        + (s.scheduleFailures ? '<div class="err-text">连续失败 ' + s.scheduleFailures + ' 次</div>' : '')
        + (s.lastError ? '<div class="err-text">' + esc(String(s.lastError).slice(0, 50)) + '</div>' : '') + '</td>'
        + '<td class="actions"><button class="btn btn-sm" data-src="' + esc(s.id) + '">管理</button></td></tr>';
    }
    html += '</tbody></table></div>';
  }
  html += '</div>';

  setBody(html);
  hostEl.querySelector('#newSrc').addEventListener('click', () => newSourceDialog(d));
  hostEl.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => openSource(b.dataset.src)));
  loadSchedulerCard();
  loadJobsCard();
}

/* ---------------- 采集调度与作业记录（A-01） ---------------- */

function jobStatusBadge(st) {
  // 复用既有 CSS 类（app.css 中不存在 badge-err，故失败用 badge-danger）
  const map = { SUCCEEDED: 'badge-ok', FAILED: 'badge-danger', BLOCKED: 'badge-warn', SKIPPED: 'badge-neutral', RUNNING: 'badge-info' };
  return '<span class="badge ' + (map[st] || 'badge-neutral') + '">' + esc(st) + '</span>';
}

async function loadSchedulerCard() {
  const card = hostEl.querySelector('#schedCard');
  if (!card) return;
  const box = card.querySelector('.card-body');
  let data;
  try { data = await api.get(withBrand('/api/mos/ingest/scheduler', ctxRef.brand)); }
  catch (err) { box.innerHTML = '<div class="err-text">调度状态加载失败：' + esc(err.message) + '</div>'; return; }
  const s = data.scheduler || {};
  const limits = data.limits || {};
  const due = (data.due || []).filter((x) => x.schedulable && x.due);

  let h = '<dl class="kv">'
    + '<dt>状态</dt><dd>' + (s.running ? '<span class="badge badge-ok">运行中</span>' : '<span class="badge badge-warn">未运行</span>')
    + ' <span class="small muted">配置项 enabled=' + esc(String(s.configured)) + '</span></dd>'
    + '<dt>巡检间隔</dt><dd>' + esc(String(s.intervalMinutes || limits.intervalMinutes || '—')) + ' 分钟（单轮最多 '
    + esc(String(s.maxPerTick || limits.maxPerTick || '—')) + ' 个来源）</dd>'
    + '<dt>连续失败上限</dt><dd>' + esc(String(limits.maxFailures || '—')) + ' 次后停止自动重试（重试有界）</dd>'
    + '<dt>已巡检轮次</dt><dd>' + esc(String(s.tickCount || 0)) + ' 轮 · 最近：' + esc(s.lastTickAt ? fmtDateTime(s.lastTickAt) : '—') + '</dd>'
    + '</dl>';

  h += '<div class="callout">' + esc(s.note || '') + '</div>';
  if (s.singleInstanceOnly) {
    h += '<div class="hint">⚠ 单实例限制：本系统为单文件 JSON 存储，<b>只支持单实例运行</b>。'
      + '第二实例会被持久化锁拒绝（如实上报 LOCK_HELD_BY_OTHER_INSTANCE），不会重复采集。'
      + (s.lock ? '<br>当前锁持有者：<span class="mono">' + esc(s.lock.ownerId) + '</span>'
        + '（心跳 ' + esc(fmtDateTime(s.lock.heartbeatAt)) + (s.lock.isSelf ? '，本进程' : '，<b>其他进程</b>') + '）' : '')
      + '</div>';
  }

  h += '<div class="divider"></div><h3>到期预览（不产生任何出站请求）</h3>';
  if (!due.length) {
    h += '<div class="small muted">当前没有可自动采集的到期来源。'
      + '只有「ACTIVE + 非 MANUAL 频率 + 域名在出站白名单内」的来源才会被调度。</div>';
  } else {
    h += '<ul class="small">';
    for (const x of due) h += '<li>' + esc(x.name) + '（' + esc(x.domain) + '）</li>';
    h += '</ul>';
  }

  const blocked = (data.due || []).filter((x) => !x.schedulable);
  if (blocked.length) {
    h += '<details class="small"><summary>不会自动采集的来源（' + blocked.length + '）</summary><ul>';
    for (const x of blocked) h += '<li>' + esc(x.name) + '：' + esc(x.reason) + '</li>';
    h += '</ul></details>';
  }

  h += '<div class="row" style="flex-wrap:wrap;margin-top:10px">'
    + '<button class="btn btn-sm ' + (s.running ? '' : 'btn-primary') + '" id="schedToggle">'
    + (s.running ? '关闭自动采集' : '开启自动采集') + '</button>'
    + '<button class="btn btn-sm" id="schedTick">立即执行一轮巡检</button>'
    + '</div>';
  h += '<div id="schedOut" style="margin-top:10px">' + (lastTickHtml || '') + '</div>';
  box.innerHTML = h;

  const out = box.querySelector('#schedOut');
  box.querySelector('#schedToggle').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await api.post(withBrand('/api/mos/ingest/scheduler', ctxRef.brand), { enabled: !s.running });
      toast(!s.running ? '自动采集已开启' : '自动采集已关闭', 'ok');
      loadSchedulerCard();
      loadJobsCard();
    } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
  });
  box.querySelector('#schedTick').addEventListener('click', async (e) => {
    e.target.disabled = true;
    out.innerHTML = loadingHtml();
    try {
      const r = await api.post(withBrand('/api/mos/ingest/scheduler/tick', ctxRef.brand), {});
      const sum = r.summary || {};
      lastTickHtml = '<div class="callout ' + (sum.ran ? 'ok' : 'info') + '">本轮巡检：执行 ' + (sum.ran || 0)
        + ' 个来源，跳过 ' + (sum.skipped || 0) + ' 个。'
        + (sum.codes && sum.codes.length ? '<br>异常码：<span class="mono">' + esc(sum.codes.join(', ')) + '</span>' : '')
        + (sum.message ? '<br>' + esc(sum.message) : '')
        + '<br><span class="small muted">「执行 0 个来源」表示当前没有任何 ACTIVE + 非 MANUAL 频率 + 白名单内的来源，'
        + '并非采集失败或成功 —— 系统不会为凑数字而伪造抓取。</span></div>';
      out.innerHTML = lastTickHtml;
      loadJobsCard();
    } catch (err) {
      out.innerHTML = '<div class="callout warn">' + esc(err.message) + '</div>';
    }
    e.target.disabled = false;
  });
}

async function loadJobsCard() {
  const card = hostEl.querySelector('#jobsCard');
  if (!card) return;
  const box = card.querySelector('.card-body');
  let data;
  try { data = await api.get(withBrand('/api/mos/ingest/jobs', ctxRef.brand, { pageSize: 50 })); }
  catch (err) { box.innerHTML = '<div class="err-text">作业记录加载失败：' + esc(err.message) + '</div>'; return; }

  if (!data.items.length) {
    box.innerHTML = '<div class="small muted">尚无采集作业记录。手工「执行采集」与自动巡检都会留下记录（含失败与跳过）。</div>';
    return;
  }
  let h = '<div class="table-wrap"><table class="tbl"><thead><tr>'
    + '<th>开始</th><th>来源</th><th>触发</th><th>状态</th><th>抓取</th><th>新增</th><th>去重</th>'
    + '<th>失败码</th><th>下次</th><th>耗时</th></tr></thead><tbody>';
  for (const j of data.items) {
    h += '<tr><td class="small">' + esc(fmtDateTime(j.startedAt)) + '</td>'
      + '<td>' + esc(j.sourceName || '—') + '</td>'
      + '<td><span class="pill">' + esc(j.trigger) + '</span></td>'
      + '<td>' + jobStatusBadge(j.status) + '</td>'
      + '<td>' + j.fetched + '</td><td>' + j.inserted + '</td><td>' + j.skipped + '</td>'
      + '<td class="small">' + (j.failureCode ? '<span class="err-text">' + esc(j.failureCode) + '</span>'
        + (j.retryable ? ' <span class="badge badge-warn">可重试</span>' : ' <span class="badge badge-err">不重试</span>') : '—')
      + (j.failureReason ? '<div class="small muted">' + esc(String(j.failureReason).slice(0, 70)) + '</div>' : '')
      + '</td>'
      + '<td class="small">' + (j.nextRunAt ? esc(fmtDateTime(j.nextRunAt)) : '—') + '</td>'
      + '<td class="small">' + (j.durationMs === null || j.durationMs === undefined ? '—' : j.durationMs + 'ms') + '</td></tr>';
  }
  h += '</tbody></table></div>';
  h += '<div class="hint">' + esc((data.note || '')) + '</div>';
  box.innerHTML = h;
}

function newSourceDialog(d) {
  openModal({
    title: '登记情报来源',
    okText: '登记（PENDING_VERIFICATION）',
    body: '<div class="hint">登记 ≠ 可用。新来源默认「待核验」，不会执行抓取；核验许可与白名单后置为 ACTIVE 才可采集。</div>'
      + '<label class="field"><span>名称</span><input id="nsN" type="text"></label>'
      + '<label class="field"><span>域名（不含协议）</span><input id="nsD" type="text" placeholder="例如 bis.org"></label>'
      + '<label class="field"><span>端点（RSS/JSON URL，可留空）</span><input id="nsE" type="text" placeholder="https://…"></label>'
      + '<label class="field"><span>等级</span><select id="nsT">' + dictOptions(d.sourceTiers, 'S1', null) + '</select></label>'
      + '<label class="field"><span>采集方式</span><select id="nsM">' + dictOptions(d.sourceMethods, 'RSS', null) + '</select></label>'
      + '<label class="field"><span>许可状态</span><select id="nsL">' + dictOptions(d.licenseStates, 'UNVERIFIED', null) + '</select></label>',
    onOk: async (b) => {
      try {
        await api.post(withBrand('/api/mos/sources', ctxRef.brand), {
          name: b.querySelector('#nsN').value,
          domain: b.querySelector('#nsD').value,
          endpoint: b.querySelector('#nsE').value,
          tier: b.querySelector('#nsT').value,
          method: b.querySelector('#nsM').value,
          licensePolicy: b.querySelector('#nsL').value
        });
        toast('来源已登记（待核验）', 'ok'); render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

async function openSource(id) {
  let data;
  try { data = await api.get(withBrand('/api/mos/sources', ctxRef.brand)); }
  catch (err) { toast(err.message, 'err'); return; }
  const s = (data.items || []).find((x) => x.id === id);
  if (!s) { toast('来源不存在', 'err'); return; }

  const dr = openDrawer({ title: '来源：' + s.name });
  const draw = () => renderSourceDetail(dr, s);
  draw();
}

/** 抽屉内：该来源的最近采集作业（含失败与跳过，不粉饰） */
async function loadSourceJobs(dr, sourceId) {
  const box = dr.body.querySelector('#srcJobs');
  if (!box) return;
  let data;
  try { data = await api.get(withBrand('/api/mos/ingest/jobs', ctxRef.brand, { sourceId, pageSize: 20 })); }
  catch (err) { box.innerHTML = '<div class="err-text">作业记录加载失败：' + esc(err.message) + '</div>'; return; }
  if (!data.items.length) {
    box.innerHTML = '<div class="small muted">该来源尚无采集作业记录。</div>';
    return;
  }
  let h = '<table class="tbl small"><thead><tr><th>开始</th><th>触发</th><th>状态</th><th>新增/去重</th><th>失败码</th><th>下次</th></tr></thead><tbody>';
  for (const j of data.items) {
    h += '<tr><td>' + esc(fmtDateTime(j.startedAt)) + '</td>'
      + '<td>' + esc(j.trigger) + '</td>'
      + '<td>' + jobStatusBadge(j.status) + '</td>'
      + '<td>' + j.inserted + ' / ' + j.skipped + '</td>'
      + '<td>' + (j.failureCode ? '<span class="err-text">' + esc(j.failureCode) + '</span>'
        + (j.retryable ? ' <span class="badge badge-warn">可重试</span>' : ' <span class="badge badge-danger">不重试</span>') : '—')
      + (j.note ? '<div class="small muted">' + esc(j.note) + '</div>' : '') + '</td>'
      + '<td>' + (j.nextRunAt ? esc(fmtDateTime(j.nextRunAt)) : '—') + '</td></tr>';
  }
  h += '</tbody></table>';
  box.innerHTML = h;
}

function renderSourceDetail(dr, s) {
  let html = '';
  html += '<div class="row between"><strong>' + esc(s.name) + '</strong>' + statusBadge(s.status) + '</div>';
  html += '<div class="small muted mono">' + esc(s.domain) + '</div>';
  html += '<div class="divider"></div>';
  html += '<dl class="kv">'
    + '<dt>端点</dt><dd class="mono small">' + esc(s.endpoint || '—') + '</dd>'
    + '<dt>等级 / 方式</dt><dd>' + esc(s.tier) + ' / ' + esc(s.method) + '</dd>'
    + '<dt>许可</dt><dd><span class="pill">' + esc(s.licensePolicy) + '</span> 保存全文：' + (s.allowFullText ? '允许' : '不允许') + '</dd>'
    + '<dt>白名单</dt><dd>' + (s.egressAllowlisted ? '<span class="badge badge-ok">在出站白名单内</span>' : '<span class="badge badge-warn">不在出站白名单内（真实抓取会被阻断）</span>') + '</dd>'
    + '<dt>采集频率</dt><dd><span class="pill">' + esc(s.frequency || 'MANUAL') + '</span> '
    + (s.schedulable ? '<span class="badge badge-ok">可自动采集</span>' : '<span class="badge badge-warn">不自动采集</span>') + '</dd>'
    + '<dt>下次自动采集</dt><dd>' + (s.nextRunAt ? esc(fmtDateTime(s.nextRunAt)) : '—')
    + (s.scheduleFailures ? ' <span class="err-text">连续失败 ' + s.scheduleFailures + ' 次</span>' : '') + '</dd>'
    + (s.schedulable ? '' : '<dt>不自动原因</dt><dd class="small">' + esc(s.schedulableReason || '') + '</dd>')
    + '<dt>最近成功</dt><dd>' + esc(fmtDateTime(s.lastOkAt)) + '</dd>'
    + '<dt>最近失败</dt><dd>' + esc(fmtDateTime(s.lastErrorAt)) + (s.lastError ? '<div class="err-text">' + esc(s.lastError) + '</div>' : '') + '</dd>'
    + '<dt>许可说明</dt><dd class="small">' + esc(s.licenseNote || '—') + '</dd>'
    + '</dl>';

  html += '<div class="divider"></div>';
  html += '<h3>操作</h3>';
  html += '<div class="row" style="flex-wrap:wrap;margin-top:8px">';
  if (s.status === 'PENDING_VERIFICATION') html += '<button class="btn btn-sm" data-act="activate">核验通过并启用</button>';
  if (s.status === 'ACTIVE') html += '<button class="btn btn-sm" data-act="disable">停用</button>';
  html += '<button class="btn btn-sm btn-primary" data-act="ingest">执行采集</button>';
  html += '<button class="btn btn-sm" data-act="license">更新许可</button>';
  html += '</div>';
  html += '<div class="hint">采集将执行真实 HTTPS 请求（受白名单 + SSRF 判定约束）。失败时错误原因会原样显示，不会伪造成功。</div>';
  html += '<div id="ingestOut" style="margin-top:12px"></div>';
  html += '<div class="divider"></div><h3>最近采集作业</h3>';
  html += '<div id="srcJobs">' + loadingHtml() + '</div>';

  dr.body.innerHTML = html;
  loadSourceJobs(dr, s.id);

  const out = dr.body.querySelector('#ingestOut');

  dr.body.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const act = b.dataset.act;
    try {
      if (act === 'activate') {
        await api.put('/api/mos/sources/' + s.id, { status: 'ACTIVE' });
        toast('来源已启用', 'ok'); dr.close(); render();
      } else if (act === 'disable') {
        await api.put('/api/mos/sources/' + s.id, { status: 'DISABLED' });
        toast('来源已停用', 'ok'); dr.close(); render();
      } else if (act === 'license') {
        openModal({
          title: '更新许可状态',
          okText: '保存',
          body: '<label class="field"><span>许可状态</span><select id="lsL">'
            + dictOptions((ctxRef.meta.dictionaries || {}).licenseStates, s.licensePolicy, null) + '</select></label>'
            + '<label class="field"><span>说明</span><input id="lsN" type="text" value="' + esc(s.licenseNote || '') + '"></label>'
            + '<div class="hint">收紧许可（非 OPEN/LICENSED）会自动撤销"保存全文"。</div>',
          onOk: async (bd) => {
            await api.put('/api/mos/sources/' + s.id, { licensePolicy: bd.querySelector('#lsL').value, licenseNote: bd.querySelector('#lsN').value });
            toast('许可已更新', 'ok'); dr.close(); render();
          }
        });
      } else if (act === 'ingest') {
        out.innerHTML = loadingHtml();
        b.disabled = true;
        const r = await api.post('/api/mos/sources/' + s.id + '/ingest', {});
        if (r.ok) {
          out.innerHTML = '<div class="callout ok">采集完成：抓取 ' + r.fetched + ' 条，新增 ' + r.inserted + ' 条，去重跳过 ' + r.skipped + ' 条。'
            + (r.job ? '<br>作业 <span class="mono small">' + esc(r.job.id) + '</span>（' + esc(r.job.trigger) + '）' : '')
            + (r.aiSummaryState === 'NOT_CONFIGURED' ? '<br>' + esc(r.aiSummaryNote || '') : '') + '</div>';
          toast('采集完成', 'ok');
          loadSourceJobs(dr, s.id);
          setTimeout(render, 700);
        } else {
          out.innerHTML = '<div class="callout warn"><strong>' + esc(r.status) + '</strong><br>' + esc(r.message || '')
            + (r.nextRunAt ? '<br>下次重试：' + esc(fmtDateTime(r.nextRunAt)) + '（退避）' : '')
            + (!r.retryable && r.status && r.status !== 'SOURCE_PENDING_VERIFICATION' ? '<br>该失败不会自动重试，需人工处理。' : '')
            + '</div>';
          toast('采集未完成：' + r.status, 'err');
          loadSourceJobs(dr, s.id);
        }
        b.disabled = false;
      }
    } catch (err) {
      out.innerHTML = '<div class="callout danger">' + esc(err.message) + '</div>';
      toast(err.message, 'err');
      b.disabled = false;
    }
  }));
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
