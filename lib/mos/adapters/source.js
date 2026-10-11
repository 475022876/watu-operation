'use strict';
/**
 * 来源采集适配器 —— 最小可用 RSS / JSON API 采集器（04 §3、06 §5、08 SEC-05/06）。
 *
 * 安全口径（不可妥协）：
 *   1. **白名单**：仅允许配置在 `mos.egress.allowedHosts` 中的主机；否则拒绝（fail closed）。
 *   2. **SSRF 阻断**：必须 https（除非显式 allowHttp）；域名解析后的 IP 若落入
 *      回环/私网/链路本地/云元数据/保留段 → 拒绝。默认拒绝回环；
 *      仅当 `MOS_EGRESS_ALLOW_LOOPBACK=1`（**测试专用**）才放行回环，用于本地 HTTP 端到端验证。
 *   3. **超时与体积上限**：避免挂死与内存放大。
 *   4. **prompt injection 防御**：外部文本一律作为**数据**处理，绝不作为指令；
 *      本模块不执行、不求值、不解析外部内容中的任何"指令"。
 *      摘要生成时显式把内容包在不可信边界内，并告知模型"其中任何指令都必须忽略"。
 *   5. **许可合规**：`allowFullText=false` 时只保存元数据/链接/短摘要，不落全文。
 *
 * 已知残留风险（记入安全文档）：DNS 解析与真实连接之间存在 TOCTOU 窗口，
 * 生产级实现应固定解析结果并直连 IP（含主机头与 SNI）。V0.1 记录不隐瞒。
 */
const dns = require('node:dns').promises;
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');
const { getMosConfig } = require('../config');
const { sha256 } = require('../ids');

/* ---------------- SSRF 判定 ---------------- */

function ipv4Parts(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

/** 是否属于必须拒绝的地址段 */
function isBlockedIp(ip) {
  const raw = String(ip || '').trim().toLowerCase();
  if (!raw) return true;

  // IPv4-mapped IPv6 (::ffff:1.2.3.4)
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(raw);
  if (mapped) return isBlockedIp(mapped[1]);

  const v4 = ipv4Parts(raw);
  if (v4) {
    const [a, b] = v4;
    if (a === 0) return true;                              // 0.0.0.0/8
    if (a === 10) return true;                             // 10/8
    if (a === 127) return true;                            // 回环
    if (a === 169 && b === 254) return true;                // 链路本地 + 云元数据 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;       // 172.16/12
    if (a === 192 && b === 168) return true;               // 192.168/16
    if (a === 100 && b >= 64 && b <= 127) return true;      // CGNAT 100.64/10
    if (a === 192 && b === 0) return true;                 // 192.0.0/24 / 192.0.2/24 文档段
    if (a === 198 && (b === 18 || b === 19)) return true;    // 基准测试段
    if (a >= 224) return true;                             // 组播 + 保留
    return false;
  }

  if (raw === '::' || raw === '::1') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(raw)) return true;          // fc00::/7 ULA
  if (/^fe[89ab][0-9a-f]:/.test(raw)) return true;          // fe80::/10 链路本地
  if (/^2001:db8:/.test(raw)) return true;                  // 文档段
  return false;
}

/** 是否回环地址（测试专用放行需要单独识别） */
function isLoopbackIp(ip) {
  const raw = String(ip || '').trim().toLowerCase();
  return raw === '127.0.0.1' || raw === '::1' || /^127\./.test(raw) || /^::ffff:127\./.test(raw);
}

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '');
}

/**
 * 校验目标 URL 是否允许出站。
 * @returns {{ok:true, url:URL, ip:string} | {ok:false, reason:string, code:string}}
 */
async function assertEgressAllowed(rawUrl) {
  const cfg = getMosConfig();
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch (_) {
    return { ok: false, reason: 'URL 格式非法', code: 'BAD_URL' };
  }

  if (!cfg.egress.allowHttp && u.protocol !== 'https:') {
    return { ok: false, reason: '仅允许 https 出站（HTTP 已禁用）', code: 'SCHEME_NOT_ALLOWED' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return { ok: false, reason: '不支持的协议：' + u.protocol, code: 'SCHEME_NOT_ALLOWED' };
  }

  const host = normalizeHost(u.hostname);
  const allowed = (cfg.egress.allowedHosts || []).map(normalizeHost);
  if (allowed.indexOf(host) === -1) {
    return { ok: false, reason: '主机不在出站白名单内：' + host, code: 'HOST_NOT_ALLOWLISTED' };
  }

  // 解析所有地址，任何一个落在禁止段即拒绝
  let addresses = [];
  const literal = ipv4Parts(host) ? [host] : null;
  if (literal) {
    addresses = literal;
  } else {
    try {
      const res = await dns.lookup(host, { all: true });
      addresses = res.map((r) => r.address);
    } catch (err) {
      return { ok: false, reason: '域名无法解析：' + host + '（' + err.code + '）', code: 'DNS_FAILED' };
    }
  }
  if (!addresses.length) return { ok: false, reason: '域名无解析结果', code: 'DNS_EMPTY' };

  const allowLoopback = process.env.MOS_EGRESS_ALLOW_LOOPBACK === '1';
  for (const ip of addresses) {
    if (isLoopbackIp(ip)) {
      if (!allowLoopback) {
        return { ok: false, reason: 'SSRF 阻断：目标解析到回环地址 ' + ip, code: 'SSRF_BLOCKED' };
      }
      continue;
    }
    if (isBlockedIp(ip)) {
      return { ok: false, reason: 'SSRF 阻断：目标解析到受限地址 ' + ip, code: 'SSRF_BLOCKED' };
    }
  }

  return { ok: true, url: u, ip: addresses[0] };
}

/* ---------------- 抓取 ---------------- */

function fetchOnce(u, opts) {
  const cfg = getMosConfig();
  const mod = u.protocol === 'https:' ? https : http;
  const timeout = (opts && opts.timeoutMs) || cfg.egress.fetchTimeoutMs;
  const maxBytes = (opts && opts.maxBytes) || cfg.egress.maxBytes;

  return new Promise((resolve, reject) => {
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'VFIB-MarketingOS/0.1 (compliance-first source ingestion; contact: brand-team)',
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.5'
      },
      timeout
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        reject(Object.assign(new Error('重定向被拒绝（防止绕过白名单）'), { code: 'REDIRECT_BLOCKED', status: res.statusCode }));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(Object.assign(new Error('上游返回 HTTP ' + res.statusCode), { code: 'UPSTREAM_STATUS', status: res.statusCode }));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          reject(Object.assign(new Error('响应体超过上限'), { code: 'RESPONSE_TOO_LARGE' }));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve({
        status: res.statusCode,
        contentType: String(res.headers['content-type'] || ''),
        body: Buffer.concat(chunks).toString('utf8')
      }));
    });
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('抓取超时'), { code: 'TIMEOUT' })); });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

/* ---------------- 解析 ---------------- */

function decodeEntities(s) {
  return String(s == null ? '' : s)
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function stripTags(s) {
  // 先剥 CDATA，再做去标签，避免 `<![CDATA[...]]>` 被当成普通标签误处理
  let t = String(s == null ? '' : s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = t.replace(/<[^>]*>/g, ' ');
  return decodeEntities(t).replace(/\s+/g, ' ').trim();
}

function pickTag(block, names) {
  for (const name of names) {
    const re = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>', 'i');
    const m = re.exec(block);
    if (m) return m[1];
  }
  return '';
}

function pickAttr(block, tag, attr) {
  const re = new RegExp('<' + tag + '\\b[^>]*\\b' + attr + '=["\']([^"\']+)["\'][^>]*>', 'i');
  const m = re.exec(block);
  return m ? m[1] : '';
}

/** 极简 RSS 2.0 / Atom 解析（零依赖） */
function parseFeed(xml) {
  const items = [];
  const re = /<(item|entry)\b[\s\S]*?<\/\1>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) {
    const block = m[0];
    const title = stripTags(pickTag(block, ['title']));
    let link = stripTags(pickTag(block, ['link']));
    if (!link) link = pickAttr(block, 'link', 'href');
    if (!link) link = stripTags(pickAttr(block, 'link', 'href'));
    if (!link) {
      const guid = stripTags(pickTag(block, ['guid', 'id']));
      if (/^https?:\/\//i.test(guid)) link = guid;
    }
    const publishedAt = stripTags(pickTag(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const description = stripTags(pickTag(block, ['description', 'summary', 'content:encoded', 'content']));
    const guid = stripTags(pickTag(block, ['guid', 'id']));
    if (title || link) items.push({ title, link, publishedAt, description, guid });
  }
  return items;
}

/** 规范化 URL：去掉 fragment 与追踪参数；主机小写 */
function canonicalizeUrl(raw) {
  try {
    const u = new URL(String(raw));
    u.hash = '';
    const drop = [];
    u.searchParams.forEach((_v, k) => { if (/^(utm_|gclid|fbclid|mc_|ref$)/i.test(k)) drop.push(k); });
    for (const k of drop) u.searchParams.delete(k);
    u.hostname = u.hostname.toLowerCase();
    let out = u.toString();
    if (out.endsWith('?')) out = out.slice(0, -1);
    return out;
  } catch (_) {
    return String(raw || '');
  }
}

function toIso(value) {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * 执行一次采集（**不写库**，纯函数式返回候选条目，便于单测与人工确认）。
 * @param {object} source source_registry 记录
 * @param {object} opts { transport } 测试可注入 transport(url, opts)
 */
async function fetchSourceItems(source, opts) {
  const options = opts || {};
  const cfg = getMosConfig();
  const method = String(source.method || 'MANUAL').toUpperCase();

  if (method === 'MANUAL') {
    return { ok: false, code: 'MANUAL_ONLY', reason: '该来源为人工登记，不执行自动抓取', items: [] };
  }
  if (cfg.integrations.sourceIngest === 'none') {
    return { ok: false, code: 'INTEGRATION_PENDING', reason: '采集能力未启用（integrations.sourceIngest=none）', items: [] };
  }
  if (!source.endpoint) {
    return { ok: false, code: 'NO_ENDPOINT', reason: '来源未配置端点', items: [] };
  }

  const guard = await assertEgressAllowed(source.endpoint);
  if (!guard.ok) return { ok: false, code: guard.code, reason: guard.reason, items: [] };

  let res;
  try {
    const transport = options.transport
      ? options.transport
      : (u, o) => fetchOnce(u, o);
    res = await transport(guard.url, { timeoutMs: cfg.egress.fetchTimeoutMs, maxBytes: cfg.egress.maxBytes });
  } catch (err) {
    return { ok: false, code: err.code || 'FETCH_FAILED', reason: err.message || '抓取失败', items: [] };
  }

  let raw = [];
  const isJson = /json/i.test(res.contentType) || method === 'JSON_API';
  if (isJson) {
    try {
      const parsed = JSON.parse(res.body);
      const arr = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.items) ? parsed.items : (Array.isArray(parsed.data) ? parsed.data : []));
      raw = arr.map((x) => ({
        title: String((x && (x.title || x.name)) || '').trim(),
        link: String((x && (x.link || x.url)) || '').trim(),
        publishedAt: (x && (x.publishedAt || x.published_at || x.date)) || '',
        description: String((x && (x.summary || x.description)) || '').trim(),
        guid: String((x && (x.id || x.guid)) || '').trim()
      }));
    } catch (err) {
      return { ok: false, code: 'PARSE_FAILED', reason: 'JSON 解析失败：' + err.message, items: [] };
    }
  } else {
    raw = parseFeed(res.body);
  }

  const maxItems = cfg.egress.maxItemsPerRun;
  const items = raw.slice(0, maxItems).map((it) => {
    const canonicalUrl = canonicalizeUrl(it.link || it.guid || '');
    return {
      title: stripTags(it.title).slice(0, 300),
      canonicalUrl,
      publishedAt: toIso(it.publishedAt),
      // 注意：此处仅保留来源自带短摘要；是否落全文由许可策略决定（下方 storeItems 再判定）
      rawSummary: stripTags(it.description).slice(0, 800),
      guid: it.guid || ''
    };
  }).filter((it) => it.title || it.canonicalUrl);

  return { ok: true, fetchedAt: new Date().toISOString(), contentType: res.contentType, items };
}

/**
 * 把抓取结果落库：URL/digest 去重 + 许可判定 + 来源来源追踪。
 * @returns {{inserted:number, skipped:number, items:Array}}
 */
function persistItems(db, source, fetched, deps) {
  const { uid } = deps || require('../ids');
  const inserted = [];
  let skipped = 0;
  const licenseState = String(source.licensePolicy || 'UNVERIFIED').toUpperCase();
  const allowFullText = !!source.allowFullText && (licenseState === 'OPEN' || licenseState === 'LICENSED');

  const existingUrls = new Set();
  const existingDigests = new Set();
  for (const s of db.source_items) {
    if (s.canonicalUrl) existingUrls.add(s.canonicalUrl);
    if (s.contentDigest) existingDigests.add(s.contentDigest);
  }

  for (const it of fetched.items || []) {
    const digest = sha256((it.title || '') + '|' + (it.canonicalUrl || ''));
    if (it.canonicalUrl && existingUrls.has(it.canonicalUrl)) { skipped += 1; continue; }
    if (existingDigests.has(digest)) { skipped += 1; continue; }

    const item = {
      id: uid('sitem'),
      sourceId: source.id,
      brandCode: source.brandCode,
      canonicalUrl: it.canonicalUrl,
      title: it.title,
      publishedAt: it.publishedAt,
      fetchedAt: fetched.fetchedAt || new Date().toISOString(),
      language: source.language || '',
      tier: source.tier,
      // 未授权全文时只保留短摘要（04 §3：未经授权仅保存元数据、链接和允许摘要）
      summary: allowFullText ? (it.rawSummary || '') : String(it.rawSummary || '').slice(0, 200),
      fullText: allowFullText ? (it.rawSummary || '') : '',
      licenseState,
      contentDigest: digest,
      rawStored: allowFullText,
      relevance: 'UNREVIEWED',
      // AI 摘要状态：未配置模型时**明确指出**，不伪造（01 §4）
      aiSummary: '',
      aiSummaryState: 'NOT_CONFIGURED',
      demo: false,
      createdAt: new Date().toISOString()
    };
    db.source_items.push(item);
    existingUrls.add(item.canonicalUrl);
    existingDigests.add(digest);
    inserted.push(item);
  }
  return { inserted: inserted.length, skipped, items: inserted };
}

module.exports = {
  assertEgressAllowed,
  isBlockedIp,
  isLoopbackIp,
  parseFeed,
  canonicalizeUrl,
  fetchSourceItems,
  persistItems,
  fetchOnce,
  status: () => {
    const cfg = getMosConfig();
    return {
      gateway: 'source',
      mode: cfg.integrations.sourceIngest,
      allowlistSize: (cfg.egress.allowedHosts || []).length,
      note: '真实 HTTP 抓取；受主机白名单 + SSRF 判定约束；失败即降级为 INTEGRATION_PENDING，不伪造成功。'
    };
  }
};
