import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createFollow } from '../com.github.copilot/extensions/trace/web/follow.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';
import * as capabilities from '../com.github.copilot/extensions/trace/web/capabilities.mjs';
import * as instructions from '../com.github.copilot/extensions/trace/web/instructions.mjs';
import * as footer from '../com.github.copilot/extensions/trace/web/footer.mjs';
import { createPoller } from '../com.github.copilot/extensions/trace/web/polling.mjs';

// A small DOM boundary double exercises reconciliation, not browser layout or native focus behavior.
function fixture(source, inventoryLoad = async () => { throw new Error('Unexpected inventory request'); }, feedLoad, instructionLoad = async () => { throw new Error('Unexpected instruction request'); }) {
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
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    querySelectorAll(selector) {
      const matches = node => selector.startsWith('.') ? node.className.split(' ').includes(selector.slice(1))
        : selector === '[data-panel]' ? Boolean(node.dataset.panel)
        : selector === '[data-close-panel]' ? node.dataset.closePanel !== undefined : node.tagName === selector;
      return this.children.flatMap(child => [child, ...child.querySelectorAll('*')]).filter(node => selector === '*' || matches(node));
    }
    addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
    dispatch(name) {
      let prevented = false;
      for (const listener of this.listeners.get(name) || []) listener({ target: this, preventDefault() { prevented = true; } });
      if (name === 'cancel' && !prevented) this.close();
    }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatch('close'); }
    focus() { assert.ok(this.isConnected, 'Focus target remains connected.'); document.activeElement = this; }
    scrollIntoView() {
      this.scrolled = true;
      this.followAtScroll = selectors.get('#follow').checked;
      document.scrollingElement.scrollTop = 120;
    }
    getBoundingClientRect() { return { height: 0 }; }
  }
  document = { body: new Element('body'), createElement: tag => new Element(tag),
    createElementNS: (_, tag) => new Element(tag) };
  document.activeElement = document.body;
  document.documentElement = document.body;
  let scrollTop = 0;
  document.scrollingElement = {
    scrollHeight: 1000, clientHeight: 200,
    get scrollTop() { return scrollTop; },
    set scrollTop(value) { scrollTop = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); },
  };
  const selectors = new Map();
  for (const selector of ['main', '#timeline', '#connection', '#notice', '#empty', '#follow', '#actor-legend', '#stat-counts',
    '#stat-scope', '#stat-hooks', '#stat-skills', '#statistics-peek', '#footer-dock', '#event-order',
    '#activity-filter', '#reset-filter', '#filter-status', '#filter-empty', '#lane-help',
    '#event-target', '#jump-event', '#navigation-status', '#capabilities', '#capability-refresh', '#capability-status',
    '#capability-scope', '#capability-window', '#capability-list', '#glossary-button', '#glossary-panel',
    '#glossary-concept', '#glossary-definition', '#glossary-deeper', '#glossary-example', '#glossary-source', '#glossary-status',
    '#guidance-comparison', '#guidance-examples',
    '#retrieval-ledger', '#retrieval-summary', '#retrieval-scope', '#retrieval-list', '#retrieval-unclassified', '#retrieval-unknown-list',
    '#instruction-sources', '#instruction-refresh', '#instruction-status', '#instruction-scope', '#instruction-window', '#instruction-current', '#instruction-loads',
    '#instruction-inspector', '#instruction-title', '#instruction-detail', '#instruction-body', '#instruction-original', '#instruction-selection-status',
    '#statistics-panel', '#statistics-button', '#evidence-scope', '#scope-summary', '#scope-view', '#stat-evidence-scope', '#stat-scope-summary']) {
    const element = new Element(['#event-order', '#activity-filter', '#event-target'].includes(selector) ? 'select' : selector === '#jump-event' ? 'button' : 'div');
    element.id = selector.slice(1); selectors.set(selector, element); document.body.append(element);
  }
  const glossary = selectors.get('#glossary-panel');
  const statistics = selectors.get('#statistics-panel');
  for (const [id, summary, body] of [['#evidence-scope', '#scope-summary', '#notice'], ['#stat-evidence-scope', '#stat-scope-summary', '#stat-scope']]) {
    const disclosure = selectors.get(id); disclosure.tagName = 'details';
    selectors.get(summary).tagName = 'summary'; disclosure.append(selectors.get(summary), selectors.get(body));
  }
  statistics.append(selectors.get('#stat-evidence-scope'));
  statistics.tagName = 'dialog'; statistics.className = 'footer-panel';
  const statisticsClose = new Element('button'); statisticsClose.textContent = 'Close'; statisticsClose.dataset.closePanel = ''; statistics.append(statisticsClose);
  selectors.get('#statistics-button').dataset.panel = 'statistics-panel';
  const retrieval = selectors.get('#retrieval-ledger'); retrieval.tagName = 'details'; statistics.append(retrieval);
  for (const id of ['summary', 'scope', 'list', 'unclassified']) retrieval.append(selectors.get(`#retrieval-${id}`));
  selectors.get('#retrieval-unclassified').tagName = 'details';
  selectors.get('#retrieval-unclassified').append(new Element('summary'));
  selectors.get('#retrieval-unclassified').append(selectors.get('#retrieval-unknown-list'));
  const instruction = selectors.get('#instruction-sources'); instruction.tagName = 'details'; statistics.append(instruction);
  for (const id of ['refresh', 'status', 'scope', 'window', 'current', 'loads', 'inspector']) instruction.append(selectors.get(`#instruction-${id}`));
  for (const id of ['title', 'detail', 'body', 'original', 'selection-status']) selectors.get('#instruction-inspector').append(selectors.get(`#instruction-${id}`));
  for (const id of ['refresh', 'original']) selectors.get(`#instruction-${id}`).tagName = 'button';
  selectors.get('#instruction-body').tagName = 'pre';
  glossary.tagName = 'dialog'; glossary.className = 'footer-panel';
  const close = new Element('button'); close.textContent = 'Close'; close.dataset.closePanel = ''; glossary.append(close);
  for (const id of ['concept', 'definition', 'deeper', 'example', 'source', 'status']) glossary.append(selectors.get(`#glossary-${id}`));
  selectors.get('#glossary-concept').tagName = 'select'; selectors.get('#glossary-source').tagName = 'button';
  selectors.get('#glossary-button').tagName = 'button';
  const deeper = selectors.get('#glossary-deeper'), more = new Element('details');
  more.className = 'glossary-depth'; glossary.insertBefore(more, deeper); more.append(deeper);
  const comparison = selectors.get('#guidance-comparison'); comparison.tagName = 'details';
  comparison.append(new Element('summary'), selectors.get('#guidance-examples')); glossary.append(comparison);
  selectors.get('#follow').checked = true;
  selectors.get('#event-order').value = 'grouped';
  selectors.get('#activity-filter').value = 'everything';
  selectors.get('#event-target').value = 'failure';
  document.querySelector = selector => selectors.get(selector);
  document.getElementById = id => selectors.get(`#${id}`);
  document.querySelectorAll = selector => document.body.querySelectorAll(selector);
  const context = vm.createContext({ ...presentation, document, window: { addEventListener() {} },
    ResizeObserver: class { observe() {} }, createDiagnostics: () => ({ record() {} }),
    createFollow,
    initCapabilities: options => capabilities.initCapabilities({ ...options, document, load: inventoryLoad }),
    initInstructionSources: options => instructions.initInstructionSources({ ...options, document, load: instructionLoad }),
    fetch: feedLoad, AbortSignal,
    createPoller: options => feedLoad ? createPoller({ ...options, schedule: () => 1, cancel() {} }) : ({ refresh() {}, stop() {} }),
    initFooter: options => footer.initPanels?.({ ...options, document }),
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  return { document, get: selector => selectors.get(selector),
    refreshFeed() { return vm.runInContext('poller.refresh();', context); },
    refreshCapabilities() { return vm.runInContext('capabilityView.refresh();', context); },
    closeCapabilities() { vm.runInContext('capabilityView.close();', context); },
    refreshInstructions() { return vm.runInContext('instructionView.refresh();', context); },
    closeInstructions() { vm.runInContext('instructionView.close();', context); },
    syncFollowing() { vm.runInContext('following.sync();', context); },
    render(entries, extra = {}) {
      context.fixtureSnapshot = { entries, history: 'ready', omitted: 0, ...extra };
      vm.runInContext('lastSnapshot = fixtureSnapshot; render(lastSnapshot);', context);
    } };
}
const appSource = await readFile(new URL('../com.github.copilot/extensions/trace/web/app.mjs', import.meta.url), 'utf8');

const feedResponse = (snapshot, status = 200) => ({ status, headers: { get: () => 'fixture-revision' }, json: async () => snapshot });

test('actual poller keeps initial failure counts unavailable and explains zero events after recovery', async () => {
  let response = new Error('private fixture failure');
  const ui = fixture(appSource, undefined, async () => { if (response instanceof Error) throw response; return response; });
  assert.equal(await ui.refreshFeed(), false);
  assert.match(ui.get('#connection').textContent, /Disconnected/);
  assert.match(ui.get('#statistics-peek').textContent, /Counts unavailable/);
  assert.match(ui.get('#notice').textContent, /No event snapshot.*counts are unknown/);
  assert.deepEqual(walk(ui.get('#stat-counts')).filter(node => node.tagName === 'dd').map(node => node.textContent), ['—', '—', '—', '—']);
  response = feedResponse({ entries: [], history: 'unavailable', omitted: 0 });
  assert.equal(await ui.refreshFeed(), true);
  assert.match(ui.get('#stat-scope').textContent, /Earlier history could not be read/);
  assert.match(ui.get('#statistics-peek').textContent, /Counts unavailable/);
  response = feedResponse({ entries: [], history: 'ready', omitted: 0 });
  assert.equal(await ui.refreshFeed(), true);
  assert.match(ui.get('#notice').textContent, /No retained supported events.*not proof that nothing happened/);
  assert.deepEqual(walk(ui.get('#stat-counts')).filter(node => node.tagName === 'dd').map(node => node.textContent), ['0', '0', '0', '0']);
  assert.doesNotMatch(ui.document.body.textContent, /private fixture failure/);
});

test('actual poller preserves offline status across filters and views, then clears stale context on 304 without rebuilding', async () => {
  const entries = [{ id: 'fixture', type: 'user.message', category: 'chat', agentId: '', title: 'Fixture', evidence: '{}' }];
  let response = feedResponse({ entries, history: 'ready', omitted: 0 });
  const ui = fixture(appSource, undefined, async () => response);
  assert.equal(await ui.refreshFeed(), true);
  response = feedResponse(null, 503);
  assert.equal(await ui.refreshFeed(), false);
  for (const [selector, value] of [['#activity-filter', 'tools'], ['#event-order', 'chronological'], ['#activity-filter', 'everything']]) {
    const control = ui.get(selector); control.value = value; control.dispatch('change');
    assert.match(ui.get('#connection').textContent, /Disconnected/);
    assert.match(ui.get('#statistics-peek').textContent, /Stale retained/);
    assert.match(ui.get('#stat-scope').textContent, /previous snapshot.*out of date/);
  }
  const details = ui.get('#evidence-scope'), summary = ui.get('#scope-summary');
  details.open = true; details.dispatch('toggle'); summary.focus();
  const row = ui.get('#timeline').firstElementChild;
  const eventDetails = row.querySelector('details'); eventDetails.open = true;
  ui.document.scrollingElement.scrollTop = 250;
  const statistics = ui.get('#stat-evidence-scope'); statistics.open = true; ui.get('#statistics-panel').scrollTop = 80;
  response = feedResponse(null, 304);
  assert.equal(await ui.refreshFeed(), true);
  assert.match(ui.get('#connection').textContent, /Connected/);
  assert.doesNotMatch(ui.get('#statistics-peek').textContent, /Stale/);
  assert.doesNotMatch(ui.get('#stat-scope').textContent, /out of date/);
  assert.equal(ui.get('#timeline').firstElementChild, row);
  assert.equal(details.open, true); assert.equal(eventDetails.open, true); assert.equal(statistics.open, true);
  assert.equal(ui.document.activeElement, summary);
  assert.equal(ui.document.scrollingElement.scrollTop, 250); assert.equal(ui.get('#statistics-panel').scrollTop, 80);
  assert.equal(ui.get('#follow').checked, false);
  response = feedResponse(null, 500); await ui.refreshFeed();
  response = feedResponse({ entries: [...entries, { ...entries[0], id: 'second' }], history: 'ready', omitted: 1 });
  assert.equal(await ui.refreshFeed(), true);
  assert.match(ui.get('#connection').textContent, /Connected/);
  assert.doesNotMatch(ui.get('#stat-scope').textContent, /out of date/);
  assert.match(ui.get('#scope-summary').textContent, /Older events omitted/);
  assert.equal(ui.document.activeElement, summary); assert.equal(details.open, true);
});

test('scope disclosures keep healthy rows quiet and preserve inspection on live changes and eviction', () => {
  const ui = fixture(appSource);
  const entries = [{ id: 'first', type: 'user.message', category: 'chat', agentId: '', evidence: '{}', title: 'Fixture' }];
  ui.render(entries);
  assert.match(ui.get('#scope-summary').textContent, /1 retained event.*Scope and limits/);
  assert.doesNotMatch(ui.get('#scope-summary').textContent, /unavailable|unknown|omitted|clipped|Stale/i);
  assert.equal(ui.get('#evidence-scope').open, false);
  assert.doesNotMatch(ui.get('#timeline').firstElementChild.querySelector('summary').textContent, /300|12,000|History.*unavailable/);
  for (const [id, summaryId] of [['#evidence-scope', '#scope-summary'], ['#stat-evidence-scope', '#stat-scope-summary']]) {
    const disclosure = ui.get(id), summary = ui.get(summaryId);
    assert.equal(disclosure.tagName, 'details'); assert.equal(summary.tagName, 'summary');
    ui.get('#follow').checked = true; disclosure.open = true; disclosure.dispatch('toggle');
    assert.equal(ui.get('#follow').checked, false);
    summary.focus(); ui.document.scrollingElement.scrollTop = 250;
    ui.render([{ ...entries[0], id: 'replacement' }], { omitted: 1 });
    assert.equal(disclosure.open, true); assert.equal(ui.document.activeElement, summary);
    assert.equal(ui.document.scrollingElement.scrollTop, 250);
    assert.match(summary.textContent, /Older events omitted/);
  }
});

test('inventory controls fetch only on request and preserve disclosure, focus, literal text and scroll across live updates', async t => {
  let reads = 0;
  const ui = fixture(appSource, async () => { reads++; return {
    schemaVersion: 1, scope: 'main-session', capturedAt: new Date().toISOString(),
    tools: { status: 'ready', omitted: 0, invalid: 0, items: [{ name: '<tool> 🧪', identityValid: true, mcpServerName: null, mcpToolName: null }] },
    skills: { status: 'unsupported', items: [], omitted: 0, invalid: 0 },
  }; });
  t.after(() => ui.closeCapabilities());
  ui.render([]); assert.equal(reads, 0);
  const disclosure = ui.get('#capabilities'), button = ui.get('#capability-refresh'), list = ui.get('#capability-list');
  disclosure.open = true; disclosure.dispatch('toggle'); assert.equal(reads, 0);
  button.focus(); button.dispatch('click'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1); assert.match(list.textContent, /<tool> 🧪/); assert.match(list.textContent, /Not observed here/);
  assert.match(ui.get('#capability-status').textContent, /unsupported/i);
  assert.equal(walk(list).some(node => ['script', 'a', 'tool'].includes(node.tagName)), false);
  const row = list.firstElementChild; list.scrollTop = 50;
  ui.document.scrollingElement.scrollTop = 250; ui.render([]);
  assert.equal(reads, 1); assert.equal(list.firstElementChild, row); assert.equal(disclosure.open, true);
  assert.equal(ui.document.activeElement, button); assert.equal(list.scrollTop, 50); assert.equal(ui.document.scrollingElement.scrollTop, 250);
});

function inventoryClock(t) {
  let now = Date.parse('2026-11-20T12:00:00Z'), nextId = 0;
  const timers = new Map();
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    const id = ++nextId; timers.set(id, { callback, due: now + delay }); return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  return { timers, now: () => now, advance(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.due <= now) { timers.delete(id); timer.callback(); }
  } };
}
const emptyInventory = capturedAt => ({ schemaVersion: 1, scope: 'main-session', capturedAt,
  tools: { status: 'ready', items: [], omitted: 0, invalid: 0 }, skills: { status: 'ready', items: [], omitted: 0, invalid: 0 } });

test('idle inventory becomes stale after a minute without new events or reads and keeps reading state', async t => {
  const clock = inventoryClock(t); let reads = 0;
  const ui = fixture(appSource, async () => { reads++; return emptyInventory(new Date(clock.now()).toISOString()); });
  t.after(() => ui.closeCapabilities());
  ui.render([]); await ui.refreshCapabilities();
  const button = ui.get('#capability-refresh'), list = ui.get('#capability-list'), disclosure = ui.get('#capabilities');
  const row = list.firstElementChild;
  button.focus(); list.scrollTop = 50; ui.document.scrollingElement.scrollTop = 250;
  clock.advance(59999); assert.doesNotMatch(ui.get('#capability-status').textContent, /Stale snapshot/);
  clock.advance(2); assert.match(ui.get('#capability-status').textContent, /Stale snapshot/);
  disclosure.open = true; disclosure.dispatch('toggle');
  assert.equal(reads, 1); assert.equal(clock.timers.size, 0, 'The age update is one-shot, not a polling loop.');
  assert.equal(ui.document.activeElement, button); assert.equal(list.firstElementChild, row);
  assert.equal(disclosure.open, true); assert.equal(list.scrollTop, 50); assert.equal(ui.document.scrollingElement.scrollTop, 250);
  const message = ui.get('#capability-status').textContent;
  clock.advance(600000); assert.equal(ui.get('#capability-status').textContent, message);
});

test('refresh replaces the stale-age timer and close clears it with any pending request timer', async t => {
  const clock = inventoryClock(t); let finish, calls = 0;
  const ui = fixture(appSource, async () => {
    calls++;
    if (calls > 1) await new Promise(resolve => { finish = resolve; });
    return emptyInventory(new Date(clock.now()).toISOString());
  });
  t.after(() => ui.closeCapabilities());
  await ui.refreshCapabilities();
  assert.equal(clock.timers.size, 1);
  const ageTimer = [...clock.timers.keys()][0]; clock.advance(10000);
  const refreshing = ui.refreshCapabilities();
  assert.equal(clock.timers.has(ageTimer), false);
  assert.equal(clock.timers.size, 1, 'Only the request deadline remains while refreshing.');
  finish(); await refreshing;
  assert.equal(clock.timers.size, 1, 'A fresh snapshot gets only one new age timer.');
  assert.equal([...clock.timers.values()][0].due, clock.now() + 60001);
  ui.closeCapabilities(); assert.equal(clock.timers.size, 0);
  const message = ui.get('#capability-status').textContent;
  clock.advance(61000); assert.equal(ui.get('#capability-status').textContent, message);

  const pending = fixture(appSource, () => new Promise(resolve => { finish = resolve; }));
  const request = pending.refreshCapabilities(); assert.equal(clock.timers.size, 1);
  pending.closeCapabilities(); assert.equal(clock.timers.size, 0);
  finish(emptyInventory(new Date(clock.now()).toISOString())); await request;
  assert.equal(clock.timers.size, 0, 'A late closed result cannot recreate an age timer.');
});

test('newer refresh wins and closed panels ignore late inventory results', async () => {
  const requests = [];
  const ui = fixture(appSource, () => new Promise(resolve => requests.push(resolve)));
  const value = name => ({ schemaVersion: 1, scope: 'main-session', capturedAt: new Date().toISOString(),
    tools: { status: 'ready', items: [{ name, identityValid: true }], omitted: 0, invalid: 0 },
    skills: { status: 'ready', items: [], omitted: 0, invalid: 0 } });
  const old = ui.refreshCapabilities(), newer = ui.refreshCapabilities();
  requests[1](value('new')); await newer;
  requests[0](value('old')); await old;
  assert.match(ui.get('#capability-list').textContent, /Tool: new/);
  assert.doesNotMatch(ui.get('#capability-list').textContent, /Tool: old/);
  const closing = ui.refreshCapabilities(); ui.closeCapabilities();
  const before = ui.get('#capability-list').textContent;
  requests[2](value('closed')); await closing;
  assert.equal(ui.get('#capability-list').textContent, before);
});

test('inventory failures keep the previous snapshot explicitly stale and later activity exposes its age', async () => {
  let fail = false;
  const ui = fixture(appSource, async () => {
    if (fail) throw new Error('private path credential');
    return { schemaVersion: 1, scope: 'main-session', capturedAt: '2026-01-01T00:00:00Z',
      tools: { status: 'ready', items: [], omitted: 0, invalid: 0 }, skills: { status: 'ready', items: [], omitted: 0, invalid: 0 } };
  });
  await ui.refreshCapabilities();
  assert.match(ui.get('#capability-status').textContent, /Stale snapshot/);
  fail = true; await ui.refreshCapabilities();
  assert.match(ui.get('#capability-status').textContent, /Refresh unavailable.*Previous snapshot/);
  assert.doesNotMatch(ui.get('#capability-status').textContent, /private|credential/);
  ui.render([{ id: 'message', type: 'user.message', category: 'chat', agentId: '', evidence: '{}', timestamp: '2026-11-20T12:00:00Z' }]);
  assert.equal(ui.get('#timeline').children.length, 1);
});
const boundary = (id, type, extra = {}) => ({ id, type: `tool.execution_${type}`, category: 'tool',
  agentId: '', toolCallId: 'call', toolName: 'view', timestamp: '2026-11-20T12:00:00Z',
  evidence: JSON.stringify({ id }), explanation: 'Recorded boundary.', ...extra });
const start = boundary('start "<>日本語\uD800', 'start');
const end = boundary('end', 'complete', { success: false, timestamp: '2026-11-20T12:00:01Z' });
const walk = element => [element, ...element.children.flatMap(walk)];
const visibleWalk = element => element.hidden ? [] : [element, ...element.children.flatMap(visibleWalk)];
const visibleEvidence = ui => visibleWalk(ui.get('#timeline')).filter(node => node.attributes['aria-label'] === 'Recorded event data').map(node => node.textContent);
function filterMode(ui, value) {
  ui.get('#activity-filter').value = value;
  ui.get('#activity-filter').dispatch('change');
}
const byClass = (element, name) => walk(element).find(node => node.className.split(' ').includes(name));
const evidenceRows = group => byClass(group, 'tool-events').children;
const reveal = node => {
  for (let parent = node.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'details') parent.open = true;
};

test('retrieval ledger preserves literal text, focus, disclosures and scroll during live updates', async () => {
  const raw = [
    { id: 'read-start', type: 'tool.execution_start', data: { toolCallId: 'read', toolName: 'view', arguments: { path: 'café 🧪<img>.txt', view_range: [3, 5] } } },
    { id: 'read-end', type: 'tool.execution_complete', data: { toolCallId: 'read', success: true, result: { content: '<script>literal 🧪</script>\nline 4' } } },
  ];
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close();
  const ui = fixture(appSource); ui.render(entries);
  const list = ui.get('#retrieval-list'), disclosure = ui.get('#retrieval-ledger');
  assert.equal(list.children.length, 1);
  assert.match(ui.get('#retrieval-summary').textContent, /1.*occurrence.*1.*reference/i);
  assert.match(list.textContent, /café 🧪<img>.txt/);
  assert.match(list.textContent, /<script>literal 🧪<\/script>/);
  assert.equal(walk(list).some(node => ['script', 'img', 'a'].includes(node.tagName)), false);
  disclosure.open = true; disclosure.dispatch('toggle');
  assert.equal(ui.get('#follow').checked, false);
  const row = list.firstElementChild, detail = row.querySelector('details'); detail.open = true;
  const content = row.querySelector('.retrieval-content'); content.open = true;
  const pre = content.querySelector('pre'); pre.focus(); pre.scrollTop = 20; list.scrollTop = 60;
  ui.get('#statistics-panel').scrollTop = 140;
  ui.document.scrollingElement.scrollTop = 270;
  ui.render([...entries, { id: 'notice', type: 'session.info', category: 'session', agentId: '', evidence: '{}', timestamp: '' }]);
  assert.equal(list.firstElementChild, row); assert.equal(detail.open, true); assert.equal(content.open, true);
  assert.equal(ui.document.activeElement, pre); assert.equal(pre.scrollTop, 20); assert.equal(list.scrollTop, 60);
  assert.equal(ui.get('#statistics-panel').scrollTop, 140);
  assert.equal(ui.document.scrollingElement.scrollTop, 270); assert.equal(ui.get('#follow').checked, false);
  ui.render(entries.slice(1), { omitted: 1 });
  assert.equal(list.children.length, 0);
  assert.match(ui.get('#retrieval-unknown-list').textContent, /unknown/i);
  assert.match(ui.get('#retrieval-scope').textContent, /older events.*omitted/i);
  assert.ok(ui.document.activeElement.isConnected, 'Evicted rows retain a reachable focus destination.');
});

test('a late retrieval completion updates the same row without collapsing or moving request focus', async () => {
  const raw = [
    { id: 'late-start', type: 'tool.execution_start', data: { toolCallId: 'late', toolName: 'view', arguments: { path: 'file' } } },
    { id: 'late-end', type: 'tool.execution_complete', data: { toolCallId: 'late', success: true, result: { content: 'returned later' } } },
  ];
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close();
  const ui = fixture(appSource); ui.render(entries.slice(0, 1));
  const list = ui.get('#retrieval-list'), row = list.firstElementChild;
  assert.match(row.textContent, /Completion not observed/);
  const request = row.querySelector('pre'); reveal(request); request.focus(); list.scrollTop = 35;
  ui.get('#follow').checked = false; ui.render(entries);
  assert.equal(list.firstElementChild, row); assert.equal(row.querySelector('details').open, true);
  assert.equal(ui.document.activeElement, request); assert.equal(list.scrollTop, 35);
  assert.equal(ui.get('#follow').checked, false);
  assert.match(row.textContent, /Reported success.*text returned/);
  assert.match(row.textContent, /returned later/);
  assert.equal(row.querySelectorAll('button').length, 2);
  const changed = { ...entries[1], evidence: JSON.stringify({ ...raw[1], data: { ...raw[1].data, result: { content: 'new retained text' } } }) };
  ui.render([entries[0], changed]);
  assert.equal(list.firstElementChild, row); assert.equal(ui.document.activeElement, request);
  assert.match(row.textContent, /new retained text/); assert.doesNotMatch(row.textContent, /returned later/);
});

test('retrieval evidence navigation closes Statistics, resets filters and opens exact original evidence in every view', async () => {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => [
    { id: 'retrieve-start', agentId: 'child', type: 'tool.execution_start', data: { toolCallId: 'call', toolName: 'grep', arguments: { pattern: '🧪', paths: 'src', output_mode: 'content', head_limit: 2 } } },
    { id: 'retrieve-end', agentId: 'child', type: 'tool.execution_complete', data: { toolCallId: 'call', success: false, result: { content: 'diagnostic <img>' } } },
  ] });
  await trace.ready; const entries = trace.snapshot().entries; trace.close();
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource); ui.get('#event-order').value = mode; ui.render(entries); filterMode(ui, 'automation');
    ui.get('#statistics-button').dispatch('click');
    assert.equal(ui.get('#statistics-panel').open, true);
    const list = ui.get('#retrieval-list'); assert.doesNotMatch(list.textContent, /diagnostic <img>/);
    const button = walk(list).find(node => node.tagName === 'button' && /result evidence/i.test(node.textContent));
    assert.ok(button); reveal(button); button.dispatch('click');
    assert.equal(ui.get('#statistics-panel').open, false);
    assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#activity-filter').value, 'everything');
    assert.equal(ui.get('#follow').checked, false);
    const target = ui.get('#timeline').children[1];
    assert.equal(target.querySelector('details').open, true);
    assert.equal(target.querySelector('.recorded-evidence').open, true);
    assert.equal(ui.document.activeElement, target.querySelector('summary'));
    assert.match(visibleEvidence(ui)[1], /diagnostic <img>/);
    ui.render([], { history: 'unsupported' });
    assert.match(ui.get('#retrieval-summary').textContent, /no recognized.*retained/i);
    assert.match(ui.get('#retrieval-scope').textContent, /did not expose the session event API/i);
    ui.get('#statistics-button').dispatch('click');
    const top = ui.document.scrollingElement.scrollTop; button.dispatch('click');
    assert.equal(ui.get('#statistics-panel').open, true, 'An expired source action does not dismiss the current panel.');
    assert.equal(ui.document.scrollingElement.scrollTop, top);
    assert.match(ui.get('#navigation-status').textContent, /no longer retained/i);
  }
});

test('scope badges share ledger facts and preserve detail focus during late results and eviction', async () => {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => [
    { id: 'scope-start', type: 'tool.execution_start', data: { toolCallId: 'scope', toolName: 'view', arguments: { path: '🧪<img>.txt', view_range: [3, 5] } } },
    { id: 'scope-end', type: 'tool.execution_complete', data: { toolCallId: 'scope', success: true, result: { content: '🧪<script>' } } },
  ] });
  await trace.ready; const entries = trace.snapshot().entries; trace.close();
  const ui = fixture(appSource); ui.get('#event-order').value = 'chronological'; ui.render(entries.slice(0, 1));
  const source = ui.get('#timeline').firstElementChild, scope = source.querySelector('.extent-evidence');
  assert.ok(scope);
  assert.match(scope.textContent, /Requested limited scope.*Unknown coverage/);
  assert.match(scope.textContent, /Lines 3–5 requested/);
  const explanation = scope.querySelector('details'), summary = explanation.querySelector('summary');
  reveal(summary); explanation.open = true; summary.focus();
  ui.document.scrollingElement.scrollTop = 310; ui.get('#follow').checked = false;
  ui.render(entries);
  assert.equal(source.querySelector('.extent-evidence'), scope);
  assert.equal(explanation.open, true); assert.equal(ui.document.activeElement, summary);
  assert.equal(ui.document.scrollingElement.scrollTop, 310); assert.equal(ui.get('#follow').checked, false);
  assert.match(scope.textContent, /10 UTF-16 code units.*result.content/);
  assert.match(ui.get('#retrieval-list').textContent, /Lines 3–5 requested.*10 UTF-16 code units/s);
  assert.equal(walk(ui.get('#retrieval-list')).some(node => ['img', 'script', 'a'].includes(node.tagName)), false);
  ui.render(entries.slice(1), { omitted: 1 });
  assert.ok(ui.document.activeElement.isConnected);
  assert.match(ui.get('#retrieval-unknown-list').textContent, /Unknown coverage/);
});

test('a doubly shortened result keeps raw evidence separate from the validated host fact', async () => {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => [
    { id: 'clipped-end', type: 'tool.execution_complete', data: { toolCallId: 'clipped', success: true, result: {
      content: '🧪'.repeat(9000), contents: [{ type: 'shell_exit', shellId: 'owned', exitCode: 0, outputTruncated: true, outputPreview: '🧪' }],
    } } },
  ] });
  await trace.ready; const entries = trace.snapshot().entries; trace.close();
  const ui = fixture(appSource); ui.get('#event-order').value = 'chronological'; ui.render(entries);
  const source = ui.get('#timeline').firstElementChild, scope = source.querySelector('.extent-evidence');
  assert.match(scope.textContent, /Host-shortened preview.*Trace-clipped evidence/);
  assert.match(scope.textContent, /separate validated projection.*raw payload is clipped/s);
  assert.match(source.querySelector('.recorded-evidence').textContent, /12,000 UTF-16 code units/);
  assert.equal(source.querySelector('.recorded-evidence').querySelector('pre').textContent, entries[0].evidence);
  const ledger = ui.get('#retrieval-unknown-list');
  assert.match(ledger.textContent, /Host-shortened preview.*Trace-clipped evidence/);
  const original = ledger.querySelector('button'); reveal(original); original.dispatch('click');
  assert.equal(source.querySelector('.recorded-evidence').open, true);
  assert.equal(ui.get('#follow').checked, false);
});

test('glossary offers all concepts with labeled authored fallback and preserves reading state on Close or Escape', () => {
  const ui = fixture(appSource);
  ui.render([]);
  const opener = ui.get('#glossary-button'), panel = ui.get('#glossary-panel'), select = ui.get('#glossary-concept');
  opener.focus(); ui.document.scrollingElement.scrollTop = 333; opener.dispatch('click');
  assert.equal(panel.open, true);
  assert.equal(select.children.length, 8);
  assert.equal(ui.get('#follow').checked, false);
  for (const id of ['model-turn', 'tool', 'hook', 'skill', 'context', 'subagent', 'permission', 'compaction']) {
    select.value = id; select.dispatch('change');
    assert.equal(ui.get('#glossary-definition').textContent, presentation.vocabulary[id].definition);
    assert.match(ui.get('#glossary-example').textContent, /Static example.*not from this chat/);
    assert.match(ui.get('#glossary-status').textContent, /No retained/);
    assert.equal(ui.get('#glossary-source').hidden, true);
  }
  panel.dispatch('cancel');
  assert.equal(panel.open, false);
  assert.equal(ui.document.activeElement, opener);
  assert.equal(ui.document.scrollingElement.scrollTop, 333);
  assert.equal(ui.get('#follow').checked, false);
  opener.dispatch('click'); panel.firstElementChild.dispatch('click');
  assert.equal(panel.open, false); assert.equal(ui.document.activeElement, opener);
});

test('every relevant event offers its concept and current example without treating source text as markup', () => {
  const cases = [['assistant.turn_start', 'model-turn'], ['tool.execution_start', 'tool'], ['hook.start', 'hook'],
    ['skill.invoked', 'skill'], ['user.message', 'context'], ['subagent.started', 'subagent'],
    ['permission.requested', 'permission'], ['session.compaction_start', 'compaction']];
  for (const [type, concept] of cases) {
    const ui = fixture(appSource);
    const entry = { id: `event-${concept}`, type, agentId: '<img> 日本語 🧪', timestamp: '', evidence: '{}', category: 'host' };
    ui.render([entry]);
    const opener = byClass(ui.get('#timeline'), 'glossary-term'); assert.ok(opener, type);
    reveal(opener); opener.dispatch('click');
    assert.equal(ui.get('#glossary-concept').value, concept);
    assert.equal(ui.get('#glossary-definition').textContent, presentation.vocabulary[concept].definition);
    assert.equal(ui.get('#glossary-source').hidden, false);
    assert.ok(ui.get('#glossary-example').textContent.includes('<img> 日本語 🧪'));
    assert.equal(walk(ui.get('#glossary-panel')).some(node => node.tagName === 'img'), false);
  }
});

test('live arrival does not replace an authored example until the user chooses a concept again', () => {
  const ui = fixture(appSource); ui.render([]); ui.get('#glossary-button').dispatch('click');
  const select = ui.get('#glossary-concept'); select.value = 'tool'; select.dispatch('change');
  const text = ui.get('#glossary-example').textContent;
  ui.render([start, end]);
  assert.equal(ui.get('#glossary-example').textContent, text);
  assert.equal(ui.get('#glossary-source').hidden, true);
  select.dispatch('change');
  assert.equal(ui.get('#glossary-source').hidden, false);
  assert.match(ui.get('#glossary-example').textContent, /tool.execution_complete/);
});

test('contextual glossary keeps nested disclosures, view, filter and focus through live updates and ordinary dismissal', () => {
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource); ui.get('#event-order').value = mode; ui.render([start, end]); filterMode(ui, 'tools');
    const opener = byClass(ui.get('#timeline'), 'glossary-term'); assert.ok(opener, mode);
    for (let parent = opener.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'details') parent.open = true;
    const details = opener.closest('details');
    details.open = true; opener.focus(); ui.document.scrollingElement.scrollTop = 333; opener.dispatch('click');
    const depth = ui.get('#glossary-deeper').closest('details'); depth.open = true;
    ui.get('#glossary-source').focus(); ui.get('#glossary-panel').scrollTop = 41;
    ui.render([start, end, { id: 'later', type: 'session.info', agentId: '', evidence: '{}', timestamp: '' }]);
    assert.equal(ui.get('#glossary-panel').open, true); assert.equal(depth.open, true);
    assert.equal(ui.document.activeElement, ui.get('#glossary-source')); assert.equal(ui.get('#glossary-panel').scrollTop, 41);
    ui.get('#glossary-panel').dispatch('cancel');
    assert.equal(ui.document.activeElement, opener); assert.equal(details.open, true);
    assert.equal(ui.get('#event-order').value, mode); assert.equal(ui.get('#activity-filter').value, 'tools');
    assert.equal(ui.document.scrollingElement.scrollTop, 333); assert.equal(ui.get('#follow').checked, false);
  }
});

test('glossary source navigation opens its contextual event from every view and hidden-filter state', () => {
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource); ui.get('#event-order').value = mode; ui.render([start, end]);
    const opener = byClass(ui.get('#timeline'), 'glossary-term'); assert.ok(opener);
    opener.dispatch('click');
    assert.match(ui.get('#glossary-example').textContent, /Current chat example/);
    assert.match(ui.get('#glossary-example').textContent, /tool.execution_start/);
    filterMode(ui, 'automation');
    ui.get('#glossary-source').dispatch('click');
    assert.equal(ui.get('#glossary-panel').open, false);
    assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#activity-filter').value, 'everything');
    const row = ui.get('#timeline').children[0];
    assert.equal(ui.document.activeElement, row.firstElementChild.firstElementChild);
    assert.equal(byClass(row, 'recorded-evidence').open, true);
    assert.equal(byClass(row, 'evidence').textContent.includes(start.evidence), true);
    assert.equal(ui.get('#follow').checked, false);
  }
});

test('an open glossary never rebinds an evicted or changed example and falls back to its stable entry button', () => {
  for (const replacement of [null, { ...start, agentId: 'other' }, { ...start, timestamp: 'different' },
    { ...start, type: 'tool.execution_complete' }, { ...start, evidence: '{"replacement":true}' }]) {
    const ui = fixture(appSource); ui.render([start, end]);
    const opener = byClass(ui.get('#timeline'), 'glossary-term'); assert.ok(opener); reveal(opener); opener.focus(); opener.dispatch('click');
    ui.document.scrollingElement.scrollTop = 333;
    ui.render(replacement ? [replacement, end] : [end], { omitted: 1 });
    assert.match(ui.get('#glossary-status').textContent, /no longer available|changed/i);
    ui.get('#glossary-source').dispatch('click');
    assert.equal(ui.get('#glossary-panel').open, true); assert.equal(ui.document.scrollingElement.scrollTop, 333);
    ui.render([start, end]);
    ui.get('#glossary-source').dispatch('click');
    assert.equal(ui.get('#glossary-panel').open, true, 'A later reused identity cannot revive an expired example.');
    ui.get('#glossary-panel').dispatch('cancel');
    assert.equal(ui.document.activeElement, replacement ? opener : ui.get('#glossary-button'));
    assert.equal(ui.get('#follow').checked, false);
  }
});

test('guidance comparison keeps chosen examples, literal bodies, focus and disclosures during live reading in every view', async () => {
  const records = [
    { id: 'lesson-skill', type: 'skill.invoked', timestamp: '', agentId: '<img> 日本語 🧪', data: { name: '<b>review</b>', path: '', content: '<script>deny()</script> 日本語 🧪'.repeat(40) } },
    { id: 'lesson-start', type: 'hook.start', timestamp: '', data: { hookInvocationId: 'pipeline', hookType: 'preToolUse' } },
    { id: 'lesson-end', type: 'hook.end', timestamp: '', data: { hookInvocationId: 'pipeline', hookType: 'preToolUse', success: true, output: { permissionDecision: 'deny', additionalContext: '<img> 日本語 🧪' } } },
    { id: 'lesson-permission', type: 'permission.completed', timestamp: '', data: { requestId: 'request', result: { kind: 'denied-by-rules' } } },
  ];
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => records }); await trace.ready;
  const entries = trace.snapshot().entries; trace.close();
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource); ui.get('#event-order').value = mode; ui.render(entries);
    const opener = walk(ui.get('#timeline')).find(node => node.className === 'glossary-term' && /skill/i.test(node.textContent));
    reveal(opener); opener.dispatch('click');
    const disclosure = ui.get('#guidance-comparison'), examples = ui.get('#guidance-examples');
    assert.equal(disclosure.open, false);
    assert.equal(examples.children.length, 3);
    assert.ok(examples.textContent.includes('Recorded permission decision request: deny'));
    assert.ok(examples.textContent.includes('denied-by-rules'));
    assert.ok(examples.textContent.includes('<script>deny()</script> 日本語 🧪'));
    assert.equal(walk(examples).some(node => ['script', 'img', 'b'].includes(node.tagName)), false);
    disclosure.open = true;
    const body = examples.querySelector('details'); body.open = true;
    const button = examples.querySelector('button'); button.focus();
    const text = examples.textContent;
    ui.get('#glossary-panel').scrollTop = 71; ui.document.scrollingElement.scrollTop = 333;
    ui.render([...entries, { ...entries[0], id: 'later', evidence: entries[0].evidence.replace('lesson-skill', 'later') }]);
    filterMode(ui, 'tools'); ui.get('#event-order').value = 'chronological'; ui.get('#event-order').dispatch('change');
    assert.equal(examples.textContent, text); assert.equal(disclosure.open, true); assert.equal(body.open, true);
    assert.equal(examples.querySelector('button'), button); assert.equal(ui.document.activeElement, button);
    assert.equal(ui.get('#glossary-panel').scrollTop, 71); assert.equal(ui.document.scrollingElement.scrollTop, 333);
    button.dispatch('click');
    assert.equal(ui.get('#glossary-panel').open, false);
    assert.equal(ui.get('#activity-filter').value, 'everything'); assert.equal(ui.get('#event-order').value, 'chronological');
    const row = ui.get('#timeline').children[0];
    assert.equal(ui.document.activeElement, row.firstElementChild.firstElementChild);
    assert.equal(byClass(row, 'recorded-evidence').open, true); assert.equal(ui.get('#follow').checked, false);
  }
});

test('guidance comparison invalidates changed supporting evidence without replacing the frozen lesson or reviving links', async () => {
  const records = [
    { id: 'start', type: 'hook.start', timestamp: '', data: { hookInvocationId: 'pipeline', hookType: 'preToolUse' } },
    { id: 'end', type: 'hook.end', timestamp: '', data: { hookInvocationId: 'pipeline', hookType: 'preToolUse', success: true, output: { permissionDecision: 'deny' } } },
  ];
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => records }); await trace.ready;
  const entries = trace.snapshot().entries; trace.close();
  for (const replacement of [null, { ...entries[1], evidence: '{}' }, { ...entries[1], agentId: 'another' }]) {
    const ui = fixture(appSource); ui.render(entries);
    const opener = byClass(ui.get('#timeline'), 'glossary-term'); reveal(opener); opener.dispatch('click');
    const card = ui.get('#guidance-examples').children[1];
    assert.ok(card, 'A hook lesson attaches to retained pipeline evidence.');
    const button = card.querySelector('button'), body = card.querySelector('pre');
    const original = body.textContent; button.focus(); ui.document.scrollingElement.scrollTop = 333;
    ui.render(replacement ? [entries[0], replacement] : [entries[0]]);
    assert.match(card.textContent, /no longer available|evidence changed/i);
    assert.equal(body.textContent, original); assert.equal(ui.document.activeElement, button);
    button.dispatch('click');
    assert.equal(ui.get('#glossary-panel').open, true); assert.equal(ui.document.scrollingElement.scrollTop, 333);
    ui.render(entries); button.dispatch('click'); assert.equal(ui.get('#glossary-panel').open, true);
    ui.get('#glossary-concept').dispatch('change');
    ui.get('#guidance-examples').children[1].querySelector('button').dispatch('click');
    assert.equal(ui.get('#glossary-panel').open, false, 'Explicit reselection can use current evidence.');
  }
});

test('static guidance comparisons remain authored illustrations until the user explicitly selects again', () => {
  const ui = fixture(appSource); ui.render([]); ui.get('#glossary-button').dispatch('click');
  const examples = ui.get('#guidance-examples');
  assert.equal(examples.children.length, 3);
  for (const card of examples.children) { assert.match(card.textContent, /Static example.*not from this chat/); assert.equal(card.querySelector('button'), null); }
  const original = examples.textContent;
  ui.render([{ id: 'new-skill', type: 'skill.invoked', timestamp: '', agentId: '', evidence: '{}' }]);
  assert.equal(examples.textContent, original);
  ui.get('#glossary-concept').value = 'skill'; ui.get('#glossary-concept').dispatch('change');
  assert.match(examples.children[0].textContent, /Current chat example/);
});

test('glossary dismissal uses the visible footer fallback when its event is filtered or collapsed', () => {
  for (const hide of ['filter', 'collapse']) {
    const ui = fixture(appSource); ui.render([start, end]);
    const opener = byClass(ui.get('#timeline'), 'glossary-term'); reveal(opener); opener.dispatch('click');
    if (hide === 'filter') filterMode(ui, 'automation');
    else opener.closest('details').open = false;
    ui.get('#glossary-panel').dispatch('cancel');
    assert.equal(ui.document.activeElement, ui.get('#glossary-button'));
    assert.equal(ui.get('#follow').checked, false);
  }
});

test('the dialog controller keeps the active panel and one focus return when another opener is requested', () => {
  const ui = fixture(appSource);
  const other = ui.document.createElement('dialog'); other.id = 'other-panel'; other.className = 'footer-panel';
  const close = ui.document.createElement('button'); close.dataset.closePanel = ''; other.append(close); ui.document.body.append(other);
  const otherButton = ui.document.createElement('button'); otherButton.dataset.panel = 'other-panel'; ui.document.body.append(otherButton);
  const second = ui.document.createElement('dialog'); second.id = 'second-panel'; second.className = 'footer-panel';
  second.append(ui.document.createElement('button'));
  // Separate fixture controller: no app listeners are invoked in this lifecycle test.
  const isolated = ui.document.createElement('body'); isolated.append(otherButton, other, second);
  const isolatedDocument = { getElementById: id => id === 'other-panel' ? other : second,
    querySelectorAll: selector => isolated.querySelectorAll(selector) };
  ui.document.body.append(isolated);
  let inspected = 0;
  const control = footer.initPanels({ document: isolatedDocument, onInspect: () => inspected++ });
  otherButton.dispatch('click');
  assert.equal(other.open, true); assert.equal(inspected, 1);
  assert.equal(control.openPanel('second-panel', ui.get('#glossary-button')), false);
  assert.equal(other.open, true); assert.equal(second.open, false); assert.equal(inspected, 1);
  close.dispatch('click');
  assert.equal(other.open, false); assert.equal(ui.document.activeElement, otherButton);
  assert.equal(other.listeners.get('close').length, 1);
  assert.equal(control.openPanel('second-panel', ui.get('#glossary-button')), true);
  control.closePanel('second-panel', { restoreFocus: false });
  otherButton.focus(); second.dispatch('close');
  assert.equal(ui.document.activeElement, otherButton, 'A later close event cannot overwrite explicit navigation focus.');
});

async function skillFixture(content, extra = {}) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => [{
    id: 'skill', type: 'skill.invoked', timestamp: '2026-11-20T12:00:00Z',
    data: { name: 'Literal <skill> 🧪', path: '', trigger: 'context-load', content, ...extra },
  }] });
  await trace.ready;
  const entry = trace.snapshot().entries[0];
  trace.close();
  return entry;
}

const instructionInventory = (content = 'Current <script>🧪</script>', extra = {}) => ({ schemaVersion: 1, scope: 'main-session', capturedAt: '2026-11-20T12:10:00Z',
  sources: { status: 'ready', omitted: 0, invalid: 0, clipped: 0, items: [{ id: 'file', label: 'Literal <file>', sourcePath: 'nested AGENTS.md',
    type: 'nested-agents', location: 'working-directory', applyTo: null, defaultDisabled: true, content, contentStatus: 'complete', identityValid: true }], ...extra } });

test('instruction view refreshes only on request and preserves the inspected capture when current sources change', async () => {
  let calls = 0, current = instructionInventory();
  const ui = fixture(appSource, undefined, undefined, async () => { calls++; return current; });
  ui.render([await skillFixture('Old loaded body')]);
  ui.get('#instruction-sources').open = true; ui.get('#instruction-sources').dispatch('toggle');
  assert.equal(calls, 0); assert.equal(ui.get('#follow').checked, false);
  assert.match(ui.get('#instruction-status').textContent, /unknown until.*request/i);
  await ui.refreshInstructions();
  assert.equal(calls, 1);
  const button = walk(ui.get('#instruction-current')).find(node => node.tagName === 'button');
  assert.ok(button, 'Current source has a captured snapshot inspection control.'); button.dispatch('click');
  assert.equal(ui.get('#instruction-body').textContent, current.sources.items[0].content);
  assert.match(ui.get('#instruction-detail').textContent, /starts disabled.*current enabled state unknown/i);
  assert.match(ui.get('#instruction-detail').textContent, /scope unknown|applicability.*unknown/i);
  assert.match(ui.get('#instruction-detail').textContent, /Discovery\/index/);
  const body = ui.get('#instruction-body'); body.scrollTop = 42; body.focus();
  current = instructionInventory('Changed current body'); await ui.refreshInstructions();
  assert.equal(body.textContent, 'Current <script>🧪</script>'); assert.equal(body.scrollTop, 42);
  assert.equal(ui.document.activeElement, body); assert.match(ui.get('#instruction-selection-status').textContent, /earlier snapshot/i);
  walk(ui.get('#instruction-current')).find(node => node.tagName === 'button').dispatch('click');
  assert.equal(body.textContent, 'Changed current body');
  assert.equal(walk(ui.get('#instruction-sources')).some(node => ['script', 'a', 'img'].includes(node.tagName)), false);
  ui.closeInstructions();
});

test('skill preview opens historical instruction inspection and exact original evidence without a host refresh', async () => {
  const entry = await skillFixture('Exact historical <body> 🧪', { source: 'sdk' });
  const ui = fixture(appSource); ui.render([entry]);
  const open = walk(ui.get('#timeline')).find(node => node.tagName === 'button' && node.textContent === 'Inspect instruction sources');
  assert.ok(open, 'Skill preview connects to instruction source inspection.'); open.dispatch('click');
  assert.equal(ui.get('#statistics-panel').open, true); assert.equal(ui.get('#instruction-sources').open, true);
  assert.equal(ui.get('#instruction-body').textContent, 'Exact historical <body> 🧪');
  assert.match(ui.get('#instruction-detail').textContent, /2026-11-20T12:00:00Z/);
  assert.equal(ui.get('#follow').checked, false);
  ui.get('#instruction-original').dispatch('click');
  assert.equal(ui.get('#statistics-panel').open, false); assert.equal(ui.get('#event-order').value, 'chronological');
  assert.equal(byClass(ui.get('#timeline').firstElementChild, 'recorded-evidence').open, true);
  ui.closeInstructions();
});

test('full instruction inspector shows a long retained skill body without the timeline preview expansion instruction', async () => {
  const content = 'Exact historical <body> 🧪\n'.repeat(40);
  assert.ok(content.length > 600);
  const entry = await skillFixture(content, { source: 'sdk' });
  const ui = fixture(appSource); ui.render([entry]);
  const preview = byClass(ui.get('#timeline').firstElementChild, 'skill-instructions');
  assert.match(preview.textContent, /Preview shortened\. Expand Exact retained instructions/);
  walk(preview).find(node => node.tagName === 'button' && node.textContent === 'Inspect instruction sources').dispatch('click');
  assert.equal(ui.get('#instruction-body').textContent, content);
  assert.equal(ui.get('#instruction-body').hidden, false);
  assert.match(ui.get('#instruction-detail').textContent, /Complete instruction body retained/);
  assert.doesNotMatch(ui.get('#instruction-detail').textContent, /Preview shortened|Expand Exact retained instructions/);
  ui.closeInstructions();
});

test('full instruction inspector preserves empty, missing and shortened-event body explanations', async () => {
  const complete = await skillFixture('Original body');
  for (const [entry, note] of [
    [await skillFixture(''), /recorded an empty instruction body/],
    [await skillFixture(undefined), /host did not record a text instruction body/],
    [{ ...complete, truncated: true }, /shortened the event evidence.*cannot recover the complete instruction body/],
  ]) {
    const ui = fixture(appSource); ui.render([entry]);
    walk(ui.get('#instruction-loads')).find(node => node.tagName === 'button').dispatch('click');
    assert.match(ui.get('#instruction-detail').textContent, note);
    assert.equal(ui.get('#instruction-body').textContent, '');
    ui.closeInstructions();
  }
});

test('instruction skill links expire on changed evidence and eviction without moving reading position', async () => {
  const entry = await skillFixture('Frozen original body', { source: 'sdk' });
  const ui = fixture(appSource); ui.render([entry]);
  ui.get('#statistics-button').dispatch('click'); ui.get('#instruction-sources').open = true;
  const button = walk(ui.get('#instruction-loads')).find(node => node.tagName === 'button');
  assert.ok(button, 'Retained skills are available without a current catalog.'); button.dispatch('click');
  const body = ui.get('#instruction-body'); body.focus(); body.scrollTop = 33;
  const changed = await skillFixture('Changed evidence body', { source: 'sdk' });
  ui.render([changed]);
  assert.equal(body.textContent, 'Frozen original body'); assert.equal(body.scrollTop, 33); assert.equal(ui.document.activeElement, body);
  assert.match(ui.get('#instruction-selection-status').textContent, /no longer retained|evidence changed/i);
  assert.equal(ui.get('#instruction-original').disabled, true);
  ui.get('#instruction-original').dispatch('click'); assert.equal(ui.get('#statistics-panel').open, true);
  ui.render([], { omitted: 1 });
  assert.match(ui.get('#instruction-loads').textContent, /No retained skill loads/);
  assert.equal(ui.get('#instruction-body').textContent, 'Frozen original body');
  ui.closeInstructions();
});

test('instruction source groups preserve open disclosures and recover focus when a retained load disappears', async () => {
  const entry = await skillFixture('Original body', { source: 'sdk' });
  const ui = fixture(appSource); ui.render([entry]);
  const details = walk(ui.get('#instruction-loads')).find(node => node.tagName === 'details');
  assert.ok(details, 'Skill identity has a repeated-load disclosure.'); details.open = true;
  const button = walk(details).find(node => node.tagName === 'button'); button.focus();
  ui.get('#statistics-panel').scrollTop = 80;
  ui.render([entry, { ...start, id: 'other' }]);
  assert.equal(details.open, true); assert.equal(ui.document.activeElement, button); assert.equal(ui.get('#statistics-panel').scrollTop, 80);
  ui.render([]);
  assert.equal(ui.document.activeElement, ui.get('#instruction-loads')); assert.equal(ui.get('#follow').checked, false);
  ui.closeInstructions();
});

test('instruction refresh races, rejected loads and close cannot replace the latest inspection', async () => {
  const pending = []; const ui = fixture(appSource, undefined, undefined, signal => new Promise(resolve => pending.push({ signal, resolve })));
  const first = ui.refreshInstructions(), second = ui.refreshInstructions();
  assert.equal(pending[0].signal.aborted, true); assert.match(ui.get('#instruction-status').textContent, /Reading/);
  pending[1].resolve(instructionInventory('Newest')); await second;
  pending[0].resolve(instructionInventory('Stale')); await first;
  walk(ui.get('#instruction-current')).find(node => node.tagName === 'button').dispatch('click');
  assert.equal(ui.get('#instruction-body').textContent, 'Newest');
  const malformed = ui.refreshInstructions(); pending[2].resolve({ schemaVersion: 1 }); await malformed;
  assert.match(ui.get('#instruction-status').textContent, /Refresh unavailable/); assert.equal(ui.get('#instruction-body').textContent, 'Newest');
  const last = ui.refreshInstructions(); ui.closeInstructions(); assert.equal(pending[3].signal.aborted, true);
  pending[3].resolve(instructionInventory('After close')); await last;
  assert.equal(ui.get('#instruction-body').textContent, 'Newest');
});

test('empty and unsupported source states retain recorded skill evidence with explicit incompleteness', async () => {
  for (const state of ['ready', 'unsupported', 'timeout', 'malformed', 'session-mismatch']) {
    const ui = fixture(appSource, undefined, undefined, async () => instructionInventory('', { status: state, items: [] }));
    ui.render([await skillFixture(undefined)]); await ui.refreshInstructions();
    assert.match(ui.get('#instruction-status').textContent, new RegExp(state));
    assert.match(ui.get('#instruction-current').textContent, state === 'ready' ? /No sources reported.*does not mean/i : /No current source snapshot/i);
    assert.ok(walk(ui.get('#instruction-loads')).some(node => node.tagName === 'button'));
    assert.match(ui.get('#instruction-scope').textContent, /empty source list can omit instructions/i);
    ui.closeInstructions();
  }
});

test('instruction inspection labels invalid load timestamps and malformed source metadata as unknown', async () => {
  const entry = await skillFixture('Exact body', { path: {}, source: [] });
  entry.timestamp = 'not-a-date'; entry.evidence = JSON.stringify({ ...JSON.parse(entry.evidence), timestamp: entry.timestamp });
  const ui = fixture(appSource); ui.render([entry]);
  const button = walk(ui.get('#instruction-loads')).find(node => node.tagName === 'button');
  assert.match(button.textContent, /time unknown/); button.dispatch('click');
  assert.match(ui.get('#instruction-detail').textContent, /Recorded skill load: time unknown/);
  assert.match(ui.get('#instruction-detail').textContent, /Recorded source: unknown/);
  assert.match(ui.get('#instruction-detail').textContent, /Recorded path: unknown/);
  ui.closeInstructions();
});

test('skill rows disclose bounded literal instructions and exact full text without interpreting markup', async () => {
  const content = '# Instructions 🧪\n\n<script>literal</script>\n```sh\n  keep spacing\n```\n' + '日本語 '.repeat(500);
  const entry = await skillFixture(content, { arguments: 'Exact <input> 🧪' });
  const ui = fixture(appSource);
  ui.render([entry, { ...start, id: 'other' }]);
  const row = ui.get('#timeline').firstElementChild;
  const instructions = byClass(row, 'skill-instructions');
  assert.ok(instructions, 'A skill exposes its supplied instructions inside its event details.');
  const full = byClass(instructions, 'skill-full');
  const preview = byClass(instructions, 'skill-preview');
  assert.ok(preview.textContent.length <= 600);
  assert.ok(content.startsWith(preview.textContent));
  assert.match(instructions.textContent, /Preview shortened/);
  const body = walk(full).find(node => node.tagName === 'pre');
  assert.equal(body.textContent, content);
  assert.equal(body.tabIndex, 0);
  assert.equal(body.attributes['aria-label'], 'Exact retained skill instructions');
  assert.equal(byClass(instructions, 'skill-arguments').children.find(node => node.tagName === 'pre').textContent, 'Exact <input> 🧪');
  assert.match(instructions.textContent, /Literal <skill> 🧪/);
  assert.match(instructions.textContent, /context-load/);
  assert.equal(walk(instructions).filter(node => ['script', 'a', 'code', 'img'].includes(node.tagName)).length, 0);
  assert.equal(byClass(ui.get('#timeline').children[1], 'skill-instructions'), undefined);
  assert.deepEqual(visibleEvidence(ui), [entry.evidence, JSON.stringify({ id: start.id })]);
});

test('skill disclosures preserve full text, expansion, focus and scrolling across history, views and filters', async () => {
  const entry = await skillFixture('Instructions 🧪\n'.repeat(200));
  const ui = fixture(appSource);
  ui.render([entry], { history: 'loading' });
  const row = ui.get('#timeline').firstElementChild;
  const full = byClass(row, 'skill-full');
  assert.ok(full, 'Exact retained content has a disclosure.');
  row.firstElementChild.open = true;
  full.open = true;
  const body = walk(full).find(node => node.tagName === 'pre');
  body.scrollTop = 90;
  body.focus();
  ui.get('#follow').checked = false;
  ui.document.scrollingElement.scrollTop = 250;
  const earlier = { id: 'prompt', type: 'user.message', category: 'chat', agentId: '',
    delivery: 'idle', timestamp: '2026-11-20T11:59:59Z', evidence: '{}', explanation: 'Input' };
  ui.render([earlier, entry]);
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode;
    ui.get('#event-order').dispatch('change');
    assert.equal(ui.document.activeElement, body);
    assert.equal(full.open, true);
    assert.equal(body.scrollTop, 90);
    assert.equal(ui.document.scrollingElement.scrollTop, 250);
    for (const filter of ['automation', 'tools', 'problems', 'everything']) {
      filterMode(ui, filter);
      const expected = [earlier, entry].filter(record => presentation.matchesFilter(record, filter));
      assert.deepEqual(visibleEvidence(ui), expected.map(record => record.evidence));
    }
    body.focus();
  }
  ui.get('#event-target').value = 'skill'; ui.get('#event-target').dispatch('change');
  ui.get('#jump-event').dispatch('click');
  assert.equal(ui.get('#event-order').value, 'chronological');
  assert.equal(ui.get('#follow').checked, false);
  assert.equal(byClass(row, 'recorded-evidence').open, true);
  assert.equal(full.open, true);
  body.focus();
  ui.render([earlier], { omitted: 1 });
  assert.equal(row.isConnected, false);
  assert.equal(ui.document.activeElement.isConnected, true);
  assert.equal(ui.get('#jump-event').disabled, true);
  assert.match(ui.get('#navigation-status').textContent, /No retained skill load/);
});

test('skill body changes from available to unavailable clear stale text and safely move focused content', async () => {
  const entry = await skillFixture('Original exact instructions');
  const ui = fixture(appSource);
  ui.render([entry]);
  const row = ui.get('#timeline').firstElementChild;
  const full = byClass(row, 'skill-full');
  assert.ok(full, 'Exact retained content has a disclosure.');
  row.firstElementChild.open = true;
  full.open = true;
  const body = walk(full).find(node => node.tagName === 'pre');
  body.focus();
  ui.render([{ ...entry, truncated: true }]);
  assert.equal(body.textContent, '');
  assert.equal(full.hidden, true);
  assert.ok(ui.document.activeElement.isConnected);
  assert.notEqual(ui.document.activeElement, body);
  assert.match(byClass(row, 'skill-instructions').textContent, /shortened.*cannot recover/i);
  const empty = await skillFixture('');
  ui.render([empty]);
  assert.match(byClass(row, 'skill-instructions').textContent, /recorded.*empty/i);
  assert.equal(byClass(row, 'skill-arguments').hidden, true);
});

async function compactionFixture(data = {}, startOnly = false) {
  const raw = [
    { id: 'compact-start', type: 'session.compaction_start', timestamp: '2026-11-20T12:00:00Z', data: { compactionAttemptId: 'attempt' } },
    { id: 'compact-end', type: 'session.compaction_complete', timestamp: '2026-11-20T12:00:01Z', data: {
      compactionAttemptId: 'attempt', success: true, outcome: 'applied', summaryContent: 'Exact <summary> 🧪',
      tokenAccountingBasis: 'local_full_context_estimate', preCompactionTokens: 100, postCompactionTokens: 40,
      tokensRemoved: 60, messagesRemoved: 2, ...data,
    } },
  ];
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => startOnly ? raw.slice(0, 1) : raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}

test('compaction details expose literal summary with source, units and explicitly limited meaning', async () => {
  const content = '# Café 🧪\r\n<script>literal only</script>\n' + '日'.repeat(8000);
  const entries = await compactionFixture({ summaryContent: content, outcome: 'future <outcome>' });
  const ui = fixture(appSource); ui.render(entries);
  const section = byClass(ui.get('#timeline').firstElementChild, 'compaction');
  assert.ok(section, 'A compaction event offers an optional summary and limits disclosure.');
  assert.equal(section.tagName, 'details'); assert.equal(section.open, false);
  const summary = byClass(section, 'compaction-summary');
  assert.equal(summary.textContent, content); assert.equal(summary.tabIndex, 0);
  assert.equal(summary.attributes['aria-label'], 'Exact retained compaction summary');
  assert.match(section.textContent, /Main chat.*attempt/s);
  assert.match(section.textContent, /Reported success.*future <outcome>/s);
  assert.match(section.textContent, /100 → 40 context-token estimates.*decrease of 60/s);
  assert.match(section.textContent, /local_full_context_estimate.*messages removed: 2/s);
  assert.match(section.textContent, /UTF-16 code units.*not all context.*future turns retain/s);
  assert.equal(walk(section).some(node => ['script', 'a', 'code', 'img'].includes(node.tagName)), false);
  assert.equal(section.querySelectorAll('button').length, 2);
  section.open = true; section.dispatch('toggle'); assert.equal(ui.get('#follow').checked, false);
});

test('compaction completion updates the same optional disclosure while keeping focus and reading position', async () => {
  const entries = await compactionFixture({ summaryContent: '日'.repeat(8000) });
  const ui = fixture(appSource); ui.render(entries.slice(0, 1), { history: 'loading' });
  const row = ui.get('#timeline').firstElementChild, section = byClass(row, 'compaction');
  assert.ok(section, 'A start-only attempt explains its missing completion.');
  assert.match(section.textContent, /Completion not retained.*does not mean.*running/s);
  reveal(section); section.open = true; section.dispatch('toggle'); section.firstElementChild.focus();
  ui.document.scrollingElement.scrollTop = 235;
  ui.render(entries);
  assert.equal(byClass(row, 'compaction'), section); assert.equal(section.open, true);
  assert.equal(ui.document.activeElement, section.firstElementChild); assert.equal(ui.document.scrollingElement.scrollTop, 235);
  const body = byClass(section, 'compaction-summary'); body.scrollTop = 95; body.focus();
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
    assert.equal(ui.document.activeElement, body); assert.equal(section.open, true); assert.equal(body.scrollTop, 95);
    assert.equal(ui.document.scrollingElement.scrollTop, 235); assert.equal(ui.get('#follow').checked, false);
    filterMode(ui, 'tools'); assert.equal(ui.document.activeElement, ui.get('#activity-filter'));
    filterMode(ui, 'everything'); body.focus();
  }
  ui.render(entries.slice(1), { omitted: 1 });
  assert.equal(row.isConnected, false); assert.equal(ui.document.activeElement.isConnected, true);
  assert.match(byClass(ui.get('#timeline'), 'compaction').textContent, /Start not retained/);
});

test('compaction original links preserve chronology and reject expired or changed source identities', async () => {
  const entries = await compactionFixture();
  const ui = fixture(appSource); ui.render(entries);
  const section = byClass(ui.get('#timeline').firstElementChild, 'compaction');
  assert.ok(section, 'Original evidence is reachable from the disclosure.');
  const link = section.querySelectorAll('button')[1];
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
    filterMode(ui, 'tools'); link.dispatch('click');
    assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#activity-filter').value, 'everything');
    assert.equal(ui.get('#follow').checked, false);
    assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
    const target = ui.get('#timeline').children[1];
    assert.equal(byClass(target, 'recorded-evidence').open, true); assert.equal(ui.document.activeElement, target.firstElementChild.firstElementChild);
  }
  ui.render([entries[0], { ...entries[1], agentId: 'changed' }]);
  ui.document.scrollingElement.scrollTop = 333; ui.get('#follow').checked = true; link.dispatch('click');
  assert.match(ui.get('#navigation-status').textContent, /no longer retained/);
  assert.equal(ui.document.scrollingElement.scrollTop, 333); assert.equal(ui.get('#follow').checked, true);
  ui.render(entries.slice(0, 1), { omitted: 1 }); link.dispatch('click');
  assert.equal(ui.document.scrollingElement.scrollTop, 333);
});

test('unavailable compaction content clears stale text and preserves explicit empty, clipped and metric states', async () => {
  const entries = await compactionFixture(); const ui = fixture(appSource); ui.render(entries);
  const section = byClass(ui.get('#timeline').children[1], 'compaction');
  assert.ok(section, 'Completion disclosure remains available when details are missing.');
  const body = byClass(section, 'compaction-summary'); reveal(body); body.focus();
  ui.render([entries[0], { ...entries[1], truncated: true }]);
  assert.equal(body.textContent, ''); assert.equal(body.hidden, true);
  assert.notEqual(ui.document.activeElement, body); assert.equal(ui.document.activeElement.isConnected, true);
  assert.match(section.textContent, /clipped.*12,000 UTF-16.*cannot recover/s);
  for (const summaryContent of ['', undefined]) {
    ui.render(await compactionFixture({ summaryContent, tokenAccountingBasis: 'future_basis', success: false }));
    assert.equal(body.hidden, true); assert.equal(body.textContent, '');
    assert.match(section.textContent, summaryContent === '' ? /recorded an empty summary/ : /did not record a text summary/);
    assert.match(section.textContent, /Reported failure.*Context comparison unavailable.*future_basis/s);
    assert.doesNotMatch(section.textContent, /100 → 40/);
  }
});

test('conflicting compaction boundaries keep only local evidence links and changed event types clear old summaries', async () => {
  const entries = await compactionFixture();
  const duplicate = { ...entries[0], id: 'duplicate', evidence: JSON.stringify({ ...JSON.parse(entries[0].evidence), id: 'duplicate' }) };
  const ui = fixture(appSource); ui.render([entries[0], duplicate, entries[1]]);
  for (const row of ui.get('#timeline').children) {
    const section = byClass(row, 'compaction'); assert.ok(section);
    assert.match(section.textContent, /Duplicate boundaries/);
    assert.equal(section.querySelectorAll('button').length, 1, 'An ambiguous group must not duplicate all other boundaries in every row.');
    assert.equal(byClass(section, 'compaction-summary').hidden, true);
  }
  ui.render(entries);
  const row = ui.get('#timeline').firstElementChild, section = byClass(row, 'compaction');
  assert.equal(byClass(section, 'compaction-summary').hidden, false);
  ui.render([{ ...entries[0], type: 'session.info' }]);
  assert.equal(byClass(row, 'compaction'), undefined);
});

async function hookFixture() {
  const raw = [
    ['first-start', 'hook.start', 'first', 'postToolUse'],
    ['second-start', 'hook.start', 'second', 'postToolUse'],
    ['first-end', 'hook.end', 'first', 'postToolUse'],
    ['gap', 'assistant.message'],
    ['second-end', 'hook.end', 'second', 'postToolUse'],
  ].map(([id, type, hookInvocationId, hookType]) => ({ id, type, timestamp: '2026-11-20T12:00:00Z',
    data: type === 'assistant.message' ? { content: 'intervening event' }
      : { hookInvocationId, hookType, ...(type === 'hook.end' ? { success: false,
        output: { additionalContext: '<img> 日本語😀 exact context' }, error: { message: 'Literal <script> failure' } } : {}) } }));
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready;
  const entries = trace.snapshot().entries;
  trace.close();
  return entries;
}
const originalEvidence = visibleEvidence;

test('hook groups expose individual pipelines while original boundary evidence stays in event order', async () => {
  const entries = await hookFixture();
  const ui = fixture(appSource);
  ui.render(entries);
  const group = ui.get('#timeline').firstElementChild;
  assert.ok(byClass(group, 'hook-invocations'), 'A hook group exposes individual pipeline summaries.');
  assert.equal(byClass(group, 'hook-invocations').children.length, 2);
  assert.match(group.textContent, /successful result/);
  assert.match(group.textContent, /Reported pipeline failure/);
  assert.match(group.textContent, /<img> 日本語😀 exact context/);
  assert.equal(walk(group).filter(node => node.tagName === 'img' || node.tagName === 'script').length, 0);
  assert.deepEqual(originalEvidence(ui), entries.map(entry => entry.evidence));
  assert.equal(ui.get('#stat-counts').children.find(node => node.dataset.metric === 'hooks').children[1].textContent, '2');
  assert.match(ui.get('#stat-scope').textContent, /pipeline.*scripts/);
  const second = byClass(group, 'hook-invocations').children[1];
  const endLink = walk(second).find(node => node.tagName === 'button' && /End/.test(node.textContent));
  endLink.dispatch('click');
  assert.equal(ui.get('#event-order').value, 'chronological');
  assert.equal(ui.document.activeElement, ui.get('#timeline').children[4].firstElementChild.firstElementChild);
  assert.equal(byClass(ui.get('#timeline').children[4], 'recorded-evidence').open, true);
  assert.deepEqual(originalEvidence(ui), entries.map(entry => entry.evidence));
});

test('hook explanations survive view filters, retained-history reconciliation and focused disclosure updates', async () => {
  const entries = await hookFixture();
  const ui = fixture(appSource);
  ui.render(entries.slice(0, 2), { history: 'loading' });
  const group = ui.get('#timeline').firstElementChild;
  const invocation = byClass(group, 'hook-invocations')?.firstElementChild?.firstElementChild;
  assert.ok(invocation, 'Individual invocation disclosure exists before its result arrives.');
  invocation.open = true;
  invocation.firstElementChild.focus();
  ui.document.scrollingElement.scrollTop = 250;
  ui.render(entries);
  assert.equal(ui.document.activeElement, invocation.firstElementChild);
  assert.equal(invocation.open, true);
  assert.equal(ui.document.scrollingElement.scrollTop, 250);
  assert.match(invocation.textContent, /Reported pipeline failure/);
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    filterMode(ui, 'everything');
    invocation.firstElementChild.focus();
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
    assert.equal(ui.document.activeElement, invocation.firstElementChild, 'The same invocation disclosure follows view changes.');
    assert.equal(invocation.open, true);
    for (const filter of ['everything', 'automation', 'problems', 'tools']) {
      filterMode(ui, filter);
      const expected = entries.filter(entry => presentation.matchesFilter(entry, filter));
      assert.deepEqual(originalEvidence(ui), expected.map(entry => entry.evidence));
      if (filter !== 'tools') assert.ok(visibleWalk(ui.get('#timeline')).some(node => node.className === 'hook-invocation'));
      assert.equal(ui.get('#stat-counts').children.find(node => node.dataset.metric === 'hooks').children[1].textContent, '2');
    }
  }
  filterMode(ui, 'everything');
  const retainedGroup = ui.get('#timeline').firstElementChild;
  const retainedInvocation = byClass(retainedGroup, 'hook-invocations').firstElementChild.firstElementChild;
  const staleStart = walk(retainedInvocation).find(node => node.tagName === 'button' && /Start/.test(node.textContent));
  staleStart.focus();
  ui.render(entries.slice(2), { omitted: 2 });
  assert.ok(ui.document.activeElement.isConnected);
  assert.notEqual(ui.document.activeElement, staleStart);
  assert.match(retainedInvocation.textContent, /Start boundary not retained/);
  ui.document.scrollingElement.scrollTop = 250;
  staleStart.dispatch('click');
  assert.match(ui.get('#navigation-status').textContent, /no longer retained/);
  assert.equal(ui.document.scrollingElement.scrollTop, 250);
});

test('history splits and merges migrate the expanded focused hook disclosure with its retained invocation', async () => {
  const entries = await hookFixture();
  const live = entries.filter(entry => entry.type !== 'assistant.message');
  const gap = entries.find(entry => entry.type === 'assistant.message');
  const ui = fixture(appSource);
  ui.render(live, { history: 'loading' });
  const selected = byClass(ui.get('#timeline').firstElementChild, 'hook-invocations').children[1].firstElementChild;
  selected.open = true;
  byClass(selected, 'hook-output').open = true;
  selected.firstElementChild.focus();
  ui.document.scrollingElement.scrollTop = 250;
  const split = [live[0], gap, ...live.slice(1)];
  for (const records of [split, live, split, split.slice(1)]) {
    ui.render(records);
    assert.equal(selected.isConnected, true, 'A surviving invocation moves to its new group instead of being destroyed.');
    assert.equal(selected.open, true);
    assert.equal(byClass(selected, 'hook-output').open, true);
    assert.equal(ui.document.activeElement, selected.firstElementChild);
    assert.equal(ui.document.scrollingElement.scrollTop, 250);
    assert.deepEqual(originalEvidence(ui), records.map(entry => entry.evidence));
    assert.equal(walk(ui.get('#timeline')).filter(node => node === selected).length, 1);
  }
  walk(selected).find(node => node.tagName === 'button' && /End evidence/.test(node.textContent)).dispatch('click');
  assert.equal(ui.get('#event-order').value, 'chronological');
  const target = ui.get('#timeline').children[3];
  assert.equal(ui.document.activeElement, target.firstElementChild.firstElementChild);
  assert.equal(byClass(target, 'recorded-evidence').open, true);
  assert.deepEqual(originalEvidence(ui), split.slice(1).map(entry => entry.evidence));
});

test('merging duplicate hook summaries preserves the focused copy and cannot transfer it to another source or reused identity', async () => {
  const entries = await hookFixture();
  const start = entries[0], end = entries[2], gap = entries[3];
  const ui = fixture(appSource);
  ui.render([start, gap, end]);
  const firstCopy = byClass(ui.get('#timeline').firstElementChild, 'hook-invocations').firstElementChild.firstElementChild;
  firstCopy.open = true;
  byClass(firstCopy, 'hook-output').open = true;
  const selected = byClass(ui.get('#timeline').children[2], 'hook-invocations').firstElementChild.firstElementChild;
  selected.firstElementChild.focus();
  ui.render([start, end]);
  assert.equal(selected.isConnected, true);
  assert.equal(selected.open, true);
  assert.equal(byClass(selected, 'hook-output').open, true);
  assert.equal(ui.document.activeElement, selected.firstElementChild);
  assert.equal(walk(ui.get('#timeline')).filter(node => node.className === 'hook-invocation').length, 1);
  ui.render([start, gap, end]);
  assert.equal(selected.isConnected, true);
  assert.equal(selected.open, true);
  assert.equal(ui.document.activeElement, selected.firstElementChild);
  ui.render([start, gap, { ...end, agentId: 'different-agent' }]);
  const child = byClass(ui.get('#timeline').children[2], 'hook-invocations').firstElementChild.firstElementChild;
  assert.notEqual(child, selected);
  assert.equal(child.open, false);
  assert.match(child.textContent, /Agent different-agent/);
  ui.render([{ ...start, id: 'new-start' }, { ...end, id: 'new-end' }]);
  assert.equal(selected.isConnected, false, 'A reused identity without retained common boundaries is a new disclosure.');
  assert.equal(byClass(ui.get('#timeline').firstElementChild, 'hook-invocations').firstElementChild.firstElementChild.open, false);
  assert.ok(ui.document.activeElement.isConnected);
});

async function actionFixture() {
  const raw = [
    { id: 'proposal', type: 'assistant.message', data: { toolRequests: [{ toolCallId: 'call', name: 'powershell', arguments: {} }] } },
    { id: 'invocation', type: 'tool.execution_start', data: { toolCallId: 'call', toolName: 'powershell' } },
    { id: 'permission', type: 'permission.requested', data: { requestId: 'request', permissionRequest: { toolCallId: 'call' } } },
    { id: 'decision', type: 'permission.completed', data: { requestId: 'request', toolCallId: 'call', result: { kind: 'denied-interactively-by-user' } } },
    { id: 'result', type: 'tool.execution_complete', data: { toolCallId: 'call', success: false } },
  ].map(entry => ({ ...entry, timestamp: '2026-11-20T12:00:00Z' }));
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready;
  const entries = trace.snapshot().entries;
  trace.close();
  return entries;
}

async function provenanceFixture() {
  const raw = [
    { id: 'first', type: 'tool.execution_start', data: { toolCallId: 'first-call', toolName: 'first-alias',
      mcpServerName: 'first', mcpConfigServerName: 'first', mcpToolName: 'echo', mcpServerDisplayName: 'Shared <img> 日本語😀', mcpConfigSource: 'plugin' } },
    { id: 'second', type: 'tool.execution_start', data: { toolCallId: 'second-call', toolName: 'second-alias',
      mcpServerName: 'second', mcpConfigServerName: 'second', mcpToolName: 'echo', mcpServerDisplayName: 'Shared <img> 日本語😀' } },
    { id: 'first-result', type: 'tool.execution_complete', data: { toolCallId: 'first-call', success: false } },
    { id: 'second-result', type: 'tool.execution_complete', data: { toolCallId: 'second-call', success: true } },
  ].map(entry => ({ ...entry, timestamp: '2026-11-20T12:00:00Z' }));
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready;
  const entries = trace.snapshot().entries;
  trace.close();
  return entries;
}

async function operationFixture() {
  const raw = [
    { id: 'read', type: 'tool.execution_start', data: { toolCallId: 'read-call', toolName: 'view', arguments: { path: '日本語😀<img>.mjs' } } },
    { id: 'read-result', type: 'tool.execution_complete', data: { toolCallId: 'read-call', success: false } },
    { id: 'fetch', type: 'tool.execution_start', data: { toolCallId: 'fetch-call', toolName: 'web_fetch', arguments: { url: 'https://example.test' } } },
    { id: 'fetch-result', type: 'tool.execution_complete', data: { toolCallId: 'fetch-call', success: true } },
    { id: 'shell', type: 'tool.execution_start', data: { toolCallId: 'shell-call', toolName: 'powershell', arguments: { command: 'cat file; rm file', description: 'Read a file' } } },
    { id: 'shell-result', type: 'tool.execution_complete', data: { toolCallId: 'shell-call', success: false } },
    { id: 'service', type: 'tool.execution_start', data: { toolCallId: 'service-call', toolName: 'view', mcpToolName: 'delete', mcpServerName: 'local', mcpTransport: 'memory', arguments: { path: 'file' } } },
    { id: 'service-result', type: 'tool.execution_complete', data: { toolCallId: 'service-call', success: false } },
    { id: 'alias', type: 'tool.execution_start', data: { toolCallId: 'alias-call', toolName: 'custom_view', arguments: { path: 'file' } } },
    { id: 'alias-result', type: 'tool.execution_complete', data: { toolCallId: 'alias-call', success: false } },
  ].map(entry => ({ ...entry, timestamp: '2026-11-20T12:00:00Z' }));
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready;
  const entries = trace.snapshot().entries;
  trace.close();
  return entries;
}

test('requested categories and their limits remain reachable with unchanged evidence and totals in every view and filter', async () => {
  const entries = await operationFixture();
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource);
    ui.get('#event-order').value = mode;
    ui.render(entries);
    const counts = ui.get('#stat-counts').textContent;
    const labels = visibleWalk(ui.get('#timeline')).filter(node => node.className === 'operation-badge').map(node => node.textContent);
    for (const label of ['Requested: Read', 'Requested: Read · External access', 'Requested: Execute', 'Requested: External access', 'Requested: Unclassified']) {
      assert.ok(labels.includes(label), `${mode}: ${label}`);
    }
    const stages = walk(ui.get('#timeline')).filter(node => node.className === 'action-stages');
    assert.equal(stages.length, 5, 'Category explanation reuses the existing action-stage disclosure.');
    assert.ok(stages.every(node => /category limits/i.test(node.firstElementChild.textContent)));
    assert.ok(stages.every(node => /not approval or completed effects/.test(byClass(node, 'operation-limits').textContent)));
    assert.match(stages[2].textContent, /Shell text is opaque/);
    assert.match(stages[3].textContent, /local or in-process/);
    assert.match(stages[4].textContent, /unavailable/);
    assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
    assert.ok(walk(ui.get('#timeline')).every(node => !['img', 'script', 'a'].includes(node.tagName)));
    filterMode(ui, 'tools');
    assert.equal(ui.get('#stat-counts').textContent, counts);
    filterMode(ui, 'problems');
    const visibleStages = visibleWalk(ui.get('#timeline')).filter(node => node.className === 'action-stages');
    assert.equal(visibleStages.length, 4);
    assert.match(visibleStages[0].textContent, /recorded view arguments/);
    assert.ok(visibleWalk(ui.get('#timeline')).some(node => node.className === 'operation-badge' && node.textContent === 'Requested: Read'));
    const sourceLink = walk(visibleStages[0]).find(node => node.tagName === 'button' && /Tool invocation entered/.test(node.textContent));
    sourceLink.dispatch('click');
    assert.equal(ui.get('#activity-filter').value, 'everything');
    assert.equal(ui.get('#event-order').value, 'chronological');
    assert.equal(byClass(ui.get('#timeline').children[0], 'recorded-evidence').open, true);
    assert.equal(ui.document.activeElement, ui.get('#timeline').children[0].firstElementChild.firstElementChild);
    assert.equal(ui.get('#stat-counts').textContent, counts);
    filterMode(ui, 'automation');
    assert.equal(visibleWalk(ui.get('#timeline')).filter(node => node.className === 'operation-badge').length, 0);
    assert.equal(ui.get('#stat-counts').textContent, counts);
  }
});

test('category updates preserve focus and reading position, discard evicted bases and reject newly ambiguous calls', async () => {
  const entries = await operationFixture();
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource);
    ui.get('#event-order').value = mode;
    ui.render(entries.slice(0, 1));
    const stages = byClass(ui.get('#timeline'), 'action-stages');
    stages.open = true;
    const link = walk(stages).find(node => node.tagName === 'button');
    link.focus();
    ui.document.scrollingElement.scrollTop = 333;
    ui.render(entries.slice(0, 2));
    assert.equal(ui.document.activeElement, link);
    assert.equal(ui.document.scrollingElement.scrollTop, 333);
    assert.equal(stages.open, true);
    assert.equal(byClass(ui.get('#timeline'), 'operation-badge').textContent, 'Requested: Read');
    const raw = JSON.parse(entries[0].evidence);
    const ambiguous = { ...entries[0], id: 'duplicate', evidence: JSON.stringify({ ...raw, id: 'duplicate' }) };
    ui.render([entries[0], ambiguous, entries[1]]);
    assert.ok(walk(ui.get('#timeline')).filter(node => node.className === 'operation-badge')
      .every(node => node.textContent === 'Requested: Unclassified'));
    assert.ok(walk(ui.get('#timeline')).filter(node => node.className === 'node-title').every(node => !node.textContent.startsWith('View ')),
      'Ambiguous calls cannot retain a contradictory interpreted title.');
    ui.render(entries.slice(1, 2), { omitted: 1 });
    assert.equal(byClass(ui.get('#timeline'), 'operation-badge').textContent, 'Requested: Unclassified');
    assert.equal(byClass(ui.get('#timeline'), 'action-stages'), stages);
    assert.match(byClass(stages, 'operation-basis').textContent, /unavailable/);
    assert.ok(ui.document.activeElement.isConnected);
    assert.notEqual(ui.document.activeElement, link);
    assert.deepEqual(visibleEvidence(ui), [entries[1].evidence]);
  }
});

test('tool origins remain literal and distinguish identical provider names with exact evidence navigation in every view', async () => {
  const entries = await provenanceFixture();
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource);
    ui.get('#event-order').value = mode;
    ui.render(entries);
    const counts = ui.get('#stat-counts').textContent;
    const disclosures = walk(ui.get('#timeline')).filter(node => node.className === 'tool-provenance');
    assert.equal(disclosures.length, 2, 'One provenance disclosure per call is reachable in each view.');
    assert.match(disclosures[0].textContent, /Shared <img> 日本語😀/);
    assert.match(disclosures[0].textContent, /Configured server keyfirst/);
    assert.match(disclosures[1].textContent, /Configured server keysecond/);
    assert.match(disclosures[0].textContent, /MCP configuration sourceplugin/);
    assert.match(disclosures[0].textContent, /does not prove a network request/);
    assert.ok(walk(ui.get('#timeline')).every(node => node.tagName !== 'img' && node.tagName !== 'a'));
    const badges = walk(ui.get('#timeline')).filter(node => node.className === 'provenance-badge');
    assert.ok(badges.length >= 4);
    assert.ok(badges.every(badge => badge.textContent === 'Origin: MCP · Shared <img> 日本語😀'));
    disclosures[1].open = true;
    filterMode(ui, 'tools');
    const link = walk(disclosures[1]).find(node => node.tagName === 'button');
    link.focus();
    link.dispatch('click');
    assert.equal(ui.get('#event-order').value, 'chronological');
    assert.equal(ui.get('#activity-filter').value, 'everything');
    assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
    const sourceRow = ui.get('#timeline').children[1];
    assert.equal(ui.document.activeElement, sourceRow.firstElementChild.firstElementChild);
    assert.equal(byClass(sourceRow, 'recorded-evidence').open, true);
    assert.equal(ui.get('#follow').checked, false);
    assert.equal(ui.get('#stat-counts').textContent, counts);
    assert.equal(byClass(sourceRow, 'tool-provenance'), disclosures[1]);
    assert.equal(disclosures[1].open, true);
  }
});

test('provenance stays reachable for a filtered failed result and keeps its focus during live updates and retention', async () => {
  const entries = await provenanceFixture();
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource);
    ui.get('#event-order').value = mode;
    ui.render([entries[0]]);
    const disclosure = byClass(ui.get('#timeline'), 'tool-provenance');
    assert.ok(disclosure);
    disclosure.open = true;
    const link = walk(disclosure).find(node => node.tagName === 'button');
    link.focus();
    ui.document.scrollingElement.scrollTop = 333;
    ui.render(entries);
    assert.equal(ui.document.activeElement, link);
    assert.equal(ui.document.scrollingElement.scrollTop, 333);
    assert.equal(disclosure.open, true);
    filterMode(ui, 'problems');
    assert.ok(visibleWalk(ui.get('#timeline')).includes(disclosure), mode);
    link.dispatch('click');
    assert.equal(ui.get('#activity-filter').value, 'everything');
    assert.equal(byClass(ui.get('#timeline').children[0], 'recorded-evidence').open, true);
    link.focus();
    ui.render(entries.slice(1), { omitted: 1 });
    assert.ok(ui.document.activeElement.isConnected);
    assert.notEqual(ui.document.activeElement, link, 'A hidden source link must not keep focus after its start is evicted.');
    const resultRow = ui.get('#timeline').children[1];
    assert.equal(byClass(resultRow, 'provenance-badge').textContent, 'Origin: Unknown');
    assert.equal(byClass(resultRow, 'tool-provenance'), disclosure);
    assert.equal(disclosure.open, true);
    assert.equal(link.hidden, true);
  }
});

test('changed metadata updates retained provenance controls and canonical merges remove obsolete disclosures', async () => {
  const entries = await provenanceFixture(), ui = fixture(appSource);
  ui.get('#event-order').value = 'chronological';
  ui.render(entries);
  const disclosure = byClass(ui.get('#timeline'), 'tool-provenance');
  disclosure.open = true;
  const link = walk(disclosure).find(node => node.tagName === 'button');
  link.focus();
  const raw = JSON.parse(entries[0].evidence);
  const changed = { ...entries[0], evidence: JSON.stringify({ ...raw, data: { ...raw.data, mcpServerDisplayName: 'Updated provider' } }) };
  ui.render([changed, ...entries.slice(1)]);
  assert.equal(ui.document.activeElement, link);
  assert.match(disclosure.textContent, /Updated provider/);
  assert.doesNotMatch(disclosure.textContent, /Shared <img>/);
  const result = entries[2], resultRaw = JSON.parse(result.evidence);
  ui.render([entries[0], { ...result, toolCallId: 'other-call', evidence: JSON.stringify({ ...resultRaw, data: { ...resultRaw.data, toolCallId: 'other-call' } }) }]);
  const separate = walk(ui.get('#timeline')).filter(node => node.className === 'tool-provenance');
  assert.equal(separate.length, 2);
  separate[1].open = true;
  ui.render([entries[0], result]);
  const merged = walk(ui.get('#timeline')).filter(node => node.className === 'tool-provenance');
  assert.equal(merged.length, 1);
  assert.equal(merged[0].open, true);
  assert.deepEqual(visibleEvidence(ui), [entries[0].evidence, result.evidence]);
});

test('observed action stages navigate to exact unchanged original evidence from every view and filter', async () => {
  const entries = await actionFixture();
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource);
    ui.get('#event-order').value = mode;
    ui.render(entries);
    const counts = ui.get('#stat-counts').textContent;
    assert.equal(walk(ui.get('#timeline')).filter(node => node.className === 'action-stages').length, 1);
    const disclosure = byClass(ui.get('#timeline'), 'action-stages');
    assert.ok(disclosure, 'The current tool card exposes observed stages in each view.');
    disclosure.open = true;
    const stageButtons = walk(disclosure).filter(node => node.tagName === 'button');
    assert.equal(stageButtons.length, 5);
    assert.match(disclosure.textContent, /invocation entered/i);
    assert.match(disclosure.textContent, /Permission denied/);
    assert.match(disclosure.textContent, /source unknown/i);
    const requestButton = stageButtons[2];
    filterMode(ui, 'tools');
    requestButton.focus();
    requestButton.dispatch('click');
    assert.equal(ui.get('#event-order').value, 'chronological');
    assert.equal(ui.get('#activity-filter').value, 'everything');
    assert.equal(ui.get('#follow').checked, false);
    assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
    const row = ui.get('#timeline').children[2];
    assert.equal(ui.document.activeElement, row.firstElementChild.firstElementChild);
    assert.equal(byClass(row, 'recorded-evidence').open, true);
    assert.equal(ui.get('#stat-counts').textContent, counts);
    assert.equal(byClass(ui.get('#timeline'), 'action-stages'), disclosure, 'One disclosure moves with the existing card; no original rows are cloned.');
    assert.equal(disclosure.open, true);
  }
});

test('stage reconciliation preserves focused controls and falls back safely when evidence is evicted', async () => {
  const entries = await actionFixture(), ui = fixture(appSource);
  ui.render(entries.slice(0, 3));
  const disclosure = byClass(ui.get('#timeline'), 'action-stages');
  assert.ok(disclosure);
  disclosure.open = true;
  const requestButton = walk(disclosure).filter(node => node.tagName === 'button')[2];
  requestButton.focus();
  ui.document.scrollingElement.scrollTop = 333;
  ui.render(entries);
  assert.equal(ui.document.activeElement, requestButton);
  assert.equal(ui.document.scrollingElement.scrollTop, 333);
  assert.equal(disclosure.open, true);
  ui.render(entries.filter(entry => entry.id !== 'permission'), { omitted: 1 });
  assert.equal(requestButton.isConnected, false);
  assert.equal(ui.document.activeElement.isConnected, true);
  assert.equal(ui.document.scrollingElement.scrollTop, 333);
  assert.ok(walk(disclosure).every(node => node !== requestButton));
});

test('the stage disclosure stays reachable with a retained failed result under Problems in each view', async () => {
  const entries = await actionFixture();
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource);
    ui.get('#event-order').value = mode;
    ui.render(entries);
    const disclosure = byClass(ui.get('#timeline'), 'action-stages');
    filterMode(ui, 'problems');
    assert.ok(visibleWalk(ui.get('#timeline')).includes(disclosure), `Observed stages remain reachable in ${mode}.`);
    const decision = walk(disclosure).filter(node => node.tagName === 'button')[3];
    decision.dispatch('click');
    assert.equal(ui.get('#activity-filter').value, 'everything');
    assert.equal(ui.document.activeElement, ui.get('#timeline').children[3].firstElementChild.firstElementChild);
  }
});

test('canonical history merging tool identities removes an obsolete stage disclosure from original rows', async () => {
  const entries = await actionFixture(), ui = fixture(appSource);
  ui.get('#event-order').value = 'chronological';
  const result = entries.at(-1);
  const raw = JSON.parse(result.evidence);
  raw.data.toolCallId = 'other';
  ui.render([...entries.slice(0, -1), { ...result, toolCallId: 'other', evidence: JSON.stringify(raw) }]);
  const disclosures = walk(ui.get('#timeline')).filter(node => node.className === 'action-stages');
  assert.equal(disclosures.length, 2);
  disclosures[1].open = true;
  ui.render(entries);
  const retained = walk(ui.get('#timeline')).filter(node => node.className === 'action-stages');
  assert.equal(retained.length, 1, 'Merging existing call identities must not leave a second stage panel on the result row.');
  assert.equal(retained[0].open, true, 'The observed-stage disclosure stays open across a history merge.');
  assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
});

test('structured explanations and optional literal evidence update without replacing focused disclosures in every view', () => {
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource);
    ui.get('#event-order').value = mode;
    const make = success => ({ ...end, explanation: '<img> Authored definition 日本語😀', success,
      evidence: JSON.stringify({ id: end.id, type: end.type, timestamp: end.timestamp, data: { success } }) });
    const first = make(true);
    ui.render([first]);
    const row = walk(ui.get('#timeline')).find(node => node.className.split(' ').includes('step')
      && walk(node).some(child => child.tagName === 'pre' && child.textContent === first.evidence)
      && !node.className.includes('group') && !node.className.includes('chapter') && !node.className.includes('lane'));
    const details = row.firstElementChild;
    details.open = true;
    assert.ok(walk(row).some(node => node.textContent === 'Understand this step'));
    for (const heading of ['What happened', 'What the recorded result means', 'What remains unknown']) {
      assert.ok(walk(row).some(node => node.tagName === 'h4' && node.textContent === heading));
    }
    const general = byClass(row, 'general-definition');
    const evidence = byClass(row, 'recorded-evidence');
    assert.equal(general.open, false);
    assert.equal(evidence.open, false);
    general.open = true;
    evidence.open = true;
    const pre = walk(evidence).find(node => node.tagName === 'pre');
    pre.focus();
    const meaning = byClass(row, 'step-means');
    assert.match(meaning.textContent, /reports success/i);
    assert.ok(general.textContent.includes(presentation.vocabulary.tool.definition));
    assert.equal(general.textContent.includes('<img> Authored definition 日本語😀'), false, 'Legacy copy cannot override the authoritative vocabulary.');
    assert.equal(walk(row).filter(node => node.tagName === 'img').length, 0);
    const replacement = { ...make(false), explanation: 'Updated authored definition.' };
    ui.render([replacement]);
    assert.equal(byClass(row, 'step-means'), meaning);
    assert.match(meaning.textContent, /reports failure/i);
    assert.equal(pre.textContent, replacement.evidence);
    assert.equal(ui.document.activeElement, pre);
    assert.equal(details.open, true);
    assert.equal(general.open, true);
    assert.equal(evidence.open, true);
    assert.ok(general.textContent.includes(presentation.vocabulary.tool.definition));
    ui.render([{ ...replacement, truncated: true }]);
    assert.match(meaning.textContent, /outcome.*unavailable/i);
    assert.match(byClass(row, 'step-unknown').textContent, /complete.*matching.*unavailable/i);
    assert.equal(byClass(row, 'evidence-truncated').hidden, false);
    assert.equal(ui.document.activeElement, pre);
  }
});

test('jumping to an original event opens its retained nested evidence disclosure', () => {
  const ui = fixture(appSource);
  ui.render([start, end]);
  const row = evidenceRows(ui.get('#timeline').firstElementChild)[1];
  const evidence = byClass(row, 'recorded-evidence');
  assert.ok(evidence, 'Literal evidence has an optional disclosure.');
  assert.equal(evidence.open, false);
  ui.get('#event-target').value = 'result';
  ui.get('#event-target').dispatch('change');
  ui.get('#jump-event').dispatch('click');
  assert.equal(evidence.open, true);
  assert.equal(row.firstElementChild.open, true);
  assert.equal(ui.document.activeElement, row.firstElementChild.firstElementChild);
  assert.equal(walk(evidence).find(node => node.tagName === 'pre').textContent, end.evidence);
});

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
  assert.equal(sourceRow.firstElementChild.firstElementChild.scrolled, true);
  assert.equal(walk(sourceRow).find(node => node.tagName === 'pre').textContent, earlier.evidence);
});

test('activity evidence navigation works from every view and a withdrawn heading moves button focus safely', () => {
  const recorded = activityIntent('intent', 'Inspect the source');
  for (const mode of ['grouped', 'chapters', 'chronological', 'lanes']) {
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
  assert.equal(endRow.firstElementChild.firstElementChild.scrolled, true);
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

test('filters preserve full-snapshot contexts, boundaries and retained Statistics in every view', () => {
  const hook = { id: 'hook', type: 'hook.end', category: 'hook', agentId: '', hookId: 'hook', hookType: 'pre', success: false, evidence: '{"id":"hook"}' };
  const other = { id: 'other', type: 'assistant.turn_start', category: 'turn', agentId: 'child', turnId: '0', evidence: '{"id":"other"}' };
  const afterInput = boundary('after-input', 'start', { toolCallId: 'after-input' });
  const entries = [request('input'), activityStart, start, other, end, request('new-input'), afterInput, hook];
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource);
    ui.render(entries);
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
    const counts = ui.get('#stat-counts').textContent;
    filterMode(ui, 'tools');
    assert.deepEqual(visibleEvidence(ui), [start.evidence, end.evidence, afterInput.evidence]);
    assert.match(ui.get('#filter-status').textContent, /Tools.*3 matching.*5 hidden.*8 retained/);
    assert.match(ui.get('#filter-status').textContent, /gaps.*connectors.*off/i);
    assert.equal(ui.get('#timeline').dataset.filtered, 'true');
    assert.equal(ui.get('#follow').checked, false);
    assert.equal(ui.get('#stat-counts').textContent, counts);
    const matchingRows = visibleWalk(ui.get('#timeline')).filter(node => node.tagName === 'pre').map(pre => pre.closest('li'));
    assert.match(byClass(matchingRows[0], 'turn-context').textContent, /Within turn 0.*Main chat/);
    assert.equal(byClass(matchingRows[2], 'turn-context').hidden, true, 'Hidden idle input still closes turn context.');
    if (mode === 'chapters') {
      assert.equal(ui.get('#timeline').children.filter(node => !node.hidden).length, 2, 'Hidden prompts still partition chapters.');
      assert.match(ui.get('#timeline').textContent, /Retained chapter context/);
    }
    filterMode(ui, 'problems');
    assert.deepEqual(visibleEvidence(ui), [end.evidence, hook.evidence]);
    if (mode === 'grouped') assert.match(ui.get('#timeline').textContent, /Retained call context.*1 matching.*1 hidden/);
    filterMode(ui, 'automation');
    assert.deepEqual(visibleEvidence(ui), [hook.evidence]);
    ui.get('#reset-filter').dispatch('click');
    assert.equal(ui.get('#activity-filter').value, 'everything');
    assert.equal(visibleEvidence(ui).length, entries.length);
    assert.equal(ui.get('#timeline').dataset.filtered, 'false');
    assert.equal(ui.document.activeElement, ui.get('#activity-filter'));
    assert.equal(ui.get('#stat-counts').textContent, counts);
  }
});

test('filtered rows keep disclosure state while same-ID changes, polling and eviction refresh matches and focus', () => {
  const ui = fixture(appSource);
  ui.render([start, end]);
  const card = ui.get('#timeline').firstElementChild;
  card.firstElementChild.open = true;
  const [first, result] = evidenceRows(card);
  result.firstElementChild.open = true;
  const evidence = walk(result).find(node => node.tagName === 'pre');
  evidence.focus();
  filterMode(ui, 'problems');
  assert.equal(ui.document.activeElement, evidence);
  assert.equal(first.hidden, true);
  assert.equal(result.hidden, false);
  const changed = { ...end, success: true, evidence: '{"success":true}' };
  ui.render([start, changed]);
  assert.equal(result.dataset.tone, 'tool', 'Canonical success also refreshes the retained row presentation.');
  assert.equal(ui.get('#filter-empty').hidden, false);
  assert.equal(ui.get('#empty').hidden, true);
  assert.equal(ui.document.activeElement, ui.get('#activity-filter'), 'Same-ID replacement hides focused evidence safely.');
  assert.equal(ui.get('#activity-filter').value, 'problems');
  assert.match(ui.get('#filter-status').textContent, /0 matching.*2 hidden.*2 retained/);
  ui.render([start, changed, { id: 'info', type: 'session.info', evidence: '{}' }]);
  assert.equal(ui.get('#filter-empty').hidden, false);
  ui.render([start, changed, { id: 'error', type: 'session.error', evidence: '{"error":true}' }]);
  assert.equal(ui.get('#filter-empty').hidden, true);
  assert.match(ui.get('#filter-status').textContent, /1 matching.*2 hidden.*3 retained/);
  ui.get('#reset-filter').dispatch('click');
  assert.equal(ui.get('#timeline').firstElementChild, card);
  assert.equal(card.firstElementChild.open, true);
  assert.equal(result.firstElementChild.open, true);
  assert.equal(evidence.textContent, changed.evidence);
  filterMode(ui, 'tools');
  evidence.focus();
  ui.render([changed], { omitted: 2 });
  assert.equal(ui.document.activeElement, evidence);
  assert.equal(evidenceRows(card)[0], result);
  assert.match(ui.get('#notice').textContent, /Older events were omitted/);
  ui.render([]);
  assert.equal(ui.get('#filter-empty').hidden, true);
  assert.equal(ui.get('#empty').hidden, false);
  assert.equal(ui.document.activeElement, ui.get('#activity-filter'));
});

test('filter-hidden card focus moves visibly and exact source navigation resets the filter', () => {
  const ui = fixture(appSource);
  ui.render([activityStart, activityIntent('intent', 'Inspect'), start, end]);
  const turnRow = ui.get('#timeline').firstElementChild;
  const reported = walk(turnRow).find(node => node.tagName === 'button');
  reported.focus();
  filterMode(ui, 'tools');
  assert.equal(ui.document.activeElement, ui.get('#activity-filter'));
  filterMode(ui, 'problems');
  const card = ui.get('#timeline').children.find(node => node.className.includes('tool-group'));
  const startButton = walk(card).find(node => node.tagName === 'button');
  startButton.focus(); startButton.dispatch('click');
  assert.equal(ui.get('#activity-filter').value, 'everything');
  assert.equal(ui.get('#event-order').value, 'chronological');
  const target = ui.get('#timeline').children[2];
  assert.equal(target.hidden, false);
  assert.equal(ui.document.activeElement, target.firstElementChild.firstElementChild);
  assert.equal(target.firstElementChild.firstElementChild.scrolled, true);
  assert.match(ui.get('#filter-status').textContent, /Everything.*4 matching.*0 hidden.*4 retained/);
  // Both source controls share the same deliberate reveal path.
  filterMode(ui, 'tools'); reported.dispatch('click');
  assert.equal(ui.get('#activity-filter').value, 'everything');
  assert.equal(ui.document.activeElement, ui.get('#timeline').children[1].firstElementChild.firstElementChild);
});

test('filtered view changes preserve disclosures and do not join hooks across hidden boundaries', () => {
  const ui = fixture(appSource);
  const firstHook = { id: 'first-hook', type: 'hook.start', category: 'hook', agentId: '', hookInvocationId: 'h1', evidence: '{"id":"first-hook"}' };
  const secondHook = { id: 'second-hook', type: 'hook.end', category: 'hook', agentId: '', hookInvocationId: 'h2', evidence: '{"id":"second-hook"}' };
  const entries = [request('one'), activityStart, firstHook, request('two'), secondHook];
  ui.render(entries);
  filterMode(ui, 'automation');
  const groups = ui.get('#timeline').children.filter(node => !node.hidden);
  assert.equal(groups.length, 2, 'Hidden user input still separates hook groups.');
  assert.match(groups[0].textContent, /Within turn 0.*Main chat/);
  assert.equal(byClass(groups[1], 'turn-context').hidden, true);
  groups[0].firstElementChild.open = true;
  const hookRow = byClass(groups[0], 'hook-events').firstElementChild;
  hookRow.firstElementChild.open = true;
  const evidence = walk(hookRow).find(node => node.tagName === 'pre');
  evidence.focus();
  for (const mode of ['chapters', 'chronological', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
    assert.equal(ui.get('#activity-filter').value, 'automation');
    assert.equal(ui.document.activeElement, evidence);
    assert.equal(hookRow.firstElementChild.open, true);
    assert.deepEqual(visibleEvidence(ui), [firstHook.evidence, secondHook.evidence]);
  }
  assert.equal(ui.get('#timeline').children.filter(node => !node.hidden)[0], groups[0]);
  assert.equal(groups[0].firstElementChild.open, true);
  filterMode(ui, 'tools');
  assert.equal(ui.get('#filter-empty').hidden, false);
  assert.equal(ui.document.activeElement, ui.get('#activity-filter'));
  ui.render([], { history: 'unsupported' });
  assert.equal(ui.get('#filter-empty').hidden, true, 'Unavailable events are not a successful empty filter result.');
  assert.match(ui.get('#notice').textContent, /did not expose the session event API/);
});
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

function agentBoundary(id, type, agentId, second, extra = {}) {
  const timestamp = `2026-11-20T12:00:0${second}Z`;
  const data = { toolCallId: `spawn-${agentId}`, agentDisplayName: 'Same name 日本語', ...extra };
  return { id, type, category: 'agent', agentId, timestamp, toolCallId: data.toolCallId,
    evidence: JSON.stringify({ id, type, agentId, timestamp, data }) };
}
const agentStart = agentBoundary('agent-start', 'subagent.started', 'a', 1);
const agentEnd = agentBoundary('agent-end', 'subagent.completed', 'a', 4);
function laneMode(ui) { ui.get('#event-order').value = 'lanes'; ui.get('#event-order').dispatch('change'); }
const laneRows = lane => byClass(lane, 'lane-events').children;

test('agent lane summaries visibly align overlapping intervals on one scale and keep original evidence', () => {
  const ui = fixture(appSource);
  const bStart = agentBoundary('b-start', 'subagent.started', 'b', 2);
  const bEnd = agentBoundary('b-end', 'subagent.completed', 'b', 5);
  ui.render([agentStart, bStart, agentEnd, bEnd]);
  laneMode(ui);
  const [a, b] = ui.get('#timeline').children;
  assert.ok(a.className.includes('agent-lane'));
  const aBar = walk(a).find(node => node.tagName === 'rect'), bBar = walk(b).find(node => node.tagName === 'rect');
  assert.equal(Number(aBar.attributes.x), 0);
  assert.equal(Number(aBar.attributes.width), 750);
  assert.equal(Number(bBar.attributes.x), 250);
  assert.equal(Number(bBar.attributes.width), 750);
  assert.match(a.textContent, /0–3 s.*3 s elapsed/);
  assert.match(b.textContent, /1–4 s.*3 s elapsed/);
  assert.match(ui.get('#lane-help').textContent, /1 pairs of lanes.*2026-11-20T12:00:01.000Z/);
  assert.deepEqual(laneRows(a).map(row => walk(row).find(node => node.tagName === 'pre').textContent), [agentStart.evidence, agentEnd.evidence]);
  const laterStart = agentBoundary('b-start', 'subagent.started', 'b', 4);
  ui.render([agentStart, agentEnd, laterStart, bEnd]);
  assert.equal(Number(walk(b).find(node => node.tagName === 'rect').attributes.x), 750);
  assert.match(ui.get('#lane-help').textContent, /0 pairs of lanes/);
});

test('lane source and recorded parent controls reset filters and open exact original evidence', () => {
  const ui = fixture(appSource);
  const spawn = { ...boundary('parent "<>日本語', 'start'), toolCallId: 'spawn-a' };
  spawn.evidence = JSON.stringify({ id: spawn.id, type: spawn.type, timestamp: spawn.timestamp, data: { toolCallId: spawn.toolCallId } });
  ui.render([spawn, agentStart, agentEnd]);
  laneMode(ui);
  const child = ui.get('#timeline').children[1];
  const parentButton = walk(child).find(node => node.tagName === 'button' && node.textContent.includes('Parent delegation'));
  assert.ok(parentButton);
  parentButton.focus(); parentButton.dispatch('click');
  assert.equal(ui.get('#event-order').value, 'chronological');
  assert.equal(ui.document.activeElement, ui.get('#timeline').firstElementChild.firstElementChild.firstElementChild);
  assert.equal(walk(ui.get('#timeline').firstElementChild).find(node => node.tagName === 'pre').textContent, spawn.evidence);
  laneMode(ui);
  const originalButton = walk(child).find(node => node.tagName === 'button' && node.textContent.includes('outcome evidence'));
  filterMode(ui, 'problems');
  assert.equal(child.hidden, true);
  filterMode(ui, 'everything');
  originalButton.dispatch('click');
  assert.equal(ui.get('#timeline').children[2].firstElementChild.open, true);
  assert.equal(ui.document.activeElement, ui.get('#timeline').children[2].firstElementChild.firstElementChild);
  laneMode(ui);
  parentButton.focus();
  ui.render([agentStart, agentEnd], { omitted: 1 });
  assert.equal(parentButton.isConnected, false);
  assert.equal(ui.document.activeElement, child.firstElementChild.firstElementChild);
  assert.match(child.textContent, /Parent delegation unavailable/);
});

test('lanes retain disclosure, focused rows, counts and filters through every view and retention', () => {
  const ui = fixture(appSource);
  const childTool = boundary('child-tool', 'start', { agentId: 'a' });
  const childResult = boundary('child-result', 'complete', { agentId: 'a', success: false });
  ui.render([agentStart, childTool, childResult]);
  const grouped = ui.get('#timeline').children[1];
  grouped.firstElementChild.open = true;
  const resultRow = evidenceRows(grouped)[1], evidence = walk(resultRow).find(node => node.tagName === 'pre');
  resultRow.firstElementChild.open = true;
  evidence.focus();
  const counts = ui.get('#stat-counts').textContent;
  for (const mode of ['lanes', 'chapters', 'chronological', 'grouped', 'lanes']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
    assert.equal(ui.document.activeElement, evidence);
    assert.equal(evidence.isConnected, true);
    assert.equal(resultRow.firstElementChild.open, true);
    assert.equal(ui.get('#stat-counts').textContent, counts);
  }
  const lane = ui.get('#timeline').firstElementChild;
  assert.equal(lane.firstElementChild.open, true);
  filterMode(ui, 'tools');
  assert.equal(ui.document.activeElement, evidence);
  assert.deepEqual(visibleEvidence(ui), [childTool.evidence, childResult.evidence]);
  assert.match(lane.textContent, /lane context.*2 matching.*1 hidden/);
  ui.render([childResult, agentEnd], { omitted: 2 });
  assert.equal(ui.get('#timeline').firstElementChild, lane);
  assert.equal(ui.document.activeElement, evidence);
  assert.match(lane.textContent, /Start unavailable/);
  filterMode(ui, 'automation');
  assert.equal(ui.document.activeElement, ui.get('#activity-filter'));
  filterMode(ui, 'everything');
  lane.firstElementChild.firstElementChild.focus();
  ui.render([]);
  assert.equal(ui.document.activeElement, ui.get('#event-order'));
  assert.equal(ui.get('#follow').checked, false);
});

test('many collapsed lanes remain stacked and preserve a collapsed focused header on live completion', () => {
  const ui = fixture(appSource);
  const entries = Array.from({ length: 40 }, (_, i) => agentBoundary(`start-${i}`, 'subagent.started', `agent-${i}`, 1));
  ui.render(entries);
  laneMode(ui);
  assert.equal(ui.get('#timeline').children.length, 40);
  assert.ok(ui.get('#timeline').children.every(lane => !lane.firstElementChild.open));
  const lane = ui.get('#timeline').children[20], summary = lane.firstElementChild.firstElementChild;
  summary.focus();
  ui.render([...entries, agentBoundary('end-20', 'subagent.completed', 'agent-20', 4)]);
  assert.equal(ui.get('#timeline').children[20], lane);
  assert.equal(lane.firstElementChild.open, false);
  assert.equal(ui.document.activeElement, summary);
  assert.equal(laneRows(lane).length, 2);
  assert.match(lane.textContent, /Completed/);
});

const navigationEntries = [
  { id: 'input', type: 'user.message', category: 'user', agentId: '', delivery: 'idle', evidence: 'input evidence' },
  activityStart,
  { id: 'hook-start', type: 'hook.start', category: 'hook', agentId: '', hookId: 'hook', evidence: 'hook start evidence' },
  { id: 'failure "<>日本語', type: 'hook.end', category: 'hook', agentId: '', hookId: 'hook', success: false, evidence: 'failure evidence' },
  { id: 'permission', type: 'permission.requested', category: 'permission', agentId: 'child', evidence: 'permission evidence' },
  { id: 'skill', type: 'skill.invoked', category: 'skill', agentId: '', evidence: 'skill evidence' },
  { ...boundary('result', 'complete', { agentId: 'child', success: true }), evidence: 'private result evidence' },
];
function navigationCategory(ui, category) {
  ui.get('#event-target').value = category;
  ui.get('#event-target').dispatch('change');
}
function evidenceNode(ui, text) {
  return walk(ui.get('#timeline')).find(node => node.tagName === 'pre' && node.textContent === text);
}

test('latest-event controls reveal exact original evidence through every view and filter without losing disclosures', () => {
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    for (const [category, text] of [['failure', 'failure evidence'], ['permission', 'permission evidence'], ['skill', 'skill evidence'], ['result', 'private result evidence']]) {
      const ui = fixture(appSource);
      ui.render(navigationEntries);
      const prior = evidenceNode(ui, 'input evidence').closest('li').firstElementChild;
      prior.open = true;
      const evidence = evidenceNode(ui, text), row = evidence.closest('li'), details = row.firstElementChild;
      ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
      for (const group of ui.get('#timeline').children) if (group !== row && group.className !== 'step') group.firstElementChild.open = false;
      filterMode(ui, category === 'result' ? 'automation' : 'tools');
      assert.equal(row.hidden, true, 'The target begins behind a filter.');
      navigationCategory(ui, category);
      const jump = ui.get('#jump-event');
      assert.equal(jump.disabled, false);
      jump.focus(); jump.dispatch('click');
      assert.equal(ui.get('#event-order').value, 'chronological');
      assert.equal(ui.get('#activity-filter').value, 'everything');
      assert.equal(evidenceNode(ui, text), evidence, 'Navigation reuses original retained evidence.');
      assert.equal(details.open, true);
      assert.equal(row.hidden, false);
      assert.equal(prior.open, true, 'Another row keeps its disclosure state.');
      assert.equal(ui.document.activeElement, details.firstElementChild);
      assert.equal(details.firstElementChild.scrolled, true, 'The focused summary is scrolled, including tall evidence cards.');
      assert.equal(details.firstElementChild.followAtScroll, false, 'Follow pauses before scrolling.');
      assert.match(ui.get('#navigation-status').textContent, /Showing latest retained.*Follow live is paused/);
      assert.doesNotMatch(ui.get('#navigation-status').textContent, /private|evidence|日本語/);
    }
  }
});

test('no matches and invalid categories leave mode, focus, follow and reading position unchanged', () => {
  const ui = fixture(appSource);
  navigationCategory(ui, 'failure');
  assert.equal(ui.get('#jump-event').disabled, true, 'Navigation is safe before the first snapshot.');
  assert.match(ui.get('#navigation-status').textContent, /No retained failure/);
  ui.render([start]);
  laneMode(ui); filterMode(ui, 'automation');
  const selector = ui.get('#event-target'), page = ui.document.scrollingElement;
  selector.focus(); page.scrollTop = 240; ui.get('#follow').checked = true;
  for (const category of ['failure', 'permission', 'skill', 'result', 'unknown']) {
    navigationCategory(ui, category);
    assert.equal(ui.get('#jump-event').disabled, true);
    ui.get('#jump-event').dispatch('click'); // A queued activation still rechecks the current snapshot.
    assert.match(ui.get('#navigation-status').textContent, /No retained|Choose an event category/);
    assert.equal(ui.get('#event-order').value, 'lanes');
    assert.equal(ui.get('#activity-filter').value, 'automation');
    assert.equal(ui.document.activeElement, selector);
    assert.equal(page.scrollTop, 240);
    assert.equal(ui.get('#follow').checked, true);
  }
});

test('an evicted source link is rejected before changing views, focus, follow or reading position', () => {
  const ui = fixture(appSource);
  ui.render([start, end]);
  const oldButton = walk(ui.get('#timeline')).filter(node => node.tagName === 'button')[1];
  ui.render([start]);
  laneMode(ui); filterMode(ui, 'automation');
  const selector = ui.get('#event-target'), page = ui.document.scrollingElement;
  selector.focus(); page.scrollTop = 240; ui.get('#follow').checked = true;
  oldButton.dispatch('click');
  assert.equal(ui.get('#event-order').value, 'lanes');
  assert.equal(ui.get('#activity-filter').value, 'automation');
  assert.equal(ui.document.activeElement, selector);
  assert.equal(page.scrollTop, 240);
  assert.equal(ui.get('#follow').checked, true);
  assert.match(ui.get('#navigation-status').textContent, /no longer retained/);
});

test('a selected category whose target is evicted cannot navigate using its earlier enabled state', () => {
  const ui = fixture(appSource);
  ui.render([start, end]);
  navigationCategory(ui, 'result');
  const jump = ui.get('#jump-event');
  assert.equal(jump.disabled, false);
  ui.render([start]);
  laneMode(ui); filterMode(ui, 'automation');
  ui.get('#event-target').focus();
  ui.document.scrollingElement.scrollTop = 230;
  ui.get('#follow').checked = true;
  jump.dispatch('click');
  assert.equal(jump.disabled, true);
  assert.match(ui.get('#navigation-status').textContent, /No retained tool result/);
  assert.equal(ui.get('#event-order').value, 'lanes');
  assert.equal(ui.get('#activity-filter').value, 'automation');
  assert.equal(ui.document.activeElement, ui.get('#event-target'));
  assert.equal(ui.document.scrollingElement.scrollTop, 230);
  assert.equal(ui.get('#follow').checked, true);
});

test('repeated deliberate jumps use the current snapshot while live arrival stays paused and Follow live returns to the bottom', () => {
  const ui = fixture(appSource), page = ui.document.scrollingElement;
  ui.render([start, end]);
  navigationCategory(ui, 'result');
  ui.syncFollowing();
  assert.equal(page.scrollTop, 800);
  const jump = ui.get('#jump-event');
  jump.focus(); jump.dispatch('click');
  const oldFocus = ui.document.activeElement;
  assert.equal(page.scrollTop, 120);
  assert.equal(ui.get('#follow').checked, false);
  const latest = boundary('latest', 'complete', { toolCallId: 'latest-call', evidence: 'new result' });
  page.scrollHeight = 1700;
  ui.render([start, end, latest]); ui.syncFollowing();
  assert.equal(page.scrollTop, 120, 'New activity cannot pull the reader away from the chosen event.');
  assert.equal(ui.document.activeElement, oldFocus);
  jump.focus(); jump.dispatch('click');
  const newestFocus = evidenceNode(ui, 'new result').closest('li').firstElementChild.firstElementChild;
  assert.equal(ui.document.activeElement, newestFocus);
  jump.focus(); jump.dispatch('click');
  assert.equal(ui.document.activeElement, newestFocus, 'Repeated keyboard activation returns to the same retained target.');
  ui.get('#follow').checked = true; ui.get('#follow').dispatch('change');
  assert.equal(page.scrollTop, 1500, 'The real follow controller resumes at the document bottom.');
  assert.equal(ui.get('#follow').checked, true);
  page.scrollHeight = 2000; ui.syncFollowing();
  assert.equal(page.scrollTop, 1800);
});
