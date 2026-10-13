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

/**
 * 企业资料库**双重身份客户端**状态（B2）。
 *
 * 只读；**不发起任何出站**；**不回传任何票据/私钥**（票据密文只存在于进程内存）。
 * 该接口是运维核对「本侧是否真的具备真实调用能力」的唯一入口。
 */
get('/api/mos/integration/workspace', async (ctx) => {
  const client = require('../workspace-client');
  const st = client.status();
  return {
    ok: true,
    status: st,
    contract: {
      version: st.contractVersion,
      workspaceAppVersion: st.workspaceAppVersion,
      openapiSha256: st.openapiSha256,
      endpoints: Object.keys(require('../workspace-contract').ENDPOINTS),
      errorCodeCount: Object.keys(require('../workspace-contract').ERROR_CODES).length
    },
    note: 'configured=true 仅代表**本侧凭据与出站守卫就绪**，不代表联调通过。'
      + '真实可用性以 /api/mos/integration/health 探测与端到端测试为准。'
  };
});

/** 真实 /health 探测（**会出站**；未配置时零出站） */
post('/api/mos/integration/health', async (ctx) => {
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'library.asset.read', brandCode, { ip: ctx.ip, objectType: 'integration' });
  const client = require('../workspace-client');
  const body = ctx.body || {};
  const r = await client.health();
  return {
    ok: true, brandCode,
    probe: {
      ok: !!r.ok, health: r.health || '', httpStatus: r.httpStatus || 0,
      errorCode: r.errorCode || '', requestId: r.requestId || '',
      data: r.ok ? {
        status: (r.data || {}).status || '',
        service: (r.data || {}).service || '',
        appVersion: (r.data || {}).appVersion || '',
        policyVersion: (r.data || {}).policyVersion || '',
        capabilities: (r.data || {}).capabilities || null,
        limits: (r.data || {}).limits || null,
        signing: (r.data || {}).signing || null,
        changesCursor: (r.data || {}).changesCursor
      } : null
    },
    probeTriggeredBy: body.trigger || 'manual',
    note: 'health 是唯一在「集成关闭 / 无活跃服务账户」时也会作答的端点，用于区分「关闭」与「故障」。'
  };
});

/** 变更事件消费状态（B3） */
get('/api/mos/integration/events', async (ctx) => {
  const ec = require('../eventconsumer');
  const brandCode = ctx.query.brand ? String(ctx.query.brand).toUpperCase() : '';
  if (brandCode) rbac.assertBrand(ctx.principal, brandCode);
  const st = ec.status();
  return {
    ok: true,
    consumer: st,
    authoritativeUsable: brandCode ? ec.authoritativeUsable(brandCode) : null,
    invalidations: (getDb().library_invalidations || []).slice(-50),
    note: st.note
  };
});

/** 手动触发一轮轮询（运维/联调用；需 source.manage 权限） */
post('/api/mos/integration/events/tick', async (ctx) => {
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'source.manage', brandCode, { ip: ctx.ip, objectType: 'integration_event' });
  const ec = require('../eventconsumer');
  const body = ctx.body || {};
  /* 事件流是**服务级**调用，但 Provider 的 /changes 仍需一个真实员工身份（票据绑人）。
   * 传入触发者的 MOS user.id，由 eventconsumer 经 userMap 映射为资料库真实用户；
   * 未映射则零出站如实失败（绝不静默降级为匿名/服务身份）。 */
  const r = await ec.tick({ brands: body.brands, userId: ctx.user.id });
  appendAudit({ actorId: ctx.user.id, brandCode, eventType: 'integration.events.tick',
    objectType: 'integration_event', ip: ctx.ip,
    metadata: { ok: !!r.ok, skipped: !!r.skipped, totalItems: r.totalItems || 0,
      truncatedBrands: r.truncatedBrands || [], reason: r.reason || '' } });
  return { ok: true, tick: r };
});

/**
 * **使用前重新验证**（B3 关键条款）：新创作使用 / 下载既有可复用资产前，
 * 必须重新验证授权；Provider 不可用时 fail closed，**不得**沿用轮询缓存结论。
 */
post('/api/mos/integration/asset-usage-check', async (ctx) => {
  const db = getDb();
  const body = ctx.body || {};
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'library.asset.read', brandCode, { ip: ctx.ip, objectType: 'library_asset_ref' });
  const refId = String(body.refId || '');
  const libraryId = String(body.libraryAssetId || '');
  if (!refId && !libraryId) throw httpError(400, '请提供 refId 或 libraryAssetId', 'MISSING_TARGET');

  const ref = refId ? (db.library_asset_refs || []).find((r) => r.id === refId) : null;
  if (ref) rbac.assertBrand(ctx.principal, ref.brandCode);
  const targetLibraryId = libraryId || (ref ? ref.libraryId : '');
  const targetBrand = ref ? ref.brandCode : brandCode;

  const ec = require('../eventconsumer');
  const r = await ec.verifyAssetUsable(targetBrand, targetLibraryId, {
    userId: ctx.user.id, purpose: '使用前重新验证授权'
  });

  // 本地引用同步为验证后的真实状态（**只降不升**：验证失败即失效）
  if (ref && !r.usable) {
    ref.permissionValid = false;
    ref.lastVerifiedAt = new Date().toISOString();
    ref.lastVerifyResult = String(r.reason || '');
    save();
  } else if (ref && r.usable) {
    ref.permissionValid = true;
    ref.assetState = 'ACTIVE';
    ref.lastVerifiedAt = new Date().toISOString();
    ref.lastVerifyResult = 'PROVIDER_VERIFIED';
    save();
  }

  appendAudit({ actorId: ctx.user.id, brandCode: targetBrand, eventType: 'integration.asset_usage_check',
    objectType: 'library_asset_ref', objectId: refId || targetLibraryId, ip: ctx.ip,
    outcome: r.usable ? 'ok' : 'denied',
    metadata: { libraryAssetId: targetLibraryId, usable: !!r.usable, reason: r.reason || '' } });

  return {
    ok: true, usable: !!r.usable, reason: r.reason,
    httpStatus: r.httpStatus || 0, errorCode: r.errorCode || '', requestId: r.requestId || '',
    asset: r.data || null,
    note: r.usable
      ? '已向 Provider 重新验证：该资产当前可复用。'
      : '未通过验证，**不得用于新创作或下载**：' + (r.note || r.reason || '')
  };
});

/**
 * **只读联调探测**（跨系统联调准备）。
 *
 * 对 Provider 的**只读**端点各发一次真实请求（不写任何数据、不产生审批副作用），
 * 返回逐端点的「是否连通 / HTTP 状态 / 契约错误码 / 响应顶层键 / 命中条数」。
 *
 * 诚实性与安全边界：
 *   · 未配置 → **零出站**，如实返回 `configured:false`；
 *   · 响应体一律**不回流正文**（知识检索只回条数与 `contentWithheld` 统计），避免把
 *     资料库正文经本侧接口二次扩散；
 *   · 不调用任何写端点（`admissions.*` / `tickets` 之外的写动作）。
 */
post('/api/mos/integration/probe', async (ctx) => {
  const brandCode = helpers.resolveBrand(ctx);
  rbac.assertCan(ctx.principal, 'library.asset.read', brandCode, { ip: ctx.ip, objectType: 'integration' });
  const client = require('../workspace-client');
  const body = ctx.body || {};
  const query = String(body.query || '');
  const out = {
    ok: true, brandCode, configured: client.isConfigured(), egress: client.egressGuard(),
    probes: [], note: ''
  };
  if (!client.isConfigured()) {
    out.note = '集成未配置或未通过出站守卫：**零出站**，未发起任何探测请求。';
    return out;
  }
  /* 票据必须承载**真实资料库用户**：与 /sync 同源解析（未映射则如实拒绝，不猜测） */
  const who = client.resolveProviderUser(body.userId || ctx.user.id);
  if (!who.ok) {
    out.configured = true;
    out.userMapping = { ok: false, source: '', note: who.note };
    out.note = '未配置用户映射：**零出站**（拒绝用服务身份顶替真实员工）。';
    return out;
  }
  out.userMapping = { ok: true, source: who.source };
  const userId = who.userId;
  const record = (name, r) => {
    if (!r) { out.probes.push({ name, ok: false, errorCode: 'PROBE_EXCEPTION' }); return; }
    const data = (r.data && typeof r.data === 'object') ? r.data : {};
    const items = Array.isArray(data.items) ? data.items : [];
    out.probes.push({
      name, ok: !!r.ok, httpStatus: r.httpStatus || 0, errorCode: r.errorCode || '',
      errorLayer: r.errorLayer || '', requestId: r.requestId || '',
      dataKeys: Object.keys(data).sort(),
      itemCount: items.length,
      /** 内容扣留统计（只回计数，不回正文） */
      withheldCount: items.filter((x) => x && x.contentWithheld === true).length,
      truncated: data.truncated === true,
      nextCursor: data.nextCursor === undefined ? null : data.nextCursor,
      ticketMeta: r.ticketMeta || null
    });
  };
  record('assets.search', await client.searchAssets({ query, brandId: brandCode, limit: 3, offset: 0, userId: userId }));
  record('knowledge.search', await client.searchKnowledge({ query, brandId: brandCode, topK: 3, userId: userId }));
  record('changes', await client.listChanges({ brandId: brandCode, cursor: 0, limit: 10, userId: userId }));
  if (body.libraryAssetId) {
    record('assets.read', await client.getAsset(String(body.libraryAssetId), {
      brandId: brandCode, userId: userId, purpose: '只读联调探测'
    }));
  }
  if (body.skillId) {
    record('skills.read', await client.getSkill(String(body.skillId), { brandId: brandCode, userId: userId }));
  }
  out.reachable = out.probes.filter((p) => p.ok).length;
  out.total = out.probes.length;
  out.note = '只读探测：不写入任何数据。`ok=true` 表示该端点在真实 Provider 上返回了合法封套。';
  return out;
});

/** 契约摘要（供前端渲染枚举与错误码表，不回传任何凭据） */get('/api/mos/integration/contract', async (ctx) => {
  const wc = require('../workspace-contract');
  return {
    ok: true,
    contractVersion: wc.CONTRACT_VERSION,
    workspaceAppVersion: wc.WORKSPACE_APP_VERSION,
    openapiSha256: wc.OPENAPI_SHA256,
    prefix: wc.PREFIX,
    endpoints: Object.entries(wc.ENDPOINTS).map(([k, v]) => ({
      key: k, method: v.method, path: v.path, serviceScope: v.serviceScope,
      ticketScope: v.ticketScope, ticketKind: v.ticketKind
    })),
    serviceScopes: wc.SERVICE_SCOPES,
    ticketScopes: wc.TICKET_SCOPES,
    sessionOnlyTicketScopes: wc.SESSION_ONLY_TICKET_SCOPES,
    errorCodes: Object.entries(wc.ERROR_CODES).map(([code, m]) => ({ code, http: m.http, layer: m.layer, retryable: m.retryable })),
    /** 运行时错误码表（= 冻结 OpenAPI 枚举 + 提供方另行声明的新增码）。**非闭合**，见 D-03。 */
    errorCodeCount: Object.keys(wc.ERROR_CODES).length,
    errorCodeEnum: wc.OPENAPI_ERROR_CODE_ENUM,
    /** 冻结基线快照内的枚举项数（C 包 OpenAPI，逐字节）——用于证明基线未被本侧改动 */
    openapiErrorCodeCount: wc.OPENAPI_ERROR_CODE_ENUM.length,
    /** 提供方 D-03.2 声明、但不在冻结快照内的新增码（只增不改） */
    providerDeclaredAdditions: wc.PROVIDER_DECLARED_ADDITIONS,
    nonEnvelopeErrorCodes: wc.NON_ENVELOPE_ERROR_CODES,
    errorCodePolicy: 'error.code 是**稳定但非闭合**枚举：既有码含义与 HTTP 状态不变，新码只增不改；'
      + '未识别码一律按 layer=unknown + **不可重试** fail-safe 处理（提供方 D-03.2 确认本侧做法正确）。',
    eventTypes: wc.EVENT_TYPES,
    libraryCategories: wc.LIBRARY_CATEGORIES,
    libraryPrimaryCategories: wc.LIBRARY_PRIMARY_CATEGORIES,
    classifications: wc.CLASSIFICATIONS,
    classificationMeta: wc.CLASSIFICATION_META,
    licenseStatuses: wc.LICENSE_STATUSES,
    reuseScopes: wc.REUSE_SCOPES,
    marketingCategories: wc.MARKETING_CATEGORIES,
    aiReusePolicies: wc.AI_REUSE_POLICIES,
    externalAiTransferPolicies: wc.EXTERNAL_AI_TRANSFER_POLICIES,
    admissionRequiredFields: wc.ADMISSION_REQUIRED_FIELDS,
    admissionStates: wc.ADMISSION_STATES,
    notProvided: wc.NOT_PROVIDED,
    note: '枚举一律引用 Provider 权威口径（OpenAPI SHA256 见上），**本侧不自创编号**。'
      + 'provisional 项（A01–A08 / 许可 / 复用范围）在 SPECIAL-01 正式原件核验前保持 PROVISIONAL。'
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
