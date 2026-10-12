/* My Reviews —— 我的审核（W08-01 / 01 §3 三条独立审批链）。
 *
 * 关键不变量：
 *   - 三条链相互独立（专业 / 发布 / 入库），**不存在单一 approved 标志位**；
 *   - 职责分离：创建者不能审批自己创建的内容版本（服务端强制，前端提前告知）；
 *   - 审批对象是**冻结的 Manifest**：详情页同时显示冻结哈希与实时重算值，不一致即会被拒（SEC-02）；
 *   - G3 需提升授权角色。
 */
import { api, withBrand } from '../api.js';
import {
  esc, toast, openModal, loadingHtml, stateBlock, statusBadge, gradeBadge,
  fmtDateTime, relTime, demoBadge
} from '../ui.js';

let ctxRef = null; let hostEl = null;
let filter = { type: '', mine: true, open: true };
let cases = []; let summary = {};

function bodyEl() { return hostEl.querySelector('#mosBody') || hostEl; }
function setBody(html) { bodyEl().innerHTML = html; }

function renderError(err, retry) {
  const kind = err.status === 403 || err.status === 404 ? 'denied' : 'error';
  const s = stateBlock(kind, { title: err.status === 403 ? '权限不足' : '加载失败', desc: err.message,
    actions: retry ? [{ label: '重试', primary: true, onClick: retry }] : [] });
  setBody(s.html); s.bind(bodyEl());
}

function head() {
  return '<div class="page-head"><div class="crumb">Governance / My Reviews</div>'
    + '<div class="ph-row"><h1>我的审核</h1>'
    + '<div class="ph-actions"><button class="btn btn-sm" id="rvRefresh">刷新</button></div></div>'
    + '<div class="ph-desc">三条审批链相互独立：专业（金融事实）审核 / 发布审批 / 资产入库审核。'
    + '批准对象是冻结的 Manifest 哈希，事后改动正文或引用资产会导致审批被拒（SEC-02）。</div></div>';
}

async function render() {
  hostEl.innerHTML = head() + '<div id="mosBody">' + loadingHtml() + '</div>';
  try {
    const r = await api.get(withBrand('/api/mos/review-cases', ctxRef.brand, {
      type: filter.type, mine: filter.mine ? 1 : '', open: filter.open ? 1 : '', pageSize: 200
    }));
    cases = r.items || []; summary = r.summary || {};
  } catch (err) { renderError(err, render); return; }
  paint();
  const rf = hostEl.querySelector('#rvRefresh');
  if (rf) rf.addEventListener('click', render);
}

function paint() {
  let h = '<div class="filters">'
    + '<label class="row" style="gap:5px"><input type="checkbox" id="rvMine"' + (filter.mine ? ' checked' : '') + '> 仅我可裁决</label>'
    + '<label class="row" style="gap:5px"><input type="checkbox" id="rvOpen"' + (filter.open ? ' checked' : '') + '> 仅未终结</label>'
    + '<select id="rvType"><option value="">全部审核类型</option>'
    + '<option value="PROFESSIONAL_REVIEW"' + (filter.type === 'PROFESSIONAL_REVIEW' ? ' selected' : '') + '>专业（金融事实）审核</option>'
    + '<option value="PUBLICATION_APPROVAL"' + (filter.type === 'PUBLICATION_APPROVAL' ? ' selected' : '') + '>发布审批</option>'
    + '<option value="ASSET_ADMISSION"' + (filter.type === 'ASSET_ADMISSION' ? ' selected' : '') + '>资产入库审核</option>'
    + '</select><span class="pill">共 ' + cases.length + '</span></div>';

  h += '<div class="grid grid-3" style="margin-bottom:12px">'
    + card('专业审核待办', (summary.professional || {}).open || 0)
    + card('发布审批待办', (summary.publication || {}).open || 0)
    + card('入库审核待办', (summary.admission || {}).open || 0) + '</div>';

  h += '<div class="card"><div class="card-head"><h2>审核单</h2></div><div class="card-body">';
  if (!cases.length) {
    h += stateBlock('empty', {
      title: filter.mine ? '没有需要我裁决的审核单' : '没有符合条件的审核单',
      desc: '内容送审后会自动生成审核单；创建者不能裁决自己创建的内容（职责分离）。'
    }).html;
  } else {
    h += cases.map((c) => {
      const s = c.subject || {};
      return '<div class="review-card">'
        + '<div class="rc-head">'
        + '<div><span class="rc-title">' + esc(caseTypeLabel(c.type)) + '</span> '
        + statusBadge(c.state) + ' ' + gradeBadge(c.riskGrade) + demoBadge(c.demo) + '</div>'
        + '<div class="small muted">' + esc(relTime(c.submittedAt)) + '</div></div>'
        + '<div class="small" style="margin-top:5px">'
        + '<span class="mono">' + esc(s.code || '—') + '</span> ' + esc(s.title || '') + '</div>'
        + '<div class="small muted">提交人 ' + esc(c.submitterName || c.submittedBy || '—')
        + ' · 版本状态 ' + esc(s.state || '—')
        + ' · Manifest <span class="mono">' + esc(String(c.versionHash || '').slice(0, 12)) + '</span></div>'
        + (c.requirements && c.requirements.length ? '<div class="small" style="color:var(--warn)">要求：' + esc(c.requirements.join('；')) + '</div>' : '')
        + (c.canDecide ? '' : '<div class="small diff-warn" style="margin-top:5px">不可裁决：' + esc((c.decideBlockedReasons || []).join('；')) + '</div>')
        + '<div class="rc-actions">'
        + '<button class="btn btn-sm" data-open="' + esc(c.id) + '">查看批准对象</button>'
        + (c.canDecide ? decisionButtons(c) : '')
        + '</div></div>';
    }).join('');
  }
  h += '</div></div>';
  setBody(h);
  bind();
}

function card(label, n) {
  return '<div class="card"><div class="card-body"><div class="small muted">' + esc(label) + '</div>'
    + '<div style="font-size:26px;font-weight:600;color:var(--navy)">' + n + '</div></div></div>';
}

function caseTypeLabel(t) {
  return { PROFESSIONAL_REVIEW: '专业（金融事实）审核', PUBLICATION_APPROVAL: '发布审批', ASSET_ADMISSION: '资产入库审核' }[t] || t;
}

/** 只渲染服务端允许的动作（allowedActions），不自行发明可执行路径 */
function decisionButtons(c) {
  const acts = c.allowedActions || [];
  const map = { START_REVIEW: ['开始审核', 'btn'], APPROVE: ['批准', 'btn btn-primary'], REQUEST_REVISION: ['要求修订', 'btn'], REJECT: ['驳回', 'btn btn-danger'], CANCEL: ['取消', 'btn'] };
  return acts.filter((a) => map[a]).map((a) => '<button class="' + map[a][1] + ' btn-sm" data-dec="' + esc(a) + '" data-case="' + esc(c.id) + '">' + esc(map[a][0]) + '</button>').join('');
}

function bind() {
  hostEl.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openCase(b.dataset.open)));
  hostEl.querySelectorAll('[data-dec]').forEach((b) => b.addEventListener('click', () => decide(b.dataset.case, b.dataset.dec)));
  const mi = hostEl.querySelector('#rvMine'); if (mi) mi.addEventListener('change', () => { filter.mine = mi.checked; render(); });
  const op = hostEl.querySelector('#rvOpen'); if (op) op.addEventListener('change', () => { filter.open = op.checked; render(); });
  const ty = hostEl.querySelector('#rvType'); if (ty) ty.addEventListener('change', () => { filter.type = ty.value; render(); });
}

async function openCase(id) {
  let d;
  try { d = await api.get(withBrand('/api/mos/review-cases/' + id, ctxRef.brand)); }
  catch (err) { toast(err.message, 'err'); return; }
  const c = d.case; const s = d.subjectSnapshot || {};
  const mismatch = s.manifestMatches === false;
  openModal({
    title: '批准对象：' + (s.code || c.id), okText: '关闭',
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
      + '<dt>正文哈希</dt><dd class="mono small">' + esc(String(s.textHash || '').slice(0, 24)) + '</dd>'
      + '<dt>作者</dt><dd>' + esc((s.authorName || '—')) + '</dd>'
      + '</dl>'
      + '<div class="divider"></div>'
      + '<div class="small muted">正文（批准对象）</div>'
      + '<pre class="mono small" style="white-space:pre-wrap;background:var(--muted);padding:9px;border-radius:7px;max-height:220px;overflow:auto">' + esc(s.body || '（空）') + '</pre>'
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

function decide(caseId, action) {
  const needRemarks = ['REQUEST_REVISION', 'REJECT', 'CANCEL'].indexOf(action) !== -1;
  const label = { START_REVIEW: '开始审核', APPROVE: '批准', REQUEST_REVISION: '要求修订', REJECT: '驳回', CANCEL: '取消' }[action] || action;
  openModal({
    title: label, okText: label,
    body: (action === 'APPROVE'
      ? '<div class="block-note info">批准仅对<b>当前冻结的 Manifest</b>生效。若正文或引用资产已变化，服务端会直接拒绝（SEC-02）。'
        + '发布审批还需要同版本的专业审核已通过。</div>'
      : '') + '<label class="field"><span>意见' + (needRemarks ? '（必填）' : '（可选）') + '</span>'
      + '<textarea id="dcR" class="ed-body" style="min-height:90px"></textarea></label>',
    onOk: async (b) => {
      const remarks = b.querySelector('#dcR').value.trim();
      if (needRemarks && !remarks) { toast('必须填写原因', 'err'); return false; }
      try {
        await api.post(withBrand('/api/mos/review-cases/' + caseId + '/decision', ctxRef.brand), { action, remarks });
        toast('已提交：' + label, 'ok');
        await render();
      } catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

export default {
  async mount(host, ctx) { ctxRef = ctx; hostEl = host; await render(); },
  unmount() { hostEl = null; },
  hasUnsaved() { return false; }
};
