import { explanationData, skillInstructions } from './presentation.mjs';
import { retainedExample } from './glossary.mjs';

const text = (value, limit = 256) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const states = new Set(['ready', 'unsupported', 'unavailable', 'timeout', 'session-mismatch', 'closed', 'malformed']);
const types = new Set(['home', 'repo', 'model', 'vscode', 'nested-agents', 'child-instructions', 'plugin']);
const locations = new Set(['user', 'repository', 'working-directory', 'plugin']);
const nullableText = (value, limit) => value === null || text(value, limit);
const recordedTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : 'time unknown';
function validInventory(inventory) {
  const section = inventory?.sources;
  return inventory?.schemaVersion === 1 && inventory.scope === 'main-session' && text(inventory.capturedAt, 64) && Number.isFinite(Date.parse(inventory.capturedAt))
    && states.has(section?.status) && ['omitted', 'invalid', 'clipped'].every(key => Number.isSafeInteger(section[key]) && section[key] >= 0)
    && Array.isArray(section.items) && section.items.length <= 100 && section.items.every(item => item && text(item.id)
      && nullableText(item.label, 256) && nullableText(item.sourcePath, 2048) && (item.type === null || types.has(item.type)) && (item.location === null || locations.has(item.location))
      && (item.applyTo === null || Array.isArray(item.applyTo) && item.applyTo.length <= 32 && item.applyTo.every(value => text(value, 512)))
      && (item.defaultDisabled === null || typeof item.defaultDisabled === 'boolean') && typeof item.identityValid === 'boolean'
      && (!item.identityValid || !section.omitted && item.sourcePath !== null && item.type !== null && item.location !== null && section.items.filter(other => other?.id === item.id).length === 1)
      && (item.content === null || typeof item.content === 'string' && item.content.length <= 12000)
      && (item.contentStatus === 'missing' ? item.content === null : item.contentStatus === 'empty' ? item.content === ''
        : ['complete', 'clipped'].includes(item.contentStatus) && typeof item.content === 'string' && item.content.length > 0));
}

export function instructionSources(inventory, snapshot = {}) {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries.slice(0, 300) : [], valid = validInventory(inventory);
  const current = valid && inventory.sources.status === 'ready' ? inventory.sources.items.map((item, index) => ({ ...item, index,
    group: `${item.location || 'Location unknown'} / ${item.type || 'Type unknown'}`,
    scopeNote: item.applyTo?.length ? `Declared applicability: ${item.applyTo.join(', ')}. Matching files and historical application are unknown.` : 'Applicability scope unknown; no usable applyTo patterns were reported.',
    note: `${['nested-agents', 'child-instructions'].includes(item.type) ? 'Discovery/index record; referenced instruction bodies are not established as loaded. ' : ''}Current host-reported source. Historical inclusion, load time and compliance are unknown.`,
  })) : [];
  const loads = [], groups = new Map();
  for (const [index, entry] of entries.entries()) {
    const skill = skillInstructions(entry);
    if (!skill) continue;
    const data = explanationData(entry), agentId = entry.agentId;
    const identityValid = retainedExample(entries, entry) && typeof agentId === 'string' && agentId.length <= 256
      && text(data?.name) && typeof data.path === 'string' && data.path.length <= 2048 && text(data.source);
    const key = identityValid ? JSON.stringify([agentId, data.name, data.path, data.source])
      : JSON.stringify(['unknown', entry.id, entries.filter(other => other.id === entry.id).length > 1 ? index : null]);
    let group = groups.get(key);
    if (!group) {
      group = { key, name: skill.name, agentId, path: typeof data?.path === 'string' && data.path.length <= 2048 ? data.path : null,
        source: text(data?.source) ? data.source : null, identityValid, occurrences: [] };
      groups.set(key, group); loads.push(group);
    }
    group.occurrences.push({ entry: Object.freeze({ ...entry }), timestamp: entry.timestamp, ...skill });
  }
  return { current, loads, capturedAt: valid ? inventory.capturedAt : null,
    window: `${entries.length} retained events; ${snapshot.omitted || 0} older events omitted. ${snapshot.history === 'ready' ? 'Only supported retained skill events appear below.' : 'History is incomplete or unavailable.'}`,
    note: 'Current sources and recorded skill loads are separate evidence. This is not a complete prompt or instruction hierarchy. Reported order does not establish universal precedence, conflict resolution or compliance. An empty source list can omit instructions supplied to the model. Child-agent current sources are unknown.' };
}

export async function fetchInstructionSources(signal) {
  const response = await fetch('instruction-sources', { signal });
  if (!response.ok || !response.body) throw new Error('Instruction sources unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('Instruction response too large.');
      body += decoder.decode(value, { stream: true });
    }
    return JSON.parse(body + decoder.decode());
  } finally { await reader.cancel().catch(() => {}); }
}

export function initInstructionSources({ document: doc = globalThis.document, load = fetchInstructionSources, onInspect = () => {}, onOriginal = () => {} } = {}) {
  const get = id => doc.querySelector(`#instruction-${id}`);
  const disclosure = get('sources'), button = get('refresh'), currentList = get('current'), loadList = get('loads');
  const currentGroups = new Map(), loadGroups = new Map();
  let inventory, retained = {}, selected, sequence = 0, closed = false, controller, timer, loading = false, failed = false;
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  const element = (tag, value) => { const node = doc.createElement(tag); if (value !== undefined) node.textContent = value; return node; };
  const actor = id => id === '' ? 'Main chat' : text(id) ? `Agent ${id}` : 'Source unavailable';
  function place(parent, item, previous) {
    const expected = previous ? previous.nextElementSibling : parent.firstElementChild;
    if (expected !== item) parent.insertBefore(item, expected);
    return item;
  }
  function groupNode(cache, key, label, parent, previous) {
    let node = cache.get(key);
    if (!node) {
      const item = element('li'), details = element('details'), title = element('summary'), list = element('ol');
      details.append(title, list); item.append(details);
      details.addEventListener('toggle', () => { if (!closed && details.open) onInspect(); });
      node = { item, title, list, rows: new Map() }; cache.set(key, node);
    }
    setText(node.title, label); place(parent, node.item, previous);
    return node;
  }
  function reconcileRows(group, rows, inspect) {
    let previous;
    const keys = new Set();
    for (const row of rows) {
      keys.add(row.key);
      let node = group.rows.get(row.key);
      if (!node) {
        const item = element('li'), button = element('button'); button.type = 'button';
        item.append(button); node = { item, button };
        button.addEventListener('click', () => { if (!closed) inspect(node.target); });
        group.rows.set(row.key, node);
      }
      node.target = row.target; setText(node.button, row.label);
      previous = place(group.list, node.item, previous);
    }
    for (const [key, node] of group.rows) if (!keys.has(key)) { node.item.remove(); group.rows.delete(key); }
  }
  function prune(cache, keys) {
    for (const [key, node] of cache) if (!keys.has(key)) { node.item.remove(); cache.delete(key); }
  }
  function selectionStatus() {
    if (!selected) return;
    const expired = selected.kind === 'skill' && !retainedExample(retained.entries || [], selected.entry);
    get('original').hidden = selected.kind !== 'skill'; get('original').disabled = expired;
    setText(get('selection-status'), selected.kind === 'skill'
      ? expired ? 'The original load is no longer retained or its evidence changed. This inspection stays fixed; its original-event link is unavailable.'
        : 'Exact retained skill occurrence. Its body is not the complete prompt and does not prove compliance.'
      : selected.inventory !== inventory ? 'Inspecting an earlier snapshot. This body stays fixed; choose a current source to inspect the refreshed capture.'
        : 'Inspecting this retrieved source snapshot. Historical inclusion and load time are unknown; the host source may change after retrieval.');
  }
  function showSelection(title, detail, content) {
    onInspect(); disclosure.open = true; get('inspector').hidden = false;
    setText(get('title'), title); setText(get('detail'), detail); setText(get('body'), content ?? '');
    get('body').hidden = content === null; get('body').scrollTop = 0;
    selectionStatus(); get('title').focus({ preventScroll: true }); get('inspector').scrollIntoView({ block: 'nearest' });
  }
  function inspectCurrent(item) {
    selected = { kind: 'current', inventory };
    const flag = item.defaultDisabled === true ? 'Starts disabled; current enabled state unknown.'
      : item.defaultDisabled === false ? 'Does not start disabled; current enabled state unknown.' : 'Default-disabled flag and current enabled state unknown.';
    const body = item.contentStatus === 'missing' ? 'Body unavailable in the host response.' : item.contentStatus === 'empty'
      ? 'The host reported an empty body.' : item.contentStatus === 'clipped' ? 'Body clipped to at most 12,000 UTF-16 code units.' : 'Body captured exactly as returned by the host.';
    showSelection(item.label || 'Source label unavailable', `Retrieved ${inventory.capturedAt}.\nSource ID: ${item.id}\nReported source reference: ${item.sourcePath ?? 'unknown'}\nReported location/type: ${item.group}\n${item.identityValid ? 'Identity is usable within this bounded snapshot.' : 'Identity is ambiguous or incomplete.'}\n${item.scopeNote}\n${flag}\n${body}\n${item.note}`, item.content);
  }
  function inspectSkill(entry) {
    if (closed) return;
    const skill = skillInstructions(entry);
    if (!skill) return;
    const data = explanationData(entry);
    const note = skill.previewTruncated ? 'Complete instruction body retained; shown below.' : skill.note;
    selected = { kind: 'skill', entry: Object.freeze({ ...entry }) };
    showSelection(skill.name || 'Skill name unavailable', `Recorded skill load: ${recordedTime(entry.timestamp)}\n${actor(entry.agentId)}\nRecorded source: ${text(data?.source) ? data.source : 'unknown'}\nRecorded path: ${typeof data?.path === 'string' && data.path.length <= 2048 ? data.path || '(empty)' : 'unknown'}\nApplicability scope unknown; skill content is not a full instruction hierarchy.\n${note}`, skill.content);
  }
  function render() {
    const comparison = instructionSources(inventory, retained), focused = doc.activeElement;
    const focusedList = currentList.contains(focused) ? currentList : loadList.contains(focused) ? loadList : null;
    const panel = doc.querySelector('#statistics-panel'), scroll = panel.scrollTop;
    setText(get('scope'), comparison.note); setText(get('window'), comparison.window);
    const section = inventory?.sources;
    setText(get('status'), `${loading ? 'Reading source snapshot… ' : failed ? 'Refresh unavailable. Previous snapshot, if shown, may be stale. ' : ''}${comparison.capturedAt
      ? `Retrieved ${comparison.capturedAt}. Source state: ${section.status}; ${section.omitted} omitted; ${section.invalid} invalid or ambiguous; ${section.clipped} bodies clipped. Current sources may have changed since retrieval.`
      : 'Current sources unknown until you request a snapshot.'}`);
    const grouped = new Map();
    for (const item of comparison.current) {
      if (!grouped.has(item.group)) grouped.set(item.group, []);
      grouped.get(item.group).push({ key: `${item.index}:${item.id}`, label: `Inspect captured source: ${item.label || item.id}`, target: item });
    }
    if (grouped.size && !currentGroups.size) currentList.replaceChildren();
    let previous;
    for (const [key, rows] of grouped) {
      const node = groupNode(currentGroups, key, `${key} · ${rows.length} reported source${rows.length === 1 ? '' : 's'}`, currentList, previous);
      reconcileRows(node, rows, inspectCurrent); previous = node.item;
    }
    prune(currentGroups, new Set(grouped.keys()));
    if (!grouped.size) setText(currentList, comparison.capturedAt && section.status === 'ready'
      ? 'No sources reported. This does not mean the model received no instructions.' : 'No current source snapshot is available. Recorded skill loads can still appear below.');
    if (comparison.loads.length && !loadGroups.size) loadList.replaceChildren();
    previous = undefined;
    for (const group of comparison.loads) {
      const title = `${group.name || 'Skill name unavailable'} · ${actor(group.agentId)} · ${group.source ?? 'Source unknown'} · ${group.path === '' ? 'Empty path' : group.path ?? 'Path unknown'} · ${group.occurrences.length} recorded load${group.occurrences.length === 1 ? '' : 's'}${group.identityValid ? '' : ' · Identity incomplete; kept separate'}`;
      const node = groupNode(loadGroups, group.key, title, loadList, previous);
      reconcileRows(node, group.occurrences.map(occurrence => ({ key: JSON.stringify(occurrence.entry),
        label: `Inspect recorded skill load: ${recordedTime(occurrence.timestamp)} · body ${occurrence.status}`, target: occurrence.entry })), inspectSkill);
      previous = node.item;
    }
    prune(loadGroups, new Set(comparison.loads.map(group => group.key)));
    if (!comparison.loads.length) setText(loadList, 'No retained skill loads. Missing events do not prove that instructions were unused.');
    selectionStatus();
    if (focusedList && !focused.isConnected) { onInspect(); focusedList.focus({ preventScroll: true }); }
    panel.scrollTop = scroll;
  }
  async function refresh() {
    if (closed) return;
    const request = ++sequence;
    clearTimeout(timer); controller?.abort(); controller = new AbortController();
    const activeController = controller, timeout = setTimeout(() => activeController.abort(), 6000); timer = timeout;
    loading = true; failed = false; button.disabled = true; onInspect(); render();
    try {
      const next = await load(activeController.signal);
      if (closed || request !== sequence || activeController.signal.aborted) return;
      if (!validInventory(next)) throw new Error('Invalid instruction snapshot.');
      inventory = next;
    } catch { if (!closed && request === sequence) failed = true; }
    finally {
      clearTimeout(timeout);
      if (!closed && request === sequence) { loading = false; button.disabled = false; render(); }
    }
  }
  button.addEventListener('click', () => { void refresh(); });
  disclosure.addEventListener('toggle', () => { if (!closed && disclosure.open) onInspect(); });
  get('original').addEventListener('click', () => {
    if (closed) return;
    selectionStatus();
    if (selected?.kind === 'skill' && retainedExample(retained.entries || [], selected.entry)) onOriginal(selected.entry);
  });
  render();
  return { refresh, inspectSkill, update(snapshot) { if (!closed) { retained = snapshot; render(); } },
    close() { closed = true; sequence++; clearTimeout(timer); controller?.abort(); } };
}
