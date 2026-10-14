/**
 * i18n —— zh-CN / en-US 双语引擎（V0.1.3 Phase C 重写，执行包 05 §国际化）。
 *
 * 与 V0.1.2 的关键差异（整改点）：
 *  1. **key-based**：文案取自独立语言资源 `public/mos/i18n/zh-CN.js` / `en-US.js`，
 *     一律通过 `t(key, params)` 精确查表；键必须成对存在（由 tools/mos-i18n-check.js 强制）。
 *  2. **统一状态/错误码映射**：`statusLabel / errorLabel / readinessLabel / jobStageLabel /
 *     completionLabel / gapLabel / kindLabel / availabilityLabel / deliverableLabel /
 *     purposeLabel / visualTypeLabel`——后端枚举与 API `error.code` 不再各页各写一套中文。
 *  3. **参数插值**：`t('error.generic_with_code', { code })`，解决"字符串拼接出来的动态文案
 *     在英文界面永远是中文"的旧缺陷。
 *  4. **不可翻译节点保护**（旧实现完全缺失）：`bindDom()` 永不触碰
 *     `[data-notranslate]`、`input/textarea/select/option/pre/code/script/style`、
 *     `[contenteditable]` 及其子树 —— 用户输入、已保存正文、AI 原始研究结果、引用原文、
 *     URL、上传文件名、日志在英文界面**保持原样**。
 *  5. 旧的**全局文本节点匹配**被替换为「显式标记 + 受保护的兼容层」：
 *     显式标记 `data-i18n` / `data-i18n-placeholder` / `data-i18n-title` /
 *     `data-i18n-aria-label` / `data-i18n-params` 是推荐写法；
 *     未迁移的历史模板仍由兼容层按**精确键匹配**处理，但受第 4 条保护。
 *
 * 不可翻译（红线）：用户输入、已保存正文、AI 原始研究结果、引用原文、URL、
 *   银行商标、上传文件名、日志。切换语言**只改 UI 资源**，不写业务文本、不丢编辑状态。
 */

import ZH from '../i18n/zh-CN.js';
import EN from '../i18n/en-US.js';

const LS_KEY = 'mos_locale';
const SUPPORTED = ['zh-CN', 'en-US'];

/** 不可翻译节点标记（模块渲染用户内容时贴在容器上） */
export const NOTRANSLATE_ATTR = 'data-notranslate';
/** 不可翻译选择器（测试与排查用；与 bindDom 的实际跳过逻辑保持一致） */
export const NO_I18N_SELECTOR = '[data-notranslate],input,textarea,select,option,pre,code,'
  + 'script,style,samp,kbd,[contenteditable]';

const PROTECTED_TAGS = {
  INPUT: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1, PRE: 1, CODE: 1,
  SCRIPT: 1, STYLE: 1, SAMP: 1, KBD: 1
};

let current = 'zh-CN';

/* ---------------- 反向索引：源文案 → 键（键成对且精确匹配，不做模糊/分词匹配） ---------------- */

const ZH_INDEX = Object.create(null); // 中文取值 → key
const EN_INDEX = Object.create(null); // 英文取值 → key
for (const k of Object.keys(ZH)) {
  const z = ZH[k];
  if (typeof z === 'string' && z && ZH_INDEX[z] === undefined) ZH_INDEX[z] = k;
}
for (const k of Object.keys(EN)) {
  const e = EN[k];
  if (typeof e === 'string' && e && EN_INDEX[e] === undefined) EN_INDEX[e] = k;
}

/** 资源键总表（测试与排查用） */
export function resourceKeys() { return Object.keys(ZH); }
export function resourceOf(locale) { return locale === 'en-US' ? EN : ZH; }
export function hasKey(key) { return Object.prototype.hasOwnProperty.call(ZH, key); }

/* ---------------- 语言状态 ---------------- */

export function getLocale() { return current; }

export function availableLocales() {
  return [{ code: 'zh-CN', label: '中文' }, { code: 'en-US', label: 'English' }];
}

/** 浏览器初始语言（仅作**初始默认**，账户偏好与本地记忆均可覆盖） */
function browserLocale() {
  try {
    const nav = String((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase();
    if (nav.indexOf('zh') === 0) return 'zh-CN';
    if (nav.indexOf('en') === 0) return 'en-US';
  } catch (_) { /* ignore */ }
  return null;
}

/**
 * 初始化（登录后调用）：服务端账户偏好 > 本地临时记忆 > 初始浏览器语言 > 组织默认 zh-CN。
 * 服务端偏好为**权威**，可覆盖浏览器语言。
 */
export function initLocale(serverLocale) {
  const saved = String(serverLocale || '').trim();
  if (SUPPORTED.indexOf(saved) !== -1) { current = saved; return current; }
  try {
    const ls = localStorage.getItem(LS_KEY);
    if (SUPPORTED.indexOf(ls) !== -1) { current = ls; return current; }
  } catch (_) { /* ignore */ }
  current = browserLocale() || 'zh-CN';
  return current;
}

/**
 * 切换语言：**只影响 UI 资源**——不发起任何业务文本写入、不丢编辑状态。
 * 持久化由调用方通过 `PUT /api/mos/auth/preferences` 完成。
 */
export function setLocale(locale) {
  if (SUPPORTED.indexOf(locale) === -1) return current;
  current = locale;
  try { localStorage.setItem(LS_KEY, locale); } catch (_) { /* ignore */ }
  return current;
}

/* ---------------- 取值 ---------------- */

function interpolate(s, params) {
  const str = String(s == null ? '' : s);
  if (!params) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (params[k] === undefined || params[k] === null ? m : String(params[k])));
}

/**
 * 取文案。
 * @param {string} key 资源键（如 `status.DRAFT`）；为兼容历史调用，也接受**源语言原文**
 *   （精确匹配反向索引，命中即等价于其键）。
 * @param {object} [params] `{name}` 占位符取值。
 * @returns {string} 命中则返回当前语言文案；未登记（品牌专名/用户内容/URL/未知码）**原样返回**。
 */
export function t(key, params) {
  const raw = String(key == null ? '' : key);
  if (!raw) return '';
  let k = hasKey(raw) ? raw : null;
  if (!k) k = ZH_INDEX[raw] || EN_INDEX[raw] || null;
  if (!k) return interpolate(raw, params);
  const val = current === 'en-US' ? EN[k] : ZH[k];
  return interpolate(val === undefined || val === null ? raw : val, params);
}

/** 面包屑/组合串：按「/」分段逐段取值，保留分隔符两侧空格 */
export function tPath(s) {
  const v = String(s == null ? '' : s);
  if (v.indexOf('/') === -1) return t(v);
  return v.split('/').map((seg) => t(seg.trim())).join(' / ');
}

/* ---------------- 统一状态 / 错误码映射（执行包 05 §统一状态/错误码映射） ---------------- */

function nsLabel(ns, code, fallbackKey) {
  const c = String(code == null ? '' : code).trim();
  if (!c) return fallbackKey ? t(fallbackKey) : '';
  const key = ns + '.' + c.toUpperCase().replace(/[\s-]+/g, '_');
  if (hasKey(key)) return t(key);
  return fallbackKey ? t(fallbackKey) : c;
}

/** 业务状态（报告/版本/任务/资产） */
export function statusLabel(code, fallbackKey) { return nsLabel('status', code, fallbackKey); }
/** Provider / 集成就绪度：REAL / CONFIGURED_NOT_TESTED / NOT_CONFIGURED / NOT_IMPLEMENTED / BLOCKED */
export function readinessLabel(code) { return nsLabel('readiness', code, 'readiness.UNKNOWN'); }
/** 研究完成度：AI_RESEARCH_COMPLETE / RETRIEVAL_ONLY / BLOCKED（RETRIEVAL_ONLY 不得显示为完成） */
export function completionLabel(code) { return nsLabel('completion', code, 'completion.NONE'); }
/** 研究作业阶段 */
export function jobStageLabel(code) { return nsLabel('job', code); }
/** 证据缺口 / 矛盾 */
export function gapLabel(code) { return nsLabel('gap', code); }/** 结论类型：FACT / INTERPRETATION / RECOMMENDATION */
export function kindLabel(code) { return nsLabel('kind', code); }
/** 网页可读性 */
export function availabilityLabel(code) { return nsLabel('availability', code); }
/** 交付物类型 */
export function deliverableLabel(code) { return nsLabel('deliverable', code); }
/** 配图用途（品牌减法：只暴露用途，不暴露模板编号；键为小写命名空间） */
export function purposeLabel(code) {
  const c = String(code == null ? '' : code).trim().toLowerCase();
  return c ? t('purpose.' + c) : '';
}
/** 视觉类型（同上） */
export function visualTypeLabel(code) {
  const c = String(code == null ? '' : code).trim().toLowerCase();
  return c ? t('visualtype.' + c) : '';
}

/**
 * 错误码 → 员工可读文案（API `error.code`）。
 * 未知码返回带码的通用文案（不静默吞掉，便于支持定位）；无码时退回原始 message。
 */
export function errorLabel(code, fallbackMessage) {
  const c = String(code == null ? '' : code).trim();
  if (c) {
    const http = /^HTTP_(\d{3})$/.exec(c);
    if (http) return t('error.http_status', { status: http[1] });
    const key = 'error.' + c.toUpperCase().replace(/[\s-]+/g, '_');
    if (hasKey(key)) return t(key);
    return t('error.generic_with_code', { code: c });
  }
  const fb = String(fallbackMessage == null ? '' : fallbackMessage);
  if (!fb) return t('error.generic');
  return t(fb);
}

/* ---------------- DOM 绑定 ---------------- */

/** 显式标记优先：data-i18n / data-i18n-placeholder / -title / -aria-label / -params */
function bindMarked(el) {
  if (!el.querySelectorAll) return;
  el.querySelectorAll('[data-i18n]').forEach((e) => {
    if (isNoTranslate(e)) return;
    let params = null;
    const p = e.getAttribute('data-i18n-params');
    if (p) { try { params = JSON.parse(p); } catch (_) { params = null; } }
    e.textContent = t(e.getAttribute('data-i18n'), params);
  });
  const attrMap = [
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-title', 'title'],
    ['data-i18n-aria-label', 'aria-label']
  ];
  for (const [marker, attr] of attrMap) {
    el.querySelectorAll('[' + marker + ']').forEach((e) => {
      if (isNoTranslate(e)) return;
      let params = null;
      const p = e.getAttribute('data-i18n-params');
      if (p) { try { params = JSON.parse(p); } catch (_) { params = null; } }
      e.setAttribute(attr, t(e.getAttribute(marker), params));
    });
  }
  el.querySelectorAll('[data-i18n-aria-describedby-hint]').forEach(() => { /* 预留：扩展位 */ });
}

/** 该元素（或其祖先）是否被标记为不可翻译 */
function isNoTranslate(el) {
  let e = el;
  while (e && e.nodeType === 1) {
    if (e.hasAttribute && e.hasAttribute(NOTRANSLATE_ATTR)) return true;
    e = e.parentElement;
  }
  return false;
}

/** 文本节点是否处于不可翻译子树（含受保护表单/代码标签与 contenteditable） */
function isProtectedNode(node) {
  let e = node.nodeType === 1 ? node : node.parentElement;
  while (e && e.nodeType === 1) {
    if (PROTECTED_TAGS[e.tagName]) return true;
    if (e.hasAttribute && e.hasAttribute(NOTRANSLATE_ATTR)) return true;
    if (e.isContentEditable) return true;
    e = e.parentElement;
  }
  return false;
}

/** 精确键匹配（当前语言 → 目标语言）；未命中返回 null */
function lookupValue(s) {
  const idx = current === 'en-US' ? ZH_INDEX : EN_INDEX;
  const k = idx[s];
  if (!k) return null;
  const v = current === 'en-US' ? EN[k] : ZH[k];
  if (v === undefined || v === null || v === s) return null;
  return v;
}

/**
 * 绑定/翻译 DOM（渲染后调用）。
 * - 显式标记（`data-i18n*`）始终生效；
 * - 兼容层只处理**未受保护**的文本节点与 placeholder/title/aria-label，
 *   且必须**精确命中**资源键，否则原样保留。
 * 推荐新代码在渲染期直接 `t(key, params)`，把兼容层当作历史模板的过渡。
 */
export function bindDom(root) {
  const el = root || (typeof document !== 'undefined' ? document : null);
  if (!el) return;
  bindMarked(el);
  if (typeof document === 'undefined' || !document.createTreeWalker) return;
  if (el.nodeType !== 1 && el.nodeType !== 9) return;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (isProtectedNode(n)) continue;
    const raw = n.nodeValue;
    const trimmed = raw.trim();
    const hit = lookupValue(trimmed);
    if (hit) { n.nodeValue = raw.replace(trimmed, hit); continue; }
    if (trimmed.indexOf('/') !== -1) {
      const parts = trimmed.split('/');
      if (parts.length >= 2) {
        const mapped = parts.map((p) => lookupValue(p.trim()));
        if (mapped.every((m) => m !== null)) n.nodeValue = raw.replace(trimmed, mapped.join(' / '));
      }
    }
  }
  if (el.querySelectorAll) {
    el.querySelectorAll('input[placeholder],button[title],[title],[aria-label]').forEach((e) => {
      if (isNoTranslate(e)) return;
      for (const attr of ['placeholder', 'title', 'aria-label']) {
        const v = e.getAttribute && e.getAttribute(attr);
        if (!v) continue;
        const hit = lookupValue(v.trim());
        if (hit) e.setAttribute(attr, hit);
      }
    });
  }
}

/** @deprecated V0.1.2 名称；等价于 `bindDom`，保留以兼容既有调用点。 */
export function applyDom(root) { return bindDom(root); }

/* —— en-US 下监听后续 DOM 变化（模块异步加载/局部刷新） —— */
let observer = null;

export function ensureDomObserver() {
  if (typeof document === 'undefined' || !document.body) return;
  if (current === 'en-US' && !observer) {
    let pending = null;
    observer = new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; bindDom(document.body); }, 60);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } else if (current !== 'en-US' && observer) {
    observer.disconnect();
    observer = null;
  }
}

/** 关闭观察器（登出/卸载时调用） */
export function stopDomObserver() {
  if (observer) { observer.disconnect(); observer = null; }
}
