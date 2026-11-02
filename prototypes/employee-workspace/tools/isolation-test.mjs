import {spawn} from 'node:child_process';import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),out=path.resolve(project,'../../docs/p2-employee-experience/evidence/isolation-tests.json'),port=9097,rows=[];
const child=spawn(process.execPath,['tools/serve.mjs'],{cwd:project,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,P2_PORT:String(port)},stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function request(url='/',method='GET',headers={}){return new Promise((resolve,reject)=>{const r=http.request({hostname:'127.0.0.1',port,path:url,method,headers:{Host:`p2.localhost:${port}`,...headers}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});r.on('error',reject);r.end();});}
async function check(name,fn){try{await fn();rows.push({name,status:'PASS'});}catch(e){rows.push({name,status:'FAIL',error:e.message});}}
try{
 for(let i=0;i<70;i++){try{if((await request()).status===200)break;}catch(_){}await sleep(100);}
 await check('static preview responds without issuing a session',async()=>{const r=await request('/','GET',{Cookie:'mos_sid=synthetic-not-real'});assert.equal(r.status,200);assert.equal(r.headers['set-cookie'],undefined);assert(!r.body.includes('synthetic-not-real'));});
 await check('CSP forbids connections workers frames and form submission',async()=>{const r=await request();for(const rule of ["connect-src 'none'","worker-src 'none'","frame-ancestors 'none'","form-action 'none'"])assert(r.headers['content-security-policy'].includes(rule));});
 await check('business API paths are refused',async()=>assert.equal((await request('/api/mos/tasks')).status,403));
 await check('POST and other writes are refused',async()=>assert.equal((await request('/','POST')).status,405));
 await check('parent traversal is refused',async()=>assert.equal((await request('/%2e%2e/package.json')).status,403));
 await check('source config environment and package files are not served',async()=>{for(const p of ['/src/main.tsx','/.env','/package.json','/tools/serve.mjs'])assert.equal((await request(p)).status,404);});
 await check('foreign Host is refused',async()=>assert.equal((await request('/','GET',{Host:'example.invalid'})).status,403));
 await check('HEAD is read-only and body-free',async()=>{const r=await request('/','HEAD');assert.equal(r.status,200);assert.equal(r.body,'');});
 await check('no-cache and MIME protections are present',async()=>{const r=await request();assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['x-content-type-options'],'nosniff');});
 await check('bundled runtime license notices are available',async()=>{const r=await request('/THIRD_PARTY_NOTICES.txt');assert.equal(r.status,200);assert.match(r.body,/react-dom/);assert.match(r.body,/Permission is hereby granted/);});
}finally{child.kill();await sleep(200);const report={at:new Date().toISOString(),scope:'Independent P2 static server only, synthetic cookie marker; no business or external service requests',passed:rows.filter(r=>r.status==='PASS').length,failed:rows.filter(r=>r.status==='FAIL').length,rows};fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exitCode=report.failed?1:0;}
