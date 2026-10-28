'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawnSync}=require('node:child_process');
function cleanupIsolated(input){
 if(typeof input!=='string')throw Error('EXPLICIT_TEST_CLUSTER_PATH_REQUIRED');
 const target=path.resolve(input),base=path.resolve(os.tmpdir())+path.sep;
 if(!target.startsWith(base)||!path.basename(target).startsWith('mos-pg-phase3a2-'))throw Error('UNSAFE_CLUSTER_PATH');
 if(fs.lstatSync(target).isSymbolicLink())throw Error('UNSAFE_CLUSTER_LINK');
 const resolved=fs.realpathSync(target);if(resolved!==target||!resolved.startsWith(base))throw Error('UNSAFE_CLUSTER_PATH');
 const marker=JSON.parse(fs.readFileSync(path.join(resolved,'phase3a2.marker.json'),'utf8'));
 const bin=path.resolve(process.env.MOS_PG18_BIN||'C:/Users/three/.cache/vfib-phase3a2/pgsql/bin');
 if(marker.format!=='vfib-pg-phase3a2-owned-v1'||marker.root!==resolved||marker.bin!==bin)throw Error('OWNED_TEST_CLUSTER_MARKER_REQUIRED');
 function verify(directory){for(const e of fs.readdirSync(directory,{withFileTypes:true})){const p=path.join(directory,e.name),s=fs.lstatSync(p);if(s.isSymbolicLink())throw Error('UNSAFE_CLUSTER_LINK');if(s.isDirectory())verify(p);}}
 verify(resolved);
 const exe=path.join(bin,'pg_ctl'+(process.platform==='win32'?'.exe':'')),data=path.join(resolved,'cluster');
 const status=spawnSync(exe,['-D',data,'status'],{stdio:'ignore',windowsHide:true});
 if(status.status===0){const stop=spawnSync(exe,['-D',data,'-w','-t','30','-m','fast','stop'],{stdio:'ignore',windowsHide:true});if(stop.status!==0)throw Error('OWNED_CLUSTER_STOP_FAILED');}
 else if(status.status!==3)throw Error('OWNED_CLUSTER_STATE_UNKNOWN');
 fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});return {stopped:true,removed:true};
}
if(require.main===module){try{console.log(JSON.stringify(cleanupIsolated(process.argv[2])));}catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={cleanupIsolated};
