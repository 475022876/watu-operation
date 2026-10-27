'use strict';
const h=require('./helpers'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const port=9582,base='http://127.0.0.1:'+port,root=h.path.resolve(__dirname,'../..');let server;const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 h.fixture();const p=h.proposal(),body=h.payload('http-durability');const user=h.db.users.find(x=>x.id==='editor');const password='Test-'+crypto.randomBytes(18).toString('hex');const pw=require('../../lib/password').hashPassword(password);user.salt=pw.salt;user.passwordHash=pw.hash;h.store.saveNow();h.store.reset();
 server=spawn(process.execPath,['--require',h.path.join(__dirname,'fault-preload.cjs'),'server.js'],{cwd:root,env:{...process.env,MOS_DATA_DIR:h.dir,MOS_PORT:String(port),MOS_HOST:'127.0.0.1',MOS_SCHEDULER_ENABLED:'0'},stdio:'ignore'});
 for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch(_){}await sleep(100);}
 const jar=new Map();async function req(method,url,data){const r=await fetch(base+url,{method,headers:{Cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),'x-mos-csrf':jar.get('mos_csrf')||'','Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});for(const c of r.headers.getSetCookie()){const q=c.split(';')[0],i=q.indexOf('=');jar.set(q.slice(0,i),q.slice(i+1));}return{status:r.status,body:await r.json()};}
 await req('GET','/api/mos/auth/me');assert.equal((await req('POST','/api/mos/auth/login',{username:'editor',password})).status,200);
 const file=h.path.join(h.dir,'mos.json'),flag=h.path.join(h.dir,'inject-rename-failure');h.fs.writeFileSync(flag,'synthetic');
 let failure;await h.check('T03 real HTTP disk failure responds 500 instead of success',async()=>{failure=await req('POST','/api/mos/topic-proposals/'+p.id+'/approve-and-schedule',body);assert.equal(failure.status,500);assert.equal(failure.body.ok,false);});
 await h.check('T03 real HTTP failure leaves proposal and task state unchanged',()=>{const db=JSON.parse(h.fs.readFileSync(file));assert.equal(db.topic_proposals[0].status,'PENDING_EDITORIAL_REVIEW');assert.equal(db.content_tasks.length,0);assert.equal(db.master_topics.length,0);});
 h.fs.unlinkSync(flag);let success;
 await h.check('T03 real HTTP retry safely commits once',async()=>{success=await req('POST','/api/mos/topic-proposals/'+p.id+'/approve-and-schedule',body);assert.equal(success.status,200);const db=JSON.parse(h.fs.readFileSync(file));assert.equal(db.content_tasks.length,1);assert.equal(db.topic_proposals[0].status,'APPROVED');});
 await h.check('T01 real HTTP replay creates no duplicate task',async()=>{const r=await req('POST','/api/mos/topic-proposals/'+p.id+'/approve-and-schedule',body);assert.equal(r.status,200);assert.equal(r.body.replay,true);assert.equal(JSON.parse(h.fs.readFileSync(file)).content_tasks.length,1);});
 await h.check('T01 real HTTP changed payload returns 409',async()=>{const r=await req('POST','/api/mos/topic-proposals/'+p.id+'/approve-and-schedule',{...body,workDate:'2026-11-06'});assert.equal(r.status,409);assert.equal(r.body.code,'IDEMPOTENCY_CONFLICT');});
})().catch(e=>h.check('HTTP harness setup',()=>{throw e;})).finally(async()=>{if(server)server.kill();await sleep(600);h.finish('http-durability');});
