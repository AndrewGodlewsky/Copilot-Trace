import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as learning from '../com.github.copilot/extensions/trace/web/learning.mjs';

const entry = (id, extra = {}) => ({ id, type: 'session.info', agentId: '', evidence: `Evidence ${id}`, ...extra });
const snapshot = entries => ({ entries, history: 'unavailable', omitted: 17, liveReceipt: 10 });
function clock() {
  const pending = new Map(), callbacks = []; let id = 0;
  return { pending, callbacks, schedule(fn) { callbacks.push(fn); pending.set(++id, fn); return id; },
    cancel(id) { pending.delete(id); }, tick() { const [id, fn] = pending.entries().next().value; pending.delete(id); fn(); } };
}

test('playback preserves frozen source evidence, recorded order and partial-history limits while stepping a prefix', () => {
  assert.equal(typeof learning.createPlayback, 'function');
  const source = snapshot([entry('later-time', { timestamp: 'z', agentId: 'child', hostOutput: { text: '日本語 😀' } }),
    entry('earlier-time', { timestamp: 'a' }), entry('missing-time')]);
  const playback = learning.createPlayback(source);
  assert.deepEqual(playback.state.snapshot.entries.map(entry => entry.id), ['later-time']);
  source.entries[0].evidence = 'mutated'; source.entries[0].hostOutput.text = 'changed'; source.entries.shift();
  playback.next();
  assert.deepEqual(playback.state.snapshot.entries.map(entry => entry.id), ['later-time', 'earlier-time']);
  assert.equal(playback.state.snapshot.entries[0].agentId, 'child');
  assert.equal(playback.state.snapshot.entries[0].hostOutput.text, '日本語 😀');
  assert.equal(playback.state.snapshot.entries[0].evidence, 'Evidence later-time');
  assert.equal(playback.state.snapshot.history, 'unavailable'); assert.equal(playback.state.snapshot.omitted, 17);
  assert.throws(() => { playback.state.snapshot.entries[0].hostOutput.text = 'overwrite'; }, TypeError);
  playback.previous(); playback.previous(); assert.equal(playback.state.count, 1);
  playback.next(); playback.next(); playback.next(); assert.equal(playback.state.count, 3);
});

test('empty, single, oversized and ambiguous playback windows have bounded deterministic end states', () => {
  assert.equal(typeof learning.createPlayback, 'function');
  for (const entries of [[], [entry('only')], [entry('duplicate'), entry('duplicate')]]) {
    const timers = clock(), playback = learning.createPlayback(snapshot(entries), timers);
    playback.play(); playback.next(); playback.previous();
    assert.equal(timers.pending.size, 0); assert.equal(playback.state.playing, false);
    assert.equal(playback.state.count, entries.length === 1 ? 1 : 0);
    assert.equal(playback.state.valid, entries.length !== 2);
  }
  const playback = learning.createPlayback(snapshot(Array.from({ length: 305 }, (_, i) => entry(String(i)))));
  for (let i = 0; i < 305; i++) playback.next();
  assert.equal(playback.state.count, 300); assert.equal(playback.state.snapshot.entries.length, 300);
  assert.equal(playback.state.snapshot.entries.at(-1).id, '299');
});

test('one playback timer advances deterministically and stale callbacks cannot cross pause, end or close', () => {
  assert.equal(typeof learning.createPlayback, 'function');
  const timers = clock(), playback = learning.createPlayback(snapshot([entry('a'), entry('b'), entry('c')]), timers);
  playback.play(); playback.play(); assert.equal(timers.pending.size, 1);
  const stale = timers.callbacks.at(-1); playback.pause(); playback.play(); stale();
  assert.equal(playback.state.count, 1); assert.equal(timers.pending.size, 1);
  timers.tick(); assert.equal(playback.state.count, 2); assert.equal(timers.pending.size, 1);
  timers.tick(); assert.equal(playback.state.count, 3); assert.equal(playback.state.playing, false); assert.equal(timers.pending.size, 0);
  playback.previous(); playback.play(); const afterClose = timers.callbacks.at(-1);
  playback.close(); afterClose(); playback.next(); playback.play();
  assert.equal(playback.state, null); assert.equal(timers.pending.size, 0);
});

test('reduced motion prevents automatic playback and changing the preference cancels a pending advance', () => {
  assert.equal(typeof learning.createPlayback, 'function');
  const timers = clock(), playback = learning.createPlayback(snapshot([entry('a'), entry('b'), entry('c')]), { ...timers, reducedMotion: true });
  playback.play(); assert.equal(timers.pending.size, 0);
  playback.next(); assert.equal(playback.state.count, 2);
  playback.setReducedMotion(false); playback.play(); const stale = timers.callbacks.at(-1);
  playback.setReducedMotion(true); stale();
  assert.equal(playback.state.count, 2); assert.equal(playback.state.playing, false); assert.equal(timers.pending.size, 0);
  playback.setReducedMotion(false); assert.equal(timers.pending.size, 0, 'Preference changes never auto-start.');
});

test('activity count uses receipt deltas through retained eviction and stays unknown after an unsafe cursor', () => {
  assert.equal(typeof learning.createActivityCounter, 'function');
  const count = learning.createActivityCounter({ history: 'ready', liveReceipt: 10 });
  assert.equal(count({ ...snapshot([entry('a')]), history: 'ready' }), 0);
  assert.equal(count({ ...snapshot([entry('replacement')]), history: 'ready', liveReceipt: 315, omitted: 321 }), 305);
  assert.equal(count({ history: 'ready', liveReceipt: 2 }), null);
  assert.equal(count({ history: 'ready', liveReceipt: 400 }), null);
  assert.equal(learning.createActivityCounter({ liveReceipt: null })({ liveReceipt: 5 }), null);
  assert.equal(learning.createActivityCounter({ history: 'loading', liveReceipt: 0 })({ history: 'ready', liveReceipt: 5 }), null);
});

test('a synchronous pause or close from playback rendering cannot schedule a timer afterward', () => {
  for (const action of ['pause', 'close']) {
    const timers = clock(); let playback;
    playback = learning.createPlayback(snapshot([entry('a'), entry('b')]), { ...timers,
      onChange(state) { if (state.playing) playback[action](); } });
    playback.play();
    assert.equal(timers.pending.size, 0, action);
  }
});
