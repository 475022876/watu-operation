'use strict';
/**
 * Marketing OS —— 专业字典 provisional 项核验机制（F-07）。
 *
 * 问题（整改主控 F-07 原文）：
 *   「`lib/mos/dict.js` 中以 SPECIAL-01 V1.1 正式原件和 Visual Skill V1.2 核验 `provisional` 项：
 *     可证实则录入名称/说明/来源版本，不能证实则保持待核验；**不能凭 AI 创作填成正式标签**。」
 *
 * 本轮的**事实前提**（必须写清楚，不得含糊）：
 *   · 本轮整改包**未随附**《VFIB 全球社交媒体运营与内容生产指导手册 V1.1》(SPECIAL-01) 原件，
 *     也未提供《VFIB Visual Brand Guardian Skill V1.2》的正式批准记录；
 *   · 因此 C01–C06 / N01–N05 / V01–V05 / M01–M05 / A01–A08 / PPT-01–08 / D0–D3
 *     这些**编码集合**只能按主控文档明示的编码建表，标签一律**保持「待核验」**。
 *
 * 因此本模块交付的不是「已核验的标签」，而是一套**可核验、可追责、防伪造**的机制：
 *   1. `SOURCE_DOCUMENTS` —— 权威原件登记（含"是否已随包提供"的如实声明）；
 *   2. `registry()` —— 逐条列出所有 provisional 项及其归属原件与核验状态；
 *   3. `applyOverrides()` —— **唯一的标签覆盖入口**，且规定：
 *        · 只给 `label` 字符串 → 仅覆盖显示名，条目**仍然 provisional**（`source: 'config_unverified'`）；
 *        · 给出 `{label, sourceVersion, evidenceRef, verifiedBy}` → 才允许标记为已核验，
 *          并把**来源版本 + 证据引用**落到条目上（可追溯）。
 *      —— 这条规则直接封堵了「用配置/AI 文案把待核验标签伪装成正式标签」的路径
 *         （原实现只要给一个字符串就把 `provisional` 置 false，属自审发现缺陷 B05-04）。
 *   4. `verify()` —— 运行时登记核验证据（写入 `settings.dictionaryVerifications`），
 *      **缺少来源版本或证据引用时一律拒绝**，并如实返回 `EVIDENCE_REQUIRED`。
 *
 * 诚实性底线：本模块**不产生任何官方标签**；未取得原件前，所有 provisional 项保持「待核验」，
 *   并在 API/UI 中如实呈现。
 */
const { DICTIONARIES } = require('./dict');

/** 权威原件登记（"providedToDev" 如实反映本轮是否拿到原件） */
const SOURCE_DOCUMENTS = {
  SPECIAL_01: {
    key: 'SPECIAL_01',
    title: 'VFIB 全球社交媒体运营与内容生产指导手册',
    version: 'V1.1',
    custodian: '企业资料库（正式文件单一权威）',
    providedToDev: false,
    note: '本轮整改包**未随附**该手册正式原件：编码集合按主控文档明示建立，标签保持「待核验」，'
      + '不得凭 AI 创作或推测填写为正式栏目/叙事/资产名。'
  },
  VISUAL_SKILL_V12: {
    key: 'VISUAL_SKILL_V12',
    title: 'VFIB Visual Brand Guardian Skill',
    version: 'V1.2',
    custodian: '企业资料库（Skill 单一权威）',
    providedToDev: false,
    note: '该 Skill 在系统中当前为 `REFERENCE_ONLY`（文件规范引用），**未在资料库正式批准**：'
      + '因此不得据其生成"正式"视觉/模板/显示分档标签。'
  }
};

/**
 * provisional 字典键 → 权威原件归属。
 * 未列出的字典键视为 `source: 'SPEC'`（主控文档已明示标签），不参与核验。
 */
const PROVISIONAL_SOURCES = {
  pillars: 'SPECIAL_01',
  narratives: 'SPECIAL_01',
  visuals: 'VISUAL_SKILL_V12',
  motions: 'VISUAL_SKILL_V12',
  assetCategories: 'SPECIAL_01',
  templateCodes: 'VISUAL_SKILL_V12',
  displays: 'VISUAL_SKILL_V12'
};

const PROVISIONAL_KEYS = Object.keys(PROVISIONAL_SOURCES);

/** 核验状态取值 */
const VERIFY_STATUSES = ['UNVERIFIED', 'VERIFIED', 'REJECTED'];

function isProvisionalKey(dictKey) {
  return PROVISIONAL_KEYS.indexOf(String(dictKey)) !== -1;
}

function sourceDocumentOf(dictKey) {
  const key = PROVISIONAL_SOURCES[dictKey];
  return key ? SOURCE_DOCUMENTS[key] : null;
}

/**
 * 逐条登记表：所有 provisional 项 + 核验状态。
 * @param {object} db 可选；提供时并入运行时登记的核验证据
 */
function registry(db) {
  const runtime = (db && db.settings && db.settings.dictionaryVerifications) || {};
  const rows = [];
  for (const dictKey of PROVISIONAL_KEYS) {
    const doc = sourceDocumentOf(dictKey);
    for (const entry of (DICTIONARIES[dictKey] || [])) {
      const rk = dictKey + ':' + entry.code;
      const rec = runtime[rk] || null;
      const verified = !!(rec && rec.status === 'VERIFIED');
      rows.push({
        dictKey,
        code: entry.code,
        label: entry.label,
        provisional: entry.provisional !== false,
        status: verified ? 'VERIFIED' : 'UNVERIFIED',
        sourceDocument: doc ? doc.key : '',
        sourceTitle: doc ? doc.title : '',
        sourceVersionRequired: doc ? doc.version : '',
        sourceVersion: verified ? rec.sourceVersion : '',
        evidenceRef: verified ? rec.evidenceRef : '',
        verifiedBy: verified ? rec.verifiedBy : '',
        verifiedAt: verified ? rec.verifiedAt : '',
        note: verified ? '' : ('待核验：需以 ' + (doc ? doc.title + ' ' + doc.version : '正式原件')
          + ' 逐条核对后方可录入正式名称')
      });
    }
  }
  return rows;
}

function summary(db) {
  const rows = registry(db);
  const byKey = {};
  for (const r of rows) {
    if (!byKey[r.dictKey]) {
      byKey[r.dictKey] = { dictKey: r.dictKey, total: 0, verified: 0, unverified: 0, sourceDocument: r.sourceDocument };
    }
    byKey[r.dictKey].total += 1;
    if (r.status === 'VERIFIED') byKey[r.dictKey].verified += 1;
    else byKey[r.dictKey].unverified += 1;
  }
  return {
    sourceDocuments: Object.keys(SOURCE_DOCUMENTS).map((k) => Object.assign({}, SOURCE_DOCUMENTS[k])),
    keys: byKey,
    total: rows.length,
    verified: rows.filter((r) => r.status === 'VERIFIED').length,
    unverified: rows.filter((r) => r.status !== 'VERIFIED').length,
    rule: '未取得正式原件时一律保持「待核验」；只有同时提供 sourceVersion + evidenceRef 才可标记为已核验。'
  };
}

/* ==================== 标签覆盖（唯一入口） ==================== */

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * 校验一条核验证据是否充分。
 * @returns {{ok:boolean, code?:string, message?:string}}
 */
function validateEvidence(dictKey, override) {
  if (!isPlainObject(override)) {
    return { ok: false, code: 'EVIDENCE_REQUIRED', message: '字符串形式的覆盖仅改显示名，不能作为核验证据' };
  }
  const doc = sourceDocumentOf(dictKey);
  const sv = String(override.sourceVersion || '').trim();
  const ev = String(override.evidenceRef || '').trim();
  if (!sv) return { ok: false, code: 'MISSING_SOURCE_VERSION', message: '缺少来源版本（sourceVersion）：无法证明依据的是哪一版原件' };
  if (!ev) return { ok: false, code: 'MISSING_EVIDENCE_REF', message: '缺少证据引用（evidenceRef，如手册章节/页码/文件哈希）：不得凭推测标记为正式' };
  if (doc && !doc.providedToDev && String(override.confirmedOriginalProvided) !== 'true') {
    return {
      ok: false,
      code: 'ORIGINAL_NOT_PROVIDED',
      message: '本轮未随附 ' + doc.title + ' ' + doc.version + ' 正式原件：如已另行取得，'
        + '请在覆盖项中显式声明 confirmedOriginalProvided=true 并给出证据引用'
    };
  }
  return { ok: true };
}

/**
 * 对单个字典集合应用覆盖。
 *
 * @param {string} dictKey
 * @param {Array} entries DICTIONARIES[dictKey]
 * @param {object} overrides { [code]: string | {label, sourceVersion, evidenceRef, verifiedBy, confirmedOriginalProvided} }
 * @returns {{items:Array, applied:Array, rejected:Array}}
 */
function applyOverrides(dictKey, entries, overrides) {
  const ov = isPlainObject(overrides) ? overrides : {};
  const applied = [];
  const rejected = [];
  const items = (entries || []).map((entry) => {
    const raw = ov[entry.code];
    if (raw === undefined || raw === null || raw === '') return Object.assign({}, entry);

    const label = isPlainObject(raw) ? raw.label : raw;
    if (typeof label !== 'string' || !label.trim()) {
      rejected.push({ code: entry.code, code_: 'BAD_LABEL', message: '覆盖标签必须是非空字符串' });
      return Object.assign({}, entry);
    }

    const check = validateEvidence(dictKey, raw);
    if (!check.ok) {
      // 关键：证据不足 → 只改显示名，**保持待核验**，并记录被拒原因（可审计）
      rejected.push({ code: entry.code, code_: check.code, message: check.message });
      applied.push({ code: entry.code, label: label.trim(), verified: false, via: 'config_unverified' });
      return Object.assign({}, entry, {
        label: label.trim(),
        // 刻意 **不** 置 provisional:false —— 见文件头 B05-04
        provisional: true,
        source: 'config_unverified',
        verificationRejected: check.code,
        verificationNote: check.message
      });
    }

    applied.push({
      code: entry.code, label: label.trim(), verified: true, via: 'config_verified',
      sourceVersion: String(raw.sourceVersion), evidenceRef: String(raw.evidenceRef)
    });
    return Object.assign({}, entry, {
      label: label.trim(),
      provisional: false,
      source: (sourceDocumentOf(dictKey) ? sourceDocumentOf(dictKey).key : 'SPEC') + '@' + String(raw.sourceVersion),
      sourceVersion: String(raw.sourceVersion),
      evidenceRef: String(raw.evidenceRef),
      verifiedBy: String(raw.verifiedBy || ''),
      verifiedAt: new Date().toISOString()
    });
  });
  return { items, applied, rejected };
}

/* ==================== 运行时核验登记 ==================== */

/**
 * 登记一条核验结论（写入 `settings.dictionaryVerifications`）。
 * 缺少来源版本 / 证据引用 → 一律拒绝（`EVIDENCE_REQUIRED` 系列），不写入任何记录。
 *
 * 设计说明：核验记录是**关于字典的元数据**，条数少且当前为 0，因此存放在既有 `settings`
 * 对象中，本轮**不为此新增数据库集合**（避免第二次 schema 版本推进）。
 * 若将来核验记录增多需要查询/分页，应提升为独立集合（已在报告中登记为开放项）。
 */
function verify(db, input) {
  const dictKey = String((input && input.dictKey) || '');
  const code = String((input && input.code) || '');
  if (!isProvisionalKey(dictKey)) {
    return { ok: false, code: 'NOT_PROVISIONAL_KEY', message: '该字典集合不含待核验项：' + dictKey };
  }
  const entry = (DICTIONARIES[dictKey] || []).find((e) => e.code === code);
  if (!entry) return { ok: false, code: 'CODE_NOT_FOUND', message: '编码不存在：' + dictKey + ':' + code };

  const check = validateEvidence(dictKey, input);
  if (!check.ok) return { ok: false, code: check.code, message: check.message };
  const label = String((input && input.label) || '').trim();
  if (!label || label === '待核验') {
    return { ok: false, code: 'MISSING_LABEL', message: '核验通过必须同时给出正式名称（不能是「待核验」）' };
  }

  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  if (!db.settings.dictionaryVerifications || typeof db.settings.dictionaryVerifications !== 'object') {
    db.settings.dictionaryVerifications = {};
  }
  const record = {
    dictKey, code, label,
    status: 'VERIFIED',
    sourceDocument: PROVISIONAL_SOURCES[dictKey],
    sourceVersion: String(input.sourceVersion),
    evidenceRef: String(input.evidenceRef),
    verifiedBy: String((input && input.verifiedById) || ''),
    verifiedByName: String((input && input.verifiedByName) || ''),
    verifiedAt: new Date().toISOString()
  };
  db.settings.dictionaryVerifications[dictKey + ':' + code] = record;
  return { ok: true, record };
}

/** 撤销一条核验（回到待核验；原件失效时应立即调用） */
function unverify(db, dictKey, code) {
  const key = String(dictKey) + ':' + String(code);
  if (db.settings && db.settings.dictionaryVerifications && db.settings.dictionaryVerifications[key]) {
    delete db.settings.dictionaryVerifications[key];
    return { ok: true };
  }
  return { ok: false, code: 'NOT_VERIFIED', message: '该条目当前不是已核验状态' };
}

module.exports = {
  SOURCE_DOCUMENTS,
  PROVISIONAL_SOURCES,
  PROVISIONAL_KEYS,
  VERIFY_STATUSES,
  isProvisionalKey,
  sourceDocumentOf,
  registry,
  summary,
  validateEvidence,
  applyOverrides,
  verify,
  unverify
};
