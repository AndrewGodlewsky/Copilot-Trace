import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createTrace } from './trace.mjs';
import { createDiagnostics } from './web/diagnostics.mjs';
import { createCapabilities } from './capabilities.mjs';
import { createInstructionSources } from './instructions.mjs';

export async function startServer(session) {
  const assets = new Map(await Promise.all([
    ['', 'index.html', 'text/html; charset=utf-8'],
    ['style.css', 'style.css', 'text/css; charset=utf-8'],
    ['app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['presentation.mjs', 'presentation.mjs', 'text/javascript; charset=utf-8'],
    ['learning.mjs', 'learning.mjs', 'text/javascript; charset=utf-8'],
    ['host-output.mjs', 'host-output.mjs', 'text/javascript; charset=utf-8'],
    ['glossary.mjs', 'glossary.mjs', 'text/javascript; charset=utf-8'],
    ['diagnostics.mjs', 'diagnostics.mjs', 'text/javascript; charset=utf-8'],
    ['polling.mjs', 'polling.mjs', 'text/javascript; charset=utf-8'],
    ['footer.mjs', 'footer.mjs', 'text/javascript; charset=utf-8'],
    ['follow.mjs', 'follow.mjs', 'text/javascript; charset=utf-8'],
    ['capabilities.mjs', 'capabilities.mjs', 'text/javascript; charset=utf-8'],
    ['instructions.mjs', 'instructions.mjs', 'text/javascript; charset=utf-8'],
    ['trace.svg', '../../../../assets/trace.svg', 'image/svg+xml'],
  ].map(async ([route, file, type]) => [route, { type, body: await readFile(new URL(`./web/${file}`, import.meta.url)) }])));
  const { version } = JSON.parse(await readFile(new URL('../../../plugin.json', import.meta.url), 'utf8'));
  const releases = JSON.parse(await readFile(new URL('../../../release-notes.json', import.meta.url), 'utf8'));
  assets.set('metadata', { type: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify({ version, releases })) });
  const prefix = `/${randomBytes(24).toString('hex')}/`;
  let host;
  const diagnostics = createDiagnostics();
  const trace = createTrace(session, diagnostics);
  const capabilities = createCapabilities(session);
  const instructions = createInstructionSources(session);
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'");
    const fail = status => { res.writeHead(status); res.end(); };
    if (req.headers.host !== host) return fail(403);
    if (!req.url?.startsWith(prefix)) return fail(404);
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return fail(405); }
    if (req.url === `${prefix}events` || req.url === `${prefix}diagnostics` || req.url === `${prefix}capabilities` || req.url === `${prefix}instruction-sources`) {
      if (req.headers.origin && req.headers.origin !== `http://${host}`) return fail(403);
      if (req.headers['sec-fetch-site'] === 'cross-site') return fail(403);
      if (req.url === `${prefix}capabilities` || req.url === `${prefix}instruction-sources`) {
        if (req.method === 'HEAD') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(); }
        const reader = req.url === `${prefix}capabilities` ? capabilities : instructions;
        void reader.read().then(snapshot => {
          if (res.destroyed) return;
          const body = JSON.stringify(snapshot);
          if (Buffer.byteLength(body) > 2 * 1024 * 1024) return fail(503);
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
          res.end(body);
        }).catch(() => { if (!res.destroyed) fail(503); });
        return;
      }
      const snapshot = trace.snapshot();
      if (req.url === `${prefix}diagnostics`) {
        const body = JSON.stringify({ version, history: snapshot.history, retained: snapshot.entries.length, omitted: snapshot.omitted, diagnostics: diagnostics.snapshot() });
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
        return res.end(req.method === 'HEAD' ? undefined : body);
      }
      const etag = `"${snapshot.revision}"`;
      res.setHeader('ETag', etag);
      if (req.headers['if-none-match'] === etag) return fail(304);
      const body = JSON.stringify(snapshot);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }
    const asset = assets.get(req.url.slice(prefix.length));
    if (!asset) return fail(404);
    res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.length });
    res.end(req.method === 'HEAD' ? undefined : asset.body);
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) { trace.close(); capabilities.close(); instructions.close(); throw error; }
  host = `127.0.0.1:${server.address().port}`;
  diagnostics.record('server_started');
  let closing;
  return {
    url: `http://${host}${prefix}`,
    close() {
      trace.close();
      capabilities.close();
      instructions.close();
      return closing ??= new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}
