import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const call = (toolName = 'view', args = { path: 'unrelated.txt' }, result = { content: 'Unrelated data 日本🧪<script>' }) => [
  { id: 'start', type: 'tool.execution_start', data: { toolCallId: 'call', toolName, arguments: args } },
  { id: 'end', type: 'tool.execution_complete', data: { toolCallId: 'call', success: true, result } },
];
async function project(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw.map(entry => ({ timestamp: '2026-11-20T12:00:00Z', ...entry })) });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function outcomes(entries) {
  assert.equal(typeof presentation.toolOutcomes, 'function', 'Matched outcome explanations are available to the renderer.');
  return presentation.toolOutcomes(entries);
}
function change(entry, mutate) {
  const raw = JSON.parse(entry.evidence); mutate(raw); entry.evidence = JSON.stringify(raw);
}
const shell = (exitCode = 0, content = 'FAIL 2 assertions; PASS 100 tests') => ({ content,
  contents: [{ type: 'shell_exit', shellId: 'shell', exitCode }] });

test('failure presence uses explicit recorded outcomes without promoting warnings, decisions or prose', () => {
  assert.equal(typeof presentation.recordedFailure, 'function');
  for (const [entry, expected] of [
    [{ type: 'session.error' }, true], [{ type: 'subagent.failed' }, true],
    ...['tool.execution_complete', 'hook.end', 'session.compaction_complete'].flatMap(type => [
      [{ type, success: false, truncated: true }, true], [{ type, success: true }, false], [{ type }, false],
      [{ type, success: 'false' }, false],
    ]),
    [{ type: 'session.warning', success: false }, false], [{ type: 'abort' }, false],
    [{ type: 'permission.requested', success: false }, false],
    [{ type: 'hook.end', success: true, evidence: '{"output":{"permissionDecision":"deny"}}' }, false],
    [{ type: 'assistant.message', preview: 'Failed with exit code 1' }, false],
    [{ type: 'tool.execution_start', success: false }, false],
  ]) assert.equal(presentation.recordedFailure(entry), expected, JSON.stringify(entry));
});

test('failure presence reuses validated typed process exits, including protocol success and opaque commands', async () => {
  assert.equal(typeof presentation.recordedFailure, 'function');
  for (const [exitCode, expected] of [[0, false], [1, true], [-1, true]]) {
    const entries = await project(call('powershell', { command: 'Write-Output "error"', description: 'Command' }, shell(exitCode)));
    const outcome = outcomes(entries).get('end');
    assert.equal(outcome.exitCode, exitCode);
    assert.equal(presentation.recordedFailure(entries[1], outcome), expected);
  }
  const raw = call('powershell', { command: 'npm test', description: 'Tests' }, shell(1));
  for (const mutate of [events => events.shift(), events => { events[1].agentId = 'other'; },
    events => { events[1].data.shellExecution = { exitCode: 0 }; },
    events => { events[1].data.result.contents.push({ type: 'shell_exit', shellId: 'shell', exitCode: 1 }); },
    events => { events[0].data.origin = 'builtin'; },
  ]) {
    const events = structuredClone(raw); mutate(events);
    const entries = await project(events), result = entries.find(entry => entry.id === 'end');
    assert.equal(presentation.recordedFailure(result, outcomes(entries).get('end')), false, mutate.toString());
  }
});

test('successful read of irrelevant content establishes returned data without judging usefulness or consuming output prose', async () => {
  for (const [name, args] of [['view', { path: 'unrelated.txt' }], ['web_fetch', { url: 'https://example.test/unrelated' }]]) {
    const entries = await project(call(name, args)), before = structuredClone(entries), descriptions = outcomes(entries);
    assert.equal(descriptions.size, 1); assert.equal(descriptions.get('end').kind, 'read');
    const lesson = presentation.explainStep(entries[1], descriptions.get('end'));
    assert.match(lesson.means, /returned data/i); assert.match(lesson.unknown, /relevan|useful/i);
    assert.doesNotMatch(lesson.means, /Unrelated data|<script>/);
    assert.match(lesson.unknown, /implementation.*unknown/i); assert.deepEqual(entries, before);
  }
});

test('successful edit without tests reports a change while correctness and missing validation remain unknown', async () => {
  for (const [name, args] of [['edit', { path: 'file', old_str: 'wrong', new_str: 'still wrong' }], ['create', { path: 'file', file_text: '' }]]) {
    const entries = await project(call(name, args, { content: 'Changed.' }));
    const outcome = outcomes(entries).get('end'), lesson = presentation.explainStep(entries[1], outcome);
    assert.equal(outcome.kind, 'edit'); assert.match(lesson.means, /reported a change/i);
    assert.match(lesson.unknown, /correctness.*unknown/i); assert.match(lesson.unknown, /missing validation.*unknown/i);
    assert.equal(presentation.validationChecks(entries).length, 0);
  }
});

test('successful command with failing assertion prose uses typed zero or nonzero exit separately from protocol and assertions', async () => {
  for (const [exitCode, success] of [[0, true], [1, true], [7, false]]) {
    const raw = call('powershell', { command: 'npm test', description: 'Check tests' }, shell(exitCode)); raw[1].data.success = success;
    const entries = await project(raw), outcome = outcomes(entries).get('end'), lesson = presentation.explainStep(entries[1], outcome);
    assert.equal(outcome.kind, 'process'); assert.match(lesson.means, new RegExp(`exit ${exitCode}\\b`));
    assert.match(lesson.means, new RegExp(`protocol reports ${success ? 'success' : 'failure'}`));
    assert.match(lesson.unknown, /assertion counts.*coverage.*unknown/i); assert.doesNotMatch(lesson.means, /assertions passed|100 tests|FAIL 2/);
    assert.match(lesson.unknown, /output text.*assistant.*task/i);
  }
});

test('supported opaque shell commands describe typed process status without becoming recognized validation checks', async () => {
  const entries = await project(call('powershell', { command: 'Write-Output "PASS"; exit 0', description: 'Opaque command' }, shell(0, 'PASS')));
  assert.equal(outcomes(entries).get('end').kind, 'process');
  assert.equal(presentation.validationChecks(entries).length, 0);
  const raw = call('powershell', { command: 'npm test', description: 'Tests', timeout_ms: 3000 }, shell());
  assert.equal(outcomes(await project(raw)).get('end').kind, 'process', 'Existing validation contract remains supported.');
});

test('unknown contracts, MCP aliases, absent output and unsupported provider markers keep neutral explanations', async () => {
  for (const [name, args, metadata, result] of [
    ['read_file', { path: 'file' }, {}, { content: 'done' }], ['view', { path: 'file', secret: true }, {}, { content: 'done' }],
    ['view', { path: 'file' }, { mcpServerName: 'remote', mcpToolName: 'edit' }, { content: 'done' }],
    ['view', { path: 'file' }, { origin: 'builtin' }, { content: 'done' }],
    ['view', { path: 'file' }, { overridesBuiltInTool: false }, { content: 'done' }],
    ['view', { path: 'file' }, {}, {}], ['view', { path: 'file' }, {}, { content: 42 }],
  ]) {
    const raw = call(name, args, result); Object.assign(raw[0].data, metadata);
    const entries = await project(raw); assert.equal(outcomes(entries).size, 0);
    assert.doesNotMatch(presentation.explainStep(entries[1]).means, /returned data|reported a change|process exit/i);
  }
});

test('partial, conflicting, clipped and protected evidence cannot borrow a known outcome from a name or another source', async () => {
  const base = await project(call());
  for (const mutate of [entries => entries.shift(), entries => entries.reverse(), entries => entries.push({ ...entries[0] }),
    entries => entries.push({ ...entries[1] }), entries => { entries[1].agentId = 'other'; },
    entries => { entries[1].success = false; }, entries => { entries[0].toolCallId = ''; },
    entries => { entries[0].id = ' '; }, entries => { entries[0].truncated = 'false'; },
    entries => change(entries[1], raw => { raw.data.toolCallId = 'different'; }),
    entries => change(entries[1], raw => { raw.data.toolName = 'edit'; }),
    entries => change(entries[1], raw => { raw.data.mcpServerName = 'service'; }),
    entries => change(entries[1], raw => { raw.data.error = { message: 'Contradictory failure' }; }),
    ...[0, 1].flatMap(index => [entries => { entries[index].truncated = true; }, entries => { entries[index].evidence = '{'; },
      ...[true, null, 'false', 0].map(marker => entries => { entries[index].protectedContentOmitted = marker; })]),
  ]) {
    const entries = structuredClone(base); mutate(entries); assert.equal(outcomes(entries).size, 0, mutate.toString());
  }
  const marked = structuredClone(base); marked[0].protectedContentOmitted = false;
  assert.equal(outcomes(marked).get('end').kind, 'read');
  const omitted = call(); omitted[0].data.arguments.reasoningOpaque = 'hidden';
  assert.equal(outcomes(await project(omitted)).size, 0, 'Actual projection omission cannot validate the reduced apparent schema.');
});

test('same call IDs in different sources retain only their own read or edit outcome', async () => {
  const other = call('edit', { path: 'other', old_str: 'a', new_str: 'b' });
  for (const entry of other) { entry.id = `other-${entry.id}`; entry.agentId = 'child'; }
  const entries = await project([...call(), ...other]), result = outcomes(entries);
  assert.equal(result.get('end').kind, 'read'); assert.equal(result.get('other-end').kind, 'edit');
  assert.equal(outcomes(entries.filter(entry => entry.id !== 'other-start')).has('other-end'), false);
});

test('malformed, conflicting or absent typed process exit never turns output prose or protocol success into process status', async () => {
  for (const mutate of [raw => { delete raw[1].data.result.contents; }, raw => { raw[1].data.result.contents[0].exitCode = '0'; },
    raw => { raw[1].data.result.contents.push({ type: 'shell_exit', shellId: 'shell', exitCode: 1 }); },
    raw => { raw[1].data.shellExecution = { exitCode: 1 }; }, raw => { raw[0].data.arguments.shellId = 'other'; },
    raw => { raw[1].data.result.contents[0].outputTruncated = 'false'; },
  ]) {
    const raw = call('powershell', { command: 'npm test', description: 'Tests' }, shell()); mutate(raw);
    assert.equal(outcomes(await project(raw)).size, 0);
  }
});
