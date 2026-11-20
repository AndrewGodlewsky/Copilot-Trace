import assert from 'node:assert/strict';
import { test } from 'node:test';
import { turnContext, summarize, describeTurn } from '../com.github.copilot/extensions/trace/web/presentation.mjs';

const event = (id, type, extra = {}) => ({ id, type, agentId: '', ...extra });
const start = (id, turnId = '1', agentId = '') => event(id, 'assistant.turn_start', { turnId, agentId });
const end = (id, turnId = '1', agentId = '') => event(id, 'assistant.turn_end', { turnId, agentId });

test('turn boundaries bracket same-agent activity without changing chronological order', () => {
  const entries = [start('s'), event('tool', 'tool.execution_start'), start('sub', '1', 'child'),
    event('child-tool', 'tool.execution_start', { agentId: 'child' }), end('e'), end('sub-end', '1', 'child'), event('later', 'assistant.message')];
  const context = turnContext(entries);
  assert.equal(context.get('tool').turn, context.get('s').turn);
  assert.equal(context.get('child-tool').turn, context.get('sub').turn);
  assert.notEqual(context.get('tool').turn, context.get('child-tool').turn);
  assert.equal(context.get('s').turn.ended, true);
  assert.equal(context.get('s').turn.count, 1);
  assert.equal(context.get('e').role, 'end');
  assert.equal(context.has('later'), false);
  assert.deepEqual([...context.keys()], entries.slice(0, -1).map(e => e.id));
});

test('missing, mismatched and interrupted boundaries do not invent turn membership', () => {
  const entries = [end('orphan'), event('before', 'assistant.message'), start('s'),
    end('wrong', '2'), event('after', 'assistant.message'), start('missing', ''),
    event('no-id', 'assistant.message'), start('again', '3'), event('interrupt', 'abort'), event('post-abort', 'assistant.message')];
  const context = turnContext(entries);
  for (const id of ['orphan', 'before', 'wrong', 'after', 'missing', 'no-id', 'interrupt', 'post-abort']) assert.equal(context.has(id), false, id);
  assert.equal(context.get('s').turn.ended, false);
  assert.equal(context.get('again').turn.ended, false);
});

test('session notices and new user requests are not nested inside model turns', () => {
  const context = turnContext([start('s'), event('info', 'session.info'), event('user', 'user.message'), event('after', 'assistant.message')]);
  assert.equal(context.has('info'), false);
  assert.equal(context.has('user'), false);
  assert.equal(context.has('after'), false);
});

test('statistics deduplicate boundary pairs by agent and exact invocation ID', () => {
  const stats = summarize([start('s'), end('e'), start('sub', '1', 'child'),
    event('h1', 'hook.start', { hookInvocationId: 'h', displayName: 'beforeTool' }),
    event('h2', 'hook.end', { hookInvocationId: 'h', displayName: 'beforeTool' }),
    event('h3', 'hook.end', { hookInvocationId: 'other', displayName: 'afterTool' }),
    event('t1', 'tool.execution_start', { toolCallId: 't' }), event('t2', 'tool.execution_complete', { toolCallId: 't' }),
    event('sk1', 'skill.invoked', { displayName: 'research' }), event('sk2', 'skill.invoked', { displayName: 'research' })]);
  assert.equal(stats.turns, 2);
  assert.equal(stats.hooks, 2);
  assert.equal(stats.tools, 1);
  assert.equal(stats.skills, 2);
  assert.deepEqual(stats.skillNames, [['research', 2]]);
  assert.deepEqual(stats.hookNames, [['beforeTool', 1], ['afterTool', 1]]);
  assert.equal(stats.unlinked, 0);
});

test('partial history counts observed IDs and reports unidentifiable events separately', () => {
  const stats = summarize([end('end'), event('hook', 'hook.end'), event('tool', 'tool.execution_complete'), start('no-id', ''), event('sk', 'skill.invoked')]);
  assert.equal(stats.turns, 1);
  assert.equal(stats.hooks, 0);
  assert.equal(stats.tools, 0);
  assert.equal(stats.unlinked, 3);
  assert.deepEqual(stats.skillNames, [['Name unavailable', 1]]);
  assert.equal(summarize([]).turns, 0);
});

test('turn headings explain completion and missing evidence without claiming ongoing inference', () => {
  const entries = [start('s'), event('m', 'assistant.message'), end('e')];
  const context = turnContext(entries);
  assert.equal(describeTurn(entries[0], context.get('s')).title, 'Model turn 1');
  assert.match(describeTurn(entries[0], context.get('s')).subtitle, /1 event · Completed/);
  assert.equal(describeTurn(entries[2], context.get('e')).title, 'Turn 1 complete');
  assert.match(describeTurn(entries[0], turnContext(entries.slice(0, 2)).get('s')).subtitle, /End not observed/);
  assert.match(describeTurn(end('missing')).subtitle, /Matching start unavailable/);
});

test('turn IDs reused in later loops are counted as separate turns', () => {
  const entries = [start('s'), end('e'), event('u', 'user.message'), start('s2'), end('e2'), start('s3'), end('e3')];
  assert.equal(summarize(entries).turns, 3);
  assert.notEqual(turnContext(entries).get('s').turn, turnContext(entries).get('s2').turn);
  assert.equal(summarize([start('s'), event('abort', 'abort'), end('matching')]).turns, 1);
  assert.equal(summarize([start('s'), event('steering', 'user.message'), end('matching')]).turns, 1);
});

test('invalid source IDs cannot be correlated with the main agent', () => {
  const entries = [start('main'), start('invalid', '1', null), event('bad', 'tool.execution_start', { agentId: null, toolCallId: 't' }), end('bad-end', '1', null)];
  const context = turnContext(entries);
  assert.equal(context.size, 1);
  assert.equal(context.get('main').turn.ended, false);
  const stats = summarize(entries);
  assert.equal(stats.turns, 1);
  assert.equal(stats.unlinked, 3);
});
