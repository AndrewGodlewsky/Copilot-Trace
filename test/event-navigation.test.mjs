import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';

test('event navigation uses four exact predicates, never labels or failure-looking content', () => {
  const latest = presentation.latestRetainedEvent;
  assert.equal(typeof latest, 'function');
  const cases = [
    ['session.error', undefined, 'failure'], ['subagent.failed', undefined, 'failure'],
    ['tool.execution_complete', false, 'failure,result'], ['hook.end', false, 'failure'],
    ['permission.requested', undefined, 'permission'], ['skill.invoked', undefined, 'skill'],
    ['tool.execution_complete', true, 'result'], ['tool.execution_complete', undefined, 'result'],
    ['tool.execution_complete', 'false', 'result'], ['hook.end', 'false', ''],
    ['session.warning', false, ''], ['abort', false, ''], ['session.info', false, ''],
    ['permission.completed', false, ''], ['subagent.completed', false, ''],
    ['tool.execution_start', false, ''], ['hook.start', false, ''], ['unknown', false, ''],
  ];
  for (const [type, success, matches] of cases) {
    const entry = { id: 'literal "<>日本語', type, success, category: 'error', preview: 'failed permission skill result' };
    for (const category of ['failure', 'permission', 'skill', 'result']) {
      assert.equal(latest([entry], category), matches.split(',').includes(category) ? entry : null, `${type}/${String(success)}/${category}`);
    }
  }
});

test('latest means last usable matching record in collector order without inferring time or using IDs as selectors', () => {
  const latest = presentation.latestRetainedEvent;
  assert.equal(typeof latest, 'function');
  const entries = [
    { id: 'later-clock', type: 'session.error', timestamp: '2026-11-20T12:00:02Z' },
    { id: 'earlier-clock', type: 'session.error', timestamp: '2026-11-20T12:00:01Z' },
    { id: 'missing-time "<>日本語\uD800', type: 'session.error' },
    { id: 'irrelevant', type: 'session.warning' },
  ];
  assert.equal(latest(entries, 'failure'), entries[2]);
  assert.equal(latest(entries.slice(0, 2), 'failure'), entries[1]);
  for (const id of [undefined, null, 0, '', 'x'.repeat(257)]) {
    assert.equal(latest([...entries, { id, type: 'session.error' }], 'failure'), entries[2]);
  }
  assert.equal(latest([{ id: 'x'.repeat(256), type: 'session.error' }], 'failure')?.id.length, 256);
  for (const category of ['permission', 'skill', 'result', 'unknown', 'toString', '__proto__', undefined]) {
    assert.equal(latest(entries, category), null);
  }
  assert.equal(latest([], 'failure'), null);
});
