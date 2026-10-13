/* W03-02 / W06-01 / W06-02 Campaigns —— 项目 Brief、Marketing Brief、Plan/Topic 关联与进展。
 *
 * M-03 / F-05：本页与 VFIB / U CARD 营销工作区共用 `components/campaignkit.js`
 * —— Campaign 列表 / 详情 / 关联 / 交付 / 进展只有一份实现。
 */
import { esc, loadingHtml, stateBlock } from '../ui.js';
import {
  CAMPAIGN_STATES, fetchCampaigns, campaignTableHtml, bindCampaignRows, openCampaignDetail, newCampaignDialog
} from '../components/campaignkit.js';

let ctxRef = null; let hostEl = null;
let stateFilter = '';

function head(ctx) {
  return '<div class="page-head"><div class="crumb">Marketing Center / Campaigns</div>'
    + '<div class="ph-row"><h1>Campaigns</h1>'
    + '<div class="ph-actions"><button class="btn btn-sm btn-primary" id="newCamp">新建 Campaign</button></div></div>'
    + '<div class="ph-desc">品牌空间隔离：' + esc(ctx.brand) + ' 的 Campaign 不与其他品牌混用。'
    + 'Campaign 可与多个月度计划、多个 Master Topic 多对多关联，且**禁止跨品牌**关联。'
    + 'Marketing Brief 为结构化表单（产品宣称须关联已核准来源）。</div></div>';
}

function bodyEl() { return hostEl.querySelector('#mosBody') || hostEl; }
function setBody(html) { bodyEl().innerHTML = html; }

async function render() {
  const ctx = ctxRef;
  hostEl.innerHTML = head(ctx) + '<div id="mosBody">' + loadingHtml() + '</div>';
  let data;
  try { data = await fetchCampaigns(ctx.brand, { state: stateFilter }); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', {
      title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message,
      actions: [{ label: '重试', primary: true, onClick: render }]
    });
    setBody(s.html); s.bind(bodyEl()); return;
  }

  let html = '<div class="filters">'
    + '<select id="cs"><option value="">全部状态</option>' + CAMPAIGN_STATES.map((s) =>
      '<option value="' + s + '"' + (stateFilter === s ? ' selected' : '') + '>' + esc(s) + '</option>').join('') + '</select>'
    + '<button class="btn btn-sm" id="cgo">筛选</button>'
    + '<span class="pill">共 ' + data.total + '</span></div>';

  html += '<div class="card"><div class="card-head"><h2>Campaign 列表</h2></div><div class="card-body tight">'
    + campaignTableHtml(data.items) + '</div></div>';
  setBody(html);

  hostEl.querySelector('#cgo').addEventListener('click', () => { stateFilter = hostEl.querySelector('#cs').value; render(); });
  hostEl.querySelector('#newCamp').addEventListener('click', () => newCampaignDialog({ brand: ctx.brand, onCreated: render }));
  bindCampaignRows(hostEl, (id) => openCampaignDetail({ id, brand: ctx.brand, meta: ctx.meta, navigate: ctx.navigate, onChanged: render }));
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
