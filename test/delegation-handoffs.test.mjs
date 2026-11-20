import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

function event(id, type, agentId, data = {}, extra = {}) {
  return { id, type, timestamp: '2026-11-20T12:00:00Z', ...(agentId === '' ? {} : { agentId }), data, ...extra };
}
function delegation(child = 'child', call = 'call', parent = '', text = 'Exact <task> 🧪\r\n日') {
  return [
    event(`${child}-task`, 'tool.execution_start', parent, { toolCallId: call, toolName: 'task',
      arguments: { name: child, description: `Description ${text}`, prompt: text, agent_type: 'fixture', mode: 'sync' } }),
    event(`${child}-start`, 'subagent.started', child, { toolCallId: call, agentName: 'fixture', agentDisplayName: 'Same name',
      agentType: 'fixture', executionMode: 'sync', ...(parent ? { parentId: parent } : {}) }),
    event(`${child}-turn`, 'assistant.turn_start', child, { turnId: '0', parentToolCallId: call }),
    event(`${child}-message`, 'assistant.message', child, { content: 'Child activity', parentToolCallId: call }),
    event(`${child}-end`, 'subagent.completed', child, { toolCallId: call, agentName: 'fixture', cancelled: false }),
    event(`${child}-result`, 'tool.execution_complete', parent, { toolCallId: call, success: true, result: { content: `Result ${text}` } }),
  ];
}
async function projected(records) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => records });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function handoffs(entries, options) {
  assert.equal(typeof presentation.delegationHandoffs, 'function', 'Delegations expose a tested linked-evidence contract.');
  return presentation.delegationHandoffs(entries, options);
}

test('overlapping and nested same-name delegations keep exact source, call, literal text and original chronology', async () => {
  const a = delegation('a'), b = delegation('b', 'second'), leaf = delegation('leaf', 'inner', 'a');
  const entries = await projected([a[0], a[1], b[0], b[1], a[2], ...leaf, a[3], b[2], b[3], a[4], a[5], b[4], b[5]]);
  const rows = handoffs(entries);
  assert.deepEqual(rows.map(row => [row.agentId, row.parentAgentId, row.toolCallId, row.status, row.lifecycle]), [
    ['a', '', 'call', 'linked', 'completed'], ['b', '', 'second', 'linked', 'completed'], ['leaf', 'a', 'inner', 'linked', 'completed'],
  ]);
  for (const row of rows) {
    assert.equal(row.anchorId, row.entries[0].id);
    assert.equal(row.handoff.status, 'complete'); assert.equal(row.handoff.prompt, 'Exact <task> 🧪\r\n日');
    assert.equal(row.handoff.description, 'Description Exact <task> 🧪\r\n日');
    assert.equal(row.result.status, 'complete'); assert.equal(row.result.content, 'Result Exact <task> 🧪\r\n日');
    assert.equal(row.result.success, true);
    assert.equal(row.parentStart.id, `${row.agentId}-task`); assert.equal(row.parentResult.id, `${row.agentId}-result`);
    assert.deepEqual(row.links.map(link => link.entry), entries.filter(entry => row.entries.includes(entry) || entry === row.parentStart || entry === row.parentResult));
    assert.match(row.notes.join(' '), /separate context.*does not prove.*file.*instruction.*parent message/i);
    assert.match(row.result.note, /parent.*result.content.*not.*correctness/i);
  }
  assert.deepEqual(entries.map(entry => entry.id), [a[0], a[1], b[0], b[1], a[2], ...leaf, a[3], b[2], b[3], a[4], a[5], b[4], b[5]].map(entry => entry.id));
});

test('unlinked children remain inspectable without proximity or display-name assignment', async () => {
  const raw = delegation(); raw[1].data.toolCallId = 'missing'; raw[2].data.parentToolCallId = 'missing';
  raw[3].data.parentToolCallId = 'missing'; raw[4].data.toolCallId = 'missing'; raw[1].parentId = raw[0].id;
  const [row] = handoffs(await projected(raw));
  assert.equal(row.status, 'unlinked'); assert.equal(row.parentAgentId, null); assert.equal(row.parentStart, null);
  assert.equal(row.handoff.prompt, null); assert.equal(row.result.content, null);
  assert.deepEqual(row.links.map(link => link.entry.id), raw.slice(1, 5).map(entry => entry.id));
  assert.match(row.notes.join(' '), /parent unknown.*names.*chronolog/i);
});

test('missing and late parent results are independent of child completion, failure and cancellation', async () => {
  for (const [kind, cancelled, lifecycle] of [['completed', false, 'completed'], ['completed', true, 'cancelled'], ['failed', undefined, 'failed']]) {
    const raw = delegation(); raw[4].type = `subagent.${kind}`; raw[4].data.cancelled = cancelled;
    raw[4].data.error = '<failure> 🧪'; raw[5].data.success = lifecycle === 'completed';
    const entries = await projected(raw);
    const [before] = handoffs(entries.slice(0, -1));
    assert.equal(before.lifecycle, lifecycle); assert.equal(before.result.status, 'unavailable');
    assert.match(before.result.note, /result not retained.*late.*does not mean.*running/i);
    const [after] = handoffs(entries);
    assert.equal(after.lifecycle, lifecycle); assert.equal(after.result.content, 'Result Exact <task> 🧪\r\n日');
    assert.equal(after.result.success, lifecycle === 'completed');
  }
  assert.equal(handoffs((await projected(delegation())).slice(0, 4))[0].lifecycle, 'missing');
});

test('duplicate, reused and conflicting child, call and parent identities suppress ambiguous associations', async () => {
  const raw = delegation();
  for (const mutate of [
    records => records.splice(2, 0, { ...records[1], id: 'duplicate' }),
    records => records.push({ ...records[4], id: 'duplicate' }),
    records => records.splice(1, 0, { ...records[0], id: 'duplicate' }),
    records => records.push({ ...records[5], id: 'duplicate' }),
    records => { records[4].data.toolCallId = 'different'; },
    records => { records[2].data.parentToolCallId = 'different'; },
    records => { records[1].data.parentId = 'different'; },
    records => { records[4].data.agentName = 'different'; },
    records => { records.unshift(records.pop()); },
  ]) {
    const records = structuredClone(raw); mutate(records);
    const [row] = handoffs(await projected(records));
    assert.equal(row.status, 'conflict', JSON.stringify(records));
    assert.equal(row.handoff.prompt, null); assert.equal(row.result.content, null);
  }
  const reused = await projected([...delegation('a'), ...delegation('b', 'call')]);
  assert.ok(handoffs(reused).every(row => row.status === 'conflict'));
  const entries = await projected(raw);
  assert.equal(handoffs([...entries, entries[4]])[0].status, 'conflict');
});

test('same call IDs across distinct explicitly recorded parent sources stay separate', async () => {
  const root = delegation('middle', 'outer'), a = delegation('a', 'shared'), b = delegation('b', 'shared', 'middle');
  const rows = handoffs(await projected([...root.slice(0, 3), ...a, ...b, ...root.slice(3)]));
  assert.deepEqual(rows.filter(row => ['a', 'b'].includes(row.agentId)).map(row => [row.agentId, row.parentAgentId, row.status]),
    [['a', '', 'linked'], ['b', 'middle', 'linked']]);
});

test('invalid source and call IDs, clipped or mismatched raw evidence cannot supply handoff text', async () => {
  for (const value of [undefined, null, '', ' ', 1, {}, [], 'x'.repeat(257)]) {
    const raw = delegation(); for (const entry of raw) {
      if (entry.data.toolCallId !== undefined) entry.data.toolCallId = value;
      if (entry.data.parentToolCallId !== undefined) entry.data.parentToolCallId = value;
    }
    assert.ok(handoffs(await projected(raw)).every(row => row.status !== 'linked'));
    if (value === undefined) continue; // An absent envelope source means main, as declared by the SDK.
    const source = delegation(); for (const entry of source.slice(1, 5)) entry.agentId = value;
    assert.ok(handoffs(await projected(source)).every(row => row.status !== 'linked'));
  }
  const entries = await projected(delegation());
  for (const change of [{ truncated: true }, { evidence: '{' }, { evidence: 'null' }, { evidence: '[]' },
    { evidence: ' '.repeat(12001) }, { toolCallId: 'other' }, { agentId: 'other' },
    ...['id', 'type', 'timestamp', 'agentId'].map(key => ({ evidence: JSON.stringify({ ...JSON.parse(entries[0].evidence), [key]: 'other' }) }))]) {
    const [row] = handoffs([{ ...entries[0], ...change }, ...entries.slice(1)]);
    assert.equal(row.handoff.status, 'unavailable'); assert.equal(row.handoff.prompt, null);
  }
});

test('partial retained history and unavailable task contracts retain honest distinct content states', async () => {
  const entries = await projected(delegation());
  const [partial] = handoffs(entries.slice(1), { history: 'loading', omitted: 1 });
  assert.equal(partial.handoff.status, 'unavailable'); assert.equal(partial.result.content, null);
  assert.match(partial.notes.join(' '), /history.*incomplete.*older events.*omitted/i);
  const [childOnly] = handoffs(entries.slice(2, 4));
  assert.equal(childOnly.parentAgentId, null); assert.equal(childOnly.lifecycle, 'missing');
  for (const mutate of [
    records => { records[0].data.toolName = 'custom_task'; },
    records => { records[0].data.mcpToolName = 'task'; records[0].data.mcpServerName = 'fixture'; },
    records => { records[0].data.arguments = '{"prompt":"not an object"}'; },
    records => { records[0].data.arguments.mode = 'background'; },
    records => { records[0].data.arguments.agent_type = 'other'; },
    records => { records[0].data.arguments.prompt = 1; },
  ]) {
    const raw = delegation(); mutate(raw); const [row] = handoffs(await projected(raw));
    assert.equal(row.handoff.status, 'unavailable'); assert.equal(row.result.content, null);
    assert.match(row.handoff.note, /contract.*unrecognized|unrecognized.*contract/i);
  }
  const empty = delegation(); empty[0].data.arguments.prompt = ''; empty[0].data.arguments.description = ''; empty[5].data.result.content = '';
  const [row] = handoffs(await projected(empty));
  assert.equal(row.handoff.status, 'empty'); assert.equal(row.result.status, 'empty'); assert.equal(row.result.content, '');
  for (const content of [undefined, null, 4, {}, []]) {
    const raw = delegation(); raw[5].data.result.content = content;
    assert.equal(handoffs(await projected(raw))[0].result.status, 'unavailable');
  }
});

test('bounded retained bodies stay literal and never reconstruct clipped evidence', async () => {
  const text = '# <script>🧪</script>\r\n' + '日'.repeat(3000);
  const [row] = handoffs(await projected(delegation('child', 'call', '', text)));
  assert.equal(row.handoff.prompt, text); assert.equal(row.result.content, `Result ${text}`);
  for (const target of [0, 5]) {
    const raw = delegation(); raw[target].data.padding = 'x'.repeat(13000);
    const [clipped] = handoffs(await projected(raw));
    assert.equal(target === 0 ? clipped.handoff.prompt : clipped.result.content, null);
    assert.match(target === 0 ? clipped.handoff.note : clipped.result.note, /clipped.*12,000 UTF-16.*cannot recover/i);
  }
});
