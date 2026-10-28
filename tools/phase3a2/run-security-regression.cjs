'use strict';
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'TEST_EVIDENCE_PHASE3A2/security-regression');fs.mkdirSync(out,{recursive:true});
const scripts=['phase1/idempotency-test.js','phase1/brand-permission-test.js','phase1/transaction-test.js','phase1/http-durability-test.js','phase1/draft-protection-test.js','phase1/storage-recovery-test.js','phase1/browser-draft-test.js','phase2/egress-test.js','phase2/workspace-policy-test.js','phase2/adapter-policy-test.js','phase2/storage-test.js','phase2/intelligence-test.js','phase2/browser-intelligence-test.js','phase3a2/h05-version-reference-test.cjs'];
(async()=>{const rows=[];for(const script of scripts){
 const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('MOS_')&&!k.startsWith('PG')&&k!=='DATABASE_URL'&&!/(?:API_KEY|PRIVATE_KEY|ACCESS_TOKEN)$/.test(k)));
 env.MOS_PROVIDER_LIVE='0';env.NODE_OPTIONS='--require '+JSON.stringify(path.join(__dirname,'../phase1/offline-test-guard.cjs'));
 const r=await new Promise(resolve=>{const p=spawn(process.execPath,['tools/'+script],{cwd:root,env,stdio:['ignore','pipe','pipe']});let log='';p.stdout.on('data',x=>log+=x);p.stderr.on('data',x=>log+=x);p.on('close',code=>resolve({code,log}));});
 const name=script.replaceAll('/','-'),safe=r.log.replace(/(初始密码[^：\n]*：)[^\r\n]*/g,'$1[redacted]').replace(/(Bearer\s+)[A-Za-z0-9._-]{15,}/g,'$1[redacted]');
 fs.writeFileSync(path.join(out,name+'.log'),safe);const summaries=safe.split(/\r?\n/).map(x=>{try{return JSON.parse(x);}catch(_){return null;}}).filter(x=>x&&Number.isInteger(x.passed));const passed=summaries.length?summaries.at(-1).passed:(safe.match(/^PASS\b/gm)||[]).length;
 rows.push({script,exitCode:r.code,passed,log:'TEST_EVIDENCE_PHASE3A2/security-regression/'+name+'.log'});console.log(script+' '+(r.code===0?'PASS':'FAIL')+' '+passed);
 }
 for(const phase of ['PHASE1','PHASE2']){const src=path.join(root,'TEST_EVIDENCE_'+phase),dst=path.join(out,phase);fs.mkdirSync(dst,{recursive:true});const names=phase==='PHASE1'?['h01.json','h02.json','h03.json','http-durability.json','h07-component.json','t04-isolated.json']:['h04.json','h05.json','h05-adapter.json','h06.json','m05.json'];for(const n of fs.readdirSync(dst)){const f=path.join(dst,n);if(fs.statSync(f).isFile()&&!names.includes(n))fs.unlinkSync(f);}for(const n of names)fs.copyFileSync(path.join(src,n),path.join(dst,n));for(const n of (phase==='PHASE1'?['browser']:['browser-m05'])){const f=path.join(src,n);if(fs.existsSync(f))fs.cpSync(f,path.join(dst,n),{recursive:true});}}
 const result={at:new Date().toISOString(),mode:'executed anew on Phase3A2 branch; no paid services',passed:rows.reduce((n,x)=>n+x.passed,0),rows};fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(result,null,2));process.exitCode=rows.some(r=>r.exitCode!==0)?1:0;
})();
