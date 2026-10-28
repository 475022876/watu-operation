'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {startCluster}=require('./cluster.cjs'),{cleanupIsolated}=require('./cleanup-isolated.cjs');
(async()=>{const rows=[];let cluster;try{
 assert.throws(()=>cleanupIsolated(path.resolve('.')),/UNSAFE_CLUSTER_PATH/);rows.push({name:'cleanup refuses repository and other non-temp paths',status:'EXECUTED_PASS'});
 cluster=await startCluster();const result=cleanupIsolated(cluster.root);assert.equal(result.removed,true);assert.equal(fs.existsSync(cluster.root),false);rows.push({name:'cleanup stops and removes only marked owned test cluster',status:'EXECUTED_PASS'});
}catch(e){rows.push({name:'cleanup harness',status:'EXECUTED_FAIL',error:e.message});process.exitCode=1;}
finally{if(cluster&&fs.existsSync(cluster.root))await cluster.stop();fs.writeFileSync('TEST_EVIDENCE_PHASE3A2/cleanup-tests.json',JSON.stringify({at:new Date().toISOString(),rows},null,2));console.log(JSON.stringify(rows));}})();
