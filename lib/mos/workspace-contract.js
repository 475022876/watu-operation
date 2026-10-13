'use strict';
/**
 * Enterprise Workspace 集成契约（A-06 / 规格 04 §Phase3「企业资料库适配契约及权限」）。
 *
 * 本文件是 **Marketing OS 侧**对《Marketing OS ↔ Enterprise Workspace 受控集成接口契约》
 * 的**逐字节对齐实现**，来源为 Enterprise Workspace 最新源码：
 *   - `INTEGRATION_API_CONTRACT.md`（契约 V1.0，应用版本 V1.1.7）
 *   - `lib/integration/service-accounts.js`（`canonicalString()` / `sha256Hex()` / SCOPES）
 *   - `lib/integration/tickets.js`（票据 SCOPES / SESSION_ONLY_SCOPES）
 *   - `lib/routes/integrations.js`（端点与封套 `respond()`）
 *
 * 立场（不可妥协）：
 *   - Marketing OS 是**受控调用方**：只能经本契约端点操作，且**任何**资产进入正式复用状态的
 *     唯一通道是 Workspace 侧的**独立最终审批**。
 *   - **服务账户永不可能**取得 `admission.final.decision`（`serviceGrantable()` 剔除 +
 *     端点强制 `kind === 'session'` 双重闭合）。本模块**不提供**任何服务侧最终审批入口。
 *   - 未配置凭据时一律 `NOT_CONFIGURED`（fail closed），**绝不伪造**任何资料库结果或联调结论。
 */
const crypto = require('node:crypto');

/** 契约版本（与 Workspace `policy.POLICY_VERSION` 对齐；每个响应回带） */
const CONTRACT_VERSION = '1.0';
/** 兼容的 Workspace 应用版本（信息性，仅用于文档与展示） */
const WORKSPACE_APP_VERSION = '1.1.7';

/** 统一前缀 */
const PREFIX = '/api/integrations/marketing';

/** 端点清单（与 `lib/routes/integrations.js` 注册表一致，含文档 §4.1 未列出的 skills） */
const ENDPOINTS = {
  HEALTH: { method: 'GET', path: PREFIX + '/health', serviceScope: null, ticketScope: null, ticketKind: null },
  TICKETS: { method: 'POST', path: PREFIX + '/tickets', serviceScope: 'tickets.issue', ticketScope: null, ticketKind: null },
  KNOWLEDGE_SEARCH: { method: 'POST', path: PREFIX + '/knowledge/search', serviceScope: 'knowledge.search', ticketScope: 'knowledge.search', ticketKind: 'service' },
  ASSETS_SEARCH: { method: 'POST', path: PREFIX + '/assets/search', serviceScope: 'assets.search', ticketScope: 'assets.search', ticketKind: 'service' },
  ASSET_GET: { method: 'GET', path: PREFIX + '/assets/:id', serviceScope: 'assets.read', ticketScope: 'assets.read', ticketKind: 'service' },
  ADMISSION_CREATE: { method: 'POST', path: PREFIX + '/admissions', serviceScope: 'admissions.write', ticketScope: 'admissions.write', ticketKind: 'service' },
  ADMISSION_SUBMIT: { method: 'POST', path: PREFIX + '/admissions/:id/submit', serviceScope: 'admissions.write', ticketScope: 'admissions.write', ticketKind: 'service' },
  ADMISSION_ARTIFACT: { method: 'POST', path: PREFIX + '/admissions/:id/artifact', serviceScope: 'admissions.write', ticketScope: 'admissions.write', ticketKind: 'service' },
  ADMISSION_GET: { method: 'GET', path: PREFIX + '/admissions/:id', serviceScope: 'admissions.read', ticketScope: 'admissions.read', ticketKind: 'service' },
  ADMISSION_FINAL_DECISION: { method: 'POST', path: PREFIX + '/admissions/:id/final-decision', serviceScope: 'admissions.read', ticketScope: 'admission.final.decision', ticketKind: 'session' },
  SKILL_GET: { method: 'GET', path: PREFIX + '/skills/:id', serviceScope: 'skills.read', ticketScope: 'skills.read', ticketKind: 'service' },
  CHANGES: { method: 'GET', path: PREFIX + '/changes', serviceScope: 'changes.read', ticketScope: 'changes.read', ticketKind: 'service' }
};

/** 服务账户 scope（`service-accounts.js SCOPES`） */
const SERVICE_SCOPES = [
  'knowledge.search', 'assets.search', 'assets.read', 'admissions.write',
  'admissions.read', 'skills.read', 'changes.read', 'tickets.issue'
];
/** 票据 scope（`tickets.js SCOPES`） */
const TICKET_SCOPES = [
  'knowledge.search', 'assets.search', 'assets.read', 'admissions.write',
  'admissions.read', 'skills.read', 'changes.read', 'admission.final.decision'
];
/** **仅本人会话**可取得的票据范围：服务账户**永远**拿不到（双重闭合的第一重） */
const SESSION_ONLY_TICKET_SCOPES = ['admission.final.decision'];

/** 错误码总表（契约 §3；调用方请判 `code`，不要判 message 措辞） */
const ERROR_CODES = {
  // 第一层：服务身份
  INTEGRATION_DISABLED: { http: 503, layer: 'service', retryable: false },
  NO_SERVICE_ACCOUNT: { http: 503, layer: 'service', retryable: false },
  MISSING_SIGNATURE: { http: 401, layer: 'service', retryable: false },
  BAD_SERVICE_ACCOUNT: { http: 401, layer: 'service', retryable: false },
  BAD_TIMESTAMP: { http: 401, layer: 'service', retryable: false },
  TIMESTAMP_OUT_OF_WINDOW: { http: 401, layer: 'service', retryable: false },
  ACCOUNT_KEY_UNUSABLE: { http: 503, layer: 'service', retryable: false },
  BAD_SIGNATURE_FORMAT: { http: 401, layer: 'service', retryable: false },
  BAD_SIGNATURE: { http: 401, layer: 'service', retryable: false },
  NONCE_REPLAY: { http: 401, layer: 'service', retryable: false },
  RATE_LIMITED: { http: 429, layer: 'service', retryable: true },
  // 第二层：票据
  TICKET_MISSING: { http: 401, layer: 'ticket', retryable: false },
  TICKET_MALFORMED: { http: 401, layer: 'ticket', retryable: false },
  TICKET_BAD_SIGNATURE: { http: 401, layer: 'ticket', retryable: false },
  TICKET_BAD_PAYLOAD: { http: 401, layer: 'ticket', retryable: false },
  TICKET_BAD_VERSION: { http: 401, layer: 'ticket', retryable: false },
  TICKET_EXPIRED: { http: 401, layer: 'ticket', retryable: true },
  TICKET_NO_USER: { http: 401, layer: 'ticket', retryable: false },
  TICKET_NO_BRAND: { http: 401, layer: 'ticket', retryable: false },
  TICKET_KIND_MISMATCH: { http: 403, layer: 'ticket', retryable: false },
  TICKET_ACCOUNT_MISMATCH: { http: 403, layer: 'ticket', retryable: false },
  TICKET_USER_INACTIVE: { http: 403, layer: 'ticket', retryable: false },
  SCOPE_NOT_GRANTED: { http: 403, layer: 'ticket', retryable: false },
  // 业务与策略
  BRAND_MISMATCH: { http: 403, layer: 'business', retryable: false },
  BRAND_NOT_ALLOWED: { http: 403, layer: 'business', retryable: false },
  FINAL_APPROVAL_FORBIDDEN: { http: 403, layer: 'business', retryable: false },
  NOT_REUSABLE_FOR_SUBJECT: { http: 403, layer: 'business', retryable: false },
  NOT_FOUND: { http: 404, layer: 'business', retryable: false },
  VERSION_NOT_FOUND: { http: 404, layer: 'business', retryable: false },
  ASSET_GONE: { http: 410, layer: 'business', retryable: false },
  ASSET_IMMUTABLE: { http: 409, layer: 'business', retryable: false },
  ADMISSION_INCONSISTENT: { http: 409, layer: 'business', retryable: false },
  FINAL_APPROVAL_REQUIRED: { http: 409, layer: 'business', retryable: true },
  REVIEW_REQUIRED: { http: 409, layer: 'business', retryable: false },
  ASSET_CONFLICT: { http: 409, layer: 'business', retryable: false },
  BAD_STATE: { http: 409, layer: 'business', retryable: false },
  BAD_TRANSITION: { http: 409, layer: 'business', retryable: false },
  /* 注：原表在此处放了 `MARKETING_ASSET_LOCKED`（403）。经 V1.1 与权威 OpenAPI 逐项比对，
   * 该码属 Provider **普通 OA 路由**（顶层 `code`，非集成封套），已移入
   * `NON_ENVELOPE_ERROR_CODES`，不再参与集成错误分层。 */
  MISSING_QUERY: { http: 400, layer: 'request', retryable: false },
  QUERY_TOO_LONG: { http: 400, layer: 'request', retryable: false },
  MISSING_USER: { http: 400, layer: 'request', retryable: false },
  MISSING_BRAND: { http: 400, layer: 'request', retryable: false },
  BAD_CURSOR: { http: 400, layer: 'request', retryable: false },
  MISSING_CONTENT: { http: 400, layer: 'request', retryable: false },
  BAD_CONTENT: { http: 400, layer: 'request', retryable: false },
  BAD_REVIEWER: { http: 400, layer: 'request', retryable: false },
  FILE_TOO_LARGE: { http: 413, layer: 'request', retryable: false },
  EXT_NOT_ALLOWED: { http: 415, layer: 'request', retryable: false },
  MAGIC_MISMATCH: { http: 415, layer: 'request', retryable: false },
  /* ---- 2026-10-13 按 Workspace V1.1.7 实取源码补齐（缺失会导致封套分类落到 unknown） ---- */
  /** `admission.createRequest()` 字段校验失败（`lib/asset-admission.js` → `policy.normalizeAdmissionInput`） */
  BAD_ADMISSION_INPUT: { http: 400, layer: 'request', retryable: false },
  /** `POST /tickets` 的 userId 不存在或已停用（`lib/routes/integrations.js` §2） */
  USER_NOT_FOUND: { http: 404, layer: 'request', retryable: false },
  /** 服务账户登记面（`POST /api/integration-accounts`，运维一次性动作，非营销业务面） */
  BAD_PUBLIC_KEY: { http: 400, layer: 'request', retryable: false },
  BAD_SCOPES: { http: 400, layer: 'request', retryable: false },
  BAD_NAME: { http: 400, layer: 'request', retryable: false },
  /** `respond()` 的兜底码（未分类失败）；收到即说明该失败未在契约 §3 归类 */
  ERROR: { http: 500, layer: 'unknown', retryable: false },

  /* ---- 2026-10-13 V1.1 三包整改：按权威 OpenAPI `components.schemas.ErrorCode.enum`
   *      （共 70 项，SHA256 cd3cc198…）逐项比对后补齐的 17 项缺失码。
   *      此前这些码会落到 `layer='unknown'`，导致「不可重试」与「可重试」判定失真。 ---- */
  /** 服务账户缺少该端点所需 scope（`sa.requireScope`，与票据侧 `SCOPE_NOT_GRANTED` 并列） */
  SERVICE_SCOPE_NOT_GRANTED: { http: 403, layer: 'service', retryable: false },
  /** 通用禁止（非特定域归类时使用） */
  FORBIDDEN: { http: 403, layer: 'business', retryable: false },
  // —— Skill 域（Provider 内部治理面；Consumer 侧仅在 `skills/:id` 只读面间接遇到 NOT_FOUND/ASSET_GONE）
  BAD_SKILL_INPUT: { http: 400, layer: 'request', retryable: false },
  SKILL_NOT_FOUND: { http: 404, layer: 'business', retryable: false },
  SKILL_ID_TAKEN: { http: 409, layer: 'business', retryable: false },
  SKILL_AUTHORITY_FORBIDDEN: { http: 403, layer: 'business', retryable: false },
  BAD_VERSION_SEQUENCE: { http: 400, layer: 'request', retryable: false },
  BAD_EFFECTIVE_AT: { http: 400, layer: 'request', retryable: false },
  EFFECTIVE_AT_TOO_FAR: { http: 400, layer: 'request', retryable: false },
  VERSION_EXISTS: { http: 409, layer: 'business', retryable: false },
  REASON_REQUIRED: { http: 400, layer: 'request', retryable: false },
  BAD_STATUS: { http: 400, layer: 'request', retryable: false },
  // —— 准入决策域
  BAD_DECISION: { http: 400, layer: 'request', retryable: false },
  NO_REVIEW: { http: 409, layer: 'business', retryable: false },
  REVIEW_FAILED: { http: 409, layer: 'business', retryable: false },
  REVOKE_FORBIDDEN: { http: 403, layer: 'business', retryable: false },
  DEPRECATE_FORBIDDEN: { http: 403, layer: 'business', retryable: false },

  /* ---- 2026-10-13 提供方 V1.1 正式答复 D-03.2 补入的两项 ----
   * `D-03` 明确：`error.code` 是**稳定但非闭合**的枚举 —— 既有码含义与 HTTP 状态不变，
   * 新码只增不改，且提供方**不承诺码集封版**（封版会把新场景塞进 `ERROR`，反而降低可诊断性）。
   * 因此本表 = 冻结的 OpenAPI 枚举（`OPENAPI_ERROR_CODE_ENUM`，71 项，逐字节取自 C 包）
   *        + 提供方另行声明的运行时新增码（`PROVIDER_DECLARED_ADDITIONS`，本项）。
   * 未识别码一律按 `layer:'unknown'` + **不可重试** fail-safe 处理（提供方 D-03.2 第 3 条确认本侧做法正确）。 */
  /** `POST /admissions/:id/submit` 的 `reviews[].outcome` 不是 `pass`/`fail`（CCR-2026-003 收紧后新增） */
  BAD_REVIEW_OUTCOME: { http: 400, layer: 'request', retryable: false },
  /** `reviews` 超过 10 条；**不静默丢弃**第 11 条起（原 fail-open，CCR-2026-003 修正） */
  TOO_MANY_REVIEWS: { http: 400, layer: 'request', retryable: false }
};

/** 提供方在 OpenAPI 冻结快照之外另行声明的新增错误码（D-03.2） */
const PROVIDER_DECLARED_ADDITIONS = ['BAD_REVIEW_OUTCOME', 'TOO_MANY_REVIEWS'];

/**
 * **非集成封套**的 Provider 普通 OA 路由错误码。
 *
 * 这些码**不在** OpenAPI 的 `ErrorCode` 枚举内（该枚举只覆盖 `/api/integrations/marketing/*`
 * 的统一封套）。它们出现在资料库**普通业务路由**上（形状为 `{ok:false, error:"消息", code:"CODE"}`，
 * `code` 在**顶层**而非 `error.code`）——本侧仅用于「营销资产不得经普通审批路径变更」的
 * 结构性说明，**不参与**集成错误分层判定。
 */
const NON_ENVELOPE_ERROR_CODES = [
  'MARKETING_ASSET_LOCKED',
  'MARKETING_ASSET_ATTRIBUTE_LOCKED'
];

/** 封套顶层键（契约 §2：**所有**端点、成功与失败同一形状） */
const ENVELOPE_KEYS = ['ok', 'data', 'error', 'request_id', 'policy_version'];

/* ---------------- 准入申请入参契约（实取 Workspace `lib/asset-policy.js`） ----------------
 * 2026-10-13 按 Workspace V1.1.7 源码逐字对齐 `normalizeAdmissionInput()` 的必填项与枚举。
 * 目的：**在出站之前**就能判定「本侧数据是否足以构成一次合法申请」，
 * 避免发出一份必然被服务端 400 `BAD_ADMISSION_INPUT` 的请求。
 */
/** Marketing OS 侧一级分类码（A01–A08） */
const MARKETING_CATEGORIES = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08'];
/** 资料库七大资料区 ID（`library-nav.js CATEGORIES`）——**必填**，决定文档落库位置 */
const LIBRARY_PRIMARY_CATEGORIES = ['01', '02', '03', '04', '05', '06', '07'];
/** 四级密级（`library-nav.js CLASSIFICATIONS` 的键）——**必填** */
const CLASSIFICATIONS = ['open', 'internal', 'restricted', 'executive'];
/** 许可状态——**必填** */
const LICENSE_STATUSES = ['cleared', 'pending', 'restricted', 'expired', 'unknown'];
/** 复用范围（缺省 `none`） */
const REUSE_SCOPES = ['none', 'internal_reference', 'brand_kit', 'campaign_reuse', 'unrestricted'];
/** AI 复用策略（缺省 `blocked`） */
const AI_REUSE_POLICIES = ['blocked', 'allowed'];
/** 对外部 AI 传输策略（缺省 `blocked`；与 `canSendToExternalAI()` 同义） */
const EXTERNAL_AI_TRANSFER_POLICIES = ['blocked', 'allowed'];

const ID_RE = /^[A-Za-z0-9_.:-]{1,120}$/;
const CONTENT_HASH_RE = /^[a-f0-9]{64}$/;
const BRAND_ID_MAX = 40;

/* ---------------- 权威枚举全表（C 包 01_FIELD_ENUMS_AND_MAPPING + 供应商 OpenAPI） ----------------
 * 立场：**编号与取值一律引用，绝不自创**。本表用于 UI 下拉与出站前预校验，
 * 语义权威仍在 Provider 侧；名称仅用于展示。
 */
/** 七大资料区及其二级目录（Provider `lib/library-nav.js CATEGORIES`，逐字节实取） */
const LIBRARY_CATEGORIES = [
  { id: '01', nameZh: '公司治理与制度', subs: [
    ['01.01', '公司简介与事实'], ['01.02', '治理与董事会'], ['01.03', '组织与人员'],
    ['01.04', '公司制度'], ['01.05', '高管与战略资料']
  ] },
  { id: '02', nameZh: '品牌与传播', subs: [
    ['02.01', '品牌规范'], ['02.02', '对外表述与口径'], ['02.03', '媒体与公关'],
    ['02.04', '创意素材'], ['02.05', '官网与活动内容']
  ] },
  { id: '03', nameZh: '产品与业务', subs: [
    ['03.01', '个人银行'], ['03.02', '企业银行'], ['03.03', '机构银行'], ['03.04', 'VFIB 卡业务'],
    ['03.05', 'USDF 与数字资产结算'], ['03.06', '支付与外汇'], ['03.07', 'API 与金融基础设施']
  ] },
  { id: '04', nameZh: '销售、合作与案例', subs: [
    ['04.01', '销售物料'], ['04.02', '合作方资料'], ['04.03', '方案与 RFP/RFI'],
    ['04.04', '报价与商务条款'], ['04.05', '客户案例'], ['04.06', '用例与行业方案']
  ] },
  { id: '05', nameZh: '合规、证明与参考', subs: [
    ['05.01', '监管与牌照'], ['05.02', '公司注册文件'], ['05.03', '合规与 AML 参考'],
    ['05.04', '法律意见'], ['05.05', '银行/支付/卡证明'], ['05.06', '技术与安全证明'],
    ['05.07', '公开披露与免责声明']
  ] },
  { id: '06', nameZh: '财务与公司记录', subs: [
    ['06.01', '预算与预测'], ['06.02', '管理报表'], ['06.03', '会计与财务制度'], ['06.04', '税务与审计'],
    ['06.05', '融资与资本'], ['06.06', '企业资金管理'], ['06.07', '供应商、发票与付款']
  ] },
  { id: '07', nameZh: '知识、研究与培训', subs: [
    ['07.01', '员工入职'], ['07.02', '产品培训'], ['07.03', '合规培训'],
    ['07.04', '研究与洞察'], ['07.05', '行业情报'], ['07.06', 'SOP 与操作指引']
  ] }
];

/** 四级密级元数据（`rank` 越大越敏感；**只升不降**由 Provider 强制） */
const CLASSIFICATION_META = {
  open: { rank: 1, labelZh: '公司公开' },
  internal: { rank: 2, labelZh: '内部资料' },
  restricted: { rank: 3, labelZh: '受限资料' },
  executive: { rank: 4, labelZh: '高管机密' }
};

/**
 * 权威 OpenAPI `ErrorCode` 枚举全集（70 项，逐字节取自
 * `C_Shared_Contract/PROVIDER_API_OPENAPI_BASELINE.yaml`，SHA256 见 `OPENAPI_SHA256`）。
 * 用途：自检断言「本侧错误码表 ⊇ 权威枚举」，任何遗漏都会被测试直接抓出来。
 */
const OPENAPI_ERROR_CODE_ENUM = [
  'ACCOUNT_KEY_UNUSABLE', 'ADMISSION_INCONSISTENT', 'ASSET_CONFLICT', 'ASSET_GONE', 'ASSET_IMMUTABLE',
  'BAD_ADMISSION_INPUT', 'BAD_CONTENT', 'BAD_CURSOR', 'BAD_DECISION', 'BAD_EFFECTIVE_AT', 'BAD_NAME',
  'BAD_PUBLIC_KEY', 'BAD_REVIEWER', 'BAD_SCOPES', 'BAD_SERVICE_ACCOUNT', 'BAD_SIGNATURE',
  'BAD_SIGNATURE_FORMAT', 'BAD_SKILL_INPUT', 'BAD_STATE', 'BAD_STATUS', 'BAD_TIMESTAMP', 'BAD_TRANSITION',
  'BAD_VERSION_SEQUENCE', 'BRAND_MISMATCH', 'BRAND_NOT_ALLOWED', 'DEPRECATE_FORBIDDEN',
  'EFFECTIVE_AT_TOO_FAR', 'ERROR', 'EXT_NOT_ALLOWED', 'FILE_TOO_LARGE', 'FINAL_APPROVAL_FORBIDDEN',
  'FINAL_APPROVAL_REQUIRED', 'FORBIDDEN', 'INTEGRATION_DISABLED', 'MAGIC_MISMATCH', 'MISSING_BRAND',
  'MISSING_CONTENT', 'MISSING_QUERY', 'MISSING_SIGNATURE', 'MISSING_USER', 'NONCE_REPLAY', 'NOT_FOUND',
  'NOT_REUSABLE_FOR_SUBJECT', 'NO_REVIEW', 'NO_SERVICE_ACCOUNT', 'QUERY_TOO_LONG', 'RATE_LIMITED',
  'REASON_REQUIRED', 'REVIEW_FAILED', 'REVIEW_REQUIRED', 'REVOKE_FORBIDDEN', 'SCOPE_NOT_GRANTED',
  'SERVICE_SCOPE_NOT_GRANTED', 'SKILL_AUTHORITY_FORBIDDEN', 'SKILL_ID_TAKEN', 'SKILL_NOT_FOUND',
  'TICKET_ACCOUNT_MISMATCH', 'TICKET_BAD_PAYLOAD', 'TICKET_BAD_SIGNATURE', 'TICKET_BAD_VERSION',
  'TICKET_EXPIRED', 'TICKET_KIND_MISMATCH', 'TICKET_MALFORMED', 'TICKET_MISSING', 'TICKET_NO_BRAND',
  'TICKET_NO_USER', 'TICKET_USER_INACTIVE', 'TIMESTAMP_OUT_OF_WINDOW', 'USER_NOT_FOUND',
  'VERSION_EXISTS', 'VERSION_NOT_FOUND'
];

/** C 包权威 OpenAPI 基线文件的 SHA256（双方对账用；本侧只读，绝不改写） */
const OPENAPI_SHA256 = 'cd3cc198a9c568192dbec76429fb9a6dbc836f5e738377249bc14f73d8e825e3';

/** 幂等键持久化用的稳定键格式（与服务端 `ID_RE` 同构） */
function isValidStableKey(v) {
  return ID_RE.test(String(v || '').trim());
}

/**
 * 准入申请**客户端**必填字段（缺任一 → 服务端 400 `BAD_ADMISSION_INPUT`）。
 *
 * 注（V1.1 与权威 OpenAPI 比对结论，已登记 CONTRACT_DIFF D-11）：
 * OpenAPI `AdmissionInput.required` 另列了 `originSystem`；但 Provider 路由
 * `lib/routes/integrations.js` 在调用 `createRequest()` **之前**无条件执行
 * `originSystem: 'marketing_os'` 覆写，且 C 包 01 节明确「Consumer 不得伪造自报」。
 * 因此本侧**不发送** `originSystem`（既符合最小权限，也避免自报被拒）。
 */
const ADMISSION_REQUIRED_FIELDS = [
  'idempotencyKey', 'originObjectId', 'brandId',
  'libraryPrimaryCategory', 'classification', 'licenseStatus', 'title'
];
/** 可选字段及其取值约束 */
const ADMISSION_OPTIONAL_FIELDS = {
  originVersionId: null,
  marketingCategory: MARKETING_CATEGORIES,
  librarySubcategory: null,
  reuseScope: REUSE_SCOPES,
  aiReusePolicy: AI_REUSE_POLICIES,
  externalAiTransferPolicy: EXTERNAL_AI_TRANSFER_POLICIES,
  contentHash: null,
  fileName: null,
  fileSize: null,
  note: null
};

/**
 * 本地预校验一次准入申请入参（**与服务端同构，不替代服务端校验**）。
 * @returns {{ok:boolean, missing:string[], errors:string[], value:object}}
 */
function validateAdmissionInput(raw) {
  const src = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? raw : {};
  const errors = [];
  const missing = [];
  const value = {};

  const reqStr = (key) => {
    const v = src[key] === undefined || src[key] === null ? '' : String(src[key]).trim();
    if (!v) missing.push(key);
    return v;
  };

  value.idempotencyKey = reqStr('idempotencyKey');
  if (value.idempotencyKey && !ID_RE.test(value.idempotencyKey)) {
    errors.push('idempotencyKey 格式非法（1-120 位 [A-Za-z0-9_.:-]）');
  }
  value.originObjectId = reqStr('originObjectId');
  if (value.originObjectId && !ID_RE.test(value.originObjectId)) {
    errors.push('originObjectId 格式非法（1-120 位 [A-Za-z0-9_.:-]）');
  }
  value.brandId = reqStr('brandId');
  if (value.brandId && (value.brandId.length > BRAND_ID_MAX || !/^[A-Za-z0-9_-]+$/.test(value.brandId))) {
    errors.push('brandId 格式非法（1-' + BRAND_ID_MAX + ' 位 [A-Za-z0-9_-]）');
  }

  value.libraryPrimaryCategory = reqStr('libraryPrimaryCategory');
  if (value.libraryPrimaryCategory && LIBRARY_PRIMARY_CATEGORIES.indexOf(value.libraryPrimaryCategory) === -1) {
    errors.push('libraryPrimaryCategory 必须是七大资料区之一（' + LIBRARY_PRIMARY_CATEGORIES.join('/') + '）');
  }
  value.classification = reqStr('classification');
  if (value.classification && CLASSIFICATIONS.indexOf(value.classification) === -1) {
    errors.push('classification 必须是四级密级之一（' + CLASSIFICATIONS.join('/') + '）');
  }
  value.licenseStatus = reqStr('licenseStatus').toLowerCase();
  if (value.licenseStatus && LICENSE_STATUSES.indexOf(value.licenseStatus) === -1) {
    errors.push('licenseStatus 必须是 ' + LICENSE_STATUSES.join('/'));
  }
  value.title = reqStr('title');
  if (value.title && value.title.length > 180) errors.push('title 超过 180 字');

  // 可选字段
  const mcat = String(src.marketingCategory || '').trim().toUpperCase();
  if (mcat && MARKETING_CATEGORIES.indexOf(mcat) === -1) {
    errors.push('marketingCategory 只能是 ' + MARKETING_CATEGORIES.join('/'));
  }
  value.marketingCategory = mcat || null;

  const ovid = src.originVersionId === undefined || src.originVersionId === null ? null : String(src.originVersionId).trim();
  if (ovid !== null && !ID_RE.test(ovid)) errors.push('originVersionId 格式非法');
  value.originVersionId = ovid || null;

  value.librarySubcategory = src.librarySubcategory ? String(src.librarySubcategory).trim() : null;
  if (value.librarySubcategory && value.libraryPrimaryCategory
    && value.librarySubcategory.split('.')[0] !== value.libraryPrimaryCategory) {
    errors.push('librarySubcategory 必须位于所选的 libraryPrimaryCategory 下');
    value.librarySubcategory = null;
  }

  const pick = (key, allowed, dflt) => {
    const raw0 = src[key] === undefined || src[key] === null ? dflt : src[key];
    const v = String(raw0).trim().toLowerCase();
    if (allowed.indexOf(v) === -1) errors.push(key + ' 必须是 ' + allowed.join('/'));
    return v;
  };
  value.reuseScope = pick('reuseScope', REUSE_SCOPES, 'none');
  value.aiReusePolicy = pick('aiReusePolicy', AI_REUSE_POLICIES, 'blocked');
  value.externalAiTransferPolicy = pick('externalAiTransferPolicy', EXTERNAL_AI_TRANSFER_POLICIES, 'blocked');

  const hash = String(src.contentHash || '').trim().toLowerCase();
  if (hash && !CONTENT_HASH_RE.test(hash)) errors.push('contentHash 必须是 64 位小写十六进制（sha256）');
  value.contentHash = hash || null;

  value.fileName = src.fileName ? String(src.fileName).trim().slice(0, 180) : null;
  value.fileSize = Number.isFinite(Number(src.fileSize)) ? Math.max(0, Math.floor(Number(src.fileSize))) : null;
  value.note = src.note ? String(src.note).slice(0, 500) : '';

  return { ok: missing.length === 0 && errors.length === 0, missing, errors, value };
}

/** sha256 hex（契约：哈希**原始字节**，不是重新序列化后的 JSON 文本） */
function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf === undefined || buf === null ? Buffer.alloc(0) : buf).digest('hex');
}
/** 计算请求体哈希（契约 §1.1：GET/无体 = sha256('')；字符串按 UTF-8 取原始字节） */
function bodyHashOf(bodyStr) {
  const s = bodyStr === undefined || bodyStr === null ? '' : String(bodyStr);
  return sha256Hex(Buffer.from(s, 'utf8'));
}
/** `sha256('')` 的常量值（契约 §1.1 第 1 点，用于自检断言） */
const EMPTY_BODY_HASH = bodyHashOf('');

/**
 * 规范化待签串（逐字节对齐 Workspace `service-accounts.canonicalString()`）。
 * `pathname` **不含** query string。
 */
function canonicalString(keyId, method, pathname, timestamp, nonce, bodyHash) {
  return ['v1', String(keyId), String(method).toUpperCase(), String(pathname),
    String(timestamp), String(nonce), String(bodyHash)].join('\n');
}

/**
 * 生成服务签名头（Ed25519，对 canonicalString 的 UTF-8 字节签名；base64 输出）。
 * @param {object} o { keyId, privateKey(PEM|KeyObject), method, pathname, bodyStr, timestamp, nonce }
 * @returns {{headers:object, canonical:string, bodyHash:string, nonce:string, timestamp:string}}
 */
function signedHeaders(o) {
  const keyId = String(o.keyId || '');
  if (!keyId) throw new Error('缺少 keyId');
  if (!o.privateKey) throw new Error('缺少 Ed25519 私钥');
  const method = String(o.method || 'GET').toUpperCase();
  const pathname = String(o.pathname || '');
  if (pathname.indexOf('?') !== -1) {
    // 契约 §1.1 第 2 点：pathname 不含 query。此处直接报错而不是静默截断，避免调用方误以为已签 query。
    throw new Error('canonicalString 的 pathname 不得包含 query string：' + pathname);
  }
  const timestamp = String(o.timestamp !== undefined ? o.timestamp : Math.floor(Date.now() / 1000));
  const nonce = String(o.nonce || crypto.randomBytes(12).toString('hex'));
  const bodyStr = o.bodyStr === undefined || o.bodyStr === null ? '' : String(o.bodyStr);
  const bodyHash = bodyHashOf(bodyStr);
  const canonical = canonicalString(keyId, method, pathname, timestamp, nonce, bodyHash);
  const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), o.privateKey).toString('base64');
  return {
    headers: {
      'x-vfib-key-id': keyId,
      'x-vfib-timestamp': timestamp,
      'x-vfib-nonce': nonce,
      'x-vfib-signature': signature
    },
    canonical, bodyHash, nonce, timestamp
  };
}

/** 本地校验签名（自检用；与服务端 `crypto.verify(null, ...)` 完全同构） */
function verifySigned(keyId, method, pathname, timestamp, nonce, bodyStr, signatureB64, publicKey) {
  const canonical = canonicalString(keyId, method, pathname, timestamp, nonce, bodyHashOf(bodyStr));
  try {
    return crypto.verify(null, Buffer.from(canonical, 'utf8'), publicKey, Buffer.from(String(signatureB64), 'base64'));
  } catch (_) { return false; }
}

/** 封套形状校验：所有端点成功/失败都必须满足（契约 §2） */
function isEnvelope(json) {
  if (!json || typeof json !== 'object') return false;
  if (typeof json.ok !== 'boolean') return false;
  for (const k of ['data', 'error', 'request_id', 'policy_version']) {
    if (!Object.prototype.hasOwnProperty.call(json, k)) return false;
  }
  if (!json.request_id || !json.policy_version) return false;
  // 失败时 data 恒为 null（绝不在错误响应里夹带业务数据）
  if (json.ok === false && json.data !== null) return false;
  if (json.ok === true && json.error !== null) return false;
  return true;
}

/** 从封套解析出结构化结果 */
function parseEnvelope(httpStatus, json) {
  const ok = !!(json && json.ok === true);
  const error = (json && json.error) || null;
  const code = error && error.code ? String(error.code) : '';
  const meta = ERROR_CODES[code];
  return {
    ok,
    httpStatus: Number(httpStatus) || 0,
    data: ok ? (json ? json.data : null) : null,
    errorCode: code,
    errorMessage: error && error.message ? String(error.message) : '',
    errorLayer: meta ? meta.layer : (ok ? '' : 'unknown'),
    retryable: meta ? !!meta.retryable : false,
    requestId: (json && json.request_id) || '',
    policyVersion: (json && json.policy_version) || '',
    envelopeValid: isEnvelope(json)
  };
}

/** 服务账户能否申请某票据范围（服务账户**永不含** final 决定权） */
function serviceGrantable(scopes) {
  return (scopes || []).map(String).filter((s) => SESSION_ONLY_TICKET_SCOPES.indexOf(s) === -1);
}

/* ---------------- 变更事件流（契约 §7） ---------------- */
/**
 * 事件类型**必须**与 Workspace `lib/integration/events.js` 的 `EVENT_TYPES` 字面量逐字节一致。
 * 2026-10-13 按 Workspace V1.1.7 实取源码修正两处：
 *   ① `service_account.changed`（下划线，不是 `service.account.changed`）；
 *   ② 补 `skill.version.changed` —— §F 正式 Skill 批准/生效/废止/撤回事件，
 *      生成任务据此判断是否需重新取规则快照（缺失会导致 Skill 版本变更被静默忽略）。
 */
const EVENT_TYPES = [
  'policy.version.changed', 'admission.state.changed', 'asset.revoked',
  'asset.deprecated', 'skill.version.changed', 'permission.changed',
  'service_account.changed'
];
const CHANGES_MAX_RETAINED = 5000;
const CHANGES_POLL_HINT_SECONDS = 60;

/** 准入状态机（契约 §5.1，仅用于展示与断言；状态迁移权威在 Workspace 侧） */
const ADMISSION_STATES = [
  'DRAFT', 'SUBMITTED', 'PRECHECK', 'REVIEWING', 'REVISION_REQUIRED',
  'FINAL_APPROVAL_PENDING', 'FINAL_APPROVED', 'ADMISSION_PENDING',
  'SYNC_FAILED', 'ADMITTED', 'REJECTED', 'REVOKED', 'DEPRECATED'
];

/** 明确「不做」的边界（契约 §8）：这些能力在 Workspace 侧**已验证不存在** */
const NOT_PROVIDED = [
  'publishedContentArchive',   // Published Content 归档仅在 Marketing OS
  'publish', 'archive'
];

module.exports = {
  CONTRACT_VERSION, WORKSPACE_APP_VERSION, PREFIX, OPENAPI_SHA256,
  ENDPOINTS, SERVICE_SCOPES, TICKET_SCOPES, SESSION_ONLY_TICKET_SCOPES,
  ERROR_CODES, NON_ENVELOPE_ERROR_CODES, ENVELOPE_KEYS, OPENAPI_ERROR_CODE_ENUM,
  PROVIDER_DECLARED_ADDITIONS,
  MARKETING_CATEGORIES, LIBRARY_PRIMARY_CATEGORIES, LIBRARY_CATEGORIES,
  CLASSIFICATIONS, CLASSIFICATION_META,
  LICENSE_STATUSES, REUSE_SCOPES, AI_REUSE_POLICIES, EXTERNAL_AI_TRANSFER_POLICIES,
  ID_RE, CONTENT_HASH_RE, BRAND_ID_MAX, isValidStableKey,
  ADMISSION_REQUIRED_FIELDS, ADMISSION_OPTIONAL_FIELDS, validateAdmissionInput,
  sha256Hex, bodyHashOf, EMPTY_BODY_HASH,
  canonicalString, signedHeaders, verifySigned,
  isEnvelope, parseEnvelope,
  serviceGrantable,
  EVENT_TYPES, CHANGES_MAX_RETAINED, CHANGES_POLL_HINT_SECONDS,
  ADMISSION_STATES, NOT_PROVIDED
};
