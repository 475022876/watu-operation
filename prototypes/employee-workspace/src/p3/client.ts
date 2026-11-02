// Same-origin MOS session only. Mutations are NEVER automatically retried.
export class Failure extends Error {
  status:number;code:string;constructor(status:number,code:string){super(code);this.status=status;this.code=code;}
  get uncertain(){return this.status===0||this.status>=500;}
}
function csrf(){const match=document.cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith('mos_csrf='));return match?decodeURIComponent(match.slice(9)):'';}
export async function request(path:string,method='GET',body?:unknown,raw=false):Promise<any>{
  if(!path.startsWith('/api/mos/')||path.includes('://'))throw new Failure(0,'INVALID_PATH');
  const headers:Record<string,string>={};if(method!=='GET'){headers['x-mos-csrf']=csrf();headers['Content-Type']=raw?'application/octet-stream':'application/json';}
  const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),30000);
  try{const res=await fetch(path,{method,headers,credentials:'same-origin',signal:ctl.signal,body:body===undefined?undefined:raw?body as Blob:JSON.stringify(body)});
    let data:any;try{data=await res.json();}catch{throw new Failure(res.ok?0:res.status,'INVALID_RESPONSE');}
    if(!res.ok)throw new Failure(res.status,data?.code||'HTTP_ERROR');return data;
  }catch(e){if(e instanceof Failure)throw e;throw new Failure(0,'NETWORK_ERROR');}finally{clearTimeout(timer);}
}
export async function all(path:string):Promise<any[]>{const rows:any[]=[];for(let page=1;page<=500;page++){const r=await request(path+(path.includes('?')?'&':'?')+'pageSize=200&page='+page);rows.push(...r.items);if(rows.length>=r.total)return rows;}throw new Failure(0,'LIST_LIMIT');}
export const q=(brand:string)=>'?brand='+encodeURIComponent(brand);
export const id=(value:string)=>encodeURIComponent(value);
export function fingerprint(v:any){return JSON.stringify([v.title,v.body,[...(v.refAssetIds||[])].sort()]);}
export function canSubmit(v:any,draft:any,busy:boolean,blocked:boolean){return !!v?.can?.submit&&!busy&&!blocked&&fingerprint(v)===fingerprint(draft)&&!!draft.body?.trim();}
export class Epoch {value=0;next(){return ++this.value;}current(n:number){return n===this.value;}}
