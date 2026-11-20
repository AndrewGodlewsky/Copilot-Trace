import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, open } from 'node:fs/promises';
import { createTrace } from './trace.mjs';
import { createDiagnostics } from './web/diagnostics.mjs';
import { createCapabilities } from './capabilities.mjs';
import { createInstructionSources } from './instructions.mjs';
import { parseExampleLibrary, EXAMPLE_BYTES } from './web/examples.mjs';
import { createInvestigation } from './investigation.mjs';
import { InvestigationError } from './investigation-model.mjs';

export async function startServer(session, { investigationFactory = createInvestigation } = {}) {
  const assets = new Map(await Promise.all([
    ['', 'index.html', 'text/html; charset=utf-8'],
    ['style.css', 'style.css', 'text/css; charset=utf-8'],
    ['app.mjs', 'app.mjs', 'text/javascript; charset=utf-8'],
    ['event-data.mjs', 'event-data.mjs', 'text/javascript; charset=utf-8'],
    ['investigation.mjs', 'investigation.mjs', 'text/javascript; charset=utf-8'],
    ['presentation.mjs', 'presentation.mjs', 'text/javascript; charset=utf-8'],
    ['learning.mjs', 'learning.mjs', 'text/javascript; charset=utf-8'],
    ['examples.mjs', 'examples.mjs', 'text/javascript; charset=utf-8'],
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
  try {
    const file = await open(new URL('./web/examples.json', import.meta.url), 'r');
    const bytes = Buffer.alloc(EXAMPLE_BYTES + 1); let size = 0;
    try {
      while (size < bytes.length) {
        const { bytesRead } = await file.read(bytes, size, bytes.length - size, null);
        if (!bytesRead) break;
        size += bytesRead;
      }
    } finally { await file.close(); }
    if (size > EXAMPLE_BYTES) throw new Error('Example library exceeds the supported size.');
    const body = bytes.subarray(0, size);
    parseExampleLibrary(body.toString('utf8'));
    assets.set('examples.json', { type: 'application/json; charset=utf-8', body });
  } catch { assets.set('examples.json', { unavailable: true }); }
  const { version } = JSON.parse(await readFile(new URL('../../../plugin.json', import.meta.url), 'utf8'));
  const releases = JSON.parse(await readFile(new URL('../../../release-notes.json', import.meta.url), 'utf8'));
  assets.set('metadata', { type: 'application/json; charset=utf-8', body: Buffer.from(JSON.stringify({ version, releases })) });
  const prefix = `/${randomBytes(24).toString('hex')}/`;
  let host;
  const diagnostics = createDiagnostics();
  const trace = createTrace(session, diagnostics);
  const capabilities = createCapabilities(session);
  const instructions = createInstructionSources(session);
  const investigation = investigationFactory({ parent: session, snapshot: () => trace.snapshot() });
  let closing;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'");
    const fail = status => { res.writeHead(status); res.end(); };
    if (req.headers.host !== host) return fail(403);
    if (!req.url?.startsWith(prefix)) return fail(404);
    if (req.url === `${prefix}investigation` && req.method === 'POST') {
      if (closing || req.headers.origin !== `http://${host}` || req.headers['x-trace-request'] !== 'investigation' || req.headers['sec-fetch-site'] === 'cross-site') return fail(403);
      if (req.headers['content-type'] !== 'application/json') return fail(415);
      if (req.headers['content-encoding'] || Number(req.headers['content-length']) > 4096) return fail(413);
      void (async () => {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4096) return fail(413); chunks.push(chunk); }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return fail(400); }
        const schemas = { settings: ['action'], preview: ['action', 'eventId'], start: ['action', 'captureId', 'requestId'], cancel: ['action', 'requestId'], status: ['action'], save: ['action', 'revision', 'modelId', 'providerId', 'effort'] };
        const fields = Object.hasOwn(schemas, input?.action) ? schemas[input.action] : undefined;
        if (!fields || Object.keys(input).sort().join(',') !== [...fields].sort().join(',') || fields.filter(key => !['action', 'revision'].includes(key)).some(key => typeof input[key] !== 'string' || !input[key].length || input[key].length > 256) ||
          (input.action === 'save' && (!Number.isSafeInteger(input.revision) || input.revision < 0))) return fail(400);
        if (closing) return fail(409);
        const value = input.action === 'settings' ? await investigation.settings()
          : input.action === 'preview' ? await investigation.preview(input.eventId)
            : input.action === 'start' ? await investigation.start(input)
              : input.action === 'cancel' ? investigation.cancel(input.requestId)
                : input.action === 'status' ? await investigation.status()
                  : await investigation.save({ modelId: input.modelId, providerId: input.providerId, effort: input.effort }, input.revision);
        if (res.destroyed) return;
        const body = JSON.stringify(value);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) }); res.end(body);
      })().catch(error => {
        if (res.destroyed) return;
        const body = JSON.stringify({ message: error instanceof InvestigationError ? error.message : 'Investigation is unavailable. No automatic retry was made.' });
        res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(body);
      });
      return;
    }
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
    if (asset.unavailable) return fail(503);
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
  } catch (error) { trace.close(); capabilities.close(); instructions.close(); await investigation.close(); throw error; }
  host = `127.0.0.1:${server.address().port}`;
  diagnostics.record('server_started');
  return {
    url: `http://${host}${prefix}`,
    close() {
      return closing ??= (async () => {
        trace.close(); capabilities.close(); instructions.close();
        const shutdown = new Promise((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
        });
        await Promise.all([shutdown, investigation.close()]);
      })();
    },
  };
}
