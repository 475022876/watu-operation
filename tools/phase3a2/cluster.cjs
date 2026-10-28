'use strict';
// Disposable loopback cluster. This module never reads any production config, JSON data or credentials.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net'),{execFileSync}=require('node:child_process');
const {Client}=require('pg');
async function startCluster(){
 const bin=process.env.MOS_PG18_BIN || 'C:/Users/three/.cache/vfib-phase3a2/pgsql/bin';
 const exe=n=>path.join(bin,n+(process.platform==='win32'?'.exe':''));
 if(!fs.existsSync(exe('initdb')))throw Error('PG18_BIN_REQUIRED');
 const version=execFileSync(exe('postgres'),['--version'],{encoding:'utf8',windowsHide:true}).trim();if(!/PostgreSQL\) 18\./.test(version))throw Error('POSTGRESQL_18_REQUIRED');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mos-pg-phase3a2-')),data=path.join(root,'cluster'),pw=path.join(root,'bootstrap-password.tmp');
 const password=crypto.randomBytes(32).toString('hex');fs.writeFileSync(pw,password,{mode:0o600});
 const env={...process.env};for(const k of Object.keys(env))if(/^PG[A-Z_]+$/.test(k))delete env[k];
 const run=(name,args)=>execFileSync(exe(name),args,{encoding:'utf8',windowsHide:true,env,stdio:'ignore'});
 try{run('initdb',['-D',data,'--username=mos_test_admin','--pwfile='+pw,'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C','--no-instructions']);}finally{fs.rmSync(pw,{force:true});}
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 fs.appendFileSync(path.join(data,'postgresql.conf'),"\nlisten_addresses='127.0.0.1'\nport="+port+"\nmax_connections=40\nshared_buffers='32MB'\nfsync=on\ndeadlock_timeout='100ms'\nlog_statement='none'\nlog_min_error_statement='panic'\nlog_parameter_max_length=0\nlog_parameter_max_length_on_error=0\n");
 run('pg_ctl',['-D',data,'-l',path.join(root,'server.log'),'-w','-t','40','start']);
 const config={host:'127.0.0.1',port,user:'mos_test_admin',password,database:'postgres',ssl:false};
 let stopped=false;
 return {version,port,root,config,async admin(database='postgres'){const c=new Client({...config,database});await c.connect();return c;},async stop(){if(stopped)return;run('pg_ctl',['-D',data,'-w','-t','30','-m','fast','stop']);stopped=true;const resolved=fs.realpathSync(root);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('mos-pg-phase3a2-'))throw Error('UNSAFE_CLUSTER_CLEANUP');fs.rmSync(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:200});}};
}
module.exports={startCluster};
