/* 公共 Campaign 组件（M-03 / F-05 / A-02）—— Campaigns 页与 VFIB / U CARD 营销工作区
 * **共用同一套** Campaign 列表 / 详情 / 关联 / 交付与进展视图，避免复制两份 Campaign 逻辑。
 *
 * 硬边界：
 *   - 营销工作区只是"已选品牌下的过滤 + 模板视图"，不新增 Campaign API（02 §2）；
 *   - Marketing Brief 为结构化表单，嵌入 Campaign（不另建重复记录）；
 *     产品宣称与已核准产品资料引用由**服务端计算**核验状态，未核验则不得用于正式输出；
 *   - Deliverables 复用 ContentTask（components/taskkit.js），不复制任务表；
 *   - 不含 CRM / 获客漏斗 / 线索移交（MARK-S05 / MARK-LEAD 明令禁止）。
 */
import { api, withBrand } from '../api.js';
import { esc, toast, openDrawer, openModal, statusBadge, demoBadge, fmtDate, stateBlock, loadingHtml } from '../ui.js';
import { fetchTasks, taskTable, bindTaskRows, openCreateTaskDialog } from './taskkit.js';

export const CAMPAIGN_STATES = ['DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED'];
export const CAMPAIGN_STATE_LABELS = { DRAFT: '草稿', ACTIVE: '进行中', PAUSED: '暂停', COMPLETED: '已完成', CANCELLED: '已取消' };

/* ---------------- API 客户端（唯一入口） ---------------- */

export function fetchCampaigns(brand, filters) {
  const f = filters || {};
  return api.get(withBrand('/api/mos/campaigns', brand, { state: f.state || '', pageSize: f.pageSize || 200 }));
}
export function fetchCampaign(id) { return api.get('/api/mos/campaigns/' + id); }
export function updateCampaign(id, patch) { return api.put('/api/mos/campaigns/' + id, patch); }
export function linkPlan(campaignId, planId) { return api.post('/api/mos/campaigns/' + campaignId + '/link-plan', { planId }); }
export function unlinkPlan(campaignId, planId) { return api.post('/api/mos/campaigns/' + campaignId + '/unlink-plan', { planId }); }
export function linkTopic(campaignId, topicId) { return api.post('/api/mos/campaigns/' + campaignId + '/link-topic', { topicId }); }
export function unlinkTopic(campaignId, topicId) { return api.del('/api/mos/campaigns/' + campaignId + '/link-topic/' + topicId); }
export function fetchCampaignResults(id) { return api.get('/api/mos/campaigns/' + id + '/results'); }
export function fetchBriefTemplates(brand) { return api.get(withBrand('/api/mos/marketing/brief-templates', brand)); }

/* ---------------- 展示片段 ---------------- */

export function campaignProgressHtml(p) {
  const g = p || {};
  const cell = (label, n) => '<div class="card"><div class="card-body" style="padding:10px 12px">'
    + '<div class="small muted">' + esc(label) + '</div>'
    + '<div style="font-size:19px;font-weight:600">' + (n || 0) + '</div></div></div>';
  return '<div class="grid grid-4">'
    + cell('任务总数', g.tasks) + cell('制作/审核中', g.inProduction)
    + cell('待发布', g.ready) + cell('已完成', g.completed) + '</div>';
}

export function briefSummaryHtml(c) {
  const b = (c && c.marketingBrief) || {};
  const cs = b.claimSummary || { total: 0, verified: 0, unverified: 0 };
  const ready = b.readyForOfficialUse;
  return '<div class="callout ' + (ready ? 'ok' : 'warn') + '">'
    + '正式输出可用性：<b>' + (ready ? '可用' : '受阻') + '</b>'
    + (ready ? '' : '（存在 ' + cs.unverified + ' 条未核验产品宣称）')
    + ' · 模板 ' + esc(b.templateCode || '—')
    + (b.isTemplate ? ' <span class="badge badge-neutral">模板默认</span>' : '') + '</div>';
}

function claimRowsHtml(claims) {
  const kindOpts = (sel) => ['', 'KNOWLEDGE', 'EVIDENCE', 'LIBRARY'].map((k) =>
    '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + (k || '选择来源类型') + '</option>').join('');
  return (claims || []).map((c, i) => '<div class="claim-row" data-claim-row style="border:1px solid var(--border-soft);border-radius:7px;padding:8px;margin-bottom:6px">'
    + '<div class="row between"><span class="small muted">宣称 #' + (i + 1) + ' · ' + esc(c.verification || 'UNVERIFIED') + '</span>'
    + '<button type="button" class="btn-link" data-del-claim>移除</button></div>'
    + '<textarea class="claim-text" style="min-height:52px;width:100%" placeholder="宣称内容（不得承诺费用/收益/可用国家/发卡能力）">' + esc(c.text || '') + '</textarea>'
    + '<div class="row" style="gap:6px;margin-top:5px">'
    + '<select class="claim-kind" style="max-width:180px">' + kindOpts(c.sourceKind) + '</select>'
    + '<input class="claim-ref" placeholder="已核准来源 ID" value="' + esc(c.sourceRef || '') + '">'
    + '</div>'
    + (c.reason ? '<div class="small diff-warn">' + esc(c.reason) + '</div>' : '')
    + '</div>').join('');
}

function refRowsHtml(refs) {
  const kindOpts = (sel) => ['', 'LIBRARY', 'KNOWLEDGE', 'EVIDENCE'].map((k) =>
    '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + (k || '选择类型') + '</option>').join('');
  return (refs || []).map((r, i) => '<div class="ref-row" data-ref-row style="border:1px solid var(--border-soft);border-radius:7px;padding:8px;margin-bottom:6px">'
    + '<div class="row between"><span class="small muted">引用 #' + (i + 1) + ' · ' + esc(r.verification || 'UNVERIFIED') + '</span>'
    + '<button type="button" class="btn-link" data-del-ref>移除</button></div>'
    + '<div class="row" style="gap:6px">'
    + '<select class="ref-kind" style="max-width:160px">' + kindOpts(r.sourceKind) + '</select>'
    + '<input class="ref-id" placeholder="已批准资料/知识条目 ID" value="' + esc(r.refId || '') + '">'
    + '<input class="ref-label" placeholder="说明" value="' + esc(r.label || '') + '">'
    + '</div>'
    + (r.reason ? '<div class="small diff-warn">' + esc(r.reason) + '</div>' : '')
    + '</div>').join('');
}

/* ---------------- Campaign 详情抽屉（分标签） ---------------- */

export async function openCampaignDetail(opts) {
  const o = opts || {};
  const brand = o.brand;
  const dr = openDrawer({ title: 'Campaign' });
  let tab = o.tab || 'brief';
  let data = null;
  let results = null;

  async function load() {
    data = await fetchCampaign(o.id);
    results = null;
    return data;
  }

  async function paint() {
    const c = data.campaign;
    const tabs = [['brief', 'Marketing Brief'], ['deliverables', 'Deliverables'], ['schedule', 'Schedule'], ['assets', 'Assets'], ['results', 'Progress & Results']];
    let html = '<div class="row between"><strong>' + esc(c.title) + '</strong> ' + demoBadge(c.demo) + '<div>' + statusBadge(c.state) + '</div></div>';
    html += '<div class="small muted mono" style="margin-top:4px">' + esc(c.code) + ' · ' + esc(c.brandCode) + ' · 负责人 ' + esc(c.ownerName) + '</div>';
    html += '<div class="tabs" style="margin-top:10px">' + tabs.map(([k, l]) =>
      '<button type="button" data-ctab="' + k + '" class="' + (tab === k ? 'on' : '') + '">' + esc(l) + '</button>').join('') + '</div>';
    html += '<div id="campTab">' + loadingHtml() + '</div>';
    dr.body.innerHTML = html;
    dr.body.querySelectorAll('[data-ctab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.ctab; paint(); }));
    await paintTab(c);
    if (o.onRendered) o.onRendered(dr, c);
  }

  async function paintTab(c) {
    const host = dr.body.querySelector('#campTab');
    if (tab === 'brief') host.innerHTML = briefTabHtml(c);
    else if (tab === 'deliverables') host.innerHTML = await deliverablesTabHtml(c);
    else if (tab === 'schedule') host.innerHTML = scheduleTabHtml(c);
    else if (tab === 'assets') host.innerHTML = assetsTabHtml(c);
    else host.innerHTML = await resultsTabHtml(c);
    bindTab(c, host);
  }

  function briefTabHtml(c) {
    const b = c.marketingBrief || {};
    return briefSummaryHtml(c)
      + '<div class="callout info" style="white-space:pre-wrap">' + esc(c.brief || '（项目 Brief 未填写）') + '</div>'
      + '<h3 style="margin:12px 0 6px">结构化 Marketing Brief</h3>'
      + '<label class="field"><span>目标（每行一条）</span><textarea id="mbObj" style="min-height:64px">' + esc((b.objectives || []).join('\n')) + '</textarea></label>'
      + '<label class="field"><span>受众</span><input id="mbAud" value="' + esc(b.audience || '') + '"></label>'
      + '<label class="field"><span>核心信息</span><textarea id="mbCore" style="min-height:56px">' + esc(b.coreMessage || '') + '</textarea></label>'
      + '<label class="field"><span>地域合规提醒</span><textarea id="mbComp" style="min-height:56px">' + esc(b.regionComplianceNote || '') + '</textarea></label>'
      + '<label class="field"><span>执行人员（逗号分隔）</span><input id="mbExec" value="' + esc((b.executors || []).join('，')) + '"></label>'
      + '<div class="row" style="gap:8px"><label class="field" style="flex:1"><span>开始</span><input id="mbS" type="date" value="' + esc(b.startAt || '') + '"></label>'
      + '<label class="field" style="flex:1"><span>结束</span><input id="mbE" type="date" value="' + esc(b.endAt || '') + '"></label></div>'
      + '<div class="row between"><h3 style="margin:12px 0 6px">已核准产品资料引用</h3>'
      + '<button type="button" class="btn btn-sm" id="mbAddRef">添加引用</button></div>'
      + '<div id="mbRefs">' + refRowsHtml(b.productRefs) + '</div>'
      + '<div class="row between"><h3 style="margin:12px 0 6px">产品宣称（必须关联已核准来源）</h3>'
      + '<button type="button" class="btn btn-sm" id="mbAddClaim">添加宣称</button></div>'
      + '<div id="mbClaims">' + claimRowsHtml(b.productClaims) + '</div>'
      + '<div class="hint">未关联来源或来源未核验的宣称会被服务端标记 UNVERIFIED，Brief 将<b>不可用于正式输出</b>；MOCK 知识库/资料库下无法被标为已核验。</div>'
      + '<div class="row" style="margin-top:10px"><button type="button" class="btn btn-primary btn-sm" id="mbSave"' + (c.can.manage ? '' : ' disabled title="缺少 campaign.manage"') + '>保存 Brief</button></div>';
  }

  async function deliverablesTabHtml(c) {
    let t;
    try { t = await fetchTasks(c.brandCode, { campaignId: c.id }); } catch (_) { t = { items: [] }; }
    return '<div class="row between"><h3>交付清单（ContentTask · 共享对象）</h3>'
      + '<button type="button" class="btn btn-sm btn-primary" id="dvNewTask"' + (c.can.manage ? '' : ' disabled') + '>新建交付任务（预填 Campaign）</button></div>'
      + '<div class="hint">任务级交付情况与「All Tasks」「Master Topic → Deliverables」为<b>同一对象</b>；发布登记在「发布中心」。系统不自动发布。</div>'
      + '<div class="card-body" style="padding:0;margin-top:8px">'
      + taskTable(t.items || [], { emptyTitle: '该 Campaign 暂无交付任务', emptyDesc: '点击右上角新建，将自动预填品牌与 Campaign 关联。' })
      + '</div>';
  }

  function scheduleTabHtml(c) {
    return '<div class="row between"><h3>关联月度计划（' + c.plans.length + '）</h3>'
      + (c.can.manage ? '<button type="button" class="btn btn-sm" id="scLinkPlan">关联计划</button>' : '') + '</div>'
      + (c.plans.length
        ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>计划号</th><th>标题</th><th>状态</th><th></th></tr></thead><tbody>'
          + c.plans.map((p) => '<tr><td class="mono">' + esc(p.code) + '</td><td>' + esc(p.title) + '</td><td>' + statusBadge(p.status) + '</td>'
            + '<td class="actions">' + (c.can.manage ? '<button class="btn-link" data-unlink-plan="' + esc(p.id) + '">解除</button>' : '') + '</td></tr>').join('')
          + '</tbody></table></div>'
        : '<div class="hint">未关联月度计划（跨月 Campaign 可用多个计划链接，不重复创建 Campaign）。</div>')
      + '<div class="callout info" style="margin-top:10px">时间窗口：' + esc(fmtDate(c.startAt)) + ' ~ ' + esc(fmtDate(c.endAt))
      + '。排期/发布日历是 PlanItem 与 PublishingSchedule 的**投影**，不另建重复内容表（M-04）；改期保留审计历史。</div>';
  }

  function assetsTabHtml(c) {
    return '<div class="row between"><h3>关联 Master Topic（' + c.topics.length + '）</h3>'
      + (c.can.manage ? '<button type="button" class="btn btn-sm" id="asLinkTopic">关联 Topic</button>' : '') + '</div>'
      + (c.topics.length
        ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>标题</th><th>栏目</th><th>状态</th><th></th></tr></thead><tbody>'
          + c.topics.map((t) => '<tr><td>' + esc(t.title) + '</td><td class="mono">' + esc(t.pillarCode) + '</td><td>' + statusBadge(t.state) + '</td>'
            + '<td class="actions">' + (c.can.manage ? '<button class="btn-link" data-unlink-topic="' + esc(t.id) + '">解除</button>' : '') + '</td></tr>').join('')
          + '</tbody></table></div>'
        : '<div class="hint">未关联 Topic。</div>')
      + '<div class="callout mock" style="margin-top:10px">复用资产须走「入库申请 → 最终审批 → 资料库同步」；'
      + '已发布内容不会自动进入企业资料库（00 §1 / 03 §2.4）。</div>';
  }

  async function resultsTabHtml(c) {
    let r;
    try { r = await fetchCampaignResults(c.id); } catch (_) { r = null; }
    if (!r || !r.available) return stateBlock('pending', { title: '结果不可用', desc: (r && (r.missing || []).join('；')) || '未获取到真实聚合数据。' }).html;
    let h = campaignProgressHtml(c.progress);
    h += '<div class="grid grid-2" style="margin-top:10px">';
    h += '<div class="card"><div class="card-head"><h2>任务状态分布</h2></div><div class="card-body">'
      + Object.keys(r.tasks.byStatus).map((k) => '<div class="checkline"><span class="ck">•</span><span>' + esc(k) + '：<b>' + r.tasks.byStatus[k] + '</b></span></div>').join('')
      + '</div></div>';
    h += '<div class="card"><div class="card-head"><h2>发布记录</h2><span class="pill">' + r.publications.total + '</span></div><div class="card-body">'
      + (r.publications.total
        ? r.publications.latest.map((p) => '<div class="checkline"><span class="ck">•</span><span class="mono small">' + esc(p.id) + '</span> '
          + esc(p.status) + ' · ' + esc(fmtDate(p.actualAt)) + ' ' + (p.url ? '<a href="' + esc(p.url) + '" target="_blank" rel="noopener noreferrer">链接</a>' : '')
          + '</span></div>').join('')
        : '<div class="hint">该 Campaign 下的内容尚无人工登记的发布记录。</div>')
      + '</div></div>';
    h += '</div>';
    h += '<div class="card" style="margin-top:10px"><div class="card-head"><h2>渠道表现指标</h2>'
      + '<span class="badge badge-mock">NOT CONFIGURED</span></div><div class="card-body">'
      + stateBlock('pending', { title: '渠道表现指标不可用', desc: (r.performance.missing || []).join('；') }).html
      + '</div></div>';
    return h;
  }

  function bindTab(c, host) {
    const bindTabBtns = () => {};
    bindTabBtns();
    // Brief 编辑
    const mbAddClaim = host.querySelector('#mbAddClaim');
    if (mbAddClaim) mbAddClaim.addEventListener('click', () => {
      host.querySelector('#mbClaims').insertAdjacentHTML('beforeend', claimRowsHtml([{}]));
      bindClaimDeletes(host);
    });
    const mbAddRef = host.querySelector('#mbAddRef');
    if (mbAddRef) mbAddRef.addEventListener('click', () => {
      host.querySelector('#mbRefs').insertAdjacentHTML('beforeend', refRowsHtml([{}]));
      bindRefDeletes(host);
    });
    bindClaimDeletes(host); bindRefDeletes(host);
    const mbSave = host.querySelector('#mbSave');
    if (mbSave) mbSave.addEventListener('click', async () => {
      const claims = [];
      host.querySelectorAll('[data-claim-row]').forEach((row) => {
        const text = row.querySelector('.claim-text').value.trim();
        if (text) claims.push({ text, sourceKind: row.querySelector('.claim-kind').value, sourceRef: row.querySelector('.claim-ref').value.trim() });
      });
      const refs = [];
      host.querySelectorAll('[data-ref-row]').forEach((row) => {
        const refId = row.querySelector('.ref-id').value.trim();
        if (refId) refs.push({ refId, sourceKind: row.querySelector('.ref-kind').value, label: row.querySelector('.ref-label').value.trim() });
      });
      const patch = {
        marketingBrief: {
          templateCode: (c.marketingBrief || {}).templateCode || '',
          objectives: host.querySelector('#mbObj').value.split('\n').map((s) => s.trim()).filter(Boolean),
          audience: host.querySelector('#mbAud').value,
          coreMessage: host.querySelector('#mbCore').value,
          regionComplianceNote: host.querySelector('#mbComp').value,
          executors: host.querySelector('#mbExec').value.split(/[,，\n]/).map((s) => s.trim()).filter(Boolean),
          startAt: host.querySelector('#mbS').value || null,
          endAt: host.querySelector('#mbE').value || null,
          productClaims: claims,
          productRefs: refs
        }
      };
      try { await updateCampaign(c.id, patch); toast('Marketing Brief 已保存（核验状态由服务端重算）', 'ok'); await load(); await paint(); if (o.onChanged) o.onChanged(); }
      catch (err) { toast(err.message, 'err'); }
    });

    // Deliverables
    const dvNew = host.querySelector('#dvNewTask');
    if (dvNew) dvNew.addEventListener('click', () => openCreateTaskDialog({
      brand: c.brandCode, meta: o.meta,
      prefill: { campaignId: c.id, campaignTitle: c.title, title: c.title + ' · 交付' },
      onCreated: async () => { await load(); await paint(); if (o.onChanged) o.onChanged(); }
    }));
    bindTaskRows(host, async () => { await load(); await paint(); if (o.onChanged) o.onChanged(); });

    // Schedule / Assets 关联
    const scLink = host.querySelector('#scLinkPlan');
    if (scLink) scLink.addEventListener('click', async () => {
      let plans;
      try { plans = await api.get(withBrand('/api/mos/plans', c.brandCode, { pageSize: 200 })); } catch (_) { plans = { items: [] }; }
      if (!plans.items.length) { toast('当前品牌没有可关联的计划', 'err'); return; }
      openModal({
        title: '关联月度计划', okText: '关联',
        body: '<label class="field"><span>计划</span><select id="lpS">'
          + plans.items.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.code) + ' · ' + esc(p.title) + '</option>').join('')
          + '</select></label><div class="hint">仅可选择同一品牌（' + esc(c.brandCode) + '）的计划。</div>',
        onOk: async (b) => {
          try { await linkPlan(c.id, b.querySelector('#lpS').value); toast('已关联计划', 'ok'); await load(); await paint(); if (o.onChanged) o.onChanged(); }
          catch (err) { toast(err.message, 'err'); return false; }
        }
      });
    });
    host.querySelectorAll('[data-unlink-plan]').forEach((b) => b.addEventListener('click', async () => {
      try { await unlinkPlan(c.id, b.dataset.unlinkPlan); toast('已解除关联', 'ok'); await load(); await paint(); if (o.onChanged) o.onChanged(); }
      catch (err) { toast(err.message, 'err'); }
    }));
    const asLink = host.querySelector('#asLinkTopic');
    if (asLink) asLink.addEventListener('click', async () => {
      let topics;
      try { topics = await api.get(withBrand('/api/mos/topics', c.brandCode, { pageSize: 200 })); } catch (_) { topics = { items: [] }; }
      if (!topics.items.length) { toast('当前品牌没有可关联的 Topic', 'err'); return; }
      openModal({
        title: '关联 Master Topic', okText: '关联',
        body: '<label class="field"><span>Topic</span><select id="ltS">'
          + topics.items.map((t) => '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>').join('')
          + '</select></label><div class="hint">跨品牌关联会被服务端拒绝（BRAND_MISMATCH）。</div>',
        onOk: async (b) => {
          try { await linkTopic(c.id, b.querySelector('#ltS').value); toast('已关联 Topic', 'ok'); await load(); await paint(); if (o.onChanged) o.onChanged(); }
          catch (err) { toast(err.message, 'err'); return false; }
        }
      });
    });
    host.querySelectorAll('[data-unlink-topic]').forEach((b) => b.addEventListener('click', async () => {
      try { await unlinkTopic(c.id, b.dataset.unlinkTopic); toast('已解除关联', 'ok'); await load(); await paint(); if (o.onChanged) o.onChanged(); }
      catch (err) { toast(err.message, 'err'); }
    }));
  }

  function bindClaimDeletes(host) {
    host.querySelectorAll('[data-del-claim]').forEach((b) => { b.onclick = () => { const r = b.closest('[data-claim-row]'); if (r) r.remove(); }; });
  }
  function bindRefDeletes(host) {
    host.querySelectorAll('[data-del-ref]').forEach((b) => { b.onclick = () => { const r = b.closest('[data-ref-row]'); if (r) r.remove(); }; });
  }

  try { await load(); await paint(); }
  catch (err) { dr.body.innerHTML = '<div class="callout danger">' + esc(err.message) + '</div>'; }
}

/* ---------------- Campaign 列表表格（两处入口共用） ---------------- */

export function campaignTableHtml(items) {
  if (!items || !items.length) {
    return stateBlock('empty', { title: '该品牌尚无 Campaign', desc: '创建 Campaign 后可关联 Master Topic 与月度计划。' }).html;
  }
  return '<div class="table-wrap"><table class="tbl"><thead><tr>'
    + '<th>编号</th><th>标题</th><th>状态</th><th>窗口</th><th>计划</th><th>Topic</th><th>任务</th><th>Brief</th><th>负责人</th><th></th></tr></thead><tbody>'
    + items.map((c) => '<tr>'
      + '<td class="mono">' + esc(c.code) + '</td>'
      + '<td>' + esc(c.title) + ' ' + demoBadge(c.demo) + '</td>'
      + '<td>' + statusBadge(c.state) + '</td>'
      + '<td class="small muted">' + esc(fmtDate(c.startAt)) + ' ~ ' + esc(fmtDate(c.endAt)) + '</td>'
      + '<td>' + c.plans.length + '</td><td>' + c.topics.length + '</td><td>' + c.taskCount + '</td>'
      + '<td>' + ((c.marketingBrief && c.marketingBrief.readyForOfficialUse)
        ? '<span class="badge badge-ok">可正式输出</span>' : '<span class="badge badge-warn">待核验宣称</span>') + '</td>'
      + '<td class="small">' + esc(c.ownerName) + '</td>'
      + '<td class="actions"><button class="btn btn-sm" data-open-camp="' + esc(c.id) + '">打开</button></td></tr>').join('')
    + '</tbody></table></div>';
}

export function bindCampaignRows(el, onOpen) {
  el.querySelectorAll('[data-open-camp]').forEach((b) => b.addEventListener('click', () => onOpen(b.dataset.openCamp)));
}

export function newCampaignDialog(opts) {
  const o = opts || {};
  openModal({
    title: o.title || '新建 Campaign',
    okText: '创建（DRAFT）',
    body: '<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px"><span class="pill">品牌 ' + esc(o.brand || '') + '</span>'
      + (o.templateCode ? '<span class="pill">模板 ' + esc(o.templateCode) + '</span>' : '') + '</div>'
      + '<label class="field"><span>标题</span><input id="ncT" type="text"></label>'
      + '<label class="field"><span>开始时间</span><input id="ncS" type="date"></label>'
      + '<label class="field"><span>结束时间</span><input id="ncE" type="date"></label>'
      + '<label class="field"><span>项目 Brief</span><textarea id="ncB" placeholder="目标、受众、约束、禁用宣称等"></textarea></label>'
      + '<div class="hint">不得在其中承诺未经核准的费用、可用国家、发卡能力或收益（10 §2 S04 边界）。'
      + '创建后可在详情内填写结构化 Marketing Brief。</div>',
    onOk: async (b) => {
      try {
        await api.post(withBrand('/api/mos/campaigns', o.brand), {
          title: b.querySelector('#ncT').value,
          startAt: b.querySelector('#ncS').value || null,
          endAt: b.querySelector('#ncE').value || null,
          brief: b.querySelector('#ncB').value,
          marketingBrief: o.templateCode ? { templateCode: o.templateCode } : undefined
        });
        toast('Campaign 已创建', 'ok');
        if (o.onCreated) await o.onCreated();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}
