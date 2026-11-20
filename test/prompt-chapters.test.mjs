import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';

const entry = (id, type, extra = {}) => ({ id, type, agentId: '', ...extra });
const prompt = (id, delivery = 'idle', extra = {}) => entry(id, 'user.message', {
  delivery, interactionId: id, preview: `Prompt ${id}`, ...extra,
});
const turn = (id, interactionId, extra = {}) => entry(id, 'assistant.turn_start', { interactionId, turnId: '0', ...extra });
const chapters = (...args) => {
  assert.equal(typeof presentation.requestChapters, 'function', 'Request chapter projection is available.');
  return presentation.requestChapters(...args);
};
const ids = groups => groups.map(group => group.entries.map(item => item.id));

test('sequential idle requests form literal chronological intervals despite reused turn numbers', () => {
  const records = [prompt('one', 'idle', { preview: '<img> 日本語😀\n  exact text' }), turn('t1', 'one'),
    entry('child', 'tool.execution_start', { agentId: 'child', toolCallId: 'tool' }),
    entry('end1', 'assistant.turn_end', { turnId: '0' }), prompt('two'), turn('t2', 'two')];
  const groups = chapters(records);
  assert.deepEqual(ids(groups), [['one', 't1', 'child', 'end1'], ['two', 't2']]);
  assert.equal(groups[0].prompt, records[0]);
  assert.deepEqual(groups.flatMap(group => group.entries), records);
  for (const group of groups) assert.deepEqual(group.stats, presentation.summarize(group.entries));
  assert.equal(groups[0].boundary, 'idle');
  assert.equal(groups[0].partial, false);
});

test('steering stays inside an interval and queued input waits for its exact interaction start', () => {
  const records = [prompt('one'), turn('t1', 'one'), prompt('steer', 'steering'), prompt('next', 'queued'),
    turn('child', 'next', { agentId: 'child' }), entry('result', 'tool.execution_complete', { toolCallId: 'tool' }),
    turn('t2', 'next'), turn('t3', 'next', { turnId: '1' })];
  const groups = chapters(records);
  assert.deepEqual(ids(groups), [['one', 't1', 'steer', 'next', 'child', 'result'], ['t2', 't3']]);
  assert.equal(groups[1].prompt.id, 'next');
  assert.equal(groups[1].boundary, 'queued');
  assert.match(groups[1].notes.join(' '), /earlier.*input record/i);
  assert.match(presentation.describeStep(records[2]).subtitle, /Steering/);
  assert.match(presentation.describeStep(records[3]).subtitle, /Queued/);
});

test('missing, invalid, duplicate and pre-input interaction IDs never manufacture queued boundaries', () => {
  for (const interactionId of ['', undefined, null, 1, 'x'.repeat(257)]) {
    const groups = chapters([prompt('one'), prompt('next', 'queued', { interactionId }), turn('t2', interactionId)]);
    assert.equal(groups.length, 1);
    assert.match(groups[0].notes.join(' '), /queued.*not linked/i);
  }
  assert.equal(chapters([prompt('one'), prompt('a', 'queued', { interactionId: 'same' }),
    prompt('b', 'queued', { interactionId: 'same' }), turn('t', 'same')]).length, 1);
  assert.equal(chapters([prompt('one'), turn('t', 'later'), prompt('later', 'queued')]).length, 1);
  assert.equal(chapters([prompt('one'), prompt('next', 'queued'), turn('t', 'next', { agentId: null })]).length, 1);
  assert.equal(chapters([prompt('one'), prompt('next', 'queued'),
    prompt('uncertain', 'queued', { agentId: null, interactionId: 'next' }), turn('t', 'next')]).length, 1);
});

test('known steering and queued inputs keep the observed model interval open without nesting the input', () => {
  for (const delivery of ['steering', 'queued']) {
    const records = [turn('start', 'one'), prompt('input', delivery), entry('work', 'assistant.message'),
      entry('end', 'assistant.turn_end', { turnId: '0' })];
    const context = presentation.turnContext(records);
    assert.equal(context.has('input'), false);
    assert.equal(context.get('start').turn.ended, true);
    assert.equal(context.get('work').turn, context.get('start').turn);
  }
});

test('old hosts and unknown sources leave attribution unavailable and the partial first interval visible', () => {
  const records = [turn('mid', ''), prompt('old', ''), prompt('bad', 'idle', { agentId: null }),
    prompt('child', 'idle', { agentId: 'child' }), prompt('known')];
  const groups = chapters(records, { history: 'unavailable', omitted: 8 });
  assert.deepEqual(ids(groups), [['mid', 'old', 'bad', 'child'], ['known']]);
  assert.equal(groups[0].boundary, 'unknown');
  assert.equal(groups[0].partial, true);
  assert.equal(groups[0].prompt, null);
  assert.match(groups[0].notes.join(' '), /boundary.*unknown/i);
  assert.match(presentation.describeStep(records[1]).subtitle, /Delivery unknown/);
  assert.equal(chapters([prompt('known')], { history: 'loading' })[0].partial, true);
});

test('abort records interruption without implying completion or attributing later work to the interrupted prompt', () => {
  const records = [prompt('one'), turn('t', 'one'), entry('abort', 'abort'),
    entry('later', 'assistant.message'), prompt('two')];
  const groups = chapters(records);
  assert.deepEqual(ids(groups), [['one', 't', 'abort'], ['later'], ['two']]);
  assert.match(groups[0].notes.join(' '), /Interruption recorded/);
  assert.equal(groups[1].boundary, 'unknown');
  assert.equal(chapters([prompt('one'), entry('abort', 'abort', { agentId: 'child' }), turn('t', 'one')]).length, 1);
});

test('chapter statistics reuse retained-record definitions without duplicating tool boundaries or interleaved agents', () => {
  const records = [prompt('one'), entry('start', 'tool.execution_start', { toolCallId: 'tool' }),
    prompt('two'), entry('end', 'tool.execution_complete', { toolCallId: 'tool' }),
    entry('hook', 'hook.start', { hookInvocationId: 'h' }), entry('skill', 'skill.invoked', { displayName: 'reading' })];
  const groups = chapters(records);
  assert.deepEqual(groups.flatMap(group => group.entries), records);
  assert.equal(groups[0].stats.tools, 1);
  assert.equal(groups[1].stats.tools, 1);
  assert.equal(presentation.summarize(records).tools, 1, 'Calls spanning intervals make chapter counts non-additive.');
  assert.equal(groups[1].stats.hooks, 1);
  assert.equal(groups[1].stats.skills, 1);
});
