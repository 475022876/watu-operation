/* Marketing OS —— Analytics Center（W07-01 Content / W07-02 Channels / W07-03 Operations / W07-04 AI & Cost）。
 *
 * 口径（00 §4 / 08 §Gate C）：
 *   - 全部数字来自服务端对本库真实记录的聚合，前端不做任何推算，也不填充占位数字；
 *   - 没有数据来源的指标一律显示「缺失」并给出原因；
 *   - 唯一可写操作是**录入渠道指标**（真实持久化到 publication_metrics，带来源与统计时点）。
 *   - 范围外能力（CAC / 获客漏斗 / 行为归因 = MARK-S05）不出现任何菜单或数据。
 */
import { api, withBrand } from '../api.js';
import { esc, toast, openModal, stateBlock, loadingHtml, fmtDateTime, platformLabel } from '../ui.js';

let ctxRef = null;
let hostEl = null;
let tab = 'content';
let data = null;
let pubs = [];          // 渠道指标录入需要发布记录
let busy = false;

const TABS = [
  ['content', 'Content'],
  ['channels', 'Channels'],
  ['operations', 'Operations'],
  ['aiCost', 'AI & Cost']
];

function missingBadge(reason) {
  return '<span class="badge badge-warn" title="' + esc(reason || '') + '">缺失</span>';
}

/** 数字卡：value 为 null 时**不显示数字**，显示缺失态 */
function stat(label, value, note, missingReason) {
  const isMissing = value === null || value === undefined;
  return '<div class="card"><div class="card-body" style="padding:12px 14px">'
    + '<div class="small muted">' + esc(label) + '</div>'
    + '<div style="font-size:21px;font-weight:600;margin:5px 0 2px">'
    + (isMissing ? missingBadge(missingReason) : esc(String(value))) + '</div>'
    + (note ? '<div class="small muted">' + esc(note) + '</div>' : '')
    + '</div></div>';
}

function kvRows(pairs) {
  return '<dl class="kv">' + pairs.filter(Boolean).map(([k, v]) =>
    '<dt>' + esc(k) + '</dt><dd>' + (v === null || v === undefined || v === '' ? '<span class="muted">缺失</span>' : esc(String(v))) + '</dd>').join('') + '</dl>';
}

function bar(label, count, total) {
  const pct = total ? Math.round((count / total) * 100) : 0;
  return '<div class="bar-row"><div class="bar-label">' + esc(label) + '</div>'
    + '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%"></div></div>'
    + '<div class="bar-val mono">' + count + '</div></div>';
}

/* ---------------- 各分段渲染 ---------------- */

function renderContent(s) {
  const t = s.tasks, v = s.versions, tp = s.topics;
  let h = '<div class="grid grid-4">'
    + stat('内容任务', t.total, '本品牌全部任务')
    + stat('内容版本', v.total, '含已冻结/已批准/被取代')
    + stat('Master Topic', tp.total, '其中带证据 ' + tp.withEvidence + ' 条')
    + stat('已发布记录', s.published.total, 'Published Archive 权威归档')
    + '</div>';

  h += '<div class="card"><div class="card-head"><h2>任务状态分布</h2>'
    + '<span class="pill">来源：content_tasks</span></div><div class="card-body">'
    + (t.total ? Object.keys(t.byStatus).sort().map((k) => bar(k, t.byStatus[k], t.total)).join('')
      : stateBlock('empty', { title: '暂无任务', desc: '该品牌还没有内容任务。' }).html)
    + '</div></div>';

  h += '<div class="grid grid-2">'
    + '<div class="card"><div class="card-head"><h2>按栏目（C01–C06）</h2></div><div class="card-body">'
    + (Object.keys(t.byPillar).length ? kvRows(Object.keys(t.byPillar).sort().map((k) => [k, t.byPillar[k]]))
      : '<div class="muted small">暂无数据</div>')
    + '</div></div>'
    + '<div class="card"><div class="card-head"><h2>按平台</h2></div><div class="card-body">'
    + (Object.keys(t.byPlatform).length ? kvRows(Object.keys(t.byPlatform).sort().map((k) => [platformLabel(k), t.byPlatform[k]]))
      : '<div class="muted small">暂无数据</div>')
    + '</div></div>'
    + '</div>';

  h += '<div class="card"><div class="card-head"><h2>版本状态与风险分层</h2></div><div class="card-body">'
    + '<div class="grid grid-2">'
    + '<div>' + kvRows(Object.keys(v.byState).sort().map((k) => [k, v.byState[k]])) + '</div>'
    + '<div>' + kvRows(Object.keys(v.byRiskGrade).sort().map((k) => [k, v.byRiskGrade[k]])) + '</div>'
    + '</div></div></div>';

  h += '<div class="card"><div class="card-head"><h2>内容产出表现</h2></div><div class="card-body">'
    + '<div class="callout warn"><b>互动/触达类表现不在此页。</b>平台指标 API 未接通（00 §4），'
    + '渠道表现请看 <b>Channels</b> 标签，那里只显示带来源与时点的人工/导入记录；无记录即显示「缺失」。</div>'
    + '</div></div>';
  return h;
}

function renderChannels(s) {
  let h = '<div class="grid grid-4">'
    + stat('已登记渠道', s.channels.length, '不含凭据')
    + stat('渠道指标记录', s.metrics.available ? s.metrics.totalRecords : null, '人工/导入录入', s.metrics.reason)
    + stat('指标种类', s.metrics.available ? s.metrics.byMetric.length : null, '按指标名聚合', s.metrics.reason)
    + stat('发布方式', 'MANUAL_ONLY', 'V0.1 不自动发布')
    + '</div>';

  h += '<div class="card"><div class="card-head"><h2>渠道登记与发布数</h2>'
    + '<button class="btn btn-sm" id="anRefresh">刷新</button></div>'
    + '<div class="card-body tight">';
  if (!s.channels.length) {
    h += '<div class="card-body">' + stateBlock('empty', { title: '还没有渠道', desc: '请先在 Publishing Center 登记官方渠道。' }).html + '</div>';
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>平台</th><th>账号标识</th><th>状态</th><th>发布数</th><th>最近发布</th><th>指标记录</th></tr></thead><tbody>'
      + s.channels.map((c) => '<tr><td>' + esc(platformLabel(c.platform)) + '</td>'
        + '<td class="mono small">' + esc(c.handle) + '</td>'
        + '<td>' + esc(c.state) + '</td>'
        + '<td class="mono">' + c.publications + '</td>'
        + '<td class="small mono">' + esc(c.lastPublishedAt ? fmtDateTime(c.lastPublishedAt) : '—') + '</td>'
        + '<td class="mono">' + c.metricRecords + '</td></tr>').join('')
      + '</tbody></table></div>';
  }
  h += '</div></div>';

  h += '<div class="card"><div class="card-head"><h2>公开渠道指标</h2>'
    + '<span class="pill">带来源与统计时点（05 §4）</span></div><div class="card-body">';
  if (!s.metrics.available) {
    h += stateBlock('pending', {
      title: '渠道指标缺失',
      desc: s.metrics.reason + '。系统不会用 0 或示例数字填充（08 §Gate C）。'
    }).html;
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>指标</th><th>记录数</th><th>合计</th><th>来源</th><th>最新时点</th></tr></thead><tbody>'
      + s.metrics.byMetric.map((m) => '<tr><td>' + esc(m.metric) + '</td>'
        + '<td class="mono">' + m.records + '</td>'
        + '<td class="mono">' + m.sum + '</td>'
        + '<td class="small">' + esc(Object.keys(m.sourceKinds).join(' / ')) + '</td>'
        + '<td class="small mono">' + esc(m.latestAsOf || '—') + '</td></tr>').join('')
      + '</tbody></table></div>';
  }
  h += '</div></div>';

  // 唯一可写操作：录入渠道指标（真实落盘 publication_metrics）
  h += '<div class="card"><div class="card-head"><h2>录入渠道指标</h2>'
    + '<span class="pill">写入 publication_metrics</span></div><div class="card-body">'
    + '<div class="hint" style="margin-bottom:8px">只能对**已登记发布**的记录录入指标；必须填写统计时点。'
    + '这是本人工作台内允许的真实操作，不是模拟提交。</div>';
  if (!pubs.length) {
    h += stateBlock('empty', { title: '还没有发布记录', desc: '先到 Publishing Center 人工登记一次实际发布。' }).html;
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>发布版本</th><th>渠道</th><th>发布时间</th><th>状态</th><th></th></tr></thead><tbody>'
      + pubs.map((p) => '<tr><td class="small">' + esc(p.versionCode) + '</td>'
        + '<td class="small">' + esc(p.channelLabel) + '</td>'
        + '<td class="small mono">' + esc(fmtDateTime(p.actualAt)) + '</td>'
        + '<td>' + esc(p.status) + '</td>'
        + '<td class="actions"><button class="btn btn-sm" data-metric="' + esc(p.id) + '">录入指标</button></td></tr>').join('')
      + '</tbody></table></div>';
  }
  h += '</div></div>';
  return h;
}

function renderOperations(s) {
  let h = '<div class="grid grid-4">'
    + stat('月度计划', s.plans.total, Object.keys(s.plans.byStatus).map((k) => k + ' ' + s.plans.byStatus[k]).join(' · ') || '')
    + stat('PlanItem', s.planItems.total, '其中 AD_HOC ' + s.planItems.adHoc)
    + stat('任务完成率', s.execution.available ? (s.execution.completionRate * 100).toFixed(1) + '%' : null,
      'READY+COMPLETED / 全部', '暂无内容任务')
    + stat('待裁决审核单', s.reviewCycle.openCases, 'SUBMITTED + IN_REVIEW')
    + '</div>';

  h += '<div class="card"><div class="card-head"><h2>审核周期（提交 → 裁决）</h2></div><div class="card-body">';
  if (!s.reviewCycle.available) {
    h += stateBlock('pending', { title: '审核耗时缺失', desc: s.reviewCycle.reason }).html;
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr><th>审核链</th><th>样本数</th><th>平均耗时(小时)</th><th>最长(小时)</th></tr></thead><tbody>'
      + s.reviewCycle.byType.map((r) => '<tr><td>' + esc(r.type) + '</td><td class="mono">' + r.samples + '</td>'
        + '<td class="mono">' + r.avgHours + '</td><td class="mono">' + r.maxHours + '</td></tr>').join('')
      + '</tbody></table></div>';
  }
  h += '</div></div>';

  h += '<div class="grid grid-2">'
    + '<div class="card"><div class="card-head"><h2>计划执行</h2></div><div class="card-body">'
    + kvRows([
      ['计划总数', s.plans.total],
      ['计划状态', Object.keys(s.plans.byStatus).map((k) => k + '×' + s.plans.byStatus[k]).join('、')],
      ['PlanItem 总数', s.planItems.total],
      ['临时（AD_HOC）', s.planItems.adHoc],
      ['任务总数', s.execution.tasks],
      ['已完成/待发布', s.execution.readyOrDone]
    ])
    + '</div></div>'
    + '<div class="card"><div class="card-head"><h2>延期</h2></div><div class="card-body">'
    + kvRows([
      ['逾期未完成任务', s.overdue.tasks],
      ['逾期未发布排期', s.overdue.schedules]
    ])
    + (s.overdue.items.length
      ? '<div class="table-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>任务</th><th>截止</th><th>状态</th></tr></thead><tbody>'
        + s.overdue.items.map((i) => '<tr><td class="small">' + esc(i.code) + ' ' + esc(i.title) + '</td>'
          + '<td class="small mono">' + esc(i.due) + '</td><td class="small">' + esc(i.status) + '</td></tr>').join('')
        + '</tbody></table></div>'
      : '<div class="callout ok" style="margin-top:8px">当前没有逾期项。</div>')
    + '</div></div></div>';
  return h;
}

function renderAiCost(s) {
  const j = s.jobs, c = s.cost;
  let h = '<div class="grid grid-4">'
    + stat('生成作业', j.total, '其中 MOCK ' + j.mock)
    + stat('成功率', j.successRate === null ? null : (j.successRate * 100).toFixed(1) + '%', 'SUCCEEDED / 已结束')
    + stat('平均耗时(小时)', j.avgHours, '样本 ' + j.durationSamples)
    + stat('可核费用', c.available ? c.byCurrency.map((x) => x.amount + ' ' + x.currency).join(' / ') : null,
      '仅供应商确认金额', c.reason)
    + '</div>';

  h += '<div class="card"><div class="card-head"><h2>作业状态 / 类型 / 供应商</h2></div><div class="card-body">'
    + '<div class="grid grid-3">'
    + '<div><div class="small muted" style="margin-bottom:4px">状态</div>' + kvRows(Object.keys(j.byStatus).sort().map((k) => [k, j.byStatus[k]])) + '</div>'
    + '<div><div class="small muted" style="margin-bottom:4px">类型</div>' + kvRows(Object.keys(j.byKind).sort().map((k) => [k, j.byKind[k]])) + '</div>'
    + '<div><div class="small muted" style="margin-bottom:4px">供应商</div>' + kvRows(Object.keys(j.byProvider).sort().map((k) => [k, j.byProvider[k]])) + '</div>'
    + '</div></div></div>';

  h += '<div class="card"><div class="card-head"><h2>成本与预算</h2></div><div class="card-body">'
    + (c.available
      ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>币种</th><th>金额</th><th>作业数</th></tr></thead><tbody>'
        + c.byCurrency.map((x) => '<tr><td>' + esc(x.currency) + '</td><td class="mono">' + x.amount + '</td><td class="mono">' + x.jobs + '</td></tr>').join('')
        + '</tbody></table></div>'
      : stateBlock('pending', { title: '费用缺失', desc: c.reason + '。按 04 §5 不做估算、不做汇率换算。' }).html)
    + '<div style="margin-top:10px">'
    + kvRows([
      ['无确认费用的作业', c.jobsWithoutConfirmedCost],
      ['品牌月度预算(USD)', s.budget.brandMonthlyUsd],
      ['单任务上限(USD)', s.budget.perJobUsdMax],
      ['文本模型', s.providers.textProvider.mode + (s.providers.textProvider.configured ? '' : '（未配置）')],
      ['图像模型', s.providers.imageProvider.mode + (s.providers.imageProvider.configured ? '' : '（未配置）')]
    ])
    + '</div></div></div>';
  return h;
}

/* ---------------- 主渲染 ---------------- */

function head(ctx) {
  const md = data && data.missing ? data.missing : [];
  return '<div class="page-head"><div class="crumb">运营分析中心 / 运营分析</div>'
    + '<div class="ph-row"><h1>运营分析</h1>'
    + '<span class="pill">当前品牌 ' + esc(ctx.brand) + '</span>'
    + '<span class="pill">数据源：本库真实记录</span>'
    + '<div class="ph-actions"><button class="btn btn-sm btn-primary" id="anRefresh2">刷新</button></div></div>'
    + '<div class="ph-desc">' + esc(data ? data.scopeNote : '') + '</div></div>'
    + (md.length
      ? '<div class="callout warn"><b>缺失项 ' + md.length + ' 条（不使用占位数字）：</b><ul style="margin:6px 0 0 18px">'
        + md.map((m) => '<li>' + esc(m) + '</li>').join('') + '</ul></div>'
      : '');
}

function body() {
  const s = data.sections;
  if (tab === 'content') return renderContent(s.content);
  if (tab === 'channels') return renderChannels(s.channels);
  if (tab === 'operations') return renderOperations(s.operations);
  return renderAiCost(s.aiCost);
}

async function load() {
  const ctx = ctxRef;
  const q = tab === 'aiCost' ? 'aicost' : tab;
  const r = await api.get(withBrand('/api/mos/analytics', ctx.brand, { section: 'all' }));
  data = r;
  // 渠道指标录入需要发布记录
  if (tab === 'channels') {
    try {
      const p = await api.get(withBrand('/api/mos/publications', ctx.brand, { pageSize: 100 }));
      pubs = p.items || [];
    } catch (_) { pubs = []; }
  }
  void q;
}

async function render() {
  const ctx = ctxRef;
  hostEl.innerHTML = loadingHtml();
  try {
    await load();
  } catch (err) {
    const s = stateBlock(err.status === 403 ? 'denied' : 'error', {
      title: err.status === 403 ? '无权查看运营分析' : '分析数据加载失败',
      desc: err.message || '未知错误',
      actions: [{ label: '重试', primary: true, onClick: () => render() }]
    });
    hostEl.innerHTML = s.html; s.bind(hostEl);
    return;
  }

  let h = head(ctx);
  h += '<div class="tabs">' + TABS.map(([k, l]) =>
    '<button data-tab="' + k + '" class="' + (tab === k ? 'on' : '') + '" id="anTab-' + k + '">' + esc(l) + '</button>').join('') + '</div>';
  h += '<div id="anBody">' + body() + '</div>';
  hostEl.innerHTML = h;

  hostEl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
    if (busy) return;
    tab = b.dataset.tab;
    await render();
  }));
  ['anRefresh', 'anRefresh2'].forEach((id) => {
    const el = hostEl.querySelector('#' + id);
    if (el) el.addEventListener('click', () => render());
  });
  hostEl.querySelectorAll('[data-metric]').forEach((b) => b.addEventListener('click', () => metricDialog(b.dataset.metric)));
}

function metricDialog(pubId) {
  const pub = pubs.find((p) => p.id === pubId);
  openModal({
    title: '录入渠道指标',
    okText: '提交并落盘',
    body: '<div class="callout info">对 <b>' + esc(pub ? pub.versionCode + ' · ' + pub.channelLabel : pubId) + '</b> 录入指标。'
      + '必须带来源与统计时点；未接通的平台 API 不会被伪造。</div>'
      + '<label class="field"><span>指标名（如 impressions / engagements / clicks）</span><input id="mtName" placeholder="impressions"></label>'
      + '<label class="field"><span>数值</span><input id="mtVal" type="number" step="any" value="0"></label>'
      + '<label class="field"><span>来源</span><select id="mtSrc"><option value="MANUAL">人工录入</option>'
      + '<option value="API">平台 API</option><option value="IMPORT">导入文件</option></select></label>'
      + '<label class="field"><span>统计时点（YYYY-MM-DD）</span><input id="mtAsOf" type="date" value="' + new Date().toISOString().slice(0, 10) + '"></label>'
      + '<label class="field"><span>凭据 / 出处（可选）</span><input id="mtProof" placeholder="后台截图链接或说明"></label>',
    onOk: async (b) => {
      const metric = b.querySelector('#mtName').value.trim();
      const amount = Number(b.querySelector('#mtVal').value);
      const sourceKind = b.querySelector('#mtSrc').value;
      const asOf = b.querySelector('#mtAsOf').value;
      if (!metric) { toast('请填写指标名', 'err'); return false; }
      if (!Number.isFinite(amount)) { toast('数值非法', 'err'); return false; }
      if (!asOf) { toast('请选择统计时点', 'err'); return false; }
      try {
        await api.post('/api/mos/publications/' + pubId + '/metrics', {
          metric, amount, sourceKind, asOf, proofRef: b.querySelector('#mtProof').value.trim()
        });
        toast('指标已落盘', 'ok');
        await render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; tab = 'content'; pubs = []; await render(); },
  unmount() { hostEl = null; data = null; pubs = []; busy = false; },
  hasUnsaved() { return false; }
};
