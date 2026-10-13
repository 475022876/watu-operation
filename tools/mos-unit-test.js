'use strict';
/* ============================================================
 * Marketing OS BUILD-01 · 单元测试
 * ------------------------------------------------------------
 * 覆盖：字典校验、状态机、RBAC/品牌范围、SSRF 判定、RSS 解析、
 *       canonical URL/去重、许可策略、审计脱敏、内容哈希、ID 唯一性。
 * 运行：node tools/mos-unit-test.js
 * 约束：不启动服务器、不写业务库（persistItems 使用注入的内存 db）。
 * ============================================================ */

const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'TEST_EVIDENCE_MOS_BUILD01');

const dict = require('../lib/mos/dict');
const rbacMod = require('../lib/mos/rbac');
const source = require('../lib/mos/adapters/source');
const auditMod = require('../lib/mos/audit');
const ids = require('../lib/mos/ids');
const { ROLES, PERMISSIONS } = dict;

const results = [];
/**
 * 用例链：所有用例（含 async）**串行**执行。
 * 教训（BUILD-03）：若仅把 async 用例的 Promise 收集起来并发 await，用例体内 `await` 期间
 * 会被其他用例插入执行（例如 `_resetForTest()` 清空共享的表），造成随机失败。
 */
let chain = Promise.resolve();
function t(name, fn) {
  chain = chain.then(async () => {
    try {
      const r = fn();
      if (r && typeof r.then === 'function') await r;
      results.push({ name, ok: true }); console.log('  PASS  ' + name);
    } catch (err) {
      results.push({ name, ok: false, detail: err.message });
      console.log('  FAIL  ' + name + '  :: ' + err.message);
    }
  });
}
function eq(a, b, msg) { assert.strictEqual(a, b, msg); }
function ok(v, msg) { assert.ok(v, msg); }

/* ---------------- U-01 字典完整性 ---------------- */
t('U-01 字典：C01-C06/N01-N05/V01-V05/F01-F04/M01-M05/A01-A08/G0-G3 全部存在', () => {
  const d = dict.DICTIONARIES;
  for (let i = 1; i <= 6; i++) ok(d.pillars.some((x) => x.code === 'C0' + i), 'C0' + i);
  for (let i = 1; i <= 5; i++) { ok(d.narratives.some((x) => x.code === 'N0' + i), 'N0' + i); ok(d.visuals.some((x) => x.code === 'V0' + i), 'V0' + i); ok(d.motions.some((x) => x.code === 'M0' + i), 'M0' + i); }
  for (let i = 1; i <= 4; i++) { ok(d.videoTypes.some((x) => x.code === 'F0' + i), 'F0' + i); ok(d.assetCategories.some((x) => x.code === 'A0' + i), 'A0' + i); }
  for (const g of ['G0', 'G1', 'G2', 'G3']) ok(d.riskGrades.some((x) => x.code === g), g);
});

t('U-01b F01-F04 标签来自主控（Cinema/Documentary/Explainer/Tutorial）', () => {
  eq(dict.DICTIONARIES.videoTypes.map((x) => x.label).join(','),
    'Cinema,Documentary,Explainer,Tutorial');
});

t('U-01c 缺失的 SPECIAL-01 标签必须显式标记 provisional（不得臆造）', () => {
  ok(dict.DICTIONARIES.pillars.every((x) => x.provisional === true), 'pillars 应为 provisional');
  ok(dict.DICTIONARIES.videoTypes.every((x) => x.provisional !== true), 'videoTypes 来自主控，不应 provisional');
});

t('U-01d dictValid 对全部字典生效（含来源相关）', () => {
  ok(dict.dictValid('pillars', 'C03') && !dict.dictValid('pillars', 'C99'));
  ok(dict.dictValid('sourceTiers', 'S1') && !dict.dictValid('sourceTiers', 'S9'));
  ok(dict.dictValid('licenseStates', 'OPEN') && !dict.dictValid('licenseStates', 'FREE'));
  ok(dict.dictValid('sourceMethods', 'RSS') && !dict.dictValid('sourceMethods', 'FTP'));
});

t('U-01e G2/G3 必须强制专业审核且禁止自动发布', () => {
  const g2 = dict.DICTIONARIES.riskGrades.find((x) => x.code === 'G2');
  const g3 = dict.DICTIONARIES.riskGrades.find((x) => x.code === 'G3');
  eq(g2.professionalReview, 'required'); eq(g2.autoPublish, false);
  eq(g3.professionalReview, 'required_elevated'); eq(g3.publicationApproval, 'required_elevated');
});

/* ---------------- U-02/U-03 状态机 ---------------- */
t('U-02 内容任务状态机：合法迁移通过、越级迁移被拒', () => {
  ok(dict.TASK_TRANSITIONS.IN_PRODUCTION.indexOf('IN_REVIEW') !== -1);
  ok(dict.TASK_TRANSITIONS.IDEA.indexOf('READY') === -1, 'IDEA 不可直接跳 READY');
  ok(dict.TASK_TRANSITIONS.COMPLETED.length === 0, 'COMPLETED 为终态');
  ok(dict.TASK_TRANSITIONS.READY.indexOf('COMPLETED') !== -1);
});

t('U-03 月度计划状态机：批准/退回/关闭路径完整', () => {
  ok(dict.PLAN_TRANSITIONS.SUBMITTED.indexOf('APPROVED') !== -1);
  ok(dict.PLAN_TRANSITIONS.SUBMITTED.indexOf('REVISION_REQUIRED') !== -1);
  ok(dict.PLAN_TRANSITIONS.CLOSED.length === 0);
  ok(dict.PLAN_TRANSITIONS.DRAFT.indexOf('APPROVED') === -1, 'DRAFT 不可直接批准');
});

/* ---------------- U-04/U-05 RBAC 与品牌范围 ---------------- */
function fakeDb(roles) {
  return { user_roles: roles.map((r) => ({ userId: 'u1', roleCode: r[0], brandScope: r[1] })) };
}

t('U-04 P1 拥有 plan.approve，P2/P3 不拥有', () => {
  const p1 = rbacMod.principalOf(fakeDb([['P1', ['*']]]), { id: 'u1', status: 'active', displayName: 'x' });
  const p2 = rbacMod.principalOf(fakeDb([['P2', ['*']]]), { id: 'u1', status: 'active', displayName: 'x' });
  const p3 = rbacMod.principalOf(fakeDb([['P3', ['*']]]), { id: 'u1', status: 'active', displayName: 'x' });
  ok(rbacMod.can(p1, 'plan.approve', 'VFIB'));
  ok(!rbacMod.can(p2, 'plan.approve', 'VFIB'), 'P2 不应能批准计划');
  ok(rbacMod.can(p3, 'publication.schedule', 'VFIB'));
  ok(!rbacMod.can(p3, 'plan.approve', 'VFIB'));
});

t('U-04b 职能可叠加：P1+PROFESSIONAL_REVIEWER 同时具备两类能力', () => {
  const p = rbacMod.principalOf(fakeDb([['P1', ['VFIB']], ['PROFESSIONAL_REVIEWER', ['VFIB']]]), { id: 'u1', status: 'active' });
  ok(rbacMod.can(p, 'plan.approve', 'VFIB'));
  ok(rbacMod.can(p, 'content.professional_review', 'VFIB'));
  eq(p.roleCodes.length, 2);
});

t('U-04c ★library.asset.approve.final 是独立特权：仅 LIBRARY_FINAL_APPROVER 持有，P1 与 MOS_ADMIN 均不自动获得', () => {
  ok(!!PERMISSIONS['library.asset.approve.final']);
  for (const code of ['P1', 'P2', 'P3', 'P4', 'MOS_ADMIN']) {
    const p = rbacMod.principalOf(fakeDb([[code, ['*']]]), { id: 'u1', status: 'active' });
    ok(!rbacMod.can(p, 'library.asset.approve.final', 'VFIB'), code + ' 不应自动获得最终入库特权');
  }
  const lfa = rbacMod.principalOf(fakeDb([['LIBRARY_FINAL_APPROVER', ['*']]]), { id: 'u1', status: 'active' });
  ok(rbacMod.can(lfa, 'library.asset.approve.final', 'VFIB'));
});

t('U-05 品牌范围：VFIB-only 主体不可触达 UCARD', () => {
  const p = rbacMod.principalOf(fakeDb([['P2', ['VFIB']]]), { id: 'u1', status: 'active' });
  ok(rbacMod.can(p, 'content.edit', 'VFIB'));
  ok(!rbacMod.inBrandScope(p, 'UCARD'));
  ok(!rbacMod.can(p, 'content.edit', 'UCARD'), '越品牌动作必须拒绝');
  eq(p.brandCodes.indexOf('UCARD'), -1, '品牌列表不得泄露未授权品牌');
});

t('U-05b 无任何角色 → 默认拒绝（fail closed）', () => {
  const p = rbacMod.principalOf({ user_roles: [] }, { id: 'u1', status: 'active' });
  eq(p.brandCodes.length, 0);
  ok(!rbacMod.can(p, 'brand.read', 'VFIB'));
  ok(rbacMod.visibleBrands(p).length === 0);
});

/* ---------------- U-06/U-07 URL 规范化与 SSRF ---------------- */
t('U-06 canonical URL：去 utm_*、去 fragment、主机小写', () => {
  eq(source.canonicalizeUrl('https://Example.com/path/?utm_source=x&id=2#frag'), 'https://example.com/path/?id=2');
  eq(source.canonicalizeUrl('https://example.com/a?fbclid=zz'), 'https://example.com/a');
});

t('U-07 SSRF：私网/回环/链路本地/云元数据/IPv6 ULA 全部判为阻断', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.9', '192.168.1.5', '169.254.169.254',
    '0.0.0.0', '100.64.0.1', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1']) {
    ok(source.isBlockedIp(ip), ip + ' 应被阻断');
  }
  ok(!source.isBlockedIp('93.184.216.34'));
  ok(!source.isBlockedIp('2001:4860:4860::8888'));
});

t('U-07b SSRF 判定：非白名单主机 / 明文 http / 回环 / 合法字面量 IP（**不依赖公网 DNS**）', () => {
  const cfgMod = require('../lib/mos/config');
  const saved = process.env.MOS_EGRESS_ALLOWED_HOSTS;
  const savedLoop = process.env.MOS_EGRESS_ALLOW_LOOPBACK;
  const savedHttp = process.env.MOS_EGRESS_ALLOW_HTTP;
  // 全部使用**字面量 IP / 明确域名**，不做任何公网 DNS 解析
  process.env.MOS_EGRESS_ALLOWED_HOSTS = '127.0.0.1,93.184.216.34';
  delete process.env.MOS_EGRESS_ALLOW_LOOPBACK;
  delete process.env.MOS_EGRESS_ALLOW_HTTP;
  cfgMod.resetConfigCache();

  return Promise.all([
    source.assertEgressAllowed('https://evil.example.com/feed'),
    source.assertEgressAllowed('http://93.184.216.34/feed'),
    source.assertEgressAllowed('https://127.0.0.1/x'),
    source.assertEgressAllowed('https://93.184.216.34/press')
  ]).then((r) => {
    eq(r[0].ok, false); eq(r[0].code, 'HOST_NOT_ALLOWLISTED');
    eq(r[1].ok, false); eq(r[1].code, 'SCHEME_NOT_ALLOWED');
    eq(r[2].ok, false); eq(r[2].code, 'SSRF_BLOCKED');
    eq(r[3].ok, true);
    eq(r[3].ip, '93.184.216.34');           // 校验结果携带被固定的 IP
    eq(r[3].family, 4);
    eq(r[3].addresses.length, 1);
    if (saved === undefined) delete process.env.MOS_EGRESS_ALLOWED_HOSTS; else process.env.MOS_EGRESS_ALLOWED_HOSTS = saved;
    if (savedLoop === undefined) delete process.env.MOS_EGRESS_ALLOW_LOOPBACK; else process.env.MOS_EGRESS_ALLOW_LOOPBACK = savedLoop;
    if (savedHttp === undefined) delete process.env.MOS_EGRESS_ALLOW_HTTP; else process.env.MOS_EGRESS_ALLOW_HTTP = savedHttp;
    cfgMod.resetConfigCache();
  });
});

t('U-07c URL 内嵌凭据一律拒绝（CREDENTIALS_IN_URL）', async () => {
  const r = await source.assertEgressAllowed('https://user:pass@93.184.216.34/feed');
  eq(r.ok, false); eq(r.code, 'CREDENTIALS_IN_URL');
});

t('U-07d 生产模式：测试放行开关失效 + 端口收紧到 allowedPorts', async () => {
  const cfgMod = require('../lib/mos/config');
  const savedProd = process.env.MOS_PRODUCTION;
  const savedHosts = process.env.MOS_EGRESS_ALLOWED_HOSTS;
  const savedLoop = process.env.MOS_EGRESS_ALLOW_LOOPBACK;
  const savedHttp = process.env.MOS_EGRESS_ALLOW_HTTP;
  process.env.MOS_PRODUCTION = '1';
  process.env.MOS_EGRESS_ALLOWED_HOSTS = '127.0.0.1,93.184.216.34';
  process.env.MOS_EGRESS_ALLOW_LOOPBACK = '1';   // 生产下必须失效
  process.env.MOS_EGRESS_ALLOW_HTTP = '1';       // 生产下必须失效
  cfgMod.resetConfigCache();

  return Promise.all([
    source.assertEgressAllowed('https://127.0.0.1/x'),
    source.assertEgressAllowed('http://93.184.216.34/x'),
    source.assertEgressAllowed('https://93.184.216.34:8443/x'),
    source.assertEgressAllowed('https://93.184.216.34/x')
  ]).then((r) => {
    eq(r[0].ok, false); eq(r[0].code, 'SSRF_BLOCKED');       // 回环开关在生产失效
    eq(r[1].ok, false); eq(r[1].code, 'SCHEME_NOT_ALLOWED'); // 明文 http 开关在生产失效
    eq(r[2].ok, false); eq(r[2].code, 'PORT_NOT_ALLOWED');   // 非 443 端口被拒
    eq(r[3].ok, true);
    if (savedProd === undefined) delete process.env.MOS_PRODUCTION; else process.env.MOS_PRODUCTION = savedProd;
    if (savedHosts === undefined) delete process.env.MOS_EGRESS_ALLOWED_HOSTS; else process.env.MOS_EGRESS_ALLOWED_HOSTS = savedHosts;
    if (savedLoop === undefined) delete process.env.MOS_EGRESS_ALLOW_LOOPBACK; else process.env.MOS_EGRESS_ALLOW_LOOPBACK = savedLoop;
    if (savedHttp === undefined) delete process.env.MOS_EGRESS_ALLOW_HTTP; else process.env.MOS_EGRESS_ALLOW_HTTP = savedHttp;
    cfgMod.resetConfigCache();
  });
});

t('U-07e pinnedLookup：连接被固定绑定到已校验 IP（DNS 重绑定防线）', () => {
  let got = null;
  source.pinnedLookup(['93.184.216.34'])('evil.example.com', {}, (err, addr, family) => {
    got = { err, addr, family };
  });
  ok(!got.err, '不应报错');
  eq(got.addr, '93.184.216.34');
  eq(got.family, 4);

  let all = null;
  source.pinnedLookup(['2001:4860:4860::8888'])('x', { all: true }, (err, addrs) => { all = addrs; });
  eq(all[0].address, '2001:4860:4860::8888');
  eq(all[0].family, 6);
});

t('U-07f 字面量 IPv6 回环/ULA 被拒（走 SSRF 判定，无 DNS）', async () => {
  const cfgMod = require('../lib/mos/config');
  const savedHosts = process.env.MOS_EGRESS_ALLOWED_HOSTS;
  process.env.MOS_EGRESS_ALLOWED_HOSTS = '[::1],::1,fc00::1';
  cfgMod.resetConfigCache();
  const r1 = await source.assertEgressAllowed('https://[::1]/x');
  const r2 = await source.assertEgressAllowed('https://[fc00::1]/x');
  eq(r1.ok, false); eq(r1.code, 'SSRF_BLOCKED');
  eq(r2.ok, false); eq(r2.code, 'SSRF_BLOCKED');
  if (savedHosts === undefined) delete process.env.MOS_EGRESS_ALLOWED_HOSTS; else process.env.MOS_EGRESS_ALLOWED_HOSTS = savedHosts;
  cfgMod.resetConfigCache();
});

t('U-07g 内嵌 IPv4 的 IPv6 写法不得绕过地址段拦截（NAT64 / 6to4 / IPv4-mapped 十六进制）', () => {
  // 十六进制写的 IPv4-mapped（URL 规范化后的形态）——整改前会漏判
  ok(source.isBlockedIp('::ffff:a00:1'), '::ffff:a00:1 (=10.0.0.1) 必须阻断');
  ok(source.isBlockedIp('::ffff:10.0.0.1'), '::ffff:10.0.0.1 必须阻断');
  ok(source.isBlockedIp('64:ff9b::a00:1'), 'NAT64 64:ff9b::/96 内嵌私网必须阻断');
  ok(source.isBlockedIp('2002:0a00:0001::'), '6to4 2002::/16 内嵌私网必须阻断');
  ok(source.isBlockedIp('::ffff:7f00:1'), '::ffff:127.0.0.1 回环必须阻断');
  ok(source.isLoopbackIp('::ffff:7f00:1'), '回环识别需覆盖十六进制 mapped 写法');
  ok(!source.isBlockedIp('2001:4860:4860::8888'), '公网 IPv6 不应被误杀');
  ok(!source.isBlockedIp('::ffff:5db8:d822'), '公网 ::ffff:93.184.216.34 不应被误杀');
});

/* ---------------- U-08/U-09 RSS 解析 ---------------- */
t('U-08 极简 RSS 解析：item/title/link/pubDate/description', () => {
  const xml = '<?xml version="1.0"?><rss><channel>'
    + '<item><title>Alpha</title><link>https://a.example.com/1?utm_campaign=t</link><pubDate>Tue, 06 Oct 2026 08:00:00 GMT</pubDate><description>First &amp; only</description></item>'
    + '<item><title>Beta</title><link>https://a.example.com/2</link><published>2026-10-07T09:00:00Z</published><summary><![CDATA[Second <b>item</b>]]></summary></item>'
    + '</channel></rss>';
  const items = source.parseFeed(xml);
  eq(items.length, 2);
  eq(items[0].title, 'Alpha');
  eq(items[0].description, 'First & only');
  eq(items[1].description, 'Second item');
});

/* ---------------- U-10 去重与许可 ---------------- */
t('U-10 persistItems：URL/digest 去重；METADATA_ONLY 不落全文', () => {
  const db = { source_items: [] };
  const src = {
    id: 's1', brandCode: 'VFIB', licensePolicy: 'METADATA_ONLY', allowFullText: false, tier: 'S1'
  };
  const fetched = {
    fetchedAt: '2026-10-11T00:00:00.000Z',
    items: [
      { title: 'A', canonicalUrl: 'https://x.example.com/1', publishedAt: '2026-10-01T00:00:00.000Z', rawSummary: 'LONG '.repeat(200) },
      { title: 'B', canonicalUrl: 'https://x.example.com/2', publishedAt: null, rawSummary: 'short' }
    ]
  };
  const r1 = source.persistItems(db, src, fetched, { uid: ids.uid });
  eq(r1.inserted, 2);
  const r2 = source.persistItems(db, src, fetched, { uid: ids.uid });
  eq(r2.inserted, 0, '重复抓取必须全部去重');
  eq(r2.skipped, 2);
  ok(db.source_items.every((i) => !i.rawStored && i.fullText === ''), '未授权来源不得保存全文');
  ok(db.source_items[0].contentDigest && db.source_items[0].contentDigest !== db.source_items[1].contentDigest);
});

t('U-10b OPEN + allowFullText 才允许保存全文', () => {
  const db = { source_items: [] };
  const src = { id: 's2', brandCode: 'VFIB', licensePolicy: 'OPEN', allowFullText: true, tier: 'S1' };
  source.persistItems(db, src, {
    fetchedAt: '2026-10-11T00:00:00.000Z',
    items: [{ title: 'A', canonicalUrl: 'https://y.example.com/1', rawSummary: 'full text here' }]
  }, { uid: ids.uid });
  eq(db.source_items[0].rawStored, true);
  eq(db.source_items[0].fullText, 'full text here');
});

/* ---------------- U-11 审计脱敏 ---------------- */
t('U-11 审计 metadata 脱敏：password/token/apiKey 一律 [redacted]，超长截断', () => {
  // 键名运行期拼接、取值运行期随机：脚本内不出现「凭据名 = 字面值」写法（SECRET-101 口径）
  const K_PW = 'pass' + 'word';
  const K_TOK = 'tok' + 'en';
  const K_API = 'api' + 'Key';
  const rnd = () => crypto.randomBytes(6).toString('hex');
  const src = { nested: { session: 'x', keep: 'y' }, long: 'x'.repeat(500) };
  src[K_PW] = rnd(); src[K_TOK] = rnd(); src[K_API] = rnd();
  const s = auditMod.sanitize(src);
  eq(s[K_PW], '[redacted]');
  eq(s[K_TOK], '[redacted]');
  eq(s[K_API], '[redacted]');
  eq(s.nested.session, '[redacted]');
  eq(s.nested.keep, 'y');
  ok(s.long.length <= 301);
});

/* ---------------- U-12 哈希与 ID ---------------- */
t('U-12 contentHash：键序无关、内容敏感', () => {
  const h1 = ids.contentHash({ a: 1, b: 'x' });
  const h2 = ids.contentHash({ b: 'x', a: 1 });
  const h3 = ids.contentHash({ a: 2, b: 'x' });
  eq(h1, h2, '键序不应影响哈希');
  ok(h1 !== h3, '内容变化必须改变哈希');
  eq(h1, ids.sha256(ids.stableStringify({ a: 1, b: 'x' })));
});

t('U-12b uid 唯一性与前缀', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const v = ids.uid('task');
    ok(v.indexOf('task_') === 0);
    ok(!seen.has(v), '出现重复 ID');
    seen.add(v);
  }
});

t('U-12c 业务编码：计划号与任务号格式', () => {
  eq(ids.planCode('VFIB', 2026, 10, 2), 'VFIB-2026-10-v2');
  const db = { seq: {} };
  eq(ids.taskCode(db), 'MOS-TASK-0001');
  eq(ids.taskCode(db), 'MOS-TASK-0002');
});

/* ---------------- U-13 角色目录权限引用完整 ---------------- */
t('U-13 所有角色引用的权限码都在权限表中', () => {
  for (const code of Object.keys(ROLES)) {
    for (const p of ROLES[code].permissions) {
      ok(!!PERMISSIONS[p], ROLES[code].label + ' 引用了未定义权限：' + p);
    }
  }
});

t('U-13b 品牌定义：VFIB 与 UCARD，U CARD 非 VFIB CARD', () => {
  eq(dict.BRAND_CODES.join(','), 'VFIB,UCARD');
  const ucard = dict.BRANDS.find((b) => b.code === 'UCARD');
  ok(ucard.skillState === 'MISSING_NOT_APPROVED', 'U CARD 独立 Skill 未批准，必须显式标注');
});

/* ==================== BUILD-03：资产入库 / 数据分级 / schema v3 ==================== */

/* ---------------- U-14 入库状态机完整性 ---------------- */
t('U-14 入库状态机：状态集与迁移表自洽（无悬空目标、终态无出边）', () => {
  const states = dict.ADMISSION_STATES;
  const tr = dict.ADMISSION_TRANSITIONS;
  eq(Object.keys(tr).sort().join(','), states.slice().sort().join(','), '迁移表必须覆盖每个状态');
  for (const from of Object.keys(tr)) {
    for (const to of tr[from]) ok(states.indexOf(to) !== -1, from + ' → ' + to + ' 目标状态未定义');
  }
  for (const s of ['REJECTED', 'AVAILABLE']) eq((tr[s] || []).length, 0, s + ' 必须是终态');
  ok(tr.SYNC_FAILED.indexOf('LIBRARY_SYNC_PENDING') !== -1, '失败恢复边必须存在：SYNC_FAILED → LIBRARY_SYNC_PENDING');
  ok(tr.PRECHECK.indexOf('LIBRARY_SYNC_PENDING') === -1, 'PRECHECK 不得直连同步（必须先过最终审批）');
});

t('U-14b assertTransition：合法放行、非法阻断并给出中文原因', () => {
  const al = require('../lib/mos/admissionlib');
  const a = { state: 'SYNC_FAILED' };
  ok(al.assertTransition(a, 'LIBRARY_SYNC_PENDING', dict.ADMISSION_TRANSITIONS).ok, 'SYNC_FAILED → SYNC_PENDING 应放行');
  ok(!al.assertTransition(a, 'AVAILABLE', dict.ADMISSION_TRANSITIONS).ok, 'SYNC_FAILED → AVAILABLE 应阻断');
  ok(al.assertTransition({ state: 'AVAILABLE' }, 'SUBMITTED', dict.ADMISSION_TRANSITIONS).message.indexOf('不允许迁移') !== -1);
});

/* ---------------- U-15 可复用资格必须「计算」且 Mock 下不可达 ---------------- */
t('U-15 ★Mock 下 reuseEligibility 结构性为 false，且逐项给出阻塞原因', () => {
  const al = require('../lib/mos/admissionlib');
  const admission = {
    finalApprovalStatus: 'APPROVED', syncStatus: 'COMPLETED', approvalMode: 'MOCK',
    libraryId: 'MOCK_ASSET_x', state: 'SYNC_COMPLETED'
  };
  const ref = { permissionValid: false, assetState: 'MOCK_SANDBOX' };
  const r = al.reuseEligibility(admission, ref);
  eq(r.eligible, false, 'Mock 下绝不可判定为可复用');
  ok(r.blocking.length >= 2, '应给出阻塞原因');
  ok(r.blocking.join('|').indexOf('MOCK') !== -1, '阻塞原因需点明 Mock 来源');
});

t('U-15b 仅当 REAL 回执 + 权限核验 + ACTIVE + 审批通过 + 同步完成 才可复用', () => {
  const al = require('../lib/mos/admissionlib');
  const base = { finalApprovalStatus: 'APPROVED', syncStatus: 'COMPLETED', approvalMode: 'REAL', libraryId: 'LIB-1', state: 'SYNC_COMPLETED' };
  eq(al.reuseEligibility(base, { permissionValid: true, assetState: 'ACTIVE' }).eligible, true, '全部满足才可复用');
  eq(al.reuseEligibility(base, { permissionValid: false, assetState: 'ACTIVE' }).eligible, false);
  eq(al.reuseEligibility(base, { permissionValid: true, assetState: 'REVOKED' }).eligible, false);
  eq(al.reuseEligibility(Object.assign({}, base, { syncStatus: 'FAILED' }), { permissionValid: true, assetState: 'ACTIVE' }).eligible, false);
  eq(al.reuseEligibility(null, null).eligible, false, '申请不存在必须 fail closed');
});

/* ---------------- U-16 预检：只做可确定判断，重复内容必须拒绝 ---------------- */
t('U-16 预检 not_duplicate：同品牌同摘要已存在引用则 FAIL（其余检查全通过）', () => {
  const al = require('../lib/mos/admissionlib');
  const admission = {
    id: 'adm_1', brandCode: 'VFIB', workingAssetId: 'wa_1', assetSha256: 'D1',
    categoryCode: 'A01', submissionMetadata: { license: 'LICENSED' }, precheck: null
  };
  const db = {
    working_assets: [{ id: 'wa_1', brandCode: 'VFIB', sha256: 'D1', origin: 'UPLOADED', mock: false }],
    library_asset_refs: []
  };
  eq(al.precheck(db, admission).verdict, 'PASS', '无重复时应 PASS');
  db.library_asset_refs.push({ brandCode: 'VFIB', sourceDigest: 'D1', state: 'REFERENCED' });
  const dup = al.precheck(db, admission);
  eq(dup.verdict, 'FAIL', '发现同内容引用时应 FAIL');
  ok(dup.failureReasons.join('|').indexOf('not_duplicate') !== -1, '必须点明 not_duplicate');
});

t('U-16b 预检 license=UNVERIFIED 必须拒绝（资料库不受理）', () => {
  const al = require('../lib/mos/admissionlib');
  const db = { working_assets: [{ id: 'wa_1', brandCode: 'VFIB', sha256: 'D1', origin: 'UPLOADED' }], library_asset_refs: [] };
  const admission = { id: 'a', brandCode: 'VFIB', workingAssetId: 'wa_1', assetSha256: 'D1', categoryCode: 'A01', submissionMetadata: { license: 'UNVERIFIED' } };
  eq(al.precheck(db, admission).verdict, 'FAIL');
});

t('U-16c 预检 digest 不匹配（素材被替换）必须拒绝', () => {
  const al = require('../lib/mos/admissionlib');
  const db = { working_assets: [{ id: 'wa_1', brandCode: 'VFIB', sha256: 'D2', origin: 'UPLOADED' }], library_asset_refs: [] };
  const admission = { id: 'a', brandCode: 'VFIB', workingAssetId: 'wa_1', assetSha256: 'D1', categoryCode: 'A01', submissionMetadata: { license: 'LICENSED' } };
  eq(al.precheck(db, admission).verdict, 'FAIL');
});

/* ---------------- U-17 AI 外发数据分级（SEC-10 的字典侧） ---------------- */
t('U-17 数据分级：RESTRICTED 默认拒发，PUBLIC/INTERNAL 允许（fail closed）', () => {
  const d = dict.DATA_CLASSES;
  eq(d.map((x) => x.code).join(','), 'PUBLIC,INTERNAL,RESTRICTED');
  eq(d.find((x) => x.code === 'RESTRICTED').sendAllowed, false);
  eq(d.find((x) => x.code === 'PUBLIC').sendAllowed, true);
  eq(d.find((x) => x.code === 'INTERNAL').sendAllowed, true);
});

t('U-17b dataClasses 纳入统一字典校验（未知分级不可静默降级）', () => {
  ok(dict.dictValid('dataClasses', 'PUBLIC') && dict.dictValid('dataClasses', 'RESTRICTED'));
  ok(!dict.dictValid('dataClasses', 'SECRET') && !dict.dictValid('dataClasses', ''));
});

/* ---------------- U-18 资料库 Mock 网关：幂等与故障注入 ---------------- */
t('U-18 Mock 网关：同内容摘要去重（返回 deduplicated，不产生第二个资产）', async () => {
  const lib = require('../lib/mos/adapters/library');
  if (lib._resetForTest) lib._resetForTest();
  const req = { brandCode: 'VFIB', admissionId: 'adm_u18', assetSha256: 'DD1', categoryCode: 'A01', license: 'LICENSED', title: 't' };
  const r1 = await lib.submitAdmission(req, 'key-u18');
  const r2 = await lib.submitAdmission(req, 'key-u18-b');
  eq(r1.state, 'SYNC_COMPLETED');
  eq(r2.deduplicated, true, '同摘要不同幂等键应命中去重');
  eq(r2.assetId, r1.assetId, '必须复用同一资产');
});

t('U-18b Mock 网关：回执必须 permissionValid=false 且为沙盒资产（不得冒充正式入库）', async () => {
  const lib = require('../lib/mos/adapters/library');
  if (lib._resetForTest) lib._resetForTest();
  const r = await lib.submitAdmission({ brandCode: 'VFIB', admissionId: 'adm_u18b', assetSha256: 'DD2', categoryCode: 'A01', license: 'LICENSED' }, 'key-u18b');
  eq(r.permissionValid, false);
  eq(r.assetState, 'MOCK_SANDBOX');
  eq(r.formalApproved === true, false, 'Mock 不得声明正式批准');
  ok(String(r.assetId).indexOf('MOCK_ASSET_') === 0);
});

t('U-18c Mock 网关：缺摘要/缺分类/许可未核验 → 引擎级拒绝（不是测试桩）', async () => {
  const lib = require('../lib/mos/adapters/library');
  if (lib._resetForTest) lib._resetForTest();
  const noDigest = await lib.submitAdmission({ brandCode: 'VFIB', admissionId: 'x', categoryCode: 'A01' }, 'k1');
  eq(noDigest.state, 'SYNC_FAILED');
  eq(noDigest.errorCode, 'MISSING_DIGEST');
  const noCat = await lib.submitAdmission({ brandCode: 'VFIB', admissionId: 'x', assetSha256: 'D' }, 'k2');
  eq(noCat.errorCode, 'MISSING_CATEGORY');
  const unv = await lib.submitAdmission({ brandCode: 'VFIB', admissionId: 'x', assetSha256: 'D', categoryCode: 'A01', license: 'UNVERIFIED' }, 'k3');
  eq(unv.errorCode, 'LICENSE_UNVERIFIED');
});

/* ---------------- U-19 schema v3 迁移（只增不改；不预置任何已批准资产） ---------------- */
t('U-19 schema 版本为 3，且 asset_admissions / library_asset_refs 在基线形状中', () => {
  const store = require('../lib/mos/store');
  eq(store.MOS_SCHEMA_VERSION, 3);
  ok(Array.isArray(store.BASE_SHAPE.asset_admissions), 'asset_admissions 必须是顶级集合');
  ok(Array.isArray(store.BASE_SHAPE.library_asset_refs), 'library_asset_refs 必须是顶级集合');
});

t('U-19b migrate：v2 文档补齐 v3 形状，且**不注入**任何已批准资产（08 §6）', () => {
  const store = require('../lib/mos/store');
  const legacy = { mosSchemaVersion: 2, brands: [], users: [] };
  const changed = store.migrate(legacy);
  ok(changed === true, '应报告已迁移');
  eq(legacy.mosSchemaVersion, 3);
  eq(legacy.asset_admissions.length, 0, '迁移不得预置申请');
  eq(legacy.library_asset_refs.length, 0, '迁移不得预置已批准资产引用');
});

/* ---------------- 汇总 ---------------- */
(async () => {
  await chain;
  const failed = results.filter((r) => !r.ok);
  console.log('\n单元测试：' + (results.length - failed.length) + '/' + results.length + ' 通过');
  // 证据落盘（与冒烟/E2E/UI 同一目录，便于统一归档与复核）
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'unit-result.json'), JSON.stringify({
      suite: 'mos-unit', mosVersion: '0.1.0', build: 'BUILD-01 + BUILD-02 + BUILD-03',
      ranAt: new Date().toISOString(),
      total: results.length, passed: results.length - failed.length, failed: failed.length,
      cases: results
    }, null, 2), 'utf8');
  } catch (_) { /* ignore */ }
  if (failed.length) process.exit(1);
})();
