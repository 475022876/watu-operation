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
/* V1.1 B1：预检新增三项 Provider 必填字段检查，故测试夹具必须显式给出枚举值。
 * V1.1 提供方答复 D-06.5：`reuseScope` 缺省/`none` 会被 Provider 预检判「无复用意义」→
 * REVISION_REQUIRED，而该状态**无重提入口**（B-4）→ 申请永久卡死。故本侧预检亦将其列为硬条件，
 * 夹具必须显式给出**非 none** 的复用范围。 */
const ADM_FIELDS = {
  libraryPrimaryCategory: '02', classification: 'internal',
  licenseStatus: 'cleared', reuseScope: 'campaign_reuse'
};

t('U-16 预检 not_duplicate：同品牌同摘要已存在引用则 FAIL（其余检查全通过）', () => {
  const al = require('../lib/mos/admissionlib');
  const admission = Object.assign({
    id: 'adm_1', brandCode: 'VFIB', workingAssetId: 'wa_1', assetSha256: 'D1',
    categoryCode: 'A01', submissionMetadata: { license: 'LICENSED' }, precheck: null
  }, ADM_FIELDS);
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

t('U-16b 预检 license 待人工核定（历史自由文本保守转 unknown）必须拒绝', () => {
  const al = require('../lib/mos/admissionlib');
  const db = { working_assets: [{ id: 'wa_1', brandCode: 'VFIB', sha256: 'D1', origin: 'UPLOADED' }], library_asset_refs: [] };
  const admission = Object.assign({
    id: 'a', brandCode: 'VFIB', workingAssetId: 'wa_1', assetSha256: 'D1', categoryCode: 'A01',
    submissionMetadata: { license: 'UNVERIFIED' }, licenseNeedsManualReview: true, licenseLegacyText: 'UNVERIFIED'
  }, ADM_FIELDS);
  eq(al.precheck(db, admission).verdict, 'FAIL');
});

t('U-16b2 预检缺 libraryPrimaryCategory / classification 必须拒绝（不得猜测补齐）', () => {
  const al = require('../lib/mos/admissionlib');
  const db = { working_assets: [{ id: 'wa_1', brandCode: 'VFIB', sha256: 'D1', origin: 'UPLOADED' }], library_asset_refs: [] };
  const noPrimary = Object.assign({
    id: 'a', brandCode: 'VFIB', workingAssetId: 'wa_1', assetSha256: 'D1', categoryCode: 'A01', submissionMetadata: {}
  }, ADM_FIELDS, { libraryPrimaryCategory: null });
  eq(al.precheck(db, noPrimary).verdict, 'FAIL', '缺资料区必须 FAIL');
  const noClass = Object.assign({}, noPrimary, { libraryPrimaryCategory: '02', classification: null });
  eq(al.precheck(db, noClass).verdict, 'FAIL', '缺密级必须 FAIL');
  const incomplete = al.providerFieldsComplete(noClass);
  eq(incomplete.complete, false);
  ok(incomplete.missing.indexOf('classification') !== -1, '必须点名缺失字段');
});

/* V1.1 提供方答复 D-06.5：reuseScope 缺省 / none 会让申请在 Provider 侧永久卡死 → 预检必须 FAIL */
t('U-16b4 预检 reuseScope 缺省 / none 必须 FAIL（D-06.5：否则申请在资料库侧永久卡死）', () => {
  const al = require('../lib/mos/admissionlib');
  const db = { working_assets: [{ id: 'wa_1', brandCode: 'VFIB', sha256: 'D1', origin: 'UPLOADED' }], library_asset_refs: [] };
  const base = {
    id: 'a', brandCode: 'VFIB', workingAssetId: 'wa_1', assetSha256: 'D1', categoryCode: 'A01', submissionMetadata: {}
  };
  const noReuse = Object.assign({}, base, ADM_FIELDS, { reuseScope: undefined });
  const r1 = al.precheck(db, noReuse);
  eq(r1.verdict, 'FAIL', '缺 reuseScope 必须 FAIL');
  ok(r1.failureReasons.join('|').indexOf('reuse_scope_usable') !== -1, '必须点明 reuse_scope_usable');

  const noneReuse = Object.assign({}, base, ADM_FIELDS, { reuseScope: 'none' });
  const r2 = al.precheck(db, noneReuse);
  eq(r2.verdict, 'FAIL', 'reuseScope=none 必须 FAIL');
  ok(al.reuseScopeUsable({ reuseScope: 'none' }).reason === 'REUSE_SCOPE_NONE', 'reason 必须可审计');
  ok(al.reuseScopeUsable({}).reason === 'MISSING_REUSE_SCOPE', '缺失与 none 必须区分');
  eq(al.reuseScopeUsable({ reuseScope: 'campaign_reuse' }).ok, true);
});

/* V1.1 提供方答复 D-06.4：licenseStatus ∈ {expired, unknown} 会被 Provider 预检阻断入库 */
t('U-16b5 预检 licenseStatus=unknown / expired 必须 FAIL，并说明是「人工确认闸门」而非占位值', () => {
  const al = require('../lib/mos/admissionlib');
  const db = { working_assets: [{ id: 'wa_1', brandCode: 'VFIB', sha256: 'D1', origin: 'UPLOADED' }], library_asset_refs: [] };
  const base = {
    id: 'a', brandCode: 'VFIB', workingAssetId: 'wa_1', assetSha256: 'D1', categoryCode: 'A01', submissionMetadata: {}
  };
  const unk = Object.assign({}, base, ADM_FIELDS, { licenseStatus: 'unknown' });
  const r = al.precheck(db, unk);
  eq(r.verdict, 'FAIL', 'unknown 必须 FAIL（无法完成准入）');
  ok(r.failureReasons.join('|').indexOf('license_admissible') !== -1, '必须点明 license_admissible');
  eq(al.licenseAdmissionGate({ licenseStatus: 'expired' }).blocking, true);
  eq(al.licenseAdmissionGate({ licenseStatus: 'cleared' }).blocking, false);
});

t('U-16b3 normalizeProviderFields：自由文本许可绝不映射为 cleared，一律保守转 unknown', () => {
  const al = require('../lib/mos/admissionlib');
  const r = al.normalizeProviderFields({ libraryPrimaryCategory: '02', classification: 'internal', licenseStatus: 'INTERNAL_DRAFT' });
  eq(r.value.licenseStatus, 'unknown', '自由文本必须保守转 unknown');
  eq(r.value.licenseNeedsManualReview, true, '必须标记待人工核定');
  eq(r.ok, false, '自由文本不得视为合法入参');
  // 显式声明 unknown 是合法值（用户明确选择，不是猜测）
  const explicit = al.normalizeProviderFields({ libraryPrimaryCategory: '02', classification: 'internal', licenseStatus: 'unknown' });
  eq(explicit.ok, true);
  eq(explicit.value.licenseNeedsManualReview, false);
  // 密级不接受猜测：为空必须 missing，不提供默认值
  const noClass = al.normalizeProviderFields({ libraryPrimaryCategory: '02', classification: '', licenseStatus: 'cleared' });
  eq(noClass.ok, false);
  ok(noClass.missing.indexOf('classification') !== -1);
});

t('U-16b4 toProviderAdmissionInput：不发送 originSystem（服务端强制覆写），且字段名与契约一致', () => {
  const al = require('../lib/mos/admissionlib');
  const body = al.toProviderAdmissionInput(Object.assign({
    id: 'adm_1', brandCode: 'VFIB', workingAssetId: 'wa_1', assetSha256: 'a'.repeat(64),
    categoryCode: 'A01', submissionMetadata: { title: 'T' }, idempotencyKey: 'k-1'
  }, ADM_FIELDS));
  eq(body.originSystem, undefined, '不得自报 originSystem');
  eq(body.brandId, 'VFIB');
  eq(body.libraryPrimaryCategory, '02');
  eq(body.classification, 'internal');
  eq(body.licenseStatus, 'cleared');
  eq(body.marketingCategory, 'A01');
  eq(body.contentHash, 'a'.repeat(64));
  ok(!/[^A-Za-z0-9_.:-]/.test(body.originObjectId), 'originObjectId 必须满足服务端 ID_RE');
});

t('U-16c 预检 digest 不匹配（素材被替换）必须拒绝', () => {
  const al = require('../lib/mos/admissionlib');
  const db = { working_assets: [{ id: 'wa_1', brandCode: 'VFIB', sha256: 'D2', origin: 'UPLOADED' }], library_asset_refs: [] };
  const admission = Object.assign({
    id: 'a', brandCode: 'VFIB', workingAssetId: 'wa_1', assetSha256: 'D1', categoryCode: 'A01', submissionMetadata: { license: 'LICENSED' }
  }, ADM_FIELDS);
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

/* ---------------- U-19 schema v3/v4/v5 迁移（只增不改；不预置任何已批准资产/作业） ---------------- */
t('U-19 schema 版本为 7（v7=V0.1.2 研究域 4 集合；v6=用户偏好；v3—v5 迁移保留）且 asset_admissions / library_asset_refs / ingest_jobs / 四项集成态集合在基线形状中', () => {
  const store = require('../lib/mos/store');
  eq(store.MOS_SCHEMA_VERSION, 7);
  ok(Array.isArray(store.BASE_SHAPE.asset_admissions), 'asset_admissions 必须是顶级集合');
  ok(Array.isArray(store.BASE_SHAPE.library_asset_refs), 'library_asset_refs 必须是顶级集合');
  ok(Array.isArray(store.BASE_SHAPE.ingest_jobs), 'ingest_jobs 必须是顶级集合（A-01 采集作业记录）');
  // V1.1 B2/B3：集成态四集合（票据元数据 / 事件游标 / 失效登记 / 准入作业）
  ok(Array.isArray(store.BASE_SHAPE.library_tickets), 'library_tickets 必须是顶级集合（票据**元数据**，不含密文）');
  ok(Array.isArray(store.BASE_SHAPE.library_event_cursors), 'library_event_cursors 必须是顶级集合（持久化 seq 游标）');
  ok(Array.isArray(store.BASE_SHAPE.library_invalidations), 'library_invalidations 必须是顶级集合（撤回/停用失效登记）');
  ok(Array.isArray(store.BASE_SHAPE.library_admission_jobs), 'library_admission_jobs 必须是顶级集合（准入推送作业记录）');
});

t('U-19b migrate：v2 文档补齐 v3—v7 形状，且**不注入**任何已批准资产或作业记录（08 §6）', () => {
  const store = require('../lib/mos/store');
  const legacy = { mosSchemaVersion: 2, brands: [], users: [{ id: 'u1', username: 'legacy' }] };
  const changed = store.migrate(legacy);
  ok(changed === true, '应报告已迁移');
  eq(legacy.mosSchemaVersion, 7);
  ok(legacy.users[0].prefs && typeof legacy.users[0].prefs === 'object', 'v6：用户必须获得 prefs 对象');
  eq(legacy.users[0].prefs.locale, null, 'v6：locale 缺省 null（未设置，前端回落组织默认）');
  eq(legacy.users[0].prefs.lastTaskId, null, 'v6：lastTaskId 缺省 null');
  eq(legacy.asset_admissions.length, 0, '迁移不得预置申请');
  eq(legacy.library_asset_refs.length, 0, '迁移不得预置已批准资产引用');
  eq(legacy.ingest_jobs.length, 0, '迁移不得预置采集作业记录');
  eq(legacy.library_tickets.length, 0, '迁移不得预置票据元数据');
  eq(legacy.library_event_cursors.length, 0, '迁移不得预置事件游标');
  eq(legacy.library_invalidations.length, 0, '迁移不得预置失效登记');
  eq(legacy.library_admission_jobs.length, 0, '迁移不得预置准入作业记录');
});

t('U-19c v3 → v5 迁移幂等且只新增集合，既有业务集合零改写', () => {
  const store = require('../lib/mos/store');
  const doc = {
    mosSchemaVersion: 3,
    campaigns: [{ id: 'c1', title: '既有 Campaign' }],
    master_topics: [{ id: 't1' }],
    source_registry: [{ id: 'src1' }],
    source_items: [{ id: 'si1' }],
    publication_records: [{ id: 'p1' }],
    review_cases: [{ id: 'r1' }],
    asset_admissions: [{ id: 'ad1' }]
  };
  // 注意：`asset_admissions` **有意**被 v4→v5 保守回填（见 U-19d），故不在"零改写"集合内；
  // 这里约束的是其余业务集合必须逐字节不变，且申请行的**身份与既有键**不得丢失。
  const zeroRewrite = () => JSON.stringify({
    campaigns: doc.campaigns, master_topics: doc.master_topics, source_registry: doc.source_registry,
    source_items: doc.source_items, publication_records: doc.publication_records,
    review_cases: doc.review_cases
  });
  const before = zeroRewrite();
  store.migrate(doc);
  eq(zeroRewrite(), before, '既有业务集合与内容必须零改写');
  eq(doc.mosSchemaVersion, 7);
  eq(doc.ingest_jobs.length, 0);
  eq(doc.library_tickets.length, 0);
  eq(doc.library_event_cursors.length, 0);
  eq(doc.library_invalidations.length, 0);
  eq(doc.library_admission_jobs.length, 0);
  eq(doc.asset_admissions.length, 1, '申请行不得被删除');
  eq(doc.asset_admissions[0].id, 'ad1', '申请行身份不得被改写');
  const second = store.migrate(doc);
  eq(second, false, '二次迁移应报告无变更（幂等）');
});

t('U-19d v4 → v5 保守回填：不猜测密级、自由文本许可绝不映射 cleared、标记待人工核定', () => {
  const store = require('../lib/mos/store');
  const doc = {
    mosSchemaVersion: 4,
    asset_admissions: [
      { id: 'ad-old', state: 'SUBMITTED', submissionMetadata: { title: '历史申请', license: 'INTERNAL_DRAFT' } },
      // 已带 v5 标记的行必须**原样保留**（幂等，不重复回填）
      { id: 'ad-new', admissionFieldsSchema: 5, libraryPrimaryCategory: '03', classification: 'executive', licenseStatus: 'cleared' }
    ]
  };
  store.migrate(doc);
  eq(doc.mosSchemaVersion, 7);
  const old = doc.asset_admissions.find((a) => a.id === 'ad-old');
  eq(old.libraryPrimaryCategory, null, '资料区**不得猜测**');
  eq(old.classification, null, '密级**不得猜测降级**');
  eq(old.licenseStatus, 'unknown', '自由文本许可绝不映射为 cleared');
  eq(old.licenseLegacyText, 'INTERNAL_DRAFT', '原始许可文本必须留痕');
  eq(old.needsManualReview, true, '必须标记待人工核定');
  eq(old.admissionFieldsSchema, 5);
  const fresh = doc.asset_admissions.find((a) => a.id === 'ad-new');
  eq(fresh.classification, 'executive', '已带 v5 标记的行不得被改写');
  eq(fresh.licenseStatus, 'cleared', '已带 v5 标记的行不得被改写');
  const again = store.migrate(doc);
  eq(again, false, '回填幂等：已迁移文档二次调用不产生变更');
});

/* ---------------- U-20 S04 Marketing Brief（A-02）与共享组件（M-01/M-02/M-03） ---------------- */
const brieflib = require('../lib/mos/brieflib');

/** 构造最小 db 桩：只包含 brieflib 核验所需集合 */
function briefDb() {
  return {
    evidence_references: [
      { id: 'ev-verified', verificationState: 'VERIFIED' },
      { id: 'ev-missing', verificationState: 'MISSING' }
    ],
    library_asset_refs: [
      { id: 'lar-mock', admissionId: 'adm-mock', permissionValid: false, assetState: 'ACTIVE', mock: true }
    ],
    asset_admissions: [
      { id: 'adm-mock', finalApprovalStatus: 'PENDING', syncStatus: 'NOT_STARTED', approvalMode: 'MOCK', libraryId: null }
    ]
  };
}

t('U-20 品牌 Marketing Brief 模板存在，且**不预置任何产品宣称**（A-02）', () => {
  const tpl = dict.MARKETING_BRIEF_TEMPLATES;
  ok(tpl.VFIB && tpl.UCARD, 'VFIB / UCARD 都应有模板');
  eq(tpl.VFIB.templateCode, 'VFIB_BANKING');
  eq(tpl.UCARD.templateCode, 'UCARD_MARKETING');
  for (const k of ['VFIB', 'UCARD']) {
    ok(tpl[k].productClaims === undefined, k + ' 模板不得包含产品宣称');
    ok(typeof tpl[k].regionComplianceNote === 'string' && tpl[k].regionComplianceNote.length > 0, k + ' 必须有合规提醒');
    // 不得预置关于费用/收益/发卡/可用国家的能力承诺
    const blob = tpl[k].regionComplianceNote + (tpl[k].objectives || []).join(' ');
    ok(/禁止|不得/.test(blob), k + ' 模板应显式禁止未经核准的承诺');
  }
});

t('U-20b normalizeMarketingBrief：未关联来源的宣称一律 UNVERIFIED，且阻断正式输出', () => {
  const r = brieflib.normalizeMarketingBrief(briefDb(), {
    templateCode: 'VFIB_BANKING',
    objectives: ['目标一', '', '目标二'],
    productClaims: [{ text: '无来源宣称' }]
  }, 'VFIB');
  eq(r.productClaims.length, 1);
  eq(r.productClaims[0].verification, 'UNVERIFIED');
  eq(r.readyForOfficialUse, false, '存在未核验宣称时不得用于正式输出');
  eq(r.claimSummary.unverified, 1);
  eq(r.objectives.length, 2, '空行应被清理');
  eq(r.isTemplate, false);
});

t('U-20c 只有真实已核验证据才可让宣称 VERIFIED；Mock 资料库/知识库恒不可核验', () => {
  const db = briefDb();
  eq(brieflib.evaluateClaims(db, [{ text: 'a', sourceKind: 'EVIDENCE', sourceRef: 'ev-verified' }])[0].verification, 'VERIFIED');
  eq(brieflib.evaluateClaims(db, [{ text: 'a', sourceKind: 'EVIDENCE', sourceRef: 'ev-missing' }])[0].verification, 'UNVERIFIED');
  eq(brieflib.evaluateClaims(db, [{ text: 'a', sourceKind: 'LIBRARY', sourceRef: 'lar-mock' }])[0].verification, 'UNVERIFIED');
  eq(brieflib.evaluateClaims(db, [{ text: 'a', sourceKind: 'KNOWLEDGE', sourceRef: 'k-1' }])[0].verification, 'UNVERIFIED');
  eq(brieflib.evaluateClaims(db, [{ text: 'a', sourceKind: 'UNKNOWN', sourceRef: 'x' }])[0].verification, 'UNVERIFIED');
});

t('U-20d productRefs：已核准资料引用同样由服务端计算核验状态', () => {
  const refs = brieflib.evaluateRefs(briefDb(), [
    { refId: 'lar-mock', sourceKind: 'LIBRARY', label: '产品手册' },
    { refId: '', sourceKind: 'LIBRARY' }
  ]);
  eq(refs.length, 1, '空 refId 应被丢弃');
  eq(refs[0].verification, 'UNVERIFIED');
  ok(/不可复用/.test(refs[0].reason), 'Mock 条目应给出不可复用原因');
});

t('U-20e 全部宣称已核验时 readyForOfficialUse=true（可达，但 Mock 下不可达）', () => {
  const r = brieflib.normalizeMarketingBrief(briefDb(), {
    productClaims: [{ text: 'ok', sourceKind: 'EVIDENCE', sourceRef: 'ev-verified' }]
  }, 'VFIB');
  eq(r.claimSummary.verified, 1);
  eq(r.readyForOfficialUse, true);
});

t('U-20f defaultMarketingBrief：按品牌回落到模板默认，且不带任何宣称', () => {
  const d = brieflib.defaultMarketingBrief('UCARD');
  eq(d.templateCode, 'UCARD_MARKETING');
  eq(d.productClaims.length, 0);
  eq(d.readyForOfficialUse, true);
  eq(d.isTemplate, true);
});

t('U-20g Campaign 序列化器统一形状（M-03 / F-05：进展视图数据源一致）', () => {
  // 不启动服务器：直接校验路由模块导出的序列化器契约
  const campaignsRoute = require('../lib/mos/routes/campaigns');
  ok(typeof campaignsRoute.serialize === 'function', 'campaigns 路由应导出 serialize');
  const tasksRoute = require('../lib/mos/routes/tasks');
  ok(typeof tasksRoute.serialize === 'function', 'tasks 路由应导出 serialize（供 Topic/Campaign 复用）');
});

t('U-20h 共享组件文件存在且导出契约齐备（M-01 / M-02 / M-03）', () => {
  const fsMod = require('node:fs');
  const compDir = path.join(ROOT, 'public', 'mos', 'js', 'components');
  const expect = {
    'reviewkit.js': ['caseTypeLabel', 'decisionButtons', 'openReviewCase', 'decideReviewCase', 'reviewHistoryTable'],
    'assetkit.js': ['fetchApprovedAssets', 'fetchLibraryAssetRefs', 'governanceAssetsHtml', 'brandReferenceHtml'],
    'taskkit.js': ['fetchTasks', 'taskTable', 'openCreateTaskDialog', 'openTaskDetail'],
    'campaignkit.js': ['fetchCampaigns', 'openCampaignDetail', 'campaignTableHtml', 'fetchBriefTemplates']
  };
  for (const file of Object.keys(expect)) {
    const p = path.join(compDir, file);
    ok(fsMod.existsSync(p), file + ' 必须存在');
    const src = fsMod.readFileSync(p, 'utf8');
    for (const sym of expect[file]) ok(src.indexOf('export function ' + sym) !== -1 || src.indexOf('export async function ' + sym) !== -1
      || src.indexOf('export const ' + sym) !== -1, file + ' 应导出 ' + sym);
  }
});

/* ---------------- U-21 专业字典 provisional 核验（F-07） ---------------- */
const dictVerify = require('../lib/mos/dictverify');

function verifyDb() {
  return { mosSchemaVersion: 4, settings: {}, audit_events: [] };
}

t('U-21 provisional 项全部登记在册，且归属权威原件（SPECIAL-01 V1.1 / Visual Skill V1.2）', () => {
  const rows = dictVerify.registry(null);
  ok(rows.length >= 30, '待核验项数量应 ≥30，实际 ' + rows.length);
  const keys = new Set(rows.map((r) => r.dictKey));
  for (const k of ['pillars', 'narratives', 'visuals', 'motions', 'assetCategories', 'templateCodes', 'displays']) {
    ok(keys.has(k), '登记表应覆盖 ' + k);
  }
  for (const r of rows) {
    ok(r.sourceDocument === 'SPECIAL_01' || r.sourceDocument === 'VISUAL_SKILL_V12',
      r.dictKey + ':' + r.code + ' 应归属受控原件，实际 ' + r.sourceDocument);
    ok(r.sourceVersionRequired === 'V1.1' || r.sourceVersionRequired === 'V1.2',
      r.dictKey + ':' + r.code + ' 应给出原件版本');
  }
});

t('U-21b 未取得原件时：所有 provisional 项保持「待核验」，不存在被伪造的官方标签', () => {
  const rows = dictVerify.registry(null);
  const dict = require('../lib/mos/dict');
  ok(rows.every((r) => r.status === 'UNVERIFIED'), '所有项都应是 UNVERIFIED');
  ok(rows.every((r) => !r.sourceVersion && !r.evidenceRef), '未核验项不得带来源版本/证据引用');
  // 字典里 provisional 项的显示名必须仍是「待核验」——不得凭 AI 创作填成正式名
  for (const k of dictVerify.PROVISIONAL_KEYS) {
    for (const e of dict.DICTIONARIES[k]) {
      ok(e.provisional === true, k + ':' + e.code + ' 应为 provisional');
      ok(e.label === '待核验', k + ':' + e.code + ' 的标签必须是「待核验」，实际 ' + e.label);
      ok(e.source === 'provisional', k + ':' + e.code + ' 的 source 必须是 provisional');
    }
  }
});

t('U-21c 权威原件登记如实声明「本轮未随包提供」（不得含糊）', () => {
  const s = dictVerify.summary(null);
  ok(s.sourceDocuments.length === 2, '应有 2 份权威原件登记');
  ok(s.sourceDocuments.every((d) => d.providedToDev === false), '本轮两件原件都未随包提供');
  ok(s.sourceDocuments.some((d) => /SPECIAL|指导手册/.test(d.title)), '应登记 SPECIAL-01 手册');
  ok(s.sourceDocuments.some((d) => /Visual Brand Guardian/.test(d.title)), '应登记 Visual Skill V1.2');
});

t('U-21d 配置只给字符串标签 → 仅改显示名，条目**仍然待核验**（封堵"一行配置洗成正式"）', () => {
  const entries = dict.DICTIONARIES.pillars.slice(0, 2);
  const res = dictVerify.applyOverrides('pillars', entries, { C01: '假设的栏目名' });
  const c01 = res.items.find((e) => e.code === 'C01');
  eq(c01.label, '假设的栏目名', '显示名应被覆盖');
  eq(c01.provisional, true, 'provisional 必须保持 true');
  eq(c01.source, 'config_unverified', '来源应标为 config_unverified');
  eq(c01.verificationRejected, 'EVIDENCE_REQUIRED', '应记录被拒原因');
  eq(res.rejected.length, 1, '应产生 1 条被拒记录');
  eq(c01.provisional === false, false, '绝不允许变为正式');
});

t('U-21e 缺证据的"核验"一律拒绝：只给 sourceVersion 或只给 evidenceRef 都不行', () => {
  const onlyVersion = dictVerify.validateEvidence('pillars', { sourceVersion: 'V1.1' });
  ok(!onlyVersion.ok && onlyVersion.code === 'MISSING_EVIDENCE_REF', '缺证据引用应被拒');
  const onlyEvidence = dictVerify.validateEvidence('pillars', { evidenceRef: 'p.12' });
  ok(!onlyEvidence.ok && onlyEvidence.code === 'MISSING_SOURCE_VERSION', '缺来源版本应被拒');
  const noFlag = dictVerify.validateEvidence('pillars', { sourceVersion: 'V1.1', evidenceRef: 'p.12' });
  ok(!noFlag.ok && noFlag.code === 'ORIGINAL_NOT_PROVIDED', '未声明已取得原件时应被拒');
  const good = dictVerify.validateEvidence('pillars', { sourceVersion: 'V1.1', evidenceRef: 'p.12', confirmedOriginalProvided: 'true' });
  ok(good.ok, '证据齐备且声明已取得原件时应通过：' + JSON.stringify(good));
});

t('U-21f 证据齐备时才标记为已核验，并把来源版本 + 证据引用写回条目（可追溯）', () => {
  const entries = dict.DICTIONARIES.narratives.slice(0, 1);
  const res = dictVerify.applyOverrides('narratives', entries, {
    N01: { label: '正式叙事名（示例）', sourceVersion: 'V1.1', evidenceRef: 'SPECIAL-01 §3.2 p.12', confirmedOriginalProvided: 'true' }
  });
  const n01 = res.items[0];
  eq(n01.label, '正式叙事名（示例）', '应录入正式名称');
  eq(n01.provisional, false, '证据齐备才可置非 provisional');
  eq(n01.source, 'SPECIAL_01@V1.1', '来源应带原件版本');
  eq(n01.evidenceRef, 'SPECIAL-01 §3.2 p.12', '应保留证据引用');
  ok(!!n01.verifiedAt, '应记录核验时间');
});

t('U-21g 运行时核验登记：缺证据被拒且不写库；证据齐备则写入并可汇总/撤销', () => {
  const db = verifyDb();
  const bad = dictVerify.verify(db, { dictKey: 'visuals', code: 'V01', label: '正式视觉名' });
  ok(!bad.ok && bad.code === 'MISSING_SOURCE_VERSION', '缺来源版本应被拒：' + JSON.stringify(bad));
  ok(!db.settings.dictionaryVerifications, '被拒时不得写入任何记录');

  const noLabel = dictVerify.verify(db, {
    dictKey: 'visuals', code: 'V01', label: '待核验',
    sourceVersion: 'V1.2', evidenceRef: 'hash-abc', confirmedOriginalProvided: 'true'
  });
  ok(!noLabel.ok && noLabel.code === 'MISSING_LABEL', '核验通过必须给出正式名称');

  const good = dictVerify.verify(db, {
    dictKey: 'visuals', code: 'V01', label: '正式视觉语言名（示例）',
    sourceVersion: 'V1.2', evidenceRef: 'VisualSkill V1.2 §4 hash-abc',
    confirmedOriginalProvided: 'true', verifiedById: 'u_demo', verifiedByName: '示例核验人'
  });
  ok(good.ok, '证据齐备应登记成功：' + JSON.stringify(good));
  const rows = dictVerify.registry(db);
  const v01 = rows.find((r) => r.dictKey === 'visuals' && r.code === 'V01');
  eq(v01.status, 'VERIFIED', 'V01 应变为已核验');
  eq(v01.sourceVersion, 'V1.2', '应记录来源版本');
  eq(v01.verifiedBy, 'u_demo', '应记录核验人');
  eq(dictVerify.summary(db).unverified, rows.length - 1, '未核验数应减少 1');

  const rv = dictVerify.unverify(db, 'visuals', 'V01');
  ok(rv.ok, '应可撤销核验');
  const back = dictVerify.registry(db).find((r) => r.dictKey === 'visuals' && r.code === 'V01');
  eq(back.status, 'UNVERIFIED', '撤销后应回到待核验');
});

t('U-21h 字典 API 输出不含任何伪造正式标签，且给出覆盖拒绝审计', () => {
  const helpers = require('../lib/mos/routes/helpers');
  const d = helpers.dictionaries(null);
  for (const k of dictVerify.PROVISIONAL_KEYS) {
    ok(Array.isArray(d[k]) && d[k].length > 0, k + ' 应返回条目');
    for (const e of d[k]) {
      if (e.provisional) eq(e.label, '待核验', k + ':' + e.code + ' 未核验时标签必须是「待核验」');
    }
  }
  ok(!Object.prototype.hasOwnProperty.call(d, '__verificationAudit'), '字典对象不应夹带审计字段');
  const audit = helpers.dictionaryAudit();
  ok(Array.isArray(audit.applied) && Array.isArray(audit.rejected), '应返回覆盖审计结构');
});

/* ---------------- A-05：Provider 统一契约纯函数 ---------------- */
t('U-22 Provider 契约：失败码分类与可重试判定稳定（429/5xx/4xx/AbortError）', () => {
  const pc = require('../lib/mos/providercontract');
  eq(pc.classifyHttp(429), pc.ERROR_CODES.RATE_LIMITED);
  eq(pc.classifyHttp(503), pc.ERROR_CODES.HTTP_ERROR);
  eq(pc.classifyHttp(401), pc.ERROR_CODES.BAD_REQUEST);
  eq(pc.classifyError(Object.assign(new Error('aborted'), { name: 'AbortError' })), pc.ERROR_CODES.TIMEOUT);
  eq(pc.classifyError(new Error('socket hang up')), pc.ERROR_CODES.NETWORK_ERROR);
  ok(pc.isRetryable(pc.ERROR_CODES.TIMEOUT) && pc.isRetryable(pc.ERROR_CODES.RATE_LIMITED), '超时/限流应可重试');
  ok(!pc.isRetryable(pc.ERROR_CODES.BAD_REQUEST) && !pc.isRetryable(pc.ERROR_CODES.BLOCKED_DATA_CLASS), '参数/分级拒绝不可重试');
});

t('U-22b Provider 费用回执：无供应商回执一律 null，绝不凭空推算（04 §5）', () => {
  const pc = require('../lib/mos/providercontract');
  const absent = pc.costReceipt({});
  eq(absent.amount, null);
  eq(absent.confirmed, false);
  const present = pc.costReceipt({ cost: { amount: 0.12, currency: 'USD' } });
  eq(present.amount, 0.12);
  eq(present.confirmed, true);
});

t('U-22c Provider 限流头解析：缺失字段一律 null，不臆测配额', () => {
  const pc = require('../lib/mos/providercontract');
  const rl = pc.parseRateLimit({ get: (k) => ({ 'x-ratelimit-remaining': '3' }[k] === undefined ? null : '3') });
  eq(rl.remaining, 3);
  eq(rl.limit, null);
  eq(rl.retryAfterSec, null);
});

t('U-22d 未配置 Provider：contract health 状态为 NOT_CONFIGURED 且不回传密钥', async () => {
  const image = require('../lib/mos/adapters/image');
  const h = await image.health();
  ok(['NOT_CONFIGURED', 'MOCK', 'CONFIGURED', 'HEALTHY', 'UNHEALTHY'].indexOf(h.state) !== -1, 'state 必须来自受控集合');
  ok(!Object.prototype.hasOwnProperty.call(h, 'apiKey'), 'health 不得含 apiKey 字段');
});

/* ---------------- A-06：企业资料库契约纯函数 ---------------- */
t('U-23 Workspace 契约：canonicalString 与 sha256 原始字节语义对齐 Workspace 源码', () => {
  const wc = require('../lib/mos/workspace-contract');
  eq(wc.canonicalString('svc_a', 'get', '/p', '1', 'n', 'H'), 'v1\nsvc_a\nGET\n/p\n1\nn\nH');
  eq(wc.EMPTY_BODY_HASH, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  ok(wc.bodyHashOf('') !== wc.bodyHashOf('{}'), '无体请求不得等价于空对象');
});

t('U-23b Workspace 契约：封套校验拒绝「失败却夹带业务数据」', () => {
  const wc = require('../lib/mos/workspace-contract');
  ok(wc.isEnvelope({ ok: true, data: {}, error: null, request_id: 'r', policy_version: '1.0' }));
  ok(!wc.isEnvelope({ ok: false, data: { leak: 1 }, error: { code: 'X' }, request_id: 'r', policy_version: '1.0' }));
  ok(!wc.isEnvelope({ ok: true, data: {} }), '缺键即非法');
});

t('U-23c Workspace 契约：服务账户 scope 表不含 admission.final.decision（双重闭合第一重）', () => {
  const wc = require('../lib/mos/workspace-contract');
  ok(wc.SERVICE_SCOPES.indexOf('admission.final.decision') === -1, '服务账户 scope 不得含最终审批');
  ok(wc.TICKET_SCOPES.indexOf('admission.final.decision') !== -1, '票据 scope 表应列出（仅本人会话可得）');
  eq(JSON.stringify(wc.serviceGrantable(['assets.read', 'admission.final.decision'])), JSON.stringify(['assets.read']));
});

t('U-23d Workspace 适配器 fail closed：未配置凭据时零出站且恒 INTEGRATION_NOT_CONFIGURED', async () => {
  const ws = require('../lib/mos/adapters/workspace');
  const st = ws.status();
  ok(st.configured === false, '默认必须未配置');
  ok(st.missing.length > 0, '应如实列出缺失项');
  const r = await ws.assetsSearch({ query: 'q', brandId: 'VFIB' });
  eq(r.state, 'INTEGRATION_NOT_CONFIGURED');
  ok(!Object.prototype.hasOwnProperty.call(st, 'privateKeyPem') && !Object.prototype.hasOwnProperty.call(st, 'ticket'),
    'status 不得回传私钥/票据字段');
  const fd = await ws.finalDecision();
  eq(fd.state, 'FINAL_DECISION_REQUIRES_SESSION');
});

t('U-23e Workspace 端点表与契约一致（含 skills；final-decision 要求 session 票据）', () => {
  const wc = require('../lib/mos/workspace-contract');
  eq(Object.keys(wc.ENDPOINTS).length, 12);
  eq(wc.ENDPOINTS.ADMISSION_FINAL_DECISION.ticketKind, 'session');
  eq(wc.ENDPOINTS.SKILL_GET.serviceScope, 'skills.read');
  eq(wc.CONTRACT_VERSION, '1.0');
  ok(wc.NOT_PROVIDED.indexOf('publishedContentArchive') !== -1, 'Published Content 归档不在资料库侧');
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
      suite: 'mos-unit', mosVersion: '0.1.3', build: 'BUILD-01 + BUILD-02 + BUILD-03',
      ranAt: new Date().toISOString(),
      total: results.length, passed: results.length - failed.length, failed: failed.length,
      cases: results
    }, null, 2), 'utf8');
  } catch (_) { /* ignore */ }
  if (failed.length) process.exit(1);
})();
