import { api, withBrand } from '../api.js';
import { esc, loadingHtml, stateBlock, fmtDateTime } from '../ui.js';
import { t } from '../i18n.js';
let epoch = 0;
export default {
  async mount(host, ctx) {
    const request = ++epoch;
    let page = 1;
    async function render() {
      host.innerHTML = loadingHtml();
      try {
        const data = await api.get(withBrand('/api/mos/content-versions', ctx.brand, { state: 'DRAFT', page, pageSize: 30 }));
        if (request !== epoch) return;
        host.innerHTML = '<div class="page-head"><div class="crumb">' + esc(t('发布管理')) + ' / ' + esc(t('草稿箱')) + '</div><h1>' + esc(t('草稿箱')) + '</h1><div class="ph-desc">' + esc(t('集中查看当前品牌的内容草稿，继续编辑后按任务提交审核。')) + '</div></div>'
          + '<div class="panel"><div class="table-wrap"><table><thead><tr><th>' + esc(t('标题')) + '</th><th>' + esc(t('版本')) + '</th><th>' + esc(t('创建时间')) + '</th><th></th></tr></thead><tbody>'
          + (data.items || []).map(v => '<tr><td data-notranslate>' + esc(v.title || v.code || v.id) + '</td><td data-notranslate>' + esc(v.code || v.id) + '</td><td>' + esc(fmtDateTime(v.createdAt)) + '</td><td><button class="btn btn-sm" data-draft-task="' + esc(v.contentTaskId) + '">' + esc(t('继续编辑')) + '</button></td></tr>').join('')
          + '</tbody></table></div>' + (!(data.items || []).length ? '<p class="muted">' + esc(t('当前没有内容草稿')) + '</p>' : '')
          + '<div class="ph-actions"><button class="btn" id="draftPrev" ' + (page === 1 ? 'disabled' : '') + '>' + esc(t('上一页')) + '</button><span>' + page + ' / ' + Math.max(1, Math.ceil(data.total / 30)) + '</span><button class="btn" id="draftNext" ' + (page * 30 >= data.total ? 'disabled' : '') + '>' + esc(t('下一页')) + '</button></div></div>';
        host.querySelectorAll('[data-draft-task]').forEach(b => b.onclick = () => ctx.navigate('task-detail', { task: b.dataset.draftTask }));
        host.querySelector('#draftPrev').onclick = () => { page--; render(); };
        host.querySelector('#draftNext').onclick = () => { page++; render(); };
      } catch (err) {
        if (request !== epoch) return;
        const s = stateBlock(err.status === 403 ? 'denied' : 'error', { title: t('加载失败'), desc: err.message, actions: [{ label: t('重试'), onClick: render }] });
        host.innerHTML = s.html; s.bind(host);
      }
    }
    await render();
  },
  unmount() { epoch++; },
  hasUnsaved() { return false; }
};
