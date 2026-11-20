import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const learning = await import('../com.github.copilot/extensions/trace/web/learning.mjs').catch(() => ({}));
const raw = (id, type, data = {}, timestamp = '2026-11-19T12:00:00.000Z', agentId) => ({ id, type, data, timestamp, ...(agentId ? { agentId } : {}) });
async function fixture(events = []) {
  let emit;
  const trace = createTrace({ on(fn) { emit = fn; return () => {}; }, getEvents: async () => events });
  await trace.ready;
  return { trace, emit };
}

test('live receipts distinguish history, buffered callbacks, duplicates and delayed timestamp arrival', async t => {
  let emit, finish;
  const trace = createTrace({ on(fn) { emit = fn; return () => {}; }, getEvents: () => new Promise(r => { finish = r; }) });
  t.after(() => trace.close());
  const overlap = raw('overlap', 'session.info');
  emit(overlap); emit(raw('buffered', 'session.info'));
  await Promise.resolve(); finish([overlap]); await trace.ready;
  assert.equal(trace.snapshot().liveReceipt, 0);
  assert.deepEqual(trace.snapshot().entries.map(entry => entry.observation), [
    { source: 'history', receipt: null }, { source: 'live', receipt: null },
  ]);
  emit(raw('newer', 'hook.start')); emit(raw('older', 'assistant.message', { content: '日本語 😀 <script>', messageId: 'm' }, '2026-11-18T00:00:00Z'));
  emit(raw('newer', 'hook.start')); emit(raw('delta', 'assistant.message_delta'));
  assert.equal(trace.snapshot().liveReceipt, 2);
  assert.equal(trace.snapshot().entries[0].id, 'older');
  assert.deepEqual(trace.snapshot().entries[0].observation, { source: 'live', receipt: 2 });
});

test('live prediction resolves exactly the first eligible receipt, ignoring hooks and host timestamp order', async t => {
  assert.equal(typeof learning.armLivePrediction, 'function');
  const { trace, emit } = await fixture([raw('old', 'assistant.message', { content: 'already seen', messageId: 'old' })]);
  t.after(() => trace.close());
  const attempt = learning.armLivePrediction(trace.snapshot(), 'response');
  assert.equal(attempt.status, 'waiting');
  emit(raw('hook', 'hook.start'));
  emit(raw('answer', 'assistant.message', { content: '日本語 😀 <script>', messageId: 'm' }));
  emit(raw('later', 'tool.execution_start', { toolName: 'view', toolCallId: 't', arguments: { path: 'future' } }, '2026-11-18T00:00:00Z'));
  const result = learning.resolveLivePrediction(attempt, trace.snapshot());
  assert.equal(result.status, 'resolved'); assert.equal(result.category, 'response');
  assert.equal(result.entry.id, 'answer'); assert.match(result.entry.evidence, /日本語 😀 <script>/);
  assert.equal(learning.resolveLivePrediction(result, trace.snapshot()), result);
});

test('uncertain live boundaries and receipt loss stay unknown rather than comparing a prediction', async t => {
  assert.equal(typeof learning.armLivePrediction, 'function');
  const { trace, emit } = await fixture(); t.after(() => trace.close());
  const baseline = trace.snapshot(), attempt = learning.armLivePrediction(baseline, 'response');
  assert.equal(learning.resolveLivePrediction(attempt, baseline).status, 'waiting');
  for (const extra of [{ history: 'loading' }, { liveReceipt: null }, { liveReceipt: Number.MAX_SAFE_INTEGER + 1 }, { omitted: -1 }]) {
    assert.equal(learning.armLivePrediction({ ...baseline, ...extra }, 'response').status, 'unknown');
  }
  assert.equal(learning.resolveLivePrediction(attempt, baseline, false).status, 'unknown');
  emit(raw('a', 'assistant.message', { content: 'a', messageId: 'a' }));
  const current = trace.snapshot();
  for (const extra of [{ entries: [] }, { liveReceipt: 2 }, { omitted: 1 }, { entries: [...current.entries, ...current.entries] },
    { entries: current.entries.map(entry => ({ ...entry, observation: { source: 'history', receipt: 1 } })) }]) {
    assert.equal(learning.resolveLivePrediction(attempt, { ...current, ...extra }).status, 'unknown');
  }
  for (let index = 0; index < 301; index++) emit(raw(`evict-${index}`, 'session.info'));
  assert.equal(learning.resolveLivePrediction(attempt, trace.snapshot()).status, 'unknown');
});

test('classification uses complete literal contracts and ignores assistant proposals without borrowing future evidence', async t => {
  assert.equal(typeof learning.classifyPredictionEvent, 'function');
  const cases = [
    ['tool.execution_start', { toolName: 'view', toolCallId: 't', arguments: { path: '日本語 😀' } }, 'read-search'],
    ['tool.execution_start', { toolName: 'grep', toolCallId: 't', arguments: { pattern: 'x' } }, 'read-search'],
    ['tool.execution_start', { toolName: 'create', toolCallId: 't', arguments: { path: 'x', file_text: '' } }, 'edit'],
    ['tool.execution_start', { toolName: 'powershell', toolCallId: 't', arguments: { command: 'echo x', description: 'fixture' } }, 'execute'],
    ['tool.execution_start', { toolName: 'task', toolCallId: 't', arguments: { prompt: 'x', agent_type: 'worker' } }, 'unknown'],
    ['tool.execution_start', { toolName: 'view', toolCallId: 't', arguments: { path: 'x', reasoningOpaque: 'secret' } }, 'unknown'],
    ['tool.execution_start', { toolName: 'view', toolCallId: 't', origin: 'plugin', arguments: { path: 'x' } }, 'unknown'],
    ['tool.execution_start', { toolName: 'view', toolCallId: 't', mcpToolName: 'view', mcpServerName: 'server', arguments: { path: 'x' } }, 'unknown'],
    ['assistant.message', { messageId: 'a', content: 'answer' }, 'response'],
    ['assistant.message', { messageId: 'a', content: 'chunk', chunkIndex: 0, chunkCount: 2 }, 'unknown'],
    ['assistant.message', { messageId: 'a', content: 'last chunk', chunkIndex: 1, chunkCount: 2 }, 'unknown'],
    ['assistant.message', { messageId: 'a', content: 'thinking', phase: 'thinking' }, 'unknown'],
    ['assistant.message', { messageId: 'a', content: 'proposal', toolRequests: [{ toolCallId: 't', name: 'view', arguments: { path: 'x' } }] }, null],
    ['assistant.message', { messageId: 'a', content: 'bad proposal', toolRequests: 'bad' }, 'unknown'],
    ['subagent.started', { toolCallId: 't', agentName: 'worker', agentDisplayName: 'Worker', agentDescription: 'Work' }, 'delegation'],
    ['hook.start', {}, null], ['tool.execution_complete', {}, null],
  ];
  const { trace } = await fixture(cases.map(([type, data], i) => raw(String(i), type, data, undefined, type === 'subagent.started' ? 'child' : undefined)));
  t.after(() => trace.close());
  const entries = trace.snapshot().entries;
  cases.forEach(([, , expected], i) => assert.equal(learning.classifyPredictionEvent(entries[i])?.category ?? null, expected, `case ${i}`));
  assert.equal(learning.classifyPredictionEvent({ ...entries[0], protectedContentOmitted: 'false' }).category, 'unknown');
  assert.equal(learning.classifyPredictionEvent({ ...entries[0], evidence: '{' }).category, 'unknown');
});

test('retained practice freezes its bounded prefix and reveals only one selected event', async t => {
  assert.equal(typeof learning.createReplayPractice, 'function');
  const { trace } = await fixture([raw('prompt', 'user.message', { content: 'question' }), raw('hook', 'hook.start'),
    raw('first', 'assistant.message', { content: 'first answer', messageId: 'a' }),
    raw('future', 'assistant.message', { content: 'hidden answer', messageId: 'b' })]);
  t.after(() => trace.close());
  const snapshot = trace.snapshot();
  const replay = learning.createReplayPractice(snapshot);
  assert.deepEqual(replay.snapshot.entries.map(entry => entry.id), ['prompt', 'hook']);
  snapshot.entries[2].evidence = 'mutated';
  const chosen = learning.chooseReplayPrediction(replay, 'response');
  assert.equal(chosen.attempt.status, 'resolved'); assert.equal(chosen.attempt.entry.id, 'first');
  assert.deepEqual(chosen.snapshot.entries.map(entry => entry.id), ['prompt', 'hook', 'first']);
  assert.match(chosen.attempt.entry.evidence, /first answer/);
  assert.doesNotMatch(JSON.stringify(chosen.snapshot), /hidden answer/);
  const next = learning.chooseReplayPrediction(chosen, 'read-search');
  assert.equal(next.attempt.entry.id, 'future');
  assert.equal(learning.chooseReplayPrediction(next, 'response').attempt.status, 'unknown');
});

test('live arming rejects a malformed baseline identity or provenance instead of waiting on it', async t => {
  const { trace } = await fixture([raw('a', 'session.info')]); t.after(() => trace.close());
  const snapshot = trace.snapshot();
  for (const entries of [[...snapshot.entries, ...snapshot.entries], [{ ...snapshot.entries[0], observation: null }],
    [{ ...snapshot.entries[0], observation: { source: 'history', receipt: 1 } }]]) {
    assert.equal(learning.armLivePrediction({ ...snapshot, entries }, 'response').status, 'unknown');
  }
});

test('replay cannot use duplicate identities as a certain outcome and all copied output remains immutable', async t => {
  const { trace } = await fixture([raw('a', 'assistant.message', { messageId: 'a', content: 'answer' })]); t.after(() => trace.close());
  const snapshot = trace.snapshot(); snapshot.entries.push({ ...snapshot.entries[0] });
  const practice = learning.createReplayPractice(snapshot);
  assert.equal(learning.chooseReplayPrediction(practice, 'response').attempt.status, 'unknown');
  const frozen = learning.freezeLearningSnapshot({ entries: [{ ...snapshot.entries[0], hostOutput: { nested: { value: 'kept' } } }] });
  assert.throws(() => { frozen.entries[0].hostOutput.nested.value = 'changed'; }, TypeError);
});
