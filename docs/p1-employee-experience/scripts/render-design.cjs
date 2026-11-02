'use strict';
// Static design drawings only. No application, APIs, model calls or upstream source.
const fs=require('node:fs'),path=require('node:path');
const out=path.resolve(__dirname,'../boards');fs.mkdirSync(out,{recursive:true});
const C={ink:'#162941',muted:'#64748b',nav:'#102843',blue:'#245fe5',bg:'#f4f6fa',line:'#dfe5ef',white:'#fff',soft:'#eef3fb',amber:'#a85c12',red:'#a63237',green:'#187757'};
const e=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function board(w,h,title){let a=[`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${e(title)}"><title>${e(title)} — static synthetic design, not a running application</title><style>text{font-family:'Microsoft YaHei','Noto Sans SC',Arial,sans-serif} .line{stroke:${C.line};stroke-width:1}</style>`];return {a,w,h};}
function box(b,x,y,w,h,fill=C.white,r=12,stroke=C.line){b.a.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}"/>`);}
function text(b,x,y,s,size=14,color=C.ink,weight=400){b.a.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${e(s)}</text>`);}
function lines(b,x,y,arr,size=14,color=C.ink,step=26){arr.forEach((s,i)=>text(b,x,y+i*step,s,size,color));}
function rule(b,x,y,w){b.a.push(`<path d="M${x} ${y}h${w}" class="line"/>`);}
function pill(b,x,y,w,label,fill=C.soft,color=C.blue){box(b,x,y,w,28,fill,14,fill);text(b,x+12,y+19,label,12,color,600);}
function button(b,x,y,w,label,primary=false,disabled=false){box(b,x,y,w,40,disabled?'#e8edf4':primary?C.blue:C.white,8,primary?C.blue:C.line);text(b,x+16,y+25,label,14,disabled?'#8693a6':primary?C.white:C.ink,600);}
function shell(b,scene){box(b,0,0,b.w,b.h,C.bg,0,C.bg);box(b,0,0,204,b.h,C.nav,0,C.nav);text(b,24,41,'VFIB',23,C.white,700);text(b,24,63,'Marketing OS',12,'#abc0d8');const groups=['工作台','数据工作台','内容制作','发布管理','品牌规范','系统扩展'];groups.forEach((g,i)=>{const y=112+i*88;const on=(scene==='tasks'?i===0:scene==='create'?i===2:i===0);if(on)box(b,12,y-25,180,42,'#244363',8,'#244363');text(b,26,y,g,15,on?C.white:'#bccce0',on?600:400);text(b,175,y,'⌄',13,'#9fb7d0');if(on)text(b,38,y+32,scene==='tasks'?'我的任务':scene==='create'?'创作工作区':'待我审核',12,'#cbdcf0');});text(b,22,b.h-24,'六区保留 · 当前分区展开',11,'#a7bbd2');box(b,204,0,b.w-204,66,C.white,0,C.line);pill(b,232,19,98,'VFIB 品牌');text(b,350,39,'工作内容随品牌隔离',12,C.muted);text(b,b.w-228,39,scene==='review'?'EN   /   陈岚 · 专业审核':scene==='tasks'?'EN   /   林悦 · 运营':'EN   /   林悦 · 制作',13,C.muted);text(b,b.w-252,b.h-17,'P1静态设计 · 合成示例 · 不可操作',11,C.muted);}
function save(b,name){b.a.push('</svg>');fs.writeFileSync(path.join(out,name+'.svg'),b.a.join('\n'));}

{
const b=board(1440,960,'我的任务 桌面设计');shell(b,'tasks');text(b,240,120,'我的任务',30,C.ink,700);text(b,240,150,'先处理需要你行动的工作',14,C.muted);button(b,1250,100,146,'＋ 发起任务');
const tabs=[['待我处理',6],['待修改',2],['待我审核',1],['临近截止',3],['全部任务',18]];tabs.forEach(([s,n],i)=>{const x=240+i*172;box(b,x,180,160,49,i===0?C.blue:C.white,10,i===0?C.blue:C.line);text(b,x+17,210,s+'  '+n,15,i===0?C.white:C.muted,i===0?600:400);});
box(b,240,252,1156,52);text(b,258,285,'⌕  搜索任务名称或负责人',14,C.muted);text(b,1134,285,'时间范围  ▾    更多筛选',13,C.muted);
box(b,240,324,1156,448);text(b,262,359,'任务与当前需要',12,C.muted);text(b,836,359,'负责人',12,C.muted);text(b,978,359,'截止',12,C.muted);text(b,1160,359,'下一步',12,C.muted);rule(b,240,378,1156);
const rows=[['会员服务介绍短文','按任务要求整理介绍，不加入未核实的费率。','制作中','林悦','今天 17:00','继续创作'],['活动邀请文案','审核意见：开头再简短一些，保留报名条件。','待修改','林悦','今天 18:00','按反馈修改'],['品牌活动通知','已安排明日开始，资料已随任务提供。','待开始','林悦','明天 16:00','查看要求']];
rows.forEach((r,i)=>{let y=398+i*120;text(b,264,y+25,r[0],18,C.ink,600);text(b,264,y+55,r[1],13,C.muted);pill(b,264,y+69,90,r[2],i===1?'#fff0dd':C.soft,i===1?C.amber:C.blue);text(b,840,y+42,r[3],14);text(b,978,y+42,r[4],14,i===0?C.amber:C.ink);button(b,1160,y+20,150,r[5],true);if(i<2)rule(b,260,y+106,1116);});
text(b,248,812,'已完成、已取消与项目总览可从“全部任务”查找。',13,C.muted);text(b,240,894,'主要动作：点击任务下一步，直接进入同一作品上下文。',13,C.muted);save(b,'01-my-tasks-desktop');
}
{
const b=board(1440,960,'创作工作区 桌面设计');shell(b,'create');text(b,240,105,'← 我的任务',13,C.muted);text(b,240,143,'会员服务介绍短文',25,C.ink,700);pill(b,1010,119,132,'当前作品未保存','#fff0dd',C.amber);button(b,1166,113,230,'保存作品',true);text(b,240,176,'林悦负责 · 今天17:00截止',13,C.muted);text(b,1030,176,'任务要求与资料（2）  ▾',13,C.blue);
box(b,240,200,408,670);text(b,262,234,'讨论与修改',17,C.ink,600);rule(b,240,251,408);box(b,270,280,350,82,C.soft,12,C.soft);lines(b,286,307,['我：帮我整理一段清楚的服务介绍，','语气简洁，不加入未经确认的条件。'],13,C.ink,25);
text(b,266,403,'AI 候选稿',14,C.ink,600);lines(b,266,433,['可以先介绍适用场景，再说明服务内容，','最后提示读者查看正式服务条款。','','以下是供你整理的示例文字……'],13,C.ink,26);button(b,266,555,176,'选为当前作品');text(b,266,620,'继续讨论不会自动修改已选定作品。',12,C.muted);
box(b,260,673,368,106,C.white,10);lines(b,276,702,['描述你想调整的地方……'],13,C.muted);text(b,276,753,'＋ 添加资料',13,C.muted);button(b,516,789,110,'发送',true);text(b,260,846,'资料理解能力按实际接入显示',11,C.muted);
box(b,668,200,728,670);text(b,692,234,'当前作品',17,C.ink,600);text(b,1206,234,'正文   附件（1）',12,C.muted);rule(b,668,251,728);text(b,698,294,'把服务说明写得更容易理解',23,C.ink,600);lines(b,698,340,['这里是你选定并正在整理的交付正文。','可以直接编辑，无需复制到另一个页面。','','先介绍读者遇到的场景，再说明已核实的服务内容。','涉及资格条件和业务细节时，应以正式条款为准。','','示例内容不代表真实品牌服务事实，不可用于发布。'],16,C.ink,34);rule(b,692,624,680);pill(b,698,647,254,'服务说明.pdf · 已上传，未用于本次生成');text(b,698,714,'只有这份正文与勾选附件会送审。聊天不会送审。',13,C.muted);button(b,698,779,178,'保存后再提交审核',false,true);text(b,698,846,'更多：历史作品 / 原有制作工具',12,C.muted);save(b,'02-creative-desktop');
}
{
const b=board(1440,960,'作品审核 桌面设计');shell(b,'review');text(b,240,105,'← 待我审核',13,C.muted);text(b,240,143,'会员服务介绍短文',25,C.ink,700);text(b,240,177,'作者：林悦 · 本次送审正文及附件只读',13,C.muted);pill(b,1014,119,174,'专业审核 · 待你处理');text(b,1210,145,'陈岚 · 专业审核人',12,C.muted);
box(b,240,204,786,656);text(b,264,240,'本次送审作品',16,C.ink,600);text(b,840,240,'附件（2）',13,C.blue);rule(b,240,256,786);text(b,274,303,'把服务说明写得更容易理解',23,C.ink,600);lines(b,274,351,['这是本次需要你审核的固定作品。','它与作者正在讨论的聊天记录分开。','','请核对正文中的业务事实和限定条件，','再结合本次附件给出专业意见。','','如需修改，说明具体要修改的内容。'],16,C.ink,34);rule(b,266,648,734);text(b,274,681,'服务说明.pdf    活动要求.docx',14,C.blue);text(b,274,739,'查看任务要求  ▾',13,C.muted);text(b,274,816,'历史审核与版本详情  ▾',12,C.muted);
box(b,1046,204,350,656);text(b,1070,240,'你的专业审核意见',17,C.ink,600);lines(b,1070,279,['专业审核与发布审批分开。','本次批准不等于内容已经发布。'],13,C.muted,24);text(b,1070,359,'意见',13,C.ink,600);box(b,1070,378,302,174);lines(b,1084,405,['退回时，请写明要修改哪里。','例如：开头简短一些，并保留','正式条款中的适用条件。'],13,C.muted,25);button(b,1070,579,302,'批准本次专业审核',true);button(b,1070,635,302,'退回修改');rule(b,1070,713,302);text(b,1070,745,'下一环节',13,C.ink,600);text(b,1070,777,'发布审批：等待专业审核通过',12,C.muted);text(b,1070,820,'无权自审或越权操作时，不显示批准动作。',11,C.muted);save(b,'03-review-desktop');
}
function mobile(title){const b=board(390,844,title);box(b,0,0,390,844,C.bg,0,C.bg);box(b,0,0,390,61,C.white,0);text(b,18,37,'☰',20);pill(b,54,17,90,'VFIB');text(b,291,37,'林悦  EN',12,C.muted);text(b,18,824,'P1静态设计 · 合成示例 · 不可操作',10,C.muted);return b;}
{
const b=mobile('我的任务 390px设计');text(b,18,105,'我的任务',26,C.ink,700);text(b,18,133,'先处理需要你行动的工作',13,C.muted);pill(b,18,158,112,'待我处理 6',C.blue,C.white);pill(b,140,158,100,'待修改 2');pill(b,250,158,118,'待我审核 1');box(b,18,207,354,44);text(b,30,235,'⌕ 搜索任务       筛选 ▾',13,C.muted);
[['会员服务介绍短文','制作中 · 今天17:00截止','继续创作'],['活动邀请文案','待修改 · 开头需要简短一些','按反馈修改'],['品牌活动通知','待开始 · 明天16:00截止','查看要求']].forEach((r,i)=>{const y=272+i*160;box(b,18,y,354,144);text(b,34,y+30,r[0],17,C.ink,600);text(b,34,y+59,r[1],12,C.muted);button(b,34,y+84,320,r[2],true);});text(b,20,790,'更多视图与六区入口从左上菜单展开',11,C.muted);save(b,'04-my-tasks-mobile');
}
{
const b=mobile('创作工作区 390px设计');text(b,18,94,'← 我的任务',12,C.muted);text(b,18,127,'会员服务介绍短文',22,C.ink,700);text(b,18,154,'今天17:00截止 · 当前作品未保存',12,C.amber);pill(b,18,177,108,'讨论');pill(b,138,177,118,'当前作品',C.blue,C.white);text(b,18,231,'任务要求与资料（2）  ▾',12,C.blue);box(b,18,252,354,414);text(b,34,289,'当前作品',16,C.ink,600);rule(b,18,307,354);text(b,34,344,'把服务说明写得更容易理解',17,C.ink,600);lines(b,34,380,['直接编辑你选定的交付内容。','','先介绍读者遇到的场景，再说明','已核实的服务内容。','','聊天、附件状态和当前作品分别保留，','切换视图不会替换正在编辑的文字。'],13,C.ink,27);text(b,34,641,'附件：服务说明.pdf · 未用于生成',11,C.muted);box(b,0,698,390,99,C.white,0);button(b,18,716,354,'保存作品',true);text(b,18,780,'保存成功后，主要动作变为“提交审核”。',11,C.muted);save(b,'05-creative-mobile');
}
{
const b=mobile('作品审核 390px设计');box(b,280,12,108,36,C.white,0,C.white);text(b,291,37,'陈岚  EN',12,C.muted);text(b,18,94,'← 待我审核',12,C.muted);text(b,18,127,'会员服务介绍短文',22,C.ink,700);pill(b,18,145,174,'专业审核 · 待你处理');pill(b,18,190,100,'作品',C.blue,C.white);pill(b,132,190,120,'审核反馈');box(b,18,240,354,415);text(b,34,274,'本次送审正文 · 只读',14,C.ink,600);lines(b,34,319,['先阅读要审核的作品，再给出意见。','','这是固定的送审正文，不包含聊天。','反馈与后续修订都留在同一任务中。','','附件（2）  查看本次附件','任务要求  展开'],14,C.ink,31);text(b,34,620,'发布审批仍需授权人员独立处理。',11,C.muted);box(b,0,684,390,116,C.white,0);button(b,18,700,130,'退回修改');button(b,160,700,212,'批准专业审核',true);text(b,18,774,'动作先打开确认/意见面板，未确认不提交。',11,C.muted);save(b,'06-review-mobile');
}
{
const b=board(1440,1040,'关键异常与恢复设计');box(b,0,0,1440,1040,C.bg,0);text(b,32,52,'关键状态：就地解释，并给出可执行的下一步',25,C.ink,700);text(b,32,81,'示例状态不是实际错误或真实服务结果。所有动作均为静态示意。',13,C.muted);
const cards=[['模型未接通','当前文字模型尚未接通。输入仍保留。','继续手动编辑 / 查看接入状态',C.muted],['资料不能用于本次生成','无法确认这份资料的使用权限，未发送给模型。','移除本次引用 / 查看原因',C.amber],['保存失败 · 断网或服务错误','当前输入仍在，请恢复连接后再保存。未送审。','重试保存 / 保留草稿',C.red],['保存冲突','服务器上有更新内容。你的输入不会被覆盖。','比较两个版本 / 保留我的草稿',C.amber],['保存结果未确认','请求已发送，但未收到明确结果。请先核对。','查询保存结果 / 暂不重复新建',C.amber],['恢复未保存内容','发现此前未保存的输入，尚未替换当前作品。','预览恢复内容 / 保留当前作品',C.blue],['审核权限已变化','你当前不能审核这份作品，未提交决定。','返回待办 / 刷新权限',C.red],['送审作品已经变化','本次审核对象需要重新核对，不能沿用旧批准。','查看最新送审作品 / 返回任务',C.red],['作品已批准 · 尚未发布','这份作品可交给发布负责人安排。','查看发布安排 / 返回任务',C.green]];
cards.forEach(([title,desc,action,color],i)=>{const x=32+i%3*464,y=118+Math.floor(i/3)*288;box(b,x,y,440,262);pill(b,x+20,y+20,90,'状态示例',C.soft,color);text(b,x+20,y+83,title,19,C.ink,600);const cut=desc.length>23?23:desc.length;lines(b,x+20,y+122,[desc.slice(0,cut),desc.slice(cut)],13,C.muted,25);rule(b,x+20,y+181,400);text(b,x+20,y+219,action,12,C.blue,600);});text(b,32,1012,'P1静态设计 · 不改变权限或服务端状态；详细交互约束见状态说明。',12,C.muted);save(b,'07-recovery-states');
}
const names=fs.readdirSync(out).filter(n=>n.endsWith('.svg')).sort();
fs.writeFileSync(path.join(out,'gallery.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>P1静态交互设计</title><style>body{font:16px "Microsoft YaHei",sans-serif;margin:24px;background:#eef1f6;color:#162941}img{display:block;max-width:100%;height:auto;background:white;border:1px solid #dfe5ef;border-radius:12px;margin:16px 0 36px}figure{margin:0}figcaption{font-weight:600}a{color:#245fe5}</style><h1>P1员工体验静态设计</h1><p>合成示例；不是可操作原型，不连接业务API。P2尚未开始。</p>'+names.map(n=>'<figure><figcaption>'+e(n)+'</figcaption><img src="'+e(n)+'" alt="'+e(n)+'"></figure>').join(''));
console.log('Generated '+names.length+' static SVG boards and non-interactive gallery.');
