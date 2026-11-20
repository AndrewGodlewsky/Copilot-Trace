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
    render(entries) {
      context.fixtureSnapshot = { entries, history: 'ready', omitted: 0 };
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
