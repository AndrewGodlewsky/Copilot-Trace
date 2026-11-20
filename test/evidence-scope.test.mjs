import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

function scope(snapshot, feed = 'connected') {
  assert.equal(typeof presentation.observerScope, 'function', 'One shared observer-scope description is available.');
  return presentation.observerScope(snapshot, feed);
}
async function observe(events) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => events });
  await trace.ready;
  const snapshot = trace.snapshot(); trace.close(); return snapshot;
}

test('scope keeps all history states distinct and zero supported events never means a complete empty session', () => {
  for (const [history, label, reason] of [
    ['loading', /History loading/, /still loading/],
    ['ready', /0 retained events/, /No retained supported events.*not proof that nothing happened/],
    ['unavailable', /Earlier history unavailable/, /Earlier history could not be read/],
    ['unsupported', /Event API unsupported/, /did not expose the session event API/],
    ['future', /History status unknown/, /History status is unknown/],
    ['__proto__', /History status unknown/, /History status is unknown/],
  ]) {
    const result = scope({ history, entries: [], omitted: 0 });
    assert.match(result.label, label);
    assert.match(result.detail, reason);
    assert.equal(result.countsAvailable, history === 'ready');
    assert.equal(result.degraded, history !== 'ready');
    assert.match(result.detail, /selected supported event types/);
    assert.match(result.detail, /300.*12,000 UTF-16 code units/);
    assert.match(result.detail, /malformed records.*absent/);
  }
});

test('scope distinguishes initial feed failure from stale retained facts and recovery', () => {
  assert.equal(scope(undefined, 'disconnected').countsAvailable, false);
  assert.match(scope(undefined, 'disconnected').detail, /No event snapshot.*counts are unknown/);
  const snapshot = { history: 'unavailable', entries: [{ id: 'fact', type: 'session.info' }] };
  const stale = scope(snapshot, 'disconnected');
  assert.equal(stale.countsAvailable, true);
  assert.match(stale.label, /Stale snapshot/);
  assert.match(stale.detail, /previous snapshot.*may be out of date/);
  assert.match(stale.detail, /Earlier history could not be read/);
  assert.doesNotMatch(scope(snapshot).detail, /out of date/);
});

test('retention, clipped Unicode evidence and unlinked malformed identities have distinct bounded reasons', async () => {
  const snapshot = await observe([
    ...Array.from({ length: 299 }, (_, i) => ({ id: `message-${i}`, type: 'user.message', data: { content: 'fixture' } })),
    { id: 'clipped', type: 'tool.execution_complete', agentId: null, data: { toolCallId: 'x'.repeat(257), success: false, result: { content: '🧪'.repeat(9000) } } },
    { id: '', type: 'hook.end', data: {} },
  ]);
  const result = scope(snapshot);
  assert.match(result.detail, /Older events were omitted: 1 older event/);
  assert.match(result.detail, /1 retained record.*Trace-clipped/);
  assert.match(result.detail, /2 turn, hook or tool events.*usable IDs.*excluded/);
  assert.match(result.detail, /1 retained record.*usable event ID/);
  const clipped = snapshot.entries.find(entry => entry.id === 'clipped');
  assert.equal(clipped.success, false, 'A reported failure remains recorded despite missing identity.');
  assert.ok(clipped.evidence.length <= 12000);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(clipped.evidence));
  assert.doesNotMatch(result.detail, /fixture|🧪|xxxxxxxx/);
  assert.equal(result.degraded, true);
});

test('stage, extent and retrieval explanations share history reasons without erasing known failure or unknown completion', async () => {
  const snapshot = await observe([
    { id: 'start', type: 'tool.execution_start', data: { toolCallId: 'failed', toolName: 'view', arguments: { path: 'fixture' } } },
    { id: 'result', type: 'tool.execution_complete', data: { toolCallId: 'failed', success: false, result: { content: 'fixture diagnostic' } } },
    { id: 'missing', type: 'tool.execution_start', data: { toolCallId: 'missing', toolName: 'view', arguments: { path: 'fixture' } } },
  ]);
  for (const [history, reason] of [['loading', /still loading/], ['unavailable', /Earlier history could not be read/],
    ['unsupported', /did not expose the session event API/], ['__proto__', /History status is unknown/]]) {
    const ledger = presentation.retrievalLedger(snapshot.entries, { history });
    const extents = presentation.toolExtents(snapshot.entries, { history });
    const stages = presentation.actionStages(snapshot.entries, { history });
    assert.match(ledger.note, reason);
    assert.match(extents.get('result').notes.join(' '), reason);
    assert.match(stages.get('result').notes.join(' '), reason);
    assert.match(extents.get('result').returned, /Reported failure/);
    assert.match(extents.get('missing').returned, /unknown/);
    assert.match(stages.get('missing').notes.join(' '), /outcome unknown.*no result/);
  }
});
