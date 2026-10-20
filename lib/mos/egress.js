'use strict';
/**
 * 统一出站治理（V0.1.4 真实接入）。
 *
 * 解决的问题（用户要求 4 中的三块）：
 *  1. **敏感数据外传限制**：外发前按内容自动分级，`CONFIDENTIAL` / `RESTRICTED` 默认**零出站**；
 *     分级不是靠调用方自觉，而是每个 Provider 调用入口都会经过 `assertDataPolicy`。
 *  2. **调用权限收敛**：供应商端点只允许 https（生产）+ 声明式主机白名单 + 拒绝内网/环回/元数据地址，
 *     避免"把密钥发到意外主机"或"用 baseUrl 打内网"。
 *  3. **可审计**：每次拦截都返回结构化理由（`reasons`），供日志与 UI 展示，不静默失败。
 *
 * 与 `adapters/source.js`（网页采集）的关系：
 *  - 采集侧已有更严格的 DNS 固定 IP + 逐跳重校验；本模块**复用**其 `isBlockedIp` / `egressTestFlags`，
 *    不复制一套 IP 判定（避免两套规则漂移）。
 */

const net = require('node:net');
const dns = require('node:dns').promises;
const { getMosConfig, isProductionMode } = require('./config');
const { isBlockedIp, egressTestFlags } = require('./adapters/source');

const DATA_CLASSES = ['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'];

/** 分级规则：命中即取最高等级（顺序即优先级，靠后者覆盖靠前者） */
const RULES = [
  { cls: 'INTERNAL', code: 'INTERNAL_MARKER', re: /(内部资料|仅供内部|内部使用|请勿外传|internal\s+use\s+only|confidential)/i },
  { cls: 'CONFIDENTIAL', code: 'CUSTOMER_DATA', re: /(客户名单|客户信息|账户余额|交易流水|身份证号|银行卡号|护照号|KYC)/i },
  { cls: 'CONFIDENTIAL', code: 'CN_ID_NUMBER', re: /(?<!\d)\d{17}[\dXx](?!\d)/ },
  { cls: 'CONFIDENTIAL', code: 'BANK_CARD', re: /(?<!\d)(?:\d[ -]?){16,19}(?!\d)/ },
  { cls: 'CONFIDENTIAL', code: 'CN_PHONE', re: /(?<!\d)1[3-9]\d{9}(?!\d)/ },
  { cls: 'CONFIDENTIAL', code: 'EMAIL_ADDRESS', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { cls: 'RESTRICTED', code: 'RESTRICTED_MARKER', re: /(绝密|机密|受限数据|restricted|top\s+secret|串谋|未公开财务)/i }
];

const RANK = { PUBLIC: 0, INTERNAL: 1, CONFIDENTIAL: 2, RESTRICTED: 3 };

function normalizeClass(v) {
  const s = String(v == null ? '' : v).trim().toUpperCase();
  return DATA_CLASSES.indexOf(s) !== -1 ? s : '';
}

/**
 * 内容分级：给定文本与调用方声明，返回更严格的那个。
 * @returns {{dataClass:string, declared:string, detected:string, reasons:string[]}}
 */
function classify(text, declared) {
  const s = String(text == null ? '' : text).slice(0, 200000);
  let detected = 'PUBLIC';
  const reasons = [];
  for (const r of RULES) {
    if (r.re.test(s)) {
      if (RANK[r.cls] > RANK[detected]) detected = r.cls;
      reasons.push(r.code);
    }
  }
  const d = normalizeClass(declared);
  const finalCls = d && RANK[d] > RANK[detected] ? d : detected;
  return {
    dataClass: finalCls,
    declared: d || '',
    detected,
    reasons: reasons.slice(0, 8)
  };
}

/** 读取数据外发策略（config.json mos.egress.dataPolicy，可被调用方覆盖） */
function dataPolicy(overrides) {
  const cfg = getMosConfig();
  const base = (cfg.egress && cfg.egress.dataPolicy) || {};
  const o = overrides || {};
  return {
    allowConfidential: o.allowConfidential !== undefined ? !!o.allowConfidential : !!base.allowConfidential,
    allowRestricted: o.allowRestricted !== undefined ? !!o.allowRestricted : !!base.allowRestricted,
    /** 显式豁免时的确认人（写入审计；为空则不放行 RESTRICTED） */
    acknowledgedBy: String(o.acknowledgedBy || base.acknowledgedBy || '')
  };
}

function blockedError(message, code, detail) {
  const e = new Error(message);
  e.code = code;
  e.status = 403;
  if (detail) e.detail = detail;
  return e;
}

/**
 * 数据分级闸门：不通过则**抛错**（调用方必须在发请求前调用，确保零出站）。
 * @param {{dataClass:string}} cls classify() 的结果
 * @param {object} policy dataPolicy() 的结果
 */
function assertDataPolicy(cls, policy) {
  const p = policy || dataPolicy();
  const c = (cls && cls.dataClass) || 'PUBLIC';
  if (c === 'RESTRICTED' && !(p.allowRestricted && p.acknowledgedBy)) {
    throw blockedError(
      '该内容被判定为受限数据，禁止发送至外部模型/搜索服务（需管理员显式豁免并留下确认人）',
      'EGRESS_BLOCKED_RESTRICTED',
      { dataClass: c, reasons: (cls && cls.reasons) || [] }
    );
  }
  if (c === 'CONFIDENTIAL' && !p.allowConfidential) {
    throw blockedError(
      '该内容被判定为机密数据（含客户信息/证件号/银行卡等），默认禁止外发；请先脱敏，或由管理员开启外发豁免',
      'EGRESS_BLOCKED_CONFIDENTIAL',
      { dataClass: c, reasons: (cls && cls.reasons) || [] }
    );
  }
  return true;
}

/** 元数据服务与常见内网别名（即使 DNS 解析被劫持也先按名字拒） */
const BLOCKED_HOSTS = new Set([
  'metadata', 'metadata.google.internal', 'metadata.goog',
  'instance-data', '169.254.169.254', '100.100.100.200'
]);

const VENDOR_HOST_HINTS = [
  'api.openai.com', 'api.anthropic.com', 'api.deepseek.com', 'dashscope.aliyuncs.com',
  'open.bigmodel.cn', 'api.moonshot.cn', 'api.siliconflow.cn', 'generativelanguage.googleapis.com',
  'api.search.brave.com', 'api.tavily.com', 'serpapi.com', 'www.googleapis.com',
  'api.bing.microsoft.com', 'api.runwayml.com', 'api.dev.runwayml.com', 'api.klingai.com',
  'ark.cn-beijing.volces.com', 'visual.volcengineapi.com', 'api.minimax.chat'
];

function isIpLiteral(host) {
  return net.isIP(String(host || '')) !== 0;
}

/**
 * 供应商端点安全校验（调用前执行）。
 * 规则：
 *  - 协议：生产**必须** https；非生产允许 http 仅限环回（且需测试开关）。
 *  - 端口：生产仅 443（可在 egress.allowedPorts 扩展）。
 *  - 主机：拒绝环回/私网/链路本地/元数据（DNS 解析后按**全部** A/AAAA 记录判定）。
 *  - 白名单：`mos.egress.providerHosts` 非空时，主机必须命中（运维可据此锁定只走指定网关）。
 * @param {string} rawUrl
 * @param {{purpose?:string, allowLoopback?:boolean}} opts
 * @returns {Promise<{url:URL, host:string, addresses:string[]}>}
 */
async function assertProviderUrl(rawUrl, opts) {
  const o = opts || {};
  const cfg = getMosConfig();
  const flags = egressTestFlags();
  const prod = isProductionMode();

  let u;
  try {
    u = new URL(String(rawUrl || ''));
  } catch (_) {
    throw blockedError('供应商端点不是合法 URL', 'EGRESS_BAD_URL');
  }

  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw blockedError('供应商端点只允许 http(s) 协议', 'EGRESS_BAD_PROTOCOL');
  }
  const isLoop = /^(localhost|127\.|\[::1\]|::1)/i.test(u.hostname);
  if (u.protocol === 'http:') {
    const loopOk = !prod && (o.allowLoopback || flags.allowLoopback) && isLoop && flags.allowHttp;
    if (!loopOk) {
      throw blockedError('生产环境禁止明文 HTTP 调用供应商（需 https）', 'EGRESS_HTTP_FORBIDDEN');
    }
  }

  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  if (!prod && flags.allowHttp) {
    /* 测试模式放宽端口，与采集侧口径一致 */
  } else {
    const ports = (cfg.egress && cfg.egress.allowedPorts) || [443];
    if (ports.indexOf(port) === -1) {
      throw blockedError('供应商端点端口不在允许列表：' + port, 'EGRESS_PORT_FORBIDDEN');
    }
  }

  const host = String(u.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) throw blockedError('供应商端点缺少主机名', 'EGRESS_BAD_URL');
  if (BLOCKED_HOSTS.has(host)) {
    throw blockedError('禁止访问云元数据/内网别名主机：' + host, 'EGRESS_BLOCKED_HOST');
  }

  let addresses = [];
  if (isIpLiteral(host)) {
    addresses = [host];
  } else {
    try {
      const list = await dns.lookup(host, { all: true, verbatim: true });
      addresses = (list || []).map((x) => String(x.address || '')).filter(Boolean);
    } catch (_) {
      throw blockedError('供应商主机名无法解析：' + host, 'EGRESS_DNS_FAILED');
    }
  }
  if (!addresses.length) throw blockedError('供应商主机名没有可用地址：' + host, 'EGRESS_DNS_FAILED');

  const loopAllowed = !prod && (o.allowLoopback || flags.allowLoopback);
  for (const ip of addresses) {
    if (!isBlockedIp(ip)) continue;
    if (loopAllowed && (ip === '127.0.0.1' || ip === '::1' || ip === '0:0:0:0:0:0:0:1')) continue;
    throw blockedError('供应商端点解析到内网/环回/保留地址，已拒绝出站：' + host + ' → ' + ip,
      'EGRESS_BLOCKED_IP', { host, addresses });
  }

  const allow = ((cfg.egress && cfg.egress.providerHosts) || []).map((s) => String(s).toLowerCase());
  if (allow.length && allow.indexOf(host) === -1) {
    throw blockedError('供应商主机不在运维白名单内：' + host, 'EGRESS_HOST_NOT_ALLOWED',
      { host, allowlistSize: allow.length });
  }

  return { url: u, host, addresses };
}

/** 供 UI/文档展示的默认供应商提示（仅提示，不做强制） */
function knownVendorHosts() {
  return VENDOR_HOST_HINTS.slice();
}

/** 出站治理状态（运维页展示） */
function describe() {
  const cfg = getMosConfig();
  const p = dataPolicy();
  const flags = egressTestFlags();
  return {
    httpsOnly: true,
    production: isProductionMode(),
    allowedPorts: (cfg.egress && cfg.egress.allowedPorts) || [443],
    providerHostAllowlist: ((cfg.egress && cfg.egress.providerHosts) || []).length,
    allowConfidential: p.allowConfidential,
    allowRestricted: p.allowRestricted && !!p.acknowledgedBy,
    testFlagsActive: !!flags.testMode,
    note: '所有外部模型/搜索调用前都会做：数据分级闸门 → https 与端口校验 → 内网/环回/元数据地址拒绝 → 主机白名单。'
  };
}

module.exports = {
  DATA_CLASSES, RANK, classify, dataPolicy, assertDataPolicy,
  assertProviderUrl, knownVendorHosts, describe, isIpLiteral
};
