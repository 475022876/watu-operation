// Employee navigation only: existing route IDs, APIs and permission boundaries remain authoritative.
export const CENTERS = [
  { id: 'workspace', label: '工作台', items: ['my-work', 'active-projects', 'tasks'] },
  { id: 'data', label: '数据工作台', items: ['intelligence', 'campaigns', 'analytics'] },
  { id: 'production', label: '内容制作', items: ['text-studio', 'visual-studio', 'video-workspace'] },
  { id: 'publishing', label: '发布管理', items: ['drafts', 'publishing'] },
  { id: 'brand', label: '品牌规范', items: ['brand-overview', 'brand-guidelines', 'brand-library'] },
  { id: 'system', label: '系统扩展', requireRoles: ['MOS_ADMIN'], items: ['settings', 'platforms'] }
];
export const LABELS = {
  'active-projects': '进行项目', intelligence: '数据获取', analytics: '运营数据',
  'content-editor': '文字制作区', 'visual-studio': '图片制作区', 'video-workspace': '视频制作区',
  publishing: '多平台发布', 'brand-guidelines': '内容规范', 'brand-library': '参考资料', settings: 'AI管理'
};
export const RELATED = [
  ['tasks', 'my-reviews', 'governance'],
  ['intelligence', 'topics', 'planning'],
  ['campaigns', 'marketing-vfib', 'marketing-ucard'],
  ['text-studio', 'drafts', 'content-editor', 'visual-studio', 'video-workspace'],
  ['publishing', 'platforms']
];
export const REVIEW_ROLES = ['P1', 'P3', 'PROFESSIONAL_REVIEWER', 'PUBLISHING_APPROVER', 'ASSET_REVIEWER', 'LIBRARY_FINAL_APPROVER'];
export function visibleRoute(id, roles) {
  if (id === 'settings' || id === 'platforms') return roles.includes('MOS_ADMIN');
  if (id === 'my-reviews' || id === 'governance') return roles.includes('MOS_ADMIN') || REVIEW_ROLES.some(r => roles.includes(r));
  return true;
}
export function primaryRoute(id) {
  return ({ 'my-reviews': 'tasks', governance: 'tasks', topics: 'intelligence', planning: 'intelligence',
    'marketing-vfib': 'campaigns', 'marketing-ucard': 'campaigns' })[id] || id;
}
