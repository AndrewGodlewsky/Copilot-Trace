import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPoller } from '../com.github.copilot/extensions/trace/web/polling.mjs';

test('manual refresh joins in-flight reads and keeps exactly one polling timer', async () => {
  let finish; let reads = 0; let next = 0;
  const timers = new Map();
  const poller = createPoller({
    load: () => { reads++; return new Promise(resolve => { finish = resolve; }); },
    schedule: fn => { timers.set(++next, fn); return next; },
    cancel: id => timers.delete(id),
  });
  const first = poller.refresh();
  const repeated = poller.refresh();
  await Promise.resolve();
  assert.equal(reads, 1);
  finish(true);
  assert.deepEqual(await Promise.all([first, repeated]), [true, true]);
  assert.equal(timers.size, 1);
  const refresh = poller.refresh();
  await Promise.resolve();
  assert.equal(timers.size, 0);
  assert.equal(reads, 2);
  poller.stop(); finish(true); await refresh;
  assert.equal(timers.size, 0);
});

test('failed reads report once and leave automatic retry available', async () => {
  let errors = 0; let scheduled = 0;
  const poller = createPoller({ load: () => { throw new Error('private'); }, onError: () => { errors++; }, schedule: () => ++scheduled, cancel: () => {} });
  assert.equal(await poller.refresh(), false);
  assert.equal(errors, 1);
  assert.equal(scheduled, 1);
  assert.equal(await poller.refresh(), false);
  assert.equal(errors, 2);
  poller.stop();
});
