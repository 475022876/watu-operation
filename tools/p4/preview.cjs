'use strict';
const {start}=require('../p3/harness.cjs');
(async()=>{const h=await start({port:9104});await h.createTask('VFIB','会员服务介绍 · 稳定性试点');await h.createTask('UCARD','会员活动邀请 · 稳定性试点');console.log('P4 isolated preview: http://p4.localhost:9104/employee-pilot/pilot.html');console.log('Synthetic accounts only; production data and paid AI are not connected.');let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await h.stop();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);})().catch(e=>{console.error(e.message);process.exitCode=1;});
