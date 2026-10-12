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
  return {
    identity: { mode: cfg.integrations.identity, mock: cfg.integrations.identity === 'mock', note: '本地隔离测试身份（MockIdentityGateway）' },
    knowledge: Object.assign({ mode: cfg.integrations.knowledge }, knowledge.status()),
    library: Object.assign({ mode: cfg.integrations.library }, library.status()),
    sourceIngest: Object.assign({ mode: cfg.integrations.sourceIngest }, source.status()),
    textProvider: Object.assign({ mode: cfg.integrations.textProvider }, text.status()),
    imageProvider: Object.assign({ mode: cfg.integrations.imageProvider }, image.status()),
    oa: { mode: 'not_integrated', note: '企业 OA 真实接口尚未审计接通（06 §1）' }
  };
}

/** 字典（可被 config.json 的 mos.dictionaries 覆盖标签） */
function dictionaries() {
  const cfg = getMosConfig();
  const overrides = cfg.dictionaries || {};
  const out = {};
  for (const key of Object.keys(DICTIONARIES)) {
    out[key] = DICTIONARIES[key].map((entry) => {
      const ov = overrides[key] && overrides[key][entry.code];
      if (!ov) return Object.assign({}, entry);
      return Object.assign({}, entry, { label: String(ov), provisional: false, source: 'config' });
    });
  }
  return out;
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
  roleCatalogue,
  getDb
};
