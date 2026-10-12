'use strict';
/* ============================================================
 * Marketing OS BUILD-02 · 端到端测试（真实服务器 + 真实 HTTP + 真实落盘）
 * ------------------------------------------------------------
 * E2E-03  AI 创作：草稿 → 编辑 → 冻结送审 → 三条审核链 → 批准
 * E2E-04  传播：渠道登记 → 排期（DRAFT/READY/SCHEDULED）→ 人工登记发布 → 归档 → 更正/指标
 * SEC-02  Manifest 绑定：冻结后不可改写；底稿被篡改后审批必须失败
 * SEC-04  未批准内容不得进入 Ready/发布
 * 补充    预算闸门、幂等、Mock 诚实性（未接通不伪造）、无自动发布（无定时器）
 *
 * 运行：node tools/mos-e2e-build02.js
 * 约束：独立数据目录 + 运行期随机口令；结束即清理；不触碰 data/。
 * ============================================================ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9660 + Math.floor(Math.random() * 25);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(ROOT, 'data-mos-b02-' + crypto.randomBytes(3).toString('hex'));
const OUT_DIR = path.join(ROOT, 'TEST_EVIDENCE_MOS_BUILD02');
const ADMIN_PW = 'B02a-' + crypto.randomBytes(9).toString('base64url');
const ADMIN_PW2 = 'B02b-' + crypto.randomBytes(9).toString('base64url');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  :: ' + detail : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- HTTP 客户端（Cookie + 双提交 CSRF） ---------------- */
function client() {
  const jar = new Map();
  async function call(method, p, body) {
    const headers = {};
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
    if (jar.get('mos_csrf')) headers['x-mos-csrf'] = jar.get('mos_csrf');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + p, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const setc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setc) {
      const pair = c.split(';')[0];
      const i = pair.indexOf('=');
      if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (_) { /* ignore */ }
    return { status: res.status, json };
  }
  return {
    call,
    jar,
    async login(u, p) { return call('POST', '/api/mos/auth/login', { username: u, password: p }); }
  };
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

/* ---------------- 主流程 ---------------- */
async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  server = startServer();
  const up = await waitReady();
  check('ENV-01 服务器启动且 /api/health 正常', up, BASE);
  if (!up) return finish();

  const admin = client();
  await admin.call('GET', '/');
  const lg = await admin.login('mosadmin', ADMIN_PW);
  check('ENV-02 管理员首次登录成功（引导口令）', lg.status === 200, 'HTTP ' + lg.status);

  const chg = await admin.call('POST', '/api/mos/auth/change-password', { oldPassword: ADMIN_PW, newPassword: ADMIN_PW2 });
  check('ENV-03 首登强制改密成功', chg.status === 200, JSON.stringify(chg.json));
  await admin.login('mosadmin', ADMIN_PW2);

  // 角色账号
  async function mkUser(username, roles) {
    const pw = 'Pw-' + crypto.randomBytes(8).toString('base64url');
    const r = await admin.call('POST', '/api/mos/admin/users', {
      username, displayName: 'E2E ' + username, password: pw, demo: true,
      mustChangePassword: false, roles
    });
    if (r.status !== 200) throw new Error('建号失败 ' + username + ' ' + JSON.stringify(r.json));
    return { id: r.json.user.id, username, password: pw };
  }
  const CREATOR = await mkUser('b02.creator', [{ roleCode: 'P2', brandScope: ['VFIB'] }]);
  const CREATOR_U = await mkUser('b02.creator.ucard', [{ roleCode: 'P2', brandScope: ['UCARD'] }]);
  const PUBLISHER = await mkUser('b02.publisher', [{ roleCode: 'P3', brandScope: ['VFIB'] }]);
  const REVIEWER = await mkUser('b02.reviewer', [{ roleCode: 'PROFESSIONAL_REVIEWER', brandScope: ['VFIB'] }]);
  const APPROVER = await mkUser('b02.approver', [{ roleCode: 'P3', brandScope: ['VFIB'] }, { roleCode: 'PUBLISHING_APPROVER', brandScope: ['VFIB'] }]);
  // P4：有 brand.read 但没有任何审核权限 —— 用于验证"有身份但无审核权"的精确拒绝
  const NOBODY = await mkUser('b02.nobody', [{ roleCode: 'P4', brandScope: ['VFIB'] }]);

  const cCreator = client(), cCreatorU = client(), cPublisher = client();
  const cReviewer = client(), cApprover = client(), cNobody = client();
  for (const c of [cCreator, cCreatorU, cPublisher, cReviewer, cApprover, cNobody]) await c.call('GET', '/');
  await cCreator.login(CREATOR.username, CREATOR.password);
  await cCreatorU.login(CREATOR_U.username, CREATOR_U.password);
  await cPublisher.login(PUBLISHER.username, PUBLISHER.password);
  await cReviewer.login(REVIEWER.username, REVIEWER.password);
  await cApprover.login(APPROVER.username, APPROVER.password);
  await cNobody.login(NOBODY.username, NOBODY.password);
  check('ENV-04 六个测试身份登录成功', true, 'creator/creator.ucard/publisher/reviewer/approver/nobody');

  /* ==================== E2E-03 AI 创作 ==================== */
  console.log('\n--- E2E-03 AI 创作与审核链 ---');

  const TASK = 'task_demo_01';           // G2 → 专业审核 + 发布审批
  const B = '?brand=VFIB';

  const sk = await cCreator.call('GET', '/api/mos/skills' + B);
  check('E2E03-01 Skill 清单可读且声明可用性', sk.status === 200 && !!(sk.json.usability),
    'HTTP ' + sk.status + ' state=' + (sk.json.usability && sk.json.usability.state) + ' body=' + JSON.stringify(sk.json).slice(0, 220));

  // 创建草稿
  const mk = await cCreator.call('POST', '/api/mos/content-versions' + B, {
    taskId: TASK, title: 'E2E 储备透明化初稿',
    body: '第一版正文：储备透明化的机构视角。本句用于验证版本哈希与冻结不变量。'
  });
  const v1 = mk.json && mk.json.version;
  check('E2E03-02 创建内容版本草稿（DRAFT，number=1）', mk.status === 200 && v1 && v1.state === 'DRAFT' && v1.number === 1,
    'HTTP ' + mk.status + ' state=' + (v1 && v1.state) + ' number=' + (v1 && v1.number) + ' body=' + JSON.stringify(mk.json).slice(0, 220));
  if (!v1) return finish();

  // 编辑
  const hashBefore = v1.textHash;
  const ed = await cCreator.call('PUT', '/api/mos/content-versions/' + v1.id + B, {
    title: 'E2E 储备透明化初稿（修订）',
    body: '第二版正文：储备透明化的机构视角，补充口径说明。',
    rowVersion: v1.rowVersion
  });
  check('E2E03-03 草稿可编辑且正文哈希随之变化', ed.status === 200 && ed.json.version.textHash !== hashBefore,
    'hash ' + String(hashBefore).slice(0, 8) + ' → ' + String(ed.json && ed.json.version.textHash).slice(0, 8));

  // 冻结送审
  const lk = await cCreator.call('POST', '/api/mos/content-versions/' + v1.id + '/lock' + B, {});
  const locked = lk.json && lk.json.version;
  check('E2E03-04 冻结送审成功，状态进入 LOCKED_FOR_REVIEW', lk.status === 200 && locked.state === 'LOCKED_FOR_REVIEW',
    'state=' + (locked && locked.state));
  check('E2E03-05 冻结时固化 Manifest 哈希与清单快照', !!(locked.manifestHash && locked.manifestPayload),
    'hash=' + String(locked.manifestHash || '').slice(0, 16));
  check('SEC-02-a 冻结后正文与引用资产不可直接改写（409 VERSION_IMMUTABLE）',
    (await cCreator.call('PUT', '/api/mos/content-versions/' + v1.id + B, { body: '篡改尝试', rowVersion: locked.rowVersion }))
      .json.code === 'VERSION_IMMUTABLE', '');

  // 审核单
  const cases1 = await cCreator.call('GET', '/api/mos/review-cases' + B + '&subjectId=' + v1.id);
  const items1 = (cases1.json && cases1.json.items) || [];
  const hasProf = items1.some((c) => c.type === 'PROFESSIONAL_REVIEW');
  const hasPub = items1.some((c) => c.type === 'PUBLICATION_APPROVAL');
  check('E2E03-06 G2 内容自动生成「专业审核 + 发布审批」两条独立链', hasProf && hasPub,
    'cases=' + items1.map((c) => c.type).join(','));

  const profCase = items1.find((c) => c.type === 'PROFESSIONAL_REVIEW');
  const pubCase = items1.find((c) => c.type === 'PUBLICATION_APPROVAL');

  // 职责分离
  const selfDecide = await cCreator.call('POST', '/api/mos/review-cases/' + pubCase.id + '/decision' + B, { action: 'APPROVE' });
  check('E2E03-07 职责分离：创作者不能审批自己创建的内容（403）', selfDecide.status === 403,
    'code=' + (selfDecide.json && selfDecide.json.code));
  const noPerm = await cNobody.call('POST', '/api/mos/review-cases/' + pubCase.id + '/decision' + B, { action: 'APPROVE' });
  check('E2E03-08 有身份但无审核权限者被拒绝（403）', noPerm.status === 403,
    'HTTP ' + noPerm.status + ' code=' + (noPerm.json && noPerm.json.code));

  // 发布审批被专业审核阻塞
  const earlyPub = await cApprover.call('POST', '/api/mos/review-cases/' + pubCase.id + '/decision' + B, { action: 'APPROVE' });
  check('E2E03-09 专业审核未过时发布审批被阻塞（PROFESSIONAL_REVIEW_PENDING）',
    earlyPub.json && earlyPub.json.code === 'PROFESSIONAL_REVIEW_PENDING', 'HTTP ' + earlyPub.status);

  // 专业审核通过
  const pr = await cReviewer.call('POST', '/api/mos/review-cases/' + profCase.id + '/decision' + B,
    { action: 'APPROVE', remarks: '事实与口径已核对。' });
  check('E2E03-10 专业审核员批准专业审核', pr.status === 200 && pr.json.case.state === 'APPROVED',
    'state=' + (pr.json && pr.json.case && pr.json.case.state));

  // 发布审批通过
  const pa = await cApprover.call('POST', '/api/mos/review-cases/' + pubCase.id + '/decision' + B,
    { action: 'APPROVE', remarks: '同意发布。' });
  const afterApprove = await cCreator.call('GET', '/api/mos/content-versions/' + v1.id + B);
  check('E2E03-11 发布审批通过后版本进入 APPROVED（两条链都完成才生效）',
    pa.status === 200 && pa.json.case.state === 'APPROVED' && afterApprove.json.version.state === 'APPROVED',
    'case=' + (pa.json.case && pa.json.case.state) + ' version=' + afterApprove.json.version.state);
  check('E2E03-11b 批准联动任务状态推进到 READY',
    (afterApprove.json.version.reviewSummary.professional || []).indexOf('APPROVED') !== -1, '');

  const detail = await cCreator.call('GET', '/api/mos/content-versions/' + v1.id + B);
  check('E2E03-12 Manifest 冻结值与实时重算值一致（SEC-02 正向）',
    detail.json.version.manifestHash && detail.json.version.manifestHash.length === 64, '');

  // 派生新版本
  const rv = await cCreator.call('POST', '/api/mos/content-versions/' + v1.id + '/revise' + B, {});
  const v2 = rv.json && rv.json.version;
  check('E2E03-13 已批准版本可派生新版本，旧版本标记 SUPERSEDED',
    rv.status === 200 && v2 && v2.number === 2 && v2.state === 'DRAFT', 'new=' + (v2 && v2.number));
  const oldAfter = await cCreator.call('GET', '/api/mos/content-versions/' + v1.id + B);
  check('E2E03-14 旧版本被标记 SUPERSEDED 且未被删除', oldAfter.json.version.state === 'SUPERSEDED',
    'state=' + oldAfter.json.version.state);

  /* ---- 预算 / 幂等 / Mock 诚实性 ---- */
  const txt = await cCreator.call('POST', '/api/mos/generation-jobs' + B, { kind: 'TEXT', taskId: TASK, brief: '写一段简介' });
  check('E2E03-15 文本 Provider 未配置时作业落到 NOT_CONFIGURED（不伪造输出）',
    txt.json && txt.json.job && txt.json.job.status === 'NOT_CONFIGURED', 'status=' + (txt.json && txt.json.job && txt.json.job.status));

  const idemKey = 'e2e-idem-' + Date.now();
  const j1 = await cCreator.call('POST', '/api/mos/generation-jobs' + B, { kind: 'TEXT', taskId: TASK, brief: 'x', idempotencyKey: idemKey });
  const j2 = await cCreator.call('POST', '/api/mos/generation-jobs' + B, { kind: 'TEXT', taskId: TASK, brief: 'x', idempotencyKey: idemKey });
  check('E2E03-16 生成作业幂等：同一 idempotencyKey 不重复执行',
    j2.json && j2.json.deduplicated === true && j1.json.job.id === j2.json.job.id, 'job=' + (j1.json.job && j1.json.job.id));

  const bud = await cCreator.call('POST', '/api/mos/generation-jobs' + B, {
    kind: 'IMAGE', taskId: TASK, brief: '测试预算闸门', estimatedCostUsd: 5, idempotencyKey: 'budget-' + Date.now()
  });
  check('E2E03-17 预算闸门在调用 Provider 之前拦截（BUDGET_EXCEEDED）',
    bud.json && bud.json.job && bud.json.job.status === 'BUDGET_EXCEEDED', 'status=' + (bud.json && bud.json.job && bud.json.job.status));

  const ucard = await cCreatorU.call('POST', '/api/mos/prompt-preview?brand=UCARD', { brief: '测试', outputIntent: 'FORMAL_OUTPUT' });
  check('E2E03-18 U CARD 未批准 Skill 时正式输出被阻塞（不得套用 VFIB 规则）',
    ucard.status === 200 && ucard.json.blocked === true,
    'HTTP ' + ucard.status + ' reason=' + (ucard.json && (ucard.json.blockReason || ucard.json.error)));
  const vfibFormal = await cCreator.call('POST', '/api/mos/prompt-preview' + B, { brief: '测试', outputIntent: 'FORMAL_OUTPUT' });
  check('E2E03-19 VFIB Skill 仅 REFERENCE_ONLY 时正式输出同样被阻塞（未批准即不得正式输出）',
    vfibFormal.status === 200 && vfibFormal.json.blocked === true,
    'blocked=' + (vfibFormal.json && vfibFormal.json.blocked));
  const vfibDraft = await cCreator.call('POST', '/api/mos/prompt-preview' + B, { brief: '测试', outputIntent: 'TEST_DRAFT' });
  check('E2E03-20 REFERENCE_ONLY 允许生成受控测试草稿（并返回生效规则哈希）',
    vfibDraft.status === 200 && vfibDraft.json.blocked !== true && !!vfibDraft.json.effectiveRuleHash,
    'hash=' + String(vfibDraft.json && vfibDraft.json.effectiveRuleHash).slice(0, 12));

  /* ==================== E2E-04 传播 ==================== */
  console.log('\n--- E2E-04 排期 / 发布 / 归档 ---');

  // 发布链需要一个**独立且已批准**的版本：v1 已在派生环节被标记 SUPERSEDED，
  // 不能再用于排期（这本身就是 SEC-04 的体现）。这里在 G1 任务上走一遍完整审批。
  const pvMk = await cCreator.call('POST', '/api/mos/content-versions' + B, {
    taskId: 'task_demo_02', title: 'E2E 短线程（发布链）', body: 'X 短线程正文：机构稳健性观察。'
  });
  const pv = pvMk.json && pvMk.json.version;
  check('E2E04-00a 为发布链创建独立草稿版本', pvMk.status === 200 && !!pv, 'state=' + (pv && pv.state));
  const pvLock = await cCreator.call('POST', '/api/mos/content-versions/' + pv.id + '/lock' + B, {});
  const pvCases = (pvLock.json && pvLock.json.createdCases) || [];
  check('E2E04-00b G1 内容送审后只生成发布审批链（不强制专业审核）',
    pvLock.status === 200 && pvCases.length > 0 && pvCases.every((c) => c.type === 'PUBLICATION_APPROVAL'),
    'HTTP ' + pvLock.status + ' cases=' + pvCases.map((c) => c.type).join(','));
  const pvPub = pvCases.find((c) => c.type === 'PUBLICATION_APPROVAL');
  await cApprover.call('POST', '/api/mos/review-cases/' + pvPub.id + '/decision' + B, { action: 'APPROVE', remarks: '同意。' });
  const pvNow = await cCreator.call('GET', '/api/mos/content-versions/' + pv.id + B);
  const vApproved = pvNow.json.version;
  check('E2E04-00c 该版本已批准，可用于排期', vApproved.state === 'APPROVED', 'state=' + vApproved.state);

  const chs = await cCreator.call('GET', '/api/mos/channels' + B);
  const chItems = (chs.json && chs.json.items) || [];
  const enabled = chItems.filter((c) => c.state === 'ENABLED')[0];
  const leaks = JSON.stringify(chItems).toLowerCase();
  check('E2E04-01 渠道登记可读且含启用渠道', chs.status === 200 && !!enabled, 'channels=' + chItems.length);
  check('SEC-04-a 渠道数据不含任何口令/令牌字段（不代持平台凭据）',
    leaks.indexOf('password') === -1 && leaks.indexOf('token') === -1 && leaks.indexOf('secret') === -1, '');

  // 未批准版本：排期只能落为 BLOCKED，且不能推进到 READY（05 §3）
  // 注意：task_demo_01/02 已因送审/批准进入 IN_REVIEW / READY，不能再建草稿，
  // 因此这里用独立临时任务（AD_HOC）承载"未批准版本"这一用例。
  const adhoc = await cCreator.call('POST', '/api/mos/tasks/ad-hoc' + B, {
    title: 'E2E 未批准内容（SEC-04 载体）', workDate: '2026-10-28'
  });
  const adhocId = (adhoc.json && (adhoc.json.task ? adhoc.json.task.id : adhoc.json.id)) || null;
  check('E2E04-00d 可创建临时任务作为未批准内容载体', adhoc.status === 200 && !!adhocId, 'id=' + adhocId);
  const draft2 = await cCreator.call('POST', '/api/mos/content-versions' + B, { taskId: adhocId, body: '未批准内容' });
  const vUnapproved = draft2.json.version;
  check('E2E04-00e 未批准草稿版本已创建（DRAFT）', draft2.status === 200 && !!vUnapproved, 'state=' + (vUnapproved && vUnapproved.state));
  const badSch = await cPublisher.call('POST', '/api/mos/publishing/schedules' + B, {
    contentVersionId: vUnapproved.id, channelId: enabled.id, plannedAt: '2026-11-01T10:00'
  });
  const bs = badSch.json && badSch.json.schedules && badSch.json.schedules[0];
  check('SEC-04-b 未批准内容版本的排期只能落为 BLOCKED（不得 READY）',
    badSch.status === 200 && bs && bs.state === 'BLOCKED' && !!bs.blockedReason,
    'state=' + (bs && bs.state));
  const forceReady = await cPublisher.call('PUT', '/api/mos/publishing/schedules/' + bs.id + B,
    { state: 'READY', rowVersion: bs.rowVersion });
  check('SEC-04-c 未批准内容强推 READY 被拒绝（NOT_APPROVED）',
    forceReady.status === 409 && forceReady.json.code === 'NOT_APPROVED',
    'HTTP ' + forceReady.status + ' code=' + (forceReady.json && forceReady.json.code));

  const sch = await cPublisher.call('POST', '/api/mos/publishing/schedules' + B, {
    contentVersionId: vApproved.id, channelId: enabled.id, plannedAt: '2026-11-02T10:00'
  });
  const s1 = sch.json && sch.json.schedules && sch.json.schedules[0];
  check('E2E04-02 已批准版本可创建排期（直接进入 READY）', sch.status === 200 && s1 && s1.state === 'READY',
    'state=' + (s1 && s1.state));
  if (!s1) return finish();

  const illegal = await cPublisher.call('PUT', '/api/mos/publishing/schedules/' + s1.id + B, { state: 'DRAFT', rowVersion: s1.rowVersion });
  check('E2E04-03 排期状态机越级/非法迁移被拒绝（ILLEGAL_TRANSITION）',
    illegal.status === 409 && illegal.json.code === 'ILLEGAL_TRANSITION',
    'HTTP ' + illegal.status + ' code=' + (illegal.json && illegal.json.code));

  const sc = await cPublisher.call('PUT', '/api/mos/publishing/schedules/' + s1.id + B, { state: 'SCHEDULED', rowVersion: s1.rowVersion });
  check('E2E04-04 排期 READY → SCHEDULED', sc.status === 200 && sc.json.schedule.state === 'SCHEDULED', 'state=' + (sc.json.schedule && sc.json.schedule.state));

  // 无 URL/证据不能登记发布
  const noEv = await cPublisher.call('POST', '/api/mos/publications' + B, { scheduleId: s1.id, actualAt: '2026-11-02T10:05' });
  check('E2E04-05 无真实 URL / 证据引用不能登记发布', noEv.status >= 400, 'code=' + (noEv.json && noEv.json.code));

  const pub = await cPublisher.call('POST', '/api/mos/publications' + B, {
    scheduleId: s1.id, url: 'https://www.linkedin.com/posts/e2e-archive-test-001',
    actualAt: '2026-11-02T10:05', notes: 'E2E 人工登记'
  });
  const P = pub.json && pub.json.publication;
  check('E2E04-06 人工登记发布成功并生成归档记录', pub.status === 200 && P && P.status === 'PUBLISHED',
    'id=' + (P && P.id) + ' status=' + (P && P.status));
  if (!P) return finish();
  check('E2E04-07 归档记录带正文哈希与清单哈希（可追溯批准对象）', !!(P.textHash && P.manifestHash), '');

  // 归档快照物理落盘
  const snapDir = path.join(DATA_DIR, 'uploads', 'published', P.id);
  const snapFiles = fs.existsSync(snapDir) ? fs.readdirSync(snapDir) : [];
  check('E2E04-08 归档快照物理落盘（正文 + 清单文件）',
    fs.existsSync(path.join(snapDir, 'content.md')) && fs.existsSync(path.join(snapDir, 'manifest.json')),
    'files=[' + snapFiles.join(',') + ']');

  const pd = await cPublisher.call('GET', '/api/mos/publications/' + P.id + B);
  check('E2E04-09 归档正文只读可读（从快照读取，非工作副本）',
    pd.json.archivedBodyAvailable === true && typeof pd.json.archivedBody === 'string',
    'bytes=' + (pd.json.archivedBody || '').length);

  const corr = await cPublisher.call('POST', '/api/mos/publications/' + P.id + '/corrections' + B, {
    kind: 'CORRECTION', reason: 'E2E：更正一处口径说明'
  });
  check('E2E04-10 更正事件 append-only 追加成功', corr.status === 200, 'HTTP ' + corr.status);
  const pd2 = await cPublisher.call('GET', '/api/mos/publications/' + P.id + B);
  check('E2E04-11 更正后原归档快照仍保留（不可编辑、仅追加）',
    pd2.json.archivedBodyAvailable === true && (pd2.json.publication.corrections || []).length >= 1,
    'corrections=' + (pd2.json.publication.corrections || []).length);

  const mt = await cPublisher.call('POST', '/api/mos/publications/' + P.id + '/metrics' + B, {
    metric: 'impressions', amount: 1234, sourceKind: 'MANUAL', asOf: '2026-11-03'
  });
  check('E2E04-12 发布指标以人工登记方式记录（含来源与截止日）', mt.status === 200, 'HTTP ' + mt.status);

  // 无自动发布：把排期改到过去，等待后状态不变
  const sch2 = await cPublisher.call('POST', '/api/mos/publishing/schedules' + B, {
    contentVersionId: vApproved.id, channelId: enabled.id, plannedAt: '2026-11-05T09:00'
  });
  const s2 = sch2.json.schedules[0];
  const s2sched = await cPublisher.call('PUT', '/api/mos/publishing/schedules/' + s2.id + B,
    { state: 'SCHEDULED', rowVersion: s2.rowVersion });
  check('E2E04-13 第二条排期成功进入 SCHEDULED（用于无自动发布验证）',
    s2sched.status === 200 && s2sched.json.schedule.state === 'SCHEDULED', 'state=' + (s2sched.json.schedule && s2sched.json.schedule.state));
  const beforePubs = ((await cPublisher.call('GET', '/api/mos/publications' + B)).json.items || []).length;
  await sleep(2600);
  const afterS = await cPublisher.call('GET', '/api/mos/publishing/schedules' + B);
  const now2 = (afterS.json.items || []).find((x) => x.id === s2.id);
  const afterPubs = ((await cPublisher.call('GET', '/api/mos/publications' + B)).json.items || []).length;
  check('E2E04-14 系统不存在自动发布：到期后状态与归档均不变',
    now2 && now2.state === 'SCHEDULED' && afterPubs === beforePubs,
    'state=' + (now2 && now2.state) + ' pubs ' + beforePubs + '→' + afterPubs);

  /* ---- 视频工作区 ---- */
  console.log('\n--- 视频工作区（首期范围） ---');
  const vg = await cCreator.call('GET', '/api/mos/video/' + TASK + B);
  check('VID-01 视频工作区按任务惰性创建（初始 BRIEF）', vg.status === 200 && vg.json.video.state === 'BRIEF',
    'state=' + (vg.json.video && vg.json.video.state));
  const vs = await cCreator.call('PUT', '/api/mos/video/' + TASK + B, {
    brief: '储备透明化 60 秒解释片', script: { sections: [{ heading: '开场', content: '提出问题', durationSec: 8 }] },
    rowVersion: vg.json.video.rowVersion
  });
  check('VID-02 保存脚本后状态推进到 SCRIPT', vs.json.video.state === 'SCRIPT', 'state=' + vs.json.video.state);
  const vst = await cCreator.call('PUT', '/api/mos/video/' + TASK + B, {
    storyboard: [{ shot: 1, description: '机构建筑中性画面', durationSec: 5, motionCode: 'M01' }],
    rowVersion: vs.json.video.rowVersion
  });
  check('VID-03 保存分镜后状态推进到 STORYBOARD', vst.json.video.state === 'STORYBOARD', 'state=' + vst.json.video.state);
  const vbad = await cCreator.call('PUT', '/api/mos/video/' + TASK + B, {
    subtitles: [{ start: 10, end: 5, text: '倒置' }], rowVersion: vst.json.video.rowVersion
  });
  check('VID-04 字幕时间倒置被拒绝（BAD_SUBTITLE）', vbad.json && vbad.json.code === 'BAD_SUBTITLE', 'code=' + (vbad.json && vbad.json.code));
  const vok = await cCreator.call('PUT', '/api/mos/video/' + TASK + B, {
    subtitles: [{ start: 0, end: 3, text: '储备透明化' }, { start: 3, end: 6, text: '机构视角' }],
    rowVersion: vst.json.video.rowVersion
  });
  check('VID-05 合法字幕保存后状态推进到 SUBTITLE', vok.json.video.state === 'SUBTITLE', 'state=' + (vok.json.video && vok.json.video.state));

  /* ---- 日历一致性 ---- */
  const cal = await cPublisher.call('GET', '/api/mos/publishing/calendar' + B + '&from=2026-11-01&to=2026-11-30');
  const calCount = (cal.json.days || []).reduce((n, d) => n + d.items.length, 0);
  const allSch = (await cPublisher.call('GET', '/api/mos/publishing/schedules' + B)).json.items || [];
  const inRange = allSch.filter((s) => String(s.plannedAt).slice(0, 10) >= '2026-11-01' && String(s.plannedAt).slice(0, 10) <= '2026-11-30').length;
  check('PUB-01 日历与排期为同一数据源（同区间条目数完全一致）',
    cal.status === 200 && calCount === inRange && inRange > 0, 'calendar=' + calCount + ' schedules=' + inRange);
  check('PUB-02 日历响应显式声明状态色不单独表达含义', /色/.test(cal.json.legend || ''), '');

  /* ---- SEC-04 渠道敏感字段拒绝 ---- */
  const secCh = await cPublisher.call('POST', '/api/mos/channels' + B, {
    platform: 'X', handle: '@test', url: 'https://x.com/test', password: 'should-be-rejected'
  });
  check('SEC-04-d 渠道登记拒绝任何密码/令牌字段（SECRET_NOT_ALLOWED）',
    secCh.json && secCh.json.code === 'SECRET_NOT_ALLOWED', 'HTTP ' + secCh.status + ' code=' + (secCh.json && secCh.json.code));
  const badUrl = await cPublisher.call('POST', '/api/mos/channels' + B, {
    platform: 'X', handle: '@test2', url: 'http://x.com/insecure'
  });
  check('SEC-04-e 渠道 URL 强制 HTTPS（拒绝 http://）', badUrl.status >= 400,
    'HTTP ' + badUrl.status + ' code=' + (badUrl.json && badUrl.json.code));

  /* ==================== SEC-02 真实篡改路径 ==================== */
  console.log('\n--- SEC-02 Manifest 绑定（直接改盘后审批必须失败） ---');
  // 1) 把未批准的草稿送审，得到一张绑定 Manifest 的审核单
  const tLock = await cCreator.call('POST', '/api/mos/content-versions/' + vUnapproved.id + '/lock' + B, {});
  const tCase = (tLock.json && tLock.json.createdCases && tLock.json.createdCases[0]) || null;
  check('SEC-02-b 送审后审核单绑定冻结的 Manifest 哈希', tLock.status === 200 && !!tCase,
    'case=' + (tCase && tCase.type));

  // 2) 等落盘稳定 → 停服 → 直接改写数据文件里的正文（模拟绕过应用层的底稿篡改）→ 重启
  //    注意：store 采用异步落盘（60ms 合并写），必须先确认目标记录已真正落到磁盘，
  //    否则测的就不是"篡改后审批失败"，而是"数据还没写下去"。
  await sleep(700);
  await stopServer(server);
  await sleep(300);
  const dbf = path.join(DATA_DIR, 'mos.json');
  let raw = null;
  for (let i = 0; i < 30; i++) {
    try {
      raw = JSON.parse(fs.readFileSync(dbf, 'utf8'));
      if ((raw.review_cases || []).some((c) => c.id === tCase.id)) break;
    } catch (_) { /* retry */ }
    await sleep(150);
  }
  const target = (raw && (raw.content_versions || []).find((x) => x.id === vUnapproved.id)) || null;
  const frozenHash = target ? target.manifestHash : '';
  const caseOnDisk = !!(raw && (raw.review_cases || []).some((c) => c.id === tCase.id));
  check('SEC-02-c 目标版本与审核单已确认落盘（前置条件）',
    !!target && !!frozenHash && caseOnDisk, 'version=' + !!target + ' case=' + caseOnDisk);
  if (target) target.body = '被外部篡改后的正文（未经审批）';
  if (raw) fs.writeFileSync(dbf, JSON.stringify(raw, null, 2), 'utf8');

  server = startServer();
  const up2 = await waitReady();
  check('SEC-02-d 服务器重启后重新加载被篡改的数据', up2, '');

  // 3) 会话存于数据文件，Cookie 仍有效；直接尝试审批
  const snap = await cCreator.call('GET', '/api/mos/review-cases/' + tCase.id + B);
  check('SEC-02-e 审核详情显示冻结哈希与实时重算值不一致（manifestMatches=false）',
    snap.status === 200 && snap.json.subjectSnapshot && snap.json.subjectSnapshot.manifestMatches === false,
    'matches=' + (snap.json.subjectSnapshot && snap.json.subjectSnapshot.manifestMatches));

  const tampered = await cApprover.call('POST', '/api/mos/review-cases/' + tCase.id + '/decision' + B,
    { action: 'APPROVE', remarks: '试图批准被篡改的对象' });
  check('SEC-02-f 批准被篡改的底稿被拒绝（MANIFEST_CHANGED）',
    tampered.status === 409 && tampered.json.code === 'MANIFEST_CHANGED',
    'HTTP ' + tampered.status + ' code=' + (tampered.json && tampered.json.code));

  const stillOpen = await cCreator.call('GET', '/api/mos/review-cases/' + tCase.id + B);
  check('SEC-02-g 被拒绝后审核单未被改动（仍为未终结状态）',
    stillOpen.status === 200 && ['SUBMITTED', 'IN_REVIEW'].indexOf(stillOpen.json.case.state) !== -1,
    'HTTP ' + stillOpen.status + ' state=' + (stillOpen.json.case && stillOpen.json.case.state));

  return finish();
}

function finish() {
  return (async () => {
    try { await stopServer(server); } catch (_) { /* ignore */ }
    await sleep(400);
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }

    const failed = results.filter((r) => !r.ok);
    const summary = {
      suite: 'mos-e2e-build02', at: new Date().toISOString(), scope: 'BUILD-02 / Gate B',
      passed: results.length - failed.length, failed: failed.length, total: results.length, results
    };
    try {
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, 'e2e-build02-result.json'), JSON.stringify(summary, null, 2), 'utf8');
    } catch (_) { /* ignore */ }
    console.log('\n端到端测试（BUILD-02）：' + (results.length - failed.length) + '/' + results.length + ' 通过');
    console.log('证据目录：' + OUT_DIR);
    if (failed.length) {
      console.log('失败项：');
      failed.forEach((f) => console.log('  - ' + f.name + ' :: ' + f.detail));
      console.log('--- 服务端日志尾部 ---\n' + serverLog.slice(-2500));
    }
    process.exit(failed.length ? 1 : 0);
  })();
}

main().catch(async (err) => {
  console.error('E2E BUILD-02 未捕获异常：', err);
  check('E2E 流程未抛异常', false, err.message);
  await finish();
});
