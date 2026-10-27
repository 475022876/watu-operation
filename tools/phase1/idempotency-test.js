'use strict';
const assert=require('node:assert/strict');const h=require('./helpers');
(async()=>{
 h.fixture();const p=h.proposal(),body=h.payload('scope-key');await h.call(p.id,body);
 await h.check('T01 identical replay creates no additional objects',async()=>{const n=h.db.content_tasks.length;const r=await h.call(p.id,body);assert.equal(r.replay,true);assert.equal(h.db.content_tasks.length,n);});
 await h.check('T01 normalized object order and defaults replay',async()=>{const r=await h.call(p.id,{deliverables:[{productionDue:'2026-11-10',ownerId:'creator',platform:'linkedin',type:'ARTICLE',title:'',reviewDue:null}],workDate:'2026-11-05',idempotencyKey:'scope-key',priority:'P1',narrativeCode:'N01',adHoc:false,comments:''});assert.equal(r.replay,true);});
 await h.check('T01 changed payload returns 409',async()=>{await assert.rejects(h.call(p.id,{...body,workDate:'2026-11-06'}),e=>e.status===409&&e.code==='IDEMPOTENCY_CONFLICT');});
 await h.check('T01 another actor cannot reuse key',async()=>{await assert.rejects(h.call(p.id,body,'other'),e=>e.status===409&&e.code==='IDEMPOTENCY_CONFLICT');});
 await h.check('T01 another proposal cannot reuse key',async()=>{await assert.rejects(h.call(h.proposal().id,body),e=>e.status===409&&e.code==='IDEMPOTENCY_CONFLICT');});
 await h.check('T01 another brand cannot obtain previous dispatch',async()=>{const q=h.proposal('UCARD');await assert.rejects(h.call(q.id,h.payload('scope-key','foreignCreator'),'foreign'),e=>e.status===409&&e.code==='IDEMPOTENCY_CONFLICT');});
 await h.check('T01 unauthorized requested brand returns 404 before replay',async()=>{await assert.rejects(h.call(p.id,body,'foreign'),e=>e.status===404);});
 await h.check('T01 revoked actor permission rejects replay before returning data',async()=>{const grants=h.db.user_roles;h.db.user_roles=h.db.user_roles.filter(x=>x.userId!=='editor');try{await assert.rejects(h.call(p.id,body),e=>e.status===404||e.status===403);}finally{h.db.user_roles=grants;}});
 await h.check('T01 legacy dispatch without request digest fails closed',async()=>{delete p.dispatch.requestDigest;await assert.rejects(h.call(p.id,body),e=>e.status===409&&e.code==='IDEMPOTENCY_CONFLICT');});
 h.finish('h01');
})().catch(e=>{console.error(e.message);h.finish('h01');process.exitCode=1;});
