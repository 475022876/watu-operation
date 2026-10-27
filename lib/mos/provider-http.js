'use strict';
// H04: validation and socket creation are one boundary. No proxy, redirects or second DNS lookup.
const http = require('node:http');
const https = require('node:https');
const { pinnedLookup } = require('./adapters/source');
const egress = require('./egress');
function failure(code) { const e = new Error(code); e.code = code; return e; }
function request(rawUrl, options, timeoutMs) {
  const o = options || {};
  const requestLimit = 2 * 1024 * 1024;
  const responseLimit = Math.min(120 * 1024 * 1024, Math.max(1, Number(o.maxResponseBytes) || 2 * 1024 * 1024));
  const ms = Math.min(180000, Math.max(1, Number(timeoutMs) || 30000));
  return new Promise((resolve, reject) => {
    let socketRequest, settled = false;
    const finish = (err, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (o.signal) o.signal.removeEventListener('abort', abort);
      if (err) { if (socketRequest) socketRequest.destroy(); reject(err); } else resolve(value);
    };
    const abort = () => finish(failure('PROVIDER_ABORTED'));
    const timer = setTimeout(() => finish(failure('PROVIDER_TIMEOUT')), ms);
    if (o.signal) { if (o.signal.aborted) return abort(); o.signal.addEventListener('abort', abort, { once: true }); }
    Promise.resolve().then(async () => {
      if (o.body != null && !Buffer.isBuffer(o.body) && typeof o.body !== 'string' && !(o.body instanceof URLSearchParams)) throw failure('PROVIDER_REQUEST_BODY_INVALID');
      const body = o.body == null ? null : Buffer.isBuffer(o.body) ? Buffer.from(o.body) : Buffer.from(String(o.body));
      if (body && body.length > requestLimit) throw failure('PROVIDER_REQUEST_TOO_LARGE');
      const guard = await egress.assertProviderUrl(rawUrl);
      if (settled) return;
      const u = guard.url;
      if (u.username || u.password) throw failure('PROVIDER_URL_CREDENTIALS_FORBIDDEN');
      const headers = Object.assign({}, o.headers || {});
      // Do not allow a caller to replace the validated virtual host or transfer framing.
      for (const k of Object.keys(headers)) if (/^(host|content-length|transfer-encoding|accept-encoding)$/i.test(k)) delete headers[k];
      headers['Accept-Encoding'] = 'identity';
      if (body) headers['Content-Length'] = body.length;
      socketRequest = (u.protocol === 'https:' ? https : http).request({
        protocol: u.protocol, hostname: guard.host, port: u.port || undefined,
        path: u.pathname + u.search, method: o.method || 'GET', headers,
        lookup: pinnedLookup(guard.addresses), servername: guard.host,
        agent: false, rejectUnauthorized: true, maxHeaderSize: 16384
      }, (res) => {
        res.on('error', () => finish(failure('PROVIDER_RESPONSE_FAILED')));
        if (res.statusCode >= 300 && res.statusCode < 400) { res.destroy(); return finish(failure('PROVIDER_REDIRECT_FORBIDDEN')); }
        if (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') { res.destroy(); return finish(failure('PROVIDER_ENCODING_FORBIDDEN')); }
        if (Number(res.headers['content-length']) > responseLimit) { res.destroy(); return finish(failure('PROVIDER_RESPONSE_TOO_LARGE')); }
        const chunks = []; let size = 0;
        res.on('data', (chunk) => { size += chunk.length; if (size > responseLimit) { res.destroy(); finish(failure('PROVIDER_RESPONSE_TOO_LARGE')); } else chunks.push(chunk); });
        res.on('aborted', () => finish(failure('PROVIDER_RESPONSE_FAILED')));
        res.on('end', () => {
          const bytes = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [k,v] of Object.entries(res.headers)) if (v != null) responseHeaders.set(k, Array.isArray(v) ? v.join(', ') : String(v));
          finish(null, {ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, headers: responseHeaders,
            text: async () => bytes.toString('utf8'), json: async () => JSON.parse(bytes.toString('utf8')),
            arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)});
        });
      });
      socketRequest.on('error', () => finish(failure('PROVIDER_NETWORK_FAILED')));
      if (body) socketRequest.write(body);
      socketRequest.end();
    }).catch((err) => finish(err && /^EGRESS_|^PROVIDER_/.test(err.code || '') ? err : failure('PROVIDER_NETWORK_FAILED')));
  });
}
module.exports = { request };
