import assert from 'node:assert/strict';
import { test } from 'node:test';
import { turnContext, describeTurn, summarize } from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const start = (id = 'start', extra = {}) => ({ id, type: 'assistant.turn_start', category: 'turn',
  turnId: '0', agentId: '', model: 'recorded-model', timestamp: '2026-11-20T12:00:00Z', ...extra });
const end = (id = 'end', extra = {}) => ({ ...start(id), type: 'assistant.turn_end', timestamp: '2026-11-20T12:00:02Z', ...extra });
function intent(id = 'intent', text = 'Inspect the recorded file', extra = {}) {
  const entry = { id, type: 'assistant.intent', category: 'model', agentId: '', timestamp: '2026-11-20T12:00:01Z', ...extra };
  entry.evidence = JSON.stringify({ id, type: entry.type, timestamp: entry.timestamp,
    ...(entry.agentId ? { agentId: entry.agentId } : {}), data: { intent: text } });
  return entry;
}
const heading = (entries, options, id = 'start') => describeTurn(entries.find(entry => entry.id === id), turnContext(entries, options).get(id));

test('turn headings use the first exact recorded intent and retain turn metadata and source evidence', () => {
  const first = intent('first', '<img> 日本語😀\n  inspect exact text');
  first.preview = 'Misleading generic preview';
  first.evidence = JSON.stringify({ id: 'first', type: 'assistant.intent', timestamp: first.timestamp,
    data: { content: 'Do not use this field', intent: '<img> 日本語😀\n  inspect exact text' } });
  const entries = [start(), first, intent('later', 'A later statement'), end()];
  const display = heading(entries);
  assert.equal(display.title, 'Reported activity: <img> 日本語😀\n  inspect exact text');
  assert.equal(display.activityId, 'first');
  assert.match(display.subtitle, /Model turn 0.*recorded-model.*Main chat.*2 events.*Completed/);
  assert.equal(summarize(entries).turns, 1);
  assert.equal(describeTurn(entries.at(-1), turnContext(entries).get('end')).title, 'Turn 0 complete');
});

test('unknown, tied or contradictory intent and boundary times cannot establish a heading', () => {
  for (const timestamp of [undefined, '', 'invalid', '2026-02-30T12:00:00Z', '2026-11-20T12:00:00',
    '2026-11-20T12:00:00Z', '2026-11-20T11:59:59Z']) {
    assert.equal(heading([start(), intent('intent', 'Uncertain timing', { timestamp }), end()]).title, 'Model turn 0');
  }
  for (const timestamp of [undefined, 'invalid', '2026-11-20T12:00:01Z', '2026-11-20T12:00:03Z']) {
    assert.equal(heading([start('start', { timestamp }), intent(), end()]).title, 'Model turn 0');
  }
  for (const timestamp of [undefined, 'invalid', '2026-11-20T12:00:01Z', '2026-11-20T11:59:59Z']) {
    assert.equal(heading([start(), intent(), end('end', { timestamp })]).title, 'Model turn 0');
  }
});

test('interleaved agents and reused loop numbers never share a reported heading', () => {
  const entries = [start(), start('child', { agentId: 'child' }), intent('child-intent', 'Child task', { agentId: 'child' }),
    intent('main-intent', 'Main task'), end(), end('child-end', { agentId: 'child' }), start('later'), intent('later-intent', 'Next request'), end('later-end')];
  assert.equal(heading(entries).title, 'Reported activity: Main task');
  assert.equal(heading(entries, undefined, 'child').title, 'Reported activity: Child task');
  assert.equal(heading(entries, undefined, 'later').title, 'Reported activity: Next request');
  assert.equal(summarize(entries).turns, 3);
});

test('steering and queued input preserve the observed interval but unknown or idle input stops it', () => {
  for (const delivery of ['steering', 'queued']) {
    const entries = [start(), { id: 'input', type: 'user.message', agentId: '', delivery }, intent(), end()];
    assert.equal(heading(entries).title, 'Reported activity: Inspect the recorded file');
  }
  for (const delivery of [undefined, 'idle', 'future']) {
    const entries = [start(), { id: 'input', type: 'user.message', agentId: '', delivery }, intent(), end()];
    assert.equal(heading(entries).title, 'Model turn 0');
    assert.equal(heading(entries).activityId, undefined);
  }
  const unknownInput = { id: 'unknown-input', type: 'user.message', agentId: null, delivery: 'steering' };
  const entries = [start(), start('child', { agentId: 'child' }), unknownInput,
    intent(), intent('child-intent', 'Child activity', { agentId: 'child' })];
  assert.equal(heading(entries).title, 'Model turn 0');
  assert.equal(heading(entries, undefined, 'child').title, 'Model turn 0');
});

test('partial history and ambiguous boundaries keep neutral headings', () => {
  const entries = [start(), intent(), end()];
  for (const options of [{ history: 'loading' }, { history: 'unavailable' }, { history: 'unsupported' }, { omitted: 1 }]) {
    assert.equal(heading(entries, options).title, 'Model turn 0');
  }
  for (const suffix of [[end('wrong', { turnId: 'other' })], [start('collision')], [{ id: 'abort', type: 'abort', agentId: '' }],
    [start('bad-source', { agentId: null })], [end('bad-source', { agentId: null })]]) {
    assert.equal(heading([start(), intent(), ...suffix]).title, 'Model turn 0');
  }
  assert.equal(heading([start(), intent(), start('collision'), intent('second')], undefined, 'collision').title, 'Model turn 0');
  assert.equal(heading([intent(), start(), end()]).title, 'Model turn 0');
  assert.equal(heading([start(), end(), intent()]).title, 'Model turn 0');
});

test('only complete matching bounded intent evidence can supply a heading', () => {
  const valid = intent();
  const records = [
    null, [], {}, { id: 'wrong', type: valid.type, data: { intent: 'wrong ID' } },
    { id: valid.id, type: 'assistant.message', data: { intent: 'wrong type' } },
    { id: valid.id, type: valid.type, agentId: 'child', data: { intent: 'wrong source' } },
    { id: valid.id, type: valid.type, agentId: '', data: { intent: 'invalid empty source' } },
    { id: valid.id, type: valid.type, timestamp: '2026-11-20T12:00:01.500Z', data: { intent: 'mismatched time' } },
    ...[null, [], 'text', {}, { intent: 0 }, { intent: {} }, { intent: '' }, { intent: ' \n\t' }, { content: 'wrong field' }]
      .map(data => ({ id: valid.id, type: valid.type, data })),
  ];
  for (const evidence of [undefined, '', '{', ...records.map(record => JSON.stringify(
    record && !Array.isArray(record) ? { timestamp: valid.timestamp, ...record } : record))]) {
    assert.equal(heading([start(), { ...valid, evidence }, end()]).title, 'Model turn 0');
  }
  for (const entry of [{ ...valid, truncated: true }, intent('intent', 'x'.repeat(12000)), { ...valid, agentId: null }]) {
    assert.equal(heading([start(), entry, end()]).title, 'Model turn 0');
  }
  assert.equal(heading([start(), intent('empty', ''), valid, end()]).activityId, 'intent', 'Skip invalid records, choosing the first complete nonempty statement.');
  assert.equal(heading([start(), end()]).title, 'Model turn 0');
});

test('reported headings bound long Unicode without modifying their original evidence', () => {
  const text = '日'.repeat(160) + '😀'.repeat(80);
  const recorded = intent('intent', text), display = heading([start(), recorded]);
  assert.ok(display.title.startsWith('Reported activity: 日'));
  assert.ok(display.title.length <= 180);
  assert.ok(display.title.endsWith('…'));
  assert.equal(display.title.isWellFormed(), true);
  assert.equal(JSON.parse(recorded.evidence).data.intent, text);
  assert.match(display.subtitle, /End not observed/);
});

test('ephemeral live intents reconcile with history before enabling a heading', async t => {
  let emit, resolveHistory;
  const trace = createTrace({ on(listener) { emit = listener; return () => {}; },
    getEvents() { return new Promise(resolve => { resolveHistory = resolve; }); } });
  t.after(() => trace.close());
  await Promise.resolve();
  const rawStart = { id: 'start', type: 'assistant.turn_start', timestamp: '2026-11-20T12:00:00Z', data: { turnId: '0', model: 'recorded-model' } };
  const rawIntent = { id: 'live', type: 'assistant.intent', timestamp: '2026-11-20T12:00:01Z', ephemeral: true, data: { intent: 'Inspect 日本語😀' } };
  emit(rawStart); emit(rawIntent);
  let snapshot = trace.snapshot();
  assert.equal(heading(snapshot.entries, snapshot).title, 'Model turn 0');
  resolveHistory([rawStart, { id: 'end', type: 'assistant.turn_end', timestamp: '2026-11-20T12:00:02Z', data: { turnId: '0' } }]);
  await trace.ready;
  snapshot = trace.snapshot();
  assert.deepEqual(snapshot.entries.map(entry => entry.id), ['start', 'live', 'end']);
  assert.equal(heading(snapshot.entries, snapshot).title, 'Reported activity: Inspect 日本語😀');
  assert.equal(heading(snapshot.entries, snapshot).activityId, 'live');
  assert.equal(summarize(snapshot.entries).turns, 1);
});
