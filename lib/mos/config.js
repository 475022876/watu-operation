'use strict';
/**
 * Marketing OS —— 子系统配置（单一来源）。
 *
 * 口径：
 *   - 数据文件默认落在 `<数据目录>/mos.json`（本工程 `data/`）；`MOS_DATA_DIR` 一处即可
 *     整体隔离，便于各套自检使用互不干扰的独立数据目录。
 *   - 集成状态（identity / knowledge / library / text / image / source）**必须显式声明**，
 *     未接通的一律为 `mock`，UI/API 不得谎称已打通（00 §0.1-5、06 §1）。
 *   - 覆盖优先级：内置默认 < config.json 的 `mos` 段 < 环境变量 MOS_*。
 */
const fs = require('node:fs');
const path = require('node:path');
const { PATHS, getConfig } = require('../config');

const MOS_VERSION = '0.1.4';

const DEFAULT = {
  enabled: true,
  /**
   * 集成状态矩阵（Mock/Real 的唯一权威来源）。
   * 任何一处从 mock 改成 real 都必须同步更新 docs/marketing-os/MOCK_REAL_MATRIX.md 并说明验证方式。
   */
  integrations: {
    identity: 'mock',       // MockIdentityGateway（本地隔离测试身份）
    knowledge: 'mock',      // MockKnowledgeGateway
    library: 'mock',        // MockLibraryGateway（入库/检索）
    sourceIngest: 'real',   // 来源采集：真实 HTTP 抓取（受 allowlist + SSRF 白名单约束）；失败即降级
    textProvider: 'none',   // none | mock | deepseek（复用既有 DeepSeek 配置）
    imageProvider: 'none'   // none | mock | openai；none = 明确未配置
  },
  /**
   * 文本 Provider 服务端配置（A-05 / 04 §6）。
   *   ⚠ apiKey **只在服务端**（此处或环境变量），绝不下发浏览器、绝不写日志/导出物（SEC-07）。
   *   baseUrl/model/timeoutMs 可配：便于自托管网关、代理与**离线契约测试**。
   */
  text: { apiKey: '', baseUrl: '', model: '', timeoutMs: 30000 },
  /** 图像 Provider 服务端配置（A-05 / 04 §6）；字段语义同上 */
  image: { apiKey: '', baseUrl: '', model: '', timeoutMs: 60000 },
  /**
   * 视频 Provider 服务端配置（V0.1.4）。
   * 异步任务式供应商：提交 → 轮询 → 下载。`generic` 模式需填三个路径模板（占位符 {id}）。
   * 默认 none → **只保留手工流程**（脚本/分镜/关键帧/成片上传），不伪造 AI 成片。
   */
  video: {
    provider: 'none',       // none | openai | generic
    apiKey: '', baseUrl: '', model: '',
    timeoutMs: 60000, maxRetries: 1,
    pollIntervalMs: 5000, maxPollMs: 600000, durationSec: 4,
    createPath: '', statusPath: '', contentPath: ''
  },
  /**
   * Enterprise Workspace（企业资料库）集成（A-06）。
   *
   * **默认整体未配置 → fail closed**：不发起任何出站、不返回任何资产结果。
   * 凭据（Ed25519 私钥）**只在服务端**，绝不入文档、日志、导出物或前端。
   * baseUrl 只应由**运维**在 config.json / 环境变量中指定（不接受用户输入，SSRF 面由此收敛）。
   */
  workspace: {
    enabled: false,
    baseUrl: '',            // 例：https://workspace.internal
    keyId: '',              // 服务账户 keyId（svc_...）
    privateKeyPem: '',      // Ed25519 PKCS8 PEM（明文，仅限受控部署）
    privateKeyPath: '',     // 或从文件读取（优先级高于 privateKeyPem 为空时）
    ticket: '',             // 当前服务票据（由 Workspace 签发，可运行时更新）
    timeoutMs: 15000,
    correlationIdPrefix: 'mos',
    /* ---- B2：受限用户票据生命周期 ---- */
    /**
     * 服务账户为真实用户换取票据时，**允许**使用的品牌上下文。
     * 留空 = 不限制（每次调用仍必须显式给出品牌，且必须与签名主体一致）。
     * 例：['VFIB','UCARD'] —— 与 Provider `OA_INTEGRATION_ALLOWED_BRANDS` 对齐。
     */
    brands: [],
    /** 请求票据时索取的 scope（服务端会 ∩ 服务账户范围并剔除 session-only 项） */
    ticketScopes: [
      'knowledge.search', 'assets.search', 'assets.read',
      'admissions.write', 'admissions.read', 'skills.read', 'changes.read'
    ],
    /** 票据 TTL 请求值（秒）；服务端有上限（默认 900）会钳制 */
    ticketTtlSeconds: 300,
    /** 刷新安全余量（秒）：剩余有效期低于此值即视为需刷新 */
    ticketRefreshSkewSeconds: 60,
    /* ---- B3：变更事件轮询 ---- */
    pollIntervalSeconds: 60,
    pollLimit: 200,
    /** 事件消费默认关闭：未获运营授权时不自动出站 */
    pollEnabled: false,
    /* ---- 出站与重试 ---- */
    retry: { maxAttempts: 3, baseDelayMs: 300, capDelayMs: 4000 },
    /**
     * 出站主机白名单（主机名，小写）。留空且未显式允许回环 = **一律拒绝出站**（fail closed）。
     * 作用：baseUrl 属运维配置，但仍做一次收敛，避免配置错误把凭据发到非预期主机。
     */
    allowedHosts: [],
    /** 仅隔离测试：允许 127.0.0.1/::1 明文 HTTP。**生产一律拒绝**（见 workspace-client 断言） */
    allowLoopbackHttp: false,
    /**
     * **真实用户映射**：Marketing OS 用户 id → 企业资料库中的用户 id/username。
     *
     * 为什么必须有它：Provider 在服务端**每次都用票据里的真实员工自己的权限重新判定**
     * （`SERVICE_AUTH_HANDOFF.md` §0），服务身份不能替代用户身份。
     * 因此本侧必须显式声明「哪个 MOS 账号对应哪个资料库账号」，**不允许**猜测或默认放行。
     */
    userMap: {},
    /** 兜底服务用户：未命中 userMap 时使用的资料库用户 id/username（仍必须是**真实存在且启用**的员工） */
    serviceUserId: ''
  },
  /**
   * 出站抓取策略（SSRF 防御，06 §5；整改 F-01）。
   *   - allowedHosts 为空数组 = **只允许 DEMO 种子**、拒绝一切真实出站（fail closed）。
   *   - allowedPorts：**生产**（allowHttp=false，https-only）只允许 443；
   *     本地端到端验证开启 `MOS_EGRESS_ALLOW_HTTP=1` 后放宽（测试专用，生产拒绝启用）。
   *   - maxRedirects：跳转链上限；**每一跳都重新做白名单 + SSRF + 协议 + 端口校验**。
   *   - fetchTimeoutMs / maxBytes：限制单次抓取规模（maxBytes 按**未压缩**字节计）。
   */
  egress: {
    allowedHosts: [
      'www.bis.org', 'bis.org',
      'www.imf.org', 'imf.org',
      'www.fsb.org', 'fsb.org',
      'www.fatf-gafi.org', 'fatf-gafi.org',
      'www.swift.com', 'swift.com'
    ],
    allowHttp: false,
    allowedPorts: [443],
    maxRedirects: 3,
    fetchTimeoutMs: 12000,
    maxBytes: 2 * 1024 * 1024,
    maxItemsPerRun: 40,
    /**
     * 供应商端点额外白名单（V0.1.4）。
     * 留空 = 只做协议/端口/内网地址校验（允许管理员接入任意合规公网供应商）；
     * 非空 = **只允许**这些主机（企业网关/合规锁定场景，更严）。
     */
    providerHosts: [],
    /**
     * 数据外发分级策略（V0.1.4）。默认**全部关闭** → 判定为机密/受限的内容零出站。
     * 这是"敏感数据外传限制"的总闸；开启必须由管理员在系统接入页显式确认并留确认人。
     */
    dataPolicy: {
      allowConfidential: false,
      allowRestricted: false,
      acknowledgedBy: ''
    }
  },
  /** 关键字覆盖（业务可在 config.json 里把 provisional 标签改成正式名称） */
  dictionaries: {},
  /**
   * Web 研究搜索 Provider（V0.1.3 Phase B，执行包 02 §真实Provider工程要求）。
   *
   * **可配置、不写死供应商**：`provider` 可选 none | searxng | brave | bing | google | tavily。
   * 默认 none → Web 研究 BLOCKED（零出站、零伪造）。apiKey **只在服务端**，绝不下发/入日志。
   * 计费型供应商（brave/bing/google/tavily）**必须**同时配置 `budget.perJobUsdMax>0`，否则 fail closed。
   */
  websearch: {
    provider: 'none',
    apiKey: '',
    baseUrl: '',            // 覆盖默认端点（自托管 SearXNG / 企业代理网关）
    cx: '',                 // Google Programmable Search 的 cx（搜索引擎 ID）
    timeoutMs: 15000,
    maxResults: 10,
    maxRetries: 1,
    lang: 'en',
    /** 研究文档抓取策略（连接层防护见 adapters/source.js） */
    research: {
      enabled: true,
      fetchFullText: true,
      maxDocs: 6,
      docTimeoutMs: 12000,
      docMaxBytes: 1536 * 1024,
      allowCompressed: true,
      /** 空数组 = 只做 SSRF（放行任意公网主机）；非空 = 额外主机白名单（更严，fail closed） */
      allowedHosts: [],
      excerptChars: 4000,
      maxEvidence: 16
    }
  },
  /**
   * 轻量情报采集调度（A-01）。
   *
   * **默认关闭** —— 未获得运营授权时不自动出站（04 §3「默认关闭或明确经过运营授权后开启」）。
   * 开启后仅调度：ACTIVE + 非 MANUAL 频率 + 域名在 `egress.allowedHosts` 内的来源；
   * 频率与退避均在此处配置，避免散落在代码里。
   *
   * ⚠ 单实例限制：本项目为单文件 JSON 存储，**只支持单实例**。
   *   调度器用 `db.settings.ingestLock`（心跳锁）阻止第二个实例同时采集；
   *   多实例属生产化议题（P2），本轮不假装支持。
   */
  scheduler: {
    enabled: false,
    /** 巡检间隔（分钟，下限 1） */
    intervalMinutes: 60,
    /** 单轮最多执行的来源数（防止一轮打满出站） */
    maxPerTick: 3,
    /** 瞬时失败退避基数与上限（毫秒）：base * 2^(n-1)，上限 cap */
    backoffBaseMs: 5 * 60 * 1000,
    backoffCapMs: 6 * 60 * 60 * 1000,
    /**
     * 连续失败上限：达到即**停止自动重试**并把来源置 ERROR 交人工核查。
     * 作用：未知失败码默认按瞬时处理（避免把可恢复问题误判为永不重试），
     *      但由此产生的重试**有界**，不可能无限重试（见 ingest.js 的失败分类说明）。
     */
    maxFailures: 5,
    /** 锁心跳过期阈值（分钟）：超过则视为旧持有者已死，可接管 */
    lockStaleMinutes: 10
  },
  /** 预算（04 §5）：默认非常保守，超限返回 BUDGET_EXCEEDED */
  budget: {
    brandMonthlyUsd: 0,
    perJobUsdMax: 0
  },
  /**
   * G3（储备/牌照/重大公告/监管）发布审批的**提升授权**角色白名单。
   * 03 §2.2：「G3需更高等级发布授权（具体签字链待业务批准，开发成可配置，不写死姓名）」
   * —— 因此这里只配**角色码**，不写人名；改 config.json 即可调整签字链。
   */
  publishingApprovalElevatedRoles: ['PUBLISHING_APPROVER'],
  /** 单文件上传上限（字节）与单个生成任务产物体积上限 */
  uploads: {
    maxBytes: 20 * 1024 * 1024,
    allowedGeneratedExts: ['.svg', '.png', '.json', '.md', '.txt']
  },
  /** DEMO 种子：仅用于本地/沙盒演示，UI 必须显著标注 DEMO */
  demoSeed: true
};

function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function mergeDeep(base, extra) {
  const out = isPlainObject(base) ? Object.assign({}, base) : {};
  if (!isPlainObject(extra)) return out;
  for (const key of Object.keys(extra)) {
    const val = extra[key];
    if (val === undefined || val === null) continue;
    if (isPlainObject(val) && isPlainObject(base[key])) out[key] = mergeDeep(base[key], val);
    else out[key] = val;
  }
  return out;
}

let cached = null;

function getMosConfig() {
  if (cached) return cached;

  // 关键：先把主配置跑一遍。`MOS_DATA_DIR` 等环境变量是在 `lib/config.js` 的 getConfig()
  // 内应用到 PATHS 上的；若不在此处确保它执行过，任何"先触碰 store、后读端口"的入口
  // （自检脚本、CLI 工具）都会绕过隔离目录，把数据写进真实 data/。见 BUILD-02 自检 A-09。
  getConfig();

  let fromFile = {};
  if (fs.existsSync(PATHS.configFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(PATHS.configFile, 'utf8'));
      if (isPlainObject(parsed.mos)) fromFile = parsed.mos;
    } catch (_) { /* 配置文件解析失败即忽略，不阻断启动 */ }
  }

  const cfg = mergeDeep(DEFAULT, fromFile);

  // 环境变量覆盖（隔离自检用）
  const bool = (v) => /^(1|true|yes|on)$/i.test(String(v).trim());
  if (process.env.MOS_ENABLED !== undefined) cfg.enabled = bool(process.env.MOS_ENABLED);
  if (process.env.MOS_DEMO_SEED !== undefined) cfg.demoSeed = bool(process.env.MOS_DEMO_SEED);
  if (process.env.MOS_IDENTITY !== undefined) cfg.integrations.identity = String(process.env.MOS_IDENTITY).trim().toLowerCase();
  if (process.env.MOS_KNOWLEDGE !== undefined) cfg.integrations.knowledge = String(process.env.MOS_KNOWLEDGE).trim().toLowerCase();
  if (process.env.MOS_LIBRARY !== undefined) cfg.integrations.library = String(process.env.MOS_LIBRARY).trim().toLowerCase();
  if (process.env.MOS_SOURCE_INGEST !== undefined) cfg.integrations.sourceIngest = String(process.env.MOS_SOURCE_INGEST).trim().toLowerCase();
  if (process.env.MOS_TEXT_PROVIDER !== undefined) cfg.integrations.textProvider = String(process.env.MOS_TEXT_PROVIDER).trim().toLowerCase();
  if (process.env.MOS_IMAGE_PROVIDER !== undefined) cfg.integrations.imageProvider = String(process.env.MOS_IMAGE_PROVIDER).trim().toLowerCase();
  // 文本/图像 Provider 服务端参数（A-05）：密钥只在服务端；baseUrl/model/timeout 可配（含离线契约测试）
  if (!cfg.text) cfg.text = {};
  if (!cfg.image) cfg.image = {};
  if (process.env.MOS_TEXT_API_KEY !== undefined) cfg.text.apiKey = String(process.env.MOS_TEXT_API_KEY).trim();
  if (process.env.MOS_TEXT_BASE_URL !== undefined) cfg.text.baseUrl = String(process.env.MOS_TEXT_BASE_URL).trim();
  if (process.env.MOS_TEXT_MODEL !== undefined) cfg.text.model = String(process.env.MOS_TEXT_MODEL).trim();
  if (process.env.MOS_TEXT_TIMEOUT_MS !== undefined) {
    const n = Number(process.env.MOS_TEXT_TIMEOUT_MS);
    if (Number.isFinite(n) && n >= 1000 && n <= 120000) cfg.text.timeoutMs = Math.floor(n);
  }
  if (process.env.MOS_IMAGE_API_KEY !== undefined) cfg.image.apiKey = String(process.env.MOS_IMAGE_API_KEY).trim();
  if (process.env.MOS_IMAGE_BASE_URL !== undefined) cfg.image.baseUrl = String(process.env.MOS_IMAGE_BASE_URL).trim();
  if (process.env.MOS_IMAGE_MODEL !== undefined) cfg.image.model = String(process.env.MOS_IMAGE_MODEL).trim();
  if (process.env.MOS_IMAGE_TIMEOUT_MS !== undefined) {
    const n = Number(process.env.MOS_IMAGE_TIMEOUT_MS);
    if (Number.isFinite(n) && n >= 1000 && n <= 300000) cfg.image.timeoutMs = Math.floor(n);
  }
  /* 视频 Provider（V0.1.4）：默认 none → 仅手工流程，不伪造 AI 成片 */
  if (!cfg.video) cfg.video = {};
  if (process.env.MOS_VIDEO_PROVIDER !== undefined) cfg.video.provider = String(process.env.MOS_VIDEO_PROVIDER).trim().toLowerCase();
  if (process.env.MOS_VIDEO_API_KEY !== undefined) cfg.video.apiKey = String(process.env.MOS_VIDEO_API_KEY).trim();
  if (process.env.MOS_VIDEO_BASE_URL !== undefined) cfg.video.baseUrl = String(process.env.MOS_VIDEO_BASE_URL).trim();
  if (process.env.MOS_VIDEO_MODEL !== undefined) cfg.video.model = String(process.env.MOS_VIDEO_MODEL).trim();
  if (process.env.MOS_VIDEO_TIMEOUT_MS !== undefined) {
    const n = Number(process.env.MOS_VIDEO_TIMEOUT_MS);
    if (Number.isFinite(n) && n >= 1000 && n <= 300000) cfg.video.timeoutMs = Math.floor(n);
  }
  /* 供应商端点额外白名单 / 数据外发策略（V0.1.4） */
  if (process.env.MOS_EGRESS_PROVIDER_HOSTS !== undefined) {
    cfg.egress.providerHosts = String(process.env.MOS_EGRESS_PROVIDER_HOSTS)
      .split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  if (!cfg.egress.dataPolicy) cfg.egress.dataPolicy = { allowConfidential: false, allowRestricted: false, acknowledgedBy: '' };
  if (process.env.MOS_EGRESS_ALLOW_CONFIDENTIAL !== undefined) {
    cfg.egress.dataPolicy.allowConfidential = /^(1|true|yes|on)$/i.test(String(process.env.MOS_EGRESS_ALLOW_CONFIDENTIAL).trim());
  }
  if (process.env.MOS_EGRESS_ALLOW_RESTRICTED !== undefined) {
    cfg.egress.dataPolicy.allowRestricted = /^(1|true|yes|on)$/i.test(String(process.env.MOS_EGRESS_ALLOW_RESTRICTED).trim());
  }
  if (process.env.MOS_EGRESS_ACK_BY !== undefined) {
    cfg.egress.dataPolicy.acknowledgedBy = String(process.env.MOS_EGRESS_ACK_BY).trim();
  }
  // Enterprise Workspace 集成（A-06）：默认未配置；以下任一凭据缺失即保持 fail closed
  if (!cfg.workspace) cfg.workspace = {};
  const wsBool = (v) => /^(1|true|yes|on)$/i.test(String(v).trim());
  if (process.env.MOS_WORKSPACE_ENABLED !== undefined) cfg.workspace.enabled = wsBool(process.env.MOS_WORKSPACE_ENABLED);
  if (process.env.MOS_WORKSPACE_BASE_URL !== undefined) cfg.workspace.baseUrl = String(process.env.MOS_WORKSPACE_BASE_URL).trim();
  if (process.env.MOS_WORKSPACE_KEY_ID !== undefined) cfg.workspace.keyId = String(process.env.MOS_WORKSPACE_KEY_ID).trim();
  if (process.env.MOS_WORKSPACE_PRIVATE_KEY_PEM !== undefined) cfg.workspace.privateKeyPem = String(process.env.MOS_WORKSPACE_PRIVATE_KEY_PEM);
  if (process.env.MOS_WORKSPACE_PRIVATE_KEY_PATH !== undefined) cfg.workspace.privateKeyPath = String(process.env.MOS_WORKSPACE_PRIVATE_KEY_PATH).trim();
  if (process.env.MOS_WORKSPACE_TICKET !== undefined) cfg.workspace.ticket = String(process.env.MOS_WORKSPACE_TICKET).trim();
  if (process.env.MOS_WORKSPACE_TIMEOUT_MS !== undefined) {
    const n = Number(process.env.MOS_WORKSPACE_TIMEOUT_MS);
    if (Number.isFinite(n) && n >= 1000 && n <= 120000) cfg.workspace.timeoutMs = Math.floor(n);
  }
  /* ---- B2/B3：票据生命周期、事件轮询、出站与重试 ---- */
  if (process.env.MOS_WORKSPACE_BRANDS !== undefined) {
    cfg.workspace.brands = String(process.env.MOS_WORKSPACE_BRANDS)
      .split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  }
  if (process.env.MOS_WORKSPACE_TICKET_TTL_SECONDS !== undefined) {
    const n = Number(process.env.MOS_WORKSPACE_TICKET_TTL_SECONDS);
    if (Number.isFinite(n) && n >= 30 && n <= 900) cfg.workspace.ticketTtlSeconds = Math.floor(n);
  }
  if (process.env.MOS_WORKSPACE_TICKET_SKEW_SECONDS !== undefined) {
    const n = Number(process.env.MOS_WORKSPACE_TICKET_SKEW_SECONDS);
    if (Number.isFinite(n) && n >= 0 && n <= 600) cfg.workspace.ticketRefreshSkewSeconds = Math.floor(n);
  }
  if (process.env.MOS_WORKSPACE_POLL_SECONDS !== undefined) {
    const n = Number(process.env.MOS_WORKSPACE_POLL_SECONDS);
    if (Number.isFinite(n) && n >= 5 && n <= 3600) cfg.workspace.pollIntervalSeconds = Math.floor(n);
  }
  if (process.env.MOS_WORKSPACE_POLL_ENABLED !== undefined) {
    cfg.workspace.pollEnabled = wsBool(process.env.MOS_WORKSPACE_POLL_ENABLED);
  }
  if (process.env.MOS_WORKSPACE_RETRY_ATTEMPTS !== undefined) {
    const n = Number(process.env.MOS_WORKSPACE_RETRY_ATTEMPTS);
    if (Number.isInteger(n) && n >= 1 && n <= 10) cfg.workspace.retry.maxAttempts = n;
  }
  if (process.env.MOS_WORKSPACE_ALLOWED_HOSTS !== undefined) {
    cfg.workspace.allowedHosts = String(process.env.MOS_WORKSPACE_ALLOWED_HOSTS)
      .split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  if (process.env.MOS_WORKSPACE_ALLOW_LOOPBACK_HTTP !== undefined) {
    cfg.workspace.allowLoopbackHttp = wsBool(process.env.MOS_WORKSPACE_ALLOW_LOOPBACK_HTTP);
  }
  if (process.env.MOS_WORKSPACE_SERVICE_USER_ID !== undefined) {
    cfg.workspace.serviceUserId = String(process.env.MOS_WORKSPACE_SERVICE_USER_ID).trim();
  }
  if (process.env.MOS_WORKSPACE_USER_MAP !== undefined) {
    // 形如 "mosUserId1=providerUser1,mosUserId2=providerUser2"
    const map = {};
    for (const pair of String(process.env.MOS_WORKSPACE_USER_MAP).split(/[,\n]/)) {
      const i = pair.indexOf('=');
      if (i > 0) map[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    cfg.workspace.userMap = map;
  }
  if (process.env.MOS_EGRESS_ALLOWED_HOSTS !== undefined) {
    cfg.egress.allowedHosts = String(process.env.MOS_EGRESS_ALLOWED_HOSTS)
      .split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  if (process.env.MOS_EGRESS_ALLOWED_PORTS !== undefined) {
    cfg.egress.allowedPorts = String(process.env.MOS_EGRESS_ALLOWED_PORTS)
      .split(/[,\n]/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
  }
  if (process.env.MOS_EGRESS_MAX_REDIRECTS !== undefined) {
    const n = Number(process.env.MOS_EGRESS_MAX_REDIRECTS);
    if (Number.isInteger(n) && n >= 0 && n <= 10) cfg.egress.maxRedirects = n;
  }
  // ⚠ 以下两项**仅限本地端到端验证**；生产环境（isProductionMode()）一律拒绝启用（见 adapters/source.js）。
  if (process.env.MOS_EGRESS_ALLOW_HTTP !== undefined) {
    cfg.egress.allowHttp = /^(1|true|yes|on)$/i.test(String(process.env.MOS_EGRESS_ALLOW_HTTP).trim());
  }
  if (process.env.MOS_EGRESS_MAX_ITEMS_PER_RUN !== undefined) {
    const n = Number(process.env.MOS_EGRESS_MAX_ITEMS_PER_RUN);
    if (Number.isInteger(n) && n >= 1 && n <= 500) cfg.egress.maxItemsPerRun = n;
  }
  /* Web 研究搜索 Provider（V0.1.3 Phase B）：密钥只在服务端；端点/超时/上限可配。
   * 默认 provider='none' → Web 研究 BLOCKED（零出站、零伪造）。 */
  if (!cfg.websearch) cfg.websearch = {};
  if (!cfg.websearch.research) cfg.websearch.research = {};
  if (process.env.MOS_WEBSEARCH_PROVIDER !== undefined) cfg.websearch.provider = String(process.env.MOS_WEBSEARCH_PROVIDER).trim().toLowerCase();
  if (process.env.MOS_WEBSEARCH_API_KEY !== undefined) cfg.websearch.apiKey = String(process.env.MOS_WEBSEARCH_API_KEY).trim();
  if (process.env.MOS_WEBSEARCH_BASE_URL !== undefined) cfg.websearch.baseUrl = String(process.env.MOS_WEBSEARCH_BASE_URL).trim();
  if (process.env.MOS_WEBSEARCH_CX !== undefined) cfg.websearch.cx = String(process.env.MOS_WEBSEARCH_CX).trim();
  if (process.env.MOS_WEBSEARCH_TIMEOUT_MS !== undefined) {
    const n = Number(process.env.MOS_WEBSEARCH_TIMEOUT_MS);
    if (Number.isFinite(n) && n >= 1000 && n <= 120000) cfg.websearch.timeoutMs = Math.floor(n);
  }
  if (process.env.MOS_WEBSEARCH_MAX_RESULTS !== undefined) {
    const n = Number(process.env.MOS_WEBSEARCH_MAX_RESULTS);
    if (Number.isInteger(n) && n >= 1 && n <= 50) cfg.websearch.maxResults = n;
  }
  if (process.env.MOS_WEBSEARCH_MAX_RETRIES !== undefined) {
    const n = Number(process.env.MOS_WEBSEARCH_MAX_RETRIES);
    if (Number.isInteger(n) && n >= 0 && n <= 3) cfg.websearch.maxRetries = n;
  }
  if (process.env.MOS_WEBSEARCH_LANG !== undefined) cfg.websearch.lang = String(process.env.MOS_WEBSEARCH_LANG).trim() || 'en';
  if (process.env.MOS_WEBSEARCH_RESEARCH_MAX_DOCS !== undefined) {
    const n = Number(process.env.MOS_WEBSEARCH_RESEARCH_MAX_DOCS);
    if (Number.isInteger(n) && n >= 1 && n <= 20) cfg.websearch.research.maxDocs = n;
  }
  if (process.env.MOS_WEBSEARCH_RESEARCH_HOSTS !== undefined) {
    cfg.websearch.research.allowedHosts = String(process.env.MOS_WEBSEARCH_RESEARCH_HOSTS)
      .split(/[,\n]/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  }
  if (process.env.MOS_WEBSEARCH_RESEARCH_FULLTEXT !== undefined) {
    cfg.websearch.research.fetchFullText = /^(1|true|yes|on)$/i.test(String(process.env.MOS_WEBSEARCH_RESEARCH_FULLTEXT).trim());
  }
  // 预算（04 §5）：计费型搜索/模型供应商必须显式配置上限，否则 fail closed
  if (!cfg.budget) cfg.budget = {};
  if (process.env.MOS_BUDGET_BRAND_MONTHLY_USD !== undefined) {
    const n = Number(process.env.MOS_BUDGET_BRAND_MONTHLY_USD);
    if (Number.isFinite(n) && n >= 0) cfg.budget.brandMonthlyUsd = n;
  }
  if (process.env.MOS_BUDGET_PER_JOB_USD_MAX !== undefined) {
    const n = Number(process.env.MOS_BUDGET_PER_JOB_USD_MAX);
    if (Number.isFinite(n) && n >= 0) cfg.budget.perJobUsdMax = n;
  }
  // 调度器（A-01）：默认关闭；只有显式开启才会自动出站
  if (!cfg.scheduler) cfg.scheduler = {};  if (process.env.MOS_SCHEDULER_ENABLED !== undefined) {
    cfg.scheduler.enabled = /^(1|true|yes|on)$/i.test(String(process.env.MOS_SCHEDULER_ENABLED).trim());
  }
  if (process.env.MOS_SCHEDULER_INTERVAL_MINUTES !== undefined) {
    const n = Number(process.env.MOS_SCHEDULER_INTERVAL_MINUTES);
    if (Number.isFinite(n) && n >= 1 && n <= 1440) cfg.scheduler.intervalMinutes = Math.floor(n);
  }
  if (process.env.MOS_SCHEDULER_MAX_PER_TICK !== undefined) {
    const n = Number(process.env.MOS_SCHEDULER_MAX_PER_TICK);
    if (Number.isInteger(n) && n >= 1 && n <= 20) cfg.scheduler.maxPerTick = n;
  }
  if (process.env.MOS_SCHEDULER_MAX_FAILURES !== undefined) {
    const n = Number(process.env.MOS_SCHEDULER_MAX_FAILURES);
    if (Number.isInteger(n) && n >= 1 && n <= 50) cfg.scheduler.maxFailures = n;
  }

  cfg.mosVersion = MOS_VERSION;
  cfg.dataFile = path.join(PATHS.dataDir, 'mos.json');
  cached = cfg;
  return cfg;
}

/**
 * 是否处于生产模式。
 * 生产模式下**测试专用**放行开关（MOS_EGRESS_ALLOW_HTTP / MOS_EGRESS_ALLOW_LOOPBACK）一律失效，
 * 且出站端口收窄到 allowedPorts（默认仅 443）。
 */
function isProductionMode() {
  if (process.env.MOS_PRODUCTION === '1') return true;
  if (process.env.MOS_PRODUCTION === '0') return false;
  return /^prod/i.test(String(process.env.NODE_ENV || '').trim());
}

/** 供测试/热更新使用 */
function resetConfigCache() {
  cached = null;
}

module.exports = { MOS_VERSION, getMosConfig, resetConfigCache, isProductionMode, DEFAULT };
