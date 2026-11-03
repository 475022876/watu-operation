'use strict';
const {start,client}=require('../p3/harness.cjs');
async function setup(port=9106){
 const h=await start({port});
 const user=await h.admin.call('POST','/api/mos/admin/users',{username:'pilot_admin',displayName:'试用管理员',password:h.password,mustChangePassword:false,roles:[{roleCode:'MOS_ADMIN',brandScope:['*']}]});if(user.status!==200)throw Error('Synthetic administrator creation failed');
 const admin=client(h.base);await admin.call('GET','/api/mos/auth/me');await admin.call('POST','/api/mos/auth/login',{username:'pilot_admin',password:h.password});h.actors.admin={...admin,user:user.data.user};
 const fixtures={tasks:[],campaigns:[],topics:[],channels:[]};
 for(const brand of ['VFIB','UCARD']){
  const campaign=await h.actors.maker.call('POST','/api/mos/campaigns?brand='+brand,{title:'【合成试用】'+brand+'会员服务宣传',brief:'隔离试用活动，不是真实金融宣传或对外发布。'});if(campaign.status!==200)throw Error('Campaign fixture failed');fixtures.campaigns.push(campaign.data.campaign);await h.actors.maker.call('PUT','/api/mos/campaigns/'+campaign.data.campaign.id,{state:'ACTIVE',rowVersion:campaign.data.campaign.rowVersion});
  const topic=await h.actors.maker.call('POST','/api/mos/topics?brand='+brand,{title:'【合成试用】'+brand+'服务问答选题',pillarCode:'C01',narrativeCode:'N01',riskGrade:'G2',summary:'合成资料，仅用于验证选题与内容任务关联。'});if(topic.status!==200)throw Error('Topic fixture failed');fixtures.topics.push(topic.data.topic);
  const task=await h.createTask(brand,'【合成试用】'+brand+'会员服务介绍');fixtures.tasks.push(task);
  const saved=await h.actors.maker.call('POST','/api/mos/content-versions?brand='+brand,{taskId:task.id,title:task.title,body:'【合成试用正文】请核对服务说明。此内容不是正式产品事实，不可对外发布。'});if(saved.status!==200)throw Error('Draft fixture failed');
  await h.actors.maker.call('PUT','/api/mos/tasks/'+task.id,{campaignId:campaign.data.campaign.id,topicId:topic.data.topic.id,rowVersion:(await h.actors.maker.call('GET','/api/mos/tasks/'+task.id)).data.task.rowVersion});
  const plan=await admin.call('POST','/api/mos/plans?brand='+brand,{year:2026,month:11,title:'【合成试用】11月内容计划',objectives:['走通制作与审核闭环']});if(plan.status!==200)throw Error('Plan fixture failed');
  await admin.call('POST','/api/mos/plans/'+plan.data.plan.id+'/items',{title:task.title,contentTaskId:task.id,workDate:'2026-11-04',priority:'NORMAL'});
  for(const suffix of ['a','b']){const c=await admin.call('POST','/api/mos/channels?brand='+brand,{platform:'LINKEDIN',handle:'synthetic_'+brand.toLowerCase()+'_'+suffix,label:'【合成试用】账号 '+suffix,url:'https://example.invalid/'+brand+'/'+suffix});if(c.status!==200)throw Error('Channel fixture failed');fixtures.channels.push(c.data.channel);}
 }
 return {...h,fixtures};
}
module.exports={setup};
