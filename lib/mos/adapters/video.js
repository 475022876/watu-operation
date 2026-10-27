'use strict';
/**
 * VideoProvider —— 真实 AI 视频生成适配器（V0.1.4）。
 *
 * 能力边界（必须诚实）：
 *  - **实现了**：异步任务式接入（提交 → 轮询 → 下载），支持 OpenAI Sora 兼容端点与自定义端点模板。
 *  - **未实现**：本地渲染、剪辑、配音、字幕烧录。这些仍由「视频工作区」的手工流程承担。
 *  - 未配置时一律 `NOT_CONFIGURED`，**不生成任何占位视频**，也不把手工上传的成片说成 AI 生成。
 *
 * 为什么是异步：视频生成通常 30 秒到数分钟，同步 HTTP 请求会超时并被重复计费。
 * 因此本模块只做单步操作（start / check / download），轮询节奏由调用方控制（有上限）。
 *
 * 安全：与文本通道同一条链——分级闸门 → 预算预检 → 端点校验 → 有界重试 → 账本留痕。
 */
const fs = require('node:fs');
const path = require('node:path');
const { PATHS } = require('../../config');
const pc = require('../providercontract');
const provideradmin = require('../provideradmin');
const providerlog = require('../providerlog');
const egress = require('../egress');

const MAX_VIDEO_BYTES = 120 * 1024 * 1024;

function normalize(res, extra) {
  const r = Object.assign({}, res || {});
  const e = extra || {};
  r.errorCode = e.errorCode || r.errorCode || '';
  /* extra.rawStatus 必须落到结果上：本模块大量失败分支把状态放在 extra 里，
   * 之前漏了这一步，导致这些分支的 rawStatus 恒为空（调用方无法区分失败原因）。 */
  if (e.rawStatus) r.rawStatus = e.rawStatus;
  r.retryable = r.errorCode ? pc.isRetryable(r.errorCode) : false;
  r.rateLimit = e.rateLimit || r.rateLimit || pc.parseRateLimit(null);
  r.costReceipt = e.costReceipt || r.costReceipt || pc.costReceipt(null);
  r.attempts = Number(e.attempts || r.attempts || 1) || 1;
  return r;
}

/** 离线状态：供 UI 与集成矩阵使用；绝不出站 */
function status() {
  const p = pc.providerConfig('video');
  const rd = provideradmin.readinessOf('video');
  const caps = ['SCRIPT', 'STORYBOARD', 'KEYFRAME', 'ASSET_UPLOAD', 'FINAL_CUT_UPLOAD'];
  /* 只有真的配置了供应商，才声明具备 AI 渲染能力；否则 UI 不得出现"AI 生成视频"按钮 */
  if (p.mode && p.mode !== 'none') caps.unshift('AI_RENDER');
  return {
    provider: 'mos.video',
    mode: p.mode,
    model: p.model,
    configured: p.mode !== 'none' && !!p.mode,
    implemented: true,
    readiness: rd.readiness,
    readinessReason: rd.reason,
    manualWorkflow: true,
    hasServerKey: p.hasServerKey,
    timeoutMs: p.timeoutMs,
    maxRetries: p.maxRetries,
    pollIntervalMs: provideradmin.effective('video').pollIntervalMs,
    maxPollMs: provideradmin.effective('video').maxPollMs,
    capabilities: caps,
    note: rd.reason + (p.mode === 'none'
      ? ' 当前只提供脚本/分镜/关键帧/成片上传的手工流程。'
      : ' AI 成片需真实调用，按次计费，须人工在任务内确认后发起。')
  };
}

async function health() {
  return pc.healthOf(pc.providerConfig('video'), { supportsLiveProbe: false });
}

function defaultBaseUrl(mode) {
  if (mode === 'openai') return 'https://api.openai.com/v1';
  if (mode === 'volcengine') return 'https://ark.cn-beijing.volces.com/api/v3';
  return '';
}

/** 火山方舟：把像素尺寸换算成它要求的 ratio 枚举（它不接受 1024x1024 这类字面值） */
function ratioOf(size) {
  const s = String(size || '').trim();
  if (/^(adaptive|16:9|9:16|1:1|4:3|3:4|21:9)$/.test(s)) return s;
  const m = /^(\d{2,5})\s*[xX*]\s*(\d{2,5})$/.exec(s);
  if (!m) return '16:9';
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return '16:9';
  const r = w / h;
  if (Math.abs(r - 1) < 0.02) return '1:1';
  if (Math.abs(r - 16 / 9) < 0.05) return '16:9';
  if (Math.abs(r - 9 / 16) < 0.05) return '9:16';
  if (Math.abs(r - 4 / 3) < 0.05) return '4:3';
  if (Math.abs(r - 3 / 4) < 0.05) return '3:4';
  return r > 1 ? '16:9' : '9:16';
}

function isVolc(p) {
  return String(p && p.mode) === 'volcengine';
}

/** 从供应商状态响应里取成片地址（火山方舟 content.video_url；兼容几种常见形状） */
function extractVideoUrl(json) {
  if (!json || typeof json !== 'object') return '';
  const cands = [
    json.video_url,
    json.videoUrl,
    (json.content && (json.content.video_url || json.content.videoUrl)),
    (json.data && (json.data.video_url || (json.data.task_result && json.data.task_result.videos
      && json.data.task_result.videos[0] && json.data.task_result.videos[0].url))),
    (json.output && (json.output.video_url || json.output.videoUrl))
  ];
  for (const c of cands) {
    const s = String(c || '').trim();
    if (/^https?:\/\//i.test(s)) return s;
  }
  return '';
}

function headersOf(p) {
  const h = { 'Content-Type': 'application/json' };
  if (p.apiKey) {
    if (p.mode === 'openai') h.Authorization = 'Bearer ' + p.apiKey;
    else h.Authorization = 'Bearer ' + p.apiKey;
  }
  return h;
}

function pickString(v, dflt, max) {
  const s = String(v === undefined || v === null ? '' : v).trim();
  return (s || dflt || '').slice(0, max || 2000);
}

function guard(p, text, opts) {
  const opts2 = opts || {};
  const cls = egress.classify(text, opts2.dataClass);
  egress.assertDataPolicy(cls, egress.dataPolicy(provideradmin.policy()));
  const check = provideradmin.checkBudget({ kind: 'video', estimateUsd: opts2.estimateUsd, brandCode: opts2.brandCode });
  if (!check.ok) {
    const err = new Error(check.note);
    err.code = pc.ERROR_CODES.BUDGET_EXCEEDED;
    err.status = 402;
    throw err;
  }
  return cls;
}

function baseOf(p) {
  return String(p.baseUrl || defaultBaseUrl(p.mode)).replace(/\/+$/, '');
}

function pathOf(p, key, fallback) {
  const e = provideradmin.effective('video');
  const v = String(e[key] || '').trim();
  return v || fallback;
}

/**
 * 提交一次生成任务。
 * @param {{prompt:string, durationSec?:number, size?:string, model?:string, brandCode?:string, actorId?:string}} req
 * @returns {Promise<{state:string, providerJobId?:string, statusRaw?:string, note?:string}>}
 */
async function start(req) {
  const r = req || {};
  const p = pc.providerConfig('video');
  if (!p.mode || p.mode === 'none') {
    return normalize({
      state: 'NOT_CONFIGURED', providerJobId: '', provider: 'none',
      note: '尚未接入视频生成供应商：请使用脚本/分镜/关键帧/成片上传的手工流程，或在「系统接入」页完成配置。'
    }, { errorCode: pc.ERROR_CODES.NOT_CONFIGURED, rawStatus: 'NOT_CONFIGURED' });
  }
  if (!p.hasServerKey) {
    return normalize({
      state: 'NOT_CONFIGURED', providerJobId: '', provider: p.mode,
      note: '已选择视频供应商但未配置密钥 → 不提交任何任务（绝不伪造成片）。'
    }, { errorCode: pc.ERROR_CODES.NOT_CONFIGURED, rawStatus: 'NOT_CONFIGURED' });
  }

  const prompt = pickString(r.prompt, '', 4000);
  if (!prompt) {
    return normalize({ state: 'FAILED', provider: p.mode, note: '缺少画面描述（prompt）' },
      { errorCode: pc.ERROR_CODES.BAD_REQUEST, rawStatus: 'BAD_REQUEST' });
  }

  const eff = provideradmin.effective('video');
  let cls;
  try {
    cls = guard(p, prompt, { dataClass: r.dataClass, brandCode: r.brandCode });
  } catch (err) {
    providerlog.record({
      kind: 'video', op: 'start', provider: p.mode, model: p.model || eff.model,
      state: 'BLOCKED', errorCode: err.code === pc.ERROR_CODES.BUDGET_EXCEEDED
        ? pc.ERROR_CODES.BUDGET_EXCEEDED : pc.ERROR_CODES.BLOCKED_DATA_CLASS,
      actorId: r.actorId, brandCode: r.brandCode, dataClass: (err.detail && err.detail.dataClass) || '',
      note: 'kf=' + p.keyFingerprint + ' ' + String(err.message || err)
    });
    return normalize({ state: 'BLOCKED', provider: p.mode, note: String(err.message || err) },
      { errorCode: err.code || pc.ERROR_CODES.BLOCKED_DATA_CLASS, rawStatus: 'BLOCKED' });
  }

  const base = baseOf(p);
  const createPath = pathOf(p, 'createPath', isVolc(p) ? '/contents/generations/tasks' : '/videos');
  let url = base + createPath;
  if (p.mode === 'openai') url = base + '/videos';

  try { await egress.assertProviderUrl(url); } catch (err) {
    return normalize({ state: 'BLOCKED', provider: p.mode, note: '端点未通过出站校验：' + String(err.message || err) },
      { errorCode: 'PROVIDER_EGRESS_BLOCKED', rawStatus: 'BLOCKED' });
  }

  const dur = Math.min(Math.max(Number(r.durationSec) || eff.durationSec || 4, 1), 60);
  const body = p.mode === 'openai'
    ? {
      model: r.model || eff.model || 'sora-2',
      prompt,
      seconds: dur
    }
    : (isVolc(p)
      ? {
        /* 火山方舟：提示词放在 content 数组里，时长是 duration，尺寸是 ratio 枚举 */
        model: r.model || eff.model || 'doubao-seedance-2-0-mini',
        content: [{ type: 'text', text: prompt }],
        duration: dur,
        ratio: ratioOf(r.size),
        watermark: false
      }
      : {
        model: r.model || eff.model || undefined,
        prompt,
        duration: dur,
        size: r.size || undefined
      });

  const t0 = Date.now();
  const result = await pc.withRetry(async (attempt) => {
    try {
      const res = await pc.fetchWithTimeout(url, {
        method: 'POST', headers: headersOf(p), body: JSON.stringify(body)
      }, p.timeoutMs);
      const raw = await res.text();
      let json = null;
      try { json = JSON.parse(raw); } catch (_) { /* ignore */ }
      const rateLimit = pc.parseRateLimit(res.headers);
      if (!res.ok) {
        return normalize({
          state: 'FAILED', provider: p.mode,
          note: '供应商返回失败（HTTP ' + res.status + '）：' + '上游错误正文已隐藏'
        }, { errorCode: pc.classifyHttp(res.status), rateLimit, rawStatus: 'HTTP_' + res.status, attempts: attempt });
      }
      const id = String((json && (json.id || json.task_id || json.taskId || (json.data && json.data.id))) || '');
      if (!id) {
        return normalize({ state: 'FAILED', provider: p.mode, note: '供应商未返回任务 id，无法轮询（原始响应前 200 字：' + '响应正文已隐藏' + '）' },
          { errorCode: pc.ERROR_CODES.EMPTY_RESPONSE, rateLimit, rawStatus: 'NO_JOB_ID', attempts: attempt });
      }
      return normalize({
        state: 'SUCCEEDED', provider: p.mode, providerJobId: id,
        statusRaw: String((json && (json.status || json.state)) || 'submitted'),
        usage: { providerJobId: id, promptChars: prompt.length },
        billing: { amount: null, currency: '', confirmed: false },
        note: '任务已提交，等待供应商生成（状态需轮询确认）。'
      }, { rateLimit, costReceipt: pc.costReceipt(json), rawStatus: 'HTTP_' + res.status, attempts: attempt });
    } catch (err) {
      const code = pc.classifyError(err);
      return normalize({ state: 'FAILED', provider: p.mode, note: String((err && err.message) || err).slice(0, 200) },
        { errorCode: code, rawStatus: code, attempts: attempt });
    }
  }, { maxRetries: p.maxRetries });

  providerlog.record({
    kind: 'video', op: 'start', provider: p.mode, model: body.model || '',
    state: result.state, errorCode: result.errorCode, retryable: result.retryable,
    latencyMs: Date.now() - t0, attempts: result.attempts, usage: result.usage,
    cost: result.costReceipt, actorId: r.actorId, brandCode: r.brandCode,
    dataClass: cls.dataClass, note: 'kf=' + p.keyFingerprint + ' ' + String(result.note || '').slice(0, 160)
  });
  return result;
}

/**
 * 查询任务状态。
 * @param {string} jobId 供应商任务 id
 * @returns {Promise<{state:'PENDING'|'SUCCEEDED'|'FAILED'|'NOT_CONFIGURED', statusRaw?:string, progress?:number}>}
 */
async function check(jobId) {
  const p = pc.providerConfig('video');
  if (!p.mode || p.mode === 'none' || !p.hasServerKey) {
    return normalize({ state: 'NOT_CONFIGURED', provider: p.mode || 'none', note: '视频供应商未配置' },
      { errorCode: pc.ERROR_CODES.NOT_CONFIGURED, rawStatus: 'NOT_CONFIGURED' });
  }
  const id = String(jobId || '').trim();
  if (!id) return normalize({ state: 'FAILED', provider: p.mode, note: '缺少任务 id' },
    { errorCode: pc.ERROR_CODES.BAD_REQUEST, rawStatus: 'BAD_REQUEST' });

  const base = baseOf(p);
  const tpl = pathOf(p, 'statusPath', isVolc(p) ? '/contents/generations/tasks/{id}' : '/videos/{id}');
  const url = base + tpl.replace(/\{id\}/g, encodeURIComponent(id));

  try { await egress.assertProviderUrl(url); } catch (err) {
    return normalize({ state: 'FAILED', provider: p.mode, note: '端点未通过出站校验：' + String(err.message || err) },
      { errorCode: 'PROVIDER_EGRESS_BLOCKED', rawStatus: 'BLOCKED' });
  }

  try {
    const res = await pc.fetchWithTimeout(url, { method: 'GET', headers: headersOf(p) }, p.timeoutMs);
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch (_) { /* ignore */ }
    if (!res.ok) {
      return normalize({ state: 'FAILED', provider: p.mode, note: '查询失败（HTTP ' + res.status + '）：' + '响应正文已隐藏' },
        { errorCode: pc.classifyHttp(res.status), rawStatus: 'HTTP_' + res.status });
    }
    const statusRaw = String((json && (json.status || json.state || (json.data && json.data.status))) || '').toLowerCase();
    const progress = Number((json && (json.progress !== undefined ? json.progress : (json.data && json.data.progress))) || 0);
    if (/fail|error|cancel|expired/.test(statusRaw)) {
      return normalize({ state: 'FAILED', provider: p.mode, statusRaw, progress,
        note: '供应商报告任务失败：' + '上游失败详情已隐藏' },
      { errorCode: pc.ERROR_CODES.HTTP_ERROR, rawStatus: 'PROVIDER_FAILED' });
    }
    if (/complete|succeed|success|done/.test(statusRaw)) {
      const videoUrl = extractVideoUrl(json);
      return normalize({ state: 'SUCCEEDED', provider: p.mode, statusRaw, progress: 100,
        videoUrl,
        usage: { providerJobId: id }, billing: { amount: null, currency: '', confirmed: false },
        note: videoUrl
          ? '生成完成，可从供应商地址下载成片（链接有时效，请立即下载）。'
          : '生成完成，但响应中未包含成片地址；若该供应商需要二进制下载端点，请确认 contentPath 配置。' },
      { rawStatus: 'COMPLETED' });
    }
    return normalize({ state: 'PENDING', provider: p.mode, statusRaw: statusRaw || 'queued', progress,
      note: '生成中：' + (statusRaw || 'queued') + '（' + progress + '%）' }, { rawStatus: 'PENDING' });
  } catch (err) {
    const code = pc.classifyError(err);
    return normalize({ state: 'FAILED', provider: p.mode, note: String((err && err.message) || err).slice(0, 200) },
      { errorCode: code, rawStatus: code });
  }
}

/**
 * 下载成片到本地上传目录。
 * 只在 check() 返回 SUCCEEDED 后调用；**不自动重试**（避免重复下载大文件）。
 * @returns {Promise<{state:string, filePath?:string, bytes?:number, note?:string}>}
 */
async function download(jobId, opts) {
  const p = pc.providerConfig('video');
  const o = opts || {};
  if (!p.mode || p.mode === 'none' || !p.hasServerKey) {
    return normalize({ state: 'NOT_CONFIGURED', provider: p.mode || 'none', note: '视频供应商未配置' },
      { errorCode: pc.ERROR_CODES.NOT_CONFIGURED, rawStatus: 'NOT_CONFIGURED' });
  }
  const id = String(jobId || '').trim();
  const base = baseOf(p);

  /* 两种下载范式：
   *  - OpenAI Sora 类：GET {contentPath} 直接返回 MP4 二进制；
   *  - 火山方舟类：**没有二进制端点**，只在状态响应里给 24 小时有效的 content.video_url。
   *    因此先查一次状态拿地址，再对该地址发起受同样出站校验约束的 GET。
   *    （这一次额外查询是真实发生的，会如实进账本，不隐藏。） */
  let url = '';
  if (isVolc(p)) {
    const st = await check(id);
    if (st.state !== 'SUCCEEDED' || !st.videoUrl) {
      return normalize({
        state: 'FAILED', provider: p.mode,
        note: st.state === 'SUCCEEDED'
          ? '任务已完成但响应未包含成片地址，无法下载（请确认该供应商的返回字段）。'
          : '任务尚未完成，拒绝下载（当前状态：' + (st.statusRaw || st.state) + '）。'
      }, { errorCode: st.errorCode || pc.ERROR_CODES.BAD_REQUEST, rawStatus: 'NOT_READY' });
    }
    url = String(o.videoUrl || st.videoUrl);
  } else {
    const tpl = pathOf(p, 'contentPath', '/videos/{id}/content');
    url = base + tpl.replace(/\{id\}/g, encodeURIComponent(id));
  }

  try { await egress.assertProviderUrl(url); } catch (err) {
    return normalize({ state: 'FAILED', provider: p.mode, note: '下载地址未通过出站校验：' + String(err.message || err) },
      { errorCode: 'PROVIDER_EGRESS_BLOCKED', rawStatus: 'BLOCKED' });
  }

  try {
    const res = await pc.fetchWithTimeout(url, { method: 'GET', headers: headersOf(p), maxResponseBytes: 120 * 1024 * 1024 }, Math.max(p.timeoutMs, 120000));
    if (!res.ok) {
      return normalize({ state: 'FAILED', provider: p.mode, note: '下载失败（HTTP ' + res.status + '）' },
        { errorCode: pc.classifyHttp(res.status), rawStatus: 'HTTP_' + res.status });
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) {
      return normalize({ state: 'FAILED', provider: p.mode, note: '下载内容为空' },
        { errorCode: pc.ERROR_CODES.EMPTY_RESPONSE, rawStatus: 'EMPTY' });
    }
    if (buf.length > MAX_VIDEO_BYTES) {
      return normalize({ state: 'FAILED', provider: p.mode, note: '成片超过本地保存上限（120MB）' },
        { errorCode: pc.ERROR_CODES.BAD_REQUEST, rawStatus: 'TOO_LARGE' });
    }
    const dir = path.join(PATHS.uploadDir, 'generated');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'AI-VIDEO-' + String(o.brandCode || 'GEN') + '-' + Date.now() + '.mp4');
    fs.writeFileSync(file, buf);
    providerlog.record({
      kind: 'video', op: 'download', provider: p.mode, model: p.model,
      state: 'SUCCEEDED', latencyMs: 0, attempts: 1, actorId: o.actorId, brandCode: o.brandCode,
      note: 'kf=' + p.keyFingerprint + ' bytes=' + buf.length + ' job=' + id
    });
    return normalize({
      state: 'SUCCEEDED', provider: p.mode, filePath: file, bytes: buf.length,
      mime: String(res.headers.get('content-type') || 'video/mp4').split(';')[0],
      note: '成片已保存到本地上传目录；是否采用仍需人工预览与审核。'
    }, { rawStatus: 'HTTP_200' });
  } catch (err) {
    const code = pc.classifyError(err);
    return normalize({ state: 'FAILED', provider: p.mode, note: String((err && err.message) || err).slice(0, 200) },
      { errorCode: code, rawStatus: code });
  }
}

async function invoke(req) {
  const r = req || {};
  const op = String(r.op || 'start').toLowerCase();
  if (op === 'start' || op === 'submit') return start(r);
  if (op === 'check' || op === 'poll') return check(r.jobId || r.id);
  if (op === 'download') return download(r.jobId || r.id, r);
  return normalize({ state: 'FAILED', provider: pc.providerConfig('video').mode, note: '未知的 invoke.op：' + op },
    { errorCode: pc.ERROR_CODES.UNKNOWN_MODE, rawStatus: 'UNKNOWN_OP' });
}

module.exports = {
  PROVIDER_ID: 'mos.video', MAX_VIDEO_BYTES,
  status, health, start, check, download, invoke,
  _headersOf: headersOf
};
