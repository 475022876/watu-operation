'use strict';
// Disposable source-only runtime. Never starts against the repository business data.
const {start}=require('./harness.cjs');
(async()=>{const h=await start({port:9095});await h.createTask('VFIB','会员服务介绍短文 · API 试点');await h.createTask('UCARD','会员活动邀请文案 · API 试点');console.log('P3 isolated API preview: http://p3.localhost:9095/employee-pilot/pilot.html');console.log('Synthetic accounts only. No production configuration, Workspace, social account, or paid AI connection.');let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await h.stop();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);h.proc.on('exit',()=>{if(!stopping)process.exitCode=1;});})().catch(e=>{console.error(e.message);process.exitCode=1;});
