'use strict';
/**
 * V0.1.3 Phase B —— Web Search Provider 适配层（执行包 02 §真实Provider工程要求）。
 *
 * 设计原则（执行包 02 逐条）：
 *  1. **服务端明确实现 `search(query, filters, budget, abortSignal)`**；
 *  2. **可配置、不写死供应商**：`PROVIDERS` 注册表 + `mos.websearch.*` 配置 / `MOS_WEBSEARCH_*` 环境变量；
 *     用户可选任一已实现供应商，或指定自托管端点（baseUrl）。
 *  3. 搜索结果保留**真实** 标题 / 原始 URL / 发布机构 / 发布时间（未知标 null → UI 显示 Unknown）/
 *     抓取时间 / 内容许可 / 摘要 / Provider 标识；每次请求记录**安全脱敏 traceId**。
 *  4. 结果 URL 一律先过 `assertSafeUrl`（**字面层**快速拒绝）；
 *     真正的连接层防护（DNS 固定 IP 复核 + TLS/Host + 逐跳重校验）在 `research-fetch.js`。
 *
 * 诚实性红线（本文件是"不得伪造"的落点）：
 *  - 未配置供应商 → `BLOCKED / NOT_CONFIGURED`：**零出站、零伪造结果**；
 *  - 已实现但未接真实凭据 → 一律 `NOT_CONFIGURED`，**绝不声称已联调**；
 *  - 供应商失败 → 原样上报 HTTP 状态与错误信息，绝不伪造成成功；
 *  - API Key **只在服务端**：本模块所有对外返回都不含 apiKey（trace 中也已脱敏）。
 *
 * 与 MOCK 的边界：本模块**没有** mock 供应商。测试用「本地契约替身」直接以
 * `provider=searxng` + 本地 baseUrl 驱动**同一份真实实现**，因此不存在"用假结果冒充真结果"的路径。
 */

const net = require('node:net');
const { getMosConfig } = require('../config');
const { sha256 } = require('../ids');

/* 注意：`provideradmin` **必须惰性 require**。
 * 它是「配置 + 账本」的聚合器，顶层 require 会连带加载 `store`（打开数据目录并打印一行日志）。
 * `research-fetch.js` 会为了 `wsConfig()` 引入本模块，而它同时被用来做**纯 URL 校验**的子进程探针；
 * 若此时产生任何 stdout 输出，探针的 JSON 解析就会被污染（J-01/J-03 曾因此假失败），
 * 且会以只读方式碰到真实 `data/`（违背 MOS_DATA_DIR 隔离约定）。 */
function providerAdmin() {
  return require('../provideradmin');
}

/* ==================== 供应商注册表（不写死：用户可切换） ==================== */

/**
 * 每个供应商声明：
 *  - `label`        中文展示名
 *  - `implemented`  适配器是否已实现（false → NOT_IMPLEMENTED，绝不假装可选）
 *  - `costBearing`  是否按次计费（true 时**必须**配置预算上限，否则 fail closed）
 *  - `defaultBaseUrl` / `path`  默认端点（可被 baseUrl 覆盖）
 *  - `auth`         { style:'header'|'query'|'body', name }
 *  - `build(ctx)`   返回 { url, init }（GET/POST 均可）
 *  - `parse(json)`  返回归一化前的原始条目数组
 *  - `docsUrl`      供应商文档（供管理员核对参数，不杜撰模型 ID）
 */
const PROVIDERS = {
  none: { label: '未配置', implemented: true, costBearing: false, docsUrl: '' },

  /** 自托管开源元搜索：GET {base}/search?q=&format=json —— 无按次费用 */
  searxng: {
    label: 'SearXNG（自托管元搜索）',
    implemented: true, costBearing: false,
    defaultBaseUrl: '', path: '/search', auth: { style: 'header', name: 'X-API-Key', optional: true },
    docsUrl: 'https://docs.searxng.org/dev/search_api.html',
    build(ctx) {
      const u = new URL(ctx.baseUrl.replace(/\/$/, '') + '/search');
      u.searchParams.set('q', ctx.query);
      u.searchParams.set('format', 'json');
      if (ctx.lang) u.searchParams.set('language', ctx.lang);
      if (ctx.timeRange) u.searchParams.set('time_range', ctx.timeRange);
      return { url: u.toString(), init: { method: 'GET' }, accept: 'application/json' };
    },
    parse(json) {
      const list = (json && Array.isArray(json.results)) ? json.results : [];
      return list.map((r) => ({
        title: r.title, url: r.url, snippet: r.content,
        publishedAt: r.publishedDate || r.published_date || null,
        sourceName: r.engine || r.source || '',
        license: r.license || 'UNKNOWN'
      }));
    }
  },

  /** Brave Search API：GET /res/v1/web/search（header X-Subscription-Token） */
  brave: {
    label: 'Brave Search API',
    implemented: true, costBearing: true,
    defaultBaseUrl: 'https://api.search.brave.com', path: '/res/v1/web/search',
    auth: { style: 'header', name: 'X-Subscription-Token' },
    docsUrl: 'https://api-dashboard.search.brave.com/app/documentation/web-search',
    build(ctx) {
      const u = new URL(ctx.baseUrl.replace(/\/$/, '') + '/res/v1/web/search');
      u.searchParams.set('q', ctx.query);
      u.searchParams.set('count', String(ctx.maxResults));
      u.searchParams.set('result_filter', 'web');
      if (ctx.timeRange) u.searchParams.set('freshness', ctx.timeRange);
      return { url: u.toString(), init: { method: 'GET', headers: { Accept: 'application/json' } } };
    },
    parse(json) {
      const list = (json && json.web && Array.isArray(json.web.results)) ? json.web.results : [];
      return list.map((r) => ({
        title: r.title, url: r.url, snippet: r.description,
        publishedAt: r.page_age || r.age || null,
        sourceName: (r.profile && r.profile.name) || r.meta_url && r.meta_url.hostname || '',
        license: 'UNKNOWN'
      }));
    }
  },

  /** Microsoft Bing Web Search v7（Azure；header Ocp-Apim-Subscription-Key） */
  bing: {
    label: 'Bing Web Search v7（Azure）',
    implemented: true, costBearing: true,
    defaultBaseUrl: 'https://api.bing.microsoft.com', path: '/v7.0/search',
    auth: { style: 'header', name: 'Ocp-Apim-Subscription-Key' },
    docsUrl: 'https://learn.microsoft.com/bing/search-apis/bing-web-search/reference/endpoints',
    build(ctx) {
      const u = new URL(ctx.baseUrl.replace(/\/$/, '') + '/v7.0/search');
      u.searchParams.set('q', ctx.query);
      u.searchParams.set('count', String(ctx.maxResults));
      u.searchParams.set('responseFilter', 'Webpages');
      if (ctx.lang) u.searchParams.set('mkt', ctx.lang === 'zh' ? 'zh-CN' : 'en-US');
      if (ctx.timeRange) u.searchParams.set('freshness', ctx.timeRange);
      return { url: u.toString(), init: { method: 'GET', headers: { Accept: 'application/json' } } };
    },
    parse(json) {
      const list = (json && json.webPages && Array.isArray(json.webPages.value)) ? json.webPages.value : [];
      return list.map((r) => ({
        title: r.name, url: r.url, snippet: r.snippet,
        publishedAt: r.datePublished || null,
        sourceName: r.siteName || '',
        license: 'UNKNOWN'
      }));
    }
  },

  /** Google Programmable Search JSON API（key + cx 均在服务端） */
  google: {
    label: 'Google Programmable Search',
    implemented: true, costBearing: true,
    defaultBaseUrl: 'https://www.googleapis.com', path: '/customsearch/v1',
    auth: { style: 'query', name: 'key' },
    docsUrl: 'https://developers.google.com/custom-search/v1/reference/rest/v1/cse/list',
    build(ctx) {
      const u = new URL(ctx.baseUrl.replace(/\/$/, '') + '/customsearch/v1');
      u.searchParams.set('q', ctx.query);
      u.searchParams.set('num', String(Math.min(ctx.maxResults, 10)));
      u.searchParams.set('cx', ctx.extraCx || '');
      u.searchParams.set('key', ctx.apiKey);
      if (ctx.lang) u.searchParams.set('hl', ctx.lang === 'zh' ? 'zh-CN' : 'en');
      if (ctx.timeRange) u.searchParams.set('dateRestrict', ctx.timeRange);
      return { url: u.toString(), init: { method: 'GET', headers: { Accept: 'application/json' } }, authInQuery: true };
    },
    parse(json) {
      const list = (json && Array.isArray(json.items)) ? json.items : [];
      return list.map((r) => ({
        title: r.title, url: r.link, snippet: r.snippet,
        publishedAt: (r.pagemap && r.pagemap.metatags && r.pagemap.metatags[0]
          && (r.pagemap.metatags[0]['article:published_time'] || r.pagemap.metatags[0].date)) || null,
        sourceName: r.displayLink || '',
        license: 'UNKNOWN'
      }));
    }
  },

  /** Tavily Search API：POST /search（body 携带 api_key） */
  tavily: {
    label: 'Tavily Search API',
    implemented: true, costBearing: true,
    defaultBaseUrl: 'https://api.tavily.com', path: '/search',
    auth: { style: 'body', name: 'api_key' },
    docsUrl: 'https://docs.tavily.com/docs/rest-api/api-reference',
    build(ctx) {
      const url = ctx.baseUrl.replace(/\/$/, '') + '/search';
      const body = {
        api_key: ctx.apiKey,
        query: ctx.query,
        max_results: ctx.maxResults,
        search_depth: ctx.depth === 'DEEP' ? 'advanced' : 'basic',
        include_answer: false
      };
      if (ctx.timeRange) body.topic = 'news';
      return {
        url,
        init: { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) },
        authInBody: true
      };
    },
    parse(json) {
      const list = (json && Array.isArray(json.results)) ? json.results : [];
      return list.map((r) => ({
        title: r.title, url: r.url, snippet: r.content,
        publishedAt: r.published_date || null,
        sourceName: r.source || '',
        license: 'UNKNOWN'
      }));
    }
  }
};

const PROVIDER_IDS = Object.keys(PROVIDERS);

/* ==================== 配置与就绪状态 ==================== */

/** 供应商「就绪状态」取严格定义（执行包 06 §真实Provider判定） */
const READINESS = ['REAL', 'CONFIGURED_NOT_TESTED', 'NOT_CONFIGURED', 'NOT_IMPLEMENTED', 'BLOCKED'];

function wsConfig() {
  const cfg = getMosConfig();
  const w = cfg.websearch || {};
  const r = w.research || {};
  /* V0.1.4：供应商/密钥/端点统一以 provideradmin 为权威（环境变量 > 管理页加密配置 > config.json），
   * 否则「系统接入页保存了 Brave Key」与「检索实际读 config.json」会各读一套而漂移。 */
  let e = null;
  try { e = providerAdmin().effective('websearch'); } catch (_) { e = null; }
  const provider = String((e && e.mode) || w.provider || 'none').trim().toLowerCase() || 'none';
  const apiKey = String((e ? e.apiKey : w.apiKey) || '').trim();
  const baseUrl = String((e ? e.baseUrl : w.baseUrl) || '').trim();
  const cx = String((e ? e.cx : w.cx) || '').trim();
  return {
    provider,
    apiKey,
    baseUrl,
    cx,
    timeoutMs: Number(e && e.timeoutMs) > 0 ? Number(e.timeoutMs) : (Number(w.timeoutMs) > 0 ? Number(w.timeoutMs) : 15000),
    maxResults: Number(e && e.maxResults) > 0 ? Math.min(Number(e.maxResults), 50) : (Number(w.maxResults) > 0 ? Math.min(Number(w.maxResults), 50) : 10),
    maxRetries: Number.isInteger(e && e.maxRetries) ? Math.max(0, Math.min(e.maxRetries, 3)) : (Number.isInteger(w.maxRetries) ? Math.max(0, Math.min(w.maxRetries, 3)) : 1),
    lang: String((e && e.lang) || w.lang || 'en'),
    // 研究文档抓取策略（连接层防护见 source.js）
    research: {
      enabled: r.enabled !== false,
      fetchFullText: r.fetchFullText !== false,
      maxDocs: Number(r.maxDocs) > 0 ? Math.min(Number(r.maxDocs), 20) : 6,
      docTimeoutMs: Number(r.docTimeoutMs) > 0 ? Number(r.docTimeoutMs) : 12000,
      docMaxBytes: Number(r.docMaxBytes) > 0 ? Number(r.docMaxBytes) : 1536 * 1024,
      allowCompressed: r.allowCompressed !== false,
      /** 空数组 = 只做 SSRF（放行任意公网主机）；非空 = 额外主机白名单（更严） */
      allowedHosts: Array.isArray(r.allowedHosts) ? r.allowedHosts.slice() : [],
      /** 正文截断上限（字符），避免把整站灌进模型 */
      excerptChars: Number(r.excerptChars) > 0 ? Number(r.excerptChars) : 4000,
      /** 每份报告最多送入模型的证据条数 */
      maxEvidence: Number(r.maxEvidence) > 0 ? Math.min(Number(r.maxEvidence), 40) : 16
    }
  };
}

/** 从 URL 取主机（脱敏展示用；绝不回传 query 中的密钥） */
function hostOf(raw) {
  try { return new URL(String(raw)).hostname.toLowerCase(); } catch (_) { return ''; }
}

/**
 * 供应商就绪状态（离线、只读配置、零出站、绝不回传密钥）。
 *
 * `configured`（向后兼容）语义 = 已选中**已实现**的供应商且**已提供必需凭据/端点**。
 * `readiness` 为 06 §真实Provider判定的严格取值。
 */
function providerStatus() {
  const w = wsConfig();
  const def = PROVIDERS[w.provider];
  const implemented = !!(def && def.implemented);
  const needsKey = !!(def && def.auth && def.auth.style !== 'header') || !!(def && def.auth && !def.auth.optional);
  const hasKey = !!w.apiKey || !needsKey;
  const baseUrl = w.baseUrl || (def && def.defaultBaseUrl) || '';
  const hasEndpoint = !!baseUrl;

  let readiness = 'NOT_CONFIGURED';
  if (w.provider === 'none' || !def) readiness = 'NOT_CONFIGURED';
  else if (!implemented) readiness = 'NOT_IMPLEMENTED';
  else if (!hasKey || !hasEndpoint) readiness = 'NOT_CONFIGURED';
  else readiness = 'CONFIGURED_NOT_TESTED';
  // REAL 需真实联调证据（由 /api/mos/research/providers 的 probe 结果提升），本函数不擅自声称。

  const configured = readiness === 'CONFIGURED_NOT_TESTED';
  return {
    provider: w.provider,
    label: (def && def.label) || w.provider,
    implemented,
    configured,                       // 向后兼容（既有测试断言 configured===false）
    readiness,
    costBearing: !!(def && def.costBearing),
    hasServerKey: !!w.apiKey,
    endpointHost: hostOf(baseUrl),    // 仅主机名，不含密钥/查询串
    maxResults: w.maxResults,
    timeoutMs: w.timeoutMs,
    maxRetries: w.maxRetries,
    available: PROVIDER_IDS.map((id) => ({
      id, label: PROVIDERS[id].label, implemented: PROVIDERS[id].implemented,
      costBearing: PROVIDERS[id].costBearing, docsUrl: PROVIDERS[id].docsUrl
    })),
    note: readiness === 'NOT_CONFIGURED'
      ? '未配置搜索 Provider（mos.websearch.provider / MOS_WEBSEARCH_PROVIDER）：'
        + 'Web 研究保持 BLOCKED，不伪造结果（配置凭据并获授权后本接口才发起真实搜索）。'
      : (readiness === 'NOT_IMPLEMENTED'
        ? '该供应商适配器尚未实现 → 不发起任何出站，也不假装可选。'
        : '适配器已实现且已配置端点与凭据；**尚未完成真实联调**，故不标记为 REAL。')
  };
}

function isConfigured() { return providerStatus().configured; }

/* ==================== URL 字面校验（快速拒绝层） ==================== */

/**
 * 校验外部 URL 安全性（**字面层**；连接层防护见 research-fetch.js）。
 * 保留既有语义：仅 https、拒绝内网/环回/链路本地/私有/metadata 主机名与字面 IP。
 *
 * 唯一放宽（**仅本地隔离测试**，与 `assertProviderEndpoint` 同一套口径）：
 *   显式开启 `MOS_EGRESS_ALLOW_HTTP=1` + `MOS_EGRESS_ALLOW_LOOPBACK=1` 且**非生产模式**时，
 *   允许 `http://127.0.0.1` / `http://[::1]`。生产模式下这两个开关一律失效（fail closed）。
 * @returns {{ok:boolean, reason?:string, testMode?:boolean}}
 */
function assertSafeUrl(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch (_) { return { ok: false, reason: 'URL 无法解析' }; }
  const prod = /^prod/i.test(String(process.env.NODE_ENV || '').trim()) || process.env.MOS_PRODUCTION === '1';
  const testLoopback = !prod && process.env.MOS_EGRESS_ALLOW_LOOPBACK === '1'
    && process.env.MOS_EGRESS_ALLOW_HTTP === '1'
    && (u.hostname === '127.0.0.1' || u.hostname === '[::1]' || u.hostname === '::1');
  if (u.protocol === 'http:') {
    if (testLoopback) return { ok: true, testMode: true };
    return { ok: false, reason: '仅允许 https（外部抓取）' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: '仅允许 https（外部抓取）' };
  const host = String(u.hostname || '').toLowerCase();
  if (!host) return { ok: false, reason: '缺少主机名' };
  if (u.username || u.password) return { ok: false, reason: 'URL 不得内嵌凭据' };
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || host === 'metadata') return { ok: false, reason: '内网/内部主机名被拒绝' };
  if (testLoopback) return { ok: true, testMode: true };
  // 字面 IPv4 内网段
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const o = host.split('.').map(Number);
    if (o.some((n) => n > 255)) return { ok: false, reason: 'IP 形态非法' };
    if (o[0] === 0 || o[0] === 10 || o[0] === 127 || (o[0] === 169 && o[1] === 254)
      || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168)
      || (o[0] === 100 && o[1] >= 64 && o[1] <= 127) || o[0] >= 224) {
      return { ok: false, reason: '私有/保留 IP 段被拒绝（SSRF 防护）' };
    }
  }
  if (host.startsWith('[')) return { ok: false, reason: 'IPv6 字面量交由连接层校验处理' };
  if (u.port && !['', '443'].includes(String(u.port))) return { ok: false, reason: '仅允许 443 端口' };
  return { ok: true };
}

/** 供应商端点策略：生产仅 https；本地隔离测试允许回环（与 egress 测试开关同一套口径） */
function assertProviderEndpoint(baseUrl) {
  let u;
  try { u = new URL(String(baseUrl)); } catch (_) { return { ok: false, reason: '端点 URL 非法' }; }
  const prod = /^prod/i.test(String(process.env.NODE_ENV || '').trim()) || process.env.MOS_PRODUCTION === '1';
  const testLoopback = !prod && process.env.MOS_EGRESS_ALLOW_LOOPBACK === '1'
    && process.env.MOS_EGRESS_ALLOW_HTTP === '1';
  if (u.protocol === 'https:') return { ok: true };
  if (u.protocol === 'http:' && testLoopback && net.isIP(u.hostname)
    && (u.hostname === '127.0.0.1' || u.hostname === '::1')) {
    return { ok: true, testMode: true };
  }
  return { ok: false, reason: '供应商端点必须为 https（仅本地隔离测试允许回环 http）' };
}

/* ==================== 结果归一化 ==================== */

/** 从 URL 推导发布机构名（供应商未提供时；不猜测、不臆造） */
function deriveSourceName(rawUrl) {
  const h = hostOf(rawUrl);
  return h.replace(/^www\./, '');
}

/**
 * 归一化单条检索结果（**保留真实字段**；缺失一律 null，不填充臆造值）。
 * @returns {{title,url,sourceName,publishedAt,retrievedAt,snippet,license,provider,rank}}
 */
function normalizeItem(raw, ctx, rank) {
  const url = String(raw.url || '').trim();
  const pub = raw.publishedAt ? String(raw.publishedAt) : null;
  return {
    title: String(raw.title || '').trim(),
    url,
    sourceName: String(raw.sourceName || '').trim() || deriveSourceName(url),
    publishedAt: pub,                                   // 未知 → null（UI 显示 Unknown）
    publishedAtKnown: !!pub,
    retrievedAt: ctx.nowIso,
    snippet: String(raw.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 600),
    license: ['PUBLIC', 'UNKNOWN', 'RESTRICTED'].indexOf(String(raw.license || '').toUpperCase()) !== -1
      ? String(raw.license).toUpperCase() : 'UNKNOWN',
    provider: ctx.provider,
    rank: rank + 1,
    ranking: { score: null, position: rank + 1, sourceRankField: null }
  };
}

/* ==================== 真实搜索入口 ==================== */

function traceId(provider, query, at) {
  return 'ws-' + sha256([provider, query, String(at)].join('|')).slice(0, 20);
}

/** 脱敏 trace：只留可核验、不含密钥与完整查询串的字段 */
function sanitizedTrace(o) {
  return {
    traceId: o.traceId, provider: o.provider, method: o.method || 'GET',
    endpointHost: hostOf(o.url), endpointPath: (() => { try { return new URL(o.url).pathname; } catch (_) { return ''; } })(),
    queryLength: o.queryLength, status: o.status === undefined ? null : o.status,
    elapsedMs: o.elapsedMs === undefined ? null : o.elapsedMs,
    responseBytes: o.responseBytes === undefined ? null : o.responseBytes,
    rawCount: o.rawCount === undefined ? null : o.rawCount,
    acceptedCount: o.acceptedCount === undefined ? null : o.acceptedCount,
    rejectedCount: o.rejectedCount === undefined ? null : o.rejectedCount,
    attempts: o.attempts || 1,
    errorCode: o.errorCode || null,
    authRedacted: true,
    note: '查询串与凭据一律不入 trace（仅记录长度与端点主机/路径）。'
  };
}

function blocked(reason, code, w) {
  return {
    ok: false, blocked: true, code: code || 'NOT_CONFIGURED', reason,
    provider: w.provider, results: [], evidence: [],
    trace: sanitizedTrace({ traceId: '', provider: w.provider, url: '', queryLength: 0, status: null, errorCode: code || 'NOT_CONFIGURED' })
  };
}

/**
 * 真实搜索入口 —— 契约 `search(query, filters, budget, abortSignal)`。
 *
 * @param {string|object} query   检索式（也接受旧式对象 `{query, timeWindow, limits}`）
 * @param {object} [filters]      `{ timeWindow:{from,to}, region, industry, depth, lang, maxResults }`
 * @param {object} [budget]       `{ remainingUsd:number|null, perJobUsdMax:number }`
 * @param {AbortSignal} [abortSignal]
 * @returns {Promise<{ok,blocked,code,reason,provider,traceId,results,evidence,trace,cost,rateLimit}>}
 */
async function search(query, filters, budget, abortSignal) {
  const w = wsConfig();
  // 兼容旧调用签名 search({ query, timeWindow, limits })
  const req = (query && typeof query === 'object')
    ? Object.assign({}, query, { query: query.query || query.q })
    : { query, filters, budget, abortSignal };
  const q = String(req.query || '').trim();
  const f = Object.assign({}, (req && typeof req.filters === 'object' && req.filters) || {},
    (req && req.timeWindow) ? { timeWindow: req.timeWindow } : {},
    (req && req.limits) ? { depth: req.limits.depth } : {});
  const bud = (req && req.budget) || budget || {};
  const signal = (req && req.abortSignal) || abortSignal || null;

  const st = providerStatus();
  if (!q) {
    return blocked('缺少检索式（query 不得为空）。', 'MISSING_QUERY', w);
  }
  if (!st.implemented && st.readiness === 'NOT_IMPLEMENTED') {
    return blocked('供应商适配器尚未实现：' + w.provider + '（不发起任何出站，也不假装可选）。', 'NOT_IMPLEMENTED', w);
  }
  if (!st.configured) {
    return blocked('搜索 Provider 未配置（mos.websearch.provider / MOS_WEBSEARCH_API_KEY）。'
      + '系统不会以模型参数或旧知识伪称「今日研究」；配置凭据并获授权后本接口才发起真实搜索。',
    'NOT_CONFIGURED', w);
  }

  const def = PROVIDERS[w.provider];
  const baseUrl = w.baseUrl || def.defaultBaseUrl;
  const ep = assertProviderEndpoint(baseUrl);
  if (!ep.ok) return blocked('供应商端点被拒绝：' + ep.reason, 'ENDPOINT_REJECTED', w);

  // ★ 预算门禁（计费型供应商必须显式配置上限，否则 fail closed —— 执行包 02 §异步工作）
  const perJobMax = Number(bud.perJobUsdMax);
  if (def.costBearing && (!Number.isFinite(perJobMax) || perJobMax <= 0)) {
    return blocked('计费型搜索供应商（' + w.provider + '）未配置预算上限（budget.perJobUsdMax）→ '
      + 'fail closed，不发起付费调用（执行包 02 §预算限额）。', 'BUDGET_EXCEEDED', w);
  }
  /**
   * 单作业预算门禁（执行包 02 §异步工作「按用户/团队/月度预算限额」）。
   * 语义：`remainingUsd === null` 表示**未配置月度上限** → 不做月度判定（改由 perJob 上限把关）；
   *       `remainingUsd === 0` 表示**额度已用尽** → fail closed。
   * 历史坑：`Number(null) === 0`，不显式判空会把"未配置"误判为"已用尽"。
   */
  const remaining = (bud.remainingUsd === null || bud.remainingUsd === undefined || bud.remainingUsd === '')
    ? null : Number(bud.remainingUsd);
  if (remaining !== null && Number.isFinite(remaining) && remaining <= 0) {
    return blocked('本月品牌预算已用尽（remainingUsd<=0）→ 不发起调用（BUDGET_EXCEEDED）。', 'BUDGET_EXCEEDED', w);
  }

  const now = Date.now();
  const ctx = {
    provider: w.provider, query: q, baseUrl, apiKey: w.apiKey, extraCx: w.cx,
    maxResults: Number(f.maxResults) > 0 ? Math.min(Number(f.maxResults), w.maxResults) : w.maxResults,
    lang: f.lang || w.lang, depth: String(f.depth || 'STANDARD').toUpperCase(),
    timeRange: timeRangeOf(f.timeWindow), nowIso: new Date(now).toISOString()
  };
  const tid = traceId(w.provider, q, now);

  const built = def.build(ctx);
  const headers = Object.assign({}, built.init.headers || {});
  if (def.auth && def.auth.style === 'header' && w.apiKey) headers[def.auth.name] = w.apiKey;

  const attempts = w.maxRetries + 1;
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = Date.now();
    try {
      if (signal && signal.aborted) {
        return blocked('研究作业已被取消（调用前中止）。', 'ABORTED', w);
      }
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctrl.abort(), w.timeoutMs);
      let res;
      try {
        res = await require('../provider-http').request(built.url, Object.assign({}, built.init, { headers, signal: ctrl.signal }), w.timeoutMs);
      } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
      }
      const text = await res.text();
      const elapsedMs = Date.now() - started;
      let json = null;
      try { json = JSON.parse(text); } catch (_) { /* 非 JSON：保留原文供诊断 */ }

      if (!res.ok) {
        const code = res.status === 429 ? 'RATE_LIMITED' : (res.status >= 500 ? 'UPSTREAM_ERROR' : 'BAD_REQUEST');
        const errTrace = sanitizedTrace({
          traceId: tid, provider: w.provider, method: built.init.method, url: built.url,
          queryLength: q.length, status: res.status, elapsedMs, responseBytes: text.length, attempts: attempt, errorCode: code
        });
        // 429 / 5xx 可重试；4xx 立即失败
        if ((res.status === 429 || res.status >= 500) && attempt < attempts) {
          lastErr = { code, note: 'HTTP ' + res.status };
          await sleep(300 * attempt);
          continue;
        }
        return {
          ok: false, blocked: false, code, provider: w.provider, traceId: tid, results: [], evidence: [], trace: errTrace,
          rateLimit: parseRateLimit(res.headers),
          reason: '搜索供应商返回失败：HTTP ' + res.status
        };
      }

      const raw = def.parse(json) || [];
      const accepted = [];
      const rejected = [];
      for (const r of raw) {
        const su = assertSafeUrl(r.url);
        if (su.ok) accepted.push(normalizeItem(r, ctx, accepted.length));
        else rejected.push({ url: String(r.url || '').slice(0, 200), reason: su.reason });
      }
      const acceptedTrimmed = accepted.slice(0, ctx.maxResults);
      return {
        ok: true, blocked: false, code: 'OK', provider: w.provider, traceId: tid,
        query: q, filters: { timeWindow: f.timeWindow || null, region: f.region || null, depth: ctx.depth },
        results: acceptedTrimmed,
        rejected,
        evidence: [],
        rateLimit: parseRateLimit(res.headers),
        // 费用：**只记录供应商回执中真实存在的字段**；无回执 → 估算标记 ESTIMATED（绝不假装精确）
        cost: {
          amount: null, currency: '', confirmed: false,
          estimated: true, estimationBasis: 'per-search-request=' + (attempt),
          priceList: null,
          note: '搜索调用费用以供应商账单为准；本侧只记录调用次数，不做单价推算。'
        },
        trace: sanitizedTrace({
          traceId: tid, provider: w.provider, method: built.init.method, url: built.url,
          queryLength: q.length, status: res.status, elapsedMs, responseBytes: text.length,
          rawCount: raw.length, acceptedCount: acceptedTrimmed.length, rejectedCount: rejected.length,
          attempts: attempt
        })
      };
    } catch (err) {
      const aborted = (signal && signal.aborted) || String(err && err.name) === 'AbortError';
      const timeout = !aborted && /abort|timed?\s*out|timeout/i.test(String(err && err.message || ''));
      const code = aborted ? 'ABORTED' : (timeout ? 'TIMEOUT' : 'NETWORK_ERROR');
      if (!aborted && attempt < attempts) { lastErr = { code, note: String(err && err.message || '').slice(0, 120) }; await sleep(300 * attempt); continue; }
      return {
        ok: false, blocked: false, code, provider: w.provider, traceId: tid, results: [], evidence: [],
        reason: aborted ? '研究作业已取消。' : (timeout ? '调用搜索供应商超时（' + w.timeoutMs + 'ms）。' : '调用搜索供应商失败：' + String(err && err.message).slice(0, 200)),
        trace: sanitizedTrace({
          traceId: tid, provider: w.provider, method: built.init.method, url: built.url,
          queryLength: q.length, status: null, elapsedMs: null, attempts: attempt, errorCode: code
        })
      };
    }
  }
  return blocked('搜索失败（已重试 ' + attempts + ' 次）：' + ((lastErr && lastErr.note) || '未知原因'),
    (lastErr && lastErr.code) || 'NETWORK_ERROR', w);
}

/** 时间窗 → 供应商 time_range 取值（SearXNG/Brave/Bing 通用：day|week|month|year） */
function timeRangeOf(timeWindow) {
  if (!timeWindow) return null;
  const from = timeWindow.from ? Date.parse(timeWindow.from) : NaN;
  const to = timeWindow.to ? Date.parse(timeWindow.to) : Date.now();
  if (!Number.isFinite(from)) {
    const days = Number(timeWindow.days);
    if (Number.isFinite(days) && days > 0) return days <= 1 ? 'day' : (days <= 7 ? 'week' : (days <= 31 ? 'month' : 'year'));
    return null;
  }
  const days = Math.max(1, Math.ceil((to - from) / 86400000));
  return days <= 1 ? 'day' : (days <= 7 ? 'week' : (days <= 31 ? 'month' : 'year'));
}

/**
 * 解析限流响应头（只回填供应商**真实提供**的字段；缺失一律 null）。
 */
function parseRateLimit(headers) {
  const get = (k) => {
    if (!headers) return null;
    if (typeof headers.get === 'function') { const v = headers.get(k); return v === undefined ? null : v; }
    const lower = k.toLowerCase();
    for (const key of Object.keys(headers)) if (key.toLowerCase() === lower) return headers[key];
    return null;
  };
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  return {
    limit: num(get('x-ratelimit-limit-requests') || get('x-ratelimit-limit')),
    remaining: num(get('x-ratelimit-remaining-requests') || get('x-ratelimit-remaining')),
    resetAt: get('x-ratelimit-reset-requests') || get('x-ratelimit-reset') || null,
    retryAfterSec: num(get('retry-after'))
  };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * 真实连通性探针（V0.1.4）：用**一次最小检索**验证密钥与端点。
 * 计费型供应商会产生极小费用，因此由管理页二次确认后触发。
 */
async function probe(opts) {
  const o = opts || {};
  const w = wsConfig();
  if (!w.provider || w.provider === 'none') {
    return { state: 'NOT_CONFIGURED', errorCode: 'PROVIDER_NOT_CONFIGURED', note: '尚未配置搜索供应商' };
  }
  const bud = providerAdmin().budget();
  const t0 = Date.now();
  const res = await search({
    query: 'site:bis.org Basel III',
    filters: { timeWindow: 'y' },
    budget: { perJobUsdMax: bud.perJobUsdMax, remainingUsd: null },
    limits: { depth: 'basic' }
  });
  const latencyMs = Date.now() - t0;
  if (res && res.ok && Array.isArray(res.results)) {
    return {
      state: 'SUCCEEDED', latencyMs, resultCount: res.results.length,
      usage: { searchCalls: 1 }, cost: (res.cost || null),
      note: '连通正常（返回 ' + res.results.length + ' 条结果）'
    };
  }
  return {
    state: 'FAILED', latencyMs,
    errorCode: (res && res.errorCode) || 'PROVIDER_NETWORK_ERROR',
    retryable: /RATE_LIMIT|TIMEOUT|NETWORK/.test(String((res && res.errorCode) || '')),
    note: String((res && (res.note || res.error)) || '检索失败').slice(0, 300)
  };
}

module.exports = {
  PROVIDERS, PROVIDER_IDS, READINESS,
  providerStatus, status: providerStatus, isConfigured, wsConfig, probe,
  assertSafeUrl, assertProviderEndpoint, deriveSourceName,
  search, parseRateLimit, timeRangeOf, sanitizedTrace
};
