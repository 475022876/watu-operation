/* W03-04 Intelligence —— Feed / Sources / Create Topic。
 * 关键诚实性：采集失败、被 SSRF 阻断、来源未核验时必须显示明确状态，绝不伪造"采集成功"。 */
import { api, withBrand } from '../api.js';
import { esc, toast, openDrawer, openModal, loadingHtml, stateBlock, statusBadge, demoBadge, dictOptions, fmtDateTime, fmtDate } from '../ui.js';

let ctxRef = null; let hostEl = null;
let tab = 'feed';       // feed | sources | research | proposals
let q = '';
let sourceFilter = '';
/** 最近一次手工巡检结果（跨卡片重渲染保留，避免结果刚显示就被刷新冲掉） */
let lastTickHtml = '';

function head(ctx) {
  return '<div class="page-head"><div class="crumb">计划中心 / 情报资讯</div>'
    + '<div class="ph-row"><h1>情报资讯</h1>'
    + '<div class="ph-actions"><button class="btn btn-sm' + (tab === 'feed' ? ' btn-primary' : '') + '" data-t="feed">情报流</button>'
    + '<button class="btn btn-sm' + (tab === 'sources' ? ' btn-primary' : '') + '" data-t="sources">来源登记</button>'
    + '<button class="btn btn-sm' + (tab === 'research' ? ' btn-primary' : '') + '" data-t="research">AI 研究</button>'
    + '<button class="btn btn-sm' + (tab === 'proposals' ? ' btn-primary' : '') + '" data-t="proposals">选题建议</button></div></div>'
    + '<div class="ph-desc">外部内容一律按**不可信数据**处理；抓取受主机白名单与 SSRF 判定约束，失败即降级且如实展示。无凭据的研究通道会如实标记 BLOCKED，绝不伪造结果。</div></div>';
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
  if (tab === 'feed') await renderFeed();
  else if (tab === 'research') await renderResearch();
  else if (tab === 'proposals') await renderProposals();
  else await renderSources();
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

/* ==================== V0.1.2 Phase B：AI 研究（报告/证据链） ==================== */

const CATEGORY_LABELS = {
  C01: 'C01 Inside VFIB', C02: 'C02 Banking Explained', C03: 'C03 Banking in Action',
  C04: 'C04 Institutional Solutions', C05: 'C05 Digital Finance Insights', C06: 'C06 VFIB Newsroom'
};
const RISK_LABELS = { G0: 'G0 低', G1: 'G1 常规', G2: 'G2 高', G3: 'G3 极高' };
const CHANNEL_LABELS = {
  LINKEDIN: 'LinkedIn', X: 'X', YOUTUBE: 'YouTube', FACEBOOK: 'Facebook', NEWSLETTER: 'Newsletter'
};

function reportBadge(st) {
  const map = {
    COMPLETED: 'badge-ok', AI_RESEARCH_COMPLETE: 'badge-ok',
    RETRIEVAL_ONLY: 'badge-warn', BLOCKED: 'badge-warn', FAILED: 'badge-danger',
    PENDING: 'badge-info', RUNNING: 'badge-info'
  };
  const label = {
    AI_RESEARCH_COMPLETE: 'AI 研究完成', RETRIEVAL_ONLY: '仅检索（未分析）',
    BLOCKED: '已阻断', COMPLETED: '已完成'
  }[st] || st;
  return '<span class="badge ' + (map[st] || 'badge-neutral') + '">' + esc(label) + '</span>';
}

/** Provider 就绪状态（06 §真实Provider判定；**不隐去 BLOCKED**） */
function readinessBadge(readiness) {
  const map = {
    REAL: ['badge-ok', '已真实联调'],
    CONFIGURED_NOT_TESTED: ['badge-info', '已配置·未联调'],
    NOT_CONFIGURED: ['badge-warn', '未配置'],
    NOT_IMPLEMENTED: ['badge-warn', '适配器未实现'],
    BLOCKED: ['badge-danger', '已阻断']
  };
  const hit = map[readiness] || ['badge-neutral', readiness || '未知'];
  return '<span class="badge ' + hit[0] + '">' + esc(hit[1]) + '</span>';
}

/** 作业状态徽章（异步研究作业） */
function jobBadge(st) {
  const map = {
    QUEUED: 'badge-info', RUNNING: 'badge-info', COMPLETED: 'badge-ok',
    BLOCKED: 'badge-warn', FAILED: 'badge-danger', CANCELLED: 'badge-neutral'
  };
  const label = { QUEUED: '排队中', RUNNING: '执行中', COMPLETED: '已完成', BLOCKED: '已阻断', FAILED: '失败', CANCELLED: '已取消' };
  return '<span class="badge ' + (map[st] || 'badge-neutral') + '">' + esc(label[st] || st) + '</span>';
}

/** 阶段中文名（首屏不出现技术阶段码） */
function stageLabel(stage) {
  return {
    QUEUED: '排队', SEARCHING: '检索外部来源', FETCHING: '读取受限网页', VERIFYING: '证据核验',
    ANALYZING: '结构化分析', DONE: '完成', CANCELLED: '已取消', FAILED: '失败', BLOCKED: '已阻断'
  }[stage] || stage || '';
}

const AVAILABILITY_LABEL = {
  AVAILABLE: '可读全文', NOT_FOUND: '页面不存在（404）', HTTP_ERROR: '上游错误',
  BLOCKED: '被安全策略阻断', UNAVAILABLE: '不可用', UNSUPPORTED_TYPE: '非文本内容'
};

const GAP_LABEL = {
  NOT_FOUND: '证据缺口', DATE_UNKNOWN: '发布时间未知', SINGLE_SOURCE: '单一来源',
  CONFLICT: '来源间存在矛盾', TIME_SENSITIVE: '时间敏感·需重新核验', STALE: '可能已过时'
};
function proposalBadge(st) {
  const map = { AI_RECOMMENDED: 'badge-info', PENDING_EDITORIAL_REVIEW: 'badge-warn', APPROVED: 'badge-ok', REVISION_REQUESTED: 'badge-warn', ON_HOLD: 'badge-neutral', REJECTED: 'badge-danger' };
  return '<span class="badge ' + (map[st] || 'badge-neutral') + '">' + esc(st) + '</span>';
}
function verificationBadge(v) {
  const map = { VERIFIED: 'badge-ok', NEEDS_VERIFICATION: 'badge-warn', UNVERIFIED: 'badge-neutral' };
  return '<span class="badge ' + (map[v] || 'badge-neutral') + '">' + esc(v === 'NEEDS_VERIFICATION' ? '待核验' : v) + '</span>';
}

let researchJobs = [];
let jobTimer = null;
let reportFilter = '';

async function renderResearch() {
  const ctx = ctxRef;
  let data, prov, jobs;
  try {
    data = await api.get(withBrand('/api/mos/research/reports', ctx.brand));
    prov = await api.get('/api/mos/research/providers');
    jobs = await api.get(withBrand('/api/mos/research/jobs', ctx.brand));
  } catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', { title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: renderResearch }] });
    setBody(s.html); s.bind(bodyEl()); return;
  }
  researchJobs = jobs.items || [];
  const p = prov.providers || {};
  const bud = prov.budget || {};

  let html = '<div class="filters">'
    + '<button class="btn btn-sm btn-primary" id="dailyBtn">汇编每日情报</button>'
    + '<button class="btn btn-sm btn-primary" id="deepBtn">发起专题研究</button>'
    + '<select id="rflt"><option value="">全部报告</option>'
    + '<option value="AI_RESEARCH_COMPLETE"' + (reportFilter === 'AI_RESEARCH_COMPLETE' ? ' selected' : '') + '>AI 研究完成</option>'
    + '<option value="RETRIEVAL_ONLY"' + (reportFilter === 'RETRIEVAL_ONLY' ? ' selected' : '') + '>仅检索（未分析）</option>'
    + '<option value="BLOCKED"' + (reportFilter === 'BLOCKED' ? ' selected' : '') + '>已阻断</option></select>'
    + '<span class="pill">共 ' + data.items.length + ' 份报告</span></div>';

  // 外部搜索状态（一屏；技术参数收进「高级」）
  html += '<div class="callout ' + (p.readiness === 'REAL' ? 'ok' : (p.readiness === 'NOT_CONFIGURED' || p.readiness === 'NOT_IMPLEMENTED' ? 'warn' : '')) + '">'
    + '外部搜索通道：' + readinessBadge(p.readiness) + ' · 供应商 <span class="mono">' + esc(p.provider || 'none') + '</span>'
    + '<div class="small muted" style="margin-top:4px">' + esc(p.note || '') + '</div>'
    + '<details class="adv"><summary>高级：预算与端点</summary>'
    + '<div class="small muted">单作业上限 $' + esc(String(bud.perJobUsdMax == null ? 0 : bud.perJobUsdMax))
    + ' · 品牌月度上限 $' + esc(String(bud.brandMonthlyUsd == null ? 0 : bud.brandMonthlyUsd))
    + ' · 本月已确认 $' + esc(String(bud.spentConfirmedUsd == null ? 0 : bud.spentConfirmedUsd))
    + ' · 端点主机 <span class="mono">' + esc(p.endpointHost || '—') + '</span>'
    + '<br>' + esc(bud.note || '') + '</div></details></div>';

  // 进行中的研究作业（进度/阶段/取消）
  const active = researchJobs.filter((j) => ['QUEUED', 'RUNNING'].indexOf(j.status) !== -1);
  if (active.length) {
    html += '<div class="card"><div class="card-head"><h2>进行中的研究（' + active.length + '）</h2></div><div class="card-body tight" id="jobList">';
    for (const j of active) html += jobRowHtml(j);
    html += '</div></div>';
  }

  // 最近完成的作业（失败/阻断也要如实可见）
  const recent = researchJobs.filter((j) => ['QUEUED', 'RUNNING'].indexOf(j.status) === -1).slice(0, 3);
  if (recent.length) {
    html += '<div class="card"><div class="card-head"><h2>最近研究作业</h2></div><div class="card-body tight">';
    for (const j of recent) html += jobRowHtml(j);
    html += '</div></div>';
  }

  const shown = reportFilter ? data.items.filter((r) => r.status === reportFilter) : data.items;
  if (!shown.length) {
    html += '<div class="card"><div class="card-body">' + stateBlock('empty', {
      title: '暂无研究报告',
      desc: '点「汇编每日情报」从已采集的可信来源生成报告；或点「发起专题研究」做一次真实外部检索与结构化分析。'
    }).html + '</div></div>';
  } else {
    html += '<div class="card"><div class="card-head"><h2>研究报告</h2></div><div class="card-body tight">';
    for (const r of shown) {
      html += '<div class="list-item"><div class="li-main">'
        + '<div class="li-title">' + esc(r.code) + ' · ' + reportBadge(r.status) + ' ' + demoBadge(r.demo) + '</div>'
        + '<div class="li-sub">' + esc(String(r.title || r.query || '').slice(0, 140)) + '</div>'
        + '<div class="li-sub small muted">证据 ' + ((r.sources || []).length) + ' 条 · 发现 ' + (r.findingCount || 0)
        + ' 条 · 候选选题 ' + ((r.editorialOpportunities || []).length) + ' 条 · 未决 ' + ((r.unresolvedClaims || []).length) + ' 项 · '
        + esc(fmtDateTime(r.createdAt)) + '</div>'
        + (r.blockedReason ? '<div class="err-text">' + esc(r.blockedReason) + '</div>' : '')
        + '</div><div class="li-actions"><button class="btn btn-sm" data-rpt="' + esc(r.id) + '">详情</button></div></div>';
    }
    html += '</div></div>';
  }
  html += '<div class="hint">研究规则：检索结果不等于有效证据（404 / 日期不明 / 单一来源 / 矛盾一律如实标注）；'
    + '无来源的事实会被强制降级；未接入分析模型时只输出检索结果，<b>不会</b>标记为「AI 研究完成」。</div>';

  setBody(html);
  hostEl.querySelector('#dailyBtn').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await api.post(withBrand('/api/mos/research/daily', ctxRef.brand), { days: 1 });
      toast('每日情报已汇编：' + r.report.findingCount + ' 条发现', 'ok');
      renderResearch();
    } catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
  });
  hostEl.querySelector('#deepBtn').addEventListener('click', () => deepResearchDialog());
  hostEl.querySelector('#rflt').addEventListener('change', (e) => { reportFilter = e.target.value; renderResearch(); });
  hostEl.querySelectorAll('[data-rpt]').forEach((b) => b.addEventListener('click', () => openReport(b.dataset.rpt)));
  bindJobActions();

  scheduleJobPoll();
}

function jobRowHtml(j) {
  const pct = Math.max(0, Math.min(100, Number(j.progress) || 0));
  return '<div class="list-item" data-job="' + esc(j.id) + '">'
    + '<div class="li-main"><div class="li-title">' + esc(j.code) + ' · ' + jobBadge(j.status) + ' · '
    + esc(stageLabel(j.stage)) + ' <span class="pill">' + pct + '%</span></div>'
    + '<div class="li-sub">' + esc(String(j.query || '').slice(0, 120)) + '</div>'
    + '<div class="progress"><i style="width:' + pct + '%"></i></div>'
    + '<div class="li-sub small muted">检索 trace ' + esc(String(j.providerTraceId || '—'))
    + ' · 证据 ' + (j.evidenceCount || 0) + ' · 发现 ' + (j.findingCount || 0) + '</div>'
    + (j.reason ? '<div class="' + (j.status === 'FAILED' ? 'err-text' : 'small muted') + '">' + esc(j.reason) + '</div>' : '')
    + '</div><div class="li-actions">'
    + (['QUEUED', 'RUNNING'].indexOf(j.status) !== -1 ? '<button class="btn btn-sm" data-jcancel="' + esc(j.id) + '">取消</button>' : '')
    + (['FAILED', 'BLOCKED', 'CANCELLED'].indexOf(j.status) !== -1 ? '<button class="btn btn-sm" data-jretry="' + esc(j.id) + '">重试</button>' : '')
    + (j.reportId ? '<button class="btn btn-sm" data-jrep="' + esc(j.reportId) + '">看报告</button>' : '')
    + '</div></div>';
}

function bindJobActions() {
  hostEl.querySelectorAll('[data-jcancel]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api.post(withBrand('/api/mos/research/jobs/' + b.dataset.jcancel + '/cancel', ctxRef.brand), {}); toast('已取消', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
    renderResearch();
  }));
  hostEl.querySelectorAll('[data-jretry]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api.post(withBrand('/api/mos/research/jobs/' + b.dataset.jretry + '/retry', ctxRef.brand), {}); toast('已重新排队（复用同一报告，避免重复计费）', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
    renderResearch();
  }));
  hostEl.querySelectorAll('[data-jrep]').forEach((b) => b.addEventListener('click', () => openReport(b.dataset.jrep)));
}

/** 只在存在活动作业时轮询；离开页签/全部终态即停止 */
function scheduleJobPoll() {
  if (jobTimer) { clearTimeout(jobTimer); jobTimer = null; }
  const active = researchJobs.filter((j) => ['QUEUED', 'RUNNING'].indexOf(j.status) !== -1);
  if (!active.length || tab !== 'research') return;
  jobTimer = setTimeout(async () => {
    try {
      const jobs = await api.get(withBrand('/api/mos/research/jobs', ctxRef.brand));
      researchJobs = jobs.items || [];
      const el = hostEl.querySelector('#jobList');
      const activeNow = researchJobs.filter((j) => ['QUEUED', 'RUNNING'].indexOf(j.status) !== -1);
      if (el && activeNow.length) el.innerHTML = activeNow.map(jobRowHtml).join('');
      bindJobActions();
      if (activeNow.length) scheduleJobPoll();
      else { toast('研究作业已结束', 'ok'); renderResearch(); }
    } catch (_) { scheduleJobPoll(); }
  }, 1500);
}

/** 发起专题研究：提交后**立即返回 jobId**，进度在页面上滚动，可取消 */
function deepResearchDialog() {
  openModal({
    title: '发起专题研究',
    okText: '开始研究',
    body: '<div class="hint">系统会做一次**真实外部检索**并读取受限网页（连接层 SSRF 防护），'
      + '再交给分析模型产出结构化研究。未配置凭据时会如实记 <b>已阻断</b>，绝不伪造结果；'
      + '未接入模型时只给检索证据（不标「AI 研究完成」）。</div>'
      + '<label class="field"><span>研究主题 *</span><input id="drQ" type="text" placeholder="例如：跨境支付监管动态与稳定币监管碎片化"></label>'
      + '<label class="field"><span>研究目标（可选）</span><input id="drO" type="text" placeholder="例如：评估对机构业务与内容机会的影响"></label>'
      + '<div class="grid grid-2">'
      + '<label class="field"><span>起始日期（可选）</span><input id="drF" type="date"></label>'
      + '<label class="field"><span>截止日期（可选）</span><input id="drT" type="date"></label>'
      + '</div>'
      + '<details class="adv"><summary>高级：深度与范围</summary>'
      + '<div class="grid grid-2">'
      + '<label class="field"><span>深度</span><select id="drD"><option value="STANDARD">标准</option><option value="DEEP">深入</option></select></label>'
      + '<label class="field"><span>最多来源</span><input id="drN" type="number" min="1" max="30" value="10"></label>'
      + '<label class="field"><span>地区（可选）</span><input id="drR" type="text" placeholder="例如：APAC"></label>'
      + '<label class="field"><span>业务方向（可选）</span><input id="drI" type="text" placeholder="例如：跨境支付"></label>'
      + '</div></details>',
    onOk: async (b) => {
      const query = b.querySelector('#drQ').value.trim();
      if (!query) { toast('请填写研究主题', 'err'); return false; }
      const from = b.querySelector('#drF').value || null;
      const to = b.querySelector('#drT').value || null;
      try {
        const r = await api.post(withBrand('/api/mos/research/jobs', ctxRef.brand), {
          query,
          objective: b.querySelector('#drO').value.trim() || null,
          timeWindow: (from || to) ? { from, to } : null,
          region: b.querySelector('#drR').value.trim() || null,
          industry: b.querySelector('#drI').value.trim() || null,
          depth: b.querySelector('#drD').value,
          maxResults: Number(b.querySelector('#drN').value) || null,
          // 前端自动生成幂等键：双击/刷新不会重复扣费（键绑定账号+品牌+内容摘要）
          idempotencyKey: 'ui:' + ctxRef.brand + ':' + query.slice(0, 60)
        });
        toast(r.deduplicated ? '已有相同研究，已复用作业 ' + r.job.code : '研究已启动 ' + r.job.code, 'ok');
        renderResearch();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

async function openReport(id) {
  let data;
  try { data = await api.get('/api/mos/research/reports/' + id); }
  catch (err) { toast(err.message, 'err'); return; }
  const r = data.report;
  const dr = openDrawer({ title: '研究报告 ' + r.code });

  const render = () => {
    let h = '<dl class="kv">'
      + '<dt>模式 / 完成度</dt><dd>' + esc(r.mode) + ' ' + reportBadge(r.status)
      + (r.completion && r.completion !== r.status ? ' <span class="pill">' + esc(r.completion) + '</span>' : '') + '</dd>'
      + '<dt>主题</dt><dd>' + esc(r.title || r.query || '') + '</dd>'
      + (r.objective ? '<dt>研究目标</dt><dd>' + esc(r.objective) + '</dd>' : '')
      + '<dt>时间范围</dt><dd>' + esc(r.period && (r.period.from || r.period.to)
        ? (fmtDate(r.period.from) + ' ~ ' + fmtDate(r.period.to)) : '未限定') + '</dd>'
      + '<dt>提供方 / 模型</dt><dd><span class="mono">' + esc(r.provider || '—') + '</span> · '
      + esc(r.model || '未调用模型') + '</dd>'
      + '<dt>创建</dt><dd>' + esc(fmtDateTime(r.createdAt)) + '</dd>'
      + '</dl>';

    if (r.blockedReason) h += '<div class="callout warn"><strong>已阻断</strong><br>' + esc(r.blockedReason) + '</div>';
    if (r.completion === 'RETRIEVAL_ONLY') {
      h += '<div class="callout warn"><strong>仅检索（未分析）</strong><br>'
        + '本次没有可用的分析模型，因此只提供检索与证据留档。<b>这不是 AI 研究结论</b>，不得直接对外使用。</div>';
    }

    if (r.executiveSummary) h += '<div class="divider"></div><h3>摘要</h3><div class="small">' + esc(r.executiveSummary) + '</div>';
    if (r.industryImplications) h += '<h3>行业含义</h3><div class="small">' + esc(r.industryImplications) + '</div>';
    if (r.vfibRelevance) h += '<h3>与本机构的相关性</h3><div class="small">' + esc(r.vfibRelevance) + '</div>';

    h += '<div class="divider"></div><h3>来源与证据（' + ((r.sources || []).length) + '）</h3>';
    if (!(r.sources || []).length) h += '<div class="small muted">无来源记录。</div>';
    for (const s of (r.sources || [])) {
      h += '<div class="list-item"><div class="li-main">'
        + '<div class="li-title">' + esc(s.title || '(无标题)') + ' <span class="badge '
        + (s.availability === 'AVAILABLE' ? 'badge-ok' : 'badge-warn') + '">' + esc(AVAILABILITY_LABEL[s.availability] || s.availability) + '</span></div>'
        + '<div class="li-sub small muted">' + esc(s.sourceName || '') + ' · 发布 ' + esc(s.publishedAt ? fmtDate(s.publishedAt) : 'Unknown')
        + ' · 抓取 ' + esc(fmtDate(s.retrievedAt)) + ' · 许可 ' + esc(s.licenseState || 'UNKNOWN')
        + ' · 指纹 <span class="mono">' + esc(String(s.contentHash || '').slice(0, 10)) + '</span></div>'
        + '<div class="li-sub small"><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">打开原文</a></div>'
        + '</div></div>';
    }

    h += '<div class="divider"></div><h3>关键发现（' + ((r.findings || []).length) + '）</h3>';
    if (!(r.findings || []).length) h += '<div class="small muted">无发现。</div>';
    for (const f of (r.findings || [])) {
      h += '<div class="list-item"><div class="li-main">'
        + '<div class="li-title">' + esc(kindLabel(f.kind)) + ' ' + verificationBadge(f.verificationState)
        + (f.origin === 'RETRIEVAL' ? ' <span class="pill">检索留档</span>' : '')
        + (f.downgraded ? ' <span class="pill">已降级</span>' : '') + '</div>'
        + '<div class="li-sub">' + esc(String(f.statement || '').slice(0, 400)) + '</div>'
        + (f.confidenceRationale ? '<div class="li-sub small muted">依据说明：' + esc(String(f.confidenceRationale).slice(0, 200)) + '</div>' : '')
        + ((f.notes || []).length ? '<div class="li-sub small muted">校验：' + esc((f.notes || []).join('；')) + '</div>' : '');
      for (const ev of (f.evidence || [])) {
        h += '<div class="li-sub small muted">证据：' + esc(ev.sourceName || ev.url) + ' · <a href="' + esc(ev.url) + '" target="_blank" rel="noopener noreferrer">链接</a>'
          + ' · 指纹 <span class="mono">' + esc(String(ev.digest || ev.contentHash || '').slice(0, 12)) + '</span></div>';
      }
      h += '</div></div>';
    }
    h += '<div class="hint">无证据的关键事实会被强制降级为「推断」并标待核验；系统不会把未核验内容标为已核验。</div>';

    const gaps = r.unresolvedClaims || [];
    h += '<div class="divider"></div><h3>未决与矛盾（' + gaps.length + '）</h3>';
    h += '<div class="small muted">交叉验证状态：' + esc(r.conflictDetection === 'MODEL_ASSISTED' ? '由模型辅助识别矛盾'
      : (r.conflictDetection === 'HEURISTIC' ? '规则识别' : '未执行（不假装已交叉验证）')) + '</div>';
    if (!gaps.length) h += '<div class="small muted">无未决项。</div>';
    for (const g of gaps) {
      h += '<div class="list-item"><div class="li-main"><div class="li-title">'
        + '<span class="badge ' + (g.kind === 'CONFLICT' ? 'badge-danger' : 'badge-warn') + '">' + esc(GAP_LABEL[g.kind] || g.kind) + '</span>'
        + (g.origin === 'MODEL' ? ' <span class="pill">模型识别</span>' : ' <span class="pill">规则识别</span>') + '</div>'
        + '<div class="li-sub">' + esc(String(g.claim || '').slice(0, 300)) + '</div>'
        + (g.reason ? '<div class="li-sub small muted">' + esc(String(g.reason).slice(0, 200)) + '</div>' : '')
        + '</div></div>';
    }
    if ((r.reverifyDue || []).length) {
      h += '<div class="callout warn">时间敏感结论需重新核验（' + r.reverifyDue.length + ' 项）：'
        + esc(r.reverifyDue.map((x) => x.claim).join('；')).slice(0, 300) + '</div>';
    }

    const ops = r.editorialOpportunities || [];
    h += '<div class="divider"></div><h3>候选选题（' + ops.length + '）</h3>';
    if (!ops.length) h += '<div class="small muted">无候选选题（降级报告不产出推荐）。</div>';
    for (const o of ops) {
      h += '<div class="list-item"><div class="li-main">'
        + '<div class="li-title">' + esc(o.primaryCategory) + ' · ' + esc(o.headlineEn || '')
        + (o.needsVerification ? ' <span class="badge badge-warn">待事实核验</span>' : '') + '</div>'
        + '<div class="li-sub">' + esc(String(o.summaryZh || '').slice(0, 300)) + '</div>'
        + '<div class="li-sub small muted">理由：' + esc(String(o.rationale || '').slice(0, 200)) + '</div>'
        + '<div class="li-sub small muted">渠道 ' + esc((o.channels || []).join('/') || '—') + ' · 交付物 '
        + esc((o.deliverables || []).join('/') || '—') + ' · 风险 ' + esc(o.riskLevel || '—')
        + ' · 证据 ' + ((o.evidenceIds || []).length) + ' 条 · 报告版本 v' + esc(String(o.reportVersion || 1)) + '</div>'
        + ((o.factCheckNeeds || []).length ? '<div class="li-sub small muted">待核验：' + esc(o.factCheckNeeds.join('；')) + '</div>' : '')
        + ((o.special01Notes || []).length ? '<div class="li-sub small muted">栏目规则：' + esc(o.special01Notes.join('；')) + '</div>' : '')
        + '</div></div>';
    }

    const mr = r.modelRun || {};
    h += '<details class="adv"><summary>高级：模型运行与费用</summary><div class="small muted">'
      + '模型调用：' + esc(mr.called ? '已调用' : '未调用') + ' · 状态 <span class="mono">' + esc(mr.state || '—') + '</span>'
      + ' · 用量 <span class="mono">' + esc(JSON.stringify(mr.usage || {})) + '</span><br>'
      + '费用：' + esc(r.cost && r.cost.confirmed ? ('供应商回执 $' + String(r.cost.modelConfirmedUsd))
        : '无供应商回执（不推算单价，标记为估算）') + '<br>'
      + '检索次数 ' + esc(String((r.cost && r.cost.searchCalls) || 0)) + ' · ' + esc((r.cost && r.cost.note) || '') + '</div></details>';

    let acts = '<button class="btn btn-sm" id="rRefresh">检查来源是否需刷新</button>';
    if (ops.length) acts += '<button class="btn btn-sm btn-primary" id="rMaterialize">生成候选选题</button>';
    h += '<div class="divider"></div><div class="li-actions">' + acts + '</div>'
      + '<div class="small muted" id="rMsg"></div>';
    return h;
  };

  dr.body.innerHTML = render();

  const bind = () => {
    const rf = dr.body.querySelector('#rRefresh');
    if (rf) rf.addEventListener('click', async () => {
      rf.disabled = true;
      try {
        const res = await api.post('/api/mos/research/reports/' + r.id + '/refresh-check', {});
        r.refreshState = res.refreshState;
        toast(res.refreshState === 'NEEDS_REFRESH' ? '来源已变更 → 该研究需要刷新' : '未发现来源变更', res.refreshState === 'NEEDS_REFRESH' ? 'err' : 'ok');
        const m = dr.body.querySelector('#rMsg');
        if (m) m.innerHTML = '刷新状态：<b>' + esc(res.refreshState) + '</b> · 变更 ' + res.stale.length + ' 项 · 到期核验 ' + res.reverifyDue.length + ' 项';
      } catch (err) { toast(err.message, 'err'); }
      rf.disabled = false;
    });
    const rm = dr.body.querySelector('#rMaterialize');
    if (rm) rm.addEventListener('click', async () => {
      rm.disabled = true;
      try {
        const res = await api.post('/api/mos/research/reports/' + r.id + '/proposals?brand=' + encodeURIComponent(ctxRef.brand), {});
        toast('已生成 ' + res.items.length + ' 条候选选题（待上级审核）', 'ok');
        if ((res.skipped || []).length) toast('有 ' + res.skipped.length + ' 条未通过校验：' + res.skipped[0].reason, 'err');
      } catch (err) { toast(err.message, 'err'); }
      rm.disabled = false;
    });
  };
  bind();
}

function kindLabel(k) {
  return { FACT: '事实', INTERPRETATION: '推断', RECOMMENDATION: '建议' }[k] || k;
}

/* ==================== V0.1.2 Phase B：选题建议（Proposal 状态机 + 一屏审核） ==================== */

let proposalStatusFilter = '';

async function renderProposals() {
  const ctx = ctxRef;
  let data;
  try { data = await api.get(withBrand('/api/mos/topic-proposals', ctx.brand, { status: proposalStatusFilter })); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', { title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: renderProposals }] });
    setBody(s.html); s.bind(bodyEl()); return;
  }

  let html = '<div class="filters">'
    + '<button class="btn btn-sm btn-primary" id="newProp">新建候选选题</button>'
    + '<select id="pst"><option value="">全部状态</option>'
    + ['AI_RECOMMENDED', 'PENDING_EDITORIAL_REVIEW', 'APPROVED', 'REVISION_REQUESTED', 'ON_HOLD', 'REJECTED'].map((s) =>
      '<option value="' + s + '"' + (proposalStatusFilter === s ? ' selected' : '') + '>' + s + '</option>').join('')
    + '</select>'
    + '<span class="pill">共 ' + data.items.length + ' 条</span></div>';

  html += '<div class="callout">候选选题（Proposal）与正式 Master Topic 分离：只有编辑审批通过后，才会进入正式选题池'
    + '（Phase C）。审核权限为 editorial.approve（仅管理员），<b>不代替</b>正式资产的 library.asset.approve.final。</div>';

  if (!data.items.length) {
    html += '<div class="card"><div class="card-body">' + stateBlock('empty', {
      title: '暂无候选选题',
      desc: '可从「AI 研究」报告推导建议，或手工新建候选选题。'
    }).html + '</div></div>';
  } else {
    html += '<div class="card"><div class="card-head"><h2>候选选题</h2></div><div class="card-body tight">';
    for (const p of data.items) {
      html += '<div class="list-item"><div class="li-main">'
        + '<div class="li-title">' + esc(p.code) + ' · ' + esc(p.suggestedTitleEN) + ' ' + proposalBadge(p.status) + '</div>'
        + '<div class="li-sub">' + esc(CATEGORY_LABELS[p.primaryCategory] || p.primaryCategory) + ' · ' + esc(RISK_LABELS[p.riskGrade] || p.riskGrade)
        + ' · 来源 ' + esc(p.source) + (p.needsVerification ? ' <span class="badge badge-warn">待核验</span>' : '') + '</div>'
        + '<div class="li-sub small muted">' + esc(String(p.summaryZH || '').slice(0, 140)) + '</div>'
        + '</div><div class="li-actions"><button class="btn btn-sm" data-pp="' + esc(p.id) + '">详情/审核</button></div></div>';
    }
    html += '</div></div>';
  }

  setBody(html);
  hostEl.querySelector('#newProp').addEventListener('click', () => newProposalDialog());
  hostEl.querySelector('#pst').addEventListener('change', (e) => { proposalStatusFilter = e.target.value; renderProposals(); });
  hostEl.querySelectorAll('[data-pp]').forEach((b) => b.addEventListener('click', () => openProposal(b.dataset.pp)));
}

function newProposalDialog() {
  openModal({
    title: '新建候选选题',
    okText: '创建（待编辑审核）',
    body: '<div class="hint">员工新建走 PENDING_EDITORIAL_REVIEW；AI 建议走 AI_RECOMMENDED。两路都必须经编辑审批。</div>'
      + '<label class="field"><span>标题（EN）</span><input id="npT" type="text"></label>'
      + '<label class="field"><span>摘要（中文）</span><textarea id="npS" rows="3"></textarea></label>'
      + '<label class="field"><span>主栏目</span><select id="npC">'
      + Object.keys(CATEGORY_LABELS).map((c) => '<option value="' + c + '">' + esc(CATEGORY_LABELS[c]) + '</option>').join('')
      + '</select></label>'
      + '<label class="field"><span>风险等级</span><select id="npG">'
      + Object.keys(RISK_LABELS).map((g) => '<option value="' + g + '"' + (g === 'G1' ? ' selected' : '') + '>' + esc(RISK_LABELS[g]) + '</option>').join('')
      + '</select></label>',
    onOk: async (b) => {
      try {
        await api.post(withBrand('/api/mos/topic-proposals', ctxRef.brand), {
          suggestedTitleEN: b.querySelector('#npT').value,
          summaryZH: b.querySelector('#npS').value,
          primaryCategory: b.querySelector('#npC').value,
          riskGrade: b.querySelector('#npG').value,
          source: 'EMPLOYEE'
        });
        toast('候选选题已创建（待审核）', 'ok');
        renderProposals();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

async function openProposal(id) {
  let data;
  try { data = await api.get('/api/mos/topic-proposals/' + id); }
  catch (err) { toast(err.message, 'err'); return; }
  drawProposal(openDrawer({ title: '候选选题 ' + data.proposal.code }), data.proposal);
}

function drawProposal(dr, p) {
  let h = '<dl class="kv">'
    + '<dt>标题</dt><dd>' + esc(p.suggestedTitleEN) + '</dd>'
    + '<dt>状态</dt><dd>' + proposalBadge(p.status) + ' · 来源 ' + esc(p.source) + ' · 修订 ' + esc(String(p.revision || 0)) + ' 次</dd>'
    + '<dt>摘要</dt><dd>' + esc(p.summaryZH || '') + '</dd>'
    + '<dt>栏目 / 风险</dt><dd>' + esc(CATEGORY_LABELS[p.primaryCategory] || p.primaryCategory) + ' · ' + esc(RISK_LABELS[p.riskGrade] || p.riskGrade) + '</dd>'
    + '<dt>平台</dt><dd>' + ((p.channels || []).map((c) => CHANNEL_LABELS[c] || c).join('、') || '—') + '</dd>'
    + '</dl>';
  if (p.needsVerification || (p.special01 && p.special01.needsVerification)) {
    h += '<div class="callout warn">SPECIAL-01：该选题存在待核验约束。</div>';
  }
  for (const n of ((p.special01 && p.special01.notes) || p.special01Notes || [])) {
    h += '<div class="small muted">· ' + esc(n) + '</div>';
  }
  if ((p.findings || []).length) {
    h += '<div class="divider"></div><h3>支撑发现</h3>';
    for (const f of p.findings) {
      h += '<div class="small">' + esc(f.kind) + ' ' + verificationBadge(f.verificationState) + '<br>' + esc(String(f.statement || '').slice(0, 200)) + '</div>';
    }
  }
  if ((p.editDiff || []).length) {
    h += '<div class="divider"></div><h3>人工改动 diff（审计留痕）</h3>';
    for (const d of p.editDiff) {
      h += '<div class="small mono">' + esc(d.field) + '：' + esc(JSON.stringify(d.from)) + ' → ' + esc(JSON.stringify(d.to)) + '</div>';
    }
  }

  h += '<div class="divider"></div><div id="propActs"></div><div id="propOut" style="margin-top:10px"></div>';
  dr.body.innerHTML = h;
  const acts = dr.body.querySelector('#propActs');
  const out = dr.body.querySelector('#propOut');
  const refresh = async () => {
    try {
      const r = await api.get('/api/mos/topic-proposals/' + p.id);
      drawProposal(dr, r.proposal);
    } catch (err) { toast(err.message, 'err'); }
  };

  let btns = '';
  if (p.status === 'AI_RECOMMENDED') btns += '<button class="btn btn-sm btn-primary" data-act="submit">提交编辑审核</button>';
  if (p.canDecide && p.status === 'PENDING_EDITORIAL_REVIEW') {
    btns += '<button class="btn btn-sm btn-primary" data-act="pool">批准入池</button>'
      + '<button class="btn btn-sm btn-primary" data-act="schedule">批准并安排</button>'
      + '<button class="btn btn-sm" data-act="decide">退回 / 暂缓 / 拒绝</button>';
  }
  if (!btns) btns = '<div class="small muted">当前状态无可用操作' + (p.canDecide ? '' : '（你没有 editorial.approve 权限）') + '</div>';
  acts.innerHTML = '<div class="row" style="flex-wrap:wrap">' + btns + '</div>';

  acts.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    if (b.dataset.act === 'submit') {
      b.disabled = true;
      try { await api.post('/api/mos/topic-proposals/' + p.id + '/submit', {}); toast('已提交审核', 'ok'); refresh(); }
      catch (err) { toast(err.message, 'err'); b.disabled = false; }
    } else if (b.dataset.act === 'pool') {
      b.disabled = true;
      openModal({
        title: '批准入池：' + p.code,
        okText: '批准（APPROVED_UNSCHEDULED）',
        body: '<div class="hint">创建正式 Master Topic（不入计划、不派工）。研究证据中无法回溯到真实来源条目的部分会被如实跳过，不伪造证据。</div>'
          + '<label class="field"><span>叙事（可选，默认 N01）</span><input id="plN" type="text" placeholder="N01-N05"></label>'
          + '<label class="field"><span>审批意见</span><input id="plC" type="text"></label>',
        onOk: async (bd) => {
          try {
            const r = await api.post('/api/mos/topic-proposals/' + p.id + '/approve-to-pool', {
              narrativeCode: bd.querySelector('#plN').value.trim() || 'N01',
              comments: bd.querySelector('#plC').value
            });
            toast('已入池：' + (r.topic ? r.topic.title : ''), 'ok');
            refresh();
          } catch (err) { toast(err.message, 'err'); return false; }
        },
        onCancel: () => { b.disabled = false; }
      });
    } else if (b.dataset.act === 'schedule') {
      b.disabled = true;
      openModal({
        title: '批准并安排：' + p.code,
        okText: '执行（幂等 Saga）',
        body: '<div class="hint">一个事务性操作：批准候选 + 选定/自动创建月度计划 + 唯一 Topic + 每平台独立任务与计划事项。'
          + '派工必填真实负责人与制作期限；重复提交由 idempotencyKey 防重（自动生成）。</div>'
          + '<label class="field"><span>工作日期</span><input id="scD" type="date"></label>'
          + '<label class="field"><span>平台交付物（每行：平台,负责人ID,制作期限YYYY-MM-DD）</span>'
          + '<textarea id="scP" rows="3" placeholder="LINKEDIN, user_xxx, 2026-11-05&#10;X, user_xxx, 2026-11-05"></textarea></label>'
          + '<label class="field"><span>审批意见</span><input id="scC" type="text"></label>',
        onOk: async (bd) => {
          const lines = bd.querySelector('#scP').value.split('\n').map((l) => l.trim()).filter(Boolean);
          const deliverables = [];
          for (const line of lines) {
            const parts = line.split(',').map((x) => x.trim());
            if (parts.length < 3) { toast('每行需：平台,负责人ID,制作期限', 'err'); return false; }
            deliverables.push({ platform: parts[0], ownerId: parts[1], productionDue: parts[2] });
          }
          if (!deliverables.length) { toast('至少 1 个平台交付物', 'err'); return false; }
          try {
            const r = await api.post('/api/mos/topic-proposals/' + p.id + '/approve-and-schedule', {
              idempotencyKey: 'sched-' + p.id + '-' + Date.now(),
              workDate: bd.querySelector('#scD').value,
              deliverables,
              comments: bd.querySelector('#scC').value
            });
            toast(r.replay ? '重复请求已幂等返回（无新增）' : '已安排：Topic + ' + (r.tasks || []).length + ' 个平台任务', 'ok');
            refresh();
          } catch (err) { toast(err.message, 'err'); return false; }
        },
        onCancel: () => { b.disabled = false; }
      });
    } else if (b.dataset.act === 'decide') {
      b.disabled = true;
      openModal({
        title: '一屏审核：' + p.code,
        okText: '提交决策',
        body: '<div class="hint">可修改标题/角度/栏目/平台/交付物/风险；修改会记入审计 diff。C06 缺公告授权、C01/C03 缺正式依据的选题不能批准。</div>'
          + '<label class="field"><span>标题</span><input id="dcT" type="text" value="' + esc(p.suggestedTitleEN) + '"></label>'
          + '<label class="field"><span>角度（可选）</span><input id="dcA" type="text" value="' + esc(p.angle || '') + '"></label>'
          + '<label class="field"><span>决策</span><select id="dcD">'
          + ['APPROVED', 'REVISION_REQUESTED', 'ON_HOLD', 'REJECTED'].map((s) => '<option value="' + s + '">' + s + '</option>').join('')
          + '</select></label>'
          + '<label class="field"><span>审核意见</span><textarea id="dcC" rows="2"></textarea></label>',
        onOk: async (bd) => {
          try {
            const r = await api.post('/api/mos/topic-proposals/' + p.id + '/decision', {
              decision: bd.querySelector('#dcD').value,
              comments: bd.querySelector('#dcC').value,
              edits: {
                suggestedTitleEN: bd.querySelector('#dcT').value,
                angle: bd.querySelector('#dcA').value
              }
            });
            toast('决策已记录：' + r.proposal.status, 'ok');
            refresh();
          } catch (err) { toast(err.message, 'err'); return false; }
        },
        onCancel: () => { b.disabled = false; }
      });
    }
  }));
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
