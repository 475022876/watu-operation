'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const h=require('../phase1/helpers');h.fixture();h.db.content_tasks.push({id:'rollback-fixture',brandCode:'VFIB',status:'IN_PRODUCTION',rowVersion:3});h.store.saveNow();const good=fs.readFileSync(path.join(h.dir,'mos.json'));h.store.reset();
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mos-phase2-rollback-')),zip=path.join(dir,'code.zip'),root=path.join(dir,'code'),data=path.join(dir,'data');fs.mkdirSync(root);fs.mkdirSync(data);fs.writeFileSync(path.join(data,'mos.json'),good);
let out;
try{
 cp.execFileSync('git',['archive','319c5b3','--format=zip','-o',zip,'lib','package.json']);cp.execFileSync('python',['-m','zipfile','-e',zip,root]);
 const script="console.log=()=>{};const db=require('./lib/mos/store').getDb();process.stdout.write(JSON.stringify({schema:db.mosSchemaVersion,task:db.content_tasks.find(t=>t.id==='rollback-fixture')}));";
 const restored=JSON.parse(cp.execFileSync(process.execPath,['-e',script],{cwd:root,env:{...process.env,MOS_DATA_DIR:data},encoding:'utf8'}));assert.equal(restored.schema,8);assert.equal(restored.task.rowVersion,3);assert.equal(restored.task.brandCode,'VFIB');assert(fs.readFileSync(path.join(h.dir,'mos.json')).equals(good));
 out={ok:true,rollbackCommit:cp.execFileSync('git',['rev-parse','319c5b3'],{encoding:'utf8'}).trim(),archiveSha256:crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex'),schema:8,scope:'isolated synthetic schema8 copy; Phase1 code loads existing task/version without migration; no production restore executed',warning:'Phase1 loader lacks H06 protection; corrupted data must never be opened with rolled-back code'};
}finally{for(const p of [dir,h.dir]){const resolved=path.resolve(p);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('mos-phase'))throw Error('Unsafe cleanup');fs.rmSync(resolved,{recursive:true,force:true});}}
fs.writeFileSync('TEST_EVIDENCE_PHASE2/rollback.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
