import { explanationData, skillInstructions, toolBuckets, toolProvenance } from './presentation.mjs';

const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const key = row => JSON.stringify([row.kind, row.source, row.name, row.mcpServerName, row.mcpToolName, row.catalogSource]);
const mcpFields = ['mcpConfigServerName', 'mcpServerName', 'mcpToolName', 'mcpServerDisplayName', 'mcpConfigSource', 'mcpTransport'];

export function compareCapabilities(inventory, snapshot = {}) {
  const entries = Array.isArray(snapshot.entries) ? snapshot.entries.slice(0, 300) : [];
  const valid = inventory?.schemaVersion === 1 && inventory.scope === 'main-session' && Number.isFinite(Date.parse(inventory.capturedAt));
  const rows = [], observations = [], provenance = toolProvenance(entries);
  for (const { boundaries, start, data } of toolBuckets(entries)) {
    const entry = start || boundaries[0], origin = provenance.get(entry.id);
    const hasMcp = data && mcpFields.some(field => data[field] !== undefined);
    const identityValid = Boolean(data && text(data.toolName) && (!hasMcp || origin?.origin === 'MCP' && text(origin.serverKey)));
    observations.push({ kind: 'tool', source: entry.agentId, name: data?.toolName || entry.toolName || 'Tool identity unavailable',
      mcpServerName: hasMcp ? origin?.serverKey : null, mcpToolName: hasMcp ? origin?.toolName : null,
      catalogSource: null, identityValid, eventId: entry.id });
  }
  for (const entry of entries.filter(entry => entry.type === 'skill.invoked')) {
    const data = explanationData(entry), skill = skillInstructions(entry);
    observations.push({ kind: 'skill', source: entry.agentId, name: text(skill.name) ? skill.name : 'Skill identity unavailable',
      catalogSource: data?.source ?? null, mcpServerName: null, mcpToolName: null,
      identityValid: text(skill.name) && (data?.source === undefined || text(data.source)), eventId: entry.id });
  }
  for (const [kind, section] of [['tool', inventory?.tools], ['skill', inventory?.skills]]) {
    if (!valid || section?.status !== 'ready' || !Array.isArray(section.items)) continue;
    for (const item of section.items.slice(0, 200)) {
      if (!text(item?.name)) continue;
      rows.push({ kind, source: '', name: item.name, mcpServerName: item.mcpServerName ?? null, mcpToolName: item.mcpToolName ?? null,
        catalogSource: item.source ?? null, enabled: item.enabled ?? null, userInvocable: item.userInvocable ?? null,
        modelInvocable: 'unknown', deferLoading: item.deferLoading ?? null,
        current: item.identityValid === true && !section.omitted ? kind === 'tool' ? 'available' : 'listed' : 'unknown',
        observed: false, count: 0, identityValid: item.identityValid === true && !section.omitted });
    }
  }
  for (const observation of observations) {
    const candidates = observation.source === '' ? rows.filter(row => row.source === '' && row.kind === observation.kind && row.name === observation.name) : [];
    const matches = candidates.filter(row => row.identityValid && observation.identityValid && (row.kind === 'tool'
      ? row.mcpServerName === observation.mcpServerName && row.mcpToolName === observation.mcpToolName
      : observation.catalogSource === null || row.catalogSource === observation.catalogSource));
    if (candidates.length === 1 && matches.length === 1) {
      matches[0].observed = true; matches[0].count++; matches[0].eventId ??= observation.eventId;
      continue;
    }
    for (const candidate of candidates) { candidate.current = 'unknown'; candidate.identityValid = false; }
    const section = observation.kind === 'tool' ? inventory?.tools : inventory?.skills;
    const complete = valid && section?.status === 'ready' && Array.isArray(section.items) && section.omitted === 0 && section.invalid === 0;
    const current = observation.source === '' && observation.identityValid && !candidates.length && complete ? 'missing' : 'unknown';
    const previous = rows.find(row => row.observed && key(row) === key(observation) && row.current === current);
    if (previous) previous.count++;
    else rows.push({ ...observation, current, observed: true, count: 1, modelInvocable: 'unknown' });
  }
  for (const row of rows) {
    const current = row.current === 'available' ? 'Available in retrieved tool snapshot'
      : row.current === 'listed' ? 'Listed in skill catalog; model access unknown'
        : row.current === 'missing' ? 'Observed here; not in current snapshot' : 'Inventory unknown';
    row.status = `${current} · ${row.observed ? `Observed here (${row.count})` : 'Not observed here'}`;
  }
  const times = entries.map(entry => Date.parse(entry.timestamp)).filter(Number.isFinite);
  const span = times.length ? `${new Date(Math.min(...times)).toISOString()} to ${new Date(Math.max(...times)).toISOString()}` : 'timestamps unavailable';
  return { rows, capturedAt: valid ? inventory.capturedAt : null,
    window: `${entries.length} retained events; ${snapshot.omitted || 0} older events omitted; ${span}. ${snapshot.history === 'ready' ? 'Supported retained events only, not complete chat history.' : 'History is incomplete or unavailable.'}`,
    note: 'Main-session snapshot only. Current metadata does not establish historical availability or selection reasons. Tool observations mean invocation starts or retained partial calls, not successful execution. Not observed here does not mean unused or irrelevant. Child-agent inventories and skill model access are unknown.' };
}

export async function fetchCapabilities(signal) {
  const response = await fetch('capabilities', { signal });
  if (!response.ok || !response.body) throw new Error('Inventory unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, body = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('Inventory response too large.');
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body);
  } finally { await reader.cancel().catch(() => {}); }
}

export function initCapabilities({ document: doc = globalThis.document, load = fetchCapabilities, onInspect = () => {} } = {}) {
  const get = id => doc.querySelector(`#${id}`);
  const button = get('capability-refresh'), list = get('capability-list'), status = get('capability-status');
  let inventory, retained = {}, sequence = 0, closed = false, suspended = false, controller, timer, ageTimer, loading = false, failed = false;
  const states = new Set(['ready', 'uninitialized', 'unsupported', 'unavailable', 'timeout', 'session-mismatch', 'closed', 'malformed']);
  const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
  function render() {
    const comparison = compareCapabilities(inventory, retained);
    setText(get('capability-window'), comparison.window);
    setText(get('capability-scope'), comparison.note);
    const age = comparison.capturedAt ? Date.now() - Date.parse(comparison.capturedAt) : 0;
    const laterActivity = comparison.capturedAt && retained.entries?.some(entry => Date.parse(entry.timestamp) > Date.parse(comparison.capturedAt));
    clearTimeout(ageTimer);
    if (!loading && comparison.capturedAt && age <= 60000 && !laterActivity) {
      ageTimer = setTimeout(() => { if (!closed) render(); }, Math.min(60001, 60001 - age));
    }
    let message = `${loading ? 'Reading snapshot… ' : failed ? 'Refresh unavailable. Previous snapshot, if shown, may be stale. ' : ''}${comparison.capturedAt
      ? `Retrieved ${comparison.capturedAt}. ${age > 60000 || laterActivity ? 'Stale snapshot: age or later activity requires a refresh. ' : 'Capabilities may have changed since retrieval. '}`
      : 'Inventory unknown until you request a snapshot. '}`;
    if (comparison.capturedAt) for (const kind of ['tools', 'skills']) {
      const section = inventory[kind];
      message += `${kind === 'tools' ? 'Tools' : 'Skills'}: ${states.has(section?.status) ? section.status : 'unknown'}; ${Number.isSafeInteger(section?.omitted) ? section.omitted : 0} omitted; ${Number.isSafeInteger(section?.invalid) ? section.invalid : 0} invalid. `;
    }
    setText(status, message);
    const yes = value => value === true ? 'yes' : value === false ? 'no' : 'unknown';
    const lines = comparison.rows.map(row => `${row.kind === 'tool' ? 'Tool' : 'Skill'}: ${row.name} · ${row.source === '' ? 'Main chat' : text(row.source) ? `Agent ${row.source}` : 'Source unavailable'} · ${row.status}${row.kind === 'tool'
      ? row.mcpServerName ? ` · MCP server ${row.mcpServerName}; tool ${row.mcpToolName}` : ' · Origin unknown'
      : ` · Catalog source: ${row.catalogSource || 'unknown'}; enabled: ${yes(row.enabled)}; user-invocable: ${yes(row.userInvocable)}; model-invocable: unknown`}${row.deferLoading === true ? ' · Loaded on demand' : ''}`);
    if (!lines.length) lines.push('No comparable capabilities or retained tool/skill observations.');
    if (JSON.stringify([...list.children].map(child => child.textContent)) !== JSON.stringify(lines)) {
      list.replaceChildren(...lines.map(line => { const item = doc.createElement('li'); item.textContent = line; return item; }));
    }
  }
  async function refresh() {
    if (closed || suspended) return;
    const request = ++sequence;
    clearTimeout(timer); controller?.abort(); controller = new AbortController();
    const activeController = controller;
    const timeout = setTimeout(() => activeController.abort(), 6000);
    timer = timeout;
    loading = true; failed = false; button.disabled = true; onInspect(); render();
    try {
      const next = await load(activeController.signal);
      if (closed || request !== sequence || activeController.signal.aborted) return;
      if (next?.schemaVersion !== 1 || next.scope !== 'main-session' || !Number.isFinite(Date.parse(next.capturedAt))) throw new Error('Invalid inventory.');
      inventory = next;
    } catch { if (!closed && request === sequence) failed = true; }
    finally {
      clearTimeout(timeout);
      if (!closed && request === sequence) { loading = false; button.disabled = false; render(); }
    }
  }
  button.addEventListener('click', () => { void refresh(); });
  get('capabilities').addEventListener('toggle', () => { if (get('capabilities').open) onInspect(); });
  render();
  return { refresh, update(snapshot) { if (!closed) { retained = snapshot; render(); } },
    suspend(value) {
      suspended = value; sequence++; clearTimeout(timer); clearTimeout(ageTimer); controller?.abort();
      inventory = undefined; loading = false; failed = false; button.disabled = value;
      get('capabilities').open = false; get('capabilities').hidden = value; render();
    },
    close() { closed = true; sequence++; clearTimeout(timer); clearTimeout(ageTimer); controller?.abort(); } };
}
