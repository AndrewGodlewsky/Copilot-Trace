import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFollow } from '../com.github.copilot/extensions/trace/web/follow.mjs';

function fixture() {
  const checkbox = { checked: true };
  let top = 0;
  const page = {
    scrollHeight: 1000, clientHeight: 200,
    get scrollTop() { return top; },
    set scrollTop(value) { top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
  };
  const follow = createFollow(checkbox, () => page);
  follow.sync();
  return { checkbox, page, follow };
}

test('scrolling up pauses follow and later updates leave the chosen position alone', () => {
  const { checkbox, page, follow } = fixture();
  assert.equal(page.scrollTop, 800);
  page.scrollTop = 640;
  follow.onScroll();
  assert.equal(checkbox.checked, false);
  page.scrollHeight = 1400;
  follow.sync();
  assert.equal(page.scrollTop, 640);
  page.scrollTop = 1200;
  follow.onScroll();
  assert.equal(checkbox.checked, false, 'Returning to the bottom does not opt back in.');
});

test('a refresh cannot override a manual scroll whose scroll event is still queued', () => {
  const { checkbox, page, follow } = fixture();
  page.scrollTop = 500;
  follow.sync();
  assert.equal(checkbox.checked, false);
  assert.equal(page.scrollTop, 500);
});

test('explicitly checking Follow live snaps back to the full bottom and resumes', () => {
  const { checkbox, page, follow } = fixture();
  page.scrollTop = 300; follow.onScroll();
  checkbox.checked = true; follow.onChange();
  assert.equal(page.scrollTop, 800);
  assert.equal(checkbox.checked, true);
  follow.onScroll();
  assert.equal(checkbox.checked, true, 'Programmatic scrolling must not pause following.');
  page.scrollHeight = 1500; follow.sync();
  assert.equal(page.scrollTop, 1300);
});

test('content growth, viewport changes and clamping after shrink keep following', () => {
  const { checkbox, page, follow } = fixture();
  page.scrollHeight = 1300; follow.sync();
  assert.equal(page.scrollTop, 1100);
  page.clientHeight = 100; follow.sync();
  assert.equal(page.scrollTop, 1200);
  page.scrollHeight = 800;
  page.scrollTop = page.scrollTop; // Browser clamps a scroll position beyond the new end.
  follow.onScroll(); follow.sync();
  assert.equal(checkbox.checked, true);
  assert.equal(page.scrollTop, 700);
});

test('bottom rounding and a short page do not cause spurious pauses', () => {
  const { checkbox, page, follow } = fixture();
  page.scrollTop = 799.5; follow.onScroll();
  assert.equal(checkbox.checked, true);
  page.scrollHeight = 100; page.scrollTop = 0; follow.onScroll(); follow.sync();
  assert.equal(checkbox.checked, true);
  assert.equal(page.scrollTop, 0);
});
