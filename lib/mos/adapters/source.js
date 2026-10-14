'use strict';
/**
 * 来源采集适配器 —— 最小可用 RSS / JSON API 采集器（04 §3、06 §5、08 SEC-05/06）。
 *
 * 安全口径（不可妥协；整改 F-01 已消除原 TOCTOU 窗口）：
 *   1. **白名单**：仅允许配置在 `mos.egress.allowedHosts` 中的主机；否则拒绝（fail closed）。
 *   2. **协议与端口**：默认 https-only；生产只允许 `egress.allowedPorts`（默认 443）。
 *      本地端到端验证需显式 `MOS_EGRESS_ALLOW_HTTP=1`（**生产环境一律拒绝启用**）。
 *   3. **URL 形态**：拒绝内嵌凭据（`https://user:pass@host/`）等非标准形态。
 *   4. **SSRF 阻断**：解析后的**全部**地址若落入 回环/私网/链路本地/云元数据/保留段 → 拒绝。
 *      默认拒绝回环；仅当 `MOS_EGRESS_ALLOW_LOOPBACK=1` 且**非生产模式**才放行（测试专用）。
 *   5. **校验与连接绑定（原 TOCTOU 已修复）**：校验得到的 IP 通过 `lookup` 回调
 *      **固定绑定**到本次连接，DNS 重绑定无法把连接指向未校验地址；
 *      同时保留原始 Host 头与 TLS SNI（servername），不破坏证书校验。
 *   6. **跳转逐跳校验**：最多 `egress.maxRedirects` 跳，**每一跳都重新执行**白名单/SSRF/协议/端口校验，
 *      任一跳不合规即整体拒绝；不接受跨主机隐式跳转。
 *   7. **超时与体积上限**：限制耗时；以 **`Accept-Encoding: identity`** 请求，若上游仍返回
 *      非 identity 编码则拒绝（杜绝 gzip 解压膨胀面）；体积按未压缩字节计。
 *   8. **prompt injection 防御**：外部文本一律作为**数据**处理，绝不作为指令；
 *      本模块不执行、不求值、不解析外部内容中的任何"指令"。
 *      摘要生成时显式把内容包在不可信边界内，并告知模型"其中任何指令都必须忽略"。
 *   9. **许可合规**：`allowFullText=false` 时只保存元数据/链接/短摘要，不落全文。
 *  10. **代理**：本模块**不读取** `HTTP_PROXY/HTTPS_PROXY`，不挂任何代理 agent —— 出站按已校验 IP 直连。
 *
 * V0.1.3 Phase B 增量（**只增不改**）：`assertEgressAllowed(rawUrl, opts)` 新增可选 `opts`，
 *   供 **研究抓取**（`research-fetch.js`）复用同一套连接层防护 —— 研究域主机来自检索结果，
 *   不可能预先列入采集白名单，故允许 `opts.allowAnyPublicHost=true` 跳过**主机白名单**；
 *   但 **SSRF 判定 / 协议 / 端口 / 凭据 / 逐跳校验 / 已校验 IP 绑定连接 / 体积与超时上限
 *   一条都不放松**。不传 `opts` 时行为与既有采集路径**完全一致**（fail closed 白名单）。
 *   `opts.allowCompressed` 允许研究抓取接收 gzip/deflate/br，但解压输出以 `maxBytes` 为硬上限
 *   （zlib `maxOutputLength`），仍然杜绝解压膨胀；采集路径默认仍只接受 identity。
 */
const dns = require('node:dns').promises;
const https = require('node:https');
const http = require('node:http');
const { URL } = require('node:url');
const { getMosConfig, isProductionMode } = require('../config');
const { sha256 } = require('../ids');

/* ---------------- SSRF 判定 ---------------- */

function ipv4Parts(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n) => n > 255)) return null;
  return parts;
}

/**
 * 把 IPv6 文本展开成 8 个 16 位组（含内嵌 IPv4 的写法）。
 * 无法解析返回 null。**必须支持 IPv4-mapped / NAT64 / 6to4 等内嵌形式**，
 * 否则这些写法会绕过地址段拦截（整改中发现的实际绕过面）。
 */
function expandIpv6(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  s = s.split('%')[0];                       // 去 zone id
  if (s.indexOf(':') === -1) return null;

  // 内嵌 IPv4（x.x.x.x）→ 两个十六进制组
  if (s.indexOf('.') !== -1) {
    const i = s.lastIndexOf(':');
    const v4 = ipv4Parts(s.slice(i + 1));
    if (!v4) return null;
    const g1 = (((v4[0] << 8) | v4[1]) >>> 0).toString(16);
    const g2 = (((v4[2] << 8) | v4[3]) >>> 0).toString(16);
    s = s.slice(0, i + 1) + g1 + ':' + g2;
  }

  const dbl = s.split('::');
  if (dbl.length > 2) return null;
  const parse = (str) => (str ? str.split(':').map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN)) : []);
  const head = parse(dbl[0]);
  const tail = dbl.length === 2 ? parse(dbl[1]) : [];
  if (head.some(Number.isNaN) || tail.some(Number.isNaN)) return null;

  let groups;
  if (dbl.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    groups = head.concat(new Array(fill).fill(0)).concat(tail);
  } else {
    groups = head;
  }
  return groups.length === 8 ? groups : null;
}

/** 从展开后的 IPv6 组还原内嵌 IPv4 四元组 */
function embeddedV4(g6, g7) {
  return [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join('.');
}

/** 是否属于必须拒绝的地址段 */
function isBlockedIp(ip) {
  const raw = String(ip || '').trim().toLowerCase();
  if (!raw) return true;

  const v4 = ipv4Parts(raw);
  if (v4) return isBlockedV4(v4);

  // IPv6（含所有内嵌 IPv4 写法）
  const g = expandIpv6(raw);
  if (!g) return /^f[cd][0-9a-f]{2}:|^fe[89ab][0-9a-f]:|^2001:db8:/.test(raw); // 解析失败时按前缀保守判定
  const allZero = g.every((x) => x === 0);
  if (allZero) return true;                                        // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1 回环
  if ((g[0] & 0xfe00) === 0xfc00) return true;                      // fc00::/7 ULA
  if ((g[0] & 0xffc0) === 0xfe80) return true;                      // fe80::/10 链路本地
  if ((g[0] & 0xff00) === 0xff00) return true;                      // ff00::/8 组播
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;              // 2001:db8::/32 文档段
  if (g[0] === 0x2001 && g[1] === 0x0000) return true;              // 2001::/32 Teredo
  if (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    return isBlockedIp(embeddedV4(g[6], g[7]));                     // 64:ff9b::/96 NAT64
  }
  if (g[0] === 0x2002) {
    return isBlockedIp(embeddedV4(g[1], g[2]));                     // 2002::/16 6to4
  }
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return isBlockedIp(embeddedV4(g[6], g[7]));                     // ::ffff:0:0/96 IPv4-mapped
  }
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && (g[5] || g[6] || g[7])) {
    return isBlockedIp(embeddedV4(g[6], g[7]));                     // ::x.x.x.x IPv4-compatible（废弃）
  }
  return false;
}

/** IPv4 四元组是否属于必须拒绝的地址段 */
function isBlockedV4(v4) {
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

/** 是否回环地址（测试专用放行需要单独识别；覆盖 IPv6 及其内嵌写法） */
function isLoopbackIp(ip) {
  const raw = String(ip || '').trim().toLowerCase();
  if (/^127\./.test(raw)) return true;
  const v4 = ipv4Parts(raw);
  if (v4) return v4[0] === 127;
  const g = expandIpv6(raw);
  if (!g) return false;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    return ipv4Parts(embeddedV4(g[6], g[7]))[0] === 127;
  }
  if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && (g[5] || g[6] || g[7])) {
    return ipv4Parts(embeddedV4(g[6], g[7]))[0] === 127;
  }
  return false;
}

function normalizeHost(host) {
  return String(host || '').trim().toLowerCase().replace(/\.$/, '');
}

/* ---------------- 解析器接缝（仅供测试注入，用于验证「校验→连接」绑定） ---------------- */
const defaultResolver = (host) => dns.lookup(host, { all: true });
let activeResolver = defaultResolver;
/** 测试专用：注入解析器（可模拟 DNS 重绑定 / 受限网络），生产不调用 */
function _setResolverForTest(fn) { activeResolver = typeof fn === 'function' ? fn : defaultResolver; }
function _resetResolverForTest() { activeResolver = defaultResolver; }

/**
 * 测试专用放行开关 —— **生产模式下强制失效**（fail closed）。
 * @returns {{allowLoopback:boolean, allowHttp:boolean, testMode:boolean}}
 */
function egressTestFlags() {
  const prod = isProductionMode();
  const flag = (name) => !prod && process.env[name] === '1';
  return {
    allowLoopback: flag('MOS_EGRESS_ALLOW_LOOPBACK'),
    allowHttp: flag('MOS_EGRESS_ALLOW_HTTP'),
    testMode: !prod && (process.env.MOS_EGRESS_ALLOW_LOOPBACK === '1' || process.env.MOS_EGRESS_ALLOW_HTTP === '1')
  };
}

/**
 * 端口是否允许：
 *   - 生产模式：**仅** `egress.allowedPorts`（默认 443）；
 *   - 测试模式（`MOS_EGRESS_ALLOW_HTTP=1` 且非生产）：放宽端口以便本地端到端验证；
 *     该放行在生产模式下一律失效（见 egressTestFlags）。
 */
function isPortAllowed(u, flags, ports) {
  const cfg = getMosConfig();
  const f = flags || egressTestFlags();
  if (f.allowHttp) return true; // 测试专用；生产已在上游被 egressTestFlags 关闭
  const explicit = u.port !== '';
  const port = explicit ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  const list = Array.isArray(ports) && ports.length ? ports : (cfg.egress.allowedPorts || [443]);
  return list.indexOf(port) !== -1;
}

/**
 * 校验目标 URL 是否允许出站（**校验结果将被固定绑定到实际连接**）。
 *
 * @param {string} rawUrl
 * @param {object} [opts] 策略覆盖（V0.1.3 Phase B 研究抓取复用本函数时使用）。
 *   - `allowedHosts: string[]`  —— 覆盖主机白名单（研究域：允许检索结果主机）。
 *   - `allowAnyPublicHost: true` —— 跳过主机白名单，但 **SSRF/协议/端口/凭据/逐跳校验一条不减**。
 *   - `allowedPorts: number[]`   —— 覆盖允许端口。
 *   **默认（不传 opts）= 既有采集语义（fail closed，白名单命中才放行）**，不改变任何既有行为。
 * @returns {{ok:true, url:URL, ip:string, family:number, addresses:string[]} |
 *           {ok:false, reason:string, code:string}}
 */
async function assertEgressAllowed(rawUrl, opts) {
  const cfg = getMosConfig();
  const flags = egressTestFlags();
  const o = opts && typeof opts === 'object' ? opts : {};
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch (_) {
    return { ok: false, reason: 'URL 格式非法', code: 'BAD_URL' };
  }

  // 1) URL 形态：禁止内嵌凭据（凭据泄露 + 解析歧义）
  if (u.username || u.password) {
    return { ok: false, reason: 'URL 不得内嵌凭据（user:pass@）', code: 'CREDENTIALS_IN_URL' };
  }

  // 2) 协议
  const httpAllowed = cfg.egress.allowHttp && flags.allowHttp;
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && httpAllowed)) {
    return {
      ok: false,
      reason: u.protocol === 'http:' ? '仅允许 https 出站（HTTP 已禁用）' : '不支持的协议：' + u.protocol,
      code: 'SCHEME_NOT_ALLOWED'
    };
  }

  // 3) 主机白名单（fail closed；研究抓取可显式传入 allowAnyPublicHost 跳过白名单，
  //    但下方 SSRF 判定 / 端口 / 协议 / 凭据校验仍然全部执行，且连接固定绑定已校验 IP）
  const host = normalizeHost(u.hostname).replace(/^\[|\]$/g, ''); // IPv6 字面量去方括号
  if (!host || /[\s/\\]/.test(host)) {
    return { ok: false, reason: '主机名形态非法', code: 'BAD_HOST' };
  }
  const allowed = (Array.isArray(o.allowedHosts) ? o.allowedHosts : (cfg.egress.allowedHosts || []))
    .map((h) => normalizeHost(h).replace(/^\[|\]$/g, ''));
  if (o.allowAnyPublicHost !== true && allowed.indexOf(host) === -1) {
    return { ok: false, reason: '主机不在出站白名单内：' + host, code: 'HOST_NOT_ALLOWLISTED' };
  }

  // 4) 解析全部地址；任何一个落在禁止段即拒绝（先于端口判定，保持 SSRF 语义优先）
  let entries = [];
  // 字面量 IP（含 IPv4-mapped IPv6）无需 DNS；其余走解析器
  const literal = ipv4Parts(host) ? host : (host.indexOf(':') !== -1 ? host : null);
  if (literal) {
    entries = [{ address: literal, family: ipv4Parts(literal) ? 4 : 6 }];
  } else {    try {
      const res = await activeResolver(host);
      entries = res.map((r) => ({ address: r.address, family: r.family || (ipv4Parts(r.address) ? 4 : 6) }));
    } catch (err) {
      return { ok: false, reason: '域名无法解析：' + host + '（' + err.code + '）', code: 'DNS_FAILED' };
    }
  }
  if (!entries.length) return { ok: false, reason: '域名无解析结果', code: 'DNS_EMPTY' };

  for (const e of entries) {
    if (isLoopbackIp(e.address)) {
      if (!flags.allowLoopback) {
        return { ok: false, reason: 'SSRF 阻断：目标解析到回环地址 ' + e.address, code: 'SSRF_BLOCKED' };
      }
      continue;
    }
    if (isBlockedIp(e.address)) {
      return { ok: false, reason: 'SSRF 阻断：目标解析到受限地址 ' + e.address, code: 'SSRF_BLOCKED' };
    }
  }

  // 5) 端口在 SSRF 判定之后：只允许 egress.allowedPorts（默认仅 443）
  if (!isPortAllowed(u, flags, o.allowedPorts)) {
    return {
      ok: false,
      reason: '端口不在允许范围（生产仅允许 ' + (cfg.egress.allowedPorts || [443]).join(',') + '）',
      code: 'PORT_NOT_ALLOWED'
    };
  }

  return {
    ok: true,
    url: u,
    ip: entries[0].address,
    family: entries[0].family,
    addresses: entries.map((e) => e.address)
  };
}

/**
 * 把已校验的 IP **固定绑定**到 socket 连接（关闭 TOCTOU / DNS 重绑定）。
 * 仍保留原 hostname 用于 Host 头与 TLS SNI（servername），因此证书校验不受影响。
 */
function pinnedLookup(addresses) {
  const list = (addresses || []).slice();
  return function lookup(_hostname, options, callback) {
    const wantAll = options && options.all;
    const pick = list.shift() || (list.length ? list[0] : null);
    const addr = pick || (addresses && addresses[0]) || null;
    if (!addr) {
      const err = new Error('无可用的已校验地址');
      err.code = 'ENOTFOUND';
      return callback(err);
    }
    const family = ipv4Parts(addr) ? 4 : 6;
    if (wantAll) return callback(null, [{ address: addr, family }]);
    return callback(null, addr, family);
  };
}

/* ---------------- 抓取 ---------------- */

/**
 * 单次 HTTP(S) 抓取 —— **连接固定绑定到已校验 IP**（guard.addresses）。
 * 3xx 一律以 `REDIRECT` 抛出，由 fetchWithRedirects 决定是否逐跳重校验。
 * @param {{url:URL, addresses:string[]}} guard assertEgressAllowed 的结果
 */
function fetchOnce(guard, opts) {
  const cfg = getMosConfig();
  const u = guard.url;
  const mod = u.protocol === 'https:' ? https : http;
  const timeout = (opts && opts.timeoutMs) || cfg.egress.fetchTimeoutMs;
  const maxBytes = (opts && opts.maxBytes) || cfg.egress.maxBytes;

  return new Promise((resolve, reject) => {
    const baseHeaders = {
      'User-Agent': 'VFIB-MarketingOS/0.1 (compliance-first source ingestion; contact: brand-team)',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.5',
      // ★ 默认不请求压缩：杜绝解压膨胀（bomb）面；研究抓取显式 allowCompressed 时才开放（仍有硬上限）
      'Accept-Encoding': (opts && opts.allowCompressed) ? 'gzip, deflate, br' : 'identity'
    };
    const reqOpts = {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: (opts && opts.method) || 'GET',
      // ★ 绑定已校验 IP：DNS 重绑定不可能把连接指向未校验地址
      lookup: pinnedLookup(guard.addresses || [guard.ip]),
      headers: Object.assign(baseHeaders, (opts && opts.headers) || {}, (opts && opts.accept) ? { Accept: opts.accept } : {}),
      timeout
    };
    if (u.protocol === 'https:') reqOpts.servername = u.hostname; // 保留 SNI，证书校验不变

    const req = mod.request(reqOpts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        reject(Object.assign(new Error('重定向待逐跳校验'), {
          code: 'REDIRECT',
          status: res.statusCode,
          location: String(res.headers.location)
        }));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(Object.assign(new Error('上游返回 HTTP ' + res.statusCode), { code: 'UPSTREAM_STATUS', status: res.statusCode }));
        return;
      }
      // ★ 编码策略：
      //   - 默认（采集）：即便请求了 identity，仍防御性检查：非 identity 编码一律拒绝（不解压）；
      //   - 研究抓取（opts.allowCompressed=true）：允许 gzip/deflate/br，但**解压输出硬上限**
      //     = maxBytes（zlib maxOutputLength），超限即失败 → 仍然杜绝解压膨胀（bomb）。
      const enc = String(res.headers['content-encoding'] || 'identity').trim().toLowerCase();
      const compressed = enc && enc !== 'identity';
      const allowCompressed = !!(opts && opts.allowCompressed);
      if (compressed && !allowCompressed) {
        res.resume();
        reject(Object.assign(new Error('上游使用了未允许的内容编码：' + enc), { code: 'UNSUPPORTED_ENCODING' }));
        return;
      }
      if (compressed && ['gzip', 'x-gzip', 'deflate', 'br'].indexOf(enc) === -1) {
        res.resume();
        reject(Object.assign(new Error('上游使用了不支持的内容编码：' + enc), { code: 'UNSUPPORTED_ENCODING' }));
        return;
      }
      const declared = Number(res.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        res.resume();
        reject(Object.assign(new Error('响应体声明长度超过上限'), { code: 'RESPONSE_TOO_LARGE' }));
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
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let out;
        let decodedBytes = raw.length;
        if (compressed) {
          try {
            const zlib = require('node:zlib');
            const inflate = enc === 'br' ? zlib.brotliDecompressSync : (enc === 'deflate' ? zlib.inflateSync : zlib.gunzipSync);
            // maxOutputLength：解压后超过上限直接抛错（有界，绝不放任膨胀）
            out = inflate(raw, { maxOutputLength: maxBytes });
          } catch (err) {
            reject(Object.assign(new Error('压缩响应体解压失败或超过上限：' + String(err && err.message || err).slice(0, 120)),
              { code: 'DECOMPRESS_FAILED' }));
            return;
          }
          decodedBytes = out.length;
        } else {
          out = raw;
        }
        resolve({
          status: res.statusCode,
          contentType: String(res.headers['content-type'] || ''),
          body: out.toString('utf8'),
          bytes: decodedBytes,
          encoding: enc || 'identity',
          finalUrl: u.toString()
        });
      });
    });
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('抓取超时'), { code: 'TIMEOUT' })); });
    req.on('error', (err) => reject(err));
    req.end();
  });
}

/**
 * 带**逐跳校验**的抓取：每一跳重新执行 白名单 / SSRF / 协议 / 端口 校验，
 * 任一跳不合规即整体拒绝（SEC-13）。
 * @param {{url:URL, addresses:string[]}} guard
 */
async function fetchWithRedirects(guard, opts) {
  const cfg = getMosConfig();
  const maxRedirects = Number.isInteger(cfg.egress.maxRedirects) ? cfg.egress.maxRedirects : 3;
  let current = guard;
  const chain = [guard.url.toString()];
  for (let hop = 0; ; hop += 1) {
    let res;
    try {
      res = await fetchOnce(current, opts);
      return Object.assign(res, { redirectChain: chain });
    } catch (err) {
      if (err.code !== 'REDIRECT') throw err;
      if (hop >= maxRedirects) {
        throw Object.assign(new Error('重定向次数超过上限（' + maxRedirects + '）'), { code: 'TOO_MANY_REDIRECTS' });
      }
      let next;
      try {
        next = new URL(err.location, current.url);
      } catch (_) {
        throw Object.assign(new Error('重定向目标 URL 非法'), { code: 'REDIRECT_BAD_URL' });
      }
      // ★ 逐跳重新校验（白名单 + SSRF + 协议 + 端口 + 凭据）
      // eslint-disable-next-line no-await-in-loop
      const g = await assertEgressAllowed(next.toString(), (opts && opts.egressOpts) || undefined);
      if (!g.ok) {
        throw Object.assign(new Error('重定向被拒绝：' + g.reason), { code: 'REDIRECT_BLOCKED', reason: g.reason, subCode: g.code });
      }
      chain.push(g.url.toString());
      current = g;
    }
  }
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
 * @param {object} opts { transport } 测试可注入 transport(guard, opts)；guard = {url, addresses, ip}
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
      : (g, o) => fetchWithRedirects(g, o);
    res = await transport(guard, { timeoutMs: cfg.egress.fetchTimeoutMs, maxBytes: cfg.egress.maxBytes });
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
  egressTestFlags,
  pinnedLookup,
  _setResolverForTest,
  _resetResolverForTest,
  parseFeed,
  canonicalizeUrl,
  fetchSourceItems,
  persistItems,
  fetchOnce,
  fetchWithRedirects,
  status: () => {
    const cfg = getMosConfig();
    const flags = egressTestFlags();
    return {
      gateway: 'source',
      mode: cfg.integrations.sourceIngest,
      allowlistSize: (cfg.egress.allowedHosts || []).length,
      allowedPorts: cfg.egress.allowedPorts,
      maxRedirects: cfg.egress.maxRedirects,
      pinnedLookup: true,
      testFlagsActive: flags.testMode,
      note: '真实 HTTP 抓取；主机白名单 + SSRF 判定 + **已校验 IP 绑定连接** + **跳转逐跳校验**；'
        + '失败即降级并如实记录，不伪造成功。测试放行开关在生产模式一律失效。'
    };
  }
};
