'use strict';
const fs=require('node:fs'),path=require('node:path');
exports.up=pgm=>pgm.sql(fs.readFileSync(path.join(__dirname,'004-integrity.sql'),'utf8'));
exports.down=()=>{throw Error('AUTOMATIC_DESTRUCTIVE_DOWN_DISABLED');};
