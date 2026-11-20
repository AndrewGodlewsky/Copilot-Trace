import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';
import { armLivePrediction, resolveLivePrediction, createPlayback } from '../com.github.copilot/extensions/trace/web/learning.mjs';

const raw = (id, type, data = {}, ms = 0, agentId) => ({ id, type, data,
  timestamp: new Date(Date.UTC(2026, 10, 20) + ms).toISOString(), ...(agentId === undefined ? {} : { agentId }) });
const tool = (id, begin, end, agent) => [raw(`${id}-start`, 'tool.execution_start', { toolCallId: id, toolName: 'view' }, begin, agent),
  raw(`${id}-end`, 'tool.execution_complete', { toolCallId: id, success: true }, end, agent)];
const usage = (id, source = 'main-account', sequence = 1, data = {}, agent) => raw(id, 'assistant.usage', {
  model: 'fixture', modelProvider: 'other', accounting: { sourceSessionId: source, sequence, usageId: id },
  inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, reasoningTokens: 5, ...data }, sequence, agent);
async function fixture(history = [], live = []) {
  let emit;
  const trace = createTrace({ on(fn) { emit = fn; return () => {}; }, getEvents: async () => history });
  await trace.ready;
  live.forEach(emit);
  return { trace, emit, entries: trace.snapshot().entries };
}
function report(entries, scope) {
  assert.equal(typeof presentation.observedTimeAndUsage, 'function', 'Time and usage aggregation is available.');
  return presentation.observedTimeAndUsage(entries, scope);
}

test('paired tools and agents distinguish wall span, summed intervals, coverage and gaps', async t => {
  const a = tool('a', 100, 700), b = tool('b', 400, 900, 'child');
  const data = await fixture([raw('first', 'user.message', {}, 0), ...a, ...b,
    raw('agent-start', 'subagent.started', { toolCallId: 'task', agentName: 'worker' }, 200, 'worker'),
    raw('agent-end', 'subagent.completed', { toolCallId: 'task', agentName: 'worker', durationMs: 9999 }, 800, 'worker'),
    ...tool('zero', 950, 950), raw('last', 'assistant.message', {}, 1000)]);
  t.after(() => data.trace.close());
  const before = structuredClone(data.entries), result = report(data.entries).timing;
  assert.equal(result.window.wallMs, 1000);
  assert.equal(result.sumMs, 1700); assert.equal(result.coveredMs, 800); assert.equal(result.unaccountedMs, 200);
  assert.deepEqual(result.intervals.map(row => row.elapsedMs).sort((a, b) => a - b), [0, 500, 600, 600]);
  assert.deepEqual(result.gaps.map(row => row.elapsedMs), [100, 50, 50]);
  assert.equal(result.intervals.flatMap(row => row.entries).length, 8);
  assert.equal(result.excluded.length, 0); assert.deepEqual(data.entries, before);
});

test('timing excludes ambiguous, malformed, incomplete, reversed and contradictory boundaries', async t => {
  const missing = tool('missing', 0, 10); delete missing[1].timestamp;
  const reversed = tool('reversed', 50, 20);
  const blank = tool('blank', 0, 10); blank.forEach(row => { row.data.toolCallId = ' '; });
  const provider = tool('provider', 0, 10); provider[0].data.mcpServerName = 'one'; provider[0].data.mcpToolName = 'read';
  provider[1].data.mcpServerName = 'two';
  const duplicate = tool('duplicate', 0, 10); duplicate.push({ ...duplicate[0], id: 'duplicate-again' });
  const data = await fixture([...missing, ...reversed, ...blank, ...provider, ...duplicate, tool('partial', 0, 10)[0]]);
  t.after(() => data.trace.close());
  assert.equal(report(data.entries).timing.intervals.length, 0);
  assert.ok(report(data.entries).timing.excluded.length >= 6);
  const clean = await fixture(tool('clean', 0, 10)); t.after(() => clean.trace.close());
  for (const mutation of [{ agentId: 'other' }, { toolCallId: 'other' }, { timestamp: '2026-02-30T00:00:00Z' },
    { truncated: true }, { id: ' ' }]) {
    assert.equal(report([{ ...clean.entries[0], ...mutation }, clean.entries[1]]).timing.intervals.length, 0);
  }
  assert.equal(report([...clean.entries, clean.entries[0]]).timing.intervals.length, 0);
});

test('no paired interval is unavailable, while a valid zero interval is measured zero', async t => {
  assert.equal(report([]).timing.window, null); assert.equal(report([]).timing.sumMs, null);
  const data = await fixture(tool('same-time', 0, 0)); t.after(() => data.trace.close());
  const result = report(data.entries).timing;
  assert.equal(result.window.wallMs, 0); assert.equal(result.sumMs, 0); assert.equal(result.coveredMs, 0);
  assert.equal(result.unaccountedMs, 0);
});

test('same invocation IDs on distinct exact sources stay separate and calendar rollover is invalid', async t => {
  const main = tool('shared', 0, 20), child = tool('shared', 5, 30, 'child'); child.forEach(row => { row.id = `child-${row.id}`; });
  const data = await fixture([...main, ...child]); t.after(() => data.trace.close());
  assert.deepEqual(report(data.entries).timing.intervals.map(row => row.elapsedMs), [20, 25]);
  for (const timestamp of ['2026-02-30T00:00:00Z', '2026-11-20T00:00:61Z', '', 123, null]) {
    const events = tool('invalid-time', 0, 10); events[1].timestamp = timestamp;
    const invalid = await fixture(events); t.after(() => invalid.trace.close());
    assert.equal(report(invalid.entries).timing.intervals.length, 0);
    assert.equal(report(invalid.entries).timing.windowExcluded.length, 1);
  }
});

test('unsupported tool origin markers and contradictory reasoning subsets are excluded', async t => {
  for (const [start, end] of [[{ origin: 'builtin' }, { origin: 'custom' }],
    [{ overridesBuiltInTool: true }, { overridesBuiltInTool: false }], [{ origin: {} }, {}],
    [{ overridesBuiltInTool: 'true' }, {}]]) {
    const events = tool('marked', 0, 20); Object.assign(events[0].data, start); Object.assign(events[1].data, end);
    const data = await fixture(events); t.after(() => data.trace.close());
    assert.equal(report(data.entries).timing.intervals.length, 0);
  }
  const data = await fixture([], [usage('reasoning', 'source', 1, { reasoningTokens: 21 })]); t.after(() => data.trace.close());
  assert.equal(report(data.entries).usage.receipts.length, 0);
  const partial = await fixture([], [usage('partial', 'source', 1, { outputTokens: undefined, reasoningTokens: 21, cacheReadTokens: 1000 })]);
  t.after(() => partial.trace.close()); assert.equal(report(partial.entries).usage.receipts.length, 1);
  assert.deepEqual(report(partial.entries).usage.groups[0].measures.outputTokens, { value: null, reported: 0, missing: 1, status: 'unavailable' });
});

test('only live usage receipts survive hydration and maintain prediction receipt continuity', async t => {
  const data = await fixture([usage('historical')]); t.after(() => data.trace.close());
  assert.equal(data.entries.length, 0);
  const attempt = armLivePrediction(data.trace.snapshot(), 'response');
  data.emit(usage('live')); data.emit(raw('answer', 'assistant.message', { content: 'Answer', messageId: 'answer' }, 2));
  assert.equal(data.trace.snapshot().liveReceipt, 2);
  assert.equal(resolveLivePrediction(attempt, data.trace.snapshot()).entry.id, 'answer');
  const entry = data.trace.snapshot().entries.find(row => row.type === 'assistant.usage');
  assert.equal(entry.category, 'host'); assert.equal(entry.observation.source, 'live');
  assert.equal(JSON.parse(entry.evidence).data.inputTokens, 100);
  assert.equal(report([entry]).usage.receipts[0].values.inputTokens, 100);
});

test('source-specific receipts exclude overlapping aggregate totals and preserve provider uncertainty', async t => {
  const data = await fixture([], [usage('main-one'), usage('child-one', 'child-account', 1, {}, 'child-envelope'),
    usage('child-two', 'other-account', 1, {}, 'other-envelope'), usage('main-two', 'main-account', 2),
    raw('checkpoint', 'session.usage_checkpoint', { totalNanoAiu: 100 }),
    raw('child-end', 'subagent.completed', { totalTokens: 120 }, 3, 'child-envelope')]);
  t.after(() => data.trace.close());
  const result = report(data.entries).usage;
  assert.equal(result.receipts.length, 4); assert.equal(result.groups.length, 4);
  assert.equal(result.receipts.reduce((sum, row) => sum + row.values.inputTokens, 0), 400);
  assert.equal(result.receipts.filter(row => row.agentId === '').reduce((sum, row) => sum + row.values.inputTokens, 0), 200);
  const child = result.receipts.find(row => row.agentId === 'child-envelope');
  assert.equal(child.accounting.sourceSessionId, 'child-account'); assert.equal(child.accounting.sequence, 1);
  assert.equal(child.provider, null); assert.equal(child.providerFamily, 'other');
  assert.equal(child.values.cacheReadTokens, 40); assert.equal(child.values.reasoningTokens, 5);
  assert.equal(child.values.cacheWriteTokens, null); assert.equal(Object.hasOwn(result, 'cost'), false);
});

test('receipt deduplication ignores unrelated metadata but excludes complete conflicting identity chains', async t => {
  const first = usage('first'), repeat = { ...first, id: 'duplicate', timestamp: raw('x', 'x', {}, 5).timestamp,
    data: { ...first.data, unrelated: { future: true }, cost: 300, providerType: 'openai' } };
  const data = await fixture([], [first, repeat]); t.after(() => data.trace.close());
  assert.equal(report(data.entries).usage.receipts.length, 1); assert.equal(report(data.entries).usage.duplicates.length, 1);
  const chain = [usage('one'), usage('two'), usage('three', 'main-account', 2, { accounting: { sourceSessionId: 'main-account', sequence: 2, usageId: 'two' } })];
  const conflict = await fixture([], chain); t.after(() => conflict.trace.close());
  assert.equal(report(conflict.entries).usage.receipts.length, 0);
  assert.equal(report(conflict.entries).usage.excluded.flatMap(row => row.entries).length, 3);
  for (const change of [{ inputTokens: 101 }, { model: 'other' }, { modelProvider: 'openai' },
    { provider: { id: 'p', kind: 'copilot', label: 'Provider' } }, { outputTokens: null }]) {
    const altered = await fixture([], [first, { ...repeat, data: { ...first.data, ...change } }]);
    t.after(() => altered.trace.close()); assert.equal(report(altered.entries).usage.receipts.length, 0);
  }
});

test('consumed usage fields validate strictly, while unknown unrelated schema metadata is harmless', async t => {
  for (const change of [{ accounting: null }, { accounting: { sourceSessionId: ' ', sequence: 1, usageId: 'x' } },
    { inputTokens: -1 }, { outputTokens: Infinity }, { cacheReadTokens: Number.MAX_SAFE_INTEGER + 1 },
    { reasoningTokens: 0.5 }, { model: ' ' }, { provider: { id: 'x', kind: 'future', label: 'X' } }, { modelProvider: {} }]) {
    const data = await fixture([], [usage('invalid', 'source', 1, change)]); t.after(() => data.trace.close());
    assert.equal(report(data.entries).usage.receipts.length, 0, JSON.stringify(change));
    assert.ok(report(data.entries).usage.excluded.length);
  }
  const data = await fixture([], [usage('extra', 'source', 1, { future: { unrecognized: true }, cost: 0, aiCreditsStatus: 'unavailable' })]);
  t.after(() => data.trace.close()); assert.equal(report(data.entries).usage.receipts.length, 1);
  assert.equal(report([{ ...data.entries[0], observation: { source: 'history', receipt: null } }]).usage.receipts.length, 0);
});

test('exact provider groups expose partial measures and guard arithmetic overflow', async t => {
  const provider = { id: 'exact', kind: 'copilot', label: 'Exact provider' };
  const data = await fixture([], [usage('one', 'source', 1, { provider, cacheWriteTokens: 0 }),
    usage('two', 'source', 2, { provider, cacheReadTokens: undefined })]);
  t.after(() => data.trace.close());
  const group = report(data.entries).usage.groups[0];
  assert.equal(report(data.entries).usage.groups.length, 1);
  assert.deepEqual(group.measures.inputTokens, { value: 200, reported: 2, missing: 0, status: 'complete' });
  assert.deepEqual(group.measures.cacheReadTokens, { value: 40, reported: 1, missing: 1, status: 'partial' });
  assert.deepEqual(group.measures.cacheWriteTokens, { value: 0, reported: 1, missing: 1, status: 'partial' });
  const big = await fixture([], [usage('big', 'source', 1, { provider, inputTokens: Number.MAX_SAFE_INTEGER }),
    usage('small', 'source', 2, { provider })]); t.after(() => big.trace.close());
  assert.equal(report(big.entries).usage.groups[0].measures.inputTokens.value, null);
  assert.equal(report(big.entries).usage.groups[0].measures.inputTokens.status, 'overflow');
});

test('timing sums guard aggregate overflow and usage respects eviction and displayed playback prefixes', async t => {
  const long = [];
  for (let i = 0; i < 40; i++) for (const [index, event] of tool(`long-${i}`, 0, 0).entries()) {
    event.timestamp = index ? '9999-12-31T00:00:00Z' : '0001-01-01T00:00:00Z'; long.push(event);
  }
  const data = await fixture(long); t.after(() => data.trace.close());
  assert.equal(report(data.entries).timing.sumMs, null);
  assert.ok(Number.isSafeInteger(report(data.entries).timing.coveredMs));
  const live = await fixture([], [raw('before', 'user.message'), usage('later')]); t.after(() => live.trace.close());
  const playback = createPlayback(live.trace.snapshot());
  assert.equal(report(playback.state.snapshot.entries).usage.receipts.length, 0); playback.close();
  for (let i = 0; i < 300; i++) live.emit(raw(`evict-${i}`, 'session.info', {}, 10 + i));
  assert.equal(report(live.trace.snapshot().entries).usage.receipts.length, 0);
});
