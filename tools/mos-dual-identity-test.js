#!/usr/bin/env node
'use strict';
/**
 * B2 / B3 专项自检（suite: dual）—— 双重身份调用客户端 + 变更事件消费。
 *
 * 依据 B 包 `01_CONSUMER_TASKS.md`：
 *   · B2 受限用户票据：服务账户换票、票据与签发账户绑定、缓存/临期刷新/并发单飞、
 *     401 回退与重新身份校验、有界重试、出站收敛（SSRF）、机密不落盘、
 *     服务身份**结构性**不能代签最终审批。
 *   · B3 事件消费：持久化 seq 游标、断线重试与 degraded fail closed、
 *     (brandId,seq) 幂等、按品牌处理、truncated 全量重验、撤回/停用即时失效、
 *     使用前重新验证授权。
 *
 * 隔离口径：独立数据目录（data-mos-dual-*）+ 回环随机端口桩 Provider + 跑完自清，
 *           **不触碰 data/**，**不与真实企业资料库发生任何联调**。
 */
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(os.tmpdir(), 'data-mos-dual-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
const OUT_DIR = path.join(__dirname, '..', 'TEST_EVIDENCE_MOS_BUILD01');

process.env.MOS_DATA_DIR = DATA_DIR;
process.env.MOS_DEMO_SEED = '1';
process.env.MOS_PRODUCTION = '0';

const mosConfig = require('../lib/mos/config');
const wc = require('../lib/mos/workspace-contract');

const cases = [];
let passed = 0;
let failed = 0;
const notes = [];

function ok(name, cond, detail) {
  const c = { name, ok: !!cond, detail: String(detail === undefined ? '' : detail) };
  cases.push(c);
  if (c.ok) { passed += 1; console.log('  PASS  ' + name + (detail ? '  :: ' + detail : '')); }
  else { failed += 1; console.log('  FAIL  ' + name + '  :: ' + c.detail); }
}
function section(t) { console.log('\n--- ' + t + ' ---'); }
function applyEnv(env) {
  for (const k of Object.keys(env)) {
    if (env[k] === null) delete process.env[k]; else process.env[k] = String(env[k]);
  }
  mosConfig.resetConfigCache();
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const PRIV_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });
const PUB_PEM = publicKey.export({ type: 'spki', format: 'pem' });

/* ==================== 桩 Provider（按 V1.1.7 契约复刻） ==================== */
const stub = {
  hits: [],
  nonces: {},
  ticketRequests: [],
  ticketSeq: 0,
  changesQueue: [],
  changesLastCursor: 0,
  assetMap: {},
  artifact: { status: 409, errorCode: 'FINAL_APPROVAL_REQUIRED', data: null },
  oneShot: {},        // pathname -> [{status, errorCode, times}]
  rateLimitFirst: 0   // >0 时，第一次 matching 请求回 429
};

function takeOneShot(pathname) {
  const q = stub.oneShot[pathname];
  if (!q || !q.length) return null;
  if (q[0].times > 0) { q[0].times -= 1; return q[0]; }
  q.shift();
  return takeOneShot(pathname);
}

function startStub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks);
        const url = req.url || '';
        const pathname = url.split('?')[0];
        const query = {};
        const qi = url.indexOf('?');
        if (qi !== -1) for (const kv of url.slice(qi + 1).split('&')) {
          const p = kv.split('='); if (p[0]) query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
        }
        const keyId = String(req.headers['x-vfib-key-id'] || '');
        const ts = String(req.headers['x-vfib-timestamp'] || '');
        const nonce = String(req.headers['x-vfib-nonce'] || '');
        const sig = String(req.headers['x-vfib-signature'] || '');
        const ticket = String(req.headers['x-vfib-ticket'] || '');
        const corr = String(req.headers['x-vfib-correlation-id'] || '');
        let body = null;
        try { body = raw.length ? JSON.parse(raw.toString('utf8')) : null; } catch (_) { body = null; }
        stub.hits.push({ pathname, query, keyId, ts, nonce, sig, ticket, corr, bodyLen: raw.length, body });

        const envelope = (status, okFlag, data, error) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: okFlag, data: okFlag ? (data === undefined ? null : data) : null,
            error: okFlag ? null : (error || { code: 'ERROR', message: 'x' }),
            request_id: corr || 'req_stub', policy_version: wc.CONTRACT_VERSION
          }));
        };

        if (!keyId || !ts || !nonce || !sig) return envelope(401, false, null, { code: 'MISSING_SIGNATURE', message: '缺签名头' });

        const expect = wc.canonicalString(keyId, req.method, pathname, ts, nonce, wc.sha256Hex(raw));
        let verified = false;
        try { verified = crypto.verify(null, Buffer.from(expect, 'utf8'), publicKey, Buffer.from(sig, 'base64')); } catch (_) { verified = false; }
        if (!verified) return envelope(401, false, null, { code: 'BAD_SIGNATURE', message: '请求签名校验失败' });

        const set = stub.nonces[keyId] || (stub.nonces[keyId] = new Set());
        if (set.has(nonce)) return envelope(401, false, null, { code: 'NONCE_REPLAY', message: 'nonce 已被使用' });
        set.add(nonce);

        // 一次性故障注入（用于 401 回退 / 429 重试场景）
        const one = takeOneShot(pathname);
        if (one) return envelope(one.status, false, null, { code: one.errorCode, message: '注入故障' });
        if (stub.rateLimitFirst > 0) {
          stub.rateLimitFirst -= 1;
          return envelope(429, false, null, { code: 'RATE_LIMITED', message: '超出配额' });
        }

        if (pathname === '/api/integrations/marketing/health') {
          return envelope(200, true, {
            enabled: true, appVersion: wc.WORKSPACE_APP_VERSION, policyVersion: wc.CONTRACT_VERSION,
            capabilities: { publishedContentArchive: false },
            signing: { ticketKeySource: 'ephemeral-random-per-boot' }
          });
        }

        if (pathname === '/api/integrations/marketing/tickets') {
          stub.ticketSeq += 1;
          const n = stub.ticketSeq;
          stub.ticketRequests.push({ seq: n, body, ticketHeader: ticket });
          const tok = 'STUBTICKET-' + n + '-' + crypto.randomBytes(24).toString('hex');
          return envelope(200, true, {
            ticket: tok, kind: 'service',
            scopes: (body && body.scopes) || [],
            userId: body && body.userId, brandId: body && body.brandId,
            expiresAt: new Date(Date.now() + 300 * 1000).toISOString()
          });
        }

        if (pathname === '/api/integrations/marketing/changes') {
          const cur = Number(query.cursor || 0);
          const next = stub.changesQueue.shift();
          if (next) {
            stub.changesLastCursor = Number(next.nextCursor !== undefined ? next.nextCursor : cur);
            return envelope(200, true, Object.assign({
              items: [], nextCursor: stub.changesLastCursor, hasMore: false, truncated: false, oldestCursor: 0
            }, next));
          }
          return envelope(200, true, {
            items: [], nextCursor: cur, hasMore: false, truncated: false, oldestCursor: 0
          });
        }

        if (pathname === '/api/integrations/marketing/knowledge/search') {
          return envelope(200, true, {
            items: [{ documentId: 'VFIB-2026-0001', libraryAssetId: 'VFIB-ASSET-0001', title: 'T',
              classification: { key: 'internal', rank: 2 }, snippet: null, contentWithheld: true,
              withholdReason: 'AI 出口策略未放行' }],
            contentPolicy: { wholeDocumentExport: 'forbidden' }
          });
        }
        if (pathname === '/api/integrations/marketing/assets/search') {
          return envelope(200, true, { items: [{ id: 'VFIB-ASSET-0001', brandId: 'VFIB', reusable: true }], nextCursor: 'n1' });
        }
        if (pathname.indexOf('/api/integrations/marketing/assets/') === 0) {
          const id = decodeURIComponent(pathname.slice('/api/integrations/marketing/assets/'.length));
          const spec = stub.assetMap[id];
          if (spec) return envelope(spec.status, false, null, { code: spec.errorCode, message: 'stub' });
          return envelope(200, true, { id, version: String(query.version || ''), isReusable: true, permissionValid: true, fileAccess: 'not-exposed' });
        }
        if (pathname.indexOf('/api/integrations/marketing/admissions') === 0) {
          if (pathname.indexOf('/artifact') !== -1) {
            const a = stub.artifact;
            if (a.status >= 400) return envelope(a.status, false, null, { code: a.errorCode, message: 'stub artifact' });
            return envelope(200, true, a.data || { isReusable: true, libraryAssetId: 'VFIB-ASSET-0001', state: 'PUBLISHED' });
          }
          if (pathname.indexOf('/submit') !== -1) {
            return envelope(200, true, { state: 'FINAL_APPROVAL_PENDING', admissionRequestId: 'ADM-STUB-1' });
          }
          return envelope(200, true, { admissionRequestId: 'ADM-STUB-1', state: 'DRAFT', created: true, isReusable: false });
        }
        return envelope(404, false, null, { code: 'NOT_FOUND', message: 'stub 未实现：' + pathname });
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/* ==================== 主流程 ==================== */
async function main() {
  console.log('B2/B3 专项自检（双重身份调用客户端 + 变更事件消费）');
  const { server, port } = await startStub();
  const baseUrl = 'http://127.0.0.1:' + port;

  const client = require('../lib/mos/workspace-client');
  const store = require('../lib/mos/store');

  const BASE_ENV = {
    MOS_WORKSPACE_ENABLED: '1', MOS_WORKSPACE_BASE_URL: baseUrl,
    MOS_WORKSPACE_KEY_ID: 'svc_mos_1', MOS_WORKSPACE_PRIVATE_KEY_PEM: PRIV_PEM,
    MOS_WORKSPACE_TIMEOUT_MS: '4000', MOS_WORKSPACE_BRANDS: 'VFIB',
    MOS_WORKSPACE_SERVICE_USER_ID: 'emp-001', MOS_WORKSPACE_TICKET_TTL_SECONDS: '300',
    MOS_WORKSPACE_POLL_SECONDS: '60', MOS_WORKSPACE_POLL_ENABLED: '0',
    MOS_WORKSPACE_ALLOW_LOOPBACK_HTTP: '1', MOS_WORKSPACE_ALLOWED_HOSTS: '',
    MOS_WORKSPACE_RETRY_ATTEMPTS: '3'
  };

  /* ============ L1 出站收敛（SSRF 面） ============ */
  section('L1 出站收敛 egressGuard（非回环必须 https；白名单留空=拒绝）');

  applyEnv(Object.assign({}, BASE_ENV, { MOS_WORKSPACE_BASE_URL: 'http://provider.example.com' }));
  let g = client.egressGuard();
  ok('D-01 非回环 + 明文 http → 拒绝（集成接口不得明文出网）', g.ok === false && /https/.test(g.reason), g.reason);

  applyEnv(Object.assign({}, BASE_ENV, { MOS_WORKSPACE_BASE_URL: 'https://provider.example.com' }));
  g = client.egressGuard();
  ok('D-02 https 但主机不在 allowedHosts（留空）→ 拒绝（fail closed）',
    g.ok === false && /白名单/.test(g.reason), g.reason);

  applyEnv(Object.assign({}, BASE_ENV, { MOS_WORKSPACE_BASE_URL: 'https://provider.example.com', MOS_WORKSPACE_ALLOWED_HOSTS: 'provider.example.com,other.example.com' }));
  g = client.egressGuard();
  ok('D-03 https + 主机命中 allowedHosts → 放行', g.ok === true && g.host === 'provider.example.com', g.reason);

  applyEnv(Object.assign({}, BASE_ENV, { MOS_WORKSPACE_ALLOW_LOOPBACK_HTTP: '0' }));
  g = client.egressGuard();
  ok('D-04 回环明文但未显式 allowLoopbackHttp → 拒绝（默认 fail closed）',
    g.ok === false && /allowLoopbackHttp/.test(g.reason), g.reason);

  applyEnv(Object.assign({}, BASE_ENV, { MOS_PRODUCTION: '1' }));
  g = client.egressGuard();
  ok('D-05 生产模式 + 回环明文（即使显式开启）→ 一律拒绝',
    g.ok === false && /生产模式/.test(g.reason), g.reason);
  applyEnv({ MOS_PRODUCTION: '0' });

  applyEnv(Object.assign({}, BASE_ENV));
  g = client.egressGuard();
  ok('D-06 隔离测试口径（回环 + 显式开启 + 非生产）→ 放行并标记 loopback',
    g.ok === true && g.loopback === true, g.reason);

  /* ============ L2 票据获取与绑定 ============ */
  section('L2 受限用户票据（服务账户换票 / 账户绑定 / 缓存 / 单飞 / 不落盘）');

  applyEnv(Object.assign({}, BASE_ENV));
  const bs = client.status();
  ok('D-07 status().configured=true 且绝不回传私钥/PEM',
    bs.configured === true && JSON.stringify(bs).indexOf('PRIVATE KEY') === -1
      && bs.finalDecisionByServiceAccount === false,
    'configured=' + bs.configured + ' egress=' + bs.egress.ok);

  stub.hits = []; stub.ticketRequests = [];
  let t = await client.ensureTicket({ brandId: 'VFIB', userId: '' });
  ok('D-08 缺真实用户 → MISSING_USER，零出站（服务账户不能替代用户身份）',
    t.ok === false && t.errorCode === 'MISSING_USER' && stub.hits.length === 0, t.errorCode);

  stub.hits = [];
  t = await client.ensureTicket({ brandId: 'OTHER_BRAND', userId: 'emp-001' });
  ok('D-09 品牌不在 workspace.brands 白名单 → BRAND_NOT_ALLOWED，零出站（本侧主动拒绝）',
    t.ok === false && t.errorCode === 'BRAND_NOT_ALLOWED' && stub.hits.length === 0, t.errorCode);

  stub.hits = []; stub.ticketRequests = [];
  t = await client.ensureTicket({ brandId: 'VFIB', userId: 'emp-001', scopes: ['assets.read', 'admission.final.decision'] });
  const reqScopes = (stub.ticketRequests[0].body || {}).scopes || [];
  ok('D-10 首次换票：refreshed=true，且 admission.final.decision 在**出站前**即被剔除',
    t.ok === true && t.refreshed === true && t.strippedScopes.indexOf('admission.final.decision') !== -1
      && reqScopes.indexOf('admission.final.decision') === -1 && reqScopes.indexOf('assets.read') !== -1,
    'granted=' + JSON.stringify(t.scopes) + ' stripped=' + JSON.stringify(t.strippedScopes));

  stub.hits = [];
  const t2 = await client.ensureTicket({ brandId: 'VFIB', userId: 'emp-001', scopes: ['assets.read'] });
  ok('D-11 二次请求命中内存缓存：cached=true 且**零新增出站**',
    t2.ok === true && t2.cached === true && stub.hits.length === 0, 'hits=' + stub.hits.length);

  // 并发单飞
  client.dropAllTickets('单飞用例前清理');
  stub.hits = []; stub.ticketRequests = [];
  const inflight = await Promise.all([
    client.ensureTicket({ brandId: 'VFIB', userId: 'emp-002' }),
    client.ensureTicket({ brandId: 'VFIB', userId: 'emp-002' }),
    client.ensureTicket({ brandId: 'VFIB', userId: 'emp-002' }),
    client.ensureTicket({ brandId: 'VFIB', userId: 'emp-002' }),
    client.ensureTicket({ brandId: 'VFIB', userId: 'emp-002' })
  ]);
  ok('D-12 并发单飞：同 (keyId,brand,user) 并发 5 次只发**一次**换票出站，且共享同一票据',
    inflight.every((x) => x.ok) && stub.ticketRequests.length === 1
      && inflight.filter((x) => x.coalesced === true).length === 4
      && new Set(inflight.map((x) => x.ticket)).size === 1,
    'issueCalls=' + stub.ticketRequests.length + ' coalesced=' + inflight.filter((x) => x.coalesced).length);

  // 账户绑定：不同 user 不同 ticketKey
  const k1 = client.ticketKey('svc_mos_1', 'emp-001', 'VFIB');
  const k2 = client.ticketKey('svc_mos_1', 'emp-002', 'VFIB');
  const k3 = client.ticketKey('svc_mos_1', 'emp-001', 'VFIB2');
  ok('D-13 票据缓存键含 keyId/brand/user → 跨账户、跨品牌**绝不**复用',
    k1 !== k2 && k1 !== k3 && k1 === 'svc_mos_1|VFIB|emp-001', k1 + ' / ' + k2 + ' / ' + k3);

  // 落盘只存非机密元数据
  const dbFile = path.join(DATA_DIR, 'mos.json');
  const rawDb = fs.existsSync(dbFile) ? fs.readFileSync(dbFile, 'utf8') : '';
  const metaRows = (store.getDb().library_tickets || []);
  ok('D-14 票据密文只在内存：落盘元数据含 ticketKey/expiresAt，但**不含** STUBTICKET 明文',
    rawDb.indexOf('STUBTICKET-') === -1 && metaRows.length >= 2
      && metaRows.every((r) => typeof r.ticketKey === 'string' && r.ticket === undefined),
    'metaRows=' + metaRows.length + ' blobHasTicket=' + (rawDb.indexOf('STUBTICKET-') !== -1));

  // 重新为 emp-001 换一枚票据（前面 dropAllTickets 已清空），再验证 dropTicket 的即时失效语义
  await client.ensureTicket({ brandId: 'VFIB', userId: 'emp-001' });
  const cachedRec = client.cachedTicket('svc_mos_1', 'emp-001', 'VFIB');
  client.dropTicket('svc_mos_1', 'emp-001', 'VFIB', '自检主动丢弃');
  ok('D-15 dropTicket 后 cachedTicket 立即失效（可用性判定 usable=false / null）',
    !!cachedRec && client.cachedTicket('svc_mos_1', 'emp-001', 'VFIB') === null && cachedRec.usable === true,
    'before=' + (cachedRec && cachedRec.usable) + ' after=' + client.cachedTicket('svc_mos_1', 'emp-001', 'VFIB'));

  /* ============ L3 重试分类与 401 回退 ============ */
  section('L3 有界重试分类 + 401 票据回退（含"只重试一次"上限）');

  ok('D-16 classify：传输失败(0)→transport/可重试；429→可重试；未识别码→**不可重试**(fail safe)',
    client.classify({ httpStatus: 0 }).retryable === true
      && client.classify({ httpStatus: 429, errorCode: 'RATE_LIMITED' }).retryable === true
      && client.classify({ httpStatus: 418, errorCode: 'TEAPOT_UNKNOWN' }).retryable === false
      && client.classify({ httpStatus: 0 }).layer === 'transport',
    'unknown=' + JSON.stringify(client.classify({ httpStatus: 418, errorCode: 'TEAPOT_UNKNOWN' })));

  // 429 重试：注入一次
  stub.hits = []; stub.oneShot = {};
  stub.oneShot['/api/integrations/marketing/assets/search'] = [{ status: 429, errorCode: 'RATE_LIMITED', times: 1 }];
  const rl = await client.searchAssets({ brandId: 'VFIB', userId: 'emp-001' });
  ok('D-17 429 限流 → 有界重试后成功（attemptsUsed>=2，且每次重新签名换 nonce）',
    rl.ok === true && rl.attemptsUsed >= 2 && stub.hits.length >= 2
      && stub.hits[0].nonce !== stub.hits[1].nonce,
    'attemptsUsed=' + rl.attemptsUsed + ' hits=' + stub.hits.length);
  stub.oneShot = {};

  // 401 TICKET_* → 丢弃 + 重换 + 只重试一次
  stub.hits = []; stub.ticketRequests = [];
  client.dropAllTickets('401 回退用例前清理');
  stub.oneShot['/api/integrations/marketing/knowledge/search'] = [{ status: 401, errorCode: 'TICKET_BAD_SIGNATURE', times: 1 }];
  const rv = await client.searchKnowledge({ brandId: 'VFIB', userId: 'emp-003' });
  ok('D-18 401 TICKET_BAD_SIGNATURE → 丢弃票据 + 重新换票 + 只重试一次后成功（revalidated=true）',
    rv.ok === true && rv.revalidated === true && rv.firstErrorCode === 'TICKET_BAD_SIGNATURE'
      && stub.ticketRequests.length === 2,
    'ok=' + rv.ok + ' code=' + rv.errorCode + ' first=' + rv.firstErrorCode
      + ' issueCalls=' + stub.ticketRequests.length + ' revalidated=' + rv.revalidated);
  stub.oneShot = {};

  // 401 签名类 → 不重试
  stub.hits = [];
  stub.oneShot['/api/integrations/marketing/assets/search'] = [{ status: 401, errorCode: 'BAD_SIGNATURE', times: 99 }];
  const bsig = await client.searchAssets({ brandId: 'VFIB', userId: 'emp-001' });
  ok('D-19 401 BAD_SIGNATURE（签名/账户类）→ **不重试、不刷新票据**，立即如实上报',
    bsig.ok === false && bsig.errorCode === 'BAD_SIGNATURE' && bsig.attemptsUsed === 1
      && bsig.revalidated === undefined,
    'attemptsUsed=' + bsig.attemptsUsed + ' code=' + bsig.errorCode);
  stub.oneShot = {};

  /* ============ L4 最终审批结构性边界 ============ */
  section('L4 服务身份结构性不可代签最终审批');

  const fd = client.finalDecision();
  ok('D-20 finalDecision() 恒拒绝（TICKET_KIND_MISMATCH / 403），与适配层双重闭合',
    fd.ok === false && fd.errorCode === 'TICKET_KIND_MISMATCH' && fd.httpStatus === 403
      && wc.SERVICE_SCOPES.indexOf('admission.final.decision') === -1
      && wc.SESSION_ONLY_TICKET_SCOPES.indexOf('admission.final.decision') !== -1,
    fd.errorCode);

  /* ============ L5 准入三步推送（不伪造审批） ============ */
  section('L5 准入三步推送：申请≠资产；未最终审批时如实 409，不伪造可复用');

  const admissionFixture = {
    idempotencyKey: 'idem-dual-1', workingAssetId: 'wa-dual-1', brandCode: 'VFIB',
    libraryPrimaryCategory: '02', classification: 'internal', licenseStatus: 'cleared',
    reuseScope: 'campaign_reuse', aiReusePolicy: 'allowed', externalAiTransferPolicy: 'blocked',
    originVersionId: 'V1.0', submissionMetadata: { title: 'B2 专项准入', fileName: 'a.svg' }
  };

  applyEnv(Object.assign({}, BASE_ENV, { MOS_WORKSPACE_ENABLED: '0' }));
  stub.hits = [];
  const pre = await client.pushAdmission({ admission: admissionFixture, userId: 'emp-001', brandId: 'VFIB' });
  ok('D-21 未配置时 pushAdmission → stage=preflight、零出站（fail closed）',
    pre.ok === false && pre.stage === 'preflight' && pre.errorCode === 'INTEGRATION_NOT_CONFIGURED' && stub.hits.length === 0,
    'stage=' + pre.stage + ' hits=' + stub.hits.length);

  applyEnv(Object.assign({}, BASE_ENV));
  stub.hits = []; stub.artifact = { status: 409, errorCode: 'FINAL_APPROVAL_REQUIRED', data: null };
  const pa = await client.pushAdmission({ admission: admissionFixture, userId: 'emp-001', brandId: 'VFIB', reviews: [{ reviewerId: 'emp-009', verdict: 'PASS' }] });
  const stages = pa.log.map((x) => x.stage).join('>');
  ok('D-22 三步顺序严格 create > submit > artifact，且未完成最终审批时 ok=false、isReusable=false',
    stages === 'create>submit>artifact' && pa.ok === false && pa.isReusable === false
      && pa.errorCode === 'FINAL_APPROVAL_REQUIRED' && pa.stage === 'artifact',
    'stages=' + stages + ' code=' + pa.errorCode);
  const sentSubmit = stub.hits.find((h) => /\/submit$/.test(h.pathname));
  ok('D-23 submit 步骤真实携带 reviews[]（不得"提交即通过"空复核）',
    !!sentSubmit && Array.isArray((sentSubmit.body || {}).reviews)
      && sentSubmit.body.reviews.length === 1
      && sentSubmit.body.reviews[0].reviewerId === 'emp-009',
    'reviews=' + JSON.stringify(sentSubmit && sentSubmit.body && sentSubmit.body.reviews));

  stub.hits = [];
  stub.artifact = { status: 200, errorCode: '', data: { isReusable: true, libraryAssetId: 'VFIB-ASSET-0001', libraryVersionId: 'VFIB-ASSET-0001-V1.0', state: 'PUBLISHED', contentHash: 'c'.repeat(64) } };
  const pa2 = await client.pushAdmission({ admission: admissionFixture, userId: 'emp-001', brandId: 'VFIB' });
  ok('D-24 真实审批完成（桩返回 200 + isReusable=true）→ 取得正式 Asset ID，ok=true',
    pa2.ok === true && pa2.isReusable === true && pa2.libraryAssetId === 'VFIB-ASSET-0001', 'assetId=' + pa2.libraryAssetId);

  // 出站前同构预校验：Provider 预检硬条件（fileName）不满足时零出站拒绝
  stub.hits = [];
  const noName = Object.assign({}, admissionFixture, {
    workingAssetId: 'wa-dual-noname', idempotencyKey: 'idem-dual-noname',
    submissionMetadata: { title: '缺文件名' }
  });
  const pn = await client.pushAdmission({ admission: noName, userId: 'emp-001', brandId: 'VFIB' });
  ok('D-24b 缺 fileName → 出站前即拒（MISSING_FILE_NAME，零出站），不把申请推进到 Provider 的 REVISION_REQUIRED',
    pn.ok === false && pn.stage === 'preflight' && pn.errorCode === 'MISSING_FILE_NAME'
      && stub.hits.length === 0 && (pn.missing || []).indexOf('fileName') !== -1,
    'stage=' + pn.stage + ' code=' + pn.errorCode + ' hits=' + stub.hits.length);

  // 检索类端点：语义参数必须落在 **POST body**，不得误当 url query
  stub.hits = []; stub.ticketRequests = [];
  const sk = await client.searchKnowledge({ brandId: 'VFIB', userId: 'emp-001', query: '品牌语气', topK: 3 });
  const sa = await client.searchAssets({ brandId: 'VFIB', userId: 'emp-001', query: 'logo', limit: 3, offset: 0 });
  const hk = stub.hits.find((h) => /\/knowledge\/search$/.test(h.pathname)) || {};
  const ha = stub.hits.find((h) => /\/assets\/search$/.test(h.pathname)) || {};
  ok('D-24c knowledge.search / assets.search 的检索参数落在 POST body（query/topK/limit/offset），url 上不出现 query',
    sk.ok === true && sa.ok === true
      && (hk.body || {}).query === '品牌语气' && (hk.body || {}).topK === 3
      && (ha.body || {}).query === 'logo' && (ha.body || {}).limit === 3 && (ha.body || {}).offset === 0
      && hk.pathname.indexOf('?') === -1 && ha.pathname.indexOf('?') === -1,
    'knowledgePath=' + hk.pathname + ' knowledgeBody=' + JSON.stringify(hk.body || {})
      + ' assetPath=' + ha.pathname + ' assetBody=' + JSON.stringify(ha.body || {}));

  /* D-06.5（资料库实测纠正）：reuseScope 缺省 / none 会让申请在 Provider 侧永久卡死
   * （预检 REVISION_REQUIRED，而该状态无重提入口）。必须**零出站**拦下。 */
  const admNoReuse = Object.assign({}, admissionFixture, { reuseScope: undefined });
  stub.hits = [];
  const prMissing = await client.pushAdmission({ admission: admNoReuse, userId: 'emp-001', brandId: 'VFIB' });
  stub.hits = [];
  const prNone = await client.pushAdmission({
    admission: Object.assign({}, admissionFixture, { reuseScope: 'none' }),
    userId: 'emp-001', brandId: 'VFIB'
  });
  ok('D-24d reuseScope 缺失 / 为 none → 出站前零出站拒绝（MISSING_REUSE_SCOPE / REUSE_SCOPE_NONE）',
    prMissing.ok === false && prMissing.stage === 'preflight' && prMissing.errorCode === 'MISSING_REUSE_SCOPE'
      && prNone.ok === false && prNone.stage === 'preflight' && prNone.errorCode === 'REUSE_SCOPE_NONE'
      && stub.hits.length === 0,
    'missing=' + prMissing.errorCode + ' none=' + prNone.errorCode + ' hits=' + stub.hits.length);

  const admLib = require('../lib/mos/admissionlib');
  ok('D-24e admissionlib 层面同构判定：reuseScopeUsable / licenseAdmissionGate 与出站预检一致',
    admLib.reuseScopeUsable({ reuseScope: 'campaign_reuse' }).ok === true
      && admLib.reuseScopeUsable({ reuseScope: 'none' }).ok === false
      && admLib.reuseScopeUsable({}).ok === false
      && admLib.licenseAdmissionGate({ licenseStatus: 'unknown' }).blocking === true
      && admLib.licenseAdmissionGate({ licenseStatus: 'expired' }).blocking === true
      && admLib.licenseAdmissionGate({ licenseStatus: 'cleared' }).blocking === false,
    'none=' + admLib.reuseScopeUsable({ reuseScope: 'none' }).reason
      + ' unknown=' + admLib.licenseAdmissionGate({ licenseStatus: 'unknown' }).blocking);

  /* ============ L6 变更事件消费（B3） ============ */
  section('L6 变更事件消费：幂等 / 失效 / 游标 / truncated / degraded');

  const ec = require('../lib/mos/eventconsumer');
  store.getDb().library_asset_refs.push({
    id: 'ref-1', brandCode: 'VFIB', libraryId: 'VFIB-ASSET-0001', state: 'ACTIVE', permissionValid: true
  });
  store.getDb().library_asset_refs.push({
    id: 'ref-2', brandCode: 'VFIB', libraryId: 'VFIB-ASSET-0002', state: 'ACTIVE', permissionValid: true
  });

  const e1 = ec.applyEvent('VFIB', { seq: 11, type: 'asset.revoked', data: { libraryAssetId: 'VFIB-ASSET-0001' } });
  const e1b = ec.applyEvent('VFIB', { seq: 11, type: 'asset.revoked', data: { libraryAssetId: 'VFIB-ASSET-0001' } });
  const ref1 = store.getDb().library_asset_refs.find((r) => r.id === 'ref-1');
  ok('E-01 asset.revoked 事件：本地引用置 INVALIDATED、permissionValid=false，且**同 seq 重复投递不重复生效**',
    e1.applied === true && e1b.applied === false && e1b.reason === 'DUPLICATE_SEQ'
      && ref1.state === 'INVALIDATED' && ref1.permissionValid === false,
    'first=' + e1.reason + ' dup=' + e1b.reason + ' state=' + ref1.state);

  ok('E-02 撤回登记进入 client.isInvalidated（新调用据此拒绝复用）',
    client.isInvalidated('asset.revoked', 'VFIB-ASSET-0001') === true
      && client.isInvalidated('asset.deprecated', 'VFIB-ASSET-0002') === false, 'isInvalidated=true');

  const e2 = ec.applyEvent('VFIB', { seq: 12, type: 'skill.version.changed', data: { skillId: 'SK-01', version: '1.2' } });
  ok('E-03 skill.version.changed → 登记失效（Skill 版本变更须使旧版本缓存失效）',
    e2.applied === true && client.isInvalidated('skill.version.changed', 'SK-01') === true,
    JSON.stringify(e2.effects));

  const e3 = ec.applyEvent('VFIB', { seq: 13, type: 'permission.changed', data: {} });
  const e3ref = store.getDb().library_asset_refs.find((r) => r.id === 'ref-2');
  ok('E-04 permission.changed → 丢弃全部票据 + 该品牌全部引用失效',
    e3.applied === true && /droppedTickets=\d+/.test(e3.effects[0])
      && e3ref.state === 'INVALIDATED' && e3ref.invalidateReason === 'permission.changed',
    e3.effects.join(','));

  const e4 = ec.applyEvent('VFIB', { seq: 14, type: 'service_account.changed', data: {} });
  ok('E-05 service_account.changed（**下划线**字面量）→ 丢弃全部票据（票据与签发账户绑定）',
    e4.applied === true && /service_account\.changed/.test(e4.effects[0]), e4.effects.join(','));

  const e5 = ec.applyEvent('VFIB', { seq: 15, type: 'brand.unknown.event.tbd', data: {} });
  ok('E-06 未识别事件类型：仍推进 seq（不卡死游标）但明确标记 unhandled（可观测）',
    e5.applied === true && e5.effects[0] === 'unhandled:brand.unknown.event.tbd:reconcile_required',
    e5.effects.join(','));
  /* D-02 消费方正式约定：未知类型 = 契约外变更 → 触发一次**全量对账**（fail-safe），不得静默忽略 */
  const rowU = ec.cursorRow('VFIB');
  ok('E-06b 未识别事件类型 → 置位 reconcileRequired（要求全量对账，而非静默忽略）',
    rowU.reconcileRequired === true
      && /UNKNOWN_EVENT_TYPE/.test(String(rowU.reconcileReason || ''))
      && (rowU.unhandledTypes || []).indexOf('brand.unknown.event.tbd') !== -1,
    'reason=' + rowU.reconcileReason);

  // 幂等登记：同 (kind,targetId) 只保留一条
  const invBefore = store.getDb().library_invalidations.filter((x) => x.kind === 'asset.revoked' && x.targetId === 'VFIB-ASSET-0001').length;
  client.invalidate('asset.revoked', 'VFIB-ASSET-0001', { brandId: 'VFIB' });
  const invAfter = store.getDb().library_invalidations.filter((x) => x.kind === 'asset.revoked' && x.targetId === 'VFIB-ASSET-0001').length;
  ok('E-07 invalidate 幂等：同一 (kind,targetId) 重复登记不产生重复行',
    invBefore === 1 && invAfter === 1, 'before=' + invBefore + ' after=' + invAfter);

  ok('E-08 未知失效类型被拒绝（不静默接受）', client.invalidate('asset.exploded', 'X').ok === false, '');

  // 游标推进
  stub.changesQueue = [{ items: [], nextCursor: 42, hasMore: false, truncated: false, oldestCursor: 0 }];
  const p1 = await ec.pollBrand('VFIB', { userId: 'emp-001' });
  const row = ec.cursorRow('VFIB');
  ok('E-09 pollBrand 正常：游标持久化推进到 nextCursor（进程重启可续传）',
    p1.ok === true && row.cursor === 42 && row.nextCursor === 42 && row.polls >= 1,
    'cursor=' + row.cursor);

  // truncated 全量重验
  client.invalidate('asset.revoked', 'VFIB-ASSET-0009', { brandId: 'VFIB' });
  const trBefore = store.getDb().library_invalidations.length;
  stub.changesQueue = [{ items: [], nextCursor: 90, hasMore: false, truncated: true, oldestCursor: 70 }];
  const p2 = await ec.pollBrand('VFIB', { userId: 'emp-001' });
  const row2 = ec.cursorRow('VFIB');
  ok('E-10 truncated=true → 清空事件累积的失效登记 + 游标重置到 oldestCursor + 重放集合清空',
    p2.ok === true && p2.truncated === true && row2.cursor === 70
      && row2.processedSeqs.length === 0 && row2.truncatedCount === 1
      && trBefore > 0 && store.getDb().library_invalidations.length === 0,
    'cursor=' + row2.cursor + ' invalidations ' + trBefore + '→0');
  ok('E-10b 全量对账同时清掉「未识别事件类型」置位的 reconcileRequired（避免永久待对账）',
    row2.reconcileRequired === false && !!row2.lastReconcileAt,
    'reconcileRequired=' + row2.reconcileRequired + ' at=' + row2.lastReconcileAt);

  ok('E-11 clearInvalidations 留下可审计的重建记录（settings.lastInvalidationReset）',
    !!store.getDb().settings.lastInvalidationReset && store.getDb().settings.lastInvalidationReset.cleared > 0,
    JSON.stringify(store.getDb().settings.lastInvalidationReset && store.getDb().settings.lastInvalidationReset.cleared));

  // 断线重试 → degraded → fail closed
  stub.oneShot['/api/integrations/marketing/changes'] = [{ status: 503, errorCode: 'UPSTREAM_UNAVAILABLE', times: 99 }];
  const f1 = await ec.pollBrand('VFIB', { userId: 'emp-001' });
  const f2 = await ec.pollBrand('VFIB', { userId: 'emp-001' });
  const gate = ec.authoritativeUsable('VFIB');
  ok('E-12 事件流连续失败 ≥2 → degraded=true，authoritativeUsable=false（拒绝新的权威授权调用）',
    f1.ok === false && f2.ok === false && ec.cursorRow('VFIB').degraded === true
      && gate.usable === false && gate.reason === 'EVENT_STREAM_DEGRADED',
    'consecutiveFailures=' + ec.cursorRow('VFIB').consecutiveFailures + ' reason=' + gate.reason);

  ok('E-13 degraded 下 verifyAssetUsable **不出站**即拒绝（绝不沿用过期 Approved 缓存）',
    (await ec.verifyAssetUsable('VFIB', 'VFIB-ASSET-0001', { userId: 'emp-001' })).usable === false, 'blocked');

  // 恢复
  stub.oneShot = {};
  stub.changesQueue = [{ items: [], nextCursor: 91, hasMore: false, truncated: false, oldestCursor: 0 }];
  await ec.pollBrand('VFIB', { userId: 'emp-001' });
  ok('E-14 事件流恢复后 degraded 复位、authoritativeUsable 恢复 usable=true',
    ec.cursorRow('VFIB').degraded === false && ec.authoritativeUsable('VFIB').usable === true, '');

  // 使用前重新验证
  stub.assetMap['VFIB-ASSET-7777'] = { status: 410, errorCode: 'ASSET_GONE' };
  const vu = await ec.verifyAssetUsable('VFIB', 'VFIB-ASSET-7777', { userId: 'emp-001' });
  ok('E-15 verifyAssetUsable 遇 410 ASSET_GONE → 如实判不可用并**立即登记撤回**（不等下轮轮询）',
    vu.ok === false && vu.usable === false && vu.reason === 'ASSET_GONE'
      && client.isInvalidated('asset.revoked', 'VFIB-ASSET-7777') === true,
    'reason=' + vu.reason);

  const vu2Before = client.invalidate('asset.revoked', 'VFIB-ASSET-0001', { brandId: 'VFIB', source: 'e16-setup' });
  stub.hits = [];
  const vu2 = await ec.verifyAssetUsable('VFIB', 'VFIB-ASSET-0001', { userId: 'emp-001' });
  ok('E-16 verifyAssetUsable 对已撤回资产**直接拒绝**（INVALIDATED_LOCALLY，零出站）',
    vu2Before.ok === true && vu2.ok === false && vu2.reason === 'INVALIDATED_LOCALLY' && stub.hits.length === 0,
    'reason=' + vu2.reason + ' hits=' + stub.hits.length);

  /* ============ L7 作业启停与状态 ============ */
  section('L7 轮询作业默认关闭 / 单实例锁 / 状态不外泄机密');

  const st1 = ec.start();
  ok('E-17 轮询默认关闭（POLL_DISABLED），不因未显式开启而偷偷出站',
    st1.started === false && st1.reason === 'POLL_DISABLED', st1.reason);

  stub.hits = [];
  const tk = await ec.tick({});
  ok('E-18 tick 正常路径：加单实例锁、按品牌轮询、汇总 totalItems',
    tk.ok === true && Array.isArray(tk.brands) && tk.brands.length === 1 && stub.hits.length > 0,
    'brands=' + (tk.brands || []).length);

  const lockRec = store.getDb().settings[ec.LOCK_KEY];
  ok('E-19 轮询锁登记 ownerId/pid/heartbeatAt（跨实例互斥可审计）',
    !!lockRec && lockRec.ownerId === ec.OWNER_ID && typeof lockRec.pid === 'number' && !!lockRec.heartbeatAt,
    'owner=' + (lockRec && lockRec.ownerId));

  const ecs = ec.status();
  ok('E-20 event 状态如实披露间隔为"建议值"而非 SLA，且不含票据密文',
    /建议值/.test(ecs.note) && JSON.stringify(ecs).indexOf('STUBTICKET-') === -1
      && ecs.clientConfigured === true,
    'cursors=' + ecs.cursors.length);

  applyEnv(Object.assign({}, BASE_ENV, { MOS_WORKSPACE_ENABLED: '0' }));
  const auOff = ec.authoritativeUsable('VFIB');
  const tickOff = await ec.tick({});
  ok('E-21 未配置集成：authoritativeUsable=false 且 tick 零出站（fail closed）',
    auOff.usable === false && auOff.reason === 'INTEGRATION_NOT_CONFIGURED'
      && tickOff.ok === false && tickOff.skipped === true, auOff.reason);

  /* ==================== 收尾 ==================== */
  try { server.close(); } catch (_) { /* ignore */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }

  notes.push('本套件为**离线专项自检**：桩 Provider 按 V1.1.7 契约复刻验签/防重放/封套/换票/事件流，'
    + '证明票据生命周期、401 回退、出站收敛、事件幂等与 fail closed 语义正确；'
    + '**未与真实企业资料库发生任何联调**（真实双进程 E2E 见 mos-e2e-build03 / 后续 e2e04）。');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'dual-identity-result.json'), JSON.stringify({
    suite: 'mos-dual-identity',
    phase: 'V1.1 B2/B3（受限用户票据 + 变更事件消费）',
    ranAt: new Date().toISOString(),
    contractVersion: wc.CONTRACT_VERSION,
    workspaceAppVersion: wc.WORKSPACE_APP_VERSION,
    realJointTest: 'NOT_VERIFIED',
    publicKeyFingerprint: crypto.createHash('sha256').update(PUB_PEM).digest('hex').slice(0, 16),
    notes,
    total: cases.length, passed, failed, cases
  }, null, 2), 'utf8');

  console.log('');
  for (const n of notes) console.log('  NOTE  ' + n);
  console.log('B2/B3 专项自检结果：' + passed + '/' + cases.length + ' 通过');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('B2/B3 专项自检异常：' + (err && err.stack ? err.stack : err));
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(1);
});
