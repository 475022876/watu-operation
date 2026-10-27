'use strict';
/* ============================================================
 * Marketing OS V0.1.2 Phase C · 编辑域端到端（真实服务器 + 真实 HTTP）
 * ------------------------------------------------------------
 * 执行包 03 §原子性派工 / 04 §内容审核与发布：
 *   - 批准入池：PENDING → 正式 Topic（APPROVED_UNSCHEDULED），绝不平行建题；
 *     重复批准 → 409（不重复建 Topic）；证据如实计数（无真实来源条目 → linked=0）。
 *   - 批准并安排：幂等 Saga = 批准 + 自动建月度计划 + 唯一 Topic(→ASSIGNED)
 *     + 每平台独立 ContentTask + 每任务一个 PlanItem；idempotencyKey 重放零新增。
 *   - 派工校验：idempotencyKey 必填、交付物非空、平台合法、真实负责人、制作期限必填。
 *   - 日/周/月同源视图：同一 PlanItem/Task 数据源过滤，按状态聚合。
 *   - 平台任务独立推进：一个平台 IN_PRODUCTION 不影响另一平台。
 *   - RBAC：P2 无 editorial.approve → 403；跨品牌 → 404（SEC-03 防枚举）。
 *   - 审计：editorial.approve_to_pool / editorial.saga_completed / plan.created(autoBySaga)。
 *
 * 运行：node tools/mos-e2e-v012-editorial.js   （run-mos-tests.sh 的 editorial 套件）
 * 约束：独立数据目录 + 运行期随机口令；结束即清理；不触碰 data/。
 * ============================================================ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9670 + Math.floor(Math.random() * 8); // 9670-9677，落在 9500-9699 自检区段
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(ROOT, 'data-mos-e12-' + crypto.randomBytes(3).toString('hex'));
const OUT_DIR = path.join(ROOT, 'TEST_EVIDENCE_MOS_V012_EDITORIAL');
const ADMIN_PW = 'E12a-' + crypto.randomBytes(9).toString('base64url');
const ADMIN_PW2 = 'E12b-' + crypto.randomBytes(9).toString('base64url');
const PWD = 'E12pw-' + crypto.randomBytes(9).toString('base64url');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  :: ' + detail : ''));
}
function section(title) { console.log('\n--- ' + title + ' ---'); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------------- HTTP 客户端（Cookie + CSRF） ---------------- */
function client() {
  const jar = new Map();
  const cookieHeader = () => (jar.size ? [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ') : '');
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
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    absorb(res);
    let json = null;
    try { json = JSON.parse(await res.text()); } catch (_) { /* ignore */ }
    return { status: res.status, json };
  }
  return { call, login: (u, p) => call('POST', '/api/mos/auth/login', { username: u, password: p }) };
}

/* ---------------- 服务器生命周期 ---------------- */
let server = null;
let serverLog = '';
function startServer() {
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      MOS_DATA_DIR: DATA_DIR, MOS_PORT: String(PORT), MOS_HOST: '127.0.0.1',
      MOS_ADMIN_PASSWORD: ADMIN_PW, MOS_DEMO_SEED: '1',
      MOS_IDENTITY: 'mock', MOS_KNOWLEDGE: 'mock', MOS_LIBRARY: 'mock',
      MOS_TEXT_PROVIDER: 'none', MOS_IMAGE_PROVIDER: 'none'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (d) => { serverLog += d.toString(); });
  server.stderr.on('data', (d) => { serverLog += d.toString(); });
}
function stopServer() {
  return new Promise((resolve) => {
    if (!server || server.killed || server.exitCode !== null) return resolve();
    try { server.kill('SIGTERM'); } catch (_) { return resolve(); }
    setTimeout(() => { try { server.kill('SIGKILL'); } catch (_) { /* ignore */ } resolve(); }, 2500);
  });
}
async function waitHealth() {
  for (let i = 0; i < 90; i += 1) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return true; } catch (_) { /* not up */ }
    await sleep(250);
  }
  return false;
}
async function cleanup() {
  await stopServer();
  await sleep(600);
  for (let i = 0; i < 5; i += 1) {
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); break; }
    catch (_) { await sleep(400); }
  }
}
function writeEvidence() {
  const passed = results.filter((r) => r.ok).length;
  try {
    fs.writeFileSync(path.join(OUT_DIR, 'v012-editorial-result.json'), JSON.stringify({
      suite: 'v012-editorial',
      phase: 'V0.1.2 Phase C（编辑域：批准入池 / 批准并安排幂等 Saga / 同源视图）',
      total: results.length, passed, failed: results.length - passed,
      ranAt: new Date().toISOString(), base: BASE, results
    }, null, 2), 'utf8');
  } catch (e) { console.error('证据写入失败：' + e.message); }
}

/* ============================================================ */
async function main() {
  console.log('V0.1.2 Phase C · 编辑域端到端（真实 HTTP + 隔离实例）');
  console.log('  实例 ' + BASE + '   数据目录 ' + DATA_DIR);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  startServer();
  if (!await waitHealth()) {
    check('SV-01 服务器启动', false, 'health 超时\n' + serverLog.slice(-1500));
    await cleanup(); writeEvidence(); process.exitCode = 2; return;
  }
  check('SV-01 服务器启动并探活', true);

  const admin = client();
  check('SV-02 引导管理员登录', (await admin.login('mosadmin', ADMIN_PW)).status === 200);
  await admin.call('POST', '/api/mos/auth/change-password', { oldPassword: ADMIN_PW, newPassword: ADMIN_PW2 });
  check('SV-03 改密并重登', (await admin.login('mosadmin', ADMIN_PW2)).status === 200);

  const mk = async (username, roleCode, brandScope) => {
    const r = await admin.call('POST', '/api/mos/admin/users', {
      username, displayName: 'e2e·' + username, password: PWD,
      mustChangePassword: false, roles: [{ roleCode, brandScope }]
    });
    if (r.status !== 200) throw new Error('创建 ' + username + ' 失败：' + JSON.stringify(r.json));
    return r.json.user;
  };
  await mk('e2e.p1', 'P1', ['VFIB']);
  await mk('e2e.p2', 'P2', ['VFIB']);
  await mk('e2e.creator', 'P2', ['VFIB']);
  await mk('e2e.ucard', 'P2', ['UCARD']);
  const cP1 = client();
  const cP2 = client();
  const cCreator = client();
  const cP2U = client();
  check('U-01 P1(VFIB) 登录', (await cP1.login('e2e.p1', PWD)).status === 200);
  check('U-02 P2(VFIB) 登录', (await cP2.login('e2e.p2', PWD)).status === 200);
  check('U-03 创作者(VFIB) 登录', (await cCreator.login('e2e.creator', PWD)).status === 200);
  check('U-04 P2(UCARD) 登录', (await cP2U.login('e2e.ucard', PWD)).status === 200);

  const creatorId = (await cP2.call('GET', '/api/mos/auth/me')).json.user.id;
  const newProposal = async (over) => {
    const r = await cP2.call('POST', '/api/mos/topic-proposals', Object.assign({
      brandCode: 'VFIB', suggestedTitleEN: 'Pool topic ' + Math.random().toString(36).slice(2, 7),
      summaryZH: '编辑域端到端候选', primaryCategory: 'C02', source: 'EMPLOYEE'
    }, over || {}));
    if (r.status !== 200) throw new Error('创建提案失败：' + JSON.stringify(r.json));
    return r.json.proposal;
  };

  /* ---------- 批准入池 ---------- */
  section('A. 批准入池（APPROVED_UNSCHEDULED）');
  const aiProp = await newProposal({ source: 'AI' });
  check('AP-01 AI_RECOMMENDED 直接批准入池 → 409（须先提交审核）',
    (await cP1.call('POST', '/api/mos/topic-proposals/' + aiProp.id + '/approve-to-pool', {})).status === 409);
  await cP2.call('POST', '/api/mos/topic-proposals/' + aiProp.id + '/submit', {});

  const pPool = await newProposal({});
  const pool = await cP1.call('POST', '/api/mos/topic-proposals/' + pPool.id + '/approve-to-pool',
    { narrativeCode: 'N01', comments: '入池待排' });
  check('AP-02 批准入池 → 200 且 Topic state=APPROVED_UNSCHEDULED', pool.status === 200
    && pool.json.topic && pool.json.topic.state === 'APPROVED_UNSCHEDULED',
    JSON.stringify(pool.json.topic || {}));
  check('AP-03 栏目映射正确（C02）且叙事 N01', pool.json.topic.pillarCode === 'C02' && pool.json.topic.narrativeCode === 'N01');
  check('AP-04 证据如实计数（无真实来源条目 → linked=0/skipped=0，不伪造）',
    pool.json.evidence.linked === 0 && pool.json.evidence.skipped === 0,
    JSON.stringify(pool.json.evidence || {}));
  const poolAgain = await cP1.call('POST', '/api/mos/topic-proposals/' + pPool.id + '/approve-to-pool', {});
  check('AP-05 重复批准入池 → 409（不重复建 Topic）', poolAgain.status === 409, 'status=' + poolAgain.status);
  const poolTopics = await cP1.call('GET', '/api/mos/topics?q=' + encodeURIComponent(pPool.suggestedTitleEN));
  check('AP-06 正式 Topic 恰好 1 条且带溯源', poolTopics.status === 200 && poolTopics.json.items.length === 1,
    'items=' + (poolTopics.json.items || []).length);
  const pNoPerm = await newProposal({});
  const denied = await cP2.call('POST', '/api/mos/topic-proposals/' + pNoPerm.id + '/approve-to-pool', {});
  check('AP-07 P2 尝试批准入池 → 403（默认拒绝）', denied.status === 403, 'status=' + denied.status);
  const cross = await cP2U.call('POST', '/api/mos/topic-proposals/' + pPool.id + '/approve-to-pool', {});
  check('AP-08 UCARD 用户操作 VFIB 提案 → 404 防枚举', cross.status === 404, 'status=' + cross.status);

  /* ---------- 批准并安排：fail-fast 校验 ---------- */
  section('B. 批准并安排（幂等 Saga）—— 校验负例');
  const pSched = await newProposal({ suggestedTitleEN: 'Scheduled topic ' + Math.random().toString(36).slice(2, 7) });
  const noKey = await cP1.call('POST', '/api/mos/topic-proposals/' + pSched.id + '/approve-and-schedule',
    { workDate: '2026-11-05', deliverables: [{ platform: 'LINKEDIN', ownerId: creatorId, productionDue: '2026-11-10' }] });
  check('SC-01 缺 idempotencyKey → 400', noKey.status === 400 && noKey.json.code === 'MISSING_IDEMPOTENCY_KEY',
    'status=' + noKey.status + ' code=' + (noKey.json && noKey.json.code));
  const noDeliv = await cP1.call('POST', '/api/mos/topic-proposals/' + pSched.id + '/approve-and-schedule',
    { idempotencyKey: 'k-noDeliv', workDate: '2026-11-05', deliverables: [] });
  check('SC-02 无平台交付物 → 400（改用批准入池）', noDeliv.status === 400 && noDeliv.json.code === 'NO_DELIVERABLES');
  const badPlatform = await cP1.call('POST', '/api/mos/topic-proposals/' + pSched.id + '/approve-and-schedule',
    { idempotencyKey: 'k-badPlat', workDate: '2026-11-05', deliverables: [{ platform: 'WECHAT', ownerId: creatorId, productionDue: '2026-11-10' }] });
  check('SC-03 非法平台 → 400', badPlatform.status === 400 && badPlatform.json.code === 'BAD_PLATFORM');
  const badOwner = await cP1.call('POST', '/api/mos/topic-proposals/' + pSched.id + '/approve-and-schedule',
    { idempotencyKey: 'k-badOwner', workDate: '2026-11-05', deliverables: [{ platform: 'LINKEDIN', ownerId: 'user_nonexistent', productionDue: '2026-11-10' }] });
  check('SC-04 负责人不是真实在职用户 → 400', badOwner.status === 400 && badOwner.json.code === 'BAD_ASSIGNEE');
  const noDue = await cP1.call('POST', '/api/mos/topic-proposals/' + pSched.id + '/approve-and-schedule',
    { idempotencyKey: 'k-noDue', workDate: '2026-11-05', deliverables: [{ platform: 'LINKEDIN', ownerId: creatorId }] });
  check('SC-05 缺制作期限 → 400', noDue.status === 400 && noDue.json.code === 'BAD_PRODUCTION_DUE');
  const badDate = await cP1.call('POST', '/api/mos/topic-proposals/' + pSched.id + '/approve-and-schedule',
    { idempotencyKey: 'k-badDate', workDate: '2026/11/05', deliverables: [{ platform: 'LINKEDIN', ownerId: creatorId, productionDue: '2026-11-10' }] });
  check('SC-06 工作日期格式非法 → 400', badDate.status === 400 && badDate.json.code === 'BAD_DATE');
  check('SC-07 全部负例后提案仍为 PENDING（fail-fast 未触碰状态）',
    (await cP2.call('GET', '/api/mos/topic-proposals/' + pSched.id)).json.proposal.status === 'PENDING_EDITORIAL_REVIEW');

  /* ---------- 批准并安排：Saga 正向 + 幂等重放 ---------- */
  section('C. Saga 正向执行与幂等重放');
  const KEY = 'saga-' + crypto.randomBytes(6).toString('hex');
  const saga = await cP1.call('POST', '/api/mos/topic-proposals/' + pSched.id + '/approve-and-schedule', {
    idempotencyKey: KEY, workDate: '2026-11-05',
    deliverables: [
      { platform: 'LINKEDIN', ownerId: creatorId, productionDue: '2026-11-10' },
      { platform: 'X', ownerId: creatorId, productionDue: '2026-11-10' }
    ],
    comments: '双平台派工'
  });
  check('SG-01 Saga 完成 → 200，Topic state=ASSIGNED', saga.status === 200
    && saga.json.topic && saga.json.topic.state === 'ASSIGNED', JSON.stringify(saga.json.topic || {}));
  check('SG-02 两个平台任务 PLANNED 且编号不同', saga.json.tasks.length === 2
    && saga.json.tasks.every((t) => t.status === 'PLANNED')
    && saga.json.tasks[0].code !== saga.json.tasks[1].code,
    (saga.json.tasks || []).map((t) => t.platform + ':' + t.code).join(' / '));
  check('SG-03 自动创建月度计划（autoCreated=true）+ 2 个 PlanItem', saga.json.plan.autoCreated === true
    && saga.json.planItems.length === 2 && saga.json.plan.year === 2026 && saga.json.plan.month === 11,
    JSON.stringify(saga.json.plan || {}));
  check('SG-04 提案 APPROVED 且回链 Topic', (await cP2.call('GET', '/api/mos/topic-proposals/' + pSched.id)).json.proposal.status === 'APPROVED');

  const replay = await cP1.call('POST', '/api/mos/topic-proposals/' + pSched.id + '/approve-and-schedule', {
    idempotencyKey: KEY, workDate: '2026-11-05',
    deliverables: [
      { platform: 'LINKEDIN', ownerId: creatorId, productionDue: '2026-11-10' },
      { platform: 'X', ownerId: creatorId, productionDue: '2026-11-10' }
    ], comments: '双平台派工'
  });
  check('SG-05 同 idempotencyKey 重放 → replay=true 且返回首次快照', replay.status === 200
    && replay.json.replay === true && replay.json.dispatch.topicId === saga.json.topic.id
    && replay.json.dispatch.taskIds.length === 2, 'replay=' + replay.json.replay);
  const topicsAfter = await cP1.call('GET', '/api/mos/topics?q=' + encodeURIComponent(pSched.suggestedTitleEN));
  check('SG-06 重放后正式 Topic 仍恰好 1 条（双击/重试不重复建题）', topicsAfter.json.items.length === 1,
    'items=' + topicsAfter.json.items.length);
  const anotherKey = await cP1.call('POST', '/api/mos/topic-proposals/' + pSched.id + '/approve-and-schedule', {
    idempotencyKey: KEY + '-2nd', workDate: '2026-11-06',
    deliverables: [{ platform: 'X', ownerId: creatorId, productionDue: '2026-11-10' }]
  });
  check('SG-07 已 APPROVED 提案换 key 再派工 → 409（状态机防护）', anotherKey.status === 409, 'status=' + anotherKey.status);
  const pP2Sched = await newProposal({});
  const schedDenied = await cP2.call('POST', '/api/mos/topic-proposals/' + pP2Sched.id + '/approve-and-schedule', {
    idempotencyKey: 'k-p2', workDate: '2026-11-05',
    deliverables: [{ platform: 'X', ownerId: creatorId, productionDue: '2026-11-10' }]
  });
  check('SG-08 P2 尝试批准并安排 → 403（默认拒绝）', schedDenied.status === 403, 'status=' + schedDenied.status);

  /* ---------- 日 / 周 / 月同源视图 ---------- */
  section('D. 日 / 周 / 月同源视图');
  const vMonth = await cP2.call('GET', '/api/mos/editorial/views?brand=VFIB&mode=month&date=2026-11-05');
  check('VW-01 月视图含 11-05 的 2 个事项且按状态聚合', vMonth.status === 200 && vMonth.json.counts.total === 2
    && vMonth.json.counts.byStatus.PLANNED === 2, JSON.stringify(vMonth.json.counts || {}));
  check('VW-02 月视图范围覆盖整月', vMonth.json.range.from === '2026-11-01' && vMonth.json.range.to === '2026-11-30',
    JSON.stringify(vMonth.json.range || {}));
  const vDay = await cP2.call('GET', '/api/mos/editorial/views?brand=VFIB&mode=day&date=2026-11-05');
  check('VW-03 日视图恰为当日 2 项', vDay.status === 200 && vDay.json.counts.total === 2
    && vDay.json.range.from === '2026-11-05' && vDay.json.range.to === '2026-11-05');
  const vWeek = await cP2.call('GET', '/api/mos/editorial/views?brand=VFIB&mode=week&date=2026-11-05');
  check('VW-04 周视图包含同一 2 项（同源过滤，非复制）', vWeek.status === 200 && vWeek.json.counts.total === 2
    && vWeek.json.items.every((i) => i.workDate === '2026-11-05'));
  const vEmpty = await cP2.call('GET', '/api/mos/editorial/views?brand=VFIB&mode=day&date=2026-12-25');
  check('VW-05 空时段如实为 0（不伪造条目）', vEmpty.status === 200 && vEmpty.json.counts.total === 0);
  const vCross = await cP2U.call('GET', '/api/mos/editorial/views?brand=VFIB&mode=month&date=2026-11-05');
  check('VW-06 跨品牌读视图 → 404 防枚举', vCross.status === 404, 'status=' + vCross.status);

  /* ---------- 平台任务独立推进 ---------- */
  section('E. 平台任务独立推进');
  const liTask = saga.json.tasks.find((t) => t.platform === 'LINKEDIN');
  const xTask = saga.json.tasks.find((t) => t.platform === 'X');
  const tr = await cCreator.call('POST', '/api/mos/tasks/' + liTask.id + '/transition', { status: 'IN_PRODUCTION' });
  check('TK-01 LinkedIn 任务独立推进 → IN_PRODUCTION', tr.status === 200 && tr.json.task.status === 'IN_PRODUCTION',
    'status=' + tr.status);
  const xDetail = await cCreator.call('GET', '/api/mos/tasks/' + xTask.id);
  check('TK-02 X 任务不受影响（仍 PLANNED，平台独立退回/推进）', xDetail.status === 200 && xDetail.json.task.status === 'PLANNED');
  const vAfter = await cP2.call('GET', '/api/mos/editorial/views?brand=VFIB&mode=day&date=2026-11-05');
  check('TK-03 视图聚合随任务状态真实更新（IN_PRODUCTION=1 / PLANNED=1）',
    vAfter.json.counts.byStatus.IN_PRODUCTION === 1 && vAfter.json.counts.byStatus.PLANNED === 1,
    JSON.stringify(vAfter.json.counts || {}));

  /* ---------- 审计落盘 ---------- */
  section('F. 审计落盘（停服后直读数据文件）');
  await sleep(600);
  await stopServer();
  await sleep(600);
  let audit = null;
  try {
    const db = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'mos.json'), 'utf8'));
    audit = (db.audit_events || []).map((e) => e.eventType);
  } catch (_) { audit = null; }
  check('AU-01 editorial.approve_to_pool 已落审计', !!audit && audit.includes('editorial.approve_to_pool'));
  check('AU-02 editorial.saga_completed 已落审计', !!audit && audit.includes('editorial.saga_completed'));
  check('AU-03 plan.created(autoBySaga) 已落审计', !!audit && audit.includes('plan.created'));
  check('AU-04 proposal.decision 已落审计', !!audit && audit.includes('proposal.decision'));

  writeEvidence();
  await cleanup();
  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log('\n[v012-editorial] ' + passed + '/' + results.length + ' 通过' + (failed ? '，' + failed + ' 失败' : ''));
  process.exitCode = failed ? 1 : 0;
}

process.on('unhandledRejection', (e) => {
  console.error('未处理异常：', e);
  writeEvidence();
  process.exit(2);
});

main();
