import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeStep, groupSteps, describeHookGroup } from '../com.github.copilot/extensions/trace/web/presentation.mjs';

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
