import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const event = (id, type, data, agentId) => ({ id, type, timestamp: '2026-11-20T12:00:00Z', data, ...(agentId === undefined ? {} : { agentId }) });
const call = (id, command = 'npm test', exitCode = 0, agentId, extra = {}) => [
  event(`${id}-start`, 'tool.execution_start', { toolCallId: id, toolName: 'powershell', arguments: { command, description: 'Run validation' }, ...extra }, agentId),
  event(`${id}-end`, 'tool.execution_complete', { toolCallId: id, success: true, result: { content: 'PASS <script>日🧪</script>\n# skipped 7\n',
    contents: [{ type: 'shell_exit', shellId: '0', exitCode }] } }, agentId),
];
async function project(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function overview(entries, options) {
  assert.equal(typeof presentation.validationOverview, 'function', 'Retained validation operations have an overview.');
  return presentation.validationOverview(entries, options);
}

test('validation overview recognizes test, build, check and lint operations once with literal source/time/results', async () => {
  const entries = await project([...call('tests'), ...call('build', 'npm run build', 1), ...call('checks', 'npm run check'),
    ...call('lint', 'npm run lint'), ...call('node', 'node --test suite.test.mjs', 1, 'agent-日🧪')]);
  const before = structuredClone(entries), result = overview(entries);
  assert.equal(result.checks.length, 5); assert.equal(result.unclassifiedCalls, 0);
  assert.deepEqual(result.checks.map(check => check.kind), ['tests', 'build', 'checks', 'lint', 'tests']);
  const check = result.checks[4];
  assert.equal(check.command, 'node --test suite.test.mjs'); assert.equal(check.source, 'agent-日🧪');
  assert.equal(check.timestamp, entries[8].timestamp); assert.equal(check.resultTimestamp, entries[9].timestamp);
  assert.equal(check.start, entries[8]); assert.equal(check.result, entries[9]); assert.equal(check.id, entries[8].id);
  assert.equal(check.toolSuccess, true); assert.equal(check.exitCode, 1); assert.equal(check.assertionCounts, null);
  assert.equal(check.output, 'PASS <script>日🧪</script>\n# skipped 7\n');
  assert.match(check.notes.join(' '), /skipped.*coverage.*unknown/i);
  assert.deepEqual(entries, before);
});

test('repeated and interleaved commands retain earlier failure and select latest result only for exact source and command', async () => {
  const one = call('one', 'npm test', 1, 'agent-a'), two = call('two', 'npm test', 0, 'agent-a');
  const entries = await project([one[0], ...call('other', 'npm test', 1, 'agent-b'), two[0], two[1], one[1],
    ...call('similar', 'node --test suite.test.mjs', 0, 'agent-a'), call('pending', 'npm test', 0, 'agent-a')[0]]);
  const { checks } = overview(entries);
  assert.equal(checks.length, 5);
  assert.deepEqual(checks.map(check => [check.start.id, check.exitCode, check.latestResult]), [
    ['one-start', 1, true], ['other-start', 1, true], ['two-start', 0, false], ['similar-start', 0, true], ['pending-start', null, false],
  ]);
  assert.equal(checks[4].result, null); assert.equal(checks[4].toolSuccess, null); assert.equal(checks[4].output, null);
  assert.match(checks[4].notes.join(' '), /completion.*not retained.*unknown.*not.*running/i);
  assert.equal(presentation.validationChecks(entries).length, 4, 'Claim candidates still require a completion.');
});

test('unknown commands, wrappers, provider metadata and missing starts remain unclassified without parsing shell prose', async () => {
  const raw = ['npm test && echo PASS', 'powershell -Command "npm test"', 'npm test; npm run lint', 'npm run test',
    'node --test "suite.test.mjs"', 'npm run lint -- --fix', 'echo PASS'].flatMap((command, index) => call(`unknown-${index}`, command));
  raw.push(...call('provider', 'npm test', 0, undefined, { mcpServerName: null }), call('orphan')[1]);
  const entries = await project(raw), result = overview(entries);
  assert.equal(result.checks.length, 0); assert.equal(result.unclassifiedCalls, presentation.summarize(entries).tools);
  assert.match(result.notes.join(' '), /unsupported.*missing.*conflicting/i);
});

test('empty and omitted history state retained scope without claiming no validation was performed', () => {
  const result = overview([], { history: 'unavailable', omitted: 42 });
  assert.equal(result.checks.length, 0); assert.equal(result.unclassifiedCalls, 0);
  assert.match(result.notes.join(' '), /300.*retained/i); assert.match(result.notes.join(' '), /42.*omitted/i);
  assert.match(result.notes.join(' '), /history.*unavailable/i);
  assert.doesNotMatch(result.notes.join(' '), /no validation performed/i);
});

test('typed exit uncertainty, clipped or partial output never supplies assertions, skipped counts or coverage', async () => {
  for (const contents of [undefined, [], [{ type: 'shell_exit', shellId: '0', exitCode: '0' }],
    [{ type: 'shell_exit', shellId: '0', exitCode: 0 }, { type: 'shell_exit', shellId: '0', exitCode: 1 }]]) {
    const raw = call('unknown'); raw[1].data.result.contents = contents;
    const check = overview(await project(raw)).checks[0];
    assert.equal(check.exitCode, null); assert.equal(check.assertionCounts, null); assert.equal(check.toolSuccess, true);
  }
  const raw = call('partial'); raw[1].data.result.contents[0].outputTruncated = true;
  raw[1].data.result.contents[0].outputPreview = 'Tests: 50 passed'; raw[1].data.shellExecution = { exitCode: 1 };
  const entries = await project(raw), check = overview(entries).checks[0];
  assert.equal(check.exitCode, null); assert.equal(check.assertionCounts, null); assert.match(check.notes.join(' '), /shortened/i);
  entries[1].truncated = true;
  const clipped = overview(entries).checks[0];
  assert.equal(clipped.exitCode, null); assert.equal(clipped.output, null); assert.equal(clipped.toolSuccess, null);
  assert.match(clipped.notes.join(' '), /clipped/i);
});

test('conflicting and reused identities do not manufacture validation invocations; counts follow lifecycle grouping', async () => {
  const base = await project(call('call'));
  for (const change of [entries => entries.push({ ...entries[0] }), entries => entries.push({ ...entries[1] }),
    entries => { entries[0].agentId = null; }, entries => { entries[0].toolCallId = ''; },
    entries => { entries[0].id = ' '; }, entries => { entries[0].truncated = true; },
    entries => { [entries[0], entries[1]] = [entries[1], entries[0]]; }]) {
    const entries = structuredClone(base); change(entries); const result = overview(entries);
    assert.equal(result.checks.length, 0); assert.equal(result.unclassifiedCalls, presentation.summarize(entries).tools);
    assert.equal(result.unlinkedBoundaries, presentation.groupSteps(entries).filter(group => group.id.startsWith('unlinked-tool:')).length);
  }
  const bad = structuredClone(base); bad[1].evidence = '{';
  const check = overview(bad).checks[0];
  assert.equal(check.command, 'npm test'); assert.equal(check.toolSuccess, null); assert.equal(check.exitCode, null);
  assert.match(check.notes.join(' '), /result.*conflicting|result.*incomplete/i);
});

test('contradictory raw result identities and providers cannot acquire an original-result link or latest-result marker', async () => {
  for (const mutate of [raw => { raw.data.toolCallId = 'foreign'; }, raw => { raw.agentId = 'foreign'; },
    raw => { raw.data.toolName = 'foreign'; }, raw => { raw.data.mcpServerName = 'foreign'; },
    raw => { raw.data.mcpServerName = null; }, raw => { raw.data.origin = 'native'; }]) {
    const events = call('call'); events[1].data.result.contents[0].outputTruncated = true;
    const entries = await project(events), raw = JSON.parse(entries[1].evidence); mutate(raw);
    entries[1].evidence = JSON.stringify(raw);
    const check = overview(entries).checks[0];
    assert.equal(check.command, 'npm test'); assert.equal(check.result, null); assert.equal(check.resultTimestamp, null);
    assert.equal(check.latestResult, false); assert.equal(check.exitCode, null); assert.equal(check.toolSuccess, null);
    assert.match(check.notes.join(' '), /result.*conflicting/i);
    assert.doesNotMatch(check.notes.join(' '), /Host-shortened output/);
    assert.equal(presentation.validationChecks(entries).length, 0);
  }
});
