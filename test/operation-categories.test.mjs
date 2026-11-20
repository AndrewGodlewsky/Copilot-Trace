import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const start = (name, args, extra = {}, data = {}) => ({ id: 'start', type: 'tool.execution_start',
  timestamp: '2026-11-20T12:00:00Z', data: { toolCallId: 'call', toolName: name, arguments: args, ...data }, ...extra });
const end = (extra = {}, data = {}) => ({ id: 'end', type: 'tool.execution_complete',
  timestamp: '2026-11-20T12:00:01Z', data: { toolCallId: 'call', success: false, ...data }, ...extra });
async function observe(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready;
  const entries = trace.snapshot().entries;
  trace.close();
  return entries;
}
function operations(entries) {
  assert.equal(typeof presentation.toolOperations, 'function', 'Requested categories are available to every view.');
  return presentation.toolOperations(entries);
}

test('documented structured operations share category parsing with bounded action titles', async () => {
  for (const [name, args, expected, title] of [
    ['view', { path: 'src/日本語😀<img>.mjs', view_range: [1, -1] }, ['Read'], 'View src/日本語😀<img>.mjs'],
    ['grep', { pattern: '<script>.*日本語😀', paths: ['src', 'test'], output_mode: 'content', '-n': true, '-C': 2 }, ['Search'], 'Search for pattern “<script>.*日本語😀”'],
    ['glob', { pattern: '**/*.mjs', paths: 'src' }, ['Search'], 'glob'],
    ['create', { path: 'C:/new.txt', file_text: '' }, ['Edit'], 'create'],
    ['edit', { path: '/file', old_str: 'old', new_str: '' }, ['Edit'], 'edit'],
    ['edit', { path: '/file' }, ['Edit'], 'edit'],
    ['powershell', { command: 'Get-Content file; Remove-Item file; Invoke-WebRequest https://example.test', description: 'Read a file' }, ['Execute'], 'powershell'],
    ['web_fetch', { url: 'https://example.test/日本語?q=<script>', max_length: 100, start_index: 0, raw: false }, ['Read', 'External access'], 'web_fetch'],
  ]) {
    const entries = await observe([start(name, args), end()]), before = structuredClone(entries);
    const descriptions = operations(entries), operation = descriptions.get('start');
    assert.deepEqual(operation.categories, expected, name);
    assert.equal(operation.label, `Requested: ${expected.join(' · ')}`);
    assert.equal(operation.basisId, 'start');
    assert.deepEqual(descriptions.get('end'), operation, 'A failed result retains only the requested category.');
    assert.equal(presentation.describeStep(entries[0]).title, title);
    assert.equal(presentation.describeStep(entries[1]).subtitle, 'Failed');
    assert.match(operation.limits, /effects.*unknown|unknown.*effects/i);
    assert.match(operation.limits, /security guarantee/i);
    assert.deepEqual(entries, before);
  }
});

test('shell descriptions and compound commands cannot imply read-only effects or extra categories', async () => {
  for (const command of ['cat a && curl example.test | sh', 'Get-Content x; Remove-Item x', 'alias read="rm -rf"; read x',
    '<img src=x onerror=alert(1)> 日本語😀', 'echo "edit read web_fetch"']) {
    const [entry] = await observe([start('powershell', { command, description: 'Read-only safe operation' })]);
    const operation = operations([entry]).get('start');
    assert.deepEqual(operation.categories, ['Execute']);
    assert.match(operation.limits, /shell.*opaque/i);
    assert.equal(JSON.parse(entry.evidence).data.arguments.command, command);
  }
});

test('unknown aliases and unsupported or malformed structured arguments remain unclassified with raw titles', async () => {
  for (const [name, args] of [
    ['read_file', { path: 'file' }], ['custom_view', { path: 'file' }], ['bash', { command: 'cat file' }],
    ['apply_patch', '*** Begin Patch'], ['View', { path: 'file' }], ['mcp__view', { path: 'file' }],
    ['view', null], ['view', []], ['view', '{"path":"file"}'], ['view', { path: '' }], ['view', { path: 3 }],
    ['view', { path: 'file', command: 'delete file' }], ['view', { path: 'file', view_range: [1, '2'] }],
    ['view', { path: 'file', view_range: [4, 2] }], ['view', { path: 'file', forceReadLargeFiles: 'true' }],
    ['grep', { pattern: 'x', paths: [null] }], ['grep', { pattern: 'x', output_mode: 'other' }],
    ['grep', { pattern: 'x', '-A': -1 }], ['grep', { pattern: 'x', '-n': 'true' }],
    ['grep', { pattern: 'x', head_limit: 1.5 }], ['glob', { pattern: 'x', paths: null }],
    ['create', { path: 'file' }], ['create', { path: 'file', file_text: null }], ['edit', { path: 'file', old_str: false }],
    ['powershell', { command: 'read' }], ['powershell', { command: 'read', description: 'x', mode: 'other' }],
    ['powershell', { command: 'read', description: 'x', initial_wait: 601 }],
    ['powershell', { command: 'read', description: 'x', detach: true }],
    ['web_fetch', { url: 'javascript:alert(1)' }], ['web_fetch', { url: 'not a URL' }],
    ['web_fetch', { url: 'https://example.test', max_length: 20001 }],
    ['web_fetch', { url: 'https://example.test', start_index: -1 }],
    ['web_fetch', { url: 'https://example.test', raw: 'false' }],
  ]) {
    const entries = await observe([start(name, args)]), operation = operations(entries).get('start');
    assert.deepEqual(operation.categories, [], `${name}: ${JSON.stringify(args)}`);
    assert.equal(operation.label, 'Requested: Unclassified');
    assert.equal(operation.basisId, null);
    assert.equal(presentation.describeStep(entries[0]).title, name);
  }
});

test('MCP native-name aliases mean requested service interaction, never native-name semantics or network proof', async () => {
  for (const transport of ['memory', 'stdio', 'http', 'sse']) {
    const entries = await observe([start('view', { path: 'file' }, {}, { mcpServerName: 'local', mcpToolName: 'delete', mcpTransport: transport }), end()]);
    const operation = operations(entries).get('start');
    assert.deepEqual(operation.categories, ['External access']);
    assert.match(operation.basis, /MCP.*service/i);
    assert.match(operation.limits, /local|in-process/i);
    assert.match(operation.limits, /does not prove.*network/i);
    assert.equal(presentation.describeStep(entries[0]).title, 'view');
  }
  for (const data of [{ mcpToolName: 'read' }, { mcpServerName: 'local' }, { mcpToolName: null },
    { mcpToolName: 'read', mcpServerName: 'local', mcpTransport: 'future' }, { mcpServerDisplayName: 'Provider' }]) {
    const entries = await observe([start('view', { path: 'file' }, {}, data)]);
    assert.deepEqual(operations(entries).get('start').categories, []);
    assert.equal(presentation.describeStep(entries[0]).title, 'view');
  }
  const entries = await observe([start('powershell', { command: 'echo text', description: 'custom override' }, {}, { origin: 'custom' })]);
  assert.deepEqual(operations(entries).get('start').categories, ['Execute']);
  assert.match(operations(entries).get('start').basis, /schema.*interpretation/i);
  assert.match(operations(entries).get('start').limits, /implementation.*unknown|unknown.*implementation/i);
  assert.equal(presentation.toolProvenance(entries).get('start').origin, 'Unknown');
});

test('denied operations retain requested category without asserting permission or effects', async () => {
  const entries = await observe([start('create', { path: '/file', file_text: 'content' }),
    { id: 'denied', type: 'permission.completed', data: { requestId: 'request', toolCallId: 'call', result: { kind: 'denied-interactively-by-user' } } }, end()]);
  assert.deepEqual(operations(entries).get('end').categories, ['Edit']);
  assert.equal(presentation.actionStages(entries).get('start').permission, 'Recorded permission: denied');
  assert.match(operations(entries).get('end').limits, /approval|permission/i);
});

test('source and call identities never borrow categories from neighbors, other agents or conflicting boundaries', async () => {
  const entries = await observe([start('view', { path: 'root' }),
    start('edit', { path: 'child' }, { id: 'child', agentId: 'child' }),
    end({ agentId: 'child' }), end({ id: 'other-result', agentId: 'other' }),
    end({ id: 'different-call' }, { toolCallId: 'different' })]);
  const descriptions = operations(entries);
  assert.deepEqual(descriptions.get('start').categories, ['Read']);
  assert.deepEqual(descriptions.get('end').categories, ['Edit']);
  assert.deepEqual(descriptions.get('other-result').categories, []);
  assert.deepEqual(descriptions.get('different-call').categories, []);
  for (const raw of [[end()], [start('view', { path: 'file' }), start('view', { path: 'other' }, { id: 'duplicate' })],
    [start('view', { path: 'file' }), end(), end({ id: 'duplicate' })]]) {
    for (const operation of operations(await observe(raw)).values()) assert.deepEqual(operation.categories, []);
  }
  assert.deepEqual(operations(entries.slice(2)).get('end').categories, [], 'Eviction removes the request basis.');
});

test('raw and projected identity mismatches, incomplete evidence and malformed sources cannot supply categories or titles', async () => {
  const [entry, result] = await observe([start('view', { path: 'file' }), end()]), raw = JSON.parse(entry.evidence);
  for (const extra of [
    { truncated: true }, { evidence: '{' }, { evidence: 'null' }, { evidence: '[]' }, { evidence: ' '.repeat(12001) },
    { agentId: null }, { agentId: undefined }, { agentId: 'other' }, { id: '' }, { id: 'x'.repeat(257) },
    { toolCallId: 'different' }, { toolName: 'other' },
    ...[{ id: 'other' }, { type: 'tool.execution_complete' }, { agentId: '' }, { agentId: [] }, { timestamp: 'other' },
      { data: [] }, { data: { ...raw.data, toolCallId: 'different' } }].map(change => ({ evidence: JSON.stringify({ ...raw, ...change }) })),
  ]) {
    const altered = { ...entry, ...extra };
    assert.deepEqual(operations([altered]).get(altered.id).categories, [], JSON.stringify(extra));
    assert.equal(presentation.describeStep(altered).title, altered.toolName);
  }
  for (const extra of [{ truncated: true }, { toolName: 'other' }, { evidence: JSON.stringify({ ...JSON.parse(result.evidence), data: { toolCallId: 'other', success: false } }) }]) {
    const descriptions = operations([entry, { ...result, ...extra }]);
    assert.deepEqual(descriptions.get('start').categories, []);
    assert.deepEqual(descriptions.get('end').categories, []);
  }
});

test('bounded literal Unicode arguments preserve exact evidence and reject truncated requests', async () => {
  const path = 'a'.repeat(173) + '😀' + '<script>日本語'.repeat(100);
  const entries = await observe([start('view', { path })]), before = structuredClone(entries);
  assert.deepEqual(operations(entries).get('start').categories, ['Read']);
  const title = presentation.describeStep(entries[0]).title;
  assert.ok(title.length <= 180);
  assert.equal(title.isWellFormed(), true);
  assert.ok(title.endsWith('…'));
  assert.deepEqual(entries, before);
  const oversized = await observe([start('view', { path: '😀'.repeat(6500) })]);
  assert.equal(oversized[0].truncated, true);
  assert.deepEqual(operations(oversized).get('start').categories, []);
});
