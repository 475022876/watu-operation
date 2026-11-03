'use strict';
const {setup}=require('./fixture.cjs');
(async()=>{const h=await setup(9106);try{
 const adminTask=await h.actors.admin.call('POST','/api/mos/tasks?brand=VFIB',{title:'【合成试用】管理员界面走查任务',requirements:'用于走查完整入口，不是真实宣传任务。',riskGrade:'G2',productionDue:new Date(Date.now()+86400000).toISOString()});if(adminTask.status!==200)throw Error('Administrator sample task failed');
 for(const revision of [false,true]){
  const task=await h.createTask('VFIB',revision?'【合成试用】按反馈修改服务问答':'【合成试用】等待审核的服务问答');
  const draft=await h.actors.maker.call('POST','/api/mos/content-versions?brand=VFIB',{taskId:task.id,title:task.title,body:'【合成试用正文】用于验证审核、意见和修订，不是真实业务事实。'});if(draft.status!==200)throw Error('Review sample draft failed');
  const lock=await h.actors.maker.call('POST','/api/mos/content-versions/'+draft.data.version.id+'/lock',{rowVersion:draft.data.version.rowVersion});if(lock.status!==200)throw Error('Review sample submission failed');
  if(revision){const review=lock.data.createdCases.find(x=>x.type==='PROFESSIONAL_REVIEW'),r=await h.actors.professional.call('POST','/api/mos/review-cases/'+review.id+'/decision',{action:'REQUEST_REVISION',remarks:'【合成反馈】请区分服务说明与营销表达，补充适用条件后重新提交。',rowVersion:1});if(r.status!==200)throw Error('Revision sample failed');}
 }
 const future=await h.createTask('VFIB','【合成试用】未来紧急活动邀请'),r=await h.actors.maker.call('PUT','/api/mos/tasks/'+future.id,{priority:'URGENT',startAt:new Date(Date.now()+86400000).toISOString().slice(0,10),productionDue:new Date(Date.now()+172800000).toISOString(),rowVersion:future.rowVersion});if(r.status!==200)throw Error('Future task sample failed');
 console.log('Unified workspace: http://unified.localhost:9106/employee-pilot/pilot.html');console.log('Synthetic tasks, reviews, campaigns, calendar, topics and manual channel records. No production data or real social accounts.');
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await h.stop();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);
 }catch(e){await h.stop();throw e;}})().catch(e=>{console.error(e.message);process.exitCode=1;});
