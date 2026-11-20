import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeActor, describeStep, groupSteps, describeHookGroup } from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

test('actor labels follow every supported exact event type independently of category', () => {
  const roles = [
    ['User', ['user.message']],
    ['Assistant', ['assistant.turn_start', 'assistant.turn_end', 'assistant.intent', 'assistant.message', 'assistant.reasoning']],
    ['Tool', ['tool.execution_start', 'tool.execution_complete']],
    ['Configured automation', ['hook.start', 'hook.end']],
    ['Permission system', ['permission.requested', 'permission.completed']],
    ['Instruction loading', ['skill.invoked']],
    ['Host', ['subagent.started', 'subagent.completed', 'subagent.failed', 'session.compaction_start',
      'session.compaction_complete', 'session.error', 'session.info', 'session.warning', 'abort']],
  ];
  for (const [role, types] of roles) for (const type of types) {
    assert.deepEqual(describeActor({ type, category: 'misleading', agentId: '' }),
      { role, source: 'Main chat' }, type);
  }
});

test('unsupported event types cannot inherit an actor from their prefix or category', () => {
  for (const type of ['future.event', 'hook.future', 'assistant.future', 'tool.future', 'permission.future',
    'session.future', 'toString', '__proto__', '', null, undefined]) {
    for (const category of ['chat', 'model', 'turn', 'tool', 'host', 'skill', 'agent']) {
      assert.deepEqual(describeActor({ type, category }),
        { role: 'Actor unknown', source: 'Source unavailable' });
    }
  }
});

test('actor roles stay separate from validated source identity and preserve literal IDs', () => {
  const tool = { type: 'tool.execution_start' };
  assert.deepEqual(describeActor({ ...tool, agentId: '' }), { role: 'Tool', source: 'Main chat' });
  assert.deepEqual(describeActor({ ...tool, agentId: 'child <img> 日本語😀' }),
    { role: 'Tool', source: 'Agent child <img> 日本語😀' });
  assert.deepEqual(describeActor({ ...tool, agentId: 'a'.repeat(256) }),
    { role: 'Tool', source: `Agent ${'a'.repeat(256)}` });
  for (const agentId of [undefined, null, 0, false, {}, [], 'a'.repeat(257)]) {
    assert.deepEqual(describeActor({ ...tool, agentId }),
      { role: 'Tool', source: 'Source unavailable' });
  }
});

test('projected missing and invalid raw agent IDs retain their distinct source meanings', async t => {
  const trace = createTrace({
    on() { return () => {}; },
    async getEvents() { return [
      { id: 'main', type: 'user.message', data: { content: 'input', source: 'system' } },
      { id: 'child', type: 'tool.execution_start', agentId: 'child', data: {} },
      { id: 'bad', type: 'hook.start', agentId: [], data: {} },
    ]; },
  });
  t.after(() => trace.close());
  await trace.ready;
  assert.deepEqual(trace.snapshot().entries.map(entry => describeActor(entry)), [
    { role: 'User', source: 'Main chat' },
    { role: 'Tool', source: 'Agent child' },
    { role: 'Configured automation', source: 'Source unavailable' },
  ]);
});

function toolStart(toolName, args) {
  const event = { id: 'start', type: 'tool.execution_start', timestamp: '2026-11-20T12:00:00Z',
    data: { toolCallId: 'call', toolName, arguments: args } };
  return { id: event.id, type: event.type, timestamp: event.timestamp, category: 'tool', toolName,
    agentId: '', toolCallId: 'call', evidence: JSON.stringify(event) };
}

test('recognized structured view and grep starts describe recorded targets literally', () => {
  const read = toolStart('view', { path: 'src/日本語😀<img>.mjs' });
  assert.equal(describeStep(read).title, 'View src/日本語😀<img>.mjs');
  assert.equal(describeStep(read).subtitle, 'Started');
  assert.equal(describeStep(toolStart('grep', { pattern: '<script>.*日本語😀' })).title,
    'Search for pattern “<script>.*日本語😀”');
  assert.equal(JSON.parse(read.evidence).data.arguments.path, 'src/日本語😀<img>.mjs');
});

test('unknown, ambiguous and malformed tool schemas keep their recorded name', () => {
  for (const [name, args] of [
    ['custom_view', { path: 'file' }], ['bash', { command: 'cat file' }],
    ['view', undefined], ['view', null], ['view', []], ['view', '{"path":"file"}'],
    ['view', { path: 5 }], ['view', { path: '' }], ['view', { file: 'file' }],
    ['grep', { pattern: [] }], ['grep', { pattern: '' }], ['grep', { query: 'term' }],
  ]) assert.equal(describeStep(toolStart(name, args)).title, name);
  const start = toolStart('view', { path: 'file' });
  for (const evidence of [undefined, '', '{', 'null', '[]', '{}', '{"data":null}',
    JSON.stringify({ data: { toolName: 'other', arguments: { path: 'file' } } })]) {
    assert.equal(describeStep({ ...start, evidence }).title, 'view');
  }
  assert.equal(describeStep({ ...start, truncated: true }).title, 'view');
});

test('action titles have a Unicode-safe 180-character bound without changing exact evidence', () => {
  const path = 'a'.repeat(173) + '😀' + 'tail'.repeat(100);
  const start = toolStart('view', { path });
  const title = describeStep(start).title;
  assert.ok(title.length <= 180);
  assert.ok(title.endsWith('…'));
  assert.equal(title.isWellFormed(), true);
  assert.equal(JSON.parse(start.evidence).data.arguments.path, path);
  assert.equal(describeStep(toolStart('grep', { pattern: '😀'.repeat(300) })).title.isWellFormed(), true);
  const oversized = toolStart('view', { path: 'a'.repeat(13000) });
  assert.equal(describeStep(oversized).title, 'view');
});

test('result text cannot become a requested-action title or change the reported status', () => {
  const start = toolStart('view', { path: 'file' });
  const end = { ...start, type: 'tool.execution_complete', success: false };
  assert.equal(describeStep(end).title, 'view');
  assert.equal(describeStep(end).subtitle, 'Failed');
  assert.equal(describeStep(end).tone, 'error');
});

test('action title and original evidence stay stable across live completion and history overlap', async t => {
  let emit, resolveHistory;
  const trace = createTrace({
    on(listener) { emit = listener; return () => {}; },
    getEvents() { return new Promise(resolve => { resolveHistory = resolve; }); },
  });
  t.after(() => trace.close());
  await Promise.resolve();
  const start = { id: 's', type: 'tool.execution_start', timestamp: '2026-11-20T12:00:00Z',
    agentId: 'child', data: { toolCallId: 'call', toolName: 'view', arguments: { path: '日本語😀.mjs' } } };
  emit(start);
  const before = trace.snapshot().entries[0];
  assert.equal(describeStep(before).title, 'View 日本語😀.mjs');
  emit({ id: 'e', type: 'tool.execution_complete', timestamp: '2026-11-20T12:00:01Z',
    agentId: 'child', data: { toolCallId: 'call', success: false } });
  resolveHistory([start]);
  await trace.ready;
  const after = trace.snapshot().entries;
  assert.equal(after.length, 2);
  assert.deepEqual(after[0], before);
  assert.equal(describeStep(after[0]).title, describeStep(before).title);
  assert.equal(after[0].agentId, 'child');
  assert.equal(describeStep(after[1]).subtitle, 'Failed');
});

test('collapsed model and user nodes use recorded names and literal message previews', () => {
  const model = describeStep({ type: 'assistant.turn_start', category: 'turn', model: 'example-model' });
  assert.equal(model.title, 'example-model');
  assert.equal(model.subtitle, 'Turn started');
  assert.equal(describeStep({ type: 'assistant.turn_start', category: 'turn' }).title, 'Model turn');
  const user = describeStep({ type: 'user.message', category: 'chat', preview: '<img src=x> 日本語 😀' });
  assert.equal(user.title, '<img src=x> 日本語 😀');
  assert.equal(user.kind, 'You');
});

test('tool appearance does not invent success or a running state', () => {
  const start = describeStep({ type: 'tool.execution_start', category: 'tool', toolName: 'read_file' });
  assert.equal(start.title, 'read_file');
  assert.equal(start.subtitle, 'Started');
  const end = { type: 'tool.execution_complete', category: 'tool' };
  assert.equal(describeStep(end).subtitle, 'Result recorded');
  assert.equal(describeStep(end).title, 'Tool name unavailable');
  assert.equal(describeStep({ ...end, success: true }).subtitle, 'Completed');
  const failed = describeStep({ ...end, success: false });
  assert.equal(failed.subtitle, 'Failed');
  assert.equal(failed.tone, 'error');
});

test('skill trigger labels use only recorded attribution and unknown types remain readable', () => {
  const skill = { type: 'skill.invoked', category: 'skill', displayName: 'research' };
  assert.equal(describeStep({ ...skill, trigger: 'agent-invoked' }).subtitle, 'Invoked by agent');
  assert.equal(describeStep({ ...skill, trigger: 'user-invoked' }).subtitle, 'Invoked by you');
  assert.equal(describeStep({ ...skill, trigger: 'context-load' }).subtitle, 'Loaded into context');
  assert.equal(describeStep(skill).subtitle, 'Trigger not recorded');
  assert.equal(describeStep({ ...skill, trigger: 'new-trigger' }).subtitle, 'See recorded trigger');
  assert.equal(describeStep({ type: 'future.event', title: 'Future activity' }).title, 'Future activity');
});

test('consecutive hook events form expandable sections without crossing other activity or agent boundaries', () => {
  const hook = (id, agentId = '', type = 'hook.start') => ({ id, agentId, type });
  const entries = [hook('a'), hook('b', '', 'hook.end'), { id: 'model', type: 'assistant.turn_start' }, hook('c'), hook('d', 'child'), hook('e', 'child', 'hook.end')];
  const groups = groupSteps(entries);
  assert.deepEqual(groups.map(g => [g.kind, g.entries.map(e => e.id)]), [
    ['hooks', ['a', 'b']], ['event', ['model']], ['hooks', ['c']], ['hooks', ['d', 'e']],
  ]);
  assert.deepEqual(groups.flatMap(g => g.entries), entries);
  assert.equal(groupSteps(entries.slice(0, 1))[0].id, groups[0].id, 'Adding a completion keeps the section identity.');
  assert.equal(groups[0].entries.length, 2, 'Counts describe events, not inferred hook invocations.');
});

test('collapsed hook groups surface recorded failures without treating event counts as calls', () => {
  const display = describeHookGroup([
    { type: 'hook.start', displayName: 'sessionStart' },
    { type: 'hook.end', displayName: 'sessionStart', success: false },
  ]);
  assert.equal(display.kind, 'Hook');
  assert.equal(display.tone, 'error');
  assert.equal(display.subtitle, '2 events · 1 failed · sessionStart');
  assert.equal(describeHookGroup([{ type: 'hook.start' }]).subtitle, '1 event');
  assert.equal(describeHookGroup([{ type: 'hook.start' }]).tone, 'host');
});
