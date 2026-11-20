import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFollow, createLivePresentation } from '../com.github.copilot/extensions/trace/web/follow.mjs';

function snapshot(count, extra = {}) {
  return { history: 'ready', omitted: 0, liveReceipt: count,
    entries: Array.from({ length: count }, (_, i) => ({ id: `event-${i + 1}`, type: 'assistant.message',
      timestamp: '2026-11-20T00:00:00.000Z', evidence: `Exact 日本語 ${i + 1}`,
      observation: { source: 'live', receipt: i + 1 } })), ...extra };
}

function fixture() {
  let time = 0, next = 0, top = 0, reduced = false, live = true;
  const frames = new Map(), callbacks = [], views = [];
  const checkbox = { checked: true };
  const page = { scrollHeight: 1000, clientHeight: 200,
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); } };
  const following = createFollow(checkbox, () => page);
  const presenter = createLivePresentation({ following, canAnimate: () => checkbox.checked && !reduced && live,
    now: () => time,
    requestFrame(callback) { callbacks.push(callback); frames.set(++next, callback); return next; },
    cancelFrame(id) { frames.delete(id); },
    render(value) { views.push(value); page.scrollHeight = 1000 + value.entries.length * 100; } });
  return { presenter, following, checkbox, page, frames, callbacks, views,
    get shown() { return views.at(-1); },
    reduce() { reduced = true; presenter.finish(); },
    leave() { live = false; return presenter.cancel(); },
    step(value) { time = value; const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); },
    advance(value) { time = value; },
  };
}

test('live arrivals progress in order, with intermediate viewport positions and an exact final snapshot by 240 ms', () => {
  const ui = fixture(), initial = snapshot(2), burst = snapshot(10);
  ui.presenter.present(initial);
  assert.equal(ui.shown, initial, 'Initial history appears in full.');
  assert.equal(ui.page.scrollTop, 1000);
  ui.presenter.present(burst, initial);
  assert.deepEqual(ui.shown.entries.map(entry => entry.id), ['event-1', 'event-2', 'event-3', 'event-4']);
  assert.equal(ui.page.scrollTop, 1000, 'Inserting the first rows does not snap the viewport.');
  ui.following.sync();
  assert.equal(ui.page.scrollTop, 1000, 'Resize/poll synchronization must not bypass the animation.');
  ui.step(60);
  assert.equal(ui.shown.entries.length, 6);
  assert.ok(ui.page.scrollTop > 1000 && ui.page.scrollTop < 1400);
  ui.step(120); assert.equal(ui.shown.entries.length, 8);
  ui.step(180); assert.equal(ui.shown, burst);
  assert.ok(ui.page.scrollTop < 1800);
  ui.step(240);
  assert.equal(ui.page.scrollTop, 1800);
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.checkbox.checked, true, 'Programmatic scrolling does not interrupt following.');
  assert.equal(ui.shown.entries[9].evidence, 'Exact 日本語 10');
  assert.equal(ui.shown.entries[9].timestamp, '2026-11-20T00:00:00.000Z');
});

test('a large burst has the same total budget and late frames catch up without replaying a queue', () => {
  const ui = fixture(), initial = snapshot(0), burst = snapshot(300);
  ui.presenter.present(initial); ui.presenter.present(burst, initial);
  assert.equal(ui.shown.entries.length, 75);
  ui.step(1000);
  assert.equal(ui.shown, burst);
  assert.equal(ui.page.scrollTop, 30800);
  assert.equal(ui.frames.size, 0);
  assert.equal(ui.views.length, 3, 'A suspended frame goes straight to the final snapshot.');
});

test('new arrivals coalesce into the original deadline without losing order or the latest snapshot', () => {
  const ui = fixture(), initial = snapshot(2), first = snapshot(10), second = snapshot(18), last = snapshot(22);
  ui.presenter.present(initial); ui.presenter.present(first, initial); ui.step(60);
  ui.advance(100); ui.presenter.present(second, first);
  assert.equal(ui.frames.size, 1);
  assert.equal(ui.shown.entries.length, 10);
  ui.step(180); assert.equal(ui.shown, second);
  ui.advance(220); ui.presenter.present(last, second);
  assert.equal(ui.shown, last);
  ui.step(240);
  assert.equal(ui.shown, last); assert.equal(ui.page.scrollTop, 3000); assert.equal(ui.frames.size, 0);
});

test('identifiable rolling-window arrivals still progress at the retention limit and share the original deadline', () => {
  const ui = fixture(), initial = snapshot(300);
  const first = snapshot(308, { omitted: 8, entries: snapshot(308).entries.slice(8) });
  const second = snapshot(316, { omitted: 16, entries: snapshot(316).entries.slice(16) });
  ui.presenter.present(initial); ui.presenter.present(first, initial);
  assert.equal(ui.shown.entries.length, 294);
  assert.equal(ui.shown.entries[0].id, 'event-9');
  assert.equal(ui.shown.entries.at(-1).id, 'event-302');
  ui.step(60);
  ui.presenter.present(second, first);
  assert.equal(ui.shown.entries[0].id, 'event-17');
  assert.equal(ui.shown.entries.at(-1).id, 'event-308');
  ui.step(180); assert.equal(ui.shown, second);
  ui.step(240); assert.equal(ui.frames.size, 0);
  assert.equal(ui.shown.entries.length, 300);
  assert.equal(ui.shown.entries.at(-1).id, 'event-316');
});

test('upward scrolling, even with its event queued, stops motion and settles all data at the chosen position', () => {
  const ui = fixture(), initial = snapshot(2), burst = snapshot(10);
  ui.presenter.present(initial); ui.presenter.present(burst, initial); ui.step(60);
  ui.page.scrollTop = 900;
  ui.step(120);
  assert.equal(ui.checkbox.checked, false);
  assert.equal(ui.page.scrollTop, 900);
  assert.equal(ui.shown, burst);
  assert.equal(ui.frames.size, 0);
});

test('unchecking Follow or inspecting stops pending motion without leaving hidden arrivals', () => {
  const ui = fixture(), initial = snapshot(2), burst = snapshot(10);
  ui.presenter.present(initial); ui.presenter.present(burst, initial); ui.step(60);
  const top = ui.page.scrollTop;
  ui.checkbox.checked = false; ui.step(80);
  assert.equal(ui.shown, burst); assert.equal(ui.page.scrollTop, top); assert.equal(ui.frames.size, 0);
  const next = snapshot(12); ui.presenter.present(next, burst);
  assert.equal(ui.shown, next); assert.equal(ui.page.scrollTop, top); assert.equal(ui.frames.size, 0);
});

test('reduced motion settles immediately and prevents subsequent animation', () => {
  const ui = fixture(), initial = snapshot(2), burst = snapshot(10);
  ui.presenter.present(initial); ui.presenter.present(burst, initial); ui.step(60);
  ui.reduce();
  assert.equal(ui.shown, burst); assert.equal(ui.page.scrollTop, 1800); assert.equal(ui.frames.size, 0);
  const next = snapshot(12); ui.presenter.present(next, burst);
  assert.equal(ui.shown, next); assert.equal(ui.page.scrollTop, 2000); assert.equal(ui.frames.size, 0);
});

test('history hydration, retention, changed evidence and backdated insertions render immediately', () => {
  const initial = snapshot(2);
  const cases = [
    [snapshot(2, { history: 'loading' }), snapshot(6)],
    [initial, snapshot(6, { omitted: 1 })],
    [initial, snapshot(6, { entries: snapshot(6).entries.slice(1) })],
    [initial, snapshot(6, { entries: snapshot(6).entries.map((entry, i) => i === 0 ? { ...entry, evidence: 'Updated' } : entry) })],
    [initial, snapshot(6, { entries: [snapshot(6).entries[2], ...initial.entries, ...snapshot(6).entries.slice(3)] })],
    [initial, snapshot(6, { entries: [...initial.entries, ...snapshot(6).entries.slice(2).map(entry => ({ ...entry, observation: { source: 'history', receipt: null } }))] })],
  ];
  for (const [before, after] of cases) {
    const ui = fixture(); ui.presenter.present(before); ui.presenter.present(after, before);
    assert.equal(ui.shown, after); assert.equal(ui.frames.size, 0);
  }
});

test('replacement during a burst cancels stale callbacks and renders the replacement exactly', () => {
  const ui = fixture(), initial = snapshot(2), burst = snapshot(10), replacement = snapshot(3, { omitted: 7 });
  ui.presenter.present(initial); ui.presenter.present(burst, initial);
  const stale = ui.callbacks.at(-1);
  ui.presenter.present(replacement, burst); stale();
  assert.equal(ui.shown, replacement); assert.equal(ui.frames.size, 0);
});

test('context cancellation returns the received snapshot without altering a frozen view; close releases all work', () => {
  const ui = fixture(), initial = snapshot(2), burst = snapshot(10);
  ui.presenter.present(initial); ui.presenter.present(burst, initial);
  const frozen = ui.shown, stale = ui.callbacks.at(-1);
  assert.equal(ui.leave(), burst); stale();
  assert.equal(ui.shown, frozen); assert.equal(ui.frames.size, 0);
  ui.presenter.close(); ui.presenter.present(snapshot(12), burst); stale();
  assert.equal(ui.shown, frozen); assert.equal(ui.frames.size, 0);
});
