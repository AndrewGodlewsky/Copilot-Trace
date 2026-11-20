import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const event = (id, type, data, agentId = '') => ({ id, type, data, ...(agentId ? { agentId } : {}), timestamp: '2026-11-20T12:00:00Z' });
const call = (id, name = 'view', args = { path: '日本語🧪<script>' }, success = true, exitCode) => [
  event(`${id}-start`, 'tool.execution_start', { toolCallId: id, toolName: name, arguments: args }),
  event(`${id}-end`, 'tool.execution_complete', { toolCallId: id, success,
    result: { content: 'FAIL 20 tests / PASS all tests / unrelated 日本語🧪<script>',
      ...(exitCode === undefined ? {} : { contents: [{ type: 'shell_exit', shellId: 'shell', exitCode }] }) } }),
];
const request = (id = 'permission', agentId = '') => event(id, 'permission.requested', {
  requestId: 'request', permissionRequest: { kind: 'shell', toolCallId: 'call' } }, agentId);
const decision = (agentId = '') => event('decision', 'permission.completed', { requestId: 'request', result: { kind: 'approved' } }, agentId);
async function project(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function lesson(entries, options) {
  assert.equal(typeof presentation.plausibleActions, 'function');
  return presentation.plausibleActions(entries, options);
}
function rewrite(entry, mutate) { const raw = JSON.parse(entry.evidence); mutate(raw); entry.evidence = JSON.stringify(raw); }

test('failure, retrieval and completed checks separate recorded facts from multiple conditional authored actions', async () => {
  for (const [raw, kind, facts] of [
    [call('failed', 'unknown_tool', {}, false), 'failure', /protocol.*failure/i],
    [call('read'), 'retrieval', /returned data/i],
    [call('check', 'powershell', { command: 'npm test', description: 'Tests' }, true, 0), 'check', /exit 0/i],
    [call('check', 'powershell', { command: 'npm test', description: 'Tests' }, true, 2), 'failure', /exit 2/i],
  ]) {
    const entries = await project(raw), before = structuredClone(entries), result = lesson(entries), scenario = result.scenarios[0];
    assert.equal(scenario.kind, kind); assert.match(scenario.observation, facts);
    assert.equal(scenario.options.length, 2); assert.ok(scenario.options.every(option => option.action && option.when));
    assert.match(scenario.limit, /unknown|does not prove/i);
    assert.deepEqual(scenario.evidence.map(entry => entry.id), entries.map(entry => entry.id));
    assert.doesNotMatch(JSON.stringify({ ...scenario, evidence: [] }), /20 tests|PASS all|unrelated 日本語|will choose|\d+%/);
    assert.deepEqual(entries, before);
  }
});

test('permission gap uses exact retained request ownership and never establishes current waiting', async () => {
  const entries = await project([request()]), scenario = lesson(entries).scenarios[0];
  assert.equal(scenario.kind, 'permission'); assert.match(scenario.limit, /current waiting.*unknown/i);
  assert.equal(lesson(await project([request(), decision('child')])).scenarios[0].kind, 'permission');
  assert.equal(lesson(await project([request(), decision()])).scenarios.length, 0);
  assert.equal(presentation.retainedPlausibleScenario(await project([request(), decision()]), scenario), false);
});

test('no evidence, unsupported contracts and output-only status get general guidance', async () => {
  for (const raw of [[], [event('claim', 'assistant.message', { messageId: 'claim', content: 'Tests passed.' })],
    call('unknown', 'read_file'), call('shell', 'powershell', { command: 'npm test', description: 'Tests' })]) {
    const result = lesson(await project(raw));
    assert.equal(result.scenarios.length, 0); assert.match(result.general.observation, /unknown/i);
    assert.equal(result.general.options.length, 2);
  }
});

test('malformed, clipped, omitted, mismatched or ambiguous identities cannot support a personalized scenario', async () => {
  for (const raw of [call('read'), call('failed', 'view', { path: 'file' }, false), [request()]]) {
    const base = await project(raw);
    for (const mutate of [entries => entries.push({ ...entries[0] }), entries => { entries[0].agentId = 'other'; },
      entries => { entries[0].id = ' '; },
      ...base.flatMap((_, index) => [entries => { entries[index].truncated = true; }, entries => { entries[index].truncated = 'false'; },
        entries => { entries[index].evidence = '{'; },
        ...[true, null, 'false'].map(marker => entries => { entries[index].protectedContentOmitted = marker; })]),
    ]) {
      const entries = structuredClone(base); mutate(entries); assert.equal(lesson(entries).scenarios.length, 0, mutate.toString());
    }
  }
  for (const mutate of [entries => entries.shift(), entries => entries.reverse(), entries => { entries[1].success = false; },
    entries => rewrite(entries[1], raw => { raw.data.toolCallId = 'other'; }),
    entries => rewrite(entries[0], raw => { raw.data.ownerAgentId = 'child'; }),
  ]) {
    const entries = await project(call('read')); mutate(entries); assert.equal(lesson(entries).scenarios.length, 0, mutate.toString());
  }
  const entries = await project([request()]); rewrite(entries[0], raw => { raw.data.ownerAgentId = 'child'; });
  assert.equal(lesson(entries).scenarios.length, 0);
});

test('overlapping retained observations stay separate, selection is bounded, and later success does not erase failure', async () => {
  const raw = [...call('failed', 'view', { path: 'file' }, false), request(), ...call('read'),
    ...call('check', 'powershell', { command: 'npm run check', description: 'Checks' }, true, 0)];
  const entries = await project(raw), result = lesson(entries, { history: 'unavailable', omitted: 4 });
  assert.equal(result.scenarios.length, 3); assert.equal(result.omittedScenarios, 1);
  assert.deepEqual(result.scenarios.map(item => item.kind), ['permission', 'retrieval', 'check']);
  assert.match(result.scope, /separate observations|not.*plan/i); assert.match(result.scope, /4.*omitted|omitted.*4/i);
  const original = lesson(entries.slice(0, 2)).scenarios[0];
  assert.equal(presentation.retainedPlausibleScenario(entries, original), true);
  assert.equal(presentation.retainedPlausibleScenario(entries.slice(1), original), false);
  assert.equal(presentation.retainedPlausibleScenario([...entries, { ...entries[0], id: 'conflict' }], original), false);
});

test('teaching uses only the supplied prefix and does not leak later check results or evidence links', async () => {
  const entries = await project(call('future', 'powershell', { command: 'npm test', description: 'Tests' }, true, 0));
  const prefix = lesson(entries.slice(0, 1)); assert.equal(prefix.scenarios.length, 0);
  assert.doesNotMatch(JSON.stringify(prefix), /future-end|exit 0|completed check/i);
  assert.equal(lesson(entries).scenarios[0].kind, 'check');
});

test('matching call and request IDs in different sources cannot borrow another source’s outcome', async () => {
  const main = call('shared', 'view', { path: 'file' }, false), child = call('shared', 'view', { path: 'file' });
  for (const entry of child) { entry.id = `child-${entry.id}`; entry.agentId = 'child'; }
  const entries = await project([main[0], child[0], request(), request('child-permission', 'child'), child[1], main[1]]);
  const result = lesson(entries);
  assert.equal(result.omittedScenarios, 1);
  assert.deepEqual(result.scenarios.map(scenario => [scenario.kind, scenario.evidence[0].agentId]), [
    ['permission', 'child'], ['retrieval', 'child'], ['failure', ''],
  ]);
  for (const scenario of result.scenarios) assert.ok(scenario.evidence.every(entry => entry.agentId === scenario.evidence[0].agentId));
});

test('protocol failure does not link contradictory provider metadata or result-only origin to an invocation', async () => {
  for (const [startMetadata, resultMetadata] of [
    [{ mcpServerName: 'one', mcpToolName: 'read' }, { mcpServerName: 'two' }],
    [{ mcpServerName: 'one', mcpToolName: 'read' }, { mcpToolName: 'edit' }],
    [{ mcpConfigServerName: 'one', mcpToolName: 'read' }, { mcpConfigServerName: 'two' }],
    [{ origin: 'one' }, { origin: 'two' }], [{ overridesBuiltInTool: false }, { overridesBuiltInTool: true }],
    [{}, { mcpServerName: 'result-only' }], [{}, { origin: 'result-only' }], [{}, { overridesBuiltInTool: false }],
  ]) {
    const raw = call('failed', 'unknown_tool', {}, false);
    Object.assign(raw[0].data, startMetadata); Object.assign(raw[1].data, resultMetadata);
    assert.equal(lesson(await project(raw)).scenarios.length, 0, JSON.stringify([startMetadata, resultMetadata]));
  }
  const raw = call('failed', 'unknown_tool', {}, false);
  Object.assign(raw[0].data, { mcpServerName: 'same', mcpToolName: 'read' });
  Object.assign(raw[1].data, { mcpServerName: 'same', mcpToolName: 'read' });
  assert.equal(lesson(await project(raw)).scenarios[0].kind, 'failure');
});

test('protocol failure requires usable call IDs on both boundaries while valid unknown-name failures remain supported', async () => {
  for (const toolCallId of ['', ' ', '\t\n']) {
    const raw = call('failed', 'unknown_tool', {}, false);
    for (const entry of raw) entry.data.toolCallId = toolCallId;
    const result = lesson(await project(raw));
    assert.deepEqual(result.scenarios, [], `Unusable call identity ${JSON.stringify(toolCallId)} must remain unclassified.`);
    assert.match(result.general.observation, /unknown/i);
  }
  const result = lesson(await project(call('usable-call', 'unknown_tool', {}, false)));
  assert.equal(result.scenarios[0].kind, 'failure');
  assert.deepEqual(result.scenarios[0].evidence.map(entry => entry.toolCallId), ['usable-call', 'usable-call']);
});
