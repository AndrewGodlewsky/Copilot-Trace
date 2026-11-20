import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

function event(id, boundary, compactionAttemptId = 'attempt', data = {}, extra = {}) {
  return { id, type: `session.compaction_${boundary}`, timestamp: '2026-11-20T12:00:00Z',
    data: { compactionAttemptId, ...(boundary === 'complete' ? { success: true } : {}), ...data }, ...extra };
}
async function projected(records) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => records });
  await trace.ready;
  const entries = trace.snapshot().entries;
  trace.close();
  return entries;
}
const metrics = { tokenAccountingBasis: 'local_full_context_estimate', preCompactionTokens: 100,
  postCompactionTokens: 40, tokensRemoved: 60, messagesRemoved: 3, preCompactionMessagesLength: 4 };

test('compaction boundaries link only exact source and attempt identities without changing event order', async () => {
  assert.equal(typeof presentation.compactionAttempts, 'function');
  const entries = await projected([event('a', 'start'), event('b', 'start', 'second'),
    event('child-a', 'start', 'attempt', {}, { agentId: 'child' }), event('c', 'complete'),
    event('d', 'complete', 'second'), event('child-b', 'complete', 'attempt', {}, { agentId: 'child' })]);
  const attempts = presentation.compactionAttempts(entries);
  assert.deepEqual(attempts.map(item => [item.agentId, item.compactionAttemptId, item.status, item.outcome]), [
    ['', 'attempt', 'paired', 'success'], ['', 'second', 'paired', 'success'], ['child', 'attempt', 'paired', 'success'],
  ]);
  assert.deepEqual(attempts.map(item => item.entries.map(entry => entry.id)), [['a', 'c'], ['b', 'd'], ['child-a', 'child-b']]);
  assert.deepEqual(presentation.groupSteps(entries).flatMap(group => group.entries), entries);
});

test('partial, failed and future compaction outcomes stay distinct from a running or successful attempt', async () => {
  for (const [raw, status, outcome, note] of [
    [[event('a', 'start')], 'start-only', 'unknown', /completion.*not retained.*does not mean.*running/i],
    [[event('a', 'complete', 'attempt', { success: false, outcome: 'future <result> 🧪', summaryContent: 'Reported summary' })], 'complete-only', 'failure', /start.*not retained/i],
    [[event('a', 'start'), event('b', 'complete', 'attempt', { success: false })], 'paired', 'failure', /future turns retain/i],
    [[event('a', 'start'), event('b', 'start'), event('c', 'complete')], 'conflict', 'unknown', /duplicate/i],
    [[event('a', 'start'), event('b', 'complete'), event('c', 'complete')], 'conflict', 'unknown', /duplicate/i],
    [[event('b', 'complete'), event('a', 'start')], 'conflict', 'unknown', /before.*start/i],
  ]) {
    const [attempt] = presentation.compactionAttempts(await projected(raw));
    assert.equal(attempt.status, status); assert.equal(attempt.outcome, outcome);
    assert.match(attempt.notes.join(' '), note);
    if (raw[0].data.outcome) {
      assert.equal(attempt.reportedOutcome, 'future <result> 🧪');
      assert.equal(attempt.summary.content, 'Reported summary');
    }
  }
});

test('missing or malformed attempt IDs and sources never pair by time, names or chronological parent ID', async () => {
  for (const identity of [undefined, null, '', ' ', 1, {}, [], 'x'.repeat(257)]) {
    const raw = [event('a', 'start', identity), event('b', 'complete', identity, { summaryContent: 'Own completion' }, { parentId: 'a' })];
    // The fixture's default argument must not turn an absent field into an identifier.
    if (identity === undefined) for (const item of raw) delete item.data.compactionAttemptId;
    const attempts = presentation.compactionAttempts(await projected(raw));
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every(item => item.status === 'unlinked'));
    assert.equal(attempts[1].summary.content, 'Own completion');
  }
  for (const agentId of [null, '', 1, {}, [], 'x'.repeat(257)]) {
    const attempts = presentation.compactionAttempts(await projected([
      event('a', 'start', 'attempt', {}, { agentId }), event('b', 'complete', 'attempt', {}, { agentId }),
    ]));
    assert.equal(attempts.length, 2); assert.ok(attempts.every(item => item.status === 'unlinked'));
    assert.ok(attempts.every(item => item.outcome === 'unknown'));
  }
  const [entry] = await projected([event('a', 'complete')]);
  assert.equal(presentation.compactionAttempts([entry, entry])[0].status, 'conflict');
});

test('exact literal summaries distinguish complete, empty, absent and evidence clipped before or after the field', async () => {
  const content = '# Café 🧪\r\n<script>literal</script>\n' + '日'.repeat(8000);
  const [complete] = presentation.compactionAttempts(await projected([event('a', 'complete', 'attempt', { summaryContent: content })]));
  assert.equal(complete.summary.status, 'complete'); assert.equal(complete.summary.content, content);
  assert.equal(complete.status, 'complete-only');
  const [empty] = presentation.compactionAttempts(await projected([event('a', 'complete', 'attempt', { summaryContent: '' })]));
  assert.equal(empty.summary.status, 'empty'); assert.equal(empty.summary.content, '');
  for (const summaryContent of [undefined, null, false, 1, [], {}]) {
    const [attempt] = presentation.compactionAttempts(await projected([event('a', 'complete', 'attempt', { summaryContent })]));
    assert.equal(attempt.summary.status, 'unavailable'); assert.equal(attempt.summary.content, null);
    assert.match(attempt.summary.note, /not record.*text summary/i);
  }
  for (const data of [{ summaryContent: '🧪'.repeat(6500) }, { padding: 'x'.repeat(13000), summaryContent: 'After' },
    { summaryContent: 'Before', padding: 'x'.repeat(13000) }]) {
    const [entry] = await projected([event('a', 'complete', 'attempt', data)]);
    const [attempt] = presentation.compactionAttempts([entry]);
    assert.equal(entry.truncated, true); assert.equal(attempt.summary.content, null);
    assert.match(attempt.summary.note, /clipped.*12,000 UTF-16.*cannot recover/i);
  }
});

test('malformed or identity-mismatched evidence cannot supply summary, outcome or comparable measurements', async () => {
  const [entry] = await projected([event('a', 'complete', 'attempt', { ...metrics, summaryContent: 'Historical summary' })]);
  const raw = JSON.parse(entry.evidence);
  for (const change of [{ truncated: true }, { evidence: '{' }, { evidence: 'null' }, { evidence: '[]' },
    { evidence: ' '.repeat(12001) }, { id: '' }, { id: 'x'.repeat(257) }, { agentId: null }, { success: false },
    ...['id', 'type', 'agentId', 'timestamp'].map(key => ({ evidence: JSON.stringify({ ...raw, [key]: 'other' }) })),
    { evidence: JSON.stringify({ ...raw, data: [] }) }]) {
    const [attempt] = presentation.compactionAttempts([{ ...entry, ...change }]);
    assert.equal(attempt.outcome, 'unknown'); assert.equal(attempt.summary.content, null);
    assert.equal(attempt.metrics.status, 'unavailable');
  }
});

test('context comparisons use only consistent safe paired estimates under the recognized accounting basis', async () => {
  const [attempt] = presentation.compactionAttempts(await projected([event('a', 'start', 'attempt', { currentTokens: 999 }),
    event('b', 'complete', 'attempt', { ...metrics, compactionTokensUsed: { inputTokens: 7000, outputTokens: 8 } })]));
  assert.deepEqual([attempt.metrics.status, attempt.metrics.basis, attempt.metrics.before, attempt.metrics.after,
    attempt.metrics.change, attempt.metrics.tokensRemoved, attempt.metrics.messagesRemoved],
  ['comparable', 'local_full_context_estimate', 100, 40, 60, 60, 3]);
  for (const data of [{ tokenAccountingBasis: undefined }, { tokenAccountingBasis: 'future' },
    { tokenAccountingBasis: {} }, { preCompactionTokens: undefined }, { postCompactionTokens: -1 },
    { preCompactionTokens: 1.5 }, { postCompactionTokens: '40' }, { preCompactionTokens: Number.MAX_SAFE_INTEGER + 1 },
    { tokensRemoved: 50 }, { tokensRemoved: -1 }, { tokensRemoved: '60' },
    { postCompactionTokens: 150 }]) {
    const [result] = presentation.compactionAttempts(await projected([event('b', 'complete', 'attempt', { ...metrics, ...data })]));
    assert.notEqual(result.metrics.status, 'comparable', JSON.stringify(data));
    assert.equal(result.metrics.before, null); assert.equal(result.metrics.after, null); assert.equal(result.metrics.change, null);
  }
  for (const [before, after, change] of [[0, 0, 0], [10, 20, -10]]) {
    const [result] = presentation.compactionAttempts(await projected([event('b', 'complete', 'attempt', {
      tokenAccountingBasis: 'local_full_context_estimate', preCompactionTokens: before, postCompactionTokens: after,
    })]));
    assert.equal(result.metrics.status, 'comparable'); assert.equal(result.metrics.change, change);
  }
});

test('conflicting counts do not become reliable reductions or memory coverage', async () => {
  const [conflict] = presentation.compactionAttempts(await projected([event('a', 'start'),
    event('b', 'complete', 'attempt', metrics), event('c', 'complete', 'attempt', { ...metrics, postCompactionTokens: 50 })]));
  assert.equal(conflict.metrics.status, 'unavailable'); assert.equal(conflict.metrics.tokensRemoved, null);
  for (const data of [{ messagesRemoved: -1 }, { messagesRemoved: 5 }, { messagesRemoved: '3' }, { preCompactionMessagesLength: -1 }]) {
    const [result] = presentation.compactionAttempts(await projected([event('b', 'complete', 'attempt', { ...metrics, ...data })]));
    assert.equal(result.metrics.messagesRemoved, null);
    assert.match(result.metrics.note, /message.*invalid|message.*inconsistent/i);
  }
});
