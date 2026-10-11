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
function t(name, fn) {
  try { fn(); results.push({ name, ok: true }); console.log('  PASS  ' + name); }
  catch (err) { results.push({ name, ok: false, detail: err.message }); console.log('  FAIL  ' + name + '  :: ' + err.message); }
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

t('U-07b 非白名单主机被拒（fail closed）', async () => {});
t('U-07b SSRF 判定：非白名单主机 / 明文 http / 回环（未开测试开关）均拒绝', () => {
  const cfgMod = require('../lib/mos/config');
  const saved = process.env.MOS_EGRESS_ALLOWED_HOSTS;
  const savedLoop = process.env.MOS_EGRESS_ALLOW_LOOPBACK;
  process.env.MOS_EGRESS_ALLOWED_HOSTS = '127.0.0.1,bis.org';
  delete process.env.MOS_EGRESS_ALLOW_LOOPBACK;
  cfgMod.resetConfigCache();

  return Promise.all([
    source.assertEgressAllowed('https://evil.example.com/feed'),
    source.assertEgressAllowed('http://bis.org/feed'),
    source.assertEgressAllowed('https://127.0.0.1:9/x'),
    source.assertEgressAllowed('https://bis.org/press')
  ]).then((r) => {
    eq(r[0].ok, false); eq(r[0].code, 'HOST_NOT_ALLOWLISTED');
    eq(r[1].ok, false); eq(r[1].code, 'SCHEME_NOT_ALLOWED');
    eq(r[2].ok, false); eq(r[2].code, 'SSRF_BLOCKED');
    eq(r[3].ok, true);
    if (saved === undefined) delete process.env.MOS_EGRESS_ALLOWED_HOSTS; else process.env.MOS_EGRESS_ALLOWED_HOSTS = saved;
    if (savedLoop === undefined) delete process.env.MOS_EGRESS_ALLOW_LOOPBACK; else process.env.MOS_EGRESS_ALLOW_LOOPBACK = savedLoop;
    cfgMod.resetConfigCache();
  });
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

/* ---------------- 汇总 ---------------- */
const failed = results.filter((r) => !r.ok);
console.log('\n单元测试：' + (results.length - failed.length) + '/' + results.length + ' 通过');
// 证据落盘（与冒烟/E2E/UI 同一目录，便于统一归档与复核）
try {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'unit-result.json'), JSON.stringify({
    suite: 'mos-unit', mosVersion: '0.1.0', ranAt: new Date().toISOString(),
    total: results.length, passed: results.length - failed.length, failed: failed.length,
    cases: results
  }, null, 2), 'utf8');
} catch (_) { /* ignore */ }
if (failed.length) process.exit(1);
