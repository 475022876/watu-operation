'use strict';
const {setup}=require('./fixture.cjs');
(async()=>{const h=await setup(9106);console.log('Unified workspace: http://unified.localhost:9106/employee-pilot/pilot.html');console.log('Synthetic fixtures and local Mock text only. No production data or real social accounts.');let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await h.stop();process.exit(0);};process.on('SIGINT',stop);process.on('SIGTERM',stop);})().catch(e=>{console.error(e.message);process.exitCode=1;});
