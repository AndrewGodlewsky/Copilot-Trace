import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const event = (id, type, data = {}, agentId) => ({ id, type, timestamp: '2026-11-20T12:00:00Z', data,
  ...(agentId === undefined ? {} : { agentId }) });
const call = (id, name = 'view', args = { path: '日本語🧪<script>' }, agentId) => [
  event(`${id}-start`, 'tool.execution_start', { toolCallId: id, toolName: name, arguments: args }, agentId),
  event(`${id}-end`, 'tool.execution_complete', { toolCallId: id, success: true, result: { content: 'Literal result' } }, agentId),
];
async function project(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function recap(entries, scope) {
  assert.equal(typeof presentation.observedRecap, 'function', 'A deterministic observed recap is available.');
  return presentation.observedRecap(entries, scope);
}

test('recap counts match Statistics with overlapping sources, repeats and completion-only boundaries', async () => {
  const read = call('same'), child = call('same', 'view', { path: 'child' }, 'child');
  child.forEach(record => { record.id = `child-${record.id}`; });
  const entries = await project([event('turn', 'assistant.turn_start', { turnId: '0' }),
    read[0], child[0], read[1], child[1], ...call('repeat'), call('orphan')[1],
    event('skill1', 'skill.invoked', { name: 'reading' }), event('skill2', 'skill.invoked', { name: 'reading' }),
    event('hook-start', 'hook.start', { hookInvocationId: 'h', hookType: 'preToolUse' }),
    event('hook-end', 'hook.end', { hookInvocationId: 'h', hookType: 'preToolUse', success: true }),
    event('turn-end', 'assistant.turn_end', { turnId: '0' })]);
  const before = structuredClone(entries), result = recap(entries);
  assert.deepEqual(result.stats, presentation.summarize(entries));
  assert.deepEqual(result.metrics.map(row => [row.key, row.count]), [['turns', 1], ['tools', 4], ['hooks', 1], ['skills', 2], ['unlinked', 0]]);
  assert.deepEqual(result.metrics.find(row => row.key === 'tools').entries.map(entry => entry.id),
    ['same-start', 'child-same-start', 'same-end', 'child-same-end', 'repeat-start', 'repeat-end', 'orphan-end']);
  assert.equal(result.retrieval.rows.length, 3);
  assert.equal(result.retrieval.unclassified.length, 1);
  assert.equal(result.retrieval.rows[0].targets[0], '日本語🧪<script>');
  assert.deepEqual(entries, before);
});

test('recap keeps literal claims, protocol failures, typed validation exits and unknown assertions separate', async () => {
  const checks = call('checks', 'powershell', { command: 'npm test', description: 'Run checks' });
  checks[1].data.result.contents = [{ type: 'shell_exit', shellId: 'shell', exitCode: 1 }];
  const failed = call('failed'); failed[1].data.success = false;
  const entries = await project([...checks, ...failed, call('missing', 'powershell', { command: 'npm run check', description: 'Check' })[0],
    ...call('unsupported', 'powershell', { command: 'echo Tests passed', description: 'Unknown' }),
    event('claim', 'assistant.message', { content: 'Tests passed.' }), event('prose', 'assistant.message', { content: 'Everything is done!' })]);
  const result = recap(entries);
  assert.equal(result.failures.find(row => row.key === 'tools').entries.length, 1);
  assert.equal(result.validation.checks.length, 2);
  assert.deepEqual(result.validation.checks.map(check => [check.toolSuccess, check.exitCode, check.assertionCounts]), [[true, 1, null], [null, null, null]]);
  assert.equal(result.validation.unclassifiedCalls, 2);
  assert.deepEqual(result.claims.map(claim => claim.statement), ['Tests passed.']);
  assert.match(result.notes.join(' '), /unknown/i);
});

test('partial, empty and clipped ranges describe observed limits without claiming request completion', async () => {
  const empty = recap([], { history: 'unavailable', omitted: 8 });
  assert.equal(empty.stats.tools, 0); assert.equal(empty.validation.checks.length, 0);
  assert.match(empty.notes.join(' '), /8 older.*omitted/i);
  assert.match(empty.notes.join(' '), /history.*unavailable/i);
  assert.match(empty.notes.join(' '), /completion.*unknown/i);
  const entries = await project(call('clipped'));
  entries[1].truncated = true;
  const partial = recap(entries);
  assert.match(partial.notes.join(' '), /1.*clipped/i);
  assert.equal(partial.unknownToolResults.length, 1);
  assert.equal(partial.failures.find(row => row.key === 'tools').entries.length, 0);
});

test('range choices reuse supported chronological intervals without counting an earlier queued prompt', async () => {
  const entries = await project([event('one', 'user.message', { content: 'First', delivery: 'idle', interactionId: 'one' }),
    event('queue', 'user.message', { content: 'Next 日本語', delivery: 'queued', interactionId: 'next' }),
    event('turn', 'assistant.turn_start', { turnId: '0', interactionId: 'next' }),
    event('steer', 'user.message', { content: 'Steer', delivery: 'steering' }), event('abort', 'abort')]);
  const chapters = presentation.requestChapters(entries), result = recap(chapters[1].entries);
  assert.equal(chapters[1].boundary, 'queued'); assert.equal(chapters[1].prompt.id, 'queue');
  assert.deepEqual(chapters[1].entries.map(entry => entry.id), ['turn', 'steer', 'abort']);
  assert.equal(result.stats.turns, 1); assert.equal(result.entries.length, 3);
});

test('recap source guard rejects same-ID replacements, duplicate IDs and eviction', async () => {
  assert.equal(typeof presentation.retainedRecapEntry, 'function');
  const entries = await project(call('read')), expected = structuredClone(entries[0]);
  assert.equal(presentation.retainedRecapEntry(entries, expected), true);
  assert.equal(presentation.retainedRecapEntry([{ ...entries[0], agentId: 'other' }], expected), false);
  assert.equal(presentation.retainedRecapEntry([{ ...entries[0], success: false }], expected), false);
  assert.equal(presentation.retainedRecapEntry([entries[0], entries[0]], expected), false);
  assert.equal(presentation.retainedRecapEntry(entries.slice(1), expected), false);
});

test('recap labels complete-only failures, host errors, delegated failures and interruptions without merging them', async () => {
  const failed = call('orphan')[1]; failed.data.success = false;
  const entries = await project([failed,
    event('hook', 'hook.end', { hookInvocationId: 'hook', hookType: 'preToolUse', success: false }),
    event('error', 'session.error', { message: 'Error' }), event('agent', 'subagent.failed', { error: 'Failure' }),
    event('abort', 'abort'), event('warning', 'session.warning', { message: 'Warning' })]);
  const result = recap(entries);
  assert.deepEqual(result.failures.map(row => [row.key, row.entries.map(entry => entry.id)]),
    [['tools', ['orphan-end']], ['hooks', ['hook']], ['errors', ['error']], ['agents', ['agent']], ['interruptions', ['abort']]]);
  assert.equal(result.stats.tools, 1); assert.equal(result.stats.hooks, 1);
  entries[0].evidence = JSON.stringify({ ...JSON.parse(entries[0].evidence), agentId: 'different' });
  const conflict = recap(entries);
  assert.equal(conflict.failures[0].entries.length, 0); assert.equal(conflict.unknownToolResults.length, 1);
});

test('recap keeps unusable retrieval and protocol identities unknown while retaining Statistics contributors', async () => {
  for (const [id, source] of [[' ', undefined], ['call', ' ']]) {
    const raw = call(id, 'view', { path: 'file' }, source); raw[1].data.success = false;
    const entries = await project(raw), result = recap(entries);
    assert.equal(result.stats.tools, 1); assert.equal(result.metrics.find(row => row.key === 'tools').entries.length, 2);
    assert.equal(result.retrieval.rows.length, 0); assert.equal(result.retrieval.unclassified.length, 1);
    assert.equal(result.failures[0].entries.length, 0); assert.equal(result.unknownToolResults.length, 1);
  }
  const raw = call('call'); raw[1].id = ' '; raw[1].data.success = false;
  const unknown = recap(await project(raw));
  assert.equal(unknown.failures[0].entries.length, 0); assert.equal(unknown.unknownToolResults.length, 1);
});

test('recap cannot link retrieval across conflicting providers but can state a standalone raw failure', async () => {
  const raw = call('call'); raw[1].data.origin = 'custom';
  const entries = await project(raw), result = recap(entries);
  assert.equal(result.retrieval.rows.length, 0); assert.equal(result.retrieval.unclassified.length, 1);
  assert.equal(result.stats.tools, 1);
  raw[1].data.success = false;
  const standalone = recap(await project([raw[1]]));
  assert.equal(standalone.failures[0].entries.length, 1);
  assert.equal(standalone.retrieval.rows.length, 0);
});
