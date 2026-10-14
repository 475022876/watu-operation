/* Content Editor —— 内容编辑器（W04-01 / 03 §2.2 版本冻结）。
 *
 * 三栏：左（任务 Brief / 证据引用 / 披露） | 中（版本列表 + 正文编辑器） | 右（AI 助手）。
 *
 * 真实操作与持久化（用户指令：不允许仅制作展示界面）：
 *   - 新建草稿 / 编辑保存 / 冻结送审 / 派生新版本，全部落到 /api/mos/content-versions；
 *   - 冻结后正文只读（服务端 EDITABLE_STATES 强制，前端同步表现，不做"看起来能改"的假 UI）；
 *   - AI 助手走 /api/mos/prompt-preview 与 /api/mos/generation-jobs，Mock 输出显式标注 MOCK。
 */
import { api, withBrand } from '../api.js';
import {
  esc, toast, openModal, confirmDialog, loadingHtml, stateBlock, statusBadge, gradeBadge,
  platformLabel, demoBadge, dictOptions, fmtDateTime, relTime
} from '../ui.js';

let ctxRef = null; let hostEl = null;
let taskId = '';          // 当前任务
let tasks = [];
let versions = [];
let current = null;       // 当前版本的详情响应（{version, cases, decisions, assets, evidence, channels}）
let dirty = false;
let assistants = null;    // { skills, usability, templates } 缓存

const RISKY = ['G2', 'G3'];

function bodyEl() { return hostEl.querySelector('#mosBody') || hostEl; }
function setBody(html) { bodyEl().innerHTML = html; }

/** 统一的错误渲染：区分「无权」与「故障」，并给出可点的重试 */
function renderError(err, retry) {
  const kind = err.status === 403 || err.status === 404 ? 'denied' : (err.status === 409 ? 'pending' : 'error');
  const s = stateBlock(kind, {
    title: err.status === 403 ? '权限不足' : (err.status === 404 ? '无权访问该品牌' : '加载失败'),
    desc: err.message,
    actions: retry ? [{ label: '重试', primary: true, onClick: retry }] : []
  });
  setBody(s.html); s.bind(bodyEl());
}

/* ==================== 页面骨架 ==================== */

function head() {
  /* V0.1.2 Phase C：任务工作空间四标签（04 §一个任务工作空间）。
   * Brief 与 Content 为本页两栏（左 Brief / 中正文）；Visuals & Video、Review & Delivery
   * 跳转到既有专用模块（visual / reviews），不在本页复制第二套功能。 */
  const wsTab = (id, label, active) => '<button class="btn btn-sm' + (active ? ' btn-primary' : '') + '" data-ws="' + id + '">' + label + '</button>';
  return '<div class="page-head"><div class="crumb">创意工作室 / 内容编辑器</div>'
    + '<div class="ph-row"><h1>内容编辑器</h1>'
    + '<div class="ph-actions">'
    + '<button class="btn btn-sm" id="ceRefresh">刷新</button>'
    + '<button class="btn btn-sm btn-primary" id="ceNew">新建草稿版本</button>'
    + '</div></div>'
    + '<div class="row" style="gap:6px;flex-wrap:wrap;margin:-4px 0 10px" id="wsTabs">'
    + wsTab('brief', '任务要求 Brief')
    + wsTab('content', '内容制作 Content', true)
    + wsTab('visual', '图片与视频 Visuals & Video')
    + wsTab('review', '审核与交付 Review & Delivery')
    + '</div>'
    + '<div class="ph-desc">版本一旦送审即冻结：正文与引用资产不可再改，只能派生新版本。'
    + '批准对象由 Manifest 哈希绑定，事后改动会导致审批失败（SEC-02）。</div></div>';
}

async function render() {
  hostEl.innerHTML = head() + '<div id="mosBody">' + loadingHtml() + '</div>';
  try {
    const r = await api.get(withBrand('/api/mos/tasks', ctxRef.brand, {}));
    tasks = r.items || [];
  } catch (err) { renderError(err, render); return; }

  if (!tasks.length) {
    const s = stateBlock('empty', { title: '当前品牌还没有内容任务', desc: '请先在 Planning Center / Content Tasks 创建任务。', });
    setBody(s.html); bindHead(); return;
  }
  /* V0.1.2 Phase A：深链接预选（#/content-editor?task=<id>，来自工作台「继续」） */
  const wantTask = ctxRef && ctxRef.params && ctxRef.params.task;
  if (wantTask && tasks.some((t) => t.id === wantTask)) taskId = wantTask;
  if (!taskId || !tasks.some((t) => t.id === taskId)) taskId = tasks[0].id;
  /* 记录「继续上次」锚点（服务端持久化；失败不阻断制作） */
  try { api.put('/api/mos/my-work/continue', { taskId }); } catch (_) { /* ignore */ }

  await Promise.all([loadVersions(), loadAssistants()]);
  paint();
  bindHead();
}

async function loadVersions() {
  const r = await api.get(withBrand('/api/mos/content-versions', ctxRef.brand, { taskId }));
  versions = r.items || [];
}

async function loadAssistants() {
  if (assistants) return;
  try {
    const [sk, tp] = await Promise.all([
      api.get(withBrand('/api/mos/skills', ctxRef.brand, {})),
      api.get(withBrand('/api/mos/templates', ctxRef.brand, {}))
    ]);
    assistants = { skills: sk.items || [], usability: sk.usability || null, templates: tp.items || [], templatesNote: tp.note };
  } catch (_) {
    assistants = { skills: [], usability: null, templates: [], templatesNote: '' };
  }
}

function bindHead() {
  const n = hostEl.querySelector('#ceNew'); if (n) n.addEventListener('click', newDraftDialog);
  const r = hostEl.querySelector('#ceRefresh'); if (r) r.addEventListener('click', async () => { current = null; await render(); toast('已刷新', 'ok'); });
  /* V0.1.2 Phase C：工作空间四标签导航 */
  hostEl.querySelectorAll('[data-ws]').forEach((b) => b.addEventListener('click', () => {
    const ws = b.dataset.ws;
    if (ws === 'brief') {
      const el = hostEl.querySelector('#wsBrief');
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (ws === 'visual') {
      ctxRef.navigate('visual-studio');
    } else if (ws === 'review') {
      ctxRef.navigate('my-reviews');
    }
  }));
  const sel = hostEl.querySelector('#ceTask');
  if (sel) sel.addEventListener('change', async () => {
    if (dirty && !(await confirmDialog('放弃未保存修改？', '当前草稿有未保存的正文修改。', '放弃并切换'))) { sel.value = taskId; return; }
    dirty = false; taskId = sel.value; current = null; await render();
  });
}

/* ==================== 主绘制 ==================== */

function paint() {
  const task = tasks.find((t) => t.id === taskId) || {};
  let html = '<div class="filters">'
    + '<label class="row" style="gap:6px"><span class="small muted">内容任务</span>'
    + '<select id="ceTask" style="max-width:420px">'
    + tasks.map((t) => '<option value="' + esc(t.id) + '"' + (t.id === taskId ? ' selected' : '') + '>'
      + esc(t.code + ' · ' + t.title) + '</option>').join('')
    + '</select></label>'
    + '<span class="pill">版本 ' + versions.length + '</span>'
    + statusBadge(task.status)
    + gradeBadge(task.riskGrade)
    + demoBadge(task.demo)
    + '</div>';

  html += '<div class="editor-3col">'
    + '<div class="ed-col" id="ceLeft"></div>'
    + '<div class="ed-col" id="ceMid"></div>'
    + '<div class="ed-col ed-col-ai" id="ceRight"></div>'
    + '</div>';
  setBody(html);
  paintLeft(task);
  paintMid(task);
  paintRight(task);
}

/* ---------- 左栏：Brief / 证据 / 披露 ---------- */

function paintLeft(task) {
  const el = hostEl.querySelector('#ceLeft');
  const v = current && current.version;
  let h = '<div class="card" id="wsBrief"><div class="card-head"><h2>任务 Brief</h2></div><div class="card-body">'
    + '<dl class="kv">'
    + '<dt>编号</dt><dd class="mono">' + esc(task.code || '—') + '</dd>'
    + '<dt>标题</dt><dd>' + esc(task.title || '—') + '</dd>'
    + '<dt>平台</dt><dd>' + esc(platformLabel(task.platform)) + '</dd>'
    + '<dt>栏目</dt><dd class="mono">' + esc(task.pillarCode || '—') + '</dd>'
    + '<dt>叙事</dt><dd class="mono">' + esc(task.narrativeCode || '—') + '</dd>'
    + '<dt>风险等级</dt><dd>' + gradeBadge(task.riskGrade) + '</dd>'
    + '<dt>制作截止</dt><dd class="mono small">' + esc((task.productionDue || '').slice(0, 10) || '—') + '</dd>'
    + '</dl></div></div>';

  // 证据引用：金融事实必须有可核验来源（BUILD-01 已建的 evidence_references）
  const ev = (v && current.evidence) || [];
  h += '<div class="card"><div class="card-head"><h2>证据引用</h2><span class="pill">' + ev.length + '</span></div><div class="card-body">';
  if (!v) h += '<div class="hint">选择或新建一个版本后，可在此挂载证据引用。</div>';
  else if (!ev.length) h += '<div class="hint">尚未挂载证据。G2 以上内容在专业审核时会被追问事实来源。</div>';
  else {
    h += '<div class="sr-list">' + ev.map((e) => '<div class="src-item">'
      + '<div class="src-h">' + statusBadge(e.verificationState) + (e.sourceTier ? '<span class="badge badge-neutral">' + esc(e.sourceTier) + '</span>' : '') + '</div>'
      + '<div class="src-t">' + esc(e.claimLocator || e.id) + '</div>'
      + (e.sourceTitle ? '<div class="small muted">' + esc(e.sourceTitle) + '</div>' : '')
      + (e.sourceUrl ? '<a class="small" href="' + esc(e.sourceUrl) + '" target="_blank" rel="noopener">来源链接</a>' : '')
      + '</div>').join('') + '</div>';
  }
  h += '</div></div>';

  // 已选渠道 / 引用资产
  const ch = (v && current.channels) || [];
  const as = (v && current.assets) || [];
  h += '<div class="card"><div class="card-head"><h2>引用资源</h2></div><div class="card-body">'
    + '<div class="small muted">渠道（' + ch.length + '）</div>'
    + (ch.length ? '<div class="tag-list">' + ch.map((c) => '<span class="badge badge-neutral">' + esc(platformLabel(c.platform) + ' ' + (c.handle || '')) + '</span>').join('') + '</div>' : '<div class="hint">未选择渠道</div>')
    + '<div class="divider"></div>'
    + '<div class="small muted">引用资产（' + as.length + '）</div>'
    + (as.length ? '<div class="tag-list" data-notranslate>' + as.map((a) => '<span class="badge badge-neutral">' + esc(a.fileName || a.id) + '</span>' + (a.mock ? ' <span class="badge badge-mock">MOCK</span>' : '') + '').join('') + '</div>' : '<div class="hint">未引用资产</div>')
    + '</div></div>';
  el.innerHTML = h;
}

/* ---------- 中栏：版本列表 + 编辑器 ---------- */

function paintMid(task) {
  const el = hostEl.querySelector('#ceMid');
  let h = '<div class="card"><div class="card-head"><h2>版本</h2>'
    + '<span class="hint">版本号单调递增，旧版本只被标记 SUPERSEDED，绝不删除</span></div><div class="card-body">';
  if (!versions.length) {
    h += stateBlock('empty', { title: '还没有内容版本', desc: '点击右上角「新建草稿版本」开始撰写。' }).html;
  } else {
    h += '<div class="ver-list">' + versions.map((v) => {
      const rs = v.reviewSummary || {};
      return '<div class="ver-item' + (current && current.version.id === v.id ? ' on' : '') + '" data-ver="' + esc(v.id) + '">'
        + '<div class="vi-top"><span class="vi-code">v' + v.number + '</span>' + statusBadge(v.state) + '</div>'
        + '<div class="small">' + esc(v.title || '（无标题）') + '</div>'
        + '<div class="ed-meta"><span>' + v.bodyChars + ' 字</span><span>' + esc(relTime(v.updatedAt)) + '</span>'
        + '<span>审核 ' + rs.open + ' 待办 / ' + rs.total + ' 共</span></div>'
        + '</div>';
    }).join('') + '</div>';
  }
  h += '</div></div>';

  // 编辑器
  h += '<div class="card"><div class="card-head"><h2>正文</h2><div id="ceEdHead"></div></div><div class="card-body" id="ceEd"></div></div>';
  el.innerHTML = h;

  el.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', async () => {
    if (dirty && !(await confirmDialog('放弃未保存修改？', '当前草稿有未保存的正文修改。', '放弃'))) return;
    dirty = false; await openVersion(b.dataset.ver);
  }));

  paintEditor(task);
}

function paintEditor(task) {
  const ed = hostEl.querySelector('#ceEd');
  const hd = hostEl.querySelector('#ceEdHead');
  if (!current) {
    ed.innerHTML = stateBlock('empty', { title: '未选择版本', desc: '从上方版本列表选择一个版本，或新建草稿。' }).html;
    hd.innerHTML = '';
    return;
  }
  const v = current.version;
  const editable = !!v.editable;

  hd.innerHTML = '<span class="ed-meta">'
    + statusBadge(v.state) + gradeBadge(v.riskGrade)
    + '<span class="mono">' + esc(v.code) + '</span>'
    + '<span>rowVersion ' + v.rowVersion + '</span>'
    + '<span>textHash ' + esc(String(v.textHash || '').slice(0, 12)) + '</span>'
    + '</span>';

  let banner = '';
  if (v.state === 'LOCKED_FOR_REVIEW') {
    banner = '<div class="lock-banner">🔒 已送审冻结。正文与引用资产只读；批准对象已被 Manifest 绑定'
      + '（<span class="mono">' + esc(String(v.manifestHash || '').slice(0, 16)) + '…</span>）。修改请派生新版本。</div>';
  } else if (v.state === 'APPROVED') {
    banner = '<div class="lock-banner">✅ 已批准。此版本只读，可用于排期与发布登记。</div>';
  } else if (v.state === 'REVISION_REQUIRED') {
    banner = '<div class="lock-banner warn">⚠ 审核要求修订。原版本不可直接改写，请点击「派生新版本」。</div>';
  } else if (v.state === 'SUPERSEDED') {
    banner = '<div class="lock-banner">历史版本（已被新版本取代），只读留档。</div>';
  }

  ed.innerHTML = banner
    + '<label class="field"><span>标题</span><input id="ceTitle" type="text" value="' + esc(v.title || '') + '"'
    + (editable ? '' : ' readonly') + '></label>'
    + '<textarea id="ceText" class="ed-body"' + (editable ? '' : ' readonly') + '>' + esc(v.body || '') + '</textarea>'
    + '<div class="ed-meta" style="margin-top:6px"><span id="ceCount">' + String(v.body || '').length + ' 字</span>'
    + '<span id="ceDirty" class="muted"></span></div>'
    + '<div class="divider"></div>'
    + '<div class="row" style="flex-wrap:wrap">'
    + (editable ? '<button class="btn btn-sm btn-primary" id="ceSave">保存草稿</button>' : '')
    + (editable ? '<button class="btn btn-sm" id="ceLock">冻结并送审</button>' : '')
    + (v.revisable ? '<button class="btn btn-sm" id="ceRevise">派生新版本</button>' : '')
    + '<button class="btn btn-sm" id="ceManifest">查看 Manifest 快照</button>'
    + '<button class="btn btn-sm" id="ceChain">查看审核链</button>'
    + '</div>'
    + '<div id="ceCases" style="margin-top:12px"></div>';

  const ta = hostEl.querySelector('#ceText');
  const cnt = hostEl.querySelector('#ceCount');
  const dt = hostEl.querySelector('#ceDirty');
  ta.addEventListener('input', () => {
    cnt.textContent = ta.value.length + ' 字';
    dirty = true; dt.textContent = '有未保存修改';
  });
  const ti = hostEl.querySelector('#ceTitle');
  ti.addEventListener('input', () => { dirty = true; dt.textContent = '有未保存修改'; });

  const sv = hostEl.querySelector('#ceSave');
  if (sv) sv.addEventListener('click', () => saveVersion(v));
  const lk = hostEl.querySelector('#ceLock');
  if (lk) lk.addEventListener('click', () => lockVersion(v));
  const rv = hostEl.querySelector('#ceRevise');
  if (rv) rv.addEventListener('click', () => reviseVersion(v));
  hostEl.querySelector('#ceManifest').addEventListener('click', () => showManifest(v));
  hostEl.querySelector('#ceChain').addEventListener('click', () => showChain());

  paintCases();
}

function paintCases() {
  const el = hostEl.querySelector('#ceCases');
  if (!el) return;
  const cases = (current && current.cases) || [];
  const dec = (current && current.decisions) || [];
  if (!cases.length) { el.innerHTML = '<div class="hint">该版本尚未产生审核单（送审后自动生成）。</div>'; return; }
  let h = '<div class="small muted" style="margin-bottom:6px">审核链</div>';
  h += cases.map((c) => '<div class="checkline' + (c.state === 'APPROVED' ? '' : ' no') + '">'
    + '<span class="ck">' + (c.state === 'APPROVED' ? '✔' : '○') + '</span>'
    + '<span>' + esc(caseTypeLabel(c.type)) + ' —— ' + statusBadge(c.state)
    + ' <span class="muted small">提交 ' + esc(fmtDateTime(c.submittedAt)) + '</span></span></div>').join('');
  if (dec.length) {
    h += '<div class="divider"></div><div class="small muted" style="margin-bottom:6px">决策记录（append-only）</div>'
      + dec.map((d) => '<div class="checkline no"><span class="ck">·</span><span>'
        + esc(decisionLabel(d.action)) + ' · ' + esc(d.actorName || d.actorId || '—')
        + ' <span class="muted small">' + esc(fmtDateTime(d.createdAt)) + '</span>'
        + (d.remarks ? '<br><span class="muted small" data-notranslate>' + esc(d.remarks) + '</span>' : '')
        + '</span></div>').join('');
  }
  el.innerHTML = h;
}

function caseTypeLabel(t) {
  return { PROFESSIONAL_REVIEW: '专业（金融事实）审核', PUBLICATION_APPROVAL: '发布审批', ASSET_ADMISSION: '资产入库审核' }[t] || t;
}
function decisionLabel(a) {
  return { START_REVIEW: '开始审核', APPROVE: '批准', REQUEST_REVISION: '要求修订', REJECT: '驳回', CANCEL: '取消' }[a] || a;
}

/* ---------- 右栏：AI 助手 ---------- */

function paintRight(task) {
  const el = hostEl.querySelector('#ceRight');
  const d = (ctxRef.meta && ctxRef.meta.dictionaries) || {};
  const u = (assistants && assistants.usability) || null;
  const tp = ctxRef.integrations && ctxRef.integrations.textProvider;
  const ip = ctxRef.integrations && ctxRef.integrations.imageProvider;

  let h = '<div class="card"><div class="card-head"><h2>AI 助手</h2></div><div class="card-body">';

  // 集成状态先行声明（00 §0.1-5：不得谎称已打通）
  h += '<div class="block-note info">文本模型：<b>' + esc(tp ? tp.mode : 'none') + '</b>'
    + (tp && tp.mock ? ' · <span class="badge badge-mock">MOCK</span>' : '')
    + '<br><span class="small">图像模型：' + esc(ip ? ip.mode : 'none')
    + (ip && ip.mock ? ' · MOCK' : '') + '</span>'
    + '<br><span class="small muted">未配置时不会伪造输出，作业会明确落到 NOT_CONFIGURED。</span></div>';

  // Skill 可用性
  if (u) {
    const blocked = u.state !== 'APPROVED';
    h += '<div class="' + (blocked ? 'block-note' : 'block-note info') + '" style="margin-top:10px">'
      + '品牌 Skill：<b>' + esc(u.skillCode || '—') + '</b> v' + esc(u.version || '—')
      + ' · ' + statusBadge(u.state || 'MISSING')
      + '<br><span class="small">' + esc(u.reason || '') + '</span></div>';
  }

  h += '<div class="divider"></div>';
  h += '<label class="field"><span>生成方式</span><select id="aiKind">'
    + '<option value="TEXT">文案草稿（写入本版本）</option>'
    + '<option value="IMAGE">图像生成（视觉工作室）</option></select></label>';
  h += '<label class="field"><span>创作简报（Brief）</span><textarea id="aiBrief" class="ed-body" style="min-height:110px" placeholder="说明受众、核心论点、必须遵守的合规口径、禁止出现的表述…"></textarea></label>';
  h += '<div class="row" style="gap:6px;flex-wrap:wrap">'
    + '<button class="btn btn-sm" id="aiPreview">预览受控提示词</button>'
    + '<button class="btn btn-sm btn-primary" id="aiRun">生成草稿</button></div>';
  h += '<div id="aiOut" style="margin-top:10px"></div>';
  h += '<div class="divider"></div><div class="small muted">最近作业</div><div id="aiJobs" class="small"></div>';
  h += '</div></div>';
  el.innerHTML = h;

  hostEl.querySelector('#aiPreview').addEventListener('click', aiPreview);
  hostEl.querySelector('#aiRun').addEventListener('click', aiRun);
  loadJobs();

  void d; void task;
}

async function loadJobs() {
  const el = hostEl.querySelector('#aiJobs');
  if (!el) return;
  try {
    const r = await api.get(withBrand('/api/mos/generation-jobs', ctxRef.brand, { pageSize: 5 }));
    const items = r.items || [];
    el.innerHTML = items.length
      ? items.map((j) => '<div class="checkline no"><span class="ck">·</span><span>'
        + esc(j.kind) + ' · ' + statusBadge(j.status) + (j.mock ? ' <span class="badge badge-mock">MOCK</span>' : '')
        + '<br><span class="muted">' + esc(relTime(j.createdAt)) + '</span></span></div>').join('')
      : '<span class="muted">暂无作业</span>';
  } catch (_) { el.innerHTML = '<span class="muted">作业加载失败</span>'; }
}

function aiBriefValue() { const t = hostEl.querySelector('#aiBrief'); return t ? t.value.trim() : ''; }

async function aiPreview() {
  const out = hostEl.querySelector('#aiOut');
  const brief = aiBriefValue();
  if (!brief) { toast('请先填写创作简报', 'err'); return; }
  const task = tasks.find((t) => t.id === taskId) || {};
  out.innerHTML = '<div class="hint">正在解析…</div>';
  try {
    const r = await api.post(withBrand('/api/mos/prompt-preview', ctxRef.brand), {
      platform: task.platform, pillarCode: task.pillarCode, narrativeCode: task.narrativeCode,
      riskGrade: task.riskGrade, brief, outputIntent: 'TEST_DRAFT'
    });
    if (r.blocked) {
      out.innerHTML = '<div class="block-note danger">已阻塞：' + esc(r.blockReason) + '</div>';
      return;
    }
    out.innerHTML = '<div class="small muted">生效规则哈希 '
      + '<span class="mono">' + esc(String(r.effectiveRuleHash || '').slice(0, 16)) + '</span></div>'
      + '<pre class="mono small" style="white-space:pre-wrap;background:var(--muted);padding:9px;border-radius:7px;max-height:220px;overflow:auto">'
      + esc(r.prompt || '') + '</pre>';
  } catch (err) {
    out.innerHTML = '<div class="block-note danger">' + esc(err.message) + '</div>';
  }
}

async function aiRun() {
  const out = hostEl.querySelector('#aiOut');
  const brief = aiBriefValue();
  if (!brief) { toast('请先填写创作简报', 'err'); return; }
  const kind = hostEl.querySelector('#aiKind').value;
  if (kind === 'IMAGE') { toast('图像生成请在「Visual Studio」中操作（可选择模板与画幅）', 'err'); return; }
  const v = current && current.version;
  if (v && !v.editable) { toast('当前版本已冻结，AI 草稿只能写入 DRAFT 版本', 'err'); return; }

  out.innerHTML = '<div class="hint">正在生成（Mock 模式为确定性骨架文本）…</div>';
  try {
    const r = await api.post(withBrand('/api/mos/generation-jobs', ctxRef.brand), {
      kind: 'TEXT', taskId, brief,
      applyToVersionId: v ? v.id : null,
      idempotencyKey: 'txt-' + taskId + '-' + (v ? v.id : 'none') + '-' + Date.now()
    });
    const j = r.job || {};
    if (j.status === 'NOT_CONFIGURED') {
      out.innerHTML = '<div class="block-note">该能力尚未接入：' + esc(j.errorMessage || '未配置文本 Provider') + '</div>';
    } else if (j.status === 'SUCCEEDED') {
      out.innerHTML = '<div class="block-note info">作业 ' + esc(j.id) + ' 已' + (j.mock ? '<b>以 MOCK 方式</b>' : '') + '完成'
        + (r.job.appliedToVersionId ? '，已写入当前版本草稿。' : '。') + '</div>';
      await openVersion(v.id, true);
      toast('AI 草稿已生成', 'ok');
    } else {
      out.innerHTML = '<div class="block-note danger">作业未成功：' + esc(j.status + ' ' + (j.errorMessage || '')) + '</div>';
    }
    loadJobs();
  } catch (err) {
    out.innerHTML = '<div class="block-note danger">' + esc(err.message) + '</div>';
    toast(err.message, 'err');
  }
}

/* ==================== 操作 ==================== */

async function openVersion(id, silent) {
  try {
    current = await api.get(withBrand('/api/mos/content-versions/' + id, ctxRef.brand));
    dirty = false;
    if (!silent) { paintMid(tasks.find((t) => t.id === taskId) || {}); paintLeft(tasks.find((t) => t.id === taskId) || {}); }
    else { paintMid(tasks.find((t) => t.id === taskId) || {}); paintLeft(tasks.find((t) => t.id === taskId) || {}); }
  } catch (err) { renderError(err, () => openVersion(id)); }
}

async function saveVersion(v) {
  const body = hostEl.querySelector('#ceText').value;
  const title = hostEl.querySelector('#ceTitle').value.trim();
  try {
    await api.put(withBrand('/api/mos/content-versions/' + v.id, ctxRef.brand), {
      body, title, rowVersion: v.rowVersion
    });
    dirty = false;
    toast('草稿已保存', 'ok');
    await loadVersions();
    await openVersion(v.id);
  } catch (err) {
    if (err.status === 409 && err.code === 'VERSION_IMMUTABLE') {
      toast('该版本已冻结，不能直接修改', 'err');
      await openVersion(v.id);
    } else toast(err.message, 'err');
  }
}

async function lockVersion(v) {
  if (dirty) {
    const ok = await confirmDialog('先保存再送审？', '当前有未保存修改，送审会以服务端已保存内容为准。', '保存并送审');
    if (!ok) return;
    await saveVersion(v);
  }
  const task = tasks.find((t) => t.id === taskId) || {};
  const risky = RISKY.indexOf(v.riskGrade) !== -1;
  const ok = await confirmDialog('冻结并送审？',
    '冻结后正文与引用资产将被 Manifest 绑定且不可再改。'
      + (risky ? '当前风险等级 ' + v.riskGrade + '，将强制进入专业（金融事实）审核 + 发布审批。' : '将进入发布审批。'),
    '冻结送审');
  if (!ok) return;
  try {
    const r = await api.post(withBrand('/api/mos/content-versions/' + v.id + '/lock', ctxRef.brand), {});
    const nCases = (r.createdCases || r.cases || []).length;
    toast('已冻结并送审，生成 ' + nCases + ' 张审核单', 'ok');
    await loadVersions();
    await openVersion(v.id);
    void task;
  } catch (err) { toast(err.message, 'err'); }
}

async function reviseVersion(v) {
  const ok = await confirmDialog('派生新版本？', '将基于 v' + v.number + ' 创建一个新的草稿版本；原版本保留并标记为已被取代，其未决审核单会被取消。', '派生');
  if (!ok) return;
  try {
    const r = await api.post(withBrand('/api/mos/content-versions/' + v.id + '/revise', ctxRef.brand), {});
    const nv = r.version || {};
    toast('已派生 v' + (nv.number || '?'), 'ok');
    await loadVersions();
    await openVersion(nv.id);
  } catch (err) { toast(err.message, 'err'); }
}

async function newDraftDialog() {
  const ok = await confirmDialog('新建草稿版本？', '将在当前任务下创建一个新的 DRAFT 版本（版本号递增）。', '创建');
  if (!ok) return;
  try {
    const r = await api.post(withBrand('/api/mos/content-versions', ctxRef.brand), {
      taskId, body: ''
    });
    const nv = r.version || {};
    toast('已创建 v' + (nv.number || '?'), 'ok');
    await loadVersions();
    await openVersion(nv.id);
  } catch (err) { toast(err.message, 'err'); }
}

function showManifest(v) {
  const p = v.manifestPayload;
  openModal({
    title: 'Manifest 快照', okText: '关闭', hideOk: false,
    body: !p ? '<div class="hint">该版本尚未冻结，没有 Manifest 快照。冻结时会固化正文哈希、引用资产 sha256、渠道、披露与风险等级。</div>'
      : '<div class="small muted">批准对象的完整定义。审批时按同一算法重算，不一致即拒绝（SEC-02）。</div>'
        + '<dl class="kv"><dt>Manifest 哈希</dt><dd class="mono small">' + esc(v.manifestHash) + '</dd>'
        + '<dt>正文哈希</dt><dd class="mono small">' + esc(p.textHash) + '</dd>'
        + '<dt>渠道</dt><dd class="small">' + esc((p.channelIds || []).join(', ') || '—') + '</dd>'
        + '<dt>披露</dt><dd class="small">' + esc((p.disclosures || []).join(' / ') || '—') + '</dd>'
        + '<dt>风险等级</dt><dd>' + gradeBadge(p.riskGrade) + '</dd>'
        + '<dt>资产</dt><dd class="small">' + esc((p.assets || []).map((a) => (a.fileName || a.id) + '@' + String(a.sha256 || '').slice(0, 8)).join(', ') || '—') + '</dd></dl>'
        + '<pre class="mono small" style="white-space:pre-wrap;background:var(--muted);padding:9px;border-radius:7px;max-height:240px;overflow:auto">'
        + esc(JSON.stringify(p, null, 2)) + '</pre>'
  });
}

function showChain() {
  const cases = (current && current.cases) || [];
  const dec = (current && current.decisions) || [];
  openModal({
    title: '审核链', okText: '关闭',
    body: '<div class="small muted">三条审批链相互独立，不存在单一 approved 标志位（01 §3）。</div>'
      + '<dl class="kv">' + cases.map((c) => '<dt>' + esc(caseTypeLabel(c.type)) + '</dt>'
        + '<dd>' + statusBadge(c.state) + ' <span class="small muted">' + esc(c.id) + '</span></dd>').join('')
      + '</dl><div class="divider"></div>'
      + dec.map((d) => '<div class="checkline no"><span class="ck">·</span><span>'
        + esc(decisionLabel(d.action)) + ' · ' + esc(d.actorName || '') + ' · ' + esc(fmtDateTime(d.createdAt))
        + (d.remarks ? '<br><span class="muted small">' + esc(d.remarks) + '</span>' : '') + '</span></div>').join('')
  });
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; current = null; dirty = false; assistants = null; },
  hasUnsaved() { return dirty; }
};
