'use strict';
const assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');const h=require('./helpers'),{preflight}=require('./preflight-isolated-db');
(async()=>{
 h.fixture();const f=h.path.join(h.dir,'mos.json'),good=h.fs.readFileSync(f);const guard=h.path.join(__dirname,'preflight-isolated-db.js');
 await h.check('T04 isolated preflight accepts valid schema8 copy',()=>assert.equal(preflight(h.dir).schema,8));
 await h.check('T04 corrupted isolated copy blocks launch without rewriting',()=>{h.fs.writeFileSync(f,'{corrupt');const before=h.fs.readFileSync(f);const r=spawnSync(process.execPath,[guard,h.dir]);assert.equal(r.status,2);assert(r.stderr.toString().includes('ISOLATED_DB_CORRUPT'));assert.deepEqual(h.fs.readFileSync(f),before);});
 await h.check('T04 backup restoration is byte identical and parseable',()=>{h.fs.writeFileSync(f,good);assert.deepEqual(h.fs.readFileSync(f),good);assert.equal(preflight(h.dir).schema,8);});
 await h.check('T04 future schema is rejected without downgrading',()=>{const v=JSON.parse(good);v.mosSchemaVersion=999;h.fs.writeFileSync(f,JSON.stringify(v));const before=h.fs.readFileSync(f);assert.throws(()=>preflight(h.dir),/SCHEMA_UNSUPPORTED/);assert.deepEqual(h.fs.readFileSync(f),before);h.fs.writeFileSync(f,good);});
 await h.check('T04 test preflight refuses production source directory',()=>assert.throws(()=>preflight(h.path.resolve(__dirname,'../../data')),/ISOLATED_COPY_REQUIRED/));
 await h.check('T04 H06 production loader blocks corrupt disposable copy after Phase2',()=>{const copy=h.path.join(h.dir,'legacy');h.fs.mkdirSync(copy);h.fs.writeFileSync(h.path.join(copy,'mos.json'),'{corrupt');const root=h.path.resolve(__dirname,'../..');const r=spawnSync(process.execPath,['-e',"require('./lib/mos/store').getDb()"],{cwd:root,env:{...process.env,MOS_DATA_DIR:copy},stdio:'pipe'});assert.notEqual(r.status,0);assert(r.stderr.toString().includes('MOS_DATABASE_LOAD_BLOCKED'));assert.equal(h.fs.readFileSync(h.path.join(copy,'mos.json'),'utf8'),'{corrupt');assert.deepEqual(h.fs.readdirSync(copy),['mos.json']);});
 h.finish('t04-isolated');
})().catch(e=>{console.error(e.message);h.finish('t04-isolated');process.exitCode=1;});
