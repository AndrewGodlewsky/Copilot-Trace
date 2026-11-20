import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const mcp = { toolName: 'mcp.query', mcpConfigServerName: 'service-a', mcpToolName: 'query', mcpServerDisplayName: 'Shared' };
const event = (id, args, extra = {}, agentId) => ({ id: `${id}-start`, type: 'tool.execution_start', timestamp: '2026-11-20T12:00:00Z',
  ...(agentId === undefined ? {} : { agentId }), data: { toolCallId: id, toolName: 'view', arguments: args, ...extra } });
async function project(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function calls(entries) {
  assert.equal(typeof presentation.argumentComparisonCalls, 'function', 'Retained argument comparison choices exist.');
  return presentation.argumentComparisonCalls(entries);
}
function compare(entries) { const [a, b] = calls(entries); return presentation.compareToolArguments(a, b); }

test('ordinary compatible requests show changed, added, removed and identical literal fields across explicitly chosen sources', async () => {
  const entries = await project([event('a', { path: 'first.txt', view_range: [1, 10] }),
    event('b', { path: 'second.txt', forceReadLargeFiles: false }, {}, 'agent-b')]);
  const [a, b] = calls(entries), diff = presentation.compareToolArguments(a, b);
  assert.equal(diff.status, 'compared'); assert.equal(a.start.agentId, ''); assert.equal(b.start.agentId, 'agent-b');
  assert.deepEqual(diff.rows.map(row => [row.path, row.status, row.before, row.after]), [
    ['["forceReadLargeFiles"]', 'added', 'Absent', 'false'],
    ['["path"]', 'changed', '"first.txt"', '"second.txt"'],
    ['["view_range"]', 'removed', '[1,10]', 'Absent'],
  ]);
  assert.match(diff.note, /implementation.*unknown/i);
  assert.equal(presentation.compareToolArguments(a, a).status, 'unavailable');
  assert.equal(presentation.retainedArgumentCall(entries, a), true);
});

test('MCP literal JSON supports absent versus null, nested own keys, array indexes and unordered object keys', async () => {
  const left = JSON.parse('{"__proto__":{"constructor":null},"a.b":1,"a":{"b":1},"a/b\\\"":null,"array":["one",null],"gone":null}');
  const right = JSON.parse('{"array":[null,"one",null],"a":{"b":1},"a.b":2,"__proto__":{"constructor":null},"new":null}');
  const result = compare(await project([event('a', left, mcp), event('b', right, mcp)]));
  assert.equal(result.status, 'compared'); assert.match(result.note, /literal JSON.*historical.*schema.*unknown/i);
  assert.deepEqual(result.rows.map(row => [row.path, row.status]), [
    ['["__proto__"]["constructor"]', 'identical'], ['["a"]["b"]', 'identical'], ['["a.b"]', 'changed'],
    ['["a/b\\\""]', 'removed'], ['["array"][0]', 'changed'], ['["array"][1]', 'changed'], ['["array"][2]', 'added'],
    ['["gone"]', 'removed'], ['["new"]', 'added'],
  ]);
  assert.equal(result.rows.at(-1).before, 'Absent'); assert.equal(result.rows.at(-1).after, 'null');
  assert.equal(result.rows.at(-2).before, 'null'); assert.equal(result.rows.at(-2).after, 'Absent');
  const reordered = compare(await project([event('a', { z: [1, 2], a: {} }, mcp), event('b', { a: {}, z: [1, 2] }, mcp)]));
  assert.equal(reordered.rows.every(row => row.status === 'identical'), true);
});

test('multiline commands, Unicode and HTML-like strings remain exact JSON literals without normalization', async () => {
  const first = 'echo "<script>日🧪é</script>"\n  next';
  const second = 'echo "<script>日🧪e\u0301</script>"\n next';
  const result = compare(await project([event('a', { command: first, description: 'Run' }, { toolName: 'powershell' }),
    event('b', { command: second, description: 'Run' }, { toolName: 'powershell' })]));
  assert.equal(result.rows[0].before, JSON.stringify(first)); assert.equal(result.rows[0].after, JSON.stringify(second));
  assert.equal(result.rows[0].status, 'changed'); assert.equal(result.rows[1].status, 'identical');
});

test('incompatible tool/provider contracts, invalid ordinary fields and incomplete evidence cannot claim precise changes', async () => {
  for (const raw of [
    [event('a', { path: 'a' }), event('b', { pattern: 'b' }, { toolName: 'grep' })],
    [event('a', { path: 'a' }), event('b', { path: 'a', unknown: 1 })],
    [event('a', { path: 'a' }), event('b', { path: null })],
    [event('a', { path: 'a' }), event('b', { path: 'b' }, { origin: 'plugin' })],
    [event('a', { x: 1 }, mcp), event('b', { x: 2 }, { ...mcp, mcpConfigServerName: 'service-b' })],
    [event('a', { x: 1 }, mcp), event('b', { x: 2 }, { ...mcp, mcpToolName: 'different' })],
    [event('a', { x: 1 }, mcp), event('b', { x: 2 }, { ...mcp, toolName: 'different' })],
    [event('a', { x: 1 }, mcp), event('b', { x: 2 }, { toolName: 'mcp.query', mcpServerName: 'Shared', mcpToolName: 'query' })],
    [event('a', { x: 1 }, mcp), event('b', { x: 2 }, { ...mcp, mcpTransport: 'http' })],
  ]) {
    const result = compare(await project(raw)); assert.equal(result.status, 'unavailable'); assert.deepEqual(result.rows, []);
  }
  for (const mutation of [entry => { entry.truncated = true; }, entry => { entry.evidence = '{'; },
    entry => { entry.toolName = 'changed'; }, entry => { entry.toolCallId = 'changed'; }, entry => { entry.agentId = 'changed'; }]) {
    const entries = await project([event('a', { path: 'a' }), event('b', { path: 'b' })]); mutation(entries[1]);
    assert.equal(compare(entries).status, 'unavailable');
  }
});

test('bounds explicitly reject large/deep inputs and omit rows or display values without claiming visible completeness', async () => {
  let deep = null; for (let i = 0; i < 14; i++) deep = { nested: deep };
  for (const args of [{ text: 'x'.repeat(8100) }, { many: Array(513).fill(null) }, deep]) {
    const result = compare(await project([event('a', { x: 1 }, mcp), event('b', args, mcp)]));
    assert.equal(result.status, 'unavailable'); assert.match(result.note, /bound|limit|clipped/i);
  }
  const many = Object.fromEntries(Array.from({ length: 90 }, (_, i) => [`field-${String(i).padStart(2, '0')}`, i]));
  const result = compare(await project([event('a', many, mcp), event('b', many, mcp)]));
  assert.equal(result.rows.length, 80); assert.equal(result.omittedRows, 10);
  const long = compare(await project([event('a', { text: 'a'.repeat(2000) }, mcp), event('b', { text: 'b'.repeat(2000) }, mcp)]));
  assert.equal(long.rows[0].status, 'changed'); assert.equal(long.rows[0].before, null); assert.equal(long.rows[0].after, null);
  assert.equal(long.omittedValues, 2); assert.match(long.note, /original/i);
  const wide = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`field-${i}`, 'x'.repeat(180)]));
  const budget = compare(await project([event('a', wide, mcp), event('b', wide, mcp)]));
  assert.equal(budget.rows.length, 40); assert.ok(budget.omittedValues > 0);
  assert.ok(budget.rows.reduce((total, row) => total + row.path.length + (row.before?.length || 0) + (row.after?.length || 0), 0) <= 12000);
});

test('frozen original guards reject reused, duplicated, evicted or conflicting source/call evidence and permit normal arrivals', async () => {
  const entries = await project([event('a', { path: 'a' }), event('b', { path: 'b' })]), selected = calls(entries)[0];
  const mutations = [items => items.shift(), items => items.push({ ...items[0] }),
    items => { items[0].evidence += ' '; }, items => { items[0].toolCallId = 'other'; },
    items => { items[0].timestamp = 'changed'; }, items => { items[0].agentId = 'changed'; },
    items => { items.push({ ...items[0], id: 'duplicate-call' }); }];
  for (const mutate of mutations) {
    const next = structuredClone(entries); mutate(next); assert.equal(presentation.retainedArgumentCall(next, selected), false);
  }
  const arrival = await project([...entries.map(entry => JSON.parse(entry.evidence)),
    { id: 'a-end', type: 'tool.execution_complete', data: { toolCallId: 'a', success: true } }]);
  assert.equal(presentation.retainedArgumentCall(arrival, selected), true);
  const duplicates = [...arrival, { ...arrival.at(-1), id: 'other-end' }];
  assert.equal(presentation.retainedArgumentCall(duplicates, selected), false);
  assert.equal(selected.start.evidence, entries[0].evidence);
});

test('protected argument suppression through the actual projection blocks identical-value claims and leaves originals explicitly incomplete', async () => {
  for (const argumentsFor of [value => ({ encryptedContent: value, keep: 'same' }),
    value => ({ nested: { reasoningOpaque: value, keep: 'same' } }),
    value => ({ array: [{ encryptedContent: value }], keep: 'same' })]) {
    const entries = await project([event('a', argumentsFor('protected-one'), mcp), event('b', argumentsFor('protected-two'), mcp)]);
    const [a, b] = calls(entries), result = presentation.compareToolArguments(a, b);
    assert.equal(result.status, 'unavailable'); assert.deepEqual(result.rows, []);
    assert.match(result.note, /protected.*omitted.*original.*incomplete/is);
    assert.doesNotMatch(a.start.evidence + b.start.evidence, /protected-one|protected-two/);
    assert.equal(presentation.retainedArgumentCall(entries, a), true, 'The safe remaining original stays navigable with its omission caveat.');
    for (const marker of [false, undefined]) {
      const changed = structuredClone(entries); changed[0].protectedContentOmitted = marker;
      assert.equal(presentation.retainedArgumentCall(changed, a), false, 'A changed completeness marker invalidates a frozen original.');
    }
  }
});

test('malformed omission-marker types cannot establish complete comparable arguments', async () => {
  for (const marker of ['true', 1, null, undefined, {}]) {
    const entries = await project([event('a', { keep: 'same' }, mcp), event('b', { keep: 'same' }, mcp)]);
    entries[0].protectedContentOmitted = marker;
    const result = compare(entries);
    assert.equal(result.status, 'unavailable'); assert.match(result.note, /omission.*invalid.*complete.*unknown/is);
  }
});
