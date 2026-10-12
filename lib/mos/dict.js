'use strict';
/**
 * Marketing OS —— 品牌、角色权限与业务字典（单一来源）。
 *
 * ⚠ 诚实性声明（10_TRACEABILITY_AND_DECISIONS §5「未确认事项不得默默假定」）：
 *   本轮**未提供**《VFIB全球社交媒体运营与内容生产指导手册 V1.1》(SPECIAL-01) 与
 *   《VFIB Visual Brand Guardian Skill V1.2》文件包，因此：
 *     - 代码（C01-C06 / N01-N05 / V01-V05 / F01-F04 / M01-M05 / A01-A08 / G0-G3）按主控
 *       与 10_TRACEABILITY 明示的**编码集合**建表，保证校验可用；
 *     - 只有主控文档**明确给出名称**的（F01-F04、G0-G3、LinkedIn A-D、YouTube Y-A..Y-D）才落真实标签；
 *     - 其余条目的标签一律标记 `provisional:true`（"待核验"），**不臆造**官方栏目/叙事/视觉名；
 *     - 业务可用 config.json 的 `mos.dictionaries` 覆盖标签，无需改代码。
 */

/* ==================== 品牌 ====================
 * 00 §1：2 个品牌，隔离项目/账号/内容/规则/审核。
 * U CARD 为**当前前置稳定币消费卡**，不同于未来 VFIB CARD；MARS 联名卡归 U CARD。
 */
const BRANDS = [
  {
    id: 'brand_vfib',
    code: 'VFIB',
    name: 'VFIB BANK',
    legalName: 'VFIB BANK',
    status: 'ACTIVE',
    skillState: 'REFERENCE_ONLY',
    skillNote: 'Visual Brand Guardian V1.2 为文件规范包引用，非已上线资料库 Skill（00 §0.1-3）。正式启用前需最终批准与版本核验。',
    palette: ['#071D49', '#0C2E69', '#C78B27', '#A9670C', '#FCFBF7', '#F4EFE5', '#E6D8BD'],
    typography: { heading: 'Libre Baskerville', body: 'DM Sans', cjk: '待正式审批（系统后备字族）' },
    createdAt: '2026-10-01T00:00:00.000Z'
  },
  {
    id: 'brand_ucard',
    code: 'UCARD',
    name: 'U CARD',
    legalName: 'U CARD',
    status: 'ACTIVE',
    skillState: 'MISSING_NOT_APPROVED',
    skillNote: 'U CARD 独立 Skill 尚未批准 —— 以占位能力存在，**不得套用** VFIB 设计规则（00 §1 / 11 检查表）。',
    palette: [],
    typography: { heading: '待批准', body: '待批准', cjk: '待批准' },
    createdAt: '2026-10-01T00:00:00.000Z'
  }
];

const BRAND_CODES = BRANDS.map((b) => b.code);

/* ==================== 权限清单 ====================
 * 03_WORKFLOW_AND_APPROVAL §4 建议权限 + 入库最终特权。
 */
const PERMISSIONS = {
  'brand.read': '查看品牌上下文（按品牌范围）',
  'plan.create': '新建月度计划',
  'plan.update': '修改月度计划与 PlanItem',
  'plan.approve': '批准月度计划（仅获授权的 P1/管理角色）',
  'campaign.manage': '创建与维护 Campaign',
  'topic.manage': '创建与维护 Master Topic',
  'source.manage': '登记情报来源与执行采集',
  'content.edit': '编辑内容草稿',
  'content.submit': '提交内容送审',
  'content.professional_review': '专业（金融事实）审核',
  'content.publish_approve': '发布审核',
  'publication.schedule': '排期（READY→SCHEDULED）',
  'publication.record': '登记实际发布',
  'asset.create': '创建工作素材',
  'asset.submit': '提交资产入库申请',
  'asset.review': '资产入库预检/复核',
  'library.asset.approve.final': '★最终入库许可（独立特权，不自动赋给 P1 或技术管理员）',
  'library.asset.read': '检索已批准可复用资产',
  'model.invoke': '调用 AI 模型（受预算/敏感数据约束）',
  'analytics.read': '查看运营分析'
};

/* ==================== 职能角色（可叠加，不是 4 个固定员工）====================
 * 03 §4：P1 战略治理 / P2 创作 / P3 发布 / P4 产品营销，
 * 另设 PROFESSIONAL_REVIEWER、PUBLISHING_APPROVER、LIBRARY_FINAL_APPROVER 权限集。
 */
const ROLES = {
  P1: {
    code: 'P1', label: 'P1 战略治理', kind: 'FUNCTION',
    permissions: ['brand.read', 'plan.create', 'plan.update', 'plan.approve', 'campaign.manage', 'topic.manage',
      'source.manage', 'content.edit', 'content.submit', 'publication.schedule', 'analytics.read', 'library.asset.read']
  },
  P2: {
    code: 'P2', label: 'P2 创作', kind: 'FUNCTION',
    permissions: ['brand.read', 'campaign.manage', 'topic.manage', 'content.edit', 'content.submit',
      'asset.create', 'asset.submit', 'model.invoke', 'analytics.read', 'library.asset.read']
  },
  P3: {
    code: 'P3', label: 'P3 发布', kind: 'FUNCTION',
    permissions: ['brand.read', 'content.submit', 'content.publish_approve', 'publication.schedule',
      'publication.record', 'analytics.read', 'library.asset.read']
  },
  P4: {
    code: 'P4', label: 'P4 产品营销', kind: 'FUNCTION',
    permissions: ['brand.read', 'campaign.manage', 'topic.manage', 'source.manage', 'content.edit',
      'content.submit', 'analytics.read', 'library.asset.read']
  },
  PROFESSIONAL_REVIEWER: {
    code: 'PROFESSIONAL_REVIEWER', label: '专业审核员', kind: 'AUTHORITY',
    permissions: ['brand.read', 'content.professional_review', 'library.asset.read']
  },
  PUBLISHING_APPROVER: {
    code: 'PUBLISHING_APPROVER', label: '发布审批人', kind: 'AUTHORITY',
    permissions: ['brand.read', 'content.publish_approve', 'publication.schedule', 'library.asset.read']
  },
  /**
   * 资产入库**预检**权限集（BUILD-03）。
   * 03 §4 的权限清单里有 `asset.review`，但未指定承载角色；此处按同一「权限集」模式补一个
   * AUTHORITY 角色承载它，**刻意不含** `library.asset.approve.final` —— 预检与最终审批分权（A-16）。
   */
  ASSET_REVIEWER: {
    code: 'ASSET_REVIEWER', label: '资产入库预检员', kind: 'AUTHORITY',
    permissions: ['brand.read', 'asset.review', 'library.asset.read']
  },
  LIBRARY_FINAL_APPROVER: {
    code: 'LIBRARY_FINAL_APPROVER', label: '资料库最终入库审批人', kind: 'AUTHORITY',
    permissions: ['brand.read', 'library.asset.approve.final', 'library.asset.read']
  },
  /**
   * 技术管理角色（原型必需，用于分配角色与查看审计）。
   * 明确**不含** library.asset.approve.final —— 技术管理员不自动获得业务特权，需独立授权。
   */
  MOS_ADMIN: {
    code: 'MOS_ADMIN', label: '系统管理员（技术）', kind: 'TECH',
    permissions: Object.keys(PERMISSIONS).filter((p) => p !== 'library.asset.approve.final')
  }
};

const ROLE_CODES = Object.keys(ROLES);

/* ==================== 业务字典 ====================
 * 标注 source:'SPEC' 表示主控文档明确给出；source:'provisional' 表示待 SPECIAL-01 核验。
 */
/** 来源等级（04 §3）：S1 官方 / S2 行业 / S3 专业媒体 / S4 研究 */
const SOURCE_TIERS = [
  { code: 'S1', label: 'S1 官方（监管/国际组织）' },
  { code: 'S2', label: 'S2 行业组织' },
  { code: 'S3', label: 'S3 专业媒体' },
  { code: 'S4', label: 'S4 研究机构' }
];

/** 采集方式 */
const SOURCE_METHODS = [
  { code: 'RSS', label: 'RSS / Atom' },
  { code: 'JSON_API', label: '官方 JSON API' },
  { code: 'MANUAL', label: '人工登记（不自动抓取）' }
];

/** 许可状态（05 §1 / 04 §3） */
const LICENSE_STATES = [
  { code: 'OPEN', label: '开放（官方公开）' },
  { code: 'LICENSED', label: '已授权转载' },
  { code: 'METADATA_ONLY', label: '仅元数据 + 链接（未授权全文）' },
  { code: 'UNVERIFIED', label: '许可待核验（不得抓取全文）' }
];

function prov(code, note) {
  return { code, label: '待核验', provisional: true, source: 'provisional', note: note || 'SPECIAL-01 未提供，标签待业务核验' };
}

const DICTIONARIES = {
  /** C01–C06 六大官方内容栏目（10 §1） */
  pillars: [
    prov('C01'), prov('C02'), prov('C03'), prov('C04'), prov('C05'), prov('C06')
  ],
  /** N01–N05 五种叙事（10 §1） */
  narratives: [prov('N01'), prov('N02'), prov('N03'), prov('N04'), prov('N05')],
  /** V01–V05 五种视觉语言（→ Visual Studio，BUILD-02） */
  visuals: [prov('V01'), prov('V02'), prov('V03'), prov('V04'), prov('V05')],
  /** F01–F04 视频类型（主控明示：Cinema / Documentary / Explainer / Tutorial） */
  videoTypes: [
    { code: 'F01', label: 'Cinema', source: 'SPEC' },
    { code: 'F02', label: 'Documentary', source: 'SPEC' },
    { code: 'F03', label: 'Explainer', source: 'SPEC' },
    { code: 'F04', label: 'Tutorial', source: 'SPEC' }
  ],
  /** M01–M05 Motion Identity 五种（→ Video Workspace，BUILD-02） */
  motions: [prov('M01'), prov('M02'), prov('M03'), prov('M04'), prov('M05')],
  /** A01–A08 八类正式资产（→ Asset Admission，BUILD-03） */
  assetCategories: [
    prov('A01'), prov('A02'), prov('A03'), prov('A04'), prov('A05'), prov('A06'), prov('A07'), prov('A08')
  ],
  /** G0–G3 风险分层（主控 03 §3 明示触发示例） */
  riskGrades: [
    { code: 'G0', label: 'G0 不影响事实的格式调整', source: 'SPEC', professionalReview: 'by_policy', publicationApproval: 'by_policy', autoPublish: false },
    { code: 'G1', label: 'G1 常规机构形象/金融知识', source: 'SPEC', professionalReview: 'by_content', publicationApproval: 'required', autoPublish: false },
    { code: 'G2', label: 'G2 产品功能、费用、路径、资格', source: 'SPEC', professionalReview: 'required', publicationApproval: 'required', autoPublish: false },
    { code: 'G3', label: 'G3 储备、牌照、重大公告、监管', source: 'SPEC', professionalReview: 'required_elevated', publicationApproval: 'required_elevated', autoPublish: false }
  ],
  /** 平台（05 §6） */
  platforms: [
    { code: 'LINKEDIN', label: 'LinkedIn', source: 'SPEC' },
    { code: 'X', label: 'X', source: 'SPEC' },
    { code: 'YOUTUBE', label: 'YouTube', source: 'SPEC' },
    { code: 'FACEBOOK', label: 'Facebook', source: 'SPEC' }
  ],
  /** 视觉模式（04 §2：主控明示 MODE-A / MODE-B） */
  modes: [
    { code: 'MODE-A', label: 'MODE-A', source: 'SPEC' },
    { code: 'MODE-B', label: 'MODE-B', source: 'SPEC' }
  ],
  /** PPT-01~08 模板（04 §2 明示编码集合，标签待 SPECIAL-01 核验） */
  templateCodes: [
    prov('PPT-01'), prov('PPT-02'), prov('PPT-03'), prov('PPT-04'),
    prov('PPT-05'), prov('PPT-06'), prov('PPT-07'), prov('PPT-08')
  ],
  /** D0~D3 显示/密度分档（04 §2 明示编码集合，标签待核验） */
  displays: [prov('D0'), prov('D1'), prov('D2'), prov('D3')],
  /** 画幅（程序化排版与生图的确定输入，非品牌字典） */
  aspects: [
    { code: '1:1', label: '1:1 方形', source: 'SPEC' },
    { code: '4:5', label: '4:5 竖版', source: 'SPEC' },
    { code: '16:9', label: '16:9 横版', source: 'SPEC' },
    { code: '9:16', label: '9:16 竖屏', source: 'SPEC' }
  ],
  /** 内容任务类型（BUILD-01 已用，纳入字典以便统一校验） */
  taskTypes: [
    { code: 'ARTICLE', label: '长文 / Article', source: 'SPEC' },
    { code: 'THREAD', label: '短线程 / Thread', source: 'SPEC' },
    { code: 'CAROUSEL', label: '轮播 / Carousel', source: 'SPEC' },
    { code: 'VIDEO_SCRIPT', label: '视频脚本 / Video Script', source: 'SPEC' },
    { code: 'POST', label: '帖文 / Post', source: 'SPEC' },
    { code: 'NEWSLETTER', label: '通讯 / Newsletter', source: 'SPEC' }
  ],
  /** 更正/撤回类型（05 §4：追加事件，不改写旧快照） */
  correctionKinds: [
    { code: 'CORRECTION', label: '更正（文字/事实修订）', source: 'SPEC' },
    { code: 'REPLACEMENT', label: '替换（换版重发）', source: 'SPEC' },
    { code: 'REMOVAL', label: '撤回 / 下架', source: 'SPEC' }
  ],
  /** 指标来源（05 §4：必须带来源与时间） */
  metricSourceKinds: [
    { code: 'MANUAL', label: '人工录入', source: 'SPEC' },
    { code: 'API', label: '平台 API', source: 'SPEC' },
    { code: 'IMPORT', label: '导入文件', source: 'SPEC' }
  ]
};

/**
 * AI 外发数据分级（06 §5）：Public 可外发 / Internal 需授权策略 / Restricted 默认拒发。
 * 服务端在**调用任何外部 Provider 之前**判定，命中 RESTRICTED 一律阻断（fail closed）。
 * 注意：必须声明在 DICTIONARIES 索引构建之前，否则 TDZ 报错。
 */
const DATA_CLASSES = [
  { code: 'PUBLIC', label: 'Public 公开数据', source: 'SPEC', sendAllowed: true },
  { code: 'INTERNAL', label: 'Internal 内部资料（需授权策略）', source: 'SPEC', sendAllowed: true },
  { code: 'RESTRICTED', label: 'Restricted 受限资料（默认拒发）', source: 'SPEC', sendAllowed: false }
];

/** 索引化：code -> entry（先并入来源相关字典，保证 dictValid 对它们同样生效） */
DICTIONARIES.sourceTiers = SOURCE_TIERS;
DICTIONARIES.sourceMethods = SOURCE_METHODS;
DICTIONARIES.licenseStates = LICENSE_STATES;
/** AI 外发数据分级（06 §5）—— 纳入统一字典校验 */
DICTIONARIES.dataClasses = DATA_CLASSES;

const DICT_INDEX = {};
for (const key of Object.keys(DICTIONARIES)) {
  DICT_INDEX[key] = {};
  for (const entry of DICTIONARIES[key]) DICT_INDEX[key][entry.code] = entry;
}

function dictValid(dictKey, code) {
  return !!(DICT_INDEX[dictKey] && DICT_INDEX[dictKey][code]);
}

/* ==================== 内容任务状态机（02 §4 / 03 §2.2）==================== */
const TASK_STATUSES = ['IDEA', 'PLANNED', 'IN_PRODUCTION', 'IN_REVIEW', 'READY', 'COMPLETED', 'ON_HOLD', 'CANCELLED'];
/** 允许的迁移（服务端强制；其余一律 409/400） */
const TASK_TRANSITIONS = {
  IDEA: ['PLANNED', 'IN_PRODUCTION', 'ON_HOLD', 'CANCELLED'],
  PLANNED: ['IN_PRODUCTION', 'ON_HOLD', 'CANCELLED'],
  IN_PRODUCTION: ['IN_REVIEW', 'ON_HOLD', 'CANCELLED'],
  IN_REVIEW: ['READY', 'IN_PRODUCTION', 'ON_HOLD', 'CANCELLED'],
  READY: ['COMPLETED', 'IN_REVIEW', 'CANCELLED'],
  ON_HOLD: ['IDEA', 'PLANNED', 'IN_PRODUCTION', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
};

/* ==================== BUILD-02 状态机（02 §4 / 03 §2）====================
 * 四条状态**相互独立**，不得用一个万能标志替代（03 §1）。
 */

/** 内容版本（02 §4）：DRAFT 冻结 → LOCKED_FOR_REVIEW，批准后只读 */
const CONTENT_VERSION_STATES = ['DRAFT', 'LOCKED_FOR_REVIEW', 'REVISION_REQUIRED', 'APPROVED', 'SUPERSEDED'];
const CONTENT_VERSION_TRANSITIONS = {
  DRAFT: ['LOCKED_FOR_REVIEW', 'SUPERSEDED'],
  LOCKED_FOR_REVIEW: ['APPROVED', 'REVISION_REQUIRED', 'SUPERSEDED'],
  // 修订**不允许直接改写原版本**（03 §2.2「底稿变化 → 产生新版本」）：
  // REVISION_REQUIRED 只能派生新版本（revise），原版本随之 SUPERSEDED。
  REVISION_REQUIRED: ['SUPERSEDED'],
  APPROVED: ['SUPERSEDED'],   // 已批准版本本身不可改写，只可被新版本取代
  SUPERSEDED: []
};

/** 审核单（02 §4）：三种类型共用状态机，权能由 type 决定 */
const REVIEW_TYPES = ['PROFESSIONAL_REVIEW', 'PUBLICATION_APPROVAL', 'ASSET_ADMISSION'];
const REVIEW_CASE_STATES = ['SUBMITTED', 'IN_REVIEW', 'REVISION_REQUIRED', 'APPROVED', 'REJECTED', 'CANCELLED'];
const REVIEW_CASE_TRANSITIONS = {
  SUBMITTED: ['IN_REVIEW', 'APPROVED', 'REVISION_REQUIRED', 'REJECTED', 'CANCELLED'],
  IN_REVIEW: ['APPROVED', 'REVISION_REQUIRED', 'REJECTED', 'CANCELLED'],
  REVISION_REQUIRED: ['CANCELLED'],
  APPROVED: [],
  REJECTED: [],
  CANCELLED: []
};
/** 审核动作（review_decisions.action，append-only） */
const REVIEW_ACTIONS = ['START_REVIEW', 'APPROVE', 'REQUEST_REVISION', 'REJECT', 'CANCEL'];

/** 排期（02 §4）：审核未完成只能是 DRAFT/BLOCKED，**不可变 READY**（03 §2.3） */
const SCHEDULE_STATES = ['DRAFT', 'BLOCKED', 'READY', 'SCHEDULED', 'CANCELLED'];
const SCHEDULE_TRANSITIONS = {
  DRAFT: ['BLOCKED', 'READY', 'CANCELLED'],
  BLOCKED: ['DRAFT', 'READY', 'CANCELLED'],
  READY: ['BLOCKED', 'SCHEDULED', 'CANCELLED'],
  SCHEDULED: ['CANCELLED'],
  CANCELLED: []
};

/** 发布记录（02 §4）：仅在实际发布登记后创建；到期**不自动**置 PUBLISHED（03 §2.3） */
const PUBLICATION_STATUSES = ['PUBLISHED', 'CORRECTED', 'REMOVED'];
const PUBLICATION_TRANSITIONS = {
  PUBLISHED: ['CORRECTED', 'REMOVED'],
  CORRECTED: ['REMOVED'],
  REMOVED: []
};

/* ==================== BUILD-03 状态机（03 §2.4）====================
 * AssetAdmission 有**两个相互独立**的字段：最终审批 + 资料库同步；
 * 二者都不能单独决定「可复用」，可复用资格是**计算判定**（见 admissionlib.reuseEligibility）。
 */
const ADMISSION_STATES = [
  'WORKING', 'SUBMITTED', 'PRECHECK', 'REVIEWING', 'FINAL_APPROVAL_PENDING',
  'FINAL_APPROVAL_GRANTED', 'REJECTED',
  'LIBRARY_SYNC_PENDING', 'SYNC_COMPLETED', 'SYNC_FAILED', 'AVAILABLE'
];
const ADMISSION_TRANSITIONS = {
  WORKING: ['SUBMITTED'],
  SUBMITTED: ['PRECHECK'],
  PRECHECK: ['REVIEWING', 'REJECTED'],
  REVIEWING: ['FINAL_APPROVAL_PENDING', 'REJECTED'],
  FINAL_APPROVAL_PENDING: ['FINAL_APPROVAL_GRANTED', 'REJECTED'],
  FINAL_APPROVAL_GRANTED: ['LIBRARY_SYNC_PENDING'],
  REJECTED: [],
  LIBRARY_SYNC_PENDING: ['SYNC_COMPLETED', 'SYNC_FAILED'],
  // 失败可重试（幂等）；成功后仍需**真实权限核验**才可能 AVAILABLE —— Mock 下永远到不了
  SYNC_FAILED: ['LIBRARY_SYNC_PENDING'],
  SYNC_COMPLETED: ['AVAILABLE'],
  AVAILABLE: []
};

/** 最终审批状态（03 §2.4 建议字段）—— 与 syncStatus 相互独立 */
const ADMISSION_APPROVAL_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
/** 资料库同步状态（03 §2.4 建议字段） */
const ADMISSION_SYNC_STATUSES = ['NOT_STARTED', 'PENDING', 'COMPLETED', 'FAILED'];
/** 可复用资产引用的资产状态（L1–L3 资格层，10 §1） */
const LIBRARY_ASSET_STATES = ['ACTIVE', 'MOCK_SANDBOX', 'REVOKED'];
/** 预检结论 */
const PRECHECK_VERDICTS = ['PASS', 'FAIL'];
/** 最终授权的实际验证来源：MOCK 只能产出 MOCK_APPROVED（03 §2.4） */
const APPROVAL_MODES = ['MOCK', 'REAL'];

/** 工作素材来源 */
const ASSET_ORIGINS = ['UPLOADED', 'GENERATED'];

/** 生成作业状态（04 §1 / §5） */
const GENERATION_JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BUDGET_EXCEEDED', 'NOT_CONFIGURED', 'BLOCKED'];
/** 视频工作区状态 */
const VIDEO_ARTIFACT_STATES = ['BRIEF', 'SCRIPT', 'STORYBOARD', 'SUBTITLE', 'FINAL_UPLOADED'];
/** 渠道状态（05 §2） */
const CHANNEL_STATES = ['ENABLED', 'DISABLED'];
/** Skill 版本状态（04 §2）：只有 APPROVED 才允许用于正式品牌输出 */
const SKILL_STATES = ['APPROVED', 'REFERENCE_ONLY', 'PENDING_APPROVAL', 'MISSING_NOT_APPROVED'];

/** 需要独立专业审核的风险等级（03 §2.2：G2 及 G3 预设强制 Professional Review） */
const RISK_REQUIRES_PROFESSIONAL_REVIEW = ['G2', 'G3'];
/** 需要提升授权（更高等级发布授权）的风险等级 —— 具体签字链待业务批准，开发为可配置 */
const RISK_REQUIRES_ELEVATED = ['G3'];

/** 月度计划状态机（03 §2.1） */
const PLAN_STATUSES = ['DRAFT', 'SUBMITTED', 'REVISION_REQUIRED', 'APPROVED', 'ACTIVE', 'CLOSED', 'CANCELLED'];
const PLAN_TRANSITIONS = {
  DRAFT: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['APPROVED', 'REVISION_REQUIRED', 'CANCELLED'],
  REVISION_REQUIRED: ['SUBMITTED', 'DRAFT', 'CANCELLED'],
  APPROVED: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['CLOSED', 'CANCELLED'],
  CLOSED: [],
  CANCELLED: []
};

module.exports = {
  BRANDS,
  BRAND_CODES,
  PERMISSIONS,
  ROLES,
  ROLE_CODES,
  DICTIONARIES,
  DICT_INDEX,
  dictValid,
  TASK_STATUSES,
  TASK_TRANSITIONS,
  CONTENT_VERSION_STATES,
  CONTENT_VERSION_TRANSITIONS,
  REVIEW_TYPES,
  REVIEW_CASE_STATES,
  REVIEW_CASE_TRANSITIONS,
  REVIEW_ACTIONS,
  SCHEDULE_STATES,
  SCHEDULE_TRANSITIONS,
  PUBLICATION_STATUSES,
  PUBLICATION_TRANSITIONS,
  ASSET_ORIGINS,
  ADMISSION_STATES,
  ADMISSION_TRANSITIONS,
  ADMISSION_APPROVAL_STATUSES,
  ADMISSION_SYNC_STATUSES,
  LIBRARY_ASSET_STATES,
  PRECHECK_VERDICTS,
  APPROVAL_MODES,
  DATA_CLASSES,
  GENERATION_JOB_STATUSES,
  VIDEO_ARTIFACT_STATES,
  CHANNEL_STATES,
  SKILL_STATES,
  RISK_REQUIRES_PROFESSIONAL_REVIEW,
  RISK_REQUIRES_ELEVATED,
  PLAN_STATUSES,
  PLAN_TRANSITIONS,
  SOURCE_TIERS,
  SOURCE_METHODS,
  LICENSE_STATES
};
