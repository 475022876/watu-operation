/* W02-04 Brand Reference Library —— 已批准可复用资产的受控引用。
 * 真实企业资料库未接通时**恒为空**，并明确标注 MOCK；绝不伪造"已批准资产"。
 *
 * M-02：与 Governance & Assets 的 Approved Assets 共用 `components/assetkit.js`
 * —— 检索、版本与授权展示只有一份实现；本页仅额外保留「品牌过滤」上下文。
 */
import { esc, loadingHtml, stateBlock } from '../ui.js';
import { fetchApprovedAssets, brandReferenceHtml, bindAssetSearch } from '../components/assetkit.js';

let ctxRef = null; let hostEl = null;

function head() {
  return '<div class="page-head"><div class="crumb">品牌中心 / 参考资料库</div>'
    + '<div class="ph-row"><h1>参考资料库</h1><span class="badge badge-neutral">只读</span></div>'
    + '<div class="ph-desc">只引用**已批准且授权范围内**的可复用资产（library.asset.read）。'
    + '与「治理与资产 → Approved Assets」共用同一检索与授权展示（M-02）。</div></div>';
}

async function render(q) {
  const ctx = ctxRef;
  hostEl.innerHTML = head() + loadingHtml();
  let data;
  try { data = await fetchApprovedAssets(ctx.brand, q); }
  catch (err) {
    const s = stateBlock(err.status === 403 ? 'denied' : 'error', {
      title: err.status === 403 ? '无权检索已批准资产' : '加载失败', desc: err.message,
      actions: err.status === 403 ? [] : [{ label: '重试', primary: true, onClick: () => render(q) }]
    });
    hostEl.innerHTML = head() + s.html; s.bind(hostEl); return;
  }

  const brandLabel = ctx.brand ? (ctx.brand + (data.brandName ? ' · ' + data.brandName : '')) : (data.brandName || '—');
  hostEl.innerHTML = head() + brandReferenceHtml(data, q, data.brandName || brandLabel);
  void esc;
  bindAssetSearch(hostEl, (val) => render(val));
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(''); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
