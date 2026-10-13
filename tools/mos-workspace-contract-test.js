#!/usr/bin/env node
'use strict';
/**
 * A-06 企业资料库适配层 —— 离线契约自检（suite: workspace）。
 *
 * 依据整改 A-06：「Enterprise Library 真实集成的接口适配层及 contract tests，**接口契约需与
 * Enterprise Workspace 最新版源码一致**；没有可用服务时只交付可测适配器和 Mock，
 * **禁止声称联调成功**」。
 *
 * 三层结构，**无任何真实服务/凭据时全部通过**：
 *   L1 契约常量与纯函数：canonicalString / bodyHash / 错误码表 / 封套解析 / scope 剔除。
 *   L2 签名互通与篡改检测：用本适配器签名 → 用与 Workspace 服务端**同构**的
 *      `crypto.verify(null, ...)` 验签；改一字节即失败。
 *   L3 本地桩 Workspace：桩按**真实契约**逐条复刻（重建 canonicalString、验签、防重放、
 *      统一封套），验证适配器的请求形成（GET query 不参与签名、原始字节哈希、票据头、
 *      correlation-id、游标）与错误码映射**真的**正确。
 *   另：fail-closed 断言——未配置凭据时**零出站**、所有方法返回 INTEGRATION_NOT_CONFIGURED。
 *
 * 隔离口径：独立数据目录（data-mos-ws-*）、回环随机端口、跑完自清，不触碰 data/。
 */
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = path.join(os.tmpdir(), 'data-mos-ws-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
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

/* ==================== 本地桩 Workspace（按真实契约复刻） ==================== */
let stubHits = [];   // 每次请求的记录（用于断言"零出站"与头部）
let stubNonces = {};  // keyId -> Set(nonce)

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
        stubHits.push({ pathname, query, keyId, ts, nonce, sig, ticket, corr, bodyLen: raw.length, body: raw.toString('utf8') });

        const envelope = (status, okFlag, data, error) => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: okFlag, data: okFlag ? (data === undefined ? null : data) : null,
            error: okFlag ? null : (error || { code: 'ERROR', message: 'x' }),
            request_id: corr || 'req_stub', policy_version: wc.CONTRACT_VERSION
          }));
        };

        // ① health 未接入场景由用例通过 baseUrl 路径前缀切换；默认按正常流程验签
        if (!keyId || !ts || !nonce || !sig) return envelope(401, false, null, { code: 'MISSING_SIGNATURE', message: '缺签名头' });

        // ② 服务端用**收到的原始字节**重建 canonicalString（与契约 §1.1 完全一致）
        const expect = wc.canonicalString(keyId, req.method, pathname, ts, nonce, wc.sha256Hex(raw));
        let verified = false;
        try { verified = crypto.verify(null, Buffer.from(expect, 'utf8'), publicKey, Buffer.from(sig, 'base64')); } catch (_) { verified = false; }
        if (!verified) {
          // 特殊情况：由用例显式构造的"坏签名"桩路径
          return envelope(401, false, null, { code: 'BAD_SIGNATURE', message: '请求签名校验失败' });
        }

        // ③ 防重放（同 keyId 下 nonce 复用）
        const set = stubNonces[keyId] || (stubNonces[keyId] = new Set());
        if (set.has(nonce)) return envelope(401, false, null, { code: 'NONCE_REPLAY', message: 'nonce 已被使用' });
        set.add(nonce);

        // ④ 场景路由（按 pathname 前缀模拟不同响应）
        if (pathname.indexOf('/api/integrations/marketing/health') === 0) {
          return envelope(200, true, {
            enabled: true, appVersion: wc.WORKSPACE_APP_VERSION, policyVersion: wc.CONTRACT_VERSION,
            capabilities: { publishedContentArchive: false },
            signing: { ticketKeySource: 'ephemeral-random-per-boot' }
          });
        }
        if (pathname === '/api/integrations/marketing/tickets') {
          return envelope(200, true, { ticket: 'stub.service.ticket', kind: 'service', scopes: ['assets.read'] });
        }
        if (pathname === '/api/integrations/marketing/knowledge/search') {
          return envelope(200, true, {
            items: [{ documentId: 'VFIB-2026-0001', libraryAssetId: 'VFIB-ASSET-2026-0001', title: 'T',
              classification: { key: 'internal', rank: 2 }, snippet: null, contentWithheld: true,
              withholdReason: 'AI 出口策略未放行' }],
            contentPolicy: { wholeDocumentExport: 'forbidden' }
          });
        }
        if (pathname === '/api/integrations/marketing/assets/search') {
          return envelope(200, true, { items: [{ id: 'VFIB-ASSET-2026-0001', brandId: 'VFIB', reusable: true }] });
        }
        if (pathname.indexOf('/api/integrations/marketing/assets/') === 0) {
          // GET /assets/:id?version=... —— 断言点：query **不参与签名**
          if (pathname.indexOf('/api/integrations/marketing/assets/GONE') !== -1) {
            return envelope(410, false, null, { code: 'ASSET_GONE', message: '资产已废止' });
          }
          if (pathname.indexOf('/api/integrations/marketing/assets/MISSING') !== -1) {
            return envelope(404, false, null, { code: 'NOT_FOUND', message: '不存在' });
          }
          return envelope(200, true, { id: 'VFIB-ASSET-2026-0001', version: String(query.version || ''), fileAccess: 'not-exposed' });
        }
        if (pathname.indexOf('/api/integrations/marketing/admissions') === 0) {
          if (pathname.indexOf('/artifact') !== -1) {
            // 未最终审批 → 409 FINAL_APPROVAL_REQUIRED（契约 §5.3 第 ④ 步）
            return envelope(409, false, null, { code: 'FINAL_APPROVAL_REQUIRED', message: '尚未完成独立最终审批' });
          }
          if (pathname.indexOf('/submit') !== -1) {
            return envelope(200, true, { state: 'FINAL_APPROVAL_PENDING', steps: ['SUBMITTED', 'PRECHECK', 'REVIEWING'] });
          }
          if (pathname.indexOf('/final-decision') !== -1) {
            return envelope(403, false, null, { code: 'TICKET_KIND_MISMATCH', message: '该端点要求 kind=session' });
          }
          return envelope(200, true, { admissionRequestId: 'ADM-1', state: 'DRAFT', created: true });
        }
        if (pathname === '/api/integrations/marketing/changes') {
          return envelope(200, true, {
            items: [], nextCursor: Number(query.cursor || 0), hasMore: false, truncated: false,
            oldestCursor: 0, pollIntervalHintSeconds: wc.CHANGES_POLL_HINT_SECONDS
          });
        }
        if (pathname.indexOf('/ratelimited') !== -1) {
          return envelope(429, false, null, { code: 'RATE_LIMITED', message: '超出配额' });
        }
        return envelope(404, false, null, { code: 'NOT_FOUND', message: 'stub 未实现：' + pathname });
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  console.log('企业资料库适配层契约自检（A-06）');
  const { server, port } = await startStub();
  const baseUrl = 'http://127.0.0.1:' + port;
  const ws = require('../lib/mos/adapters/workspace');

  /* ==================== L1：契约常量与纯函数 ==================== */
  section('L1 契约常量与纯函数（与 Workspace V1.1.7 源码对齐）');

  const cs = wc.canonicalString('svc_1', 'get', '/api/x', '1700000000', 'nonce1', 'HASH');
  ok('WC-01 canonicalString：v1 + 7 段、method 大写、以 \\n 连接、末尾无换行',
    cs === 'v1\nsvc_1\nGET\n/api/x\n1700000000\nnonce1\nHASH' && cs.slice(-1) !== '\n',
    JSON.stringify(cs));

  ok('WC-02 无体请求的 bodyHash = sha256(\'\') 的固定值（契约 §1.1 第 1 点）',
    wc.EMPTY_BODY_HASH === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    wc.EMPTY_BODY_HASH);

  let threw = false;
  try { wc.signedHeaders({ keyId: 'k', privateKey, method: 'GET', pathname: '/a?x=1', bodyStr: '' }); } catch (_) { threw = true; }
  ok('WC-03 pathname 含 query 时**直接报错**（不静默截断，避免误以为 query 已签）', threw);

  ok('WC-04 bodyHash 对原始字符串：\'\' vs \'{}\' 不同（禁止重新序列化）',
    wc.bodyHashOf('') !== wc.bodyHashOf('{}') && wc.bodyHashOf('{"a":1}') !== wc.bodyHashOf('{ "a": 1 }'),
    'h(empty)=' + wc.bodyHashOf('').slice(0, 12));

  ok('WC-05 错误码表覆盖契约 §3（服务/票据/业务三层的代表码）且 HTTP 状态一致',
    wc.ERROR_CODES.BAD_SIGNATURE.http === 401 && wc.ERROR_CODES.RATE_LIMITED.http === 429
      && wc.ERROR_CODES.TICKET_KIND_MISMATCH.http === 403 && wc.ERROR_CODES.BRAND_MISMATCH.http === 403
      && wc.ERROR_CODES.ASSET_GONE.http === 410 && wc.ERROR_CODES.ASSET_IMMUTABLE.http === 409
      && wc.ERROR_CODES.FINAL_APPROVAL_REQUIRED.http === 409 && wc.ERROR_CODES.NOT_FOUND.http === 404,
    'codes=' + Object.keys(wc.ERROR_CODES).length);

  ok('WC-06 端点数与路径前缀与源码注册表一致（含文档未列出的 skills）',
    Object.keys(wc.ENDPOINTS).length === 12
      && wc.ENDPOINTS.HEALTH.path === '/api/integrations/marketing/health'
      && wc.ENDPOINTS.SKILL_GET.path === '/api/integrations/marketing/skills/:id'
      && wc.ENDPOINTS.ADMISSION_FINAL_DECISION.ticketKind === 'session',
    'endpoints=' + Object.keys(wc.ENDPOINTS).length);

  ok('WC-07 服务账户 scope 无 admission.final.decision；ticket scope 有（双重闭合第一重）',
    wc.SERVICE_SCOPES.indexOf('admission.final.decision') === -1
      && wc.TICKET_SCOPES.indexOf('admission.final.decision') !== -1
      && wc.SESSION_ONLY_TICKET_SCOPES.indexOf('admission.final.decision') !== -1,
    'serviceScopes=' + wc.SERVICE_SCOPES.length + ' ticketScopes=' + wc.TICKET_SCOPES.length);

  ok('WC-08 serviceGrantable 剔除 final 范围（服务账户请求也拿不到）',
    JSON.stringify(wc.serviceGrantable(['assets.read', 'admission.final.decision'])) === JSON.stringify(['assets.read']),
    JSON.stringify(wc.serviceGrantable(['assets.read', 'admission.final.decision'])));

  ok('WC-09 封套校验：失败响应 data 必须为 null，缺键即判非法',
    wc.isEnvelope({ ok: true, data: {}, error: null, request_id: 'r', policy_version: '1.0' }) === true
      && wc.isEnvelope({ ok: false, data: null, error: { code: 'X' }, request_id: 'r', policy_version: '1.0' }) === true
      && wc.isEnvelope({ ok: false, data: { leak: 1 }, error: { code: 'X' }, request_id: 'r', policy_version: '1.0' }) === false
      && wc.isEnvelope({ ok: true, data: {} }) === false);

  const pe = wc.parseEnvelope(429, { ok: false, data: null, error: { code: 'RATE_LIMITED' }, request_id: 'r', policy_version: '1.0' });
  ok('WC-10 封套解析：错误码分层与可重试判定（429→service/retryable，404→business/不可重试）',
    pe.errorLayer === 'service' && pe.retryable === true && pe.envelopeValid === true
      && wc.parseEnvelope(404, { ok: false, data: null, error: { code: 'NOT_FOUND' }, request_id: 'r', policy_version: '1.0' }).retryable === false,
    'layer=' + pe.errorLayer + ' retryable=' + pe.retryable);

  /* ==================== L2：签名互通与篡改检测 ==================== */
  section('L2 Ed25519 签名互通（与 Workspace 服务端同构验签）');
  const s = wc.signedHeaders({ keyId: 'svc_1', privateKey, method: 'post', pathname: '/api/x', bodyStr: '{"a":1}' });
  ok('WC-11 本适配器签名可被服务端同构 verify(null, canonical, pub, sig) 通过',
    wc.verifySigned('svc_1', 'POST', '/api/x', s.timestamp, s.nonce, '{"a":1}', s.headers['x-vfib-signature'], publicKey) === true,
    'nonce.len=' + s.nonce.length + ' sig.len=' + s.headers['x-vfib-signature'].length);

  ok('WC-12 篡改检测：任一要素变化（body / method / pathname / nonce）即验签失败',
    wc.verifySigned('svc_1', 'POST', '/api/x', s.timestamp, s.nonce, '{"a":2}', s.headers['x-vfib-signature'], publicKey) === false
      && wc.verifySigned('svc_1', 'GET', '/api/x', s.timestamp, s.nonce, '{"a":1}', s.headers['x-vfib-signature'], publicKey) === false
      && wc.verifySigned('svc_1', 'POST', '/api/y', s.timestamp, s.nonce, '{"a":1}', s.headers['x-vfib-signature'], publicKey) === false
      && wc.verifySigned('svc_1', 'POST', '/api/x', s.timestamp, 'other', '{"a":1}', s.headers['x-vfib-signature'], publicKey) === false);

  ok('WC-13 nonce 默认 12 字节随机 hex（24 字符）且两次调用不同',
    s.nonce.length === 24 && wc.signedHeaders({ keyId: 'k', privateKey, method: 'GET', pathname: '/a', bodyStr: '' }).nonce !== s.nonce);

  /* ==================== fail closed（未配置凭据 → 零出站） ==================== */
  section('fail closed：未配置凭据时零出站、恒 INTEGRATION_NOT_CONFIGURED');
  applyEnv({ MOS_WORKSPACE_ENABLED: '0', MOS_WORKSPACE_BASE_URL: baseUrl, MOS_WORKSPACE_KEY_ID: '', MOS_WORKSPACE_PRIVATE_KEY_PEM: '', MOS_WORKSPACE_TICKET: '' });
  stubHits = [];
  const stOff = ws.status();
  const rOff1 = await ws.health();
  const rOff2 = await ws.assetsSearch({ query: 'q', brandId: 'VFIB' });
  const rOff3 = await ws.createAdmission({ idempotencyKey: 'k', brandId: 'VFIB' });
  ok('WC-14 未配置时 status().configured=false 且如实列出缺失项',
    stOff.configured === false && stOff.missing.indexOf('keyId') !== -1 && stOff.missing.indexOf('privateKey') !== -1,
    'missing=' + JSON.stringify(stOff.missing));
  ok('WC-15 未配置时所有业务方法返回 INTEGRATION_NOT_CONFIGURED，且**桩零命中**（真的没出站）',
    rOff1.state === 'INTEGRATION_NOT_CONFIGURED' && rOff2.state === 'INTEGRATION_NOT_CONFIGURED'
      && rOff3.state === 'INTEGRATION_NOT_CONFIGURED' && stubHits.length === 0,
    'state=' + rOff2.state + ' stubHits=' + stubHits.length);

  applyEnv({ MOS_WORKSPACE_ENABLED: '1', MOS_WORKSPACE_KEY_ID: 'svc_1', MOS_WORKSPACE_PRIVATE_KEY_PEM: 'not-a-pem' });
  const stBadKey = ws.status();
  stubHits = [];
  const rBadKey = await ws.health();
  ok('WC-16 私钥非法（解析失败）：configured=false、如实报错、零出站',
    stBadKey.configured === false && /解析失败/.test(stBadKey.privateKeyError)
      && rBadKey.state === 'INTEGRATION_NOT_CONFIGURED' && stubHits.length === 0,
    'err=' + stBadKey.privateKeyError.slice(0, 40) + ' hits=' + stubHits.length);

  /* ==================== L3：本地桩 Workspace 契约验证 ==================== */
  section('L3 本地桩 Workspace（真实验签 + 防重放 + 统一封套）');
  applyEnv({
    MOS_WORKSPACE_ENABLED: '1', MOS_WORKSPACE_BASE_URL: baseUrl,
    MOS_WORKSPACE_KEY_ID: 'svc_1', MOS_WORKSPACE_PRIVATE_KEY_PEM: PRIV_PEM,
    MOS_WORKSPACE_TICKET: 'stub.service.ticket', MOS_WORKSPACE_TIMEOUT_MS: '4000'
  });
  stubHits = []; stubNonces = {};
  const stOn = ws.status();
  const h = await ws.health();
  ok('WC-17 已配置：status().configured=true；health 通则 200 封套（桩如实披露 ticketKeySource）',
    stOn.configured === true && stOn.ticketPresent === true && h.ok === true && h.state === 'OK'
      && h.data && h.data.signing && h.data.signing.ticketKeySource === 'ephemeral-random-per-boot',
    'configured=' + stOn.configured + ' health=' + h.health + ' policy=' + h.policyVersion);

  ok('WC-18 请求头齐全：key-id / timestamp / nonce / signature / ticket / correlation-id',
    stubHits.length === 1 && !!stubHits[0].keyId && !!stubHits[0].ts && !!stubHits[0].nonce
      && !!stubHits[0].sig && stubHits[0].ticket === 'stub.service.ticket' && /^mos-/.test(stubHits[0].corr),
    'headers=' + JSON.stringify(Object.keys(stubHits[0]).length));

  const a1 = await ws.getAsset('VFIB-ASSET-2026-0001', { version: 'VFIB-ASSET-2026-0001-V1.0', brandId: 'VFIB' });
  ok('WC-19 GET 带 query：**query 不参与签名**（服务端仅按 pathname 验签即通过），并原样回带 version',
    a1.ok === true && a1.data && a1.data.version === 'VFIB-ASSET-2026-0001-V1.0'
      && a1.data.fileAccess === 'not-exposed' && !!a1.requestId,
    'version=' + (a1.data && a1.data.version) + ' fileAccess=' + (a1.data && a1.data.fileAccess));

  const gc = await ws.getAsset('GONE');
  ok('WC-20 410 ASSET_GONE：errorLayer=business、不可重试（营销侧据此清缓存）',
    gc.ok === false && gc.errorCode === 'ASSET_GONE' && gc.errorLayer === 'business' && gc.retryable === false,
    'code=' + gc.errorCode + ' layer=' + gc.errorLayer);

  const gm = await ws.getAsset('MISSING');
  ok('WC-21 404 NOT_FOUND：与「无权」同响应、不可探测，且不可重试',
    gm.ok === false && gm.errorCode === 'NOT_FOUND' && gm.retryable === false && gm.envelopeValid === true,
    'code=' + gm.errorCode + ' retryable=' + gm.retryable);

  const fa = await ws.pushArtifact('ADM-1', { fileName: 'a.svg', contentBase64: 'PHN2Zy8+' });
  ok('WC-22 409 FINAL_APPROVAL_REQUIRED：标记为可重试（审批完成后可重推），状态不改写',
    fa.ok === false && fa.errorCode === 'FINAL_APPROVAL_REQUIRED' && fa.errorCode === 'FINAL_APPROVAL_REQUIRED'
      && fa.retryable === true && fa.errorLayer === 'business',
    'code=' + fa.errorCode + ' retryable=' + fa.retryable);

  const ks = await ws.knowledgeSearch({ query: 'KYC', brandId: 'VFIB' });
  ok('WC-23 检索正文边界：snippet=null + contentWithheld=true + withholdReason，且整篇外送被禁',
    ks.ok === true && ks.data.items[0].snippet === null && ks.data.items[0].contentWithheld === true
      && !!ks.data.items[0].withholdReason && ks.data.contentPolicy.wholeDocumentExport === 'forbidden',
    'withheld=' + ks.data.items[0].contentWithheld);

  const ch = await ws.changes({ cursor: 0, brandId: 'VFIB' });
  ok('WC-24 变更事件流：游标语义为 seq、下一游标与保留上限提示一致',
    ch.ok === true && ch.data.nextCursor === 0 && ch.data.truncated === false
      && ch.data.pollIntervalHintSeconds === wc.CHANGES_POLL_HINT_SECONDS,
    'nextCursor=' + (ch.data && ch.data.nextCursor));

  const tk = await ws.issueServiceTicket({ userId: 'u1', brandId: 'VFIB', scopes: ['assets.read', 'admission.final.decision'] });
  ok('WC-25 签发服务票据：本地即剔除 admission.final.decision（双重闭合第一重，可审计）',
    tk.requestedScopes.indexOf('admission.final.decision') !== -1
      && tk.grantedScopes.indexOf('admission.final.decision') === -1
      && tk.strippedScopes.indexOf('admission.final.decision') !== -1,
    'granted=' + JSON.stringify(tk.grantedScopes) + ' stripped=' + JSON.stringify(tk.strippedScopes));

  const fd = await ws.finalDecision();
  ok('WC-26 结构性边界：服务侧 finalDecision() **恒拒绝**（最终审批只能本人会话完成）',
    fd.ok === false && fd.state === 'FINAL_DECISION_REQUIRES_SESSION' && fd.errorCode === 'TICKET_KIND_MISMATCH',
    'state=' + fd.state);

  const caps = ws.capabilities();
  ok('WC-27 能力声明不夸大：服务账户无最终审批权、不提供 Published Content 归档',
    caps.finalDecisionByServiceAccount === false && caps.publishedContentArchive === false
      && caps.notProvided.indexOf('publishedContentArchive') !== -1,
    'finalByService=' + caps.finalDecisionByServiceAccount);

  // 密钥/票据不外泄
  const leak = JSON.stringify({ st: ws.status(), caps: ws.capabilities(), h });
  ok('WC-28 密钥与票据不外泄：status/capabilities/响应序列化不含私钥 PEM 或票据原文',
    leak.indexOf('PRIVATE KEY') === -1 && leak.indexOf('stub.service.ticket') === -1,
    'blob.len=' + leak.length);

  // 防重放：桩会拒绝复用 nonce → 适配器每次都新 nonce，故连续调用均通过
  stubHits = []; stubNonces = {};
  const c1 = await ws.health(); const c2 = await ws.health();
  ok('WC-29 nonce 每次唯一：连续两次调用均不被桩判为 NONCE_REPLAY',
    c1.ok === true && c2.ok === true && stubHits.length === 2 && stubHits[0].nonce !== stubHits[1].nonce,
    'n1=' + String(stubHits[0].nonce).slice(0, 8) + ' n2=' + String(stubHits[1].nonce).slice(0, 8));

  section('L4 与 Workspace V1.1.7 实取源码的逐项对齐（2026-10-13 修正项）');

  // WC-31：事件类型字面量 —— 必须与 events.js 完全一致（含下划线与 skill.version.changed）
  const evtOk = wc.EVENT_TYPES.length === 7
    && wc.EVENT_TYPES.indexOf('skill.version.changed') !== -1
    && wc.EVENT_TYPES.indexOf('service_account.changed') !== -1
    && wc.EVENT_TYPES.indexOf('service.account.changed') === -1;
  ok('WC-31 事件类型表与 Workspace events.js 一致（下划线 service_account.changed + 含 skill.version.changed）',
    evtOk, wc.EVENT_TYPES.join(','));

  // WC-32：补齐的错误码可被正确分层（此前落 unknown）
  const e1 = wc.parseEnvelope(400, { ok: false, data: null, error: { code: 'BAD_ADMISSION_INPUT' }, request_id: 'r', policy_version: '1.0' });
  const e2 = wc.parseEnvelope(404, { ok: false, data: null, error: { code: 'USER_NOT_FOUND' }, request_id: 'r', policy_version: '1.0' });
  ok('WC-32 补齐 BAD_ADMISSION_INPUT/USER_NOT_FOUND 后可正确分层（不再落 unknown）',
    e1.errorLayer === 'request' && e1.retryable === false && e2.errorLayer === 'request' && e2.retryable === false,
    'l1=' + e1.errorLayer + ' l2=' + e2.errorLayer);

  // WC-33：准入入参预校验 fail closed —— 本侧模型目前给不出必填字段 → 零出站
  stubHits = [];
  const pre = await ws.createAdmission({ originObjectId: 'wa_1', contentHash: 'a'.repeat(64), brandId: 'VFIB', title: 't' });
  ok('WC-33 准入入参缺必填字段 → BAD_ADMISSION_INPUT + missing[]，且**零出站**',
    pre.ok === false && pre.errorCode === 'BAD_ADMISSION_INPUT' && pre.missing.indexOf('libraryPrimaryCategory') !== -1
      && pre.missing.indexOf('classification') !== -1 && pre.missing.indexOf('licenseStatus') !== -1 && stubHits.length === 0,
    'missing=' + pre.missing.join('|') + ' hits=' + stubHits.length);

  // WC-34：字段齐备 → 放行并如实携带服务端必填字段
  stubHits = [];
  const full = await ws.createAdmission({
    idempotencyKey: 'idem_1', originObjectId: 'wa_1', brandId: 'VFIB',
    libraryPrimaryCategory: '02', classification: 'internal', licenseStatus: 'cleared',
    marketingCategory: 'A03', title: 'T', contentHash: 'b'.repeat(64)
  });
  const sentBody = stubHits.length ? JSON.parse(stubHits[0].body) : {};
  ok('WC-34 字段齐备：申请放行，请求体含 libraryPrimaryCategory/classification/licenseStatus，且 originSystem 不由调用方指定',
    full.ok === true && sentBody.libraryPrimaryCategory === '02' && sentBody.classification === 'internal'
      && sentBody.licenseStatus === 'cleared' && sentBody.originSystem === undefined
      && sentBody.reuseScope === 'none' && sentBody.externalAiTransferPolicy === 'blocked',
    'state=' + full.state + ' body=' + JSON.stringify(sentBody).slice(0, 160));

  // WC-35：knowledgeSearch 发 topK（旧实现发 limit 会被服务端忽略）
  stubHits = [];
  await ws.knowledgeSearch({ query: 'q', brandId: 'VFIB', limit: 7 });
  const ksBody = stubHits.length ? JSON.parse(stubHits[0].body) : {};
  ok('WC-35 knowledgeSearch 以 topK 传参（limit 作为兼容别名映射到 topK）',
    ksBody.topK === 7 && ksBody.limit === undefined, 'body=' + JSON.stringify(ksBody));

  // WC-36：assetsSearch 支持 offset 与三类过滤（服务端按 body.offset 分页）
  stubHits = [];
  await ws.assetsSearch({ query: 'q', brandId: 'VFIB', limit: 10, offset: 20, marketingCategory: 'A03' });
  const asBody = stubHits.length ? JSON.parse(stubHits[0].body) : {};
  ok('WC-36 assetsSearch 支持 offset 与 marketingCategory 过滤', asBody.offset === 20 && asBody.marketingCategory === 'A03',
    'body=' + JSON.stringify(asBody));

  // 坏签名场景：把私钥换成另一把 → 桩验签失败 → 401 BAD_SIGNATURE，分层为 service
  const other = crypto.generateKeyPairSync('ed25519');
  applyEnv({ MOS_WORKSPACE_PRIVATE_KEY_PEM: other.privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  const bad = await ws.knowledgeSearch({ query: 'x', brandId: 'VFIB' });
  ok('WC-30 签名不匹配：401 BAD_SIGNATURE → errorLayer=service、不可重试（不掩盖为业务错误）',
    bad.ok === false && bad.errorCode === 'BAD_SIGNATURE' && bad.errorLayer === 'service' && bad.retryable === false,
    'code=' + bad.errorCode + ' layer=' + bad.errorLayer);

  /* ==================== 收尾 ==================== */
  try { server.close(); } catch (_) { /* ignore */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }

  notes.push('本套件为**离线契约自检**：桩服务按契约逐条复刻验签/防重放/封套，'
    + '证明适配器请求形成与错误码映射正确；**未与真实 Enterprise Workspace 发生任何联调**（真实联调 NOT_VERIFIED）。');

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'workspace-contract-result.json'), JSON.stringify({
    suite: 'mos-workspace-contract',
    phase: 'Phase 3（A-06 企业资料库适配层契约）',
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
  console.log('资料库契约自检结果：' + passed + '/' + cases.length + ' 通过');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('资料库契约自检异常：' + (err && err.stack ? err.stack : err));
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(1);
});
