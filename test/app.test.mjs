import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';

// A small DOM boundary double exercises reconciliation, not browser layout or native focus behavior.
function fixture(source) {
  let document;
  class Element {
    constructor(tagName) {
      this.tagName = tagName; this.children = []; this.parentElement = null; this.dataset = {};
      this.attributes = {}; this.listeners = new Map(); this.style = { setProperty() {} };
      this.className = ''; this._text = ''; this.open = false; this.checked = false;
      this.classList = {
        add: name => { if (!this.className.split(' ').includes(name)) this.className += ` ${name}`; },
        toggle: (name, value) => {
          this.className = this.className.split(' ').filter(item => item !== name).join(' ');
          if (value) this.classList.add(name);
        },
      };
    }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(text) { this.replaceChildren(); this._text = String(text); }
    get firstElementChild() { return this.children[0] || null; }
    get nextElementSibling() { const siblings = this.parentElement?.children || []; return siblings[siblings.indexOf(this) + 1] || null; }
    get isConnected() { return this === document.body || Boolean(this.parentElement?.isConnected); }
    append(...children) { for (const child of children) this.insertBefore(child, null); }
    insertBefore(child, before) {
      child.remove();
      const index = before === null ? this.children.length : this.children.indexOf(before);
      assert.ok(index >= 0, 'Insert target belongs to the parent.');
      this.children.splice(index, 0, child); child.parentElement = this;
    }
    remove() {
      if (!this.parentElement) return;
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null;
    }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this._text = ''; this.append(...children); }
    contains(element) { return this === element || this.children.some(child => child.contains(element)); }
    closest(selector) { return this.tagName === selector ? this : this.parentElement?.closest(selector) || null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
    dispatch(name) { for (const listener of this.listeners.get(name) || []) listener({ target: this, preventDefault() {} }); }
    focus() { assert.ok(this.isConnected, 'Focus target remains connected.'); document.activeElement = this; }
    scrollIntoView() { this.scrolled = true; }
    getBoundingClientRect() { return { height: 0 }; }
  }
  document = { body: new Element('body'), createElement: tag => new Element(tag),
    createElementNS: (_, tag) => new Element(tag) };
  document.activeElement = document.body;
  document.documentElement = document.body;
  const selectors = new Map();
  for (const selector of ['main', '#timeline', '#connection', '#notice', '#empty', '#follow', '#actor-legend', '#stat-counts',
    '#stat-scope', '#stat-unlinked', '#stat-hooks', '#stat-skills', '#statistics-peek', '#footer-dock', '#event-order']) {
    const element = new Element(selector === '#event-order' ? 'select' : 'div');
    selectors.set(selector, element); document.body.append(element);
  }
  selectors.get('#follow').checked = true;
  selectors.get('#event-order').value = 'grouped';
  document.querySelector = selector => selectors.get(selector);
  const context = vm.createContext({ ...presentation, document, window: { addEventListener() {} },
    ResizeObserver: class { observe() {} }, createDiagnostics: () => ({ record() {} }),
    createFollow: () => ({ onChange() {}, onScroll() {}, sync() {} }),
    createPoller: () => ({ refresh() {}, stop() {} }), initFooter() {},
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  return { document, get: selector => selectors.get(selector),
    render(entries, extra = {}) {
      context.fixtureSnapshot = { entries, history: 'ready', omitted: 0, ...extra };
      vm.runInContext('lastSnapshot = fixtureSnapshot; render(lastSnapshot);', context);
    } };
}
const appSource = await readFile(new URL('../com.github.copilot/extensions/trace/web/app.mjs', import.meta.url), 'utf8');
const boundary = (id, type, extra = {}) => ({ id, type: `tool.execution_${type}`, category: 'tool',
  agentId: '', toolCallId: 'call', toolName: 'view', timestamp: '2026-11-20T12:00:00Z',
  evidence: JSON.stringify({ id }), explanation: 'Recorded boundary.', ...extra });
const start = boundary('start "<>日本語\uD800', 'start');
const end = boundary('end', 'complete', { success: false, timestamp: '2026-11-20T12:00:01Z' });
const walk = element => [element, ...element.children.flatMap(walk)];
const byClass = (element, name) => walk(element).find(node => node.className.split(' ').includes(name));
const evidenceRows = group => byClass(group, 'tool-events').children;

const activityStart = { id: 'activity-start', type: 'assistant.turn_start', category: 'turn', agentId: '',
  turnId: '0', model: 'fixture-model', timestamp: '2026-11-20T12:00:00Z', evidence: '{}' };
function activityIntent(id, text, timestamp = '2026-11-20T12:00:01Z', extra = {}) {
  return { id, type: 'assistant.intent', category: 'model', agentId: '', timestamp, ...extra,
    evidence: JSON.stringify({ id, type: 'assistant.intent', timestamp,
      ...(extra.agentId ? { agentId: extra.agentId } : {}), data: { intent: text } }) };
}

test('reported headings and their persistent source control update without resetting disclosures, focus or counts', () => {
  const ui = fixture(appSource), later = activityIntent('later', 'Later statement');
  ui.render([activityStart]);
  const turnRow = ui.get('#timeline').firstElementChild;
  turnRow.firstElementChild.open = true;
  turnRow.firstElementChild.dispatch('toggle');
  const evidence = walk(turnRow).find(node => node.tagName === 'pre');
  evidence.focus();
  const counts = ui.get('#stat-counts').textContent;
  ui.render([activityStart, later]);
  const button = walk(turnRow).find(node => node.tagName === 'button');
  assert.ok(button, 'A reported turn exposes its original intent evidence.');
  assert.equal(button.parentElement.hidden, false);
  assert.equal(ui.get('#timeline').firstElementChild, turnRow);
  assert.equal(turnRow.firstElementChild.open, true);
  assert.equal(ui.document.activeElement, evidence);
  assert.equal(ui.get('#follow').checked, false);
  assert.equal(ui.get('#stat-counts').textContent, counts);
  assert.equal(byClass(turnRow, 'node-title').textContent, 'Reported activity: Later statement');
  button.focus();
  const earlier = activityIntent('earlier "<>日本語😀', 'First statement', '2026-11-20T12:00:00.500Z');
  ui.render([activityStart, earlier, later]);
  assert.equal(walk(turnRow).find(node => node.tagName === 'button'), button);
  assert.equal(ui.document.activeElement, button);
  assert.equal(byClass(turnRow, 'node-title').textContent, 'Reported activity: First statement');
  button.dispatch('click');
  const sourceRow = ui.get('#timeline').children[1];
  assert.equal(ui.get('#event-order').value, 'chronological');
  assert.equal(sourceRow.firstElementChild.open, true);
  assert.equal(ui.document.activeElement, sourceRow.firstElementChild.firstElementChild);
  assert.equal(sourceRow.scrolled, true);
  assert.equal(walk(sourceRow).find(node => node.tagName === 'pre').textContent, earlier.evidence);
});

test('activity evidence navigation works from every view and a withdrawn heading moves button focus safely', () => {
  const recorded = activityIntent('intent', 'Inspect the source');
  for (const mode of ['grouped', 'chapters', 'chronological']) {
    const ui = fixture(appSource);
    ui.render([activityStart, recorded]);
    ui.get('#event-order').value = mode;
    ui.get('#event-order').dispatch('change');
    const button = walk(ui.get('#timeline')).find(node => node.tagName === 'button');
    assert.ok(button);
    button.focus(); button.dispatch('click');
    const [turnRow, sourceRow] = ui.get('#timeline').children;
    assert.equal(ui.document.activeElement, sourceRow.firstElementChild.firstElementChild);
    assert.equal(sourceRow.firstElementChild.open, true);
    turnRow.firstElementChild.open = true;
    button.focus();
    const counts = ui.get('#stat-counts').textContent;
    ui.render([activityStart, recorded], { omitted: 1 });
    assert.equal(button.parentElement.hidden, true);
    assert.equal(ui.document.activeElement, turnRow.firstElementChild.firstElementChild);
    assert.equal(turnRow.firstElementChild.open, true);
    assert.equal(byClass(turnRow, 'node-title').textContent, 'Model turn 0');
    assert.equal(ui.get('#stat-counts').textContent, counts);
    assert.equal(ui.get('#follow').checked, false);
  }
});

test('canonical history replacement refreshes intent evidence and metadata in the existing focused node', () => {
  const ui = fixture(appSource), live = activityIntent('intent', 'Live statement', undefined, { truncated: true });
  ui.render([activityStart, live]);
  const row = ui.get('#timeline').children[1], details = row.firstElementChild;
  details.open = true;
  assert.equal(byClass(row, 'evidence-truncated').hidden, false);
  const pre = walk(row).find(node => node.tagName === 'pre');
  pre.focus();
  const canonical = activityIntent('intent', 'Canonical history statement', '2026-11-20T12:00:01.500Z');
  ui.render([activityStart, canonical]);
  assert.equal(ui.get('#timeline').children[1], row);
  assert.equal(details.open, true);
  assert.equal(walk(row).find(node => node.tagName === 'pre'), pre);
  assert.equal(pre.textContent, canonical.evidence);
  assert.equal(ui.document.activeElement, pre);
  assert.equal(byClass(row, 'evidence-truncated').hidden, true);
  assert.match(byClass(row, 'metadata').textContent, /2026-11-20T12:00:01\.500Z/);
  assert.equal(byClass(ui.get('#timeline').firstElementChild, 'node-title').textContent, 'Reported activity: Canonical history statement');
  const otherSource = activityIntent('intent', 'Child statement', '2026-11-20T12:00:01.750Z', { agentId: 'child' });
  ui.render([activityStart, otherSource]);
  assert.match(byClass(row, 'metadata').textContent, /Agent child/);
  assert.equal(pre.textContent, otherSource.evidence);
  assert.equal(ui.document.activeElement, pre);
  assert.equal(byClass(ui.get('#timeline').firstElementChild, 'node-title').textContent, 'Model turn 0');
});

test('tool cards retain expanded evidence and focus through completion, history and start eviction', () => {
  const ui = fixture(appSource);
  ui.render([start]);
  const group = ui.get('#timeline').firstElementChild;
  assert.ok(group.className.includes('tool-group'));
  const details = group.firstElementChild;
  details.open = true;
  const startRow = evidenceRows(group)[0];
  startRow.firstElementChild.open = true;
  const startEvidence = walk(startRow).find(node => node.tagName === 'pre');
  startEvidence.focus();
  ui.render([start, end]);
  assert.equal(ui.get('#timeline').children.length, 1);
  assert.equal(ui.get('#timeline').firstElementChild, group);
  assert.equal(evidenceRows(group)[0], startRow);
  assert.equal(details.open, true);
  assert.equal(startRow.firstElementChild.open, true);
  assert.equal(ui.document.activeElement, startEvidence);
  const endRow = evidenceRows(group)[1];
  endRow.firstElementChild.open = true;
  ui.render([{ id: 'history', type: 'session.info', category: 'host', evidence: '{}' }, start, end]);
  assert.equal(ui.get('#timeline').children[1], group);
  assert.equal(ui.document.activeElement, startEvidence);
  ui.render([end]);
  assert.equal(ui.get('#timeline').firstElementChild, group);
  assert.equal(evidenceRows(group)[0], endRow);
  assert.equal(endRow.firstElementChild.open, true);
  assert.equal(details.open, true);
  assert.equal(ui.document.activeElement, details.firstElementChild, 'Removed evidence falls back to its retained card.');
  assert.match(group.textContent, /Start unavailable.*Elapsed unknown/);
});

test('boundary controls reveal exact event order and mode changes reuse rows and group expansion', () => {
  const ui = fixture(appSource);
  const childStart = boundary('child-start', 'start', { agentId: 'child' });
  const childEnd = boundary('child-end', 'complete', { agentId: 'child' });
  ui.render([start, childStart, end, childEnd]);
  const group = ui.get('#timeline').children[0];
  assert.ok(group.className.includes('tool-group'));
  group.firstElementChild.open = true;
  const [startRow, endRow] = evidenceRows(group);
  const button = walk(group).filter(node => node.tagName === 'button')[1];
  assert.ok(button, 'Each retained boundary has a navigation control.');
  button.focus(); button.dispatch('click');
  assert.equal(ui.get('#event-order').value, 'chronological');
  assert.equal(ui.get('#follow').checked, false);
  const rows = ui.get('#timeline').children;
  assert.equal(rows.length, 4);
  assert.equal(rows[0], startRow);
  assert.equal(rows[2], endRow);
  assert.equal(ui.document.activeElement, endRow.firstElementChild.firstElementChild);
  assert.equal(endRow.firstElementChild.open, true);
  assert.equal(endRow.scrolled, true);
  ui.get('#event-order').value = 'grouped';
  ui.get('#event-order').dispatch('change');
  assert.equal(ui.get('#timeline').children[0], group);
  assert.equal(group.firstElementChild.open, true);
  assert.equal(evidenceRows(group)[1], endRow);
  assert.equal(ui.document.activeElement, endRow.firstElementChild.firstElementChild);
});

test('completion-first cards keep their identity when matching history arrives', () => {
  const ui = fixture(appSource);
  ui.render([end]);
  const group = ui.get('#timeline').firstElementChild;
  assert.ok(group.className.includes('tool-group'));
  group.firstElementChild.open = true;
  const row = evidenceRows(group)[0];
  row.firstElementChild.open = true;
  row.firstElementChild.firstElementChild.focus();
  ui.render([start, end]);
  assert.equal(ui.get('#timeline').firstElementChild, group);
  assert.equal(evidenceRows(group)[1], row);
  assert.equal(row.firstElementChild.open, true);
  assert.equal(ui.document.activeElement, row.firstElementChild.firstElementChild);
});

test('chronological retention moves focus to the surviving boundary and keeps counts unchanged by grouping', () => {
  const ui = fixture(appSource);
  ui.render([start, end]);
  const group = ui.get('#timeline').firstElementChild;
  const [startRow, endRow] = evidenceRows(group);
  const groupedCounts = ui.get('#stat-counts').textContent;
  ui.get('#event-order').value = 'chronological';
  ui.get('#event-order').dispatch('change');
  assert.equal(ui.get('#stat-counts').textContent, groupedCounts);
  assert.ok(startRow.textContent.includes(start.timestamp));
  assert.ok(endRow.textContent.includes(end.timestamp));
  assert.equal(walk(startRow).find(node => node.tagName === 'pre').textContent, start.evidence);
  startRow.firstElementChild.open = true;
  startRow.firstElementChild.firstElementChild.focus();
  ui.render([end]);
  assert.equal(ui.get('#timeline').firstElementChild, endRow);
  assert.equal(ui.document.activeElement, endRow.firstElementChild.firstElementChild);
  assert.equal(ui.get('#stat-counts').textContent, groupedCounts);
});

const request = (id, extra = {}) => ({ id, type: 'user.message', category: 'chat', agentId: '',
  delivery: 'idle', interactionId: id, preview: '<img> 日本語😀\n  exact text', evidence: JSON.stringify({ id }), ...extra });
const requestTurn = (id, interactionId) => ({ id, type: 'assistant.turn_start', category: 'turn', agentId: '',
  turnId: '0', interactionId, evidence: JSON.stringify({ id }) });
const chapterRows = chapter => byClass(chapter, 'chapter-events').children;
function chapterMode(ui) {
  ui.get('#event-order').value = 'chapters';
  ui.get('#event-order').dispatch('change');
}

test('request chapters keep collapsed state and summary focus as live events and earlier history arrive', () => {
  const ui = fixture(appSource);
  const input = request('input'), turn = requestTurn('turn', 'input');
  ui.render([input, turn, start]);
  chapterMode(ui);
  const chapter = ui.get('#timeline').firstElementChild;
  assert.ok(chapter.className.includes('request-chapter'));
  const details = chapter.firstElementChild;
  assert.equal(details.open, false);
  details.firstElementChild.focus();
  ui.render([request('earlier'), input, turn, start, end]);
  assert.equal(ui.get('#timeline').children[1], chapter);
  assert.equal(details.open, false, 'Updating a focused collapsed header must not open it.');
  assert.equal(ui.document.activeElement, details.firstElementChild);
  assert.equal(byClass(chapter, 'node-title').textContent, input.preview);
  assert.match(chapter.textContent, /4 retained events.*1 model turns.*1 tool calls/);
  assert.equal(chapterRows(chapter).length, 4);
  details.open = true;
  details.dispatch('toggle');
  assert.equal(ui.get('#follow').checked, false);
});

test('request chapters retain original evidence rows, tool cards and focus across view changes', () => {
  const ui = fixture(appSource);
  const input = request('input');
  ui.render([input, start, end]);
  const tool = ui.get('#timeline').children[1];
  tool.firstElementChild.open = true;
  const [startRow, endRow] = evidenceRows(tool);
  chapterMode(ui);
  const chapter = ui.get('#timeline').firstElementChild;
  assert.ok(chapter.className.includes('request-chapter'));
  assert.deepEqual(chapterRows(chapter).slice(1), [startRow, endRow]);
  chapter.firstElementChild.open = true;
  endRow.firstElementChild.open = true;
  const evidence = walk(endRow).find(node => node.tagName === 'pre');
  evidence.focus();
  const counts = ui.get('#stat-counts').textContent;
  ui.get('#event-order').value = 'grouped';
  ui.get('#event-order').dispatch('change');
  assert.equal(ui.get('#timeline').children[1], tool);
  assert.equal(tool.firstElementChild.open, true);
  assert.equal(ui.document.activeElement, evidence);
  chapterMode(ui);
  assert.equal(ui.get('#timeline').firstElementChild, chapter);
  assert.equal(chapter.firstElementChild.open, true);
  assert.equal(ui.document.activeElement, evidence);
  assert.equal(ui.get('#stat-counts').textContent, counts);
  assert.equal(evidence.textContent, end.evidence);
  ui.get('#event-order').value = 'chronological';
  ui.get('#event-order').dispatch('change');
  assert.deepEqual(ui.get('#timeline').children.slice(1), [startRow, endRow]);
  assert.ok(endRow.textContent.includes(end.timestamp));
});

test('queued chapter boundaries do not move earlier input and eviction retains surviving chapter focus', () => {
  const ui = fixture(appSource);
  const input = request('input'), queued = request('queued', { delivery: 'queued' });
  const turn = requestTurn('queued-turn', 'queued');
  ui.render([input, queued, start]);
  chapterMode(ui);
  const first = ui.get('#timeline').firstElementChild;
  assert.ok(first.className.includes('request-chapter'));
  const queuedRow = chapterRows(first)[1];
  ui.render([input, queued, start, turn, end]);
  assert.equal(ui.get('#timeline').children.length, 2);
  assert.equal(chapterRows(first)[1], queuedRow);
  const second = ui.get('#timeline').children[1];
  second.firstElementChild.open = true;
  const turnRow = chapterRows(second)[0];
  turnRow.firstElementChild.open = true;
  turnRow.firstElementChild.firstElementChild.focus();
  ui.render([end], { omitted: 4 });
  assert.equal(ui.get('#timeline').firstElementChild, second);
  assert.equal(second.firstElementChild.open, true);
  assert.equal(ui.document.activeElement, second.firstElementChild.firstElementChild);
  assert.match(second.textContent, /Partial first chapter/);
  assert.match(second.textContent, /boundary unknown/);
  ui.render([]);
  assert.equal(ui.document.activeElement, ui.get('#event-order'), 'When nothing survives, focus returns to the view control.');
});

test('history splitting an unknown interval retains its disclosure state for surviving event spans', () => {
  const ui = fixture(appSource);
  const one = requestTurn('one-turn', 'one'), two = requestTurn('two-turn', 'two');
  ui.render([one, two]);
  chapterMode(ui);
  const original = ui.get('#timeline').firstElementChild;
  assert.ok(original.className.includes('request-chapter'));
  original.firstElementChild.open = true;
  ui.render([request('one'), one, request('two'), two]);
  assert.equal(ui.get('#timeline').children.length, 2);
  assert.ok(ui.get('#timeline').children.every(chapter => chapter.firstElementChild.open));
});

test('evicting queued input merges uncertain intervals and restores chapter-summary focus', () => {
  const ui = fixture(appSource);
  const one = request('one'), queued = request('queued', { delivery: 'queued' });
  const before = requestTurn('before', 'one'), after = requestTurn('after', 'queued');
  ui.render([one, queued, before, after]);
  chapterMode(ui);
  const second = ui.get('#timeline').children[1];
  second.firstElementChild.firstElementChild.focus();
  ui.render([before, after], { omitted: 2 });
  assert.equal(ui.get('#timeline').children.length, 1);
  const merged = ui.get('#timeline').firstElementChild;
  assert.equal(ui.document.activeElement, merged.firstElementChild.firstElementChild);
  assert.equal(chapterRows(merged).length, 2);
  assert.match(merged.textContent, /boundary unknown/);
});

test('merging chapters preserves expanded retained evidence without relying on keyboard focus', () => {
  const ui = fixture(appSource);
  const one = request('one'), queued = request('queued', { delivery: 'queued' });
  const before = requestTurn('before', 'one'), after = requestTurn('after', 'queued');
  ui.render([one, queued, before, after]);
  chapterMode(ui);
  const [first, second] = ui.get('#timeline').children;
  assert.equal(first.firstElementChild.open, false);
  second.firstElementChild.open = true;
  const retainedRow = chapterRows(second)[0];
  retainedRow.firstElementChild.open = true;
  assert.equal(ui.document.activeElement, ui.document.body, 'Mouse reading has no focused descendant.');

  ui.render([before, after], { omitted: 2 });
  const merged = ui.get('#timeline').firstElementChild;
  assert.equal(ui.get('#timeline').children.length, 1);
  assert.equal(merged.firstElementChild.open, true, 'Any overlapping open chapter keeps retained evidence visible.');
  assert.equal(chapterRows(merged)[1], retainedRow);
  assert.equal(retainedRow.firstElementChild.open, true);
  assert.equal(ui.document.activeElement, ui.document.body);

  merged.firstElementChild.open = false;
  ui.render([before, after, requestTurn('later', 'queued')], { omitted: 2 });
  assert.equal(ui.get('#timeline').firstElementChild, merged);
  assert.equal(merged.firstElementChild.open, false, 'A subsequent one-to-one update preserves an explicit collapse.');
});
