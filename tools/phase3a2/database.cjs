'use strict';
const {Client}=require('pg'),crypto=require('node:crypto'),path=require('node:path');
const credentials=new WeakMap();
const {ROLES}=require('../../lib/mos/dict');
function isolated(config){if(!config||!['127.0.0.1','::1'].includes(config.host)||!/^mos_phase3a2_[a-z0-9_]+$/.test(config.database)||!Number.isInteger(config.port)||!config.user||!config.password)throw Error('ISOLATED_TEST_DATABASE_REQUIRED');return config;}
async function createDatabase(cluster,suffix='foundation'){
 const admin=await cluster.admin(),database='mos_phase3a2_'+suffix+'_'+crypto.randomBytes(4).toString('hex');
 let passwords=credentials.get(cluster);if(!passwords){passwords={};for(const r of ['mos_migrator','mos_app','mos_worker'])passwords[r]=crypto.randomBytes(32).toString('hex');credentials.set(cluster,passwords);}
 try{
  for(const name of ['mos_owner','mos_guard','mos_migrator','mos_app','mos_worker']){
   const has=await admin.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[name]);
   if(!has.rowCount){const q=await admin.query('SELECT format(\'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS\',$1::text) AS sql',[name]);await admin.query(q.rows[0].sql);}
   if(passwords[name]&&!has.rowCount){const q=await admin.query('SELECT format(\'ALTER ROLE %I LOGIN PASSWORD %L\',$1::text,$2::text) AS sql',[name,passwords[name]]);await admin.query(q.rows[0].sql);}
  }
  await admin.query('GRANT mos_owner TO mos_migrator');await admin.query('GRANT mos_guard TO mos_owner');
  const q=await admin.query('SELECT format(\'CREATE DATABASE %I OWNER mos_migrator\',$1::text) AS sql',[database]);await admin.query(q.rows[0].sql);
  const d=await cluster.admin(database);try{await d.query('REVOKE ALL ON DATABASE '+database+' FROM PUBLIC');await d.query('GRANT CONNECT ON DATABASE '+database+' TO mos_app,mos_worker');await d.query('GRANT CREATE ON DATABASE '+database+' TO mos_owner');await d.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');}finally{await d.end();}
 }finally{await admin.end();}
 return {database,configFor:role=>isolated({...cluster.config,database,user:role,password:passwords[role]})};
}
async function migrate(config,extra={}){
 isolated(config);if(Number(process.versions.node.split('.')[0])<20)throw Error('PG_MIGRATION_NODE20_REQUIRED');
 const c=new Client({...config,connectionTimeoutMillis:2000});await c.connect();
 try{const {runner}=await import('node-pg-migrate');return await runner({dbClient:c,dir:path.resolve(__dirname,'../../migrations/postgresql'),ignorePattern:'.*\\.sql',migrationsTable:'schema_migrations',migrationsSchema:'mos_meta',createMigrationsSchema:true,direction:'up',singleTransaction:true,checkOrder:true,noLock:false,logger:{info(){},warn(){},error(){},debug(){}},...extra});}finally{await c.end();}
}
async function seedSynthetic(cluster,database){
 const admin=await cluster.admin(database),key=crypto.randomBytes(32);
 try{
  for(const code of ['VFIB','UCARD'])await admin.query('INSERT INTO mos.brands(code,name) VALUES($1,$1)',[code]);
  for(const [code,r]of Object.entries(ROLES)){
   await admin.query('INSERT INTO mos.role_definitions(id,role_code,label,kind,policy_version) VALUES($1,$1,$2,$3,$4)',[code,r.label,r.kind,'MOS-POLICY-2026.10-v1']);
   for(const p of r.permissions)await admin.query('INSERT INTO mos.role_permissions(id,role_code,permission_code,policy_version) VALUES($1,$2,$3,$4)',[code+':'+p,code,p,'MOS-POLICY-2026.10-v1']);
  }
  for(const [id,role,brand] of [['creator','P2','VFIB'],['ucard','P2','UCARD'],['editor','P1','VFIB'],['reviewer','P3','VFIB'],['admin','MOS_ADMIN','*'],['final','LIBRARY_FINAL_APPROVER','VFIB']]){
   await admin.query('INSERT INTO mos.users(id,username,status,display_name) VALUES($1,$1,$2,$1)',[id,'active']);
   await admin.query('INSERT INTO mos.user_role_grants(id,user_id,role_code,all_brands) VALUES($1,$2,$3,$4)',['g-'+id,id,role,brand==='*']);
   if(brand!=='*')await admin.query('INSERT INTO mos.role_brand_scopes(id,grant_id,scope_brand_code) VALUES($1,$2,$3)',['s-'+id,'g-'+id,brand]);
  }
  await admin.query('INSERT INTO mos.system_settings(id,setting_key,schema_version,value) VALUES($1,$2,1,$3::jsonb)',['pg-context-key','_pg_context_key',JSON.stringify({hex:key.toString('hex')})]);
 }finally{await admin.end();}
 return key;
}
module.exports={isolated,createDatabase,migrate,seedSynthetic};
