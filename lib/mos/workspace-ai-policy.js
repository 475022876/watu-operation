'use strict';
// H05: Workspace metadata is evaluated only after fresh, per-user Provider authorization.
const egress = require('./egress');
const MAPPING = Object.freeze({open:'PUBLIC',public:'PUBLIC',internal:'INTERNAL',confidential:'CONFIDENTIAL',restricted:'RESTRICTED',executive:'EXECUTIVE_CONFIDENTIAL',executive_confidential:'EXECUTIVE_CONFIDENTIAL'});
function mapClassification(value) {
  const raw=value && typeof value==='object' ? value.key : value;
  return MAPPING[String(raw == null ? '' : raw).trim().toLowerCase().replace(/[ -]+/g,'_')] || 'UNKNOWN';
}
function deny(code) {const e=new Error('企业资料未获准用于外部 AI，请核对资料库授权与外发策略');e.code=code;e.status=403;throw e;}
function evaluateMetadata(data, brandCode) {
  if (!data || data.isReusable !== true || data.permissionValid === false) deny('WORKSPACE_AI_NOT_REUSABLE');
  // No inference from search snippets, cached labels or a caller's declared dataClass.
  const cls=mapClassification(data.classification);
  if(cls==='UNKNOWN') deny('WORKSPACE_AI_UNKNOWN_CLASS');
  if(cls==='EXECUTIVE_CONFIDENTIAL') deny('WORKSPACE_AI_EXECUTIVE_FORBIDDEN');
  if(data.brandId && String(data.brandId).toUpperCase() !== String(brandCode).toUpperCase()) deny('WORKSPACE_AI_BRAND_MISMATCH');
  if(data.brandCode && String(data.brandCode).toUpperCase() !== String(brandCode).toUpperCase()) deny('WORKSPACE_AI_BRAND_MISMATCH');
  if(data.aiReusePolicy !== 'allowed' || data.externalAiTransferPolicy !== 'allowed') deny('WORKSPACE_AI_TRANSFER_FORBIDDEN');
  egress.assertDataPolicy({dataClass:cls,reasons:['WORKSPACE_AUTHORITY']}, egress.dataPolicy(require('./provideradmin').policy()));
  return cls;
}
async function assertExternalUse(input) {
  const o=input || {},db=require('./store').getDb(),formal=require('./formalguard'),rbac=require('./rbac');
  const task=o.taskId ? db.content_tasks.find(t=>t.id===o.taskId) : null;
  if(o.taskId && !task) deny('WORKSPACE_AI_TASK_NOT_FOUND');
  const brand=String(o.brandCode || (task && task.brandCode) || '').toUpperCase();
  if(task && task.brandCode!==brand) deny('WORKSPACE_AI_BRAND_MISMATCH');
  if(o.libraryRefIds != null && !Array.isArray(o.libraryRefIds))deny('WORKSPACE_AI_REFERENCE_INVALID');
  if(o.refAssetIds != null && !Array.isArray(o.refAssetIds))deny('WORKSPACE_AI_REFERENCE_INVALID');
  const ids=formal.collectRefIds(db,{task,libraryRefIds:o.libraryRefIds,brief:undefined});
  // Include library-backed working assets attached to any task content version.
  const assets=new Set(o.refAssetIds || []);
  if(task) for(const v of db.content_versions || []) if(v.contentTaskId===task.id) for(const id of v.refAssetIds || []) assets.add(id);
  for(const id of assets){const a=(db.working_assets || []).find(a=>a.id===id);if(a){const linked=a.libraryRefId || ((db.library_asset_refs || []).find(r=>r.workingAssetId===a.id) || {}).id;if(linked && !ids.includes(linked))ids.push(linked);}}
  if(!ids.length)return {checked:0};
  const actor=(db.users || []).find(u=>u.id===o.actorId);
  if(!actor || actor.status!=='active' || !rbac.can(rbac.principalOf(db,actor),'model.invoke',brand))deny('WORKSPACE_AI_ACTOR_DENIED');
  for(const id of ids){
    const ref=formal.resolveRef(db,id);
    if(!ref || !ref.libraryId || ref.brandCode!==brand)deny('WORKSPACE_AI_REFERENCE_DENIED');
    const fresh=await require('./eventconsumer').verifyAssetUsable(brand,ref.libraryId,{userId:actor.id,purpose:'外部AI使用前授权与密级核验'});
    if(!fresh.ok || !fresh.usable)deny('WORKSPACE_AI_PERMISSION_REVOKED');
    evaluateMetadata(fresh.data,brand);
  }
  // A revocation that occurred during remote checks must not leave a stale local actor authorized.
  const current=require('./store').getDb();const latest=current.users.find(u=>u.id===o.actorId);
  if(!latest || latest.status!=='active' || !rbac.can(rbac.principalOf(current,latest),'model.invoke',brand))deny('WORKSPACE_AI_ACTOR_DENIED');
  return {checked:ids.length};
}
module.exports={MAPPING,mapClassification,evaluateMetadata,assertExternalUse};
