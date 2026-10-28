'use strict';
// Opt-in foundation only. No business store imports, process.env DB defaults or JSON fallback.
const {Pool}=require('pg'),crypto=require('node:crypto');
const {PgBoundaryError,mapError}=require('./errors'),{active}=require('./context');
function createDatabase(options={}){
 const {connection,resolvePrincipal,signingKey,enabled}=options;
 if(enabled!==true)throw new PgBoundaryError('PG_EXPLICIT_OPT_IN_REQUIRED');
 if(!connection || !['127.0.0.1','::1'].includes(connection.host) || !/^mos_phase3a2_[a-z0-9_]+$/.test(connection.database) || !Number.isInteger(connection.port) || connection.port<1 || connection.port>65535 || !connection.password)throw new PgBoundaryError('PG_ISOLATED_TEST_DATABASE_REQUIRED');
 if(!['mos_app','mos_worker'].includes(connection.user))throw new PgBoundaryError('PG_RUNTIME_ROLE_FORBIDDEN',403);
 if(typeof resolvePrincipal!=='function'||!Buffer.isBuffer(signingKey)||signingKey.length!==32)throw new PgBoundaryError('PG_TRUSTED_IDENTITY_CONFIGURATION_REQUIRED');
 const key=Buffer.from(signingKey),issued=new WeakSet();let closed=false;
 const max=Math.min(10,Math.max(1,Number(options.poolMax)||4));
 const connectionErrorHook=Symbol('connectionErrorHook');
 const pool=new Pool({host:connection.host,port:connection.port,database:connection.database,user:connection.user,password:connection.password,ssl:false,max,connectionTimeoutMillis:Math.min(5000,Math.max(100,options.connectionTimeoutMs||1000)),idleTimeoutMillis:1000,application_name:'vfib-phase3a2-foundation'});
 const log=(event,code,extra={})=>{try{if(typeof options.logger==='function')options.logger(Object.freeze({event,code,...extra}));}catch(_){}};
 pool.on('error',()=>log('idle_connection_error','PG_UNAVAILABLE'));
 async function contextFor(request,brandCode){
  if(closed)throw new PgBoundaryError('PG_CLOSED');
  // Identity resolver is installed by trusted server code. Never copy actorId/roles from request.body.
  const p=await resolvePrincipal(request);
  if(!p||typeof p.id!=='string'||p.status!=='active')throw new PgBoundaryError('PG_AUTHENTICATION_REQUIRED',401);
  if(typeof brandCode!=='string'||!/^[A-Z0-9_-]{1,32}$/.test(brandCode))throw new PgBoundaryError('PG_BRAND_REQUIRED',403);
  const c=Object.freeze({actorId:p.id,brandCode});issued.add(c);return c;
 }
 async function once(context,operation,opts,attempt){
  let client,released=false,finished=false,timer,phase='acquiring';
  const release=destroy=>{if(client&&!released){released=true;client.release(destroy===true);}};
  try{
   client=await pool.connect();if(!client[connectionErrorHook]){client[connectionErrorHook]=true;client.on('error',()=>log('active_connection_error','PG_UNAVAILABLE'));}
   phase='transaction';await client.query('BEGIN');
   const statementMs=Math.min(10000,Math.max(20,Number(opts.statementTimeoutMs)||3000)),lockMs=Math.min(5000,Math.max(20,Number(opts.lockTimeoutMs)||1000));
   await client.query("SELECT set_config('statement_timeout',$1,true),set_config('lock_timeout',$2,true),set_config('idle_in_transaction_session_timeout',$3,true)",[String(statementMs),String(lockMs),String(statementMs+1000)]);
   const {rows}=await client.query('SELECT pg_backend_pid() AS pid,txid_current()::text AS xid');
   const claims=JSON.stringify({actorId:context.actorId,brandCode:context.brandCode,backendPid:rows[0].pid,transactionId:rows[0].xid,expiresAt:Math.floor(Date.now()/1000)+60});
   const signature=crypto.createHmac('sha256',key).update(claims).digest('hex');
   await client.query('SELECT mos.set_context($1,$2)',[claims,signature]);
   const tx=Object.freeze({context,attempt,async query(sql,parameters=[]){if(finished||released)throw new PgBoundaryError('PG_TRANSACTION_CLOSED');if(typeof sql!=='string'||!Array.isArray(parameters))throw new PgBoundaryError('PG_PARAMETERIZED_QUERY_REQUIRED');return client.query(sql,parameters);}});
   const deadlineMs=Math.min(15000,Math.max(30,Number(opts.transactionTimeoutMs)||5000));
   const work=active.run(tx,()=>Promise.resolve().then(()=>operation(tx)));
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{finished=true;release(true);reject(new PgBoundaryError('PG_TRANSACTION_DEADLINE',504));},deadlineMs);});
   const result=await Promise.race([work,deadline]);clearTimeout(timer);finished=true;
   phase='committing';await client.query('COMMIT');phase='committed';
   try{
    await client.query('RESET ALL');
    const clear=await client.query("SELECT coalesce(current_setting('mos.claims',true),'')='' AND coalesce(current_setting('mos.claims_signature',true),'')='' AS cleared");
    if(!clear.rows[0].cleared)throw new PgBoundaryError('PG_CONTEXT_NOT_CLEARED');
    log('transaction_committed','OK',{attempt,contextCleared:true});
   }catch(_){release(true);log('connection_cleanup_failed','PG_COMMIT_CONFIRMED',{attempt});}
   return result;
  }catch(e){
   clearTimeout(timer);finished=true;
   if(client&&!released){try{await client.query('ROLLBACK');await client.query('RESET ALL');}catch(_){release(true);}}
   const transportLost=!e.code || /^(08|57P0|ECONN|EPIPE|ETIMEDOUT)/.test(e.code);
   const mapped=phase==='committing'&&transportLost?new PgBoundaryError('PG_COMMIT_OUTCOME_UNKNOWN',503):mapError(e);
   log('transaction_failed',mapped.code,{attempt});throw mapped;
  }finally{clearTimeout(timer);finished=true;release(false);}
 }
 async function transaction(context,operation,opts={}){
  if(closed)throw new PgBoundaryError('PG_CLOSED');
  if(!context||!issued.has(context))throw new PgBoundaryError('PG_TRUSTED_CONTEXT_REQUIRED',403);
  if(active.getStore())throw new PgBoundaryError('PG_NESTED_TRANSACTION_FORBIDDEN');
  if(typeof operation!=='function')throw new PgBoundaryError('PG_OPERATION_REQUIRED');
  const retries=opts.retrySafe===true?Math.min(3,Math.max(0,Number(opts.maxRetries)||0)):0;
  for(let attempt=0;;attempt++){
   try{return await once(context,operation,opts,attempt);}catch(e){if(!e.retryable||attempt>=retries)throw e;await new Promise(r=>setTimeout(r,10+Math.floor(Math.random()*20)));}
  }
 }
 return Object.freeze({contextFor,transaction,diagnostics(){return {total:pool.totalCount,idle:pool.idleCount,waiting:pool.waitingCount};},async close(){if(closed)return;closed=true;await pool.end();key.fill(0);}});
}
module.exports={createDatabase};
