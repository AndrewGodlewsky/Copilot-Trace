import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const event = (id, type, data, agentId) => ({ id, type, timestamp: '2026-11-20T12:00:00Z', data,
  ...(agentId === undefined ? {} : { agentId }) });
const call = (id, args = { path: 'same.txt', view_range: [1, 10] }, success = true, extra = {}, agentId) => [
  event(`${id}-start`, 'tool.execution_start', { toolCallId: id, toolName: 'view', arguments: args, ...extra }, agentId),
  event(`${id}-end`, 'tool.execution_complete', { toolCallId: id, success }, agentId),
];
async function project(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function inspect(entries, options) {
  assert.equal(typeof presentation.repeatedActivity, 'function', 'Retained repetition inspection is available.');
  return presentation.repeatedActivity(entries, options);
}
const mcp = { toolName: 'mcp.read', mcpConfigServerName: 'a', mcpServerDisplayName: 'Shared', mcpToolName: 'read' };

test('protected arguments omitted by the actual projection cannot create false exact repetition', async () => {
  const entries = await project([...call('one', { nested: { encryptedContent: 'first', keep: 'same' } }, true, mcp),
    ...call('two', { nested: { encryptedContent: 'second', keep: 'same' } }, true, mcp)]);
  const result = inspect(entries);
  assert.equal(result.patterns.length, 0); assert.equal(result.unclassifiedCalls, 2);
  assert.match(result.notes.join(' '), /protected.*omission/i);
  for (const marker of ['true', null, 1, undefined]) {
    const unmarked = await project([...call('one', { keep: 'same' }, true, mcp), ...call('two', { keep: 'same' }, true, mcp)]);
    for (const entry of unmarked.filter(entry => entry.type === 'tool.execution_start')) entry.protectedContentOmitted = marker;
    assert.equal(inspect(unmarked).patterns.length, 0); assert.equal(inspect(unmarked).unclassifiedCalls, 2);
  }
});

test('exact repetition counts invocations once, canonicalizes object keys, and keeps tied occurrence order', async () => {
  const entries = await project([...call('one'), ...call('two', { view_range: [1, 10], path: 'same.txt' }),
    ...call('different', { path: 'other.txt', view_range: [1, 10] })]);
  assert.equal(inspect(entries.slice(0, 2)).patterns.length, 0);
  const before = structuredClone(entries), result = inspect(entries), row = result.patterns[0];
  assert.equal(result.patterns.length, 1); assert.equal(row.count, 2);
  assert.deepEqual(row.occurrences.map(item => item.start.id), ['one-start', 'two-start']);
  assert.deepEqual(row.occurrences[0].links.map(link => link.id), ['one-start', 'one-end']);
  assert.equal(row.toolFailures, 0); assert.equal(row.processFailures, 0); assert.deepEqual(entries, before);
  assert.match(row.rule, /object key order/i); assert.match(row.provider, /unknown/i);
});

test('nested JSON equality preserves array order, types, whitespace, newlines and literal Unicode', async () => {
  const args = { nested: { b: [1, 'é日🧪', { y: null, x: true }], a: ' x\n' } };
  const same = { nested: { a: ' x\n', b: [1, 'é日🧪', { x: true, y: null }] } };
  const variations = [
    { nested: { ...args.nested, a: 'x\n' } }, { nested: { ...args.nested, a: ' x' } },
    { nested: { ...args.nested, b: [1, 'e\u0301日🧪', { y: null, x: true }] } },
    { nested: { ...args.nested, b: ['1', 'é日🧪', { y: null, x: true }] } },
    { nested: { ...args.nested, b: [...args.nested.b].reverse() } },
    { nested: { ...args.nested, b: [1, 'é日🧪', { x: true }] } },
  ];
  const raw = [...call('first', args, true, mcp), ...call('same', same, true, mcp),
    ...variations.flatMap((args, index) => call(`different-${index}`, args, true, mcp))];
  const result = inspect(await project(raw));
  assert.equal(result.patterns.length, 1); assert.equal(result.patterns[0].count, 2);
  assert.match(result.patterns[0].provider, /configured.*a.*read/i);
});

test('same display names cannot merge different sources, configured servers, raw tools or unknown providers', async () => {
  const raw = [...call('a', { target: 'x' }, true, mcp, 'agent-a'),
    ...call('b', { target: 'x' }, true, mcp, 'agent-b'),
    ...call('server', { target: 'x' }, true, { ...mcp, mcpConfigServerName: 'b' }, 'agent-a'),
    ...call('tool', { target: 'x' }, true, { ...mcp, mcpToolName: 'other' }, 'agent-a'),
    ...call('raw', { target: 'x' }, true, { ...mcp, toolName: 'other' }, 'agent-a'),
    ...call('legacy', { target: 'x' }, true, { toolName: 'mcp.read', mcpServerName: 'Shared', mcpToolName: 'read' }, 'agent-a'),
    ...call('later', { target: 'x' }, true, mcp, 'agent-a')];
  const result = inspect(await project(raw));
  assert.deepEqual(result.patterns[0].occurrences.map(item => item.start.id), ['a-start', 'later-start']);
  assert.equal(result.patterns.length, 1); assert.equal(result.unclassifiedCalls, 1);
});

test('tool failure, typed process failure, missing result and later success remain separate facts', async () => {
  const args = { command: 'npm test', description: 'Test' }, extra = { toolName: 'powershell' };
  const raw = [...call('failed', args, false, extra), ...call('again', args, false, extra),
    ...call('exit', args, true, extra), ...call('exit-again', args, true, extra),
    ...call('success', args, true, extra), ...call('missing', args, true, extra).slice(0, 1)];
  for (const index of [5, 7]) raw[index].data.result = { contents: [{ type: 'shell_exit', shellId: '0', exitCode: 7 }] };
  raw[9].data.result = { contents: [{ type: 'shell_exit', shellId: '0', exitCode: 0 }] };
  const row = inspect(await project(raw)).patterns[0];
  assert.equal(row.count, 6); assert.equal(row.toolFailures, 2); assert.equal(row.processFailures, 2); assert.equal(row.missingResults, 1);
  assert.deepEqual(row.occurrences.map(item => item.toolSuccess), [false, false, true, true, true, null]);
  assert.deepEqual(row.occurrences.map(item => item.exitCode), [null, null, 7, 7, 0, null]);
  assert.equal(row.occurrences.at(-1).resultState, 'missing');
  for (const provider of [mcp, { ...mcp, toolName: 'powershell' }]) {
    const events = [...call('m1', args, true, provider), ...call('m2', args, true, provider)];
    for (const index of [1, 3]) events[index].data.result = { contents: [{ type: 'shell_exit', shellId: '0', exitCode: 7 }] };
    assert.equal(inspect(await project(events)).patterns[0].processFailures, 0);
  }
});

test('conflicting results preserve known starts but cannot contribute failures or result links', async () => {
  const base = await project([...call('one', undefined, false), ...call('two', undefined, false)]);
  for (const mutate of [raw => { raw.agentId = 'other'; }, raw => { raw.data.toolCallId = 'other'; },
    raw => { raw.data.toolName = 'other'; }, raw => { raw.data.mcpConfigServerName = 'other'; },
    raw => { raw.data.origin = 'native'; }, raw => { raw.data.success = true; }]) {
    const entries = structuredClone(base), raw = JSON.parse(entries[1].evidence); mutate(raw); entries[1].evidence = JSON.stringify(raw);
    const row = inspect(entries).patterns[0]; assert.equal(row.count, 2); assert.equal(row.toolFailures, 1);
    assert.equal(row.occurrences[0].resultState, 'unknown'); assert.deepEqual(row.occurrences[0].links.map(link => link.id), ['one-start']);
  }
  for (const mutate of [entry => { entry.evidence = '{'; }, entry => { entry.truncated = true; }]) {
    const entries = structuredClone(base); mutate(entries[1]);
    assert.equal(inspect(entries).patterns[0].toolFailures, 1);
  }
});

test('ambiguous, clipped, unsupported and reused invocation identities remain unclassified', async () => {
  const base = await project([...call('one'), ...call('two')]);
  for (const mutate of [entries => entries.push({ ...entries[0] }), entries => entries.push({ ...entries[1] }),
    entries => { entries[0].id = ' '; }, entries => { entries[0].agentId = null; },
    entries => { entries[0].truncated = true; }, entries => { entries[0].evidence = '{'; },
    entries => { [entries[0], entries[1]] = [entries[1], entries[0]]; },
    entries => { const raw = JSON.parse(entries[0].evidence); raw.data.arguments.extra = true; entries[0].evidence = JSON.stringify(raw); }]) {
    const entries = structuredClone(base); mutate(entries);
    const result = inspect(entries); assert.equal(result.patterns.length, 0);
    assert.ok(result.unclassifiedCalls + result.unlinkedBoundaries > 0);
  }
});

test('canonical matching bounds nested depth, node count and characters without truncating identity', async () => {
  let deep = null; for (let i = 0; i < 20; i++) deep = { nested: deep };
  for (const args of [{ deep }, { nodes: Array(600).fill(null) }, { text: 'x'.repeat(8500) }]) {
    const result = inspect(await project([...call('one', args, true, mcp), ...call('two', args, true, mcp)]));
    assert.equal(result.patterns.length, 0); assert.equal(result.unclassifiedCalls, 2);
    assert.match(result.notes.join(' '), /depth.*12.*512.*8,000/i);
  }
});

test('retention eviction changes counts, result-only evidence cannot invent calls, and scope remains partial', async () => {
  const entries = await project([...call('one'), ...call('two'), ...call('three')]);
  assert.equal(inspect(entries).patterns[0].count, 3);
  const result = inspect(entries.slice(1), { history: 'unavailable', omitted: 19 });
  assert.equal(result.patterns[0].count, 2); assert.equal(result.unclassifiedCalls, 1);
  assert.equal(inspect(entries.slice(3)).patterns.length, 0);
  assert.match(result.notes.join(' '), /history.*unavailable/i); assert.match(result.notes.join(' '), /19.*omitted/i);
  assert.match(result.notes.join(' '), /300.*retained/i);
});

test('duplicate call IDs with different event IDs are ambiguous and the helper enforces its retained window bound', async () => {
  const base = await project([...call('one'), ...call('two')]);
  const reused = structuredClone(base[0]), raw = JSON.parse(reused.evidence);
  reused.id = raw.id = 'reused-start'; reused.evidence = JSON.stringify(raw);
  assert.equal(inspect([...base, reused]).patterns.length, 0);
  const filler = Array.from({ length: 300 }, (_, index) => ({ id: `filler-${index}`, type: 'session.info' }));
  const result = inspect([...base, ...filler]);
  assert.equal(result.patterns.length, 0); assert.match(result.notes.join(' '), /4 additional supplied events.*outside/i);
});

test('unsupported metadata, nonfinite JSON numbers and conflicting typed statuses do not create false certainty', async () => {
  for (const extra of [{ origin: 'native' }, { overridesBuiltInTool: false }, { ...mcp, mcpServerName: null }]) {
    const args = extra.mcpToolName ? { target: 'x' } : { path: 'x' };
    const result = inspect(await project([...call('one', args, true, extra), ...call('two', args, true, extra)]));
    assert.equal(result.patterns.length, 0); assert.equal(result.unclassifiedCalls, 2);
  }
  const entries = await project([...call('one', { number: 1 }, true, mcp), ...call('two', { number: 1 }, true, mcp)]);
  entries[0].evidence = entries[0].evidence.replace(/"number":\s*1/, '"number":1e400');
  assert.equal(inspect(entries).patterns.length, 0);
  const args = { command: 'npm test', description: 'Test' };
  for (const contents of [[], [{ type: 'shell_exit', shellId: '0', exitCode: '7' }],
    [{ type: 'shell_exit', shellId: '0', exitCode: 7 }, { type: 'shell_exit', shellId: '0', exitCode: 0 }]]) {
    const raw = [...call('one', args, true, { toolName: 'powershell' }), ...call('two', args, true, { toolName: 'powershell' })];
    for (const index of [1, 3]) raw[index].data.result = { content: 'exit code 7; tests failed', contents };
    const pattern = inspect(await project(raw)).patterns[0];
    assert.equal(pattern.processFailures, 0); assert.equal(pattern.toolFailures, 0);
    assert.deepEqual(pattern.occurrences.map(item => item.exitCode), [null, null]);
  }
});

test('original occurrence snapshots remain frozen when callers replace or mutate retained evidence', async () => {
  const entries = await project([...call('one'), ...call('two')]);
  const start = inspect(entries).patterns[0].occurrences[0].start;
  assert.equal(Object.isFrozen(start), true); const evidence = start.evidence;
  entries[0].evidence = '{}'; assert.equal(start.evidence, evidence);
});
