'use strict';
// Real headless Chrome + isolated HTTP server. No real credentials, models or external services.
const h=require('./helpers'),assert=require('node:assert/strict'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=h.path.resolve(__dirname,'../..');const dir=h.dir,port=9581,cdpPort=9632,base='http://127.0.0.1:'+port;
const profile=h.fs.mkdtempSync(h.path.join(os.tmpdir(),'mos-phase1-browser-'));
const out=h.path.join(root,'TEST_EVIDENCE_PHASE1/browser');h.fs.mkdirSync(out,{recursive:true});
const results=[];let server,chrome,cdp;let mode='',lockRequests=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS '+name);}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL '+name+' '+e.message);}}
class Cdp{constructor(url){this.ws=new WebSocket(url);this.n=0;this.pending=new Map();this.handlers=[];this.ready=new Promise((r,j)=>{this.ws.addEventListener('open',r);this.ws.addEventListener('error',j);});this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else this.handlers.forEach(f=>f(m));});}send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.n;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout '+method));},15000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}close(){this.ws.close();}}
async function evaluate(expression){const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;}
async function wait(expression){for(let i=0;i<70;i++){try{if(await evaluate(expression))return;}catch(_){}await sleep(100);}throw Error('Browser condition timed out');}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function screenshot(name){await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const r=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});h.fs.writeFileSync(h.path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
(async()=>{
 h.fixture();const p=h.proposal();const dispatch=await h.call(p.id,h.payload());const taskId=dispatch.tasks[0].id;
 require('../../lib/mos/routes/content');const user=h.db.users.find(x=>x.id==='creator');const password='Test-'+crypto.randomBytes(18).toString('hex');const pw=require('../../lib/password').hashPassword(password);user.salt=pw.salt;user.passwordHash=pw.hash;
 h.db.content_tasks[0].businessBasis={type:'OFFICIAL_NOTICE',note:'Synthetic authorized fixture'};
 const make=h.router.routes.find(x=>x.method==='POST'&&x.pattern==='/api/mos/content-versions').handler;
 const created=await make({body:{taskId,title:'Phase 1 browser fixture',body:'Original saved body'},query:{brand:'VFIB'},params:{},user,principal:h.rbac.principalOf(h.db,user),ip:'127.0.0.1'});const versionId=created.version.id;
 h.store.saveNow();h.store.reset();
 server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,MOS_PORT:String(port),MOS_HOST:'127.0.0.1',MOS_DATA_DIR:dir,MOS_SCHEDULER_ENABLED:'0'},stdio:'ignore'});
 for(let i=0;i<70;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch(_){}await sleep(100);}
 const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>h.fs.existsSync(p));if(!executable)throw Error('Chrome unavailable');
 chrome=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','--window-size=1680,1050','--remote-debugging-port='+cdpPort,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 let tabs;for(let i=0;i<70;i++){try{tabs=await(await fetch('http://127.0.0.1:'+cdpPort+'/json')).json();if(tabs.some(t=>t.type==='page'))break;}catch(_){}await sleep(100);}
 cdp=new Cdp(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await cdp.ready;await cdp.send('Page.enable');await cdp.send('Network.enable');
 cdp.handlers.push(m=>{if(m.method==='Network.requestWillBeSent'&&m.params.request.method==='POST'&&m.params.request.url.includes('/'+versionId+'/lock'))lockRequests++;if(m.method==='Fetch.requestPaused'){
  const {requestId,request}=m.params;if(request.method==='PUT'&&request.url.includes('/api/mos/content-versions/'+versionId)&&mode){const params=mode==='offline'?{requestId,errorReason:'InternetDisconnected'}:{requestId,responseCode:Number(mode),responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({ok:false,code:mode==='409'?'ROW_VERSION_CONFLICT':'INJECTED_SAVE_FAILURE',error:'Synthetic save failure'})).toString('base64')};cdp.send(mode==='offline'?'Fetch.failRequest':'Fetch.fulfillRequest',params).catch(()=>{});}else cdp.send('Fetch.continueRequest',{requestId}).catch(()=>{});}});
 await cdp.send('Page.navigate',{url:base+'/mos'});await wait("!!document.querySelector('#appRoot')");
 const login=await evaluate(`(async()=>{await fetch('/api/mos/auth/me');const token=()=>decodeURIComponent(document.cookie.split('; ').find(x=>x.startsWith('mos_csrf=')).split('=').slice(1).join('='));const r=await fetch('/api/mos/auth/login',{method:'POST',headers:{'Content-Type':'application/json','x-mos-csrf':token()},body:JSON.stringify({username:'creator',password:${JSON.stringify(password)}})});return r.status;})()`);assert.equal(login,200);
 await cdp.send('Page.navigate',{url:base+'/mos?phase1='+Date.now()+'#/content-editor?task='+taskId});await wait("!!document.querySelector('#ceText') && document.querySelector('#ceText').getClientRects().length>0");
 await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/api/mos/content-versions/*',requestStage:'Request'}]});
 for(const scenario of ['409','500','offline'])await check('T08 real Chrome '+scenario+' retains draft and blocks review lock',async()=>{
  mode=scenario;const text='Retained employee draft '+scenario;
  await evaluate(`(()=>{const e=document.querySelector('#ceText');e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#ceLock').click();})()`);
  await wait("document.querySelector('#ceSaveState')?.getAttribute('role')==='alert' && document.querySelector('#ceSaveState')?.textContent.includes('未提交审核')");
  assert.equal(await evaluate("document.querySelector('#ceText').value"),text);assert.equal(lockRequests,0);
  const db=JSON.parse(h.fs.readFileSync(h.path.join(dir,'mos.json'),'utf8'));assert.equal(db.content_versions.find(v=>v.id===versionId).state,'DRAFT');assert.equal(db.content_versions.find(v=>v.id===versionId).body,'Original saved body');await screenshot('save-failed-'+scenario);
 });
 await check('T08 real Chrome switching tabs retains failed draft',async()=>{await click('[data-ts="IMAGE"]');await wait("!!document.querySelector('#tiUp')");await click('[data-ts="TEXT"]');await wait("!!document.querySelector('#ceText') && document.querySelector('#ceText').getClientRects().length>0");assert.equal(await evaluate("document.querySelector('#ceText').value"),'Retained employee draft offline');});
 await check('T08 real Chrome retry commits latest draft',async()=>{mode='';await click('#ceSave');await wait("document.querySelector('#ceSaveState')?.textContent.includes('已保存') || !document.querySelector('#ceDirty')?.textContent.trim()");const db=JSON.parse(h.fs.readFileSync(h.path.join(dir,'mos.json'),'utf8'));assert.equal(db.content_versions.find(v=>v.id===versionId).body,'Retained employee draft offline');assert.equal(lockRequests,0);await screenshot('draft-recovered');});
})().catch(e=>{results.push({name:'browser harness',ok:false,error:e.message});console.log('FAIL browser harness '+e.message);}).finally(async()=>{
 if(cdp)cdp.close();for(const child of [server,chrome])if(child&&!child.killed)child.kill();await sleep(700);
 const summary={suite:'h07-browser',at:new Date().toISOString(),total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results};h.fs.writeFileSync(h.path.join(out,'results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify({total:summary.total,passed:summary.passed,failed:summary.failed}));
 for(const p of [dir,profile]){const resolved=h.path.resolve(p);if(!resolved.startsWith(h.path.resolve(os.tmpdir())+h.path.sep)||!h.path.basename(resolved).startsWith('mos-phase1-'))throw Error('Unsafe cleanup');try{h.fs.rmSync(resolved,{recursive:true,force:true});}catch(_){}}
 process.exitCode=summary.failed?1:0;
});
