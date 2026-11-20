const ROW_LIMIT = 200;
const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const sources = new Set(['project', 'inherited', 'personal-copilot', 'personal-agents', 'plugin', 'custom', 'builtin', 'sdk', 'mcp']);
const empty = status => ({ status, items: [], omitted: 0, invalid: 0 });

function project(raw, kind, sessionId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty('malformed');
  if (raw.sessionId !== undefined && raw.sessionId !== sessionId) return empty('session-mismatch');
  if (kind === 'tools' && raw.tools === null) return empty('uninitialized');
  if (!Array.isArray(raw[kind])) return empty('malformed');
  const rows = raw[kind], items = [];
  let invalid = 0;
  // Project only bounded allowlisted fields; never stringify schemas, descriptions or raw errors.
  for (const row of rows.slice(0, ROW_LIMIT)) {
    if (!row || !text(row.name)) { invalid++; continue; }
    if (kind === 'tools') {
      const mcp = row.mcpServerName !== undefined || row.mcpToolName !== undefined;
      const identityValid = !mcp || text(row.mcpServerName) && text(row.mcpToolName);
      if (!identityValid) invalid++;
      items.push({ name: row.name, mcpServerName: text(row.mcpServerName) ? row.mcpServerName : null,
        mcpToolName: text(row.mcpToolName) ? row.mcpToolName : null, identityValid,
        deferLoading: typeof row.deferLoading === 'boolean' ? row.deferLoading : null });
    } else {
      const identityValid = sources.has(row.source);
      if (!identityValid) invalid++;
      items.push({ name: row.name, source: identityValid ? row.source : null, identityValid,
        enabled: typeof row.enabled === 'boolean' ? row.enabled : null,
        userInvocable: typeof row.userInvocable === 'boolean' ? row.userInvocable : null, modelInvocable: 'unknown' });
    }
  }
  const names = new Map();
  for (const item of items) names.set(item.name, (names.get(item.name) || 0) + 1);
  for (const item of items) if (names.get(item.name) > 1 && item.identityValid) { item.identityValid = false; invalid++; }
  return { status: 'ready', items, omitted: Math.max(0, rows.length - ROW_LIMIT), invalid };
}

export function createCapabilities(session, { timeoutMs = 5000 } = {}) {
  const sessionId = session?.sessionId;
  let closed = false, active;
  const owned = () => text(sessionId) && session.sessionId === sessionId;
  const snapshot = (tools, skills) => ({ schemaVersion: 1, scope: 'main-session', capturedAt: new Date().toISOString(), tools, skills });
  return {
    read() {
      if (closed || !owned()) return Promise.resolve(snapshot(empty(closed ? 'closed' : 'session-mismatch'), empty(closed ? 'closed' : 'session-mismatch')));
      if (active) return active.response;
      let finish, timer;
      const stop = new Promise(resolve => { finish = resolve; });
      const state = { response: null, cancel: () => finish('closed') };
      active = state;
      const calls = ['tools', 'skills'].map(kind => {
        const api = session.rpc?.[kind], method = kind === 'tools' ? 'getCurrentMetadata' : 'list';
        return Promise.resolve().then(() => {
          if (!owned() || closed) return empty(closed ? 'closed' : 'session-mismatch');
          if (typeof api?.[method] !== 'function') return empty('unsupported');
          return Promise.resolve(api[method]()).then(raw => project(raw, kind, sessionId));
        }).catch(error => empty(error?.code === -32601 ? 'unsupported' : 'unavailable'));
      });
      timer = setTimeout(() => finish('timeout'), timeoutMs);
      state.response = Promise.all(calls.map(call => Promise.race([call, stop.then(empty)]))).then(([tools, skills]) => {
        if (closed || !owned()) tools = skills = empty(closed ? 'closed' : 'session-mismatch');
        return snapshot(tools, skills);
      }).finally(() => clearTimeout(timer));
      // Timed-out RPCs cannot be cancelled by this SDK. Keep their slot until they settle.
      void Promise.all(calls).finally(() => { if (active === state) active = null; });
      return state.response;
    },
    close() { closed = true; active?.cancel(); active = null; },
  };
}
