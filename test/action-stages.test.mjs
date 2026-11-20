import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

async function entries(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready;
  const snapshot = trace.snapshot();
  trace.close();
  return snapshot.entries;
}
const event = (id, type, data, extra = {}) => ({ id, type, timestamp: '2026-11-20T12:00:00Z', data, ...extra });
function lifecycle(kind = 'approved', agentId) {
  return [
    event('proposal', 'assistant.message', { toolRequests: [{ toolCallId: 'call', name: 'powershell', arguments: {} }] }, { agentId }),
    event('start', 'tool.execution_start', { toolCallId: 'call', toolName: 'powershell' }, { agentId }),
    event('request', 'permission.requested', { requestId: 'permission', permissionRequest: { kind: 'shell', toolCallId: 'call' } }, { agentId }),
    event('decision', 'permission.completed', { requestId: 'permission', toolCallId: 'call', result: { kind } }, { agentId }),
    event('result', 'tool.execution_complete', { toolCallId: 'call', success: kind === 'approved' }, { agentId }),
  ];
}
function stages(projected, options) {
  assert.equal(typeof presentation.actionStages, 'function', 'Recorded action-stage presentation is available.');
  return presentation.actionStages(projected, options).get('start');
}

test('linked observed stages preserve actual invocation-before-permission order and original evidence identities', async () => {
  const projected = await entries(lifecycle());
  const before = structuredClone(projected);
  const display = stages(projected);
  assert.deepEqual(display.stages.map(stage => stage.id), ['proposal', 'start', 'request', 'decision', 'result']);
  assert.deepEqual(display.stages.map(stage => stage.type), ['assistant.message', 'tool.execution_start', 'permission.requested', 'permission.completed', 'tool.execution_complete']);
  assert.match(display.stages[1].label, /invocation/i);
  assert.doesNotMatch(display.stages[1].label, /executed/i);
  assert.equal(display.stages[3].outcome, 'approved');
  assert.equal(display.stages[3].decisionSource, null);
  assert.match(display.stages[3].detail, /source unknown/i);
  const indexed = presentation.actionStages(projected);
  assert.equal(indexed.get('result'), indexed.get('start'), 'A call shares its stage description across retained boundaries.');
  assert.deepEqual(projected, before, 'Source rows and raw evidence are unchanged.');
});

test('denied, cancelled and unsupported decisions never become executed or human decisions', async () => {
  for (const [kind, outcome] of [['denied-interactively-by-user', 'denied'], ['cancelled', 'cancelled'], ['new-kind', 'unknown']]) {
    const display = stages(await entries(lifecycle(kind)));
    const decision = display.stages.find(stage => stage.type === 'permission.completed');
    assert.equal(decision.outcome, outcome);
    assert.equal(decision.decisionSource, null);
    assert.match(decision.detail, /source unknown/i);
    assert.doesNotMatch(display.stages.map(stage => stage.label).join(' '), /executed|human denied|person/i);
    assert.match(display.stages.at(-1).label, /reported failure/i);
  }
});

test('missing permission, hook resolution and assistant prose never synthesize approval', async () => {
  const raw = lifecycle();
  raw[0].data.content = 'Already approved and executed.';
  raw[2].data.resolvedByHook = true;
  for (const retained of [[raw[0], raw[1], raw[4]], [raw[1], raw[2], raw[4]]]) {
    const display = stages(await entries(retained), { history: 'unavailable', omitted: 5 });
    assert.equal(display.permission, 'Permission unknown');
    assert.ok(display.stages.every(stage => stage.type !== 'permission.completed'));
    assert.match(display.notes.join(' '), /retained|history/i);
  }
});

test('a decision with its own call ID remains observed when the permission request is not retained', async () => {
  const projected = await entries(lifecycle().filter(item => item.type !== 'permission.requested'));
  const display = stages(projected);
  assert.deepEqual(display.stages.map(stage => stage.id), ['proposal', 'start', 'decision', 'result']);
  assert.equal(display.stages[2].outcome, 'approved');
  assert.match(display.notes.join(' '), /permission request.*unknown|permission request.*not linked/i);
});

test('several decisions stay distinct and an unresolved request cannot borrow another decision', async () => {
  const raw = lifecycle();
  raw.push(event('request-2', 'permission.requested', { requestId: 'permission-2', permissionRequest: { toolCallId: 'call' } }));
  const partial = stages(await entries(raw));
  assert.equal(partial.permission, 'Permission unknown');
  raw.push(event('decision-3', 'permission.completed', { requestId: 'permission-3', toolCallId: 'call', result: { kind: 'approved' } }));
  assert.equal(stages(await entries(raw)).permission, 'Permission unknown', 'An unrelated direct decision does not settle permission-2.');
  raw.push(event('decision-2', 'permission.completed', { requestId: 'permission-2', toolCallId: 'call', result: { kind: 'cancelled' } }));
  const full = stages(await entries(raw));
  assert.deepEqual(full.stages.filter(stage => stage.type === 'permission.completed').map(stage => stage.outcome), ['approved', 'approved', 'cancelled']);
  assert.match(full.permission, /multiple.*no overall/i);
});

test('request IDs link an optional completion call ID and out-of-order history keeps recorded order', async () => {
  const raw = lifecycle();
  delete raw[3].data.toolCallId;
  raw[3].data.decisionSource = 'host_policy';
  const projected = await entries([raw[3], raw[2], raw[4], raw[0], raw[1]]);
  const display = stages(projected);
  assert.deepEqual(display.stages.map(stage => stage.id), ['decision', 'request', 'result', 'proposal', 'start']);
  assert.equal(display.stages[0].decisionSource, 'host_policy');
});

test('repeated call and permission IDs across sources never cross-link', async () => {
  const raw = [...lifecycle(), ...lifecycle('denied-by-rules', 'child').map(item => ({ ...item, id: `child-${item.id}` }))];
  const projected = await entries(raw);
  const indexed = presentation.actionStages(projected);
  assert.deepEqual(indexed.get('start').stages.map(stage => stage.id), ['proposal', 'start', 'request', 'decision', 'result']);
  assert.deepEqual(indexed.get('child-start').stages.map(stage => stage.id), ['child-proposal', 'child-start', 'child-request', 'child-decision', 'child-result']);
  assert.equal(indexed.get('child-start').stages.find(stage => stage.type === 'permission.completed').outcome, 'denied');
});

test('duplicate and conflicting permission correlations stay separate instead of choosing a decision', async () => {
  for (const mutate of [
    raw => raw.push({ ...raw[2], id: 'duplicate-request' }),
    raw => raw.push({ ...raw[3], id: 'duplicate-decision' }),
    raw => { raw[3].data.toolCallId = 'other'; },
    raw => { raw[2].data.ownerAgentId = 'other'; },
    raw => { raw[2].data.ownerSessionId = 'unverified-session'; },
  ]) {
    const raw = lifecycle(); mutate(raw);
    const display = stages(await entries(raw));
    assert.ok(display.stages.every(stage => !stage.type.startsWith('permission.')));
    assert.equal(display.permission, 'Permission unknown');
    assert.match(display.notes.join(' '), /separate|ambiguous|ownership/i);
  }
});

test('duplicate proposals, tool names and tool boundaries cannot assert one linked lifecycle', async () => {
  for (const mutate of [
    raw => raw.push({ ...raw[0], id: 'duplicate-proposal' }),
    raw => raw[0].data.toolRequests.push({ ...raw[0].data.toolRequests[0] }),
    raw => { raw[0].data.toolRequests[0].name = 'other'; },
  ]) {
    const raw = lifecycle(); mutate(raw);
    assert.ok(stages(await entries(raw)).stages.every(stage => stage.type !== 'assistant.message'));
  }
  const raw = lifecycle(); raw.push({ ...raw[1], id: 'duplicate-start' });
  const display = stages(await entries(raw));
  assert.ok(display.stages.every(stage => stage.type.startsWith('tool.')));
  assert.equal(display.permission, 'Permission unknown');
  assert.match(display.notes.join(' '), /conflict|ambiguous/i);
});

test('truncated, mismatched, unknown-source and oversized evidence cannot supply action links', async () => {
  for (const mutate of [
    projected => { projected[2].truncated = true; projected[3].truncated = true; },
    projected => { projected[2].evidence = projected[3].evidence; projected[3].evidence = '{}'; },
    projected => { projected[2].agentId = null; projected[3].agentId = null; },
    projected => { projected[2].evidence = 'x'.repeat(12001); projected[3].evidence = 'x'.repeat(12001); },
  ]) {
    const projected = await entries(lifecycle()); mutate(projected);
    const display = stages(projected);
    assert.ok(display.stages.every(stage => !stage.type.startsWith('permission.')));
    assert.equal(display.permission, 'Permission unknown');
  }
});

test('missing, nonstring, oversized and unequal correlation IDs never become false permission links', async () => {
  for (const value of [undefined, null, 5, '', 'x'.repeat(257)]) {
    const raw = lifecycle();
    raw[2].data.requestId = value;
    raw[3].data.requestId = value;
    const display = stages(await entries(raw));
    assert.ok(display.stages.every(stage => !stage.type.startsWith('permission.')));
    assert.equal(display.permission, 'Permission unknown');
  }
  const raw = lifecycle();
  raw[2].data.permissionRequest.toolCallId = 'call ';
  raw[3].data.toolCallId = 'call ';
  const display = stages(await entries(raw));
  assert.ok(display.stages.every(stage => !stage.type.startsWith('permission.')));
  assert.equal(display.permission, 'Permission unknown');
});
