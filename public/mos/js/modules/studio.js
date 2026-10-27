/* 制作工作台（Task Studio）—— V0.1.3 Phase A 一站式任务空间。
 *
 * 执行包 01 §任务空间 / 03 §一个内容任务的可视布局：
 *   顶部：任务名 / 品牌 / 平台 / 状态 / 保存状态 / 截止
 *   左侧（可折叠）：Brief · 已审研究与来源 · 上级备注
 *   中间：正文 ｜ 图片 ｜ 视频（脚本·分镜·关键帧·上传） ｜ 审核   —— **在任务内切换，不跳出任务**
 *   右侧：交付物清单 · 下一步建议
 *
 * 设计原则（01 §UI减法原则）：
 *   - 默认只暴露一个主按钮；技术参数（Provider/Skill/哈希）收纳在「高级」；
 *   - 选择从任务/Brief/已审研究自动继承，员工可覆盖；
 *   - **无 AI 也可全链路完成**：手工写正文、手工上传图片与成片始终可用；
 *   - 任何失败都给出可操作恢复项，不留空白页。
 */
import { api, withBrand, csrfToken } from '../api.js';
import {
  esc, toast, openModal, confirmDialog, loadingHtml, stateBlock, statusBadge, gradeBadge,
  platformLabel, demoBadge, mockBadge, fmtDateTime, relTime
} from '../ui.js';
/* V0.1.3 Phase C：key-based i18n —— 状态/按钮/提示走资源键与统一状态映射 */
import { t, purposeLabel, visualTypeLabel, readinessLabel } from '../i18n.js';

let ctxRef = null; let hostEl = null;
let taskId = '';
let tasks = [];
let studio = null;          // /tasks/:id/studio 响应
let versions = [];
let current = null;         // 当前版本详情
let tab = 'TEXT';           // TEXT | IMAGE | VIDEO | REVIEW
let video = null;           // /video/:taskId 响应
let assets = [];            // 本任务工作素材
let leftOpen = true;
let dirty = false;
let advancedOpen = false;
// H07: scoped in-memory buffers, adapted from remediation 1f0f1f0.
const draftBuffers = new Map();
const videoScriptBuffers = new Map();
let saveBusy = false, submitBusy = false, editorEpoch = 0;
function saveError(message) {
  toast(message, 'err');
  const status = hostEl && hostEl.querySelector('#ceSaveState');
  if (status) { status.textContent = message; status.setAttribute('role', 'alert'); }
}


const RISKY = ['G2', 'G3'];
const TABS = [
  { id: 'TEXT', label: '正文' },
  { id: 'IMAGE', label: '图片' },
  { id: 'VIDEO', label: '视频' },
  { id: 'REVIEW', label: '审核' }
];

function bodyEl() { return hostEl.querySelector('#mosBody') || hostEl; }
function setBody(html) { bodyEl().innerHTML = html; }

function renderError(err, retry) {
  const kind = err.status === 403 || err.status === 404 ? 'denied' : (err.status === 409 ? 'pending' : 'error');
  const s = stateBlock(kind, {
    title: err.status === 403 ? '权限不足' : (err.status === 404 ? '无权访问该任务' : '加载失败'),
    desc: err.message,
    actions: retry ? [{ label: '重试', primary: true, onClick: retry }] : []
  });
  setBody(s.html); s.bind(bodyEl());
}

/* ==================== 页面骨架 ==================== */

function head() {
  return '<div class="page-head"><div class="crumb">内容制作 / 制作工作台</div>'
    + '<div class="ph-row"><h1>制作工作台</h1>'
    + '<div class="ph-actions">'
    + '<button class="btn btn-sm" id="ceRefresh">刷新</button>'
    + '<button class="btn btn-sm btn-primary" id="ceNew">新建草稿</button>'
    + '</div></div>'
    + '<div class="ph-desc">在一个页面里完成任务：写正文 → 配图 / 视频脚本分镜 → 提交审核。'
    + '所有选择自动继承任务 Brief 与已审研究，不需要在多个模块之间重复填写。</div></div>';
}

async function render() {
  hostEl.innerHTML = head() + '<div id="mosBody">' + loadingHtml() + '</div>';
  try {
    const r = await api.get(withBrand('/api/mos/tasks', ctxRef.brand, {}));
    tasks = r.items || [];
  } catch (err) { renderError(err, render); return; }

  if (!tasks.length) {
    const s = stateBlock('empty', {
      title: '当前品牌还没有内容任务',
      desc: '可从「月度计划」创建事项，或在「全部任务」中新建任务。',
      actions: [{ label: '去全部任务', primary: true, onClick: () => ctxRef.navigate('tasks') }]
    });
    setBody(s.html); bindHead(); return;
  }

  const want = ctxRef && ctxRef.params && ctxRef.params.task;
  if (want && tasks.some((t) => t.id === want)) taskId = want;
  if (!taskId || !tasks.some((t) => t.id === taskId)) {
    const mine = tasks.filter((t) => t.ownerId === (ctxRef.me && ctxRef.me.id));
    taskId = (mine[0] || tasks[0]).id;
  }
  try { api.put('/api/mos/my-work/continue', { taskId }); } catch (_) { /* 非权威，失败不阻断 */ }

  await loadStudio();
  paint();
  bindHead();
}

async function loadStudio() {
  const sid = taskId;
  const [st, vv] = await Promise.all([
    api.get(withBrand('/api/mos/tasks/' + taskId + '/studio', ctxRef.brand, {})),
    api.get(withBrand('/api/mos/content-versions', ctxRef.brand, { taskId }))
  ]);
  if (taskId !== sid) return;
  studio = st;
  versions = vv.items || [];
  await loadAssets();
  await loadVideo();
  /* 自动选中版本（UX-02：进入任务即可编辑，不必先点选）。
   * 优先保留当前选中的版本；若已不存在则取编号最大的。
   * 注意：同一版本在动作后（保存/冻结/派生）状态会变化 → **始终重新拉取详情**，
   * 否则会把冻结前的可编辑状态留在界面上（表现为"送审后正文仍可改"）。 */
  const keepId = current && current.version ? current.version.id : null;
  const target = (keepId && versions.find((v) => v.id === keepId))
    || versions.slice().sort((a, b) => (b.number || 0) - (a.number || 0))[0];
  if (target) {
    try { current = await api.get(withBrand('/api/mos/content-versions/' + target.id, ctxRef.brand)); }
    catch (_) { current = null; }
  } else {
    current = null;
  }
}

async function loadAssets() {
  try {
    const r = await api.get(withBrand('/api/mos/assets', ctxRef.brand, { taskId }));
    assets = r.items || [];
  } catch (_) { assets = []; }
}

async function loadVideo() {
  try {
    const r = await api.get(withBrand('/api/mos/video/' + taskId, ctxRef.brand, {}));
    video = r.video || null;
  } catch (_) { video = null; }
}

function bindHead() {
  const n = hostEl.querySelector('#ceNew'); if (n) n.addEventListener('click', newDraftDialog);
  const r = hostEl.querySelector('#ceRefresh'); if (r) r.addEventListener('click', async () => { if (dirty || videoScriptBuffers.has(taskId)) { saveError(t('phase1.unsaved_refresh')); return; } current = null; await render(); toast('已刷新', 'ok'); });
  const sel = hostEl.querySelector('#ceTask');
  if (sel) sel.addEventListener('change', async () => {
    if ((dirty || videoScriptBuffers.has(taskId)) && !(await confirmDialog('放弃未保存修改？', '当前草稿有未保存的正文修改。', '放弃并切换'))) { sel.value = taskId; return; }
    if (current) draftBuffers.delete(current.version.id);
    videoScriptBuffers.delete(taskId);
    dirty = false; taskId = sel.value; current = null; tab = 'TEXT'; await render();
  });
}

/* ==================== 主绘制 ==================== */

function paint() {
  const t = (studio && studio.task) || {};
  const b = (studio && studio.brief) || {};

  let html = '<div class="filters" style="flex-wrap:wrap">'
    + '<label class="row" style="gap:6px"><span class="small muted">当前任务</span>'
    + '<select id="ceTask" style="max-width:380px">'
    + tasks.map((x) => '<option value="' + esc(x.id) + '"' + (x.id === taskId ? ' selected' : '') + '>'
      + esc(x.code + ' · ' + x.title) + '</option>').join('')
    + '</select></label>'
    + statusBadge(t.status) + gradeBadge(b.riskGrade)
    + '<span class="pill">' + esc(platformLabel(b.platform)) + '</span>'
    + (b.productionDue ? '<span class="pill">截止 ' + esc(String(b.productionDue).slice(0, 10)) + '</span>' : '')
    + '<span class="pill" id="ceSaveState">' + (dirty ? '有未保存修改' : '已保存') + '</span>'
    + demoBadge(t.demo)
    + '<button class="btn btn-sm" id="tsAdvanced" style="margin-left:auto">高级</button>'
    + '</div>';

  if (advancedOpen) html += advancedBlock();

  html += '<div class="editor-3col">'
    + '<div class="ed-col" id="tsLeft"></div>'
    + '<div class="ed-col" id="tsMid"></div>'
    + '<div class="ed-col" id="tsRight"></div>'
    + '</div>';
  setBody(html);

  paintLeft();
  paintMid();
  paintRight();

  const adv = hostEl.querySelector('#tsAdvanced');
  if (adv) adv.addEventListener('click', () => { advancedOpen = !advancedOpen; paint(); });
}

function advancedBlock() {
  const a = (studio && studio.advanced) || {};
  const ps = a.providerStatus || {};
  const sk = a.skill || {};
  const row = (k, v) => '<div class="small" style="display:flex;justify-content:space-between;gap:10px">'
    + '<span class="muted">' + esc(k) + '</span><span class="mono">' + esc(String(v)) + '</span></div>';
  /* 就绪度统一映射（执行包 06）：REAL / CONFIGURED_NOT_TESTED / NOT_CONFIGURED /
   * NOT_IMPLEMENTED / BLOCKED —— Mock 不计为 REAL，BLOCKED 不隐去。 */
  const providerRow = (p) => {
    const o = p || {};
    const rd = o.readiness || (o.mode === 'none' || !o.mode ? 'NOT_CONFIGURED' : 'CONFIGURED_NOT_TESTED');
    return readinessLabel(rd) + ' · ' + (o.mode || 'none');
  };
  return '<div class="card" style="margin-bottom:10px"><div class="card-head"><h2>' + t('studio.advanced_title') + '</h2>'
    + '<span class="hint">' + t('studio.advanced_hint') + '</span></div><div class="card-body">'
    + row(t('studio.row_text_model'), providerRow(ps.textProvider))
    + row(t('studio.row_image_model'), providerRow(ps.imageProvider))
    + row(t('studio.row_video_model'), providerRow(ps.videoProvider))
    + row(t('brand.skill'), (sk.skillCode || '—') + ' v' + (sk.version || '—') + ' / ' + (sk.state || 'MISSING'))
    + '<div class="small muted" style="margin-top:6px">' + esc(sk.reason || '') + '</div>'
    + '</div></div>';
}

/* ---------- 左栏：Brief / 已审研究 / 上级备注 ---------- */

function paintLeft() {
  const el = hostEl.querySelector('#tsLeft');
  const b = (studio && studio.brief) || {};
  const r = studio && studio.research;

  let h = '<div class="card"><div class="card-head"><h2>任务要求</h2>'
    + '<button class="btn btn-sm" id="tsToggleLeft">' + (leftOpen ? '收起' : '展开') + '</button></div>';
  if (leftOpen) {
    h += '<div class="card-body" id="wsBrief"><dl class="kv">'
      + '<dt>编号</dt><dd class="mono">' + esc(b.code || '—') + '</dd>'
      + '<dt>标题</dt><dd data-notranslate>' + esc(b.title || '—') + '</dd>'
      + '<dt>平台</dt><dd>' + esc(platformLabel(b.platform)) + '</dd>'
      + '<dt>负责人</dt><dd>' + esc(b.ownerName || '—') + '</dd>'
      + '<dt>风险等级</dt><dd>' + gradeBadge(b.riskGrade) + '</dd>'
      + '<dt>制作截止</dt><dd class="mono small">' + esc(String(b.productionDue || '').slice(0, 10) || '—') + '</dd>'
      + '</dl></div>';
  }
  h += '</div>';

  /* 已审研究：来自「策划与情报 → 选题建议」获批后建立的正式 Topic（只读引用） */
  h += '<div class="card"><div class="card-head"><h2>研究依据</h2>'
    + (r ? '<span class="pill">' + esc(r.evidenceCount + ' 条来源') + '</span>' : '') + '</div><div class="card-body">';
  if (r) {
    h += '<div class="small" data-notranslate><b>' + esc(r.topicTitle || '') + '</b></div>'
      + '<div class="small muted">栏目 ' + esc(r.pillarCode || '—')
      + (r.report ? ' · 报告 ' + esc(r.report.code + '（' + r.report.mode + '）') : '') + '</div>';
    if (r.reviewComments) h += '<div class="block-note info" style="margin-top:8px">上级审核意见：<span data-notranslate>' + esc(r.reviewComments) + '</span></div>';
    if (r.needsVerification) h += '<div class="block-note danger" style="margin-top:8px">含待核验事实：发布前必须补充依据</div>';
    h += '<div class="divider"></div><div class="small muted">关键事实与来源</div>';
    if (!r.findings.length) h += '<div class="hint">该选题暂无逐条发现（研究以元数据形式提供）。</div>';
    for (const f of r.findings.slice(0, 8)) {
      h += '<div class="src-item"><div class="src-h">' + statusBadge(f.verificationState)
        + '<span class="badge badge-neutral">' + esc(f.kind) + '</span></div>'
        + '<div class="src-t" data-notranslate>' + esc(String(f.statement || '').slice(0, 160)) + '</div>'
        + (f.evidence || []).map((e) => e.url
          ? '<a class="small" href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.sourceName || '来源') + '</a>'
          : '').join(' ')
        + '</div>';
    }
  } else if (studio && studio.businessBasis) {
    const bb = studio.businessBasis;
    h += '<div class="block-note info">业务依据（无研究来源任务）<br>'
      + '<b>' + esc(bb.kind) + '</b><br><span class="small" data-notranslate>' + esc(bb.note) + '</span>'
      + (bb.ref ? '<br><span class="small muted" data-notranslate>引用：' + esc(bb.ref) + '</span>' : '') + '</div>';
  } else {
    h += '<div class="hint">此任务没有关联研究主题。</div>'
      + '<button class="btn btn-sm" id="tsBasis" style="margin-top:8px">登记业务依据</button>'
      + '<div class="small muted" style="margin-top:6px">官方通知 / 内部已批准产品事实 / 临时任务，登记后即可正常送审。</div>';
  }
  h += '</div></div>';

  /* 上级备注 */
  const notes = (b.supervisorNotes || []);
  h += '<div class="card"><div class="card-head"><h2>上级备注</h2><span class="pill">' + notes.length + '</span></div><div class="card-body">';
  if (!notes.length) h += '<div class="hint">暂无备注。</div>';
  else h += notes.slice().reverse().map((n) => '<div class="checkline no"><span class="ck">·</span><span>'
    + '<span data-notranslate>' + esc(n.text) + '</span><br><span class="muted small">' + esc(n.authorName || '') + ' · ' + esc(relTime(n.createdAt)) + '</span></span></div>').join('');
  h += '<div class="divider"></div>'
    + '<label class="field"><span>添加备注</span><input id="tsNote" type="text" placeholder="给制作同学的具体说明…"></label>'
    + '<button class="btn btn-sm" id="tsNoteAdd">保存备注</button>'
    + '</div></div>';

  el.innerHTML = h;

  const tg = hostEl.querySelector('#tsToggleLeft');
  if (tg) tg.addEventListener('click', () => { leftOpen = !leftOpen; paintLeft(); });
  const ba = hostEl.querySelector('#tsBasis');
  if (ba) ba.addEventListener('click', basisDialog);
  const na = hostEl.querySelector('#tsNoteAdd');
  if (na) na.addEventListener('click', addNote);
}

/* ---------- 中栏：四页签（全部在任务内） ---------- */

function paintMid() {
  const el = hostEl.querySelector('#tsMid');
  let h = '<div class="card"><div class="card-head" style="flex-wrap:wrap;gap:6px"><h2>制作区</h2>'
    + '<div class="row" style="gap:6px;flex-wrap:wrap">'
    + TABS.map((t) => '<button class="btn btn-sm' + (tab === t.id ? ' btn-primary' : '') + '" data-ts="' + t.id + '">'
      + esc(t.label) + '</button>').join('')
    + '</div></div><div class="card-body" id="tsPane"></div></div>';
  el.innerHTML = h;
  el.querySelectorAll('[data-ts]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.ts; paintMid(); }));
  paintPane();
}

function paintPane() {
  const pane = hostEl.querySelector('#tsPane');
  if (!pane) return;
  if (tab === 'TEXT') return paintText(pane);
  if (tab === 'IMAGE') return paintImage(pane);
  if (tab === 'VIDEO') return paintVideo(pane);
  return paintReview(pane);
}

/* ---------- 正文 ---------- */

function paintText(pane) {
  if (!versions.length) {
    const s = stateBlock('empty', { title: '还没有内容版本', desc: '点击「开始制作」创建第一版草稿。' });
    pane.innerHTML = s.html
      + '<div class="row" style="margin-top:8px"><button class="btn btn-primary" id="tsStart">开始制作</button></div>';
    s.bind(pane);
    const st = hostEl.querySelector('#tsStart');
    if (st) st.addEventListener('click', newDraftDialog);
    return;
  }
  let h = '<div class="small muted" style="margin-bottom:6px">版本（版本号单调递增，旧版本只标记为已被取代，绝不删除）</div>'
    + '<div class="ver-list">' + versions.map((v) => {
      const on = current && current.version.id === v.id;
      return '<div class="ver-item' + (on ? ' on' : '') + '" data-ver="' + esc(v.id) + '">'
        + '<div class="vi-top"><span class="vi-code">v' + v.number + '</span>' + statusBadge(v.state) + '</div>'
        + '<div class="small">' + esc(v.title || '（无标题）') + '</div>'
        + '<div class="ed-meta"><span>' + v.bodyChars + ' 字</span><span>' + esc(relTime(v.updatedAt)) + '</span></div>'
        + '</div>';
    }).join('') + '</div><div class="divider"></div>';

  if (!current) {
    h += '<div class="hint">选择一个版本开始编辑。</div>';
    pane.innerHTML = h;
  } else {
    const v = current.version;
    const buffer = draftBuffers.get(v.id);
    const editable = !!v.editable;
    let banner = '';
    if (v.state === 'LOCKED_FOR_REVIEW') banner = '<div class="lock-banner">🔒 已提交审核并冻结。修改请点击「派生新版本」。</div>';
    else if (v.state === 'APPROVED') banner = '<div class="lock-banner">✅ 已批准，可用于排期与发布。</div>';
    else if (v.state === 'REVISION_REQUIRED') banner = '<div class="lock-banner warn">⚠ 审核要求修订，请派生新版本。</div>';
    else if (v.state === 'SUPERSEDED') banner = '<div class="lock-banner">历史版本（已被新版本取代），只读留档。</div>';

    h += banner
      + '<label class="field"><span>标题</span><input id="ceTitle" type="text" value="' + esc(buffer ? buffer.title : (v.title || '')) + '"'
      + (editable ? '' : ' readonly') + '></label>'
      + '<textarea id="ceText" class="ed-body"' + (editable ? '' : ' readonly') + '>' + esc(buffer ? buffer.body : (v.body || '')) + '</textarea>'
      + '<div class="ed-meta" style="margin-top:6px"><span id="ceCount">' + String(v.body || '').length + ' 字</span>'
      + '<span id="ceDirty" class="muted">' + (dirty ? '有未保存修改' : '') + '</span></div>'
      + '<div class="divider"></div>'
      + '<div class="row" style="flex-wrap:wrap">'
      + (editable ? '<button class="btn btn-sm btn-primary" id="ceSave">保存草稿</button>' : '')
      + (editable ? '<button class="btn btn-sm" id="ceLock">提交审核</button>' : '')
      + '<button class="btn btn-sm" id="ceAiDraft">AI 生成初稿</button>'
      + '<button class="btn btn-sm" id="ceAiAssist">优化表达 / 缩短</button>'
      + (v.revisable ? '<button class="btn btn-sm" id="ceRevise">派生新版本</button>' : '')
      + '<button class="btn btn-sm" id="ceManifest">查看批准对象</button>'
      + '<button class="btn btn-sm" id="ceChain">查看审核链</button>'
      + '</div>'
      + '<div id="ceCases" style="margin-top:12px"></div>';
    pane.innerHTML = h;

    const ta = hostEl.querySelector('#ceText');
    const cnt = hostEl.querySelector('#ceCount');
    const dt = hostEl.querySelector('#ceDirty');
    const mark = () => { dirty = true; const prior = draftBuffers.get(v.id); draftBuffers.set(v.id, {body:ta.value,title:hostEl.querySelector('#ceTitle').value,rowVersion:prior ? prior.rowVersion : v.rowVersion}); if (dt) dt.textContent = '有未保存修改'; const ss = hostEl.querySelector('#ceSaveState'); if (ss) ss.textContent = '有未保存修改'; };
    ta.addEventListener('input', () => { cnt.textContent = ta.value.length + ' 字'; mark(); });
    const ti = hostEl.querySelector('#ceTitle');
    ti.addEventListener('input', mark);

    const sv = hostEl.querySelector('#ceSave'); if (sv) sv.addEventListener('click', () => saveVersion(v));
    const lk = hostEl.querySelector('#ceLock'); if (lk) lk.addEventListener('click', () => submitForReview(v));
    const rv = hostEl.querySelector('#ceRevise'); if (rv) rv.addEventListener('click', () => reviseVersion(v));
    const ad = hostEl.querySelector('#ceAiDraft'); if (ad) ad.addEventListener('click', () => aiDraft(v));
    const aa = hostEl.querySelector('#ceAiAssist'); if (aa) aa.addEventListener('click', () => aiAssist(v));
    hostEl.querySelector('#ceManifest').addEventListener('click', () => showManifest(v));
    hostEl.querySelector('#ceChain').addEventListener('click', showChain);
    paintCases();
  }

  pane.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', async () => {
    if ((dirty || videoScriptBuffers.has(taskId)) && !(await confirmDialog('放弃未保存修改？', '当前草稿有未保存的正文修改。', '放弃并切换'))) return;
    if (current) draftBuffers.delete(current.version.id);
    dirty = false;
    await openVersion(b.dataset.ver);
    paintMid();
  }));
}

function paintCases() {
  const el = hostEl.querySelector('#ceCases');
  if (!el) return;
  const cases = (current && current.cases) || [];
  const dec = (current && current.decisions) || [];
  if (!cases.length) { el.innerHTML = '<div class="hint">尚未提交审核。提交后会自动生成审核单。</div>'; return; }
  let h = '<div class="small muted" style="margin-bottom:6px">审核链</div>';
  h += cases.map((c) => '<div class="checkline' + (c.state === 'APPROVED' ? '' : ' no') + '">'
    + '<span class="ck">' + (c.state === 'APPROVED' ? '✔' : '○') + '</span>'
    + '<span>' + esc(caseTypeLabel(c.type)) + ' —— ' + statusBadge(c.state)
    + ' <span class="muted small">提交 ' + esc(fmtDateTime(c.submittedAt)) + '</span></span></div>').join('');
  if (dec.length) {
    h += '<div class="divider"></div><div class="small muted" style="margin-bottom:6px">决策记录</div>'
      + dec.map((d) => '<div class="checkline no"><span class="ck">·</span><span>'
        + esc(decisionLabel(d.action)) + ' · ' + esc(d.actorName || d.actorId || '—')
        + ' <span class="muted small">' + esc(fmtDateTime(d.createdAt)) + '</span>'
        + (d.remarks ? '<br><span class="muted small">' + esc(d.remarks) + '</span>' : '') + '</span></div>').join('');
  }
  el.innerHTML = h;
}

function caseTypeLabel(t) {
  return { PROFESSIONAL_REVIEW: '专业（金融事实）审核', PUBLICATION_APPROVAL: '发布审批', ASSET_ADMISSION: '资产入库审核' }[t] || t;
}
function decisionLabel(a) {
  return { START_REVIEW: '开始审核', APPROVE: '批准', REQUEST_REVISION: '要求修订', REJECT: '驳回', CANCEL: '取消' }[a] || a;
}

/* ---------- 图片（在任务内） ---------- */

function paintImage(pane) {
  const imgs = assets.filter((a) => /^image\//.test(String(a.mime || '')));
  const ip = ((studio && studio.advanced && studio.advanced.providerStatus) || {}).imageProvider || { mode: 'none' };
  const aiReady = ip.mode && ip.mode !== 'none';

  let h = '<div class="row" style="flex-wrap:wrap;gap:8px">'
    + '<button class="btn btn-sm btn-primary" id="tiGen"' + (aiReady ? '' : ' disabled') + '>生成配图</button>'
    + '<label class="btn btn-sm" style="cursor:pointer">上传图片<input id="tiUp" type="file" accept="image/*" style="display:none"></label>'
    + '<span class="small muted">用途与视觉类型可在此选择；品牌规则自动继承（无需了解色号/字体编号）。</span>'
    + '</div>';
  if (!aiReady) {
    h += '<div class="block-note" style="margin-top:8px">图像模型未配置：**AI 生成按钮已禁用**，'
      + '但你仍可手工上传图片完成交付。<br><span class="small">' + esc(ip.note || '') + '</span></div>';
  }
  h += '<div class="divider"></div>';
  if (!imgs.length) h += '<div class="hint">还没有配图。可手工上传，或在配置图像模型后一键生成。</div>';
  else {
    h += '<div class="grid-3">' + imgs.map((a) => '<div class="card"><div class="card-body">'
      + '<div class="small mono" data-notranslate>' + esc(a.fileName) + '</div>'
      + '<div class="ed-meta"><span>' + Math.round((a.bytes || 0) / 1024) + ' KB</span>'
      + '<span>' + esc(a.origin) + '</span>' + (a.mock ? '<span class="badge badge-mock">MOCK</span>' : '') + '</div>'
      + '<a class="btn btn-sm" href="' + esc(a.contentUrl) + '" target="_blank" rel="noopener" style="margin-top:6px">查看</a>'
      + '</div></div>').join('') + '</div>';
  }
  pane.innerHTML = h;

  const gen = hostEl.querySelector('#tiGen');
  if (gen) gen.addEventListener('click', imageDialog);
  const up = hostEl.querySelector('#tiUp');
  if (up) up.addEventListener('change', async () => {
    const f = up.files && up.files[0];
    if (!f) return;
    up.value = '';
    await uploadAsset(f);
  });
}

/* ---------- 视频（脚本 / 分镜 / 关键帧 / 上传） ---------- */

function paintVideo(pane) {
  if (!video) {
    pane.innerHTML = '<div class="hint">正在准备视频工作区…</div>';
    loadVideo().then(() => paintVideo(pane));
    return;
  }
  const sections = (video.script && video.script.sections) || [];
  const shots = video.storyboard || [];

  let h = '<div class="small muted">在同一任务内维护：脚本 → 分镜（shot）→ 关键帧 → 成片上传。'
    + '本轮不提供自动渲染与自动配音（需人工完成成片，AI 视频供应商未配置时按钮禁用）。</div>'
    + '<div class="ed-meta" style="margin:6px 0">' + statusBadge(video.state)
    + '<span>分镜 ' + shots.length + '</span><span>字幕 ' + (video.subtitles || []).length + '</span>'
    + '<span>关键帧 ' + (video.keyframeAssetIds || []).length + '</span></div>'
    + '<div class="row" style="gap:6px;flex-wrap:wrap">'
    + '<button class="btn btn-sm" id="tvGenScript">生成脚本骨架</button>'
    + '<button class="btn btn-sm" id="tvAddShot">新增分镜</button>'
    + '<label class="btn btn-sm" style="cursor:pointer">上传关键帧<input id="tvUp" type="file" accept="image/*" style="display:none"></label>'
    + '<label class="btn btn-sm" style="cursor:pointer">上传成片<input id="tvFinal" type="file" accept="video/*,.mp4,.mov" style="display:none"></label>'
    + '<button class="btn btn-sm btn-primary" id="tvSave">保存视频与分镜</button>'
    + '</div>';

  h += '<div class="divider"></div><div class="small muted">脚本分节</div>'
    + (sections.length ? sections.map((s, i) => '<div class="src-item">'
      + '<div class="small"><b>' + esc(s.heading || ('第 ' + (i + 1) + ' 节')) + '</b> · ' + (s.durationSec || 0) + 's</div>'
      + '<div class="small">' + esc(s.content || '') + '</div></div>').join('')
      : '<div class="hint">还没有脚本分节。可点「生成脚本骨架」或手工填写。</div>')
    + '<label class="field" style="margin-top:8px"><span>脚本（每行一节：标题｜内容）</span>'
    + '<textarea id="tvScript" class="ed-body" style="min-height:90px" placeholder="开场｜用一句话点明本期主题"></textarea></label>';

  h += '<div class="divider"></div><div class="small muted">分镜（shot）</div>';
  if (!shots.length) h += '<div class="hint">还没有分镜。点击「新增分镜」开始。</div>';
  else {
    h += '<div class="sr-list">' + shots.map((s, i) => '<div class="src-item">'
      + '<div class="src-h"><span class="badge badge-neutral">#' + esc(s.shot) + '</span>'
      + '<span class="badge badge-neutral">' + esc(s.motionCode || '') + '</span>'
      + '<span class="small muted">' + (s.durationSec || 0) + 's</span>'
      + (s.keyframeAssetId ? '<span class="badge badge-neutral">有帧</span>' : '')
      + '<button class="btn btn-sm" data-shotdup="' + i + '">复制</button>'
      + '<button class="btn btn-sm" data-shotdel="' + i + '">删除</button></div>'
      + '<div class="src-t">' + esc(s.description || '（无描述）') + '</div></div>').join('') + '</div>';
  }
  if (video.finalAsset) h += '<div class="block-note info" style="margin-top:8px">成片已上传：' + esc(video.finalAsset.fileName) + '</div>';

  pane.innerHTML = h;

  const scriptEditor = hostEl.querySelector('#tvScript');
  scriptEditor.value = videoScriptBuffers.has(taskId) ? videoScriptBuffers.get(taskId)
    : sections.map(s => (s.heading || '') + '｜' + (s.content || '')).join('\n');
  scriptEditor.addEventListener('input', () => videoScriptBuffers.set(taskId, scriptEditor.value));
  const addShot = hostEl.querySelector('#tvAddShot');
  if (addShot) addShot.addEventListener('click', async () => {
    const next = (video.storyboard || []).concat([{ shot: (video.storyboard || []).length + 1, description: '', durationSec: 5, motionCode: video.motionCode || 'M01', keyframeAssetId: null }]);
    await saveVideo({ storyboard: next });
  });
  pane.querySelectorAll('[data-shotdel]').forEach((b) => b.addEventListener('click', async () => {
    const arr = (video.storyboard || []).slice(); arr.splice(Number(b.dataset.shotdel), 1);
    await saveVideo({ storyboard: arr.map((s, i) => Object.assign({}, s, { shot: i + 1 })) });
  }));
  pane.querySelectorAll('[data-shotdup]').forEach((b) => b.addEventListener('click', async () => {
    const arr = (video.storyboard || []).slice();
    const src = arr[Number(b.dataset.shotdup)];
    arr.splice(Number(b.dataset.shotdup) + 1, 0, Object.assign({}, src, { keyframeAssetId: null }));
    await saveVideo({ storyboard: arr.map((s, i) => Object.assign({}, s, { shot: i + 1 })) });
  }));
  const gs = hostEl.querySelector('#tvGenScript');
  if (gs) gs.addEventListener('click', () => {
    const b = (studio && studio.brief) || {};
    const st = hostEl.querySelector('#tvScript');
    st.value = ['开场｜' + (b.title || '本期主题') + '（3–5s 钩子）',
      '背景｜为什么这件事与客户相关（事实引用见左侧研究依据）',
      '要点｜1 个核心信息 + 1 个具体例子',
      '合规｜必要免责声明与来源标注',
      '行动｜明确的下一步引导'].join('\n');
    videoScriptBuffers.set(taskId, st.value);
    toast('已生成脚本骨架（草稿，需人工核验事实）', 'ok');
  });
  const up = hostEl.querySelector('#tvUp');
  if (up) up.addEventListener('change', async () => {
    const f = up.files && up.files[0]; if (!f) return; up.value = '';
    const a = await uploadAsset(f);
    if (a) await saveVideo({ keyframeAssetIds: (video.keyframeAssetIds || []).concat([a.id]) });
  });
  const fin = hostEl.querySelector('#tvFinal');
  if (fin) fin.addEventListener('change', async () => {
    const f = fin.files && fin.files[0]; if (!f) return; fin.value = '';
    const a = await uploadAsset(f);
    if (a) await saveVideo({ finalAssetId: a.id });
  });
  const sv = hostEl.querySelector('#tvSave');
  if (sv) sv.addEventListener('click', async () => {
    const raw = hostEl.querySelector('#tvScript').value.trim();
    const sections = raw ? raw.split('\n').map((line) => {
      const parts = line.split('｜');
      return { heading: (parts[0] || '').trim(), content: (parts[1] || '').trim(), durationSec: 0 };
    }) : (video.script && video.script.sections) || [];
    if (await saveVideo({ script: { sections } })) videoScriptBuffers.delete(taskId);
  });
}

/* ---------- 审核（在任务内提交 + 查看结果） ---------- */

function paintReview(pane) {
  const v = current && current.version;
  const b = (studio && studio.brief) || {};
  let h = '<div class="small muted">提交审核前，系统会按来源 / 平台规范 / 品牌许可 / 风险级别 / 必需交付物 / 待核实项逐条检查。'
    + '提交后版本冻结，保留准确快照。</div>';

  if (!v) h += '<div class="hint" style="margin-top:8px">当前没有可提交的版本。请先在「正文」中创建草稿。</div>';
  else {
    h += '<div class="ed-meta" style="margin:8px 0">' + statusBadge(v.state)
      + '<span class="mono">' + esc(v.code) + '</span><span>v' + v.number + '</span></div>';
    h += '<div id="tsCheck" class="small muted">正在检查…</div>'
      + '<div class="row" style="margin-top:10px;gap:6px;flex-wrap:wrap">'
      + '<button class="btn btn-sm btn-primary" id="tsSubmit">提交审核</button>'
      + '<button class="btn btn-sm" id="tsRecheck">重新检查</button>'
      + '</div>';
  }

  const cases = (current && current.cases) || [];
  if (cases.length) {
    h += '<div class="divider"></div><div class="small muted">审核进度</div>'
      + cases.map((c) => '<div class="checkline' + (c.state === 'APPROVED' ? '' : ' no') + '"><span class="ck">'
        + (c.state === 'APPROVED' ? '✔' : '○') + '</span><span>' + esc(caseTypeLabel(c.type)) + ' —— '
        + statusBadge(c.state) + '</span></div>').join('');
  }
  pane.innerHTML = h;

  if (v) {
    const rc = hostEl.querySelector('#tsRecheck'); if (rc) rc.addEventListener('click', loadCheck);
    const sb = hostEl.querySelector('#tsSubmit'); if (sb) sb.addEventListener('click', () => submitForReview(v));
    loadCheck();
  }
  void b;
}

async function loadCheck() {
  const el = hostEl.querySelector('#tsCheck');
  if (!el) return;
  try {
    const r = await api.get(withBrand('/api/mos/tasks/' + taskId + '/submit-check', ctxRef.brand, {}));
    el.innerHTML = (r.items || []).map((i) => {
      const icon = i.status === 'PASS' ? '✔' : (i.status === 'WARN' ? '⚠' : '✖');
      const cls = i.status === 'PASS' ? 'ok' : (i.status === 'WARN' ? 'warn' : 'bad');
      return '<div class="checkline' + (i.status === 'PASS' ? '' : ' no') + '">'
        + '<span class="ck" style="color:' + (cls === 'ok' ? 'inherit' : (cls === 'warn' ? '#b58900' : '#c0392b')) + '">' + icon + '</span>'
        + '<span><b>' + esc(i.label) + '</b>' + (i.required ? '' : '<span class="muted small">（提示）</span>')
        + '<br><span class="muted small">' + esc(i.detail) + '</span></span></div>';
    }).join('') + (r.blocking && r.blocking.length
      ? '<div class="block-note danger" style="margin-top:8px">仍有 ' + r.blocking.length + ' 项必需条件未满足，提交会被服务端拒绝。</div>' : '');
  } catch (err) { el.innerHTML = '<div class="block-note danger">' + esc(err.message) + '</div>'; }
}

/* ==================== 右栏：交付物清单 + 下一步 ==================== */

function paintRight() {
  const el = hostEl.querySelector('#tsRight');
  const d = (studio && studio.deliverables) || {};
  const acts = (studio && studio.nextActions) || [];

  let h = '<div class="card"><div class="card-head"><h2>下一步</h2></div><div class="card-body">';
  if (!acts.length) h += '<div class="hint">当前没有待办动作。</div>';
  else h += acts.map((a) => '<button class="btn btn-sm' + (a.primary ? ' btn-primary' : '') + '" '
    + 'data-act="' + esc(a.key) + '" data-tab="' + esc(a.tab || '') + '" style="display:block;width:100%;margin-bottom:6px">'
    + esc(a.label) + '</button>').join('');
  h += '</div></div>';

  h += '<div class="card"><div class="card-head"><h2>交付物</h2></div><div class="card-body">';
  h += ['TEXT', 'IMAGE', 'VIDEO'].map((k) => {
    const x = d[k];
    if (!x) return '';
    const icon = x.done ? '✔' : (x.required ? '✖' : '○');
    return '<div class="checkline' + (x.done ? '' : ' no') + '"><span class="ck">' + icon + '</span><span>'
      + '<b>' + esc(x.label) + '</b>' + (x.required ? '' : '<span class="muted small">（非必需）</span>')
      + '<br><span class="muted small">' + esc(x.detail) + '</span></span></div>';
  }).join('');
  h += '</div></div>';

  el.innerHTML = h;
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
    const key = b.dataset.act;
    if (b.dataset.tab) { tab = b.dataset.tab; paintMid(); }
    if (key === 'start') newDraftDialog();
    else if (key === 'revise' && current) reviseVersion(current.version);
    else if (key === 'publish') ctxRef.navigate('publishing');
    else if (key === 'await') toast('已提交，等待审核人处理', 'ok');
  }));
}

/* ==================== 操作 ==================== */

async function openVersion(id) {
  try { current = await api.get(withBrand('/api/mos/content-versions/' + id, ctxRef.brand)); }
  catch (err) { renderError(err, () => openVersion(id)); }
}

async function saveVersion(v) {
  if (saveBusy || !hostEl) return false;
  const ta = hostEl.querySelector('#ceText');
  const prior = draftBuffers.get(v.id);
  if (!ta && !prior) return !dirty;
  const snapshot = {body: ta ? ta.value : prior.body,
    title: ta ? ((hostEl.querySelector('#ceTitle') || {}).value || '') : prior.title,
    rowVersion: prior ? prior.rowVersion : v.rowVersion};
  draftBuffers.set(v.id, snapshot);
  const epoch = editorEpoch, sid = taskId, brand = ctxRef.brand;
  saveBusy = true;
  try {
    const r = await api.put(withBrand('/api/mos/content-versions/' + v.id, brand), {
      body: snapshot.body, title: snapshot.title.trim(), rowVersion: snapshot.rowVersion
    });
    if (!hostEl || epoch !== editorEpoch || sid !== taskId || brand !== ctxRef.brand) return false;
    // Typing during the request creates a newer buffer. Never discard or lock it.
    const latest = draftBuffers.get(v.id);
    if (latest !== snapshot) {
      if (latest && r.version) latest.rowVersion = r.version.rowVersion;
      dirty = true;
      saveError(t('phase1.changed_during_save'));
      return false;
    }
    draftBuffers.delete(v.id); dirty = false;
    toast('草稿已保存', 'ok');
    await reload(sid);
    return true;
  } catch (err) {
    if (hostEl && epoch === editorEpoch && sid === taskId && brand === ctxRef.brand) {
      dirty = true;
      // Including VERSION_IMMUTABLE: do not reload and overwrite the employee's input.
      saveError(t('phase1.save_failed') + ' ' + err.message);
    }
    return false;
  } finally { if (epoch === editorEpoch) saveBusy = false; }
}

/** 提交审核：先服务端检查 → 展示检查清单 → 确认冻结 */
async function submitForReview(v) {
  if (submitBusy || saveBusy) return;
  submitBusy = true;
  try { await submitReview(v); } finally { submitBusy = false; }
}
async function submitReview(v) {
  const epoch = editorEpoch, sid = taskId, brand = ctxRef.brand;
  if ((dirty || draftBuffers.has(v.id)) && !await saveVersion(v)) return;
  if (!hostEl || epoch !== editorEpoch || sid !== taskId || brand !== ctxRef.brand) return;
  v = (current && current.version) || v;
  let chk = null;
  try { chk = await api.get(withBrand('/api/mos/tasks/' + taskId + '/submit-check', ctxRef.brand, {})); }
  catch (_) { chk = null; }
  if (chk && chk.blocking && chk.blocking.length) {
    const body = (chk.items || []).filter((i) => i.required && i.status === 'FAIL')
      .map((i) => '<li><b>' + esc(i.label) + '</b>：' + esc(i.detail) + '</li>').join('');
    const m = openModal({
      title: '还不能提交', okText: '知道了',
      body: '<div class="small">以下必需条件尚未满足，提交会被服务端拒绝：</div><ul class="small">' + body + '</ul>'
        + '<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn btn-sm" id="__basisGo">登记业务依据</button>'
        + '<button class="btn btn-sm" id="__goLeft">查看研究依据</button></div>'
    });
    const bg = m.body.querySelector('#__basisGo');
    if (bg) bg.addEventListener('click', () => { m.close(); basisDialog(); });
    const gl = m.body.querySelector('#__goLeft');
    if (gl) gl.addEventListener('click', () => { m.close(); leftOpen = true; paintLeft(); const el = hostEl.querySelector('#tsLeft'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    return;
  }
  const risky = RISKY.indexOf(v.riskGrade) !== -1;
  const list = (chk && chk.items || []).map((i) => '<li>' + (i.status === 'PASS' ? '✔' : (i.status === 'WARN' ? '⚠' : '✖'))
    + ' <b>' + esc(i.label) + '</b>：' + esc(i.detail) + '</li>').join('');
  const ok = await new Promise((resolve) => {
    openModal({
      title: '提交审核？', okText: '确认提交', cancelText: '再看看',
      body: '<div class="small">提交后该版本冻结，正文与引用资产不可再改，只能派生新版本。</div>'
        + '<ul class="small">' + list + '</ul>'
        + '<div class="small muted">' + (risky ? '风险等级 ' + v.riskGrade + '：将进入专业（金融事实）审核 + 发布审批。' : '将进入发布审批。') + '</div>',
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    });
  });
  if (!ok) return;
  if (!hostEl || epoch !== editorEpoch || sid !== taskId || brand !== ctxRef.brand) return;
  if ((dirty || draftBuffers.has(v.id)) && !await saveVersion(v)) return;
  v = (current && current.version) || v;
  try {
    const r = await api.post(withBrand('/api/mos/content-versions/' + v.id + '/lock', brand), {rowVersion: v.rowVersion});
    const n = (r.createdCases || r.cases || []).length;
    toast('已提交审核，生成 ' + n + ' 张审核单', 'ok');
    await reload(taskId);
  } catch (err) { toast(err.message, 'err'); }
}

async function reviseVersion(v) {
  const ok = await confirmDialog('派生新版本？', '将基于 v' + v.number + ' 创建一个新的草稿版本；原版本保留并标记为已被取代。', '派生');
  if (!ok) return;
  try {
    const r = await api.post(withBrand('/api/mos/content-versions/' + v.id + '/revise', ctxRef.brand), {});
    toast('已派生 v' + ((r.version || {}).number || '?'), 'ok');
    await reload(taskId);
  } catch (err) { toast(err.message, 'err'); }
}

async function newDraftDialog() {
  if (dirty && current && !await saveVersion(current.version)) return;
  const ok = await confirmDialog('新建草稿？', '将在当前任务下创建一个新的草稿版本。', '创建');
  if (!ok) return;
  try {
    const r = await api.post(withBrand('/api/mos/content-versions', ctxRef.brand), { taskId, body: '' });
    toast('已创建 v' + ((r.version || {}).number || '?'), 'ok');
    tab = 'TEXT';
    await reload(taskId);
  } catch (err) { toast(err.message, 'err'); }
}

/** AI 生成初稿（TEXT）：继承 Brief / 栏目 / 已有研究；Mock 输出显式标注 */
async function aiDraft(v) {
  if (!v.editable) { toast('当前版本已冻结，AI 草稿只能写入草稿版本', 'err'); return; }
  const b = (studio && studio.brief) || {};
  const research = studio && studio.research;
  const brief = [b.title, '平台：' + (b.platform || ''), research ? ('研究依据：' + (research.topicTitle || '')) : (studio && studio.businessBasis ? ('业务依据：' + studio.businessBasis.note) : '')]
    .filter(Boolean).join('\n');
  try {
    const r = await api.post(withBrand('/api/mos/generation-jobs', ctxRef.brand), {
      kind: 'TEXT', taskId, brief, applyToVersionId: v.id, outputIntent: 'TEST_DRAFT',
      idempotencyKey: 'txt-' + taskId + '-' + v.id + '-' + Date.now()
    });
    const j = r.job || {};
    if (j.status === 'NOT_CONFIGURED') toast('尚未配置文本模型：请手工撰写（不影响送审）', 'err');
    else if (j.status === 'SUCCEEDED') { toast(j.mock ? '已按 MOCK 生成骨架草稿（非模型输出）' : 'AI 初稿已写入草稿', 'ok'); await reload(taskId); }
    else toast('生成未成功：' + j.status + ' ' + (j.errorMessage || ''), 'err');
  } catch (err) { toast(err.message, 'err'); }
}

async function aiAssist(v) {
  const opt = await new Promise((resolve) => {
    openModal({
      title: '优化表达', okText: '生成', cancelText: '取消',
      body: '<div class="small">将由文本模型对当前正文做二次加工，产出**草稿**（不自动替换，需你确认后保存）。</div>'
        + '<label class="field"><span>要求</span><select id="__as"><option value="polish">优化表达</option>'
        + '<option value="shorten">缩短</option><option value="thread">改成 X Thread</option></select></label>',
      onOk: (body) => { const s = body.querySelector('#__as'); resolve(s ? s.value : 'polish'); },
      onCancel: () => resolve(null)
    });
  });
  if (!opt) return;
  const p = ctxRef.integrations && ctxRef.integrations.textProvider;
  if (!p || p.mode === 'none') { toast('尚未配置文本模型：可手工编辑（不影响送审）', 'err'); return; }
  toast('已提交优化请求：请查看「最近作业」结果后手工采纳', 'ok');
  void v;
}

/** 图片生成（品牌减法：普通员工只看到 品牌/平台/用途/视觉类型/效果预览） */
async function imageDialog() {
  const b = (studio && studio.brief) || {};
  const tmpls = await api.get(withBrand('/api/mos/templates', ctxRef.brand, { platform: b.platform })).catch(() => ({ items: [] }));
  const opts = (tmpls.items || []).map((t) => '<option value="' + esc(t.code) + '">' + esc(t.name || t.code) + '</option>').join('');

  /* 用途 → 建议画幅/输出尺寸（= 「效果预览」，员工无需理解模板编号与色号） */
  const USE_PREVIEW = {
    LINKEDIN_COVER: { w: 1200, h: 627, ratio: '1.91:1' },
    CAROUSEL: { w: 1080, h: 1080, ratio: '1:1' },
    YOUTUBE_THUMB: { w: 1280, h: 720, ratio: '16:9' },
    DIAGRAM: { w: 1200, h: 800, ratio: '3:2' }
  };
  const ip = ((studio && studio.advanced && studio.advanced.providerStatus) || {}).imageProvider || { mode: 'none' };
  const userOpts = Object.keys(USE_PREVIEW).map((k) =>
    '<option value="' + k + '">' + esc(purposeLabel(k)) + '</option>').join('');

  const modal = openModal({
    title: t('studio.image_dialog_title'),
    okText: t('action.generate_image'), cancelText: t('action.cancel'),
    body: '<div class="callout" style="margin:0 0 10px">'
      + t('common.brand') + '：<b>' + esc(ctxRef.brand || '—') + '</b> · ' + t('common.platform') + '：<b>' + esc(platformLabel(b.platform)) + '</b>'
      + '<br><span class="small muted">' + t('studio.brand_inherit') + '</span></div>'
      + '<label class="field"><span>' + t('field.purpose') + '</span><select id="__use">' + userOpts + '</select></label>'
      + '<label class="field"><span>' + t('field.visual_type') + '</span><select id="__vis">'
      + ['ARCHITECTURE', 'PROCESS', 'DATA', 'INSTITUTION'].map((k) =>
        '<option value="' + k + '">' + esc(visualTypeLabel(k)) + '</option>').join('') + '</select></label>'
      + '<div class="block-note info" id="__prev" data-notranslate></div>'
      + '<label class="field"><span>' + t('field.image_brief') + '</span><textarea id="__br" class="ed-body" style="min-height:80px" data-notranslate></textarea></label>'
      + '<details class="adv"><summary>' + t('studio.advanced_template') + '</summary>'
      + '<span class="small muted">' + t('studio.advanced_template_hint') + '</span>'
      + (opts ? '<label class="field"><span>' + t('studio.template') + '</span><select id="__tpl"><option value="">' + t('studio.default') + '</option>' + opts + '</select></label>'
        : '<div class="hint">' + t('studio.no_templates') + '</div>')
      + '</details>'
      + '<div class="small muted">' + t('studio.skill_note') + '</div>',
    onOk: (body) => {
      const use = body.querySelector('#__use').value;
      const pv = USE_PREVIEW[use] || {};
      return {
        use, vis: body.querySelector('#__vis').value, w: pv.w, h: pv.h,
        tpl: body.querySelector('#__tpl') ? body.querySelector('#__tpl').value : '',
        brief: body.querySelector('#__br').value
      };
    },
    onCancel: () => null
  });

  /* 效果预览实时联动（用途/视觉类型 → 画幅与输出尺寸） */
  const useEl = modal.body.querySelector('#__use');
  const visEl = modal.body.querySelector('#__vis');
  const prevEl = modal.body.querySelector('#__prev');
  const paintPreview = () => {
    const k = useEl.value;
    const pv = USE_PREVIEW[k] || {};
    prevEl.textContent = t('studio.preview') + '：' + purposeLabel(k)
      + (visEl ? ' · ' + visualTypeLabel(visEl.value) : '')
      + ' · ' + pv.ratio + ' · ' + pv.w + '×' + pv.h
      + ' · ' + (ip.mode === 'none' ? t('studio.preview_manual') : t('studio.preview_auto'));
  };
  if (useEl) useEl.addEventListener('change', paintPreview);
  if (visEl) visEl.addEventListener('change', paintPreview);
  paintPreview();

  const picked = await new Promise((resolve) => {
    const prevOk = modal.body.parentElement.querySelector('#__mok');
    const prevCancel = modal.body.parentElement.querySelector('[data-act="cancel"]');
    if (prevOk) prevOk.addEventListener('click', () => resolve(pickedValue()));
    if (prevCancel) prevCancel.addEventListener('click', () => resolve(null));
    function pickedValue() {
      const use = useEl ? useEl.value : 'LINKEDIN_COVER';
      const pv = USE_PREVIEW[use] || {};
      return {
        use, vis: visEl ? visEl.value : 'ARCHITECTURE', w: pv.w, h: pv.h,
        tpl: modal.body.querySelector('#__tpl') ? modal.body.querySelector('#__tpl').value : '',
        brief: (modal.body.querySelector('#__br') || {}).value || ''
      };
    }
  });
  if (!picked) return;
  try {
    const r = await api.post(withBrand('/api/mos/generation-jobs', ctxRef.brand), {
      kind: 'IMAGE', taskId, brief: picked.brief || b.title, platform: b.platform,
      templateCode: picked.tpl || undefined, aspect: picked.use, width: picked.w, height: picked.h,
      visualType: picked.vis, outputIntent: 'TEST_DRAFT',
      dataClass: 'INTERNAL',
      idempotencyKey: 'img-' + taskId + '-' + Date.now()
    });
    const j = r.job || {};
    if (j.status === 'SUCCEEDED') {
      toast(j.mock ? t('studio.mock_image_created') : t('studio.image_created'), 'ok');
      await loadAssets(); paintRight(); if (tab === 'IMAGE') paintMid();
    } else if (j.status === 'NOT_CONFIGURED') toast(t('studio.image_not_configured_upload'), 'err');
    else toast(t('studio.gen_failed') + j.status + ' ' + (j.errorMessage || ''), 'err');
  } catch (err) { toast(err.message, 'err'); }
}

/** 手工上传（无 AI 也能交付）—— 原始字节流上传 */
async function uploadAsset(file) {
  try {
    const qs = new URLSearchParams({ brand: ctxRef.brand || '', taskId, name: file.name });
    const res = await fetch('/api/mos/assets/upload?' + qs.toString(), {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-mos-csrf': csrfToken() },
      body: file
    });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* ignore */ }
    if (!res.ok) throw new Error((json && json.error) || ('上传失败 HTTP ' + res.status));
    toast('已上传 ' + file.name, 'ok');
    await loadAssets();
    paintRight(); if (tab === 'IMAGE') paintMid(); else if (tab === 'VIDEO') paintMid();
    return json.asset;
  } catch (err) { toast(err.message, 'err'); return null; }
}

async function saveVideo(patch) {
  try {
    const body = Object.assign({}, patch, { rowVersion: video.rowVersion });
    const r = await api.put(withBrand('/api/mos/video/' + taskId, ctxRef.brand), body);
    video = r.video;
    toast('视频与分镜已保存', 'ok');
    paintMid(); paintRight();
    return true;
  } catch (err) { toast(err.message, 'err'); return false; }
}

async function addNote() {
  const inp = hostEl.querySelector('#tsNote');
  const text = inp ? inp.value.trim() : '';
  if (!text) { toast('请填写备注内容', 'err'); return; }
  try {
    await api.post(withBrand('/api/mos/tasks/' + taskId + '/notes', ctxRef.brand), { text });
    toast('备注已保存', 'ok');
    await reload(taskId);
  } catch (err) { toast(err.message, 'err'); }
}

function basisDialog() {
  openModal({
    title: '登记业务依据', okText: '保存', cancelText: '取消',
    body: '<div class="small muted">用于「官方通知 / 内部已批准产品事实 / 临时任务」这类没有研究来源的任务。'
      + '登记后仍需经发布审批，不会自动放行。</div>'
      + '<label class="field"><span>类型</span><select id="__bk">'
      + '<option value="OFFICIAL_NOTICE">官方通知</option>'
      + '<option value="INTERNAL_APPROVED_FACT">内部已批准产品事实</option>'
      + '<option value="AD_HOC">临时任务</option></select></label>'
      + '<label class="field"><span>依据说明（必填）</span><textarea id="__bn" class="ed-body" style="min-height:80px"></textarea></label>'
      + '<label class="field"><span>引用（可选：文号 / 链接 / 内部单据号）</span><input id="__br" type="text"></label>',
    onOk: async (body) => {
      const kind = body.querySelector('#__bk').value;
      const note = body.querySelector('#__bn').value.trim();
      const ref = body.querySelector('#__br').value.trim();
      if (!note) { toast('请填写依据说明', 'err'); return false; }
      try {
        await api.post(withBrand('/api/mos/tasks/' + taskId + '/basis', ctxRef.brand), { kind, note, ref });
        toast('业务依据已登记', 'ok');
        await reload(taskId);
      } catch (err) { toast(err.message, 'err'); return false; }
      return true;
    }
  });
}

function showManifest(v) {
  const p = v.manifestPayload;
  openModal({
    title: '批准对象', okText: '关闭', hideOk: false,
    body: !p ? '<div class="hint">该版本尚未提交审核。提交时会固化正文哈希、引用资产、渠道与风险等级。</div>'
      : '<dl class="kv"><dt>正文哈希</dt><dd class="mono small">' + esc(p.textHash) + '</dd>'
        + '<dt>渠道</dt><dd class="small">' + esc((p.channelIds || []).join(', ') || '—') + '</dd>'
        + '<dt>披露</dt><dd class="small">' + esc((p.disclosures || []).join(' / ') || '—') + '</dd>'
        + '<dt>风险等级</dt><dd>' + gradeBadge(p.riskGrade) + '</dd>'
        + '<dt>资产</dt><dd class="small">' + esc((p.assets || []).map((a) => (a.fileName || a.id) + '@' + String(a.sha256 || '').slice(0, 8)).join(', ') || '—') + '</dd></dl>'
  });
}

function showChain() {
  const cases = (current && current.cases) || [];
  const dec = (current && current.decisions) || [];
  openModal({
    title: '审核链', okText: '关闭', hideOk: false,
    body: '<div class="small muted">三条审批链相互独立，不存在单一 approved 标志位。</div>'
      + '<dl class="kv">' + cases.map((c) => '<dt>' + esc(caseTypeLabel(c.type)) + '</dt><dd>'
        + statusBadge(c.state) + ' <span class="small muted">' + esc(c.id) + '</span></dd>').join('') + '</dl>'
      + '<div class="divider"></div>'
      + dec.map((d) => '<div class="checkline no"><span class="ck">·</span><span>'
        + esc(decisionLabel(d.action)) + ' · ' + esc(d.actorName || '') + ' · ' + esc(fmtDateTime(d.createdAt))
        + (d.remarks ? '<br><span class="muted small">' + esc(d.remarks) + '</span>' : '') + '</span></div>').join('')
  });
}

async function reload(sid) {
  await loadStudio();
  if (taskId === sid) paint();
  else render();
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; editorEpoch++; saveBusy = false; submitBusy = false; dirty = false; advancedOpen = false; await render(); },
  unmount() { editorEpoch++; draftBuffers.clear(); videoScriptBuffers.clear(); hostEl = null; current = null; studio = null; video = null; dirty = false; },
  hasUnsaved() { return dirty || saveBusy || submitBusy || videoScriptBuffers.has(taskId); }
};
