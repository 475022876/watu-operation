'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'TEST_EVIDENCE_PHASE2/phase1-regression');fs.mkdirSync(out,{recursive:true});
(async()=>{const rows=[];for(const name of ['idempotency-test','brand-permission-test','transaction-test','http-durability-test','draft-protection-test','storage-recovery-test','browser-draft-test']){
 const result=await new Promise(resolve=>{const p=cp.spawn(process.execPath,['tools/phase1/'+name+'.js'],{cwd:root,env:{...process.env,NODE_OPTIONS:'--require '+JSON.stringify(path.join(__dirname,'../phase1/offline-test-guard.cjs'))},stdio:['ignore','pipe','pipe']});let log='';p.stdout.on('data',x=>log+=x);p.stderr.on('data',x=>log+=x);p.on('close',code=>resolve({code,log}));});
 fs.writeFileSync(path.join(out,name+'.log'),result.log);rows.push({suite:name,exitCode:result.code});console.log(name+' '+(result.code===0?'PASS':'FAIL'));}
 for(const name of ['h01','h02','h03','h07-component','t04-isolated','http-durability']){const f=path.join(root,'TEST_EVIDENCE_PHASE1',name+'.json');if(fs.existsSync(f))fs.copyFileSync(f,path.join(out,name+'.json'));}
 const browser=path.join(root,'TEST_EVIDENCE_PHASE1/browser');fs.cpSync(browser,path.join(out,'browser'),{recursive:true});
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({rows},null,2));process.exitCode=rows.some(x=>x.exitCode!==0)?1:0;
})();
