'use strict';
// Reviewable migration file digests. No DB connection or data access.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.resolve(__dirname,'../../migrations/postgresql'),file=path.join(dir,'MANIFEST.json');
function current(){return Object.fromEntries(fs.readdirSync(dir).filter(n=>/^\d+-.*\.(cjs|sql)$/.test(n)).sort().map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,n),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n')).digest('hex')]));}
function validate(){const expected=JSON.parse(fs.readFileSync(file,'utf8')).files,actual=current();if(JSON.stringify(expected)!==JSON.stringify(actual))throw Object.assign(Error('MIGRATION_SOURCE_DIGEST_MISMATCH'),{code:'MIGRATION_SOURCE_DIGEST_MISMATCH'});return true;}
if(require.main===module){if(process.argv.includes('--write'))fs.writeFileSync(file,JSON.stringify({format:1,textNormalization:'UTF8, no BOM, LF',files:current()},null,2));else validate();console.log('Migration source manifest verified');}
module.exports={validate};
