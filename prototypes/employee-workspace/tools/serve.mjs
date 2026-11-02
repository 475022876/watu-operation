// Only this built prototype. No cookies are read, logged or issued; no proxy/API/data access.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const dist=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../dist'),port=Number(process.env.P2_PORT||9094);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid isolated preview port');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.txt':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'"};
 const host=String(req.headers.host||'');if(![`p2.localhost:${port}`,`127.0.0.1:${port}`].includes(host)){res.writeHead(403,headers);return res.end('Prototype host refused');}
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,headers);return res.end('Static prototype only');}
 let raw;try{raw=decodeURIComponent(String(req.url||'/').split('?')[0]);}catch(_){res.writeHead(400,headers);return res.end('Bad path');}
 if(raw.startsWith('/api')||raw.includes('..')||raw.includes('\\')){res.writeHead(403,headers);return res.end('No APIs or parent paths');}
 const target=path.resolve(dist,raw==='/'?'index.html':'.'+raw),relative=path.relative(dist,target),ext=path.extname(target);
 if(relative.startsWith('..')||path.isAbsolute(relative)||!types[ext]||!fs.existsSync(target)||!fs.statSync(target).isFile()){res.writeHead(404,headers);return res.end('Not found');}
 if(!fs.realpathSync(target).startsWith(fs.realpathSync(dist)+path.sep)){res.writeHead(403,headers);return res.end('Refused');}
 res.writeHead(200,{...headers,'Content-Type':types[ext]});if(req.method==='HEAD')return res.end();fs.createReadStream(target).pipe(res);
});
server.on('error',err=>{console.error('Isolated prototype cannot start: '+err.code);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(`P2 MOCK prototype: http://p2.localhost:${port}/ — synthetic browser-only data; no business connection`));
