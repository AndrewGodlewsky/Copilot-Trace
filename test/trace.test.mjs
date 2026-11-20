import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const event = (id, type, data = {}, extra = {}) => ({ id, type, data, timestamp: '2026-11-19T12:00:00.000Z', parentId: null, ...extra });

test('request delivery and interaction identity are validated without changing their evidence', async t => {
  const values = ['idle', 'steering', 'queued', '', 'future', '__proto__', null, 7];
  const history = values.map((delivery, i) => event(String(i), 'user.message', { delivery,
    interactionId: i < 3 ? '日本語😀' : i === 3 ? 'x'.repeat(256) : i === 4 ? 'x'.repeat(257) : null }));
  history.push(event('turn', 'assistant.turn_start', { interactionId: 'exact interaction', turnId: '0' }));
  const fixture = host(Promise.resolve(history));
  const trace = createTrace(fixture.session);
  t.after(() => trace.close());
  await trace.ready;
  const entries = trace.snapshot().entries;
  assert.deepEqual(entries.slice(0, values.length).map(entry => entry.delivery), ['idle', 'steering', 'queued', '', '', '', '', '']);
  assert.deepEqual(entries.slice(0, values.length).map(entry => entry.interactionId), ['日本語😀', '日本語😀', '日本語😀', 'x'.repeat(256), '', '', '', '']);
  assert.equal(entries.at(-1).interactionId, 'exact interaction');
  assert.equal(entries.at(-1).turnId, '0');
  assert.equal(JSON.parse(entries[4].evidence).data.interactionId, 'x'.repeat(257));
});
function host(history = Promise.resolve([])) {
  let listener;
  let subscriptions = 0;
  return {
    session: {
      on(fn) { listener = fn; subscriptions++; return () => { subscriptions--; listener = undefined; }; },
      getEvents() { assert.equal(subscriptions, 1); return history; },
    },
    emit(value) { listener?.(value); },
    get subscriptions() { return subscriptions; },
  };
}

test('protected evidence omissions are explicit without exposing suppressed argument values', async t => {
  const fixture = host(Promise.resolve([
    event('history-protected', 'tool.execution_start', { toolCallId: 'history', toolName: 'mcp.query',
      arguments: { encryptedContent: 'hidden-history', keep: 'literal encryptedContent' } }),
    event('ordinary', 'tool.execution_start', { toolCallId: 'ordinary', toolName: 'view', arguments: { path: 'fixture.txt' } }),
  ]));
  const trace = createTrace(fixture.session);
  t.after(() => trace.close());
  await trace.ready;
  fixture.emit(event('live-protected', 'tool.execution_start', { toolCallId: 'live', toolName: 'mcp.query',
    arguments: { items: [{ reasoningOpaque: 'hidden-live', keep: null }], encryptedContent: null } }));
  fixture.emit(event('undefined', 'assistant.message', { content: 'visible', encryptedContent: undefined }));
  fixture.emit(event('clipped-protected', 'assistant.message', { content: 'x'.repeat(13000), reasoningOpaque: 'hidden-clipped' }));
  const [historical, ordinary, live, absent, clipped] = trace.snapshot().entries;
  assert.equal(historical.protectedContentOmitted, true);
  assert.equal(ordinary.protectedContentOmitted, false);
  assert.equal(live.protectedContentOmitted, true);
  assert.equal(absent.protectedContentOmitted, false);
  assert.equal(clipped.protectedContentOmitted, true);
  assert.equal(clipped.truncated, true);
  assert.deepEqual(JSON.parse(historical.evidence).data.arguments, { keep: 'literal encryptedContent' });
  assert.deepEqual(JSON.parse(live.evidence).data.arguments, { items: [{ keep: null }] });
  assert.doesNotMatch(JSON.stringify(trace.snapshot()), /hidden-history|hidden-live|hidden-clipped/);
});

test('correlation IDs remain exact and oversized IDs cannot create false matches', async () => {
  const fixture = host(Promise.resolve([
    event('turn', 'assistant.turn_start', { turnId: '0' }),
    event('hook', 'hook.start', { hookInvocationId: '日本語😀' }),
    event('bad', 'tool.execution_start', { toolCallId: 'x'.repeat(257), turnId: 'x'.repeat(257), hookInvocationId: 'x'.repeat(257) }, { agentId: 'x'.repeat(257) }),
  ]));
  const trace = createTrace(fixture.session);
  await trace.ready;
  const [turn, hook, bad] = trace.snapshot().entries;
  assert.equal(turn.turnId, '0');
  assert.equal(turn.agentId, '');
  assert.equal(hook.hookInvocationId, '日本語😀');
  assert.equal(bad.agentId, null);
  assert.equal(bad.turnId, '');
  assert.equal(bad.hookInvocationId, '');
  assert.equal(bad.toolCallId, '');
  trace.close();
});

test('tool results from invalid sources never inherit another source tool name', async () => {
  const fixture = host(Promise.resolve([
    event('start', 'tool.execution_start', { toolCallId: 't', toolName: 'private-name' }, { agentId: 'a'.repeat(257) }),
    event('end', 'tool.execution_complete', { toolCallId: 't', success: true }, { agentId: 'b'.repeat(257) }),
  ]));
  const trace = createTrace(fixture.session);
  await trace.ready;
  assert.equal(trace.snapshot().entries[1].toolName, '');
  trace.close();
});

test('history and live overlap reconcile once in chronological order', async () => {
  let resolve;
  const fixture = host(new Promise(r => { resolve = r; }));
  const trace = createTrace(fixture.session);
  const earlier = event('one', 'user.message', { content: 'hello' });
  const overlap = event('two', 'assistant.turn_start', { turnId: '0' });
  fixture.emit(overlap);
  fixture.emit(event('three', 'skill.invoked', { name: 'research', trigger: 'agent-invoked' }));
  resolve([earlier, overlap]);
  await trace.ready;
  const snapshot = trace.snapshot();
  assert.equal(snapshot.history, 'ready');
  assert.deepEqual(snapshot.entries.map(e => e.id), ['one', 'two', 'three']);
  assert.match(snapshot.entries[2].explanation, /agent/i);
  assert.match(snapshot.entries[2].explanation, /does not record which instruction/i);
  const version = snapshot.revision;
  fixture.emit(overlap);
  assert.equal(trace.snapshot().revision, version);
  trace.close();
  assert.equal(fixture.subscriptions, 0);
});

test('history failure still permits live delivery; absent trigger is not invented', async () => {
  const fixture = host(Promise.reject(new Error('private host error')));
  const trace = createTrace(fixture.session);
  await trace.ready;
  fixture.emit(event('one', 'skill.invoked', { name: 'example' }));
  assert.equal(trace.snapshot().history, 'unavailable');
  assert.match(trace.snapshot().entries[0].explanation, /not recorded/i);
  assert.doesNotMatch(JSON.stringify(trace.snapshot()), /private host error/);
  trace.close();
});

test('a live overlap older than the retained history window cannot be reinserted at the end', async () => {
  let resolve;
  const fixture = host(new Promise(r => { resolve = r; }));
  const trace = createTrace(fixture.session);
  fixture.emit(event('0', 'user.message'));
  resolve(Array.from({ length: 310 }, (_, i) => event(String(i), 'user.message')));
  await trace.ready;
  assert.equal(trace.snapshot().entries.at(-1).id, '309');
  assert.equal(trace.snapshot().entries[0].id, '10');
  trace.close();
});

test('ephemeral live activity stays between its persisted chronological neighbors', async () => {
  let resolve;
  const fixture = host(new Promise(r => { resolve = r; }));
  const trace = createTrace(fixture.session);
  const turn = event('turn', 'assistant.turn_start', {}, { timestamp: '2026-11-19T12:00:00Z' });
  const intent = event('intent', 'assistant.intent', { intent: 'Reading' }, { timestamp: '2026-11-19T12:00:01Z', ephemeral: true });
  const tool = event('tool', 'tool.execution_start', { toolCallId: 'read', toolName: 'read' }, { timestamp: '2026-11-19T12:00:02Z' });
  fixture.emit(intent);
  fixture.emit(tool);
  resolve([turn, tool]);
  await trace.ready;
  assert.deepEqual(trace.snapshot().entries.map(e => e.id), ['turn', 'intent', 'tool']);
  fixture.emit(event('unknown-time', 'session.info', {}, { timestamp: undefined }));
  fixture.emit(event('next', 'assistant.message', {}, { timestamp: '2026-11-19T12:00:03Z' }));
  assert.deepEqual(trace.snapshot().entries.map(e => e.id), ['turn', 'intent', 'tool', 'next', 'unknown-time']);
  trace.close();
});

test('unsupported session is visible and closing pending history cannot revive data', async () => {
  const unsupported = createTrace({});
  await unsupported.ready;
  assert.equal(unsupported.snapshot().history, 'unsupported');
  unsupported.close();
  let resolve;
  const fixture = host(new Promise(r => { resolve = r; }));
  const trace = createTrace(fixture.session);
  trace.close();
  resolve([event('late', 'user.message')]);
  await trace.ready;
  assert.equal(trace.snapshot().entries.length, 0);
  assert.equal(fixture.subscriptions, 0);
});

test('history timeout preserves live collection and ignores late history', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolve;
  const fixture = host(new Promise(r => { resolve = r; }));
  const trace = createTrace(fixture.session);
  await Promise.resolve();
  t.mock.timers.tick(10000);
  await trace.ready;
  assert.equal(trace.snapshot().history, 'unavailable');
  fixture.emit(event('live', 'user.message'));
  resolve([event('late', 'user.message')]);
  await Promise.resolve();
  assert.deepEqual(trace.snapshot().entries.map(e => e.id), ['live']);
  trace.close();
});

test('bounds retained records and evidence, ignores chunks and checkpoint copies', async () => {
  const fixture = host();
  const trace = createTrace(fixture.session);
  await trace.ready;
  fixture.emit(event('chunk', 'assistant.message_delta', { deltaContent: 'a' }));
  fixture.emit(event('checkpoint', 'user.message', {}, { checkpoint: true }));
  assert.equal(trace.snapshot().entries.length, 0);
  for (let i = 0; i < 305; i++) fixture.emit(event(String(i), 'user.message', { content: '😀'.repeat(20000) }));
  const snapshot = trace.snapshot();
  assert.equal(snapshot.entries.length, 300);
  assert.equal(snapshot.omitted, 5);
  assert.equal(snapshot.entries[0].id, '5');
  assert.ok(snapshot.entries.every(e => e.evidence.length <= 12000 && e.truncated));
  assert.ok(snapshot.entries.every(e => e.evidence.isWellFormed()));
  trace.close();
});

test('tool correlation is scoped by agent and missing starts remain explicit', async () => {
  const fixture = host();
  const trace = createTrace(fixture.session);
  await trace.ready;
  fixture.emit(event('root', 'tool.execution_start', { toolCallId: 'same', toolName: 'read' }));
  fixture.emit(event('child', 'tool.execution_start', { toolCallId: 'same', toolName: 'search' }, { agentId: 'child' }));
  fixture.emit(event('end-child', 'tool.execution_complete', { toolCallId: 'same', success: false }, { agentId: 'child' }));
  fixture.emit(event('end-root', 'tool.execution_complete', { toolCallId: 'same', success: true }));
  fixture.emit(event('missing', 'tool.execution_complete', { toolCallId: 'unknown', success: true }));
  const entries = trace.snapshot().entries;
  assert.match(entries[2].title, /search/);
  assert.match(entries[2].title, /failed/i);
  assert.match(entries[3].title, /read/);
  assert.match(entries[4].title, /name unavailable/i);
  assert.doesNotMatch(entries[0].explanation, /model chose|model decided/i);
  trace.close();
});

test('evidence preserves literal Unicode, IDs and inputs; all skill triggers stay distinct', async () => {
  const fixture = host();
  const trace = createTrace(fixture.session);
  await trace.ready;
  for (const trigger of ['user-invoked', 'agent-invoked', 'context-load', 'future-trigger']) {
    fixture.emit(event(trigger, 'skill.invoked', { trigger, name: '<img src=x>', content: '日本語 😀' }));
  }
  const entries = trace.snapshot().entries;
  assert.match(entries[0].explanation, /user/i);
  assert.match(entries[1].explanation, /agent/i);
  assert.match(entries[2].explanation, /loaded.*context/i);
  assert.match(entries[3].explanation, /unrecognized/i);
  assert.match(entries[0].evidence, /日本語 😀/);
  assert.equal(JSON.parse(entries[0].evidence).id, 'user-invoked');
  trace.close();
});

test('display fields remain bounded and available even when raw evidence is shortened', async () => {
  const fixture = host();
  const trace = createTrace(fixture.session);
  await trace.ready;
  fixture.emit(event('message', 'assistant.message', { model: 'recorded-model', content: '😀'.repeat(20000) }));
  fixture.emit(event('skill', 'skill.invoked', { name: 'research', trigger: 'agent-invoked', content: 'private skill instructions' }));
  const [message, skill] = trace.snapshot().entries;
  assert.equal(message.model, 'recorded-model');
  assert.ok(message.preview.length <= 180 && message.preview.isWellFormed());
  assert.equal(message.truncated, true);
  assert.equal(skill.displayName, 'research');
  assert.equal(skill.trigger, 'agent-invoked');
  assert.equal(skill.preview, '');
  trace.close();
});
