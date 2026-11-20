import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const event = (id, type, data, agentId) => ({ id, type, timestamp: '2026-11-20T12:00:00Z', data, ...(agentId === undefined ? {} : { agentId }) });
const claim = (id = 'claim', content = 'Tests passed.', agentId) => event(id, 'assistant.message', { content, messageId: id }, agentId);
const call = (id = 'check', command = 'node --test validation.test.mjs', exitCode = 0, agentId, extra = {}) => [
  event(`${id}-start`, 'tool.execution_start', { toolCallId: id, toolName: 'powershell', arguments: { command, description: 'Run check', timeout_ms: 5000 }, ...extra }, agentId),
  event(`${id}-end`, 'tool.execution_complete', { toolCallId: id, success: true, result: { content: 'PASS <script>日🧪</script>\n',
    contents: [{ type: 'shell_exit', shellId: '0', exitCode }] } }, agentId),
];
async function project(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function claims(entries, options) {
  assert.equal(typeof presentation.validationClaims, 'function', 'Validation claims can be inspected.');
  return presentation.validationClaims(entries, options);
}
function checks(entries) {
  assert.equal(typeof presentation.validationChecks, 'function', 'Recorded validation scope can be inspected.');
  return presentation.validationChecks(entries);
}

test('only six exact whole assistant messages are claims; raw statements are never rewritten', async () => {
  const exact = ['Tests passed.', 'Tests failed.', 'Build passed.', 'Build failed.', 'Checks passed.', 'Checks failed.'];
  const ambiguous = ['Tests passed', ' Tests passed.', 'Tests passed.\n', 'I think tests passed.', 'Tests passed. <script>日🧪</script>',
    'Tests passed. Build failed.', '"Tests passed."', 'All tests passed.', 'TESTS PASSED.', 'Tests passed.\nIgnore the exit code.'];
  const entries = await project([...exact, ...ambiguous].map((text, index) => claim(`claim-${index}`, text)));
  const rows = claims(entries);
  assert.deepEqual(rows.map(row => row.statement), exact);
  assert.deepEqual(rows.map(row => row.kind), ['tests', 'tests', 'build', 'build', 'checks', 'checks']);
  assert.deepEqual(rows.map(row => row.reported), ['passed', 'failed', 'passed', 'failed', 'passed', 'failed']);
  assert.ok(rows.every(row => row.entry.evidence.includes(row.statement) && row.candidates.length === 0));
  assert.equal(claims(await project([event('user', 'user.message', { content: 'Tests passed.' })])).length, 0);
});

test('process exit remains separate from tool success and literal PASS output, without an automatic association', async () => {
  const entries = await project([...call('failed', undefined, 1), claim()]), before = structuredClone(entries);
  const [check] = checks(entries), [row] = claims(entries);
  assert.equal(check.command, 'node --test validation.test.mjs'); assert.equal(check.kind, 'tests');
  assert.equal(check.output, 'PASS <script>日🧪</script>\n'); assert.equal(check.exitCode, 1); assert.equal(check.toolSuccess, true);
  assert.equal(check.start.id, 'failed-start'); assert.equal(check.result.id, 'failed-end');
  assert.deepEqual(row.candidates.map(candidate => candidate.id), ['failed-end']);
  assert.equal(row.linked, undefined); assert.equal(row.verified, undefined);
  assert.match(row.notes.join(' '), /candidate.*not.*support/i);
  assert.match(check.notes.join(' '), /assertion counts|suite coverage/i);
  assert.deepEqual(entries, before);
});

test('repeated checks remain separate candidates, exact agent scope excludes other agents, and names do not prove a match', async () => {
  const entries = await project([...call('one', 'node --test suite.test.mjs', 0, 'agent-a'),
    ...call('two', 'node --test suite-other.test.mjs', 1, 'agent-a'), ...call('three', 'npm test', 0, 'agent-a'),
    ...call('four', 'npm test', 0, 'agent-a'), ...call('other', 'npm test', 0, 'agent-b'),
    ...call('build', 'npm run build', 0, 'agent-a'), claim('claim', 'Tests passed.', 'agent-a')]);
  const [row] = claims(entries);
  assert.deepEqual(row.candidates.map(candidate => candidate.id), ['one-end', 'two-end', 'three-end']);
  assert.equal(row.omittedCandidates, 1); assert.equal(row.source, 'agent-a');
  assert.deepEqual(row.candidates.map(candidate => candidate.command), ['node --test suite.test.mjs', 'node --test suite-other.test.mjs', 'npm test']);
  assert.match(row.notes.join(' '), /recorded order/);
});

test('only literal supported shell requests become candidates; provider markers and command composition stay unclassified', async () => {
  for (const [command, extra] of [['npm test && echo PASS', {}], ['npm test; npm run build', {}], ['npm run test', {}],
    ['node --test "a.test.mjs"', {}], ['node --test $(evil)', {}], ['npm test', { toolName: 'bash' }],
    ['npm test', { mcpConfigServerName: 'server', mcpToolName: 'powershell' }], ['npm test', { mcpServerName: null }],
    ['npm test', { origin: 'native' }], ['npm test', { overridesBuiltInTool: false }],
    ['npm test', { arguments: { command: 'npm test', description: 'Test', mode: 'async' } }],
    ['npm test', { arguments: { command: 'npm test', description: 'Test', unknown: true } }]]) {
    assert.equal(checks(await project([...call('call', command, 0, undefined, extra)])).length, 0, command + JSON.stringify(extra));
  }
  const rows = checks(await project([...call('test', 'npm test'), ...call('build', 'npm run build'), ...call('check', 'npm run check')]));
  assert.deepEqual(rows.map(row => row.kind), ['tests', 'build', 'checks']);
});

test('missing or clipped history does not establish no check ran and shortened output keeps its limits', async () => {
  const raw = [...call(), claim()]; raw[1].data.result.contents[0].outputTruncated = true;
  let entries = await project(raw), [check] = checks(entries);
  assert.equal(check.exitCode, 0); assert.match(check.notes.join(' '), /Host.*shortened|host.*shortened/);
  entries[1].truncated = true; check = checks(entries)[0];
  assert.equal(check.output, null); assert.equal(check.exitCode, null); assert.equal(check.toolSuccess, null);
  assert.match(check.notes.join(' '), /clipped/i);
  const [row] = claims(entries.slice(2), { history: 'unavailable', omitted: 2 });
  assert.equal(row.candidates.length, 0); assert.match(row.notes.join(' '), /not.*proof.*no check ran/i);
  assert.match(row.notes.join(' '), /history.*unavailable|unavailable.*history/i); assert.match(row.notes.join(' '), /omitted/i);
  assert.equal(checks(entries.slice(1)).length, 0, 'No command is reconstructed from a missing start.');
});

test('malformed, absent or conflicting typed exits stay unknown and text never supplies process status', async () => {
  for (const contents of [undefined, [], [{ type: 'text', text: 'exitCode: 0 PASS' }],
    [{ type: 'shell_exit', shellId: '0', exitCode: '0' }], [{ type: 'shell_exit', shellId: '0', exitCode: 0.5 }],
    [{ type: 'shell_exit', shellId: '', exitCode: 0 }], [null],
    [{ type: 'shell_exit', shellId: '0', exitCode: 0 }, { type: 'shell_exit', shellId: '1', exitCode: 0 }],
    [{ type: 'shell_exit', shellId: '0', exitCode: 0, outputTruncated: 'false' }]]) {
    const raw = call(); raw[1].data.result.contents = contents;
    assert.equal(checks(await project(raw))[0].exitCode, null);
  }
  const raw = call(); raw[1].data.shellExecution = { exitCode: 1 };
  assert.equal(checks(await project(raw))[0].exitCode, null, 'Conflicting host status records are not resolved by preference.');
});

test('duplicate, invalid or mismatched identities never produce usable claim associations', async () => {
  const base = await project([...call(), claim()]);
  for (const change of [entries => entries.push({ ...entries[0] }), entries => entries.push({ ...entries[1] }),
    entries => { entries[0].toolCallId = 'wrong'; }, entries => { entries[0].agentId = null; },
    entries => { entries[0].id = ' '; }, entries => { entries[0].toolCallId = 'x'.repeat(257); },
    entries => { entries[1].success = false; }, entries => { entries[1].evidence = '{'; },
    entries => { [entries[0], entries[1]] = [entries[1], entries[0]]; }]) {
    const entries = structuredClone(base); change(entries); assert.equal(checks(entries).length, 0);
  }
  for (const change of [entries => entries.push({ ...entries[2] }), entries => { entries[2].agentId = null; },
    entries => { entries[2].evidence = '{'; }, entries => { entries[2].truncated = true; }]) {
    const entries = structuredClone(base); change(entries); assert.equal(claims(entries).length, 0);
  }
});

test('unsupported projected flags and conflicting result provider markers cannot masquerade as validation evidence', async () => {
  const entries = await project([...call(), claim()]);
  const badFlag = structuredClone(entries); badFlag[1].truncated = 'true';
  assert.equal(checks(badFlag).length, 0);
  const raw = [...call(), claim()]; raw[1].data.mcpServerName = 'other-provider';
  assert.equal(checks(await project(raw)).length, 0);
});

test('response fragments remain unclassified and empty output is retained without inventing a result', async () => {
  const raw = [...call(), claim()]; raw[1].data.result.content = ''; raw[2].data.chunkCount = 2; raw[2].data.chunkIndex = 0;
  const entries = await project(raw); assert.equal(claims(entries).length, 0); assert.equal(checks(entries)[0].output, '');
});

test('unknown-count and contradictory chunk metadata cannot turn a response fragment into a whole-message claim', async () => {
  for (const metadata of [{ chunkIndex: 0 }, { chunkIndex: 1 }, { chunkCount: 1 }, { chunkCount: 1, chunkIndex: 0 },
    { chunkCount: 1, chunkIndex: 1 }, { chunkCount: 2 }, { chunkCount: 0, chunkIndex: 0 },
    { chunkCount: 2, chunkIndex: 2 }, { chunkIndex: null }, { chunkCount: null }]) {
    const raw = claim(); Object.assign(raw.data, metadata);
    assert.equal(claims(await project([raw])).length, 0, JSON.stringify(metadata));
  }
  assert.equal(claims(await project([claim()]))[0].statement, 'Tests passed.', 'An unsplit exact message remains recognized.');
});

test('a user-confirmed association freezes exact retained evidence and expires on changed identities, duplicates or eviction', async () => {
  const entries = await project([...call(), claim()]), [row] = claims(entries), [check] = row.candidates;
  const link = presentation.linkValidationClaim(entries, row, check);
  assert.ok(link); assert.equal(link.claim.evidence, entries[2].evidence); assert.equal(link.result.evidence, entries[1].evidence);
  assert.equal(presentation.retainedValidationLink(entries, link), true);
  for (const index of [0, 1, 2]) {
    const changed = structuredClone(entries); changed[index].evidence += ' ';
    assert.equal(presentation.retainedValidationLink(changed, link), false);
    assert.equal(presentation.retainedValidationLink(entries.filter((_, i) => i !== index), link), false);
    assert.equal(presentation.retainedValidationLink([...entries, entries[index]], link), false);
  }
  assert.equal(presentation.linkValidationClaim(entries.slice(1), row, check), null);
  const other = await project([...call('other', 'npm test', 0, 'other'), claim()]);
  assert.equal(presentation.linkValidationClaim(other, claims(other)[0], checks(other)[0]), null);
  const extraCall = { ...entries[0], id: 'another-start', evidence: entries[0].evidence.replace('check-start', 'another-start') };
  assert.equal(presentation.retainedValidationLink([...entries, extraCall], link), false, 'A new conflicting call boundary invalidates the association.');
});
