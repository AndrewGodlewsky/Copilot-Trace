import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';

test('exclusive activity filters use exact recorded types and explicit failure values', () => {
  const matches = presentation.matchesFilter;
  assert.equal(typeof matches, 'function');
  const records = [
    ['user.message'], ['assistant.turn_start'], ['assistant.intent'], ['assistant.message'],
    ['tool.execution_start'], ['tool.execution_complete', true], ['tool.execution_complete', false],
    ['tool.execution_complete', 'false'], ['skill.invoked'], ['hook.start'], ['hook.end', false],
    ['hook.end', true], ['session.error'], ['session.warning'], ['session.info'], ['abort'],
    ['subagent.failed'], ['subagent.completed'], ['permission.requested'], ['permission.completed'],
    ['tool.unknown', false], ['unknown', false],
  ].map(([type, success]) => ({ type, success, category: 'error', preview: 'failed error warning' }));
  const selected = filter => records.filter(entry => matches(entry, filter)).map(entry => [entry.type, entry.success]);
  assert.equal(selected('everything').length, records.length);
  assert.equal(selected('unknown').length, records.length, 'Unknown preference falls back to Everything.');
  assert.deepEqual(selected('tools'), records.slice(4, 8).map(entry => [entry.type, entry.success]));
  assert.deepEqual(selected('automation'), records.slice(8, 12).map(entry => [entry.type, entry.success]));
  assert.deepEqual(selected('problems'), [6, 10, 12, 13, 15, 16].map(index => [records[index].type, records[index].success]));
});
