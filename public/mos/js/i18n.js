/**
 * i18n —— zh-CN / en-US 双语支持（V0.1.2 Phase A / 执行包 05 双语规范）。
 *
 * 设计口径：
 *  - 中文为源语言（UI 代码中的中文文案即 key），en-US 走**精确匹配字典**；
 *  - 只翻译「系统文案」：菜单/按钮/页头/状态/空态提示等；**品牌专名、用户输入、
 *    已保存草稿、AI 报告正文、来源内容不翻译**（字典未命中的文本原样保留）；
 *  - 内部状态码 / API 字段 / 审计事件不翻译；
 *  - 语言偏好保存在服务端（users[].prefs.locale，PUT /api/mos/auth/preferences），
 *    重新登录仍有效；localStorage 仅作未登录时的临时记忆，不是权威。
 */

const LS_KEY = 'mos_locale';

let current = 'zh-CN';

/* 字典：key = 中文源文案（精确匹配），value = en-US */
const EN = {
  /* 工作中心 / 导航 */
  '工作台': 'Workspace', '品牌中心': 'Brand Center', '计划中心': 'Planning Center',
  '创意工作室': 'Creative Studio', '发布中心': 'Publishing Center', '营销中心': 'Marketing Center',
  '运营分析中心': 'Analytics Center', '治理与资产': 'Governance & Assets',
  '策划与情报': 'Planning & Intelligence', '内容制作': 'Content Production',
  '发布管理': 'Publishing', '运营分析': 'Analytics',
  '品牌与素材': 'Brand & Assets', '审批与管理': 'Review & Administration',
  '我的工作': 'My Work', '进行中项目': 'Active Projects', '我的审核': 'My Reviews',
  '品牌总览': 'Brand Overview', '视觉与规范': 'Visual & Guidelines',
  '参考资料库': 'Reference Library', '月度计划': 'Monthly Planning',
  '专题内容包': 'Master Topics', '情报资讯': 'Intelligence', '全部任务': 'All Tasks',
  'VFIB 银行营销': 'VFIB Banking Marketing', 'U CARD 营销': 'U CARD Marketing',
  '营销活动': 'Campaigns', '内容编辑器': 'Content Editor', '视觉工作室': 'Visual Studio',
  '视频工作区': 'Video Workspace', '制作工作台': 'Production Desk',
  '正文': 'Copy', '图片': 'Images', '视频': 'Video', '审核': 'Review',
  '任务要求': 'Task brief', '研究依据': 'Research basis', '上级备注': 'Editor notes',
  '下一步': 'Next step', '交付物': 'Deliverables', '高级': 'Advanced', '高级（技术参数）': 'Advanced (technical)',
  '新建草稿': 'New draft', '开始制作': 'Start producing', '生成配图': 'Generate image',
  '上传图片': 'Upload image', '保存草稿': 'Save draft', '提交审核': 'Submit for review',
  '派生新版本': 'Derive new version', '查看批准对象': 'View approved object', '查看审核链': 'View review chain',
  'AI 生成初稿': 'AI first draft', '优化表达 / 缩短': 'Polish / Shorten',
  '收起': 'Collapse', '展开': 'Expand', '添加备注': 'Add note', '保存备注': 'Save note',
  '生成脚本骨架': 'Generate script skeleton', '新增分镜': 'Add shot', '上传关键帧': 'Upload keyframe',
  '上传成片': 'Upload final cut', '保存视频与分镜': 'Save video & storyboard',
  '登记业务依据': 'Record business basis', '重新检查': 'Re-check',
  /* 常见状态 / 徽标 */
  '只读': 'Read-only', '草稿': 'Draft', '待审核': 'Pending review', '已批准': 'Approved',
  '已发布': 'Published', '进行中': 'In progress', '暂缓': 'On hold', '已拒绝': 'Rejected',
  '演示': 'Demo', '已连接': 'Connected', '已连接服务': 'Connected', '沙盒环境': 'SANDBOX',
  '未保存': 'Unsaved', '重试': 'Retry', '保存': 'Save', '取消': 'Cancel', '关闭': 'Close',
  '提交': 'Submit', '删除': 'Delete', '刷新': 'Refresh', '新建任务': 'New Task',
  '新建临时任务（AD_HOC）': 'New Ad-hoc Task (AD_HOC)', '退出登录': 'Sign out',
  '修改密码': 'Change password', '关于': 'About',
  /* 工作台卡片 */
  '今日待办': 'Today', '我的任务': 'My Tasks', '本周待发布': 'Publishing This Week',
  '继续上次工作': 'Continue Where You Left Off', '继续': 'Continue', '开始': 'Start',
  '待我审核': 'Awaiting My Review', '我的计划草稿': 'My Plan Drafts',
  '语言': 'Language', '中文': '中文', 'English': 'English'
};

export function getLocale() { return current; }

export function availableLocales() {
  return [{ code: 'zh-CN', label: '中文' }, { code: 'en-US', label: 'English' }];
}

/** 初始化（登录后调用）：服务端偏好优先，其次 localStorage 临时记忆，默认 zh-CN */
export function initLocale(serverLocale) {
  const saved = String(serverLocale || '').trim();
  if (saved === 'zh-CN' || saved === 'en-US') { current = saved; return current; }
  try {
    const ls = localStorage.getItem(LS_KEY);
    if (ls === 'zh-CN' || ls === 'en-US') { current = ls; return current; }
  } catch (_) { /* ignore */ }
  current = 'zh-CN';
  return current;
}

export function setLocale(locale) {
  if (locale !== 'zh-CN' && locale !== 'en-US') return current;
  current = locale;
  try { localStorage.setItem(LS_KEY, locale); } catch (_) { /* ignore */ }
  return current;
}

/** 翻译单个文案：精确匹配字典；未命中原样返回（品牌专名/用户内容不受影响） */
export function t(zh) {
  const s = String(zh == null ? '' : zh);
  if (current === 'zh-CN') return s;
  return Object.prototype.hasOwnProperty.call(EN, s) ? EN[s] : s;
}

/** 翻译面包屑/组合串：按「/」分段逐段翻译，保留分隔符两侧空格 */
export function tPath(s) {
  const v = String(s == null ? '' : s);
  if (current === 'zh-CN') return v;
  return v.split('/').map((seg) => t(seg.trim())).join(' / ');
}

/** 遍历 DOM 精确替换文本节点（渲染后调用；不改属性、不动输入框值与用户内容） */
export function applyDom(root) {
  const el = root || document;
  if (current === 'zh-CN') return;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue;
    const trimmed = raw.trim();
    const hit = Object.prototype.hasOwnProperty.call(EN, trimmed) ? EN[trimmed] : null;
    if (hit) { n.nodeValue = raw.replace(trimmed, hit); continue; }
    if (trimmed.indexOf('/') !== -1) {
      const parts = trimmed.split('/');
      if (parts.length >= 2 && parts.every((p) => Object.prototype.hasOwnProperty.call(EN, p.trim()))) {
        const mapped = parts.map((p) => EN[p.trim()]).join(' / ');
        n.nodeValue = raw.replace(trimmed, mapped);
      }
    }
  }
  // 占位符与 title/aria（仅精确命中）
  el.querySelectorAll && el.querySelectorAll('input[placeholder],button[title],[aria-label]').forEach((e) => {
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      const v = e.getAttribute && e.getAttribute(attr);
      if (v && Object.prototype.hasOwnProperty.call(EN, v.trim())) e.setAttribute(attr, EN[v.trim()]);
    }
  });
}

/* —— en-US 下监听后续 DOM 变化（模块异步加载/局部刷新），保证英文界面完整 —— */
let observer = null;

export function ensureDomObserver() {
  if (current === 'en-US' && !observer) {
    let pending = null;
    observer = new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; applyDom(document.body); }, 60);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  } else if (current === 'zh-CN' && observer) {
    observer.disconnect();
    observer = null;
  }
}
