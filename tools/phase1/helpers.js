'use strict';
// Phase 1 tests use synthetic identities and a new OS temporary data directory only.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mos-phase1-'));
process.env.MOS_DATA_DIR=dir;process.env.MOS_DEMO_SEED='0';process.env.MOS_ADMIN_PASSWORD=crypto.randomBytes(24).toString('hex');
process.env.MOS_IDENTITY='mock';process.env.MOS_LIBRARY='mock';process.env.MOS_KNOWLEDGE='mock';
for(const k of ['TEXT','IMAGE','VIDEO','SEARCH'])process.env['MOS_'+k+'_PROVIDER']='none';
const store=require('../../lib/mos/store');const log=console.log;let db;
try{console.log=()=>{};db=store.getDb();}finally{console.log=log;}
const router=require('../../lib/mos/router'),rbac=require('../../lib/mos/rbac');
require('../../lib/mos/routes/editorial');
function fixture(){
 for(const k of Object.keys(db))if(Array.isArray(db[k]))db[k]=[];
 db.seq={};db.settings={};
 for(const [id,role,brand]of [['editor','P1','VFIB'],['other','P1','VFIB'],['creator','P2','VFIB'],['foreign','P1','UCARD'],['foreignCreator','P2','UCARD']]){
  db.users.push({id,username:id,displayName:id,status:'active',mustChangePassword:false});
  db.user_roles.push({userId:id,roleCode:role,brandScope:[brand]});
 }
 store.saveNow();
}
let seq=0;
function proposal(brand='VFIB'){const p={id:'proposal-'+(++seq),brandCode:brand,status:'PENDING_EDITORIAL_REVIEW',suggestedTitleEN:'Synthetic fixture',summaryZH:'Synthetic',primaryCategory:'S01',riskGrade:'G0',sourceFindingIds:[],rowVersion:1};db.topic_proposals.push(p);return p;}
function payload(key='key-'+(++seq),owner='creator'){return{idempotencyKey:key,workDate:'2026-11-05',deliverables:[{platform:'LINKEDIN',ownerId:owner,productionDue:'2026-11-10'}]};}
function call(id,body,actor='editor',action='approve-and-schedule'){
 const r=router.routes.find(x=>x.pattern==='/api/mos/topic-proposals/:id/'+action);
 const user=db.users.find(x=>x.id===actor);return r.handler({params:{id},body,user,principal:rbac.principalOf(db,user),ip:'127.0.0.1'});
}
const results=[];
async function check(name,fn){try{await fn();results.push({name,ok:true});console.log('PASS '+name);}catch(e){results.push({name,ok:false,error:e.message});console.log('FAIL '+name+' '+e.message);}}
function finish(suite){store.reset();const target=path.join(__dirname,'../../TEST_EVIDENCE_PHASE1');fs.mkdirSync(target,{recursive:true});const out={suite,at:new Date().toISOString(),total:results.length,passed:results.filter(x=>x.ok).length,failed:results.filter(x=>!x.ok).length,results};fs.writeFileSync(path.join(target,suite+'.json'),JSON.stringify(out,null,2));console.log(JSON.stringify({suite,total:out.total,passed:out.passed,failed:out.failed}));fs.rmSync(dir,{recursive:true,force:true});process.exitCode=out.failed?1:0;}
module.exports={fs,path,dir,db,store,router,rbac,fixture,proposal,payload,call,check,finish};
