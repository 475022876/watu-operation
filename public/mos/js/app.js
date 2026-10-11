/* Marketing OS —— 应用外壳（BUILD-01）。
 * 8 个员工工作中心（00 §1）：Workspace / Brand Center / Planning Center / Creative Studio /
 * Publishing Center / Marketing Center / Analytics Center / Governance & Assets。
 * 注意：Marketing Center **不得**命名为 Growth Center（00 §1 明文）。
 */
import { api, ApiError } from './api.js';
import { esc, initials, toast, openModal, openDrawer, confirmDialog, stateBlock, loadingHtml, integrationBarHtml } from './ui.js';

export const store = {
  me: null,
  brands: [],
  meta: null,
  integrations: null,
  brand: localStorage.getItem('mos.brand') || '',
  ready: false
};

const CENTERS = [
  { id: 'workspace', label: 'Workspace', items: ['my-work', 'active-projects'] },
  { id: 'brand', label: 'Brand Center', items: ['brand-overview', 'brand-guidelines', 'brand-library'] },
  { id: 'planning', label: 'Planning Center', items: ['planning', 'topics', 'intelligence', 'tasks'] },
  { id: 'creative', label: 'Creative Studio', items: ['creative'] },
  { id: 'publishing', label: 'Publishing Center', items: ['publishing'] },
  { id: 'marketing', label: 'Marketing Center', items: ['campaigns'] },
  { id: 'analytics', label: 'Analytics Center', items: ['analytics'] },
  { id: 'governance', label: 'Governance & Assets', items: ['governance'] }
];

const MODULES = [
  { id: 'my-work', label: 'My Work', icon: '☰', center: 'workspace', context: '我负责的任务、草稿与下一步动作',
    loader: () => import('./modules/workspace.js') },
  { id: 'active-projects', label: 'Active Projects', icon: '◈', center: 'workspace', context: '进行中的 Campaign 与 Master Topic',
    loader: () => import('./modules/projects.js') },

  { id: 'brand-overview', label: 'Brand Overview', icon: '◉', center: 'brand', context: '当前已批准版本与使用范围（只读）',
    loader: () => import('./modules/brand.js') },
  { id: 'brand-guidelines', label: 'Visual & Guidelines', icon: '◐', center: 'brand', context: 'V01–V05 / PPT-01–08 与模板（只读）',
    loader: () => import('./modules/guidelines.js') },
  { id: 'brand-library', label: 'Reference Library', icon: '▤', center: 'brand', context: '已批准可复用资产的受控引用',
    loader: () => import('./modules/reference.js') },

  { id: 'planning', label: 'Monthly Planning', icon: '▦', center: 'planning', context: '月度计划、PlanItem 与统一日历',
    loader: () => import('./modules/planning.js') },
  { id: 'topics', label: 'Master Topics', icon: '◎', center: 'planning', context: 'Research / Narrative / Deliverables / Reuse',
    loader: () => import('./modules/topics.js') },
  { id: 'intelligence', label: 'Intelligence', icon: '☍', center: 'planning', context: 'Feed / Sources / Create Topic',
    loader: () => import('./modules/intelligence.js') },
  { id: 'tasks', label: 'Content Tasks', icon: '✎', center: 'planning', context: '内容任务与制作排期',
    loader: () => import('./modules/tasks.js') },

  { id: 'campaigns', label: 'Campaigns', icon: '◆', center: 'marketing', context: '项目 Brief、Topic/Task 关联与进度',
    loader: () => import('./modules/campaigns.js') },

  { id: 'creative', label: 'Content & Visual Studio', icon: '✦', center: 'creative', stage: 'BUILD-02', context: '内容编辑、视觉生成与视频工作区',
    loader: () => import('./modules/stage.js') },
  { id: 'publishing', label: 'Publishing', icon: '⇪', center: 'publishing', stage: 'BUILD-02', context: '排期、发布队列与 Published Archive',
    loader: () => import('./modules/stage.js') },
  { id: 'analytics', label: 'Analytics', icon: '▩', center: 'analytics', stage: 'BUILD-03', context: '内容/渠道/计划执行/AI 成本',
    loader: () => import('./modules/stage.js') },
  { id: 'governance', label: 'Governance & Assets', icon: '⛨', center: 'governance', stage: 'BUILD-03', context: '三条审批链与资产入库',
    loader: () => import('./modules/stage.js') }
];

const els = {};
let activeModule = null;
let mounted = null;

function $(id) { return document.getElementById(id); }

/* ---------------- 初始化 ---------------- */

async function boot() {
  els.gate = $('gate'); els.pwdGate = $('pwdGate'); els.appRoot = $('appRoot');
  els.nav = $('nav'); els.content = $('content'); els.brandSwitch = $('brandSwitch');
  els.userAvatar = $('userAvatar'); els.userName = $('userName'); els.userMenu = $('userMenu');
  els.integrationBar = $('integrationBar'); els.versionText = $('versionText');
  els.syncDot = $('syncDot'); els.syncText = $('syncText'); els.envChip = $('envChip');
  els.sidebar = $('sidebar'); els.mask = $('sidebarMask'); els.menuBtn = $('menuBtn');

  bindLogin();
  bindPwd();
  bindChrome();

  try {
    const me = await api.get('/api/mos/auth/me');
    if (!me.authenticated) { showGate(); return; }
    await enterApp(me);
  } catch (err) {
    showGate(String(err.message || err));
  }
}

function showGate(msg) {
  els.gate.hidden = false;
  els.pwdGate.hidden = true;
  els.appRoot.hidden = true;
  const e = $('loginErr');
  if (msg) { e.hidden = false; e.textContent = msg; } else e.hidden = true;
  // 未登录时只调用**公开**接口，避免产生无谓的 401（保持控制台干净以便审计）
  try {
    api.get('/api/mos/identity/status').then((m) => {
      if (m && m.mosVersion) $('gateVersion').textContent = 'Marketing OS v' + m.mosVersion + ' · 沙盒原型（身份来源：' + m.mode + '）';
    }).catch(() => {});
  } catch (_) { /* ignore */ }
}

function bindLogin() {
  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = $('loginBtn'); btn.disabled = true;
    const errBox = $('loginErr'); errBox.hidden = true;
    try {
      const r = await api.post('/api/mos/auth/login', { username: $('loginUser').value, password: $('loginPass').value });
      $('loginPass').value = '';
      if (r.mustChangePassword) { els.gate.hidden = true; els.pwdGate.hidden = false; $('pwdOld').focus(); }
      else { const me = await api.get('/api/mos/auth/me'); await enterApp(me); }
    } catch (err) {
      errBox.hidden = false; errBox.textContent = err.message || '登录失败';
      toast(err.message || '登录失败', 'err');
    } finally { btn.disabled = false; }
  });
}

function bindPwd() {
  $('pwdForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const errBox = $('pwdErr'); errBox.hidden = true;
    try {
      await api.post('/api/mos/auth/change-password', { oldPassword: $('pwdOld').value, newPassword: $('pwdNew').value });
      $('pwdOld').value = ''; $('pwdNew').value = '';
      const me = await api.get('/api/mos/auth/me');
      await enterApp(me);
    } catch (err) { errBox.hidden = false; errBox.textContent = err.message || '修改失败'; }
  });
}

async function enterApp(me) {
  if (me.mustChangePassword) { els.gate.hidden = true; els.appRoot.hidden = true; els.pwdGate.hidden = false; return; }
  els.gate.hidden = true; els.pwdGate.hidden = true; els.appRoot.hidden = false;

  store.me = me.user;
  store.brands = me.brands || [];
  store.integrations = me.integrations || null;
  if (!store.brand || !store.brands.some((b) => b.code === store.brand)) {
    store.brand = store.brands.length ? store.brands[0].code : '';
  }
  try { store.meta = await api.get('/api/mos/meta'); } catch (_) { store.meta = null; }
  store.ready = true;

  renderBrandSwitch();
  renderUser();
  renderNav();
  renderIntegrationBar();
  els.versionText.textContent = 'v' + ((store.meta && store.meta.mosVersion) || '0.1.0');
  els.syncText.textContent = '已连接服务';
  els.syncDot.classList.remove('bad');
  els.envChip.textContent = 'SANDBOX · MOS V0.1';

  const hash = (location.hash || '').replace(/^#\/?/, '');
  navigate(MODULES.some((m) => m.id === hash) ? hash : 'my-work');
}

function renderBrandSwitch() {
  if (store.brands.length <= 1) {
    els.brandSwitch.innerHTML = '<span class="pill">' + esc(store.brands.length ? (store.brands[0].name + '（唯一品牌）') : '无可用品牌') + '</span>';
    return;
  }
  els.brandSwitch.innerHTML = store.brands.map((b) =>
    '<button data-brand="' + esc(b.code) + '" class="' + (store.brand === b.code ? 'on' : '') + '" title="' + esc(b.name) + '">'
    + esc(b.code) + '</button>').join('');
  els.brandSwitch.querySelectorAll('[data-brand]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const code = btn.dataset.brand;
      if (code === store.brand) return;
      // 01 §1：品牌切换不得自动丢弃/继承未保存草稿 —— 有未保存内容时先询问
      if (mounted && typeof mounted.hasUnsaved === 'function' && mounted.hasUnsaved()) {
        const ok = await confirmDialog('切换品牌', '当前页面存在未保存的内容。切换品牌会丢弃这些内容，确定继续？', '丢弃并切换');
        if (!ok) return;
      }
      store.brand = code;
      localStorage.setItem('mos.brand', code);
      renderBrandSwitch();
      remount();
    });
  });
}

function renderUser() {
  const me = store.me || {};
  els.userAvatar.textContent = initials(me.displayName);
  els.userName.textContent = me.displayName || '—';
}

function renderIntegrationBar() {
  els.integrationBar.innerHTML = integrationBarHtml(store.integrations);
}

function bindChrome() {
  els.userName && $('userChip').addEventListener('click', (e) => {
    e.stopPropagation();
    const m = els.userMenu;
    if (!m.classList.contains('hidden')) { m.classList.add('hidden'); return; }
    const me = store.me || {};
    m.innerHTML = '<div class="dd-head"><div class="dd-name">' + esc(me.displayName || '') + '</div>'
      + '<div class="dd-sub">' + esc(me.username || '') + (me.demo ? ' · DEMO 演示账号' : '') + '</div>'
      + '<div class="dd-sub">角色：' + esc((me.roles || []).map((r) => r.roleLabel).join('、') || '（无）') + '</div>'
      + '<div class="dd-sub">品牌范围：' + esc((me.brandCodes || []).join('、') || '（无）') + '</div></div>'
      + '<button data-act="pwd">修改密码</button>'
      + '<button data-act="about">关于与集成状态</button>'
      + '<button data-act="logout">退出登录</button>';
    m.classList.remove('hidden');
    m.querySelector('[data-act="pwd"]').addEventListener('click', () => { m.classList.add('hidden'); changePwdDialog(); });
    m.querySelector('[data-act="about"]').addEventListener('click', () => { m.classList.add('hidden'); aboutDialog(); });
    m.querySelector('[data-act="logout"]').addEventListener('click', async () => {
      m.classList.add('hidden');
      try { await api.post('/api/mos/auth/logout', {}); } catch (_) { /* ignore */ }
      location.reload();
    });
  });
  document.addEventListener('click', () => { if (els.userMenu) els.userMenu.classList.add('hidden'); });

  if (els.menuBtn) els.menuBtn.addEventListener('click', () => { els.sidebar.classList.add('open'); els.mask.classList.add('show'); });
  if (els.mask) els.mask.addEventListener('click', () => { els.sidebar.classList.remove('open'); els.mask.classList.remove('show'); });
  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').replace(/^#\/?/, '');
    if (h && MODULES.some((m) => m.id === h) && (!activeModule || activeModule.id !== h)) navigate(h);
  });
}

function changePwdDialog() {
  openModal({
    title: '修改密码',
    okText: '提交',
    body: '<label class="field"><span>当前密码</span><input id="cpOld" type="password"></label>'
      + '<label class="field"><span>新密码（≥8 位）</span><input id="cpNew" type="password"></label>',
    onOk: async (b) => {
      const oldP = b.querySelector('#cpOld').value;
      const newP = b.querySelector('#cpNew').value;
      if (String(newP).length < 8) { toast('新密码至少 8 位', 'err'); return false; }
      try { await api.post('/api/mos/auth/change-password', { oldPassword: oldP, newPassword: newP }); toast('密码已更新', 'ok'); }
      catch (err) { toast(err.message, 'err'); return false; }
    }
  });
}

function aboutDialog() {
  const ig = store.integrations || {};
  const lines = Object.keys(ig).map((k) => '<div class="checkline"><span class="ck">•</span><span><strong>'
    + esc(k) + '</strong>：' + esc(ig[k].mode || '') + (ig[k].mock ? '（MOCK）' : '') + ' — ' + esc(ig[k].note || '') + '</span></div>').join('');
  openModal({
    title: '关于 Marketing OS V0.1（沙盒）',
    hideOk: true,
    body: '<div class="callout mock">本环境为 <strong>原型/沙盒</strong>：企业 OA、企业资料库、正式供应商 API、真实金融数据源均<strong>尚未</strong>完成源码级集成审计。凡标注 MOCK 的能力均不代表已打通。</div>'
      + '<h3 style="margin:12px 0 6px">集成状态</h3>' + lines
      + '<h3 style="margin:14px 0 6px">范围声明</h3>'
      + '<div class="checkline no"><span class="ck">✕</span><span>S05 客户增长、品牌声誉/风险专项、营销线索移交与闭环：<strong>MARK / 不在 V0.1</strong></span></div>'
      + '<div class="checkline no"><span class="ck">✕</span><span>代理后台、佣金、代理合同、KYC、银行卡与资金交易：<strong>禁止开发</strong></span></div>'
      + '<div class="checkline no"><span class="ck">✕</span><span>社交平台自动发布：<strong>V0.1 一律人工发布</strong></span></div>'
  });
}

/* ---------------- 导航 ---------------- */

function renderNav() {
  const byId = {};
  for (const m of MODULES) byId[m.id] = m;
  let html = '';
  for (const c of CENTERS) {
    html += '<div class="nav-group"><div class="nav-group-label">' + esc(c.label) + '</div>';
    for (const id of c.items) {
      const m = byId[id];
      if (!m) continue;
      html += '<button class="nav-item' + (m.stage ? ' soon' : '') + '" data-route="' + m.id + '" title="' + esc(m.context) + '">'
        + '<span class="nav-ico">' + m.icon + '</span><span class="nav-label">' + esc(m.label) + '</span>'
        + (m.stage ? '<span class="soon-tag">' + esc(m.stage) + '</span>' : '') + '</button>';
    }
    html += '</div>';
  }
  els.nav.innerHTML = html;
  els.nav.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => {
    navigate(b.dataset.route);
    els.sidebar.classList.remove('open'); els.mask.classList.remove('show');
  }));
  highlightNav();
}

function highlightNav() {
  els.nav.querySelectorAll('[data-route]').forEach((b) => {
    const on = activeModule && b.dataset.route === activeModule.id;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
}

/* ---------------- 路由 / 挂载 ---------------- */

export function navigate(id) {
  const mod = MODULES.find((m) => m.id === id);
  if (!mod) return;
  if (activeModule && activeModule.id === mod.id && mounted) { highlightNav(); return; }
  activeModule = mod;
  if (location.hash !== '#/' + id) location.hash = '#/' + id;
  highlightNav();
  remount();
}

async function remount() {
  if (mounted && typeof mounted.unmount === 'function') {
    try { mounted.unmount(); } catch (err) { console.error('[mos] unmount 异常', err); }
  }
  mounted = null;
  els.content.innerHTML = loadingHtml();
  try {
    const imported = await activeModule.loader();
    const inst = imported.default || imported;
    mounted = inst;
    els.content.innerHTML = '';
    const host = document.createElement('div');
    els.content.appendChild(host);
    await inst.mount(host, {
      brand: store.brand,
      me: store.me,
      meta: store.meta,
      integrations: store.integrations,
      brands: store.brands,
      navigate,
      module: activeModule,
      refreshShell: async () => { renderBrandSwitch(); }
    });
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) console.error('[mos] mount 异常', err);
    els.content.innerHTML = '';
    const s = stateBlock('error', {
      title: '页面加载失败',
      desc: (err && err.message) || '未知错误',
      actions: [{ label: '重试', primary: true, onClick: () => remount() }]
    });
    els.content.innerHTML = s.html;
    s.bind(els.content);
  }
}

/* 供各模块复用 */
export { MODULES, confirmDialog, openDrawer, openModal, toast, esc };
void stateBlock;
void ApiError;

boot();
