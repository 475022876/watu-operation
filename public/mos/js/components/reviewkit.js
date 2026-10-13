/* 公共审核组件（M-01）—— My Reviews 与 Governance & Assets **共用同一套**审核列表 / 详情 /
 * 动作与 API 客户端，禁止两处分别维护审批状态规则（01 §MERGE M-01）。
 *
 * 硬规则（03 §1-§5）：
 *   - 三条链相互独立（专业 / 发布 / 入库），**不存在单一 approved 标志位**；
 *   - 可执行动作只来自服务端返回的 `allowedActions` 与 `canDecide`；
 *     前端隐藏/显示按钮**不构成授权**，服务端会再次判定（03 §5）；
 *   - 批准对象是冻结的 Manifest（或入库申请的资产指纹），详情同时显示冻结值与实时重算值。
 */
import { api, withBrand } from '../api.js';
import { esc, toast, openModal, stateBlock, statusBadge, gradeBadge, fmtDateTime, relTime, demoBadge } from '../ui.js';

/** 三条审核链（与后端 lib/mos/routes/reviews.js PERM_BY_TYPE 一一对应） */
export const REVIEW_TYPES = [
  { code: 'PROFESSIONAL_REVIEW', label: '专业（金融事实）审核' },
  { code: 'PUBLICATION_APPROVAL', label: '发布审批' },
  { code: 'ASSET_ADMISSION', label: '资产入库审核' }
];

const TYPE_LABELS = {};
for (const t of REVIEW_TYPES) TYPE_LABELS[t.code] = t.label;

export function caseTypeLabel(t) { return TYPE_LABELS[t] || t || '—'; }

/** 动作 → 文案与样式（仅用于渲染服务端允许的动作，不用于判定是否允许） */
export const ACTION_META = {
  START_REVIEW: { label: '开始审核', cls: 'btn' },
  APPROVE: { label: '批准', cls: 'btn btn-primary' },
  REQUEST_REVISION: { label: '要求修订', cls: 'btn' },
  REJECT: { label: '驳回', cls: 'btn btn-danger' },
  CANCEL: { label: '取消', cls: 'btn' }
};

/** 这些动作必须填写原因（与后端 REVIEW 校验一致：REMARKS_REQUIRED） */
export const REMARKS_REQUIRED_ACTIONS = ['REQUEST_REVISION', 'REJECT', 'CANCEL'];

export function actionLabel(a) { return (ACTION_META[a] || { label: a }).label; }

/** 只渲染服务端允许的动作（allowedActions），不自行发明可执行路径 */
export function decisionButtons(c, attrs) {
  const a = attrs || {};
  const dataCase = a.dataCase || 'data-case="' + esc(c.id) + '"';
  const acts = c.allowedActions || [];
  return acts.filter((x) => ACTION_META[x]).map((x) =>
    '<button class="' + ACTION_META[x].cls + ' btn-sm" data-dec="' + esc(x) + '" ' + dataCase + '>'
    + esc(ACTION_META[x].label) + '</button>').join('');
}

/* ---------------- API 客户端（唯一入口） ---------------- */

export async function fetchReviewCases(brand, filter) {
  const f = filter || {};
  return api.get(withBrand('/api/mos/review-cases', brand, {
    type: f.type || '', mine: f.mine ? 1 : '', open: f.open ? 1 : '', pageSize: f.pageSize || 200
  }));
}

export async function fetchReviewCaseDetail(id, brand) {
  return api.get(withBrand('/api/mos/review-cases/' + id, brand));
}

export async function submitReviewDecision(caseId, brand, action, remarks, extra) {
  const body = Object.assign({ action, remarks: remarks || '' }, extra || {});
  return api.post(withBrand('/api/mos/review-cases/' + caseId + '/decision', brand), body);
}

export async function fetchReviewHistory(brand, extra) {
  return api.get(withBrand('/api/mos/review-history', brand, Object.assign({ pageSize: 200 }, extra || {})));
}

/* ---------------- 渲染 ---------------- */

export function reviewSummaryCards(summary) {
  const s = summary || {};
  const card = (label, n) => '<div class="card"><div class="card-body"><div class="small muted">' + esc(label) + '</div>'
    + '<div style="font-size:26px;font-weight:600;color:var(--navy)">' + (n || 0) + '</div></div></div>';
  return '<div class="grid grid-3" style="margin-bottom:12px">'
    + card('专业审核待办', (s.professional || {}).open)
    + card('发布审批待办', (s.publication || {}).open)
    + card('入库审核待办', (s.admission || {}).open) + '</div>';
}

export function reviewFiltersHtml(filter) {
  const f = filter || {};
  return '<div class="filters">'
    + '<label class="row" style="gap:5px"><input type="checkbox" id="rvMine"' + (f.mine ? ' checked' : '') + '> 仅我可裁决</label>'
    + '<label class="row" style="gap:5px"><input type="checkbox" id="rvOpen"' + (f.open ? ' checked' : '') + '> 仅未终结</label>'
    + '<select id="rvType" aria-label="审核类型"><option value="">全部审核类型</option>'
    + REVIEW_TYPES.map((t) => '<option value="' + esc(t.code) + '"' + (f.type === t.code ? ' selected' : '') + '>'
      + esc(t.label) + '</option>').join('')
    + '</select></div>';
}

/** 绑定筛选控件（change 即回调，便于两处复用同一交互） */
export function bindReviewFilters(el, filter, onChange) {
  const mi = el.querySelector('#rvMine');
  const op = el.querySelector('#rvOpen');
  const ty = el.querySelector('#rvType');
  if (mi) mi.addEventListener('change', () => { filter.mine = mi.checked; onChange(); });
  if (op) op.addEventListener('change', () => { filter.open = op.checked; onChange(); });
  if (ty) ty.addEventListener('change', () => { filter.type = ty.value; onChange(); });
}

/** 审核卡片（列表项）。两处入口共用同一张卡，避免状态规则分叉。 */
export function reviewCard(c) {
  const s = c.subject || {};
  return '<div class="review-card">'
    + '<div class="rc-head">'
    + '<div><span class="rc-title">' + esc(caseTypeLabel(c.type)) + '</span> '
    + statusBadge(c.state) + ' ' + gradeBadge(c.riskGrade) + demoBadge(c.demo) + '</div>'
    + '<div class="small muted">' + esc(relTime(c.submittedAt)) + '</div></div>'
    + '<div class="small" style="margin-top:5px">'
    + '<span class="mono">' + esc(s.code || '—') + '</span> ' + esc(s.title || '') + '</div>'
    + '<div class="small muted">提交人 ' + esc(c.submitterName || c.submittedBy || '—')
    + ' · 对象状态 ' + esc(s.state || '—')
    + ' · Manifest <span class="mono">' + esc(String(c.versionHash || '').slice(0, 12)) + '</span></div>'
    + (c.requirements && c.requirements.length ? '<div class="small" style="color:var(--warn)">要求：' + esc(c.requirements.join('；')) + '</div>' : '')
    + (c.canDecide ? '' : '<div class="small diff-warn" style="margin-top:5px">不可裁决：' + esc((c.decideBlockedReasons || []).join('；')) + '</div>')
    + '<div class="rc-actions">'
    + '<button class="btn btn-sm" data-open-case="' + esc(c.id) + '">查看批准对象</button>'
    + (c.canDecide ? decisionButtons(c) : '')
    + '</div></div>';
}

export function reviewListHtml(cases, filter) {
  if (!cases || !cases.length) {
    return stateBlock('empty', {
      title: (filter && filter.mine) ? '没有需要我裁决的审核单' : '没有符合条件的审核单',
      desc: '内容送审后会自动生成审核单；创建者不能裁决自己创建的内容（职责分离）。'
    }).html;
  }
  return cases.map(reviewCard).join('');
}

/** 审核决策历史表（W08-02，append-only） */
export function reviewHistoryTable(items) {
  if (!items || !items.length) {
    return stateBlock('empty', { title: '还没有审核决策', desc: '任何审核裁决都会在这里留下不可改写的记录。' }).html;
  }
  return '<div class="table-wrap"><table class="tbl"><thead><tr>'
    + '<th>时间</th><th>审核链</th><th>动作</th><th>主体</th><th>裁决人</th><th>权限快照</th><th>备注</th></tr></thead><tbody>'
    + items.map((d) => '<tr>'
      + '<td class="small mono">' + esc(fmtDateTime(d.createdAt)) + '</td>'
      + '<td class="small">' + esc(caseTypeLabel(d.type)) + '</td>'
      + '<td class="small"><b>' + esc(d.action) + '</b><br><span class="muted">'
      + esc(d.previousState || '') + (d.newState ? ' → ' + esc(d.newState) : '') + '</span></td>'
      + '<td class="mono small">' + esc(d.subjectId) + '</td>'
      + '<td class="small">' + esc(d.actorName || d.actorId) + '</td>'
      + '<td class="small muted">' + esc((d.actingAuthority || []).join(' / ')) + '</td>'
      + '<td class="small">' + esc(String(d.remarks || '').slice(0, 80)) + '</td></tr>').join('')
    + '</tbody></table></div>';
}

/** 资产入库状态徽标（供 Governance 与 Review 详情共用） */
export function admissionStateBadge(a) {
  const cls = {
    WORKING: 'badge-neutral', SUBMITTED: 'badge-info', PRECHECK: 'badge-info', REVIEWING: 'badge-info',
    FINAL_APPROVAL_PENDING: 'badge-warn', FINAL_APPROVAL_GRANTED: 'badge-ok',
    REJECTED: 'badge-danger', LIBRARY_SYNC_PENDING: 'badge-info',
    SYNC_COMPLETED: 'badge-ok', SYNC_FAILED: 'badge-danger', AVAILABLE: 'badge-ok'
  }[a.state] || 'badge-neutral';
  return '<span class="badge ' + cls + '">' + esc(a.state) + '</span>';
}

/* ---------------- 详情与裁决 ---------------- */

/** 审核详情模态框：显示"批准的到底是哪一版"（冻结 vs 实时重算）。 */
export async function openReviewCase(id, brand) {
  let d;
  try { d = await fetchReviewCaseDetail(id, brand); } catch (err) { toast(err.message, 'err'); return; }
  const c = d.case; const s = d.subjectSnapshot || {};
  const mismatch = s.manifestMatches === false;
  openModal({
    title: '批准对象：' + (s.code || s.title || c.id), okText: '关闭',
    body: (mismatch ? '<div class="block-note danger"><b>批准对象已变化。</b>冻结的 Manifest 与当前实时重算值不一致，'
      + '任何审批动作都会被服务端拒绝（SEC-02）。请退回并重新送审。</div>' : '')
      + '<dl class="kv">'
      + '<dt>审核类型</dt><dd>' + esc(caseTypeLabel(c.type)) + '</dd>'
      + '<dt>审核状态</dt><dd>' + statusBadge(c.state) + '</dd>'
      + '<dt>风险等级</dt><dd>' + gradeBadge(c.riskGrade) + '</dd>'
      + '<dt>策略版本</dt><dd class="mono small">' + esc(c.policyVersion) + '</dd>'
      + '<dt>冻结哈希</dt><dd class="mono small" style="word-break:break-all">' + esc(c.versionHash) + '</dd>'
      + '<dt>当前哈希</dt><dd class="mono small" style="word-break:break-all">' + esc(s.manifestNow || '—') + '</dd>'
      + '<dt>是否一致</dt><dd>' + (mismatch ? '<span class="badge badge-danger">不一致</span>' : '<span class="badge badge-ok">一致</span>') + '</dd>'
      + '<dt>作者</dt><dd>' + esc(s.authorName || '—') + '</dd>'
      + '</dl>'
      + (s.body !== undefined ? '<div class="divider"></div><div class="small muted">正文（批准对象）</div>'
        + '<pre class="mono small" style="white-space:pre-wrap;background:var(--muted);padding:9px;border-radius:7px;max-height:220px;overflow:auto">' + esc(s.body || '（空）') + '</pre>' : '')
      + (s.assets && s.assets.length ? '<div class="small muted">引用资产</div>'
        + s.assets.map((a) => '<div class="checkline no"><span class="ck">·</span><span>' + esc(a.fileName || a.id)
          + ' <span class="mono muted">' + esc(String(a.sha256 || '').slice(0, 10)) + '</span>'
          + (a.mock ? ' <span class="badge badge-mock">MOCK</span>' : '') + '</span></div>').join('') : '')
      + (s.evidence && s.evidence.length ? '<div class="small muted" style="margin-top:6px">证据引用</div>'
        + s.evidence.map((e) => '<div class="checkline no"><span class="ck">·</span><span>' + esc(e.claimLocator || e.id)
          + ' ' + statusBadge(e.verificationState) + '</span></div>').join('') : '')
      + '<div class="divider"></div><div class="small muted">' + esc(d.policyNote || '') + '</div>'
      + ((c.decisions || []).length ? '<div class="divider"></div><div class="small muted">决策记录</div>'
        + c.decisions.map((x) => '<div class="checkline no"><span class="ck">·</span><span>' + esc(x.action)
          + ' · ' + esc(x.actorName || x.actorId) + ' · ' + esc(fmtDateTime(x.createdAt))
          + (x.remarks ? '<br><span class="muted">' + esc(x.remarks) + '</span>' : '') + '</span></div>').join('') : '')
  });
}

/** 裁决对话框：原因必填规则集中在此，两处入口共用。 */
export function decideReviewCase(opts) {
  const o = opts || {};
  const action = o.action;
  const label = actionLabel(action);
  const needRemarks = REMARKS_REQUIRED_ACTIONS.indexOf(action) !== -1;
  openModal({
    title: (o.titlePrefix ? o.titlePrefix + ' · ' : '') + label, okText: label,
    body: (action === 'APPROVE'
      ? '<div class="block-note info">批准仅对<b>当前冻结的 Manifest</b>生效。若正文或引用资产已变化，服务端会直接拒绝（SEC-02）。'
        + '发布审批还需要同版本的专业审核已通过。</div>'
      : '') + '<label class="field"><span>意见' + (needRemarks ? '（必填）' : '（可选）') + '</span>'
      + '<textarea id="dcR" class="ed-body" style="min-height:90px"></textarea></label>',
    onOk: async (b) => {
      const remarks = b.querySelector('#dcR').value.trim();
      if (needRemarks && !remarks) { toast('必须填写原因', 'err'); return false; }
      try {
        await submitReviewDecision(o.caseId, o.brand, action, remarks, o.extraBody);
        toast('已提交：' + label, 'ok');
        if (o.onDone) await o.onDone();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}
