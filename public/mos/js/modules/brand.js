/* W02-01 Brand Overview —— 当前已批准版本与使用范围（**只读**；BUILD-01 不提供品牌编辑）。 */
import { api } from '../api.js';
import { esc, loadingHtml, stateBlock, mockBadge } from '../ui.js';

let ctxRef = null; let hostEl = null;

function head(ctx) {
  return '<div class="page-head"><div class="crumb">Brand Center / Brand Overview</div>'
    + '<div class="ph-row"><h1>Brand Overview</h1><span class="badge badge-neutral">只读</span></div>'
    + '<div class="ph-desc">当前品牌上下文与已批准版本状态。品牌配置在本阶段**只读**（不提供编辑入口）。</div></div>';
}

async function render() {
  const ctx = ctxRef;
  if (!ctx.brand) {
    const s = stateBlock('denied', { title: '无可用品牌', desc: '当前账号没有任何品牌范围授权，请联系管理员分配角色。' });
    hostEl.innerHTML = head(ctx) + s.html; return;
  }
  hostEl.innerHTML = head(ctx) + loadingHtml();
  let data;
  try { data = await api.get('/api/mos/brand/' + encodeURIComponent(ctx.brand) + '/overview'); }
  catch (err) {
    const s = stateBlock(err.status === 404 ? 'denied' : 'error', {
      title: err.status === 404 ? '无权访问该品牌' : '加载失败', desc: err.message,
      actions: [{ label: '重试', primary: true, onClick: render }]
    });
    hostEl.innerHTML = head(ctx) + s.html; s.bind(hostEl); return;
  }

  const b = data.brand;
  const sa = data.skillActivation;
  const it = data.integrations || {};

  let html = head(ctx);
  html += '<div class="grid grid-2">';

  html += '<div class="card"><div class="card-head"><h2>品牌身份</h2></div><div class="card-body">'
    + '<dl class="kv">'
    + '<dt>品牌代码</dt><dd class="mono">' + esc(b.code) + '</dd>'
    + '<dt>名称</dt><dd>' + esc(b.name) + '</dd>'
    + '<dt>状态</dt><dd><span class="badge badge-ok">' + esc(b.status) + '</span></dd>'
    + '<dt>Skill 状态</dt><dd>' + esc(b.skillState)
    + (b.skillState === 'REFERENCE_ONLY' ? ' <span class="badge badge-warn">仅规范引用</span>' : '')
    + (b.skillState === 'MISSING_NOT_APPROVED' ? ' <span class="badge badge-danger">未批准</span>' : '') + '</dd>'
    + '</dl>'
    + '<div class="callout warn" style="margin-top:12px">' + esc(b.skillNote) + '</div>'
    + '</div></div>';

  html += '<div class="card"><div class="card-head"><h2>Skill 激活与正式输出阻断</h2></div><div class="card-body">'
    + '<dl class="kv">'
    + '<dt>已批准 Skill</dt><dd>' + sa.approvedSkills + ' 个</dd>'
    + '<dt>可用模板</dt><dd>' + sa.templates + ' 个</dd>'
    + '<dt>正式输出</dt><dd>' + (sa.officialOutputBlocked
      ? '<span class="badge badge-danger">已阻断</span>' : '<span class="badge badge-ok">允许</span>') + '</dd>'
    + '</dl>'
    + (sa.message ? '<div class="callout danger" style="margin-top:12px">' + esc(sa.message) + '</div>' : '')
    + '<div class="callout info" style="margin-top:8px">' + esc(sa.visualGuardian) + '</div>'
    + '</div></div>';

  html += '<div class="card"><div class="card-head"><h2>视觉基础（源码证据）</h2></div><div class="card-body">'
    + (b.palette && b.palette.length
      ? '<div class="tag-list">' + b.palette.map((c) => '<span class="pill mono">' + esc(c) + '</span>').join('') + '</div>'
      : '<div class="callout warn">该品牌尚未登记色板（U CARD 独立 Skill 未批准）。</div>')
    + '<dl class="kv" style="margin-top:12px">'
    + '<dt>英文标题</dt><dd>' + esc(b.typography.heading) + '</dd>'
    + '<dt>正文</dt><dd>' + esc(b.typography.body) + '</dd>'
    + '<dt>中文</dt><dd>' + esc(b.typography.cjk) + '</dd>'
    + '</dl></div></div>';

  html += '<div class="card"><div class="card-head"><h2>我的品牌内权限</h2></div><div class="card-body">'
    + '<div class="tag-list">' + (data.myPermissions || []).map((p) => '<span class="pill mono">' + esc(p) + '</span>').join('') + '</div>'
    + '<div class="hint">权限由服务端按「主体 + 品牌范围 + 动作」实时判定，前端仅作展示。</div>'
    + '</div></div>';

  html += '<div class="card"><div class="card-head"><h2>品牌级集成状态</h2></div><div class="card-body">'
    + '<div class="checkline"><span class="ck">•</span><span>企业资料库：<strong>' + esc(it.library.mode) + '</strong> ' + mockBadge(it.library.mock) + ' ' + esc(it.library.note || '') + '</span></div>'
    + '<div class="checkline"><span class="ck">•</span><span>知识库：<strong>' + esc(it.knowledge.mode) + '</strong> ' + mockBadge(it.knowledge.mock) + '</span></div>'
    + '<div class="checkline"><span class="ck">•</span><span>文本模型：<strong>' + esc(data.textProvider.mode) + '</strong>' + (data.textProvider.configured ? '' : '（尚未配置模型）') + '</span></div>'
    + '</div></div>';

  html += '</div>';
  hostEl.innerHTML = html;
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
