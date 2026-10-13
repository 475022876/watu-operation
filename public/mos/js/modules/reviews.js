/* My Reviews —— 我的审核（W08-01 / 01 §3 三条独立审批链）。
 *
 * 关键不变量：
 *   - 三条链相互独立（专业 / 发布 / 入库），**不存在单一 approved 标志位**；
 *   - 职责分离：创建者不能审批自己创建的内容版本（服务端强制，前端提前告知）；
 *   - 审批对象是**冻结的 Manifest**：详情页同时显示冻结哈希与实时重算值，不一致即会被拒（SEC-02）；
 *   - G3 需提升授权角色。
 *
 * M-01：本页与 Governance & Assets 共用 `components/reviewkit.js` 的审核列表 / 详情 / 动作与
 * API 客户端 —— 审批状态规则**只在 reviewkit 一处维护**，两个入口不再分叉。
 */
import { loadingHtml, stateBlock } from '../ui.js';
import {
  fetchReviewCases, reviewFiltersHtml, reviewSummaryCards, bindReviewFilters,
  reviewListHtml, openReviewCase, decideReviewCase
} from '../components/reviewkit.js';

let ctxRef = null; let hostEl = null;
let filter = { type: '', mine: true, open: true };
let cases = []; let summary = {};

function bodyEl() { return hostEl.querySelector('#mosBody') || hostEl; }
function setBody(html) { bodyEl().innerHTML = html; }

function renderError(err, retry) {
  const kind = err.status === 403 || err.status === 404 ? 'denied' : 'error';
  const s = stateBlock(kind, { title: err.status === 403 ? '权限不足' : '加载失败', desc: err.message,
    actions: retry ? [{ label: '重试', primary: true, onClick: retry }] : [] });
  setBody(s.html); s.bind(bodyEl());
}

function head() {
  return '<div class="page-head"><div class="crumb">工作台 / 我的审核</div>'
    + '<div class="ph-row"><h1>我的审核</h1>'
    + '<div class="ph-actions"><button class="btn btn-sm" id="rvRefresh">刷新</button></div></div>'
    + '<div class="ph-desc">三条审批链相互独立：专业（金融事实）审核 / 发布审批 / 资产入库审核。'
    + '批准对象是冻结的 Manifest 哈希，事后改动正文或引用资产会导致审批被拒（SEC-02）。</div></div>';
}

async function render() {
  hostEl.innerHTML = head() + '<div id="mosBody">' + loadingHtml() + '</div>';
  try {
    const r = await fetchReviewCases(ctxRef.brand, filter);
    cases = r.items || []; summary = r.summary || {};
  } catch (err) { renderError(err, render); return; }
  paint();
  const rf = hostEl.querySelector('#rvRefresh');
  if (rf) rf.addEventListener('click', render);
}

function paint() {
  let h = reviewFiltersHtml(filter);
  h += '<span class="pill">共 ' + cases.length + '</span>';
  h += reviewSummaryCards(summary);
  h += '<div class="card"><div class="card-head"><h2>审核单</h2></div><div class="card-body">';
  h += reviewListHtml(cases, filter);
  h += '</div></div>';
  setBody(h);
  bind();
}

function bind() {
  hostEl.querySelectorAll('[data-open-case]').forEach((b) =>
    b.addEventListener('click', () => openReviewCase(b.dataset.openCase, ctxRef.brand)));
  hostEl.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () =>
    decideReviewCase({ caseId: b.dataset.case, brand: ctxRef.brand, action: b.dataset.dec, onDone: render })));
  bindReviewFilters(hostEl, filter, render);
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
