/* 公共资产浏览组件（M-02）—— Brand Center 的 Reference Library 与 Governance & Assets 的
 * Approved Assets **共用同一套**已批准资产检索 / 详情 / 版本与授权展示（01 §MERGE M-02）。
 *
 * 硬约束（00 §3 / 03 §2.4 / 06 §1）：
 *   - 企业资料库真实接口未接通时，**正式库检索恒为空**，绝不伪造"已批准资产"；
 *   - 沙盒条目（MOCK_ 前缀）**不具备复用资格**：reuseEligibility 由服务端计算，前端只展示结论；
 *   - Brand Center 的变体仅增加「品牌过滤」，检索能力与治理页完全一致。
 */
import { api, withBrand } from '../api.js';
import { esc, mockBadge, fmtDateTime, stateBlock } from '../ui.js';

/* ---------------- API 客户端（唯一入口） ---------------- */

/** 已批准可复用资产检索（W02-04）：MOCK 下 items 恒为空 */
export function fetchApprovedAssets(brand, q) {
  return api.get(withBrand('/api/mos/library/approved', brand, { q: q || '' }));
}

/** 沙盒条目 + 正式库检索（W08-04）：两者分列返回，避免混淆 */
export function fetchLibraryAssetRefs(brand, q) {
  return api.get(withBrand('/api/mos/library-asset-refs', brand, { q: q || '' }));
}

/* ---------------- 展示片段 ---------------- */

export function reuseBadge(eligible, blocking) {
  return eligible
    ? '<span class="badge badge-ok">可复用</span>'
    : '<span class="badge badge-neutral" title="' + esc((blocking || []).join('；')) + '">不可复用</span>';
}

export function gatewaySection(gateway) {
  const gw = gateway || { items: [] };
  const has = gw.items && gw.items.length;
  return '<div class="card"><div class="card-head"><h2>Production 检索（真实资料库）</h2>'
    + '<span class="badge badge-mock">' + esc(gw.mode || 'mock') + '</span></div>'
    + '<div class="card-body">'
    + (has
      ? '<div class="table-wrap"><table class="tbl"><thead><tr><th>资产</th><th>版本</th><th>权限</th></tr></thead><tbody>'
        + gw.items.map((i) => '<tr><td class="mono small">' + esc(i.id || i.assetId) + '</td>'
          + '<td class="small">' + esc(i.version || '—') + '</td><td class="small">' + esc(i.permissionScope || '') + '</td></tr>').join('')
        + '</tbody></table></div>'
      : stateBlock('pending', { title: '正式库检索为空', desc: gw.note || 'MOCK 下不返回正式已批准资产。' }).html)
    + '</div></div>';
}

export function sandboxRefsTable(items) {
  if (!items || !items.length) {
    return stateBlock('empty', {
      title: '还没有沙盒条目',
      desc: '完成一次「入库申请 → 预检 → 最终审批 → 同步」后，这里会出现回执条目。'
    }).html;
  }
  return '<div class="table-wrap"><table class="tbl"><thead><tr>'
    + '<th>资料库 ID</th><th>版本</th><th>资产状态</th><th>权限核验</th><th>可复用</th><th>来源申请</th><th>核验时间</th></tr></thead><tbody>'
    + items.map((r) => '<tr>'
      + '<td class="mono small">' + esc(r.libraryId || '—') + mockBadge(r.mock) + '</td>'
      + '<td class="small">' + esc(r.version || '—') + '</td>'
      + '<td class="small">' + esc(r.assetState) + '</td>'
      + '<td class="small">' + (r.permissionValid ? '<span class="badge badge-ok">有效</span>' : '<span class="badge badge-warn">未核验</span>') + '</td>'
      + '<td>' + reuseBadge(r.reuseEligibility, r.reuseBlocking) + '</td>'
      + '<td class="mono small">' + esc(r.admissionId) + '</td>'
      + '<td class="small mono">' + esc(fmtDateTime(r.lastVerifiedAt)) + '</td></tr>').join('')
    + '</tbody></table></div>';
}

/** 可复用资格判定口径（避免各处重复解释业务规则） */
export function reuseLegend() {
  return '<div class="card"><div class="card-head"><h2>设计说明</h2></div><div class="card-body">'
    + '<div class="checkline no"><span class="ck">✕</span><span>入库审批 APPROVED <b>不等于</b>已持久化的 AVAILABLE（00 §3）。</span></div>'
    + '<div class="checkline no"><span class="ck">✕</span><span>已发布内容不会自动进入企业资料库；复用需单独发起入库申请。</span></div>'
    + '<div class="checkline"><span class="ck">•</span><span>可复用资格 = 最终审批通过 AND 同步完成 AND 权限核验有效 AND 资产 ACTIVE AND 授权来源为 REAL。</span></div>'
    + '</div></div>';
}

/** 治理页「Approved Assets」标签页：沙盒条目 + 正式库检索 + 判定口径 */
export function governanceAssetsHtml(data, q) {
  const d = data || { items: [], gateway: { items: [] }, counts: {}, integration: {} };
  let h = '<div class="callout mock"><b>企业资料库未接通（MOCK）。</b>' + esc(d.note || '')
    + ' 正式库检索（下方 Production 段）在 Mock 下<b>恒为空</b>，不伪造正式资产。</div>';

  h += '<div class="filters">'
    + '<input type="search" id="laQ" placeholder="按资料库 ID / 来源检索" value="' + esc(q || '') + '">'
    + '<button class="btn btn-sm" id="laSearch">检索</button>'
    + '<span class="pill">条目 ' + ((d.counts && d.counts.total) || 0) + '</span>'
    + '<span class="badge badge-mock">沙盒 ' + ((d.counts && d.counts.mockOnly) || 0) + '</span>'
    + '<span class="badge badge-ok">可复用 ' + ((d.counts && d.counts.reusable) || 0) + '</span>'
    + '</div>';

  h += gatewaySection(d.gateway);
  h += '<div class="card"><div class="card-head"><h2>Sandbox 条目（本机入库流程产生）</h2>'
    + '<span class="pill">带 MOCK_ 前缀</span></div><div class="card-body tight">'
    + '<div class="card-body">' + sandboxRefsTable(d.items) + '</div></div></div>';
  h += reuseLegend();
  return h;
}

/** Brand Center「Reference Library」变体：与治理页同一检索能力 + 品牌过滤（M-02） */
export function brandReferenceHtml(data, q, brandLabel) {
  const d = data || { items: [] };
  let h = '<div class="callout mock">' + esc(d.note || '') + '</div>';
  h += '<div class="filters" role="search">'
    + '<label class="row" style="gap:5px"><span class="small muted">品牌过滤</span>'
    + '<span class="pill" id="rbBrand">' + esc(brandLabel || d.brandName || d.brandCode || '—') + '</span></label>'
    + '<input type="search" id="rbQ" placeholder="检索已批准资产…" value="' + esc(q || '') + '" aria-label="检索已批准资产">'
    + '<button class="btn btn-sm" id="rbGo">检索</button>'
    + '<span class="badge badge-mock">MOCK 资料库</span>'
    + '<span class="pill">结果 ' + ((d.items || []).length) + '</span>'
    + '</div>';
  h += '<div class="card"><div class="card-head"><h2>检索结果</h2>'
    + '<div class="ch-actions"><span class="badge badge-neutral">' + ((d.items || []).length) + '</span></div></div>'
    + '<div class="card-body">'
    + stateBlock('pending', {
      title: '当前无可引用的正式资产',
      desc: '企业资料库（LibraryGateway）真实接口尚未审计接通（06 §1）。为避免误用，MOCK 模式下**不返回任何资产**；接通后此处将按权限展示已批准资产与版次。'
    }).html
    + '</div></div>';
  return h;
}

/** 绑定检索控件（两处入口共用） */
export function bindAssetSearch(el, onSearch) {
  const go = (inputId) => {
    const input = el.querySelector('#' + inputId);
    onSearch(input ? input.value.trim() : '');
  };
  const b1 = el.querySelector('#laSearch'); if (b1) b1.addEventListener('click', () => go('laQ'));
  const b2 = el.querySelector('#rbGo'); if (b2) b2.addEventListener('click', () => go('rbQ'));
  const i1 = el.querySelector('#laQ'); if (i1) i1.addEventListener('keydown', (e) => { if (e.key === 'Enter') go('laQ'); });
  const i2 = el.querySelector('#rbQ'); if (i2) i2.addEventListener('keydown', (e) => { if (e.key === 'Enter') go('rbQ'); });
}
