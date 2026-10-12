#!/usr/bin/env node
'use strict';
/**
 * BUILD-02 后端冒烟脚本（临时验证用，非交付物）。
 * 复用 mos-e2e-test.js 的 Cookie + 双提交 CSRF 客户端模式。
 */
const BASE = 'http://127.0.0.1:' + (process.env.MOS_PORT || 9080);
const PW = process.env.MOS_ADMIN_PASSWORD || process.argv[2] || 'VfibMos2026';

function client() {
  const jar = new Map();
  async function call(method, p, body) {
    const headers = {};
    if (jar.size) headers.Cookie = [...jar.entries()].map(([k, v]) => k + '=' + v).join('; ');
    if (jar.get('mos_csrf')) headers['x-mos-csrf'] = jar.get('mos_csrf');
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(BASE + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
  return { call, jar, async login(u, p) { return call('POST', '/api/mos/auth/login', { username: u, password: p }); } };
}

const results = [];
function rec(label, r) {
  const ok = r.status >= 200 && r.status < 300;
  const err = r.json && r.json.error ? ' | ' + r.json.error + (r.json.code ? ' (' + r.json.code + ')' : '') : '';
  results.push({ label, status: r.status, ok });
  console.log((ok ? 'PASS ' : 'FAIL ') + String(r.status).padEnd(4) + label + err);
  return r;
}

async function main() {
  const c = client();
  // 取 CSRF Cookie
  await c.call('GET', '/');
  const lg = await c.login('mosadmin', PW);
  if (lg.status !== 200) {
    console.log('LOGIN FAIL', lg.status, JSON.stringify(lg.json));
    process.exit(1);
  }
  console.log('LOGIN OK as mosadmin');

  const B = '?brand=VFIB';
  const GETS = [
    '/api/mos/skills' + B,
    '/api/mos/templates' + B,
    '/api/mos/content-dictionaries' + B,
    '/api/mos/content-versions' + B,
    '/api/mos/review-cases' + B,
    '/api/mos/review-history' + B,
    '/api/mos/channels' + B,
    '/api/mos/publishing/schedules' + B,
    '/api/mos/publishing/calendar' + B,
    '/api/mos/publications' + B,
    '/api/mos/generation-jobs' + B,
    '/api/mos/tasks' + B,
    '/api/mos/meta'
  ];
  for (const p of GETS) rec('GET  ' + p, await c.call('GET', p));

  // 写路径最小验证：创建草稿。
  // 注意：不能盲目取"第一个任务" —— 已送审（IN_REVIEW）/已批准（READY）的任务会被服务端
  // 正确拒绝（TASK_NOT_EDITABLE）。这里优先选可编辑状态的任务，没有就建一个临时任务。
  const trees = await c.call('GET', '/api/mos/tasks' + B);
  const EDITABLE = ['IDEA', 'PLANNED', 'IN_PRODUCTION'];
  let tasks = (trees.json && (trees.json.items || trees.json.data || trees.json)) || [];
  let pick = tasks.find((t) => EDITABLE.indexOf(t.status) !== -1);
  if (!pick) {
    const ah = await c.call('POST', '/api/mos/tasks/ad-hoc' + B, {
      title: '冒烟临时任务 ' + new Date().toISOString().slice(0, 16), workDate: new Date().toISOString().slice(0, 10)
    });
    pick = ah.json && (ah.json.task || ah.json);
    console.log('无可编辑任务，已创建临时任务 =', pick && pick.id);
  }
  const taskId = pick && pick.id;
  console.log('smoke taskId =', taskId, 'status =', pick && pick.status);

  if (taskId) {
    const created = await c.call('POST', '/api/mos/content-versions' + B, {
      taskId, body: '冒烟测试草稿：本段用于验证内容版本的创建、锁定与审核链。'
    });
    rec('POST /api/mos/content-versions', created);
    if (created.status >= 200 && created.status < 300) {
      const it = (created.json && (created.json.version || created.json.item)) || created.json;
      const id = it && it.id;
      console.log('  new versionId =', id, 'state =', it && it.state);
      if (id) {
        const locked = await c.call('POST', '/api/mos/content-versions/' + id + '/lock' + B, {});
        rec('POST /api/mos/content-versions/:id/lock', locked);
        const cases = await c.call('GET', '/api/mos/review-cases' + B);
        const arr = (cases.json && (cases.json.items || cases.json.data || cases.json)) || [];
        console.log('  review cases after lock =', Array.isArray(arr) ? arr.length : 'n/a');
        const got = await c.call('GET', '/api/mos/content-versions/' + id + B);
        rec('GET  /api/mos/content-versions/:id', got);
      }
    }
  } else {
    console.log('WARN 没有可用 content task，跳过写路径验证');
  }

  const bad = results.filter((r) => !r.ok);
  console.log('\n=== 冒烟汇总：' + (results.length - bad.length) + '/' + results.length + ' 通过 ===');
  if (bad.length) { console.log('失败项：'); bad.forEach((b) => console.log('  - ' + b.label + ' -> ' + b.status)); process.exit(1); }
}

main().catch((e) => { console.error('SMOKE ERROR', e); process.exit(1); });
