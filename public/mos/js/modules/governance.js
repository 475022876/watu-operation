/* Marketing OS —— Governance & Assets（W08-02 Review History / W08-03 Asset Admission / W08-04 Approved Assets）。
 *
 * 三条审批链中，本页承载**第三条：资产入库（ASSET_ADMISSION）**。
 * 硬规则（03 §2.4 / 08 §E2E-05）：
 *   - 最终入库审批是**独立特权** `library.asset.approve.final`，页面只按服务端返回的 canDecide 显示按钮，
 *     按钮的有无**不构成授权**（前端隐藏不等于安全）；
 *   - 可复用资格（reuseEligibility）由服务端计算，页面只展示结论与阻塞原因；
 *   - Mock 资料库下 AVAILABLE 不可达，页面明确说明，不给出「已入库可用」的假象。
 *
 * M-01 / M-02：审核历史、审核裁决与已批准资产浏览分别复用 `components/reviewkit.js` 与
 * `components/assetkit.js` —— 与 My Reviews / Brand Reference Library 共用同一套规则与展示。
 */
import { api, withBrand } from '../api.js';
import {
  esc, toast, openModal, openDrawer, stateBlock, loadingHtml, fmtDateTime,
  dictOptions, mockBadge
} from '../ui.js';
import {
  admissionStateBadge, decideReviewCase, fetchReviewHistory, reviewHistoryTable
} from '../components/reviewkit.js';
import { fetchLibraryAssetRefs, governanceAssetsHtml, bindAssetSearch } from '../components/assetkit.js';

let ctxRef = null;
let hostEl = null;
let tab = 'admission';
let admissions = [];
let summary = null;
let blockedReason = '';
let assets = [];
let refs = null;
let history = [];
let q = '';
let busy = false;
let contract = null;

const TABS = [
  ['admission', 'Asset Admission'],
  ['assets', 'Approved Assets'],
  ['history', 'Review History']
];

function head(ctx) {
  return '<div class="page-head"><div class="crumb">治理与资产</div>'
    + '<div class="ph-row"><h1>治理与资产</h1>'
    + '<span class="pill">当前品牌 ' + esc(ctx.brand) + '</span>'
    + '<span class="pill">第三条链：Asset Admission</span>'
    + '<div class="ph-actions"><button class="btn btn-sm" id="gvRefresh">刷新</button></div></div>'
    + '<div class="ph-desc">专业审核 / 发布审核 / 资产入库是<b>三条独立链</b>；'
    + '最终入库许可是独立特权，不随 P1 或技术管理员自动获得。</div></div>';
}

/* ---------------- W08-03 Asset Admission ---------------- */

function renderAdmission() {
  let h = '<div class="grid grid-4">'
    + '<div class="card"><div class="card-body" style="padding:12px 14px"><div class="small muted">申请总数</div>'
    + '<div style="font-size:21px;font-weight:600;margin:4px 0">' + (summary ? summary.total : 0) + '</div></div></div>'
    + '<div class="card"><div class="card-body" style="padding:12px 14px"><div class="small muted">待最终审批</div>'
    + '<div style="font-size:21px;font-weight:600;margin:4px 0">' + (summary ? summary.pendingApproval : 0) + '</div></div></div>'
    + '<div class="card"><div class="card-body" style="padding:12px 14px"><div class="small muted">同步失败待重试</div>'
    + '<div style="font-size:21px;font-weight:600;margin:4px 0">' + (summary ? summary.failed : 0) + '</div></div></div>'
    + '<div class="card"><div class="card-body" style="padding:12px 14px"><div class="small muted">可复用资产</div>'
    + '<div style="font-size:21px;font-weight:600;margin:4px 0">' + (summary ? summary.reusable : 0) + '</div>'
    + '<div class="small muted">Mock 下必然为 0</div></div></div>'
    + '</div>';

  h += '<div class="callout mock"><b>资料库为 MOCK。</b>' + esc(blockedReason || '')
    + ' 因此本页任何申请都<b>不会</b>变成「可复用」。</div>';

  h += '<div class="card"><div class="card-head"><h2>入库申请</h2>'
    + '<div class="ch-actions"><button class="btn btn-sm btn-primary" id="admNew">新建入库申请</button></div></div>'
    + '<div class="card-body tight">';
  if (!admissions.length) {
    h += '<div class="card-body">' + stateBlock('empty', {
      title: '还没有入库申请',
      desc: '入库申请从 Visual Studio 上传/生成的工作素材发起；也可以在右上角直接新建。'
    }).html + '</div>';
  } else {
    h += '<div class="table-wrap"><table class="tbl"><thead><tr>'
      + '<th>资产 / 分类</th><th>状态</th><th>最终审批</th><th>同步</th><th>可复用</th><th>提交</th><th></th></tr></thead><tbody>'
      + admissions.map((a) => '<tr>'
        + '<td>' + mockBadge(a.assetMock) + '<div class="small">' + esc((a.submissionMetadata || {}).title || a.assetFileName)
        + '</div><div class="mono small muted">' + esc(a.categoryCode) + '</div></td>'
        + '<td>' + admissionStateBadge(a) + '</td>'
        + '<td class="small">' + esc(a.finalApprovalStatus) + '<br><span class="muted">' + esc(a.approvalMode) + '</span></td>'
        + '<td class="small">' + esc(a.syncStatus) + '<br><span class="muted mono">' + esc(a.libraryId || '—') + '</span></td>'
        + '<td>' + (a.reuseEligibility ? '<span class="badge badge-ok">可复用</span>'
          : '<span class="badge badge-neutral" title="' + esc((a.reuseBlocking || []).join('；')) + '">不可复用</span>') + '</td>'
        + '<td class="small">' + esc(a.submittedByName || '—') + '<br><span class="muted mono">' + esc(fmtDateTime(a.submittedAt)) + '</span></td>'
        + '<td class="actions"><button class="btn btn-sm" data-open="' + esc(a.id) + '">处理</button></td></tr>').join('')
      + '</tbody></table></div>';
  }
  h += '</div></div>';
  return h;
}

async function openAdmission(id) {
  let d;
  try { d = await api.get('/api/mos/asset-admissions/' + id); } catch (err) { toast(err.message, 'err'); return; }
  const a = d.admission;
  const c = d.reviewCase;
  let body = '<div class="callout mock">' + esc(blockedReason || '') + '</div>';

  body += '<h3 style="margin:4px 0 6px">申请信息</h3>'
    + '<dl class="kv">'
    + '<dt>状态</dt><dd>' + admissionStateBadge(a) + '</dd>'
    + '<dt>最终审批</dt><dd>' + esc(a.finalApprovalStatus) + '（授权来源 ' + esc(a.approvalMode) + '）</dd>'
    + '<dt>同步状态</dt><dd>' + esc(a.syncStatus) + ' · 尝试 ' + a.syncAttempts + ' 次</dd>'
    + '<dt>幂等键</dt><dd class="mono small">' + esc(a.idempotencyKey) + '</dd>'
    + '<dt>资产指纹</dt><dd class="mono small">' + esc(a.assetSha256) + '</dd>'
    + '<dt>当前指纹</dt><dd class="mono small">' + esc(a.assetDigestNow || '—') + '</dd>'
    + '<dt>分类</dt><dd>' + esc(a.categoryCode) + '</dd>'
    + '<dt>资料区</dt><dd>' + esc(a.libraryPrimaryCategory ? (a.libraryPrimaryCategory + (a.librarySubcategory ? ' / ' + a.librarySubcategory : '')) : '（未填写 · 待人工选择）') + '</dd>'
    + '<dt>密级</dt><dd>' + esc(a.classification || '（未填写 · 不得猜测降级）') + '</dd>'
    + '<dt>许可状态</dt><dd>' + esc(a.licenseStatus || '（未填写）')
      + (a.licenseLegacyText ? ' <span class="small muted">（历史文本：' + esc(a.licenseLegacyText) + '）</span>' : '') + '</dd>'
    + '<dt>复用范围</dt><dd>' + esc(a.reuseScope || 'none') + '</dd>'
    + '<dt>外部 AI 传输</dt><dd>' + esc(a.externalAiTransferPolicy || 'blocked') + '</dd>'
    + '<dt>Provider 必填字段</dt><dd>' + (a.providerFieldsComplete
      ? '<span class="small">齐备</span>'
      : '<span class="small" style="color:var(--danger,#c00)">缺失：' + esc((a.providerFieldsMissing || []).join('、')) + '</span>') + '</dd>'
    + '<dt>许可</dt><dd>' + esc((a.submissionMetadata || {}).license) + '</dd>'
    + '<dt>资料库 ID</dt><dd class="mono small">' + esc(a.libraryId || '（无：Mock 无正式回执）') + '</dd>'
    + '</dl>';

  if (a.needsManualReview) {
    body += '<div class="callout warn">该申请为<b>历史迁移数据</b>，三项必填字段待人工补齐（'
      + esc((a.manualReviewReasons || []).join('；')) + '）。'
      + '在本补齐之前，预检不会通过，也不会向资料库发起任何入库请求。</div>';
  }

  body += '<h3 style="margin:12px 0 6px">预检</h3>';
  if (!a.precheck) {
    body += '<div class="muted small">尚未预检。</div>';
  } else {
    body += '<div class="small">结论：<b>' + esc(a.precheck.verdict) + '</b> · ' + esc(a.precheck.checkedByName || '') + ' · ' + esc(fmtDateTime(a.precheck.checkedAt)) + '</div>'
      + '<div class="checklist" style="margin-top:6px">' + (a.precheck.checks || []).map((k) =>
        '<div class="checkline ' + (k.ok ? '' : 'no') + '"><span class="ck">' + (k.ok ? '✓' : '✕') + '</span>'
        + '<span>' + esc(k.id) + ' — ' + esc(k.note) + '</span></div>').join('') + '</div>';
  }

  body += '<h3 style="margin:12px 0 6px">资料库回执</h3>';
  body += a.receipt
    ? '<dl class="kv"><dt>回执号</dt><dd class="mono small">' + esc(a.receipt.receiptId) + '</dd>'
      + '<dt>回执状态</dt><dd>' + esc(a.receipt.state) + (a.receipt.deduplicated ? ' · 幂等去重' : '') + '</dd>'
      + '<dt>资产 ID</dt><dd class="mono small">' + esc(a.receipt.assetId || '—') + '</dd>'
      + '<dt>错误</dt><dd class="small">' + esc(a.receipt.errorCode || '—') + ' ' + esc(a.receipt.error || '') + '</dd></dl>'
    : '<div class="muted small">尚未调用资料库。</div>';

  body += '<h3 style="margin:12px 0 6px">可复用资格（服务端计算）</h3>'
    + (a.reuseEligibility
      ? '<div class="callout ok">满足可复用条件。</div>'
      : '<div class="callout warn">不可复用。阻塞原因：<ul style="margin:6px 0 0 18px">'
        + (a.reuseBlocking || []).map((r) => '<li>' + esc(r) + '</li>').join('') + '</ul></div>');

  if (c) {
    body += '<h3 style="margin:12px 0 6px">最终审批审核单</h3>'
      + '<div class="small">类型 ' + esc(c.type) + ' · 状态 ' + esc(c.state)
      + ' · 需权限 <span class="mono">library.asset.approve.final</span></div>'
      + (c.canDecide ? '' : '<div class="small muted" style="margin-top:4px">你当前无权裁决：'
        + esc((c.decideBlockedReasons || []).join('；')) + '</div>');
  }

  body += '<h3 style="margin:12px 0 6px">流程历史</h3>'
    + '<div class="timeline">' + (a.history || []).map((e) => '<div class="tl-item">'
      + '<div class="tl-dot"></div><div><div class="small"><b>' + esc(e.action) + '</b> '
      + (e.fromState && e.toState && e.fromState !== e.toState ? esc(e.fromState) + ' → ' + esc(e.toState) : '')
      + '</div><div class="small muted">' + esc(e.actorName || '—') + ' · ' + esc(fmtDateTime(e.at)) + '</div>'
      + (e.note ? '<div class="small">' + esc(e.note) + '</div>' : '') + '</div></div>').join('') + '</div>';

  const footer = document.createElement('div');
  footer.className = 'row';
  footer.style.gap = '8px';
  footer.style.flexWrap = 'wrap';
  const dr = openDrawer({ title: '入库申请 · ' + ((a.submissionMetadata || {}).title || a.id), body, footer });

  const addBtn = (label, primary, fn) => {
    const b = document.createElement('button');
    b.className = 'btn btn-sm' + (primary ? ' btn-primary' : '');
    b.textContent = label;
    b.addEventListener('click', async () => { b.disabled = true; try { await fn(); } finally { b.disabled = false; } });
    footer.appendChild(b);
    return b;
  };

  const reload = async () => { dr.close(); await refresh(); };

  /* B1：历史迁移行必须能人工补齐三项必填字段（**不提供任何"猜测默认值"**） */
  if (!['AVAILABLE', 'SYNC_COMPLETED', 'LIBRARY_SYNC_PENDING'].includes(a.state)) {
    addBtn(a.providerFieldsComplete ? '修订必填字段' : '补齐必填字段（资料区/密级/许可）',
      !a.providerFieldsComplete, () => editAdmissionFields(a, reload));
  }

  if (a.state === 'SUBMITTED') {
    addBtn('执行预检', true, async () => {
      try { const r = await api.post('/api/mos/asset-admissions/' + a.id + '/precheck', {}); toast('预检结论：' + (r.precheck ? r.precheck.verdict : '—'), r.precheck && r.precheck.verdict === 'PASS' ? 'ok' : 'err'); await reload(); }
      catch (err) { toast(err.message, 'err'); }
    });
  }
  if (a.precheck && a.precheck.verdict === 'PASS' && ['PRECHECK', 'REVIEWING'].indexOf(a.state) !== -1) {
    addBtn('提交最终审批', true, async () => {
      try { await api.post('/api/mos/asset-admissions/' + a.id + '/submit-final', {}); toast('已提交最终审批', 'ok'); await reload(); }
      catch (err) { toast(err.message, 'err'); }
    });
  }
  if (c && c.canDecide && c.state !== 'APPROVED' && c.state !== 'REJECTED') {
    addBtn('批准入库', true, () => {
      // M-01：复用 reviewkit 的裁决对话框与原因必填规则
      decideReviewCase({ caseId: c.id, brand: ctxRef.brand, action: 'APPROVE', titlePrefix: '最终审批',
        extraBody: { approvalRef: a.id }, onDone: reload });
    });
    addBtn('驳回', false, () => {
      decideReviewCase({ caseId: c.id, brand: ctxRef.brand, action: 'REJECT', titlePrefix: '最终审批', onDone: reload });
    });
  }
  if (a.state === 'FINAL_APPROVAL_GRANTED') {
    addBtn('提交资料库同步', true, async () => {
      try { const r = await api.post('/api/mos/asset-admissions/' + a.id + '/sync', {}); toast(r.note || '已同步', r.admission.syncStatus === 'COMPLETED' ? 'ok' : 'err'); await reload(); }
      catch (err) { toast(err.message, 'err'); }
    });
  }
  if (a.state === 'SYNC_FAILED') {
    addBtn('重试同步（幂等）', true, async () => {
      try { const r = await api.post('/api/mos/asset-admissions/' + a.id + '/retry-sync', {}); toast(r.note || '已重试', r.admission.syncStatus === 'COMPLETED' ? 'ok' : 'err'); await reload(); }
      catch (err) { toast(err.message, 'err'); }
    });
  }
  if (a.asset && a.asset.contentUrl) {
    addBtn('查看素材', false, async () => { window.open(a.asset.contentUrl, '_blank', 'noopener'); });
  }
  if (!footer.children.length) {
    footer.innerHTML = '<span class="small muted">当前状态没有可执行动作（或你没有相应权限）。</span>';
  }
}

/** B1：补齐/修订三项 Provider 必填字段（资料区 / 密级 / 许可） */
function editAdmissionFields(a, onDone) {
  const C = contract || {};
  const libCats = C.libraryCategories || [];
  const classMeta = C.classificationMeta || {};
  const catOpts = libCats.map((c) => '<option value="' + esc(c.id) + '"' + (c.id === a.libraryPrimaryCategory ? ' selected' : '') + '>'
    + esc(c.id + ' · ' + c.nameZh) + '</option>').join('');
  const classOpts = (C.classifications || []).map((k) => '<option value="' + esc(k) + '"' + (k === a.classification ? ' selected' : '') + '>'
    + esc(k + ' · ' + ((classMeta[k] || {}).labelZh || '')) + '</option>').join('');
  const licOpts = (C.licenseStatuses || []).map((k) => '<option value="' + esc(k) + '"' + (k === a.licenseStatus ? ' selected' : '') + '>'
    + esc(k) + '</option>').join('');

  openModal({
    title: '补齐准入必填字段',
    okText: '保存',
    body: '<div class="callout info">三项均为企业资料库必填字段。'
      + '<b>许可状态不得由历史自由文本推断</b>（原文本：' + esc(a.licenseLegacyText || '无') + '）；'
      + '<b>密级不得猜测降级</b>（资料库侧强制只升不降）。</div>'
      + '<label class="field"><span>资料区（01–07）</span><select id="efPrimary">'
      + '<option value="">请选择</option>' + catOpts + '</select></label>'
      + '<label class="field"><span>密级</span><select id="efClass">'
      + '<option value="">请选择</option>' + classOpts + '</select></label>'
      + '<label class="field"><span>许可状态</span><select id="efLicense">'
      + '<option value="">请选择</option>' + licOpts + '</select></label>',
    onOk: async (b) => {
      const body = {
        libraryPrimaryCategory: b.querySelector('#efPrimary').value,
        classification: b.querySelector('#efClass').value,
        licenseStatus: b.querySelector('#efLicense').value,
        brand: ctxRef.brand
      };
      if (!body.libraryPrimaryCategory || !body.classification || !body.licenseStatus) {
        toast('三项均为必填，请完整选择', 'err'); return false;
      }
      try {
        await api.post('/api/mos/asset-admissions/' + a.id + '/admission-fields', body);
        toast('必填字段已保存', 'ok');
        if (onDone) await onDone();
      } catch (err) {
        const extra = (err.missing && err.missing.length) ? ('（缺失：' + err.missing.join('、') + '）') : '';
        toast((err.message || '保存失败') + extra, 'err'); return false;
      }
    }
  });
}

function newAdmissionDialog() {
  if (!assets.length) {
    toast('还没有工作素材：请先在 Visual Studio 上传一份素材', 'err');
    return;
  }
  const cats = (ctxRef.meta && ctxRef.meta.dictionaries && ctxRef.meta.dictionaries.assetCategories) || [];
  const C = contract || {};
  const libCats = C.libraryCategories || [];
  const classMeta = C.classificationMeta || {};
  const licStatuses = C.licenseStatuses || [];
  const reuseScopes = C.reuseScopes || [];
  const aiPolicies = C.externalAiTransferPolicies || [];

  const catOpts = libCats.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.id + ' · ' + c.nameZh) + '</option>').join('');
  const classOpts = (C.classifications || []).map((k) =>
    '<option value="' + esc(k) + '">' + esc(k + ' · ' + ((classMeta[k] || {}).labelZh || '')) + '</option>').join('');
  const licOpts = licStatuses.map((k) => '<option value="' + esc(k) + '">' + esc(k) + '</option>').join('');
  /* D-06.5（资料库实测纠正）：reuseScope **必须**由人工显式选择，且**不得**默认 none ——
   * none 会被 Provider 预检判「无复用意义」并落 REVISION_REQUIRED，而该状态**没有重提入口**
   * （B-4 / CCR-2026-004）→ 申请会永久卡死。故此处不预选任何值。 */
  const reuseOpts = reuseScopes.map((k) => '<option value="' + esc(k) + '">' + esc(k) + '</option>').join('');
  const aiOpts = aiPolicies.map((k) => '<option value="' + esc(k) + '"' + (k === 'blocked' ? ' selected' : '') + '>' + esc(k) + '</option>').join('');

  const m = openModal({
    title: '新建入库申请',
    okText: '提交申请',
    body: '<div class="callout info">入库申请只针对**已存在的工作素材**；预检与最终审批在提交后分别执行。'
      + '以下三项为<b>企业资料库必填字段</b>，枚举与编号一律引用资料库权威口径，'
      + '<b>不得猜测</b>：资料区决定落库位置，密级<b>只升不降</b>由资料库强制，许可状态不得由自由文本推断。</div>'
      + '<div class="callout warn">复用范围<b>必须显式选择非 none</b> 的值：none 会被资料库预检判为'
      + '「无复用意义」并退回修订，而该状态<b>没有重提入口</b>，申请将永久卡死（需另建申请）。'
      + '许可状态选 <b>unknown / expired</b> 同样无法完成准入，会停在上游等待人工补齐许可信息。</div>'
      + '<label class="field"><span>工作素材</span><select id="admAsset">'
      + assets.map((a) => '<option value="' + esc(a.id) + '">' + esc(a.fileName) + (a.mock ? '（MOCK）' : '') + '</option>').join('')
      + '</select></label>'
      + '<label class="field"><span>资产分类（A01–A08 · provisional）</span><select id="admCat">'
      + dictOptions(cats, '', '请选择') + '</select></label>'
      + '<label class="field"><span>资料区（必填 · 七大资料区 01–07）</span><select id="admPrimary">'
      + '<option value="">请选择资料区</option>' + catOpts + '</select></label>'
      + '<label class="field"><span>二级目录（可选）</span><select id="admSub"><option value="">（不指定）</option></select></label>'
      + '<label class="field"><span>密级（必填 · 四级）</span><select id="admClass">'
      + '<option value="">请选择密级（不得猜测降级）</option>' + classOpts + '</select></label>'
      + '<label class="field"><span>许可状态（必填 · 不得由自由文本推断）</span><select id="admLicenseStatus">'
      + '<option value="">请选择许可状态</option>' + licOpts + '</select></label>'
      + '<label class="field"><span>复用范围（必填 · 不得为 none）</span><select id="admReuse">'
      + '<option value="">请选择复用范围</option>' + reuseOpts + '</select></label>'
      + '<label class="field"><span>外部 AI 传输策略（默认 blocked）</span><select id="admAi">' + aiOpts + '</select></label>'
      + '<label class="field"><span>标题</span><input id="admTitle" placeholder="资产名称"></label>'
      + '<label class="field"><span>说明</span><input id="admDesc" placeholder="用途、来源、适用场景"></label>',
    onOk: async (b) => {
      const primary = b.querySelector('#admPrimary').value;
      const body = {
        workingAssetId: b.querySelector('#admAsset').value,
        categoryCode: b.querySelector('#admCat').value,
        libraryPrimaryCategory: primary,
        librarySubcategory: b.querySelector('#admSub').value || undefined,
        classification: b.querySelector('#admClass').value,
        licenseStatus: b.querySelector('#admLicenseStatus').value,
        reuseScope: b.querySelector('#admReuse').value,
        externalAiTransferPolicy: b.querySelector('#admAi').value,
        submissionMetadata: {
          title: b.querySelector('#admTitle').value.trim(),
          description: b.querySelector('#admDesc').value.trim(),
          license: b.querySelector('#admLicenseStatus').value
        }
      };
      if (!body.categoryCode) { toast('请选择资产分类', 'err'); return false; }
      if (!body.libraryPrimaryCategory) { toast('请选择资料区（必填）', 'err'); return false; }
      if (!body.classification) { toast('请选择密级（必填，不得猜测）', 'err'); return false; }
      if (!body.licenseStatus) { toast('请选择许可状态（必填，不得由自由文本推断）', 'err'); return false; }
      if (!body.reuseScope) { toast('请选择复用范围（必填）', 'err'); return false; }
      /* 前端同构预检（与后端 admissionlib.reuseScopeUsable / licenseAdmissionGate 一致）：
       * 与其等 Provider 预检把申请卡死后无法重提，不如在提交前明确阻止。 */
      if (body.reuseScope === 'none') {
        toast('复用范围不得为 none：资料库预检会退回修订，且该状态无法重提，申请将永久卡死', 'err');
        return false;
      }
      if (body.licenseStatus === 'unknown' || body.licenseStatus === 'expired') {
        toast('许可状态 ' + body.licenseStatus + ' 无法完成准入（需先补齐许可信息），请修正后再提交', 'err');
        return false;
      }
      try {
        const r = await api.post('/api/mos/asset-admissions', Object.assign({ brand: ctxRef.brand }, body));
        toast('入库申请已创建：' + r.admission.id, 'ok');
        await refresh();
      } catch (err) {
        const extra = (err.missing && err.missing.length) ? ('（缺失：' + err.missing.join('、') + '）') : '';
        const ferr = (err.fieldErrors && err.fieldErrors.length) ? ('（' + err.fieldErrors.join('；') + '）') : '';
        toast((err.message || '创建失败') + extra + ferr, 'err');
        return false;
      }
    }
  });
  // 资料区 → 二级目录联动（编号一律来自契约，不自创）；openModal 不提供 onMount，故在返回后绑定
  const sel = m.body.querySelector('#admPrimary');
  const sub = m.body.querySelector('#admSub');
  if (sel && sub) {
    const sync = () => {
      const c = libCats.find((x) => x.id === sel.value);
      sub.innerHTML = '<option value="">（不指定）</option>'
        + (c ? c.subs.map((s) => '<option value="' + esc(s[0]) + '">' + esc(s[0] + ' · ' + s[1]) + '</option>').join('') : '');
    };
    sel.addEventListener('change', sync);
    sync();
  }
}

/* ---------------- W08-04 Approved Assets（M-02：复用 assetkit） ---------------- */

function renderAssets() {
  return governanceAssetsHtml(refs, q);
}

/* ---------------- W08-02 Review History（M-01：复用 reviewkit） ---------------- */

function renderHistory() {
  let h = '<div class="filters"><span class="pill">决策记录 ' + history.length + ' 条</span>'
    + '<span class="small muted">append-only：历史不会被改写</span></div>';
  h += '<div class="card"><div class="card-head"><h2>审核决策历史</h2>'
    + '<div class="ch-actions"><span class="small muted">与 My Reviews 共用同一套裁决组件（M-01）</span></div></div>'
    + '<div class="card-body tight">' + reviewHistoryTable(history) + '</div></div>';
  return h;
}

/* ---------------- 加载与渲染 ---------------- */

async function load() {
  const ctx = ctxRef;
  if (tab === 'admission') {
    const r = await api.get(withBrand('/api/mos/asset-admissions', ctx.brand, { pageSize: 100 }));
    admissions = r.items || [];
    summary = r.summary || null;
    blockedReason = r.availableBlockedReason || '';
    const a = await api.get(withBrand('/api/mos/assets', ctx.brand, { pageSize: 200 }));
    assets = a.items || [];
    // B1：三项 Provider 必填字段的枚举一律**引用**服务端契约，前端不自创编号
    if (!contract) {
      try { contract = await api.get('/api/mos/integration/contract'); } catch (_) { contract = null; }
    }
  } else if (tab === 'assets') {
    refs = await fetchLibraryAssetRefs(ctx.brand, q);
  } else {
    const r = await fetchReviewHistory(ctx.brand);
    history = r.items || [];
  }
}

async function render() {
  const ctx = ctxRef;
  hostEl.innerHTML = loadingHtml();
  try { await load(); } catch (err) {
    const s = stateBlock(err.status === 403 ? 'denied' : 'error', {
      title: err.status === 403 ? '无权访问该视图' : '加载失败',
      desc: err.message || '未知错误',
      actions: [{ label: '重试', primary: true, onClick: () => render() }]
    });
    hostEl.innerHTML = s.html; s.bind(hostEl);
    return;
  }

  let h = head(ctx);
  h += '<div class="tabs">' + TABS.map(([k, l]) =>
    '<button data-tab="' + k + '" class="' + (tab === k ? 'on' : '') + '" id="gvTab-' + k + '">' + esc(l) + '</button>').join('') + '</div>';

  if (tab === 'admission') h += renderAdmission();
  else if (tab === 'assets') h += renderAssets();
  else h += renderHistory();

  hostEl.innerHTML = h;

  hostEl.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', async () => {
    if (busy) return;
    tab = b.dataset.tab;
    await render();
  }));
  const rf = hostEl.querySelector('#gvRefresh');
  if (rf) rf.addEventListener('click', () => render());
  const nb = hostEl.querySelector('#admNew');
  if (nb) nb.addEventListener('click', newAdmissionDialog);
  hostEl.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openAdmission(b.dataset.open)));
  bindAssetSearch(hostEl, async (val) => { q = val; await render(); });
}

async function refresh() { await render(); }

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; tab = 'admission'; q = ''; busy = false; await render(); },
  unmount() { hostEl = null; admissions = []; refs = null; history = []; busy = false; },
  hasUnsaved() { return false; }
};
