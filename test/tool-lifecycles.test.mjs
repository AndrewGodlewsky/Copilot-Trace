import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

const boundary = (id, type, extra = {}) => ({ id, type: `tool.execution_${type}`, category: 'tool',
  agentId: '', toolCallId: 'call', toolName: 'view', timestamp: '2026-11-20T12:00:00Z', ...extra });
const start = boundary('start', 'start', { evidence: JSON.stringify({ data: { toolName: 'view', arguments: { path: '日本語😀<img>.mjs' } } }) });
const end = boundary('end', 'complete', { timestamp: '2026-11-20T12:00:01.250Z', success: false });

test('tool grouping joins exact identities across interleaved activity without losing original records', () => {
  const childStart = boundary('child-start', 'start', { agentId: 'child' });
  const childEnd = boundary('child-end', 'complete', { agentId: 'child', success: true });
  const message = { id: 'message', type: 'assistant.message', agentId: '' };
  const entries = [start, childStart, message, childEnd, end];
  const groups = presentation.groupSteps(entries);
  assert.deepEqual(groups.map(group => [group.kind, group.entries.map(entry => entry.id)]), [
    ['tool', ['start', 'end']], ['tool', ['child-start', 'child-end']], ['event', ['message']],
  ]);
  assert.equal(groups[0].entries[0], start);
  assert.equal(groups[0].entries[1], end);
  assert.equal(presentation.summarize(entries).tools, 2);
  assert.deepEqual(presentation.groupSteps(entries, true).flatMap(group => group.entries), entries);
  assert.ok(presentation.groupSteps(entries, true).every(group => group.kind === 'event'));
});

test('a lifecycle reports only its observed result and validated elapsed time', () => {
  assert.equal(typeof presentation.describeToolGroup, 'function');
  const display = presentation.describeToolGroup([start, end]);
  assert.equal(display.title, 'View 日本語😀<img>.mjs');
  assert.match(display.subtitle, /Failed/);
  assert.match(display.subtitle, /1\.25 s/);
  assert.equal(display.tone, 'error');
  assert.match(presentation.describeToolGroup([start]).subtitle, /Completion not observed/);
  assert.doesNotMatch(presentation.describeToolGroup([start]).subtitle, /running|Completed|Failed/);
  assert.match(presentation.describeToolGroup([end]).subtitle, /Failed.*Start unavailable.*Elapsed unknown/);
  assert.match(presentation.describeToolGroup([{ ...end, success: null }]).subtitle, /Result recorded/);
});

test('invalid identities never join or contribute to identified call counts', () => {
  for (const agentId of [undefined, null, false, {}, 'a'.repeat(257)]) {
    const entries = [{ ...start, agentId }, { ...end, agentId }];
    assert.equal(presentation.groupSteps(entries).length, 2);
    assert.equal(presentation.summarize(entries).tools, 0);
    assert.equal(presentation.summarize(entries).unlinked, 2);
  }
  for (const toolCallId of ['', undefined, null, false, {}, 'c'.repeat(257)]) {
    const entries = [{ ...start, toolCallId }, { ...end, toolCallId }];
    assert.equal(presentation.groupSteps(entries).length, 2);
    assert.equal(presentation.summarize(entries).tools, 0);
    assert.match(presentation.describeToolGroup([entries[0]]).subtitle, /IDs unavailable/);
  }
  const entries = [{ ...start, agentId: 'a'.repeat(256), toolCallId: 'c'.repeat(256) },
    { ...end, agentId: 'a'.repeat(256), toolCallId: 'c'.repeat(256) }];
  assert.equal(presentation.groupSteps(entries).length, 1);
  assert.equal(presentation.summarize(entries).tools, 1);
  assert.equal(presentation.groupSteps([start, { ...end, toolCallId: 'call ' }]).length, 2);
});

test('reused IDs retain every conflicting boundary without selecting an outcome or duration', () => {
  for (const entries of [[start, { ...start, id: 'other-start' }, end],
    [start, end, { ...end, id: 'other-end', success: true }]]) {
    const groups = presentation.groupSteps(entries);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].entries, entries);
    const display = presentation.describeToolGroup(groups[0].entries);
    assert.match(display.subtitle, /Conflicting boundaries.*Outcome unknown.*Elapsed unknown/);
    assert.doesNotMatch(display.subtitle, /Completed|Failed|1\.25 s/);
    assert.equal(presentation.summarize(entries).tools, 1);
  }
});

test('elapsed time rejects missing, malformed, calendar-invalid or reversed timestamps and accepts ties', () => {
  for (const timestamp of ['', undefined, null, 0, '0', '2026-02-30T12:00:00Z',
    '2026-11-20', '2026-11-20T12:00:00', '2026-11-20T12:00:00+25:00', '2026-11-20T11:59:59Z']) {
    assert.match(presentation.describeToolGroup([start, { ...end, timestamp }]).subtitle, /Elapsed unknown/);
  }
  assert.match(presentation.describeToolGroup([{ ...start, timestamp: '' }, end]).subtitle, /Elapsed unknown/);
  assert.match(presentation.describeToolGroup([start, { ...end, timestamp: start.timestamp }]).subtitle, /0 s/);
  assert.match(presentation.describeToolGroup([start, { ...end, timestamp: '2026-11-20T13:00:01.250+01:00' }]).subtitle, /1\.25 s/);
});

test('group identity survives late history, completion-first delivery and retained start eviction', () => {
  const completeFirst = presentation.groupSteps([end])[0];
  const paired = presentation.groupSteps([end, start])[0];
  assert.equal(completeFirst.id, paired.id);
  assert.deepEqual(paired.entries, [end, start], 'Preserve input boundary order even before history sorts it.');
  assert.equal(presentation.groupSteps([start])[0].id, paired.id);
  assert.equal(presentation.groupSteps([end])[0].id, paired.id);
  const hooks = [{ id: 'hook-a', type: 'hook.start', agentId: '' }, { id: 'hook-b', type: 'hook.end', agentId: '' }];
  assert.deepEqual(presentation.groupSteps([start, hooks[0], end, hooks[1]]).map(group => group.entries.map(entry => entry.id)),
    [['start', 'end'], ['hook-a'], ['hook-b']], 'A moved completion must not merge previously nonconsecutive hook events.');
});

test('observer overlap and duplicate delivery produce one lifecycle with two original evidence records', async t => {
  let emit, resolveHistory;
  const trace = createTrace({
    on(listener) { emit = listener; return () => {}; },
    getEvents() { return new Promise(resolve => { resolveHistory = resolve; }); },
  });
  t.after(() => trace.close());
  await Promise.resolve();
  const rawStart = { id: 'start', type: start.type, timestamp: start.timestamp,
    data: { toolCallId: 'call', toolName: 'view', arguments: { path: '日本語😀<img>.mjs' } } };
  const rawEnd = { id: 'end', type: end.type, timestamp: end.timestamp,
    data: { toolCallId: 'call', success: false } };
  emit(rawEnd);
  emit(rawEnd);
  resolveHistory([rawStart, rawEnd, rawEnd]);
  await trace.ready;
  emit(rawStart);
  const entries = trace.snapshot().entries;
  assert.equal(entries.length, 2);
  const groups = presentation.groupSteps(entries);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].entries.map(entry => JSON.parse(entry.evidence).id), ['start', 'end']);
  assert.match(presentation.describeToolGroup(groups[0].entries).subtitle, /Failed.*1\.25 s/);
  assert.equal(presentation.summarize(entries).tools, 1);
  for (let i = 0; i < 299; i++) emit({ id: `later-${i}`, type: 'session.info', timestamp: '2026-11-20T12:01:00Z', data: {} });
  const retained = trace.snapshot().entries;
  assert.equal(retained.length, 300);
  assert.equal(retained[0].id, 'end');
  assert.equal(presentation.groupSteps(retained)[0].id, groups[0].id);
  assert.match(presentation.describeToolGroup([retained[0]]).subtitle, /Start unavailable.*Elapsed unknown/);
  assert.equal(presentation.summarize(retained).tools, 1);
});
