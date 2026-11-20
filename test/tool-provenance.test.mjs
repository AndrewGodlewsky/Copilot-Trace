import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const start = (id, data = {}, extra = {}) => ({ id, type: 'tool.execution_start', timestamp: '2026-11-20T12:00:00Z',
  data: { toolCallId: id, toolName: 'renamed-tool', mcpConfigServerName: 'first', mcpServerName: 'first',
    mcpToolName: 'echo', mcpServerDisplayName: 'Shared provider 日本語😀', ...data }, ...extra });
const end = (id, call, extra = {}) => ({ id, type: 'tool.execution_complete', timestamp: '2026-11-20T12:00:01Z',
  data: { toolCallId: call, success: true }, ...extra });
async function observe(raw, extra = {}) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw, ...extra });
  await trace.ready;
  const entries = trace.snapshot().entries;
  trace.close();
  return entries;
}
function provenance(entries) {
  assert.equal(typeof presentation.toolProvenance, 'function', 'The renderer can describe recorded tool provenance.');
  return presentation.toolProvenance(entries);
}

test('identical provider titles and raw tool names retain distinct invocation-specific configured identities', async () => {
  const entries = await observe([start('first'), start('second', { toolName: 'other-alias', mcpConfigServerName: 'second', mcpServerName: 'second' }),
    end('first-result', 'first'), end('second-result', 'second')]);
  const original = structuredClone(entries), origins = provenance(entries);
  for (const [id, key, modelName] of [['first', 'first', 'renamed-tool'], ['second', 'second', 'other-alias']]) {
    const origin = origins.get(id);
    assert.equal(origin.origin, 'MCP');
    assert.equal(origin.provider, 'Shared provider 日本語😀');
    assert.equal(origin.serverKey, key);
    assert.equal(origin.toolName, 'echo');
    assert.equal(origin.modelToolName, modelName);
    assert.equal(origin.basisId, id);
    assert.match(origin.basis, /tool.execution_start/);
    assert.match(origin.uncertainty, /does not prove.*network/i);
    assert.match(origin.uncertainty, /safety|safe/i);
    assert.match(origin.uncertainty, /authorization/i);
    assert.deepEqual(origins.get(`${id}-result`), origin);
  }
  assert.deepEqual(entries, original, 'Provenance preserves every original field and evidence string.');
  assert.equal(presentation.summarize(entries).tools, 2);
});

test('configuration source plugin or builtin stays MCP and does not claim native tool origin', async () => {
  for (const source of ['user', 'workspace', 'plugin', 'builtin', 'managed', 'account']) {
    const [entry] = await observe([start(source, { mcpConfigSource: source, mcpTransport: 'memory' })]);
    const origin = provenance([entry]).get(source);
    assert.equal(origin.origin, 'MCP');
    assert.equal(origin.configSource, source);
    assert.equal(origin.transport, 'memory');
    assert.match(origin.uncertainty, /configuration.*native/i);
  }
  const entries = await observe(['powershell', 'builtin:powershell', 'plugin:echo', 'mcp__first__echo'].map(name => start(name, {
    toolName: name, mcpToolName: undefined, mcpServerName: undefined, mcpConfigServerName: undefined,
    mcpServerDisplayName: undefined, origin: 'builtin', pluginName: 'Not verified', toolTitle: 'MCP tool',
  })));
  for (const origin of provenance(entries).values()) {
    assert.equal(origin.origin, 'Unknown');
    assert.equal(origin.provider, null);
    assert.match(origin.uncertainty, /built-in|plugin/i);
  }
});

test('explicit configured key takes priority over legacy server display names without treating a title as identity', async () => {
  const entries = await observe([start('legacy', { mcpServerName: 'Legacy title', mcpServerDisplayName: undefined }),
    start('ambiguous', { mcpConfigServerName: undefined, mcpServerName: 'Legacy title', mcpServerDisplayName: undefined }),
    start('key-only', { mcpServerName: undefined }),
    start('display-only', { mcpConfigServerName: undefined, mcpServerName: undefined })]);
  const origins = provenance(entries);
  assert.equal(origins.get('legacy').serverKey, 'first');
  assert.equal(origins.get('legacy').serverName, 'Legacy title');
  assert.equal(origins.get('legacy').provider, null);
  assert.equal(origins.get('ambiguous').origin, 'MCP');
  assert.equal(origins.get('ambiguous').serverKey, null);
  assert.match(origins.get('ambiguous').uncertainty, /legacy.*display name/i);
  assert.equal(origins.get('key-only').origin, 'MCP');
  assert.equal(origins.get('display-only').origin, 'Unknown');
});

test('metadata changes and independent calls never inherit a provider through a name, source or previous snapshot', async () => {
  const original = await observe([start('same')]);
  assert.equal(provenance(original).get('same').serverKey, 'first');
  const changed = await observe([start('same', { mcpConfigServerName: 'changed', mcpServerName: 'changed', mcpServerDisplayName: 'New provider' })]);
  assert.equal(provenance(changed).get('same').provider, 'New provider');
  const noMetadata = await observe([start('same', { mcpServerName: undefined, mcpConfigServerName: undefined, mcpToolName: undefined })]);
  assert.equal(provenance(noMetadata).get('same').origin, 'Unknown');
  const sources = await observe([start('root', { toolCallId: 'shared' }),
    start('child', { toolCallId: 'shared', mcpServerName: 'child', mcpConfigServerName: 'child' }, { agentId: 'child' }),
    end('child-result', 'shared', { agentId: 'child' }), end('other-result', 'shared', { agentId: 'different' })]);
  assert.equal(provenance(sources).get('child-result').serverKey, 'child');
  assert.equal(provenance(sources).get('other-result').origin, 'Unknown');
  const differentSession = await observe([end('first-session-result', 'same')]);
  assert.equal(provenance(differentSession).get('first-session-result').origin, 'Unknown');
});

test('conflicting boundaries and result-only calls never select an invocation provider', async () => {
  for (const raw of [[start('a'), start('b', { toolCallId: 'a', mcpConfigServerName: 'second' }), end('end', 'a')],
    [start('a'), end('end', 'a'), end('other-end', 'a')], [end('end', 'a')]]) {
    const entries = await observe(raw);
    for (const origin of provenance(entries).values()) {
      assert.equal(origin.origin, 'Unknown');
      assert.equal(origin.basisId, null);
    }
  }
});

test('complete raw and projected identities must match before a start or result can supply provenance', async () => {
  const [entry] = await observe([start('a')]);
  const raw = JSON.parse(entry.evidence);
  const changes = [
    { truncated: true }, { evidence: '{' }, { evidence: 'null' }, { evidence: '[]' }, { evidence: ' '.repeat(12001) },
    { agentId: null }, { agentId: 'other' }, { id: '' }, { id: 'x'.repeat(257) }, { toolCallId: 'different' }, { toolName: 'different' },
    ...[{ id: 'different' }, { type: 'tool.execution_complete' }, { agentId: 'other' }, { agentId: '' },
      { timestamp: 'different' }, { data: [] }, { data: { ...raw.data, toolCallId: 'different' } }]
      .map(extra => ({ evidence: JSON.stringify({ ...raw, ...extra }) })),
  ];
  for (const extra of changes) assert.equal(provenance([{ ...entry, ...extra }]).values().next().value.origin, 'Unknown', JSON.stringify(extra));
  const pair = await observe([start('a'), end('end', 'a')]);
  const resultRaw = JSON.parse(pair[1].evidence);
  const mismatched = { ...pair[1], evidence: JSON.stringify({ ...resultRaw, data: { ...resultRaw.data, toolCallId: 'different' } }) };
  assert.equal(provenance([pair[0], mismatched]).get('end').origin, 'Unknown');
  assert.equal(provenance([pair[0], { ...pair[1], truncated: true }]).get('end').origin, 'Unknown');
});

test('malformed or oversized identity and provenance fields stay unknown without guessed or clipped identities', async () => {
  for (const field of ['mcpToolName', 'mcpServerName', 'mcpConfigServerName', 'mcpServerDisplayName']) {
    for (const value of ['', ' ', null, false, {}, [], 'x'.repeat(257)]) {
      const entries = await observe([start('a', { [field]: value })]);
      assert.equal(provenance(entries).get('a').origin, 'Unknown', `${field}: ${JSON.stringify(value)}`);
    }
  }
  for (const data of [{ toolName: 'x'.repeat(181) }, { toolCallId: 'x'.repeat(257) },
    { mcpTransport: 'future' }, { mcpConfigSource: 'future' }, { arguments: { text: 'x'.repeat(12000) } }]) {
    assert.equal(provenance(await observe([start('a', data)])).get('a').origin, 'Unknown');
  }
  const longName = 'x'.repeat(256);
  const exact = provenance(await observe([start('a', { mcpConfigServerName: longName, mcpToolName: longName })])).get('a');
  assert.equal(exact.origin, 'MCP');
  assert.equal(exact.serverKey, longName);
  assert.equal(exact.toolName, longName);
});

test('provenance leaves ordinary collection intact when discovery is missing or would fail', async () => {
  let discoveryCalls = 0;
  const entries = await observe([start('a'), end('end', 'a')], { rpc: { tools: {
    getCurrentMetadata() { discoveryCalls++; throw new Error('Unsupported discovery'); },
    initializeAndValidate() { discoveryCalls++; throw new Error('Must not initialize'); },
  } } });
  assert.equal(provenance(entries).get('end').origin, 'MCP');
  assert.equal(discoveryCalls, 0);
  assert.equal(entries.length, 2);
  const native = await observe([start('a', { mcpToolName: undefined })]);
  assert.equal(provenance(native).get('a').origin, 'Unknown');
});
