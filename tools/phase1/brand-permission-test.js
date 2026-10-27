'use strict';
const assert=require('node:assert/strict');const h=require('./helpers');
async function denied(owner,edit){h.fixture();if(edit)edit();const p=h.proposal();await assert.rejects(h.call(p.id,h.payload(undefined,owner)),e=>e.status===400&&e.code==='BAD_ASSIGNEE');assert.equal(p.status,'PENDING_EDITORIAL_REVIEW');assert.equal(h.db.content_tasks.length,0);assert.equal(h.db.master_topics.length,0);}
(async()=>{
 await h.check('T02 active user of another brand is not a valid assignee',()=>denied('foreignCreator'));
 await h.check('T02 revoked brand permission is checked at dispatch time',()=>denied('creator',()=>{h.db.user_roles=h.db.user_roles.filter(x=>x.userId!=='creator');}));
 await h.check('T02 active user with non-production role is rejected',()=>denied('other'));
 await h.check('T02 disabled creator is rejected',()=>denied('creator',()=>{h.db.users.find(x=>x.id==='creator').status='disabled';}));
 await h.check('T02 missing assignee is rejected',()=>denied('missing'));
 await h.check('T02 authorized producer is assigned and other brand unchanged',async()=>{h.fixture();const p=h.proposal();const r=await h.call(p.id,h.payload());assert.equal(r.tasks[0].ownerId,'creator');assert.equal(h.db.content_tasks.filter(x=>x.brandCode==='UCARD').length,0);});
 h.finish('h02');
})().catch(e=>{console.error(e.message);h.finish('h02');process.exitCode=1;});
