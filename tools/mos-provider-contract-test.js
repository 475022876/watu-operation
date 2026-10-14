#!/usr/bin/env node
'use strict';
/**
 * A-05 Provider 统一契约自检（suite: provider）。
 *
 * 依据 04 §6「Provider 契约：health/status、invoke、timeout、rateLimit、costReceipt、errorCode」
 * 与整改 A-05：「至少验证一个真实文本和一个真实图像 Provider 端到端调用；**没有凭据则保持
 * NOT_CONFIGURED**，提供隔离的 contract test 与启用说明，不阻断纯本地原型构建」。
 *
 * 本套件分三层，**默认在无任何凭据的 CI 环境全部通过**：
 *   L1 离线诚实性（零出站）：未配置 → NOT_CONFIGURED，绝不伪造内容；密钥不外泄；契约纯函数正确。
 *   L2 本地桩契约验证（零真实供应商）：指向本机桩服务，逐条验证 invoke/timeout/rateLimit/
 *      costReceipt/errorCode 的真实行为——证明适配器**真的**按契约工作，而非只写了字段名。
 *   L3 真实端到端（**仅当 MOS_PROVIDER_LIVE=1 且提供密钥时**执行）：调用真实供应商并把
 *      **原始回执**落证据目录；缺凭据时如实记录 BLOCKED（不假称已验证）。
 *
 * 隔离口径：独立数据目录（data-mos-provider-*）、回环随机端口、跑完自清，不触碰 data/。
 */
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const DATA_DIR = path.join(os.tmpdir(), 'data-mos-provider-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
const OUT_DIR = path.join(__dirname, '..', 'TEST_EVIDENCE_MOS_BUILD01');

process.env.MOS_DATA_DIR = DATA_DIR;
process.env.MOS_DEMO_SEED = '1';
process.env.MOS_PRODUCTION = '0';

const mosConfig = require('../lib/mos/config');
const pc = require('../lib/mos/providercontract');

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
/** 切换 Provider 配置后让 config 缓存失效（同一进程内多次改 env 必须） */
function applyEnv(env) {
  for (const k of Object.keys(env)) {
    if (env[k] === null) delete process.env[k]; else process.env[k] = String(env[k]);
  }
  mosConfig.resetConfigCache();
}

/* ==================== 本机桩供应商（仅回环，测试专用） ==================== */
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function startStub() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url || '';
      const send = (code, obj, headers) => {
        res.writeHead(code, Object.assign({ 'Content-Type': 'application/json' }, headers || {}));
        res.end(JSON.stringify(obj));
      };
      // 500：真实供应商错误
      if (url.indexOf('/err/') === 0) return send(500, { error: { message: 'stub upstream failure' } });
      // 429：限流（带 retry-after）
      if (url.indexOf('/rl/') === 0) {
        return send(429, { error: { message: 'stub rate limited' } }, { 'retry-after': '7', 'x-ratelimit-remaining-requests': '0' });
      }
      // 慢响应：用于触发超时
      if (url.indexOf('/slow/') === 0) {
        return setTimeout(() => send(200, { choices: [{ message: { content: 'too late' } }], data: [{ b64_json: PNG_1x1 }] }), 2500);
      }
      // 空响应：图像缺 b64
      if (url.indexOf('/empty/') === 0) return send(200, { data: [{}] });
      // 正常：文本（deepseek 风格）
      if (url.indexOf('/chat/completions') !== -1) {
        return send(200, {
          choices: [{ message: { content: 'stub real text content' } }],
          usage: { prompt_tokens: 11, completion_tokens: 7 }
        }, { 'x-ratelimit-limit-requests': '60', 'x-ratelimit-remaining-requests': '59' });
      }
      // 正常：图像（openai 风格，含真实成本回执字段）
      if (url.indexOf('/images/generations') !== -1) {
        return send(200, {
          id: 'stub-img-1',
          data: [{ b64_json: PNG_1x1 }],
          usage: { total_tokens: 42 },
          cost: { amount: 0.04, currency: 'USD' }
        });
      }
      return send(404, { error: { message: 'stub not found: ' + url } });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  console.log('Provider 契约自检（A-05）');
  const { server, port } = await startStub();
  const base = 'http://127.0.0.1:' + port;
  const text = require('../lib/mos/adapters/text');
  const image = require('../lib/mos/adapters/image');

  /* ==================== L1：离线诚实性（零出站） ==================== */
  section('L1 离线诚实性（无凭据 → NOT_CONFIGURED，零出站）');

  applyEnv({ MOS_TEXT_PROVIDER: 'none', MOS_IMAGE_PROVIDER: 'none', MOS_TEXT_API_KEY: '', MOS_IMAGE_API_KEY: '' });
  const tStat = text.status();
  const tHealth = await text.health();
  ok('PC-01 文本：未配置时 status/health 均如实为未配置（零出站）',
    tStat.configured === false && tStat.provider === 'none'
      && tHealth.state === 'NOT_CONFIGURED' && tHealth.configured === false,
    'configured=' + tStat.configured + ' health=' + tHealth.state);

  const tNone = await text.invoke({ op: 'draft', title: 'X', brief: 'Y' });
  ok('PC-02 文本：未配置时 invoke 返回 NOT_CONFIGURED 且**不产出任何文字**',
    tNone.state === 'NOT_CONFIGURED' && tNone.text === '' && tNone.errorCode === pc.ERROR_CODES.NOT_CONFIGURED,
    'state=' + tNone.state + ' text.len=' + String(tNone.text).length + ' errorCode=' + tNone.errorCode);

  const iNone = await image.invoke({ op: 'generate', prompt: 'anything' });
  const iStat = image.status();
  ok('PC-03 图像：未配置时 invoke 返回 NOT_CONFIGURED 且 outputs 为空',
    iNone.state === 'NOT_CONFIGURED' && iNone.outputs.length === 0 && iStat.configured === false
      && iNone.errorCode === pc.ERROR_CODES.NOT_CONFIGURED,
    'state=' + iNone.state + ' outputs=' + iNone.outputs.length + ' configured=' + iStat.configured);

  // 选中真实供应商但无密钥 → 仍 NOT_CONFIGURED（fail closed，不伪造）
  applyEnv({ MOS_TEXT_PROVIDER: 'deepseek', MOS_IMAGE_PROVIDER: 'openai', MOS_TEXT_API_KEY: '', MOS_IMAGE_API_KEY: '' });
  const tNoKey = await text.invoke({ op: 'draft', brief: 'b' });
  const iNoKey = await image.invoke({ op: 'generate', prompt: 'p' });
  ok('PC-04 选中真实供应商但无密钥：文本/图像一律 NOT_CONFIGURED（绝不伪造模型输出）',
    tNoKey.state === 'INTEGRATION_PENDING' && tNoKey.text === '' && tNoKey.errorCode === pc.ERROR_CODES.NOT_CONFIGURED
      && iNoKey.state === 'NOT_CONFIGURED' && iNoKey.outputs.length === 0,
    'text=' + tNoKey.state + ' image=' + iNoKey.state);

  // 密钥不外泄：status/health 序列化后不得出现密钥值
  applyEnv({ MOS_TEXT_API_KEY: 'sk-SECRET-DO-NOT-LEAK', MOS_IMAGE_API_KEY: 'sk-IMAGE-SECRET' });
  const leakBlob = JSON.stringify({
    ts: text.status(), th: await text.health(),
    is: image.status(), ih: await image.health()
  });
  ok('PC-05 密钥不外泄：status/health 序列化结果不含密钥（只在服务端）',
    leakBlob.indexOf('SECRET') === -1 && leakBlob.indexOf('apiKey') === -1,
    'blob.len=' + leakBlob.length);

  ok('PC-06 hasServerKey 只报布尔、不报密钥本身',
    text.status().hasServerKey === true && image.status().hasServerKey === true
      && typeof text.status().hasServerKey === 'boolean',
    'text.hasServerKey=' + text.status().hasServerKey);

  /* ==================== V0.1.3 Phase C：就绪度（执行包 06 §真实Provider判定） ====================
   * 判定口径：REAL / CONFIGURED_NOT_TESTED / NOT_CONFIGURED / NOT_IMPLEMENTED / BLOCKED。
   * 关键诚实性：**MOCK 不是真实模型能力**，就绪度仍为 NOT_CONFIGURED；视频 AI 成片
   * **未实现**，就绪度为 NOT_IMPLEMENTED 且不得宣称可生成成片。 */
  section('V0.1.3 Phase C 就绪度（不得把 MOCK / 未实现 说成 REAL）');

  applyEnv({ MOS_IMAGE_PROVIDER: 'none', MOS_IMAGE_API_KEY: '' });
  ok('PC-06a 图像：未配置 → readiness=NOT_CONFIGURED',
    image.status().readiness === 'NOT_CONFIGURED',
    'readiness=' + image.status().readiness);

  applyEnv({ MOS_IMAGE_PROVIDER: 'mock', MOS_IMAGE_API_KEY: '' });
  const iMockStat = image.status();
  ok('PC-06b 图像：MOCK 不被标为 REAL（readiness 仍 NOT_CONFIGURED，且标注 simulated）',
    iMockStat.readiness === 'NOT_CONFIGURED' && iMockStat.simulated === true && iMockStat.mock === true,
    'readiness=' + iMockStat.readiness + ' simulated=' + iMockStat.simulated);

  applyEnv({ MOS_IMAGE_PROVIDER: 'openai', MOS_IMAGE_API_KEY: 'sk-image-readiness' });
  const iKeyStat = image.status();
  ok('PC-06c 图像：已选真实供应商且有密钥 → CONFIGURED_NOT_TESTED（未联调不称 REAL）',
    iKeyStat.readiness === 'CONFIGURED_NOT_TESTED',
    'readiness=' + iKeyStat.readiness);

  const vStat = image.videoStatus();
  ok('PC-06d 视频：AI 成片未实现 → readiness=NOT_IMPLEMENTED，且只声明手工流程能力',
    vStat.readiness === 'NOT_IMPLEMENTED' && vStat.manualWorkflow === true
      && vStat.capabilities.indexOf('FINAL_CUT_UPLOAD') !== -1
      && vStat.capabilities.indexOf('AI_RENDER') === -1,
    'readiness=' + vStat.readiness + ' caps=' + vStat.capabilities.join('/'));

  applyEnv({ MOS_IMAGE_PROVIDER: 'none', MOS_IMAGE_API_KEY: '' });
  const helpers = require('../lib/mos/routes/helpers');
  const integ = helpers.integrationStatus();
  ok('PC-06e 集成状态矩阵暴露 imageProvider.readiness 与 videoProvider（BLOCKED 不被隐去）',
    !!integ.imageProvider.readiness && integ.videoProvider
      && integ.videoProvider.readiness === 'NOT_IMPLEMENTED',
    'image=' + integ.imageProvider.readiness + ' video=' + integ.videoProvider.readiness);

  /* ==================== 契约纯函数 ==================== */
  section('契约纯函数（分类/限流/费用回执的诚实性）');
  ok('PC-07 classifyHttp：429→RATE_LIMITED，5xx→HTTP_ERROR，4xx→BAD_REQUEST',
    pc.classifyHttp(429) === pc.ERROR_CODES.RATE_LIMITED
      && pc.classifyHttp(500) === pc.ERROR_CODES.HTTP_ERROR
      && pc.classifyHttp(400) === pc.ERROR_CODES.BAD_REQUEST,
    '429/500/400=' + [pc.classifyHttp(429), pc.classifyHttp(500), pc.classifyHttp(400)].join(','));

  const abortErr = Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  ok('PC-08 classifyError：AbortError→TIMEOUT，其余→NETWORK_ERROR，且 TIMEOUT 可重试',
    pc.classifyError(abortErr) === pc.ERROR_CODES.TIMEOUT
      && pc.classifyError(new Error('boom')) === pc.ERROR_CODES.NETWORK_ERROR
      && pc.isRetryable(pc.ERROR_CODES.TIMEOUT) === true
      && pc.isRetryable(pc.ERROR_CODES.BAD_REQUEST) === false,
    'abort=' + pc.classifyError(abortErr) + ' retryable(400)=' + pc.isRetryable(pc.ERROR_CODES.BAD_REQUEST));

  const rl = pc.parseRateLimit({ get: (k) => ({ 'x-ratelimit-limit-requests': '60', 'retry-after': '7' }[k] === undefined ? null : { 'x-ratelimit-limit-requests': '60', 'retry-after': '7' }[k]) });
  ok('PC-09 parseRateLimit：只回填供应商真实提供的字段，缺失一律 null',
    rl.limit === 60 && rl.retryAfterSec === 7 && rl.remaining === null && rl.resetAt === null,
    'limit=' + rl.limit + ' remaining=' + rl.remaining + ' retryAfter=' + rl.retryAfterSec);

  ok('PC-10 costReceipt：无回执一律 amount=null/confirmed=false（不凭空推算）',
    pc.costReceipt({}).amount === null && pc.costReceipt({}).confirmed === false
      && pc.costReceipt({ cost: { amount: 0.04, currency: 'USD' } }).amount === 0.04
      && pc.costReceipt({ cost: { amount: 0.04, currency: 'USD' } }).confirmed === true,
    'absent=' + JSON.stringify(pc.costReceipt({}).amount) + ' present=0.04');

  /* ==================== MOCK 与分级闸门 ==================== */
  section('MOCK 标注与数据分级闸门');
  applyEnv({ MOS_TEXT_PROVIDER: 'mock', MOS_IMAGE_PROVIDER: 'mock' });
  const tMock = await text.invoke({ op: 'draft', title: '标题', brief: '要点一。要点二。' });
  ok('PC-11 MOCK 文本草稿：state=MOCK 且醒目标注「非模型输出」',
    tMock.state === 'MOCK' && tMock.mock === true && /非模型输出/.test(tMock.text),
    'state=' + tMock.state + ' mock=' + tMock.mock);

  const iMockA = await image.invoke({ op: 'generate', prompt: 'same prompt' });
  const iMockB = await image.invoke({ op: 'generate', prompt: 'same prompt' });
  ok('PC-12 MOCK 图像：产出真实落盘 SVG、标注「非真实模型输出」且同提示词字节可复现',
    iMockA.state === 'MOCK' && iMockA.outputs.length === 1
      && iMockA.outputs[0].bytes.toString('utf8').indexOf('非真实模型输出') !== -1
      && iMockA.outputs[0].bytes.equals(iMockB.outputs[0].bytes),
    'state=' + iMockA.state + ' bytes=' + iMockA.outputs[0].bytes.length);

  applyEnv({ MOS_TEXT_PROVIDER: 'deepseek' });   // 保留 key（上一段设置过）
  const tRestricted = await text.invoke({ op: 'draft', brief: 'b', trustLevel: 'internal_restricted' });
  ok('PC-13 数据分级：内部受限内容默认拒发外模型（BLOCKED，errorCode 明确）',
    tRestricted.state === 'BLOCKED' && tRestricted.text === ''
      && tRestricted.errorCode === pc.ERROR_CODES.BLOCKED_DATA_CLASS,
    'state=' + tRestricted.state + ' errorCode=' + tRestricted.errorCode);

  applyEnv({ MOS_TEXT_PROVIDER: 'weirdvendor' });
  const tUnknown = await text.invoke({ op: 'draft', brief: 'b' });
  ok('PC-14 未知供应商：明确报错且不伪造（UNKNOWN_MODE）',
    tUnknown.state === 'NOT_CONFIGURED' && tUnknown.errorCode === pc.ERROR_CODES.UNKNOWN_MODE,
    'state=' + tUnknown.state + ' errorCode=' + tUnknown.errorCode);

  /* ==================== L2：本地桩契约验证 ==================== */
  section('L2 本地桩契约验证（invoke/timeout/rateLimit/costReceipt/errorCode 真实行为）');

  applyEnv({
    MOS_TEXT_PROVIDER: 'deepseek', MOS_TEXT_API_KEY: 'stub-key',
    MOS_TEXT_BASE_URL: base, MOS_TEXT_MODEL: 'stub-text', MOS_TEXT_TIMEOUT_MS: '1500',
    MOS_IMAGE_PROVIDER: 'openai', MOS_IMAGE_API_KEY: 'stub-key',
    MOS_IMAGE_BASE_URL: base + '/v1', MOS_IMAGE_MODEL: 'stub-image', MOS_IMAGE_TIMEOUT_MS: '1500'
  });

  const tOk = await text.invoke({ op: 'draft', brief: '要点', title: 'T' });
  ok('PC-15 文本成功路径：SUCCEEDED + usage 回执 + rateLimit 解析 + costReceipt 诚实（无回执→null）',
    tOk.state === 'SUCCEEDED' && tOk.text === 'stub real text content'
      && tOk.usage.prompt_tokens === 11 && tOk.rateLimit.limit === 60 && tOk.rateLimit.remaining === 59
      && tOk.costReceipt.amount === null && tOk.costReceipt.confirmed === false,
    'state=' + tOk.state + ' usage=' + JSON.stringify(tOk.usage) + ' rl.limit=' + tOk.rateLimit.limit);

  applyEnv({ MOS_TEXT_BASE_URL: base + '/rl' });
  const tRl = await text.invoke({ op: 'draft', brief: 'b' });
  ok('PC-16 文本 429：errorCode=RATE_LIMITED、retryable=true、retryAfterSec 如实解析',
    tRl.state === 'FAILED' && tRl.errorCode === pc.ERROR_CODES.RATE_LIMITED && tRl.retryable === true
      && tRl.rateLimit.retryAfterSec === 7,
    'state=' + tRl.state + ' errorCode=' + tRl.errorCode + ' retryAfter=' + tRl.rateLimit.retryAfterSec);

  applyEnv({ MOS_IMAGE_BASE_URL: base + '/v1' });
  const iOk = await image.invoke({ op: 'generate', prompt: 'p', title: 'I' });
  ok('PC-17 图像成功路径：SUCCEEDED + 真实 PNG 字节（b64 解码）+ 供应商成本回执透传',
    iOk.state === 'SUCCEEDED' && iOk.outputs.length === 1
      && iOk.outputs[0].bytes.length > 0 && iOk.outputs[0].mime === 'image/png'
      && iOk.costReceipt.amount === 0.04 && iOk.costReceipt.confirmed === true,
    'state=' + iOk.state + ' bytes=' + iOk.outputs[0].bytes.length + ' cost=' + iOk.costReceipt.amount);

  applyEnv({ MOS_IMAGE_BASE_URL: base + '/err' });
  const iErr = await image.invoke({ op: 'generate', prompt: 'p' });
  ok('PC-18 图像 5xx：errorCode=PROVIDER_HTTP_ERROR、retryable=true、失败原因原样上报',
    iErr.state === 'FAILED' && iErr.errorCode === pc.ERROR_CODES.HTTP_ERROR && iErr.retryable === true
      && /stub upstream failure/.test(iErr.note),
    'state=' + iErr.state + ' errorCode=' + iErr.errorCode);

  applyEnv({ MOS_IMAGE_BASE_URL: base + '/slow', MOS_IMAGE_TIMEOUT_MS: '1000' });
  const iTo = await image.invoke({ op: 'generate', prompt: 'p' });
  ok('PC-19 图像超时：硬超时生效 → errorCode=PROVIDER_TIMEOUT、retryable=true',
    iTo.state === 'FAILED' && iTo.errorCode === pc.ERROR_CODES.TIMEOUT && iTo.retryable === true,
    'state=' + iTo.state + ' errorCode=' + iTo.errorCode + ' note=' + String(iTo.note).slice(0, 60));

  applyEnv({ MOS_IMAGE_BASE_URL: base + '/empty' });
  const iEmpty = await image.invoke({ op: 'generate', prompt: 'p' });
  ok('PC-20 图像空响应：errorCode=PROVIDER_EMPTY_RESPONSE（不伪造成成功）',
    iEmpty.state === 'FAILED' && iEmpty.errorCode === pc.ERROR_CODES.EMPTY_RESPONSE,
    'state=' + iEmpty.state + ' errorCode=' + iEmpty.errorCode);

  applyEnv({ MOS_TEXT_BASE_URL: base });
  const tBadOp = await text.invoke({ op: 'nonsense' });
  ok('PC-21 invoke 未知 op：明确报错，不做静默降级',
    tBadOp.state === 'FAILED' && tBadOp.errorCode === pc.ERROR_CODES.UNKNOWN_MODE,
    'state=' + tBadOp.state + ' errorCode=' + tBadOp.errorCode);

  /* ==================== L3：真实端到端（仅凭据存在时） ==================== */
  section('L3 真实端到端（仅当 MOS_PROVIDER_LIVE=1 且持有密钥）');
  const live = String(process.env.MOS_PROVIDER_LIVE || '') === '1';
  const realTextKey = String(process.env.MOS_REAL_TEXT_API_KEY || '').trim();
  const realImageKey = String(process.env.MOS_REAL_IMAGE_API_KEY || '').trim();
  const liveRecord = { attempted: false, text: null, image: null };

  if (!live) {
    notes.push('L3 未执行：未设置 MOS_PROVIDER_LIVE=1。**未对任何真实供应商做过端到端验证**（BLOCKED：无凭据/未授权）。');
    console.log('  SKIP  PC-L3 真实端到端未执行（未设置 MOS_PROVIDER_LIVE=1）—— 如实记录为 BLOCKED，不假称已验证');
  } else {
    // 文本
    if (realTextKey) {
      applyEnv({ MOS_TEXT_PROVIDER: 'deepseek', MOS_TEXT_API_KEY: realTextKey,
        MOS_TEXT_BASE_URL: process.env.MOS_REAL_TEXT_BASE_URL || '', MOS_TEXT_MODEL: process.env.MOS_REAL_TEXT_MODEL || '' });
      const r = await text.invoke({ op: 'draft', brief: '请写一句话品牌问候语。', title: 'L3' });
      liveRecord.attempted = true;
      liveRecord.text = { state: r.state, errorCode: r.errorCode, len: String(r.text || '').length,
        usage: r.usage, costReceipt: r.costReceipt, rateLimit: r.rateLimit, rawStatus: r.rawStatus, note: r.note };
      ok('PC-L1 真实文本 Provider 端到端：返回 SUCCEEDED 且回执已记录',
        r.state === 'SUCCEEDED' && String(r.text || '').length > 0,
        'state=' + r.state + ' len=' + String(r.text || '').length + ' errorCode=' + r.errorCode);
    } else {
      notes.push('L3 文本未执行：未提供 MOS_REAL_TEXT_API_KEY。');
      console.log('  SKIP  PC-L1 真实文本未执行（缺 MOS_REAL_TEXT_API_KEY）');
    }
    // 图像
    if (realImageKey) {
      applyEnv({ MOS_IMAGE_PROVIDER: 'openai', MOS_IMAGE_API_KEY: realImageKey,
        MOS_IMAGE_BASE_URL: process.env.MOS_REAL_IMAGE_BASE_URL || '', MOS_IMAGE_MODEL: process.env.MOS_REAL_IMAGE_MODEL || '' });
      const r = await image.invoke({ op: 'generate', prompt: 'a calm minimal banking poster, neutral white background', size: '1024x1024' });
      liveRecord.attempted = true;
      liveRecord.image = { state: r.state, errorCode: r.errorCode, outputs: (r.outputs || []).map((o) => o.bytes.length),
        usage: r.usage, costReceipt: r.costReceipt, rateLimit: r.rateLimit, rawStatus: r.rawStatus, note: r.note };
      ok('PC-L2 真实图像 Provider 端到端：返回 SUCCEEDED 且产出字节 > 0',
        r.state === 'SUCCEEDED' && (r.outputs || []).length > 0 && (r.outputs || [])[0].bytes.length > 0,
        'state=' + r.state + ' bytes=' + ((r.outputs || [])[0] || {}).bytes);
    } else {
      notes.push('L3 图像未执行：未提供 MOS_REAL_IMAGE_API_KEY。');
      console.log('  SKIP  PC-L2 真实图像未执行（缺 MOS_REAL_IMAGE_API_KEY）');
    }
    if (!liveRecord.attempted) {
      notes.push('L3 标记为 LIVE 但两项密钥均缺失 → 仍视为 BLOCKED（未做任何真实调用）。');
    }
  }

  /* ==================== 收尾 ==================== */
  try { server.close(); } catch (_) { /* ignore */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'provider-contract-result.json'), JSON.stringify({
    suite: 'mos-provider-contract',
    phase: 'Phase 3（A-05 真实 Provider 契约测试）',
    ranAt: new Date().toISOString(),
    liveRequested: live,
    liveRecord,
    notes,
    total: cases.length, passed, failed, cases
  }, null, 2), 'utf8');

  console.log('');
  if (notes.length) for (const n of notes) console.log('  NOTE  ' + n);
  console.log('Provider 契约自检结果：' + passed + '/' + cases.length + ' 通过'
    + (live ? '（含真实端到端）' : '（离线层；真实端到端按 BLOCKED 如实记录）'));
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Provider 契约自检异常：' + (err && err.stack ? err.stack : err));
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(1);
});
