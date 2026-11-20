import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';

const start = (id, toolName, args, extra = {}) => ({ id: `${id}-start`, type: 'tool.execution_start',
  data: { toolCallId: id, toolName, arguments: args }, ...extra });
const shell = extra => ({ type: 'shell_exit', shellId: 'owned-shell', exitCode: 0,
  outputTruncated: true, outputPreview: '🧪é', ...extra });
const end = (id, result = {}, extra = {}) => ({ id: `${id}-end`, type: 'tool.execution_complete',
  data: { toolCallId: id, success: true, result: { content: 'recorded output', ...result } }, ...extra });
async function observe(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready;
  const snapshot = trace.snapshot(); trace.close(); return snapshot;
}
function extents(snapshot) {
  assert.equal(typeof presentation.toolExtents, 'function', 'Shared extent descriptions are available.');
  return presentation.toolExtents(snapshot.entries, snapshot);
}

test('overlapping line requests stay separate with exact inclusive ranges and Unknown coverage', async () => {
  const snapshot = await observe([
    start('one', 'view', { path: 'café 🧪.txt', view_range: [3, 5] }), end('one', { content: '3\n4\n5' }),
    start('two', 'view', { path: 'café 🧪.txt', view_range: [4, 9] }), end('two', { content: '4\n5' }),
    start('eof', 'view', { path: 'café 🧪.txt', view_range: [1, -1], forceReadLargeFiles: true }), end('eof'),
  ]);
  const descriptions = extents(snapshot), ledger = presentation.retrievalLedger(snapshot.entries);
  assert.deepEqual(descriptions.get('one-start').requested, ['Lines 3–5 requested (1-based, inclusive)']);
  assert.deepEqual(descriptions.get('two-end').requested, ['Lines 4–9 requested (1-based, inclusive)']);
  assert.equal(descriptions.get('one-end').requestedLimited, true);
  assert.equal(descriptions.get('eof-end').requestedLimited, false);
  assert.match(descriptions.get('eof-end').requested.join(' '), /Line 1 through end.*Large-file limit override requested/);
  assert.equal(ledger.rows.length, 3);
  for (const row of ledger.rows) {
    assert.equal(row.extent.coverage, 'Unknown coverage');
    assert.equal(row.extent.hostShortened, false);
    assert.doesNotMatch(row.extent.notes.join(' '), /[0-9]+%|entire file received|complete file received/);
  }
});

test('search excerpt modes, result counts and context lines preserve their distinct units', async () => {
  const snapshot = await observe([
    start('snippets', 'grep', { pattern: '🧪', output_mode: 'content', head_limit: 2, '-A': 3, '-B': 1, '-C': 4, '-n': true }), end('snippets'),
    start('files', 'grep', { pattern: 'x', output_mode: 'files_with_matches', head_limit: 5 }), end('files'),
    start('counts', 'grep', { pattern: 'x', output_mode: 'count', head_limit: 0 }), end('counts'),
  ]);
  const descriptions = extents(snapshot);
  assert.deepEqual(descriptions.get('snippets-end').requested, ['Matching-line excerpts requested', 'First 2 results requested',
    '3 context lines after matches requested', '1 context line before matches requested', '4 context lines around matches requested', 'Line numbers requested']);
  assert.equal(descriptions.get('snippets-end').requestedLimited, true);
  assert.match(descriptions.get('files-end').requested.join(' '), /Matching file paths.*First 5 results/);
  assert.match(descriptions.get('counts-end').requested.join(' '), /Per-file counts.*head_limit: 0/);
  assert.match(descriptions.get('counts-end').notes.join(' '), /not file contents/);
});

test('web character limits are not byte limits or measured UTF-16 counts and unknown byte contracts stay unclassified', async () => {
  const snapshot = await observe([
    start('web', 'web_fetch', { url: 'https://example.invalid/🧪', max_length: 7, start_index: 3 }), end('web', { content: '🧪é' }),
    start('bytes', 'read_bytes', { path: 'file', max_bytes: 7 }), end('bytes', { content: '🧪é' }),
    start('malformed', 'view', { path: 'file', max_bytes: 7 }), end('malformed'),
  ]);
  const descriptions = extents(snapshot);
  assert.deepEqual(descriptions.get('web-start').requested, ['Start index 3 requested (character pagination)', 'At most 7 characters requested']);
  assert.match(descriptions.get('web-end').returned, /3 UTF-16 code units.*result.content/);
  for (const id of ['bytes-end', 'malformed-end']) {
    assert.deepEqual(descriptions.get(id).requested, []);
    assert.equal(descriptions.get(id).requestedLimited, false);
  }
  assert.equal(presentation.retrievalLedger(snapshot.entries).unclassified.length, 2);
});

test('empty results and failed output do not establish empty files or successful retrieved extent', async () => {
  const snapshot = await observe([
    start('empty', 'view', { path: 'empty' }), end('empty', { content: '' }),
    start('failed', 'view', { path: 'missing' }), end('failed', {}, { data: { toolCallId: 'failed', success: false, result: { content: 'diagnostic' } } }),
  ]);
  assert.match(extents(snapshot).get('empty-end').returned, /0 UTF-16 code units/);
  assert.match(extents(snapshot).get('empty-end').notes.join(' '), /empty.*does not prove.*empty/i);
  assert.match(extents(snapshot).get('failed-end').returned, /failure.*not retrieved/i);
  assert.equal(presentation.retrievalLedger(snapshot.entries).rows[1].content, null);
});

test('only documented shell_exit true facts establish a host-shortened preview', async () => {
  for (const outputTruncated of [false, undefined, 'true', 1]) {
    const snapshot = await observe([end('call', { contents: [shell({ outputTruncated })], truncated: true,
      content: 'Output truncated 99% complete', detailedContent: 'more text'.repeat(200) })]);
    assert.equal(extents(snapshot).get('call-end').hostShortened, false);
    assert.equal(snapshot.entries[0].hostOutput, undefined);
  }
  const snapshot = await observe([end('call', { contents: [shell()] })]);
  const entry = snapshot.entries[0], description = extents(snapshot).get(entry.id);
  assert.equal(entry.hostOutput.previewCodeUnits, 3);
  assert.equal(description.hostShortened, true);
  assert.ok(description.badges.includes('Host-shortened preview'));
  assert.match(description.notes.join(' '), /shell_exit.*outputTruncated.*3 UTF-16 code units/);
  assert.equal(description.traceClipped, false);
});

test('both shortening layers survive a late host flag without repairing clipped JSON or retaining output paths', async () => {
  const snapshot = await observe([start('call', 'view', { path: 'file', view_range: [3, 5] }),
    end('call', { content: '🧪'.repeat(9000), contents: [shell({ outputFilePath: 'DO-NOT-READ', outputPreview: '🧪é' })] })]);
  const entry = snapshot.entries[1], description = extents(snapshot).get(entry.id);
  assert.equal(entry.truncated, true);
  assert.ok(entry.evidence.length <= 12000);
  assert.ok(!/[\uD800-\uDBFF]…$/.test(entry.evidence));
  assert.throws(() => JSON.parse(entry.evidence));
  assert.equal(description.hostShortened, true);
  assert.equal(description.traceClipped, true);
  assert.ok(description.badges.includes('Trace-clipped evidence'));
  assert.match(description.notes.join(' '), /separate validated projection.*clipped/i);
  assert.match(description.notes.join(' '), /12,000 UTF-16 code units/);
  assert.doesNotMatch(JSON.stringify(entry.hostOutput), /DO-NOT-READ|🧪é/);
  const ledger = presentation.retrievalLedger(snapshot.entries);
  assert.equal(ledger.rows.length, 0);
  assert.equal(ledger.unclassified[0].extent.hostShortened, true);
});

test('host projections reject malformed, duplicate, oversized and wrong-source records', async () => {
  const valid = await observe([end('call', { contents: [shell()] })]);
  const entry = valid.entries[0];
  for (const delta of [{ id: 'other' }, { type: 'tool.execution_start' }, { toolCallId: 'other' }, { agentId: 'other' },
    { hostOutput: { ...entry.hostOutput, previewCodeUnits: -1 } },
    { hostOutput: { ...entry.hostOutput, type: 'text' } }]) {
    assert.equal(extents({ entries: [{ ...entry, ...delta }] }).get(delta.id || entry.id)?.hostShortened || false, false);
  }
  for (const delta of [{ truncated: 'true' }, { truncated: undefined }, { truncated: true, evidence: 'x'.repeat(12001) },
    { truncated: true, evidence: null }, { truncated: true, timestamp: null, hostOutput: { ...entry.hostOutput, timestamp: null } },
    { truncated: true, timestamp: 'x'.repeat(81), hostOutput: { ...entry.hostOutput, timestamp: 'x'.repeat(81) } }]) {
    assert.equal(extents({ entries: [{ ...entry, ...delta }] }).get(entry.id).hostShortened, false);
  }
  for (const contents of [[shell(), shell({ outputTruncated: false })], [shell({ shellId: '' })],
    [shell({ exitCode: '0' })], [shell({ outputPreview: 3 })], [shell({ shellId: 'a'.repeat(257) })],
    [shell(), null], [shell(), ...Array.from({ length: 64 }, () => ({ type: 'text', text: 'x' }))]]) {
    const snapshot = await observe([end('call', { contents })]);
    assert.equal(snapshot.entries[0].hostOutput, undefined);
    assert.equal(extents(snapshot).get('call-end').hostShortened, false);
  }
  for (const extra of [{ agentId: '' }, { agentId: 'a'.repeat(257) }, { id: '' }]) {
    const snapshot = await observe([end('call', { contents: [shell()] }, extra)]);
    assert.equal(snapshot.entries[0]?.hostOutput, undefined);
  }
  const unrelated = await observe([end('call', {}, { data: { toolCallId: 'call', success: true,
    shellExecution: { exitCode: 0, outputTruncated: true }, toolTelemetry: { outputTruncated: true }, result: { content: 'x' } } })]);
  assert.equal(extents(unrelated).get('call-end').hostShortened, false);
});

test('a valid flag with no preview has unknown length and the 64-block boundary is supported', async () => {
  const snapshot = await observe([end('call', { contents: [shell({ outputPreview: undefined }),
    ...Array.from({ length: 63 }, () => ({ type: 'text', text: 'x' }))] })]);
  assert.equal(snapshot.entries[0].hostOutput.previewCodeUnits, null);
  assert.equal(extents(snapshot).get('call-end').hostShortened, true);
  assert.match(extents(snapshot).get('call-end').notes.join(' '), /Preview length unavailable/);
});

test('retained-history limits are separate from per-event clipping and host output limits', async () => {
  const snapshot = await observe(Array.from({ length: 301 }, (_, index) => start(`call-${index}`, 'view', { path: 'file' })));
  const description = extents(snapshot).get('call-1-start');
  assert.match(description.notes.join(' '), /300 events.*1 older event.*omitted/i);
  assert.equal(description.traceClipped, false);
  assert.equal(description.hostShortened, false);
});

test('original evidence navigation rejects changed host facts beyond an identical clipped raw prefix', async () => {
  const first = await observe([end('call', { content: 'x'.repeat(15000), contents: [shell()] })]);
  const second = await observe([end('call', { content: 'x'.repeat(15000), contents: [shell({ outputPreview: 'different' })] })]);
  const old = first.entries[0], current = second.entries[0];
  assert.equal(old.evidence, current.evidence);
  const frozen = presentation.glossaryExample(first.entries, 'tool');
  assert.equal(presentation.retainedExample([structuredClone(old)], frozen), true);
  assert.equal(presentation.retainedExample(second.entries, old), false);
  assert.equal(presentation.retainedExample(second.entries, frozen), false);
});
