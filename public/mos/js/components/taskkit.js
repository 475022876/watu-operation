/* 公共内容任务组件（M-03）—— Planning 的 Content Tasks（All Tasks）、Campaign Deliverables、
 * Master Topic Deliverables 与 Workspace 共用**同一个 ContentTask 对象与同一套弹窗**，
 * 创建按钮在任务上下文**预填品牌与关联 ID**（01 §MERGE M-03 / 02 §2）。
 *
 * 不变量（02 §3）：
 *   - 一个 ContentTask 关联 0/1 Campaign、0/1 Topic，均须同品牌（服务端强制）；
 *   - 状态迁移由服务端状态机强制，前端只渲染 allowedTransitions；
 *   - 版本冻结与送审在「Creative Studio → 内容编辑器」完成，本组件不复制该逻辑。
 */
import { api, withBrand } from '../api.js';
import {
  esc, toast, openModal, stateBlock, statusBadge, gradeBadge, platformLabel, demoBadge,
  dictOptions, fmtDate, fmtDateTime
} from '../ui.js';

export const TASK_STATUSES = ['IDEA', 'PLANNED', 'IN_PRODUCTION', 'IN_REVIEW', 'READY', 'COMPLETED', 'ON_HOLD', 'CANCELLED'];

/* ---------------- API 客户端（唯一入口） ---------------- */

export function fetchTasks(brand, filters) {
  const f = filters || {};
  return api.get(withBrand('/api/mos/tasks', brand, {
    q: f.q || '', status: f.status || '', workState:f.workState || '', platform: f.platform || '',
    campaignId: f.campaignId || '', topicId: f.topicId || '', period: f.period || '',
    mine: f.mine ? 1 : '', page: f.page || 1, pageSize: f.pageSize || 200
  }));
}

export function fetchTaskDetail(id) { return api.get('/api/mos/tasks/' + id); }

/** 创建内容任务（唯一入口）：brandCode 始终来自当前品牌上下文，关联 ID 可预填 */
export function createTask(brand, body) {
  return api.post(withBrand('/api/mos/tasks', brand), body);
}

/* ---------------- 渲染片段 ---------------- */

export function taskRelation(t) {
  const parts = [];
  if (t.topicTitle) parts.push('Topic：' + esc(t.topicTitle));
  if (t.campaignTitle) parts.push('Campaign：' + esc(t.campaignTitle));
  return parts.length ? '<span class="muted small">' + parts.join(' · ') + '</span>' : '<span class="muted small">未关联 Topic / Campaign</span>';
}

/** 任务表（opts.columns 可裁剪；默认用于 All Tasks 综合视图） */
export function taskTable(items, opts) {
  const o = opts || {};
  if (!items || !items.length) {
    return stateBlock('empty', { title: o.emptyTitle || '没有符合条件的任务', desc: o.emptyDesc }).html;
  }
  if(o.compact) return '<div class="table-wrap"><table class="tbl employee-task-table"><thead><tr><th>任务与要求</th><th>负责人</th><th>截止时间</th><th>当前进度</th><th>下一步</th></tr></thead><tbody>' + items.map(t=>'<tr><td><strong data-notranslate>'+esc(t.title)+'</strong><p class="muted small" data-notranslate>'+esc((t.requirements || '查看任务要求').slice(0,100))+'</p></td><td>'+esc(t.ownerName)+'<p class="small muted">由 '+esc(t.createdByName || '—')+' 发起</p></td><td>'+esc(fmtDate(t.productionDue))+(t.priority==='URGENT'?'<p class="delivery-error">紧急</p>':'')+'</td><td>'+statusBadge(t.workState || t.status)+'</td><td><button class="btn btn-sm btn-primary" data-open-task="'+esc(t.id)+'">'+({'REVISION_REQUIRED':'按反馈修改','APPROVED':'查看批准作品','IN_REVIEW':'查看审核进度','READY':'查看交付作品','COMPLETED':'查看结果','CANCELLED':'查看任务'}[t.workState || t.status] || '继续处理')+'</button></td></tr>').join('')+'</tbody></table></div>';
  return '<div class="table-wrap"><table class="tbl"><thead><tr>'
    + '<th>编号</th><th>标题</th><th>平台</th><th>风险</th><th>进度</th><th>发起人</th><th>要求</th>'
    + '<th>制作截止</th><th>计划发布</th><th>关联</th><th>负责人</th><th></th></tr></thead><tbody>'
    + items.map((t) => '<tr class="task-progress-' + (t.status === 'CANCELLED' ? 'cancelled' : t.status === 'COMPLETED' ? 'completed' : t.priority === 'URGENT' ? 'urgent' : 'pending') + '">'
      + '<td class="mono">' + esc(t.code) + '</td>'
      + '<td>' + esc(t.title) + ' ' + demoBadge(t.demo) + '</td>'
      + '<td>' + esc(platformLabel(t.platform)) + '</td>'
      + '<td>' + gradeBadge(t.riskGrade) + '</td>'
      + '<td>' + statusBadge(t.status) + '</td><td>' + esc(t.createdByName || '—') + '</td><td><span class="task-requirements" title="' + esc(t.requirements || '') + '">' + esc(t.requirements || '—') + '</span></td>'
      + '<td class="mono small">' + esc(fmtDate(t.productionDue)) + '</td>'
      + '<td class="mono small">' + esc(fmtDate(t.plannedPublishAt)) + '</td>'
      + '<td>' + taskRelation(t) + '</td>'
      + '<td class="small">' + esc(t.ownerName) + '</td>'
      + '<td class="actions"><button class="btn btn-sm" data-open-task="' + esc(t.id) + '">详情</button></td></tr>').join('')
    + '</tbody></table></div>';
}

/** 绑定任务表里的「详情」按钮 */
export function bindTaskRows(el, onChanged, navigate) {
  el.querySelectorAll('[data-open-task]').forEach((b) =>
    b.addEventListener('click', () => navigate ? navigate('task-detail',{task:b.dataset.openTask}) : openTaskDetail({ id: b.dataset.openTask, onChanged })));
}

/* ---------------- 任务详情 ---------------- */

export async function openTaskDetail(opts) {
  const o = opts || {};
  let data;
  try { data = await fetchTaskDetail(o.id); } catch (err) { toast(err.message, 'err'); return; }
  const t = data.task;
  let workspace;
  try { workspace = await api.get('/api/mos/tasks/' + t.id + '/workspace'); } catch (err) { toast('任务交付资料加载失败：' + err.message, 'err'); workspace = { files: [], feedback: [], reviews: [], reminders: [] }; }
  const mo = openModal({
    title: '任务 ' + t.code, okText: '关闭',
    body: '<dl class="kv"><dt>标题</dt><dd>' + esc(t.title) + ' ' + demoBadge(t.demo) + '</dd>'
      + '<dt>平台</dt><dd>' + esc(platformLabel(t.platform)) + '</dd>'
      + '<dt>状态</dt><dd>' + statusBadge(t.status) + '</dd>'
      + '<dt>风险等级</dt><dd>' + gradeBadge(t.riskGrade) + '</dd>'
      + '<dt>Topic</dt><dd>' + esc(t.topicTitle || '—') + '</dd>'
      + '<dt>Campaign</dt><dd>' + esc(t.campaignTitle || '—') + '</dd>'
      + '<dt>制作截止</dt><dd class="mono">' + esc(fmtDate(t.productionDue)) + '</dd>'
      + '<dt>审核截止</dt><dd class="mono">' + esc(fmtDate(t.reviewDue)) + '</dd>'
      + '<dt>计划发布</dt><dd class="mono">' + esc(fmtDate(t.plannedPublishAt)) + '</dd>'
      + '<dt>内容版本</dt><dd>' + (t.versionCount || 0) + ' 个</dd>'
      + '<dt>创建</dt><dd class="small muted">' + esc(fmtDateTime(t.createdAt)) + '</dd>'
      + '</dl>'
      + '<h3>工作要求</h3><p data-notranslate style="white-space:pre-wrap">' + esc(t.requirements || '未填写') + '</p>'
      + '<h3>任务文件</h3>' + (workspace.files.length ? workspace.files.map(a => '<p><a target="_blank" rel="noopener" href="' + esc(a.contentUrl) + '">' + esc(a.fileName) + '</a></p>').join('') : '<p class="muted">暂无任务文件</p>')
      + '<h3>审核与反馈</h3>' + workspace.reviews.map(r => '<p>' + esc(r.type) + ' · ' + statusBadge(r.state) + '</p>').join('')
      + workspace.feedback.map(r => '<p data-notranslate>' + esc(r.actorName || '') + ' · ' + esc(r.action) + '：' + esc(r.comment) + '</p>').join('')
      + '<p class="muted">催办记录：' + workspace.reminders.length + '</p>'
      + '<div class="row" style="gap:8px"><a class="btn btn-primary" href="#/content-editor?task=' + encodeURIComponent(t.id) + '" id="taskDelivery">进入任务制作与交付</a>' + (workspace.canRemind ? '<button class="btn" id="taskRemind">催办负责人</button>' : '') + '</div>'
      + (t.can && t.can.edit ? '<button class="btn" id="taskEditBrief">编辑任务要求与时间</button>' : '')
      + '<div class="divider"></div>'
      + '<div class="row" style="flex-wrap:wrap">' + (t.allowedTransitions || []).map((s) =>
        '<button class="btn btn-sm" data-tt="' + esc(s) + '">迁移到 ' + esc(s) + '</button>').join('') + '</div>'
      + '<div class="hint">进入 IN_REVIEW / READY 需要 content.submit 权限；版本冻结与专业/发布审核在「Creative Studio → 内容编辑器」发起。</div>'
  });
  mo.body.querySelector('#taskDelivery').onclick = () => mo.close();
  const editBrief = mo.body.querySelector('#taskEditBrief');
  if (editBrief) editBrief.onclick = () => {
    mo.close();
    openModal({ title: '编辑任务要求与时间', okText: '保存', body:
      '<label class="field"><span>要求</span><textarea id="briefText" maxlength="12000">' + esc(t.requirements || '') + '</textarea></label>'
      + '<label class="field"><span>开始时间</span><input id="briefStart" type="date" value="' + esc(t.startAt || '') + '"></label>'
      + '<label class="field"><span>截止时间</span><input id="briefDue" type="date" value="' + esc(t.productionDue || '') + '"></label>'
      + '<label class="field"><span>优先级</span><select id="briefPriority"><option value="NORMAL">普通</option><option value="URGENT"' + (t.priority === 'URGENT' ? ' selected' : '') + '>紧急</option></select></label>',
      onOk: async b => { try { await api.put('/api/mos/tasks/' + t.id, {rowVersion:t.rowVersion,requirements:b.querySelector('#briefText').value,startAt:b.querySelector('#briefStart').value || null,productionDue:b.querySelector('#briefDue').value || null,priority:b.querySelector('#briefPriority').value}); toast('任务要求已保存','ok'); if(o.onChanged) await o.onChanged(); } catch(err) { toast(err.message,'err'); return false; } }
    });
  };
  const remind = mo.body.querySelector('#taskRemind');
  if (remind) remind.onclick = async () => { remind.disabled = true; try { const r = await api.post('/api/mos/tasks/' + t.id + '/remind', {}); toast(r.note, 'ok'); mo.close(); if(o.onChanged) o.onChanged(); } catch(err) { toast(err.message, 'err'); remind.disabled = false; } };
  mo.body.querySelectorAll('[data-tt]').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api.post('/api/mos/tasks/' + o.id + '/transition', { status: b.dataset.tt });
      toast('状态已更新为 ' + b.dataset.tt, 'ok');
      mo.close();
      if (o.onChanged) await o.onChanged();
    } catch (err) { toast(err.message, 'err'); }
  }));
}

/* ---------------- 创建任务弹窗（支持品牌 / 关联 ID 预填） ---------------- */

/**
 * prefill: { campaignId, campaignTitle, topicId, topicTitle, title, platform,
 *            pillarCode, narrativeCode, riskGrade, lockRelation }
 * 传入 campaignId/topicId 时下拉默认选中该关联（上下文预填），并在顶部显示"品牌预填"提示。
 */
export async function openCreateTaskDialog(opts) {
  const o = opts || {};
  const brand = o.brand;
  const pre = o.prefill || {};
  const meta = o.meta || {};
  const d = (meta.dictionaries) || {};

  let people = [];
  try { people = (await api.get(withBrand('/api/mos/task-workspace/people', brand))).items || []; } catch (_) {}
  let campaigns = [];
  let topics = [];
  try {
    if (brand && !pre.lockRelation) {
      const [c, tp] = await Promise.all([
        api.get(withBrand('/api/mos/campaigns', brand, { pageSize: 200 })).catch(() => ({ items: [] })),
        api.get(withBrand('/api/mos/topics', brand, { pageSize: 200 })).catch(() => ({ items: [] }))
      ]);
      campaigns = c.items || [];
      topics = tp.items || [];
    }
  } catch (_) { /* 忽略：无关联也可创建 */ }

  const campOpts = (campaigns.length
    ? campaigns.map((c) => '<option value="' + esc(c.id) + '"' + (pre.campaignId === c.id ? ' selected' : '') + '>'
      + esc(c.code) + ' · ' + esc(c.title) + '</option>').join('')
    : (pre.campaignId ? '<option value="' + esc(pre.campaignId) + '" selected>' + esc(pre.campaignTitle || pre.campaignId) + '</option>' : ''));
  const topicOpts = (topics.length
    ? topics.map((t) => '<option value="' + esc(t.id) + '"' + (pre.topicId === t.id ? ' selected' : '') + '>'
      + esc(t.title) + '</option>').join('')
    : (pre.topicId ? '<option value="' + esc(pre.topicId) + '" selected>' + esc(pre.topicTitle || pre.topicId) + '</option>' : ''));

  openModal({
    title: o.title || '新建内容任务',
    okText: o.okText || '创建任务',
    body: '<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px">'
      + '<span class="pill">品牌预填 ' + esc(brand || '—') + '</span>'
      + (pre.campaignId ? '<span class="pill">Campaign 预填</span>' : '')
      + (pre.topicId ? '<span class="pill">Topic 预填</span>' : '')
      + '</div>'
      + '<label class="field"><span>标题</span><input id="ktT" type="text" value="' + esc(pre.title || '') + '"></label>'
      + '<label class="field"><span>工作要求</span><textarea id="ktRequirements" maxlength="12000"></textarea></label>'
      + '<label class="field"><span>负责人</span><select id="ktOwner"><option value="">我自己</option>' + people.map(u => '<option value="' + esc(u.id) + '">' + esc(u.displayName) + '</option>').join('') + '</select></label>'
      + '<label class="field"><span>优先级</span><select id="ktPriority"><option value="NORMAL">普通</option><option value="URGENT">紧急</option></select></label>'
      + '<label class="field"><span>计划开始</span><input id="ktStart" type="date"></label>'
      + '<label class="field"><span>截止时间</span><input id="ktD" type="date"></label>'
      + '<details class="delivery-details"><summary>发布要求与高级选项</summary>'
      + '<label class="field"><span>平台</span><select id="ktP">' + dictOptions(d.platforms, pre.platform || 'LINKEDIN', null) + '</select></label>'
      + '<label class="field"><span>栏目</span><select id="ktC">' + dictOptions(d.pillars, pre.pillarCode || 'C01', null) + '</select></label>'
      + '<label class="field"><span>叙事</span><select id="ktN">' + dictOptions(d.narratives, pre.narrativeCode || 'N01', null) + '</select></label>'
      + '<label class="field"><span>风险等级</span><select id="ktG">' + dictOptions(d.riskGrades, pre.riskGrade || 'G1', null) + '</select></label>'
      + '<label class="field"><span>关联 Campaign（可选）</span><select id="ktCamp">'
      + '<option value="">不关联</option>' + campOpts + '</select></label>'
      + '<label class="field"><span>关联 Topic（可选）</span><select id="ktTop">'
      + '<option value="">不关联</option>' + topicOpts + '</select></label>'
      + '<label class="field"><span>计划发布</span><input id="ktPub" type="date"></label></details>',
    onOk: async (b) => {
      try {
        const created = await createTask(brand, {
          title: b.querySelector('#ktT').value,
          requirements: b.querySelector('#ktRequirements').value,
          ownerId: b.querySelector('#ktOwner').value || undefined,
          priority: b.querySelector('#ktPriority').value, startAt: b.querySelector('#ktStart').value || null,
          platform: b.querySelector('#ktP').value,
          pillarCode: b.querySelector('#ktC').value,
          narrativeCode: b.querySelector('#ktN').value,
          riskGrade: b.querySelector('#ktG').value,
          campaignId: b.querySelector('#ktCamp').value || null,
          topicId: b.querySelector('#ktTop').value || null,
          productionDue: b.querySelector('#ktD').value || null,
          plannedPublishAt: b.querySelector('#ktPub').value || null
        });
        toast('任务已创建', 'ok');
        if (o.onCreated) await o.onCreated(created.task);
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}
