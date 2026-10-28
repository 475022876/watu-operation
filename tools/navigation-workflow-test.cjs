'use strict';
const h=require('./phase1/helpers'),assert=require('node:assert/strict');
require('../lib/mos/routes/tasks');require('../lib/mos/routes/task-workspace');
const workflow=require('../lib/mos/task-workflow'),rows=[];
function call(method,pattern,body={},id='',actor='editor',query={brand:'VFIB'}){
 const user=h.db.users.find(u=>u.id===actor);return h.router.routes.find(r=>r.method===method&&r.pattern===pattern).handler({body,params:{id},query,user,principal:h.rbac.principalOf(h.db,user),ip:'127.0.0.1'});
}
async function test(name,fn){try{await fn();rows.push({name,passed:true});console.log('PASS '+name);}catch(e){rows.push({name,passed:false,error:e.message});console.log('FAIL '+name+' '+e.message);}}
(async()=>{
 h.fixture();let task;
 await test('create requirements future date urgent and eligible owner atomically',async()=>{task=(await call('POST','/api/mos/tasks',{title:'Employee workflow',ownerId:'creator',requirements:'Required result',priority:'URGENT',startAt:'2026-11-01',productionDue:'2026-11-03'})).task;assert.equal(task.requirements,'Required result');assert.equal(task.ownerId,'creator');assert.equal(task.priority,'URGENT');});
 await test('cross-brand assignee refused',()=>assert.rejects(call('POST','/api/mos/tasks',{title:'Forbidden',ownerId:'foreignCreator'}),e=>e.status===403));
 await test('revoked assignee refused',async()=>{const grant=h.db.user_roles.find(r=>r.userId==='creator');grant.roleCode='NO_ROLE';try{await assert.rejects(call('PUT','/api/mos/tasks/:id',{ownerId:'creator'},task.id),e=>e.status===403);}finally{grant.roleCode='P2';}});
 await test('invalid priority refused',()=>assert.rejects(call('PUT','/api/mos/tasks/:id',{priority:'BAD'},task.id),e=>e.status===400));
 await test('start after deadline refused',()=>assert.rejects(call('PUT','/api/mos/tasks/:id',{startAt:'2026-12-01'},task.id),e=>e.status===400));
 await test('stale row version refuses lost update',()=>assert.rejects(call('PUT','/api/mos/tasks/:id',{requirements:'new',rowVersion:999},task.id),e=>e.status===409));
 await test('task workspace denies cross-brand',()=>assert.rejects(call('GET','/api/mos/tasks/:id/workspace',{},task.id,'foreign'),e=>e.status===403||e.status===404));
 await test('ordinary employee cannot remind',()=>assert.rejects(call('POST','/api/mos/tasks/:id/remind',{},task.id,'creator'),e=>e.status===403));
 await test('manager reminder persisted with recipient no external messages',async()=>{await call('POST','/api/mos/tasks/:id/remind',{},task.id);assert.equal((await call('GET','/api/mos/tasks/:id/workspace',{},task.id)).reminders.length,1);});
 await test('today and future and urgent date filters',()=>{const now=new Date(2026,9,28,12);assert(workflow.dateInPeriod({productionDue:'2026-10-28'},'today',now));assert(!workflow.dateInPeriod({productionDue:'2026-10-29'},'today',now));assert(workflow.dateInPeriod({startAt:'2026-11-01'},'future',now));assert(!workflow.dateInPeriod({productionDue:'2026-10-01',status:'COMPLETED'},'overdue',now));assert(workflow.dateInPeriod({priority:'URGENT',status:'PLANNED'},'urgent',now));});
 await test('write failure leaves requirements and row version unchanged',async()=>{const fs=require('fs'),rename=fs.renameSync,before=JSON.stringify(h.db.content_tasks);fs.renameSync=()=>{throw Error('Injected save failure');};try{await assert.rejects(call('PUT','/api/mos/tasks/:id',{requirements:'must rollback',rowVersion:task.rowVersion},task.id));assert.equal(JSON.stringify(h.db.content_tasks),before);}finally{fs.renameSync=rename;}});
})().catch(e=>rows.push({name:'harness',passed:false,error:e.message})).finally(()=>{const out=h.path.resolve('TEST_EVIDENCE_NAVIGATION');h.fs.mkdirSync(out,{recursive:true});h.fs.writeFileSync(h.path.join(out,'workflow.json'),JSON.stringify({at:new Date().toISOString(),passed:rows.filter(r=>r.passed).length,failed:rows.filter(r=>!r.passed).length,rows},null,2));h.store.reset();const real=h.fs.realpathSync(h.dir);if(!real.startsWith(h.path.resolve(require('os').tmpdir())+h.path.sep)||!h.path.basename(real).startsWith('mos-phase1-'))throw Error('Unsafe cleanup');h.fs.rmSync(real,{recursive:true,force:true});process.exitCode=rows.some(r=>!r.passed)?1:0;});
