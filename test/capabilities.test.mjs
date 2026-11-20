import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { startServer } from '../com.github.copilot/extensions/trace/server.mjs';
import { createCapabilities } from '../com.github.copilot/extensions/trace/capabilities.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

import { compareCapabilities, fetchCapabilities } from '../com.github.copilot/extensions/trace/web/capabilities.mjs';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const host = (tools, skills = []) => ({ sessionId: 'main', rpc: {
  tools: { getCurrentMetadata: async () => ({ tools }) }, skills: { list: async () => ({ skills }) },
} });
const tool = (name, server) => ({ name, ...(server ? { mcpServerName: server, mcpToolName: 'echo' } : {}) });
const skill = (name, extra = {}) => ({ name, source: 'sdk', enabled: true, userInvocable: true, ...extra });
const event = (id, type, data, agentId) => ({ id, type, timestamp: '2026-11-20T12:00:00Z', data, ...(agentId === undefined ? {} : { agentId }) });
const use = (id, name, server, agentId) => event(id, 'tool.execution_start', { toolCallId: id, toolName: name,
  ...(server ? { mcpConfigServerName: server, mcpServerName: server, mcpToolName: 'echo' } : {}) }, agentId);
async function observed(events) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => events });
  await trace.ready; const snapshot = trace.snapshot(); trace.close(); return snapshot;
}

test('inventory comparison distinguishes current tools, earlier use, exact providers and child scope', async () => {
  assert.equal(typeof compareCapabilities, 'function');
  const inventory = await createCapabilities(host([tool('first-echo', 'first'), tool('second-echo', 'second'), tool('new')])).read();
  const history = await observed([use('a', 'first-echo', 'first'), use('b', 'old'), use('child', 'second-echo', 'second', 'child')]);
  const result = compareCapabilities(inventory, history);
  const find = (name, source = '') => result.rows.find(row => row.name === name && row.source === source);
  assert.equal(find('first-echo').current, 'available'); assert.equal(find('first-echo').observed, true);
  assert.equal(find('second-echo').observed, false); assert.equal(find('second-echo').mcpServerName, 'second');
  assert.equal(find('second-echo', 'child').current, 'unknown'); assert.equal(find('second-echo', 'child').observed, true);
  assert.equal(find('old').current, 'missing'); assert.match(find('old').status, /not in current snapshot/i);
  assert.equal(find('new').observed, false); assert.match(find('new').status, /not observed here/i);
  const changed = await createCapabilities(host([tool('old')])).read();
  assert.equal(compareCapabilities(changed, history).rows.find(row => row.name === 'old').current, 'available');
  assert.match(result.note, /not.*historical|historical.*unknown/i);
});

test('skill catalog flags never imply model access and provenance conflicts remain unknown', async () => {
  assert.equal(typeof compareCapabilities, 'function');
  const inventory = await createCapabilities(host([tool('echo', 'first')], [skill('auto'), skill('manual'), skill('disabled', { enabled: false })])).read();
  const history = await observed([event('s', 'skill.invoked', { name: 'auto', path: '', source: 'sdk', content: 'body' }), use('wrong-provider', 'echo', 'second')]);
  const result = compareCapabilities(inventory, history);
  assert.equal(result.rows.find(row => row.name === 'auto').observed, true);
  assert.equal(result.rows.find(row => row.name === 'manual').observed, false);
  assert.ok(result.rows.filter(row => row.kind === 'skill').every(row => row.current === 'listed' && row.modelInvocable === 'unknown'));
  assert.ok(result.rows.filter(row => row.name === 'echo').every(row => row.current === 'unknown'));
});

test('partial, malformed, duplicate or clipped identities never establish absence or a matched invocation', async () => {
  assert.equal(typeof compareCapabilities, 'function');
  const inventory = await createCapabilities(host([tool('same'), tool('same'), { name: 'bad', mcpServerName: 3 }])).read();
  const history = await observed([use('same', 'same'), use('absent', 'absent'), use('clip', 'clip')]);
  history.entries[2].truncated = true; history.history = 'unavailable'; history.omitted = 7;
  const result = compareCapabilities(inventory, history);
  assert.ok(result.rows.every(row => row.current === 'unknown'));
  assert.match(result.window, /3 retained.*7.*omitted/i); assert.match(result.window, /incomplete/i);
  const unsupported = compareCapabilities(null, history);
  assert.ok(unsupported.rows.every(row => row.current === 'unknown'));
});

test('collector limits strings and rows without copying raw metadata or truncating identities', async () => {
  const catalog = [tool('🧪 <literal>'), { name: 'a'.repeat(257) }, ...Array.from({ length: 250 }, (_, i) => tool(`tool${i}`))];
  catalog[0].description = 'secret'.repeat(100000); catalog[0].input_schema = catalog;
  const snapshot = await createCapabilities(host(catalog)).read();
  assert.equal(snapshot.tools.items[0].name, '🧪 <literal>');
  assert.equal(snapshot.tools.items.length, 199); assert.equal(snapshot.tools.omitted, 52); assert.equal(snapshot.tools.invalid, 1);
  assert.ok(JSON.stringify(snapshot).length < 100000); assert.doesNotMatch(JSON.stringify(snapshot), /secret/);
});

test('collector coalesces pending refresh and keeps timed-out operations bounded until settled', async () => {
  const pending = deferred(); let calls = 0;
  const session = host([]); session.rpc.tools.getCurrentMetadata = () => { calls++; return pending.promise; };
  const collector = createCapabilities(session, { timeoutMs: 10 });
  const a = collector.read(), b = collector.read(); assert.equal(a, b);
  assert.equal((await a).tools.status, 'timeout'); assert.equal((await b).skills.status, 'ready');
  assert.equal((await collector.read()).tools.status, 'timeout'); assert.equal(calls, 1);
  pending.resolve({ tools: [tool('late')] }); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await collector.read()).tools.items[0].name, 'late'); assert.equal(calls, 2); collector.close();
});

test('unsupported, malformed, refused and mismatched inventory remains unavailable and close discards late replies', async () => {
  assert.equal((await createCapabilities({ sessionId: 'main' }).read()).tools.status, 'unsupported');
  assert.equal((await createCapabilities(host(null)).read()).tools.status, 'uninitialized');
  const session = host([]); session.rpc.tools.getCurrentMetadata = async () => { throw new Error('Denied private credentials'); };
  assert.equal((await createCapabilities(session).read()).tools.status, 'unavailable');
  session.rpc.tools.getCurrentMetadata = async () => ({ sessionId: 'foreign', tools: [tool('wrong')] });
  assert.equal((await createCapabilities(session).read()).tools.status, 'session-mismatch');
  session.rpc.tools.getCurrentMetadata = async () => ({ tools: {} });
  assert.equal((await createCapabilities(session).read()).tools.status, 'malformed');
  const pending = deferred(); session.rpc.tools.getCurrentMetadata = () => pending.promise;
  const collector = createCapabilities(session); const read = collector.read(); await Promise.resolve(); collector.close();
  assert.equal((await read).tools.status, 'closed'); pending.resolve({ tools: [tool('late')] });
  assert.equal((await collector.read()).tools.status, 'closed');
  const changed = createCapabilities(session); session.sessionId = 'other';
  assert.equal((await changed.read()).tools.status, 'session-mismatch');
});

test('in-flight ownership changes discard both catalogs and do not expose another session', async () => {
  const pending = deferred(), session = host([]);
  session.rpc.tools.getCurrentMetadata = () => pending.promise;
  const collector = createCapabilities(session), result = collector.read();
  await Promise.resolve(); session.sessionId = 'changed'; pending.resolve({ tools: [tool('wrong-session')] });
  const snapshot = await result;
  assert.equal(snapshot.tools.status, 'session-mismatch'); assert.equal(snapshot.skills.status, 'session-mismatch');
  assert.doesNotMatch(JSON.stringify(snapshot), /wrong-session|changed/); collector.close();
});

test('client bounds streamed response bytes and decodes literal Unicode across chunks', async t => {
  const encoded = new TextEncoder().encode(JSON.stringify({ name: '日本語 🧪' }));
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoded.slice(0, 12)); controller.enqueue(encoded.slice(12)); controller.close();
  } })));
  assert.deepEqual(await fetchCapabilities(), { name: '日本語 🧪' });
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
  }, cancel() { cancelled = true; } }));
  await assert.rejects(fetchCapabilities(), /too large/); assert.equal(cancelled, true);
});

test('inventory refresh is protected, read-only, bounded and separate from timeline polling', async t => {
  let reads = 0;
  const session = { sessionId: 'attached', on() { return () => {}; }, getEvents: async () => [], rpc: {
    tools: { getCurrentMetadata: async () => { reads++; return { tools: [{ name: 'first-echo', mcpServerName: 'first', mcpToolName: 'echo', input_schema: { secret: 'private' } }] }; } },
    skills: { list: async () => { reads++; return { skills: [{ name: '日本語 🧪', source: 'sdk', enabled: true, userInvocable: true, path: 'private' }] }; } },
  } };
  const server = await startServer(session); t.after(() => server.close());
  const url = server.url + 'capabilities';
  assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
  await fetch(server.url + 'events'); await fetch(server.url + 'events');
  assert.equal(reads, 0);
  assert.equal((await fetch(url, { headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await fetch(url, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await fetch(new URL('/capabilities', url))).status, 404);
  assert.equal((await fetch(url + '?sessionId=foreign')).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const badHost = await new Promise((resolve, reject) => {
    request(url, { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).end();
  });
  assert.equal(badHost, 403); assert.equal(reads, 0);
  const body = await (await fetch(url)).text(), snapshot = JSON.parse(body);
  assert.equal(snapshot.scope, 'main-session'); assert.ok(Number.isFinite(Date.parse(snapshot.capturedAt)));
  assert.equal(snapshot.tools.status, 'ready'); assert.equal(snapshot.tools.items[0].name, 'first-echo');
  assert.equal(snapshot.skills.items[0].modelInvocable, 'unknown'); assert.equal(snapshot.skills.items[0].name, '日本語 🧪');
  assert.doesNotMatch(body, /private|input_schema|sessionId/); assert.equal(reads, 2);
  assert.doesNotMatch(await (await fetch(server.url + 'diagnostics')).text(), /first-echo|日本語|private/);
});
