'use strict';
/**
 * VFIB Enterprise Workspace V1.1.3 —— 生产密钥扫描器（P1-01，取代 AUD-14 的旧实现）。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 为什么重做
 * ────────────────────────────────────────────────────────────────────────
 * 旧 AUD-14 用「关键词命中」判定：
 *     /admin123|manager123|demo123|password123|emp123456/i   → 命中即 FAIL
 * 结果把**讨论口令的文档**（"不要把 admin123 这类弱口令写进配置"）与
 * **真实凭据值**混为一谈，并靠 `skip = /smoke-test|acceptance-test|ui-check|self-audit/`
 * 直接跳过整个测试目录 —— 这属于「删规则式降噪」。
 *
 * 本扫描器改成 **值导向（value-oriented）+ 语境判定（context-aware）**：
 *
 *   1. 高置信度**密钥格式**（SECRET-0xx）：无论出现在源码、配置、文档还是产物中，
 *      只要形态匹配真实凭据（sk- / AKIA / PEM / JWT / gh*_ / xox* / AIza / AccountKey）
 *      一律判定为泄漏。
 *   2. **赋值语境凭据**（SECRET-1xx）：只有在 `password|secret|apiKey|token = "字面值"`
 *      这种赋值语境里才判定；并且必须通过 `isBenignValue()` 的良性值过滤：
 *         · 运行期生成（`randomBytes` / `randomPassword(` / `process.env` / `hashPassword(` …）
 *         · 占位符（`<...>` / `${...}` / `CHANGE_ME` / `YOUR_...` / `example` / `placeholder` …）
 *         · 传输/配置常量（MIME 类型、Cache-Control、Cookie 名、URL、路径）
 *      运行期随机生成的测试夹具口令因此天然不命中，**不需要任何 allowlist**。
 *   3. **文档语境隔离**：`.md` 里 SECRET-1xx 只在**代码块 / 行内代码**中生效。
 *      叙述性文字里出现 "admin123" 只是文档在讨论口令，不构成泄漏。
 *   4. **窄范围 allowlist**（tools/secret-scan-allowlist.json）：必须同时指定
 *      `path` + `rule` + `mustContain`（命中行必须包含的子串），并写明 reason / owner /
 *      reviewBy —— 无法用一条规则静默压制整个文件或整个目录。
 *   5. **自证自检**（--selftest）：内置对抗样本，每类真实密钥**必须**被判定为泄漏，
 *      每类良性写法**必须**不被误报。自检失败 → 扫描器本身失败。
 *      这直接证明「真实硬编码密钥仍会 FAIL」，而不是靠放宽规则换来「干净」。
 *
 * ────────────────────────────────────────────────────────────────────────
 * 扫描范围
 * ────────────────────────────────────────────────────────────────────────
 * 默认使用 `git ls-files --cached --others --exclude-standard`：
 *   已跟踪源码 + 尚未 add 的新文件，**排除** .gitignore 覆盖的运行期状态
 *   （data/ data-test/ node_modules/ ui-screenshots/ .workbuddy/ *.zip config.json）。
 * 因此扫描面 == 源码包实际内容的超集。
 * 交付产物（ZIP、证据目录）用 `--paths <目录>` 单独扫描，见 DEPLOYMENT_PRODUCTION_V1.1.3.md。
 *
 * 用法：
 *   node tools/secret-scan-v113.js                 # 人类可读报告
 *   node tools/secret-scan-v113.js --json           # 机器可读
 *   node tools/secret-scan-v113.js --selftest       # 仅运行自证自检
 *   node tools/secret-scan-v113.js --paths dist/    # 扫描指定路径（可多次）
 *
 * 退出码：0 = 无命中且自检通过；1 = 有命中或自检失败。
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ALLOWLIST_FILE = path.join(__dirname, 'secret-scan-allowlist.json');

/* ==================== 规则 ==================== */

/** 高置信度密钥格式：任何语境（源码 / 配置 / 文档 / 产物）命中即泄漏 */
const HIGH_CONFIDENCE_RULES = [
  { id: 'SECRET-001', label: 'OpenAI / DeepSeek 风格 API Key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'SECRET-002', label: 'AWS Access Key ID', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'SECRET-003', label: 'PEM 私钥块', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'SECRET-004', label: 'JWT（三段式，疑似长期凭据）', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { id: 'SECRET-005', label: 'GitHub Token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { id: 'SECRET-006', label: 'Slack Token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'SECRET-007', label: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'SECRET-008', label: 'Stripe 密钥', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { id: 'SECRET-009', label: 'Azure 存储连接串密钥', re: /AccountKey=[A-Za-z0-9+/=]{40,}/g }
];

/** 赋值语境凭据：仅在 `凭据名 = "字面值"` 语境下判定，并经过良性值过滤 */
const CONTEXT_RULES = [
  {
    id: 'SECRET-101',
    label: '硬编码口令 / 密钥字面值',
    re: /(?:^|[^\w.$])(password|passwd|pwd|secret|apiKey|api_key|apikey|accessKey|access_key|privateKey|private_key|authToken|auth_token|bearerToken)\s*['"]?\s*[:=]\s*(['"])([^'"\n]{6,})\2/gi,
    codeOnly: true
  },
  {
    id: 'SECRET-102',
    label: '凭据类环境变量的字面默认值回退',
    re: /(?:PASSWORD|PASSWD|SECRET|TOKEN|API[_-]?KEY|ACCESS[_-]?KEY)\b[^\n]{0,80}?\|\|\s*(['"])([^'"\n]{6,})\1/g,
    codeOnly: true
  }
];

/** 良性值：不可能是真实凭据的字面值 */
const PLACEHOLDER_RE = /^(?:<[^>]*>|\$\{[^}]*\}|change[_-]?me|changeme|your[_-].*|replace[_-].*|example.*|sample.*|dummy.*|placeholder.*|todo.*|tbd|x{3,}|\*{3,}|n\/a|none|null|undefined)$/i;
/** 紧跟在字面值之后的「拼接运行期生成器」写法（如 'fx-' + crypto.randomBytes(8)）不算硬编码凭据 */
const CONCAT_GENERATOR_RE = /^\s*\+\s*(?:crypto\s*\.\s*randomBytes|randomBytes|randomPassword|randomToken|hashPassword|newCsrfToken|Date\s*\.\s*now|uid\s*\(|String\s*\(|Math\s*\.\s*random|require\s*\()/;
const TRANSPORT_CONSTANTS = new Set([
  'application/json', 'application/octet-stream', 'text/event-stream', 'text/plain',
  'text/html; charset=utf-8', 'no-store', 'no-cache', 'same-origin', 'include', 'omit',
  'utf-8', 'bearer', 'strict', 'lax'
]);

/**
 * 判定一个字面值是否良性（返回 true = 不算泄漏）。
 * `afterLiteral` 是该字面值之后的一段原文，用于识别「拼接运行期生成器」的写法。
 * 判定依据全部可解释，避免「静默跳过」。
 */
function isBenignValue(value, line, afterLiteral) {
  const v = String(value || '').trim();
  if (v.length < 6) return true;                       // 太短，不构成凭据
  if (PLACEHOLDER_RE.test(v)) return true;             // 占位符
  if (TRANSPORT_CONSTANTS.has(v.toLowerCase())) return true;
  if (/^https?:\/\//i.test(v)) return true;            // URL
  if (v.startsWith('/')) return true;                  // 路径
  if (/\s/.test(v)) return true;                       // 含空白 → 自然语言片段
  // 该字面值只是运行期生成值的「前缀」（如 'fx-' + crypto.randomBytes(15)）
  if (CONCAT_GENERATOR_RE.test(String(afterLiteral || ''))) return true;
  return false;
}

/* ==================== allowlist ==================== */

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
    return Array.isArray(parsed.entries) ? parsed.entries : [];
  } catch (err) {
    console.error('[secret-scan] allowlist 解析失败：' + err.message);
    process.exit(2);
  }
}

/** 窄范围匹配：必须同时命中 path + rule + mustContain 三项才生效 */
function isAllowlisted(entry, finding) {
  if (!entry || !entry.path || !entry.rule || !entry.mustContain) return false;
  if (entry.rule !== finding.rule) return false;
  const rel = finding.path.replace(/\\/g, '/');
  const pattern = String(entry.path).replace(/\\/g, '/');
  const pathOk = pattern.endsWith('/**')
    ? rel.startsWith(pattern.slice(0, -2))
    : rel === pattern;
  if (!pathOk) return false;
  return finding.line.indexOf(String(entry.mustContain)) !== -1;
}

/* ==================== 扫描 ==================== */

const TEXT_EXT = /\.(js|mjs|cjs|ts|json|html|htm|css|md|txt|ya?ml|sh|bat|ps1|env|ini|cfg|conf|xml|csv|log)$/i;

/** 提取 .md 中「代码语境」的文本（围栏代码块 + 行内代码），并把其它部分替换为等长空白以保持行号/列号 */
function maskProse(text) {
  const lines = text.split('\n');
  let inFence = false;
  return lines.map((line) => {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) { inFence = !inFence; return ''; }
    if (inFence) return line;
    // 保留行内代码，其余字符替换为空格
    let out = '';
    const re = /`[^`\n]*`/g;
    let last = 0;
    let m;
    while ((m = re.exec(line)) !== null) {
      out += ' '.repeat(m.index - last) + m[0];
      last = m.index + m[0].length;
    }
    out += ' '.repeat(line.length - last);
    return out;
  }).join('\n');
}

function scanText(relPath, text, options) {
  const opts = options || {};
  const findings = [];
  const isDoc = /\.md$/i.test(relPath);
  const scanTarget = isDoc ? maskProse(text) : text;
  const lines = scanTarget.split('\n');
  const rawLines = text.split('\n');

  const push = (rule, lineIdx, snippet) => {
    findings.push({
      rule: rule.id,
      label: rule.label,
      path: relPath,
      line: lineIdx + 1,
      text: String(rawLines[lineIdx] || '').trim().slice(0, 220),
      snippet: String(snippet).slice(0, 60)
    });
  };

  for (const rule of HIGH_CONFIDENCE_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m;
    while ((m = re.exec(scanTarget)) !== null) {
      const lineIdx = scanTarget.slice(0, m.index).split('\n').length - 1;
      push(rule, lineIdx, m[0]);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  for (const rule of CONTEXT_RULES) {
    const re = new RegExp(rule.re.source, rule.re.flags);
    let m;
    while ((m = re.exec(scanTarget)) !== null) {
      const lineIdx = scanTarget.slice(0, m.index).split('\n').length - 1;
      const rawLine = rawLines[lineIdx] || '';
      const value = m[3] !== undefined ? m[3] : m[2];
      const afterLiteral = scanTarget.slice(m.index + m[0].length, m.index + m[0].length + 80);
      if (!isBenignValue(value, rawLine, afterLiteral)) push(rule, lineIdx, value);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  if (opts.extraRules) {
    for (const rule of opts.extraRules) {
      const re = new RegExp(rule.re.source, rule.re.flags);
      let m;
      while ((m = re.exec(scanTarget)) !== null) {
        const lineIdx = scanTarget.slice(0, m.index).split('\n').length - 1;
        push(rule, lineIdx, m[0]);
        if (m.index === re.lastIndex) re.lastIndex += 1;
      }
    }
  }

  return findings;
}

/** 兜底枚举：不依赖 git（部分受控运行环境禁止子进程）。忽略运行期状态目录。 */
const FALLBACK_ROOTS = ['lib', 'public', 'tools', 'TEST_EVIDENCE_V1.1.3', 'UI_EVIDENCE_V1.1.3'];
const FALLBACK_FILES = ['server.js', 'package.json', 'config.example.json', 'start.sh', 'start.bat', '.gitignore'];
const IGNORED_DIRS = new Set(['node_modules', 'data', 'data-test', 'ui-screenshots', '.git', '.workbuddy', 'dist', 'coverage']);
const IGNORED_EXT = /\.(zip|png|jpg|jpeg|gif|ico|pdf|woff2?|ttf|eot|mp4|genie)$/i;

function collectFilesFallback() {
  const out = [];
  const walk = (rel) => {
    const abs = path.join(ROOT, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(path.join(rel, entry.name));
        continue;
      }
      if (IGNORED_EXT.test(entry.name)) continue;
      out.push(rel.replace(/\\/g, '/') + '/' + entry.name);
    }
  };
  for (const r of FALLBACK_ROOTS) if (fs.existsSync(path.join(ROOT, r))) walk(r);
  for (const f of FALLBACK_FILES) if (fs.existsSync(path.join(ROOT, f))) out.push(f);
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(entry.name);
  }
  return out.sort();
}

/** 默认扫描面：git 已跟踪 + 未跟踪但未被忽略的文件（= 源码包内容超集）；git 不可用时走兜底枚举 */
function collectTrackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024
    });
    const list = out.split('\0').filter(Boolean);
    if (list.length) return { files: list, source: 'git ls-files --cached --others --exclude-standard' };
  } catch (_) { /* 回退到目录枚举 */ }
  return { files: collectFilesFallback(), source: '目录枚举（git 不可用，已排除运行期状态目录）' };
}

function walkDir(dir, base) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

function scan(rootOverride, options) {
  const opts = options || {};
  const root = rootOverride || ROOT;
  let source = '目录枚举';
  let files;
  if (opts.fileList) {
    files = opts.fileList;
    source = '显式文件列表';
  } else if (root === ROOT) {
    const collected = collectTrackedFiles();
    files = collected.files;
    source = collected.source;
  } else {
    files = walkDir(root, root);
  }
  const allowlist = loadAllowlist();
  const findings = [];
  let scanned = 0;
  const skipped = [];

  for (const rel of files) {
    const abs = path.join(root, rel);
    if (!TEXT_EXT.test(rel)) { skipped.push(rel + '（二进制/非文本）'); continue; }
    if (!fs.existsSync(abs)) { skipped.push(rel + '（不存在）'); continue; }
    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch (_) { skipped.push(rel + '（读取失败）'); continue; }
    scanned += 1;
    for (const f of scanText(rel.replace(/\\/g, '/'), text, opts)) {
      const hit = allowlist.find((entry) => isAllowlisted(entry, f));
      if (hit) { f.allowlisted = hit.reason || '已登记豁免'; continue; }
      findings.push(f);
    }
  }

  return { scanned, skipped, findings, allowlistSize: allowlist.length, files: files.length, source, root };
}

/* ==================== 自证自检 ==================== */

/** 对抗样本在运行期拼装，扫描器自身文件里不出现任何连续的密钥形态 */
function selftest() {
  const results = [];
  const eq = (name, cond, detail) => results.push({ name, pass: !!cond, detail: detail || '' });

  const fakeOpenAi = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0k1L2'.repeat(1);
  const fakeAws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const fakePem = '-----BEGIN ' + 'RSA PRIVATE KEY-----';
  const fakeJwt = 'eyJ' + 'hbGciOiJIUzI1NiJ9' + '.' + 'eyJzdWIiOiIxMjM0NTY3ODkw' + '.' + 'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const fakeGh = 'gh' + 'p_' + 'A'.repeat(36);
  const fakeSlack = 'xox' + 'b-' + '123456789012';
  const fakeGoogle = 'AIza' + 'SyDabcdefghijklmnopqrstuvwxyz012345';
  const fakeStripe = 'sk_' + 'live_' + 'A'.repeat(24);
  const fakeAzure = 'AccountKey=' + 'A'.repeat(48) + '==';

  // 对抗样本在运行期拼装，扫描器自身文件里不出现任何连续的密钥 / 口令形态
  const part = (...xs) => xs.join('');
  const fakePw = part('Str0ng', 'P@ssw0rd!', '2026');
  const fakeApiKey = part('9f8e7d6c', '5b4a3928', '1706f5e4d3c2b1a0');
  const fakeDefaultPw = part('adm1n', 'Pass', '2026');
  const fakeCfgPw = part('Prod', 'Passw', '0rd!');
  const fakeLegacyDemo = part('legacy-', 'demo-', 'value');

  const adversarial = [
    ['OpenAI/DeepSeek Key', 'const key = "' + fakeOpenAi + '";', 'SECRET-001'],
    ['AWS AK', 'aws_access_key_id = "' + fakeAws + '"', 'SECRET-002'],
    ['PEM 私钥', fakePem + '\nMIIEowIBAAKCAQEA...', 'SECRET-003'],
    ['JWT', 'const t = "' + fakeJwt + '";', 'SECRET-004'],
    ['GitHub Token', 'token: "' + fakeGh + '"', 'SECRET-005'],
    ['Slack Token', 'const s = "' + fakeSlack + '";', 'SECRET-006'],
    ['Google API Key', 'const g = "' + fakeGoogle + '";', 'SECRET-007'],
    ['Stripe Key', 'const k = "' + fakeStripe + '";', 'SECRET-008'],
    ['Azure AccountKey', 'const cs = "DefaultEndpointsProtocol=https;' + fakeAzure + '"', 'SECRET-009'],
    ['硬编码口令赋值', "const " + 'password' + " = '" + fakePw + "';", 'SECRET-101'],
    ['硬编码 apiKey 赋值', 'apiKey: "' + fakeApiKey + '",', 'SECRET-101'],
    ['凭据环境变量的字面默认值回退', 'const ADMIN_PASSWORD = process.env.MOS_TEST_ADMIN_PASSWORD || ' + "'" + fakeDefaultPw + "';", 'SECRET-102'],
    ['config.json 里的明文口令', '{ "password": "' + fakeCfgPw + '" }', 'SECRET-101']
  ];

  for (const [name, sample, expectRule] of adversarial) {
    const found = scanText('sample.js', sample, {});
    eq('对抗样本必须命中 ' + expectRule + '：' + name,
      found.some((f) => f.rule === expectRule),
      found.length ? found.map((f) => f.rule).join(',') : '未命中');
  }

  const benign = [
    ['文档叙述中讨论弱口令（行内代码）', 'md', '历史文档里不要写 `admin123` 这种弱口令，也不要把它当成默认值。'],
    ['文档叙述中讨论弱口令（纯文字）', 'md', '历史文档里不要写 admin123 这种弱口令。'],
    ['运行期随机生成的夹具口令', 'js', "const FIXTURE_PW = 'fx-' + crypto.randomBytes(15).toString('base64url');"],
    ['运行期随机生成的迁移夹具口令', 'js', "const MIG_PW = 'v111-' + crypto.randomBytes(15).toString('base64url');"],
    ['口令来自环境变量（无默认值）', 'js', "const ADMIN_PASSWORD = process.env.MOS_TEST_ADMIN_PASSWORD || process.env.MOS_ADMIN_PASSWORD || '';"],
    ['占位符', 'js', "apiKey: '<YOUR_API_KEY_HERE>',"],
    ['占位符（模板块）', 'js', 'apiKey: "${DEEPSEEK_API_KEY}",'],
    ['占位符（change_me）', 'json', '{ "password": "CHANGE_ME" }'],
    ['传输常量', 'js', "const secret = 'application/json';"],
    ['文档/正则中的规则字符串', 'js', "const re = /admin123|manager123|demo123/i;"],
    ['Cookie 名 / 头名', 'js', "const cookieName = 'mos_sid'; const header = 'x-mos-csrf';"],
    ['协议常量', 'js', "const scheme = 'Bearer '; const ct = 'text/event-stream';"],
    ['示例 URL', 'js', "const baseUrl = 'https://api.deepseek.com';"],
    ['6 位以下短值', 'js', "password: 'abc',"],
    ['文档中提到真实密钥形态但不含值', 'md', '真实密钥形如 `sk-` 开头并在扫描中被识别。']
  ];

  for (const [name, kind, sample] of benign) {
    const rel = kind === 'md' ? 'sample.md' : (kind === 'json' ? 'sample.json' : 'sample.js');
    const found = scanText(rel, sample, {});
    eq('良性写法不得误报：' + name, found.length === 0,
      found.length ? found.map((f) => f.rule + ':' + f.snippet).join(',') : '');
  }

  // 窄范围 allowlist 语义
  const f = { rule: 'SECRET-101', path: 'docs/x.md', line: 'password: "' + fakeLegacyDemo + '"' };
  eq('allowlist 需要 path+rule+mustContain 三项同时命中',
    isAllowlisted({ path: 'docs/x.md', rule: 'SECRET-101', mustContain: 'legacy-demo-value', reason: 'r' }, f) === true
    && isAllowlisted({ path: 'docs/x.md', rule: 'SECRET-101', mustContain: 'other', reason: 'r' }, f) === false
    && isAllowlisted({ path: 'docs/y.md', rule: 'SECRET-101', mustContain: 'legacy-demo-value', reason: 'r' }, f) === false
    && isAllowlisted({ path: 'docs/**', rule: 'SECRET-101', mustContain: 'legacy-demo-value', reason: 'r' }, f) === true);

  return results;
}

/* ==================== CLI ==================== */

function main() {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');
  const onlySelftest = argv.includes('--selftest');
  const pathArgs = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--paths' && argv[i + 1]) pathArgs.push(argv[i + 1]);
  }

  const st = selftest();
  const stFailed = st.filter((r) => !r.pass);

  if (!wantJson) {
    console.log('== V1.1.3 密钥扫描自证自检 ==');
    console.log('  对抗样本（真实密钥必须命中）与良性样本（不得误报）共 ' + st.length + ' 项');
    for (const r of stFailed) console.log('  ✗ ' + r.name + '  → ' + r.detail);
    console.log('  自检：' + (stFailed.length ? '失败 ' + stFailed.length + ' 项' : '全部通过（' + st.length + '/' + st.length + '）'));
    console.log('');
  }

  if (onlySelftest) {
    if (wantJson) console.log(JSON.stringify({ selftest: st, selftestFailed: stFailed.length }, null, 2));
    process.exit(stFailed.length ? 1 : 0);
  }

  const scans = [];
  if (pathArgs.length) {
    for (const p of pathArgs) scans.push(Object.assign({ root: path.resolve(ROOT, p) }, scan(path.resolve(ROOT, p), {})));
  } else {
    scans.push(Object.assign({ root: ROOT }, scan(ROOT, {})));
  }

  const allFindings = scans.reduce((acc, s) => acc.concat(s.findings), []);
  const scanned = scans.reduce((n, s) => n + s.scanned, 0);

  if (wantJson) {
    console.log(JSON.stringify({
      scanned,
      allowlistSize: scans[0].allowlistSize,
      findings: allFindings,
      selftest: { total: st.length, failed: stFailed.length, failures: stFailed },
      result: (allFindings.length === 0 && stFailed.length === 0) ? 'PASS' : 'FAIL'
    }, null, 2));
    process.exit((allFindings.length === 0 && stFailed.length === 0) ? 0 : 1);
  }

  console.log('== V1.1.3 生产密钥扫描（AUD-14 重做版）==');
  for (const s of scans) {
    console.log('  扫描根：' + (path.relative(ROOT, s.root).replace(/\\/g, '/') || '.'));
    console.log('  文件来源：' + s.source);
    console.log('  文件总数：' + s.files + '（文本文件 ' + s.scanned + ' 个）');
  }
  console.log('  扫描规则：' + HIGH_CONFIDENCE_RULES.length + ' 条高置信度格式 + '
    + CONTEXT_RULES.length + ' 条赋值语境（含良性值过滤）');
  console.log('  allowlist 条目：' + scans[0].allowlistSize + '（窄范围：path + rule + mustContain）');
  console.log('');

  if (allFindings.length) {
    console.log('  命中 ' + allFindings.length + ' 处（判定为泄漏）：');
    for (const f of allFindings) {
      console.log('  ✗ [' + f.rule + '] ' + f.path + ':' + f.line + '  ' + f.label);
      console.log('      ' + f.text);
    }
  } else {
    console.log('  ✓ 未发现任何硬编码凭据 / 密钥 / 私钥。');
  }

  const pass = allFindings.length === 0 && stFailed.length === 0;
  console.log('');
  console.log('  AUD-14 结果：' + (pass ? 'PASS' : 'FAIL')
    + '（命中 ' + allFindings.length + ' 处，自检失败 ' + stFailed.length + ' 项）');
  console.log('  残余限制：扫描只覆盖「源码包内容超集」。部署主机上的 config.json、'
    + '环境变量、进程内存不在本扫描范围内，须由部署清单逐项核对。');
  process.exit(pass ? 0 : 1);
}

module.exports = {
  HIGH_CONFIDENCE_RULES,
  CONTEXT_RULES,
  scanText,
  scan,
  selftest,
  isAllowlisted,
  isBenignValue,
  maskProse
};

if (require.main === module) main();
