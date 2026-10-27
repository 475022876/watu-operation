'use strict';
const assert=require('node:assert/strict');const h=require('./helpers');
require('../../lib/mos/routes/content');
const file=h.path.join(h.dir,'mos.json');
function withFault(kind,fn){const old=h.fs[kind];h.fs[kind]=function(...args){if((kind==='renameSync'&&args[1]===file)||(kind==='writeFileSync'&&String(args[0]).startsWith(file+'.'))){const e=Error('SYNTHETIC_DISK_FAILURE');e.code='EIO';throw e;}return old.apply(this,args);};return Promise.resolve().then(fn).finally(()=>h.fs[kind]=old);}
async function failedMutation(kind,fn){const before=JSON.stringify(h.db),disk=h.fs.readFileSync(file,'utf8');await withFault(kind,()=>assert.rejects(fn,/SYNTHETIC_DISK_FAILURE/));assert.equal(JSON.stringify(h.db),before);assert.equal(h.fs.readFileSync(file,'utf8'),disk);}
function ctx(body,id,actor='creator'){const user=h.db.users.find(x=>x.id===actor);return {body,params:{id},query:{brand:'VFIB'},user,principal:h.rbac.principalOf(h.db,user),ip:'127.0.0.1'};}
function route(method,pattern){return h.router.routes.find(r=>r.method===method&&r.pattern===pattern).handler;}
(async()=>{
 await h.check('T03 dispatch success is persisted before response',async()=>{h.fixture();const p=h.proposal();const r=await h.call(p.id,h.payload());const disk=JSON.parse(h.fs.readFileSync(file));assert.equal(disk.topic_proposals.find(x=>x.id===p.id).status,'APPROVED');assert.equal(disk.content_tasks[0].id,r.tasks[0].id);});
 for(const fault of ['writeFileSync','renameSync'])await h.check('T03 dispatch '+fault+' failure rolls back objects state audit and sequences',async()=>{h.fixture();const p=h.proposal();h.store.saveNow();await failedMutation(fault,()=>h.call(p.id,h.payload()));assert.equal(h.db.topic_proposals[0].status,'PENDING_EDITORIAL_REVIEW');});
 await h.check('T03 pool approval cannot succeed on disk failure',async()=>{h.fixture();const p=h.proposal();h.store.saveNow();await failedMutation('renameSync',()=>h.call(p.id,{},'editor','approve-to-pool'));});
 await h.check('T03 callback exception rolls back all in-memory mutation',()=>{h.fixture();const before=JSON.stringify(h.db);assert.throws(()=>h.store.atomicMutation(()=>{h.db.seq.fixture=999;throw Error('INTERRUPTED');}),/INTERRUPTED/);assert.equal(JSON.stringify(h.db),before);});
 await h.check('T03 async callback is rejected before invocation',()=>{let ran=false;assert.throws(()=>h.store.atomicMutation(async()=>{ran=true;}),/SYNCHRONOUS_TRANSACTION_REQUIRED/);assert.equal(ran,false);});
 await h.check('T03 nested transaction is rejected and rolled back',()=>{const before=JSON.stringify(h.db);assert.throws(()=>h.store.atomicMutation(()=>{h.db.seq.fixture=3;h.store.atomicMutation(()=>{});}),/SYNCHRONOUS_TRANSACTION_REQUIRED/);assert.equal(JSON.stringify(h.db),before);});
 h.fixture();const p=h.proposal();const disp=await h.call(p.id,h.payload());const taskId=disp.tasks[0].id;
 let version=(await route('POST','/api/mos/content-versions')(ctx({taskId,title:'Fixture',body:'Saved fixture body'}))).version;
 await h.check('T03 draft creation is committed before response',()=>{assert(JSON.parse(h.fs.readFileSync(file)).content_versions.some(v=>v.id===version.id));});
 await h.check('T03 failed content edit preserves persisted draft and rowVersion',async()=>{await failedMutation('renameSync',()=>route('PUT','/api/mos/content-versions/:id')(ctx({body:'Unsaved fixture',rowVersion:version.rowVersion},version.id)));});
 await h.check('T03 failed review lock preserves DRAFT task and empty review chain',async()=>{await failedMutation('renameSync',()=>route('POST','/api/mos/content-versions/:id/lock')(ctx({},version.id)));assert.equal(h.db.content_versions.find(x=>x.id===version.id).state,'DRAFT');assert.equal(h.db.review_cases.length,0);});
 await h.check('T03 successful edit is committed before response',async()=>{version=(await route('PUT','/api/mos/content-versions/:id')(ctx({body:'Durable fixture',rowVersion:version.rowVersion},version.id))).version;assert.equal(JSON.parse(h.fs.readFileSync(file)).content_versions[0].body,'Durable fixture');});
 await h.check('T07 stale reviewed version token is rejected before lock',async()=>{await assert.rejects(route('POST','/api/mos/content-versions/:id/lock')(ctx({rowVersion:version.rowVersion-1},version.id)),e=>e.status===409&&e.code==='ROW_VERSION_CONFLICT');assert.equal(h.db.review_cases.length,0);});
 await h.check('T07 review lock binds exact persisted content manifest',async()=>{const r=await route('POST','/api/mos/content-versions/:id/lock')(ctx({},version.id));const disk=JSON.parse(h.fs.readFileSync(file));assert.equal(disk.content_versions[0].manifestHash,r.version.manifestHash);assert(disk.review_cases.every(c=>c.versionHash===r.version.manifestHash));});
 await h.check('T07 locked version cannot be overwritten',async()=>{await assert.rejects(route('PUT','/api/mos/content-versions/:id')(ctx({body:'Tamper'},version.id)),e=>e.status===409&&e.code==='VERSION_IMMUTABLE');});
 await h.check('T03 schema8 and Provider collections preserved',()=>{assert.equal(h.db.mosSchemaVersion,8);assert(Array.isArray(h.db.provider_calls));assert(Array.isArray(h.db.video_render_jobs));h.store.migrate(h.db);assert.equal(h.store.migrate(h.db),false);});
 h.finish('h03');
})().catch(e=>{console.error(e.message);h.finish('h03');process.exitCode=1;});
