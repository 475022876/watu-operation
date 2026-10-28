'use strict';
const assert=require('node:assert/strict');
const {sha256,stableStringify}=require('../../lib/mos/ids');
module.exports=async function({test,db,vf,admin,tasks,versions,rejectsCode}){
 const digest=sha256('file');
 await test('schema','synthetic file metadata initializes without any real media access',async()=>{
  await admin.query("INSERT INTO mos.file_objects(id,brand_code,storage_backend,object_key,state) VALUES('file-object','VFIB','fixture','fixture/working','READY'),('archive-object','VFIB','fixture','fixture/published','READY')");
  for(const [id,obj] of [['file-v1','file-object'],['archive-v1','archive-object']])await admin.query("INSERT INTO mos.file_versions(id,brand_code,object_id,version_no,sha256,byte_length,mime,upload_state,verified_at,immutable) VALUES($1,'VFIB',$2,1,$3,4,'application/octet-stream','READY',CURRENT_TIMESTAMP,true)",[id,obj,digest]);
  await admin.query("INSERT INTO mos.working_assets(id,brand_code,file_version_id,sha256,bytes,mime,origin,visibility,owner_id) VALUES('asset-v1','VFIB','file-v1',$1,4,'application/octet-stream','UPLOAD','PRIVATE','creator')",[digest]);
 });
 await test('schema','frozen asset reference pins a ready immutable file version',async()=>{
  await db.transaction(vf,async tx=>{
   await versions.create(tx,{id:'asset-cv',content_task_id:'vf-task',number:4,code:'asset-cv',state:'DRAFT',body:'Asset body',risk_grade:'G0',locale:'zh-CN',author_id:'creator',disclosures:[]});
   await tx.query("INSERT INTO mos.content_version_assets(id,brand_code,content_version_id,asset_id,file_version_id,asset_sha256,ordinal) VALUES('asset-ref','VFIB','asset-cv','asset-v1','file-v1',$1,0)",[digest]);
   const payload={contentVersionId:'asset-cv',contentTaskId:'vf-task',brandCode:'VFIB',textHash:sha256('Asset body'),assets:[{id:'asset-v1',sha256:digest,mime:'application/octet-stream',origin:'UPLOAD'}],channelIds:[],locale:'zh-CN',disclosures:[],riskGrade:'G0'};
   const canonical=stableStringify(payload);await versions.update(tx,'asset-cv',1,{state:'LOCKED_FOR_REVIEW',manifest_hash:sha256(canonical),manifest_canonical_text:canonical,manifest_payload:payload});
  });
 });
 await test('schema','ready file digest cannot be changed even by owner',()=>assert.rejects(admin.query("UPDATE mos.file_versions SET sha256=$1 WHERE id='file-v1'",['0'.repeat(64)]),e=>e.code==='55000'));
 await test('schema','ready file location cannot be changed',()=>assert.rejects(admin.query("UPDATE mos.file_objects SET object_key='replacement' WHERE id='file-object'"),e=>e.code==='55000'));
 await test('schema','asset material referenced by frozen content cannot be changed',()=>rejectsCode(db.transaction(vf,tx=>tx.query("UPDATE mos.working_assets SET sha256=$1 WHERE id='asset-v1'",['0'.repeat(64)])),'PG_IMMUTABLE_RECORD'));
 await test('schema','frozen asset reference cannot be deleted',()=>rejectsCode(db.transaction(vf,tx=>tx.query("DELETE FROM mos.content_version_assets WHERE id='asset-ref'")),'PG_IMMUTABLE_RECORD'));
 await admin.query("INSERT INTO mos.channels(id,brand_code,platform,state) VALUES('ch-fixture','VFIB','LINKEDIN','ENABLED')");
 await admin.query("INSERT INTO mos.publishing_schedules(id,brand_code,content_version_id,channel_id,planned_at_raw,state) VALUES('schedule-fixture','VFIB','frozen-cv','ch-fixture','2026-10-29T10:00','READY')");
 await admin.query("INSERT INTO mos.publication_records(id,brand_code,schedule_id,content_version_id,channel_id,status) VALUES('publication-fixture','VFIB','schedule-fixture','frozen-cv','ch-fixture','PUBLISHED')");
 await test('schema','published snapshot requires ready file metadata',()=>assert.rejects(admin.query("INSERT INTO mos.published_artifacts(id,brand_code,publication_id,kind,sha256,bytes) VALUES('bad-snapshot','VFIB','publication-fixture','TEXT_SNAPSHOT',$1,4)",[digest]),e=>e.code==='23514'));
 await test('schema','valid snapshot is immutable independent archive version',async()=>{await admin.query("INSERT INTO mos.published_artifacts(id,brand_code,publication_id,kind,file_version_id,sha256,bytes) VALUES('snapshot-fixture','VFIB','publication-fixture','TEXT_SNAPSHOT','archive-v1',$1,4)",[digest]);await assert.rejects(admin.query("UPDATE mos.published_artifacts SET sha256=$1 WHERE id='snapshot-fixture'",['0'.repeat(64)]),e=>e.code==='55000');});
 await admin.query("INSERT INTO mos.asset_admissions(id,brand_code,working_asset_id,asset_sha256,origin_object_id,state,final_approval_status,sync_status,approval_mode,idempotency_key,submitted_by,classification) VALUES('admission-fixture','VFIB','asset-v1',$1,'origin-fixture','SUBMITTED','PENDING','NOT_STARTED','MOCK','admission-fixture','creator','internal')",[digest]);
 await test('security','creator cannot grant final library approval',()=>rejectsCode(db.transaction(vf,tx=>tx.query("UPDATE mos.asset_admissions SET final_approval_status='APPROVED' WHERE id='admission-fixture'")),'PG_ACCESS_DENIED'));
 await test('security','technical admin does not inherit final library approval',async()=>{const ac=await db.contextFor({testSession:'admin'},'VFIB');await rejectsCode(db.transaction(ac,tx=>tx.query("UPDATE mos.asset_admissions SET final_approval_status='APPROVED' WHERE id='admission-fixture'")),'PG_ACCESS_DENIED');});
 await test('security','independent final approver preserves MOCK status in synthetic fixture',async()=>{const fc=await db.contextFor({testSession:'final'},'VFIB');await db.transaction(fc,tx=>tx.query("UPDATE mos.asset_admissions SET final_approval_status='APPROVED' WHERE id='admission-fixture'"));assert.equal((await admin.query("SELECT approval_mode FROM mos.asset_admissions WHERE id='admission-fixture'")).rows[0].approval_mode,'MOCK');});
 await test('schema','approved admission metadata cannot be downgraded',()=>assert.rejects(admin.query("UPDATE mos.asset_admissions SET classification='open' WHERE id='admission-fixture'"),e=>e.code==='55000'));
 await test('schema','MOCK approved admission cannot be relabeled REAL',()=>assert.rejects(admin.query("UPDATE mos.asset_admissions SET approval_mode='REAL' WHERE id='admission-fixture'"),e=>e.code==='55000'));
 await test('security','application cannot SET ROLE guard or disable RLS',async()=>{await rejectsCode(db.transaction(vf,tx=>tx.query('SET LOCAL ROLE mos_guard')),'PG_ACCESS_DENIED');await rejectsCode(db.transaction(vf,tx=>tx.query('ALTER TABLE mos.content_tasks DISABLE ROW LEVEL SECURITY')),'PG_ACCESS_DENIED');});
 await test('transaction','lost connection during COMMIT is UNKNOWN and is never blindly retried',async()=>{
  await admin.query("CREATE FUNCTION mos.test_commit_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$");
  await admin.query("CREATE CONSTRAINT TRIGGER test_commit_delay AFTER INSERT ON mos.content_tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.id='commit-unknown') EXECUTE FUNCTION mos.test_commit_delay()");
  let signal,pid,attempts=0;const reached=new Promise(r=>signal=r);
  try{
   const outcome=db.transaction(vf,async tx=>{attempts++;pid=(await tx.query('SELECT pg_backend_pid() p')).rows[0].p;await tasks.create(tx,{id:'commit-unknown',code:'PG-commit-unknown',title:'Synthetic',status:'IDEA',owner_id:'creator'});signal();},{retrySafe:true,maxRetries:2}).then(()=>null,e=>e);
   await reached;let waiting=false;for(let i=0;i<50;i++){const r=await admin.query('SELECT query,wait_event FROM pg_stat_activity WHERE pid=$1',[pid]);if(r.rows[0]?.query==='COMMIT'&&r.rows[0]?.wait_event==='PgSleep'){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
   assert(waiting);await admin.query('SELECT pg_terminate_backend($1)',[pid]);const e=await outcome;assert.equal(e.code,'PG_COMMIT_OUTCOME_UNKNOWN');assert.equal(e.retryable,false);assert.equal(attempts,1);
  }finally{await admin.query('DROP TRIGGER test_commit_delay ON mos.content_tasks');await admin.query('DROP FUNCTION mos.test_commit_delay()');}
 });

 await test('transaction','whole transaction deadline also covers COMMIT and reports UNKNOWN',async()=>{
  await admin.query("CREATE FUNCTION mos.test_commit_deadline() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$");
  await admin.query("CREATE CONSTRAINT TRIGGER test_commit_deadline AFTER INSERT ON mos.content_tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN (NEW.id='commit-deadline') EXECUTE FUNCTION mos.test_commit_deadline()");
  let attempts=0;
  try{await rejectsCode(db.transaction(vf,async tx=>{attempts++;await tasks.create(tx,{id:'commit-deadline',code:'PG-commit-deadline',title:'Synthetic',status:'IDEA',owner_id:'creator'});},{transactionTimeoutMs:100,retrySafe:true,maxRetries:2}),'PG_COMMIT_OUTCOME_UNKNOWN');assert.equal(attempts,1);}
  finally{await admin.query('DROP TRIGGER test_commit_deadline ON mos.content_tasks');await admin.query('DROP FUNCTION mos.test_commit_deadline()');}
 });
};
