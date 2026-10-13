/* Video Workspace —— 视频工作区（W04-03 / 04 §2）。
 *
 * 首期范围**只有**：Brief、脚本、分镜、字幕、关键帧资产引用、成片上传。
 * 明确不做：自动渲染 / 自动配音 / 自动剪辑 —— 界面上直接写明，避免"看起来能自动成片"。
 *
 * 真实操作与持久化：全部字段经 PUT /api/mos/video/:taskId 落库，
 * 状态（BRIEF→SCRIPT→STORYBOARD→SUBTITLE→FINAL_UPLOADED）由服务端按实际内容推导。
 */
import { api, withBrand } from '../api.js';
import {
  esc, toast, openModal, confirmDialog, loadingHtml, stateBlock, statusBadge, gradeBadge,
  platformLabel, dictOptions, fmtDateTime, relTime
} from '../ui.js';

let ctxRef = null; let hostEl = null;
let tasks = []; let taskId = '';
let video = null; let taskInfo = null;
let assets = [];
let dirty = false;

function bodyEl() { return hostEl.querySelector('#mosBody') || hostEl; }
function setBody(html) { bodyEl().innerHTML = html; }

function renderError(err, retry) {
  const kind = err.status === 403 || err.status === 404 ? 'denied' : 'error';
  const s = stateBlock(kind, { title: err.status === 403 ? '权限不足' : (err.status === 404 ? '无权访问' : '加载失败'),
    desc: err.message, actions: retry ? [{ label: '重试', primary: true, onClick: retry }] : [] });
  setBody(s.html); s.bind(bodyEl());
}

function head() {
  return '<div class="page-head"><div class="crumb">创意工作室 / 视频工作区</div>'
    + '<div class="ph-row"><h1>视频工作区</h1>'
    + '<div class="ph-actions"><button class="btn btn-sm" id="vwRefresh">刷新</button></div></div>'
    + '<div class="ph-desc">首期仅支持 Brief / 脚本 / 分镜 / 字幕 / 关键帧与成片上传；'
    + '<b>不提供自动渲染、自动配音、自动剪辑</b>（04 §2）。</div></div>';
}

async function render() {
  hostEl.innerHTML = head() + '<div id="mosBody">' + loadingHtml() + '</div>';
  try {
    const [tr, ar] = await Promise.all([
      api.get(withBrand('/api/mos/tasks', ctxRef.brand, {})),
      api.get(withBrand('/api/mos/assets', ctxRef.brand, { pageSize: 100 }))
    ]);
    tasks = tr.items || [];
    assets = ar.items || [];
  } catch (err) { renderError(err, render); return; }

  if (!tasks.length) {
    setBody(stateBlock('empty', { title: '当前品牌还没有内容任务', desc: '视频工作区依附于内容任务，请先创建任务。' }).html);
    bindHead(); return;
  }
  if (!taskId || !tasks.some((t) => t.id === taskId)) taskId = tasks[0].id;
  await loadVideo();
  paint();
  bindHead();
}

async function loadVideo() {
  const r = await api.get(withBrand('/api/mos/video/' + taskId, ctxRef.brand, {}));
  video = r.video; taskInfo = r.task; dirty = false;
}

function bindHead() {
  const r = hostEl.querySelector('#vwRefresh');
  if (r) r.addEventListener('click', async () => { await render(); toast('已刷新', 'ok'); });
  const s = hostEl.querySelector('#vwTask');
  if (s) s.addEventListener('change', async () => {
    if (dirty && !(await confirmDialog('放弃未保存修改？', '当前视频工作区有未保存修改。', '放弃并切换'))) { s.value = taskId; return; }
    taskId = s.value; await loadVideo(); paint();
  });
}

const STAGES = ['BRIEF', 'SCRIPT', 'STORYBOARD', 'SUBTITLE', 'FINAL_UPLOADED'];
const STAGE_LABEL = { BRIEF: 'Brief', SCRIPT: '脚本', STORYBOARD: '分镜', SUBTITLE: '字幕', FINAL_UPLOADED: '成片已上传' };

function paint() {
  const d = (ctxRef.meta && ctxRef.meta.dictionaries) || {};
  const cur = STAGES.indexOf(video.state);

  let h = '<div class="filters"><label class="row" style="gap:6px"><span class="small muted">内容任务</span>'
    + '<select id="vwTask" style="max-width:420px">'
    + tasks.map((t) => '<option value="' + esc(t.id) + '"' + (t.id === taskId ? ' selected' : '') + '>'
      + esc(t.code + ' · ' + t.title) + '</option>').join('') + '</select></label>'
    + statusBadge(video.state) + gradeBadge(taskInfo.riskGrade)
    + '<span class="pill">rowVersion ' + video.rowVersion + '</span></div>';

  // 阶段条
  h += '<div class="card"><div class="card-body tight"><div class="row" style="gap:10px;flex-wrap:wrap">'
    + STAGES.map((s, i) => '<span class="badge ' + (i <= cur ? 'badge-ok' : 'badge-neutral') + '">'
      + (i <= cur ? '✔ ' : '○ ') + esc(STAGE_LABEL[s]) + '</span>').join('<span class="muted">→</span>')
    + '</div></div></div>';

  h += '<div class="split-2">';
  h += '<div class="ed-col">';

  // Brief
  h += '<div class="card"><div class="card-head"><h2>Brief</h2></div><div class="card-body">'
    + '<div class="grid grid-2">'
    + '<label class="field"><span>视频类型</span><select id="vwType">' + dictOptions(d.videoTypes, video.videoType, null) + '</select></label>'
    + '<label class="field"><span>Motion Identity</span><select id="vwMotion">' + dictOptions(d.motions, video.motionCode, null) + '</select></label>'
    + '</div>'
    + '<label class="field"><span>创作简报</span><textarea id="vwBrief" class="ed-body" style="min-height:110px">' + esc(video.brief) + '</textarea></label>'
    + '</div></div>';

  // 脚本
  const sections = (video.script && video.script.sections) || [];
  h += '<div class="card"><div class="card-head"><h2>脚本</h2>'
    + '<button class="btn btn-sm" id="vwAddSec">添加分节</button></div><div class="card-body">'
    + '<div id="vwSecs">' + (sections.length ? sections.map((s, i) => `
        <div class="shot-row" data-sec="${i}">
          <div class="sh-no">${i + 1}</div>
          <div>
            <input type="text" class="sec-h" placeholder="分节标题" value="${esc(s.heading)}">
            <textarea class="sec-c" style="margin-top:6px" placeholder="正文内容">${esc(s.content)}</textarea>
          </div>
          <input type="number" class="sec-d" min="0" step="1" placeholder="秒" value="${Number(s.durationSec) || 0}">
          <button class="icon-btn sec-x" title="删除">✕</button>
        </div>`).join('') : '<div class="hint">还没有脚本分节。</div>') + '</div>'
    + '</div></div>';

  // 分镜
  const shots = video.storyboard || [];
  h += '<div class="card"><div class="card-head"><h2>分镜</h2>'
    + '<button class="btn btn-sm" id="vwAddShot">添加分镜</button></div><div class="card-body">'
    + '<div id="vwShots">' + (shots.length ? shots.map((s, i) => `
        <div class="shot-row" data-shot="${i}">
          <div class="sh-no">#${s.shot || i + 1}</div>
          <div>
            <textarea class="sh-d" placeholder="画面描述">${esc(s.description)}</textarea>
            <div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">
              <select class="sh-kf" style="max-width:240px"><option value="">（无关键帧）</option>
                ${assets.map((a) => `<option value="${esc(a.id)}"${s.keyframeAssetId === a.id ? ' selected' : ''}>${esc(a.fileName)}</option>`).join('')}
              </select>
              <select class="sh-m" style="max-width:170px">${dictOptions(d.motions, s.motionCode, null)}</select>
            </div>
          </div>
          <input type="number" class="sh-t" min="0" step="0.5" placeholder="秒" value="${Number(s.durationSec) || 0}">
          <button class="icon-btn sh-x" title="删除">✕</button>
        </div>`).join('') : '<div class="hint">还没有分镜。</div>') + '</div>'
    + '</div></div>';

  // 字幕
  const subs = video.subtitles || [];
  h += '<div class="card"><div class="card-head"><h2>字幕</h2>'
    + '<button class="btn btn-sm" id="vwAddSub">添加字幕</button></div><div class="card-body">'
    + '<div class="hint">时间不得倒置或重叠（服务端强制校验）。</div>'
    + '<div id="vwSubs">' + (subs.length ? subs.map((s, i) => `
        <div class="shot-row" data-sub="${i}">
          <div class="sh-no">${i + 1}</div>
          <div><input type="text" class="su-x2" placeholder="字幕文本" value="${esc(s.text)}"></div>
          <div class="row" style="gap:4px"><input type="number" class="su-s" min="0" step="0.1" value="${s.start}" style="width:100%"><input type="number" class="su-e" min="0" step="0.1" value="${s.end}" style="width:100%"></div>
          <button class="icon-btn su-del" title="删除">✕</button>
        </div>`).join('') : '<div class="hint">还没有字幕。</div>') + '</div>'
    + '</div></div>';

  h += '<div class="row" style="gap:8px;flex-wrap:wrap">'
    + '<button class="btn btn-primary" id="vwSave">保存</button>'
    + '<span id="vwDirty" class="muted small"></span></div>';
  h += '</div>';

  // 右栏：关键帧与成片
  h += '<div class="ed-col">';
  h += '<div class="card"><div class="card-head"><h2>关键帧资产</h2><span class="pill">' + (video.keyframeAssets || []).length + '</span></div><div class="card-body">';
  if (!(video.keyframeAssets || []).length) h += '<div class="hint">分镜中引用的关键帧会显示在这里。</div>';
  else h += '<div class="asset-grid">' + video.keyframeAssets.map((a) => '<div class="asset-card">'
    + (a.missing ? '<div class="ac-thumb"><span class="muted small">素材缺失</span></div>'
      : '<div class="ac-thumb"><img loading="lazy" src="/api/mos/assets/' + esc(a.id) + '/content" alt="' + esc(a.fileName) + '"></div>')
    + '<div class="ac-meta"><div class="ac-name">' + esc(a.fileName || a.id) + '</div>'
    + (a.mock ? '<span class="badge badge-mock">MOCK</span>' : '') + '</div></div>').join('') + '</div>';
  h += '</div></div>';

  h += '<div class="card"><div class="card-head"><h2>成片</h2></div><div class="card-body">';
  if (video.finalAsset) {
    h += '<dl class="kv"><dt>文件</dt><dd class="small mono">' + esc(video.finalAsset.fileName) + '</dd>'
      + '<dt>大小</dt><dd>' + Math.round((video.finalAsset.bytes || 0) / 1024) + ' KB</dd></dl>'
      + '<button class="btn btn-sm btn-block" id="vwClearFinal">清除成片引用</button>';
  } else {
    h += '<div class="hint">还没有上传成片。上传后状态推进到「成片已上传」。</div>'
      + '<button class="btn btn-sm btn-primary btn-block" id="vwUploadFinal">上传成片</button>';
  }
  h += '<div class="divider"></div>'
    + '<div class="small muted">本工作区不产出渲染文件；成片由外部工具制作后上传归档。</div>'
    + '</div></div>';

  h += '<div class="card"><div class="card-head"><h2>关键帧来源</h2></div><div class="card-body">'
    + '<div class="hint">可先在 Visual Studio 生成或上传素材，再在上方分镜中引用。</div>'
    + '<button class="btn btn-sm btn-block" id="vwGoVisual">前往 Visual Studio</button>'
    + '</div></div>';
  h += '</div></div>';

  setBody(h);
  bindStage();
}

function markDirty() { dirty = true; const el = hostEl.querySelector('#vwDirty'); if (el) el.textContent = '有未保存修改'; }

function bindStage() {
  const mark = () => markDirty();
  ['#vwBrief', '#vwType', '#vwMotion'].forEach((s) => {
    const el = hostEl.querySelector(s); if (el) el.addEventListener('input', mark);
  });

  hostEl.querySelector('#vwAddSec').addEventListener('click', () => {
    const c = hostEl.querySelector('#vwSecs');
    if (c.querySelector('.hint')) c.innerHTML = '';
    const i = c.querySelectorAll('[data-sec]').length;
    const div = document.createElement('div');
    div.className = 'shot-row'; div.dataset.sec = String(i);
    div.innerHTML = '<div class="sh-no">' + (i + 1) + '</div>'
      + '<div><input type="text" class="sec-h" placeholder="分节标题"><textarea class="sec-c" style="margin-top:6px" placeholder="正文内容"></textarea></div>'
      + '<input type="number" class="sec-d" min="0" step="1" placeholder="秒" value="0">'
      + '<button class="icon-btn sec-x" title="删除">✕</button>';
    c.appendChild(div); markDirty(); bindDeletes();
  });

  hostEl.querySelector('#vwAddShot').addEventListener('click', () => {
    const c = hostEl.querySelector('#vwShots');
    if (c.querySelector('.hint')) c.innerHTML = '';
    const i = c.querySelectorAll('[data-shot]').length;
    const d = (ctxRef.meta && ctxRef.meta.dictionaries) || {};
    const div = document.createElement('div');
    div.className = 'shot-row'; div.dataset.shot = String(i);
    div.innerHTML = '<div class="sh-no">#' + (i + 1) + '</div>'
      + '<div><textarea class="sh-d" placeholder="画面描述"></textarea>'
      + '<div class="row" style="gap:6px;margin-top:6px;flex-wrap:wrap">'
      + '<select class="sh-kf" style="max-width:240px"><option value="">（无关键帧）</option>'
      + assets.map((a) => '<option value="' + esc(a.id) + '">' + esc(a.fileName) + '</option>').join('') + '</select>'
      + '<select class="sh-m" style="max-width:170px">' + dictOptions(d.motions, video.motionCode, null) + '</select>'
      + '</div></div><input type="number" class="sh-t" min="0" step="0.5" placeholder="秒" value="0">'
      + '<button class="icon-btn sh-x" title="删除">✕</button>';
    c.appendChild(div); markDirty(); bindDeletes();
  });

  hostEl.querySelector('#vwAddSub').addEventListener('click', () => {
    const c = hostEl.querySelector('#vwSubs');
    if (c.querySelector('.hint')) c.innerHTML = '';
    const i = c.querySelectorAll('[data-sub]').length;
    const div = document.createElement('div');
    div.className = 'shot-row'; div.dataset.sub = String(i);
    div.innerHTML = '<div class="sh-no">' + (i + 1) + '</div>'
      + '<div><input type="text" class="su-x2" placeholder="字幕文本"></div>'
      + '<div class="row" style="gap:4px"><input type="number" class="su-s" min="0" step="0.1" value="0" style="width:100%">'
      + '<input type="number" class="su-e" min="0" step="0.1" value="0" style="width:100%"></div>'
      + '<button class="icon-btn su-del" title="删除">✕</button>';
    c.appendChild(div); markDirty(); bindDeletes();
  });

  bindDeletes();
  hostEl.querySelector('#vwSave').addEventListener('click', save);
  const uf = hostEl.querySelector('#vwUploadFinal');
  if (uf) uf.addEventListener('click', uploadFinal);
  const cf = hostEl.querySelector('#vwClearFinal');
  if (cf) cf.addEventListener('click', async () => {
    if (!(await confirmDialog('清除成片引用？', '只会解除引用，素材本身仍保留在工作素材库。', '清除'))) return;
    try { await api.put(withBrand('/api/mos/video/' + taskId, ctxRef.brand), { finalAssetId: null, rowVersion: video.rowVersion }); await loadVideo(); paint(); toast('已清除', 'ok'); }
    catch (err) { toast(err.message, 'err'); }
  });
  hostEl.querySelector('#vwGoVisual').addEventListener('click', () => ctxRef.navigate('visual-studio'));
}

function bindDeletes() {
  hostEl.querySelectorAll('.sec-x, .sh-x, .su-del').forEach((b) => {
    if (b.dataset.bound) return;
    b.dataset.bound = '1';
    b.addEventListener('click', () => { const r = b.closest('.shot-row'); if (r) { r.remove(); markDirty(); } });
  });
  hostEl.querySelectorAll('.shot-row input, .shot-row textarea, .shot-row select').forEach((el) => {
    if (el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('input', markDirty);
    el.addEventListener('change', markDirty);
  });
}

function collect() {
  const sections = [...hostEl.querySelectorAll('#vwSecs [data-sec]')].map((r) => ({
    heading: r.querySelector('.sec-h').value.trim(),
    content: r.querySelector('.sec-c').value,
    durationSec: Number(r.querySelector('.sec-d').value) || 0
  })).filter((s) => s.heading || s.content);

  const storyboard = [...hostEl.querySelectorAll('#vwShots [data-shot]')].map((r, i) => ({
    shot: i + 1,
    description: r.querySelector('.sh-d').value,
    durationSec: Number(r.querySelector('.sh-t').value) || 0,
    motionCode: r.querySelector('.sh-m').value,
    keyframeAssetId: r.querySelector('.sh-kf').value || null
  })).filter((s) => s.description || s.keyframeAssetId);

  const subtitles = [...hostEl.querySelectorAll('#vwSubs [data-sub]')].map((r) => ({
    start: Number(r.querySelector('.su-s').value) || 0,
    end: Number(r.querySelector('.su-e').value) || 0,
    text: r.querySelector('.su-x2').value
  })).filter((s) => s.text);

  return {
    videoType: hostEl.querySelector('#vwType').value,
    motionCode: hostEl.querySelector('#vwMotion').value,
    brief: hostEl.querySelector('#vwBrief').value,
    script: { sections },
    storyboard,
    subtitles,
    rowVersion: video.rowVersion
  };
}

async function save() {
  try {
    await api.put(withBrand('/api/mos/video/' + taskId, ctxRef.brand), collect());
    toast('已保存', 'ok');
    await loadVideo();
    await render();
  } catch (err) {
    if (err.code === 'BAD_SUBTITLE') toast('字幕时间非法：' + err.message, 'err');
    else toast(err.message, 'err');
  }
}

function uploadFinal() {
  openModal({
    title: '上传成片',
    okText: '上传',
    body: '<div class="hint">成片作为工作素材登记（PRIVATE），并写入视频产物的成片引用。</div>'
      + '<label class="field"><span>选择视频文件</span><input id="vfF" type="file"></label>',
    onOk: async (b) => {
      const f = b.querySelector('#vfF').files[0];
      if (!f) { toast('请选择文件', 'err'); return false; }
      try {
        const url = withBrand('/api/mos/assets/upload', ctxRef.brand, { name: f.name, taskId });
        const res = await fetch(url, {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream', 'x-mos-csrf': csrf() },
          body: f
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error((json && json.error) || ('上传失败 HTTP ' + res.status));
        const assetId = (json && (json.asset ? json.asset.id : json.id)) || null;
        if (!assetId) throw new Error('上传成功但未返回素材 ID');
        await api.put(withBrand('/api/mos/video/' + taskId, ctxRef.brand), { finalAssetId: assetId, rowVersion: video.rowVersion });
        toast('成片已上传', 'ok');
        await loadVideo(); await render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

function csrf() {
  const m = String(document.cookie || '').match(/(?:^|;\s*)mos_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; assets = []; await render(); },
  unmount() { hostEl = null; video = null; dirty = false; },
  hasUnsaved() { return dirty; }
};
