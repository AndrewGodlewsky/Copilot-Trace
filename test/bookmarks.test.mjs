import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as learning from '../com.github.copilot/extensions/trace/web/learning.mjs';

const entry = id => ({ id, type: 'assistant.message', agentId: '', timestamp: '2026-11-20T12:00:00Z',
  preview: 'Literal 日本語🧪<script>', evidence: '{"content":"Literal 日本語🧪<script>"}' });
function bookmarks() {
  assert.equal(typeof learning.createSurpriseBookmarks, 'function');
  return learning.createSurpriseBookmarks();
}

test('surprise bookmarks deduplicate exact originals and reject overflow without replacing marks', () => {
  const marks = bookmarks(), entries = Array.from({ length: 21 }, (_, i) => entry(String(i)));
  const before = structuredClone(entries);
  for (const original of entries.slice(0, 20)) assert.equal(marks.mark(original, entries), 'marked');
  const first = marks.items[0];
  assert.equal(marks.mark(structuredClone(entries[0]), entries), 'duplicate');
  assert.equal(marks.mark(entries[20], entries), 'full');
  assert.equal(marks.items.length, 20); assert.equal(marks.items[0], first);
  assert.deepEqual(entries, before);
  marks.unmark(first); assert.equal(first.expected, null);
  assert.equal(marks.mark(entries[20], entries), 'marked');
  assert.equal(marks.items.at(-1).number, 21);
});

test('surprise bookmarks discard comparison data on eviction, ambiguity and in-place replacement permanently', () => {
  for (const change of [entries => entries.splice(0, 1), entries => entries.push(structuredClone(entries[0])),
    entries => { entries[0].agentId = 'other-source'; }, entries => { entries[0].evidence += ' changed'; }]) {
    const marks = bookmarks(), original = entry('same'), entries = [structuredClone(original)];
    marks.mark(entries[0], entries); const mark = marks.items[0]; change(entries); marks.sync(entries);
    assert.equal(mark.expected, null); assert.equal(marks.find(original), undefined);
    marks.sync([original]); assert.equal(mark.expected, null);
    assert.equal(marks.mark(original, [original]), 'marked');
    assert.equal(marks.items.length, 2); assert.equal(marks.items[0].number, 1);
  }
});

test('surprise bookmarks reject invalid, ambiguous and oversized evidence and release every capture on clear/close', () => {
  const marks = bookmarks(), original = entry('one');
  assert.equal(marks.mark(original, []), 'unavailable');
  assert.equal(marks.mark(original, [original, original]), 'unavailable');
  const huge = { ...original, evidence: 'x'.repeat(65537) };
  assert.equal(marks.mark(huge, [huge]), 'unavailable');
  const invalid = { ...original, id: '' };
  assert.equal(marks.mark(invalid, [invalid]), 'unavailable');
  marks.mark(original, [original]); const first = marks.items[0]; marks.clear();
  assert.equal(first.expected, null); assert.equal(marks.items.length, 0);
  marks.mark(original, [original]); const second = marks.items[0]; marks.close();
  assert.equal(second.expected, null); assert.equal(marks.items.length, 0);
  assert.equal(marks.mark(original, [original]), 'unavailable');
});
