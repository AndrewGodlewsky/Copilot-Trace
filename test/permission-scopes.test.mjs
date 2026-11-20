import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const event = (id, type, data, agentId) => ({ id, type, timestamp: '2026-11-20T12:00:00Z', data,
  ...(agentId === undefined ? {} : { agentId }) });
const decision = (result, extra = {}) => event('decision', 'permission.completed', { requestId: 'request', toolCallId: 'call', result, ...extra });
async function project(raw) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
async function scope(result) {
  assert.equal(typeof presentation.permissionScope, 'function', 'Recorded permission scope is available to the renderer and runtime fixture.');
  return presentation.permissionScope((await project([decision(result)]))[0]);
}
const approvals = [
  [{ kind: 'commands', commandIdentifiers: ['private-command'] }, /command identifiers/],
  [{ kind: 'read' }, /read-only filesystem/], [{ kind: 'write' }, /filesystem write/],
  [{ kind: 'mcp', serverName: 'private-server', toolName: 'private-tool' }, /one MCP server tool/],
  [{ kind: 'mcp', serverName: 'private-server', toolName: null }, /all tools on one MCP server/],
  [{ kind: 'memory' }, /memory writes/], [{ kind: 'custom-tool', toolName: 'private-tool' }, /one custom tool/],
  [{ kind: 'extension-management' }, /extension-management operations/],
  [{ kind: 'extension-management', operation: 'private-operation' }, /one extension-management operation/],
  [{ kind: 'workflow' }, /workflow operations/], [{ kind: 'workflow', approvalKey: 'private-key' }, /one workflow approval key/],
  [{ kind: 'extension-permission-access', extensionName: 'private-extension' }, /permission-gated access/],
  [{ kind: 'extension-env-access', extensionName: 'private-extension', environmentVariables: ['PRIVATE_TOKEN'] }, /named environment variables/],
];

test('single-request and read-only directory approval explain only the typed recorded scope', async () => {
  for (const managedApprovalHandled of [undefined, true, false]) {
    const result = { kind: 'approved', ...(managedApprovalHandled === undefined ? {} : { managedApprovalHandled }) };
    const recorded = await scope(result);
    assert.equal(recorded.kind, 'request'); assert.equal(recorded.approvalKind, null);
    assert.match(recorded.detail, /single request/i); assert.match(recorded.detail, /no approval rule|without.*approval rule/i);
  }
  const recorded = await scope({ kind: 'approved-read-only-for-session', directories: ['private-directory'] });
  assert.equal(recorded.kind, 'session-read-only'); assert.equal(recorded.approvalKind, null);
  assert.match(recorded.detail, /read-only.*director/i); assert.match(recorded.detail, /session/);
  assert.doesNotMatch(recorded.detail, /private-directory/);
});

test('all ten typed approval variants explain session and location grants without copying targets', async () => {
  for (const [approval, category] of approvals) {
    for (const [kind, expected] of [['approved-for-session', 'session'], ['approved-for-location', 'location']]) {
      const result = { kind, approval, managedApprovalHandled: false, ...(expected === 'location' ? { locationKey: 'private-location' } : {}) };
      const recorded = await scope(result);
      assert.equal(recorded.kind, expected, JSON.stringify(result)); assert.equal(recorded.approvalKind, approval.kind);
      assert.match(recorded.detail, category); assert.match(recorded.detail, /reusable/);
      assert.match(recorded.detail, /current authority.*storage.*reuse.*not established/i);
      assert.doesNotMatch(recorded.detail, /private-|PRIVATE_TOKEN/);
    }
  }
});

test('missing malformed empty oversized and unknown scope payloads remain unknown', async () => {
  const invalid = [null, [], 'approved', {}, { kind: 'future' }, { kind: 'approved', managedApprovalHandled: 'true' },
    { kind: 'approved', approval: { kind: 'read' } }, { kind: 'approved-read-only-for-session' },
    { kind: 'approved-read-only-for-session', directories: [] }, { kind: 'approved-read-only-for-session', directories: [''] },
    { kind: 'approved-read-only-for-session', directories: ['ok', 1] },
    { kind: 'approved-read-only-for-session', directories: Array(301).fill('x') },
    { kind: 'approved-for-session' }, { kind: 'approved-for-session', approval: { kind: 'read' }, managedApprovalHandled: null },
    { kind: 'approved-for-session', approval: { kind: 'read' }, locationKey: 'unexpected' },
    { kind: 'approved-for-location', approval: { kind: 'read' } },
    { kind: 'approved-for-location', approval: { kind: 'read' }, locationKey: '' },
    { kind: 'approved-for-location', approval: { kind: 'read' }, locationKey: 42 },
    { kind: 'approved-for-location', approval: { kind: 'read' }, locationKey: 'x'.repeat(12001) },
  ];
  for (const approval of [null, [], 'read', {}, { kind: 'future' }, { kind: 'read', narrowerFutureScope: 'x' },
    { kind: 'commands' }, { kind: 'commands', commandIdentifiers: [] }, { kind: 'commands', commandIdentifiers: [' '] },
    { kind: 'commands', commandIdentifiers: ['node', null] }, { kind: 'commands', commandIdentifiers: Array(301).fill('node') },
    { kind: 'mcp', serverName: 'server' }, { kind: 'mcp', serverName: '', toolName: null },
    { kind: 'mcp', serverName: 'server', toolName: 1 }, { kind: 'custom-tool', toolName: '' },
    { kind: 'extension-management', operation: [] }, { kind: 'workflow', approvalKey: null },
    { kind: 'extension-permission-access' }, { kind: 'extension-env-access', extensionName: 'extension', environmentVariables: [] },
    { kind: 'extension-env-access', extensionName: 'extension', environmentVariables: ['ok', 1] },
  ]) invalid.push({ kind: 'approved-for-session', approval });
  for (const result of invalid) {
    const recorded = await scope(result);
    assert.equal(recorded.kind, 'unknown', JSON.stringify(result)); assert.equal(recorded.approvalKind, null);
    assert.match(recorded.detail, /scope unknown/i); assert.doesNotMatch(recorded.detail, /reusable .*grant/);
  }
});

test('scope requires complete identity-matching evidence and never interprets historical authorization records', async () => {
  const [entry] = await project([decision({ kind: 'approved-for-session', approval: { kind: 'read' } })]);
  const raw = JSON.parse(entry.evidence);
  for (const extra of [{ truncated: true }, { evidence: '{' }, { evidence: ' '.repeat(12001) }, { agentId: null },
    { evidence: JSON.stringify({ ...raw, id: 'other' }) }, { evidence: JSON.stringify({ ...raw, agentId: 'child' }) },
    { evidence: JSON.stringify({ ...raw, timestamp: 'other' }) }, { evidence: JSON.stringify({ ...raw, data: [] }) },
    ...['permission.requested', 'permission.carriedForward', 'permission.messageAuthorization'].map(type => ({ type, evidence: JSON.stringify({ ...raw, type }) }))]) {
    assert.equal(presentation.permissionScope({ ...entry, ...extra }).kind, 'unknown');
  }
  assert.equal(presentation.permissionScope().kind, 'unknown');
});

test('scope stays separate from every recorded decision kind and decision-source attribution', async () => {
  const kinds = ['approved', 'approved-read-only-for-session', 'approved-for-session', 'approved-for-location',
    'denied-by-rules', 'denied-no-approval-rule-and-could-not-request-from-user', 'denied-interactively-by-user',
    'denied-by-content-exclusion-policy', 'denied-by-permission-request-hook', 'cancelled', 'future'];
  const sources = ['assisted_approval', 'human_response', 'host_policy', 'unattended_fallback', 'authorization_carry_forward', undefined, 'future'];
  for (const kind of kinds) for (const decisionSource of sources) {
    const entries = await project([event('start', 'tool.execution_start', { toolCallId: 'call', toolName: 'powershell' }),
      decision({ kind }, { decisionSource })]);
    const stage = presentation.actionStages(entries).get('start').stages.at(-1);
    assert.equal(stage.outcome, kind.startsWith('approved') ? 'approved' : kind.startsWith('denied') ? 'denied' : kind === 'cancelled' ? 'cancelled' : 'unknown');
    assert.equal(stage.decisionSource, sources.slice(0, 5).includes(decisionSource) ? decisionSource : null);
    assert.equal(stage.scope.kind, kind === 'approved' ? 'request' : 'unknown');
    assert.match(stage.detail, /single request|scope unknown/i);
    if (stage.decisionSource === null) assert.match(stage.detail, /source unknown/i);
    assert.doesNotMatch(stage.detail, /(?:human|person|you) (?:approved|denied|cancelled)/i);
    const explanation = presentation.explainStep(entries[1]);
    if (kind.startsWith('approved')) assert.ok(explanation.means.includes(stage.scope.detail));
  }
});

test('reusable permission remains approved when a tool or typed process later reports failure', async () => {
  for (const success of [true, false]) {
    const entries = await project([
      event('start', 'tool.execution_start', { toolCallId: 'call', toolName: 'powershell', arguments: { command: 'node --test fixture.test.mjs', description: 'Run owned fixture' } }),
      decision({ kind: 'approved-for-session', approval: { kind: 'commands', commandIdentifiers: ['node'] } }),
      event('result', 'tool.execution_complete', { toolCallId: 'call', success, result: { contents: [{ type: 'shell_exit', shellId: '0', exitCode: 1 }] } }),
    ]);
    const before = structuredClone(entries), display = presentation.actionStages(entries).get('start');
    assert.equal(display.permission, 'Recorded permission: approved'); assert.equal(display.stages[1].scope.kind, 'session');
    assert.match(display.stages.at(-1).label, success ? /reported success/ : /reported failure/);
    assert.equal(presentation.validationChecks(entries)[0].exitCode, 1);
    assert.equal(presentation.validationChecks(entries)[0].toolSuccess, success);
    assert.match(display.notes.join(' '), /request unknown/); assert.deepEqual(entries, before);
  }
});

test('cancelled work and late repeated decisions retain individual scope rather than overall authorization', async () => {
  const entries = await project([
    event('start', 'tool.execution_start', { toolCallId: 'call', toolName: 'powershell' }),
    decision({ kind: 'cancelled' }), event('abort', 'abort', {}),
    event('late', 'permission.completed', { requestId: 'later', toolCallId: 'call', result: { kind: 'approved-for-session', approval: { kind: 'read' } } }),
  ]);
  const display = presentation.actionStages(entries).get('start');
  assert.deepEqual(display.stages.map(stage => stage.id), ['start', 'decision', 'late']);
  assert.deepEqual(display.stages.slice(1).map(stage => [stage.outcome, stage.scope.kind]), [['cancelled', 'unknown'], ['approved', 'session']]);
  assert.match(display.permission, /multiple.*no overall/i); assert.match(display.notes.join(' '), /Tool outcome unknown/);
});

test('grant descriptions do not make ambiguous request or recovery ownership linkable', async () => {
  const base = [event('start', 'tool.execution_start', { toolCallId: 'call', toolName: 'powershell' }),
    event('request', 'permission.requested', { requestId: 'request', permissionRequest: { toolCallId: 'call' } }),
    decision({ kind: 'approved-for-session', approval: { kind: 'read' } })];
  for (const change of [raw => raw.push({ ...raw[1], id: 'duplicate-request' }), raw => raw.push({ ...raw[2], id: 'duplicate-decision' }),
    raw => { raw[1].data.ownerSessionId = 'foreign'; }, raw => { raw[1].data.ownerAgentId = 'foreign'; },
    raw => { raw[2].data.toolCallId = 'different'; }]) {
    const raw = structuredClone(base); change(raw);
    const entries = await project(raw), display = presentation.actionStages(entries).get('start');
    assert.ok(display.stages.every(stage => !stage.type.startsWith('permission.'))); assert.equal(display.permission, 'Permission unknown');
    assert.equal(presentation.permissionScope(entries.find(entry => entry.id === 'decision')).kind, 'session', 'Original scope remains readable without assigning it to a tool.');
  }
  const child = structuredClone(base).map(raw => ({ ...raw, id: `child-${raw.id}`, agentId: 'child' }));
  child[2].data.result = { kind: 'approved-for-location', approval: { kind: 'write' }, locationKey: 'private-location' };
  const displays = presentation.actionStages(await project([...base, ...child]));
  assert.equal(displays.get('start').stages.at(-1).scope.kind, 'session');
  assert.equal(displays.get('child-start').stages.at(-1).scope.kind, 'location');
});

test('globally duplicated event IDs cannot substitute another source grant or leave trusted stage links', async () => {
  const main = await project([event('start', 'tool.execution_start', { toolCallId: 'call', toolName: 'powershell' }),
    decision({ kind: 'approved-for-session', approval: { kind: 'read' } })]);
  const childRaw = decision({ kind: 'approved-for-location', approval: { kind: 'write' }, locationKey: 'private-location' });
  const child = await project([event('child-start', 'tool.execution_start', { toolCallId: 'call', toolName: 'powershell' }, 'child'),
    { ...childRaw, agentId: 'child' }]);
  for (const entries of [[...main, ...child], [...child, ...main]]) {
    const displays = presentation.actionStages(entries);
    for (const id of ['start', 'child-start']) {
      assert.equal(displays.get(id).permission, 'Permission unknown');
      assert.ok(displays.get(id).stages.every(stage => stage.type !== 'permission.completed'));
    }
  }
  for (const duplicate of [main[0], { ...main[0], evidence: '{}' }, { ...main[1], evidence: '{}' }]) {
    const display = presentation.actionStages([...main, duplicate]).get('start');
    assert.equal(display.permission, 'Permission unknown');
    assert.ok(display.stages.every(stage => stage.type !== 'permission.completed'));
    assert.ok(display.stages.every(stage => stage.id !== duplicate.id));
  }
});
