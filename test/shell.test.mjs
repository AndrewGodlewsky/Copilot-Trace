import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { startServer } from '../com.github.copilot/extensions/trace/server.mjs';
import { traceCanvas } from '../com.github.copilot/extensions/trace/canvas.mjs';

test('serves only authenticated local assets, with restrictive headers', async t => {
  const server = await startServer();
  t.after(() => server.close());
  const page = await fetch(server.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Copilot Trace/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(server.url + 'style.css')).status, 200);
  assert.equal((await fetch(new URL('/wrong/', server.url))).status, 404);
  assert.equal((await fetch(server.url + '%2e%2e%2fpackage.json')).status, 404);
  assert.equal((await fetch(server.url + 'extension.mjs')).status, 404);
  assert.equal((await fetch(server.url, { method: 'POST', body: '{}' })).status, 405);
  const status = await new Promise((resolve, reject) => {
    request(server.url, { headers: { Host: 'attacker.example' } }, res => {
      res.resume(); resolve(res.statusCode);
    }).on('error', reject).end();
  });
  assert.equal(status, 403);
});

const context = instanceId => ({ sessionId: 'attached', instanceId, input: {} });
function fixture(start = startServer) {
  return traceCanvas({ createCanvas: options => options, getSession: () => ({ sessionId: 'attached' }), startServer: start });
}

test('reopens one instance, isolates others, rejects foreign sessions and closes servers', async t => {
  const shell = fixture();
  t.after(() => shell.close());
  const [first, repeated] = await Promise.all([shell.canvas.open(context('one')), shell.canvas.open(context('one'))]);
  assert.equal(first.url, repeated.url);
  const other = await shell.canvas.open(context('two'));
  assert.notEqual(first.url, other.url);
  await assert.rejects(shell.canvas.open({ ...context('one'), sessionId: 'foreign' }), /session/i);
  await assert.rejects(shell.canvas.onClose({ ...context('one'), sessionId: 'foreign' }), /session/i);
  assert.equal((await fetch(first.url)).status, 200);
  await shell.canvas.onClose(context('one'));
  await assert.rejects(fetch(first.url));
  assert.equal((await fetch(other.url)).status, 200);
  await shell.close();
  await assert.rejects(fetch(other.url));
  await assert.rejects(shell.canvas.open(context('three')), /closed/i);
});

test('closing during startup releases the server and cannot return a usable panel', async () => {
  let ready;
  let closes = 0;
  const shell = fixture(() => new Promise(resolve => { ready = resolve; }));
  const opening = shell.canvas.open(context('one'));
  const rejected = assert.rejects(opening, /closed/i);
  const closing = shell.canvas.onClose(context('one'));
  ready({ url: 'http://127.0.0.1/', close: async () => { closes++; } });
  await Promise.all([rejected, closing]);
  assert.equal(closes, 1);
  await shell.close();
});

test('failed startup can be retried', async () => {
  let attempts = 0;
  const shell = fixture(async () => {
    if (++attempts === 1) throw new Error('startup failed');
    return { url: 'http://127.0.0.1/', close: async () => {} };
  });
  await assert.rejects(shell.canvas.open(context('one')), /startup failed/);
  assert.equal((await shell.canvas.open(context('one'))).url, 'http://127.0.0.1/');
  await shell.close();
});
