'use strict';
/**
 * MOS 元数据路由：品牌只读配置、字典、权限catalogue、集成状态、知识检索（MOCK）。
 * 对应页面 W02-01 Brand Overview / W02-02 Messaging & Terminology / W02-04 Brand Reference Library。
 */
const { get, post } = require('../router');
const { httpError } = require('../../util');
const { PERMISSIONS, SOURCE_TIERS, SOURCE_METHODS, LICENSE_STATES, TASK_STATUSES, PLAN_STATUSES } = require('../dict');
const rbac = require('../rbac');
const { getMosConfig, MOS_VERSION } = require('../config');
const knowledge = require('../adapters/knowledge');
const library = require('../adapters/library');
const dictVerify = require('../dictverify');
const { getDb, save } = require('../store');
const { appendAudit } = require('../audit');
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

/**
 * 专业字典待核验项登记（F-07）。
 *
 * 如实回答三个问题：
 *   1. 哪些字典项仍是「待核验」（编码 + 归属原件 + 为什么未核验）；
 *   2. 权威原件（SPECIAL-01 V1.1 / Visual Skill V1.2）本轮是否随包提供；
 *   3. 标签覆盖是否因证据不足被拒（防止用一行配置把"待核验"洗成"正式"）。
 */
get('/api/mos/dictionaries/verification', async (ctx) => {
  const db = getDb();
  return {
    ok: true,
    summary: dictVerify.summary(db),
    items: dictVerify.registry(db),
    overrideAudit: helpers.dictionaryAudit(),
    note: '未取得正式原件前，provisional 项一律保持「待核验」；本接口不返回、也不构造任何"官方名称"。'
  };
});

/**
 * 登记一条字典核验结论（F-07）。
 * 必须同时提供正式名称 + 来源版本 + 证据引用；缺任一项一律拒绝（不写入记录）。
 */
post('/api/mos/dictionaries/verify', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'brand.read', brandCode, { ip: ctx.ip, objectType: 'dictionary' });
  if (!rbac.can(ctx.principal, 'topic.manage', brandCode)) {
    throw httpError(403, '当前账号没有登记字典核验结论的权限（需要字典/主题管理权限）', 'FORBIDDEN');
  }
  const r = dictVerify.verify(db, Object.assign({}, body, {
    verifiedById: ctx.user.id, verifiedByName: ctx.user.displayName
  }));
  if (!r.ok) throw httpError(400, r.message, r.code);
  save();
  appendAudit({
    actorId: ctx.user.id, brandCode, eventType: 'dictionary.verified', objectType: 'dictionary',
    objectId: r.record.dictKey + ':' + r.record.code, ip: ctx.ip,
    metadata: { sourceVersion: r.record.sourceVersion, evidenceRef: r.record.evidenceRef }
  });
  return { ok: true, record: r.record, summary: dictVerify.summary(db) };
});

/**
 * Provider 统一契约探针（A-05 / 04 §6）。
 * 返回 health/status/timeout/rateLimit/costReceipt/errorCode 契约面；**不含任何密钥**。
 * 未配置供应商时返回 NOT_CONFIGURED，且**不发起任何出站调用**（诚实性红线）。
 */
get('/api/mos/providers/health', async (ctx) => {
  const text = require('../adapters/text');
  const image = require('../adapters/image');
  const pc = require('../providercontract');
  return {
    ok: true,
    contract: ['health', 'status', 'invoke', 'timeout', 'rateLimit', 'costReceipt', 'errorCode'],
    errorCodes: pc.ERROR_CODES,
    text: { status: text.status(), health: await text.health() },
    image: { status: image.status(), health: await image.health() },
    note: '已配置密钥的真实供应商默认只报 CONFIGURED（不主动付费探测）；真实端到端由 tools/mos-provider-contract-test.js 显式触发。'
  };
});

/**
 * 企业资料库适配层状态（A-06）。**只读状态，不发起任何出站、不回传任何凭据。**
 * 未配置凭据时如实为 configured=false / NOT_CONFIGURED（不假称已联调）。
 */
get('/api/mos/workspace/status', async (ctx) => {
  const ws = require('../adapters/workspace');
  return {
    ok: true,
    status: ws.status(),
    capabilities: ws.capabilities(),
    contract: {
      version: ws.contract.CONTRACT_VERSION,
      workspaceAppVersion: ws.contract.WORKSPACE_APP_VERSION,
      endpoints: Object.keys(ws.contract.ENDPOINTS),
      realJointTest: 'NOT_VERIFIED'
    },
    note: '真实联调未发生（NOT_VERIFIED）。服务账户**无**最终审批权：最终审批只能由用户在 Workspace 侧完成。'
  };
});

/** 正式术语检索（W02-02）—— 真实知识库未接通，返回 MOCK 并标注 */get('/api/mos/knowledge/search', async (ctx) => {
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
