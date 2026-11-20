import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { startServer } from '../com.github.copilot/extensions/trace/server.mjs';
import { traceCanvas } from '../com.github.copilot/extensions/trace/canvas.mjs';

test('serves only authenticated local assets, with restrictive headers', async t => {
  const server = await startServer();
  t.after(() => server.close());
  const page = await fetch(server.url);
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /<title>Trace<\/title>/);
  assert.match(html, /<h1>Trace<\/h1>/);
  assert.match(page.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(server.url + 'style.css')).status, 200);
  assert.equal((await fetch(server.url + 'app.mjs')).status, 200);
  assert.equal((await fetch(server.url + 'presentation.mjs')).status, 200);
  for (const module of ['footer.mjs', 'diagnostics.mjs', 'polling.mjs', 'follow.mjs']) assert.equal((await fetch(server.url + module)).status, 200);
  const metadata = await (await fetch(server.url + 'metadata')).json();
  const manifest = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'));
  assert.equal(metadata.version, manifest.version);
  assert.equal(metadata.releases[0].version, manifest.version);
  assert.deepEqual(metadata.releases, JSON.parse(await readFile(new URL('../release-notes.json', import.meta.url), 'utf8')));
  const logo = await fetch(server.url + 'trace.svg');
  assert.equal(logo.headers.get('content-type'), 'image/svg+xml');
  assert.equal(await logo.text(), await readFile(new URL('../assets/trace.svg', import.meta.url), 'utf8'));
  assert.match(page.headers.get('content-security-policy'), /img-src 'self'/);
  assert.equal((await fetch(server.url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 200, 'Host embedding must be able to load the static panel.');
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
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

test('snapshot endpoint requires capability, Host and same Origin, validates revisions and releases subscription', async () => {
  let listener;
  let active = 0;
  const server = await startServer({
    on(fn) { active++; listener = fn; return () => { active--; }; },
    async getEvents() { return []; },
  });
  try {
    const response = await fetch(server.url + 'events');
    assert.equal(response.status, 200);
    const initial = await response.json();
    assert.equal(initial.history, 'ready');
    assert.equal((await fetch(server.url + 'events', { headers: { 'If-None-Match': response.headers.get('etag') } })).status, 304);
    listener({ id: 'live', type: 'user.message', data: { content: '<script>alert(1)</script> 😀' } });
    const next = await fetch(server.url + 'events', { headers: { 'If-None-Match': response.headers.get('etag') } });
    assert.equal(next.status, 200);
    assert.equal((await next.json()).entries[0].id, 'live');
    assert.equal((await fetch(server.url + 'events', { headers: { Origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await fetch(server.url + 'events', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    assert.equal((await fetch(new URL('/events', server.url))).status, 404);
    assert.equal((await fetch(server.url + 'events', { method: 'POST' })).status, 405);
    const head = await fetch(server.url + 'events', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally { await server.close(); }
  assert.equal(active, 0);
});

test('support diagnostics omit chat evidence and raw failures and require the event endpoint boundaries', async t => {
  let listener;
  const server = await startServer({
    on(fn) { listener = fn; return () => {}; },
    async getEvents() { throw new Error('private error C:/private/path token-secret'); },
  });
  t.after(() => server.close());
  listener({ id: 'private-event-id', type: 'user.message', data: { content: 'private chat token-secret' } });
  const response = await fetch(server.url + 'diagnostics');
  const body = await response.text();
  const snapshot = JSON.parse(body);
  assert.equal(snapshot.history, 'unavailable');
  assert.equal(snapshot.retained, 1);
  assert.ok(snapshot.diagnostics.entries.some(entry => entry.code === 'history_failed'));
  assert.doesNotMatch(body, /private|token-secret|evidence|toolCallId|sessionId/);
  assert.equal((await fetch(server.url + 'diagnostics', { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(server.url + 'diagnostics', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(new URL('/diagnostics', server.url))).status, 404);
  assert.equal((await fetch(server.url + 'diagnostics', { method: 'POST' })).status, 405);
  const head = await fetch(server.url + 'diagnostics', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
  const status = await new Promise((resolve, reject) => {
    request(server.url + 'diagnostics', { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).end();
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
  assert.equal(shell.canvas.displayName, 'Trace');
  const [first, repeated] = await Promise.all([shell.canvas.open(context('one')), shell.canvas.open(context('one'))]);
  assert.equal(first.title, 'Trace');
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
