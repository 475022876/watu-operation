/* Visual Studio —— 视觉工作室（04 §2 品牌 Skill + 模板版本锁定）。
 *
 * 真实操作与持久化：
 *   - 生成走 POST /api/mos/generation-jobs（kind=IMAGE），产物真实落盘为 WorkingAsset；
 *   - 上传走 POST /api/mos/assets/upload（raw body + ?name=，服务端做扩展名与魔数双重校验）；
 *   - Mock 产物在缩略图上直接标注 MOCK，绝不冒充真实模型输出。
 *
 * 硬约束（04 §2）：Skill 未 APPROVED 时，正式输出被服务端阻塞（SKILL_NOT_APPROVED）。
 */
import { api, withBrand } from '../api.js';
import {
  esc, toast, openModal, loadingHtml, stateBlock, statusBadge, demoBadge, dictOptions, fmtDateTime, relTime
} from '../ui.js';

let ctxRef = null; let hostEl = null;
let assistants = null;
let assets = [];
let busy = false;

function bodyEl() { return hostEl.querySelector('#mosBody') || hostEl; }
function setBody(html) { bodyEl().innerHTML = html; }

function renderError(err, retry) {
  const kind = err.status === 403 || err.status === 404 ? 'denied' : 'error';
  const s = stateBlock(kind, { title: err.status === 403 ? '权限不足' : '加载失败', desc: err.message,
    actions: retry ? [{ label: '重试', primary: true, onClick: retry }] : [] });
  setBody(s.html); s.bind(bodyEl());
}

function head() {
  return '<div class="page-head"><div class="crumb">Creative Studio / Visual Studio</div>'
    + '<div class="ph-row"><h1>视觉工作室</h1>'
    + '<div class="ph-actions"><button class="btn btn-sm" id="vsRefresh">刷新素材</button></div></div>'
    + '<div class="ph-desc">生成记录会保存 template_version 与 effective_rule_hash；'
    + 'UFIB 品牌硬约束（中性白、无黄调、不得重绘 Logo、不得虚构界面与图表、不得用加密风金色）由服务端注入提示词。</div></div>';
}

async function render() {
  hostEl.innerHTML = head() + '<div id="mosBody">' + loadingHtml() + '</div>';
  try {
    const [sk, tp, as] = await Promise.all([
      api.get(withBrand('/api/mos/skills', ctxRef.brand, {})),
      api.get(withBrand('/api/mos/templates', ctxRef.brand, {})),
      api.get(withBrand('/api/mos/assets', ctxRef.brand, { pageSize: 60 }))
    ]);
    assistants = { skills: sk.items || [], usability: sk.usability || null, templates: tp.items || [], templatesNote: tp.note || '' };
    assets = as.items || [];
  } catch (err) { renderError(err, render); return; }
  paint();
  hostEl.querySelector('#vsRefresh').addEventListener('click', async () => { await render(); toast('已刷新', 'ok'); });
}

function paint() {
  const d = (ctxRef.meta && ctxRef.meta.dictionaries) || {};
  const u = assistants.usability || {};
  const ip = (ctxRef.integrations && ctxRef.integrations.imageProvider) || { mode: 'none' };

  let h = '';
  // Skill/集成状态
  h += '<div class="block-note info" style="margin-bottom:12px">'
    + '图像模型：<b>' + esc(ip.mode) + '</b>' + (ip.mock ? ' <span class="badge badge-mock">MOCK</span>' : '')
    + ' · 品牌 Skill：<b>' + esc(u.skillCode || '—') + '</b> ' + statusBadge(u.state || 'MISSING')
    + '<br><span class="small">' + esc(u.reason || '') + '</span></div>';

  h += '<div class="split-2">';
  // 左：生成表单 + 素材网格
  h += '<div class="ed-col">';
  h += '<div class="card"><div class="card-head"><h2>生成图像</h2></div><div class="card-body">'
    + '<div class="grid grid-2">'
    + '<label class="field"><span>模板（版本锁定）</span><select id="vsTpl">'
    + '<option value="">（不套用模板）</option>'
    + (assistants.templates || []).map((t) => '<option value="' + esc(t.id) + '"'
      + ' data-aspect="' + esc((t.aspects || [])[0] || '16:9') + '" data-mode="' + esc(t.mode || '') + '"'
      + ' data-platform="' + esc(t.platform || '') + '">'
      + esc(t.label + ' · ' + t.templateCode + ' · v' + t.version)).join('')
    + '</select></label>'
    + '<label class="field"><span>画幅</span><select id="vsAspect">' + dictOptions(d.aspects, '16:9', null) + '</select></label>'
    + '<label class="field"><span>模式</span><select id="vsMode">' + dictOptions(d.modes, '', '（跟随模板）') + '</select></label>'
    + '<label class="field"><span>展示场景</span><select id="vsDisplay">' + dictOptions(d.displays, '', '（不指定）') + '</select></label>'
    + '</div>'
    + '<label class="field"><span>创作简报</span><textarea id="vsBrief" class="ed-body" style="min-height:110px"'
    + ' placeholder="描述画面主体、构图、留白与信息密度；不要描述 Logo 重绘或虚构数据…"></textarea></label>'
    + '<div class="row" style="flex-wrap:wrap;gap:6px">'
    + '<button class="btn btn-sm" id="vsPreview">预览受控提示词</button>'
    + '<button class="btn btn-sm btn-primary" id="vsRun">生成图像</button>'
    + '<button class="btn btn-sm" id="vsUpload">上传素材</button>'
    + '</div>'
    + '<div id="vsOut" style="margin-top:10px"></div>'
    + '</div></div>';

  h += '<div class="card"><div class="card-head"><h2>工作素材</h2><span class="pill">' + assets.length + '</span></div><div class="card-body">';
  if (!assets.length) {
    h += stateBlock('empty', { title: '还没有素材', desc: '生成或上传后，素材会以 PRIVATE 可见性登记在此版本库中。' }).html;
  } else {
    h += '<div class="asset-grid">' + assets.map((a) => '<div class="asset-card">'
      + '<div class="ac-thumb"><img loading="lazy" src="' + esc(a.contentUrl) + '" alt="' + esc(a.fileName) + '"></div>'
      + '<div class="ac-meta"><div class="ac-name">' + esc(a.fileName) + '</div>'
      + '<div class="row" style="gap:5px;flex-wrap:wrap">'
      + '<span class="badge badge-neutral">' + esc(a.origin) + '</span>'
      + (a.mock ? '<span class="badge badge-mock">MOCK</span>' : '')
      + demoBadge(a.demo) + '</div>'
      + '<div>' + Math.round((a.bytes || 0) / 1024) + ' KB · ' + esc(relTime(a.createdAt)) + '</div>'
      + '<div class="mono" style="font-size:10.5px">sha256 ' + esc(String(a.sha256 || '').slice(0, 10)) + '</div>'
      + '<button class="btn btn-sm btn-block" data-asset="' + esc(a.id) + '">详情</button>'
      + '</div></div>').join('') + '</div>';
  }
  h += '</div></div>';
  h += '</div>';

  // 右：模板与 Skill 清单（只读说明）
  h += '<div class="ed-col">';
  h += '<div class="card"><div class="card-head"><h2>模板清单</h2></div><div class="card-body">';
  if (!(assistants.templates || []).length) {
    h += '<div class="hint">' + esc(assistants.templatesNote || '该品牌尚无可用的已登记模板。') + '</div>';
  } else {
    h += '<div class="sr-list">' + assistants.templates.map((t) => '<div class="src-item">'
      + '<div class="src-h"><span class="badge badge-neutral">' + esc(t.templateCode) + '</span>'
      + '<span class="badge badge-neutral">' + esc(t.mode || '—') + '</span>'
      + '<span class="badge badge-neutral">v' + esc(t.version) + '</span></div>'
      + '<div class="src-t">' + esc(t.label) + '</div>'
      + '<div class="small muted">' + esc(t.platform) + ' · 画幅 ' + esc((t.aspects || []).join(' / ')) + ' · 展示 ' + esc(t.display || '—') + '</div>'
      + '</div>').join('') + '</div>';
  }
  h += '</div></div>';

  h += '<div class="card"><div class="card-head"><h2>Skill 登记</h2></div><div class="card-body">'
    + (assistants.skills || []).map((s) => '<div class="src-item" style="margin-bottom:8px">'
      + '<div class="src-h">' + statusBadge(s.state) + '<span class="badge badge-neutral">v' + esc(s.version) + '</span></div>'
      + '<div class="src-t">' + esc(s.skillCode) + '</div>'
      + '<div class="small muted">' + esc(s.note || '') + '</div></div>').join('')
    + '</div></div>';
  h += '</div></div>';

  setBody(h);

  const tpl = hostEl.querySelector('#vsTpl');
  tpl.addEventListener('change', () => {
    const o = tpl.selectedOptions[0];
    if (!o || !o.value) return;
    const aspect = o.dataset.aspect, mode = o.dataset.mode;
    if (aspect) hostEl.querySelector('#vsAspect').value = aspect;
    if (mode) hostEl.querySelector('#vsMode').value = mode;
  });
  hostEl.querySelector('#vsPreview').addEventListener('click', preview);
  hostEl.querySelector('#vsRun').addEventListener('click', run);
  hostEl.querySelector('#vsUpload').addEventListener('click', uploadDialog);
  hostEl.querySelectorAll('[data-asset]').forEach((b) => b.addEventListener('click', () => showAsset(b.dataset.asset)));
}

function form() {
  const tplSel = hostEl.querySelector('#vsTpl');
  const tplId = tplSel.value;
  const tpl = (assistants.templates || []).find((t) => t.id === tplId);
  return {
    templateId: tplId || undefined,
    skillCode: (assistants.usability && assistants.usability.skillCode) || undefined,
    aspect: hostEl.querySelector('#vsAspect').value,
    mode: hostEl.querySelector('#vsMode').value || undefined,
    display: hostEl.querySelector('#vsDisplay').value || undefined,
    platform: tpl ? tpl.platform : undefined,
    templateCode: tpl ? tpl.templateCode : undefined,
    brief: hostEl.querySelector('#vsBrief').value.trim()
  };
}

async function preview() {
  const out = hostEl.querySelector('#vsOut');
  const f = form();
  if (!f.brief) { toast('请先填写创作简报', 'err'); return; }
  out.innerHTML = '<div class="hint">正在解析…</div>';
  try {
    const r = await api.post(withBrand('/api/mos/prompt-preview', ctxRef.brand), Object.assign({}, f, { outputIntent: 'TEST_DRAFT' }));
    if (r.blocked) { out.innerHTML = '<div class="block-note danger">已阻塞：' + esc(r.blockReason) + '</div>'; return; }
    out.innerHTML = '<div class="small muted">生效规则哈希 <span class="mono">' + esc(String(r.effectiveRuleHash || '').slice(0, 16)) + '</span></div>'
      + '<pre class="mono small" style="white-space:pre-wrap;background:var(--muted);padding:9px;border-radius:7px;max-height:240px;overflow:auto">' + esc(r.prompt || '') + '</pre>';
  } catch (err) { out.innerHTML = '<div class="block-note danger">' + esc(err.message) + '</div>'; }
}

async function run() {
  if (busy) return;
  const out = hostEl.querySelector('#vsOut');
  const f = form();
  if (!f.brief) { toast('请先填写创作简报', 'err'); return; }
  busy = true;
  out.innerHTML = '<div class="hint">正在生成…</div>';
  try {
    const r = await api.post(withBrand('/api/mos/generation-jobs', ctxRef.brand), Object.assign({}, f, {
      kind: 'IMAGE',
      idempotencyKey: 'img-' + ctxRef.brand + '-' + Date.now()
    }));
    const j = r.job || {};
    if (j.status === 'SUCCEEDED') {
      out.innerHTML = '<div class="block-note info">作业 ' + esc(j.id) + (j.mock ? ' 已<b>以 MOCK 方式</b>产出（非真实模型输出）' : ' 已完成')
        + '，产出 ' + (j.outputAssetIds || []).length + ' 个素材。'
        + (j.qaResult ? '<br><span class="small">QA：' + esc(j.qaResult.verdict) + '</span>' : '') + '</div>';
      toast('生成完成', 'ok');
      await refreshAssets();
    } else if (j.status === 'NOT_CONFIGURED') {
      out.innerHTML = '<div class="block-note">该能力尚未接入：' + esc(j.errorMessage || '未配置图像 Provider') + '</div>';
    } else if (j.status === 'BUDGET_EXCEEDED') {
      out.innerHTML = '<div class="block-note danger">预算闸门拦截：' + esc(j.errorMessage || r.note || '') + '</div>';
    } else {
      out.innerHTML = '<div class="block-note danger">作业未成功：' + esc(j.status + ' ' + (j.errorMessage || '')) + '</div>';
    }
  } catch (err) {
    if (err.code === 'SKILL_NOT_APPROVED') out.innerHTML = '<div class="block-note danger">Skill 门禁拦截：' + esc(err.message) + '</div>';
    else out.innerHTML = '<div class="block-note danger">' + esc(err.message) + '</div>';
    toast(err.message, 'err');
  } finally { busy = false; }
}

async function refreshAssets() {
  const as = await api.get(withBrand('/api/mos/assets', ctxRef.brand, { pageSize: 60 }));
  assets = as.items || [];
  paint();
}

function uploadDialog() {
  openModal({
    title: '上传工作素材',
    okText: '上传',
    body: '<div class="hint">允许办公文档、纯文本与图片；服务端会校验扩展名与文件魔数，伪装扩展名一律拒绝。'
      + '素材默认 PRIVATE 可见性，不会自动进入任何已批准引用。</div>'
      + '<label class="field"><span>选择文件</span><input id="upF" type="file"></label>',
    onOk: async (b) => {
      const f = b.querySelector('#upF').files[0];
      if (!f) { toast('请选择文件', 'err'); return false; }
      try {
        const res = await fetch(withBrand('/api/mos/assets/upload', ctxRef.brand, { name: f.name }), {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/octet-stream', 'x-mos-csrf': csrf() },
          body: f
        });
        const json = await res.json().catch(() => null);
        if (!res.ok) throw new Error((json && json.error) || ('上传失败 HTTP ' + res.status));
        toast('素材已上传', 'ok');
        await refreshAssets();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

function csrf() {
  const m = String(document.cookie || '').match(/(?:^|;\s*)mos_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

function showAsset(id) {
  const a = assets.find((x) => x.id === id);
  if (!a) return;
  openModal({
    title: '素材详情', okText: '关闭',
    body: '<dl class="kv">'
      + '<dt>文件名</dt><dd class="mono small">' + esc(a.fileName) + '</dd>'
      + '<dt>来源</dt><dd>' + esc(a.origin) + (a.mock ? ' <span class="badge badge-mock">MOCK</span>' : '') + '</dd>'
      + '<dt>可见性</dt><dd>' + esc(a.visibility) + '</dd>'
      + '<dt>大小</dt><dd>' + Math.round((a.bytes || 0) / 1024) + ' KB</dd>'
      + '<dt>sha256</dt><dd class="mono small" style="word-break:break-all">' + esc(a.sha256) + '</dd>'
      + '<dt>Provider</dt><dd class="small">' + esc(a.provider || '—') + '</dd>'
      + '<dt>生成作业</dt><dd class="mono small">' + esc(a.generationJobId || '—') + '</dd>'
      + '<dt>创建</dt><dd class="small">' + esc(fmtDateTime(a.createdAt)) + '</dd></dl>'
      + '<div class="divider"></div><img src="' + esc(a.contentUrl) + '" style="max-width:100%;border:1px solid var(--border-soft);border-radius:8px">'
  });
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; assistants = null; await render(); },
  unmount() { hostEl = null; assets = []; },
  hasUnsaved() { return false; }
};
