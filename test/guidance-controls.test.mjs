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
const record = (id, type, data, agentId) => ({ id, type, timestamp: '2026-11-20T12:00:00Z', data, ...(agentId ? { agentId } : {}) });
const hook = (id, type, data = {}) => record(id, `hook.${type}`, {
  hookInvocationId: 'pipeline', hookType: 'preToolUse', ...(type === 'end' ? { success: true } : {}), ...data,
});
const comparison = (entries, preferred) => {
  assert.equal(typeof presentation.guidanceComparison, 'function', 'The optional lesson must use recorded evidence, not infer enforcement from descriptions.');
  return presentation.guidanceComparison(entries, preferred);
};

test('guidance examples prefer the contextual load and keep literal supplied text separate from compliance', async () => {
  const content = '<script>deny()</script> 日本語 🧪 ' + '😀'.repeat(400);
  const entries = await projected([
    record('skill', 'skill.invoked', { name: '<img> 日本語 🧪', path: '', trigger: 'user-invoked', content }),
    record('later', 'skill.invoked', { name: 'later', path: '', content: 'Other instructions' }),
  ]);
  const [skill, hooks, permission] = comparison(entries, entries[0]);
  assert.equal(skill.target.id, 'skill');
  assert.ok(skill.facts.join(' ').includes('<img> 日本語 🧪'));
  assert.ok(content.startsWith(skill.body));
  assert.ok(skill.body.length <= 600);
  assert.match(skill.lesson, /guidance/i);
  assert.match(skill.lesson, /does not prove.*followed|not.*guarantee/i);
  assert.match(skill.lesson, /script.*separate|separate.*script/i);
  assert.equal(hooks.target, null); assert.equal(permission.target, null);
  assert.match(hooks.example, /Static example.*not from this chat/);
  assert.equal(presentation.retainedExample(entries, skill.target), true);
});

test('typed hook decisions remain requests and context or prose never becomes a permission outcome', async () => {
  const cases = [
    [{ permissionDecision: 'deny' }, ['permissionDecision']],
    [{ permissionDecision: 'allow' }, ['permissionDecision']],
    [{ permissionDecision: 'ask' }, ['permissionDecision']],
    [{ description: 'deny this operation' }, []],
    [{ additionalContext: '<b>deny 日本語 🧪</b>' }, ['additionalContext']],
    [undefined, []],
  ];
  for (const [output, fields] of cases) {
    const entries = await projected([hook('start', 'start', { input: { permissionDecision: 'deny' } }),
      hook('end', 'end', output === undefined ? {} : { output })]);
    const card = comparison(entries, entries[0])[1];
    assert.equal(card.target.id, 'start');
    assert.deepEqual(card.reported.map(item => item.field), fields);
    assert.match(card.facts.join(' '), /Pipeline outcome: success/);
    assert.match(card.lesson, /zero.*multiple|no configured.*multiple/i);
    assert.match(card.facts.join(' '), /request.*does not.*applied permission/i);
    assert.deepEqual(card.evidence.map(item => item.id), ['start', 'end']);
    if (fields.includes('permissionDecision')) assert.match(card.reported[0].label, /request/);
    if (!fields.length) assert.match(card.facts.join(' '), /No supported decision request/);
    if (output === undefined) assert.match(card.facts.join(' '), /Output.*unavailable|output.*not recorded/i);
  }
});

test('unknown, conflicting, clipped and mismatched hook evidence cannot teach an unsupported decision', async () => {
  const normal = await projected([hook('start', 'start'), hook('end', 'end', { output: { permissionDecision: 'deny' } })]);
  const cases = [
    [normal[0]],
    [normal[0], { ...normal[1], truncated: true }],
    [normal[0], { ...normal[1], evidence: '{' }],
    [normal[0], { ...normal[1], evidence: normal[1].evidence.replace('"id": "end"', '"id": "other"') }],
    [normal[0], normal[1], { ...normal[1], id: 'duplicate' }],
    await projected([hook('future', 'end', { hookType: 'future <img> 日本語 🧪', output: { permissionDecision: 'deny', additionalContext: 'do it' } })]),
    await projected([hook('start', 'start'), hook('end', 'end', { hookType: 'postToolUse', output: { permissionDecision: 'deny' } })]),
  ];
  for (const entries of cases) {
    const card = comparison(entries)[1];
    assert.deepEqual(card.reported, []);
    assert.match(card.facts.join(' '), /unknown|unavailable/i);
  }
  const missing = comparison(await projected([hook('start', 'start')]))[1];
  assert.match(missing.facts.join(' '), /end.*not retained/i);
  const unknown = comparison(cases[5])[1];
  assert.match(unknown.facts.join(' '), /Timing unknown/);
  assert.ok(unknown.body.includes('deny'), 'Uninterpreted raw output remains literal evidence.');
});

test('permission examples reuse recorded decision kinds while missing or malformed outcomes stay unknown', async () => {
  const cases = [
    ['denied-by-rules', /recorded decision kind is denied-by-rules/],
    ['approved', /Approval permits.*does not prove/],
    ['cancelled', /refusal or cancellation/],
    ['future-deny', /unavailable or unrecognized/i],
    [undefined, /unavailable or unrecognized/i],
  ];
  for (const [kind, expected] of cases) {
    const entries = await projected([record('permission', 'permission.completed', { requestId: 'request', result: { kind } })]);
    const card = comparison(entries)[2];
    assert.match(card.facts.join(' '), expected);
    assert.match(card.lesson, /authorization/i);
    assert.match(card.lesson, /missing.*unknown/i);
    const malformed = comparison([{ ...entries[0], truncated: true }])[2];
    assert.doesNotMatch(malformed.facts.join(' '), /recorded decision kind is/);
  }
  const request = comparison(await projected([record('request', 'permission.requested', { requestId: 'request', permissionRequest: { kind: 'write' } })]))[2];
  assert.match(request.facts.join(' '), /not approval/i);
});

test('a hook lesson cannot attribute output to a supporting event with an ambiguous original identity', async () => {
  const entries = await projected([hook('start', 'start'), hook('end', 'end', { output: { permissionDecision: 'deny' } })]);
  const [duplicate] = await projected([record('end', 'session.info', { message: 'Different original event' })]);
  const card = comparison([...entries, duplicate], entries[0])[1];
  assert.equal(card.target.id, 'start');
  assert.ok(card.evidence.includes(null));
  assert.deepEqual(card.reported, []);
  assert.equal(card.body, null);
  assert.match(card.facts.join(' '), /outcome.*unknown/i);
});

test('the comparison has authored static examples without manufacturing current-chat evidence', () => {
  const cards = comparison([]);
  assert.deepEqual(cards.map(card => card.concept), ['skill', 'hook', 'permission']);
  for (const card of cards) {
    assert.equal(card.target, null);
    assert.deepEqual(card.evidence, []);
    assert.deepEqual(card.reported, []);
    assert.match(card.example, /Static example.*not from this chat/);
  }
});
