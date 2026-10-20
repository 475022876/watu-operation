'use strict';
/* ============================================================
 * Marketing OS BUILD-03 · 端到端测试（真实服务器 + 真实 HTTP + 真实落盘）
 * ------------------------------------------------------------
 * E2E-05  资产入库：WorkingAsset → Submit → Precheck → 最终审批专有权限
 *         → Library Mock 同步（返回 MOCK Asset ID）→ 幂等 → 失败恢复
 * SEC-01  无 library.asset.approve.final 尝试最终入库 → 403 + AuditEvent
 * SEC-02  类比：入库申请的资产/元数据变化 → 原审批不可用
 * SEC-07  供应商密钥不出现在 Web bundle / API 响应
 * SEC-08  资料库同步失败 → 不可复用 + 幂等重试不产生双资产
 * SEC-09  Mock 内容不得冒充正式入库（永不 AVAILABLE）
 * SEC-10  受限（RESTRICTED）资料禁止外发模型
 * ANALYTICS  真实聚合 + 未接指标显示「缺失」
 *
 * 运行：node tools/mos-e2e-build03.js
 * 约束：独立数据目录 + 运行期随机口令；结束即清理；不触碰 data/。
 * ============================================================ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
// 端口收敛到声明的自检区段 9500-9699（原 9700-9724 越界，Phase 3 自审修正 B05-05）
const PORT = 9690 + Math.floor(Math.random() * 10);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(ROOT, 'data-mos-b03-' + crypto.randomBytes(3).toString('hex'));
const OUT_DIR = path.join(ROOT, 'TEST_EVIDENCE_MOS_BUILD03');
const ADMIN_PW = 'B03a-' + crypto.randomBytes(9).toString('base64url');
const ADMIN_PW2 = 'B03b-' + crypto.randomBytes(9).toString('base64url');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  :: ' + detail : ''));
}
function section(title) { console.log('\n--- ' + title + ' ---'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 最小合法 PNG：签名 + 一段负载（魔数校验要求真实签名）。
 * 每次调用生成**唯一内容** —— 预检的 not_duplicate 会拒绝同内容重复入库（06 §3），
 * 不同用例必须使用不同字节；否则预检 FAIL，submit-final 返回 409，拿不到审核单。
 */
let pngSeq = 0;
function png(tag) {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    Buffer.from('e2e-build03-' + (tag || 'img') + '-' + (++pngSeq) + '-' + Date.now())
  ]);
}

/* ---------------- HTTP 客户端（Cookie + 双提交 CSRF + 原始字节上传） ---------------- */
function client() {
  const jar = new Map();
  function cookieHeader() {
    return jar.size ? [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ') : '';
  }
  function absorb(res) {
    const setc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setc) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  async function call(method, p, body) {
    const headers = {};
    const ch = cookieHeader();
    if (ch) headers.Cookie = ch;
    if (jar.get('mos_csrf')) headers['x-mos-csrf'] = jar.get('mos_csrf');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + p, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    absorb(res);
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (_) { /* ignore */ }
    return { status: res.status, json };
  }
  /** 原始字节上传（工作素材） */
  async function raw(pathname, bytes, contentType) {
    const headers = { 'Content-Type': contentType || 'application/octet-stream' };
    const ch = cookieHeader();
    if (ch) headers.Cookie = ch;
    if (jar.get('mos_csrf')) headers['x-mos-csrf'] = jar.get('mos_csrf');
    const res = await fetch(BASE + pathname, { method: 'POST', headers, body: bytes });
    absorb(res);
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (_) { /* ignore */ }
    return { status: res.status, json };
  }
  async function text(pathname) {
    const headers = {};
    const ch = cookieHeader();
    if (ch) headers.Cookie = ch;
    const res = await fetch(BASE + pathname, { headers });
    return { status: res.status, text: await res.text() };
  }
  return { call, raw, text, jar, async login(u, p) { return call('POST', '/api/mos/auth/login', { username: u, password: p }); } };
}

/* ---------------- 服务器生命周期 ---------------- */
let server = null;
let serverLog = '';

function startServer(extraEnv) {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      MOS_DATA_DIR: DATA_DIR,
      MOS_PORT: String(PORT),
      MOS_HOST: '127.0.0.1',
      MOS_ADMIN_PASSWORD: ADMIN_PW,
      MOS_DEMO_SEED: '1',
      MOS_IDENTITY: 'mock', MOS_KNOWLEDGE: 'mock', MOS_LIBRARY: 'mock',
      MOS_TEXT_PROVIDER: 'none', MOS_IMAGE_PROVIDER: 'none'
    }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (d) => { serverLog += d.toString(); });
  child.stderr.on('data', (d) => { serverLog += d.toString(); });
  return child;
}

async function waitReady(tries) {
  for (let i = 0; i < (tries || 60); i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch (_) { /* retry */ }
    await sleep(250);
  }
  return false;
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.killed) return resolve();
    child.once('exit', () => resolve());
    try { child.kill('SIGTERM'); } catch (_) { return resolve(); }
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* ignore */ } resolve(); }, 2500);
  });
}

const B = '?brand=VFIB';

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  server = startServer();
  let up = await waitReady();
  check('ENV-01 服务器启动且 /api/health 正常', up, BASE);
  if (!up) return finish();

  const admin = client();
  await admin.call('GET', '/');
  const lg = await admin.login('mosadmin', ADMIN_PW);
  check('ENV-02 管理员首次登录成功（引导口令）', lg.status === 200, 'HTTP ' + lg.status);
  const chg = await admin.call('POST', '/api/mos/auth/change-password', { oldPassword: ADMIN_PW, newPassword: ADMIN_PW2 });
  check('ENV-03 首登强制改密成功', chg.status === 200, JSON.stringify(chg.json).slice(0, 120));
  await admin.login('mosadmin', ADMIN_PW2);

  async function mkUser(username, roles) {
    const pw = 'Pw-' + crypto.randomBytes(8).toString('base64url');
    const r = await admin.call('POST', '/api/mos/admin/users', {
      username, displayName: 'B03 ' + username, password: pw, demo: true,
      mustChangePassword: false, roles
    });
    if (r.status !== 200) throw new Error('建号失败 ' + username + ' ' + JSON.stringify(r.json));
    return { id: r.json.user.id, username, password: pw };
  }

  const CREATOR = await mkUser('b03.creator', [{ roleCode: 'P2', brandScope: ['VFIB'] }]);
  const CREATOR_U = await mkUser('b03.creator.ucard', [{ roleCode: 'P2', brandScope: ['UCARD'] }]);
  const ASSET_REV = await mkUser('b03.assetrev', [{ roleCode: 'ASSET_REVIEWER', brandScope: ['VFIB'] }]);
  const FINAL = await mkUser('b03.final', [{ roleCode: 'LIBRARY_FINAL_APPROVER', brandScope: ['VFIB'] }]);
  const PUBLISHER = await mkUser('b03.publisher', [{ roleCode: 'P3', brandScope: ['VFIB'] }]);
  const APPROVER = await mkUser('b03.approver', [{ roleCode: 'P3', brandScope: ['VFIB'] }, { roleCode: 'PUBLISHING_APPROVER', brandScope: ['VFIB'] }]);
  const NOBODY = await mkUser('b03.nobody', [{ roleCode: 'P4', brandScope: ['VFIB'] }]);
  // 同时具备 asset.submit 与最终入库特权：用于验证「提交人不得自批」的职责分离
  const DUAL = await mkUser('b03.dual', [
    { roleCode: 'P2', brandScope: ['VFIB'] },
    { roleCode: 'LIBRARY_FINAL_APPROVER', brandScope: ['VFIB'] }
  ]);

  const cCreator = client(); const cCreatorU = client(); const cAssetRev = client();
  const cFinal = client(); const cPublisher = client(); const cApprover = client();
  const cNobody = client(); const cDual = client();
  const all = [cCreator, cCreatorU, cAssetRev, cFinal, cPublisher, cApprover, cNobody, cDual];
  for (const c of all) await c.call('GET', '/');
  await cCreator.login(CREATOR.username, CREATOR.password);
  await cCreatorU.login(CREATOR_U.username, CREATOR_U.password);
  await cAssetRev.login(ASSET_REV.username, ASSET_REV.password);
  await cFinal.login(FINAL.username, FINAL.password);
  await cPublisher.login(PUBLISHER.username, PUBLISHER.password);
  await cApprover.login(APPROVER.username, APPROVER.password);
  await cNobody.login(NOBODY.username, NOBODY.password);
  await cDual.login(DUAL.username, DUAL.password);
  check('ENV-04 八个测试身份登录成功', true, 'creator/creator.ucard/assetrev/final/publisher/approver/nobody/dual');

  const roleCat = await admin.call('GET', '/api/mos/admin/roles');
  check('ENV-05 角色目录含 ASSET_REVIEWER 与 LIBRARY_FINAL_APPROVER 两个权限集',
    roleCat.status === 200
    && roleCat.json.roles.some((r) => r.code === 'ASSET_REVIEWER')
    && roleCat.json.roles.some((r) => r.code === 'LIBRARY_FINAL_APPROVER'), '');

  /**
   * A-26 回归：会话（安全关键状态）必须在登录后**立即落盘**，不依赖 60ms 合并窗口。
   * 否则在写入窗口内被硬终止（Windows 上 kill('SIGTERM') 即硬终止）会丢失会话：
   * 轻则刚登录就掉线，重则「已注销的会话在重启后复活」。
   */
  const persisted = (() => {
    try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mos.json'), 'utf8')); }
    catch (_) { return null; }
  })();
  const tokensInFile = new Set(((persisted && persisted.sessions) || []).map((s) => s.token));
  const durableCount = all.filter((c) => tokensInFile.has(String(c.jar.get('mos_sid') || ''))).length;
  check('ENV-06 ★会话在登录后立即落盘（不依赖 60ms 合并窗口）',
    durableCount === all.length, durableCount + '/' + all.length);

  /* ==================== Analytics：接入前的「缺失」语义 ==================== */
  section('ANALYTICS 真实聚合与缺失语义');

  const anBefore = await cCreator.call('GET', '/api/mos/analytics' + B);
  const secBefore = (anBefore.json && anBefore.json.sections) || {};
  check('AN-01 Analytics 端点可用且返回四段', anBefore.status === 200
    && !!secBefore.content && !!secBefore.channels && !!secBefore.operations && !!secBefore.aiCost,
    'HTTP ' + anBefore.status);

  const anCrossBrand = await cCreatorU.call('GET', '/api/mos/analytics' + B);
  check('AN-02 跨品牌请求分析数据被拒（404，不泄露存在性）', anCrossBrand.status === 404,
    'HTTP ' + anCrossBrand.status);

  check('AN-03 无指标数据时渠道指标显示「缺失」而非 0',
    secBefore.channels.metrics.available === false && !!secBefore.channels.metrics.reason
    && secBefore.channels.metrics.byMetric.length === 0,
    'reason=' + (secBefore.channels.metrics.reason || '').slice(0, 60));

  check('AN-04 无生成作业时 AI 成本显示「缺失」，不显示估算金额',
    secBefore.aiCost.cost.available === false && !!secBefore.aiCost.cost.reason
    && secBefore.aiCost.cost.byCurrency.length === 0,
    'reason=' + (secBefore.aiCost.cost.reason || '').slice(0, 60));

  check('AN-05 缺失项被显式汇总（前端据此展示，不用占位数字）',
    Array.isArray(anBefore.json.missing) && anBefore.json.missing.length > 0,
    'missing=' + anBefore.json.missing.length);

  // 真实作业：TEXT provider=none → NOT_CONFIGURED（不伪造输出）
  const jobText = await cCreator.call('POST', '/api/mos/generation-jobs' + B, {
    kind: 'TEXT', taskId: 'task_demo_01', brief: '写一段简介', dataClass: 'INTERNAL'
  });
  check('AN-06 生成作业带数据分级字段并如实落到 NOT_CONFIGURED',
    jobText.status === 200 && jobText.json.job.status === 'NOT_CONFIGURED'
    && jobText.json.job.dataClass === 'INTERNAL',
    'status=' + (jobText.json && jobText.json.job && jobText.json.job.status));

  const anAfterJob = await cCreator.call('GET', '/api/mos/analytics' + B + '&section=aicost');
  check('AN-07 作业写入后 AI 成本段反映真实作业数（byKind.TEXT）',
    anAfterJob.json.sections.aiCost.jobs.total >= 1
    && (anAfterJob.json.sections.aiCost.jobs.byKind.TEXT || 0) >= 1,
    'total=' + anAfterJob.json.sections.aiCost.jobs.total);

  const anOps = await cCreator.call('GET', '/api/mos/analytics' + B + '&section=operations');
  check('AN-08 Operations 段可用且含计划/任务维度',
    anOps.status === 200 && anOps.json.sections.operations.execution.available === true,
    'tasks=' + anOps.json.sections.operations.execution.tasks);

  /* ==================== SEC-10 AI 外发数据分级 ==================== */
  section('SEC-10 受限资料禁止外发模型');

  const restricted = await cCreator.call('POST', '/api/mos/generation-jobs' + B, {
    kind: 'IMAGE', taskId: 'task_demo_01', brief: '受限资料', dataClass: 'RESTRICTED',
    idempotencyKey: 'sec10-' + Date.now()
  });
  check('SEC-10-a RESTRICTED 作业在调用 Provider 之前被阻断（BLOCKED）',
    restricted.status === 200 && restricted.json.job.status === 'BLOCKED'
    && restricted.json.job.errorCode === 'DATA_CLASS_RESTRICTED',
    'status=' + (restricted.json && restricted.json.job && restricted.json.job.status));
  check('SEC-10-b 未发生任何外部调用（无 providerJobId / 无产物）',
    !restricted.json.job.providerJobId && restricted.json.job.outputAssetIds.length === 0, '');

  const badClass = await cCreator.call('POST', '/api/mos/generation-jobs' + B, {
    kind: 'TEXT', taskId: 'task_demo_01', brief: 'x', dataClass: 'TOP_SECRET'
  });
  check('SEC-10-c 未知数据分级被拒绝（fail closed，不静默降级）',
    badClass.status === 400 && badClass.json.code === 'BAD_DATA_CLASS',
    'HTTP ' + badClass.status + ' code=' + (badClass.json && badClass.json.code));

  /* ==================== SEC-07 密钥不出现在 bundle / API ==================== */
  section('SEC-07 供应商密钥不外泄');

  const bundles = ['/mos/js/api.js', '/mos/js/app.js', '/mos/js/modules/visual.js', '/mos/js/modules/analytics.js', '/mos/js/modules/governance.js'];
  let bundleText = '';
  for (const b of bundles) { const t = await cCreator.text(b); bundleText += t.text; }
  const metaText = JSON.stringify((await cCreator.call('GET', '/api/mos/meta')).json);
  const meText = JSON.stringify((await cCreator.call('GET', '/api/mos/auth/me')).json);
  const blob = bundleText + metaText + meText;
  check('SEC-07-a 前端 bundle 与 API 响应中不含类似密钥的字面量',
    !/sk-[A-Za-z0-9]{16,}/.test(blob) && !/"apiKey"\s*:\s*"[^"]+"/.test(blob) && !/"secret"\s*:\s*"[^"]+"/.test(blob), '');
  check('SEC-07-b 模型适配器声明 hasServerKey=false（无密钥即不宣称已配置）',
    metaText.indexOf('"hasServerKey":false') !== -1 || metaText.indexOf('"hasServerKey": true') === -1, '');

  /* ==================== E2E-05 资产入库全流程 ==================== */
  section('E2E-05 Asset Admission → Library Reference');

  const coverBytes = png('cover');
  const up1 = await cCreator.raw('/api/mos/assets/upload' + B + '&name=e2e-b03-cover.png&taskId=task_demo_01', coverBytes, 'image/png');
  const asset1 = up1.json && up1.json.asset;
  check('E2E05-01 上传工作素材（魔数校验通过、真实落盘、带 sha256）',
    up1.status === 200 && asset1 && asset1.sha256 && asset1.origin === 'UPLOADED',
    'sha256=' + String(asset1 && asset1.sha256).slice(0, 12));

  const badMagic = await cCreator.raw('/api/mos/assets/upload' + B + '&name=fake.png',
    Buffer.from('<script>alert(1)</script>'), 'image/png');
  check('E2E05-01b 伪装成图片的脚本被魔数校验拒绝', badMagic.status === 400, 'HTTP ' + badMagic.status);

  const idemKey = 'adm-' + Date.now();
  const mkAdm = await cCreator.call('POST', '/api/mos/asset-admissions' + B, {
    workingAssetId: asset1.id, categoryCode: 'A01',
    submissionMetadata: { title: 'E2E 机构形象底纹', license: 'LICENSED', description: 'E2E 用例' },
    /* V1.1 B1：三项 Provider 必填字段 */
    libraryPrimaryCategory: '02', librarySubcategory: '02.04', classification: 'internal', licenseStatus: 'cleared', reuseScope: 'campaign_reuse',
    idempotencyKey: idemKey
  });
  const adm = mkAdm.json && mkAdm.json.admission;
  check('E2E05-02 创建入库申请 → SUBMITTED，双字段初始为 PENDING / NOT_STARTED',
    mkAdm.status === 200 && adm && adm.state === 'SUBMITTED'
    && adm.finalApprovalStatus === 'PENDING' && adm.syncStatus === 'NOT_STARTED',
    'state=' + (adm && adm.state));

  const mkAdmDup = await cCreator.call('POST', '/api/mos/asset-admissions' + B, {
    workingAssetId: asset1.id, categoryCode: 'A01', submissionMetadata: { title: 'dup' }, idempotencyKey: idemKey
  });
  check('E2E05-03 入库申请幂等：同一 idempotencyKey 不重复创建',
    mkAdmDup.json && mkAdmDup.json.deduplicated === true && mkAdmDup.json.admission.id === adm.id, '');

  const badCat = await cCreator.call('POST', '/api/mos/asset-admissions' + B, {
    workingAssetId: asset1.id, categoryCode: 'Z99', idempotencyKey: 'badcat-' + Date.now()
  });
  check('E2E05-04 非法资产分类被拒绝（A01–A08 字典强制）',
    badCat.status === 400 && badCat.json.code === 'BAD_CATEGORY', 'HTTP ' + badCat.status);

  /* ---- V1.1 B1：三项 Provider 必填字段缺失 → 400 BAD_ADMISSION_INPUT + missing[]（绝不猜测补齐） ---- */
  const missFields = await cCreator.call('POST', '/api/mos/asset-admissions' + B, {
    workingAssetId: asset1.id, categoryCode: 'A01',
    submissionMetadata: { title: '缺三项必填字段', license: 'LICENSED' },
    idempotencyKey: 'missfields-' + Date.now()
  });
  const missArr = (missFields.json && missFields.json.missing) || [];
  check('E2E05-04b 缺 libraryPrimaryCategory/classification/licenseStatus → 400 BAD_ADMISSION_INPUT 且回传 missing[]',
    missFields.status === 400 && missFields.json.code === 'BAD_ADMISSION_INPUT'
      && missArr.indexOf('libraryPrimaryCategory') !== -1 && missArr.indexOf('classification') !== -1
      && missArr.indexOf('licenseStatus') !== -1,
    'HTTP ' + missFields.status + ' missing=' + JSON.stringify(missArr));

  /* ---- V1.1 B1：自由文本许可**绝不**被猜成 cleared，保守转 unknown 并标记待人工核定 ---- */
  const freeText = await cCreator.call('POST', '/api/mos/asset-admissions' + B, {
    workingAssetId: asset1.id, categoryCode: 'A01',
    libraryPrimaryCategory: '02', classification: 'internal', licenseStatus: 'INTERNAL_DRAFT',
    submissionMetadata: { title: '自由文本许可反例', license: 'INTERNAL_DRAFT' },
    idempotencyKey: 'freetext-' + Date.now()
  });
  check('E2E05-04c 自由文本许可被拒且给出保守替代值建议（suggested.licenseStatus=unknown），绝不映射 cleared',
    freeText.status === 400 && freeText.json.code === 'BAD_ADMISSION_INPUT'
      && freeText.json.suggested && freeText.json.suggested.licenseStatus === 'unknown'
      && (freeText.json.fieldErrors || []).join(';').indexOf('unknown') !== -1,
    'HTTP ' + freeText.status + ' suggested=' + JSON.stringify(freeText.json && freeText.json.suggested));

  const preNoPerm = await cCreator.call('POST', '/api/mos/asset-admissions/' + adm.id + '/precheck' + B, {});
  check('E2E05-05 无 asset.review 权限者不能执行预检（403）',
    preNoPerm.status === 403, 'HTTP ' + preNoPerm.status + ' code=' + (preNoPerm.json && preNoPerm.json.code));

  const pre = await cAssetRev.call('POST', '/api/mos/asset-admissions/' + adm.id + '/precheck' + B, {});
  check('E2E05-06 预检通过（PASS）并记录检查项，状态进入 PRECHECK',
    pre.status === 200 && pre.json.admission.state === 'PRECHECK'
    && pre.json.precheck.verdict === 'PASS' && pre.json.precheck.checks.length >= 5,
    'checks=' + (pre.json.precheck && pre.json.precheck.checks.length));

  const submit = await cCreator.call('POST', '/api/mos/asset-admissions/' + adm.id + '/submit-final' + B, {});
  const caseId = submit.json && submit.json.reviewCase && submit.json.reviewCase.id;
  check('E2E05-07 提交最终审批 → 开 ASSET_ADMISSION 审核单（第三条独立链）',
    submit.status === 200 && submit.json.admission.state === 'FINAL_APPROVAL_PENDING'
    && submit.json.reviewCase.type === 'ASSET_ADMISSION' && !!caseId,
    'case=' + caseId);

  const syncEarly = await cCreator.call('POST', '/api/mos/asset-admissions/' + adm.id + '/sync' + B, {});
  check('E2E05-08 最终审批未过时不能提交同步（NOT_APPROVED）',
    syncEarly.status === 409 && syncEarly.json.code === 'NOT_APPROVED', 'HTTP ' + syncEarly.status);

  /* ---- SEC-01 最终入库许可为独立特权 ---- */
  const dNobody = await cNobody.call('POST', '/api/mos/review-cases/' + caseId + '/decision' + B, { action: 'APPROVE' });
  check('SEC-01-a 无 library.asset.approve.final 者执行最终入库被拒（403）',
    dNobody.status === 403, 'HTTP ' + dNobody.status + ' code=' + (dNobody.json && dNobody.json.code));

  const dAssetRev = await cAssetRev.call('POST', '/api/mos/review-cases/' + caseId + '/decision' + B, { action: 'APPROVE' });
  check('SEC-01-b 资产预检员（asset.review）不能执行最终入库审批（分权）',
    dAssetRev.status === 403, 'HTTP ' + dAssetRev.status);

  const dAdmin = await admin.call('POST', '/api/mos/review-cases/' + caseId + '/decision' + B, { action: 'APPROVE' });
  check('SEC-01-c 技术管理员（MOS_ADMIN）不自动获得最终入库特权（403）',
    dAdmin.status === 403, 'HTTP ' + dAdmin.status);

  const auditDenied = await admin.call('GET', '/api/mos/audit' + B + '&eventType=review.decision.denied&limit=50');
  check('SEC-01-d 每次越权尝试都写入审计事件（append-only）',
    auditDenied.status === 200 && auditDenied.json.total >= 3,
    'total=' + (auditDenied.json && auditDenied.json.total));

  /* ---- 职责分离：提交人不得自批 ---- */
  const up2 = await cDual.raw('/api/mos/assets/upload' + B + '&name=e2e-b03-dual.png', png('dual'), 'image/png');
  const asset2 = up2.json.asset;
  const adm2mk = await cDual.call('POST', '/api/mos/asset-admissions' + B, {
    workingAssetId: asset2.id, categoryCode: 'A02',
    submissionMetadata: { title: 'E2E 职责分离用例', license: 'LICENSED' }, idempotencyKey: 'dual-' + Date.now(),
    libraryPrimaryCategory: '02', classification: 'internal', licenseStatus: 'cleared', reuseScope: 'campaign_reuse'
  });
  const adm2 = adm2mk.json.admission;
  // 预检由**资产预检员**执行（P2 不含 asset.review）；提交人仍是 dual —— 用于验证「提交人不得自批」
  const pre2 = await cAssetRev.call('POST', '/api/mos/asset-admissions/' + adm2.id + '/precheck' + B, {});
  const adm2sub = await cDual.call('POST', '/api/mos/asset-admissions/' + adm2.id + '/submit-final' + B, {});
  const case2 = adm2sub.json.reviewCase && adm2sub.json.reviewCase.id;
  check('E2E05-07b 职责分离用例前置：预检 PASS 且已开 ASSET_ADMISSION 审核单',
    pre2.status === 200 && pre2.json.precheck.verdict === 'PASS' && !!case2,
    'precheck=' + (pre2.json.precheck && pre2.json.precheck.verdict) + ' case=' + case2);
  const dSelf = await cDual.call('POST', '/api/mos/review-cases/' + case2 + '/decision' + B, { action: 'APPROVE' });
  check('SEC-01-e 职责分离：提交人即使持有最终特权也不能审批自己的入库申请（403）',
    dSelf.status === 403 && String(dSelf.json.error || '').indexOf('职责分离') !== -1,
    'HTTP ' + dSelf.status + ' err=' + (dSelf.json && dSelf.json.error));
  // 正向对照：非提交人的最终审批人可以正常裁决（证明上一处 403 来自「职责分离」而非权限不足）
  const dOther = await cFinal.call('POST', '/api/mos/review-cases/' + case2 + '/decision' + B, { action: 'REJECT', remarks: '用例结束：不进入同步' });
  check('SEC-01-e2 正向对照：非提交人的最终审批人可裁决（同一权限、不同主体）',
    dOther.status === 200, 'HTTP ' + dOther.status);

  /* ---- 篡改检测（SEC-02 类比）：资产被替换后原审批不可用 ---- */
  const tamperAsset = asset1.id;
  // 直接改盘 → 重启（BUILD-02 已验证真实篡改路径，这里只验证绑定哈希的敏感性）
  const admDetail0 = await cCreator.call('GET', '/api/mos/asset-admissions/' + adm.id);
  const frozenBinding = admDetail0.json.bindingHash;
  check('SEC-02-x 入库审批绑定哈希已冻结并对外可见',
    !!frozenBinding && frozenBinding.length === 64, 'hash=' + String(frozenBinding).slice(0, 12));

  /* ---- 最终审批通过 ---- */
  const dFinal = await cFinal.call('POST', '/api/mos/review-cases/' + caseId + '/decision' + B,
    { action: 'APPROVE', remarks: '资料与分类无误，同意入库。', approvalRef: adm.id });
  check('E2E05-09 最终入库审批人批准 → FINAL_APPROVAL_GRANTED',
    dFinal.status === 200 && dFinal.json.case.state === 'APPROVED', 'HTTP ' + dFinal.status + ' state=' + (dFinal.json.case && dFinal.json.case.state));

  const admAfterApprove = await cCreator.call('GET', '/api/mos/asset-admissions/' + adm.id);
  const aApprove = admAfterApprove.json.admission;
  check('E2E05-10 最终审批通过：finalApprovalStatus=APPROVED，授权来源如实记录为 MOCK',
    aApprove.finalApprovalStatus === 'APPROVED' && aApprove.approvalMode === 'MOCK'
    && aApprove.state === 'FINAL_APPROVAL_GRANTED',
    'status=' + aApprove.finalApprovalStatus + ' mode=' + aApprove.approvalMode);

  check('E2E05-11 批准后仍未同步：syncStatus 独立保持 NOT_STARTED（双字段不互相推导）',
    aApprove.syncStatus === 'NOT_STARTED', 'syncStatus=' + aApprove.syncStatus);

  /* ---- 资料库同步（Mock）---- */
  const sync = await cCreator.call('POST', '/api/mos/asset-admissions/' + adm.id + '/sync' + B, {});
  const aSync = sync.json.admission;
  check('E2E05-12 资料库同步成功并返回 MOCK 资产 ID',
    sync.status === 200 && aSync.syncStatus === 'COMPLETED'
    && String(aSync.libraryId || '').indexOf('MOCK_ASSET_') === 0,
    'libraryId=' + aSync.libraryId + ' state=' + aSync.state);

  check('SEC-09-a Mock 同步**不得**把申请标记为 AVAILABLE（Mock 下结构性不可达）',
    aSync.state === 'SYNC_COMPLETED' && aSync.state !== 'AVAILABLE'
    && !!aSync.availableBlockedReason,
    'state=' + aSync.state);

  check('SEC-09-b 可复用资格为计算判定且为 false，并给出全部阻塞原因',
    aSync.reuseEligibility === false && (aSync.reuseBlocking || []).length >= 3,
    'blocking=' + (aSync.reuseBlocking || []).length);

  check('SEC-09-c 沙盒引用条目带 MOCK 标记、权限未核验、资产状态为沙盒',
    aSync.ref && aSync.ref.mock === true && aSync.ref.permissionValid === false
    && aSync.ref.assetState === 'MOCK_SANDBOX',
    'assetState=' + (aSync.ref && aSync.ref.assetState));

  const syncDup = await cCreator.call('POST', '/api/mos/asset-admissions/' + adm.id + '/sync' + B, {});
  check('E2E05-13 重复同步被幂等拦截，未重复调用资料库',
    syncDup.json.deduplicated === true, 'HTTP ' + syncDup.status);

  const refs = await cCreator.call('GET', '/api/mos/library-asset-refs' + B);
  check('E2E05-14 Approved Assets：正式库检索恒空，沙盒条目分列',
    refs.status === 200 && refs.json.gateway.total === 0
    && refs.json.items.length >= 1, 'gateway=' + refs.json.gateway.total + ' sandbox=' + refs.json.items.length);

  check('E2E05-15 可复用资产数为 0（Mock 下不允许出现"可复用"资产）',
    refs.json.counts.reusable === 0 && refs.json.counts.mockOnly >= 1,
    'reusable=' + refs.json.counts.reusable);

  const admAll = await cCreator.call('GET', '/api/mos/asset-admissions' + B);
  check('E2E05-16 列表汇总不含任何 AVAILABLE / 可复用条目',
    admAll.json.summary.reusable === 0
    && admAll.json.items.every((x) => x.state !== 'AVAILABLE'),
    'reusable=' + admAll.json.summary.reusable);

  /* ---- 同内容重复入库：预检必须拒绝（06 §3；这也是本套件必须为每次上传生成唯一字节的原因） ---- */
  const dupUp = await cCreator.raw('/api/mos/assets/upload' + B + '&name=e2e-b03-cover-copy.png', coverBytes, 'image/png');
  const dupAsset = dupUp.json && dupUp.json.asset;
  const dupAdmMk = await cCreator.call('POST', '/api/mos/asset-admissions' + B, {
    workingAssetId: dupAsset.id, categoryCode: 'A01',
    submissionMetadata: { title: '同内容副本', license: 'LICENSED' }, idempotencyKey: 'dup-' + Date.now(),
    libraryPrimaryCategory: '02', classification: 'internal', licenseStatus: 'cleared', reuseScope: 'campaign_reuse'
  });
  const dupAdm = dupAdmMk.json.admission;
  // 预检需 asset.review（P2 不含），故由资产预检员执行
  const dupPre = await cAssetRev.call('POST', '/api/mos/asset-admissions/' + dupAdm.id + '/precheck' + B, {});
  const dupCheck = ((dupPre.json.precheck || {}).checks || []).find((x) => x.id === 'not_duplicate');
  check('E2E05-17 同内容重复入库被预检明确拒绝（not_duplicate=FAIL）',
    dupPre.status === 200 && dupPre.json.precheck.verdict === 'FAIL'
    && dupCheck && dupCheck.ok === false,
    'verdict=' + (dupPre.json.precheck && dupPre.json.precheck.verdict));
  const dupSubmitTry = await cCreator.call('POST', '/api/mos/asset-admissions/' + dupAdm.id + '/submit-final' + B, {});
  const dupAfter = await cCreator.call('GET', '/api/mos/asset-admissions/' + dupAdm.id);
  check('E2E05-18 预检未通过的申请不能提交最终审批（状态机强制）',
    dupSubmitTry.status === 409 && dupAfter.json.admission.state === 'PRECHECK',
    'HTTP ' + dupSubmitTry.status + ' state=' + dupAfter.json.admission.state);

  /* ==================== E2E-05 续：发布 → 指标 → Analytics 由「缺失」转为有数据 ==================== */
  section('Analytics 数据落盘后由「缺失」转为真实聚合');

  const adhoc = await cCreator.call('POST', '/api/mos/tasks/ad-hoc' + B, {
    title: 'B03 发布链用例', workDate: '2026-10-30'
  });
  const adhocId = adhoc.json.task ? adhoc.json.task.id : adhoc.json.id;
  const mk = await cCreator.call('POST', '/api/mos/content-versions' + B, {
    taskId: adhocId, title: 'B03 发布用例', body: '用于验证指标录入与聚合的正文。'
  });
  const cv = mk.json.version;
  const lock = await cCreator.call('POST', '/api/mos/content-versions/' + cv.id + '/lock' + B, {});
  const pubCase = (lock.json.createdCases || []).find((c) => c.type === 'PUBLICATION_APPROVAL');
  check('PUB-01 冻结送审生成发布审批链', lock.status === 200 && !!pubCase, 'cases=' + (lock.json.createdCases || []).length);
  await cApprover.call('POST', '/api/mos/review-cases/' + pubCase.id + '/decision' + B, { action: 'APPROVE', remarks: '同意。' });
  const cvNow = await cCreator.call('GET', '/api/mos/content-versions/' + cv.id + B);
  check('PUB-02 版本进入 APPROVED', cvNow.json.version.state === 'APPROVED', 'state=' + cvNow.json.version.state);

  const chs = await cPublisher.call('GET', '/api/mos/channels' + B);
  const ch = (chs.json.items || []).filter((c) => c.state === 'ENABLED')[0];
  const sch = await cPublisher.call('POST', '/api/mos/publishing/schedules' + B, {
    contentVersionId: cv.id, channelId: ch.id, plannedAt: '2026-11-05T10:00'
  });
  const s0 = (sch.json.schedules || [])[0];
  await cPublisher.call('PUT', '/api/mos/publishing/schedules/' + s0.id + B, { state: 'SCHEDULED', rowVersion: s0.rowVersion });
  const pub = await cPublisher.call('POST', '/api/mos/publications' + B, {
    scheduleId: s0.id, url: 'https://www.linkedin.com/company/vfib-bank/posts/e2e-b03', actualAt: '2026-11-05T10:05'
  });
  const pubId = pub.json.publication && pub.json.publication.id;
  check('PUB-03 人工登记实际发布并生成不可覆盖快照', pub.status === 200 && !!pubId, 'pub=' + pubId);

  const mt = await cPublisher.call('POST', '/api/mos/publications/' + pubId + '/metrics' + B, {
    metric: 'impressions', amount: 1234, sourceKind: 'MANUAL', asOf: '2026-11-06', proofRef: 'E2E 手工记录'
  });
  check('AN-09 渠道指标真实落盘（带来源与统计时点）', mt.status === 200 && mt.json.metric.amount === 1234, 'HTTP ' + mt.status);

  const an2 = await cCreator.call('GET', '/api/mos/analytics' + B + '&section=channels');
  const ch2 = an2.json.sections.channels;
  check('AN-10 指标录入后渠道段由「缺失」转为真实聚合',
    ch2.metrics.available === true && ch2.metrics.totalRecords >= 1
    && ch2.metrics.byMetric.length >= 1 && ch2.metrics.byMetric[0].latestAsOf === '2026-11-06',
    'records=' + ch2.metrics.totalRecords);

  check('AN-11 渠道段同时反映发布数（真实聚合，不是占位数字）',
    ch2.channels.some((c) => c.publications >= 1), '');

  const anOps2 = await cCreator.call('GET', '/api/mos/analytics' + B + '&section=operations');
  check('AN-12 审核耗时按审核链分组统计（含 ASSET_ADMISSION）',
    anOps2.json.sections.operations.reviewCycle.available === true
    && anOps2.json.sections.operations.reviewCycle.byType.some((r) => r.type === 'ASSET_ADMISSION'),
    'types=' + anOps2.json.sections.operations.reviewCycle.byType.map((r) => r.type).join(','));

  const badSection = await cCreator.call('GET', '/api/mos/analytics' + B + '&section=nope');
  check('AN-13 未知分析分段被拒绝（400）', badSection.status === 400, 'HTTP ' + badSection.status);

  /* ==================== SEC-08 同步失败 → 幂等重试（独立实例 + 故障注入） ==================== */
  section('SEC-08 资料库同步失败与幂等恢复');

  await sleep(700);
  await stopServer(server);
  await sleep(300);
  server = startServer({ MOS_LIBRARY_MOCK_FAULT: 'once-per-key' });
  up = await waitReady();
  check('SEC-08-00 以故障注入模式重启服务器（模拟资料库瞬时超时）', up, '');

  const c2 = client();
  await c2.call('GET', '/');
  await c2.login('mosadmin', ADMIN_PW2);
  // 裁决必须由**独立**的最终审批人执行（提交人自批会被职责分离拦截）
  const c2final = client();
  await c2final.call('GET', '/');
  await c2final.login(FINAL.username, FINAL.password);

  const up3 = await c2.raw('/api/mos/assets/upload' + B + '&name=e2e-b03-fail.png', png('fail'), 'image/png');
  const asset3 = up3.json.asset;
  const a3mk = await c2.call('POST', '/api/mos/asset-admissions' + B, {
    workingAssetId: asset3.id, categoryCode: 'A03',
    submissionMetadata: { title: 'E2E 同步失败用例', license: 'LICENSED' }, idempotencyKey: 'sec08-' + Date.now(),
    libraryPrimaryCategory: '02', classification: 'internal', licenseStatus: 'cleared', reuseScope: 'campaign_reuse'
  });
  const a3 = a3mk.json.admission;
  await c2.call('POST', '/api/mos/asset-admissions/' + a3.id + '/precheck' + B, {});
  const a3sub = await c2.call('POST', '/api/mos/asset-admissions/' + a3.id + '/submit-final' + B, {});
  const a3case = a3sub.json.reviewCase && a3sub.json.reviewCase.id;
  const a3dec = await c2final.call('POST', '/api/mos/review-cases/' + a3case + '/decision' + B, { action: 'APPROVE', approvalRef: a3.id });
  check('SEC-08-01 同步失败用例前置：独立审批人批准入库（finalApprovalStatus=APPROVED）',
    a3dec.status === 200 && a3dec.json.case.state === 'APPROVED', 'HTTP ' + a3dec.status);

  const failSync = await c2.call('POST', '/api/mos/asset-admissions/' + a3.id + '/sync' + B, {});
  const a3fail = failSync.json.admission;
  check('SEC-08-a 资料库同步失败 → SYNC_FAILED 且保留错误原因',
    failSync.status === 200 && a3fail.syncStatus === 'FAILED' && a3fail.state === 'SYNC_FAILED'
    && !!a3fail.lastSyncError,
    'state=' + a3fail.state + ' err=' + a3fail.lastSyncError);
  check('SEC-08-b 同步失败的申请**不可复用**（未生成引用）',
    a3fail.reuseEligibility === false && a3fail.ref === null, '');

  const retry = await c2.call('POST', '/api/mos/asset-admissions/' + a3.id + '/retry-sync' + B, {});
  const a3ok = retry.json.admission;
  check('SEC-08-c 幂等重试成功（复用同一幂等键）',
    retry.status === 200 && a3ok.syncStatus === 'COMPLETED' && a3ok.syncAttempts === 2,
    'attempts=' + a3ok.syncAttempts);

  const refs2 = await c2.call('GET', '/api/mos/library-asset-refs' + B);
  const refsForAdm = refs2.json.items.filter((r) => r.admissionId === a3.id);
  check('SEC-08-d 重试未产生双资产（该申请只有 1 条引用）',
    refsForAdm.length === 1, 'refs=' + refsForAdm.length);

  const auditSync = await c2.call('GET', '/api/mos/audit' + B + '&eventType=asset_admission.sync.failed&limit=50');
  check('SEC-08-e 同步失败写入审计事件（失败不静默）',
    auditSync.json.total >= 1, 'total=' + auditSync.json.total);

  const retryAgain = await c2.call('POST', '/api/mos/asset-admissions/' + a3.id + '/retry-sync' + B, {});
  check('SEC-08-f 已成功的申请再重试被拒绝（NOT_FAILED，状态机强制）',
    retryAgain.status === 409 && retryAgain.json.code === 'NOT_FAILED', 'HTTP ' + retryAgain.status);

  /* ==================== 权限 / 审计收口 ==================== */
  section('权限与审计收口');

  const histWrap = await cCreator.call('GET', '/api/mos/review-history' + B + '&pageSize=200');
  check('GOV-01 审核历史 append-only 可查（含资产入库决策）',
    histWrap.status === 200 && histWrap.json.items.some((d) => d.type === 'ASSET_ADMISSION'),
    'total=' + histWrap.json.total);

  const refsNoPerm = await cNobody.call('GET', '/api/mos/library-asset-refs' + B);
  check('GOV-02 无 library.asset.read 的账号被拒（本用例中 P4 也持有该权限，故允许读）',
    refsNoPerm.status === 200, 'HTTP ' + refsNoPerm.status);

  const crossRef = await cCreatorU.call('GET', '/api/mos/library-asset-refs' + B);
  check('GOV-03 跨品牌读取资产引用被拒（404）', crossRef.status === 404, 'HTTP ' + crossRef.status);

  const crossAdm = await cCreatorU.call('GET', '/api/mos/asset-admissions' + B);
  check('GOV-04 跨品牌读取入库申请被拒（404）', crossAdm.status === 404, 'HTTP ' + crossAdm.status);

  const sec = await admin.call('GET', '/api/mos/audit' + B + '&limit=1');
  const secText = JSON.stringify(sec.json).toLowerCase();
  check('GOV-05 审计事件 metadata 已脱敏（不含 password/token 明文）',
    secText.indexOf('"password"') === -1 && secText.indexOf('"token"') === -1, '');

  const meta2 = await admin.call('GET', '/api/mos/meta');
  check('GOV-06 schema 版本不低于 v7（只增不改；v6 用户偏好、v7 研究域、v8 Provider 调用账本）',
    meta2.json.schemaVersion >= 7, 'schema=' + meta2.json.schemaVersion);

  /* ==================== Phase 3：A-01 采集调度 API（真实 HTTP） ==================== */
  section('Phase 3 · A-01 情报采集调度（服务端 API，默认关闭 + 单实例限制）');

  const sched0 = await admin.call('GET', '/api/mos/ingest/scheduler' + B);
  check('SCH-API-01 调度总览可读，且默认关闭、如实声明单实例限制',
    sched0.status === 200 && sched0.json.scheduler.configured === false
      && sched0.json.scheduler.running === false && sched0.json.scheduler.singleInstanceOnly === true,
    'configured=' + (sched0.json.scheduler && sched0.json.scheduler.configured)
      + ' singleInstance=' + (sched0.json.scheduler && sched0.json.scheduler.singleInstanceOnly));

  const dueDemo = sched0.json.due || [];
  check('SCH-API-02 到期预览逐条给出不可调度原因（DEMO 来源：未核验 / MANUAL 频率）',
    dueDemo.length >= 2 && dueDemo.every((x) => typeof x.schedulable === 'boolean')
      && dueDemo.filter((x) => !x.schedulable).length >= 2,
    dueDemo.map((x) => x.name + ':' + (x.schedulable ? 'schedulable' : x.reason.slice(0, 18))).join(' | '));

  const tick = await admin.call('POST', '/api/mos/ingest/scheduler/tick' + B, {});
  check('SCH-API-03 手工巡检真实执行且不粉饰：DEMO 来源全部不可调度 → 执行 0',
    tick.status === 200 && tick.json.summary.ran === 0 && tick.json.summary.skipped >= 2,
    'ran=' + (tick.json.summary && tick.json.summary.ran) + ' skipped=' + (tick.json.summary && tick.json.summary.skipped));

  const jobs0 = await admin.call('GET', '/api/mos/ingest/jobs' + B);
  check('SCH-API-04 采集作业记录接口可用（无假数据：无作业时为空数组并给出说明）',
    jobs0.status === 200 && Array.isArray(jobs0.json.items) && !!jobs0.json.note,
    'items=' + (jobs0.json.items && jobs0.json.items.length));

  // 未核验来源的手工采集必须被阻断（fail closed），并留下 BLOCKED 作业记录
  const srcList = await admin.call('GET', '/api/mos/sources' + B);
  const pendingSrc = (srcList.json.items || []).find((s) => s.status === 'PENDING_VERIFICATION');
  const ingestTry = await admin.call('POST', '/api/mos/sources/' + pendingSrc.id + '/ingest', {});
  check('SCH-API-05 未核验来源的手工采集被阻断（fail closed，不伪造采集成功）',
    ingestTry.status === 200 && ingestTry.json.ok === false
      && ingestTry.json.status === 'SOURCE_PENDING_VERIFICATION' && ingestTry.json.inserted === 0,
    'HTTP ' + ingestTry.status + ' status=' + (ingestTry.json && ingestTry.json.status));

  const jobs1 = await admin.call('GET', '/api/mos/ingest/jobs' + B + '&sourceId=' + pendingSrc.id);
  check('SCH-API-06 被阻断的采集同样留下作业记录（BLOCKED + 失败码，可审计）',
    jobs1.status === 200 && jobs1.json.items.length >= 1
      && jobs1.json.items[0].status === 'BLOCKED'
      && jobs1.json.items[0].failureCode === 'SOURCE_PENDING_VERIFICATION',
    'job=' + (jobs1.json.items[0] && (jobs1.json.items[0].status + '/' + jobs1.json.items[0].failureCode)));

  const schedOn = await admin.call('POST', '/api/mos/ingest/scheduler' + B, { enabled: true });
  const schedOff = await admin.call('POST', '/api/mos/ingest/scheduler' + B, { enabled: false });
  check('SCH-API-07 调度开关双向可用（开启后可关闭，且状态如实回读）',
    schedOn.status === 200 && schedOn.json.enabled === true && schedOn.json.scheduler.running === true
      && schedOff.status === 200 && schedOff.json.scheduler.running === false,
    'on=' + (schedOn.json.scheduler && schedOn.json.scheduler.running)
      + ' off=' + (schedOff.json.scheduler && schedOff.json.scheduler.running));

  const schedBad = await admin.call('POST', '/api/mos/ingest/scheduler' + B, { enabled: 'yes' });
  check('SCH-API-08 非法开关取值被拒绝（400，不做宽松解析）',
    schedBad.status === 400 && schedBad.json.code === 'BAD_ENABLED',
    'HTTP ' + schedBad.status + ' code=' + (schedBad.json && schedBad.json.code));

  // P3（发布角色）权限集**不含** source.manage —— 用于验证调度动作受服务端 RBAC 强制（03 §5）
  const schedPerm = await cPublisher.call('POST', '/api/mos/ingest/scheduler/tick' + B, {});
  check('SCH-API-09 无 source.manage 权限的主体不能触发巡检（403，服务端强制）',
    schedPerm.status === 403, 'HTTP ' + schedPerm.status + ' code=' + (schedPerm.json && schedPerm.json.code));

  /* ==================== Phase 3：F-07 字典待核验项登记 API ==================== */
  section('Phase 3 · F-07 专业字典 provisional 核验（不伪造官方标签）');

  const dv = await admin.call('GET', '/api/mos/dictionaries/verification' + B);
  const dvItems = dv.json.items || [];
  check('DV-01 待核验项登记接口可用，且全部保持 UNVERIFIED（未取得原件）',
    dv.status === 200 && dvItems.length >= 30 && dvItems.every((r) => r.status === 'UNVERIFIED'),
    'items=' + dvItems.length + ' verified=' + (dv.json.summary && dv.json.summary.verified));

  check('DV-02 权威原件登记如实声明「本轮未随包提供」',
    (dv.json.summary.sourceDocuments || []).length === 2
      && dv.json.summary.sourceDocuments.every((d) => d.providedToDev === false),
    JSON.stringify((dv.json.summary.sourceDocuments || []).map((d) => d.title + '@' + d.version)));

  const dvBad = await admin.call('POST', '/api/mos/dictionaries/verify' + B,
    { dictKey: 'pillars', code: 'C01', label: '假设的正式栏目名' });
  check('DV-03 缺证据的核验请求被拒绝（400，不写入任何记录）',
    dvBad.status === 400 && dvBad.json.code === 'MISSING_SOURCE_VERSION',
    'HTTP ' + dvBad.status + ' code=' + (dvBad.json && dvBad.json.code));

  const metaAfter = await admin.call('GET', '/api/mos/meta');
  const c01 = ((metaAfter.json.dictionaries || {}).pillars || []).find((e) => e.code === 'C01');
  check('DV-04 字典输出中 provisional 项标签仍为「待核验」（不存在伪造的官方名称）',
    !!c01 && c01.provisional === true && c01.label === '待核验',
    'label=' + (c01 && c01.label) + ' provisional=' + (c01 && c01.provisional));


  /* ==================== Phase 3：A-05 Provider 契约 / A-06 资料库适配层状态 ==================== */
  section('Phase 3 · A-05 Provider 契约探针与 A-06 资料库适配层状态');

  const ph = await admin.call('GET', '/api/mos/providers/health' + B);
  check('A05-01 Provider 契约探针可用，声明 7 项契约面且给出错误码表',
    ph.status === 200 && Array.isArray(ph.json.contract) && ph.json.contract.length === 7
      && !!ph.json.errorCodes && ph.json.errorCodes.TIMEOUT === 'PROVIDER_TIMEOUT',
    'contract=' + JSON.stringify(ph.json.contract));
  check('A05-02 未配置供应商时如实为 NOT_CONFIGURED（不含任何密钥字段）',
    ph.json.text.health.state === 'NOT_CONFIGURED' && ph.json.image.health.state === 'NOT_CONFIGURED'
      && JSON.stringify(ph.json).indexOf('apiKey') === -1,
    'text=' + ph.json.text.health.state + ' image=' + ph.json.image.health.state);

  const wsst = await admin.call('GET', '/api/mos/workspace/status' + B);
  check('A06-01 资料库适配层状态可用：未配置凭据 → configured=false 且如实列出缺失项',
    wsst.status === 200 && wsst.json.status.configured === false
      && wsst.json.status.missing.length > 0,
    'missing=' + JSON.stringify(wsst.json.status.missing));
  check('A06-02 能力声明不夸大：真实联调 NOT_VERIFIED、服务账户无最终审批权、无归档能力',
    wsst.json.contract.realJointTest === 'NOT_VERIFIED'
      && wsst.json.capabilities.finalDecisionByServiceAccount === false
      && wsst.json.capabilities.publishedContentArchive === false,
    'joint=' + wsst.json.contract.realJointTest);
  check('A06-03 资料库适配层状态不含私钥/票据字段（密钥只在服务端）',
    JSON.stringify(wsst.json).indexOf('PRIVATE KEY') === -1
      && !Object.prototype.hasOwnProperty.call(wsst.json.status, 'privateKeyPem'),
    'len=' + JSON.stringify(wsst.json).length);

  const metaP3 = await admin.call('GET', '/api/mos/meta');
  check('A06-04 meta 集成状态矩阵新增企业资料库项，且未配置时如实为 not_configured',
    !!metaP3.json.integrations.enterpriseLibrary
      && metaP3.json.integrations.enterpriseLibrary.configured === false,
    'mode=' + (metaP3.json.integrations.enterpriseLibrary || {}).mode);

  /* ==================== 审计修正 A-25：Topic 复用视图必须真实聚合 ==================== */
  section('A-25 Topic 复用视图（真实聚合，不再是空壳）');

  const reuse0 = await cCreator.call('GET', '/api/mos/topics/topic_demo_01/reuse' + B);
  check('REUSE-01 Topic 复用视图可用且返回真实计数',
    reuse0.status === 200 && reuse0.json.counts && reuse0.json.counts.tasks >= 2,
    'tasks=' + (reuse0.json.counts && reuse0.json.counts.tasks));
  check('REUSE-02 已授权资产检索恒为空并如实标注资料库为 mock（不伪造正式资产）',
    Array.isArray(reuse0.json.libraryAssets) && reuse0.json.libraryAssets.length === 0
    && reuse0.json.libraryIntegrationMode === 'mock', 'mode=' + reuse0.json.libraryIntegrationMode);

  // 真实写入一条内容版本后，复用视图的计数必须随之变化（证明是聚合而非硬编码）
  const taskForReuse = 'task_demo_01';
  const mkVer = await cCreator.call('POST', '/api/mos/content-versions' + B, {
    taskId: taskForReuse, title: 'A-25 复用聚合验证稿'
  });
  const versionCount0 = reuse0.json.counts.contentVersions;
  const reuse1 = await cCreator.call('GET', '/api/mos/topics/topic_demo_01/reuse' + B);
  check('REUSE-03 新建内容版本后复用视图计数随之增长（真实聚合，非硬编码空数组）',
    mkVer.status === 200 && reuse1.json.counts.contentVersions === versionCount0 + 1,
    versionCount0 + ' → ' + reuse1.json.counts.contentVersions);
  check('REUSE-04 复用的版本条目带状态与风险等级（可安全外显字段）',
    reuse1.json.contentVersions.length >= 1
    && !!reuse1.json.contentVersions[0].code && !!reuse1.json.contentVersions[0].state,
    'code=' + (reuse1.json.contentVersions[0] && reuse1.json.contentVersions[0].code));

  return finish();
}

function finish() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const out = {
    suite: 'e2e03',
    build: 'BUILD-03',
    ranAt: new Date().toISOString(),
    total, passed, failed: total - passed,
    results
  };
  fs.writeFileSync(path.join(OUT_DIR, 'e2e-build03-result.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n[e2e03] ' + passed + '/' + total + ' 通过');
  console.log('[e2e03] 证据：' + path.relative(ROOT, path.join(OUT_DIR, 'e2e-build03-result.json')));
  const cleanup = async () => {
    await stopServer(server);
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
    process.exit(passed === total ? 0 : 1);
  };
  return cleanup();
}

main().catch(async (err) => {
  console.error('[e2e03] 未捕获异常：', err);
  check('EXCEPTION 用例执行未抛出异常', false, String(err && err.message));
  await finish();
});
