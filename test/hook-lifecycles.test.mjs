import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

async function projected(records) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => records });
  await trace.ready;
  const entries = trace.snapshot().entries;
  trace.close();
  return entries;
}
function event(id, type, hookInvocationId = 'pipeline', hookType = 'preToolUse', extra = {}) {
  return { id, type: `hook.${type}`, timestamp: '2026-11-20T12:00:00Z',
    data: { hookInvocationId, hookType, ...(type === 'end' ? { success: true } : {}), ...extra } };
}

test('hook invocations count exact source identities once without moving interleaved original boundaries', async () => {
  assert.equal(typeof presentation.hookInvocations, 'function');
  const entries = await projected([event('a', 'start'), event('b', 'start', 'second'),
    { ...event('child-start', 'start'), agentId: 'child' }, event('c', 'end'), event('d', 'end', 'second'),
    { ...event('child-end', 'end'), agentId: 'child' }]);
  const calls = presentation.hookInvocations(entries);
  assert.deepEqual(calls.map(call => [call.agentId, call.hookInvocationId, call.status, call.outcome]), [
    ['', 'pipeline', 'paired', 'success'], ['', 'second', 'paired', 'success'], ['child', 'pipeline', 'paired', 'success'],
  ]);
  assert.deepEqual(calls.map(call => call.entries.map(entry => entry.id)), [['a', 'c'], ['b', 'd'], ['child-start', 'child-end']]);
  assert.deepEqual(presentation.groupSteps(entries).flatMap(group => group.entries), entries);
  assert.equal(presentation.summarize(entries).hooks, 3);
  assert.deepEqual(presentation.summarize(entries).hookNames, [['preToolUse', 3]]);
  assert.match(presentation.describeHookGroup(entries.slice(0, 2)).subtitle, /2 pipeline invocations.*2 events/);
});

test('invalid invocation and source identities stay unlinked in summaries and Statistics', async () => {
  for (const value of [undefined, null, 1, {}, [], '', 'x'.repeat(257)]) {
    const entries = await projected([event('a', 'start', value), event('b', 'end', value)]);
    // Explicitly replace projection too: consumers must not coerce malformed snapshot fields.
    for (const entry of entries) entry.hookInvocationId = value;
    const calls = presentation.hookInvocations(entries);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => !call.linked && call.status === 'unlinked' && call.outcome === 'unknown'));
    assert.equal(presentation.summarize(entries).hooks, 0);
    assert.equal(presentation.summarize(entries).unlinked, 2);
  }
  for (const agentId of [undefined, null, 1, [], {}, 'x'.repeat(257)]) {
    const entries = (await projected([event('a', 'start'), event('b', 'end')])).map(entry => ({ ...entry, agentId }));
    assert.equal(presentation.summarize(entries).hooks, 0);
    assert.equal(presentation.hookInvocations(entries).length, 2);
    assert.equal(presentation.groupSteps(entries).length, 2);
  }
});

test('partial and conflicting hook pairs never imply running or a successful whole invocation', async () => {
  const cases = [
    [[event('a', 'start')], 'start-only', 'unknown', /end.*not retained/i],
    [[event('b', 'end', 'pipeline', 'preToolUse', { success: false })], 'end-only', 'failure', /start.*not retained/i],
    [[event('a', 'start'), event('b', 'start'), event('c', 'end')], 'conflict', 'unknown', /duplicate/i],
    [[event('a', 'start'), event('b', 'end'), event('c', 'end')], 'conflict', 'unknown', /duplicate/i],
    [[event('a', 'start'), event('b', 'end', 'pipeline', 'postToolUse')], 'conflict', 'unknown', /conflicting.*types/i],
    [[event('b', 'end'), event('a', 'start')], 'conflict', 'unknown', /before.*start/i],
  ];
  for (const [raw, status, outcome, note] of cases) {
    const entries = await projected(raw);
    const [call] = presentation.hookInvocations(entries);
    assert.equal(call.status, status);
    assert.equal(call.outcome, outcome);
    assert.match(call.notes.join(' '), note);
    assert.equal(presentation.summarize(entries).hooks, 1);
    if (raw[0].data.hookType !== raw.at(-1).data.hookType) {
      assert.deepEqual(presentation.summarize(entries).hookNames, [['Conflicting hook types', 1]]);
    }
  }
});

test('documented timing distinguishes successful results, failure-only results, prompts and agent stops', async () => {
  const cases = [
    ['preToolUse', /before.*tool/i], ['preMcpToolCall', /before.*MCP/i],
    ['postToolUse', /successful.*tool|tool.*successful/i], ['postToolUseFailure', /failure.*denied.*timeout/i],
    ['userPromptSubmitted', /submits.*prompt/i], ['userPromptTransformed', /transforms.*before.*stored/i],
    ['sessionStart', /session.*starts/i], ['sessionEnd', /session.*ends/i], ['errorOccurred', /error.*occurs/i],
    ['agentStop', /natural.*stop.*abort/i], ['subagentStart', /before.*first turn/i], ['subagentStop', /after.*turn/i],
  ];
  for (const [type, timing] of cases) {
    const [call] = presentation.hookInvocations(await projected([event('a', 'start', 'pipeline', type)]));
    assert.equal(call.hookType, type);
    assert.match(call.timing, timing);
  }
  const future = 'future <img> 日本語😀' + 'x'.repeat(200);
  const [call] = presentation.hookInvocations(await projected([event('a', 'end', 'pipeline', future, { output: { decision: 'block', additionalContext: 'Do this' } })]));
  assert.equal(call.hookType, future);
  assert.deepEqual(presentation.summarize(call.entries).hookNames, [[future, 1]]);
  assert.match(call.timing, /unknown/i);
  assert.deepEqual(call.reported, []);
  assert.match(call.output, /additionalContext/);
});

test('only complete matching hook evidence supplies typed decisions, context, error and output', async () => {
  const text = '<img onerror="bad"> 日本語😀\nexact output';
  const entries = await projected([event('a', 'start'), event('b', 'end', 'pipeline', 'preToolUse', {
    success: false, error: { message: text, source: 'fixture' }, output: { permissionDecision: 'deny', additionalContext: text },
  })]);
  const [call] = presentation.hookInvocations(entries);
  assert.equal(call.outcome, 'failure');
  assert.deepEqual(call.reported.map(item => [item.field, item.value]), [['additionalContext', text], ['permissionDecision', 'deny']]);
  assert.equal(JSON.parse(call.error).message, text);
  assert.equal(JSON.parse(call.output).additionalContext, text);
  for (const change of [
    { truncated: true }, { evidence: '{' }, { evidence: ' '.repeat(12001) },
    { evidence: JSON.stringify({ ...JSON.parse(entries[1].evidence), id: 'other' }) },
    { evidence: JSON.stringify({ ...JSON.parse(entries[1].evidence), agentId: 'other' }) },
    { evidence: JSON.stringify({ ...JSON.parse(entries[1].evidence), timestamp: 'other' }) },
    { evidence: JSON.stringify({ ...JSON.parse(entries[1].evidence), data: { hookInvocationId: 'other', hookType: 'preToolUse', success: true, output: { additionalContext: text } } }) },
    { evidence: JSON.stringify({ ...JSON.parse(entries[1].evidence), data: { hookInvocationId: 'pipeline', hookType: 'postToolUse', success: false, output: { additionalContext: text } } }) },
  ]) {
    const [changed] = presentation.hookInvocations([entries[0], { ...entries[1], ...change }]);
    assert.equal(changed.outcome, 'unknown');
    assert.equal(changed.output, null);
    assert.equal(changed.error, null);
    assert.deepEqual(changed.reported, []);
  }
});

test('pipeline success, inputs and generic prose cannot invent context or blocking effects', async () => {
  const cases = [
    ['preToolUse', { input: { additionalContext: 'input only' } }],
    ['preToolUse', { output: 'I approved and injected context' }],
    ['preToolUse', { output: { permissionDecision: 'approved', additionalContext: {} } }],
    ['preMcpToolCall', { output: { permissionDecision: 'deny', additionalContext: 'not this contract' } }],
    ['subagentStop', { output: { decision: 'block', reason: '' } }],
  ];
  for (const [type, extra] of cases) {
    const [call] = presentation.hookInvocations(await projected([event('a', 'end', 'pipeline', type, extra)]));
    assert.deepEqual(call.reported, []);
    assert.match(call.notes.join(' '), /configured handler.*unknown/i);
  }
  for (const type of ['postToolUse', 'postToolUseFailure', 'userPromptSubmitted', 'sessionStart', 'subagentStart']) {
    const [call] = presentation.hookInvocations(await projected([event('a', 'end', 'pipeline', type, { output: { additionalContext: 'context' } })]));
    assert.equal(call.reported[0].field, 'additionalContext');
  }
  for (const [type, output, field] of [
    ['userPromptSubmitted', { decision: 'block' }, 'decision'], ['agentStop', { decision: 'block', reason: 'continue' }, 'decision'],
    ['subagentStop', { decision: 'allow' }, 'decision'], ['subagentStop', { decision: 'block', reason: 'continue' }, 'decision'],
    ['errorOccurred', { errorHandling: 'retry' }, 'errorHandling'],
  ]) {
    const [call] = presentation.hookInvocations(await projected([event('a', 'end', 'pipeline', type, { output })]));
    assert.equal(call.reported[0].field, field);
  }
});
