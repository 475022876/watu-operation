export const groups=[
 {id:'workspace',zh:'工作台',en:'Workspace',items:[['tasks','我的工作','My work'],['projects','进行项目','Active projects'],['all-tasks','全部任务','All tasks'],['reviews','待我审核','My reviews']]},
 {id:'data',zh:'数据工作台',en:'Data workspace',items:[['intelligence','数据获取','Research and sources'],['campaigns','营销活动','Campaigns'],['analytics','运营数据','Analytics']]},
 {id:'production',zh:'内容制作',en:'Content production',items:[['text-studio','文字制作区','Text studio'],['visual-studio','图片制作区','Image studio'],['video-workspace','视频制作区','Video studio']]},
 {id:'publishing',zh:'发布管理',en:'Publishing',items:[['drafts','草稿箱','Drafts'],['publishing','多平台发布','Publishing workspace']]},
 {id:'brand',zh:'品牌规范',en:'Brand standards',items:[['brand-overview','品牌总览','Brand overview'],['brand-guidelines','内容规范','Content standards'],['brand-library','参考资料','Reference library']]},
 {id:'system',zh:'系统扩展',en:'Extensions',items:[['settings','AI 管理','AI providers'],['platforms','平台管理','Platform accounts']]}
];
export const modules:Record<string,{file:string;zh:string;en:string;route?:string}>={
 'all-tasks':{file:'tasks',zh:'全部任务',en:'All tasks',route:'tasks'},
 projects:{file:'projects',zh:'进行项目',en:'Active projects',route:'active-projects'},
 intelligence:{file:'intelligence',zh:'数据获取',en:'Research and sources'},campaigns:{file:'campaigns',zh:'营销活动',en:'Campaigns'},analytics:{file:'analytics',zh:'运营数据',en:'Analytics'},
 'text-studio':{file:'text-studio',zh:'文字制作区',en:'Text studio'},'visual-studio':{file:'visual',zh:'图片制作区',en:'Image studio'},'video-workspace':{file:'video',zh:'视频制作区',en:'Video studio'},
 drafts:{file:'drafts',zh:'草稿箱',en:'Drafts'},publishing:{file:'publishing',zh:'多平台发布',en:'Publishing workspace'},
 'brand-overview':{file:'brand',zh:'品牌总览',en:'Brand overview'},'brand-guidelines':{file:'guidelines',zh:'内容规范',en:'Content standards'},'brand-library':{file:'reference',zh:'参考资料',en:'Reference library'},
 settings:{file:'settings',zh:'AI 管理',en:'AI providers'},platforms:{file:'publishing',zh:'平台管理',en:'Platform accounts'},
 topics:{file:'topics',zh:'专题与选题',en:'Topics'},planning:{file:'planning',zh:'内容日历',en:'Content calendar'},'marketing-vfib':{file:'marketing',zh:'VFIB 营销工作区',en:'VFIB campaigns'},'marketing-ucard':{file:'marketing',zh:'UCARD 营销工作区',en:'UCARD campaigns'},governance:{file:'governance',zh:'资产入库与治理',en:'Asset governance'}
};
export const related=[['intelligence','topics','planning'],['campaigns','marketing-vfib','marketing-ucard'],['drafts','publishing'],['brand-overview','brand-guidelines','brand-library','governance']];
export function permitted(route:string,roles:string[]){return !['settings','platforms'].includes(route)||roles.includes('MOS_ADMIN');}
export function primary(route:string){return ({topics:'intelligence',planning:'intelligence','marketing-vfib':'campaigns','marketing-ucard':'campaigns',governance:'brand-library',creative:'tasks',review:'reviews'})[route]||route;}
