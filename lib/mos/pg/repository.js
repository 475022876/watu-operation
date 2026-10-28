'use strict';
const {PgBoundaryError}=require('./errors');
// Trusted code chooses descriptors. HTTP input never chooses tables or column identifiers.
const DESCRIPTORS=Object.freeze({
 content_tasks:{fields:['id','code','title','owner_id','campaign_id','topic_id','status','production_due','review_due','platform','type','risk_grade'],mutable:['title','status','production_due','review_due']},
 content_versions:{fields:['id','content_task_id','number','code','title','body','format','state','risk_grade','locale','author_id','manifest_hash','manifest_payload','manifest_canonical_text','disclosures'],mutable:['title','body','state','risk_grade','locale','manifest_hash','manifest_payload','manifest_canonical_text','disclosures'],json:['manifest_payload','disclosures']}
});
function toDto(row){if(!row)return null;const out={};for(const [key,value] of Object.entries(row)){const k=key.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());out[k]=value instanceof Date?value.toISOString():value;}return out;}
function createRepository(table){
 const d=Object.hasOwn(DESCRIPTORS,table)?DESCRIPTORS[table]:null;if(!d)throw new PgBoundaryError('PG_REPOSITORY_NOT_ALLOWED');
 const encode=(k,v)=>d.json&&d.json.includes(k)&&v!==null?JSON.stringify(v):v;
 const columns='id,brand_code,row_version,'+d.fields.filter(f=>f!=='id').join(',');
 function ensure(tx){if(!tx||typeof tx.query!=='function'||!tx.context)throw new PgBoundaryError('PG_UNIT_OF_WORK_REQUIRED');}
 async function get(tx,id){ensure(tx);const r=await tx.query(`SELECT ${columns} FROM mos.${table} WHERE brand_code=$1 AND id=$2`,[tx.context.brandCode,id]);return toDto(r.rows[0]);}
 return Object.freeze({get,async list(tx,limit=50){ensure(tx);if(!Number.isInteger(limit)||limit<1||limit>100)throw new PgBoundaryError('PG_BAD_PAGE_SIZE',400);return(await tx.query(`SELECT ${columns} FROM mos.${table} WHERE brand_code=$1 ORDER BY id LIMIT $2`,[tx.context.brandCode,limit])).rows.map(toDto);},async create(tx,values){ensure(tx);const keys=Object.keys(values);if(!keys.length||keys.some(k=>!d.fields.includes(k)))throw new PgBoundaryError('PG_REPOSITORY_FIELD_NOT_ALLOWED',400);const r=await tx.query(`INSERT INTO mos.${table} (brand_code,${keys.join(',')}) VALUES($1,${keys.map((_,i)=>'$'+(i+2)).join(',')}) RETURNING ${columns}`,[tx.context.brandCode,...keys.map(k=>encode(k,values[k]))]);return toDto(r.rows[0]);},async update(tx,id,expected,patch){ensure(tx);const keys=Object.keys(patch);if(!Number.isInteger(expected)||expected<1||!keys.length||keys.some(k=>!d.mutable.includes(k)))throw new PgBoundaryError('PG_REPOSITORY_FIELD_NOT_ALLOWED',400);const r=await tx.query(`UPDATE mos.${table} SET ${keys.map((k,i)=>k+'=$'+(i+4)).join(',')},row_version=row_version+1,updated_at=CURRENT_TIMESTAMP WHERE brand_code=$1 AND id=$2 AND row_version=$3 RETURNING ${columns}`,[tx.context.brandCode,id,expected,...keys.map(k=>encode(k,patch[k]))]);if(!r.rowCount){if(!await get(tx,id))throw new PgBoundaryError('PG_NOT_FOUND',404);throw new PgBoundaryError('PG_VERSION_CONFLICT',409);}return toDto(r.rows[0]);}});
}
module.exports={createRepository,toDto};
