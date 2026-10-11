'use strict';
/**
 * Marketing OS —— RBAC + 品牌范围（ABAC）判定引擎（03 §4 / 06 §4）。
 *
 * 不可动摇的口径：
 *   1. **服务端强制**：前端隐藏控件不等于安全（03 §5）；所有动作在此判定。
 *   2. **默认拒绝**：无角色、无该动作权限、品牌不在范围 → 403。
 *   3. **品牌范围来自会话与对象联合判断**（01 §1）：先看主体能否触达品牌，再看动作权限。
 *   4. **技术管理员不自动获得最终入库特权**（03 §2.4：library.asset.approve.final 为独立特权）。
 *   5. 未授权动作返回 403 且**写审计事件**（03 §5）。
 */
const { httpError } = require('../util');
const { ROLES, BRANDS } = require('./dict');
const { appendAudit } = require('./audit');

const BRAND_BY_CODE = {};
for (const b of BRANDS) BRAND_BY_CODE[b.code] = b;

/** 主体（UserPrincipal）：由 MockIdentityGateway 产出，形态与未来真实 IdP 保持一致 */
function principalOf(db, user) {
  if (!user) return null;
  const grants = (db.user_roles || []).filter((r) => r.userId === user.id);
  const roles = grants.map((g) => ({
    roleCode: g.roleCode,
    roleLabel: (ROLES[g.roleCode] || {}).label || g.roleCode,
    brandScope: Array.isArray(g.brandScope) ? g.brandScope.slice() : ['*'],
    grantedAt: g.grantedAt
  }));

  const permsByBrand = {};
  const ensure = (brand) => {
    if (!permsByBrand[brand]) permsByBrand[brand] = new Set();
    return permsByBrand[brand];
  };
  for (const r of roles) {
    const def = ROLES[r.roleCode];
    if (!def) continue;
    for (const scope of r.brandScope) {
      const set = ensure(scope);
      for (const p of def.permissions) set.add(p);
    }
  }

  const brandCodes = new Set();
  for (const r of roles) {
    for (const s of r.brandScope) {
      if (s === '*') { for (const b of BRANDS) brandCodes.add(b.code); } else brandCodes.add(s);
    }
  }

  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    demo: !!user.demo,
    mustChangePassword: !!user.mustChangePassword,
    roles,
    roleCodes: roles.map((r) => r.roleCode),
    brandCodes: Array.from(brandCodes),
    permsByBrand
  };
}

/** 主体对某品牌是否在范围内 */
function inBrandScope(principal, brandCode) {
  if (!principal || !brandCode) return false;
  return principal.brandCodes.indexOf(brandCode) !== -1;
}

/** 主体在某品牌的权限集合（含 '*' 通配） */
function permissionsFor(principal, brandCode) {
  const out = new Set();
  if (!principal) return out;
  const all = principal.permsByBrand['*'];
  if (all) for (const p of all) out.add(p);
  const scoped = principal.permsByBrand[brandCode];
  if (scoped) for (const p of scoped) out.add(p);
  return out;
}

function can(principal, action, brandCode) {
  if (!principal) return false;
  if (brandCode && !inBrandScope(principal, brandCode)) return false;
  // 无品牌上下文的权限（如查看品牌列表）只要在任一品牌拥有该权限即可
  if (!brandCode) {
    for (const code of principal.brandCodes) {
      if (permissionsFor(principal, code).has(action)) return true;
    }
    return false;
  }
  return permissionsFor(principal, brandCode).has(action);
}

/**
 * 断言动作权限；失败抛 403 并写审计（03 §5「未授权审批：返回 403 及 AuditEvent」）。
 * @param {object} principal
 * @param {string} action 权限码
 * @param {string|null} brandCode
 * @param {object} meta { ip, objectType, objectId, eventType }
 */
function assertCan(principal, action, brandCode, meta) {
  if (can(principal, action, brandCode)) return true;
  const m = meta || {};
  appendAudit({
    actorId: principal ? principal.id : '',
    brandCode: brandCode || '',
    // 统一事件名：所有 RBAC 拒绝都记为 permission.denied，具体权限点/场景写进 metadata，
    // 保证安全监控只需盯一个事件名即可覆盖全部越权（AUD-01）。
    eventType: 'permission.denied',
    objectType: m.objectType || '',
    objectId: m.objectId || '',
    outcome: 'denied',
    ip: m.ip || '',
    metadata: { action, reason: principal ? 'insufficient_permission' : 'no_principal', scene: m.scene || m.eventType || '' }
  });
  throw httpError(403, '当前账号没有该操作的权限（服务端拒绝）', 'FORBIDDEN');
}

/**
 * 断言主体可访问某品牌。品牌不存在 → 404；品牌不在范围 → 404（避免枚举其他品牌）。
 * 注意：对**不存在**与**越权**返回同一 404，防止通过状态码差异探测其他品牌是否存在（SEC-03）。
 */
function assertBrand(principal, brandCode) {
  const brand = BRAND_BY_CODE[brandCode];
  if (!brand) throw httpError(404, '品牌不存在', 'BRAND_NOT_FOUND');
  if (!principal || !inBrandScope(principal, brandCode)) {
    appendAudit({
      actorId: principal ? principal.id : '',
      brandCode: brandCode || '',
      eventType: 'brand.scope.denied',
      objectType: 'brand',
      objectId: brandCode || '',
      outcome: 'denied',
      metadata: { reason: 'out_of_scope' }
    });
    // 返回 404 而非 403：与"不存在"不可区分，避免跨品牌存在性探测
    throw httpError(404, '未找到该品牌或无权访问', 'BRAND_NOT_FOUND');
  }
  return brand;
}

/** 品牌一致性：对象品牌必须与请求品牌一致，否则 404（防跨品牌改写，02 §3） */
function assertSameBrand(objectBrandCode, requestBrandCode) {
  if (String(objectBrandCode) !== String(requestBrandCode)) {
    throw httpError(404, '资源不存在', 'BRAND_MISMATCH');
  }
  return true;
}

/** 可见品牌列表（前端品牌切换器用） */
function visibleBrands(principal) {
  if (!principal) return [];
  return BRANDS.filter((b) => inBrandScope(principal, b.code)).map((b) => ({
    id: b.id, code: b.code, name: b.name, status: b.status, skillState: b.skillState
  }));
}

/** 供 UI 展示的权限摘要（当前品牌） */
function permissionSummary(principal, brandCode) {
  return Array.from(permissionsFor(principal, brandCode)).sort();
}

module.exports = {
  principalOf,
  inBrandScope,
  permissionsFor,
  can,
  assertCan,
  assertBrand,
  assertSameBrand,
  visibleBrands,
  permissionSummary,
  BRAND_BY_CODE
};
