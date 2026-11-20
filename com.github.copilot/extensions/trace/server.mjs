import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function startServer() {
  const assets = new Map(await Promise.all([
    ['', 'index.html', 'text/html; charset=utf-8'],
    ['style.css', 'style.css', 'text/css; charset=utf-8'],
  ].map(async ([route, file, type]) => [route, { type, body: await readFile(new URL(`./web/${file}`, import.meta.url)) }])));
  const prefix = `/${randomBytes(24).toString('hex')}/`;
  let host;
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'self'; base-uri 'none'; form-action 'none'");
    const fail = status => { res.writeHead(status); res.end(); };
    if (req.headers.host !== host) return fail(403);
    if (!req.url?.startsWith(prefix)) return fail(404);
    if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); return fail(405); }
    const asset = assets.get(req.url.slice(prefix.length));
    if (!asset) return fail(404);
    res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': asset.body.length });
    res.end(req.method === 'HEAD' ? undefined : asset.body);
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  host = `127.0.0.1:${server.address().port}`;
  let closing;
  return {
    url: `http://${host}${prefix}`,
    close() {
      return closing ??= new Promise((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve());
        server.closeAllConnections();
      });
    },
  };
}
