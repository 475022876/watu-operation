'use strict';
/**
 * MOS 元数据路由：品牌只读配置、字典、权限catalogue、集成状态、知识检索（MOCK）。
 * 对应页面 W02-01 Brand Overview / W02-02 Messaging & Terminology / W02-04 Brand Reference Library。
 */
const { get } = require('../router');
const { httpError } = require('../../util');
const { PERMISSIONS, SOURCE_TIERS, SOURCE_METHODS, LICENSE_STATES, TASK_STATUSES, PLAN_STATUSES } = require('../dict');
const rbac = require('../rbac');
const { getMosConfig, MOS_VERSION } = require('../config');
const knowledge = require('../adapters/knowledge');
const library = require('../adapters/library');
const helpers = require('./helpers');

get('/api/mos/meta', async (ctx) => {
  const cfg = getMosConfig();
  return {
    ok: true,
    mosVersion: MOS_VERSION,
    schemaVersion: require('../store').MOS_SCHEMA_VERSION,
    environment: 'sandbox',
    identityMode: cfg.integrations.identity,
    demoSeed: !!cfg.demoSeed,
    integrations: helpers.integrationStatus(),
    brandCodes: helpers.BRAND_CODES,
    dictionaries: helpers.dictionaries(),
    roles: helpers.roleCatalogue(),
    permissions: PERMISSIONS,
    enumerations: {
      taskStatuses: TASK_STATUSES,
      planStatuses: PLAN_STATUSES,
      sourceTiers: SOURCE_TIERS,
      sourceMethods: SOURCE_METHODS,
      licenseStates: LICENSE_STATES
    }
  };
});

/** 品牌只读配置（W02-01 / W02-03） */
get('/api/mos/brand/:code/overview', async (ctx) => {
  const code = String(ctx.params.code || '').toUpperCase();
  const brand = rbac.assertBrand(ctx.principal, code);
  const cfg = getMosConfig();

  // 已批准的 Skill：当前**没有任何**已批准 Skill 进入系统（00 §0.1-3）
  const skills = [];
  const templates = [];

  return {
    ok: true,
    brand: {
      id: brand.id,
      code: brand.code,
      name: brand.name,
      status: brand.status,
      skillState: brand.skillState,
      skillNote: brand.skillNote,
      palette: brand.palette,
      typography: brand.typography
    },
    // 关键诚实性：Skill 未批准时必须阻断"正式品牌输出"，只允许测试草稿（01 §4）
    skillActivation: {
      approvedSkills: skills.length,
      templates: templates.length,
      officialOutputBlocked: skills.length === 0,
      message: skills.length === 0
        ? '当前没有任何 APPROVED 状态的品牌 Skill 版本：正式品牌输出被阻断，仅允许标注测试草稿。（V0.1 属预期状态）'
        : '',
      visualGuardian: code === 'VFIB'
        ? 'VFIB Visual Brand Guardian V1.2 已作为**文件规范引用**登记，尚未作为资料库 Skill 激活。'
        : 'U CARD 独立 Skill 尚未建立；**不得套用** VFIB 设计规则。'
    },
    dictionaries: helpers.dictionaries(),
    integrations: { library: library.status(), knowledge: knowledge.status() },
    myPermissions: rbac.permissionSummary(ctx.principal, code),
    textProvider: helpers.integrationStatus().textProvider
  };
});

/** 正式术语检索（W02-02）—— 真实知识库未接通，返回 MOCK 并标注 */
get('/api/mos/knowledge/search', async (ctx) => {
  const q = String(ctx.query.q || '');
  const scope = { brandCode: ctx.query.brand ? String(ctx.query.brand).toUpperCase() : '' };
  const res = await knowledge.searchApproved(q, scope);
  return { ok: true, sandbox: true, mock: true, query: q, items: res.items, integration: knowledge.status() };
});

/** 已批准可复用资产检索（W02-04）—— MOCK 下恒为空，不伪造正式资产 */
get('/api/mos/library/approved', async (ctx) => {
  const q = String(ctx.query.q || '');
  const brandCode = ctx.query.brand ? String(ctx.query.brand).toUpperCase() : (ctx.principal.brandCodes[0] || '');
  if (brandCode) rbac.assertBrand(ctx.principal, brandCode);
  if (!rbac.can(ctx.principal, 'library.asset.read', brandCode)) {
    throw httpError(403, '当前账号没有检索已批准资产的权限', 'FORBIDDEN');
  }
  const brand = helpers.brandOf(brandCode);
  return {
    ok: true,
    sandbox: true,
    mock: true,
    query: q,
    brandCode,
    brandName: brand ? brand.name : '',
    items: [],
    note: '企业资料库真实接口尚未接通（06 §1）：MOCK 下不返回任何"已批准资产"，任何界面都不得据此声称资产可用。',
    integration: library.status()
  };
});
