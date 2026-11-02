// Explicit, browser-only simulation. This is not an authorization service or a production repository.
export type Brand = 'VFIB' | 'UCARD';
export type Role = 'maker' | 'professional' | 'publisher';
export type Actor = {id:string;name:string;roles:Role[];brands:Brand[]};
export const actors:Actor[]=[
 {id:'maker',name:'林悦',roles:['maker','publisher'],brands:['VFIB','UCARD']},
 {id:'professional',name:'陈岚',roles:['professional'],brands:['VFIB']},
 {id:'publisher',name:'周宁',roles:['publisher'],brands:['VFIB','UCARD']},
 {id:'ucard',name:'许晨',roles:['maker'],brands:['UCARD']}
];
export type FileRef={id:string;name:string;bytes:number;allowed:boolean;readable:boolean;selected:boolean;useForGeneration:boolean;inRequest:boolean};
export type Review={type:'professional'|'publisher';state:'PENDING'|'APPROVED'|'RETURNED'|'CANCELLED';actor?:string;comment?:string};
export type Work={id:string;number:number;row:number;author:string;title:string;body:string;files:FileRef[];state:'DRAFT'|'IN_REVIEW'|'REVISION_REQUIRED'|'APPROVED';reviews:Review[];signature?:string};
export type Task={id:string;brand:Brand;title:string;requirements:string;owner:string;author:string;due:string;risk:'G1'|'G2';future?:boolean;files:FileRef[];works:Work[]};
export type Message={id:string;role:'user'|'assistant';text:string};
export type Draft={title:string;body:string;files:FileRef[];baseId:string|null;baseRow:number;edit:number;savedEdit:number;prompt:string;messages:Message[];dirty:boolean};
export type Scenario='normal'|'not-configured'|'budget'|'generation-failed'|'save-409'|'save-500'|'offline'|'save-unknown-applied'|'save-unknown-unapplied'|'slow-save'|'file-denied'|'file-unreadable'|'upload-failed'|'review-denied'|'subject-changed'|'decision-unknown'|'revoked'|'task-changed'|'empty'|'read-denied'|'publication-wait'|'self-review'|'draft-recovery'|'slow-response';
export const scenarios:Scenario[]=['normal','not-configured','budget','generation-failed','save-409','save-500','offline','save-unknown-applied','save-unknown-unapplied','slow-save','file-denied','file-unreadable','upload-failed','review-denied','subject-changed','decision-unknown','revoked','task-changed','empty','read-denied','publication-wait','self-review','draft-recovery','slow-response'];
export class MockError extends Error{code:string;constructor(code:string){super(code);this.code=code;}}
type UnknownSave={taskId:string;scope:string;draft:Draft;applied:boolean};
export type Snapshot={seq:number;tasks:Task[];drafts:Record<string,Draft>;actorId:string;brand:Brand;taskId:string|null;page:'tasks'|'creative'|'review';locale:'zh'|'en';scenario:Scenario;unknown:UnknownSave|null;decisionUnknown:string|null;recovery:{scope:string;body:string;baseId:string|null;baseRow:number}|null};
const clone=<T,>(x:T):T=>x===undefined?x:JSON.parse(JSON.stringify(x));
export const latest=(t:Task)=>t.works[t.works.length-1];
const signature=(w:Work)=>JSON.stringify({title:w.title,body:w.body,files:w.files.filter(f=>f.selected).map(f=>({id:f.id,name:f.name,bytes:f.bytes}))});
const file=(id:string,name:string):FileRef=>({id,name,bytes:800,allowed:true,readable:false,selected:false,useForGeneration:false,inRequest:false});
function seed():Snapshot{
 const base=(id:string,title:string,brand:Brand='VFIB'):Task=>({id,brand,title,requirements:'合成任务：用清楚的语言说明服务内容，不添加未经确认的费率、收益或资格条件。',owner:brand==='VFIB'?'maker':'ucard',author:'publisher',due:'2026-11-02T17:00',risk:'G2',files:[file(id+'-file','服务说明（合成示例）.pdf')],works:[]});
 const a=base('p2-vfib-1','会员服务介绍短文');
 const b=base('p2-vfib-2','活动邀请文案');b.risk='G1';b.works=[{id:'p2-work-revision',number:1,row:2,author:'maker',title:'活动邀请文案',body:'这是待修改的合成文案，不包含真实业务事实。',files:[],state:'REVISION_REQUIRED',reviews:[{type:'publisher',state:'RETURNED',actor:'publisher',comment:'开头简短一些，并保留报名条件。'}]}];b.works[0].signature=signature(b.works[0]);
 const c=base('p2-vfib-3','品牌活动通知');c.future=true;c.due='2026-11-03T16:00';
 const d=base('p2-vfib-4','团队服务公告');d.owner='colleague';d.risk='G1';d.works=[{id:'p2-team-review',number:1,row:2,author:'colleague',title:d.title,body:'同事提交的合成公告，供演示独立审核。',files:[],state:'IN_REVIEW',reviews:[{type:'publisher',state:'PENDING'}]}];d.works[0].signature=signature(d.works[0]);
 const u=base('p2-ucard-1','UCARD活动介绍','UCARD');
 return {seq:20,tasks:[a,b,c,d,u],drafts:{},actorId:'maker',brand:'VFIB',taskId:null,page:'tasks',locale:'zh',scenario:'normal',unknown:null,decisionUnknown:null,recovery:null};
}
export class MockWorkspace{
 state:Snapshot;listeners=new Set<()=>void>();revision=0;generation=0;saving=new Set<string>();
 persist?: (s:Snapshot)=>void;delayMs:number;
 constructor(persist?: (s:Snapshot)=>void,initial?:Snapshot,delayMs=250){this.persist=persist;this.delayMs=delayMs;this.state=initial?clone(initial):seed();}
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 getSnapshot=()=>this.revision;
 touch(){this.revision++;this.persist?.(clone(this.state));for(const f of this.listeners)f();}
 get actor(){return actors.find(a=>a.id===this.state.actorId)!;}
 get scope(){return `${this.actor.id}:${this.state.brand}:${this.state.taskId||'free'}`;}
 id(prefix:string){return `p2-${prefix}-${++this.state.seq}`;}
 assertBrand(brand:Brand){if(!this.actor.brands.includes(brand)||brand!==this.state.brand||this.state.scenario==='read-denied')throw new MockError('task.denied');}
 task(id=this.state.taskId):Task{const t=this.state.tasks.find(t=>t.id===id);if(!t)throw new MockError('task.denied');this.assertBrand(t.brand);return t;}
 draft():Draft{
  const key=this.scope;
  if(!this.state.drafts[key]){let w:Work|undefined,t:Task|undefined;if(this.state.taskId){t=this.task();w=latest(t);}this.state.drafts[key]={title:w?.title||t?.title||'',body:w?.body||'',files:clone(w?.files||t?.files||[]),baseId:w?.id||null,baseRow:w?.row||0,edit:0,savedEdit:0,prompt:'',messages:[],dirty:false};}
  return this.state.drafts[key];
 }
 assertEditable(){const w=this.state.taskId?latest(this.task()):undefined;if(w&&w.state!=='DRAFT')throw new MockError('work.frozen');}
 edit(field:'title'|'body'|'prompt',value:string){if(!this.actor.roles.includes('maker'))throw new MockError('task.denied');if(field!=='prompt')this.assertEditable();const d=this.draft();d[field]=value;if(field!=='prompt'){d.edit++;d.dirty=true;}this.touch();}
 changeBrand(brand:Brand){if(!this.actor.brands.includes(brand))throw new MockError('task.denied');this.generation++;this.state.brand=brand;this.state.taskId=null;this.state.page='tasks';this.touch();}
 changeActor(id:string){const a=actors.find(a=>a.id===id);if(!a)throw new MockError('task.denied');this.generation++;this.state.actorId=id;if(!a.brands.includes(this.state.brand))this.state.brand=a.brands[0];this.state.page='tasks';this.state.taskId=null;this.touch();}
 open(id:string,page:'creative'|'review'='creative'){this.task(id);this.generation++;this.state.taskId=id;this.state.page=page;this.touch();}
 free(){this.generation++;this.state.taskId=null;this.state.page='creative';this.touch();}
 setScenario(s:Scenario){this.state.scenario=s;if(s==='task-changed'&&this.state.taskId)this.task().requirements='合成情境：任务要求刚刚更新，请核对新的截止安排。';if(s==='draft-recovery'){const d=this.draft();this.state.recovery={scope:this.scope,body:'尚未保存的合成恢复草稿。',baseId:d.baseId,baseRow:d.baseRow};}this.touch();}
 removeFile(id:string){this.assertEditable();const d=this.draft();d.files=d.files.filter(f=>f.id!==id);d.edit++;d.dirty=true;this.touch();}
 prepareScenario(s:Scenario){
  if(['self-review','review-denied','subject-changed','decision-unknown','publication-wait'].includes(s)){
   this.state.actorId=s==='self-review'?'maker':s==='publication-wait'?'publisher':'professional';this.state.brand='VFIB';const t=this.state.tasks.find(t=>t.id==='p2-vfib-1')!;
   if(!latest(t)||latest(t)!.state!=='IN_REVIEW'){const w:Work={id:this.id('scenario-work'),number:t.works.length+1,row:1,author:'maker',title:t.title,body:'这是供审核情境演示的固定合成作品。',files:[],state:'IN_REVIEW',reviews:[{type:'professional',state:'PENDING'},{type:'publisher',state:'PENDING'}]};w.signature=signature(w);t.works.push(w);}
   this.state.taskId=t.id;this.state.page='review';
  }
  if(['file-denied','revoked','file-unreadable'].includes(s)){const d=this.draft();if(!d.files.length)d.files.push(file(this.id('file'),'合成资料.pdf'));d.files.forEach(f=>{if(s==='file-unreadable')f.readable=false;else{f.allowed=false;f.useForGeneration=true;}});}
  this.setScenario(s);
 }
 setLocale(locale:'zh'|'en'){this.state.locale=locale;this.touch();}
 list(view:string,q=''){
  if(this.state.scenario==='empty'||this.state.scenario==='read-denied')return [];
  return this.state.tasks.filter(t=>t.brand===this.state.brand&&this.actor.brands.includes(t.brand)).filter(t=>{
   const w=latest(t);if(view==='review')return !!w&&w.reviews.some(c=>this.canReview(t,w,c));
   if(view==='revision')return t.owner===this.actor.id&&w?.state==='REVISION_REQUIRED';
   if(view==='due')return t.owner===this.actor.id&&!t.future&&w?.state!=='APPROVED';
   if(view==='all')return true;return t.owner===this.actor.id&&w?.state!=='APPROVED';
  }).filter(t=>`${t.title} ${actors.find(a=>a.id===t.owner)?.name||''}`.toLowerCase().includes(q.toLowerCase()));
 }
 async generate(){
  if(!this.actor.roles.includes('maker'))throw new MockError('task.denied');
  const d=this.draft(),scope=this.scope,token=++this.generation,scenario=this.state.scenario,prompt=d.prompt.trim();
  if(!prompt)throw new MockError('create.input');
  if(['not-configured','budget','generation-failed','offline'].includes(scenario))throw new MockError(scenario==='not-configured'?'create.not_configured':scenario==='budget'?'create.budget':scenario==='file-denied'||scenario==='revoked'?'file.denied':'create.failed');
  if(d.files.some(f=>f.useForGeneration&&!f.allowed))throw new MockError('file.denied');
  if(d.files.some(f=>f.useForGeneration&&!f.readable))throw new MockError('file.unreadable');
  await new Promise(r=>setTimeout(r,scenario==='slow-response'?1200:this.delayMs));
  if(token!==this.generation||scope!==this.scope)return false;
  d.files.forEach(f=>{f.inRequest=f.useForGeneration&&f.allowed&&f.readable;});
  d.messages.push({id:this.id('message'),role:'user',text:prompt},{id:this.id('message'),role:'assistant',text:`【MOCK · 合成候选稿】\n${prompt}\n\n先说明适用场景，再介绍已核实的内容。具体条件以正式资料为准。\n此内容由本地演示规则生成，未调用AI，不可直接发布。`});
  d.prompt='';this.touch();return true;
 }
 select(text:string){if(!this.actor.roles.includes('maker'))throw new MockError('task.denied');if(this.state.taskId&&latest(this.task())?.state&&latest(this.task())!.state!=='DRAFT')throw new MockError('work.frozen');const d=this.draft();d.body=text;if(!d.title)d.title='选定的合成文字作品';d.edit++;d.dirty=true;this.touch();}
 addFile(name:string,bytes:number){this.assertEditable();
  if(!this.actor.roles.includes('maker'))throw new MockError('task.denied');
  if(this.state.scenario==='upload-failed'||bytes>2*1024*1024)throw new MockError('file.failed');
  const f={...file(this.id('file'),name),bytes,allowed:this.state.scenario!=='file-denied',readable:/\.(txt|md|csv|json)$/i.test(name)&&this.state.scenario!=='file-unreadable'};this.draft().files.push(f);this.draft().edit++;this.draft().dirty=true;this.touch();return f;
 }
 selectFile(id:string,selected:boolean){this.assertEditable();if(!this.actor.roles.includes('maker'))throw new MockError('task.denied');const d=this.draft(),f=d.files.find(f=>f.id===id);if(!f)throw new MockError('file.failed');if(selected&&!f.allowed)throw new MockError('file.denied');f.selected=selected;d.edit++;d.dirty=true;this.touch();}
 generationFile(id:string,value:boolean){if(!this.actor.roles.includes('maker'))throw new MockError('task.denied');const f=this.draft().files.find(f=>f.id===id);if(!f||!f.allowed)throw new MockError('file.denied');if(!f.readable)throw new MockError('file.unreadable');f.useForGeneration=value;this.touch();}
 makeTask(title:string,requirements='',ownerId=this.actor.id,due='2026-11-03T17:00'){if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(due)||!Number.isFinite(new Date(due).getTime()))throw new MockError('task.changed');if(!this.actor.roles.includes('maker')||!title.trim())throw new MockError('task.denied');if(!actors.some(a=>a.id===ownerId&&a.brands.includes(this.state.brand)&&a.roles.includes('maker')))throw new MockError('task.denied');const t:Task={id:this.id('task'),brand:this.state.brand,title,requirements:requirements||'从本地合成创作选定的作品。',owner:ownerId,author:this.actor.id,due,risk:'G2',files:[],works:[]};this.state.tasks.push(t);this.touch();return t;}
 attachToTask(id:string){if(!this.actor.roles.includes('maker'))throw new MockError('task.denied');const original=clone(this.draft());const target=this.task(id);const w=latest(target);if(w&&w.state!=='DRAFT')throw new MockError('work.frozen');this.state.taskId=id;original.title=original.title||target.title;original.baseId=w?.id||null;original.baseRow=w?.row||0;original.dirty=true;original.edit++;this.state.drafts[this.scope]=original;this.touch();}
 commit(t:Task,d:Draft,actorId=this.actor.id){
  const current=latest(t);if(current&&current.state!=='DRAFT')throw new MockError('work.frozen');
  if((current?.id||null)!==d.baseId||(current?.row||0)!==d.baseRow)throw new MockError('work.conflict');
  const w:Work={id:current?.id||this.id('work'),number:current?.number||t.works.length+1,row:(current?.row||0)+1,author:current?.author||actorId,title:d.title,body:d.body,files:clone(d.files),state:'DRAFT',reviews:[]};
  if(current)t.works[t.works.length-1]=w;else t.works.push(w);t.files=clone(w.files);return w;
 }
 async save(){
  if(!this.actor.roles.includes('maker'))throw new MockError('task.denied');const t=this.task(),d=this.draft(),scope=this.scope,snap=clone(d),actorId=this.actor.id,scenario=this.state.scenario;
  if(!snap.title.trim()||!snap.body.trim())throw new MockError('work.save_first');
  if(snap.files.some(f=>f.selected&&!f.allowed))throw new MockError('file.denied');
  if(this.saving.has(scope))throw new MockError('work.saving');this.saving.add(scope);
  try{
   await new Promise(r=>setTimeout(r,scenario==='slow-save'?1200:this.delayMs));
   if(['save-500','offline'].includes(scenario))throw new MockError('work.save_failed');
   if(scenario==='save-409')throw new MockError('work.conflict');
   if(scenario==='save-unknown-applied'||scenario==='save-unknown-unapplied'){
    if(scenario==='save-unknown-applied')this.commit(t,snap,actorId);
    this.state.unknown={taskId:t.id,scope,draft:snap,applied:scenario==='save-unknown-applied'};this.touch();throw new MockError('work.unknown');
   }
   const w=this.commit(t,snap,actorId);d.baseId=w.id;d.baseRow=w.row;d.savedEdit=snap.edit;
   d.dirty=d.edit!==snap.edit;this.touch();if(d.dirty)throw new MockError('work.changed_during_save');return w;
  }finally{this.saving.delete(scope);}
 }
 reconcile(){const u=this.state.unknown;if(!u||u.scope!==this.scope)throw new MockError('work.unknown');const d=this.draft(),w=latest(this.task());if(u.applied&&w){d.baseId=w.id;d.baseRow=w.row;d.savedEdit=u.draft.edit;d.dirty=d.edit!==u.draft.edit;}this.state.unknown=null;this.state.scenario='normal';this.touch();return u.applied;}
 serverDraft(){return clone(latest(this.task()));}
 rebase(){const d=this.draft(),w=latest(this.task());if(w?.state&&w.state!=='DRAFT')throw new MockError('work.frozen');d.baseId=w?.id||null;d.baseRow=w?.row||0;d.dirty=true;this.state.scenario='normal';this.touch();}
 async submit(){
  const t=this.task(),d=this.draft(),w=latest(t);if(!this.actor.roles.includes('maker')||!w||w.state!=='DRAFT')throw new MockError('work.frozen');
  if(d.dirty||d.edit!==d.savedEdit||d.baseId!==w.id||d.baseRow!==w.row||this.saving.has(this.scope)||this.state.unknown?.scope===this.scope)throw new MockError('work.save_first');
  if(d.files.some(f=>f.selected&&!f.allowed)||this.state.scenario==='revoked')throw new MockError('file.denied');
  if(w.body!==d.body||w.title!==d.title)throw new MockError('work.conflict');
  w.state='IN_REVIEW';w.row++;w.signature=signature(w);w.reviews=t.risk==='G2'?[{type:'professional',state:'PENDING'},{type:'publisher',state:'PENDING'}]:[{type:'publisher',state:'PENDING'}];d.baseRow=w.row;this.touch();return w;
 }
 canReview(t:Task,w:Work,c:Review){return t.brand===this.state.brand&&this.actor.brands.includes(t.brand)&&w.state==='IN_REVIEW'&&c.state==='PENDING'&&this.actor.roles.includes(c.type)&&w.author!==this.actor.id&&this.state.scenario!=='review-denied'&&!(c.type==='publisher'&&w.reviews.some(r=>r.type==='professional'&&r.state!=='APPROVED'));}
 decide(taskId:string,type:Review['type'],action:'approve'|'return',comment:string,expected:{id:string;row:number}){
  const t=this.task(taskId),w=latest(t),c=w?.reviews.find(c=>c.type===type);if(!w||w.id!==expected.id||w.row!==expected.row)throw new MockError('review.changed');if(!w||!c||!this.canReview(t,w,c))throw new MockError(w?.author===this.actor.id?'review.self':'review.denied');
  if(this.state.scenario==='subject-changed'||w.signature!==signature(w))throw new MockError('review.changed');
  if(action==='return'&&!comment.trim())throw new MockError('review.comments_required');
  c.actor=this.actor.id;c.comment=comment;c.state=action==='approve'?'APPROVED':'RETURNED';
  if(action==='return'){w.state='REVISION_REQUIRED';w.reviews.forEach(r=>{if(r!==c&&r.state==='PENDING')r.state='CANCELLED';});}
  else if(w.reviews.every(r=>r.state==='APPROVED'))w.state='APPROVED';w.row++;
  if(this.state.scenario==='decision-unknown'){this.state.decisionUnknown=w.id;this.touch();throw new MockError('review.unknown');}this.touch();return w;
 }
 revise(){const t=this.task(),w=latest(t);if(!this.actor.roles.includes('maker')||!w||!['REVISION_REQUIRED','APPROVED'].includes(w.state))throw new MockError('work.frozen');const next:Work={...clone(w),id:this.id('work'),number:w.number+1,row:1,state:'DRAFT',reviews:[],signature:undefined,author:this.actor.id};t.works.push(next);delete this.state.drafts[this.scope];this.touch();}
 recover(){const d=this.draft(),r=this.state.recovery,w=this.state.taskId?latest(this.task()):undefined;if(!r||r.scope!==this.scope||(w?.id||null)!==r.baseId||(w?.row||0)!==r.baseRow)throw new MockError('work.conflict');if(w&&w.state!=='DRAFT')throw new MockError('work.frozen');d.body=r.body;d.dirty=true;d.edit++;this.state.recovery=null;this.state.scenario='normal';this.touch();}
 reset(){this.generation++;this.state=seed();this.touch();}
}
