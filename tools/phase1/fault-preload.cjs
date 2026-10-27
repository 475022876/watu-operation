'use strict';
// Test-only injected through --require, never registered by the application.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const dir=path.resolve(process.env.MOS_DATA_DIR||'');if(!dir.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(dir).startsWith('mos-phase1-'))throw Error('ISOLATED_COPY_REQUIRED');
const rename=fs.renameSync;fs.renameSync=function(from,to){if(to===path.join(dir,'mos.json')&&fs.existsSync(path.join(dir,'inject-rename-failure'))){const e=Error('SYNTHETIC_PHASE1_DISK_FAILURE');e.code='EIO';throw e;}return rename.apply(this,arguments);};
