/* W02-04 Brand Reference Library —— 已批准可复用资产的受控引用。
 * 真实企业资料库未接通时**恒为空**，并明确标注 MOCK；绝不伪造"已批准资产"。 */
import { api, withBrand } from '../api.js';
import { esc, loadingHtml, stateBlock, toast } from '../ui.js';

let ctxRef = null; let hostEl = null;

function head() {
  return '<div class="page-head"><div class="crumb">Brand Center / Reference Library</div>'
    + '<div class="ph-row"><h1>Reference Library</h1><span class="badge badge-neutral">只读</span></div>'
    + '<div class="ph-desc">只引用**已批准且授权范围内**的可复用资产（library.asset.read）。</div></div>';
}

async function render(q) {
  const ctx = ctxRef;
  hostEl.innerHTML = head() + loadingHtml();
  let data;
  try { data = await api.get(withBrand('/api/mos/library/approved', ctx.brand, { q: q || '' })); }
  catch (err) {
    const s = stateBlock(err.status === 403 ? 'denied' : 'error', {
      title: err.status === 403 ? '无权检索已批准资产' : '加载失败', desc: err.message,
      actions: err.status === 403 ? [] : [{ label: '重试', primary: true, onClick: () => render(q) }]
    });
    hostEl.innerHTML = head() + s.html; s.bind(hostEl); return;
  }

  let html = head();
  html += '<div class="callout mock">' + esc(data.note) + '</div>';
  html += '<div class="filters"><input type="search" id="rq" placeholder="检索已批准资产…" value="' + esc(q || '') + '">'
    + '<button class="btn" id="rgo">检索</button>'
    + '<span class="badge badge-mock">MOCK 资料库</span>'
    + '<span class="pill">品牌 ' + esc(data.brandName || data.brandCode) + '</span></div>';

  html += '<div class="card"><div class="card-head"><h2>检索结果</h2><div class="ch-actions"><span class="badge badge-neutral">'
    + (data.items || []).length + '</span></div></div><div class="card-body">'
    + stateBlock('pending', {
      title: '当前无可引用的正式资产',
      desc: '企业资料库（LibraryGateway）真实接口尚未审计接通（06 §1）。为避免误用，MOCK 模式下**不返回任何资产**；接通后此处将按权限展示已批准资产与版次。'
    }).html
    + '</div></div>';

  hostEl.innerHTML = html;
  const go = () => render(hostEl.querySelector('#rq').value.trim());
  hostEl.querySelector('#rgo').addEventListener('click', go);
  hostEl.querySelector('#rq').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}
void toast;

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(''); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
