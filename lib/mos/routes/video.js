'use strict';
/**
 * Marketing OS —— Video Workspace（W04-03 / 04 §2 视频首期范围）。
 *
 * 首期**只做**：Brief、脚本、分镜（shots）、字幕、关键帧资产引用、成片上传。
 * 明确**不做**（04 §2）：全自动视频渲染、自动配音、自动剪辑。
 *
 * 字典合规：视频类型 F01–F04、Motion Identity M01–M05 必须为字典值，
 * 未核验条目在 UI 显示为「待核验」，不臆造正式名称（10 §1）。
 */
const { get, put, post } = require('../router');
const { getDb, save } = require('../store');
const { httpError } = require('../../util');
const { dictValid, VIDEO_ARTIFACT_STATES } = require('../dict');
const rbac = require('../rbac');
const { appendAudit } = require('../audit');
const { uid } = require('../ids');
const helpers = require('./helpers');

/** 由已有内容推导「已推进到哪一步」，避免出现与实际不符的状态标签 */
function deriveState(a) {
  if (a.finalAssetId) return 'FINAL_UPLOADED';
  if ((a.subtitles || []).length) return 'SUBTITLE';
  if ((a.storyboard || []).length) return 'STORYBOARD';
  if ((a.script && (a.script.sections || []).length)) return 'SCRIPT';
  return 'BRIEF';
}

function blank(task) {
  return {
    id: uid('va'),
    brandCode: task.brandCode,
    taskId: task.id,
    videoType: 'F03',                 // 默认 Explainer（主控明示的 F03）
    motionCode: 'M01',
    brief: '',
    script: { sections: [] },
    storyboard: [],
    subtitles: [],
    keyframeAssetIds: [],
    finalAssetId: null,
    state: 'BRIEF',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    rowVersion: 1
  };
}

function serialize(db, a) {
  const assets = (a.keyframeAssetIds || []).map((id) => {
    const x = db.working_assets.find((y) => y.id === id);
    return x ? { id: x.id, fileName: x.fileName, mime: x.mime, mock: !!x.mock } : { id, missing: true };
  });
  const fin = a.finalAssetId ? db.working_assets.find((y) => y.id === a.finalAssetId) : null;
  return {
    id: a.id, brandCode: a.brandCode, taskId: a.taskId,
    videoType: a.videoType, motionCode: a.motionCode,
    brief: a.brief || '',
    script: a.script || { sections: [] },
    storyboard: a.storyboard || [],
    subtitles: a.subtitles || [],
    keyframeAssetIds: (a.keyframeAssetIds || []).slice(),
    keyframeAssets: assets,
    finalAssetId: a.finalAssetId || null,
    finalAsset: fin ? { id: fin.id, fileName: fin.fileName, mime: fin.mime, bytes: fin.bytes, mock: !!fin.mock } : null,
    state: a.state,
    stages: VIDEO_ARTIFACT_STATES,
    note: '首期仅支持 Brief / 脚本 / 分镜 / 字幕 / 关键帧与成片上传；不提供自动渲染（04 §2）。',
    createdAt: a.createdAt, updatedAt: a.updatedAt, rowVersion: a.rowVersion || 1
  };
}

function loadOrCreate(db, taskId, principal) {
  const task = db.content_tasks.find((t) => t.id === taskId);
  if (!task) throw httpError(404, '内容任务不存在', 'TASK_NOT_FOUND');
  rbac.assertBrand(principal, task.brandCode);
  let a = db.video_artifacts.find((x) => x.taskId === taskId);
  if (!a) {
    a = blank(task);
    db.video_artifacts.push(a);
    save();
    appendAudit({ actorId: principal.id, brandCode: task.brandCode, eventType: 'video_artifact.created',
      objectType: 'video_artifact', objectId: a.id, newState: 'BRIEF', metadata: { taskCode: task.code } });
  }
  return { task, a };
}

get('/api/mos/video/:taskId', async (ctx) => {
  const db = getDb();
  const { task, a } = loadOrCreate(db, ctx.params.taskId, ctx.principal);
  return { ok: true, task: { id: task.id, code: task.code, title: task.title, platform: task.platform, riskGrade: task.riskGrade },
    video: serialize(db, a) };
});

put('/api/mos/video/:taskId', async (ctx) => {
  const db = getDb();
  const { task, a } = loadOrCreate(db, ctx.params.taskId, ctx.principal);
  rbac.assertCan(ctx.principal, 'content.edit', task.brandCode, { ip: ctx.ip, objectType: 'video_artifact', objectId: a.id });

  const body = ctx.body || {};
  const patch = {};

  if (body.videoType !== undefined) {
    const v = String(body.videoType).toUpperCase();
    if (!dictValid('videoTypes', v)) throw httpError(400, '视频类型非法（F01–F04）', 'BAD_VIDEO_TYPE');
    patch.videoType = v;
  }
  if (body.motionCode !== undefined) {
    const v = String(body.motionCode).toUpperCase();
    if (!dictValid('motions', v)) throw httpError(400, 'Motion Identity 非法（M01–M05）', 'BAD_MOTION');
    patch.motionCode = v;
  }
  if (body.brief !== undefined) patch.brief = String(body.brief).slice(0, 8000);

  if (body.script !== undefined) {
    const s = body.script || {};
    const sections = Array.isArray(s.sections) ? s.sections : [];
    if (sections.length > 60) throw httpError(400, '脚本分节过多', 'TOO_MANY_SECTIONS');
    patch.script = {
      sections: sections.map((x) => ({
        heading: String((x && x.heading) || '').slice(0, 200),
        content: String((x && x.content) || '').slice(0, 4000),
        durationSec: Number((x && x.durationSec) || 0) || 0
      }))
    };
  }

  if (body.storyboard !== undefined) {
    if (!Array.isArray(body.storyboard)) throw httpError(400, 'storyboard 必须是数组', 'BAD_FIELD');
    if (body.storyboard.length > 120) throw httpError(400, '分镜数量过多', 'TOO_MANY_SHOTS');
    patch.storyboard = body.storyboard.map((s, i) => {
      const keyframeAssetId = s && s.keyframeAssetId ? String(s.keyframeAssetId) : null;
      if (keyframeAssetId) {
        const asset = db.working_assets.find((x) => x.id === keyframeAssetId);
        if (!asset) throw httpError(400, '关键帧引用的素材不存在：' + keyframeAssetId, 'BAD_REFERENCE');
        rbac.assertSameBrand(asset.brandCode, task.brandCode);
      }
      const motionCode = s && s.motionCode ? String(s.motionCode).toUpperCase() : (a.motionCode || 'M01');
      if (!dictValid('motions', motionCode)) throw httpError(400, '分镜 Motion Identity 非法', 'BAD_MOTION');
      return {
        shot: Number((s && s.shot) || i + 1),
        description: String((s && s.description) || '').slice(0, 1000),
        durationSec: Number((s && s.durationSec) || 0) || 0,
        motionCode,
        keyframeAssetId
      };
    });
  }

  if (body.subtitles !== undefined) {
    if (!Array.isArray(body.subtitles)) throw httpError(400, 'subtitles 必须是数组', 'BAD_FIELD');
    if (body.subtitles.length > 500) throw httpError(400, '字幕条数过多', 'TOO_MANY_SUBS');
    let lastEnd = -1;
    patch.subtitles = body.subtitles.map((s, i) => {
      const start = Number((s && s.start) || 0) || 0;
      const end = Number((s && s.end) || 0) || 0;
      if (end < start) throw httpError(400, '第 ' + (i + 1) + ' 条字幕结束时间早于开始时间', 'BAD_SUBTITLE');
      if (start < lastEnd) throw httpError(400, '第 ' + (i + 1) + ' 条字幕与上一条时间重叠', 'BAD_SUBTITLE');
      lastEnd = end;
      return { start, end, text: String((s && s.text) || '').slice(0, 500) };
    });
  }

  if (body.keyframeAssetIds !== undefined) {
    if (!Array.isArray(body.keyframeAssetIds)) throw httpError(400, 'keyframeAssetIds 必须是数组', 'BAD_FIELD');
    const list = Array.from(new Set(body.keyframeAssetIds.map(String))).slice(0, 60);
    for (const id of list) {
      const asset = db.working_assets.find((x) => x.id === id);
      if (!asset) throw httpError(400, '关键帧素材不存在：' + id, 'BAD_REFERENCE');
      rbac.assertSameBrand(asset.brandCode, task.brandCode);
    }
    patch.keyframeAssetIds = list;
  }

  if (body.finalAssetId !== undefined) {
    const id = body.finalAssetId ? String(body.finalAssetId) : null;
    if (id) {
      const asset = db.working_assets.find((x) => x.id === id);
      if (!asset) throw httpError(400, '成片素材不存在', 'BAD_REFERENCE');
      rbac.assertSameBrand(asset.brandCode, task.brandCode);
    }
    patch.finalAssetId = id;
  }

  const changed = helpers.applyUpdate(a, patch, ctx.user.id, body.rowVersion);
  const nextState = deriveState(a);
  if (nextState !== a.state) {
    a.state = nextState;
    const idx = VIDEO_ARTIFACT_STATES.indexOf(nextState);
    if (idx === -1) throw httpError(500, '视频状态推导异常', 'INTERNAL_STATE');
  }
  if (changed || nextState) {
    save();
    if (changed) {
      appendAudit({ actorId: ctx.user.id, brandCode: task.brandCode, eventType: 'video_artifact.updated',
        objectType: 'video_artifact', objectId: a.id, newState: a.state, ip: ctx.ip,
        metadata: { fields: Object.keys(patch), shots: (a.storyboard || []).length, subtitles: (a.subtitles || []).length } });
    }
  }
  return { ok: true, video: serialize(db, a), changed };
});

/* ==================== V0.1.4：AI 成片（真实异步任务） ====================
 *
 * 只有在「系统接入」页配置了真实视频供应商时才会真正出站；未配置时
 * `POST /api/mos/video-renders` 明确返回 NOT_CONFIGURED，**绝不产出占位成片**。
 * 手工流程（脚本/分镜/关键帧/上传）始终可用，与此功能互不影响。
 */

const videoProvider = require('../adapters/video');

function serializeRender(j) {
  return {
    id: j.id, brandCode: j.brandCode, taskId: j.taskId,
    status: j.status, statusRaw: j.statusRaw || '', progress: j.progress || 0,
    provider: j.provider || '', model: j.model || '',
    prompt: String(j.prompt || '').slice(0, 500),
    durationSec: j.durationSec || null,
    providerJobId: j.providerJobId || '',
    filePath: j.filePath || '', bytes: j.bytes || 0,
    errorCode: j.errorCode || '', note: j.note || '',
    createdAt: j.createdAt, updatedAt: j.updatedAt,
    actorId: j.actorId || ''
  };
}

post('/api/mos/video-renders', async (ctx) => {
  const brandCode = ctx.query.brand ? String(ctx.query.brand).toUpperCase() : '';
  rbac.assertBrand(ctx.principal, brandCode);
  rbac.assertCan(ctx.principal, 'model.invoke', brandCode, { objectType: 'video_render', scene: 'video.ai_render', ip: ctx.ip });

  const db = getDb();
  const body = ctx.body || {};
  const task = db.content_tasks.find((x) => x.id === String(body.taskId || ''));
  if (!task) throw httpError(404, '任务不存在', 'TASK_NOT_FOUND');
  rbac.assertSameBrand(task.brandCode, brandCode);

  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw httpError(400, '请填写画面描述', 'BAD_REQUEST');

  const now = new Date().toISOString();
  const job = {
    id: uid('vrj'), brandCode, taskId: task.id,
    prompt: prompt.slice(0, 4000),
    durationSec: Math.min(Math.max(Number(body.durationSec) || 4, 1), 60),
    size: String(body.size || '') || undefined,
    status: 'SUBMITTING', statusRaw: '', progress: 0,
    provider: '', model: '', providerJobId: '',
    filePath: '', bytes: 0, errorCode: '', note: '',
    actorId: ctx.user ? ctx.user.id : '', createdAt: now, updatedAt: now
  };
  if (!Array.isArray(db.video_render_jobs)) db.video_render_jobs = [];
  db.video_render_jobs.push(job);
  save();

  const r = await videoProvider.start({
    prompt: job.prompt, durationSec: job.durationSec, size: job.size,
    brandCode, actorId: job.actorId
  });

  if (r.state !== 'SUCCEEDED') {
    job.status = r.state === 'BLOCKED' ? 'BLOCKED'
      : (r.state === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'FAILED');
    job.errorCode = r.errorCode || '';
    job.note = String(r.note || '').slice(0, 400);
    job.updatedAt = new Date().toISOString();
    save();
    appendAudit({ actorId: job.actorId, brandCode, eventType: 'video.render.' + job.status.toLowerCase(),
      objectType: 'video_render', objectId: job.id, outcome: job.status === 'BLOCKED' ? 'denied' : 'failed',
      ip: ctx.ip, metadata: { errorCode: job.errorCode, note: job.note.slice(0, 160) } });
    /* 未配置/被拦截不是服务器错误：返回 200 + 明确状态，让前端显示可操作提示 */
    return { ok: false, state: r.state, code: r.errorCode || '', note: job.note, render: serializeRender(job) };
  }

  job.status = 'PENDING';
  job.providerJobId = r.providerJobId || '';
  job.provider = r.provider || '';
  job.statusRaw = r.statusRaw || 'submitted';
  job.note = String(r.note || '');
  job.updatedAt = new Date().toISOString();
  save();
  appendAudit({ actorId: job.actorId, brandCode, eventType: 'video.render.submitted',
    objectType: 'video_render', objectId: job.id, ip: ctx.ip,
    metadata: { provider: job.provider, providerJobId: job.providerJobId.slice(0, 80) } });
  return { ok: true, render: serializeRender(job) };
});

get('/api/mos/video-renders/:id', async (ctx) => {
  const db = getDb();
  const job = (db.video_render_jobs || []).find((x) => x.id === String(ctx.params.id || ''));
  if (!job) throw httpError(404, '渲染作业不存在', 'RENDER_NOT_FOUND');
  rbac.assertBrand(ctx.principal, job.brandCode);

  /* 已终结的状态不再向供应商查询，避免无意义出站与计费 */
  if (['COMPLETED', 'FAILED', 'BLOCKED', 'NOT_CONFIGURED'].indexOf(job.status) === -1 && job.providerJobId) {
    const st = await videoProvider.check(job.providerJobId);
    job.statusRaw = st.statusRaw || job.statusRaw;
    job.progress = st.progress || job.progress;
    if (st.state === 'SUCCEEDED') {
      const dl = await videoProvider.download(job.providerJobId, { brandCode: job.brandCode, actorId: job.actorId });
      if (dl.state === 'SUCCEEDED') {
        job.status = 'COMPLETED';
        job.filePath = dl.filePath;
        job.bytes = dl.bytes;
        job.progress = 100;
        job.note = dl.note || '';
      } else {
        job.status = 'FAILED';
        job.errorCode = dl.errorCode || '';
        job.note = String(dl.note || '').slice(0, 400);
      }
    } else if (st.state === 'FAILED') {
      job.status = 'FAILED';
      job.errorCode = st.errorCode || '';
      job.note = String(st.note || '').slice(0, 400);
    } else {
      job.status = 'PENDING';
      job.note = String(st.note || '');
    }
    job.updatedAt = new Date().toISOString();
    save();
    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
      appendAudit({ actorId: job.actorId, brandCode: job.brandCode,
        eventType: 'video.render.' + (job.status === 'COMPLETED' ? 'completed' : 'failed'),
        objectType: 'video_render', objectId: job.id, outcome: job.status === 'COMPLETED' ? 'success' : 'failed',
        ip: ctx.ip, metadata: { bytes: job.bytes || 0, errorCode: job.errorCode || '' } });
    }
  }
  return { ok: true, render: serializeRender(job) };
});

get('/api/mos/video-renders', async (ctx) => {
  const brandCode = ctx.query.brand ? String(ctx.query.brand).toUpperCase() : '';
  rbac.assertBrand(ctx.principal, brandCode);
  const db = getDb();
  const items = (db.video_render_jobs || [])
    .filter((x) => x.brandCode === brandCode)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, 50)
    .map(serializeRender);
  return { ok: true, items };
});
