'use strict';
// Test-only network backstop; loaded through NODE_OPTIONS in the regression runner.
// Local contract fixtures remain usable. No real provider or social endpoint can be called.
function allowed(input){let host='';if(typeof input==='string'||input instanceof URL){try{host=new URL(input).hostname;}catch(_){return false;}}else if(input&&typeof input==='object')host=String(input.hostname||input.host||'').replace(/:\d+$/,'');return ['localhost','127.0.0.1','[::1]','::1'].includes(host);}
const realFetch=global.fetch;if(realFetch)global.fetch=function(input,...args){if(!allowed(typeof input==='object'&&input.url?input.url:input))return Promise.reject(Object.assign(Error('PHASE1_EXTERNAL_NETWORK_DISABLED'),{code:'EGRESS_BLOCKED'}));return realFetch.call(this,input,...args);};
for(const name of ['node:http','node:https']){
 const mod=require(name),request=mod.request;
 mod.request=function(input,...args){
  if(!allowed(input)){
   if(!input || typeof input!=='object' || typeof input.lookup!=='function')throw Object.assign(Error('PHASE1_EXTERNAL_NETWORK_DISABLED'),{code:'EGRESS_BLOCKED'});
   // Source SSRF tests use a public-looking hostname with a fixed loopback lookup.
   // Allow that contract fixture only after verifying the actual lookup result.
   const lookup=input.lookup;
   input={...input,lookup:(hostname,options,callback)=>lookup(hostname,options,(err,address,family)=>{
    const addresses=Array.isArray(address)?address.map(x=>x.address):[address];
    if(!err && addresses.every(x=>['127.0.0.1','::1'].includes(x)))callback(null,address,family);
    else callback(err||Object.assign(Error('PHASE1_EXTERNAL_NETWORK_DISABLED'),{code:'EGRESS_BLOCKED'}));
   })};
  }
  return request.call(this,input,...args);
 };
}
