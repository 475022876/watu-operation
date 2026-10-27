'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const h=require('../phase1/helpers');h.fixture();
const current=require('../../lib/mos/egress');let egress=current,policy=require('../../lib/mos/workspace-ai-policy');
const before=process.env.PHASE2_BEFORE==='1';
if(before){const Module=require('node:module'),cp=require('node:child_process'),file=path.resolve(__dirname,'../../lib/mos/egress.js');const m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(cp.execFileSync('git',['show','319c5b3:lib/mos/egress.js'],{encoding:'utf8'}),file);egress=m.exports;policy={evaluateMetadata(data){egress.assertDataPolicy(egress.classify('neutral',data && data.classification),{});},async assertExternalUse(){return {checked:0};}};}
const ec=require('../../lib/mos/eventconsumer'),oldVerify=ec.verifyAssetUsable;let fresh={ok:true,usable:true,data:{isReusable:true,classification:'open',brandId:'VFIB',aiReusePolicy:'allowed',externalAiTransferPolicy:'allowed'}},calls=0;
ec.verifyAssetUsable=async()=>{calls++;return fresh;};
h.db.library_asset_refs.push({id:'ref1',libraryId:'asset1',brandCode:'VFIB'});h.db.content_tasks.push({id:'t1',brandCode:'VFIB',libraryRefIds:['ref1']});
const input={taskId:'t1',brandCode:'VFIB',actorId:'creator'};const results=[];async function test(name,fn){try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:String(e.message).split('\n')[0].slice(0,160)});}}
(async()=>{
 for(const name of ['executive','Executive Confidential','EXECUTIVE_CONFIDENTIAL','unknown-security-level'])await test('classification fail closed '+name,()=>assert.throws(()=>egress.assertDataPolicy(egress.classify('neutral',name),{allowRestricted:true,acknowledgedBy:'admin'})));
 await test('open classification explicitly maps PUBLIC',()=>assert.equal(egress.classify('neutral','open').dataClass,'PUBLIC'));
 for(const cls of ['open','internal'])await test('fresh authorized '+cls+' metadata allowed',()=>policy.evaluateMetadata({...fresh.data,classification:cls},'VFIB'));
 for(const data of [null,{isReusable:true},{...fresh.data,permissionValid:false}, {...fresh.data,classification:'restricted'}, {...fresh.data,classification:'executive'}, {...fresh.data,externalAiTransferPolicy:undefined},{...fresh.data,aiReusePolicy:'blocked'},{...fresh.data,brandId:'UCARD'},{...fresh.data,classification:{key:'new-level'}}])await test('untrusted or non-exportable metadata denied '+results.length,()=>assert.throws(()=>policy.evaluateMetadata(data,'VFIB')));
 await test('fresh Provider checked on every call',async()=>{const beforeCalls=calls;await policy.assertExternalUse(input);await policy.assertExternalUse(input);assert.equal(calls-beforeCalls,2);});
 await test('revoked Provider permission denies even client PUBLIC override',async()=>{fresh={ok:false,usable:false};await assert.rejects(policy.assertExternalUse({...input,dataClass:'PUBLIC'}));});
 fresh={ok:true,usable:true,data:{isReusable:true,classification:'open',brandId:'VFIB',aiReusePolicy:'allowed',externalAiTransferPolicy:'allowed'}};
 await test('cross-brand task rejected before Provider request',async()=>{const c=calls;await assert.rejects(policy.assertExternalUse({...input,brandCode:'UCARD'}));assert.equal(calls,c);});
 await test('actor brand permission revoked cannot use reference',async()=>{const roles=h.db.user_roles;h.db.user_roles=[];try{await assert.rejects(policy.assertExternalUse(input));}finally{h.db.user_roles=roles;}});
 await test('unknown local reference denied',async()=>assert.rejects(policy.assertExternalUse({...input,libraryRefIds:['missing']})));
 await test('missing trusted metadata from current authority rejected',async()=>{fresh={ok:true,usable:true,data:{isReusable:true}};await assert.rejects(policy.assertExternalUse(input));});
 ec.verifyAssetUsable=oldVerify;h.store.reset();fs.rmSync(h.dir,{recursive:true,force:true});const out={suite:'h05',mode:before?'before':'after',total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results};fs.writeFileSync('TEST_EVIDENCE_PHASE2/h05'+(before?'-before':'')+'.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));process.exitCode=out.failed?1:0;
})().catch(e=>{console.error(e.message);process.exitCode=1});
