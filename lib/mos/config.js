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

const MOS_VERSION = '0.1.0';

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
    textProvider: 'none',   // none | deepseek（复用既有 DeepSeek 配置）
    imageProvider: 'none'   // BUILD-02 才接入；none = 明确未配置
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
    maxItemsPerRun: 40
  },
  /** 字典标签覆盖（业务可在 config.json 里把 provisional 标签改成正式名称） */
  dictionaries: {},
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
