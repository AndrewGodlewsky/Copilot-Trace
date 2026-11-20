import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const start = (id, name, args, extra = {}, data = {}) => ({ id: `${id}-start`, type: 'tool.execution_start',
  data: { toolCallId: id, toolName: name, arguments: args, ...data }, ...extra });
const end = (id, success, content, extra = {}, data = {}) => ({ id: `${id}-end`, type: 'tool.execution_complete',
  data: { toolCallId: id, success, result: { content }, ...data }, ...extra });
async function observe(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready;
  const entries = trace.snapshot().entries;
  trace.close();
  return entries;
}
function ledger(entries, options) {
  assert.equal(typeof presentation.retrievalLedger, 'function', 'A shared recorded-evidence ledger is available.');
  return presentation.retrievalLedger(entries, options);
}

test('mixed retrievals distinguish reported returned text, failed diagnostics, empty and missing results', async () => {
  const entries = await observe([
    start('read', 'view', { path: 'src/café 🧪<img>.txt', view_range: [3, 5] }),
    end('read', true, 'line 3\nline 4\nline 5', {}, { result: { content: 'line 3\nline 4\nline 5', detailedContent: 'display-only diff' } }),
    start('search', 'grep', { pattern: '<script>🧪', paths: ['src', 'test'], output_mode: 'content', head_limit: 2, '-n': true }),
    end('search', true, 'src/a:3:snippet'),
    start('failed', 'view', { path: 'missing.txt' }), end('failed', false, 'Path missing.txt does not exist'),
    start('empty', 'view', { path: 'empty.txt' }), end('empty', true, ''),
    start('pending', 'view', { path: 'pending.txt' }),
  ]);
  const before = structuredClone(entries), result = ledger(entries);
  assert.deepEqual(result.rows.map(row => row.status), ['returned', 'returned', 'failed', 'empty', 'missing']);
  assert.equal(result.rows[0].content, 'line 3\nline 4\nline 5');
  assert.deepEqual(result.rows[0].targets, ['src/café 🧪<img>.txt']);
  assert.match(result.rows[0].request, /3.*5/);
  assert.equal(result.rows[0].partial, true);
  assert.deepEqual(result.rows[0].links.map(link => link.id), ['read-start', 'read-end']);
  assert.match(result.rows[1].request, /content[\s\S]*2/);
  assert.equal(result.rows[1].partial, true);
  assert.equal(result.rows[2].content, null, 'Failure prose is never presented as retrieved content.');
  assert.match(result.rows[2].scopeNote, /diagnostic/i);
  assert.equal(result.rows[3].content, '');
  assert.equal(result.rows[4].content, null);
  assert.match(result.rows[4].scopeNote, /does not mean.*running/i);
  assert.equal(result.references, 6);
  assert.match(result.note, /understood.*used.*active context/i);
  assert.match(result.note, /implementation.*unknown/i);
  assert.deepEqual(entries, before);
});

test('reference identity preserves literal targets and source scope while repeats remain occurrences', async () => {
  const entries = await observe([
    start('one', 'view', { path: './same.txt' }), end('one', true, 'first'),
    start('two', 'view', { path: './same.txt' }), end('two', true, 'second'),
    start('three', 'view', { path: 'same.txt' }),
    start('four', 'view', { path: './same.txt' }, { agentId: 'child' }),
    start('web', 'web_fetch', { url: 'https://example.invalid/café?q=<img>&a=1', start_index: 3, max_length: 10 }),
    end('web', true, 'literal 🧪<script>'),
  ]);
  const result = ledger(entries);
  assert.equal(result.rows.length, 5);
  assert.equal(result.references, 4, 'Exact source and literal references are counted, not physical files.');
  assert.deepEqual(result.rows[4].targets, ['https://example.invalid/café?q=<img>&a=1']);
  assert.equal(result.rows[4].content, 'literal 🧪<script>');
  assert.match(result.rows[4].request, /3[\s\S]*10/);
  assert.equal(result.rows[4].partial, true);
  assert.match(result.note, /physical files|physical resources/i);
});

test('search modes and omitted targets stay distinct without inventing files or total coverage from output prose', async () => {
  const result = ledger(await observe([
    start('files', 'grep', { pattern: 'x', output_mode: 'files_with_matches' }), end('files', true, 'a.txt\nb.txt'),
    start('count', 'grep', { pattern: 'x', paths: 'src', output_mode: 'count' }), end('count', true, 'src/a:99'),
    start('default', 'grep', { pattern: 'x' }), end('default', true, 'a.txt'),
    start('glob', 'glob', { pattern: '**/*.txt', paths: ['src', 'src'] }), end('glob', true, 'src/a.txt'),
    start('view', 'view', { path: 'dir', view_range: [1, -1] }), end('view', true, 'a.txt'),
  ]));
  assert.deepEqual(result.rows.map(row => row.targets), [[], ['src'], [], ['src', 'src'], ['dir']]);
  assert.equal(result.references, 2);
  assert.match(result.rows[0].scopeNote, /file.list.*not.*contents/i);
  assert.match(result.rows[1].scopeNote, /count.*not.*contents/i);
  assert.match(result.rows[2].request, /mode not recorded/i);
  assert.match(result.rows[3].scopeNote, /file.list.*not.*contents/i);
  assert.match(result.rows[4].scopeNote, /file.*image.*directory/i);
  assert.equal(result.rows[4].partial, false, 'An EOF request does not establish a partial file or full returned extent.');
  assert.match(result.rows[4].scopeNote, /extent.*unknown/i);
});

test('only complete known contracts classify requests; MCP aliases and explicit custom evidence do not', async () => {
  for (const [name, args, data] of [
    ['view', { path: 'file' }, { mcpServerName: 'local', mcpToolName: 'echo' }],
    ['view', { path: 'file' }, { mcpToolName: 'echo' }],
    ['view', { path: 'file' }, { origin: 'custom' }],
    ['view', { path: 'file' }, { overridesBuiltInTool: true }],
    ['custom_view', { path: 'file' }, {}], ['view', { path: 'file', command: 'other' }, {}],
    ['view', { path: 'file', view_range: [5, 2] }, {}],
    ['grep', { pattern: 'x', head_limit: 1.5 }, {}], ['glob', { pattern: 'x', paths: [] }, {}],
    ['web_fetch', { url: 'javascript:alert(1)' }, {}], ['web_fetch', { url: 'https://example.invalid', raw: 'true' }, {}],
  ]) {
    const result = ledger(await observe([start('call', name, args, {}, data), end('call', true, 'echo content')]));
    assert.equal(result.rows.length, 0, JSON.stringify([name, args, data]));
    assert.equal(result.unclassified.length, 1);
    assert.deepEqual(result.unclassified[0].links.map(link => link.id), ['call-start', 'call-end']);
  }
  const excluded = ledger(await observe([start('edit', 'edit', { path: 'file' }), start('exec', 'powershell', { command: 'cat file', description: 'Read' })]));
  assert.equal(excluded.rows.length, 0);
  assert.equal(excluded.other, 2);
});

test('clipped, conflicting, malformed or evicted boundary evidence remains navigable and unclassified', async () => {
  const entries = await observe([start('call', 'view', { path: 'file' }), end('call', true, 'body')]);
  for (const altered of [
    [entries[1]],
    [entries[0], { ...entries[1], truncated: true }],
    [entries[0], { ...entries[1], evidence: '{' }],
    [{ ...entries[0], agentId: 'wrong' }, entries[1]],
    [entries[0], { ...entries[1], toolCallId: 'wrong' }],
    [entries[0], { ...entries[0], id: 'duplicate' }, entries[1]],
    [entries[0], entries[1], { ...entries[1], id: 'duplicate' }],
  ]) {
    const result = ledger(altered);
    assert.equal(result.rows.filter(row => row.status === 'returned').length, 0);
    assert.ok(result.unclassified.length > 0);
    assert.ok(result.unclassified.every(row => row.links.length > 0));
  }
  const clipped = ledger(await observe([start('huge', 'view', { path: 'file' }), end('huge', true, '🧪'.repeat(6500))]));
  assert.equal(clipped.rows.length, 0);
  assert.match(clipped.unclassified[0].note, /shortened/i);
  assert.equal(clipped.references, 0);
  const none = ledger([], { history: 'unsupported', omitted: 9 });
  assert.match(none.note, /did not expose the session event API/i);
  assert.match(none.note, /older events.*omitted/i);
});

test('unknown or contradictory success never promotes detailed display data to retrieved text', async () => {
  for (const data of [
    { success: undefined, result: { content: 'body' } },
    { success: true, result: { detailedContent: 'display only' } },
    { success: true, result: { content: { text: 'body' } } },
    { success: true, result: { content: 'body' }, error: { code: 'failure' } },
  ]) {
    const result = ledger(await observe([start('call', 'view', { path: 'file' }), end('call', true, null, {}, data)]));
    assert.equal(result.rows[0].status, 'unavailable');
    assert.equal(result.rows[0].content, null);
    if (data.success === true && !data.error) assert.match(result.rows[0].statusLabel, /reported success.*text unavailable/i);
  }
  const entries = await observe([start('call', 'view', { path: 'file' }), end('call', true, 'body')]);
  assert.equal(ledger([entries[0], { ...entries[1], success: false }]).rows[0].status, 'unavailable');
});

test('the ledger uses the retained window and keeps same-call requests in separate source contexts', async () => {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => [
    ...Array.from({ length: 301 }, (_, index) => start(`read-${index}`, 'view', { path: `file-${index}` })),
  ] });
  await trace.ready;
  const snapshot = trace.snapshot(), result = ledger(snapshot.entries, snapshot); trace.close();
  assert.equal(result.rows.length, 300);
  assert.equal(result.rows[0].id, 'read-1-start');
  assert.equal(result.references, 300);
  assert.match(result.note, /older events.*omitted/i);
  const separate = ledger(await observe([
    start('same', 'view', { path: 'main' }),
    start('same', 'view', { path: 'child' }, { id: 'child-start', agentId: 'child' }),
    end('same', true, 'child body', { id: 'child-end', agentId: 'child' }),
  ]));
  assert.equal(separate.rows[0].status, 'missing');
  assert.equal(separate.rows[1].status, 'returned');
  assert.equal(separate.rows[1].content, 'child body');
});

test('semantic retrieval rejects unusable identities and incompatible result providers without changing Statistics', async () => {
  for (const [label, raw] of [
    ['whitespace call', [start(' ', 'view', { path: 'file' }), end(' ', true, 'body')]],
    ['whitespace source', [start('call', 'view', { path: 'file' }, { agentId: ' ' }), end('call', true, 'body', { agentId: ' ' })]],
    ['whitespace event', [start('call', 'view', { path: 'file' }, { id: ' ' }), end('call', true, 'body')]],
    ...['origin', 'overridesBuiltInTool', 'mcpServerName', 'mcpToolName', 'mcpConfigServerName'].map(field => [field,
      [start('call', 'view', { path: 'file' }), end('call', true, 'body', {}, { [field]: field === 'overridesBuiltInTool' ? true : 'custom' })]]),
    ['protected request', [start('call', 'view', { path: 'file', encryptedContent: 'hidden' }), end('call', true, 'body')]],
    ['protected result', [start('call', 'view', { path: 'file' }), end('call', true, 'body', {}, { reasoningOpaque: 'hidden' })]],
  ]) {
    const entries = await observe(raw), result = ledger(entries);
    assert.equal(presentation.summarize(entries).tools, 1, label);
    assert.equal(result.rows.length, 0, label); assert.equal(result.references, 0, label);
    assert.equal(result.unclassified.length, 1, label);
    assert.match(result.unclassified[0].extent.returned, /unknown/i, label);
    assert.deepEqual(result.unclassified[0].extent.requested, [], label);
    assert.equal(result.unclassified[0].links.length, 2, label);
  }
});

test('semantic retrieval rejects ambiguous event IDs and reversed boundaries while keeping independent shortening facts', async () => {
  const entries = await observe([start('call', 'view', { path: 'file', view_range: [2, 3] }), end('call', true, 'body')]);
  const duplicate = await observe([start('other', 'view', { path: 'other' }, { id: entries[1].id, agentId: 'child' })]);
  for (const altered of [[entries[1], entries[0]], [...entries, ...duplicate],
    [entries[0], { ...entries[1], protectedContentOmitted: 'invalid' }]]) {
    const result = ledger(altered);
    assert.equal(result.rows.length, 0); assert.ok(result.unclassified.length > 0);
    assert.ok(result.unclassified.every(row => /unknown/i.test(row.extent.returned)));
    assert.ok(result.unclassified.every(row => row.extent.requested.length === 0));
  }
  const shortened = await observe([start('call', 'view', { path: 'file' }), end('call', true, '', {}, {
    origin: 'custom', result: { content: 'preview', contents: [{ type: 'shell_exit', shellId: '0', exitCode: 0, outputTruncated: true, outputPreview: 'preview' }] },
  })]);
  const extent = ledger(shortened).unclassified[0].extent;
  assert.equal(extent.hostShortened, true); assert.match(extent.returned, /unknown/i);
});
