/* W01-02 Active Projects —— 我可见品牌下的活动 Campaign / Master Topic 进度视图。 */
import { api, withBrand } from '../api.js';
import { esc, loadingHtml, stateBlock, statusBadge, gradeBadge, demoBadge } from '../ui.js';

let ctxRef = null; let hostEl = null;

function head(ctx) {
  return '<div class="page-head"><div class="crumb">Workspace / Active Projects</div>'
    + '<div class="ph-row"><h1>Active Projects</h1></div>'
    + '<div class="ph-desc">正在进行中的 Campaign 与 Master Topic（品牌范围：' + esc((ctx.me.brandCodes || []).join('、') || '—') + '）。</div></div>';
}

async function render() {
  const ctx = ctxRef;
  hostEl.innerHTML = head(ctx) + loadingHtml();
  let data;
  try { data = await api.get('/api/mos/active-projects'); }
  catch (err) {
    const s = stateBlock('error', { title: '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: render }] });
    hostEl.innerHTML = head(ctx) + s.html; s.bind(hostEl); return;
  }
  const camps = data.campaigns || [];
  const topics = data.topics || [];

  let html = head(ctx) + '<div class="grid grid-2">';

  html += '<div class="card"><div class="card-head"><h2>进行中的 Campaign</h2>'
    + '<div class="ch-actions"><button class="btn btn-sm" data-go="campaigns">前往 Marketing Center</button></div></div>';
  html += camps.length
    ? '<div class="card-body tight">' + camps.map((c) => '<div class="list-item"><div class="li-main">'
      + '<div class="li-title"><span class="mono muted small">' + esc(c.code) + '</span> ' + esc(c.title) + '</div>'
      + '<div class="li-sub">' + statusBadge(c.state) + ' · 品牌 ' + esc(c.brandCode) + ' · 关联任务 ' + c.taskCount + '</div>'
      + '</div></div>').join('') + '</div>'
    : '<div class="card-body">' + stateBlock('empty', { title: '当前品牌没有进行中的 Campaign', desc: '在 Marketing Center 创建 Campaign 后会出现在这里。' }).html + '</div>';
  html += '</div>';

  html += '<div class="card"><div class="card-head"><h2>活跃 Master Topic</h2>'
    + '<div class="ch-actions"><button class="btn btn-sm" data-go="topics">前往 Master Topics</button></div></div>';
  html += topics.length
    ? '<div class="card-body tight">' + topics.map((t) => '<div class="list-item"><div class="li-main">'
      + '<div class="li-title">' + esc(t.title) + ' ' + demoBadge(t.demo) + '</div>'
      + '<div class="li-sub">' + statusBadge(t.state) + ' · ' + esc(t.pillarCode)
      + ' · 证据 ' + statusBadge(t.evidenceStatus) + ' · 任务 ' + t.taskCount + '</div>'
      + '</div></div>').join('') + '</div>'
    : '<div class="card-body">' + stateBlock('empty', { title: '当前品牌没有活跃 Topic' }).html + '</div>';
  html += '</div>';

  html += '</div>';
  hostEl.innerHTML = html;
  hostEl.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => ctx.navigate(b.dataset.go)));
}
void gradeBadge;

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
