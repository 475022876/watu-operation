/* W03-04 Intelligence —— Feed / Sources / Create Topic。
 * 关键诚实性：采集失败、被 SSRF 阻断、来源未核验时必须显示明确状态，绝不伪造"采集成功"。 */
import { api, withBrand } from '../api.js';
import { esc, toast, openDrawer, openModal, loadingHtml, stateBlock, statusBadge, demoBadge, dictOptions, fmtDateTime, fmtDate } from '../ui.js';

let ctxRef = null; let hostEl = null;
let tab = 'feed';       // feed | sources
let q = '';
let sourceFilter = '';

function head(ctx) {
  return '<div class="page-head"><div class="crumb">Planning Center / Intelligence</div>'
    + '<div class="ph-row"><h1>Intelligence</h1>'
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

  html += '<div class="card"><div class="card-head"><h2>来源登记表</h2></div>';
  if (!data.items.length) {
    html += '<div class="card-body">' + stateBlock('empty', { title: '尚未登记任何来源' }).html + '</div>';
  } else {
    html += '<div class="table-wrap"><table class="tbl"><thead><tr>'
      + '<th>名称</th><th>域名</th><th>等级</th><th>方式</th><th>许可</th><th>状态</th><th>白名单</th><th>条目</th><th>最近成功</th><th></th></tr></thead><tbody>';
    for (const s of data.items) {
      html += '<tr><td>' + esc(s.name) + ' ' + demoBadge(s.demo) + '</td>'
        + '<td class="mono small">' + esc(s.domain) + '</td>'
        + '<td>' + esc(s.tier) + '</td>'
        + '<td>' + esc(s.method) + '</td>'
        + '<td><span class="pill">' + esc(s.licensePolicy) + '</span></td>'
        + '<td>' + statusBadge(s.status) + '</td>'
        + '<td>' + (s.egressAllowlisted ? '<span class="badge badge-ok">在名单</span>' : '<span class="badge badge-warn">未列入</span>') + '</td>'
        + '<td>' + s.itemCount + '</td>'
        + '<td class="small muted">' + esc(fmtDate(s.lastOkAt)) + (s.lastError ? '<div class="err-text">' + esc(s.lastError.slice(0, 60)) + '</div>' : '') + '</td>'
        + '<td class="actions"><button class="btn btn-sm" data-src="' + esc(s.id) + '">管理</button></td></tr>';
    }
    html += '</tbody></table></div>';
  }
  html += '</div>';

  setBody(html);
  hostEl.querySelector('#newSrc').addEventListener('click', () => newSourceDialog(d));
  hostEl.querySelectorAll('[data-src]').forEach((b) => b.addEventListener('click', () => openSource(b.dataset.src)));
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

  dr.body.innerHTML = html;

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
            + (r.aiSummaryState === 'NOT_CONFIGURED' ? '<br>' + esc(r.aiSummaryNote || '') : '') + '</div>';
          toast('采集完成', 'ok');
          setTimeout(render, 700);
        } else {
          out.innerHTML = '<div class="callout warn"><strong>' + esc(r.status) + '</strong><br>' + esc(r.message || '') + '</div>';
          toast('采集未完成：' + r.status, 'err');
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
