import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';

const example = (id, type, extra = {}) => ({ id, type, agentId: '', timestamp: '', evidence: '{}', ...extra });

test('all eight concepts supply the definitions used by relevant event explanations', () => {
  assert.equal(typeof presentation.conceptForEntry, 'function');
  const cases = [['assistant.turn_start', 'model-turn'], ['tool.execution_complete', 'tool'], ['hook.start', 'hook'],
    ['skill.invoked', 'skill'], ['user.message', 'context'], ['subagent.failed', 'subagent'],
    ['permission.completed', 'permission'], ['session.compaction_complete', 'compaction']];
  assert.equal(Object.keys(presentation.vocabulary).length, 8);
  for (const [type, id] of cases) {
    const concept = presentation.conceptForEntry({ type });
    assert.equal(concept, id);
    const definition = presentation.vocabulary[id];
    assert.equal(presentation.explainStep({ type, explanation: 'Conflicting old definition' }).general, definition.definition);
    assert.ok(definition.deeper.length > definition.definition.length);
    assert.ok(definition.example.length > 20);
  }
  assert.match(presentation.vocabulary.hook.deeper, /does not prove.*handler/i);
  assert.match(presentation.vocabulary.skill.deeper, /does not prove.*followed/i);
  assert.match(presentation.vocabulary.permission.deeper, /does not prove.*execut/i);
  assert.match(presentation.vocabulary.context.deeper, /not.*(?:full|complete).*prompt/i);
  assert.match(presentation.vocabulary.compaction.deeper, /does not prove.*preserved/i);
  for (const type of ['tool.future', 'toString', '__proto__', 'assistant.message']) {
    assert.equal(presentation.conceptForEntry({ type }), null);
  }
});

test('examples prefer the relevant event then the latest exact matching retained type, never prose or IDs alone', () => {
  assert.equal(typeof presentation.glossaryExample, 'function');
  const entries = [example('start', 'tool.execution_start'), example('result', 'tool.execution_complete'),
    example('fake', 'session.info', { preview: 'tool hook permission' })];
  assert.equal(presentation.glossaryExample(entries, 'tool').id, 'result');
  assert.equal(presentation.glossaryExample(entries, 'tool', entries[0]).id, 'start');
  assert.equal(presentation.glossaryExample(entries, 'tool', { ...entries[0], agentId: 'other' }).id, 'result');
  for (const id of ['hook', 'skill', 'context', 'subagent', 'permission', 'compaction', 'model-turn', 'toString']) {
    assert.equal(presentation.glossaryExample(entries, id), null);
  }
  for (const [id, type] of [['hook', 'hook.end'], ['skill', 'skill.invoked'], ['context', 'user.message'],
    ['subagent', 'subagent.completed'], ['permission', 'permission.requested'], ['compaction', 'session.compaction_start'], ['model-turn', 'assistant.turn_end']]) {
    assert.equal(presentation.glossaryExample([example('literal <日本語> 🧪', type)], id).id, 'literal <日本語> 🧪');
  }
});

test('frozen examples reject missing, reused, conflicting and malformed identities', () => {
  assert.equal(typeof presentation.retainedExample, 'function');
  const original = example('id', 'hook.start');
  const frozen = presentation.glossaryExample([original], 'hook');
  assert.notEqual(frozen, original);
  assert.equal(presentation.retainedExample([{ ...original }], frozen), true);
  assert.equal(presentation.retainedExample([], frozen), false);
  assert.equal(presentation.retainedExample([original, original], frozen), false);
  for (const change of [{ agentId: 'another' }, { type: 'hook.end' }, { timestamp: 'changed' }, { evidence: '{"changed":true}' }]) {
    assert.equal(presentation.retainedExample([{ ...original, ...change }], frozen), false);
  }
  for (const change of [{ id: '' }, { id: 'x'.repeat(257) }, { agentId: null }, { timestamp: null }, { evidence: undefined }, { evidence: 'x'.repeat(12001) }]) {
    assert.equal(presentation.glossaryExample([{ ...original, ...change }], 'hook'), null);
  }
});
