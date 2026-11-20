import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const event = (id, type, data, agentId) => ({ id, type, timestamp: '2026-11-20T12:00:00Z', data, ...(agentId === undefined ? {} : { agentId }) });
const call = (id, args = { path: 'same.txt', view_range: [1, 10] }, success = false, extra = {}, agentId) => [
  event(`${id}-start`, 'tool.execution_start', { toolCallId: id, toolName: 'view', arguments: args, ...extra }, agentId),
  event(`${id}-end`, 'tool.execution_complete', { toolCallId: id, success, ...(success
    ? { result: { content: `Result ${id} <script>日🧪</script>` } } : { error: { message: `Failure ${id}`, code: 'cancelled' } }) }, agentId),
];
async function project(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function inspect(entries, options) {
  assert.equal(typeof presentation.recoveryAttempts, 'function', 'Related-attempt inspection is available.');
  return presentation.recoveryAttempts(entries, options);
}

test('changed options on the same literal target are suggestions, preserving original failure and later result', async () => {
  const entries = await project([...call('first'), ...call('unrelated', { path: 'other.txt' }, true),
    ...call('later', { path: 'same.txt', view_range: [20, 30] }, true)]);
  const before = structuredClone(entries), rows = inspect(entries), row = rows[0];
  assert.equal(row.anchorId, 'first-end');
  assert.deepEqual(row.candidates.map(item => item.id), ['later-start']);
  assert.equal(row.original.outcome, 'failure'); assert.equal(row.candidates[0].outcome, 'success');
  assert.equal(row.original.arguments, JSON.stringify({ path: 'same.txt', view_range: [1, 10] }, null, 2));
  assert.equal(row.candidates[0].arguments, JSON.stringify({ path: 'same.txt', view_range: [20, 30] }, null, 2));
  assert.match(row.original.result, /Failure first/); assert.match(row.candidates[0].result, /<script>日🧪/);
  assert.match(row.rule, /same.*source.*tool.*path/i); assert.match(row.notes.join(' '), /suggestion.*not.*retry/i);
  assert.deepEqual(entries, before);
});

test('exact source and provider evidence separate same-name agents, MCP servers and unrelated shell commands', async () => {
  const provider = { toolName: 'mcp.read', mcpConfigServerName: 'server-a', mcpServerDisplayName: 'Shared', mcpToolName: 'read' };
  const entries = await project([...call('first', { target: 'a' }, false, provider, 'agent-a'),
    ...call('other-agent', { target: 'a' }, true, provider, 'agent-b'),
    ...call('other-provider', { target: 'a' }, true, { ...provider, mcpConfigServerName: 'server-b' }, 'agent-a'),
    ...call('later', { target: 'a' }, true, provider, 'agent-a'),
    ...call('shell-failed', { command: 'npm test', description: 'Test' }, false, { toolName: 'powershell' }),
    ...call('shell-unrelated', { command: 'npm run build', description: 'Build' }, true, { toolName: 'powershell' }),
    ...call('shell-later', { command: 'npm test', description: 'Again', initial_wait: 60 }, true, { toolName: 'powershell' })]);
  const rows = inspect(entries);
  assert.deepEqual(rows[0].candidates.map(item => item.id), ['later-start']);
  assert.match(rows[0].original.provider, /server-a/);
  assert.deepEqual(rows[1].candidates.map(item => item.id), ['shell-later-start']);
  assert.match(rows[1].original.provider, /unknown/i);
});

test('typed denial and cancellation stay separate from result and abort does not cancel tools', async () => {
  const raw = [...call('denied').slice(0, 1), event('deny', 'permission.completed', {
    requestId: 'denial', toolCallId: 'denied', result: { kind: 'denied-by-rules' } }),
    ...call('cancel').slice(0, 1), event('cancelled', 'permission.completed', {
      requestId: 'cancellation', toolCallId: 'cancel', result: { kind: 'cancelled' } }),
    ...call('open').slice(0, 1), event('abort', 'abort', { reason: 'stopped' }), ...call('success', undefined, true)];
  const rows = inspect(await project(raw));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].original.permission, 'Recorded permission: denied');
  assert.equal(rows[1].original.permission, 'Recorded permission: cancelled');
  assert.equal(rows[0].original.outcome, 'unknown'); assert.equal(rows[1].original.outcome, 'unknown');
  assert.ok(rows[0].original.links.some(link => link.entry.id === 'deny'));
  assert.match(rows[0].original.notes.join(' '), /result.*not retained/i);
});

test('ambiguous identities, malformed, clipped and result-before-start records never become suggestions', async () => {
  const normal = await project([...call('first'), ...call('later', undefined, true)]);
  for (const mutate of [
    entries => entries.push({ ...entries[2], id: 'reused', evidence: entries[2].evidence.replace('later-start', 'reused') }),
    entries => entries.push({ ...entries[2] }),
    entries => { entries[2].agentId = null; },
    entries => { entries[2].toolCallId = 'x'.repeat(257); },
    entries => { entries[2].truncated = true; },
    entries => { entries[2].evidence = '{'; },
    entries => { [entries[2], entries[3]] = [entries[3], entries[2]]; },
  ]) {
    const entries = structuredClone(normal); mutate(entries);
    assert.equal(inspect(entries)[0].candidates.length, 0);
  }
  const clippedResult = structuredClone(normal); clippedResult[3].truncated = true;
  const candidate = inspect(clippedResult)[0].candidates[0];
  assert.equal(candidate.outcome, 'unknown'); assert.equal(candidate.result, null);
  assert.match(candidate.notes.join(' '), /clipped|incomplete/i);
});

test('missing starts and retention never recreate arguments or missing attempts; candidates are bounded', async () => {
  const entries = await project([...call('first'), ...Array.from({ length: 12 }, (_, index) => call(`later-${index}`, undefined, true)).flat()]);
  const row = inspect(entries, { omitted: 20, history: 'unavailable' })[0];
  assert.equal(row.candidates.length, 3); assert.equal(row.omittedCandidates, 9);
  assert.match(row.notes.join(' '), /retained.*missing.*attempts/i);
  const partial = inspect(entries.slice(1), { omitted: 21 })[0];
  assert.equal(partial.original.arguments, null); assert.equal(partial.candidates.length, 0);
  assert.match(partial.original.notes.join(' '), /start.*not retained/i);
  assert.equal(inspect(entries.slice(2), { omitted: 22 }).length, 0);
});

test('target matching is literal and rejects unsupported shapes, display-only providers and changed MCP arguments', async () => {
  for (const extra of [{ arguments: { path: 'same.txt', invented: true } }, { arguments: { path: 'SAME.txt' } },
    { mcpServerName: 'Display', mcpToolName: 'view' }, { mcpConfigServerName: 'server', mcpToolName: 'view' }]) {
    const entries = await project([...call('first'), ...call('later', undefined, true, extra)]);
    assert.equal(inspect(entries)[0].candidates.length, 0);
  }
  const provider = { toolName: 'mcp.read', mcpConfigServerName: 'server', mcpToolName: 'read' };
  const entries = await project([...call('first', { target: 'a' }, false, provider), ...call('later', { target: 'b' }, true, provider)]);
  assert.equal(inspect(entries)[0].candidates.length, 0);
});

test('later means after the failure, with no borrowed retry, chronology or error-code meaning', async () => {
  const first = call('first'), parallel = call('parallel', undefined, true), later = call('later', { path: 'other.txt' }, true);
  later[0].parentId = first[1].id;
  later[0].data.retryAttempt = 1; later[0].data.retryGuidance = 'retry';
  later[1].data.causalDependencies = ['first'];
  const rows = inspect(await project([first[0], parallel[0], first[1], parallel[1], ...later]));
  assert.equal(rows[0].candidates.length, 0);
  assert.equal(rows[0].original.outcome, 'failure');
  assert.equal(rows[0].original.permission, 'Permission unknown', 'An open error code named cancelled is not a typed permission cancellation.');
});

test('result-only failures and late missing results remain inspectable without fabricating matching inputs', async () => {
  const entries = await project([...call('first'), ...call('later').slice(0, 1)]);
  const row = inspect(entries)[0]; assert.equal(row.candidates.length, 1);
  assert.equal(row.candidates[0].outcome, 'unknown'); assert.equal(row.candidates[0].result, null);
  const partial = inspect(entries.slice(1))[0]; assert.equal(partial.original.outcome, 'failure');
  assert.equal(partial.original.arguments, null); assert.equal(partial.candidates.length, 0);
  assert.deepEqual(partial.original.links.map(link => link.entry.id), ['first-end']);
});

test('duplicate decisions do not establish permission and suggested source links are bounded', async () => {
  const raw = [...call('first'), ...call('later', undefined, true)];
  for (let index = 0; index < 10; index++) raw.push(event(`permission-${index}`, 'permission.completed', {
    requestId: `permission-${index}`, toolCallId: 'later', result: { kind: 'approved' } }));
  const row = inspect(await project(raw))[0];
  assert.equal(row.candidates[0].links.length, 5);
  assert.match(row.candidates[0].notes.join(' '), /7 additional permission decisions.*not linked/);
  const entries = await project([...call('first'), event('denial', 'permission.completed', {
    requestId: 'deny', toolCallId: 'first', result: { kind: 'denied-by-rules' } })]);
  entries.push({ ...entries.at(-1) });
  assert.equal(inspect(entries)[0].original.permission, 'Permission unknown');
});

test('documented target fields allow changed supported options without normalizing their values', async () => {
  for (const [toolName, before, after] of [
    ['edit', { path: 'same.txt', old_str: 'A', new_str: 'B' }, { path: 'same.txt', old_str: 'C', new_str: 'D' }],
    ['grep', { pattern: 'needle', paths: ['src'], head_limit: 1 }, { pattern: 'needle', paths: ['src'], head_limit: 10 }],
    ['web_fetch', { url: 'https://example.test/%41', max_length: 20 }, { url: 'https://example.test/%41', start_index: 20 }],
  ]) {
    const entries = await project([...call('first', before, false, { toolName }), ...call('later', after, true, { toolName })]);
    assert.equal(inspect(entries)[0].candidates.length, 1, toolName);
  }
  const url = await project([...call('first', { url: 'https://example.test/%41' }, false, { toolName: 'web_fetch' }),
    ...call('later', { url: 'https://example.test/A' }, true, { toolName: 'web_fetch' })]);
  assert.equal(inspect(url)[0].candidates.length, 0);
});
