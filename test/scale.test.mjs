import assert from 'node:assert/strict';
import { test } from 'node:test';
import { performance } from 'node:perf_hooks';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { makeSession, persisted, host } from './fixtures/workload.mjs';

// Budgets are deliberately generous (roughly 20–50x measured times) so they catch algorithmic regressions,
// not machine speed. Measurements and the workload model are described in docs/efficiency-review.md.

const time = timestamp => { const parsed = Date.parse(typeof timestamp === 'string' ? timestamp.slice(0, 80) : ''); return Number.isFinite(parsed) ? parsed : Infinity; };
const supported = new Set(['user.message', 'assistant.turn_start', 'assistant.turn_end', 'assistant.intent', 'assistant.message', 'assistant.reasoning',
  'assistant.usage', 'tool.execution_start', 'tool.execution_complete', 'skill.invoked', 'subagent.started', 'subagent.completed', 'subagent.failed',
  'hook.start', 'hook.end', 'permission.requested', 'permission.completed', 'session.compaction_start', 'session.compaction_complete',
  'session.error', 'session.info', 'session.warning', 'abort']);
const accepted = event => event && !event.checkpoint && typeof event.id === 'string' && event.id.length <= 256 && supported.has(event.type);

// The original retention semantics, kept deliberately naive: insert, fully re-sort by time (stable), trim the oldest.
function oracle(history, live = []) {
  let kept = [], omitted = 0;
  const insert = event => {
    if (kept.some(item => item.id === event.id)) return;
    kept.push(event);
    kept = kept.map((item, index) => ({ item, index })).sort((a, b) => (time(a.item.timestamp) - time(b.item.timestamp)) || (a.index - b.index)).map(({ item }) => item);
    if (kept.length > 300) { kept.shift(); omitted++; }
  };
  for (const event of history) if (event.type !== 'assistant.usage' && accepted(event)) insert(event);
  for (const event of live) if (accepted(event)) insert(event);
  return { ids: kept.map(event => event.id), omitted };
}

function fastest(run, repeat = 3) {
  let best = Infinity;
  for (let i = 0; i < repeat; i++) { const start = performance.now(); run(); best = Math.min(best, performance.now() - start); }
  return best;
}

test('retained window matches the original insert-and-resort semantics on anomalous histories and live streams', async t => {
  for (const seed of [3, 5, 8]) for (const size of [0, 299, 300, 301, 3000]) {
    const all = makeSession(size + 600, { seed, anomalies: true, largeResults: false });
    const history = persisted(all.slice(0, size)), live = all.slice(size);
    const fixture = host(history);
    const trace = createTrace(fixture.session);
    t.after(() => trace.close());
    await trace.ready;
    for (const event of live) fixture.emit(event);
    const snapshot = trace.snapshot(), expected = oracle(history, live);
    assert.deepEqual(snapshot.entries.map(entry => entry.id), expected.ids, `seed ${seed} size ${size}`);
    assert.equal(snapshot.omitted, expected.omitted, `seed ${seed} size ${size} omitted`);
    const receipts = snapshot.entries.filter(entry => entry.observation.source === 'live').map(entry => entry.observation.receipt);
    assert.ok(receipts.every((receipt, index) => Number.isSafeInteger(receipt) && (index === 0 || receipt !== receipts[index - 1])), 'live receipts stay numbered');
  }
});

test('hydrating a 100,000-event history projects only the retained window and stays fast', async t => {
  const history = persisted(makeSession(100000, { seed: 21, largeResults: false }));
  assert.ok(history.length > 90000);
  const fixture = host(history);
  const start = performance.now();
  const trace = createTrace(fixture.session);
  t.after(() => trace.close());
  await trace.ready;
  const elapsed = performance.now() - start;
  const snapshot = trace.snapshot();
  const accepted = history.filter(event => event.type !== 'assistant.usage' && supported.has(event.type));
  assert.equal(snapshot.entries.length, 300);
  assert.equal(snapshot.omitted, accepted.length - 300);
  assert.deepEqual(snapshot.entries.map(entry => entry.id), accepted.slice(-300).map(event => event.id), 'an ordered history keeps its newest records');
  assert.ok(snapshot.entries.every(entry => entry.observation.source === 'history'));
  assert.ok(elapsed < 3000, `hydration took ${elapsed.toFixed(0)} ms (measured about 50 ms; the original re-sort took about 8 s)`);
});

test('20,000 live events arriving one at a time keep a bounded, ordered window', async t => {
  const fixture = host([]);
  const trace = createTrace(fixture.session);
  t.after(() => trace.close());
  await trace.ready;
  const live = makeSession(20000, { seed: 34, largeResults: false });
  const start = performance.now();
  for (const event of live) fixture.emit(event);
  const elapsed = performance.now() - start;
  const { entries, omitted, liveReceipt } = trace.snapshot();
  const accepted = live.filter(event => supported.has(event.type));
  assert.equal(entries.length, 300);
  assert.equal(omitted, accepted.length - 300);
  assert.equal(liveReceipt, accepted.length);
  assert.ok(entries.every((entry, index) => index === 0 || time(entries[index - 1].timestamp) <= time(entry.timestamp)));
  assert.ok(elapsed < 10000, `live ingestion took ${elapsed.toFixed(0)} ms`);
});

test('repeated snapshots of one revision share one projection but return caller-owned arrays', async t => {
  const fixture = host(persisted(makeSession(2000, { seed: 2 })));
  const trace = createTrace(fixture.session);
  t.after(() => trace.close());
  await trace.ready;
  const first = trace.snapshot(), second = trace.snapshot();
  assert.notEqual(first, second);
  assert.notEqual(first.entries, second.entries);
  assert.deepEqual(first, second);
  first.entries.length = 0;
  assert.equal(trace.snapshot().entries.length, 300, 'caller mutation does not reach the retained window');
  const elapsed = fastest(() => { for (let i = 0; i < 10000; i++) trace.snapshot(); }, 1);
  assert.ok(elapsed < 2000, `10,000 unchanged-revision snapshots took ${elapsed.toFixed(0)} ms`);
});

// Windows larger than the 300-event cap, built from consecutive retained projections, show how each analysis scales.
async function window(size, seed, options = {}) {
  const all = makeSession(Math.ceil(size * 1.15), { seed, largeResults: false, ...options });
  const entries = [];
  for (let offset = 0; entries.length < size && offset < all.length; offset += 300) {
    const trace = createTrace(host(persisted(all.slice(offset, offset + 300))).session);
    await trace.ready;
    entries.push(...trace.snapshot().entries);
    trace.close();
  }
  return { history: 'ready', omitted: 0, entries: entries.slice(0, size) };
}

// The default mix and a delegation-heavy mix (every tool call spawns a subagent) stress different per-row scans.
for (const [label, options] of [['mixed tools', {}], ['delegation-heavy', { tools: ['task'] }]]) test(`panel analyses scale near-linearly from 3,000 to 30,000 retained records (${label})`, async () => {
  const [small, large] = [await window(3000, 13, options), await window(30000, 13, options)];
  const analyses = {
    actionStages: s => presentation.actionStages(s.entries, s),
    observedActivity: s => presentation.observedActivity(s.entries, { ...s, now: Date.parse('2027-01-01T00:00:00Z') }),
    recoveryAttempts: s => presentation.recoveryAttempts(s.entries, s),
    agentLanes: s => presentation.agentLanes(s.entries, s),
    delegationHandoffs: s => presentation.delegationHandoffs(s.entries, s),
    observedRecap: s => presentation.observedRecap(s.entries, s),
  };
  const encoded = [JSON.stringify(small), JSON.stringify(large)];
  // Fresh copies keep the per-entry evidence cache from hiding parse costs; copying is outside the timed region.
  const timed = (run, source, repeat) => {
    let best = Infinity;
    for (let i = 0; i < repeat; i++) {
      const snapshot = JSON.parse(source), start = performance.now();
      run(snapshot);
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };
  for (const [name, run] of Object.entries(analyses)) {
    const smallTime = timed(run, encoded[0], 5), largeTime = timed(run, encoded[1], 3);
    // A 5 ms floor keeps timer noise in very fast small runs from dominating the ratio.
    const ratio = largeTime / Math.max(smallTime, 5);
    assert.ok(ratio < 30, `${name}: 10x records cost ${ratio.toFixed(1)}x time (${smallTime.toFixed(1)} → ${largeTime.toFixed(1)} ms); quadratic growth would be about 100x`);
    assert.ok(largeTime < 15000, `${name} took ${largeTime.toFixed(0)} ms for 30,000 records`);
  }
});

test('cached evidence parsing follows in-place entry changes', () => {
  const entry = { id: 'a', type: 'tool.execution_complete', agentId: '', timestamp: '2026-01-01T00:00:00.000Z', truncated: false,
    evidence: JSON.stringify({ id: 'a', type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:00.000Z', data: { success: true } }) };
  assert.deepEqual(presentation.explanationData(entry), { success: true });
  assert.equal(presentation.explanationData(entry), presentation.explanationData(entry), 'one parse per unchanged entry');
  entry.evidence = JSON.stringify({ id: 'a', type: 'tool.execution_complete', timestamp: '2026-01-01T00:00:00.000Z', data: { success: false } });
  assert.deepEqual(presentation.explanationData(entry), { success: false });
  entry.truncated = true;
  assert.equal(presentation.explanationData(entry), null);
});
