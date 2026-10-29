'use strict';
// Current-run evidence only. Child fixtures own their disposable databases.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),out=path.join(root,'TEST_EVIDENCE_TASK_TEXT/regression');
fs.mkdirSync(out,{recursive:true});
const suites=[
 ['task-text-browser-test.cjs','TEST_EVIDENCE_TASK_TEXT/browser/results.json'],
 ['navigation-browser-test.cjs','TEST_EVIDENCE_TASK_TEXT/navigation/results.json'],
 ['navigation-workflow-test.cjs','TEST_EVIDENCE_NAVIGATION/workflow.json'],
 ['mos-unit-test.js','TEST_EVIDENCE_MOS_BUILD01/unit-result.json'],
 ['mos-e2e-test.js','TEST_EVIDENCE_MOS_BUILD01/e2e-result.json'],
 ['mos-i18n-check.js','TEST_EVIDENCE_MOS_V013_I18N/i18n-check-result.json'],
 ['mos-workspace-contract-test.js','TEST_EVIDENCE_MOS_BUILD01/workspace-contract-result.json'],
 ['phase1/idempotency-test.js','TEST_EVIDENCE_PHASE1/h01.json'],
 ['phase1/brand-permission-test.js','TEST_EVIDENCE_PHASE1/h02.json'],
 ['phase1/transaction-test.js','TEST_EVIDENCE_PHASE1/h03.json'],
 ['phase1/browser-draft-test.js','TEST_EVIDENCE_PHASE1/browser/results.json']
];
(async()=>{const rows=[];for(const [script,evidence]of suites){
 const started=Date.now(),name=script.replace(/[\/]/g,'-');
 const result=await new Promise(resolve=>{const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('MOS_')&&!k.startsWith('PG')&&k!=='DATABASE_URL'&&!/(?:API_KEY|PRIVATE_KEY|ACCESS_TOKEN)$/.test(k)));const child=spawn(process.execPath,[path.join('tools',script)],{cwd:root,env:{...env,NODE_OPTIONS:'--require '+JSON.stringify(path.join(__dirname,'phase1/offline-test-guard.cjs'))},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);child.stderr.on('data',b=>log+=b);child.on('error',e=>resolve({exitCode:-1,log:e.message}));child.on('close',exitCode=>resolve({exitCode,log}));});
 fs.writeFileSync(path.join(out,name+'.log'),result.log.replace(/(初始密码[^：\n]*：)[^\r\n]*/g,'$1[redacted]'));
 const filename=path.join(root,evidence);let report;
 if(fs.existsSync(filename)&&fs.statSync(filename).mtimeMs>=started-2000){report=JSON.parse(fs.readFileSync(filename,'utf8'));fs.copyFileSync(filename,path.join(out,name+'.json'));}
 const row={script,exitCode:result.exitCode,passed:report?.passed,failed:report?.failed,durationMs:Date.now()-started,evidenceFresh:!!report};rows.push(row);console.log(JSON.stringify(row));
 fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify({at:new Date().toISOString(),scope:'isolated local services, real Chrome, local MOCK text provider, no paid/live external services',passed:rows.reduce((n,r)=>n+(r.passed||0),0),failed:rows.reduce((n,r)=>n+(r.failed||0)+(r.exitCode!==0||!r.evidenceFresh?1:0),0),rows},null,2));
 }process.exitCode=rows.some(r=>r.exitCode!==0||r.failed||!r.evidenceFresh)?1:0;
})().catch(e=>{console.error(e.message);process.exitCode=1;});
