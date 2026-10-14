/* Marketing OS —— UI 基础件（无框架）。
 * 统一：转义、Toast、模态、抽屉、五种状态块（Loading/Empty/Error/Denied/IntegrationPending）。
 */
import { statusLabel as statusLabelI18n } from './i18n.js';


export function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function initials(name) {
  const s = String(name || '').trim();
  if (!s) return '—';
  if (/[\u4e00-\u9fa5]/.test(s)) return s.slice(-2);
  return s.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}

export function fmtDateTime(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
export function fmtDate(v) {
  if (!v) return '—';
  return String(v).slice(0, 10);
}
export function relTime(v) {
  if (!v) return '—';
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) return String(v);
  const diff = Date.now() - t;
  const m = Math.round(diff / 60000);
  if (Math.abs(m) < 1) return '刚刚';
  if (Math.abs(m) < 60) return m + ' 分钟前';
  const h = Math.round(m / 60);
  if (Math.abs(h) < 24) return h + ' 小时前';
  const d = Math.round(h / 24);
  if (Math.abs(d) < 30) return d + ' 天前';
  return fmtDate(v);
}

/* ---------------- Toast ---------------- */
export function toast(msg, kind) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' toast-err' : (kind === 'ok' ? ' toast-ok' : ''));
  el.setAttribute('role', 'status');
  el.textContent = String(msg);
  root.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 250); }, kind === 'err' ? 6000 : 3200);
}

/* ---------------- 模态 ---------------- */
export function openModal(opts) {
  const root = document.getElementById('modalRoot');
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = '<div class="modal" role="dialog" aria-modal="true">'
    + '<div class="modal-head"><h2>' + esc(opts.title || '') + '</h2></div>'
    + '<div class="modal-body" id="__mb"></div>'
    + '<div class="modal-foot">'
    + '<button class="btn" data-act="cancel">' + esc(opts.cancelText || '取消') + '</button>'
    + '<button class="btn btn-primary" data-act="ok" id="__mok">' + esc(opts.okText || '确定') + '</button>'
    + '</div></div>';
  root.appendChild(mask);
  const body = mask.querySelector('#__mb');
  if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);

  const close = () => { mask.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', (e) => { if (e.target === mask) close(); });
  const okBtn = mask.querySelector('#__mok');
  if (opts.hideOk) okBtn.style.display = 'none';
  mask.querySelector('[data-act="cancel"]').addEventListener('click', () => { if (opts.onCancel) opts.onCancel(); close(); });
  okBtn.addEventListener('click', async () => {
    if (!opts.onOk) { close(); return; }
    okBtn.disabled = true;
    try { const r = await opts.onOk(body, mask); if (r !== false) close(); }
    finally { okBtn.disabled = false; }
  });
  return { close, body, root: mask };
}

export function confirmDialog(title, message, okText) {
  return new Promise((resolve) => {
    openModal({
      title,
      okText: okText || '确定',
      body: '<p style="margin:0;font-size:13.5px">' + esc(message) + '</p>',
      onOk: () => resolve(true),
      onCancel: () => resolve(false)
    });
  });
}

/* ---------------- 抽屉 ---------------- */
export function openDrawer(opts) {
  const root = document.getElementById('drawerRoot');
  const mask = document.createElement('div');
  mask.className = 'drawer-mask';
  const panel = document.createElement('div');
  panel.className = 'drawer';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = '<div class="drawer-head"><h2>' + esc(opts.title || '') + '</h2>'
    + '<div class="dh-actions" id="__dh"></div>'
    + '<button class="icon-btn" data-act="close" aria-label="关闭">✕</button></div>'
    + '<div class="drawer-body" id="__db"></div>'
    + (opts.footer ? '<div class="drawer-foot" id="__df"></div>' : '');
  root.appendChild(mask);
  root.appendChild(panel);

  const body = panel.querySelector('#__db');
  if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
  if (opts.footer) panel.querySelector('#__df').appendChild(opts.footer);

  const close = () => { mask.remove(); panel.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  mask.addEventListener('click', close);
  panel.querySelector('[data-act="close"]').addEventListener('click', close);
  return { close, body, head: panel.querySelector('#__dh') };
}

/* ---------------- 状态块 ---------------- */
export function stateBlock(kind, opts) {
  const o = opts || {};
  const map = {
    loading: { icon: '⏳', title: '加载中…', cls: 'state-loading' },
    empty: { icon: '○', title: '暂无数据', cls: '' },
    error: { icon: '!', title: '出错了', cls: 'state-error' },
    denied: { icon: '⛔', title: '无权访问', cls: 'state-denied' },
    pending: { icon: '⏳', title: '尚未接通', cls: 'state-pending' }
  };
  const m = map[kind] || map.empty;
  let html = '<div class="state ' + m.cls + '"><div class="st-icon">' + m.icon + '</div>'
    + '<div class="st-title">' + esc(o.title || m.title) + '</div>';
  if (o.desc) html += '<div class="st-desc">' + esc(o.desc) + '</div>';
  if (o.actions && o.actions.length) {
    html += '<div class="st-actions">' + o.actions.map((a, i) =>
      '<button class="btn ' + (a.primary ? 'btn-primary' : '') + '" data-state-act="' + i + '">' + esc(a.label) + '</button>').join('') + '</div>';
  }
  html += '</div>';
  return { html, bind(el) {
    if (!o.actions) return;
    el.querySelectorAll('[data-state-act]').forEach((b) => {
      b.addEventListener('click', () => { const a = o.actions[Number(b.dataset.stateAct)]; if (a && a.onClick) a.onClick(); });
    });
  } };
}

export function loadingHtml() {
  return '<div class="card"><div class="card-body">'
    + '<div class="skeleton sk-line" style="width:40%"></div>'
    + '<div class="skeleton sk-line" style="width:80%"></div>'
    + '<div class="skeleton sk-line" style="width:65%"></div>'
    + '<div class="skeleton sk-line" style="width:72%"></div>'
    + '</div></div>';
}

/* ---------------- 业务标签 ---------------- */
const STATUS_LABELS = {
  IDEA: '构思', PLANNED: '已计划', IN_PRODUCTION: '制作中', IN_REVIEW: '审核中', READY: '待发布',
  COMPLETED: '已完成', ON_HOLD: '暂缓', CANCELLED: '已取消',
  DRAFT: '草稿', SUBMITTED: '已提交', REVISION_REQUIRED: '需修订', APPROVED: '已批准',
  ACTIVE: '生效中', CLOSED: '已关闭', RESEARCHING: '调研中', ARCHIVED: '已归档',
  PAUSED: '已暂停', ACTIVE_SRC: '启用',
  PENDING_VERIFICATION: '待核验', DISABLED: '已停用', ERROR: '异常',
  MISSING: '缺失', PARTIAL: '部分', SUFFICIENT: '充分'
};
/* V0.1.3 Phase C：状态文案统一取自 i18n 资源（status.*），避免各页各写一套中文标签。
 * 样式类仍由本文件的 STATUS_CLS 决定（视觉关注点，与语言无关）。 */
export function statusLabel(s) {
  const k = String(s === undefined || s === null ? '' : s);
  if (!k) return '—';
  const hit = statusLabelI18n(k);
  if (hit && hit !== k) return hit;
  return STATUS_LABELS[k] || k;
}

export function statusBadge(s) {
  const cls = {
    COMPLETED: 'badge-ok', READY: 'badge-ok', APPROVED: 'badge-ok', ACTIVE: 'badge-ok', SUFFICIENT: 'badge-ok',
    IN_REVIEW: 'badge-info', SUBMITTED: 'badge-info', RESEARCHING: 'badge-info', IN_PRODUCTION: 'badge-info',
    ON_HOLD: 'badge-warn', REVISION_REQUIRED: 'badge-warn', PARTIAL: 'badge-warn',
    PENDING_VERIFICATION: 'badge-warn', MISSING: 'badge-warn',
    CANCELLED: 'badge-danger', ERROR: 'badge-danger', DISABLED: 'badge-danger',
    DRAFT: 'badge-neutral', PLANNED: 'badge-neutral', IDEA: 'badge-neutral', ARCHIVED: 'badge-neutral',
    PAUSED: 'badge-neutral', CLOSED: 'badge-neutral'
  }[s] || 'badge-neutral';
  return '<span class="badge ' + cls + '">' + esc(statusLabel(s)) + '</span>';
}

export function gradeBadge(g) {
  const cls = { G0: 'badge-g0', G1: 'badge-g1', G2: 'badge-g2', G3: 'badge-g3' }[g] || 'badge-neutral';
  return '<span class="badge ' + cls + '">' + esc(g || '—') + '</span>';
}

export function demoBadge(on) {
  return on ? '<span class="badge badge-demo">DEMO</span>' : '';
}
export function mockBadge(on) {
  return on ? '<span class="badge badge-mock">MOCK</span>' : '';
}

/** 平台标签 */
export function platformLabel(p) {
  return { LINKEDIN: 'LinkedIn', X: 'X', YOUTUBE: 'YouTube', FACEBOOK: 'Facebook' }[p] || p || '—';
}

/** 字典选择项（provisional 条目带提示） */
export function dictOptions(list, selected, emptyLabel) {
  let html = emptyLabel === null ? '' : '<option value="">' + esc(emptyLabel || '请选择') + '</option>';
  for (const it of list || []) {
    const label = it.provisional ? (it.code + ' · 待核验') : (it.code + ' · ' + it.label);
    html += '<option value="' + esc(it.code) + '"' + (selected === it.code ? ' selected' : '') + '>' + esc(label) + '</option>';
  }
  return html;
}

/** 集成状态提示条内容（01 §4：Mock/未接通必须显式可见） */
export function integrationBarHtml(integrations) {
  if (!integrations) return '';
  const parts = [];
  const tag = (label, mode, mock) => '<span class="ib-item">' + esc(label) + '：<span class="ib-tag">'
    + esc(mock ? ('MOCK/' + mode) : mode) + '</span></span>';
  parts.push(tag('身份', integrations.identity.mode, integrations.identity.mock));
  parts.push(tag('资料库', integrations.library.mode, integrations.library.mock));
  parts.push(tag('知识库', integrations.knowledge.mode, integrations.knowledge.mock));
  parts.push(tag('情报采集', integrations.sourceIngest.mode, false));
  parts.push(tag('文本模型', integrations.textProvider.mode, integrations.textProvider.mock));
  parts.push(tag('图像模型', integrations.imageProvider.mode, false));
  const el = integrations.enterpriseLibrary;
  parts.push('<span class="ib-item">企业资料库：<span class="ib-tag">'
    + esc(el ? (el.configured ? 'CONFIGURED（未联调）' : 'NOT_CONFIGURED') : '未接通') + '</span></span>');
  parts.push('<span class="ib-item">OA 接口：<span class="ib-tag">未接通</span></span>');
  return '沙盒环境 · 集成状态：' + parts.join('')
    + '<span class="ib-item muted">（未接通项一律按 MOCK 展示，不得视为生产可用）</span>';
}
