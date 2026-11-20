const ROW_LIMIT = 100, CONTENT_LIMIT = 12000, BYTE_LIMIT = 500 * 1024;
const types = new Set(['home', 'repo', 'model', 'vscode', 'nested-agents', 'child-instructions', 'plugin']);
const locations = new Set(['user', 'repository', 'working-directory', 'plugin']);
const text = (value, limit = 256) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const empty = status => ({ status, items: [], omitted: 0, invalid: 0, clipped: 0 });

function project(raw, sessionId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty('malformed');
  if (raw.sessionId !== undefined && raw.sessionId !== sessionId) return empty('session-mismatch');
  if (!Array.isArray(raw.sources)) return empty('malformed');
  const items = [], ids = new Map(), indices = new Map(), invalid = new Set();
  let clipped = 0, omitted = Math.max(0, raw.sources.length - ROW_LIMIT), bytes = 0;
  for (const [index, row] of raw.sources.slice(0, ROW_LIMIT).entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row) || !text(row.id)) { invalid.add(index); continue; }
    ids.set(row.id, (ids.get(row.id) || 0) + 1);
    const label = text(row.label) ? row.label : null, sourcePath = text(row.sourcePath, 2048) ? row.sourcePath : null;
    const type = types.has(row.type) ? row.type : null, location = locations.has(row.location) ? row.location : null;
    const scopeValid = row.applyTo === undefined || Array.isArray(row.applyTo) && row.applyTo.length <= 32 && row.applyTo.every(value => text(value, 512));
    const flagValid = row.defaultDisabled === undefined || typeof row.defaultDisabled === 'boolean';
    let content = typeof row.content === 'string' ? row.content : null;
    let contentStatus = content === null ? 'missing' : content === '' ? 'empty' : 'complete';
    if (content !== null && content.length > CONTENT_LIMIT) {
      let end = CONTENT_LIMIT;
      if (/[\uD800-\uDBFF]/.test(content[end - 1]) && /[\uDC00-\uDFFF]/.test(content[end])) end--;
      content = content.slice(0, end); contentStatus = 'clipped';
    }
    const identityValid = Boolean(sourcePath && type && location);
    if (!label || !identityValid || !scopeValid || !flagValid || row.content !== undefined && content === null) invalid.add(index);
    const item = { id: row.id, label, sourcePath, type, location, applyTo: scopeValid && row.applyTo !== undefined ? [...row.applyTo] : null,
      defaultDisabled: flagValid && row.defaultDisabled !== undefined ? row.defaultDisabled : null, content, contentStatus, identityValid };
    // Measure only the bounded projection, never serialize arbitrary host fields or the full catalog.
    const size = Buffer.byteLength(JSON.stringify(item)) + 1;
    if (bytes + size > BYTE_LIMIT) { omitted++; continue; }
    bytes += size; if (contentStatus === 'clipped') clipped++;
    items.push(item); indices.set(item, index);
  }
  for (const item of items) {
    if (ids.get(item.id) > 1) { item.identityValid = false; invalid.add(indices.get(item)); }
    // An omitted row could share an identity; never treat a partial catalog as unambiguous.
    if (omitted) item.identityValid = false;
  }
  return { status: 'ready', items, omitted, invalid: invalid.size, clipped };
}

export function createInstructionSources(session, { timeoutMs = 5000 } = {}) {
  const sessionId = session?.sessionId;
  let closed = false, active;
  const owned = () => text(sessionId) && session.sessionId === sessionId;
  const snapshot = sources => ({ schemaVersion: 1, scope: 'main-session', capturedAt: new Date().toISOString(), sources });
  return {
    read() {
      if (closed || !owned()) return Promise.resolve(snapshot(empty(closed ? 'closed' : 'session-mismatch')));
      if (active) return active.response;
      let finish;
      const stop = new Promise(resolve => { finish = resolve; });
      const state = { response: null, cancel: () => finish('closed') };
      active = state;
      const call = Promise.resolve().then(() => {
        if (closed || !owned()) return empty(closed ? 'closed' : 'session-mismatch');
        const api = session.rpc?.instructions;
        if (typeof api?.getSources !== 'function') return empty('unsupported');
        return Promise.resolve(api.getSources()).then(raw => project(raw, sessionId));
      }).catch(error => empty(error?.code === -32601 ? 'unsupported' : 'unavailable'));
      const timer = setTimeout(() => finish('timeout'), timeoutMs);
      state.response = Promise.race([call, stop.then(empty)]).then(sources => snapshot(closed || !owned()
        ? empty(closed ? 'closed' : 'session-mismatch') : sources)).finally(() => clearTimeout(timer));
      // This SDK cannot cancel the RPC: a timeout must retain its slot until actual settlement.
      void call.finally(() => { if (active === state) active = null; });
      return state.response;
    },
    close() { closed = true; active?.cancel(); active = null; },
  };
}
