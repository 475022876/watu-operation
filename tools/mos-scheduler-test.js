#!/usr/bin/env node
'use strict';
/**
 * A-01 轻量来源调度 —— 隔离自检（suite: sched）。
 *
 * 覆盖（对应 02 §5 / 04 §3 与整改 A-01）：
 *   1. 默认关闭：未显式开启时 `start()` 不启动定时器、状态如实为 configured=false；
 *   2. 可调度判定：非 ACTIVE / MANUAL 方式 / MANUAL 频率 / 域名不在白名单 → 一律不调度，并给出原因；
 *   3. 真实抓取：本地 allowlist 源（回环放行仅测试）→ 作业 SUCCEEDED，条目落库；
 *   4. 幂等去重：同一时间桶重复 tick 不重复抓取；同内容再次采集按 canonicalUrl/digest 跳过；
 *   5. 跨重启不补发：作业记录（含桶键）持久化，`store.reset()` 后再次 tick 仍判定为已执行；
 *   6. 失败退避：瞬时失败 → `nextRunAt` 退避、`scheduleFailures` 递增，未到期不再重试；
 *   7. 永久失败：白名单外域名 → 不自动重试、来源置 ERROR，且不再被调度；
 *   8. 单实例锁：存在**他实例**新鲜心跳锁时，本轮拒绝执行并如实上报 LOCK_HELD_BY_OTHER_INSTANCE；
 *   9. fail closed：未核验来源的手工采集被阻断，并落 BLOCKED 作业记录；
 *  10. schema v4：新增 `ingest_jobs` 集合存在（只增不改的确定性迁移）。
 *
 * 隔离口径：独立数据目录（data-mos-sched-*）、随机端口段 9640-9649、跑完自清，不触碰 data/。
 */
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const FEED_PORT = 9640 + Math.floor(Math.random() * 10);
const DATA_DIR = path.join(os.tmpdir(), 'data-mos-sched-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
const OUT_DIR = path.join(__dirname, '..', 'TEST_EVIDENCE_MOS_BUILD01');

process.env.MOS_DATA_DIR = DATA_DIR;
process.env.MOS_DEMO_SEED = '1';
process.env.MOS_PRODUCTION = '0';
process.env.MOS_EGRESS_ALLOWED_HOSTS = '127.0.0.1,localhost';
process.env.MOS_EGRESS_ALLOW_HTTP = '1';
process.env.MOS_EGRESS_ALLOW_LOOPBACK = '1';
process.env.MOS_EGRESS_MAX_ITEMS_PER_RUN = '5';
process.env.MOS_SCHEDULER_ENABLED = '0';
process.env.MOS_SCHEDULER_INTERVAL_MINUTES = '1';
process.env.MOS_SCHEDULER_MAX_PER_TICK = '3';
process.env.MOS_SCHEDULER_MAX_FAILURES = '2';   // 让「连续失败达上限即停」可在少量调用内被验证

const store = require('../lib/mos/store');
const mosConfig = require('../lib/mos/config');
const ingest = require('../lib/mos/ingest');
const scheduler = require('../lib/mos/scheduler');

const cases = [];
let passed = 0;
let failed = 0;

function ok(name, cond, detail) {
  const c = { name, ok: !!cond, detail: String(detail === undefined ? '' : detail) };
  cases.push(c);
  if (c.ok) { passed += 1; console.log('  PASS  ' + name + (detail ? '  :: ' + detail : '')); }
  else { failed += 1; console.log('  FAIL  ' + name + '  :: ' + c.detail); }
}

/* ---------------- 本地 feed 服务（仅回环，测试专用放行） ---------------- */

let feedItems = [
  { title: 'Official notice A', link: 'https://example.test/a', date: '2026-10-01T00:00:00Z', desc: 'A body' },
  { title: 'Official notice B', link: 'https://example.test/b', date: '2026-10-02T00:00:00Z', desc: 'B body' }
];

function feedXml() {
  const items = feedItems.map((i) => '<item><title>' + i.title + '</title><link>' + i.link
    + '</link><pubDate>' + i.date + '</pubDate><description>' + i.desc + '</description></item>').join('');
  return '<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>'
    + '<title>Test Allowlisted Feed</title>' + items + '</channel></rss>';
}

function startFeedServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/feed.xml') === 0) {
        res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' });
        res.end(feedXml());
        return;
      }
      if (req.url.indexOf('/boom') === 0) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('upstream error');
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
    });
    server.listen(FEED_PORT, '127.0.0.1', () => resolve(server));
  });
}

/* ---------------- 直接构造来源登记（绕过 HTTP，聚焦调度逻辑） ---------------- */

function addSource(db, patch) {
  const nowIso = new Date().toISOString();
  const s = Object.assign({
    id: 'src_test_' + Math.floor(Math.random() * 1e9).toString(36),
    brandCode: 'VFIB',
    domain: '127.0.0.1',
    name: '测试来源',
    tier: 'S1',
    method: 'RSS',
    endpoint: 'http://127.0.0.1:' + FEED_PORT + '/feed.xml',
    licensePolicy: 'OPEN',
    licenseNote: '测试',
    country: 'ZZ',
    frequency: 'HOURLY',
    retryPolicy: 'EXP_BACKOFF_3',
    retentionDays: 180,
    allowFullText: true,
    ownerId: 'u_test',
    status: 'ACTIVE',
    demo: false,
    createdAt: nowIso, updatedAt: nowIso, rowVersion: 1
  }, patch || {});
  db.source_registry.push(s);
  return s;
}

const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 9, 13, 12, 0, 0);

/* ---------------- 主流程 ---------------- */

async function main() {
  const feedServer = await startFeedServer();
  let db = store.getDb();

  /* 1. schema 与默认关闭
   * 注：V0.1.4 起 schema 升到 v8（新增 provider_calls）；此处只断言"不低于 v7 且关键集合存在"，
   * 避免每次加集合都要改这条历史断言。 */
  ok('SCH-01 schema 不低于 v7，且存在 ingest_jobs 与四项集成态集合',
    store.MOS_SCHEMA_VERSION >= 7 && Array.isArray(db.ingest_jobs)
      && Array.isArray(db.library_tickets) && Array.isArray(db.library_event_cursors),
    'schemaVersion=' + store.MOS_SCHEMA_VERSION + ' ingest_jobs=' + (Array.isArray(db.ingest_jobs) ? 'array' : 'missing'));

  const st0 = scheduler.status();
  ok('SCH-02 调度器默认关闭（未获运营授权不自动出站）',
    st0.configured === false && st0.running === false && st0.singleInstanceOnly === true,
    'configured=' + st0.configured + ' running=' + st0.running);

  const startRes = scheduler.start();
  ok('SCH-03 关闭状态下 start() 不启动定时器',
    startRes.started === false && startRes.reason === 'DISABLED',
    JSON.stringify(startRes));

  /* 2. 可调度判定矩阵 */
  const cfg = mosConfig.getMosConfig();
  const mk = (patch) => Object.assign({ id: 'x', brandCode: 'VFIB', domain: '127.0.0.1', method: 'RSS', frequency: 'HOURLY', status: 'ACTIVE' }, patch);
  const rActive = ingest.schedulableReason(mk({}), cfg);
  const rPend = ingest.schedulableReason(mk({ status: 'PENDING_VERIFICATION' }), cfg);
  const rDisabled = ingest.schedulableReason(mk({ status: 'DISABLED' }), cfg);
  const rManualMethod = ingest.schedulableReason(mk({ method: 'MANUAL' }), cfg);
  const rManualFreq = ingest.schedulableReason(mk({ frequency: 'MANUAL' }), cfg);
  const rOffHost = ingest.schedulableReason(mk({ domain: 'evil.example.com' }), cfg);
  ok('SCH-04 可调度判定矩阵：仅 ACTIVE + 非 MANUAL + 白名单内可自动调度',
    rActive === '' && !!rPend && !!rDisabled && !!rManualMethod && !!rManualFreq && !!rOffHost,
    'ACTIVE="' + rActive + '" / 待核验="' + rPend + '" / 停用="' + rDisabled
      + '" / MANUAL方式="' + rManualMethod + '" / MANUAL频率="' + rManualFreq + '" / 白名单外="' + rOffHost + '"');

  /* 3. 真实抓取 + 作业记录 */
  const s1 = addSource(db, { name: '官方来源 S1' });
  const t1 = await scheduler.tick({ now: T0 });
  const jobs1 = db.ingest_jobs.filter((j) => j.sourceId === s1.id);
  const items1 = db.source_items.filter((i) => i.sourceId === s1.id);
  ok('SCH-05 到期来源被真实采集：作业 SUCCEEDED 且条目落库',
    t1.ran === 1 && jobs1.length === 1 && jobs1[0].status === 'SUCCEEDED'
      && jobs1[0].trigger === 'SCHEDULED' && items1.length === 2 && jobs1[0].inserted === 2,
    'ran=' + t1.ran + ' job=' + (jobs1[0] && jobs1[0].status) + ' trigger=' + (jobs1[0] && jobs1[0].trigger)
      + ' inserted=' + (jobs1[0] && jobs1[0].inserted) + ' items=' + items1.length);

  ok('SCH-06 作业记录含开始/结束/耗时/幂等桶键（可审计）',
    !!jobs1[0].startedAt && !!jobs1[0].finishedAt && Number.isFinite(jobs1[0].durationMs)
      && !!jobs1[0].dedupeKey && jobs1[0].dedupeKey.indexOf(s1.id + ':') === 0,
    'dedupeKey=' + jobs1[0].dedupeKey + ' duration=' + jobs1[0].durationMs + 'ms');

  /* 4. 幂等：同桶重复 tick */
  const t2 = await scheduler.tick({ now: T0 + 5 * 1000 });
  const items1b = db.source_items.filter((i) => i.sourceId === s1.id);
  const succ1 = db.ingest_jobs.filter((j) => j.sourceId === s1.id && j.status === 'SUCCEEDED');
  ok('SCH-07 同一调度桶重复巡检：不重复抓取（幂等去重）',
    t2.ran === 0 && items1b.length === 2 && succ1.length === 1,
    'ran=' + t2.ran + ' items=' + items1b.length + ' succeededJobs=' + succ1.length);

  /* 5. 条目级去重：内容有新增时只插入新增条目 */
  feedItems = feedItems.concat([{ title: 'Official notice C', link: 'https://example.test/c', date: '2026-10-03T00:00:00Z', desc: 'C body' }]);
  const t3 = await scheduler.tick({ now: T0 + 61 * MIN });
  const items1c = db.source_items.filter((i) => i.sourceId === s1.id);
  const lastJob = db.ingest_jobs.filter((j) => j.sourceId === s1.id).slice(-1)[0];
  ok('SCH-08 下一周期增量采集：新增 1 条、重复 2 条按 URL/digest 去重',
    t3.ran === 1 && items1c.length === 3 && lastJob.inserted === 1 && lastJob.skipped === 2,
    'items=' + items1c.length + ' inserted=' + lastJob.inserted + ' skipped=' + lastJob.skipped);

  /* 6. 跨重启不补发 */
  store.saveNow();
  const jobsBefore = db.ingest_jobs.length;
  store.reset();                       // 模拟进程重启（内存态丢弃）
  const db2 = store.getDb();           // 重新从磁盘加载
  const jobsAfter = db2.ingest_jobs.length;
  db = db2;                            // 之后所有断言都基于「重启后」的库
  const t4 = await scheduler.tick({ now: T0 + 61 * MIN });   // 同一个时间桶再巡检一次
  ok('SCH-09 进程重启后不凭空补发：作业记录（含桶键）已持久化，同桶仍判定为已执行',
    jobsAfter === jobsBefore && t4.ran === 0,
    'jobs(before/after)=' + jobsBefore + '/' + jobsAfter + ' ran=' + t4.ran);

  /* 7. 瞬时失败 → 指数退避 */
  const s2 = addSource(db, { name: '故障来源 S2', endpoint: 'http://127.0.0.1:' + FEED_PORT + '/boom' });
  const t5 = await scheduler.tick({ now: T0 + 122 * MIN });
  const s2row = db.source_registry.find((x) => x.id === s2.id);
  const s2job = db.ingest_jobs.filter((j) => j.sourceId === s2.id).slice(-1)[0];
  ok('SCH-10 瞬时失败：作业 FAILED + 失败理由 + 退避 nextRunAt + failures 递增',
    s2job.status === 'FAILED' && !!s2job.failureCode && !!s2job.nextRunAt
      && s2row.scheduleFailures === 1 && Number(s2job.backoffMs) > 0,
    'code=' + s2job.failureCode + ' nextRunAt=' + s2job.nextRunAt + ' failures=' + s2row.scheduleFailures
      + ' backoffMs=' + s2job.backoffMs);

  const t6 = await scheduler.tick({ now: T0 + 122 * MIN + 30 * 1000 });
  const s2jobs = db.ingest_jobs.filter((j) => j.sourceId === s2.id);
  ok('SCH-11 退避期内不重试：未到期来源被跳过（避免故障放大）',
    t6.results.filter((r) => r.sourceId === s2.id).length === 0 && s2jobs.length === 1,
    '本轮该来源执行次数=' + t6.results.filter((r) => r.sourceId === s2.id).length + ' jobs=' + s2jobs.length);

  const jobSer = ingest.serializeJob(db2, s2jobs[0]);
  ok('SCH-12 作业序列化如实暴露 retryable/permanent（瞬时失败=true，供运维判断）',
    jobSer.retryable === true && jobSer.permanent === false && jobSer.status === 'FAILED',
    'retryable=' + jobSer.retryable + ' permanent=' + jobSer.permanent
      + ' status=' + jobSer.status + ' code=' + jobSer.failureCode);

  /* 7b. 连续失败达上限 → 停止自动重试（有界，不无限重试） */
  const maxF = mosConfig.getMosConfig().scheduler.maxFailures;
  const rCap = await ingest.runIngest(db, s2, { trigger: 'SCHEDULED', now: T0 + 130 * MIN, dedupeKey: 'cap-1' });
  const s2row2 = db.source_registry.find((x) => x.id === s2.id);
  const s2cap = db.ingest_jobs.filter((j) => j.sourceId === s2.id).slice(-1)[0];
  ok('SCH-13 连续失败达上限后停止自动重试并置 ERROR（重试有界，不无限重试）',
    rCap.retryable === false && s2row2.status === 'ERROR' && s2row2.nextRunAt === null
      && s2cap.retryable === false && /达上限/.test(s2cap.note || ''),
    'maxFailures=' + maxF + ' failures=' + s2row2.scheduleFailures + ' state=' + s2row2.status
      + ' nextRunAt=' + s2row2.nextRunAt + ' retryable=' + s2cap.retryable + ' note=' + s2cap.note);

  const rCap2 = await ingest.runIngest(db, s2, { trigger: 'SCHEDULED', now: T0 + 140 * MIN, dedupeKey: 'cap-2' });
  const s2cap2 = db.ingest_jobs.filter((j) => j.sourceId === s2.id).slice(-1)[0];
  ok('SCH-13b 已熔断来源不再执行采集，且失败码与真实状态一致（SOURCE_ERROR，不误报待核验）',
    rCap2.ok === false && rCap2.status === 'SOURCE_ERROR' && s2cap2.status === 'BLOCKED'
      && s2cap2.failureCode === 'SOURCE_ERROR' && s2cap2.retryable === false,
    'status=' + rCap2.status + ' job=' + s2cap2.status + '/' + s2cap2.failureCode
      + ' retryable=' + s2cap2.retryable);

  /* 8. 永久失败：白名单外域名 */
  const s3 = addSource(db, { name: '白名单外 S3', domain: 'not-allowlisted.example', endpoint: 'https://not-allowlisted.example/feed.xml' });
  const r3 = await ingest.runIngest(db, s3, { trigger: 'SCHEDULED', now: T0 + 183 * MIN, dedupeKey: 'sched-test-s3' });
  const s3row = db.source_registry.find((x) => x.id === s3.id);
  const s3job = db.ingest_jobs.filter((j) => j.sourceId === s3.id).slice(-1)[0];
  ok('SCH-14 永久失败（白名单外）：不自动重试、来源置 ERROR，并如实记录失败码',
    r3.ok === false && r3.status === 'HOST_NOT_ALLOWLISTED' && r3.nextRunAt === null
      && s3row.status === 'ERROR' && s3row.nextRunAt === null && /永久性失败/.test(s3job.note || ''),
    'status=' + r3.status + ' sourceState=' + s3row.status + ' nextRunAt=' + s3row.nextRunAt);

  ok('SCH-15 ERROR 来源不再被自动调度',
    !!ingest.schedulableReason(s3row, cfg),
    'reason=' + ingest.schedulableReason(s3row, cfg));

  /* 9. 单实例锁 */
  db.settings.ingestLock = {
    ownerId: 'other-instance-' + Date.now(), pid: 99999, bootId: 'zzz',
    acquiredAt: new Date().toISOString(), heartbeatAt: new Date().toISOString()
  };
  const t7 = await scheduler.tick({ now: T0 + 244 * MIN });
  ok('SCH-16 单实例限制：检测到他实例新鲜心跳锁 → 本轮拒绝执行并如实上报',
    t7.ran === 0 && t7.codes.indexOf('LOCK_HELD_BY_OTHER_INSTANCE') !== -1,
    'ran=' + t7.ran + ' codes=' + JSON.stringify(t7.codes) + ' msg=' + (t7.message || ''));
  db.settings.ingestLock = null;

  /* 10. fail closed：未核验来源的手工采集 */
  const s4 = addSource(db, { name: '待核验 S4', status: 'PENDING_VERIFICATION' });
  const r4 = await ingest.runIngest(db, s4, { trigger: 'MANUAL', actorId: 'u_test', now: T0 + 245 * MIN });
  const s4job = db.ingest_jobs.filter((j) => j.sourceId === s4.id).slice(-1)[0];
  ok('SCH-17 fail closed：未核验来源的手工采集被阻断并落 BLOCKED 作业（不伪造成功）',
    r4.ok === false && r4.status === 'SOURCE_PENDING_VERIFICATION' && s4job.status === 'BLOCKED'
      && s4job.failureCode === 'SOURCE_PENDING_VERIFICATION',
    'status=' + r4.status + ' job=' + s4job.status + '/' + s4job.failureCode);

  /* 11. MANUAL 频率来源不被调度 */
  const s5 = addSource(db, { name: '人工来源 S5', frequency: 'MANUAL' });
  const due = scheduler.duePreview(T0 + 300 * MIN).find((d) => d.sourceId === s5.id);
  const t8 = await scheduler.tick({ now: T0 + 300 * MIN });
  const s5jobs = db.ingest_jobs.filter((j) => j.sourceId === s5.id);
  ok('SCH-18 MANUAL 频率来源：不在到期预览中、也不会被自动调度',
    due && due.schedulable === false && due.due === false && s5jobs.length === 0,
    'schedulable=' + (due && due.schedulable) + ' due=' + (due && due.due)
      + ' reason=' + (due && due.reason) + ' jobs=' + s5jobs.length);

  /* 12. 退避序列单调 */
  const b1 = ingest.backoffMs(1, 5 * MIN, 6 * 60 * MIN);
  const b2 = ingest.backoffMs(2, 5 * MIN, 6 * 60 * MIN);
  const b3 = ingest.backoffMs(9, 5 * MIN, 6 * 60 * MIN);
  ok('SCH-19 指数退避：递增且被上限封顶',
    b1 === 5 * MIN && b2 === 10 * MIN && b3 === 6 * 60 * MIN,
    'b1=' + b1 + ' b2=' + b2 + ' b9(capped)=' + b3);

  /* 收尾 */
  scheduler.stop();
  try { feedServer.close(); } catch (_) { /* ignore */ }
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'scheduler-result.json'), JSON.stringify({
    suite: 'mos-scheduler',
    phase: 'Phase 3（A-01 轻量来源调度）',
    ranAt: new Date().toISOString(),
    total: cases.length, passed, failed, cases
  }, null, 2), 'utf8');

  console.log('');
  console.log('调度自检结果：' + passed + '/' + cases.length + ' 通过');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('调度自检异常：' + (err && err.stack ? err.stack : err));
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(1);
});
