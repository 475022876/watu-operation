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
const { PATHS } = require('../config');

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
   * 出站抓取策略（SSRF 防御，06 §5）。
   *   - allowedHosts 为空数组 = **只允许 DEMO 种子**、拒绝一切真实出站（fail closed）。
   *   - fetchTimeoutMs / maxBytes 限制单次抓取规模。
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
  // 仅限本地端到端验证使用（生产保持 https-only）
  if (process.env.MOS_EGRESS_ALLOW_HTTP !== undefined) {
    cfg.egress.allowHttp = /^(1|true|yes|on)$/i.test(String(process.env.MOS_EGRESS_ALLOW_HTTP).trim());
  }

  cfg.mosVersion = MOS_VERSION;
  cfg.dataFile = path.join(PATHS.dataDir, 'mos.json');
  cached = cfg;
  return cfg;
}

/** 供测试/热更新使用 */
function resetConfigCache() {
  cached = null;
}

module.exports = { MOS_VERSION, getMosConfig, resetConfigCache, DEFAULT };
