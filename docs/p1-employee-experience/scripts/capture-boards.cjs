'use strict';
// Existing Chrome renders local static SVGs only. No MOS, accounts, APIs or installed packages.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawn}=require('node:child_process'),{pathToFileURL}=require('node:url'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../boards'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'vfib-p1-render-'));
const chrome=['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(fs.existsSync);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let child,client;
class Cdp{
 constructor(url){this.n=0;this.pending=new Map();this.ws=new WebSocket(url);this.ready=new Promise((r,j)=>{this.ws.addEventListener('open',r);this.ws.addEventListener('error',j);});this.ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(!m.id)return;const p=this.pending.get(m.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);});}
 send(method,params={}){return new Promise((resolve,reject)=>{const id=++this.n;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('CDP timeout: '+method));},15000);this.pending.set(id,{resolve,reject,timer});this.ws.send(JSON.stringify({id,method,params}));});}
}
(async()=>{
 if(!chrome)throw Error('Existing Chrome/Edge required');
 child=spawn(chrome,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--disable-background-networking','--disable-sync','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore',windowsHide:true});
 const active=path.join(profile,'DevToolsActivePort');for(let i=0;i<100&&!fs.existsSync(active);i++)await sleep(100);const port=Number(fs.readFileSync(active,'utf8').split('\n')[0]);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid owned debug endpoint');
 const tabs=await(await fetch('http://127.0.0.1:'+port+'/json')).json();client=new Cdp(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await client.ready;await client.send('Page.enable');await client.send('Network.enable');await client.send('Network.setCacheDisabled',{cacheDisabled:true});
 const results=[];
 for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.svg')).sort()){
  const svg=fs.readFileSync(path.join(root,name),'utf8'),match=svg.match(/width="(\d+)" height="(\d+)"/),width=Number(match[1]),height=Number(match[2]);
  await client.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await client.send('Page.navigate',{url:pathToFileURL(path.join(root,name)).href});await sleep(200);
  await client.send('Runtime.evaluate',{expression:'document.fonts.ready',awaitPromise:true});
  const shot=await client.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height,scale:1}}),png=Buffer.from(shot.data,'base64');
  if(png.readUInt32BE(16)!==width||png.readUInt32BE(20)!==height)throw Error('Incorrect drawing dimensions');
  const filename=name.replace(/\.svg$/,'.png');fs.writeFileSync(path.join(root,filename),png);results.push({drawing:filename,width,height,sha256:crypto.createHash('sha256').update(png).digest('hex'),status:'RENDERED_STATIC_DESIGN'});
 }
 fs.writeFileSync(path.resolve(root,'../DESIGN_RENDER_EVIDENCE.json'),JSON.stringify({date:'2026-11-02',at:new Date().toISOString(),scope:'Static SVG drawing rendering only; not a prototype or user workflow test',results},null,2));console.log('Rendered '+results.length+' static design PNGs.');
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{
 if(client){try{await client.send('Browser.close');}catch(_){}client.ws.close();}
 if(child){for(let i=0;i<30&&child.exitCode===null;i++)await sleep(100);if(child.exitCode===null)child.kill();await sleep(500);}
 const resolved=path.resolve(profile);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep)||!path.basename(resolved).startsWith('vfib-p1-render-'))throw Error('Unsafe render-profile cleanup');
 fs.rmSync(resolved,{recursive:true,force:true});
});
