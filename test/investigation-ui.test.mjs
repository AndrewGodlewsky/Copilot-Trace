import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initInvestigation } from '../com.github.copilot/extensions/trace/web/investigation.mjs';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const metadata = { models: [{ id: 'a', providerId: 'copilot', name: 'A', efforts: ['high'] }, { id: 'b', providerId: 'copilot', name: 'B', efforts: ['high', 'max'] }], selected: { id: 'a', providerId: 'copilot', effort: 'high' }, settings: { revision: 0 } };
function fixture(request) {
  class Element {
    constructor() { this.value = ''; this.disabled = false; this.listeners = new Map(); this.children = []; }
    append(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    addEventListener(event, listener) { this.listeners.set(event, listener); }
    dispatch(event) { this.listeners.get(event)?.(); }
  }
  const nodes = new Map(['model', 'effort', 'settings-status', 'save', 'refresh'].map(id => [`investigation-${id}`, new Element()]));
  const document = { getElementById: id => nodes.get(id), createElement: () => new Element() };
  const ui = initInvestigation({ document, request, navigate() {} });
  return { ui, model: nodes.get('investigation-model'), effort: nodes.get('investigation-effort'), save: nodes.get('investigation-save'), refresh: nodes.get('investigation-refresh'), status: nodes.get('investigation-settings-status') };
}

test('model refresh owns disabled controls until its response has installed one consistent selection', async () => {
  const pending = deferred(), view = fixture(() => pending.promise);
  const opening = view.ui.openSettings();
  assert.equal(view.model.disabled, true); assert.equal(view.effort.disabled, true); assert.equal(view.refresh.disabled, true); assert.equal(view.save.disabled, true);
  view.model.dispatch('change'); assert.equal(view.save.disabled, true);
  pending.resolve(metadata); await opening;
  assert.equal(view.model.value, 'copilot/a'); assert.equal(view.effort.value, 'high'); assert.equal(view.model.disabled, false); assert.equal(view.save.disabled, false);
  view.ui.close();
});

test('saving freezes the submitted choice and prevents a second save or refresh before completion', async () => {
  const pending = deferred(), calls = [];
  const view = fixture(async (action, values) => { calls.push({ action, values }); return action === 'settings' ? metadata : pending.promise; });
  await view.ui.openSettings(); view.model.value = 'copilot/b'; view.model.dispatch('change'); assert.equal(view.effort.value, 'max');
  view.save.dispatch('click');
  assert.equal(view.model.disabled, true); assert.equal(view.effort.disabled, true); assert.equal(view.refresh.disabled, true); assert.equal(view.save.disabled, true);
  view.model.dispatch('change'); view.save.dispatch('click'); view.refresh.dispatch('click');
  assert.equal(calls.length, 2); assert.equal(calls[1].values.modelId, 'b'); assert.equal(calls[1].values.effort, 'max');
  pending.resolve({ revision: 1 }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(view.model.value, 'copilot/b'); assert.equal(view.effort.value, 'max'); assert.equal(view.save.disabled, false); assert.match(view.status.textContent, /saved/);
  view.ui.close();
});
