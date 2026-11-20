import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from 'node:http';
import { startServer } from '../com.github.copilot/extensions/trace/server.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';
const { createInstructionSources } = await import('../com.github.copilot/extensions/trace/instructions.mjs').catch(() => ({}));
const { instructionSources, fetchInstructionSources } = await import('../com.github.copilot/extensions/trace/web/instructions.mjs').catch(() => ({}));
const source = (id = 'global', extra = {}) => ({ id, label: id, sourcePath: `instructions/${id}.md`, type: 'vscode', location: 'repository', content: 'Exact café 🧪 <script>literal</script>\r\n', ...extra });
const host = sources => ({ sessionId: 'main', rpc: { instructions: { getSources: async () => ({ sources }) } } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function observed(data) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => data.map((item, i) => ({ id: `s${i}`, type: 'skill.invoked', timestamp: `2026-11-20T12:00:0${i}Z`, ...item })) });
  await trace.ready; const snapshot = trace.snapshot(); trace.close(); return snapshot;
}

test('instruction reader returns bounded current reported sources without inventing scope or enablement', async () => {
  assert.equal(typeof createInstructionSources, 'function');
  const snapshot = await createInstructionSources(host([source(), source('scoped', { applyTo: ['src/**/*.js'], defaultDisabled: true }), source('index', { type: 'nested-agents', sourcePath: 'nested AGENTS.md' }), source('unknown', { type: 'future', location: 'future', content: undefined })])).read();
  assert.equal(snapshot.scope, 'main-session'); assert.ok(Number.isFinite(Date.parse(snapshot.capturedAt)));
  const [global, scoped, index, unknown] = snapshot.sources.items;
  assert.equal(global.content, source().content); assert.equal(global.applyTo, null); assert.equal(global.defaultDisabled, null);
  assert.deepEqual(scoped.applyTo, ['src/**/*.js']); assert.equal(scoped.defaultDisabled, true);
  assert.equal(index.sourcePath, 'nested AGENTS.md'); assert.equal(unknown.type, null); assert.equal(unknown.location, null);
  assert.equal(unknown.contentStatus, 'missing'); assert.equal(unknown.content, null);
});

test('source projection rejects malformed identities, marks duplicates and bounds Unicode plus aggregate bytes', async () => {
  assert.equal(typeof createInstructionSources, 'function');
  const rows = [source('same'), source('same'), source('x'.repeat(257)), source('empty', { content: '' }), source('scope', { applyTo: ['ok', 42] }), ...Array.from({ length: 200 }, (_, i) => source(`large${i}`, { content: '🧪'.repeat(20000) }))];
  rows[0].private = { secret: 'never expose' }; rows[0].description = 'never expose';
  const snapshot = await createInstructionSources(host(rows)).read();
  assert.ok(snapshot.sources.items.filter(item => item.id === 'same').every(item => !item.identityValid));
  assert.ok(!snapshot.sources.items.some(item => item.id.length > 256));
  assert.equal(snapshot.sources.items.find(item => item.id === 'empty').contentStatus, 'empty');
  assert.equal(snapshot.sources.items.find(item => item.id === 'scope').applyTo, null);
  assert.ok(snapshot.sources.invalid >= 4); assert.ok(snapshot.sources.omitted > 0); assert.ok(snapshot.sources.clipped > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < 512 * 1024);
  assert.doesNotMatch(JSON.stringify(snapshot), /never expose/);
  for (const item of snapshot.sources.items.filter(item => item.id.startsWith('large'))) {
    assert.equal(item.contentStatus, 'clipped'); assert.ok(item.content.length <= 12000); assert.equal(item.content.length % 2, 0);
  }
});

test('source projection preserves a surrogate pair at the clipping boundary and marks duplicates outside the retained budget ambiguous', async () => {
  const snapshot = await createInstructionSources(host([source('clip', { content: 'x'.repeat(11999) + '🧪end' })])).read();
  assert.equal(snapshot.sources.items[0].content, 'x'.repeat(11999)); assert.equal(snapshot.sources.clipped, 1);
  const partial = await createInstructionSources(host([...Array.from({ length: 100 }, (_, i) => source(`s${i}`)), source('s0')])).read();
  assert.equal(partial.sources.omitted, 1); assert.equal(partial.sources.items[0].identityValid, false);
  const invalidDuplicates = await createInstructionSources(host([source('same', { label: [] }), source('same', { label: [] })])).read();
  assert.equal(invalidDuplicates.sources.invalid, 2, 'Invalid counts describe affected source rows, not multiple flags on one row.');
});

test('instruction reads coalesce and retain their timeout slot until the actual host request settles', async () => {
  assert.equal(typeof createInstructionSources, 'function');
  let calls = 0; const pending = deferred(), session = host([]);
  session.rpc.instructions.getSources = () => { calls++; return pending.promise; };
  const reader = createInstructionSources(session, { timeoutMs: 10 }), first = reader.read();
  assert.equal(first, reader.read()); assert.equal((await first).sources.status, 'timeout');
  assert.equal((await reader.read()).sources.status, 'timeout'); assert.equal(calls, 1);
  pending.resolve({ sources: [source()] }); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await reader.read()).sources.status, 'ready'); assert.equal(calls, 2); reader.close();
});

test('unsupported, malformed, unavailable, closed and mismatched instruction results stay separate', async () => {
  assert.equal(typeof createInstructionSources, 'function');
  assert.equal((await createInstructionSources({ sessionId: 'main' }).read()).sources.status, 'unsupported');
  assert.equal((await createInstructionSources(host(null)).read()).sources.status, 'malformed');
  const session = host([]);
  session.rpc.instructions.getSources = async () => { throw new Error('private raw failure'); };
  assert.equal((await createInstructionSources(session).read()).sources.status, 'unavailable');
  session.rpc.instructions.getSources = async () => { throw Object.assign(new Error(), { code: -32601 }); };
  assert.equal((await createInstructionSources(session).read()).sources.status, 'unsupported');
  session.rpc.instructions.getSources = async () => ({ sessionId: 'foreign', sources: [source()] });
  assert.equal((await createInstructionSources(session).read()).sources.status, 'session-mismatch');
  for (const close of [false, true]) {
    const pending = deferred(); session.rpc.instructions.getSources = () => pending.promise;
    const reader = createInstructionSources(session), read = reader.read(); await Promise.resolve();
    if (close) reader.close(); else session.sessionId = 'changed';
    pending.resolve({ sources: [source('private late body')] });
    const result = await read;
    assert.equal(result.sources.status, close ? 'closed' : 'session-mismatch'); assert.equal(result.sources.items.length, 0); reader.close();
  }
});

test('current source records remain separate from repeated exact historical skill loads and conflicting bodies', async () => {
  assert.equal(typeof instructionSources, 'function');
  const snapshot = await observed([
    { data: { name: 'same', path: 'same', source: 'sdk', content: 'Old loaded rule' } },
    { data: { name: 'same', path: 'same', source: 'sdk', content: 'Conflicting loaded rule' } },
    { agentId: 'child', data: { name: 'same', path: 'same', source: 'sdk', content: 'Child rule' } },
    { data: { name: 'same', path: 'same', content: '' } },
    { data: { name: 'same', path: 'same' } },
  ]);
  const inventory = await createInstructionSources(host([source('same', { sourcePath: 'same', content: 'Current changed rule' })])).read();
  const result = instructionSources(inventory, snapshot);
  assert.equal(result.current[0].content, 'Current changed rule'); assert.match(result.current[0].scopeNote, /unknown/);
  assert.equal(result.loads.length, 4); assert.equal(result.loads[0].occurrences.length, 2);
  assert.equal(result.loads[0].occurrences[0].content, 'Old loaded rule');
  assert.equal(result.loads[0].occurrences[1].content, 'Conflicting loaded rule');
  assert.equal(result.loads[1].agentId, 'child');
  assert.equal(instructionSources(null, snapshot).loads[0].occurrences.length, 2);
  assert.match(result.note, /not.*complete prompt|complete prompt.*unknown/); assert.match(result.note, /compliance/i);
  assert.equal(instructionSources({ ...inventory, scope: 'other' }, snapshot).current.length, 0);
});

test('client source schema rejects unknown enums, invalid capture times and contradictory identity flags', async () => {
  const inventory = await createInstructionSources(host([source()])).read();
  for (const changed of [
    { ...inventory, capturedAt: 123 },
    { ...inventory, sources: { ...inventory.sources, items: [{ ...inventory.sources.items[0], type: 'unrecognized' }] } },
    { ...inventory, sources: { ...inventory.sources, items: [{ ...inventory.sources.items[0], location: 'unrecognized' }] } },
    { ...inventory, sources: { ...inventory.sources, items: [...inventory.sources.items, ...inventory.sources.items] } },
    { ...inventory, sources: { ...inventory.sources, omitted: 1 } },
  ]) assert.equal(instructionSources(changed).current.length, 0);
});

test('invalid recorded source fields and duplicate event identities stay separate rather than manufacturing a group', async () => {
  const snapshot = await observed([{ data: { name: 'same', path: [], source: {}, content: 'Body' } }]);
  const result = instructionSources(null, { ...snapshot, entries: [...snapshot.entries, ...snapshot.entries] });
  assert.equal(result.loads.length, 2);
  assert.ok(result.loads.every(group => group.source === null && group.path === null && !group.identityValid));
});

test('source fetch bounds streamed bytes and preserves Unicode split between chunks', async t => {
  assert.equal(typeof fetchInstructionSources, 'function');
  const encoded = new TextEncoder().encode(JSON.stringify({ body: '🧪日本語' }));
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(encoded.slice(0, 11)); controller.enqueue(encoded.slice(11)); controller.close(); } })));
  assert.deepEqual(await fetchInstructionSources(), { body: '🧪日本語' });
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel() { cancelled = true; } }));
  await assert.rejects(fetchInstructionSources(), /too large/); assert.equal(cancelled, true);
});

test('instruction endpoint protects current source bodies and HEAD, polling and diagnostics do not read them', async t => {
  let calls = 0; const session = { ...host([]), on() { return () => {}; }, getEvents: async () => [] };
  session.rpc.instructions.getSources = async () => { calls++; return { sources: [source('fixture-private-body')] }; };
  const server = await startServer(session); t.after(() => server.close()); const url = server.url + 'instruction-sources';
  assert.equal((await fetch(url, { method: 'HEAD' })).status, 200);
  await fetch(server.url + 'events'); await fetch(server.url + 'capabilities'); await fetch(server.url + 'diagnostics');
  assert.equal(calls, 0);
  for (const headers of [{ Origin: 'https://attacker.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.equal((await fetch(url, { headers })).status, 403);
  assert.equal((await fetch(new URL('/instruction-sources', url))).status, 404);
  assert.equal((await fetch(url + '?sessionId=other')).status, 404);
  assert.equal((await fetch(url, { method: 'POST' })).status, 405);
  const badHost = await new Promise((resolve, reject) => request(url, { headers: { Host: 'attacker.invalid' } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).end());
  assert.equal(badHost, 403); assert.equal(calls, 0);
  const response = await fetch(url, { headers: { Origin: new URL(url).origin } });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal((await response.json()).sources.items[0].id, 'fixture-private-body'); assert.equal(calls, 1);
  assert.doesNotMatch(await (await fetch(server.url + 'diagnostics')).text(), /fixture-private-body|literal|sourcePath/);
});
