import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';

const time = seconds => new Date(Date.UTC(2026, 10, 20, 12, 0, seconds)).toISOString();
function event(id, type, agentId, seconds, data = {}) {
  const timestamp = time(seconds);
  return { id, type, agentId, timestamp, toolCallId: data.toolCallId || '', turnId: data.turnId || '',
    displayName: data.agentDisplayName || '', category: type.startsWith('subagent.') ? 'agent' : 'turn',
    evidence: JSON.stringify({ id, type, timestamp, ...(agentId === '' ? {} : { agentId }), data }) };
}
const pair = (agent, start, end, data = {}) => [
  event(`${agent}-start`, 'subagent.started', agent, start, { toolCallId: `call-${agent}`, agentDisplayName: 'Same name', ...data }),
  event(`${agent}-end`, 'subagent.completed', agent, end, { toolCallId: `call-${agent}`, ...data }),
];
const chronological = entries => entries.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
const lanes = (entries, snapshot) => {
  assert.equal(typeof presentation.agentLanes, 'function', 'The lane view exposes its tested presentation contract.');
  return presentation.agentLanes(entries, snapshot);
};

test('exact source lanes show shared-scale overlap rather than merging reused display names', () => {
  const entries = chronological([...pair('a', 0, 4), ...pair('b', 2, 6)]);
  const result = lanes(entries);
  assert.equal(result.lanes.length, 2);
  assert.deepEqual(result.lanes.map(lane => lane.agentId), ['a', 'b']);
  assert.deepEqual(result.lanes.map(lane => lane.entries.map(entry => entry.id)), [['a-start', 'a-end'], ['b-start', 'b-end']]);
  assert.deepEqual(result.scale, { start: Date.parse(time(0)), end: Date.parse(time(6)) });
  assert.equal(result.overlaps, 1);
  assert.equal(result.lanes[1].intervals[0].start, Date.parse(time(2)));
  assert.equal(lanes(chronological([...pair('a', 0, 2), ...pair('b', 2, 4)])).overlaps, 0);
  assert.equal(lanes(chronological([...pair('a', 0, 4), ...pair('b', 0, 4)])).overlaps, 1);
  assert.match(result.note, /wall time/i);
  assert.match(result.note, /sum/i);
});

test('incomplete, conflicting and unreliable lifecycle intervals never imply ongoing execution or concurrency', () => {
  const [start, end] = pair('a', 0, 2);
  const cases = [[start], [end], [end, start], [start, { ...end, timestamp: time(0) }],
    [start, { ...end, timestamp: '2026-02-30T12:00:02Z' }],
    [start, { ...end, timestamp: 'no time' }], [start, { ...start, id: 'duplicate' }, end],
    [start, event('inside', 'assistant.message', 'a', 5), end],
    [start, { ...end, truncated: true }], [start, { ...end, evidence: '{}' }],
    [start, event('wrong-call', 'subagent.completed', 'a', 2, { toolCallId: 'different' })]];
  for (const entries of cases) {
    const result = lanes(entries);
    assert.equal(result.lanes[0].intervals.length, 0, JSON.stringify(entries));
    assert.equal(result.scale, null);
    assert.equal(result.overlaps, 0);
    assert.match(result.lanes[0].timing, /unknown/i);
    assert.doesNotMatch(result.lanes[0].status, /running|successful/i);
  }
});

test('recorded completion, cancellation, failure and unknown outcomes stay distinct', () => {
  assert.match(lanes(pair('a', 0, 2)).lanes[0].status, /Completed/);
  assert.match(lanes(pair('a', 0, 2, { cancelled: true })).lanes[0].status, /Cancelled/);
  assert.match(lanes(pair('a', 0, 2, { cancelled: 'true' })).lanes[0].status, /unknown/i);
  assert.match(lanes([pair('a', 0, 2)[0], event('failed', 'subagent.failed', 'a', 2, { toolCallId: 'call-a' })]).lanes[0].status, /Failed/);
  assert.match(lanes([pair('a', 0, 2)[0]]).lanes[0].status, /Completion not observed/);
  assert.match(lanes([pair('a', 0, 2)[1]]).lanes[0].status, /Start unavailable/);
});

test('parent links require validated spawning tool IDs and one unambiguous original tool start', () => {
  const spawn = event('spawn "<>日本語', 'tool.execution_start', '', 0, { toolCallId: 'call-a' });
  const child = pair('a', 1, 2);
  assert.equal(lanes([spawn, ...child]).lanes.find(lane => lane.agentId === 'a').parentId, spawn.id);
  for (const extra of [event('duplicate', 'tool.execution_start', '', 0, { toolCallId: 'call-a' }),
    event('other-agent', 'tool.execution_complete', 'b', 0, { toolCallId: 'call-a' }),
    event('unknown-agent', 'tool.execution_start', null, 0, { toolCallId: 'call-a' })]) {
    assert.equal(lanes([spawn, extra, ...child]).lanes.find(lane => lane.agentId === 'a').parentId, null);
  }
  const invalid = { ...child[0], evidence: JSON.stringify({ ...JSON.parse(child[0].evidence), parentId: spawn.id, data: {} }) };
  assert.equal(lanes([spawn, invalid]).lanes.find(lane => lane.agentId === 'a').parentId, null);
  assert.equal(lanes(child).lanes[0].parentId, null);
  for (const patch of [{ id: 'other' }, { type: 'subagent.failed' }, { agentId: 'other' }, { timestamp: time(9) },
    { data: { toolCallId: 'other' } }]) {
    const changed = { ...child[0], evidence: JSON.stringify({ ...JSON.parse(child[0].evidence), ...patch }) };
    const lane = lanes([spawn, changed, child[1]]).lanes.find(lane => lane.agentId === 'a');
    assert.equal(lane.parentId, null);
    assert.equal(lane.intervals.length, 0);
  }
});

test('main intervals pair consecutive exact turn boundaries while unknown sources remain unassigned', () => {
  const main = [event('turn0', 'assistant.turn_start', '', 0, { turnId: '0' }),
    event('end0', 'assistant.turn_end', '', 4, { turnId: '0' }),
    event('turn1', 'assistant.turn_start', '', 5, { turnId: '0' }),
    event('end1', 'assistant.turn_end', '', 6, { turnId: '0' })];
  const result = lanes(chronological([...main, ...pair('a', 1, 3),
    event('unknown', 'assistant.message', null, 2), event('invalid', 'assistant.message', 'x'.repeat(257), 2)]));
  assert.equal(result.lanes[0].agentId, '');
  assert.equal(result.lanes[0].intervals.length, 2);
  assert.equal(result.overlaps, 1);
  assert.deepEqual(result.lanes.at(-1).entries.map(entry => entry.id), ['unknown', 'invalid']);
  assert.equal(result.lanes.at(-1).agentId, null);
  assert.equal(result.lanes.at(-1).intervals.length, 0);
  assert.match(result.lanes.at(-1).title, /Source unavailable/);
  assert.equal(lanes([main[0], { ...main[1], turnId: 'different' }]).lanes[0].intervals.length, 0);
  assert.equal(lanes([main[0], event('abort', 'abort', '', 1), main[1]]).lanes[0].intervals.length, 0);
  assert.equal(lanes([main[0], event('abort', 'abort', null, 1), main[1]]).lanes[0].intervals.length, 0);
  assert.equal(lanes([main[0], event('input', 'user.message', '', 1), main[1]]).lanes[0].intervals.length, 0);
  assert.equal(lanes([main[0], { ...event('input', 'user.message', '', 1), delivery: 'steering' }, main[1]]).lanes[0].intervals.length, 1);
});

test('retention and many agents keep exact ownership and label the partial observed window', () => {
  const entries = Array.from({ length: 100 }, (_, i) => pair(`agent-${i}`, 0, 3)).flat();
  const result = lanes(chronological(entries), { history: 'loading', omitted: 7 });
  assert.equal(result.lanes.length, 100);
  assert.equal(result.lanes.reduce((sum, lane) => sum + lane.entries.length, 0), entries.length);
  assert.match(result.note, /incomplete|partial/i);
  assert.match(result.note, /omitted/i);
  const retained = lanes([pair('a', 0, 3)[1]], { history: 'ready', omitted: 1 });
  assert.equal(retained.lanes[0].intervals.length, 0);
  assert.equal(retained.lanes[0].parentId, null);
});
