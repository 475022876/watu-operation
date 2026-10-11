/* W02-03 Visual & Creative Guidelines —— V01–V05 / PPT-01–08 / 模板（只读，BUILD-01 无模板编辑）。 */
import { api } from '../api.js';
import { esc, loadingHtml, stateBlock } from '../ui.js';

let ctxRef = null; let hostEl = null;

async function render() {
  const ctx = ctxRef;
  hostEl.innerHTML = '<div class="page-head"><div class="crumb">Brand Center / Visual & Creative Guidelines</div>'
    + '<div class="ph-row"><h1>Visual &amp; Creative Guidelines</h1><span class="badge badge-neutral">只读</span></div>'
    + '<div class="ph-desc">五种视觉语言（V01–V05）、Motion（M01–M05）与视频类型（F01–F04）字典。标签为占位时表示待 SPECIAL-01 核验。</div></div>'
    + loadingHtml();

  let meta;
  try { meta = ctx.meta || await api.get('/api/mos/meta'); }
  catch (err) {
    const s = stateBlock('error', { title: '加载失败', desc: err.message, actions: [{ label: '重试', primary: true, onClick: render }] });
    hostEl.innerHTML = s.html; s.bind(hostEl); return;
  }
  const d = meta.dictionaries || {};

  const card = (title, list, note) => {
    return '<div class="card"><div class="card-head"><h2>' + esc(title) + '</h2>'
      + '<div class="ch-actions"><span class="badge badge-neutral">' + (list || []).length + '</span></div></div>'
      + '<div class="card-body">'
      + (note ? '<div class="callout warn">' + esc(note) + '</div>' : '')
      + '<div class="tag-list">' + (list || []).map((x) =>
        '<span class="pill">' + esc(x.code) + ' · ' + esc(x.provisional ? '待核验' : x.label) + '</span>').join('') + '</div>'
      + '</div></div>';
  };

  hostEl.innerHTML = '<div class="page-head"><div class="crumb">Brand Center / Visual & Creative Guidelines</div>'
    + '<div class="ph-row"><h1>Visual &amp; Creative Guidelines</h1><span class="badge badge-neutral">只读</span></div>'
    + '<div class="ph-desc">字典为系统唯一来源（单一来源原则）；provisional 条目标签待业务核验后由 config.json 覆盖。</div></div>'
    + '<div class="callout mock">VFIB Visual Brand Guardian V1.2 在本阶段仅作为<strong>规范引用</strong>登记，尚未作为资料库 Skill 激活；'
    + '因此模板列表为空，正式品牌输出处于阻断状态（见 Brand Overview）。</div>'
    + '<div class="grid grid-2">'
    + card('五种视觉语言 V01–V05', d.visuals, d.visuals && d.visuals[0] && d.visuals[0].provisional ? 'SPECIAL-01 未提供：以下标签为占位，待业务核验。' : '')
    + card('Motion Identity M01–M05', d.motions, d.motions && d.motions[0] && d.motions[0].provisional ? 'SPECIAL-01 未提供：标签占位。' : '')
    + card('视频类型 F01–F04', d.videoTypes)
    + card('平台', d.platforms)
    + '</div>'
    + '<div class="card"><div class="card-head"><h2>创意模板（PPT-01–08）</h2></div><div class="card-body">'
    + stateBlock('pending', { title: '暂无可加载模板', desc: '模板需绑定到已激活的 Skill 版本；当前无 APPROVED Skill 版本，因此模板列表为空。模板加载能力在 BUILD-02 交付。' }).html
    + '</div></div>';
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
