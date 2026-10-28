'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),Module=require('node:module');
const h=require('../phase1/helpers');h.fixture();
let policy=require('../../lib/mos/workspace-ai-policy');
if(process.env.PHASE3A2_BEFORE==='1'){const file=path.resolve(__dirname,'../../lib/mos/workspace-ai-policy.js'),m=new Module(file,module);m.filename=file;m.paths=Module._nodeModulePaths(path.dirname(file));m._compile(cp.execFileSync('git',['show','bbd3658:lib/mos/workspace-ai-policy.js'],{encoding:'utf8'}),file);policy=m.exports;}
const ec=require('../../lib/mos/eventconsumer'),old=ec.verifyAssetUsable;let calls=0,fresh;
h.db.content_tasks.push({id:'t-h05',brandCode:'VFIB'});
h.db.content_versions.push({id:'v-h05',contentTaskId:'t-h05',brandCode:'VFIB',refAssetIds:['asset-h05'],state:'DRAFT'});
h.db.working_assets.push({id:'asset-h05',brandCode:'VFIB'});
h.db.library_asset_refs.push({id:'ref-h05',workingAssetId:'asset-h05',libraryId:'ws-h05',brandCode:'VFIB'});
const input={taskId:'t-h05',brandCode:'VFIB',actorId:'creator',dataClass:'PUBLIC'};
const allowed=()=>({ok:true,usable:true,data:{isReusable:true,permissionValid:true,classification:'open',brandId:'VFIB',aiReusePolicy:'allowed',externalAiTransferPolicy:'allowed'}});
ec.verifyAssetUsable=async()=>{calls++;return fresh;};
const rows=[];async function test(name,fn){try{await fn();rows.push({name,ok:true});console.log('PASS '+name);}catch(e){rows.push({name,ok:false,error:e.message.split('\n')[0]});console.log('FAIL '+name);}}
(async()=>{
 for(const [name,value] of [['revoked',{ok:false,usable:false}],['restricted',{...allowed(),data:{...allowed().data,classification:'restricted'}}],['executive',{...allowed(),data:{...allowed().data,classification:'executive'}}],['unknown classification',{...allowed(),data:{...allowed().data,classification:'new-class'}}],['missing metadata',{ok:true,usable:true,data:{isReusable:true}}],['external transfer blocked',{...allowed(),data:{...allowed().data,externalAiTransferPolicy:'blocked'}}]]){
  await test('H05 contentTaskId-only version rejects '+name,async()=>{fresh=value;const c=calls;await assert.rejects(policy.assertExternalUse(input));assert.equal(calls,c+1);});
 }
 await test('H05 authorized open version asset reaches fresh authority',async()=>{fresh=allowed();const c=calls;assert.equal((await policy.assertExternalUse(input)).checked,1);assert.equal(calls,c+1);});
 await test('H05 authorized internal version asset allowed by policy',async()=>{fresh={...allowed(),data:{...allowed().data,classification:{key:'internal'}}};assert.equal((await policy.assertExternalUse(input)).checked,1);});
 await test('H05 cross-brand library reference denied',async()=>{fresh=allowed();const ref=h.db.library_asset_refs[0];ref.brandCode='UCARD';try{await assert.rejects(policy.assertExternalUse(input));}finally{ref.brandCode='VFIB';}});
 await test('H05 revoked local actor cannot use version asset',async()=>{const roles=h.db.user_roles;h.db.user_roles=[];try{await assert.rejects(policy.assertExternalUse(input));}finally{h.db.user_roles=roles;}});
 await test('H05 direct reference control still rejects revoked authority',async()=>{fresh={ok:false,usable:false};await assert.rejects(policy.assertExternalUse({...input,libraryRefIds:['ref-h05']}));});
 await test('H05 no library references remains ordinary manual text',async()=>{fresh=allowed();h.db.content_versions[0].refAssetIds=[];assert.equal((await policy.assertExternalUse(input)).checked,0);});
})().finally(()=>{ec.verifyAssetUsable=old;h.store.reset();fs.rmSync(h.dir,{recursive:true,force:true});const out={suite:'phase3a2-h05',at:new Date().toISOString(),mode:process.env.PHASE3A2_BEFORE==='1'?'before':'after',total:rows.length,passed:rows.filter(x=>x.ok).length,failed:rows.filter(x=>!x.ok).length,rows};fs.writeFileSync('TEST_EVIDENCE_PHASE3A2/h05-'+out.mode+'.json',JSON.stringify(out,null,2));process.exitCode=out.failed?1:0;});
