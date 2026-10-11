'use strict';
/**
 * 网络地址解析与 CIDR 匹配（V1.1.3 P0-01）。
 *
 * 为什么需要这个模块：
 *   V1.1.2 的 IP 白名单用 `String.startsWith()` 做前缀比较，属于**字符串匹配冒充网络匹配**。
 *   后果：规则 `192.0.2.10` 会错误地放行 `192.0.2.100`；`10.0.0.1` 会放行 `10.0.0.123`。
 *   本模块改用**逐位（bitwise）字节比较**，并显式处理 IPv4 / IPv6 / IPv4-mapped IPv6。
 *
 * 严格性：
 *   - 任何无法确定解析的输入一律返回 null，**绝不猜测**（调用方据此 fail closed）。
 *   - 拒绝前导零（`010` 是八进制歧义）、多个 `::`、越界前缀、非数字前缀、作用域 ID 等。
 *   - 不支持主机名：只接受字面量 IP，避免 DNS 解析带来的 TOCTOU 与解析器差异。
 *
 * 零第三方依赖（仅 Node 内置模块）。
 */

/* ==================== 基础解析 ==================== */

/** 解析十进制点分 IPv4；失败返回 null。拒绝前导零等歧义写法。 */
function parseIpv4(input) {
  const s = String(input == null ? '' : input).trim();
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i += 1) {
    const p = parts[i];
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p[0] === '0') return null; // 010 / 00 等歧义写法
    const n = Number(p);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

/** 解析 IPv6（含 `::` 压缩与内嵌 IPv4）；失败返回 null。 */
function parseIpv6(input) {
  let s = String(input == null ? '' : input).trim().toLowerCase();
  if (!s) return null;
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1); // [::1]
  if (s.includes('%')) return null; // 作用域 ID（fe80::1%eth0）不支持
  if (!s.includes(':')) return null;

  const halves = s.split('::');
  if (halves.length > 2) return null; // 多个 "::" 非法

  const parseSide = (side) => {
    if (side === '') return [];
    const out = [];
    for (const tok of side.split(':')) {
      if (tok === '') return null; // 例如 "1::2:3" 之外的 "1:2:" 非法
      if (tok.includes('.')) {
        const v4 = parseIpv4(tok);
        if (!v4) return null;
        out.push((v4[0] << 8) | v4[1]);
        out.push((v4[2] << 8) | v4[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(tok)) return null;
        out.push(parseInt(tok, 16));
      }
    }
    return out;
  };

  const head = parseSide(halves[0]);
  if (head === null) return null;

  let groups;
  if (halves.length === 2) {
    const tail = parseSide(halves[1]);
    if (tail === null) return null;
    const missing = 8 - (head.length + tail.length);
    if (missing < 1) return null; // "::" 至少要压缩掉一组
    groups = head.concat(new Array(missing).fill(0), tail);
  } else {
    groups = head;
    if (groups.length !== 8) return null;
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    bytes[i * 2] = (groups[i] >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i] & 0xff;
  }
  return bytes;
}

/** 是否为 IPv4-mapped IPv6（::ffff:a.b.c.d） */
function isV4Mapped(bytes) {
  if (!bytes || bytes.length !== 16) return false;
  for (let i = 0; i < 10; i += 1) if (bytes[i] !== 0) return false;
  return bytes[10] === 0xff && bytes[11] === 0xff;
}

/** 归一化解析：IPv4-mapped IPv6 折叠为 IPv4。返回 { family, bytes } 或 null。
 *  接受**已解析对象**作为输入（幂等），避免调用方把解析结果再传入解析函数时静默失败。 */
function parseIp(input) {
  // 幂等：已经是 { family, bytes } 形态时直接返回副本
  if (input && typeof input === 'object' && (input.family === 4 || input.family === 6) && input.bytes
    && typeof input.bytes.length === 'number' && input.bytes.length === (input.family === 4 ? 4 : 16)) {
    return { family: input.family, bytes: Uint8Array.from(input.bytes) };
  }

  const s = String(input == null ? '' : input).trim();
  if (!s) return null;

  const v4 = parseIpv4(s);
  if (v4) return { family: 4, bytes: v4 };

  const v6 = parseIpv6(s);
  if (!v6) return null;
  if (isV4Mapped(v6)) return { family: 4, bytes: v6.slice(12) };
  return { family: 6, bytes: v6 };
}

/** 规范化的文本形式（用于日志/会话键/比较），解析失败返回 ''。 */
function normalizeIp(input) {
  const ip = parseIp(input);
  if (!ip) return '';
  if (ip.family === 4) return [...ip.bytes].join('.');
  // IPv6：压缩最长零段
  const groups = [];
  for (let i = 0; i < 8; i += 1) groups.push((ip.bytes[i * 2] << 8) | ip.bytes[i * 2 + 1]);
  let bestStart = -1; let bestLen = 0; let curStart = -1; let curLen = 0;
  for (let i = 0; i < 8; i += 1) {
    if (groups[i] === 0) {
      if (curStart === -1) curStart = i;
      curLen += 1;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else { curStart = -1; curLen = 0; }
  }
  if (bestLen < 2) return groups.map((g) => g.toString(16)).join(':');
  const left = groups.slice(0, bestStart).map((g) => g.toString(16)).join(':');
  const right = groups.slice(bestStart + bestLen).map((g) => g.toString(16)).join(':');
  return left + '::' + right;
}

/** 是否回环地址（127.0.0.0/8 或 ::1）。接受原始字符串或已解析对象。 */
function isLoopback(input) {
  const ip = parseIp(input);
  if (!ip) return false;
  if (ip.family === 4) return ip.bytes[0] === 127;
  return ip.bytes.every((b, i) => (i === 15 ? b === 1 : b === 0));
}

/** 是否回环地址（**已解析对象**入参；供已持有 parseIp 结果的调用方使用，语义与 isLoopback 一致） */
function isLoopbackIp(ip) {
  if (!ip || typeof ip !== 'object' || !ip.bytes) return false;
  if (ip.family === 4) return ip.bytes[0] === 127;
  if (ip.family === 6) return Array.from(ip.bytes).every((b, i) => (i === 15 ? b === 1 : b === 0));
  return false;
}

/* ==================== CIDR ==================== */

const LEGACY_PREFIX_RE = /^(\d{1,3})(?:\.(\d{1,3}))?(?:\.(\d{1,3}))?\.$/;

/**
 * 解析单条规则为 CIDR。返回 { family, bytes, prefix, legacy } 或 { error }。
 *
 * 支持三种写法：
 *   1. 精确地址：`192.0.2.10` → /32（IPv6 为 /128）
 *   2. 标准 CIDR：`192.0.2.0/24`、`2001:db8::/32`
 *   3. 历史「整段前缀」写法（向后兼容，等价语义、非字符串匹配）：
 *      `192.168.1.` → 192.168.1.0/24 ；`10.0.0.` → 10.0.0.0/16… 实为按八位组整段。
 *      该写法在 V1.1.2 前端占位符中使用过，此处做**确定性**归一化并标记 legacy。
 */
function parseCidr(input) {
  const s = String(input == null ? '' : input).trim();
  if (!s) return { error: 'empty' };

  const legacy = LEGACY_PREFIX_RE.exec(s);
  if (legacy) {
    const octets = [legacy[1], legacy[2], legacy[3]].filter((x) => x !== undefined).map(Number);
    if (octets.some((n) => n > 255)) return { error: 'bad-octet' };
    const prefix = octets.length * 8;
    if (prefix < 8) return { error: 'too-broad' }; // 不允许 "0." 这类过于宽泛的规则
    const bytes = new Uint8Array(4);
    octets.forEach((n, i) => { bytes[i] = n; });
    return { family: 4, bytes, prefix, legacy: true };
  }

  const segs = s.split('/');
  if (segs.length > 2) return { error: 'bad-cidr' };
  const ip = parseIp(segs[0]);
  if (!ip) return { error: 'bad-ip' };

  const max = ip.family === 4 ? 32 : 128;
  let prefix;
  if (segs.length === 1) {
    prefix = max;
  } else {
    const p = segs[1];
    if (!/^\d{1,3}$/.test(p)) return { error: 'bad-prefix' };
    prefix = Number(p);
    if (prefix > max) return { error: 'bad-prefix' };
  }

  const bytes = new Uint8Array(ip.bytes);
  const keep = ip.family === 4
    ? [Math.floor(prefix / 8), prefix % 8]
    : [Math.floor(prefix / 8), prefix % 8];
  // 主机位清零，保证 contains 判定与展示一致
  if (keep[1] !== 0) {
    const mask = (0xff << (8 - keep[1])) & 0xff;
    bytes[keep[0]] &= mask;
  }
  for (let i = keep[0] + (keep[1] !== 0 ? 1 : 0); i < bytes.length; i += 1) bytes[i] = 0;

  return { family: ip.family, bytes, prefix, legacy: false };
}

/** 前缀比较：cidr 是否包含 ip（均为已解析对象） */
function cidrContains(cidr, ip) {
  if (!cidr || !ip || cidr.family !== ip.family) return false;
  const fullBytes = Math.floor(cidr.prefix / 8);
  for (let i = 0; i < fullBytes; i += 1) {
    if (cidr.bytes[i] !== ip.bytes[i]) return false;
  }
  const rem = cidr.prefix % 8;
  if (rem === 0) return true;
  const mask = (0xff << (8 - rem)) & 0xff;
  return (cidr.bytes[fullBytes] & mask) === (ip.bytes[fullBytes] & mask);
}

/**
 * 解析规则列表。返回 { rules, errors }。
 * 调用方必须在 errors 非空时 fail closed（拒绝启动或拒绝放行），不得静默忽略。
 */
function parseCidrList(list) {
  const rules = [];
  const errors = [];
  const arr = Array.isArray(list) ? list : [];
  for (const raw of arr) {
    if (typeof raw !== 'string') { errors.push({ value: String(raw), error: 'not-a-string' }); continue; }
    const t = raw.trim();
    if (!t) continue; // 忽略空行
    if (t.startsWith('#')) continue; // 允许注释行
    const parsed = parseCidr(t);
    if (parsed.error) errors.push({ value: t, error: parsed.error });
    else rules.push(parsed);
  }
  return { rules, errors };
}

/** 地址是否命中规则列表（list 为原始字符串数组或已解析规则） */
function ipInList(list, ipInput) {
  const ip = typeof ipInput === 'string' || ipInput == null ? parseIp(ipInput) : ipInput;
  if (!ip) return false;
  const rules = (list && list.length && typeof list[0] === 'object' && list[0].bytes)
    ? list
    : parseCidrList(list).rules;
  return rules.some((rule) => cidrContains(rule, ip));
}

/** 供日志/展示：把 CIDR 还原为文本 */
function formatCidr(cidr) {
  if (!cidr) return '';
  const addr = normalizeIp(cidr.family === 4
    ? [...cidr.bytes].join('.')
    : (() => {
      const parts = [];
      for (let i = 0; i < 8; i += 1) parts.push(((cidr.bytes[i * 2] << 8) | cidr.bytes[i * 2 + 1]).toString(16));
      return parts.join(':');
    })());
  return addr + '/' + cidr.prefix;
}

module.exports = {
  parseIpv4,
  parseIpv6,
  parseIp,
  normalizeIp,
  isLoopback,
  isLoopbackIp,
  isV4Mapped,
  parseCidr,
  parseCidrList,
  cidrContains,
  ipInList,
  formatCidr
};
