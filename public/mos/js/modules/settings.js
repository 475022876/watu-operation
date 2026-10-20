/* 系统接入（Provider 配置中心）—— V0.1.4。
 *
 * 谁用：技术管理员（settings.manage）。业务同事看不到这个页面，也不需要理解这些参数。
 *
 * 设计取舍（与 01 §UI 减法原则一致）：
 *   - **一屏一卡**：网页检索 / 大语言模型 / 图像 / 视频，各一张卡，顺序按业务价值排；
 *   - 密钥**只写不读**：输入框永远空白，占位符显示掩码（sk-••••••••1a2b）；
 *   - 连接测试会**真实出站并可能计费** → 必须二次确认，且 8 秒内不可重复；
 *   - 所有"未配置/未联调"都如实显示，不用绿色对勾糊过去。
 */
import { api } from '../api.js';
import { esc, toast, loadingHtml, stateBlock, confirmDialog, fmtDateTime } from '../ui.js';
import { t, readinessLabel } from '../i18n.js';

let hostEl = null;
let ctxRef = null;
let data = null;
let usage = null;
let busy = false;
let usageDays = 30;

const ORDER = ['websearch', 'text', 'image', 'video'];
const ICON = { websearch: '☍', text: '✎', image: '✦', video: '▶' };

function badgeCls(r) {
  if (r === 'REAL') return 'badge badge-ok';
  if (r === 'CONFIGURED_NOT_TESTED') return 'badge badge-warn';
  if (r === 'NOT_IMPLEMENTED') return 'badge badge-danger';
  return 'badge';
}

function num(id, value, step) {
  return '<input class="input" type="number" id="' + id + '" value="' + esc(value === undefined || value === null ? '' : value) + '"'
    + (step ? ' step="' + step + '"' : '') + ' min="0">';
}

function row(label, control, hint, hintId) {
  return '<div class="field"><label class="label">' + esc(label) + '</label>' + control
    + (hint ? '<div class="small muted"' + (hintId ? ' id="' + esc(hintId) + '"' : '') + '>' + esc(hint) + '</div>' : '') + '</div>';
}

function modeOptions(k) {
  return k.modes.map((m) => '<option value="' + esc(m.id) + '"' + (m.id === k.mode ? ' selected' : '') + '>'
    + esc(m.label) + (m.needsKey ? ' · 需密钥' : '') + (m.costBearing ? ' · 计费' : '')
    + (m.freeTier ? ' · 有免费额度' : '') + '</option>').join('');
}

/** 模式说明 + 免费档提示（免费档由服务端下发，页面不自行编造额度） */
function modeHint(m) {
  const parts = [];
  if (m && m.note) parts.push(m.note);
  if (m && m.freeTier) parts.push('免费档：' + m.freeTier + '（以厂商控制台为准）');
  return parts.join(' ｜ ');
}

function currentMode(k) {
  return (k.modes || []).find((m) => m.id === k.mode) || {};
}

function card(k) {
  const m = currentMode(k);
  const locked = k.lockedByEnv || {};
  const ro = (f) => (locked[f] ? ' disabled' : '');
  const envNote = locked.mode || locked.apiKey
    ? '<div class="notice small">' + esc(t('settings.locked_env')) + '</div>' : '';

  let extra = '';
  if (k.kind === 'text') {
    extra = row(t('settings.price_in'), num('s-text-priceIn', k.pricePerMTokIn, '0.01'),
      t('settings.price_hint'))
      + row(t('settings.price_out'), num('s-text-priceOut', k.pricePerMTokOut, '0.01'), '')
      + row(t('settings.max_tokens'), num('s-text-maxTokens', k.maxTokens, '1'), '')
      + row(t('settings.temperature'), num('s-text-temperature', k.temperature, '0.1'), '');
  } else if (k.kind === 'websearch') {
    extra = row(t('settings.max_results'), num('s-websearch-maxResults', k.maxResults, '1'), '')
      + row(t('settings.cx'), '<input class="input" id="s-websearch-cx" value="' + esc(k.cx || '') + '"'
        + ' placeholder="' + esc(t('settings.cx_hint')) + '">', '')
      + row(t('settings.lang'), '<input class="input" id="s-websearch-lang" value="' + esc(k.lang || '') + '" placeholder="en / zh-CN">', '');
  } else if (k.kind === 'video') {
    extra = row(t('settings.duration'), num('s-video-durationSec', k.durationSec, '1'), t('settings.duration_hint'))
      + row(t('settings.poll_interval'), num('s-video-pollIntervalMs', k.pollIntervalMs, '500'), '')
      + row(t('settings.max_poll'), num('s-video-maxPollMs', k.maxPollMs, '1000'), '');
  }

  const keyField = '<div class="field"><label class="label">' + esc(t('settings.key')) + '</label>'
    + '<input class="input" type="password" id="s-' + k.kind + '-key" autocomplete="new-password"'
    + ' placeholder="' + esc(k.hasKey ? (k.keyMask || '••••••••') : t('settings.key_hint')) + '"' + ro('apiKey') + '>'
    + '<div class="small muted">'
    + (k.hasKey
      ? esc(t('settings.key_saved', { mask: k.keyMask || '', fp: k.keyFingerprint || '' }))
        + (k.keySource === 'env' ? ' · ' + esc(t('settings.key_from_env')) : '')
      : esc(t('settings.key_none')))
    + (k.keyError ? ' · <span style="color:var(--danger,#c00)">' + esc(k.keyError) + '</span>' : '')
    + '</div></div>';

  return '<div class="card" data-kind="' + k.kind + '">'
    + '<div class="card-head" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<span style="font-size:16px">' + ICON[k.kind] + '</span>'
    + '<strong>' + esc(t('settings.kind_' + k.kind)) + '</strong>'
    + '<span class="' + badgeCls(k.readiness) + '">' + esc(readinessLabel(k.readiness)) + '</span>'
    + '<span class="small muted">' + esc(k.readinessReason || '') + '</span>'
    + '</div><div class="card-body">'
    + '<div class="small muted" style="margin-bottom:8px">' + esc(t('settings.purpose_' + k.kind)) + '</div>'
    + envNote
    + row(t('settings.mode'), '<select class="input" id="s-' + k.kind + '-mode"' + ro('mode') + '>' + modeOptions(k) + '</select>',
      modeHint(m), 's-' + k.kind + '-mode-hint')
    + row(t('settings.endpoint'),
      '<input class="input" id="s-' + k.kind + '-baseUrl" value="' + esc(k.baseUrl || '') + '"'
      + ' placeholder="' + esc(m.defaultBaseUrl || 'https://…') + '"' + ro('baseUrl') + '>',
      t('settings.endpoint_hint'))
    + (k.kind === 'websearch' ? '' : row(t('settings.model'),
      '<input class="input" id="s-' + k.kind + '-model" value="' + esc(k.model || '') + '"'
      + ' placeholder="' + esc(m.modelHint || '') + '"' + ro('model') + '>',
      t('settings.model_hint')))
    + row(t('settings.timeout'), num('s-' + k.kind + '-timeoutMs', k.timeoutMs, '500'), '')
    + row(t('settings.retries'), num('s-' + k.kind + '-maxRetries', k.maxRetries, '1'), t('settings.retries_hint'))
    + extra
    + keyField
    + '<div class="row" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'
    + '<button class="btn btn-primary" data-act="save" data-kind="' + k.kind + '">' + esc(t('settings.save')) + '</button>'
    + '<button class="btn" data-act="test" data-kind="' + k.kind + '"' + (m.probe ? '' : ' disabled') + '>'
    + esc(t('settings.test')) + '</button>'
    + (k.hasKey ? '<button class="btn" data-act="clear" data-kind="' + k.kind + '">' + esc(t('settings.clear_key')) + '</button>' : '')
    + (m.docsUrl ? '<a class="btn" href="' + esc(m.docsUrl) + '" target="_blank" rel="noopener">'
      + esc(t('settings.docs')) + '</a>' : '')
    + '</div>'
    + (k.updatedAt ? '<div class="small muted" style="margin-top:8px">' + esc(t('settings.last_updated',
      { at: fmtDateTime(k.updatedAt), by: k.updatedBy || '—' })) + '</div>' : '')
    + '</div></div>';
}

function budgetCard(b) {
  return '<div class="card"><div class="card-head"><strong>' + esc(t('settings.budget')) + '</strong></div>'
    + '<div class="card-body">'
    + '<div class="small muted" style="margin-bottom:8px">' + esc(t('settings.budget_note')) + '</div>'
    + row(t('settings.budget_month'), num('s-budget-month', b.brandMonthlyUsd, '0.01'), '')
    + row(t('settings.budget_job'), num('s-budget-job', b.perJobUsdMax, '0.0001'), '')
    + '<button class="btn btn-primary" data-act="save-budget">' + esc(t('settings.save')) + '</button>'
    + '</div></div>';
}

function policyCard(p) {
  return '<div class="card"><div class="card-head"><strong>' + esc(t('settings.data_policy')) + '</strong></div>'
    + '<div class="card-body">'
    + '<div class="small muted" style="margin-bottom:8px">' + esc(t('settings.policy_note')) + '</div>'
    + '<label class="check"><input type="checkbox" id="s-pol-conf"' + (p.allowConfidential ? ' checked' : '') + '> '
    + esc(t('settings.allow_confidential')) + '</label>'
    + '<label class="check" style="display:block;margin:6px 0"><input type="checkbox" id="s-pol-rest"' + (p.allowRestricted ? ' checked' : '') + '> '
    + esc(t('settings.allow_restricted')) + '</label>'
    + row(t('settings.ack_by'), '<input class="input" id="s-pol-ack" value="' + esc(p.acknowledgedBy || '') + '"'
      + ' placeholder="' + esc(t('settings.ack_hint')) + '">', '')
    + '<button class="btn btn-primary" data-act="save-policy">' + esc(t('settings.save')) + '</button>'
    + '</div></div>';
}

function usageCard(u) {
  if (!u) return '';
  const s = u.summary;
  const cur = u.budget.currency || 'USD';
  const kinds = Object.keys(s.byKind || {});
  const rows = kinds.length
    ? kinds.map((k) => '<tr><td>' + esc(t('settings.kind_' + k)) + '</td><td class="mono">' + s.byKind[k].calls + '</td>'
      + '<td class="mono">' + s.byKind[k].failed + '</td>'
      + '<td class="mono">' + (s.byKind[k].tokens || 0) + '</td></tr>').join('')
    : '<tr><td colspan="4" class="muted">' + esc(t('settings.usage_empty')) + '</td></tr>';
  return '<div class="card"><div class="card-head" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    + '<strong>' + esc(t('settings.usage')) + '</strong>'
    + '<select class="input" id="s-usage-days" style="width:auto;margin-left:auto">'
    + [7, 30, 90].map((d) => '<option value="' + d + '"' + (d === usageDays ? ' selected' : '') + '>'
      + esc(t('settings.last_days', { d })) + '</option>').join('')
    + '</select></div><div class="card-body">'
    + '<div class="grid grid-4">'
    + '<div><div class="small muted">' + esc(t('settings.usage_calls')) + '</div><div style="font-size:20px" class="mono">' + s.total + '</div></div>'
    + '<div><div class="small muted">' + esc(t('settings.usage_success')) + '</div><div style="font-size:20px" class="mono">'
    + (s.total ? Math.round((s.ok / s.total) * 100) : 0) + '%</div></div>'
    + '<div><div class="small muted">' + esc(t('settings.usage_p95')) + '</div><div style="font-size:20px" class="mono">'
    + (s.latency.p95 === null ? '—' : s.latency.p95 + 'ms') + '</div></div>'
    + '<div><div class="small muted">' + esc(t('settings.usage_cost')) + '</div><div style="font-size:20px" class="mono">'
    + (s.cost.confirmedSum ? (cur + ' ' + s.cost.confirmedSum) : '—') + '</div></div>'
    + '</div>'
    + '<div class="small muted" style="margin:8px 0">' + esc(t('settings.usage_unknown', { n: s.cost.unknownCount })) + '</div>'
    + '<table class="table"><thead><tr><th>' + esc(t('settings.col_kind')) + '</th><th>' + esc(t('settings.col_calls'))
    + '</th><th>' + esc(t('settings.col_failed')) + '</th><th>' + esc(t('settings.col_tokens')) + '</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table>'
    + '</div></div>';
}

function render() {
  if (!hostEl) return;
  if (!data) { hostEl.innerHTML = loadingHtml(); return; }
  const kinds = data.kinds || [];
  const byId = {};
  for (const k of kinds) byId[k.kind] = k;
  const cards = ORDER.filter((x) => byId[x]).map((x) => card(byId[x])).join('');
  const sec = data.secrets || {};
  const eg = data.egress || {};
  hostEl.innerHTML = '<div class="page">'
    + '<div class="page-head"><h2>' + esc(t('settings.title')) + '</h2>'
    + '<div class="small muted">' + esc(t('settings.intro')) + '</div></div>'
    + '<div class="notice">' + esc(t('settings.security_note')) + '</div>'
    + '<div class="notice small">' + esc(t('settings.secret_state',
      { src: sec.source || '—', fp: sec.keyFingerprint || '—' })) + '</div>'
    + '<div class="grid grid-2">' + cards + '</div>'
    + '<div class="grid grid-2">' + budgetCard(data.budget || {}) + policyCard(data.dataPolicy || {}) + '</div>'
    + '<div class="notice small">' + esc(t('settings.egress_state',
      { host: eg.providerHostAllowlist || 0, prod: eg.production ? '1' : '0' })) + '</div>'
    + usageCard(usage)
    + '</div>';
}

/* ---------------- 数据加载 ---------------- */

async function loadAll() {
  const r = await api.get('/api/mos/settings/providers');
  data = r.settings;
  try {
    const u = await api.get('/api/mos/settings/usage?days=' + usageDays);
    usage = u.usage;
  } catch (_) { usage = null; }
}

/* ---------------- 交互 ---------------- */

function val(kind, field) {
  const el = hostEl.querySelector('#s-' + kind + '-' + field);
  return el ? el.value.trim() : undefined;
}

async function onSave(kind) {
  const body = {
    mode: val(kind, 'mode'),
    baseUrl: val(kind, 'baseUrl'),
    timeoutMs: Number(val(kind, 'timeoutMs')) || undefined,
    maxRetries: Number(val(kind, 'maxRetries'))
  };
  if (kind !== 'websearch') body.model = val(kind, 'model');
  if (kind === 'text') {
    body.pricePerMTokIn = Number(val(kind, 'priceIn')) || 0;
    body.pricePerMTokOut = Number(val(kind, 'priceOut')) || 0;
    body.maxTokens = Number(val(kind, 'maxTokens')) || undefined;
    body.temperature = Number(val(kind, 'temperature')) || 0;
  } else if (kind === 'websearch') {
    body.maxResults = Number(val(kind, 'maxResults')) || undefined;
    body.cx = val(kind, 'cx');
    body.lang = val(kind, 'lang');
  } else if (kind === 'video') {
    body.durationSec = Number(val(kind, 'durationSec')) || undefined;
    body.pollIntervalMs = Number(val(kind, 'pollIntervalMs')) || undefined;
    body.maxPollMs = Number(val(kind, 'maxPollMs')) || undefined;
  }
  const key = val(kind, 'key');
  if (key) body.apiKey = key;
  await api.put('/api/mos/settings/providers/' + kind, body);
  toast(t('settings.saved'), 'ok');
  await loadAll();
  render();
}

async function onTest(kind) {
  const okc = await confirmDialog(t('settings.test'), t('settings.test_confirm'), t('settings.test'));
  if (!okc) return;
  toast(t('settings.testing'), 'ok');
  try {
    const r = await api.post('/api/mos/settings/providers/' + kind + '/test', {});
    if (r.ok) toast(t('settings.test_ok', { ms: r.latencyMs || 0 }), 'ok');
    else toast((r.message || r.code || t('settings.test_failed')), 'err');
  } catch (err) {
    toast(err.message, 'err');
  }
  await loadAll();
  render();
}

async function onClear(kind) {
  const okc = await confirmDialog(t('settings.clear_key'), t('settings.clear_confirm'), t('settings.clear_key'));
  if (!okc) return;
  await api.del('/api/mos/settings/providers/' + kind + '/key');
  toast(t('settings.cleared'), 'ok');
  await loadAll();
  render();
}

async function onSaveBudget() {
  const month = Number((hostEl.querySelector('#s-budget-month') || {}).value) || 0;
  const job = Number((hostEl.querySelector('#s-budget-job') || {}).value) || 0;
  const r = await api.put('/api/mos/settings/budget', { brandMonthlyUsd: month, perJobUsdMax: job });
  data.budget = r.budget;
  toast(t('settings.saved'), 'ok');
  render();
}

async function onSavePolicy() {
  const allowConfidential = !!(hostEl.querySelector('#s-pol-conf') || {}).checked;
  const allowRestricted = !!(hostEl.querySelector('#s-pol-rest') || {}).checked;
  const acknowledgedBy = ((hostEl.querySelector('#s-pol-ack') || {}).value || '').trim();
  const r = await api.put('/api/mos/settings/data-policy', { allowConfidential, allowRestricted, acknowledgedBy });
  data.dataPolicy = r.dataPolicy;
  toast(t('settings.saved'), 'ok');
  render();
}

async function onClick(ev) {
  const btn = ev.target.closest('[data-act]');
  if (!btn || busy) return;
  const act = btn.getAttribute('data-act');
  const kind = btn.getAttribute('data-kind');
  busy = true;
  btn.disabled = true;
  try {
    if (act === 'save') await onSave(kind);
    else if (act === 'test') await onTest(kind);
    else if (act === 'clear') await onClear(kind);
    else if (act === 'save-budget') await onSaveBudget();
    else if (act === 'save-policy') await onSavePolicy();
  } catch (err) {
    toast(err.message, 'err');
  } finally {
    busy = false;
    btn.disabled = false;
  }
}

async function onChange(ev) {
  /* 切换接入方式：就地更新占位符与提示（不整页重渲染，避免清掉用户已填但未保存的内容） */
  const id = ev.target && ev.target.id;
  if (id && /^s-[a-z]+-mode$/.test(id)) {
    const kind = id.slice(2, -5);
    const k = ((data && data.kinds) || []).find((x) => x.kind === kind);
    const m = k && (k.modes || []).find((x) => x.id === ev.target.value);
    if (m) {
      const bu = hostEl.querySelector('#s-' + kind + '-baseUrl');
      const md = hostEl.querySelector('#s-' + kind + '-model');
      if (bu) bu.placeholder = m.defaultBaseUrl || 'https://…';
      if (md) md.placeholder = m.modelHint || '';
      const hintEl = hostEl.querySelector('#s-' + kind + '-mode-hint');
      if (hintEl) hintEl.textContent = modeHint(m);
    }
    return;
  }
  if (ev.target && ev.target.id === 's-usage-days') {
    usageDays = Number(ev.target.value) || 30;
    try {
      const u = await api.get('/api/mos/settings/usage?days=' + usageDays);
      usage = u.usage;
    } catch (_) { usage = null; }
    render();
  }
}

export default {
  async mount(host, ctx) {
    hostEl = host; ctxRef = ctx; data = null; usage = null;
    host.addEventListener('click', onClick);
    host.addEventListener('change', onChange);
    host.innerHTML = loadingHtml();
    try {
      await loadAll();
      render();
    } catch (err) {
      const blk = stateBlock('error', {
        title: t('settings.load_failed'),
        desc: err.message,
        actions: [{ label: t('settings.retry'), primary: true, onClick: async () => { await loadAll(); render(); } }]
      });
      host.innerHTML = blk.html;
      blk.bind(host);
    }
  },
  unmount() {
    if (hostEl) {
      hostEl.removeEventListener('click', onClick);
      hostEl.removeEventListener('change', onChange);
    }
    hostEl = null; data = null; usage = null; busy = false;
  },
  hasUnsaved() { return false; }
};
