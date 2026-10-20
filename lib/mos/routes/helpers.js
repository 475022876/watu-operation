'use strict';
/**
 * MOS 路由公共工具：品牌解析、分页、序列化、集成状态。
 */
const { getDb } = require('../store');
const { httpError } = require('../../util');
const { getMosConfig } = require('../config');
const { BRAND_CODES, BRANDS, DICTIONARIES, PERMISSIONS, ROLES } = require('../dict');
const rbac = require('../rbac');

const BRAND_BY_CODE = {};
for (const b of BRANDS) BRAND_BY_CODE[b.code] = b;

/** 解析并断言请求品牌：优先 query，其次 body，最后主体唯一可见品牌 */
function resolveBrand(ctx, explicit) {
  let code = explicit || ctx.query.brand || (ctx.body && ctx.body.brandCode) || '';
  code = String(code || '').trim().toUpperCase();
  if (!code) {
    const visible = ctx.principal ? ctx.principal.brandCodes : [];
    if (visible.length === 1) code = visible[0];
    else throw httpError(400, '请先选择品牌（brand 参数缺失）', 'BRAND_REQUIRED');
  }
  rbac.assertBrand(ctx.principal, code);
  return code;
}

/** 解析品牌：允许无权限时返回 404（不泄露存在性），已在 rbac.assertBrand 内实现 */
function brandOf(code) {
  return BRAND_BY_CODE[code] || null;
}

function paginate(items, query) {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 50));
  const start = (page - 1) * pageSize;
  return { page, pageSize, total: items.length, items: items.slice(start, start + pageSize) };
}

function isDemo(obj) {
  return !!(obj && obj.demo);
}

/** 通用更新：写 row_version + updated_at/by，返回是否真发生变更（乐观并发 409） */
function applyUpdate(row, patch, actorId, expectedRowVersion) {
  if (expectedRowVersion !== undefined && expectedRowVersion !== null
    && Number(expectedRowVersion) !== Number(row.rowVersion || 1)) {
    throw httpError(409, '记录已被他人修改，请刷新后重试', 'ROW_VERSION_CONFLICT');
  }
  let changed = false;
  for (const key of Object.keys(patch)) {
    if (patch[key] === undefined) continue;
    if (row[key] !== patch[key]) { row[key] = patch[key]; changed = true; }
  }
  if (changed) {
    row.rowVersion = Number(row.rowVersion || 1) + 1;
    row.updatedAt = new Date().toISOString();
    row.updatedBy = actorId || '';
  }
  return changed;
}

/** 集成状态矩阵（Mock/Real 的唯一权威输出） */
function integrationStatus() {
  const cfg = getMosConfig();
  const library = require('../adapters/library');
  const knowledge = require('../adapters/knowledge');
  const source = require('../adapters/source');
  const text = require('../adapters/text');
  const image = require('../adapters/image');
  const video = require('../adapters/video');
  const websearch = require('../adapters/websearch');
  const wsAdapter = require('../adapters/workspace');
  return {
    identity: { mode: cfg.integrations.identity, mock: cfg.integrations.identity === 'mock', note: '本地隔离测试身份（MockIdentityGateway）' },
    knowledge: Object.assign({ mode: cfg.integrations.knowledge }, knowledge.status()),
    library: Object.assign({ mode: cfg.integrations.library }, library.status()),
    sourceIngest: Object.assign({ mode: cfg.integrations.sourceIngest }, source.status()),
    textProvider: Object.assign({ mode: text.status().mode }, text.status()),
    imageProvider: Object.assign({ mode: image.status().mode }, image.status()),
    // V0.1.4：视频已实现异步真实接入；**未配置时仍是 NOT_CONFIGURED**，能力里才声明 AI_RENDER
    videoProvider: video.status(),
    // V0.1.4：网页检索就绪度（未配置 → NOT_CONFIGURED，与 Web 研究的 BLOCKED 同源）
    webSearchProvider: (() => {
      const st = websearch.providerStatus();
      return { mode: st.provider || 'none', readiness: st.readiness || 'NOT_CONFIGURED', note: st.note || '' };
    })(),
    // A-06：企业资料库（Enterprise Workspace）适配层状态——未配置凭据时如实为 NOT_CONFIGURED
    // 注：此处同步汇总；A-05 的 Provider 探针见 GET /api/mos/providers/health
    enterpriseLibrary: Object.assign({ mode: cfg.integrations.library === 'real' ? 'real' : 'not_configured' }, wsAdapter.status()),
    oa: { mode: 'not_integrated', note: '企业 OA 真实接口尚未审计接通（06 §1）' }
  };
}

/**
 * 字典（标签覆盖的唯一入口）。
 *
 * F-07 修正（自审缺陷 B05-04）：原实现只要 `config.json` 给了字符串标签，
 * 就把它标记为 `provisional:false / source:'config'` —— 等于**用一行配置就把"待核验"洗成"正式"**，
 * 正是整改主控明令禁止的「不能凭 AI 创作/猜测填成正式标签」。
 * 现在一律走 `dictverify.applyOverrides()`：证据不足只改显示名并保持 `provisional:true`。
 */
function dictionaries(db) {
  const cfg = getMosConfig();
  const overrides = cfg.dictionaries || {};
  const dictVerify = require('../dictverify');
  let live = db;
  if (!live) { try { live = getDb(); } catch (_) { live = null; } }
  const out = {};
  for (const key of Object.keys(DICTIONARIES)) {
    const res = dictVerify.applyOverrides(key, DICTIONARIES[key], overrides[key]);
    out[key] = res.items;
  }
  // 运行时核验登记（settings.dictionaryVerifications）叠加到 provisional 项上
  for (const row of dictVerify.registry(live)) {
    if (row.status !== 'VERIFIED') continue;
    const target = (out[row.dictKey] || []).find((e) => e.code === row.code);
    if (target) {
      target.label = row.label;
      target.provisional = false;
      target.source = row.sourceDocument + '@' + row.sourceVersion;
      target.sourceVersion = row.sourceVersion;
      target.evidenceRef = row.evidenceRef;
      target.verifiedAt = row.verifiedAt;
    }
  }
  return out;
}

/** 字典覆盖的核验审计：哪些覆盖被接受、哪些因证据不足被拒（F-07，供 API/自检使用） */
function dictionaryAudit() {
  const cfg = getMosConfig();
  const overrides = cfg.dictionaries || {};
  const dictVerify = require('../dictverify');
  const applied = [];
  const rejected = [];
  for (const key of Object.keys(DICTIONARIES)) {
    const res = dictVerify.applyOverrides(key, DICTIONARIES[key], overrides[key]);
    for (const a of res.applied) applied.push(Object.assign({ dictKey: key }, a));
    for (const r of res.rejected) rejected.push(Object.assign({ dictKey: key }, r));
  }
  return { applied, rejected };
}

function roleCatalogue() {
  return Object.keys(ROLES).map((code) => ({
    code,
    label: ROLES[code].label,
    kind: ROLES[code].kind,
    permissions: ROLES[code].permissions.slice()
  }));
}

module.exports = {
  BRAND_BY_CODE,
  BRAND_CODES,
  PERMISSIONS,
  resolveBrand,
  brandOf,
  paginate,
  isDemo,
  applyUpdate,
  integrationStatus,
  dictionaries,
  dictionaryAudit,
  roleCatalogue,
  getDb
};
