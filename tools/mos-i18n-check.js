'use strict';
/* ============================================================
 * Marketing OS · 国际化静态校验（V0.1.3 Phase C，执行包 05 §国际化 / 06 LANG-01）
 * ------------------------------------------------------------
 * 检查项：
 *   1. 资源文件键**一一对应**（zh-CN / en-US），无空值；
 *   2. 键值一致性：同一中文取值只能对应同一英文取值（否则反向索引有歧义）；
 *   3. 插值占位符 {x} 在两个语言中必须一致；
 *   4. 命名空间覆盖：后端枚举（报告完成度/证据可用性/作业状态与阶段/缺口/结论类型/
 *      选题状态）必须全部有映射；
 *   5. 错误码覆盖：`httpError(..., 'CODE')` 抛出的码必须有统一映射或落到通用码（报告覆盖率）；
 *   6. 保护完整性（LANG-01）：i18n 引擎必须内置不可翻译规则（data-notranslate、
 *      input/textarea/select/option/pre/code、contenteditable），且各页面已对
 *      用户内容/AI 原文/来源/文件名/URL 加标记。
 *
 * 运行：node tools/mos-i18n-check.js
 * 约束：零第三方依赖；不启动服务、不写业务数据。
 * ============================================================ */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'TEST_EVIDENCE_MOS_V013_I18N');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  :: ' + detail : ''));
}

const ZH_PATH = path.join(ROOT, 'public', 'mos', 'i18n', 'zh-CN.js');
const EN_PATH = path.join(ROOT, 'public', 'mos', 'i18n', 'en-US.js');
const ENGINE = path.join(ROOT, 'public', 'mos', 'js', 'i18n.js');

/** 解析资源文件（生成规则固定：每行 `"key": "value",`） */
function parseResource(file) {
  const src = fs.readFileSync(file, 'utf8');
  const map = new Map();
  const re = /^ {2}"((?:[^"\\]|\\.)*)":\s*"((?:[^"\\]|\\.)*)",\s*$/gm;
  let m;
  while ((m = re.exec(src))) {
    map.set(JSON.parse('"' + m[1] + '"'), JSON.parse('"' + m[2] + '"'));
  }
  return { src, map };
}

const zh = parseResource(ZH_PATH);
const en = parseResource(EN_PATH);
const engineSrc = fs.readFileSync(ENGINE, 'utf8');

/* ---------------- 1. 键一一对应 ---------------- */
const zhKeys = [...zh.map.keys()];
const enKeys = [...en.map.keys()];
const missingEn = zhKeys.filter((k) => !en.map.has(k));
const missingZh = enKeys.filter((k) => !zh.map.has(k));
check('I18N-01 zh-CN / en-US 键集合一致（一一对应）',
  missingEn.length === 0 && missingZh.length === 0,
  'zh=' + zhKeys.length + ' en=' + enKeys.length
  + (missingEn.length ? ' 缺 en: ' + missingEn.slice(0, 5).join(',') : '')
  + (missingZh.length ? ' 缺 zh: ' + missingZh.slice(0, 5).join(',') : ''));

/* ---------------- 2. 空值 ---------------- */
const emptyZh = zhKeys.filter((k) => !String(zh.map.get(k)).trim());
const emptyEn = enKeys.filter((k) => !String(en.map.get(k)).trim());
check('I18N-02 无空取值', emptyZh.length === 0 && emptyEn.length === 0,
  'zh 空=' + emptyZh.length + ' en 空=' + emptyEn.length);

/* ---------------- 3. 反向索引歧义（同一中文 → 必须同一英文） ---------------- */
const byZh = new Map();
const ambiguous = [];
for (const k of zhKeys) {
  if (!en.map.has(k)) continue;
  const z = zh.map.get(k);
  const e = en.map.get(k);
  if (byZh.has(z) && byZh.get(z).e !== e) ambiguous.push(z + ' → ' + byZh.get(z).e + ' / ' + e);
  else if (!byZh.has(z)) byZh.set(z, { k, e });
}
check('I18N-03 同一中文取值对应唯一英文（无反向索引歧义）', ambiguous.length === 0,
  ambiguous.length ? ambiguous.slice(0, 3).join(' | ') : byZh.size + ' 个唯一中文键');

/* ---------------- 4. 插值占位符一致 ---------------- */
const ph = (s) => (String(s).match(/\{(\w+)\}/g) || []).sort().join(',');
const phBad = zhKeys.filter((k) => en.map.has(k) && ph(zh.map.get(k)) !== ph(en.map.get(k)));
check('I18N-04 插值占位符 {x} 双语一致', phBad.length === 0, phBad.slice(0, 5).join(', '));

/* ---------------- 5. 命名空间覆盖（对齐后端真实枚举） ---------------- */
let lib = null;
try { lib = require(path.join(ROOT, 'lib', 'mos', 'researchlib.js')); } catch (e) { lib = null; }
const nsExpect = [];
if (lib) {
  for (const c of lib.REPORT_COMPLETION || []) nsExpect.push(['completion', c]);
  for (const c of lib.EVIDENCE_AVAILABILITY || []) nsExpect.push(['availability', c]);
  for (const c of lib.JOB_STATUS || []) nsExpect.push(['status', c]);
  for (const c of lib.JOB_STAGES || []) nsExpect.push(['job', c]);
  for (const c of lib.GAP_KINDS || []) nsExpect.push(['gap', c]);
  for (const c of lib.FINDING_KINDS || []) nsExpect.push(['kind', c]);
  for (const c of lib.PROPOSAL_STATUS || []) nsExpect.push(['status', c]);
  for (const c of lib.REPORT_STATUS || []) nsExpect.push(['status', c]);
}
const nsMissing = nsExpect.filter(([ns, c]) => !zh.map.has(ns + '.' + String(c).toUpperCase()));
check('I18N-05 后端枚举全部有统一映射（completion/status/job/gap/kind/availability）',
  lib !== null && nsMissing.length === 0 && nsExpect.length > 25,
  '覆盖 ' + (nsExpect.length - nsMissing.length) + '/' + nsExpect.length
  + (nsMissing.length ? ' 缺: ' + nsMissing.slice(0, 6).map((x) => x[0] + '.' + x[1]).join(',') : ''));

/* ---------------- 6. 错误码覆盖率 ---------------- */
function collectCodes(dir, acc) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { collectCodes(p, acc); continue; }
    if (!e.name.endsWith('.js')) continue;
    const src = fs.readFileSync(p, 'utf8');
    const re = /httpError\(\s*\d+\s*,\s*'[^']*'\s*,\s*'([A-Z0-9_]+)'/g;
    let m;
    while ((m = re.exec(src))) acc.add(m[1]);
  }
  return acc;
}
const codes = collectCodes(path.join(ROOT, 'lib', 'mos'), new Set());
const codesCovered = [...codes].filter((c) => zh.map.has('error.' + c));
const uncovered = [...codes].filter((c) => !zh.map.has('error.' + c));
const rate = codes.size ? Math.round((codesCovered.length / codes.size) * 100) : 0;
check('I18N-06 路由错误码映射覆盖率 ≥ 80%（未覆盖的回落通用码，不静默）',
  rate >= 80 && codes.size > 30,
  codesCovered.length + '/' + codes.size + ' = ' + rate + '%'
  + (uncovered.length ? ' 未映射(前5): ' + uncovered.slice(0, 5).join(',') : ''));

/* ---------------- 7. 保护规则完整性（LANG-01） ---------------- */
check('I18N-07 引擎内置不可翻译选择器（data-notranslate/表单/代码/contenteditable）',
  /NO_I18N_SELECTOR/.test(engineSrc)
  && /'\[data-notranslate\],input,textarea,select,option,pre,code,'/.test(engineSrc)
  && /\[contenteditable\]/.test(engineSrc),
  'NO_I18N_SELECTOR 含 9 类受保护节点');

check('I18N-08 引擎提供 bindDom 并逐节点执行保护判定（非全局无差别替换）',
  /export function bindDom/.test(engineSrc)
  && /function isProtectedNode/.test(engineSrc)
  && /if \(isProtectedNode\(n\)\) continue;/.test(engineSrc)
  && /function isNoTranslate/.test(engineSrc),
  'isProtectedNode + isNoTranslate 均在替换前判定');

check('I18N-09 显式标记绑定（data-i18n / placeholder / title / aria-label / params）',
  /data-i18n-placeholder/.test(engineSrc) && /aria-label/.test(engineSrc)
  && /data-i18n-params/.test(engineSrc),
  '含 ARIA 与占位符标记');

check('I18N-10 统一状态/错误码 API 齐备（statusLabel/errorLabel/readinessLabel/...）',
  ['statusLabel', 'errorLabel', 'readinessLabel', 'completionLabel', 'jobStageLabel',
    'gapLabel', 'kindLabel', 'availabilityLabel', 'deliverableLabel',
    'purposeLabel', 'visualTypeLabel'].every((f) => new RegExp('export function ' + f).test(engineSrc)),
  '11 个映射函数');

check('I18N-11 参数插值实现（{key} 占位符）',
  /function interpolate/.test(engineSrc) && engineSrc.indexOf('/\\{(\\w+)\\}/g') !== -1,
  'interpolate() 支持命名参数');

/* ---------------- 8. 页面级保护标记到位 ---------------- */
const MARKED = [
  ['public/mos/js/modules/intelligence.js', 20, '研究/来源/AI 原文'],
  ['public/mos/js/modules/studio.js', 4, '任务正文与备注'],
  ['public/mos/js/components/reviewkit.js', 2, '审核意见与文件名'],
  ['public/mos/js/modules/content.js', 1, '资产文件名与备注'],
  ['public/mos/js/modules/governance.js', 1, '上传文件名与回执原文'],
  ['public/mos/js/modules/publishing.js', 1, '归档文件名']
];
for (const [rel, min, label] of MARKED) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const n = (src.match(/data-notranslate/g) || []).length;
  check('I18N-12 ' + rel + ' 已保护' + label + '（≥' + min + ' 处）', n >= min, n + ' 处标记');
}

/* ---------------- 9. 语言切换不写业务文本 ---------------- */
const appSrc = fs.readFileSync(path.join(ROOT, 'public/mos', 'js', 'app.js'), 'utf8');
check('I18N-13 语言切换保留未保存编辑（hasUnsaved 判定，不 remount 丢状态）',
  /mounted\.hasUnsaved\(\)/.test(appSrc) && /notice\.locale_kept_edits/.test(appSrc),
  '切语言前检查 hasUnsaved()');
check('I18N-14 语言切换仅写偏好接口（不写业务文本）',
  /api\.put\('\/api\/mos\/auth\/preferences', \{ locale: next \}\)/.test(appSrc)
  && !/setLocale[\s\S]{0,400}api\.put\('\/api\/mos\/[^']*(content|task|version)/.test(appSrc),
  '仅 PUT /auth/preferences');

/* ---------------- 10. 错误提示走统一映射（单点生效） ---------------- */
const apiSrc = fs.readFileSync(path.join(ROOT, 'public/mos', 'js', 'api.js'), 'utf8');
check('I18N-15 ApiError.message 经统一错误码映射（覆盖全部 err.message 调用点）',
  /import \{ errorLabel \} from '\.\/i18n\.js';/.test(apiSrc)
  && /get\(\) \{ return errorLabel\(code, message\); \}/.test(apiSrc)
  && /rawMessage/.test(apiSrc),
  '服务端原文保留在 rawMessage（不翻译）');

/* ---------------- 11. 前端导入完整性（真实缺陷：使用了 t() 却未导入 → 运行期 ReferenceError） ---------------- */
const I18N_API = ['t', 'tPath', 'bindDom', 'applyDom', 'statusLabel', 'errorLabel', 'readinessLabel',
  'completionLabel', 'jobStageLabel', 'gapLabel', 'kindLabel', 'availabilityLabel',
  'deliverableLabel', 'purposeLabel', 'visualTypeLabel'];
const jsFiles = [];
(function walkJs(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walkJs(p); continue; }
    if (e.name.endsWith('.js')) jsFiles.push(p);
  }
})(path.join(ROOT, 'public', 'mos', 'js'));
const importIssues = [];
for (const f of jsFiles) {
  if (f.endsWith('i18n.js')) continue;
  const src = fs.readFileSync(f, 'utf8');
  const imported = new Set();
  const im = src.match(/import\s*\{([^}]*)\}\s*from\s*'[^']*i18n\.js'/);
  if (im) im[1].split(',').forEach((x) => imported.add(x.trim().split(/\s+as\s+/).pop()));
  for (const n of I18N_API) {
    const used = new RegExp('(?<![\\w.$])' + n + '\\s*\\(').test(src);
    if (!used) continue;
    // 本文件自行定义的（如 ui.js 的 statusLabel 包装）不算问题
    const locallyDefined = new RegExp('(export )?function ' + n + '\\s*\\(').test(src);
    if (imported.has(n) || locallyDefined) continue;
    importIssues.push(path.relative(ROOT, f) + ' -> ' + n);
  }
}
check('I18N-16 前端使用 i18n API 的模块均已正确导入（无运行期 ReferenceError）',
  importIssues.length === 0, importIssues.slice(0, 5).join(' | '));

/* ---------------- 写出证据 ---------------- */
const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
try {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'i18n-check-result.json'), JSON.stringify({
    suite: 'i18n', total: results.length, passed, failed,
    ranAt: new Date().toISOString(),
    zhKeys: zhKeys.length, enKeys: enKeys.length,
    errorCodeCoverage: { covered: codesCovered.length, total: codes.size, percent: rate },
    i18nImportIssues: importIssues,
    results
  }, null, 2));
} catch (_) { /* 证据写入失败不影响退出码 */ }

console.log('\n[i18n] ' + passed + '/' + results.length + ' 通过' + (failed ? '，' + failed + ' 失败' : ''));
process.exitCode = failed ? 1 : 0;
