'use strict';
// Real headless Chrome + isolated HTTP server. No real credentials, models or external services.
const h=require('../phase1/helpers'),assert=require('node:assert/strict'),os=require('node:os'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const root=h.path.resolve(__dirname,'../..');const dir=h.dir,port=9583,cdpPort=9633,base='http://127.0.0.1:'+port;
const profile=h.fs.mkdtempSync(h.path.join(os.tmpdir(),'mos-phase1-browser-'));
const out=h.path.join(root,'TEST_EVIDENCE_PHASE2/browser-m05');h.fs.mkdirSync(out,{recursive:true});
const results=[];let server,chrome,cdp;let mode='',lockRequests=0;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS '+name);}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL '+name+' '+e.message);}}
class Cdp{constructor(url){this.ws=new WebSocket(url);this.n=0;this.pending=new Map();this.handlers=[];this.ready=new Promise((r,j)=>{this.ws.addEventListener('open',r);this.ws.addEventListener('error',j);});this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=this.pending.get(m.id);if(p){clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}}else this.handlers.forEach(f=>f(m));});}send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.n;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout '+method));},15000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}close(){this.ws.close();}}
async function evaluate(expression){const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;}
async function wait(expression){for(let i=0;i<70;i++){try{if(await evaluate(expression))return;}catch(_){}await sleep(100);}throw Error('Browser condition timed out');}
async function click(selector){await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);}
async function screenshot(name){await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const r=await cdp.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});h.fs.writeFileSync(h.path.join(out,name+'.png'),Buffer.from(r.data,'base64'));}
const paused=[];
async function waitPaused(count){for(let i=0;i<80;i++){if(paused.length>=count)return;await sleep(100);}throw Error('No intercepted intelligence request');}
async function respond(req,title,status=200){await cdp.send('Fetch.fulfillRequest',{requestId:req.requestId,responseCode:status,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify(status===200?{ok:true,total:1,items:[{id:title,title,summary:'Synthetic fixture',aiSummary:'Local fixture',canonicalUrl:'https://fixture.invalid',sourceName:'Isolated fixture',tier:'S1',licenseState:'OPEN'}]}:{ok:false,error:'Synthetic delayed failure'})).toString('base64')});}
(async()=>{
 h.fixture();h.db.user_roles.push({userId:'creator',roleCode:'P2',brandScope:['UCARD']});const user=h.db.users.find(x=>x.id==='creator');const password='Test-'+crypto.randomBytes(18).toString('hex');const pw=require('../../lib/password').hashPassword(password);user.salt=pw.salt;user.passwordHash=pw.hash;h.store.saveNow();h.store.reset();
 server=spawn(process.execPath,['server.js'],{cwd:root,env:{...process.env,MOS_PORT:String(port),MOS_HOST:'127.0.0.1',MOS_DATA_DIR:dir,MOS_SCHEDULER_ENABLED:'0'},stdio:'ignore'});
 for(let i=0;i<70;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch(_){}await sleep(100);}
 const executable=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>h.fs.existsSync(p));if(!executable)throw Error('Chrome unavailable');
 chrome=spawn(executable,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--no-proxy-server','--window-size=1680,1050','--remote-debugging-port='+cdpPort,'--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 let tabs;for(let i=0;i<70;i++){try{tabs=await(await fetch('http://127.0.0.1:'+cdpPort+'/json')).json();if(tabs.some(t=>t.type==='page'))break;}catch(_){}await sleep(100);}
 cdp=new Cdp(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await cdp.ready;await cdp.send('Page.enable');await cdp.send('Network.enable');
 cdp.handlers.push(m=>{if(m.method==='Fetch.requestPaused'){if(m.params.request.url.includes('/api/mos/source-items'))paused.push(m.params);else cdp.send('Fetch.continueRequest',{requestId:m.params.requestId}).catch(()=>{});}});
 await cdp.send('Page.navigate',{url:base+'/mos'});await wait("!!document.querySelector('#appRoot')");
 assert.equal(await evaluate(`(async()=>{await fetch('/api/mos/auth/me');const token=()=>decodeURIComponent(document.cookie.split('; ').find(x=>x.startsWith('mos_csrf=')).split('=').slice(1).join('='));return(await fetch('/api/mos/auth/login',{method:'POST',headers:{'Content-Type':'application/json','x-mos-csrf':token()},body:JSON.stringify({username:'creator',password:${JSON.stringify(password)}})})).status;})()`),200);
 await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*/api/mos/source-items*',requestStage:'Request'}]});
 await cdp.send('Page.navigate',{url:base+'/mos?phase2='+Date.now()+'#/intelligence'});await waitPaused(1);await wait("!!document.querySelector('[data-brand=UCARD]')");
 await check('T09 real Chrome delayed VFIB response cannot overwrite UCARD',async()=>{
 const old=paused.shift();assert.equal(new URL(old.request.url).searchParams.get('brand'),'VFIB');await click('[data-brand=UCARD]');await waitPaused(1);const fresh=paused.shift();assert.equal(new URL(fresh.request.url).searchParams.get('brand'),'UCARD');await respond(fresh,'UCARD_CURRENT');await wait("document.querySelector('#content').textContent.includes('UCARD_CURRENT')");await respond(old,'VFIB_STALE');await sleep(300);assert.equal(await evaluate("document.querySelector('#content').textContent.includes('VFIB_STALE')"),false);await screenshot('ucard-after-stale-vfib');
 });
 await check('T09 real Chrome rapid roundtrip and stale failure keep latest brand',async()=>{
 await click('[data-brand=VFIB]');await waitPaused(1);const old=paused.shift();await click('[data-brand=UCARD]');await waitPaused(1);const fresh=paused.shift();await respond(fresh,'UCARD_RETRY_CURRENT');await wait("document.querySelector('#content').textContent.includes('UCARD_RETRY_CURRENT')");await respond(old,'OLD_FAILURE',500);await sleep(300);assert.equal(await evaluate("document.querySelector('#content').textContent.includes('UCARD_RETRY_CURRENT')"),true);await screenshot('ucard-after-stale-failure');
 });
})().catch(e=>{results.push({name:'browser harness',ok:false,error:e.message});console.log('FAIL browser harness '+e.message);}).finally(async()=>{
 if(cdp)cdp.close();for(const child of [server,chrome])if(child&&!child.killed)child.kill();await sleep(700);
 const summary={suite:'m05-browser',at:new Date().toISOString(),total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results};h.fs.writeFileSync(h.path.join(out,'results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
 for(const p of [dir,profile]){const resolved=h.path.resolve(p);if(!resolved.startsWith(h.path.resolve(os.tmpdir())+h.path.sep)||!h.path.basename(resolved).startsWith('mos-phase1-'))throw Error('Unsafe cleanup');try{h.fs.rmSync(resolved,{recursive:true,force:true});}catch(_){}}
 process.exitCode=summary.failed?1:0;
});
