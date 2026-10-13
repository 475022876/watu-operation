/* W06 Marketing Workspace —— VFIB Banking Marketing / U CARD Marketing（F-05 / 02 §2）。
 *
 * 同一模块按 `ctx.module.id` 参数化，避免复制两套 Campaign API / 页面：
 *   - marketing-vfib  → 期望品牌 VFIB
 *   - marketing-ucard → 期望品牌 UCARD
 * 营销工作区 = 已选品牌下的**过滤 + 模板视图**（不新增 Campaign 实体/接口）。
 * 范围边界：不含获客漏斗、CAC、生命周期、CRM、线索移交（MARK-S05 / MARK-LEAD）。
 */
import { esc, loadingHtml, stateBlock, toast } from '../ui.js';
import {
  fetchCampaigns, campaignProgressHtml, campaignTableHtml, bindCampaignRows,
  openCampaignDetail, newCampaignDialog, fetchBriefTemplates
} from '../components/campaignkit.js';

const SCOPES = {
  'marketing-vfib': { expected: 'VFIB', label: 'VFIB Banking Marketing', sub: 'VFIB BANK 机构级银行营销工作区' },
  'marketing-ucard': { expected: 'UCARD', label: 'U CARD Marketing', sub: 'U CARD 卡产品营销工作区' }
};

let ctxRef = null; let hostEl = null;
let scope = SCOPES['marketing-vfib'];
let campaigns = [];
let template = null;
let total = 0;

function head(ctx) {
  const matched = !scope.expected || ctx.brand === scope.expected;
  let h = '<div class="page-head"><div class="crumb">Marketing Center / ' + esc(scope.label) + '</div>'
    + '<div class="ph-row"><h1>' + esc(scope.label) + '</h1>'
    + '<span class="pill">当前品牌 ' + esc(ctx.brand || '—') + '</span>'
    + '<div class="ph-actions"><button class="btn btn-sm btn-primary" id="mwNew">新建 Campaign</button>'
    + '<button class="btn btn-sm" id="mwRefresh">刷新</button></div></div>'
    + '<div class="ph-desc">' + esc(scope.sub) + '。工作区是**已选品牌下的过滤 + 模板视图**，'
    + '与 Campaigns 页共用同一 Campaign API 与详情（M-03 / F-05）；不含获客漏斗 / CRM / 线索移交。</div></div>';
  if (!matched) {
    h += '<div class="callout warn"><b>品牌不匹配。</b>本工作区对应品牌 <b>' + esc(scope.expected)
      + '</b>，当前选定品牌为 <b>' + esc(ctx.brand || '—') + '</b>。下方数据仍按当前品牌展示。'
      + '<div class="row" style="margin-top:8px"><button class="btn btn-sm btn-primary" id="mwSwitch">切换到 ' + esc(scope.expected) + '</button></div></div>';
  }
  return h;
}

function bodyEl() { return hostEl.querySelector('#mwBody') || hostEl; }
function setBody(html) { bodyEl().innerHTML = html; }

async function render() {
  const ctx = ctxRef;
  scope = SCOPES[ctx.module && ctx.module.id] || SCOPES['marketing-vfib'];
  hostEl.innerHTML = head(ctx) + '<div id="mwBody">' + loadingHtml() + '</div>';
  const sw = hostEl.querySelector('#mwSwitch');
  if (sw) sw.addEventListener('click', async () => {
    if (ctx.setBrand && ctx.setBrand(scope.expected)) { toast('已切换到品牌 ' + scope.expected, 'ok'); }
    else toast('当前账号没有该品牌范围授权', 'err');
  });
  hostEl.querySelector('#mwRefresh').addEventListener('click', render);
  hostEl.querySelector('#mwNew').addEventListener('click', () => newCampaignDialog({
    brand: ctx.brand, templateCode: template ? template.templateCode : '',
    title: '新建 Campaign · ' + scope.label, onCreated: render
  }));

  try {
    const [c, t] = await Promise.all([
      fetchCampaigns(ctx.brand, {}),
      fetchBriefTemplates(ctx.brand).catch(() => ({ template: null }))
    ]);
    campaigns = c.items || []; total = c.total || campaigns.length;
    template = t.template || null;
  } catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', {
      title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message,
      actions: [{ label: '重试', primary: true, onClick: render }]
    });
    setBody(s.html); s.bind(bodyEl()); return;
  }
  paint(ctx);
}

function paint(ctx) {
  const agg = campaigns.reduce((a, c) => {
    const p = c.progress || {};
    a.tasks += p.tasks || 0; a.inProduction += p.inProduction || 0;
    a.ready += p.ready || 0; a.completed += p.completed || 0;
    a.active += c.state === 'ACTIVE' ? 1 : 0;
    a.briefBlocked += (c.marketingBrief && !c.marketingBrief.readyForOfficialUse) ? 1 : 0;
    return a;
  }, { tasks: 0, inProduction: 0, ready: 0, completed: 0, active: 0, briefBlocked: 0 });

  let h = campaignProgressHtml({ tasks: agg.tasks, inProduction: agg.inProduction, ready: agg.ready, completed: agg.completed });

  h += '<div class="grid grid-3" style="margin:10px 0">'
    + '<div class="card"><div class="card-body" style="padding:12px 14px"><div class="small muted">Campaign 总数</div>'
    + '<div style="font-size:21px;font-weight:600">' + total + '</div><div class="small muted">进行中 ' + agg.active + '</div></div></div>'
    + '<div class="card"><div class="card-body" style="padding:12px 14px"><div class="small muted">Brief 待核验宣称</div>'
    + '<div style="font-size:21px;font-weight:600">' + agg.briefBlocked + '</div><div class="small muted">需关联已核准来源</div></div></div>'
    + '<div class="card"><div class="card-body" style="padding:12px 14px"><div class="small muted">Brief 模板</div>'
    + '<div style="font-size:14px;font-weight:600;margin-top:4px">' + esc(template ? template.templateCode : '（无品牌模板）') + '</div>'
    + '<div class="small muted">按品牌切换</div></div></div>'
    + '</div>';

  if (template) {
    h += '<div class="card"><div class="card-head"><h2>' + esc(template.label) + '</h2>'
      + '<span class="badge badge-neutral">模板（不含产品宣称）</span></div><div class="card-body">'
      + '<dl class="kv"><dt>目标</dt><dd><ul style="margin:0 0 0 16px">' + (template.objectives || []).map((o) => '<li>' + esc(o) + '</li>').join('') + '</ul></dd>'
      + '<dt>受众</dt><dd>' + esc(template.audience) + '</dd>'
      + '<dt>合规提醒</dt><dd>' + esc(template.regionComplianceNote) + '</dd></dl>'
      + '<div class="hint">模板仅提供框架字段；产品宣称须在具体 Campaign 内逐条关联已核准知识/来源。</div>'
      + '</div></div>';
  } else {
    h += '<div class="callout warn">当前品牌暂无 Marketing Brief 模板（不预置任何产品宣称）。</div>';
  }

  h += '<div class="card" style="margin-top:10px"><div class="card-head"><h2>' + esc(scope.label) + ' · Campaign</h2>'
    + '<div class="ch-actions"><span class="pill">筛选品牌 ' + esc(ctx.brand) + '</span></div></div>'
    + '<div class="card-body tight">' + campaignTableHtml(campaigns) + '</div></div>';

  setBody(h);
  bindCampaignRows(hostEl, (id) => openCampaignDetail({ id, brand: ctx.brand, meta: ctx.meta, navigate: ctx.navigate, onChanged: render }));
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; campaigns = []; template = null; },
  hasUnsaved() { return false; }
};
