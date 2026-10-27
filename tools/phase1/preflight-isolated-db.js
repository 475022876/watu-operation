'use strict';
// TEST-ONLY preflight. Does not replace or modify the production store.load recovery policy.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
function preflight(dir){const p=path.resolve(dir),tmp=path.resolve(os.tmpdir());if(!p.startsWith(tmp+path.sep)||!path.basename(p).startsWith('mos-phase1-'))throw Error('ISOLATED_COPY_REQUIRED');const f=path.join(p,'mos.json');let db;try{db=JSON.parse(fs.readFileSync(f,'utf8'));}catch(_){throw Error('ISOLATED_DB_CORRUPT');}if(!Number.isInteger(db.mosSchemaVersion)||db.mosSchemaVersion>8)throw Error('ISOLATED_SCHEMA_UNSUPPORTED');return{ok:true,schema:db.mosSchemaVersion};}
module.exports={preflight};if(require.main===module){try{console.log(JSON.stringify(preflight(process.argv[2])));}catch(e){console.error(e.message);process.exitCode=2;}}
