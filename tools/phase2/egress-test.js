'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),https=require('node:https'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'mos-phase2-egress-'));
process.env.MOS_DATA_DIR=root;process.env.MOS_EGRESS_ALLOW_LOOPBACK='1';process.env.MOS_EGRESS_ALLOW_HTTP='1';
const pc=require('../../lib/mos/providercontract');
let request=pc.fetchWithTimeout;
if(process.env.PHASE2_BEFORE==='1'){
 const Module=require('node:module'),cp=require('node:child_process'),file=path.resolve(__dirname,'../../lib/mos/providercontract.js');
 const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));
 m._compile(cp.execFileSync('git',['show','319c5b3:lib/mos/providercontract.js'],{encoding:'utf8'}),file);request=m.exports.fetchWithTimeout;
}
const results=[];async function test(name,fn){try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:String(e.message).split('\n')[0].slice(0,180)});}}
(async()=>{
 let redirected=0;const server=http.createServer((req,res)=>{
 if(req.url==='/redirect'){res.writeHead(302,{Location:'/target'});res.end();}
 else if(req.url==='/target'){redirected++;res.end('target');}
 else if(req.url==='/large'){res.end('x'.repeat(2048));}
 else if(req.url==='/slow'){res.writeHead(200);res.write('x');setTimeout(()=>res.end('y'),150);}
 else {res.setHeader('x-ratelimit-remaining','12');res.end('{"ok":true}');}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 await test('redirects forbidden and target receives zero requests',async()=>{await assert.rejects(request(base+'/redirect',{},1000));assert.equal(redirected,0);});
 await test('response byte limit enforced while streaming',async()=>assert.rejects(request(base+'/large',{maxResponseBytes:1024},1000)));
 await test('timeout includes response body',async()=>assert.rejects((async()=>{const r=await request(base+'/slow',{},30);await r.text();})()));
 await test('request body capped before network',async()=>assert.rejects(request(base,{method:'POST',body:'x'.repeat(2*1024*1024+1)},1000)));
 await test('normal response and rate limit headers preserved',async()=>{const r=await request(base,{},1000);assert.equal(r.status,200);assert.equal((await r.json()).ok,true);assert.equal(r.headers.get('x-ratelimit-remaining'),'12');});
 await test('abort cancels body read',async()=>{const c=new AbortController();setTimeout(()=>c.abort(),20);await assert.rejects((async()=>{const r=await request(base+'/slow',{signal:c.signal},1000);await r.text();})());});
 await new Promise(r=>server.close(r));
 await test('validated address pins actual TLS socket lookup and keeps SNI',async()=>{
 const egress=require('../../lib/mos/egress'),original=egress.assertProviderUrl,originalRequest=https.request,originalFetch=global.fetch;let pinned=false;
 try{
 egress.assertProviderUrl=async()=>({url:new URL('https://fixture.example/v1'),host:'fixture.example',addresses:['93.184.216.34']});
 global.fetch=async()=>{throw new Error('UNPINNED_FETCH');};
 https.request=(options)=>{assert.equal(options.servername,'fixture.example');assert.equal(options.rejectUnauthorized,true);assert.equal(options.agent,false);options.lookup('fixture.example',{all:true},(err,list)=>{assert.ifError(err);assert.equal(list[0].address,'93.184.216.34');pinned=true;});const EventEmitter=require('node:events');const r=new EventEmitter();r.end=()=>queueMicrotask(()=>r.emit('error',new Error('synthetic')));r.destroy=()=>{};return r;};
 await assert.rejects(request('https://fixture.example/v1',{},1000));assert.equal(pinned,true);
 }finally{egress.assertProviderUrl=original;https.request=originalRequest;global.fetch=originalFetch;}
 });
 process.env.MOS_EGRESS_ALLOW_LOOPBACK='0';process.env.MOS_EGRESS_ALLOW_HTTP='0';
 const egress=require('../../lib/mos/egress');
 for(const u of ['https://127.0.0.1','https://10.0.0.1','https://169.254.169.254','https://[::1]','https://metadata.google.internal'])await test('SSRF blocked '+u,async()=>assert.rejects(egress.assertProviderUrl(u)));
 await test('mixed public/private DNS records rejected',async()=>{const dns=require('node:dns').promises,old=dns.lookup;try{dns.lookup=async()=>[{address:'93.184.216.34'},{address:'10.1.1.1'}];await assert.rejects(egress.assertProviderUrl('https://fixture.example'));}finally{dns.lookup=old;}});
 const out={suite:'h04',mode:process.env.PHASE2_BEFORE==='1'?'before':'after',total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results};
 fs.mkdirSync('TEST_EVIDENCE_PHASE2',{recursive:true});fs.writeFileSync('TEST_EVIDENCE_PHASE2/h04'+(out.mode==='before'?'-before':'')+'.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));process.exitCode=out.failed?1:0;
})().catch(e=>{console.error(e.message);process.exitCode=1});
