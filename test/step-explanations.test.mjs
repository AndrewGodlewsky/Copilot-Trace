import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

async function observed(type, data = {}, extra = {}) {
  const trace = createTrace({ on() { return () => {}; }, async getEvents() {
    return [{ id: 'event', type, timestamp: '2026-11-20T12:00:00Z', data, ...extra }];
  } });
  await trace.ready;
  const entry = trace.snapshot().entries[0];
  trace.close();
  return entry;
}

test('each supported event explains its recorded boundary, teaching meaning and uncertainty', async () => {
  assert.equal(typeof presentation.explainStep, 'function', 'Event explanations are available to the actual renderer.');
  const cases = [
    ['user.message', /input/i], ['assistant.turn_start', /turn.*start/i],
    ['assistant.turn_end', /turn.*end/i], ['assistant.intent', /reported activity/i],
    ['assistant.message', /assistant message/i], ['assistant.reasoning', /reasoning text/i],
    ['tool.execution_start', /invocation/i], ['tool.execution_complete', /tool result/i],
    ['skill.invoked', /skill/i], ['subagent.started', /delegated agent/i],
    ['subagent.completed', /delegated.*outcome/i], ['subagent.failed', /failure/i],
    ['hook.start', /hook.*start/i], ['hook.end', /hook result/i],
    ['permission.requested', /requested.*permission decision/i], ['permission.completed', /permission decision/i],
    ['session.compaction_start', /compaction.*start/i], ['session.compaction_complete', /compaction result/i],
    ['session.error', /error/i], ['session.info', /informational/i],
    ['session.warning', /warning/i], ['abort', /interruption/i],
  ];
  for (const [type, what] of cases) {
    const entry = await observed(type);
    const explanation = presentation.explainStep(entry);
    assert.match(explanation.happened, what, type);
    for (const section of ['happened', 'means', 'unknown']) {
      assert.ok(explanation[section].length > 20 && explanation[section].length < 500, `${type}: ${section} is concise and meaningful.`);
    }
    assert.equal(explanation.general, entry.explanation, `${type}: Preserve the authored definition.`);
  }
});

test('tool invocation, recorded success, failure and unavailable result remain different claims', async () => {
  const invocation = presentation.explainStep(await observed('tool.execution_start'));
  assert.match(invocation.means, /does not prove.*execut/i);
  assert.match(invocation.unknown, /outcome|result/i);
  for (const type of ['tool.execution_complete', 'hook.end', 'session.compaction_complete']) {
    const good = presentation.explainStep(await observed(type, { success: true }));
    const bad = presentation.explainStep(await observed(type, { success: false }));
    const missing = presentation.explainStep(await observed(type));
    assert.match(good.means, /reports success/i, type);
    assert.match(bad.means, /reports failure/i, type);
    assert.match(missing.means, /outcome.*unavailable/i, type);
    assert.match(good.unknown, /task|correct|later/i, type);
    assert.notEqual(good.means, bad.means);
    for (const success of [null, 0, 'true', [], {}]) {
      assert.match(presentation.explainStep(await observed(type, { success })).means, /outcome.*unavailable/i);
    }
  }
});

test('assistant statements are reported text and never independently verified reasons', async () => {
  for (const type of ['assistant.intent', 'assistant.message', 'assistant.reasoning']) {
    const explanation = presentation.explainStep(await observed(type, { content: 'I know why <script>日本語😀', intent: 'I know why' }));
    assert.match(explanation.means, /reported|statement|exposed/i);
    assert.match(explanation.unknown, /reason|internal|correct|verified/i);
    assert.doesNotMatch(explanation.happened + explanation.means, /I know why/);
  }
});

test('skill and input attribution use exact known recorded fields without inventing intent', async () => {
  const skill = presentation.explainStep(await observed('skill.invoked', { trigger: 'agent-invoked' }));
  assert.match(skill.means, /recorded trigger.*agent-invoked/i);
  assert.match(skill.unknown, /instruction|choice/i);
  assert.match(presentation.explainStep(await observed('skill.invoked', { trigger: 'agent-invoked<script>' })).means, /trigger.*unavailable|unrecognized/i);
  const queued = presentation.explainStep(await observed('user.message', { delivery: 'queued' }));
  assert.match(queued.means, /queued/);
  assert.match(queued.unknown, /read|acted|response/i);
});

test('subagent cancellation is distinct from a completed event and cannot be inferred from prose', async () => {
  for (const [cancelled, expected] of [[true, /cancellation/i], [false, /without cancellation/i], [undefined, /cancellation.*unavailable/i]]) {
    const entry = await observed('subagent.completed', { cancelled, content: 'Everything succeeded.' });
    const result = presentation.explainStep(entry);
    assert.match(result.means, expected);
    assert.match(result.unknown, /task|correct/i);
  }
});

test('permission kinds describe recorded decisions without assuming a person or execution', async () => {
  for (const kind of ['approved', 'approved-read-only-for-session', 'approved-for-session', 'approved-for-location']) {
    const result = presentation.explainStep(await observed('permission.completed', { result: { kind } }));
    assert.ok(result.means.includes(kind));
    assert.match(result.means, /does not prove.*execut/i);
    assert.match(result.unknown, /decision source.*unavailable/i);
  }
  for (const kind of ['denied-by-rules', 'denied-no-approval-rule-and-could-not-request-from-user', 'denied-interactively-by-user',
    'denied-by-content-exclusion-policy', 'denied-by-permission-request-hook', 'cancelled']) {
    const result = presentation.explainStep(await observed('permission.completed', { result: { kind } }));
    assert.ok(result.means.includes(kind));
    assert.match(result.unknown, /decision source.*unavailable/i);
    assert.doesNotMatch(result.happened + result.means, /(?:person|human|you) (?:denied|approved|cancelled)/i);
  }
  const attributed = presentation.explainStep(await observed('permission.completed', {
    result: { kind: 'approved' }, decisionSource: 'human_response',
  }));
  assert.match(attributed.unknown, /Recorded decision source: human_response/);
  assert.match(attributed.unknown, /does not.*person/i);
  for (const result of [{ kind: 'approved<script>' }, null, [], 'approved', { kind: 'future' }]) {
    assert.match(presentation.explainStep(await observed('permission.completed', { result })).means, /unavailable|unrecognized/i);
  }
});

test('shortened, malformed or mismatched evidence cannot supply an outcome or attribution', async () => {
  const entry = await observed('subagent.completed', { cancelled: true });
  const raw = JSON.parse(entry.evidence);
  const cases = [
    { truncated: true }, { evidence: '{' }, { evidence: 'null' }, { evidence: '[]' },
    { evidence: JSON.stringify({ ...raw, id: 'different' }) },
    { evidence: JSON.stringify({ ...raw, type: 'subagent.failed' }) },
    { evidence: JSON.stringify({ ...raw, agentId: 'other' }) },
    { evidence: JSON.stringify({ ...raw, timestamp: 'different' }) },
    { evidence: JSON.stringify({ ...raw, data: [] }) }, { evidence: ' '.repeat(12001) },
    { agentId: null }, { id: '' }, { id: 'x'.repeat(257) },
  ];
  for (const extra of cases) {
    const result = presentation.explainStep({ ...entry, ...extra });
    assert.match(result.means, /cancellation.*unavailable/i, JSON.stringify(extra));
    assert.match(result.unknown, /complete.*matching.*unavailable/i);
  }
  const tool = await observed('tool.execution_complete', { success: true });
  assert.match(presentation.explainStep({ ...tool, success: false }).means, /outcome.*unavailable/i);
  assert.match(presentation.explainStep({ ...tool, truncated: true }).means, /outcome.*unavailable/i);
  const skill = await observed('skill.invoked', { trigger: 'user-invoked' });
  assert.match(presentation.explainStep({ ...skill, trigger: 'agent-invoked' }).means, /trigger.*unavailable|unrecognized/i);
});

test('unknown types and missing entries use neutral explanations without prefix guessing', () => {
  for (const type of ['assistant.future', 'tool.future', 'toString', '__proto__', '', null, undefined]) {
    const result = presentation.explainStep({ type, success: true, explanation: 'Invented reason', preview: 'Success' });
    assert.match(result.happened, /unrecognized|unknown/i);
    assert.match(result.means, /unavailable/i);
    assert.match(result.unknown, /reason|outcome/i);
    assert.doesNotMatch(JSON.stringify(result), /Invented reason|Success/);
  }
  assert.deepEqual(presentation.explainStep(), presentation.explainStep({}));
});

test('Unicode and markup stay in literal evidence and authored definitions without interpretation', async () => {
  const literal = '<img src=x onerror=alert(1)>日本語😀\n A  B';
  const entry = await observed('assistant.message', { content: literal });
  const original = structuredClone(entry);
  const result = presentation.explainStep({ ...entry, explanation: literal });
  assert.equal(result.general, literal);
  assert.deepEqual(entry, original);
  assert.equal(JSON.parse(entry.evidence).data.content, literal);
  assert.doesNotMatch(result.happened + result.means + result.unknown, /<img/);
});
