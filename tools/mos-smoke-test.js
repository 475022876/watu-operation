'use strict';
/**
 * MOS 冒烟自检（BUILD-01）：以子进程方式拉起真实服务器，跑通关键接口后收尾。
 * 独立数据目录、运行期随机口令，不触碰 data/。
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = 9500 + Math.floor(Math.random() * 50);
const DATA_DIR = path.join(ROOT, 'data-mos-smoke-' + crypto.randomBytes(3).toString('hex'));
const ADMIN_PW = 'Smk' + crypto.randomBytes(9).toString('hex');

const results = [];
function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail: detail === undefined ? '' : String(detail) });
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '  :: ' + detail : ''));
}

function cookiesFrom(res, jar) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of raw) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }
  return jar;
}
function cookieHeader(jar) {
  return Object.keys(jar).map((k) => k + '=' + jar[k]).join('; ');
}

async function main() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: Object.assign({}, process.env, {
      MOS_DATA_DIR: path.relative(ROOT, DATA_DIR).replace(/\\/g, '/'),
      MOS_PORT: String(PORT),
      MOS_ADMIN_PASSWORD: ADMIN_PW,
      MOS_TEXT_PROVIDER: 'mock',
      MOS_EGRESS_ALLOW_LOOPBACK: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d.toString(); });
  child.stderr.on('data', (d) => { out += d.toString(); });

  const base = 'http://127.0.0.1:' + PORT;
  const jar = {};

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(base + '/api/health');
      if (r.ok) break;
    } catch (_) { /* retry */ }
    await wait(250);
  }

  const req = async (method, p, body) => {
    const headers = { cookie: cookieHeader(jar) };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (jar.mos_csrf) headers['x-mos-csrf'] = jar.mos_csrf;
    const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    cookiesFrom(res, jar);
    let json = null;
    try { json = await res.json(); } catch (_) { /* ignore */ }
    return { status: res.status, json };
  };

  try {
    const me0 = await req('GET', '/api/mos/auth/me');
    check('GET /api/mos/auth/me 未登录返回 authenticated=false', me0.status === 200 && me0.json && me0.json.authenticated === false, JSON.stringify(me0.json));

    const bad = await req('POST', '/api/mos/auth/login', { username: 'mosadmin', password: crypto.randomBytes(12).toString('hex') });
    check('错误口令被拒绝', bad.status === 401, bad.status + ' ' + JSON.stringify(bad.json));

    const login = await req('POST', '/api/mos/auth/login', { username: 'mosadmin', password: ADMIN_PW });
    check('管理员登录成功', login.status === 200 && login.json && login.json.ok === true, JSON.stringify(login.json));

    const me1 = await req('GET', '/api/mos/auth/me');
    check('登录后 /me 返回主体与权限', me1.status === 200 && me1.json.authenticated === true && Array.isArray(me1.json.brands), '');

    const meta = await req('GET', '/api/mos/meta');
    check('GET /api/mos/meta 返回字典与集成状态', meta.status === 200 && meta.json.dictionaries && meta.json.integrations, '');

    // 未改密 → 受保护接口应被拦截
    const blocked = await req('GET', '/api/mos/plans?brand=VFIB');
    check('首登未改密 → 受保护接口 403 PASSWORD_CHANGE_REQUIRED', blocked.status === 403 && blocked.json.code === 'PASSWORD_CHANGE_REQUIRED', JSON.stringify(blocked.json));

    const chg = await req('POST', '/api/mos/auth/change-password', { oldPassword: ADMIN_PW, newPassword: 'MosAdmin!' + crypto.randomBytes(4).toString('hex') });
    check('修改密码成功', chg.status === 200 && chg.json.ok === true, JSON.stringify(chg.json));

    const plans = await req('GET', '/api/mos/plans?brand=VFIB');
    check('GET /api/mos/plans 返回 DEMO 计划', plans.status === 200 && plans.json.total >= 1, 'total=' + (plans.json && plans.json.total));

    const cal = await req('GET', '/api/mos/calendar?brand=VFIB&view=month&anchor=2026-10-11');
    check('GET /api/mos/calendar 返回统一日历条目', cal.status === 200 && Array.isArray(cal.json.entries), 'entries=' + (cal.json && cal.json.entries && cal.json.entries.length));

    const xbrand = await req('GET', '/api/mos/plans?brand=NOPE');
    check('未知品牌返回 404', xbrand.status === 404, xbrand.status);

    const sources = await req('GET', '/api/mos/sources?brand=VFIB');
    check('GET /api/mos/sources 返回来源登记', sources.status === 200 && sources.json.items.length >= 1, '');

    const topics = await req('GET', '/api/mos/topics?brand=VFIB');
    check('GET /api/mos/topics 返回 DEMO Topic', topics.status === 200 && topics.json.total >= 1, '');

    const audit = await req('GET', '/api/mos/audit?limit=10');
    check('GET /api/mos/audit 返回审计事件', audit.status === 200 && Array.isArray(audit.json.items) && audit.json.items.length >= 1, 'n=' + (audit.json && audit.json.items && audit.json.items.length));

    /* ---- V0.1.3 Phase D：版本一致性（REL-01；禁止"只改包名"或改了包名不改显示） ---- */
    const pkgVer = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const mosCfgSrc = fs.readFileSync(path.join(ROOT, 'lib', 'mos', 'config.js'), 'utf8');
    const mosVer = (mosCfgSrc.match(/const MOS_VERSION = '([^']+)'/) || [])[1];
    const baseCfgSrc = fs.readFileSync(path.join(ROOT, 'lib', 'config.js'), 'utf8');
    const appVer = (baseCfgSrc.match(/appVersion: '([^']+)'/) || [])[1];
    const htmlVer = (fs.readFileSync(path.join(ROOT, 'public', 'mos.html'), 'utf8')
      .match(/id="versionText">v([0-9.]+)</) || [])[1];
    const metaVer = String((meta.json && meta.json.mosVersion) || '');
    check('VER-01 版本一致：package.json = MOS_VERSION = appVersion = 页面显示 = /api/mos/meta',
      pkgVer === mosVer && mosVer === appVer && appVer === htmlVer && htmlVer === metaVer,
      'pkg=' + pkgVer + ' mos=' + mosVer + ' app=' + appVer + ' html=' + htmlVer + ' meta=' + metaVer);
    check('VER-02 版本已升级到 0.1.5（本轮目标；非 0.1.4）',
      pkgVer === '0.1.5', 'version=' + pkgVer);
  } catch (err) {
    check('冒烟过程未抛异常', false, err.message);
  }

  child.kill('SIGTERM');
  await wait(600);
  try { child.kill('SIGKILL'); } catch (_) { /* ignore */ }

  const failed = results.filter((r) => !r.ok);
  console.log('\n冒烟结果：' + (results.length - failed.length) + '/' + results.length + ' 通过');
  // 证据落盘（与单元/E2E/UI 同一目录，便于统一归档与复核）
  try {
    const outDir = path.join(ROOT, 'TEST_EVIDENCE_MOS_BUILD01');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'smoke-result.json'), JSON.stringify({
      suite: 'mos-smoke', mosVersion: '0.1.5', ranAt: new Date().toISOString(),
      total: results.length, passed: results.length - failed.length, failed: failed.length,
      cases: results
    }, null, 2), 'utf8');
  } catch (_) { /* ignore */ }
  if (out && failed.length) console.log('--- 服务端输出 ---\n' + out.slice(-3000));
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(failed.length ? 1 : 0);
}

main();
void os;
