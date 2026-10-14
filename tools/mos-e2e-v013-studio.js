'use strict';
/* ============================================================
 * Marketing OS · V0.1.3 Phase A —— 一站式任务工作空间 e2e（真实 HTTP + 隔离实例）
 * ------------------------------------------------------------
 * 覆盖（执行包 01/03/04）：
 *   - /tasks/:id/studio 聚合（Brief/研究/交付物/下一步/高级收纳）
 *   - /tasks/:id/submit-check 服务端检查（必需项阻断）
 *   - 业务依据登记（无研究任务路径）→ 解除 source 阻断
 *   - 平台变体：幂等重放零新增 / 缺依据 409 / 非法平台 400 / 跨品牌 404 / 无权 403
 *   - 上级备注（任务内可见）
 * 运行：node tools/mos-e2e-v013-studio.js（或 bash tools/run-mos-tests.sh studio）
 * 端口：9720-9727；证据：TEST_EVIDENCE_MOS_V013_STUDIO/
 * ============================================================ */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9720 + Math.floor(Math.random() * 8);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA_DIR = path.join(ROOT, 'data-mos-studio-' + crypto.randomBytes(3).toString('hex'));
const OUT_DIR = path.join(ROOT, 'TEST_EVIDENCE_MOS_V013_STUDIO');

const ADMIN_PW = 'Studio-' + crypto.randomBytes(9).toString('base64url');
const STAFF_PW = 'Studio-' + crypto.randomBytes(9).toString('base64url');
const OTHER_PW = 'Studio-' + crypto.randomBytes(9).toString('base64url');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : String(detail) });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  :: ' + detail : ''));
}
function section(t) { console.log('\n---- ' + t + ' ----'); }

function client() {
  let cookies = {};
  const call = async (method, p, body) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookies.mos_csrf) headers['x-mos-csrf'] = cookies.mos_csrf;
    if (Object.keys(cookies).length) headers.Cookie = Object.keys(cookies).map((k) => k + '=' + cookies[k]).join('; ');
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of sc) {
      const [pair] = String(c).split(';');
      const i = pair.indexOf('=');
      if (i > 0) cookies[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch (_) { /* ignore */ }
    return { status: res.status, json, cookies: Object.assign({}, cookies) };
  };
  return { call };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      MOS_DATA_DIR: path.relative(ROOT, DATA_DIR).replace(/\\/g, '/'),
      MOS_PORT: String(PORT),
      MOS_ADMIN_PASSWORD: ADMIN_PW,
      MOS_TEXT_PROVIDER: 'mock',
      MOS_IMAGE_PROVIDER: 'mock'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 80; i += 1) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch (_) { /* retry */ }
    await sleep(250);
  }

  try {
    const admin = client();
    let r = await admin.call('POST', '/api/mos/auth/login', { username: 'mosadmin', password: ADMIN_PW });
    check('A-00 引导管理员登录', r.status === 200 && r.json.ok, 'status=' + r.status);
    if (r.json && r.json.mustChangePassword) {
      await admin.call('POST', '/api/mos/auth/change-password', { oldPassword: ADMIN_PW, newPassword: ADMIN_PW + 'x' });
    }
    const mk = async (username, password, roleCode, brandScope) => {
      const res = await admin.call('POST', '/api/mos/admin/users', {
        username, displayName: 'e2e·' + username, password, mustChangePassword: false,
        roles: [{ roleCode, brandScope }]
      });
      if (res.status !== 200) throw new Error('创建 ' + username + ' 失败：' + JSON.stringify(res.json));
      return res.json.user;
    };
    await mk('e2e.p2vfib', STAFF_PW, 'P2', ['VFIB']);
    await mk('e2e.p2ucard', OTHER_PW, 'P2', ['UCARD']);
    await mk('e2e.p3vfib', STAFF_PW + 'z', 'P3', ['VFIB']);

    const p2 = client();
    const p2u = client();
    const p3 = client();
    check('A-01 P2(VFIB) 登录', (await p2.call('POST', '/api/mos/auth/login', { username: 'e2e.p2vfib', password: STAFF_PW })).status === 200);
    check('A-02 P2(UCARD) 登录', (await p2u.call('POST', '/api/mos/auth/login', { username: 'e2e.p2ucard', password: OTHER_PW })).status === 200);
    check('A-03 P3(VFIB) 登录', (await p3.call('POST', '/api/mos/auth/login', { username: 'e2e.p3vfib', password: STAFF_PW + 'z' })).status === 200);

    /* ---------- 受控任务：AD_HOC（无 Topic / 无研究） ---------- */
    section('B. 受控临时任务（无研究来源）');
    const adhoc = await p2.call('POST', '/api/mos/tasks/ad-hoc?brand=VFIB',
      { title: 'Phase A 受控临时任务', workDate: '2026-11-05', platform: 'LINKEDIN' });
    check('B-01 创建 AD_HOC 任务', adhoc.status === 200 && adhoc.json.ok, 'status=' + adhoc.status);
    const taskId = (adhoc.json.task || {}).id;
    const st0 = await p2.call('GET', '/api/mos/tasks/' + taskId + '/studio?brand=VFIB');
    check('B-02 studio 聚合 200（含 deliverables/nextActions）', st0.status === 200
      && st0.json.deliverables && st0.json.deliverables.TEXT && Array.isArray(st0.json.nextActions),
      'keys=' + Object.keys(st0.json.deliverables || {}).join(','));
    check('B-03 无研究主题时 research=null 且未登记依据', st0.json.research === null && !st0.json.businessBasis,
      'research=' + JSON.stringify(st0.json.research));
    check('B-04 技术参数收纳进 advanced（不在首屏字段）',
      st0.json.advanced && st0.json.advanced.providerStatus && !st0.json.task.textProvider, '');

    /* ---------- submit-check：必需项阻断 ---------- */
    section('C. 提交审核前检查（服务端判定）');
    const chk0 = await p2.call('GET', '/api/mos/tasks/' + taskId + '/submit-check?brand=VFIB');
    check('C-01 无版本 → body 阻断', chk0.status === 200 && (chk0.json.blocking || []).indexOf('body') !== -1,
      'blocking=' + JSON.stringify(chk0.json.blocking));
    check('C-02 无版本且无依据 → source 阻断', (chk0.json.blocking || []).indexOf('source') !== -1,
      'blocking=' + JSON.stringify(chk0.json.blocking));
    const mkv = await p2.call('POST', '/api/mos/content-versions?brand=VFIB', { taskId, body: '' });
    const vid = (mkv.json.version || {}).id;
    await p2.call('PUT', '/api/mos/content-versions/' + vid + '?brand=VFIB',
      { body: 'Phase A e2e 正文：用于验证提交检查链路。', title: 'Phase A 受控草稿', rowVersion: 1 });
    const chk1 = await p2.call('GET', '/api/mos/tasks/' + taskId + '/submit-check?brand=VFIB');
    check('C-03 写入正文后 body 解除阻断', (chk1.json.blocking || []).indexOf('body') === -1,
      'blocking=' + JSON.stringify(chk1.json.blocking));
    check('C-04 仍缺来源（source 阻断保持）', (chk1.json.blocking || []).indexOf('source') !== -1, '');

    /* ---------- 业务依据：无研究任务路径 ---------- */
    section('D. 业务依据登记（无 AI / 无研究也可交付）');
    const badBasis = await p2.call('POST', '/api/mos/tasks/' + taskId + '/basis?brand=VFIB', { kind: 'NOT_A_KIND', note: 'x' });
    check('D-01 非法依据类型 → 400', badBasis.status === 400, 'status=' + badBasis.status);
    const noNote = await p2.call('POST', '/api/mos/tasks/' + taskId + '/basis?brand=VFIB', { kind: 'AD_HOC', note: '' });
    check('D-02 空说明 → 400', noNote.status === 400, 'status=' + noNote.status);
    const basis = await p2.call('POST', '/api/mos/tasks/' + taskId + '/basis?brand=VFIB',
      { kind: 'OFFICIAL_NOTICE', note: '监管机构公开通知（e2e 依据）', ref: 'REF-2026-001' });
    check('D-03 登记依据 → 200 且 requiresReview=true（不豁免审核）',
      basis.status === 200 && basis.json.task && true
        && (await p2.call('GET', '/api/mos/tasks/' + taskId + '/studio?brand=VFIB')).json.businessBasis.requiresReview === true,
      'status=' + basis.status);
    const chk2 = await p2.call('GET', '/api/mos/tasks/' + taskId + '/submit-check?brand=VFIB');
    check('D-04 登记依据后 source 解除阻断', (chk2.json.blocking || []).indexOf('source') === -1,
      'blocking=' + JSON.stringify(chk2.json.blocking));

    /* ---------- 平台变体：幂等 / 校验 / RBAC ---------- */
    section('E. 平台变体（同一任务，多平台独立制作）');
    const noKey = await p2.call('POST', '/api/mos/tasks/' + taskId + '/variant?brand=VFIB', { platform: 'X' });
    check('E-01 缺 idempotencyKey → 400', noKey.status === 400, 'status=' + noKey.status);
    const badPlat = await p2.call('POST', '/api/mos/tasks/' + taskId + '/variant?brand=VFIB', { platform: 'TIKTOK', idempotencyKey: 'k0' });
    check('E-02 非法平台 → 400', badPlat.status === 400, 'status=' + badPlat.status);
    const v1 = await p2.call('POST', '/api/mos/tasks/' + taskId + '/variant?brand=VFIB',
      { platform: 'X', idempotencyKey: 'key-001' });
    check('E-03 创建 X 变体 → 200（独立任务）', v1.status === 200 && v1.json.task && v1.json.task.id !== taskId,
      'code=' + (v1.json.task || {}).code);
    check('E-04 变体继承栏目/风险与平台切换', (v1.json.task || {}).platform === 'X'
      && (v1.json.task || {}).pillarCode === adhoc.json.task.pillarCode, '');
    const v2 = await p2.call('POST', '/api/mos/tasks/' + taskId + '/variant?brand=VFIB',
      { platform: 'X', idempotencyKey: 'key-001' });
    check('E-05 幂等重放 → deduplicated=true 零新增', v2.status === 200 && v2.json.deduplicated === true
      && v2.json.task.id === v1.json.task.id, '');
    const before = await p2.call('GET', '/api/mos/tasks?brand=VFIB');
    const v3 = await p2.call('POST', '/api/mos/tasks/' + taskId + '/variant?brand=VFIB',
      { platform: 'YOUTUBE', idempotencyKey: 'key-002' });
    const after = await p2.call('GET', '/api/mos/tasks?brand=VFIB');
    check('E-06 第二平台变体（YOUTUBE）成功且任务数 +1', v3.status === 200
      && after.json.total === before.json.total + 1, 'total=' + after.json.total);

    /* ---------- RBAC ---------- */
    section('F. 越权防护');
    const cross = await p2u.call('GET', '/api/mos/tasks/' + taskId + '/studio?brand=VFIB');
    check('F-01 跨品牌读 studio → 404（防枚举，SEC-03 同形）', cross.status === 404, 'status=' + cross.status);
    const crossVar = await p2u.call('POST', '/api/mos/tasks/' + taskId + '/variant?brand=VFIB',
      { platform: 'X', idempotencyKey: 'kx' });
    check('F-02 跨品牌创建变体 → 404', crossVar.status === 404, 'status=' + crossVar.status);
    const p3Var = await p3.call('POST', '/api/mos/tasks/' + taskId + '/variant?brand=VFIB',
      { platform: 'X', idempotencyKey: 'kp' });
    check('F-03 P3（无 content.edit）创建变体 → 403', p3Var.status === 403, 'status=' + p3Var.status);
    const p3Basis = await p3.call('POST', '/api/mos/tasks/' + taskId + '/basis?brand=VFIB', { kind: 'AD_HOC', note: 'x' });
    check('F-04 P3 登记依据 → 403', p3Basis.status === 403, 'status=' + p3Basis.status);

    /* ---------- 上级备注 ---------- */
    section('G. 任务内上级备注');
    const note = await p2.call('POST', '/api/mos/tasks/' + taskId + '/notes?brand=VFIB', { text: '请引用左侧研究依据中的第 2 条事实。' });
    check('G-01 添加备注 → 200', note.status === 200, 'status=' + note.status);
    const emptyNote = await p2.call('POST', '/api/mos/tasks/' + taskId + '/notes?brand=VFIB', { text: '  ' });
    check('G-02 空备注 → 400', emptyNote.status === 400, 'status=' + emptyNote.status);
    const st1 = await p2.call('GET', '/api/mos/tasks/' + taskId + '/studio?brand=VFIB');
    const notes = ((st1.json.brief || {}).supervisorNotes) || [];
    check('G-03 备注进入 studio 聚合（含作者与时间）', notes.length === 1 && !!notes[0].authorName && !!notes[0].createdAt,
      'notes=' + notes.length);

    /* ---------- 收尾 ---------- */
    await sleep(700);
    const fsOut = {
      suite: 'studio (V0.1.3 Phase A)',
      generatedAt: new Date().toISOString(),
      base: BASE,
      total: results.length,
      passed: results.filter((x) => x.ok).length,
      failed: results.filter((x) => !x.ok).length,
      results
    };
    fs.writeFileSync(path.join(OUT_DIR, 'studio-result.json'), JSON.stringify(fsOut, null, 2));
    console.log('\nStudio e2e：' + fsOut.passed + '/' + fsOut.total + ' 通过');
    if (fsOut.failed) process.exitCode = 1;
  } finally {
    try { server.kill('SIGTERM'); } catch (_) { /* ignore */ }
    await sleep(700);
    try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
}

main().catch((err) => { console.error('套件异常：', err && err.stack || err); process.exit(1); });
