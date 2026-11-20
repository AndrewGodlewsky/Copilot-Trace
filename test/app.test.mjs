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
import * as learning from '../com.github.copilot/extensions/trace/web/learning.mjs';
import * as examples from '../com.github.copilot/extensions/trace/web/examples.mjs';
import { createDiagnostics } from '../com.github.copilot/extensions/trace/web/diagnostics.mjs';

// A small DOM boundary double exercises reconciliation, not browser layout or native focus behavior.
function fixture(source, inventoryLoad = async () => { throw new Error('Unexpected inventory request'); }, feedLoad, instructionLoad = async () => { throw new Error('Unexpected instruction request'); }, clock = Date, exampleLoad) {
  let document;
  class Element {
    constructor(tagName) {
      this.tagName = tagName; this.children = []; this.parentElement = null; this.dataset = {};
      this.attributes = {}; this.listeners = new Map(); this.captureListeners = new Map(); this.style = { setProperty() {} };
      this.className = ''; this._text = ''; this.open = false; this.checked = false;
      this.scrollTop = 0; this.clientTop = 0;
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
    addEventListener(name, listener, options) {
      const listeners = options === true || options?.capture ? this.captureListeners : this.listeners;
      if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(listener);
    }
    dispatch(name) {
      let prevented = false;
      const event = { target: this, preventDefault() { prevented = true; } }, path = [];
      for (let node = this; node; node = node.parentElement) path.unshift(node);
      for (const node of path) for (const listener of node.captureListeners.get(name) || []) listener(event);
      for (const listener of this.listeners.get(name) || []) listener(event);
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
    getBoundingClientRect() { return { top: 0, bottom: 0, height: 0 }; }
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
    '#prediction', '#prediction-live', '#prediction-replay', '#prediction-controls', '#prediction-category', '#prediction-record',
    '#prediction-next', '#prediction-skip', '#prediction-exit', '#prediction-follow', '#prediction-status', '#prediction-result', '#prediction-mode',
    '#playback', '#playback-start', '#playback-controls', '#playback-previous', '#playback-next', '#playback-play',
    '#playback-exit', '#playback-follow', '#playback-status', '#playback-scope', '#playback-motion', '#learning-activity',
    '#examples', '#examples-load', '#examples-select', '#examples-open', '#examples-status', '#examples-notes', '#example-banner',
    '#plausible-actions', '#plausible-summary', '#plausible-scope', '#plausible-list',
    '#stat-scope', '#stat-hooks', '#stat-skills', '#statistics-peek', '#footer-dock', '#event-order',
    '#activity-filter', '#reset-filter', '#filter-status', '#filter-empty', '#lane-help',
    '#event-target', '#jump-event', '#navigation-status', '#capabilities', '#capability-refresh', '#capability-status',
    '#capability-scope', '#capability-window', '#capability-list', '#glossary-button', '#glossary-panel',
    '#glossary-concept', '#glossary-definition', '#glossary-deeper', '#glossary-example', '#glossary-source', '#glossary-status',
    '#guidance-comparison', '#guidance-examples',
    '#prompt-panel', '#prompt-button', '#prompt-draft',
    '#arguments-button', '#arguments-panel', '#arguments-first', '#arguments-second', '#arguments-first-detail', '#arguments-second-detail',
    '#arguments-status', '#arguments-limits', '#arguments-diff', '#arguments-scope',
    '#recap-button', '#recap-panel', '#recap-range', '#recap-scope', '#recap-status', '#recap-report',
    '#surprises-button', '#surprises-panel', '#surprises-scope', '#surprises-count', '#surprises-list', '#surprises-clear', '#surprises-status',
    '#retrieval-ledger', '#retrieval-summary', '#retrieval-scope', '#retrieval-list', '#retrieval-unclassified', '#retrieval-unknown-list',
    '#validation-overview', '#validation-summary', '#validation-scope', '#validation-list',
    '#repeated-activity', '#repeated-summary', '#repeated-scope', '#repeated-list',
    '#observed-activity', '#observed-summary', '#observed-time', '#observed-feed', '#observed-scope', '#observed-list',
    '#instruction-sources', '#instruction-refresh', '#instruction-status', '#instruction-scope', '#instruction-window', '#instruction-current', '#instruction-loads',
    '#instruction-inspector', '#instruction-title', '#instruction-detail', '#instruction-body', '#instruction-original', '#instruction-selection-status',
    '#statistics-panel', '#statistics-button', '#evidence-scope', '#scope-summary', '#scope-view', '#stat-evidence-scope', '#stat-scope-summary']) {
    const element = new Element(['#event-order', '#activity-filter', '#event-target'].includes(selector) ? 'select' : selector === '#jump-event' ? 'button' : 'div');
    element.id = selector.slice(1); selectors.set(selector, element); document.body.append(element);
  }
  const glossary = selectors.get('#glossary-panel');
  const prompt = selectors.get('#prompt-panel'); prompt.tagName = 'dialog'; prompt.className = 'footer-panel';
  const promptClose = new Element('button'); promptClose.dataset.closePanel = ''; prompt.append(promptClose);
  prompt.append(selectors.get('#prompt-draft')); selectors.get('#prompt-draft').value = '';
  selectors.get('#prompt-button').tagName = 'button'; selectors.get('#prompt-button').dataset.panel = 'prompt-panel';
  const plausible = selectors.get('#plausible-actions'); plausible.tagName = 'details';
  selectors.get('#plausible-summary').tagName = 'summary';
  for (const id of ['summary', 'scope', 'list']) plausible.append(selectors.get(`#plausible-${id}`));
  const statistics = selectors.get('#statistics-panel');
  const surprisesPanel = selectors.get('#surprises-panel'); surprisesPanel.tagName = 'dialog'; surprisesPanel.className = 'footer-panel';
  const surprisesClose = new Element('button'); surprisesClose.textContent = 'Close'; surprisesClose.dataset.closePanel = ''; surprisesPanel.append(surprisesClose);
  for (const id of ['scope', 'count', 'list', 'clear', 'status']) surprisesPanel.append(selectors.get(`#surprises-${id}`));
  selectors.get('#surprises-button').tagName = 'button'; selectors.get('#surprises-clear').tagName = 'button';
  selectors.get('#surprises-list').tagName = 'ol';
  const recapPanel = selectors.get('#recap-panel'); recapPanel.tagName = 'dialog'; recapPanel.className = 'footer-panel';
  const recapClose = new Element('button'); recapClose.textContent = 'Close'; recapClose.dataset.closePanel = ''; recapPanel.append(recapClose);
  for (const id of ['range', 'scope', 'status', 'report']) recapPanel.append(selectors.get(`#recap-${id}`));
  selectors.get('#recap-button').tagName = 'button'; selectors.get('#recap-range').tagName = 'select';
  const argumentsPanel = selectors.get('#arguments-panel'); argumentsPanel.tagName = 'dialog'; argumentsPanel.className = 'footer-panel';
  const argumentsClose = new Element('button'); argumentsClose.textContent = 'Close'; argumentsClose.dataset.closePanel = ''; argumentsPanel.append(argumentsClose);
  selectors.get('#arguments-button').tagName = 'button';
  for (const id of ['first', 'second', 'first-detail', 'second-detail', 'status', 'limits', 'diff', 'scope']) argumentsPanel.append(selectors.get(`#arguments-${id}`));
  for (const id of ['first', 'second']) selectors.get(`#arguments-${id}`).tagName = 'select';
  selectors.get('#arguments-diff').tagName = 'ol';
  for (const [id, summary, body] of [['#evidence-scope', '#scope-summary', '#notice'], ['#stat-evidence-scope', '#stat-scope-summary', '#stat-scope']]) {
    const disclosure = selectors.get(id); disclosure.tagName = 'details';
    selectors.get(summary).tagName = 'summary'; disclosure.append(selectors.get(summary), selectors.get(body));
  }
  statistics.append(selectors.get('#stat-evidence-scope'));
  statistics.tagName = 'dialog'; statistics.className = 'footer-panel';
  const statisticsHeading = new Element('div'); statisticsHeading.className = 'panel-heading'; statistics.append(statisticsHeading);
  const statisticsClose = new Element('button'); statisticsClose.textContent = 'Close'; statisticsClose.dataset.closePanel = ''; statisticsHeading.append(statisticsClose);
  selectors.get('#statistics-button').dataset.panel = 'statistics-panel';
  const retrieval = selectors.get('#retrieval-ledger'); retrieval.tagName = 'details'; statistics.append(retrieval);
  for (const id of ['summary', 'scope', 'list', 'unclassified']) retrieval.append(selectors.get(`#retrieval-${id}`));
  selectors.get('#retrieval-unclassified').tagName = 'details';
  selectors.get('#retrieval-unclassified').append(new Element('summary'));
  selectors.get('#retrieval-unclassified').append(selectors.get('#retrieval-unknown-list'));
  const validation = selectors.get('#validation-overview'); validation.tagName = 'details'; statistics.append(validation);
  validation.append(new Element('summary'));
  for (const id of ['summary', 'scope', 'list']) validation.append(selectors.get(`#validation-${id}`));
  const repeated = selectors.get('#repeated-activity'); repeated.tagName = 'details'; statistics.append(repeated);
  for (const id of ['summary', 'scope', 'list']) repeated.append(selectors.get(`#repeated-${id}`));
  const observed = selectors.get('#observed-activity'); observed.tagName = 'details'; statistics.append(observed);
  for (const id of ['summary', 'time', 'feed', 'scope', 'list']) observed.append(selectors.get(`#observed-${id}`));
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
  const windowEvents = new Map();
  const diagnostics = createDiagnostics(), fetches = [], storageCalls = [];
  const storage = { setItem(...args) { storageCalls.push(args); }, getItem() { return null; }, removeItem() {}, clear() {} };
  const playbackTimers = new Map(), playbackCallbacks = []; let playbackTimerId = 0, motionListener;
  const motion = { matches: false, addEventListener(name, listener) { motionListener = listener; }, removeEventListener() { motionListener = undefined; } };
  const context = vm.createContext({ ...presentation, ...learning, ...examples, TextEncoder,
    createPlayback: (snapshot, options) => learning.createPlayback(snapshot, { ...options,
      schedule(callback) { playbackCallbacks.push(callback); playbackTimers.set(++playbackTimerId, callback); return playbackTimerId; },
      cancel(id) { playbackTimers.delete(id); } }),
    document, window: { matchMedia: () => motion, addEventListener(name, listener) {
    if (!windowEvents.has(name)) windowEvents.set(name, []); windowEvents.get(name).push(listener);
  } },
    ResizeObserver: class { observe() {} disconnect() {} }, createDiagnostics: () => diagnostics,
    localStorage: storage, sessionStorage: storage,
    createFollow,
    initCapabilities: options => capabilities.initCapabilities({ ...options, document, load: inventoryLoad }),
    initInstructionSources: options => instructions.initInstructionSources({ ...options, document, load: instructionLoad }),
    fetch: (url, options) => { fetches.push({ url, options }); return url === 'examples.json' && exampleLoad ? exampleLoad(url, options) : feedLoad(url, options); }, AbortSignal, AbortController, Date: clock,
    createPoller: options => feedLoad ? createPoller({ ...options, schedule: () => 1, cancel() {} }) : ({ refresh() {}, stop() {} }),
    initFooter: options => footer.initPanels?.({ ...options, document }),
  });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, ''), context);
  return { document, diagnostics, fetches, storageCalls, get: selector => selectors.get(selector),
    playbackTimers, playbackCallbacks,
    tickPlayback() { const [id, callback] = playbackTimers.entries().next().value; playbackTimers.delete(id); callback(); },
    reduceMotion(matches) { motion.matches = matches; motionListener?.({ matches }); },
    closePage() { for (const listener of windowEvents.get('pagehide') || []) listener(); },
    refreshFeed() { return vm.runInContext('poller.refresh();', context); },
    refreshCapabilities() { return vm.runInContext('capabilityView.refresh();', context); },
    closeCapabilities() { vm.runInContext('capabilityView.close();', context); },
    refreshInstructions() { return vm.runInContext('instructionView.refresh();', context); },
    closeInstructions() { vm.runInContext('instructionView.close();', context); },
    settlePrediction() { return vm.runInContext('armingPrediction;', context); },
    settleExamples() { return vm.runInContext('loadingExamples;', context); },
    syncFollowing() { vm.runInContext('following.sync();', context); },
    render(entries, extra = {}) {
      context.fixtureSnapshot = { entries, history: 'ready', omitted: 0, ...extra };
      vm.runInContext('lastSnapshot = fixtureSnapshot; liveSnapshot = fixtureSnapshot; render(lastSnapshot);', context);
    } };
}
const appSource = await readFile(new URL('../com.github.copilot/extensions/trace/web/app.mjs', import.meta.url), 'utf8');

const feedResponse = (snapshot, status = 200) => ({ status, headers: { get: () => 'fixture-revision' }, json: async () => snapshot });

const exampleText = await readFile(new URL('../com.github.copilot/extensions/trace/web/examples.json', import.meta.url), 'utf8');
const exampleResponse = text => ({ ok: true, text: async () => text });

function openPlausible(ui) { const disclosure = ui.get('#plausible-actions'); disclosure.open = true; disclosure.dispatch('toggle'); }
function closePlausible(ui) { const disclosure = ui.get('#plausible-actions'); disclosure.open = false; disclosure.dispatch('toggle'); }
function emitRead(data, id = 'read', success = true) {
  data.emit(`${id}-start`, 'tool.execution_start', { toolCallId: id, toolName: 'view', arguments: { path: '日本語🧪<script>' } });
  data.emit(`${id}-end`, 'tool.execution_complete', { toolCallId: id, success, result: { content: 'Literal 日本語🧪<script>' } });
}

test('plausible actions are opt-in, separate authored choices, preserve reading during arrivals and navigate literal evidence', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); emitRead(data);
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed();
  const list = ui.get('#plausible-list'); assert.equal(list.children.length, 0);
  const before = JSON.stringify(data.trace.snapshot().entries), counts = ui.get('#stat-counts').textContent;
  ui.get('#follow').checked = true; openPlausible(ui);
  assert.equal(ui.get('#follow').checked, false); assert.match(list.textContent, /Recorded observation.*returned data.*Authored alternatives/s);
  assert.match(list.textContent, /If the data.*If the returned data/s);
  assert.equal(ui.get('#stat-counts').textContent, counts); assert.equal(JSON.stringify(data.trace.snapshot().entries), before);
  const row = list.children[0], buttons = row.querySelectorAll('button'), source = buttons.find(button => /Original result/.test(button.textContent));
  source.focus(); list.scrollTop = 60; ui.document.scrollingElement.scrollTop = 200;
  const text = list.textContent; emitRead(data, 'later'); await ui.refreshFeed();
  assert.equal(list.children[0], row); assert.equal(list.textContent, text);
  assert.equal(ui.document.activeElement, source); assert.equal(list.scrollTop, 60); assert.equal(ui.document.scrollingElement.scrollTop, 200);
  assert.equal(list.attributes['aria-live'], undefined); assert.equal(row.querySelector('p').attributes.role, undefined);
  buttons.find(button => /Glossary/.test(button.textContent)).dispatch('click');
  assert.equal(ui.get('#glossary-panel').open, true); assert.match(ui.get('#glossary-example').textContent, /tool.execution_start/);
  ui.get('#glossary-panel').close(); source.dispatch('click');
  assert.match(ui.get('#timeline').textContent, /Literal 日本語🧪<script>/); assert.equal(ui.get('#event-order').value, 'chronological');
  assert.ok(walk(ui.get('#timeline')).some(node => node.scrolled));
  closePlausible(ui); assert.equal(list.children.length, 0);
  source.dispatch('click'); assert.equal(list.children.length, 0);
});

test('plausible permission gap settles without rewriting choices or stealing focus, and stale controls cannot jump', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  data.emit('request', 'permission.requested', { requestId: 'permission', permissionRequest: { kind: 'shell', toolCallId: 'call' } });
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed(); openPlausible(ui);
  const list = ui.get('#plausible-list'), row = list.children[0], source = row.querySelector('button');
  assert.match(row.textContent, /current waiting and approval are unknown/i); source.focus(); ui.document.scrollingElement.scrollTop = 250;
  data.emit('decision', 'permission.completed', { requestId: 'permission', result: { kind: 'approved' } }); await ui.refreshFeed();
  assert.equal(list.children[0], row); assert.equal(ui.document.activeElement, source);
  assert.match(row.textContent, /changed, settled or left/i); assert.equal(source.attributes['aria-disabled'], 'true');
  for (const button of row.querySelectorAll('button')) button.dispatch('click');
  assert.equal(ui.get('#glossary-panel').open, false); assert.equal(ui.document.scrollingElement.scrollTop, 250);
  closePlausible(ui); openPlausible(ui); assert.match(list.textContent, /General guidance/);
});

test('plausible source guards reject replaced, ambiguous and evicted records and page-close callbacks', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); emitRead(data);
  const entries = data.trace.snapshot().entries;
  for (const change of [records => records.slice(0, 1), records => [...records, { ...records[1], id: 'another-start' }],
    records => records.map(entry => entry.id === 'read-end' ? { ...entry, evidence: '{}' } : entry)]) {
    const ui = fixture(appSource); ui.render(entries); openPlausible(ui);
    const row = ui.get('#plausible-list').children[0], buttons = row.querySelectorAll('button');
    buttons[0].focus(); ui.document.scrollingElement.scrollTop = 240; ui.render(change(entries));
    for (const button of buttons) button.dispatch('click');
    assert.equal(ui.document.scrollingElement.scrollTop, 240); assert.equal(ui.get('#glossary-panel').open, false);
    assert.match(row.textContent, /unavailable/i); ui.closePage();
  }
  const ui = fixture(appSource); ui.render(entries); openPlausible(ui); const buttons = ui.get('#plausible-list').querySelectorAll('button');
  ui.closePage(); for (const button of buttons) button.dispatch('click');
  assert.equal(ui.get('#plausible-list').children.length, 0); assert.equal(ui.get('#glossary-panel').open, false);
});

test('plausible teaching only sees playback and practice prefixes and inspection pauses automatic playback', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); emitRead(data); data.response('future');
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed();
  openPlausible(ui); const old = ui.get('#plausible-list').querySelector('button');
  ui.get('#playback-start').dispatch('click'); assert.equal(ui.get('#plausible-actions').open, false); old.dispatch('click');
  openPlausible(ui); assert.match(ui.get('#plausible-list').textContent, /General guidance/);
  assert.equal(ui.get('#plausible-list').querySelectorAll('button').length, 1);
  ui.get('#playback-next').dispatch('click'); closePlausible(ui); openPlausible(ui);
  assert.match(ui.get('#plausible-list').textContent, /General guidance/);
  ui.get('#playback-next').dispatch('click'); closePlausible(ui); ui.get('#playback-play').dispatch('click');
  assert.equal(ui.playbackTimers.size, 1); openPlausible(ui); assert.equal(ui.playbackTimers.size, 0);
  assert.match(ui.get('#plausible-list').textContent, /returned data/);
  const futureControl = ui.get('#plausible-list').querySelector('button'); ui.get('#playback-previous').dispatch('click');
  futureControl.dispatch('click'); assert.equal(ui.get('#plausible-list').children.length, 0);
  assert.doesNotMatch(ui.get('#timeline').textContent, /Literal 日本語/);
  ui.get('#playback-exit').dispatch('click'); ui.get('#prediction-replay').dispatch('click'); openPlausible(ui);
  assert.match(ui.get('#plausible-list').textContent, /General guidance/); assert.doesNotMatch(ui.get('#plausible-list').textContent, /returned data/);
  ui.closePage();
});

test('plausible alternatives keep synthetic prefixes separate from live evidence and ignore detached same-ID controls', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); emitRead(data);
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot()), undefined, Date, async () => exampleResponse(exampleText));
  await ui.refreshFeed(); openPlausible(ui); const liveButton = ui.get('#plausible-list').querySelector('button');
  ui.get('#examples-load').dispatch('click'); await ui.settleExamples(); ui.get('#examples-open').dispatch('click');
  liveButton.dispatch('click'); openPlausible(ui);
  assert.match(ui.get('#plausible-scope').textContent, /Synthetic demonstration observations/);
  assert.match(ui.get('#plausible-list').textContent, /General guidance/);
  assert.doesNotMatch(ui.get('#timeline').textContent, /Literal 日本語/);
  const exampleButton = ui.get('#plausible-list').querySelector('button');
  ui.get('#playback-exit').dispatch('click'); ui.document.scrollingElement.scrollTop = 230; exampleButton.dispatch('click');
  assert.equal(ui.get('#glossary-panel').open, false); assert.equal(ui.document.scrollingElement.scrollTop, 230);
  openPlausible(ui); assert.match(ui.get('#plausible-scope').textContent, /Recorded chat observations/);
  assert.match(ui.get('#plausible-list').textContent, /returned data/); ui.closePage();
});

test('plausible teaching does not expose live arrivals hidden by an active prediction window', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed();
  ui.get('#prediction-live').dispatch('click'); emitRead(data, 'hidden'); await ui.refreshFeed(); openPlausible(ui);
  assert.match(ui.get('#plausible-list').textContent, /General guidance/);
  ui.get('#plausible-list').querySelector('button').dispatch('click');
  assert.equal(ui.get('#glossary-source').hidden, true);
  assert.doesNotMatch(ui.get('#timeline').textContent, /Literal 日本語/);
  ui.get('#glossary-panel').close(); ui.get('#prediction-exit').dispatch('click'); openPlausible(ui);
  assert.match(ui.get('#plausible-list').textContent, /returned data/); ui.closePage();
});

test('synthetic lessons reveal only their prefix, label all viewers and preserve live capture, reading settings and marks on return', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); data.response('live answer');
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot()), undefined, Date, async () => exampleResponse(exampleText));
  await ui.refreshFeed();
  ui.get('#event-order').value = 'chronological'; ui.get('#event-order').dispatch('change');
  ui.get('#activity-filter').value = 'problems'; ui.get('#activity-filter').dispatch('change');
  ui.document.scrollingElement.scrollTop = 137;
  ui.get('#examples-load').dispatch('click'); await ui.settleExamples();
  ui.get('#examples-select').value = 'bug-fix'; ui.get('#examples-open').dispatch('click');
  assert.match(ui.get('#example-banner').textContent, /Synthetic demonstration.*bug-fix/i);
  assert.match(ui.get('#statistics-peek').textContent, /Synthetic demonstration/);
  assert.match(ui.get('#stat-scope').textContent, /not.*current chat/i);
  assert.match(ui.get('#connection').textContent, /Demonstration/);
  assert.doesNotMatch(ui.get('#timeline').textContent, /return a \+ b|exit 0|live answer/);
  assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#activity-filter').value, 'everything');
  ui.get('#prediction-live').dispatch('click'); ui.get('#prediction-replay').dispatch('click');
  ui.get('#prediction-record').dispatch('click'); assert.equal(ui.get('#prediction-controls').hidden, true);
  data.response('arrived-during-example'); await ui.refreshFeed();
  assert.match(ui.get('#learning-activity').textContent, /1 newly received/);
  assert.doesNotMatch(ui.get('#timeline').textContent, /arrived-during-example/);
  ui.get('#playback-next').dispatch('click'); ui.get('#playback-next').dispatch('click');
  assert.match(ui.get('#examples-notes').textContent, /Authored annotation.*protocol success true/s);
  assert.match(ui.get('#examples-notes').textContent, /Hypothetical alternative/);
  assert.doesNotMatch(ui.get('#examples-notes').textContent, /typed exit 0|Who approved/);
  ui.get('#glossary-button').dispatch('click');
  assert.match(ui.get('#glossary-panel').textContent, /Synthetic demonstration/);
  assert.doesNotMatch(ui.get('#glossary-example').textContent, /Current chat example/);
  ui.get('#playback-previous').dispatch('click'); assert.doesNotMatch(ui.get('#examples-notes').textContent, /protocol success true/);
  ui.get('#playback-follow').checked = false; ui.get('#playback-exit').dispatch('click');
  assert.equal(ui.get('#example-banner').hidden, true); assert.equal(ui.get('#examples-notes').textContent, '');
  assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#activity-filter').value, 'problems');
  assert.equal(ui.document.scrollingElement.scrollTop, 137); assert.equal(ui.get('#follow').checked, false);
  assert.match(ui.get('#timeline').textContent, /arrived-during-example/); assert.doesNotMatch(ui.get('#statistics-peek').textContent, /Synthetic/);
  assert.equal(ui.document.activeElement, ui.get('#examples-open'));
  for (const id of ['exploration', 'recovery', 'bug-fix']) {
    ui.get('#examples-select').value = id; ui.get('#examples-open').dispatch('click');
    assert.doesNotMatch(ui.get('#timeline').textContent, /arrived-during-example/);
    ui.get('#playback-play').dispatch('click'); const stale = ui.playbackCallbacks.at(-1);
    ui.get('#playback-exit').dispatch('click'); stale();
    assert.match(ui.get('#timeline').textContent, /arrived-during-example/);
  }
  ui.get('#prediction-live').dispatch('click'); ui.get('#examples-open').dispatch('click');
  assert.equal(ui.get('#example-banner').hidden, true); ui.get('#prediction-exit').dispatch('click');
  ui.closePage();
});

test('prompt inspection pauses playback and Follow without revealing hidden lesson or live evidence', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); data.response('private live answer');
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot()), undefined, Date, async () => exampleResponse(exampleText));
  await ui.refreshFeed(); ui.get('#examples-load').dispatch('click'); await ui.settleExamples();
  ui.get('#examples-select').value = 'bug-fix'; ui.get('#examples-open').dispatch('click');
  const before = ui.get('#timeline').textContent;
  ui.get('#playback-play').dispatch('click'); assert.equal(ui.playbackTimers.size, 1);
  ui.document.scrollingElement.scrollTop = 137;
  ui.get('#prompt-button').dispatch('click');
  assert.equal(ui.get('#prompt-panel').open, true); assert.equal(ui.playbackTimers.size, 0);
  assert.equal(ui.get('#follow').checked, false); assert.equal(ui.document.scrollingElement.scrollTop, 137);
  assert.equal(ui.get('#prompt-draft').value, ''); assert.doesNotMatch(ui.get('#prompt-panel').textContent, /Synthetic demonstration|private live|return a \+ b/);
  data.response('private arrival while drafting'); await ui.refreshFeed();
  assert.equal(ui.get('#timeline').textContent, before); assert.equal(ui.get('#prompt-draft').value, '');
  assert.match(ui.get('#learning-activity').textContent, /1 newly received/);
  ui.get('#prompt-panel').dispatch('cancel'); assert.equal(ui.document.activeElement, ui.get('#prompt-button'));
  assert.equal(ui.get('#follow').checked, false); assert.equal(ui.playbackTimers.size, 0);
  ui.get('#playback-exit').dispatch('click');
  assert.match(ui.get('#timeline').textContent, /private arrival while drafting/);
  ui.get('#prediction-replay').dispatch('click'); const predictionView = ui.get('#timeline').textContent;
  ui.get('#prompt-button').dispatch('click'); assert.equal(ui.get('#timeline').textContent, predictionView);
  assert.equal(ui.get('#prompt-draft').value, ''); ui.closePage();
});

test('lesson loading failures, bounded data and stale completions never replace or freeze live state', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  for (const response of [{ ok: false, text: async () => exampleText }, exampleResponse('{'), exampleResponse(' '.repeat(262145))]) {
    const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot()), undefined, Date, async () => response);
    await ui.refreshFeed(); const before = ui.get('#timeline').textContent;
    ui.get('#examples-load').dispatch('click'); await ui.settleExamples();
    assert.match(ui.get('#examples-status').textContent, /unavailable/i);
    assert.equal(ui.get('#timeline').textContent, before); assert.equal(ui.get('#follow').disabled, false);
    ui.closePage();
  }
  let release;
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot()), undefined, Date, () => new Promise(resolve => { release = resolve; }));
  await ui.refreshFeed(); ui.get('#examples-load').dispatch('click'); ui.closePage();
  const status = ui.get('#examples-status').textContent; release(exampleResponse(exampleText)); await ui.settleExamples();
  assert.equal(ui.get('#examples-status').textContent, status); assert.equal(ui.get('#examples-select').children.length, 0);
});

test('live claim links and disclosures survive lessons, and detached controls cannot alter matching synthetic or live evidence', async () => {
  const live = await claimFixture({ exitCode: 0 }), library = JSON.parse(exampleText);
  const raw = live.map(entry => JSON.parse(entry.evidence));
  raw.forEach((event, index) => {
    event.id = `synthetic:bug-fix:event-${index + 1}`;
    event.timestamp = new Date(event.timestamp).toISOString();
    if (event.data.toolCallId) event.data.toolCallId = 'synthetic:bug-fix:check';
    if (event.data.messageId) event.data.messageId = 'synthetic:bug-fix:message';
    if (event.data.result?.contents) event.data.result.contents[0].shellId = 'synthetic:bug-fix:shell';
  });
  library.examples[1].events = raw; library.examples[1].annotations = [{ eventId: raw[0].id, note: 'Authored fixture annotation.', alternative: 'An invented alternative.' }];
  const model = createTrace({ on() { return () => {}; }, getEvents: async () => raw }); await model.ready;
  const ui = fixture(appSource, undefined, undefined, undefined, Date, async () => exampleResponse(JSON.stringify(library)));
  ui.render(model.snapshot().entries); model.close();
  const liveClaim = byClass(ui.get('#timeline'), 'claim-evidence');
  const liveSelect = walk(liveClaim).find(node => node.tagName === 'button' && node.textContent === 'Link this result');
  liveSelect.dispatch('click'); liveClaim.open = true;
  ui.get('#examples-load').dispatch('click'); await ui.settleExamples();
  assert.match(ui.get('#examples-status').textContent, /ready/);
  ui.get('#examples-select').value = 'bug-fix'; ui.get('#examples-open').dispatch('click');
  ui.get('#playback-next').dispatch('click'); ui.get('#playback-next').dispatch('click');
  const syntheticClaim = byClass(ui.get('#timeline'), 'claim-evidence');
  assert.notEqual(syntheticClaim, liveClaim); assert.doesNotMatch(syntheticClaim.textContent, /User-linked result/);
  liveSelect.dispatch('click');
  const syntheticSelect = walk(syntheticClaim).find(node => node.tagName === 'button' && node.textContent === 'Link this result');
  syntheticSelect.dispatch('click'); assert.match(syntheticClaim.textContent, /User-linked result/);
  ui.get('#playback-exit').dispatch('click');
  assert.equal(byClass(ui.get('#timeline'), 'claim-evidence'), liveClaim); assert.equal(liveClaim.open, true);
  assert.match(liveClaim.textContent, /User-linked result/);
  syntheticSelect.dispatch('click'); assert.match(liveClaim.textContent, /User-linked result/);
  ui.closePage();
});

test('reloading a loaded library cannot open an obsolete selection while its response is pending', async () => {
  let release, reload = false;
  const ui = fixture(appSource, undefined, undefined, undefined, Date, () => reload
    ? new Promise(resolve => { release = resolve; }) : Promise.resolve(exampleResponse(exampleText)));
  ui.render([]); ui.get('#examples-load').dispatch('click'); await ui.settleExamples();
  reload = true; ui.get('#examples-load').dispatch('click');
  assert.equal(ui.get('#examples-select').disabled, true); assert.equal(ui.get('#examples-open').disabled, true);
  ui.get('#examples-open').dispatch('click'); assert.equal(ui.get('#example-banner').hidden, true);
  release(exampleResponse(exampleText)); await ui.settleExamples();
  assert.equal(ui.get('#examples-open').disabled, false); ui.closePage();
});

async function predictionFixture() {
  let emit;
  const event = (id, type, data = {}) => ({ id, type, data, timestamp: '2026-11-19T12:00:00.000Z' });
  const trace = createTrace({ on(fn) { emit = fn; return () => {}; }, getEvents: async () => [event('prompt', 'user.message', { content: 'Question 日本語 😀' })] });
  await trace.ready;
  return { trace, emit: (id, type, data) => emit(event(id, type, data)), response: (id, timestamp) => emit({ ...event(id, 'assistant.message', { messageId: id, content: `Answer ${id} 日本語 😀 <script>` }), ...(timestamp ? { timestamp } : {}) }) };
}

test('playback freezes evidence through live eviction, reports arrivals and returns with an explicit Follow choice', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); data.response('second'); data.response('last');
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed();
  ui.get('#playback-start').dispatch('click');
  assert.match(ui.get('#connection').textContent, /Playback.*live capture continues/);
  assert.doesNotMatch(ui.get('#timeline').textContent, /Answer second|Answer last/);
  assert.equal(ui.get('#follow').checked, false); assert.equal(ui.get('#follow').disabled, true);
  assert.equal(ui.document.activeElement, ui.get('#playback-next'));
  ui.get('#playback-next').dispatch('click');
  assert.match(ui.get('#timeline').textContent, /Answer second/); assert.doesNotMatch(ui.get('#timeline').textContent, /Answer last/);
  ui.get('#playback-next').focus(); ui.document.scrollingElement.scrollTop = 210;
  for (let i = 0; i < 305; i++) data.response(`arrival-${i}`);
  await ui.refreshFeed();
  assert.match(ui.get('#learning-activity').textContent, /305 newly received/);
  assert.match(ui.get('#timeline').textContent, /Answer second/); assert.doesNotMatch(ui.get('#timeline').textContent, /arrival/);
  assert.equal(ui.document.activeElement, ui.get('#playback-next')); assert.equal(ui.document.scrollingElement.scrollTop, 210);
  ui.get('#playback-next').dispatch('click'); assert.match(ui.get('#playback-status').textContent, /End of snapshot/);
  assert.equal(ui.get('#playback-next').attributes['aria-disabled'], 'true');
  ui.get('#playback-exit').dispatch('click');
  assert.equal(ui.get('#follow').checked, false); assert.equal(ui.get('#follow').disabled, false);
  assert.match(ui.get('#timeline').textContent, /arrival-304/); assert.doesNotMatch(ui.get('#timeline').textContent, /Answer second/);
  assert.equal(ui.document.scrollingElement.scrollTop, 210);
  ui.get('#playback-start').dispatch('click'); ui.get('#playback-follow').checked = true; ui.get('#playback-exit').dispatch('click');
  assert.equal(ui.get('#follow').checked, true); assert.equal(ui.document.scrollingElement.scrollTop, 800);
});

test('playback timers stop for manual inspection, reduced motion, replacement and page close', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); data.response('second'); data.response('third');
  const ui = fixture(appSource); ui.render(data.trace.snapshot().entries, data.trace.snapshot());
  ui.get('#playback-start').dispatch('click'); ui.get('#playback-play').dispatch('click');
  assert.equal(ui.playbackTimers.size, 1); const stale = ui.playbackCallbacks.at(-1);
  ui.get('#playback-previous').focus(); ui.get('#playback-previous').dispatch('click');
  assert.equal(ui.playbackTimers.size, 1, 'An aria-disabled boundary control must be inert when activated.');
  assert.equal(ui.document.activeElement, ui.get('#playback-previous'));
  ui.get('#playback-play').dispatch('click'); ui.get('#playback-play').dispatch('click'); stale();
  assert.doesNotMatch(ui.get('#timeline').textContent, /Answer second/); assert.equal(ui.playbackTimers.size, 1);
  ui.tickPlayback(); assert.match(ui.get('#timeline').textContent, /Answer second/);
  ui.get('#statistics-button').dispatch('click'); assert.equal(ui.playbackTimers.size, 0, 'Inspection pauses playback.');
  ui.get('#statistics-panel').close(); ui.get('#playback-play').dispatch('click'); const motionStale = ui.playbackCallbacks.at(-1);
  ui.reduceMotion(true); motionStale();
  assert.equal(ui.playbackTimers.size, 0); assert.doesNotMatch(ui.get('#timeline').textContent, /Answer third/);
  assert.match(ui.get('#playback-motion').textContent, /Reduced motion.*manual/i);
  ui.get('#playback-play').dispatch('click'); assert.equal(ui.playbackTimers.size, 0);
  ui.get('#playback-next').dispatch('click'); assert.match(ui.get('#timeline').textContent, /Answer third/);
  ui.reduceMotion(false); ui.get('#playback-previous').dispatch('click'); ui.get('#playback-play').dispatch('click');
  const replaced = ui.playbackCallbacks.at(-1); ui.get('#playback-exit').dispatch('click'); ui.get('#playback-start').dispatch('click'); replaced();
  assert.doesNotMatch(ui.get('#timeline').textContent, /Answer second/); assert.equal(ui.playbackTimers.size, 0);
  ui.get('#playback-play').dispatch('click'); const afterClose = ui.playbackCallbacks.at(-1); ui.closePage();
  const closed = ui.get('#timeline').textContent; afterClose(); ui.get('#playback-next').dispatch('click'); ui.get('#playback-start').dispatch('click');
  assert.equal(ui.get('#timeline').textContent, closed); assert.equal(ui.playbackTimers.size, 0);
});

test('nested evidence and analysis inspection pauses resumed playback and invalidates its pending callback', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); data.response('second');
  for (const [entries, selectors] of [[data.trace.snapshot().entries, ['.recorded-evidence', '.general-definition']],
    [await argumentFixture(), ['.tool-provenance', '.action-stages']]]) {
    const ui = fixture(appSource); ui.render(entries, { liveReceipt: 0 }); ui.get('#playback-start').dispatch('click');
    for (const selector of selectors) {
      const nested = ui.get('#timeline').querySelector(selector);
      assert.ok(nested, `The ${selector} inspector is present in the active prefix.`);
      const outer = nested.parentElement.closest('details'); outer.open = true; outer.dispatch('toggle');
      ui.get('#playback-play').dispatch('click'); assert.equal(ui.playbackTimers.size, 1);
      const stale = ui.playbackCallbacks.at(-1), before = ui.get('#timeline').textContent;
      const summary = nested.querySelector('summary'); summary.focus(); ui.document.scrollingElement.scrollTop = 210;
      nested.open = true; nested.dispatch('toggle');
      assert.equal(ui.playbackTimers.size, 0, `${selector} must pause playback even when its outer event is already open.`);
      stale(); assert.equal(ui.get('#timeline').textContent, before);
      assert.equal(ui.document.activeElement, summary); assert.equal(ui.document.scrollingElement.scrollTop, 210);
      assert.match(ui.get('#playback-status').textContent, /Paused.*1 of/);
    }
  }
});

test('linking an already-open validation result pauses playback before changing the analysis', async t => {
  const entries = await claimFixture({ exitCode: 0 }), data = await predictionFixture(); t.after(() => data.trace.close());
  data.response('later', '2026-11-21T00:00:00Z');
  const ui = fixture(appSource); ui.render([...entries, data.trace.snapshot().entries.at(-1)], { liveReceipt: 0 });
  ui.get('#playback-start').dispatch('click');
  for (let i = 1; i < entries.length; i++) ui.get('#playback-next').dispatch('click');
  const claim = byClass(ui.get('#timeline'), 'claim-evidence'); claim.open = true; claim.dispatch('toggle');
  const result = claim.querySelector('.claim-result'); result.open = true; result.dispatch('toggle');
  const link = result.querySelectorAll('button').find(button => button.textContent === 'Link this result');
  ui.get('#playback-play').dispatch('click'); assert.equal(ui.playbackTimers.size, 1);
  const stale = ui.playbackCallbacks.at(-1); link.focus(); link.dispatch('click');
  assert.equal(ui.playbackTimers.size, 0); stale();
  assert.match(claim.textContent, /User-linked result/); assert.doesNotMatch(ui.get('#timeline').textContent, /Answer later/);
  assert.equal(ui.document.activeElement, link);
});

test('playback and prediction controls cannot reveal each other’s hidden future and reverse stepping clears inspectors', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  data.emit('tool', 'tool.execution_start', { toolName: 'view', toolCallId: 't', arguments: { path: 'LATER-PATH' } });
  data.response('future');
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed();
  ui.get('#playback-start').dispatch('click');
  ui.get('#prediction-replay').dispatch('click'); ui.get('#prediction-live').dispatch('click');
  ui.get('#prediction-category').value = 'response'; ui.get('#prediction-record').dispatch('click'); ui.get('#prediction-skip').dispatch('click');
  assert.equal(ui.get('#prediction-controls').hidden, true); assert.doesNotMatch(ui.get('#timeline').textContent, /LATER-PATH|Answer future/);
  ui.get('#playback-next').dispatch('click'); ui.get('#arguments-button').dispatch('click');
  ui.get('#arguments-first').value = '0'; ui.get('#arguments-first').dispatch('change');
  const staleOriginal = ui.get('#arguments-first-detail').querySelector('button');
  ui.get('#playback-previous').dispatch('click'); staleOriginal.dispatch('click');
  assert.equal(ui.get('#arguments-panel').open, false); assert.equal(ui.get('#arguments-first-detail').textContent, '');
  for (const view of ['grouped', 'chronological', 'chapters', 'lanes']) {
    ui.get('#event-order').value = view; ui.get('#event-order').dispatch('change');
    assert.doesNotMatch(ui.get('#timeline').textContent, /LATER-PATH|Answer future/);
  }
  assert.doesNotMatch(ui.get('#statistics-panel').textContent, /LATER-PATH|Answer future/);
  ui.get('#playback-exit').dispatch('click'); ui.get('#prediction-replay').dispatch('click');
  ui.get('#playback-start').dispatch('click'); ui.get('#playback-next').dispatch('click'); ui.get('#playback-play').dispatch('click');
  assert.equal(ui.get('#playback-controls').hidden, true); assert.equal(ui.playbackTimers.size, 0);
  assert.doesNotMatch(ui.get('#timeline').textContent, /LATER-PATH|Answer future/);
  data.response('arrival'); await ui.refreshFeed();
  assert.match(ui.get('#learning-activity').textContent, /1 newly received/); assert.doesNotMatch(ui.get('#learning-activity').textContent, /response|arrival|LATER/);
});

test('playback empty and partial-history states stay usable and activity count is honestly unavailable', () => {
  const ui = fixture(appSource); ui.render([], { history: 'loading', omitted: 12, liveReceipt: 0 });
  ui.get('#playback-start').dispatch('click');
  assert.match(ui.get('#playback-status').textContent, /No retained events/); assert.match(ui.get('#playback-scope').textContent, /12 older.*loading/i);
  assert.match(ui.get('#learning-activity').textContent, /unknown/i);
  ui.get('#playback-play').dispatch('click'); ui.get('#playback-next').dispatch('click'); ui.get('#playback-previous').dispatch('click');
  assert.equal(ui.playbackTimers.size, 0); ui.get('#playback-exit').dispatch('click');
  assert.equal(ui.get('#playback-controls').hidden, true);
});

test('playback original links use their frozen source after a live same-ID replacement', async () => {
  const entries = await argumentFixture();
  let snapshot = { entries, history: 'ready', omitted: 0, liveReceipt: 0 };
  const ui = fixture(appSource, undefined, async () => feedResponse(snapshot)); await ui.refreshFeed();
  ui.get('#playback-start').dispatch('click'); ui.get('#playback-next').dispatch('click');
  ui.get('#arguments-button').dispatch('click'); ui.get('#arguments-first').value = '1'; ui.get('#arguments-first').dispatch('change');
  const original = ui.get('#arguments-first-detail').querySelector('button');
  snapshot = { entries: [{ ...entries[1], agentId: 'different-source', evidence: 'REPLACED-LIVE-EVIDENCE' }], history: 'ready', omitted: 2, liveReceipt: 1 };
  await ui.refreshFeed(); original.dispatch('click');
  const shown = walk(ui.get('#timeline')).find(node => node.scrolled);
  assert.ok(shown, 'The original-evidence control opens a retained snapshot row.');
  assert.match(shown.closest('details').textContent, /agent-b.*second.txt/s);
  assert.doesNotMatch(shown.closest('details').textContent, /different-source|REPLACED-LIVE/);
  ui.get('#playback-exit').dispatch('click');
  assert.match(ui.get('#timeline').textContent, /REPLACED-LIVE-EVIDENCE/);
});

test('reverse playback removes cached results and closes future glossary selections across all evidence views', async () => {
  const entries = await claimFixture({ output: 'LATER-CHECK', exitCode: 0 }), ui = fixture(appSource);
  ui.render(entries, { liveReceipt: 0 }); ui.get('#playback-start').dispatch('click');
  for (let i = 1; i < entries.length; i++) ui.get('#playback-next').dispatch('click');
  const claim = byClass(ui.get('#timeline'), 'claim-evidence');
  const select = claim.querySelectorAll('button').find(button => button.textContent === 'Link this result');
  select.dispatch('click'); assert.match(claim.textContent, /User-linked result/);
  const original = claim.querySelectorAll('button').find(button => button.textContent.startsWith('Original result'));
  ui.get('#glossary-button').dispatch('click'); ui.get('#glossary-concept').value = 'tool-result'; ui.get('#glossary-concept').dispatch('change');
  for (let i = 1; i < entries.length; i++) ui.get('#playback-previous').dispatch('click');
  select.dispatch('click'); original.dispatch('click'); ui.get('#glossary-source').dispatch('click');
  assert.equal(ui.get('#glossary-panel').open, false); assert.equal(ui.get('#glossary-example').textContent, '');
  for (const view of ['grouped', 'chronological', 'chapters', 'lanes']) {
    ui.get('#event-order').value = view; ui.get('#event-order').dispatch('change');
    assert.doesNotMatch(ui.get('#timeline').textContent, /LATER-CHECK|Tests passed/);
  }
  assert.doesNotMatch(ui.get('#statistics-panel').textContent, /LATER-CHECK|Tests passed/);
  ui.get('#event-target').value = 'result'; ui.get('#event-target').dispatch('change'); ui.get('#jump-event').dispatch('click');
  assert.equal(ui.get('#jump-event').disabled, true); assert.doesNotMatch(ui.get('#timeline').textContent, /LATER-CHECK/);
});

test('single-event playback reaches its end without disabling the focused stepping control', async () => {
  const entries = await argumentFixture(), ui = fixture(appSource); ui.render(entries.slice(0, 1), { liveReceipt: 0 });
  ui.get('#playback-start').dispatch('click');
  assert.match(ui.get('#playback-status').textContent, /1 of 1.*End of snapshot/);
  for (const action of ['previous', 'next', 'play']) {
    const control = ui.get(`#playback-${action}`); control.focus(); control.dispatch('click');
    assert.equal(control.attributes['aria-disabled'], 'true'); assert.notEqual(control.disabled, true);
    assert.equal(ui.document.activeElement, control); assert.equal(ui.playbackTimers.size, 0);
  }
});

test('live practice waits for an in-flight poll and then a fresh baseline, preserving reading and one outcome', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  let load = async () => feedResponse(data.trace.snapshot()), calls = 0;
  const ui = fixture(appSource, undefined, () => { calls++; return load(); });
  await ui.refreshFeed();
  ui.get('#prediction-live').dispatch('click');
  let release;
  load = () => new Promise(resolve => { release = resolve; });
  const pending = ui.refreshFeed(); await Promise.resolve(); await Promise.resolve();
  ui.get('#prediction-category').value = 'response'; ui.get('#prediction-record').dispatch('click');
  data.response('already-fetched'); release(feedResponse(data.trace.snapshot()));
  load = async () => feedResponse(data.trace.snapshot());
  await pending; await ui.settlePrediction();
  assert.ok(calls >= 3, 'Arming must perform a separate request after the coalesced pending poll.');
  assert.match(ui.get('#prediction-status').textContent, /Waiting.*next newly observed/);
  assert.doesNotMatch(ui.get('#timeline').textContent, /already-fetched/);
  assert.doesNotMatch(ui.get('#prediction-result').textContent, /already-fetched/);
  ui.document.scrollingElement.scrollTop = 210;
  data.emit('hook', 'hook.start'); data.response('chosen'); data.response('future');
  await ui.refreshFeed();
  assert.match(ui.get('#prediction-result').textContent, /chosen.*日本語 😀 <script>/s);
  assert.doesNotMatch(ui.get('#prediction-result').textContent, /future|already-fetched/);
  assert.doesNotMatch(ui.get('#timeline').textContent, /future|already-fetched/);
  assert.equal(ui.document.scrollingElement.scrollTop, 210);
  assert.equal(ui.get('#follow').checked, false);
  ui.get('#prediction-follow').checked = false; ui.get('#prediction-exit').dispatch('click');
  assert.match(ui.get('#timeline').textContent, /future/);
  assert.equal(ui.get('#follow').checked, false);
  assert.match(ui.get('#prediction-status').textContent, /current live view.*paused/i);
});

test('replay hides future evidence across views and clears inspectors while live capture keeps updating', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  data.response('first');
  data.emit('secret-tool', 'tool.execution_start', { toolName: 'view', toolCallId: 'future-call', arguments: { path: 'FUTURE-PATH' } });
  data.emit('secret-skill', 'skill.invoked', { name: 'FUTURE-SKILL', content: 'FUTURE-BODY' });
  const ui = fixture(appSource, async () => emptyInventory(new Date().toISOString()),
    async () => feedResponse(data.trace.snapshot()), async () => instructionInventory('FUTURE-CATALOG'));
  await ui.refreshFeed(); await ui.refreshInstructions();
  const catalogButton = ui.get('#instruction-current').querySelector('button'); catalogButton.dispatch('click');
  ui.get('#arguments-button').dispatch('click');
  ui.get('#prediction-replay').dispatch('click');
  assert.equal(ui.get('#arguments-panel').open, false);
  assert.equal(ui.get('#instruction-sources').hidden, true);
  assert.equal(ui.get('#capabilities').hidden, true);
  assert.equal(ui.get('#instruction-body').textContent, '');
  assert.equal(ui.get('#arguments-first').textContent, '');
  catalogButton.dispatch('click');
  assert.equal(ui.get('#instruction-body').textContent, '', 'A stale inspector control cannot restore the future.');
  for (const view of ['grouped', 'chronological', 'chapters', 'lanes']) {
    ui.get('#event-order').value = view; ui.get('#event-order').dispatch('change');
    assert.doesNotMatch(ui.get('#timeline').textContent, /Answer first|FUTURE/);
  }
  ui.get('#statistics-button').dispatch('click');
  assert.doesNotMatch(ui.get('#statistics-panel').textContent, /FUTURE/);
  ui.get('#statistics-panel').close();
  ui.get('#glossary-button').dispatch('click');
  ui.get('#glossary-concept').value = 'skill'; ui.get('#glossary-concept').dispatch('change');
  assert.doesNotMatch(ui.get('#glossary-panel').textContent, /FUTURE/);
  ui.get('#glossary-panel').close();
  data.response('new-live'); await ui.refreshFeed();
  assert.doesNotMatch(ui.get('#timeline').textContent, /new-live|FUTURE/);
  ui.get('#prediction-category').value = 'response'; ui.get('#prediction-record').dispatch('click');
  assert.match(ui.get('#prediction-result').textContent, /Answer first/);
  assert.doesNotMatch(ui.get('#timeline').textContent, /FUTURE|new-live/);
  ui.get('#prediction-next').dispatch('click'); ui.get('#prediction-skip').dispatch('click');
  assert.match(ui.get('#prediction-status').textContent, /Skipped/);
  assert.doesNotMatch(ui.get('#prediction-result').textContent, /wrong|score/i);
  ui.get('#prediction-follow').checked = true; ui.get('#prediction-exit').dispatch('click');
  assert.match(ui.get('#timeline').textContent, /new-live/);
  assert.equal(ui.get('#follow').checked, true);
  assert.equal(ui.get('#instruction-sources').hidden, false);
});

test('skip, disconnect and page close invalidate a live prediction and late baseline responses', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  let load = async () => feedResponse(data.trace.snapshot());
  const ui = fixture(appSource, undefined, () => load()); await ui.refreshFeed();
  ui.get('#prediction-live').dispatch('click');
  ui.get('#prediction-category').value = 'response'; ui.get('#prediction-record').dispatch('click');
  await ui.settlePrediction();
  load = async () => feedResponse(null, 503); await ui.refreshFeed();
  assert.match(ui.get('#prediction-status').textContent, /Unanswered.*connection/i);
  load = async () => feedResponse(data.trace.snapshot()); data.response('later'); await ui.refreshFeed();
  assert.doesNotMatch(ui.get('#prediction-result').textContent, /Answer later/);
  ui.get('#prediction-next').dispatch('click');
  let release; load = () => new Promise(resolve => { release = resolve; });
  ui.get('#prediction-record').dispatch('click'); await Promise.resolve(); await Promise.resolve();
  ui.get('#prediction-skip').dispatch('click');
  release(feedResponse(data.trace.snapshot())); await ui.settlePrediction();
  assert.match(ui.get('#prediction-status').textContent, /Skipped/);
  ui.closePage(); const before = ui.get('#prediction-status').textContent;
  ui.get('#prediction-record').dispatch('click'); ui.get('#prediction-exit').dispatch('click');
  assert.equal(ui.get('#prediction-status').textContent, before);
});

test('retained practice clears future hook, compaction, result and claim content from previously rendered groups', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  data.emit('hook-start', 'hook.start', { hookInvocationId: 'h', hookType: 'preToolUse' });
  data.emit('compact-start', 'session.compaction_start', { compactionAttemptId: 'c' });
  data.response('first');
  data.emit('hook-end', 'hook.end', { hookInvocationId: 'h', hookType: 'preToolUse', success: true, output: 'FUTURE-HOOK' });
  data.emit('compact-end', 'session.compaction_complete', { compactionAttemptId: 'c', success: true, summaryContent: 'FUTURE-COMPACT' });
  data.emit('command', 'tool.execution_start', { toolName: 'powershell', toolCallId: 'check', arguments: { command: 'npm test', description: 'Test' } });
  data.emit('result', 'tool.execution_complete', { toolCallId: 'check', success: true, result: { content: 'FUTURE-RESULT' } });
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed();
  assert.match(ui.get('#timeline').textContent, /FUTURE/);
  ui.get('#prediction-replay').dispatch('click');
  for (const view of ['grouped', 'chronological', 'chapters', 'lanes']) {
    ui.get('#event-order').value = view; ui.get('#event-order').dispatch('change');
    assert.doesNotMatch(ui.get('#timeline').textContent, /FUTURE/);
  }
  assert.doesNotMatch(ui.get('#statistics-panel').textContent, /FUTURE/);
  ui.get('#prediction-category').value = 'response'; ui.get('#prediction-record').dispatch('click');
  assert.doesNotMatch(ui.get('#timeline').textContent, /FUTURE/);
  ui.get('#prediction-next').dispatch('click'); ui.get('#prediction-record').dispatch('click');
  assert.match(ui.get('#timeline').textContent, /FUTURE-HOOK|FUTURE-COMPACT/);
  assert.doesNotMatch(ui.get('#timeline').textContent, /FUTURE-RESULT/);
  assert.doesNotMatch(ui.get('#statistics-panel').textContent, /FUTURE-RESULT/);
});

test('practice aborts pending catalog reads, ignores late responses and releases a held baseline on page close', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); data.response('future');
  let releaseCatalog, releaseInventory, releaseFeed, loads = 0, catalogReads = 0;
  const ui = fixture(appSource, () => new Promise(resolve => { releaseInventory = resolve; }),
    async () => { loads++; return loads > 1 ? new Promise(resolve => { releaseFeed = resolve; }) : feedResponse(data.trace.snapshot()); },
    () => { catalogReads++; return new Promise(resolve => { releaseCatalog = resolve; }); });
  await ui.refreshFeed();
  const catalog = ui.refreshInstructions(), inventory = ui.refreshCapabilities();
  ui.get('#prediction-replay').dispatch('click');
  releaseCatalog(instructionInventory('FUTURE-CATALOG')); releaseInventory(emptyInventory(new Date().toISOString()));
  await Promise.all([catalog, inventory]);
  assert.doesNotMatch(ui.get('#statistics-panel').textContent, /FUTURE-CATALOG|future/);
  await ui.refreshInstructions(); assert.equal(catalogReads, 1);
  ui.get('#prediction-exit').dispatch('click'); ui.get('#prediction-live').dispatch('click');
  ui.get('#prediction-category').value = 'response'; ui.get('#prediction-record').dispatch('click');
  await Promise.resolve(); await Promise.resolve();
  ui.closePage();
  const frozen = ui.get('#timeline').textContent, status = ui.get('#prediction-status').textContent;
  data.response('late-after-close'); releaseFeed(feedResponse(data.trace.snapshot())); await ui.settlePrediction();
  assert.equal(ui.get('#timeline').textContent, frozen); assert.equal(ui.get('#prediction-status').textContent, status);
  assert.equal(loads, 2, 'Closing during the coalesced baseline phase must not start another request.');
});

test('an unknown prediction source is never presented as the main chat', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); data.response('unknown-source');
  for (const agentId of [null, '   ']) {
    const snapshot = data.trace.snapshot(); snapshot.entries[1] = { ...snapshot.entries[1], agentId };
    const ui = fixture(appSource); ui.render(snapshot.entries, snapshot);
    ui.get('#prediction-replay').dispatch('click');
    ui.get('#prediction-category').value = 'response'; ui.get('#prediction-record').dispatch('click');
    assert.match(ui.get('#prediction-result').textContent, /Source unavailable/);
    assert.doesNotMatch(ui.get('#prediction-result').textContent, /Main chat/);
    assert.match(ui.get('#prediction-status').textContent, /unknown/i);
  }
});

test('retained practice removes cached claim results and blocks detached future source controls', async () => {
  const entries = await claimFixture({ output: 'UNREVEALED-CHECK', exitCode: 0 }), ui = fixture(appSource);
  ui.render(entries, { liveReceipt: 0 });
  const claim = byClass(ui.get('#timeline'), 'claim-evidence');
  const select = claim.querySelectorAll('button').find(button => button.textContent === 'Link this result');
  select.dispatch('click'); assert.match(claim.textContent, /User-linked result/);
  const original = claim.querySelectorAll('button').find(button => button.textContent.startsWith('Original result'));
  ui.get('#prediction-replay').dispatch('click');
  assert.doesNotMatch(ui.get('#timeline').textContent, /UNREVEALED-CHECK|Tests passed/);
  assert.doesNotMatch(ui.get('#statistics-panel').textContent, /UNREVEALED-CHECK/);
  select.dispatch('click'); original.dispatch('click');
  ui.get('#prediction-category').value = 'execute'; ui.get('#prediction-record').dispatch('click');
  assert.doesNotMatch(ui.get('#timeline').textContent, /UNREVEALED-CHECK|Tests passed/);
  assert.doesNotMatch(ui.get('#statistics-panel').textContent, /UNREVEALED-CHECK/);
});

test('live receipt outcomes still render in recorded timestamp order', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed();
  ui.get('#event-order').value = 'chronological'; ui.get('#event-order').dispatch('change');
  ui.get('#prediction-live').dispatch('click'); ui.get('#prediction-category').value = 'response';
  ui.get('#prediction-record').dispatch('click'); await ui.settlePrediction();
  data.response('delayed', '2026-11-18T00:00:00Z'); await ui.refreshFeed();
  assert.match(ui.get('#timeline').firstElementChild.textContent, /Answer delayed/);
  assert.match(ui.get('#prediction-result').textContent, /Trace live receipt 1.*boundary 0/);
});

async function argumentFixture(mcp = false) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => [0, 1, 2].map(index => ({
    id: `argument-${index}`, type: 'tool.execution_start', agentId: index === 1 ? 'agent-b' : undefined,
    data: { toolCallId: `call-${index}`, toolName: mcp ? 'mcp.query' : 'view',
      ...(mcp ? { mcpConfigServerName: 'service-a', mcpToolName: 'query', mcpServerDisplayName: 'Shared' } : {}),
      arguments: mcp ? { nested: { text: '<script>日🧪</script>\nnext', value: index === 0 ? null : [null, 'new'] }, ...(index ? { added: null } : {}) }
        : { path: index === 0 ? 'first.txt' : 'second.txt' } },
  })) });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}
function chooseArguments(ui, first = '0', second = '1') {
  for (const [id, value] of [['first', first], ['second', second]]) {
    const select = ui.get(`#arguments-${id}`); select.value = value; select.dispatch('change');
  }
}

test('argument comparison requires two explicit choices and exposes nested MCP null changes as literal JSON in the usable panel', async () => {
  const entries = await argumentFixture(true), ui = fixture(appSource); ui.render(entries);
  ui.document.scrollingElement.scrollTop = 200; ui.get('#arguments-button').dispatch('click');
  assert.equal(ui.get('#arguments-panel').open, true); assert.equal(ui.get('#follow').checked, false);
  assert.equal(ui.get('#arguments-first').value, ''); assert.equal(ui.get('#arguments-second').value, '');
  assert.equal(ui.get('#arguments-diff').children.length, 0);
  assert.equal(ui.document.activeElement, ui.get('#arguments-panel').querySelector('button'));
  chooseArguments(ui);
  assert.match(ui.get('#arguments-status').textContent, /1 added.*1 changed.*1 identical/);
  const rows = ui.get('#arguments-diff').children;
  assert.match(rows[0].textContent, /added.*\["added"\].*Absent.*null/is);
  assert.match(rows[2].textContent, /changed.*\["nested"\]\["value"\].*null.*\[null,"new"\]/is);
  assert.equal(rows[1].querySelector('pre').textContent, '"<script>日🧪</script>\\nnext"');
  assert.match(ui.get('#arguments-limits').textContent, /literal JSON.*historical.*schema.*unknown/is);
  assert.match(ui.get('#arguments-second-detail').textContent, /agent-b.*call-1.*argument-1.*service-a/s);
  assert.equal(ui.get('#arguments-panel').querySelectorAll('script').length, 0);
  assert.equal(ui.document.scrollingElement.scrollTop, 200);
});

test('comparison choices and rendered values stay frozen through live arrivals, view changes and filtering, then close clears local evidence', async () => {
  const entries = await argumentFixture(), ui = fixture(appSource); ui.render(entries.slice(0, 2)); ui.get('#arguments-button').dispatch('click');
  chooseArguments(ui); const diff = ui.get('#arguments-diff'), row = diff.firstElementChild;
  const link = ui.get('#arguments-first-detail').querySelector('button'); link.focus();
  diff.scrollTop = 30; ui.get('#arguments-panel').scrollTop = 90; ui.document.scrollingElement.scrollTop = 220;
  ui.render(entries);
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change'); filterMode(ui, 'automation');
    assert.equal(ui.get('#arguments-first').children.length, 3); assert.equal(ui.get('#arguments-first').value, '0');
    assert.equal(diff.firstElementChild, row); assert.equal(ui.document.activeElement, link);
    assert.equal(diff.scrollTop, 30); assert.equal(ui.get('#arguments-panel').scrollTop, 90); assert.equal(ui.document.scrollingElement.scrollTop, 220);
  }
  ui.get('#arguments-panel').dispatch('cancel'); assert.equal(ui.get('#arguments-panel').open, false);
  assert.equal(ui.document.activeElement, ui.get('#arguments-button'));
  assert.equal(diff.children.length, 0); assert.equal(ui.get('#arguments-first-detail').textContent, '');
  ui.get('#arguments-button').dispatch('click'); assert.equal(ui.get('#arguments-first').value, '');
  assert.equal(ui.get('#arguments-first').children.length, 4);
  chooseArguments(ui); ui.closePage(); assert.equal(diff.children.length, 0);
  ui.get('#arguments-button').dispatch('click'); assert.equal(ui.get('#arguments-first').children.length, 0);
});

test('frozen selections invalidate permanently after replacement, duplication or eviction without navigation or focus loss', async () => {
  const entries = await argumentFixture();
  for (const mutate of [items => items.shift(), items => items.push({ ...items[0] }), items => { items[0].evidence += ' '; },
    items => { items[0].toolCallId = 'replacement'; }, items => { items.push({ ...items[0], id: 'duplicate-call' }); }]) {
    const ui = fixture(appSource); ui.render(entries); ui.get('#arguments-button').dispatch('click'); chooseArguments(ui);
    const link = ui.get('#arguments-first-detail').querySelector('button'); link.focus(); ui.document.scrollingElement.scrollTop = 210;
    const changed = structuredClone(entries); mutate(changed); ui.render(changed);
    assert.match(ui.get('#arguments-status').textContent, /unavailable.*changed|changed.*unavailable/is);
    assert.equal(ui.get('#arguments-diff').children.length, 0); assert.equal(ui.document.activeElement, link);
    ui.render(entries); link.dispatch('click');
    assert.equal(ui.get('#arguments-panel').open, true); assert.equal(ui.document.scrollingElement.scrollTop, 210);
    assert.equal(ui.get('#arguments-diff').children.length, 0);
  }
});

test('both original call links use guarded evidence navigation even when argument comparison is unsupported', async () => {
  const entries = await argumentFixture(); const raw = JSON.parse(entries[1].evidence); raw.data.arguments.path = null;
  entries[1].evidence = JSON.stringify(raw);
  for (const which of ['first', 'second']) {
    const ui = fixture(appSource); ui.render(entries); ui.get('#arguments-button').dispatch('click'); chooseArguments(ui);
    assert.match(ui.get('#arguments-status').textContent, /schema|unsupported/i); assert.equal(ui.get('#arguments-diff').children.length, 0);
    filterMode(ui, 'automation'); ui.get(`#arguments-${which}-detail`).querySelector('button').dispatch('click');
    assert.equal(ui.get('#arguments-panel').open, false); assert.equal(ui.get('#event-order').value, 'chronological');
    assert.equal(ui.get('#activity-filter').value, 'everything'); assert.equal(ui.get('#follow').checked, false);
    assert.match(ui.get('#navigation-status').textContent, /original.*arguments/i);
    assert.equal(ui.document.activeElement.parentElement.open, true);
  }
});

test('discarded comparison controls cannot navigate after a selection change or dialog close and reopen', async () => {
  const entries = await argumentFixture();
  for (const discard of [ui => chooseArguments(ui, '2', '1'), ui => {
    ui.get('#arguments-panel').dispatch('cancel'); ui.get('#arguments-button').dispatch('click'); chooseArguments(ui);
  }]) {
    const ui = fixture(appSource); ui.render(entries); ui.get('#arguments-button').dispatch('click'); chooseArguments(ui);
    const old = ui.get('#arguments-first-detail').querySelector('button'); discard(ui);
    ui.document.scrollingElement.scrollTop = 225; old.dispatch('click');
    assert.equal(ui.get('#arguments-panel').open, true); assert.equal(ui.document.scrollingElement.scrollTop, 225);
  }
});

test('malformed and clipped unknown-source comparison choices never attribute their evidence to Main chat', async () => {
  for (const [agentId, path] of [[null, 'file.txt'], [17, 'file.txt'], ['x'.repeat(257), 'file.txt'], [null, 'x'.repeat(13000)]]) {
    const trace = createTrace({ on() { return () => {}; }, getEvents: async () => [
      { id: 'unknown-source', type: 'tool.execution_start', agentId, data: { toolCallId: 'unknown-call', toolName: 'view', arguments: { path } } },
      { id: 'known-source', type: 'tool.execution_start', data: { toolCallId: 'known-call', toolName: 'view', arguments: { path: 'other.txt' } } },
    ] });
    await trace.ready; const entries = trace.snapshot().entries; trace.close();
    const ui = fixture(appSource); ui.render(entries); ui.get('#arguments-button').dispatch('click'); chooseArguments(ui);
    assert.match(ui.get('#arguments-first').children[1].textContent, /Source unavailable/);
    assert.doesNotMatch(ui.get('#arguments-first').children[1].textContent, /Main chat/);
    assert.match(ui.get('#arguments-first-detail').textContent, /Source unavailable/);
    assert.doesNotMatch(ui.get('#arguments-first-detail').textContent, /Main chat/);
    assert.match(ui.get('#arguments-second-detail').textContent, /Main chat/);
    assert.equal(ui.get('#arguments-diff').children.length, 0);
    ui.document.scrollingElement.scrollTop = 200; ui.get('#arguments-first-detail').querySelector('button').dispatch('click');
    assert.equal(ui.get('#arguments-panel').open, true); assert.equal(ui.document.scrollingElement.scrollTop, 200);
  }
});

test('protected arguments never produce a precise diff and both original links expose readable projection-omission notices', async () => {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => ['protected-one', 'protected-two'].map((value, index) => ({
    id: `protected-${index}`, type: 'tool.execution_start', data: { toolCallId: `protected-call-${index}`, toolName: 'mcp.query',
      mcpConfigServerName: 'service-a', mcpToolName: 'query', arguments: { nested: { reasoningOpaque: value, keep: 'same' } } },
  })) });
  await trace.ready; const entries = trace.snapshot().entries; trace.close();
  for (const side of ['first', 'second']) {
    const ui = fixture(appSource); ui.render(entries); ui.get('#arguments-button').dispatch('click'); chooseArguments(ui);
    assert.equal(ui.get('#arguments-diff').children.length, 0);
    assert.match(ui.get('#arguments-status').textContent, /protected.*omitted.*original.*incomplete/is);
    assert.match(ui.get(`#arguments-${side}-detail`).textContent, /protected.*omitted.*original.*incomplete/is);
    ui.get(`#arguments-${side}-detail`).querySelector('button').dispatch('click');
    assert.equal(ui.get('#arguments-panel').open, false);
    const original = ui.document.activeElement.parentElement.querySelector('.recorded-evidence');
    const notice = original.querySelector('.evidence-protected'); assert.ok(notice); assert.equal(notice.hidden, false);
    assert.match(notice.textContent, /protected.*omitted.*incomplete.*cannot.*recover/is);
    assert.doesNotMatch(original.querySelector('pre').textContent, /protected-one|protected-two/);
  }
});

test('changing only the protected-content marker invalidates comparison selection and updates retained evidence notices', async () => {
  const entries = await argumentFixture(true), ui = fixture(appSource); ui.render(entries);
  ui.get('#arguments-button').dispatch('click'); chooseArguments(ui);
  const link = ui.get('#arguments-first-detail').querySelector('button'); link.focus();
  const changed = structuredClone(entries); changed[0].protectedContentOmitted = true;
  ui.document.scrollingElement.scrollTop = 210; ui.render(changed);
  assert.equal(ui.get('#arguments-diff').children.length, 0); assert.equal(ui.document.activeElement, link);
  assert.match(ui.get('#arguments-status').textContent, /unavailable.*changed/is);
  link.dispatch('click'); assert.equal(ui.get('#arguments-panel').open, true); assert.equal(ui.document.scrollingElement.scrollTop, 210);
  assert.equal(ui.get('#timeline').querySelectorAll('.evidence-protected').filter(node => !node.hidden).length, 1);
  ui.render(entries); assert.equal(ui.get('#timeline').querySelectorAll('.evidence-protected').filter(node => !node.hidden).length, 0);
  link.dispatch('click'); assert.equal(ui.get('#arguments-panel').open, true);
});

test('an invalid protected-content marker reports unknown completeness in the comparison and retained original', async () => {
  const entries = await argumentFixture(true); entries[0].protectedContentOmitted = 'true';
  const ui = fixture(appSource); ui.render(entries); ui.get('#arguments-button').dispatch('click'); chooseArguments(ui);
  assert.equal(ui.get('#arguments-diff').children.length, 0);
  assert.match(ui.get('#arguments-status').textContent, /omission.*invalid.*complete.*unknown/is);
  ui.get('#arguments-first-detail').querySelector('button').dispatch('click');
  const notice = ui.document.activeElement.parentElement.querySelector('.evidence-protected');
  assert.ok(notice); assert.equal(notice.hidden, false); assert.match(notice.textContent, /omission.*invalid.*complete.*unknown/is);
});

async function repeatedFixture() {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => [0, 1, 2].flatMap(index => [
    { id: `repeat-${index}-start`, type: 'tool.execution_start', data: { toolCallId: `repeat-${index}`, toolName: 'view',
      arguments: { path: '<script>日🧪</script>\n file' } } },
    { id: `repeat-${index}-end`, type: 'tool.execution_complete', data: { toolCallId: `repeat-${index}`, success: index === 2 } },
  ]) });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}

test('repeated operations stay quiet and preserve occurrence focus, disclosures and reading position through arrivals and eviction', async () => {
  const entries = await repeatedFixture(), ui = fixture(appSource); ui.render(entries.slice(0, 3));
  const list = ui.get('#repeated-list'), disclosure = ui.get('#repeated-activity');
  assert.equal(list.children.length, 1); assert.equal(disclosure.open, false);
  assert.match(list.textContent, /2 exact repeated invocations/); assert.match(list.textContent, /Result not retained/);
  ui.get('#statistics-button').dispatch('click'); disclosure.open = true; disclosure.dispatch('toggle');
  const row = list.firstElementChild, details = row.querySelector('details'), occurrences = row.querySelector('ol');
  details.open = true; const link = occurrences.children[1].querySelector('button'); link.focus();
  list.scrollTop = 55; ui.get('#statistics-panel').scrollTop = 120; ui.document.scrollingElement.scrollTop = 230;
  ui.render(entries);
  assert.match(row.textContent, /3 exact repeated invocations/); assert.match(row.textContent, /2 reported tool failures/);
  assert.equal(row.querySelector('pre').textContent, JSON.stringify({ path: '<script>日🧪</script>\n file' }, null, 2));
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change'); filterMode(ui, 'automation');
    assert.equal(list.firstElementChild, row); assert.equal(ui.document.activeElement, link); assert.equal(details.open, true);
    assert.equal(list.scrollTop, 55); assert.equal(ui.get('#statistics-panel').scrollTop, 120);
    assert.equal(ui.document.scrollingElement.scrollTop, 230); assert.equal(ui.get('#follow').checked, false);
  }
  ui.render(entries.slice(2), { omitted: 2 });
  assert.equal(list.firstElementChild, row); assert.equal(ui.document.activeElement, link);
  assert.match(row.textContent, /2 exact repeated invocations/); assert.match(ui.get('#repeated-scope').textContent, /2 older events.*omitted/i);
  assert.equal(disclosure.attributes['aria-live'], undefined); assert.equal(list.attributes.role, undefined);
  assert.equal(list.querySelectorAll('script').length, 0); assert.equal(list.querySelectorAll('a').length, 0);
  ui.render(entries.slice(4)); assert.equal(list.children.length, 0); assert.equal(ui.document.activeElement, list);
  assert.equal(ui.document.scrollingElement.scrollTop, 230); assert.equal(ui.get('#statistics-panel').scrollTop, 120);
});

test('repetition links navigate exact originals and reject changed, evicted, reused and closed evidence', async () => {
  const entries = await repeatedFixture();
  for (const mutate of [items => { items[0] = { ...items[0], timestamp: 'changed' }; }, items => items.splice(0, 1),
    items => items.push({ ...items[0] })]) {
    const ui = fixture(appSource); ui.render(entries); ui.get('#statistics-button').dispatch('click');
    const button = ui.get('#repeated-list').querySelector('button'); const changed = structuredClone(entries); mutate(changed); ui.render(changed);
    ui.document.scrollingElement.scrollTop = 210; button.dispatch('click');
    assert.equal(ui.document.scrollingElement.scrollTop, 210); assert.equal(ui.get('#statistics-panel').open, true);
    assert.match(ui.get('#navigation-status').textContent, /no longer|unchanged/i);
  }
  const ui = fixture(appSource); ui.render(entries); ui.get('#statistics-button').dispatch('click'); filterMode(ui, 'automation');
  const button = ui.get('#repeated-list').querySelector('button'); button.dispatch('click');
  assert.equal(ui.get('#statistics-panel').open, false); assert.equal(ui.get('#activity-filter').value, 'everything');
  assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#follow').checked, false);
  ui.closePage(); ui.document.scrollingElement.scrollTop = 210; button.dispatch('click');
  assert.equal(ui.get('#repeated-list').children.length, 0); assert.equal(ui.document.scrollingElement.scrollTop, 210);
});

test('late repeated results retain argument focus and replaced result links cannot target new evidence', async () => {
  const entries = await repeatedFixture(), ui = fixture(appSource); ui.render(entries.slice(0, 3));
  const list = ui.get('#repeated-list'), pattern = list.firstElementChild;
  ui.get('#statistics-button').dispatch('click');
  const occurrence = pattern.querySelector('ol').children[1], argument = occurrence.querySelector('button'); argument.focus();
  ui.document.scrollingElement.scrollTop = 180; ui.render(entries.slice(0, 4));
  assert.equal(pattern.querySelector('ol').children[1], occurrence); assert.equal(ui.document.activeElement, argument);
  const result = occurrence.querySelectorAll('button').find(button => button.textContent === 'Original result');
  assert.ok(result); assert.match(occurrence.textContent, /Tool protocol: failure/);
  const changed = structuredClone(entries.slice(0, 4)); changed[3].evidence = '{}'; ui.render(changed);
  result.dispatch('click'); assert.equal(ui.document.scrollingElement.scrollTop, 180); assert.equal(ui.get('#statistics-panel').open, true);
  assert.match(occurrence.textContent, /Tool protocol: unknown/); assert.equal(occurrence.querySelectorAll('button').length, 1);
});

async function observedFixture() {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => [
    { id: 'observed-start', type: 'tool.execution_start', timestamp: '2026-11-20T12:00:00Z',
      data: { toolCallId: 'observed-call', toolName: '<script>日🧪' } },
    { id: 'observed-request', type: 'permission.requested', timestamp: '2026-11-20T12:00:01Z',
      data: { requestId: 'observed-permission', permissionRequest: { kind: 'shell', toolCallId: 'observed-call' } } },
    { id: 'observed-result', type: 'tool.execution_complete', timestamp: '2026-11-20T12:00:02Z',
      data: { toolCallId: 'observed-call', success: false } },
  ] });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}

test('observed activity keeps literal overlapping evidence and reading state across views, then guards expired links', async () => {
  const entries = await observedFixture(), ui = fixture(appSource); ui.render(entries.slice(0, 2));
  const disclosure = ui.get('#observed-activity'), list = ui.get('#observed-list');
  assert.equal(disclosure.open, false); assert.equal(list.children.length, 2);
  assert.match(list.textContent, /Tool completion not observed.*Permission decision not observed/s);
  assert.match(list.textContent, /<script>日🧪/); assert.equal(list.querySelectorAll('script').length, 0);
  ui.get('#statistics-button').dispatch('click'); disclosure.open = true; disclosure.dispatch('toggle');
  const link = list.querySelector('button'); link.focus();
  ui.get('#statistics-panel').scrollTop = 120; list.scrollTop = 70; ui.document.scrollingElement.scrollTop = 230;
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
    assert.equal(list.querySelector('button'), link); assert.equal(ui.document.activeElement, link);
    assert.equal(disclosure.open, true); assert.equal(list.scrollTop, 70);
    assert.equal(ui.get('#statistics-panel').scrollTop, 120); assert.equal(ui.document.scrollingElement.scrollTop, 230);
    assert.equal(ui.get('#follow').checked, false);
  }
  filterMode(ui, 'automation'); link.dispatch('click');
  assert.equal(ui.get('#statistics-panel').open, false); assert.equal(ui.get('#activity-filter').value, 'everything');
  assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#follow').checked, false);
  ui.get('#statistics-button').dispatch('click'); link.focus(); ui.render(entries);
  assert.equal(list.children.length, 1, 'Completion removes the invocation row but does not invent a permission decision.');
  assert.equal(ui.document.activeElement, list, 'An evicted focused item moves focus to the stable list.');
  ui.get('#follow').checked = true; ui.document.scrollingElement.scrollTop = 333; link.dispatch('click');
  assert.match(ui.get('#navigation-status').textContent, /no longer.*activity|no longer retained/i);
  assert.equal(ui.document.scrollingElement.scrollTop, 333); assert.equal(ui.get('#follow').checked, true);
  const changed = structuredClone(entries[0]), raw = JSON.parse(changed.evidence);
  raw.data.arguments = { command: 'A different retained invocation' }; changed.evidence = JSON.stringify(raw);
  ui.render([changed]); link.dispatch('click');
  assert.match(ui.get('#navigation-status').textContent, /no longer.*activity|no longer retained/i);
  assert.equal(ui.document.scrollingElement.scrollTop, 333); assert.equal(ui.get('#follow').checked, true);
  ui.render([], { omitted: 3 }); assert.equal(list.children.length, 0); assert.match(ui.get('#observed-scope').textContent, /Older events were omitted/);
});

test('observed activity distinguishes feed receipts and host time through 304, disconnect and recovery without announcements', async () => {
  const entries = (await observedFixture()).slice(0, 1); let now = Date.parse('2026-11-20T12:00:10Z');
  class Clock extends Date { static now() { return now; } }
  let response = feedResponse({ entries, history: 'ready', omitted: 0 });
  const ui = fixture(appSource, undefined, async () => response, undefined, Clock);
  await ui.refreshFeed();
  const list = ui.get('#observed-list'), row = list.firstElementChild, disclosure = ui.get('#observed-activity');
  assert.match(ui.get('#observed-time').textContent, /2026-11-20T12:00:00Z.*10 s/s);
  assert.match(ui.get('#observed-feed').textContent, /2026-11-20T12:00:10.000Z/);
  disclosure.open = true; disclosure.dispatch('toggle'); row.querySelector('button').focus();
  ui.get('#statistics-panel').scrollTop = 100; ui.document.scrollingElement.scrollTop = 240;
  now += 60000; response = feedResponse(null, 304); await ui.refreshFeed();
  assert.equal(list.firstElementChild, row); assert.match(ui.get('#observed-time').textContent, /12:00:00Z.*70 s/s);
  assert.match(ui.get('#observed-feed').textContent, /12:01:10.000Z.*no new retained events received/s);
  assert.equal(ui.get('#statistics-panel').scrollTop, 100); assert.equal(ui.document.scrollingElement.scrollTop, 240);
  response = feedResponse(null, 503); await ui.refreshFeed();
  assert.match(ui.get('#connection').textContent, /Disconnected/); assert.match(ui.get('#observed-feed').textContent, /cached|stale/i);
  assert.equal(list.firstElementChild, row); assert.match(list.textContent, /completion not observed/i);
  assert.doesNotMatch(list.textContent, /inactive|stuck|thinking|still running/i);
  response = feedResponse(null, 304); await ui.refreshFeed();
  assert.match(ui.get('#connection').textContent, /Connected/); assert.doesNotMatch(ui.get('#observed-feed').textContent, /cached|stale/i);
  assert.ok(walk(disclosure).every(node => node.attributes.role !== 'status' && !node.attributes['aria-live']));
  ui.render([{ ...entries[0], timestamp: '2027-01-01T12:00:00Z' }]); assert.match(ui.get('#observed-time').textContent, /unknown/i);
  ui.closePage(); assert.equal(list.children.length, 0); assert.equal(await ui.refreshFeed(), false);
});

test('an in-flight feed response after page close cannot recreate observed activity', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const ui = fixture(appSource, undefined, () => pending); const refresh = ui.refreshFeed();
  ui.closePage(); release(feedResponse({ entries: (await observedFixture()).slice(0, 1), history: 'ready', omitted: 0 }));
  assert.equal(await refresh, false); assert.equal(ui.get('#observed-list').children.length, 0);
});

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
    assert.equal(ui.document.activeElement, replacement && replacement.type === start.type ? opener : ui.get('#glossary-button'));
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

async function handoffFixture(result = 'Exact returned <script>café 🧪</script>\r\n日', extra = []) {
  const raw = [
    { id: 'delegate-task', type: 'tool.execution_start', data: { toolCallId: 'delegate-call', toolName: 'task',
      arguments: { prompt: 'Exact delegated <prompt> 🧪\r\n日', description: 'Literal <description>', agent_type: 'fixture', mode: 'sync' } } },
    { id: 'delegate-start', type: 'subagent.started', agentId: 'child', data: { toolCallId: 'delegate-call', agentName: 'fixture', agentDisplayName: 'Same name' } },
    { id: 'delegate-activity', type: 'assistant.message', agentId: 'child', data: { parentToolCallId: 'delegate-call', content: 'Child activity' } },
    ...extra,
    { id: 'delegate-end', type: 'subagent.completed', agentId: 'child', data: { toolCallId: 'delegate-call', agentName: 'fixture', cancelled: false } },
    { id: 'delegate-result', type: 'tool.execution_complete', data: { toolCallId: 'delegate-call', success: true, result: { content: result } } },
  ].map(entry => ({ timestamp: '2026-11-20T12:00:00Z', ...entry }));
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}

async function recoveryFixture(count = 1, result = 'Exact later <script>日🧪</script>') {
  const raw = Array.from({ length: count + 1 }, (_, index) => [
    { id: `attempt-${index}-start`, type: 'tool.execution_start', data: { toolCallId: `attempt-${index}`, toolName: 'view',
      arguments: { path: '<file>日🧪', view_range: [index + 1, index + 10] } } },
    { id: `attempt-${index}-end`, type: 'tool.execution_complete', data: { toolCallId: `attempt-${index}`, success: index > 0,
      ...(index ? { result: { content: result } } : { error: { message: 'Original failed <request>' } }) } },
  ]).flat().map(entry => ({ timestamp: '2026-11-20T12:00:00Z', ...entry }));
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}

async function claimFixture({ count = 1, output = 'PASS <script>日🧪</script>\n', statement = 'Tests passed.', exitCode = 1 } = {}) {
  const raw = Array.from({ length: count }, (_, index) => [
    { id: `validation-${index}-start`, type: 'tool.execution_start', data: { toolCallId: `validation-${index}`, toolName: 'powershell',
      arguments: { command: `node --test suite-${index}.test.mjs`, description: 'Run validation' } } },
    { id: `validation-${index}-end`, type: 'tool.execution_complete', data: { toolCallId: `validation-${index}`, success: true,
      result: { content: output, contents: [{ type: 'shell_exit', shellId: '0', exitCode }] } } },
  ]).flat();
  raw.push({ id: 'validation-claim', type: 'assistant.message', data: { content: statement, messageId: 'message' } });
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw.map(entry => ({ timestamp: '2026-11-20T12:00:00Z', ...entry })) });
  await trace.ready; const entries = trace.snapshot().entries; trace.close(); return entries;
}

test('outcome lesson preserves literal output and routes explicitly to all retained validation without linking it to the edit', async () => {
  const checks = await claimFixture({ count: 2, exitCode: 0, output: 'FAIL assertions <script>日🧪</script>' });
  const editTrace = createTrace({ on() { return () => {}; }, getEvents: async () => [
    { id: 'edit-start', type: 'tool.execution_start', data: { toolCallId: 'edit', toolName: 'edit', arguments: { path: 'file', old_str: 'old', new_str: 'wrong' } } },
    { id: 'edit-end', type: 'tool.execution_complete', data: { toolCallId: 'edit', success: true, result: { content: 'Changed <script>日🧪</script>' } } },
  ] });
  await editTrace.ready; const edit = editTrace.snapshot().entries; editTrace.close();
  const ui = fixture(appSource); ui.render(edit);
  const result = walk(ui.get('#timeline')).find(node => node.className.split(' ').includes('evidence') && node.textContent.includes(edit[1].evidence));
  assert.match(byClass(result, 'step-means').textContent, /reported a change/i);
  assert.match(byClass(result, 'step-unknown').textContent, /missing validation.*unknown/i);
  assert.ok(result.querySelectorAll('pre').some(pre => pre.textContent === edit[1].evidence));
  const button = result.querySelectorAll('button').find(item => /Inspect validation/.test(item.textContent));
  assert.ok(button); assert.match(button.textContent, /all retained/i);
  reveal(button); button.focus(); ui.document.scrollingElement.scrollTop = 261;
  ui.render([...edit, ...checks]);
  assert.equal(ui.document.activeElement, button); assert.equal(ui.document.scrollingElement.scrollTop, 261);
  button.dispatch('click');
  assert.equal(ui.get('#statistics-panel').open, true); assert.equal(ui.get('#validation-overview').open, true);
  assert.equal(ui.document.activeElement, ui.get('#validation-overview').querySelector('summary'));
  assert.equal(ui.get('#follow').checked, false); assert.equal(ui.get('#validation-list').children.length, 2);
  assert.match(byClass(result, 'step-unknown').textContent, /separate.*not.*linked/i);
  ui.get('#statistics-panel').close(); assert.equal(ui.document.activeElement, button);
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change'); filterMode(ui, 'tools');
    assert.equal(ui.document.activeElement, button); assert.equal(ui.get('#follow').checked, false);
    assert.equal(ui.document.scrollingElement.scrollTop, 261);
    button.dispatch('click'); assert.equal(ui.get('#validation-list').children.length, 2); ui.get('#statistics-panel').close();
  }
  filterMode(ui, 'everything');
  const processLesson = walk(ui.get('#timeline')).find(node => node.className.split(' ').includes('evidence') && node.textContent.includes(checks[1].evidence));
  assert.match(byClass(processLesson, 'step-means').textContent, /protocol reports success.*exit 0/s);
  assert.doesNotMatch(byClass(processLesson, 'step-means').textContent, /FAIL assertions|assertions passed/);
  assert.deepEqual(visibleEvidence(ui), [...edit, ...checks].map(entry => entry.evidence));
});

test('outcome lesson recomputes after invocation eviction and rejects stale, detached and closed-page validation buttons', async () => {
  const entries = await claimFixture(), ui = fixture(appSource); ui.render(entries);
  const result = walk(ui.get('#timeline')).find(node => node.className.split(' ').includes('evidence') && node.textContent.includes(entries[1].evidence));
  const button = result.querySelectorAll('button').find(item => /Inspect validation/.test(item.textContent)); assert.ok(button);
  reveal(button); button.focus(); ui.get('#follow').checked = false; ui.document.scrollingElement.scrollTop = 233;
  ui.render(entries.slice(1), { omitted: 1 });
  assert.doesNotMatch(byClass(result, 'step-means').textContent, /process exit/i);
  assert.equal(ui.document.activeElement, button); assert.equal(ui.document.scrollingElement.scrollTop, 233);
  const changed = await claimFixture({ output: 'Replacement same-ID output' }); ui.render(changed);
  ui.get('#follow').checked = true; button.dispatch('click');
  assert.equal(ui.get('#statistics-panel').open, false); assert.equal(ui.get('#follow').checked, true);
  const fresh = walk(ui.get('#timeline')).filter(node => node.tagName === 'button' && /Inspect validation/.test(node.textContent));
  ui.render([], { omitted: entries.length }); fresh[0].dispatch('click');
  assert.equal(ui.get('#statistics-panel').open, false);
  ui.render(entries); const last = walk(ui.get('#timeline')).find(node => node.tagName === 'button' && /Inspect validation/.test(node.textContent));
  ui.closePage(); last.dispatch('click'); assert.equal(ui.get('#statistics-panel').open, false);
});

test('validation navigation clears the measured sticky header in a scrolled drawer with nested offsets without scrolling the timeline', async () => {
  const entries = await claimFixture();
  for (const [panelTop, panelHeight, initialScroll, headerHeight, contentTop, offsetTop, summaryHeight] of [
    [0, 300, 0, 64, 511, 500, 32],
    [170, 360, 230, 96, 900, 80, 48],
    [40, 240, 980, 104, 650, 12, 48],
  ]) {
    const ui = fixture(appSource); ui.render(entries);
    const panel = ui.get('#statistics-panel'), header = panel.querySelector('.panel-heading');
    const disclosure = ui.get('#validation-overview'), summary = disclosure.querySelector('summary');
    const nested = ui.document.createElement('div'); panel.append(nested); nested.append(disclosure);
    disclosure.offsetParent = nested; disclosure.offsetTop = offsetTop;
    panel.clientTop = 2; panel.scrollTop = initialScroll;
    panel.getBoundingClientRect = () => ({ top: panelTop, bottom: panelTop + panelHeight, height: panelHeight });
    header.getBoundingClientRect = () => {
      const top = panelTop + panel.clientTop + Math.max(0, 13 - panel.scrollTop);
      return { top, bottom: top + headerHeight, height: headerHeight };
    };
    summary.getBoundingClientRect = () => {
      const top = panelTop + panel.clientTop + contentTop - panel.scrollTop;
      return { top, bottom: top + summaryHeight, height: summaryHeight };
    };
    const button = walk(ui.get('#timeline')).find(node => node.tagName === 'button' && /Inspect validation/.test(node.textContent));
    reveal(button); button.focus(); ui.document.scrollingElement.scrollTop = 317;
    button.dispatch('click');
    const target = summary.getBoundingClientRect(), heading = header.getBoundingClientRect();
    assert.ok(target.top >= heading.bottom + 6, 'Focused summary and its focus outline clear the current sticky header.');
    assert.ok(target.bottom <= panelTop + panelHeight, 'Summary remains inside the drawer viewport.');
    assert.notEqual(panel.scrollTop, initialScroll); assert.equal(ui.document.scrollingElement.scrollTop, 317);
    assert.equal(ui.document.activeElement, summary); assert.equal(ui.get('#follow').checked, false);
    panel.close(); assert.equal(ui.document.activeElement, button); assert.equal(ui.document.scrollingElement.scrollTop, 317);
  }
});

test('changed result type or omission marker cannot leave an active stale outcome route', async () => {
  const entries = await claimFixture(), ui = fixture(appSource); ui.render(entries);
  const button = walk(ui.get('#timeline')).find(node => node.tagName === 'button' && /Inspect validation/.test(node.textContent));
  ui.render(entries.map(entry => entry.id === entries[1].id ? { ...entry, protectedContentOmitted: true } : entry));
  assert.equal(button.isConnected, false); button.dispatch('click'); assert.equal(ui.get('#statistics-panel').open, false);
  const marked = walk(ui.get('#timeline')).find(node => node.tagName === 'button' && /Inspect validation/.test(node.textContent));
  reveal(marked); marked.focus(); ui.document.scrollingElement.scrollTop = 233;
  ui.render(entries.map(entry => entry.id === entries[1].id ? { ...entry, type: 'session.info' } : entry));
  assert.equal(marked.isConnected, false); marked.dispatch('click'); assert.equal(ui.get('#statistics-panel').open, false);
  assert.equal(ui.document.activeElement.tagName, 'summary'); assert.equal(ui.document.activeElement.isConnected, true);
  assert.equal(ui.document.scrollingElement.scrollTop, 233); assert.equal(ui.get('#follow').checked, false);
  ui.render(entries);
  const restored = walk(ui.get('#timeline')).find(node => node.tagName === 'button' && /Inspect validation/.test(node.textContent));
  reveal(restored); restored.focus();
  ui.render(entries.map(entry => entry.id === entries[1].id ? { ...entry, type: 'tool.execution_start' } : entry));
  assert.equal(restored.isConnected, false); restored.dispatch('click'); assert.equal(ui.get('#statistics-panel').open, false);
  assert.equal(ui.document.activeElement.tagName, 'summary'); assert.equal(ui.document.scrollingElement.scrollTop, 233);
});

test('validation overview remains optional and shows literal command, typed failure, tool success and unknown assertion counts', async () => {
  const entries = await claimFixture(), ui = fixture(appSource); ui.render(entries);
  const overview = ui.get('#validation-overview'), list = ui.get('#validation-list');
  assert.equal(overview.open, false); assert.equal(list.children.length, 1);
  assert.match(ui.get('#validation-summary').textContent, /1 recognized validation operation/);
  assert.match(list.textContent, /node --test suite-0.test.mjs.*Process exit: 1.*Tool protocol: success/s);
  assert.match(list.textContent, /Main chat.*validation-0.*2026-11-20T12:00:00Z/s);
  assert.match(list.textContent, /Latest retained result.*exact source and literal command/i);
  assert.match(list.textContent, /assertion counts.*skipped tests.*coverage.*unknown/i);
  assert.equal(byClass(list, 'validation-output').textContent, 'PASS <script>日🧪</script>\n');
  assert.equal(walk(list).some(node => ['script', 'img', 'a'].includes(node.tagName)), false);
  overview.open = true; overview.dispatch('toggle'); assert.equal(ui.get('#follow').checked, false);
  assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
});

test('validation late completion and live view/filter changes preserve disclosure, focus and reading positions', async () => {
  const entries = await claimFixture({ output: '日'.repeat(4000) }), ui = fixture(appSource); ui.render(entries.slice(0, 1));
  const list = ui.get('#validation-list'), row = list.firstElementChild, details = row.querySelector('details');
  assert.match(row.textContent, /Completion not retained.*unknown/s); assert.match(row.textContent, /Process exit: unknown/);
  reveal(details); details.open = true; details.dispatch('toggle'); details.querySelector('summary').focus();
  list.scrollTop = 31; ui.get('#statistics-panel').scrollTop = 80; ui.document.scrollingElement.scrollTop = 247;
  ui.render(entries);
  assert.equal(list.firstElementChild, row); assert.equal(details.open, true); assert.equal(ui.document.activeElement, details.querySelector('summary'));
  const output = byClass(row, 'validation-output'); output.focus(); output.scrollTop = 44;
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change'); filterMode(ui, 'automation');
    assert.equal(list.firstElementChild, row); assert.equal(ui.document.activeElement, output); assert.equal(output.scrollTop, 44);
    assert.equal(details.open, true); assert.equal(list.scrollTop, 31); assert.equal(ui.get('#statistics-panel').scrollTop, 80);
    assert.equal(ui.document.scrollingElement.scrollTop, 247); assert.equal(ui.get('#follow').checked, false);
  }
  ui.render(entries.slice(1), { omitted: 1, history: 'unavailable' });
  assert.equal(row.isConnected, false); assert.equal(ui.document.activeElement, list);
  assert.match(ui.get('#validation-summary').textContent, /No validation observed here/);
  assert.match(ui.get('#validation-scope').textContent, /1 unclassified tool call.*unknown validation status/s);
  assert.match(ui.get('#validation-scope').textContent, /history.*unavailable.*1 older events.*omitted/s);
});

test('validation original buttons reset filters and reject changed, evicted or duplicate evidence targets', async () => {
  const entries = await claimFixture(), ui = fixture(appSource); ui.render(entries); filterMode(ui, 'automation');
  const list = ui.get('#validation-list'), original = list.querySelectorAll('button').find(button => button.textContent === 'Original result');
  original.dispatch('click');
  assert.equal(ui.get('#statistics-panel').open, false); assert.equal(ui.get('#activity-filter').value, 'everything');
  assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#follow').checked, false);
  ui.render(await claimFixture({ output: 'Changed same-ID result' }));
  ui.document.scrollingElement.scrollTop = 333; ui.get('#follow').checked = true; original.dispatch('click');
  assert.match(ui.get('#navigation-status').textContent, /no longer retained/);
  assert.equal(ui.document.scrollingElement.scrollTop, 333); assert.equal(ui.get('#follow').checked, true);
  const replacement = list.querySelectorAll('button').find(button => button.textContent === 'Original result');
  ui.render([...entries, entries[1]]); replacement.dispatch('click');
  assert.equal(list.children.length, 0); assert.match(ui.get('#navigation-status').textContent, /no longer retained/);
  ui.render(entries); ui.closePage(); assert.equal(list.children.length, 0);
});

test('empty validation overview names retained scope without treating unsupported commands as failed validation', async () => {
  const ui = fixture(appSource); ui.render([], { history: 'unsupported', omitted: 40 });
  assert.equal(ui.get('#validation-summary').textContent, 'No validation observed here.');
  assert.match(ui.get('#validation-scope').textContent, /300 retained events.*40 older events/s);
  assert.doesNotMatch(ui.get('#validation-overview').textContent, /no validation performed/i);
  ui.render([boundary('unknown-command', 'start')]);
  assert.equal(ui.get('#validation-list').children.length, 0);
  assert.match(ui.get('#validation-scope').textContent, /1 unclassified tool call.*unknown validation status/s);
});

test('validation attempts keep prior failures visible and label invalid recorded times without inventing chronology', async () => {
  const entries = await claimFixture({ count: 2 }), ui = fixture(appSource);
  for (const [index, change] of [[2, raw => { raw.data.arguments.command = 'node --test suite-0.test.mjs'; }],
    [3, raw => { raw.data.result.contents[0].exitCode = 0; }]]) {
    const raw = JSON.parse(entries[index].evidence); change(raw); raw.timestamp = 'unknown recorded time';
    entries[index].evidence = JSON.stringify(raw); entries[index].timestamp = raw.timestamp;
  }
  ui.render(entries);
  const rows = ui.get('#validation-list').children;
  assert.equal(rows.length, 2); assert.match(rows[0].textContent, /Process exit: 1/);
  assert.doesNotMatch(rows[0].textContent, /Latest retained result/);
  assert.match(rows[1].textContent, /Process exit: 0.*Latest retained result/s);
  assert.match(rows[1].textContent, /Time unknown \(recorded: unknown recorded time\)/);
  const result = rows[1].querySelectorAll('button').find(button => button.textContent === 'Original result');
  ui.render(entries.slice(0, 3), { omitted: 2 }); result.dispatch('click');
  assert.match(ui.get('#navigation-status').textContent, /no longer retained/);
  assert.match(rows[0].textContent, /Latest retained result/); assert.match(rows[1].textContent, /Completion not retained/);
});

test('claim disclosure keeps candidates literal and separate until the user links a result, with neutral conflicting exit', async () => {
  const entries = await claimFixture({ count: 6 }), ui = fixture(appSource); ui.render(entries);
  const section = byClass(ui.get('#timeline'), 'claim-evidence'); assert.ok(section); assert.equal(section.open, false);
  assert.equal(byClass(section, 'claim-statement').textContent, 'Tests passed.');
  assert.match(byClass(section, 'claim-status').textContent, /Candidate evidence.*No supporting result linked/);
  assert.equal(section.querySelectorAll('.claim-result').length, 3); assert.match(section.textContent, /3 additional.*not shown/);
  const candidate = section.querySelectorAll('.claim-result')[1];
  assert.match(candidate.textContent, /node --test suite-1.test.mjs/);
  assert.equal(byClass(candidate, 'claim-output').textContent, 'PASS <script>日🧪</script>\n');
  assert.match(candidate.textContent, /Tool protocol.*success.*Process exit.*1/s);
  const select = candidate.querySelectorAll('button').find(button => button.textContent === 'Link this result');
  reveal(select); select.focus(); ui.document.scrollingElement.scrollTop = 230; select.dispatch('click');
  assert.match(byClass(section, 'claim-status').textContent, /User-linked.*not verified/i);
  assert.match(candidate.querySelector('summary').textContent, /User-linked/);
  assert.match(candidate.textContent, /reports passed.*nonzero exit.*No automatic verdict/i);
  assert.equal(ui.document.activeElement, select); assert.equal(ui.document.scrollingElement.scrollTop, 230); assert.equal(ui.get('#follow').checked, false);
  assert.equal(walk(section).some(node => ['script', 'img', 'a'].includes(node.tagName)), false);
  assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
  select.dispatch('click'); assert.match(byClass(section, 'claim-status').textContent, /No supporting result linked/);
});

test('linked claim survives live refresh, views and filters with focus and scroll, but expires on exact evidence replacement or eviction', async () => {
  const entries = await claimFixture({ output: '日'.repeat(4000), exitCode: 0 }), ui = fixture(appSource); ui.render(entries);
  const section = byClass(ui.get('#timeline'), 'claim-evidence'), candidate = section.querySelector('.claim-result');
  const select = candidate.querySelectorAll('button').find(button => button.textContent === 'Link this result');
  reveal(select); section.open = true; section.dispatch('toggle'); candidate.open = true; select.dispatch('click');
  const body = byClass(candidate, 'claim-output'); body.focus(); body.scrollTop = 71; ui.document.scrollingElement.scrollTop = 247;
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.render([...entries, { ...boundary(`extra-${mode}`, 'start'), evidence: '{}' }]);
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
    assert.equal(byClass(ui.get('#timeline'), 'claim-evidence'), section); assert.equal(section.open, true); assert.equal(candidate.open, true);
    assert.equal(ui.document.activeElement, body); assert.equal(body.scrollTop, 71); assert.equal(ui.document.scrollingElement.scrollTop, 247);
    assert.match(byClass(section, 'claim-status').textContent, /User-linked/); assert.equal(ui.get('#follow').checked, false);
  }
  const original = candidate.querySelectorAll('button').find(button => button.textContent.startsWith('Original result'));
  filterMode(ui, 'automation'); original.dispatch('click');
  assert.equal(ui.get('#activity-filter').value, 'everything'); assert.equal(ui.get('#event-order').value, 'chronological');
  ui.render(await claimFixture({ output: 'Changed same-ID result', exitCode: 0 }));
  assert.match(byClass(section, 'claim-status').textContent, /link expired.*changed|link expired.*retained/i);
  ui.document.scrollingElement.scrollTop = 333; ui.get('#follow').checked = true; select.dispatch('click'); original.dispatch('click');
  assert.match(ui.get('#navigation-status').textContent, /no longer retained/);
  assert.equal(ui.document.scrollingElement.scrollTop, 333); assert.equal(ui.get('#follow').checked, true);
  ui.render(entries.slice(2), { omitted: 2, history: 'unavailable' });
  assert.match(section.textContent, /Supporting result not found in this view/); assert.match(section.textContent, /not proof that no check ran/);
  assert.equal(section.querySelectorAll('.claim-result').length, 0);
  ui.render([], { omitted: 3 }); assert.equal(section.isConnected, false); assert.equal(ui.document.activeElement.isConnected, true);
});

test('claim replacement, ambiguous identities and panel close release links and candidate controls', async () => {
  const entries = await claimFixture(), ui = fixture(appSource); ui.render(entries);
  let section = byClass(ui.get('#timeline'), 'claim-evidence');
  const select = section.querySelectorAll('button').find(button => button.textContent === 'Link this result');
  select.dispatch('click');
  ui.render(await claimFixture({ statement: 'Tests failed.' }));
  assert.equal(section.isConnected, false); section = byClass(ui.get('#timeline'), 'claim-evidence');
  assert.match(byClass(section, 'claim-status').textContent, /No supporting result linked/);
  ui.render([...entries, entries[2]]); assert.equal(section.isConnected, false);
  ui.render(entries); section = byClass(ui.get('#timeline'), 'claim-evidence');
  ui.closePage(); assert.equal(section.isConnected, false);
  select.dispatch('click'); assert.equal(byClass(ui.get('#timeline'), 'claim-evidence'), undefined);
});

test('an explicitly linked result stays visible when earlier history expands beyond the candidate limit', async () => {
  const entries = await claimFixture({ count: 4, exitCode: 0 }), ui = fixture(appSource); ui.render(entries.slice(6));
  const section = byClass(ui.get('#timeline'), 'claim-evidence');
  section.querySelectorAll('button').find(button => button.textContent === 'Link this result').dispatch('click');
  ui.render(entries);
  assert.equal(section.querySelectorAll('.claim-result').length, 4);
  assert.match(byClass(section, 'claim-status').textContent, /User-linked/);
  const selected = section.querySelectorAll('.claim-result').find(row => row.querySelector('summary').textContent.startsWith('User-linked'));
  assert.match(selected.querySelector('summary').textContent, /suite-3.test.mjs/);
  selected.querySelectorAll('button').find(button => button.textContent === 'Remove user link').dispatch('click');
  assert.equal(section.querySelectorAll('.claim-result').length, 3);
});

test('failure disclosure preserves literal arguments and results in a bounded optional suggestion sequence', async () => {
  const entries = await recoveryFixture(8); const ui = fixture(appSource); ui.get('#event-order').value = 'chronological'; ui.render(entries);
  const sections = ui.get('#timeline').querySelectorAll('.recovery'); assert.equal(sections.length, 1);
  const section = sections[0]; assert.equal(section.tagName, 'details'); assert.equal(section.open, false);
  assert.match(section.textContent, /Original.*reported failure.*Suggestion 1.*reported success/s);
  assert.match(section.textContent, /5 additional.*not shown/); assert.match(section.textContent, /Provider.*unknown/);
  assert.match(section.textContent, /not recorded retries.*does not.*prove process, tests or task success/s);
  assert.match(section.textContent, /Original failed <request>/); assert.match(section.textContent, /Exact later <script>日🧪/);
  assert.equal(section.querySelectorAll('.recovery-attempt').length, 4);
  assert.equal(section.querySelectorAll('button').length, 8);
  assert.equal(walk(section).some(node => ['script', 'a', 'img', 'code'].includes(node.tagName)), false);
  assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
  section.open = true; section.dispatch('toggle'); assert.equal(ui.get('#follow').checked, false);
});

test('related-attempt refresh and view changes preserve reading state, disclosures and guarded original targets', async () => {
  const entries = await recoveryFixture(1, '日'.repeat(5000)); const ui = fixture(appSource); ui.render(entries.slice(0, -1));
  const section = byClass(ui.get('#timeline'), 'recovery'); assert.ok(section); reveal(section); section.open = true; section.dispatch('toggle');
  const attempt = section.querySelectorAll('.recovery-attempt')[1]; attempt.open = true;
  const body = byClass(attempt, 'recovery-arguments'); body.focus(); body.scrollTop = 71;
  ui.document.scrollingElement.scrollTop = 247; ui.render(entries);
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
    assert.equal(byClass(ui.get('#timeline'), 'recovery'), section); assert.equal(section.open, true); assert.equal(attempt.open, true);
    assert.equal(ui.document.activeElement, body); assert.equal(body.scrollTop, 71); assert.equal(ui.document.scrollingElement.scrollTop, 247);
    assert.equal(ui.get('#follow').checked, false);
  }
  const link = attempt.querySelectorAll('button').find(button => button.textContent.startsWith('Result / error'));
  filterMode(ui, 'automation'); link.dispatch('click'); assert.equal(ui.get('#activity-filter').value, 'everything');
  assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#follow').checked, false);
  assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
  ui.render(await recoveryFixture(1, 'Changed same-ID result')); ui.document.scrollingElement.scrollTop = 333; ui.get('#follow').checked = true;
  link.dispatch('click'); assert.match(ui.get('#navigation-status').textContent, /no longer retained/);
  assert.equal(ui.document.scrollingElement.scrollTop, 333); assert.equal(ui.get('#follow').checked, true);
  ui.render(entries.slice(1), { omitted: 1 }); assert.match(section.textContent, /Start not retained/);
  assert.equal(section.querySelectorAll('.recovery-attempt').length, 1);
  ui.render(entries.slice(2), { omitted: 2 }); assert.equal(section.isConnected, false); assert.equal(ui.document.activeElement.isConnected, true);
});

test('delegation disclosure connects literal handoff, child activity and separate parent result once per child', async () => {
  const entries = await handoffFixture(); const ui = fixture(appSource); ui.get('#event-order').value = 'chronological'; ui.render(entries);
  const sections = ui.get('#timeline').querySelectorAll('.delegation');
  assert.equal(sections.length, 1, 'One optional disclosure belongs to the first retained child record.');
  const section = sections[0]; assert.equal(section.tagName, 'details'); assert.equal(section.open, false);
  assert.equal(byClass(section, 'delegation-prompt').textContent, 'Exact delegated <prompt> 🧪\r\n日');
  assert.equal(byClass(section, 'delegation-description').textContent, 'Literal <description>');
  assert.equal(byClass(section, 'delegation-result').textContent, 'Exact returned <script>café 🧪</script>\r\n日');
  for (const name of ['prompt', 'description', 'result']) assert.equal(byClass(section, `delegation-${name}`).tabIndex, 0);
  assert.match(section.textContent, /Main chat.*child.*delegate-call/s);
  assert.match(section.textContent, /Completed.*correctness.*separate context.*included or excluded/s);
  assert.equal(walk(section).some(node => ['script', 'a', 'img', 'code'].includes(node.tagName)), false);
  assert.equal(section.querySelectorAll('button').length, entries.length);
  assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
  section.open = true; section.dispatch('toggle'); assert.equal(ui.get('#follow').checked, false);
});

test('delegation live results, view changes and anchor eviction retain disclosure, focus and reading state', async () => {
  const entries = await handoffFixture('日'.repeat(5000)); const ui = fixture(appSource); ui.render(entries.slice(0, -1));
  const section = byClass(ui.get('#timeline'), 'delegation'); assert.ok(section);
  assert.match(section.textContent, /Parent result not retained.*late/s);
  reveal(section); section.open = true; section.dispatch('toggle'); section.firstElementChild.focus();
  ui.document.scrollingElement.scrollTop = 247; ui.render(entries);
  assert.equal(byClass(ui.get('#timeline'), 'delegation'), section); assert.equal(section.open, true);
  assert.equal(ui.document.activeElement, section.firstElementChild); assert.equal(ui.document.scrollingElement.scrollTop, 247);
  const body = byClass(section, 'delegation-result'); body.scrollTop = 110; body.focus();
  for (const mode of ['chronological', 'chapters', 'lanes', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change');
    assert.equal(ui.document.activeElement, body); assert.equal(body.scrollTop, 110); assert.equal(section.open, true);
    assert.equal(ui.document.scrollingElement.scrollTop, 247); assert.equal(ui.get('#follow').checked, false);
    filterMode(ui, 'tools'); assert.equal(ui.document.activeElement, ui.get('#activity-filter'));
    filterMode(ui, 'everything'); body.focus();
  }
  section.firstElementChild.focus(); ui.render(entries.slice(2), { omitted: 2 });
  assert.equal(byClass(ui.get('#timeline'), 'delegation'), section); assert.equal(section.open, true);
  assert.equal(ui.document.activeElement, section.firstElementChild); assert.equal(ui.document.scrollingElement.scrollTop, 247);
  assert.match(section.textContent, /Parent unknown.*Older events were omitted/s);
  assert.equal(byClass(section, 'delegation-prompt').hidden, true);
  ui.render([], { omitted: 5 }); assert.equal(section.isConnected, false); assert.equal(ui.document.activeElement.isConnected, true);
});

test('delegation original links reset filters without changing chronology and reject stale same-ID targets', async () => {
  const entries = await handoffFixture(); const ui = fixture(appSource); ui.render(entries);
  const section = byClass(ui.get('#timeline'), 'delegation'); assert.ok(section);
  const link = section.querySelectorAll('button').find(button => button.textContent.startsWith('Parent returned result'));
  assert.ok(link);
  for (const mode of ['lanes', 'chapters', 'grouped']) {
    ui.get('#event-order').value = mode; ui.get('#event-order').dispatch('change'); filterMode(ui, 'automation'); link.dispatch('click');
    assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#activity-filter').value, 'everything');
    assert.equal(ui.get('#follow').checked, false); assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
    const target = ui.get('#timeline').children.at(-1);
    assert.equal(byClass(target, 'recorded-evidence').open, true); assert.equal(ui.document.activeElement, target.firstElementChild.firstElementChild);
  }
  const updated = await handoffFixture('Changed same-ID text'); ui.render(updated);
  ui.document.scrollingElement.scrollTop = 333; ui.get('#follow').checked = true; link.dispatch('click');
  assert.match(ui.get('#navigation-status').textContent, /no longer retained/);
  assert.equal(ui.document.scrollingElement.scrollTop, 333); assert.equal(ui.get('#follow').checked, true);
  ui.render(updated.slice(0, -1)); link.dispatch('click'); assert.equal(ui.document.scrollingElement.scrollTop, 333);
});

test('delegation clears clipped or changed content and bounds activity links to retained records', async () => {
  const entries = await handoffFixture(); const ui = fixture(appSource); ui.render(entries);
  const section = byClass(ui.get('#timeline'), 'delegation'); assert.ok(section);
  const body = byClass(section, 'delegation-result'); reveal(body); body.focus();
  ui.render([...entries.slice(0, -1), { ...entries.at(-1), truncated: true }]);
  assert.equal(body.hidden, true); assert.equal(body.textContent, '');
  assert.notEqual(ui.document.activeElement, body); assert.equal(ui.document.activeElement.isConnected, true);
  assert.match(section.textContent, /clipped.*12,000 UTF-16.*cannot recover/s);
  const many = await handoffFixture('Result', Array.from({ length: 120 }, (_, index) => ({ id: `child-${index}`,
    type: 'assistant.message', agentId: 'child', data: { parentToolCallId: 'delegate-call', content: `Activity ${index}` } })));
  ui.render(many);
  assert.equal(ui.get('#timeline').querySelectorAll('.delegation').length, 1);
  assert.equal(section.querySelectorAll('button').length, many.length);
  ui.render(entries); assert.equal(section.querySelectorAll('button').length, entries.length);
  ui.render([{ ...entries[1], agentId: '', evidence: '{}' }]); assert.equal(section.isConnected, false);
});

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
  assert.equal(row.isConnected, false);
  assert.equal(byClass(ui.get('#timeline'), 'compaction'), undefined);
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

test('recorded grant scope is readable in existing stage and event details without revealing target previews', async () => {
  const entries = await actionFixture();
  const original = entries[3], raw = JSON.parse(original.evidence);
  raw.data.result = { kind: 'approved-for-location', approval: { kind: 'extension-env-access',
    extensionName: 'private-extension', environmentVariables: ['PRIVATE_TOKEN'] }, locationKey: 'private-location' };
  entries[3] = { ...original, evidence: JSON.stringify(raw) };
  for (const mode of ['grouped', 'chronological', 'chapters', 'lanes']) {
    const ui = fixture(appSource);
    ui.get('#event-order').value = mode;
    ui.render(entries);
    const counts = ui.get('#stat-counts').textContent;
    const disclosure = byClass(ui.get('#timeline'), 'action-stages');
    disclosure.open = true;
    assert.match(disclosure.textContent, /Permission approved/);
    assert.match(disclosure.textContent, /project-location grant.*named environment variables/);
    assert.match(disclosure.textContent, /current authority.*storage.*reuse.*not established/i);
    assert.match(disclosure.textContent, /Tool result: reported failure/);
    assert.doesNotMatch(disclosure.textContent, /private-|PRIVATE_TOKEN/);
    assert.equal(walk(ui.get('#timeline')).filter(node => node.className === 'action-stages').length, 1);
    filterMode(ui, 'problems');
    assert.ok(visibleWalk(ui.get('#timeline')).includes(disclosure));
    const button = walk(disclosure).find(node => node.tagName === 'button' && /Permission approved/.test(node.textContent));
    button.focus(); button.dispatch('click');
    const row = ui.get('#timeline').children[3];
    assert.equal(ui.document.activeElement, row.firstElementChild.firstElementChild);
    assert.equal(byClass(row, 'recorded-evidence').open, true);
    assert.match(row.textContent, /project-location grant.*named environment variables/);
    assert.deepEqual(visibleEvidence(ui), entries.map(entry => entry.evidence));
    assert.equal(ui.get('#stat-counts').textContent, counts);
    assert.equal(ui.get('#follow').checked, false);
    assert.ok(walk(ui.get('#timeline')).every(node => !['img', 'script', 'a'].includes(node.tagName)));
  }
});

test('updated or evicted grant evidence loses its old scope while retained stage controls keep focus', async () => {
  const entries = await actionFixture(), original = entries[3], raw = JSON.parse(original.evidence);
  raw.data.result = { kind: 'approved-for-session', approval: { kind: 'read' } };
  entries[3] = { ...original, evidence: JSON.stringify(raw) };
  const ui = fixture(appSource);
  ui.render(entries);
  const disclosure = byClass(ui.get('#timeline'), 'action-stages');
  disclosure.open = true;
  const button = walk(disclosure).find(node => node.tagName === 'button' && /Permission approved/.test(node.textContent));
  button.focus(); ui.document.scrollingElement.scrollTop = 333;
  delete raw.data.result.approval;
  ui.render(entries.map(entry => entry.id === 'decision' ? { ...entry, evidence: JSON.stringify(raw) } : entry));
  assert.equal(ui.document.activeElement, button); assert.equal(ui.document.scrollingElement.scrollTop, 333);
  assert.equal(disclosure.open, true); assert.match(disclosure.textContent, /grant scope unknown/i);
  assert.doesNotMatch(disclosure.textContent, /reusable session grant/);
  ui.render(entries.filter(entry => entry.id !== 'decision'), { omitted: 1 });
  assert.equal(button.isConnected, false); assert.ok(ui.document.activeElement.isConnected);
  assert.doesNotMatch(disclosure.textContent, /reusable session grant/);
  assert.equal(ui.document.scrollingElement.scrollTop, 333);
  button.dispatch('click');
  assert.match(ui.get('#navigation-status').textContent, /no longer retained/);
  assert.equal(ui.document.scrollingElement.scrollTop, 333);
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
  assert.deepEqual(laneRows(a).map(row => byClass(row, 'recorded-evidence').querySelector('pre').textContent), [agentStart.evidence, agentEnd.evidence]);
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

function selectRecap(ui, value = 'range') {
  ui.get('#recap-button').dispatch('click'); ui.get('#recap-range').value = value; ui.get('#recap-range').dispatch('change');
}

const surpriseActions = ui => ui.get('#timeline').querySelectorAll('.surprise-mark');
const surpriseOriginal = ui => ui.get('#surprises-list').querySelector('button');
function openSurprises(ui) { ui.get('#surprises-button').dispatch('click'); }

test('surprise marks preserve reading and Follow, reconcile live arrivals, and open nested filtered original evidence', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); emitRead(data);
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed();
  const before = JSON.stringify(data.trace.snapshot()), action = surpriseActions(ui).at(-1);
  assert.ok(action, 'Original event rows expose an opt-in mark action.');
  ui.document.scrollingElement.scrollTop = 210; action.focus(); action.dispatch('click');
  assert.equal(action.attributes['aria-pressed'], 'true'); assert.equal(ui.get('#follow').checked, true);
  assert.equal(ui.document.activeElement, action); assert.equal(ui.document.scrollingElement.scrollTop, 210);
  assert.equal(JSON.stringify(data.trace.snapshot()), before);
  filterMode(ui, 'automation'); openSurprises(ui);
  assert.match(ui.get('#surprises-count').textContent, /1 of 20/);
  assert.match(ui.get('#surprises-scope').textContent, /memory.*panel/i);
  const list = ui.get('#surprises-list'), row = list.children[0], original = surpriseOriginal(ui);
  original.focus(); list.scrollTop = 35; ui.document.scrollingElement.scrollTop = 220;
  emitRead(data, 'arrival'); await ui.refreshFeed();
  assert.equal(list.children[0], row); assert.equal(ui.document.activeElement, original);
  assert.equal(list.scrollTop, 35); assert.equal(ui.document.scrollingElement.scrollTop, 220);
  assert.equal(list.attributes['aria-live'], undefined);
  original.dispatch('click'); assert.equal(ui.get('#surprises-panel').open, false);
  assert.equal(ui.get('#event-order').value, 'chronological'); assert.equal(ui.get('#activity-filter').value, 'everything');
  assert.equal(ui.get('#follow').checked, false); assert.match(ui.get('#navigation-status').textContent, /surprising.*original/i);
  assert.ok(walk(ui.get('#timeline')).some(node => node.scrolled));
  const marked = surpriseActions(ui).find(button => button.attributes['aria-pressed'] === 'true');
  marked.dispatch('click'); assert.equal(marked.attributes['aria-pressed'], 'false');
  openSurprises(ui); assert.match(ui.get('#surprises-count').textContent, /0 of 20/);
});

test('surprise marks become ordinal-only expired placeholders and never attach to replacement evidence', () => {
  const ui = fixture(appSource); ui.render([start, end]); const action = surpriseActions(ui)[0];
  assert.ok(action); action.dispatch('click'); openSurprises(ui);
  const original = surpriseOriginal(ui); original.focus(); const list = ui.get('#surprises-list');
  ui.render([{ ...start, evidence: 'replacement' }, end]);
  assert.equal(original.attributes['aria-disabled'], 'true'); assert.equal(ui.document.activeElement, original);
  assert.match(list.textContent, /Mark 1.*Original unavailable/); assert.doesNotMatch(list.textContent, /日本語|replacement/);
  assert.equal(surpriseActions(ui)[0].attributes['aria-pressed'], 'false');
  ui.document.scrollingElement.scrollTop = 230; original.dispatch('click');
  assert.equal(ui.document.scrollingElement.scrollTop, 230); assert.equal(ui.get('#surprises-panel').open, true);
  ui.get('#surprises-panel').close(); surpriseActions(ui)[0].dispatch('click'); openSurprises(ui);
  assert.equal(list.children.length, 2, 'Marking a replacement is a separate deliberate mark.');
  const unmark = list.children[0].querySelectorAll('button')[1]; unmark.focus(); unmark.dispatch('click');
  assert.equal(list.children.length, 1); assert.equal(ui.document.activeElement, list.children[0].querySelectorAll('button')[1]);
  ui.get('#surprises-clear').focus(); ui.get('#surprises-clear').dispatch('click');
  assert.equal(list.children.length, 0); assert.equal(ui.document.activeElement, ui.get('#surprises-clear'));
  assert.equal(ui.document.scrollingElement.scrollTop, 230); assert.equal(ui.get('#follow').checked, false);
});

test('surprise marks keep live-only scope across same-ID examples and prediction/playback prefixes', async () => {
  const entries = examples.parseExampleLibrary(exampleText)[0].snapshot.entries;
  const ui = fixture(appSource, undefined, undefined, undefined, Date, async () => exampleResponse(exampleText));
  ui.render(entries); assert.ok(surpriseActions(ui).length); surpriseActions(ui).at(-1).dispatch('click'); openSurprises(ui);
  const stale = surpriseOriginal(ui);
  ui.get('#examples-load').dispatch('click'); await ui.settleExamples(); ui.get('#examples-open').dispatch('click');
  for (const action of surpriseActions(ui)) assert.equal(action.disabled, true);
  openSurprises(ui); assert.equal(ui.get('#surprises-list').textContent, ''); assert.equal(ui.get('#surprises-count').textContent, '');
  assert.match(ui.get('#surprises-scope').textContent, /Return to live/);
  ui.document.scrollingElement.scrollTop = 200; stale.dispatch('click'); assert.equal(ui.document.scrollingElement.scrollTop, 200);
  ui.get('#playback-exit').dispatch('click'); openSurprises(ui);
  assert.match(ui.get('#surprises-count').textContent, /1 of 20/);
  ui.get('#prediction-replay').dispatch('click'); openSurprises(ui);
  assert.equal(ui.get('#surprises-list').textContent, ''); assert.equal(ui.get('#surprises-count').textContent, '');
  assert.match(ui.get('#surprises-scope').textContent, /Return to live/);
  ui.get('#prediction-exit').dispatch('click'); ui.get('#playback-start').dispatch('click');
  ui.get('#playback-next').dispatch('click'); ui.get('#playback-previous').dispatch('click'); openSurprises(ui);
  assert.equal(ui.get('#surprises-list').textContent, '');
  ui.get('#playback-exit').dispatch('click'); openSurprises(ui); assert.match(ui.get('#surprises-count').textContent, /1 of 20/);
  ui.closePage(); stale.dispatch('click'); assert.equal(ui.get('#surprises-list').textContent, '');
});

test('surprise dialog queued close/reopen invalidates old callbacks without discarding marks', () => {
  const ui = fixture(appSource); ui.render([start]); assert.ok(surpriseActions(ui).length);
  surpriseActions(ui)[0].dispatch('click'); openSurprises(ui);
  const panel = ui.get('#surprises-panel'), stale = surpriseOriginal(ui);
  panel.close = () => { panel.open = false; }; panel.dispatch('cancel');
  openSurprises(ui); panel.dispatch('close');
  assert.equal(panel.open, true); assert.match(ui.get('#surprises-count').textContent, /1 of 20/);
  ui.document.scrollingElement.scrollTop = 250; stale.dispatch('click');
  assert.equal(panel.open, true); assert.equal(ui.document.scrollingElement.scrollTop, 250);
  ui.closePage(); surpriseOriginal(ui)?.dispatch('click');
  assert.equal(ui.get('#surprises-list').textContent, '');
});

test('surprise list enforces its visible limit, renders literal Unicode and sends no mark data to diagnostics, storage or requests', () => {
  const ui = fixture(appSource), text = 'PRIVATE 日本語🧪<script> C:/private/file https://private.example';
  const entries = Array.from({ length: 21 }, (_, index) => ({ ...start, id: `private-${index}`, type: 'user.message',
    category: 'chat', preview: text, evidence: text }));
  ui.render(entries); const diagnosticsBefore = JSON.stringify(ui.diagnostics.snapshot()), requestsBefore = ui.fetches.length;
  for (const action of surpriseActions(ui).slice(0, 20)) action.dispatch('click');
  const last = surpriseActions(ui)[20]; last.focus(); ui.document.scrollingElement.scrollTop = 240; last.dispatch('click');
  assert.equal(last.attributes['aria-pressed'], 'false'); assert.equal(ui.document.activeElement, last);
  assert.equal(ui.document.scrollingElement.scrollTop, 240); assert.match(last.parentElement.textContent, /20 marks reached/);
  ui.render([...entries, { ...entries[0], id: 'unmarked-arrival' }]);
  assert.match(last.parentElement.textContent, /20 marks reached/, 'Live updates keep the limit explanation readable.');
  openSurprises(ui); const list = ui.get('#surprises-list');
  assert.equal(list.children.length, 20); assert.match(ui.get('#surprises-count').textContent, /20 of 20/);
  assert.ok(list.textContent.includes(text)); assert.equal(list.querySelectorAll('script').length, 0);
  const stale = surpriseOriginal(ui); ui.get('#surprises-clear').focus(); ui.get('#surprises-clear').dispatch('click');
  stale.dispatch('click'); assert.equal(list.children.length, 0); assert.equal(ui.get('#surprises-panel').open, true);
  ui.get('#surprises-panel').dispatch('cancel');
  assert.equal(ui.document.activeElement, ui.get('#surprises-button'));
  surpriseActions(ui)[0].dispatch('click'); ui.closePage();
  surpriseActions(ui)[0].dispatch('click'); openSurprises(ui);
  assert.equal(list.children.length, 0);
  assert.equal(JSON.stringify(ui.diagnostics.snapshot()), diagnosticsBefore);
  assert.deepEqual(ui.storageCalls, []); assert.equal(ui.fetches.length, requestsBefore);
});

test('live eviction during learning expires hidden marks before return and never revives a reused event ID', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  let snapshot = data.trace.snapshot();
  const ui = fixture(appSource, undefined, async () => feedResponse(snapshot)); await ui.refreshFeed();
  const originalEntries = snapshot.entries; surpriseActions(ui)[0].dispatch('click');
  ui.get('#prediction-live').dispatch('click');
  snapshot = { ...snapshot, revision: snapshot.revision + 1, entries: [], omitted: 1 }; await ui.refreshFeed();
  openSurprises(ui); assert.equal(ui.get('#surprises-list').textContent, ''); assert.equal(ui.get('#surprises-count').textContent, '');
  snapshot = { ...snapshot, revision: snapshot.revision + 1, entries: originalEntries }; await ui.refreshFeed();
  ui.get('#prediction-exit').dispatch('click'); openSurprises(ui);
  assert.match(ui.get('#surprises-list').textContent, /Mark 1.*Original unavailable/);
  assert.doesNotMatch(ui.get('#surprises-list').textContent, /Question/);
  assert.equal(surpriseOriginal(ui).attributes['aria-disabled'], 'true');
  assert.equal(surpriseActions(ui)[0].attributes['aria-pressed'], 'false');
});

test('recap explicitly selects a frozen range and keeps counts, content, focus and reading position through arrivals', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close()); emitRead(data);
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed();
  ui.get('#recap-button').dispatch('click');
  assert.equal(ui.get('#recap-panel').open, true); assert.equal(ui.get('#follow').checked, false);
  assert.equal(ui.get('#recap-report').textContent, '', 'The user explicitly chooses a scope.');
  ui.get('#recap-range').value = 'range'; ui.get('#recap-range').dispatch('change');
  const report = ui.get('#recap-report'), text = report.textContent, scope = ui.get('#recap-scope').textContent;
  const choices = ui.get('#recap-range').textContent;
  assert.match(text, /Tool calls: 1/); assert.match(text, /Information gathering/);
  assert.match(text, /日本語🧪<script>/); assert.equal(report.querySelectorAll('script').length, 0);
  const original = report.querySelector('button'); original.focus(); report.scrollTop = 55; ui.document.scrollingElement.scrollTop = 200;
  emitRead(data, 'arrival'); data.emit('interrupt', 'abort');
  data.emit('new-request', 'user.message', { content: 'Later request', delivery: 'idle' }); await ui.refreshFeed();
  assert.equal(report.textContent, text); assert.equal(ui.get('#recap-scope').textContent, scope);
  assert.equal(ui.get('#recap-range').textContent, choices);
  assert.equal(ui.document.activeElement, original); assert.equal(report.scrollTop, 55); assert.equal(ui.document.scrollingElement.scrollTop, 200);
  assert.equal(report.attributes['aria-live'], undefined);
  original.dispatch('click'); assert.equal(ui.get('#recap-panel').open, false);
  assert.equal(ui.get('#follow').checked, false); assert.equal(ui.get('#event-order').value, 'chronological');
  assert.ok(walk(ui.get('#timeline')).some(node => node.scrolled));
  selectRecap(ui); assert.match(report.textContent, /Tool calls: 2/);
  ui.get('#recap-panel').dispatch('cancel'); assert.equal(report.textContent, '');
  assert.equal(ui.document.activeElement, ui.get('#recap-button'));
});

test('recap queued native close cannot carry an old selection into a reopened capture', async () => {
  const entries = await argumentFixture(), ui = fixture(appSource); ui.render(entries); selectRecap(ui);
  const panel = ui.get('#recap-panel'), stale = ui.get('#recap-report').querySelector('button');
  panel.close = () => { panel.open = false; };
  panel.dispatch('cancel');
  ui.render(entries.slice(1)); ui.get('#recap-button').dispatch('click'); panel.dispatch('close');
  assert.equal(panel.open, true); assert.equal(ui.get('#recap-range').value, '');
  assert.equal(ui.get('#recap-report').textContent, '', 'A reopened capture needs a new explicit selection.');
  assert.equal(ui.get('#recap-status').textContent, '');
  ui.document.scrollingElement.scrollTop = 200; stale.dispatch('click');
  assert.equal(ui.document.scrollingElement.scrollTop, 200); assert.equal(panel.open, true);
});

test('recap separates identical event IDs in examples, live snapshots and active prediction prefixes', async () => {
  const entries = examples.parseExampleLibrary(exampleText)[0].snapshot.entries;
  const ui = fixture(appSource, undefined, undefined, undefined, Date, async () => exampleResponse(exampleText));
  ui.render(entries); selectRecap(ui); const liveLink = ui.get('#recap-report').querySelector('button');
  ui.get('#examples-load').dispatch('click'); await ui.settleExamples(); ui.get('#examples-open').dispatch('click');
  selectRecap(ui); assert.match(ui.get('#recap-scope').textContent, /Synthetic demonstration/);
  ui.document.scrollingElement.scrollTop = 200; liveLink.dispatch('click');
  assert.equal(ui.get('#recap-panel').open, true); assert.equal(ui.document.scrollingElement.scrollTop, 200);
  const exampleLink = ui.get('#recap-report').querySelector('button');
  ui.get('#playback-exit').dispatch('click'); selectRecap(ui);
  assert.match(ui.get('#recap-scope').textContent, /Recorded chat observations/);
  ui.document.scrollingElement.scrollTop = 220; exampleLink.dispatch('click');
  assert.equal(ui.get('#recap-panel').open, true); assert.equal(ui.document.scrollingElement.scrollTop, 220);
  ui.get('#prediction-replay').dispatch('click'); selectRecap(ui);
  assert.match(ui.get('#recap-scope').textContent, /prefix only/);
  assert.match(ui.get('#recap-report').textContent, /Tool calls: 0/);
  assert.doesNotMatch(ui.get('#recap-report').textContent, /demo\/|Tests passed/);
  ui.closePage();
});

test('recap empty partial capture keeps zero counts scoped and lets a cleared selection return to choosing', () => {
  const ui = fixture(appSource); ui.render([], { history: 'unavailable', omitted: 7 }); selectRecap(ui);
  assert.match(ui.get('#recap-scope').textContent, /No retained events/);
  assert.match(ui.get('#recap-report').textContent, /7 older events.*omitted/);
  assert.match(ui.get('#recap-report').textContent, /Earlier history.*unavailable/);
  assert.match(ui.get('#recap-report').textContent, /Tool calls: 0/);
  assert.equal(ui.get('#recap-report').querySelectorAll('button').length, 0);
  ui.get('#recap-range').value = ''; ui.get('#recap-range').dispatch('change');
  assert.equal(ui.get('#recap-report').textContent, ''); assert.match(ui.get('#recap-scope').textContent, /Choose/);
});

test('recap retains frozen counts after replacement or eviction while guarding stale source callbacks', async () => {
  const entries = await argumentFixture(), ui = fixture(appSource); ui.render(entries); selectRecap(ui);
  const report = ui.get('#recap-report'), original = report.querySelector('button'); original.focus();
  const count = byClass(report, 'recap-metric').textContent;
  ui.render([{ ...entries[0], evidence: 'REPLACED' }], { omitted: 2 });
  assert.equal(byClass(report, 'recap-metric').textContent, count.replaceAll('Open original', 'Original unavailable'));
  assert.match(ui.get('#recap-status').textContent, /unavailable.*frozen|frozen.*unavailable/i);
  assert.equal(original.attributes['aria-disabled'], 'true'); assert.equal(ui.document.activeElement, original);
  ui.document.scrollingElement.scrollTop = 200; original.dispatch('click');
  assert.equal(ui.document.scrollingElement.scrollTop, 200); assert.equal(ui.get('#recap-panel').open, true);
  ui.closePage(); original.dispatch('click'); assert.equal(report.textContent, '');
});

test('recap captures queued interval context without expanding its bounds and clears future data on reverse playback', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  data.emit('queue', 'user.message', { content: 'QUEUED 日本語', delivery: 'queued', interactionId: 'next' });
  data.emit('turn', 'assistant.turn_start', { turnId: '0', interactionId: 'next' }); emitRead(data, 'later');
  const ui = fixture(appSource, undefined, async () => feedResponse(data.trace.snapshot())); await ui.refreshFeed();
  ui.get('#recap-button').dispatch('click');
  const queued = ui.get('#recap-range').children.find(option => /Queued/.test(option.textContent));
  assert.ok(queued); ui.get('#recap-range').value = queued.value; ui.get('#recap-range').dispatch('change');
  assert.match(ui.get('#recap-report').textContent, /QUEUED 日本語/);
  assert.match(ui.get('#recap-scope').textContent, /3 events/);
  assert.match(ui.get('#recap-report').textContent, /earlier.*outside.*counts/i);
  const stale = ui.get('#recap-report').querySelector('button');
  ui.get('#playback-start').dispatch('click'); stale.dispatch('click');
  assert.equal(ui.get('#recap-report').textContent, ''); assert.equal(ui.get('#recap-panel').open, false);
  assert.doesNotMatch(ui.get('#timeline').textContent, /QUEUED/);
  ui.get('#playback-next').dispatch('click'); ui.get('#playback-next').dispatch('click'); selectRecap(ui, 'chapter:turn');
  assert.match(ui.get('#recap-report').textContent, /QUEUED/);
  const future = ui.get('#recap-report').querySelector('button');
  ui.get('#playback-previous').dispatch('click'); ui.get('#playback-previous').dispatch('click'); future.dispatch('click');
  assert.equal(ui.get('#recap-report').textContent, ''); assert.doesNotMatch(ui.get('#timeline').textContent, /QUEUED/);
});

test('incompatible retrieval results stay unknown in both Statistics extent and the frozen recap', async t => {
  const data = await predictionFixture(); t.after(() => data.trace.close());
  data.emit('read-start', 'tool.execution_start', { toolCallId: 'read', toolName: 'view', arguments: { path: 'file', view_range: [2, 3] } });
  data.emit('read-end', 'tool.execution_complete', { toolCallId: 'read', success: true, origin: 'custom', result: { content: 'UNTRUSTED_RETURNED_TEXT' } });
  const ui = fixture(appSource); ui.render(data.trace.snapshot().entries);
  assert.equal(ui.get('#retrieval-list').children.length, 0);
  const unknown = ui.get('#retrieval-unknown-list');
  assert.match(unknown.textContent, /Returned extent unknown/);
  assert.doesNotMatch(unknown.textContent, /code units retained|UNTRUSTED_RETURNED_TEXT|Lines 2/);
  assert.ok(unknown.querySelectorAll('button').length >= 2);
  selectRecap(ui); assert.match(ui.get('#recap-report').textContent, /Tool calls: 1/);
  assert.match(ui.get('#recap-report').textContent, /Retrieval status unknown: 1/);
  assert.doesNotMatch(ui.get('#recap-report').textContent, /text returned|UNTRUSTED_RETURNED_TEXT/);
});
