export type DraftScope={actor:string;brand:string;task:string};
// Browser drafts are untrusted input. Never treat a cached permission or state as authority.
export function readDraft(storage:Pick<Storage,'getItem'>,key:string,scope:DraftScope){
 const raw=storage.getItem(key);if(!raw)return null;
 const c=JSON.parse(raw);
 if(!c||c.schema!==1||c.actor!==scope.actor||c.brand!==scope.brand||c.task!==scope.task)throw Error('DRAFT_SCOPE');
 const d=c.draft;
 if(!d||typeof d.title!=='string'||typeof d.body!=='string'||!Array.isArray(d.refAssetIds)||d.refAssetIds.length>50||!d.refAssetIds.every((x:unknown)=>typeof x==='string'))throw Error('DRAFT_SHAPE');
 if(c.baseId!==undefined&&typeof c.baseId!=='string')throw Error('DRAFT_BASE');
 if(c.baseRow!==undefined&&(!Number.isInteger(c.baseRow)||c.baseRow<1))throw Error('DRAFT_ROW');
 if(c.pending!==undefined&&!['','save','submit','revise','decision','upload','check'].includes(c.pending))throw Error('DRAFT_OUTCOME');
 return {...c,draft:{title:d.title,body:d.body,refAssetIds:[...d.refAssetIds]}};
}
