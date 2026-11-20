import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const timestamp = '2026-11-20T12:00:00Z';
const event = (id, type, data, agentId = '', extra = {}) => ({ id, type, data, timestamp,
  ...(agentId ? { agentId } : {}), ...extra });
const start = (id = 'start', call = 'call', source = '') => event(id, 'tool.execution_start', { toolCallId: call, toolName: 'same-name' }, source);
const result = (id = 'result', call = 'call', source = '') => event(id, 'tool.execution_complete', { toolCallId: call, success: true }, source);
const request = (id = 'request', requestId = 'permission', call = 'call', source = '') => event(id, 'permission.requested',
  { requestId, permissionRequest: { kind: 'shell', ...(call === undefined ? {} : { toolCallId: call }) } }, source);
const decision = (id = 'decision', requestId = 'permission', source = '', kind = 'approved') => event(id, 'permission.completed',
  { requestId, result: { kind } }, source);
const child = (id, source, call, type = 'subagent.started', extra = {}) => event(id, type,
  { toolCallId: call, agentName: 'fixture', agentDisplayName: 'Same name', ...extra }, source);
async function projected(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function activity(entries, options = {}) {
  assert.equal(typeof presentation.observedActivity, 'function', 'Retained activity has a deterministic evidence contract.');
  return presentation.observedActivity(entries, { now: Date.parse(timestamp) + 10000, ...options });
}

test('overlapping exact sources retain separate permission, invocation and delegated boundaries', async () => {
  const entries = await projected([start(), request(), start('other', 'call', 'child'),
    child('a', 'agent-a', 'a-call'), child('b', 'agent-b', 'b-call')]);
  const before = structuredClone(entries), observed = activity(entries);
  assert.deepEqual(observed.items.map(item => [item.kind, item.source, item.entry.id]), [
    ['tool', '', 'start'], ['permission', '', 'request'], ['tool', 'child', 'other'],
    ['delegation', 'agent-a', 'a'], ['delegation', 'agent-b', 'b'],
  ]);
  assert.match(observed.items[0].label, /completion not observed/i);
  assert.match(observed.items[1].label, /decision not observed/i);
  assert.match(observed.items[3].label, /outcome not observed/i);
  assert.ok(observed.items.every(item => item.links.includes(item.entry)));
  assert.match(observed.notes.join(' '), /not.*currently.*running|not.*currently.*waiting/i);
  assert.deepEqual(entries, before);
});

test('decisions settle only their exact request and source, including request-only records and delayed decisions', async () => {
  const raw = [request('a', 'shared'), request('b', 'shared', 'call', 'child'), request('c', 'other')];
  assert.deepEqual(activity(await projected(raw)).items.map(item => item.entry.id), ['a', 'b', 'c']);
  raw.push(decision('end-b', 'shared', 'child', 'cancelled'));
  assert.deepEqual(activity(await projected(raw)).items.map(item => item.entry.id), ['a', 'c']);
  raw.unshift(decision('end-a', 'shared', '', 'denied-by-rules'));
  assert.deepEqual(activity(await projected(raw)).items.map(item => item.entry.id), ['c']);
  const standalone = request(); delete standalone.data.permissionRequest.toolCallId;
  assert.equal(activity(await projected([standalone])).items[0].kind, 'permission');
  assert.equal(activity(await projected([standalone, decision()])).items.length, 0);
});

test('tool results and delegated failure, cancellation or completion remove only their observed missing outcomes', async () => {
  const raw = [start(), start('other', 'call', 'child'), result()];
  assert.deepEqual(activity(await projected(raw)).items.map(item => item.entry.id), ['other']);
  for (const [type, extra] of [['subagent.completed', {}], ['subagent.completed', { cancelled: true }], ['subagent.failed', { error: 'fixture' }]]) {
    const observed = activity(await projected([child('a', 'a', 'a-call'), child('b', 'b', 'b-call'), child('a-end', 'a', 'a-call', type, extra)]));
    assert.deepEqual(observed.items.map(item => item.entry.id), ['b']);
  }
});

test('denial and same-source interruption add context without settling uncorrelated calls', async () => {
  const entries = await projected([start(), request(), decision('denied', 'permission', '', 'denied-by-rules'),
    start('other', 'call', 'child'), event('abort', 'abort', { reason: 'user' }), event('unrelated', 'abort', { reason: 'user' }, 'different')]);
  const observed = activity(entries);
  assert.deepEqual(observed.items.map(item => item.entry.id), ['start', 'other']);
  assert.match(observed.items[0].detail, /denied.*interruption.*outcome.*unknown/i);
  assert.deepEqual(observed.items[0].links.map(entry => entry.id), ['start', 'denied', 'abort']);
  assert.doesNotMatch(observed.items[1].detail, /interruption|denied/);
});

test('unsupported ownership, unknown IDs, duplicate records and conflicting boundaries remain inspectable unknowns', async () => {
  const cases = [
    [request('request'), request('duplicate')], [request(), decision(), decision('duplicate')],
    [start(), start('duplicate')], [child('a', 'a', 'call'), child('b', 'a', 'other')],
    [event('request', 'permission.requested', { requestId: 'permission', ownerSessionId: 'unsupported', permissionRequest: { toolCallId: 'call' } })],
    [event('request', 'permission.requested', { requestId: 'permission', ownerAgentId: 'child', permissionRequest: { toolCallId: 'call' } })],
    [request('request', ' ')], [request('request', 'permission', ' ')],
    [start('start', '')], [event('start', 'tool.execution_start', { toolCallId: 'call' }, '', { agentId: null })],
  ];
  for (const raw of cases) {
    const observed = activity(await projected(raw));
    assert.ok(observed.items.length > 0);
    assert.ok(observed.items.every(item => item.kind === 'unknown'), JSON.stringify(raw));
    assert.match(observed.items[0].detail, /unknown|ambiguous|unavailable/i);
  }
  const entries = await projected([start()]);
  for (const malformed of [[...entries, entries[0]], [{ ...entries[0], truncated: true }], [{ ...entries[0], evidence: '{}' }]]) {
    assert.ok(activity(malformed).items.every(item => item.kind === 'unknown'));
  }
});

test('retained start-only history is never current execution and eviction does not infer success', async () => {
  const entries = await projected([start()]);
  const partial = activity(entries, { history: 'unavailable', omitted: 20 });
  assert.equal(partial.items[0].kind, 'tool');
  assert.match(partial.notes.join(' '), /history.*incomplete|history.*unavailable/i);
  assert.match(partial.notes.join(' '), /older events.*omitted/i);
  const evicted = activity([], { omitted: 21 });
  assert.equal(evicted.items.length, 0);
  assert.match(evicted.notes.join(' '), /absence.*not.*inactiv|does not establish inactivity/i);
});

test('last recorded event age follows validated host time and never supplies activity diagnoses', async () => {
  const entries = await projected([start()]);
  assert.equal(activity(entries).lastEvent.elapsedSeconds, 10);
  assert.equal(activity(entries).lastEvent.timestamp, timestamp);
  assert.equal(activity(entries, { now: Date.parse(timestamp) + 1000000 }).items[0].label, activity(entries).items[0].label);
  for (const value of ['', 'invalid', '2026-02-30T12:00:00Z', '2027-01-01T12:00:00Z']) {
    const observed = activity([{ ...entries[0], timestamp: value }]);
    assert.equal(observed.lastEvent.elapsedSeconds, null, value);
    assert.equal(observed.lastEvent.timestamp, null, value);
  }
  assert.equal(activity([]).lastEvent, null);
});
