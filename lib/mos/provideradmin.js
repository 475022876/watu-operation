'use strict';
/**
 * Provider 配置中心（V0.1.4 真实接入 · 人工接入的唯一写入口）。
 *
 * 职责边界：
 *  - **只管配置**：谁能接、接哪家、用哪个模型、密钥是什么、限额多少；
 *  - **不执行调用**：真实调用在 `adapters/{text,image,video,websearch}.js`，本模块只提供
 *    `effective(kind)`（含解密后的密钥，仅在服务端内存中存在）与就绪度判定。
 *
 * 配置优先级（从高到低）：环境变量 → 本模块落库的加密配置（管理页保存）→ config.json → 内置默认。
 * 为什么环境变量最高：部署时可用它锁定供应商（防止有人在页面上把流量切到不符合合规要求的端点）；
 * 被环境变量覆盖的字段会在 `publicView()` 里标 `lockedByEnv:true`，页面据此显示为只读，**不装作可改**。
 *
 * 安全约束：
 *  - 密钥只以 AES-256-GCM 密文落库（`secrets.seal`），**任何返回结构都不含明文**；
 *  - 每次变更写审计 `provider.config.updated`，只记"改了哪些字段"，不记字段值；
 *  - 端点保存时做同步校验（协议/字面内网 IP/元数据主机），调用时再做一次完整解析校验（egress）。
 */
const { getDb, save } = require('./store');
const { getMosConfig } = require('./config');
const { appendAudit } = require('./audit');
const secrets = require('./secrets');
const egress = require('./egress');
const providerlog = require('./providerlog');

/* ==================== 供应商注册表 ==================== */

/**
 * mode 声明：
 *  - `needsKey`  该模式是否必须密钥（searxng 自托管可无密钥）
 *  - `baseUrl`   默认端点（可覆盖）
 *  - `model`     建议模型（**仅为默认值**，实际以供应商控制台可用模型为准，不做可用性承诺）
 *  - `docsUrl`   官方文档，供管理员核对参数（不杜撰参数名）
 *  - `probe`     是否支持低成本的连接测试
 */
const KINDS = {
  text: {
    label: '大语言模型（文本生成）',
    purpose: '研究报告 / 资料总结 / 选题 / 英文文案 / 视频脚本',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    implemented: true,
    modes: {
      none: { label: '未接入', needsKey: false },
      openai: {
        label: 'OpenAI 兼容接口',
        needsKey: true, probe: true,
        defaultBaseUrl: 'https://api.openai.com/v1',
        modelHint: 'gpt-4o-mini',
        docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
        note: '任何 OpenAI 兼容网关（含 Azure OpenAI 代理、vLLM、Ollama、通义/智谱/月之暗面的兼容端点）都可用此项。'
      },
      deepseek: {
        label: 'DeepSeek',
        needsKey: true, probe: true,
        defaultBaseUrl: 'https://api.deepseek.com/v1',
        modelHint: 'deepseek-chat',
        docsUrl: 'https://api-docs.deepseek.com/zh-cn/',
        note: '与 OpenAI 兼容协议；复用同一套调用实现。'
      },
      anthropic: {
        label: 'Anthropic Claude',
        needsKey: true, probe: true,
        defaultBaseUrl: 'https://api.anthropic.com/v1',
        modelHint: 'claude-3-5-sonnet-latest',
        docsUrl: 'https://docs.anthropic.com/en/api/messages',
        note: '使用 Messages 协议（与 OpenAI 不同），已单独实现。'
      },
      mock: {
        label: 'MOCK（演示用，非真实模型）',
        needsKey: false, probe: false,
        note: '确定性抽取式输出，仅用于演示流程；就绪度**永远不是 REAL**。'
      }
    }
  },

  image: {
    label: '图像生成',
    purpose: '配图 / 封面 / 社媒图卡',
    docsUrl: 'https://platform.openai.com/docs/api-reference/images',
    implemented: true,
    modes: {
      none: { label: '未接入', needsKey: false },
      openai: {
        label: 'OpenAI 兼容图像接口',
        needsKey: true, probe: false,
        defaultBaseUrl: 'https://api.openai.com/v1',
        modelHint: 'gpt-image-1',
        docsUrl: 'https://platform.openai.com/docs/api-reference/images',
        note: 'POST /images/generations；支持 b64_json 与 url 两种返回。'
      },
      mock: {
        label: 'MOCK（演示用，非真实模型）',
        needsKey: false, probe: false,
        note: '产出确定性 SVG 并显著标注「非真实模型输出」，就绪度仍是 NOT_CONFIGURED。'
      }
    }
  },

  video: {
    label: '视频生成',
    purpose: '短片成片 / 动态背景',
    docsUrl: 'https://platform.openai.com/docs/api-reference/videos',
    implemented: true,
    modes: {
      none: { label: '未接入（仅手工流程）', needsKey: false },
      openai: {
        label: 'OpenAI Sora 兼容接口',
        needsKey: true, probe: false,
        defaultBaseUrl: 'https://api.openai.com/v1',
        modelHint: 'sora-2',
        docsUrl: 'https://platform.openai.com/docs/api-reference/videos',
        note: '异步任务：POST /videos → GET /videos/{id} → GET /videos/{id}/content。'
      },
      volcengine: {
        label: '火山方舟 Seedance（异步任务）',
        needsKey: true, probe: false,
        defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
        modelHint: 'doubao-seedance-2-0-mini',
        docsUrl: 'https://www.volcengine.com/docs/82379/1520757',
        note: '异步任务：POST /contents/generations/tasks → GET 同路径/{id} → 从 content.video_url 下载（URL 24 小时有效）。'
      },
      generic: {
        label: '通用异步任务端点（自定义）',
        needsKey: true, probe: false,
        defaultBaseUrl: '',
        modelHint: '',
        docsUrl: '',
        note: '适用于自建/私有化视频服务：需自行填写创建/查询/下载三个路径模板，占位符 {id}。'
      }
    }
  },

  websearch: {
    label: '网页检索',
    purpose: '权威官方信息检索与全文抓取',
    docsUrl: 'https://docs.searxng.org/dev/search_api.html',
    implemented: true,
    modes: {
      none: { label: '未接入', needsKey: false },
      searxng: {
        label: 'SearXNG（自托管元搜索）',
        needsKey: false, probe: true,
        defaultBaseUrl: '',
        modelHint: '',
        docsUrl: 'https://docs.searxng.org/dev/search_api.html',
        note: '无按次费用；需自建实例并开启 JSON 输出（search.formats: [json]）。'
      },
      brave: {
        label: 'Brave Search API',
        needsKey: true, probe: true, costBearing: true,
        defaultBaseUrl: 'https://api.search.brave.com',
        docsUrl: 'https://api-dashboard.search.brave.com/app/documentation/web-search'
      },
      bing: {
        label: 'Microsoft Bing Web Search',
        needsKey: true, probe: true, costBearing: true,
        defaultBaseUrl: 'https://api.bing.microsoft.com',
        docsUrl: 'https://learn.microsoft.com/bing/search-apis/bing-web-search/'
      },
      google: {
        label: 'Google Programmable Search',
        needsKey: true, probe: true, costBearing: true,
        defaultBaseUrl: 'https://www.googleapis.com',
        docsUrl: 'https://developers.google.com/custom-search/v1/overview',
        note: '除 API Key 外还需填写搜索引擎 ID（cx）。'
      },
      tavily: {
        label: 'Tavily Search API',
        needsKey: true, probe: true, costBearing: true,
        defaultBaseUrl: 'https://api.tavily.com',
        docsUrl: 'https://docs.tavily.com/documentation/api-reference'
      }
    }
  }
};

const KIND_IDS = Object.keys(KINDS);

/** 各 kind 对应 config.json / 环境变量的字段名 */
const FILE_MAP = {
  text: { integrations: 'textProvider', section: 'text', env: 'MOS_TEXT' },
  image: { integrations: 'imageProvider', section: 'image', env: 'MOS_IMAGE' },
  video: { integrations: 'videoProvider', section: 'video', env: 'MOS_VIDEO' },
  websearch: { integrations: null, section: 'websearch', env: 'MOS_WEBSEARCH' }
};

const LIMITS = {
  timeoutMs: { min: 1000, max: 300000 },
  maxRetries: { min: 0, max: 3 },
  maxTokens: { min: 64, max: 32000 },
  temperature: { min: 0, max: 2 },
  maxResults: { min: 1, max: 50 },
  pollIntervalMs: { min: 1000, max: 60000 },
  maxPollMs: { min: 5000, max: 1800000 },
  durationSec: { min: 1, max: 60 }
};

/* ==================== 存取 ==================== */

function settings() {
  const db = getDb();
  if (!db.settings || typeof db.settings !== 'object') db.settings = {};
  if (!db.settings.providers || typeof db.settings.providers !== 'object') db.settings.providers = {};
  return db.settings;
}

function storedOf(kind) {
  return settings().providers[kind] || {};
}

function envOf(kind) {
  const p = FILE_MAP[kind].env;
  const get = (n) => {
    const v = process.env[p + '_' + n];
    return v === undefined ? undefined : String(v).trim();
  };
  return {
    mode: get('PROVIDER'),
    apiKey: get('API_KEY'),
    baseUrl: get('BASE_URL'),
    model: get('MODEL'),
    timeoutMs: get('TIMEOUT_MS'),
    maxRetries: get('MAX_RETRIES')
  };
}

function fileOf(kind) {
  const cfg = getMosConfig();
  const fm = FILE_MAP[kind];
  const sec = cfg[fm.section] || {};
  const mode = fm.integrations ? cfg.integrations[fm.integrations] : sec.provider;
  return {
    mode: String(mode || 'none').toLowerCase(),
    apiKey: String(sec.apiKey || '').trim() || '',
    baseUrl: String(sec.baseUrl || '').trim(),
    model: String(sec.model || '').trim(),
    timeoutMs: sec.timeoutMs,
    maxRetries: sec.maxRetries,
    maxResults: sec.maxResults,
    cx: sec.cx,
    lang: sec.lang
  };
}

/**
 * 生效配置（**含解密后的密钥**，只在服务端使用；绝不返回给前端）。
 * @returns {{kind, mode, baseUrl, model, timeoutMs, maxRetries, apiKey, hasKey, keyMask, keyFingerprint,
 *            keySource, lockedByEnv, maxResults, cx, lang, pricePerMTokIn, pricePerMTokOut, note}}
 */
function effective(kind) {
  if (KIND_IDS.indexOf(kind) === -1) throw new Error('未知的 provider kind：' + kind);
  const def = KINDS[kind];
  const st = storedOf(kind);
  const env = envOf(kind);
  const file = fileOf(kind);
  const locked = {};

  const pick = (field, envVal, storedVal, fileVal, dflt) => {
    if (envVal !== undefined && envVal !== '') { locked[field] = true; return envVal; }
    if (storedVal !== undefined && storedVal !== null && storedVal !== '') return storedVal;
    if (fileVal !== undefined && fileVal !== null && fileVal !== '') return fileVal;
    return dflt;
  };

  const mode = String(pick('mode', env.mode, st.mode, file.mode, 'none') || 'none').toLowerCase();
  const baseUrl = String(pick('baseUrl', env.baseUrl, st.baseUrl, file.baseUrl, '') || '');
  const model = String(pick('model', env.model, st.model, file.model, '') || '');
  let timeoutMs = Number(pick('timeoutMs', env.timeoutMs, st.timeoutMs, file.timeoutMs, 30000));
  if (!Number.isFinite(timeoutMs)) timeoutMs = 30000;
  let maxRetries = Number(pick('maxRetries', env.maxRetries, st.maxRetries, file.maxRetries, 1));
  if (!Number.isFinite(maxRetries)) maxRetries = 1;

  /* 密钥：环境变量 > 库内密文 > config.json 明文（历史兼容，只读） */
  let apiKey = '';
  let keySource = '';
  let keyError = '';
  if (env.apiKey) { apiKey = env.apiKey; keySource = 'env'; locked.apiKey = true; }
  else if (secrets.isSealed(st.apiKey)) {
    try { apiKey = secrets.open(st.apiKey); keySource = 'db'; }
    catch (err) { keyError = String((err && err.message) || err); keySource = 'db-broken'; }
  } else if (file.apiKey) { apiKey = file.apiKey; keySource = 'file'; }

  const modeDef = def.modes[mode] || {};
  return {
    kind,
    mode,
    implemented: !!def.implemented && !!def.modes[mode],
    baseUrl,
    model,
    timeoutMs,
    maxRetries,
    maxResults: Number(pick('maxResults', undefined, st.maxResults, file.maxResults, 10)) || 10,
    cx: String(pick('cx', undefined, st.cx, file.cx, '') || ''),
    lang: String(pick('lang', undefined, st.lang, file.lang, 'en') || 'en'),
    maxTokens: Number(st.maxTokens || 1200),
    temperature: st.temperature === undefined ? 0.3 : Number(st.temperature),
    pollIntervalMs: Number(st.pollIntervalMs || 5000),
    maxPollMs: Number(st.maxPollMs || 600000),
    durationSec: Number(st.durationSec || 4),
    /* 视频三步的路径模板：必须出现在 effective 里，否则 adapter 的 pathOf() 永远读不到
     * 用户在页面上填的自定义值（generic 模式曾因此完全失效）。 */
    createPath: String(pick('createPath', undefined, st.createPath, file.createPath, '') || ''),
    statusPath: String(pick('statusPath', undefined, st.statusPath, file.statusPath, '') || ''),
    contentPath: String(pick('contentPath', undefined, st.contentPath, file.contentPath, '') || ''),
    pricePerMTokIn: Number(st.pricePerMTokIn || 0),
    pricePerMTokOut: Number(st.pricePerMTokOut || 0),
    apiKey,
    hasKey: !!apiKey,
    keySource,
    keyError,
    keyMask: apiKey ? secrets.mask(apiKey) : '',
    keyFingerprint: apiKey ? secrets.fingerprint(apiKey) : '',
    needsKey: !!modeDef.needsKey,
    costBearing: !!modeDef.costBearing,
    lockedByEnv: locked,
    note: modeDef.note || ''
  };
}

/** 就绪度（执行包 06 §真实Provider判定口径，不新增含糊档位） */
function readinessOf(kind) {
  const def = KINDS[kind];
  if (!def || !def.implemented) return { readiness: 'NOT_IMPLEMENTED', reason: '适配器未实现' };
  const e = effective(kind);
  if (!def.modes[e.mode]) return { readiness: 'NOT_IMPLEMENTED', reason: '未知模式：' + e.mode };
  if (e.mode === 'none') return { readiness: 'NOT_CONFIGURED', reason: '尚未选择供应商' };
  if (e.mode === 'mock') return { readiness: 'NOT_CONFIGURED', reason: 'MOCK 为本地模拟，不是真实模型能力', simulated: true };
  if (e.keyError) return { readiness: 'NOT_CONFIGURED', reason: e.keyError };
  if (e.needsKey && !e.hasKey) return { readiness: 'NOT_CONFIGURED', reason: '已选择供应商但未配置密钥' };
  const ev = providerlog.successEvidence(kind, { fingerprint: e.keyFingerprint });
  if (ev) return { readiness: 'REAL', reason: '已有真实成功调用证据', evidence: ev };
  return { readiness: 'CONFIGURED_NOT_TESTED', reason: '已配置凭据，尚无真实成功调用证据' };
}

/** 对外视图：**绝不含密钥** */
function publicView(kind) {
  const def = KINDS[kind];
  const e = effective(kind);
  const rd = readinessOf(kind);
  const st = storedOf(kind);
  return {
    kind,
    label: def.label,
    purpose: def.purpose,
    docsUrl: def.docsUrl,
    implemented: !!def.implemented,
    mode: e.mode,
    modes: Object.keys(def.modes).map((m) => ({
      id: m,
      label: def.modes[m].label,
      needsKey: !!def.modes[m].needsKey,
      probe: !!def.modes[m].probe,
      costBearing: !!def.modes[m].costBearing,
      defaultBaseUrl: def.modes[m].defaultBaseUrl || '',
      modelHint: def.modes[m].modelHint || '',
      docsUrl: def.modes[m].docsUrl || def.docsUrl || '',
      note: def.modes[m].note || ''
    })),
    baseUrl: e.baseUrl,
    model: e.model,
    timeoutMs: e.timeoutMs,
    maxRetries: e.maxRetries,
    maxResults: e.maxResults,
    cx: e.cx,
    lang: e.lang,
    maxTokens: e.maxTokens,
    temperature: e.temperature,
    pollIntervalMs: e.pollIntervalMs,
    maxPollMs: e.maxPollMs,
    durationSec: e.durationSec,
    pricePerMTokIn: e.pricePerMTokIn,
    pricePerMTokOut: e.pricePerMTokOut,
    hasKey: e.hasKey,
    keyMask: e.keyMask,
    keyFingerprint: e.keyFingerprint,
    keySource: e.keySource,
    keyError: e.keyError,
    needsKey: e.needsKey,
    readiness: rd.readiness,
    readinessReason: rd.reason,
    readinessEvidence: rd.evidence || null,
    simulated: !!rd.simulated,
    lockedByEnv: e.lockedByEnv,
    updatedAt: st.updatedAt || '',
    updatedBy: st.updatedBy || ''
  };
}

function publicViewAll() {
  return {
    kinds: KIND_IDS.map(publicView),
    budget: budget(),
    dataPolicy: policy(),
    secrets: secrets.status(),
    egress: egress.describe()
  };
}

/* ==================== 校验 ==================== */

function badInput(message, code) {
  const e = new Error(message);
  e.code = code || 'BAD_PROVIDER_CONFIG';
  e.status = 400;
  return e;
}

function clampInt(v, key, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  const lim = LIMITS[key];
  if (!lim) return Math.floor(n);
  return Math.min(Math.max(Math.floor(n), lim.min), lim.max);
}

/** 同步端点校验（保存时用；DNS 解析级校验在调用时由 egress.assertProviderUrl 再做一次） */
function validateEndpoint(rawUrl) {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  let u;
  try { u = new URL(s); } catch (_) { throw badInput('端点不是合法 URL：' + s.slice(0, 80), 'BAD_BASE_URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw badInput('端点只允许 http(s) 协议', 'BAD_BASE_URL');
  if (u.username || u.password) throw badInput('端点 URL 不允许内嵌账号口令（密钥请填在密钥栏）', 'BAD_BASE_URL');
  const host = u.hostname.toLowerCase();
  if (egress.isIpLiteral(host)) {
    const { isBlockedIp } = require('./adapters/source');
    if (isBlockedIp(host) && !/^(127\.0\.0\.1|::1)$/.test(host)) {
      throw badInput('端点不能指向内网/保留地址：' + host, 'BAD_BASE_URL');
    }
  }
  if (/^(metadata|instance-data)(\.|$)/.test(host) || host === '169.254.169.254') {
    throw badInput('端点不能指向云元数据服务', 'BAD_BASE_URL');
  }
  return s.replace(/\/+$/, '');
}

/* ==================== 写入 ==================== */

function pickFields(kind, body) {
  const allowed = ['mode', 'baseUrl', 'model', 'timeoutMs', 'maxRetries',
    'maxResults', 'cx', 'lang', 'maxTokens', 'temperature',
    'pollIntervalMs', 'maxPollMs', 'durationSec', 'pricePerMTokIn', 'pricePerMTokOut',
    'createPath', 'statusPath', 'contentPath'];
  const out = {};
  for (const k of allowed) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

/**
 * 保存配置。密钥单独处理：传入非空字符串即替换；`clearKey:true` 删除。
 * @returns {object} publicView(kind)
 */
function update(kind, body, actor) {
  if (KIND_IDS.indexOf(kind) === -1) throw badInput('未知的 provider kind：' + kind);
  const def = KINDS[kind];
  const b = body || {};
  const st = settings();
  const cur = Object.assign({}, st.providers[kind] || {});
  const changed = [];

  if (b.mode !== undefined) {
    const m = String(b.mode || 'none').toLowerCase();
    if (!def.modes[m]) throw badInput('该供应商不支持的接入方式：' + m, 'BAD_MODE');
    if (cur.mode !== m) changed.push('mode');
    cur.mode = m;
  }

  if (b.baseUrl !== undefined) {
    const v = validateEndpoint(b.baseUrl);
    if ((cur.baseUrl || '') !== v) changed.push('baseUrl');
    cur.baseUrl = v;
  }
  if (b.model !== undefined) {
    const v = String(b.model || '').trim().slice(0, 120);
    if (/[\s]/.test(v) && v) throw badInput('模型名不能包含空白字符', 'BAD_MODEL');
    if ((cur.model || '') !== v) changed.push('model');
    cur.model = v;
  }

  const numeric = {
    timeoutMs: 'timeoutMs', maxRetries: 'maxRetries', maxResults: 'maxResults',
    maxTokens: 'maxTokens', pollIntervalMs: 'pollIntervalMs', maxPollMs: 'maxPollMs', durationSec: 'durationSec'
  };
  for (const k of Object.keys(numeric)) {
    if (b[k] === undefined) continue;
    const v = clampInt(b[k], numeric[k], cur[k]);
    if (cur[k] !== v) changed.push(k);
    cur[k] = v;
  }
  if (b.temperature !== undefined) {
    const t = Math.min(Math.max(Number(b.temperature) || 0, LIMITS.temperature.min), LIMITS.temperature.max);
    if (cur.temperature !== t) changed.push('temperature');
    cur.temperature = t;
  }
  for (const k of ['pricePerMTokIn', 'pricePerMTokOut']) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0) throw badInput('单价必须是非负数（USD / 百万 token）', 'BAD_PRICE');
    if (cur[k] !== n) changed.push(k);
    cur[k] = n;
  }
  for (const k of ['cx', 'lang', 'createPath', 'statusPath', 'contentPath']) {
    if (b[k] === undefined) continue;
    const v = String(b[k] || '').trim().slice(0, 200);
    if (cur[k] !== v) changed.push(k);
    cur[k] = v;
  }

  /* 密钥 */
  if (b.clearKey === true) {
    cur.apiKey = null; cur.keyMask = ''; cur.keyFingerprint = ''; cur.keyUpdatedAt = '';
    changed.push('apiKey:cleared');
  } else if (typeof b.apiKey === 'string' && b.apiKey.trim()) {
    const raw = b.apiKey.trim();
    if (raw.length < 8) throw badInput('密钥长度过短（至少 8 个字符）', 'BAD_API_KEY');
    if (/^(sk-)?x{4,}$/i.test(raw)) throw badInput('密钥看起来是占位符，请填入真实密钥', 'BAD_API_KEY');
    cur.apiKey = secrets.seal(raw);
    cur.keyMask = secrets.mask(raw);
    cur.keyFingerprint = secrets.fingerprint(raw);
    cur.keyUpdatedAt = new Date().toISOString();
    changed.push('apiKey:set');
  }

  /* 必填性：选中真实供应商却没端点/模型时给出**警告**而非拒绝（部分供应商端点就是默认值） */
  const modeDef = def.modes[cur.mode || 'none'] || {};
  if (modeDef.needsKey && !cur.apiKey && !cur.keyMask) {
    /* 允许先保存模式、后补密钥：readiness 会保持 NOT_CONFIGURED，不会伪造可用 */
  }

  cur.updatedAt = new Date().toISOString();
  cur.updatedBy = actor ? (actor.username || actor.id || '') : '';
  st.providers[kind] = cur;
  save();

  appendAudit({
    actorId: actor ? actor.id : '',
    brandCode: '',
    eventType: 'provider.config.updated',
    objectType: 'provider',
    objectId: kind,
    outcome: 'success',
    metadata: {
      kind,
      changes: changed,
      mode: cur.mode,
      baseUrlHost: cur.baseUrl ? (() => { try { return new URL(cur.baseUrl).host; } catch (_) { return ''; } })() : '',
      model: cur.model || '',
      keyFingerprint: cur.keyFingerprint || ''
    }
  });

  return publicView(kind);
}

/* ==================== 预算 ==================== */

function budget() {
  const st = settings();
  const cfg = getMosConfig();
  const b = st.providerBudget || {};
  return {
    brandMonthlyUsd: b.brandMonthlyUsd !== undefined ? Number(b.brandMonthlyUsd) : Number((cfg.budget && cfg.budget.brandMonthlyUsd) || 0),
    perJobUsdMax: b.perJobUsdMax !== undefined ? Number(b.perJobUsdMax) : Number((cfg.budget && cfg.budget.perJobUsdMax) || 0),
    currency: 'USD',
    note: '0 表示不设上限。上限用于**事前拦截**（按配置单价估算）与**事后核对**（只用供应商回执）。'
  };
}

function updateBudget(body, actor) {
  const b = body || {};
  const st = settings();
  const cur = Object.assign({}, st.providerBudget || {});
  for (const k of ['brandMonthlyUsd', 'perJobUsdMax']) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isFinite(n) || n < 0) throw badInput('预算必须是非负数（USD）', 'BAD_BUDGET');
    /* 保留 6 位小数：单次上限可以小到 0.000001 美元（测试与极小额度场景），
     * 用 toFixed(4) 会把它抹成 0，等于"静默取消限额"——不允许。 */
    cur[k] = Number(n.toFixed(6));
  }
  cur.updatedAt = new Date().toISOString();
  cur.updatedBy = actor ? (actor.username || actor.id || '') : '';
  st.providerBudget = cur;
  save();
  appendAudit({
    actorId: actor ? actor.id : '', brandCode: '', eventType: 'provider.budget.updated',
    objectType: 'budget', objectId: 'provider', outcome: 'success',
    metadata: { brandMonthlyUsd: cur.brandMonthlyUsd, perJobUsdMax: cur.perJobUsdMax }
  });
  return budget();
}

/** 已确认花费（当月，按品牌） */
function monthSpend(brandCode) {
  const since = new Date();
  since.setDate(1); since.setHours(0, 0, 0, 0);
  const s = providerlog.summarize({ days: 31, brandCode });
  return Number(s.cost.confirmedSum || 0);
}

/**
 * 预算闸门（调用前）。
 * @param {{kind:string, estimateUsd?:number, brandCode?:string}} o
 * @returns {{ok:boolean, code?:string, note?:string, estimateUsd?:number}}
 */
function checkBudget(o) {
  const b = budget();
  const est = Number(o && o.estimateUsd);
  if (b.perJobUsdMax > 0 && Number.isFinite(est) && est > b.perJobUsdMax) {
    return { ok: false, code: 'PROVIDER_BUDGET_EXCEEDED',
      note: '单次预估费用 $' + est.toFixed(4) + ' 超过上限 $' + b.perJobUsdMax + '（可在系统接入页调整）', estimateUsd: est };
  }
  if (b.brandMonthlyUsd > 0) {
    const spent = monthSpend(o && o.brandCode);
    const next = spent + (Number.isFinite(est) ? est : 0);
    if (next > b.brandMonthlyUsd) {
      return { ok: false, code: 'PROVIDER_BUDGET_EXCEEDED',
        note: '本月已发生 $' + spent.toFixed(4) + '，本次预估后 $' + next.toFixed(4) + ' 超过月度上限 $' + b.brandMonthlyUsd,
        estimateUsd: est };
    }
  }
  return { ok: true, estimateUsd: Number.isFinite(est) ? est : null };
}

/** 粗略费用估算（仅在管理员配置了单价时可用；否则返回 null，绝不凭空推算） */
function estimateCost(kind, o) {
  const e = effective(kind);
  const x = o || {};
  if (!e.pricePerMTokIn && !e.pricePerMTokOut) return null;
  const promptTokens = Number(x.promptTokens) || Math.ceil((Number(x.promptChars) || 0) / 3.2);
  const outTokens = Number(x.completionTokens) || Number(x.maxTokens) || 800;
  return (promptTokens / 1e6) * (e.pricePerMTokIn || 0)
    + (outTokens / 1e6) * (e.pricePerMTokOut || 0);
}

/* ==================== 数据外发策略 ==================== */

function policy() {
  const st = settings();
  const p = st.egressPolicy || {};
  const eff = egress.dataPolicy(p);
  return {
    allowConfidential: !!eff.allowConfidential,
    allowRestricted: !!(eff.allowRestricted && eff.acknowledgedBy),
    allowRestrictedRaw: !!eff.allowRestricted,
    acknowledgedBy: eff.acknowledgedBy || '',
    updatedAt: p.updatedAt || '',
    note: '默认全部关闭：判定为机密/受限的内容不会发送到任何外部服务。开启即视为该部署的合规责任人已确认。'
  };
}

function updatePolicy(body, actor) {
  const b = body || {};
  const st = settings();
  const cur = Object.assign({}, st.egressPolicy || {});
  if (b.allowConfidential !== undefined) cur.allowConfidential = !!b.allowConfidential;
  if (b.allowRestricted !== undefined) {
    cur.allowRestricted = !!b.allowRestricted;
    if (cur.allowRestricted && !b.acknowledgedBy && !cur.acknowledgedBy) {
      throw badInput('开启受限数据外发必须同时填写确认人（将记入审计）', 'ACK_REQUIRED');
    }
  }
  if (b.acknowledgedBy !== undefined) cur.acknowledgedBy = String(b.acknowledgedBy || '').slice(0, 80);
  cur.updatedAt = new Date().toISOString();
  st.egressPolicy = cur;
  save();
  appendAudit({
    actorId: actor ? actor.id : '', brandCode: '', eventType: 'egress.policy.updated',
    objectType: 'egress', objectId: 'dataPolicy', outcome: 'success',
    metadata: { allowConfidential: !!cur.allowConfidential, allowRestricted: !!cur.allowRestricted, acknowledgedBy: cur.acknowledgedBy || '' }
  });
  return policy();
}

/* ==================== 连接测试（真实调用，计费风险由页面二次确认） ==================== */

const TEST_MIN_INTERVAL_MS = 8000;

/**
 * 真实连接测试：用**最小请求**验证凭据与模型可用。
 * 注意：这是真实出站调用，可能产生费用；页面上必须二次确认。
 */
async function test(kind, actor) {
  if (KIND_IDS.indexOf(kind) === -1) throw badInput('未知的 provider kind：' + kind);
  const st = settings();
  if (!st.providerTestAt) st.providerTestAt = {};
  const last = Date.parse(st.providerTestAt[kind] || '') || 0;
  if (Date.now() - last < TEST_MIN_INTERVAL_MS) {
    throw badInput('连接测试过于频繁，请 ' + Math.ceil((TEST_MIN_INTERVAL_MS - (Date.now() - last)) / 1000) + ' 秒后再试', 'TEST_TOO_FREQUENT');
  }
  st.providerTestAt[kind] = new Date().toISOString();
  save();

  const e = effective(kind);
  const modeDef = (KINDS[kind].modes[e.mode] || {});
  if (!modeDef.probe) {
    return {
      ok: false, supported: false, kind, mode: e.mode,
      code: 'NO_PROBE_SUPPORTED',
      message: '该接入方式没有低成本探针：真实调用会生成内容并计费，请在制作页用一条真实任务验证。'
    };
  }
  const budgetCheck = checkBudget({ kind, estimateUsd: 0 });
  if (!budgetCheck.ok) return { ok: false, supported: true, kind, code: budgetCheck.code, message: budgetCheck.note };

  const t0 = Date.now();
  let result;
  try {
    if (kind === 'text') result = await require('./adapters/text').probe({ actorId: actor && actor.id });
    else if (kind === 'websearch') result = await require('./adapters/websearch').probe({ actorId: actor && actor.id });
    else result = { state: 'UNSUPPORTED', note: '无探针' };
  } catch (err) {
    result = { state: 'FAILED', errorCode: err && err.code, note: String((err && err.message) || err) };
  }
  const latencyMs = Date.now() - t0;
  const ok = result && (result.state === 'SUCCEEDED' || result.state === 'HEALTHY');

  providerlog.record({
    kind, op: 'probe', provider: e.mode, model: e.model,
    state: ok ? 'SUCCEEDED' : 'FAILED',
    errorCode: result && result.errorCode, retryable: !!(result && result.retryable),
    httpStatus: result && result.httpStatus, latencyMs, attempts: 1,
    usage: (result && result.usage) || {}, cost: (result && result.cost) || {},
    actorId: actor && actor.id, dataClass: 'PUBLIC',
    note: 'kf=' + (e.keyFingerprint || '') + ' ' + ((result && result.note) || '')
  });

  appendAudit({
    actorId: actor ? actor.id : '', brandCode: '', eventType: 'provider.test.' + (ok ? 'ok' : 'failed'),
    objectType: 'provider', objectId: kind, outcome: ok ? 'success' : 'failed',
    metadata: { mode: e.mode, model: e.model, latencyMs, code: (result && result.errorCode) || '' }
  });

  return {
    ok, supported: true, kind, mode: e.mode, model: e.model,
    latencyMs,
    code: (result && result.errorCode) || '',
    message: (result && result.note) || '',
    usage: (result && result.usage) || {},
    readiness: readinessOf(kind).readiness
  };
}

/** 用量与健康 */
function usage(opts) {
  const o = opts || {};
  return {
    summary: providerlog.summarize(o),
    recent: providerlog.list({ limit: o.limit || 30, kind: o.kind, brandCode: o.brandCode }),
    budget: budget(),
    monthSpend: monthSpend(o.brandCode)
  };
}

module.exports = {
  KINDS, KIND_IDS, LIMITS,
  effective, readinessOf, publicView, publicViewAll,
  update, budget, updateBudget, checkBudget, estimateCost, monthSpend,
  policy, updatePolicy, test, usage,
  validateEndpoint
};
