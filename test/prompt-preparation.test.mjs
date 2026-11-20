import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as footer from '../com.github.copilot/extensions/trace/web/footer.mjs';
import { createDiagnostics } from '../com.github.copilot/extensions/trace/web/diagnostics.mjs';

const blankOutline = 'Desired outcome:\n\nRelevant files or examples:\n\nConstraints:\n\nAllowed actions:\n\nEvidence of success:\n';
const source = await readFile(new URL('../com.github.copilot/extensions/trace/web/footer.mjs', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));

test('prompt copies use an outline only for empty text and preserve exact partial, full and Unicode drafts', () => {
  assert.equal(typeof footer.preparePromptCopy, 'function', 'The bounded prompt copy helper exists.');
  assert.equal(footer.preparePromptCopy(''), blankOutline);
  for (const draft of [' \t\n ', 'Only an outcome', blankOutline, '  café e\u0301 😀 漢字\r\n<script>literal</script>\n\tশেষ  ']) {
    assert.equal(footer.preparePromptCopy(draft), draft);
  }
});

test('the copy boundary keeps a complete Unicode draft and rejects oversized input without clipping', () => {
  assert.equal(typeof footer.preparePromptCopy, 'function');
  const exact = '😀'.repeat(8000);
  assert.equal(footer.preparePromptCopy(exact), exact);
  assert.equal(footer.preparePromptCopy(exact + 'x'), null);
  assert.equal(footer.preparePromptCopy('x'.repeat(200000)), null);
});

// A DOM boundary fixture executes the actual footer, including diagnostics export and queued close events.
// Native geometry, textarea/clipboard platform behavior and focus trapping still need owner acceptance.
function fixture(clipboard) {
  const nodes = new Map(), queuedCloses = [], windowEvents = new Map();
  let inspected = 0;
  const document = { activeElement: null, documentElement: { dataset: {} },
    getElementById: id => nodes.get(id),
    createElement: tag => new Element(tag),
    querySelectorAll(selector) {
      return [...nodes.values()].filter(node => selector === '.footer-panel' ? node.className === 'footer-panel'
        : selector === '[data-panel]' ? Boolean(node.dataset.panel) : selector === '[data-close-panel]' && node.dataset.closePanel !== undefined);
    },
  };
  class Element {
    constructor(tag, id) {
      this.tagName = tag; this.id = id; this.children = []; this.dataset = {}; this.listeners = new Map(); this.attributes = {};
      this.parentElement = null; this.isConnected = true; this.hidden = false; this.open = false; this.value = ''; this.textContent = ''; this.disabled = false;
      if (id) nodes.set(id, this);
    }
    append(...children) { for (const child of children) { this.children.push(child); child.parentElement = this; } }
    replaceChildren(...children) { this.children = []; this.textContent = ''; this.append(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    querySelector(selector) { return this.children.find(node => node.tagName === selector) || null; }
    closest(selector) { return this.tagName === selector ? this : this.parentElement?.closest(selector); }
    addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); }
    dispatch(name) {
      let prevented = false;
      const event = { preventDefault() { prevented = true; }, target: this };
      for (const listener of this.listeners.get(name) || []) listener(event);
      if (name === 'cancel' && !prevented) this.close();
    }
    showModal() { this.open = true; }
    close() { this.open = false; queuedCloses.push(() => this.dispatch('close')); }
    focus() { document.activeElement = this; }
    select() { this.selectionStart = 0; this.selectionEnd = this.value.length; }
  }
  document.body = new Element('body');
  for (const id of ['prompt-panel', 'settings-panel', 'logs-panel', 'releases-panel']) {
    const panel = new Element('dialog', id); panel.className = 'footer-panel'; document.body.append(panel);
    const close = new Element('button', id + '-close'); close.dataset.closePanel = ''; panel.append(close);
    const opener = new Element('button', id + '-opener'); opener.dataset.panel = id; document.body.append(opener);
  }
  for (const [id, tag] of [['prompt-draft', 'textarea'], ['prompt-copy', 'button'], ['prompt-status', 'p'], ['prompt-fallback', 'div'], ['prompt-output', 'textarea']]) {
    const node = new Element(tag, id); nodes.get('prompt-panel').append(node);
  }
  nodes.get('prompt-fallback').hidden = true;
  nodes.get('prompt-fallback').append(nodes.get('prompt-output'));
  for (const id of ['footer-status', 'plugin-version', 'feedback', 'release-list', 'text-size', 'refresh', 'log-output', 'log-status', 'update-logs', 'copy-logs', 'export-logs']) {
    new Element('div', id);
  }
  const diagnostics = createDiagnostics();
  const context = vm.createContext({ document, navigator: { clipboard }, diagnostics,
    window: { addEventListener(name, listener) { windowEvents.set(name, listener); } },
    fetch: async route => ({ ok: true, json: async () => route === 'metadata' ? { version: 'fixture', releases: [] }
      : { history: 'ready', retained: 0, omitted: 0, diagnostics: createDiagnostics().snapshot() } }),
    AbortSignal, performance, setTimeout, URL, Blob,
    refresh: async () => true, onInspect: () => { inspected++; },
  });
  const panels = vm.runInContext(source.replace(/^export /gm, '') + '\ninitFooter({ diagnostics, refresh, onInspect });', context);
  return {
    get: id => nodes.get(id), document, diagnostics, panels,
    get inspected() { return inspected; },
    open() { nodes.get('prompt-panel-opener').dispatch('click'); },
    edit(value) { nodes.get('prompt-draft').value = value; nodes.get('prompt-draft').dispatch('input'); },
    copy() { nodes.get('prompt-copy').dispatch('click'); },
    close() { nodes.get('prompt-panel-close').dispatch('click'); },
    flushCloses() { while (queuedCloses.length) queuedCloses.shift()(); },
    pagehide() { windowEvents.get('pagehide')?.(); },
  };
}

test('empty copy requests the outline explicitly; partial text copies exactly and newer edits clear the result', async () => {
  const writes = [], ui = fixture({ writeText: async text => writes.push(text) });
  ui.open(); assert.equal(ui.inspected, 1); assert.deepEqual(writes, []);
  assert.equal(ui.get('prompt-draft').value, '');
  ui.copy(); await settle();
  assert.deepEqual(writes, [blankOutline]); assert.match(ui.get('prompt-status').textContent, /copied/i);
  const draft = ' \t\n<em>private café 😀 漢字</em>\n  ';
  ui.edit(draft); assert.doesNotMatch(ui.get('prompt-status').textContent, /copied/i);
  ui.copy(); await settle(); assert.equal(writes[1], draft);
  assert.equal(ui.get('prompt-draft').value, draft);
});

for (const kind of ['unavailable', 'denied', 'throwing']) test(`${kind} clipboard offers exact selectable fallback without private diagnostic output`, async () => {
  const privateText = ' \tPRIVATE-DRAFT 😀 <img onerror="secret()">\n  ';
  const clipboard = kind === 'unavailable' ? undefined : { writeText() {
    if (kind === 'throwing') throw new Error(privateText);
    return Promise.reject(new Error(privateText));
  } };
  const ui = fixture(clipboard); ui.open(); ui.edit(privateText); ui.copy(); await settle();
  const output = ui.get('prompt-output');
  assert.equal(ui.get('prompt-fallback').hidden, false);
  assert.equal(output.value, privateText); assert.equal(output.children.length, 0);
  assert.equal(output.selectionStart, 0); assert.equal(output.selectionEnd, privateText.length);
  assert.equal(ui.document.activeElement, output);
  assert.match(ui.get('prompt-status').textContent, /copy shortcut/i);
  assert.doesNotMatch(ui.get('prompt-status').textContent, /PRIVATE|secret|img/);
  ui.close();
  assert.equal(ui.get('prompt-draft').value, ''); assert.equal(output.value, '');
  assert.equal(ui.get('prompt-fallback').hidden, true); assert.equal(ui.get('prompt-status').textContent, '');
  ui.flushCloses(); ui.get('logs-panel-opener').dispatch('click'); await settle();
  assert.match(ui.get('log-output').value, /plugin diagnostics/);
  assert.doesNotMatch(ui.get('log-output').value, /PRIVATE|secret|img/);
  assert.doesNotMatch(JSON.stringify(ui.diagnostics.snapshot()), /PRIVATE|secret|img/);
});

test('oversized drafts stay fully editable and selectable without a clipped copy or stale fallback', async () => {
  const writes = [], ui = fixture({ writeText: text => { writes.push(text); throw new Error('denied'); } });
  ui.open(); ui.edit('previous'); ui.copy(); await settle();
  const draft = '😀'.repeat(8000) + '\nend'; ui.edit(draft); ui.copy(); await settle();
  assert.equal(ui.get('prompt-draft').value, draft);
  ui.get('prompt-draft').select(); assert.equal(ui.get('prompt-draft').selectionEnd, draft.length);
  assert.equal(ui.get('prompt-copy').disabled, true); assert.deepEqual(writes, ['previous']);
  assert.match(ui.get('prompt-status').textContent, /16,000|16000/);
  assert.match(ui.get('prompt-status').textContent, /copy shortcut/i);
  assert.equal(ui.get('prompt-output').value, ''); assert.equal(ui.get('prompt-fallback').hidden, true);
  ui.edit('   '); assert.equal(ui.get('prompt-copy').disabled, false); ui.copy(); await settle(); assert.equal(writes.at(-1), '   ');
});

for (const result of ['resolve', 'reject']) test(`pending clipboard ${result} cannot overwrite an edited draft or newer copy state`, async () => {
  const pending = [], ui = fixture({ writeText: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) });
  ui.open(); ui.edit('old private'); ui.copy();
  ui.edit('new private'); ui.copy();
  const state = ui.get('prompt-status').textContent;
  pending[0][result](new Error('old private')); await settle();
  assert.equal(ui.get('prompt-draft').value, 'new private'); assert.equal(ui.get('prompt-status').textContent, state);
  assert.equal(ui.get('prompt-output').value, ''); assert.equal(ui.get('prompt-fallback').hidden, true);
  pending[1].reject(new Error('new private')); await settle();
  assert.equal(ui.get('prompt-output').value, 'new private');
});

for (const result of ['resolve', 'reject']) test(`editing alone invalidates a pending clipboard ${result}`, async () => {
  let complete;
  const ui = fixture({ writeText: () => new Promise((resolve, reject) => { complete = result === 'resolve' ? resolve : reject; }) });
  ui.open(); ui.edit('old private'); ui.copy(); ui.edit('new private');
  complete(new Error('old private')); await settle();
  assert.equal(ui.get('prompt-draft').value, 'new private'); assert.equal(ui.get('prompt-output').value, '');
  assert.equal(ui.get('prompt-status').textContent, ''); assert.equal(ui.get('prompt-fallback').hidden, true);
});

for (const result of ['resolve', 'reject']) test(`queued close and pending clipboard ${result} cannot clear or repopulate a reopened draft`, async () => {
  let complete;
  const ui = fixture({ writeText: () => new Promise((resolve, reject) => { complete = result === 'resolve' ? resolve : reject; }) });
  ui.open(); ui.edit('discard me'); ui.copy(); ui.close();
  assert.equal(ui.get('prompt-draft').value, ''); assert.equal(ui.get('prompt-output').value, '');
  assert.equal(ui.document.activeElement, ui.get('prompt-panel-opener'));
  ui.open(); assert.equal(ui.get('prompt-draft').value, ''); ui.edit('keep new');
  ui.flushCloses(); complete(new Error('discard me')); await settle();
  assert.equal(ui.get('prompt-panel').open, true); assert.equal(ui.get('prompt-draft').value, 'keep new');
  assert.equal(ui.get('prompt-output').value, ''); assert.equal(ui.get('prompt-fallback').hidden, true);
  assert.doesNotMatch(ui.get('prompt-status').textContent, /copied|blocked|unavailable/i);
});

test('reopening before an externally closed dialog delivers its close event resets only the previous draft', async () => {
  const ui = fixture(undefined); ui.open(); ui.edit('old fallback'); ui.copy(); await settle();
  ui.get('prompt-panel').close();
  ui.open(); assert.equal(ui.get('prompt-draft').value, ''); assert.equal(ui.get('prompt-output').value, '');
  ui.edit('new draft'); ui.flushCloses();
  assert.equal(ui.get('prompt-draft').value, 'new draft'); assert.equal(ui.get('prompt-panel').open, true);
  assert.equal(ui.get('prompt-panel-opener').attributes['aria-expanded'], 'true');
});

for (const close of ['escape', 'switch', 'pagehide']) test(`${close} discards draft and fallback, ignores a late result and leaves fresh state`, async () => {
  let rejectCopy;
  const ui = fixture({ writeText: () => new Promise((_, reject) => { rejectCopy = reject; }) });
  ui.open(); ui.edit('discard private'); ui.copy();
  if (close === 'escape') ui.get('prompt-panel').dispatch('cancel');
  else if (close === 'switch') {
    ui.panels.closePanel('prompt-panel', { restoreFocus: false });
    ui.get('settings-panel-opener').dispatch('click');
  } else ui.pagehide();
  rejectCopy(new Error('discard private')); await settle(); ui.flushCloses();
  assert.equal(ui.get('prompt-draft').value, ''); assert.equal(ui.get('prompt-output').value, '');
  assert.equal(ui.get('prompt-status').textContent, ''); assert.equal(ui.get('prompt-fallback').hidden, true);
  if (close === 'escape') assert.equal(ui.document.activeElement, ui.get('prompt-panel-opener'));
  if (close === 'switch') assert.equal(ui.get('settings-panel').open, true);
});
