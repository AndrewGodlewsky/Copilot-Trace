export async function investigationRequest(action, values = {}) {
  const response = await fetch('investigation', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Trace-Request': 'investigation' },
    body: JSON.stringify({ action, ...values }), signal: AbortSignal.timeout(10000) });
  const value = await response.json();
  if (!response.ok) throw Error(value.message || 'Investigation request failed.');
  return value;
}

export function initInvestigation({ document = globalThis.document, request = investigationRequest, navigate, schedule = setTimeout, cancelTimer = clearTimeout }) {
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const get = id => document.getElementById(id), views = new Set();
  let active, timer, closed = false, settings, settingsGeneration = 0, settingsBusy = false, visible = [], checking;
  const fail = error => typeof error?.message === 'string' ? error.message : 'Investigation unavailable.';
  function current(view, generation) { return !closed && view.live && view.generation === generation && views.has(view); }
  function discard(view, message) {
    view.generation++; view.capture = undefined; view.retained = undefined; view.completed = undefined; view.result.replaceChildren(); view.scope.replaceChildren(); view.start.disabled = true;
    view.inspect.disabled = !view.live; view.status.textContent = message;
    if (active?.view === view) {
      const operation = active; active = undefined; cancelTimer(timer);
      void request('cancel', { requestId: operation.id }).catch(() => {});
    }
    view.cancel.hidden = true;
  }
  function updateButtons() { for (const view of views) { view.inspect.disabled = !view.live || Boolean(active); view.start.disabled = !view.live || !view.capture || Boolean(active); } }
  function done(operation, value) {
    if (active !== operation || !current(operation.view, operation.generation)) return;
    const view = operation.view; view.status.textContent = value.message || value.progress || value.state;
    if (value.busy) { timer = schedule(() => void poll(operation), 700); return; }
    active = undefined; view.cancel.hidden = true; view.capture = undefined; updateButtons();
    if (value.state !== 'completed' || !value.result) return;
    view.completed = operation.id;
    view.result.append(make('h4', 'AI interpretation'), make('p', `${value.model.name} · ${value.model.effort} reasoning. This is a possible explanation, not proof of cause.`));
    for (const [key, label] of [['what', 'What failed'], ['possibleCause', 'Possible cause'], ['unknowns', 'Still unknown'], ['nextCheck', 'Next check']]) view.result.append(make('h4', label), make('p', value.result[key]));
    for (const ref of value.result.references) {
      const evidence = value.records.find(record => record.ref === ref); if (!evidence) continue;
      const button = make('button', `Open original evidence ${ref}`); button.type = 'button';
      button.addEventListener('click', () => { if (current(view, operation.generation)) navigate(evidence.id); }); view.result.append(button);
    }
    const receipt = value.receipt;
    if (receipt) view.result.append(make('p', `${receipt.usage === 'known' ? `Reported helper usage: ${receipt.inputTokens} input / ${receipt.outputTokens} output tokens.` : 'Helper usage is incomplete or unavailable.'} Cleanup: ${receipt.cleanup}.`, 'investigation-note'));
    view.status.textContent = 'Investigation complete.';
  }
  async function poll(operation) {
    try {
      const value = await request('status');
      if (value.requestId !== operation.id) { if (active === operation) discard(operation.view, 'Request changed. Inspect the evidence again.'); return; }
      done(operation, value);
    } catch {
      if (active === operation) { discard(operation.view, 'Connection lost. Cancellation was requested; helper release is not yet confirmed. Inspect again only after the server is available.'); updateButtons(); }
    }
  }
  function attach(entry, live = true) {
    const section = make('section', undefined, 'failure-investigation'); section.setAttribute('aria-label', 'Investigate recorded failure');
    const inspect = make('button', 'Refresh scope'), start = make('button', 'Investigate'), cancel = make('button', 'Cancel');
    for (const button of [inspect, start, cancel]) button.type = 'button'; start.disabled = true; cancel.hidden = true;
    const status = make('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    const scope = make('div'), result = make('div');
    section.append(make('h3', 'Investigate this failure'), make('p', 'Get a short possible explanation from the evidence below. Only Investigate sends it to a separate Copilot chat. Model preferences are in Settings.'), scope, start, cancel, inspect, status, result);
    const view = { section, inspect, start, cancel, status, scope, result, entry, live, generation: 0 }; views.add(view);
    inspect.disabled = !live;
    if (!live) status.textContent = 'Investigations are available only in the current live view.';
    async function prepare() {
      if (!view.live || active || closed || view.loading) return;
      discard(view, 'Preparing the evidence preview…'); inspect.disabled = true; const generation = view.generation;
      view.loading = true;
      try {
        const captured = await request('preview', { eventId: view.entry.id });
        if (!current(view, generation)) return;
        if (!captured.records.every(record => visible.filter(entry => entry.id === record.id && entry.evidence === record.evidence).length === 1)) throw Error('Evidence changed or is outside the displayed view. Refresh the scope.');
        view.capture = captured;
        view.retained = captured.records;
        scope.append(make('p', `${captured.model.name} · ${captured.model.effort} reasoning`));
        const disclosure = make('details'); disclosure.append(make('summary', 'Evidence scope · inspect before sending'), make('p', captured.scope)); scope.append(disclosure);
        for (const record of captured.records) {
          const details = make('details'), pre = make('pre', record.evidence); pre.tabIndex = 0;
          details.append(make('summary', `${record.ref} · ${record.type} · Exact evidence to send`), pre); disclosure.append(details);
        }
        disclosure.append(make('p', 'Trace keeps no prompt or answer files. Copilot runtime/provider logging may retain them. No command or repair will run.', 'investigation-note'));
        status.textContent = 'Ready to investigate.';
      } catch (error) { if (current(view, generation)) status.textContent = fail(error); }
      finally { view.loading = false; if (current(view, generation)) updateButtons(); }
    }
    inspect.addEventListener('click', () => void prepare());
    view.prepare = () => { if (!view.capture) void prepare(); };
    start.addEventListener('click', async () => {
      if (!view.live || active || closed || !view.capture) return;
      const operation = { id: globalThis.crypto.randomUUID(), view, generation: view.generation }; active = operation;
      for (const other of views) if (other !== view) { other.result.replaceChildren(); other.completed = undefined; }
      view.result.replaceChildren(); cancel.hidden = false; status.textContent = 'Starting isolated investigation…'; updateButtons();
      try { done(operation, await request('start', { captureId: view.capture.captureId, requestId: operation.id })); }
      catch (error) { if (active === operation) { discard(view, `${fail(error)} Cancellation requested; no retry was made.`); updateButtons(); } }
    });
    cancel.addEventListener('click', () => {
      if (active?.view !== view) return;
      const operation = active; cancel.disabled = true; status.textContent = 'Cancelling and releasing helper…';
      void request('cancel', { requestId: operation.id }).then(value => done(operation, value), () => {
        if (active === operation) discard(view, 'Cancellation could not be confirmed. The server will continue enforcing its deadline.');
      }).finally(() => { cancel.disabled = false; });
    });
    return view;
  }
  function reconcile(entries, live) {
    visible = entries;
    for (const view of views) {
      const matches = entries.filter(entry => entry.id === view.entry.id), next = matches[0];
      const changed = matches.length !== 1 || next.evidence !== view.entry.evidence || next.truncated !== view.entry.truncated || next.type !== view.entry.type ||
        view.retained?.some(record => entries.filter(entry => entry.id === record.id && entry.evidence === record.evidence).length !== 1);
      const modeChanged = view.live !== live; view.live = live && matches.length === 1;
      if (changed || modeChanged) discard(view, live ? 'Evidence changed. Inspect the current scope again.' : 'Investigations are available only in the current live view.');
      if (next) view.entry = next;
      if (!matches.length) views.delete(view);
    }
    updateButtons();
  }
  function check() {
    const view = [...views].find(item => item.completed);
    if (closed || active || checking || !view) return;
    const id = view.completed, generation = view.generation;
    checking = request('status').then(value => {
      if (current(view, generation) && view.completed === id && (value.requestId !== id || value.state !== 'completed')) discard(view, value.message || 'Investigation is no longer current.');
    }, () => { if (current(view, generation) && view.completed === id) discard(view, 'Investigation freshness could not be confirmed.'); }).finally(() => { checking = undefined; });
  }
  const model = get('investigation-model'), effort = get('investigation-effort'), status = get('investigation-settings-status');
  function settingsControls(busy) {
    settingsBusy = busy;
    model.disabled = effort.disabled = get('investigation-refresh').disabled = busy;
    const selected = settings?.models.find(item => `${item.providerId}/${item.id}` === model.value);
    get('investigation-save').disabled = busy || !selected?.efforts.includes(effort.value);
  }
  function renderEfforts(preferred) {
    const selected = settings?.models.find(item => `${item.providerId}/${item.id}` === model.value); effort.replaceChildren();
    for (const value of selected?.efforts ?? []) { const option = make('option', value); option.value = value; effort.append(option); }
    effort.value = selected?.efforts.includes(preferred) ? preferred : selected?.efforts.at(-1) ?? '';
    settingsControls(settingsBusy);
  }
  model.addEventListener('change', () => { if (!settingsBusy) renderEfforts(); });
  async function openSettings() {
    if (closed || settingsBusy) return;
    const generation = ++settingsGeneration; status.textContent = 'Reading available Copilot models…'; settingsControls(true);
    try {
      const data = await request('settings'); if (closed || generation !== settingsGeneration) return; settings = data; model.replaceChildren();
      for (const item of data.models) { const option = make('option', item.name); option.value = `${item.providerId}/${item.id}`; model.append(option); }
      model.value = data.selected ? `${data.selected.providerId}/${data.selected.id}` : ''; renderEfforts(data.selected?.effort);
      status.textContent = data.message || 'Model and reasoning preferences are remembered across sessions. Parent chat settings are unchanged.';
    } catch (error) { if (!closed && generation === settingsGeneration) status.textContent = fail(error); }
    finally { if (!closed && generation === settingsGeneration) settingsControls(false); }
  }
  get('investigation-refresh').addEventListener('click', () => void openSettings());
  get('investigation-save').addEventListener('click', async () => {
    if (closed || settingsBusy) return;
    const selected = settings?.models.find(item => `${item.providerId}/${item.id}` === model.value); if (!selected || !selected.efforts.includes(effort.value)) return;
    const generation = ++settingsGeneration; settingsControls(true); status.textContent = 'Saving preferences…';
    try {
      const saved = await request('save', { revision: settings.settings.revision, modelId: selected.id, providerId: selected.providerId, effort: effort.value });
      if (closed || generation !== settingsGeneration) return; settings.settings = saved;
      for (const view of views) discard(view, 'Settings changed. Inspect a new investigation scope.');
      status.textContent = 'Investigation preferences saved.';
    } catch (error) { if (!closed && generation === settingsGeneration) status.textContent = fail(error); }
    finally { if (!closed && generation === settingsGeneration) settingsControls(false); }
  });
  return { attach, reconcile, check, openSettings, close() { closed = true; settingsGeneration++; cancelTimer(timer); for (const view of views) discard(view, 'Trace closed.'); views.clear(); } };
}
