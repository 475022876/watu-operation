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
const { get, put } = require('../router');
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
