const messages = Object.freeze({
  server_started: 'Panel server started.',
  observer_started: 'Session event subscription started.',
  history_ready: 'Available history loaded.',
  history_failed: 'History could not be loaded; live collection remains active.',
  history_timeout: 'History exceeded the ten-second deadline.',
  observer_unsupported: 'Session event API is unavailable or subscription failed.',
  panel_started: 'Panel initialized.',
  connected: 'Event feed connected.',
  disconnected: 'Event feed read failed; automatic retry is active.',
  refresh_started: 'Manual refresh requested.',
  refresh_ok: 'Latest observer snapshot received.',
  refresh_failed: 'Manual refresh failed.',
  metadata_failed: 'Version and release notes could not be loaded.',
  logs_failed: 'Server diagnostics could not be loaded.',
  copy_failed: 'Clipboard write blocked; selectable logs remain available.',
  export_requested: 'Diagnostic file download requested.',
  export_failed: 'Diagnostic download could not be started.',
  client_error: 'Panel script reported an error; private error details omitted.',
});

export function createDiagnostics() {
  const entries = [];
  const startedAt = new Date().toISOString();
  let dropped = 0;
  return {
    record(code, fields = {}) {
      if (!Object.hasOwn(messages, code)) return;
      const data = {};
      for (const key of ['status', 'count', 'durationMs']) {
        const value = fields?.[key];
        if (Number.isSafeInteger(value) && value >= 0 && value <= 1e9 && (key !== 'status' || (value >= 100 && value <= 599))) data[key] = value;
      }
      entries.push({ at: new Date().toISOString(), code, message: messages[code], data });
      if (entries.length > 200) { entries.shift(); dropped++; }
    },
    snapshot() {
      return { startedAt, limit: 200, dropped, entries: entries.map(entry => ({ ...entry, data: { ...entry.data } })) };
    },
  };
}
