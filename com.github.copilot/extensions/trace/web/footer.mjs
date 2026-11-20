const get = id => document.getElementById(id);

export function initPanels({ onInspect, onOpen = () => {}, document = globalThis.document }) {
  const panels = [...document.querySelectorAll('.footer-panel')];
  const states = new Map();
  function available(node) {
    if (!node?.isConnected) return false;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      if (ancestor.hidden) return false;
      if (ancestor !== node && ancestor.tagName.toLowerCase() === 'details' && !ancestor.open) return false;
    }
    return true;
  }
  function openPanel(id, opener, fallback = opener) {
    const panel = document.getElementById(id);
    if (!panels.includes(panel) || panels.some(other => other.open)) return false;
    states.set(panel, { opener, fallback, restoreFocus: true });
    onInspect(); panel.showModal();
    opener.setAttribute('aria-expanded', 'true');
    panel.querySelector('button').focus({ preventScroll: true });
    onOpen(id);
    return true;
  }
  function closePanel(id, { restoreFocus = true } = {}) {
    const panel = document.getElementById(id);
    const state = states.get(panel);
    if (state) state.restoreFocus = restoreFocus;
    if (panel?.open) panel.close();
  }
  for (const panel of panels) panel.addEventListener('close', () => {
    if (panel.open) return;
    const state = states.get(panel);
    if (!state) return;
    state.opener.setAttribute('aria-expanded', 'false');
    if (state.restoreFocus && !panels.some(other => other.open)) {
      const target = available(state.opener) ? state.opener : state.fallback;
      if (available(target)) target.focus({ preventScroll: true });
    }
  });
  for (const toggle of document.querySelectorAll('[data-panel]')) {
    toggle.addEventListener('click', () => openPanel(toggle.dataset.panel, toggle));
  }
  for (const button of document.querySelectorAll('[data-close-panel]')) button.addEventListener('click', () => button.closest('dialog').close());
  return { openPanel, closePanel };
}

export function initFooter({ diagnostics, refresh, onInspect }) {
  let version = 'unknown';
  let metadata;
  let metadataRequest;
  let serverLogs;
  let serverCapturedAt;
  let logsRequest;
  const panels = initPanels({ onInspect, onOpen(id) {
    if (id === 'releases-panel') void loadMetadata();
    if (id === 'logs-panel') void loadLogs();
  } });
  const say = message => { get('footer-status').textContent = message; };
  async function read(route) {
    const response = await fetch(route, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Support data unavailable.');
    return response.json();
  }
  async function loadMetadata() {
    if (metadata) return;
    if (metadataRequest) return metadataRequest;
    metadataRequest = (async () => {
      try {
        metadata = await read('metadata');
        version = metadata.version;
        get('plugin-version').textContent = `v${version}`;
        get('feedback').href = `https://github.com/AndrewGodlewsky/Copilot-Trace/issues/new?body=${encodeURIComponent(`Trace v${version}\n\nWhat happened?\n\nSteps to reproduce:\n\nExpected behavior:\n\nDiagnostic logs (Show logs → Copy logs):\n`)}`;
        const list = get('release-list');
        list.replaceChildren();
        for (const release of metadata.releases) {
          const details = document.createElement('details');
          details.className = 'release';
          details.open = release.version === version;
          const summary = document.createElement('summary');
          summary.textContent = `v${release.version}${release.version === version ? ' · Installed' : ''}`;
          const description = document.createElement('p');
          description.textContent = release.summary;
          details.append(summary, description); list.append(details);
        }
      } catch {
        metadata = undefined;
        diagnostics.record('metadata_failed');
        get('plugin-version').textContent = 'Version unavailable';
        get('release-list').textContent = 'Release notes could not be loaded. Close and reopen this section to retry.';
      } finally { metadataRequest = undefined; }
    })();
    return metadataRequest;
  }
  get('text-size').addEventListener('change', () => {
    const value = get('text-size').value;
    if (['100', '115', '130', '150'].includes(value)) document.documentElement.dataset.textSize = value;
  });
  get('refresh').addEventListener('click', async () => {
    const button = get('refresh');
    button.disabled = true; say('Refreshing…');
    diagnostics.record('refresh_started');
    const started = performance.now();
    try {
      const ok = await refresh();
      diagnostics.record(ok ? 'refresh_ok' : 'refresh_failed', { durationMs: Math.round(performance.now() - started) });
      say(ok ? 'Latest activity synced.' : 'Refresh failed. Retrying automatically; see logs for details.');
    } finally { button.disabled = false; }
  });
  function report() {
    const client = diagnostics.snapshot();
    const lines = [
      `Trace v${version} — plugin diagnostics`,
      `Exported snapshot: ${new Date().toISOString()}`,
      'Structured health data only. No chat evidence, paths, IDs, URLs or raw errors.',
      'Logs are in memory for this open panel; failures before startup are not captured.',
      `Panel: ${client.entries.length}/${client.limit} entries; ${client.dropped} older entries omitted.`,
    ];
    if (serverLogs) {
      lines.push(`Server snapshot captured: ${serverCapturedAt} (not a current connection check).`,
        `History: ${serverLogs.history}; retained events: ${serverLogs.retained}; omitted events: ${serverLogs.omitted}.`,
        `Server: ${serverLogs.diagnostics.entries.length}/${serverLogs.diagnostics.limit} entries; ${serverLogs.diagnostics.dropped} older entries omitted.`);
    } else lines.push('Server diagnostics unavailable. Panel logs only.');
    const entries = [...client.entries.map(entry => ({ source: 'panel', ...entry })),
      ...(serverLogs?.diagnostics.entries ?? []).map(entry => ({ source: 'server', ...entry }))];
    entries.sort((a, b) => a.at.localeCompare(b.at));
    return [...lines, '', ...entries.map(entry => JSON.stringify(entry))].join('\n');
  }
  function renderLogs() { get('log-output').value = report(); }
  async function loadLogs() {
    if (logsRequest) return logsRequest;
    renderLogs(); get('log-status').textContent = 'Reading server diagnostics…';
    get('update-logs').disabled = true;
    logsRequest = (async () => {
      try {
        serverLogs = await read('diagnostics');
        serverCapturedAt = new Date().toISOString();
        get('log-status').textContent = 'Snapshot updated. Copy or export it to include with feedback.';
      } catch {
        diagnostics.record('logs_failed');
        get('log-status').textContent = serverLogs ? 'Server unavailable. Showing its last snapshot and current panel logs.' : 'Server unavailable. Current panel logs are still available.';
      } finally { renderLogs(); get('update-logs').disabled = false; logsRequest = undefined; }
    })();
    return logsRequest;
  }
  get('update-logs').addEventListener('click', () => { void loadLogs(); });
  get('copy-logs').addEventListener('click', async () => {
    renderLogs();
    try {
      await navigator.clipboard.writeText(get('log-output').value);
      get('log-status').textContent = 'Logs copied.';
    } catch {
      diagnostics.record('copy_failed'); renderLogs();
      get('log-output').focus(); get('log-output').select();
      get('log-status').textContent = 'Clipboard access was blocked. Logs are selected; use your copy shortcut.';
    }
  });
  get('export-logs').addEventListener('click', () => {
    let url;
    try {
      diagnostics.record('export_requested'); renderLogs();
      url = URL.createObjectURL(new Blob([get('log-output').value], { type: 'text/plain;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url; link.download = `trace-diagnostics-${version}-${new Date().toISOString().slice(0, 10)}.txt`;
      document.body.append(link); link.click(); link.remove();
      get('log-status').textContent = 'Download requested. If no file appears, use Copy logs.';
    } catch {
      diagnostics.record('export_failed'); renderLogs();
      get('log-status').textContent = 'Download could not start. Use Copy logs instead.';
    } finally { if (url) setTimeout(() => URL.revokeObjectURL(url), 60000); }
  });
  void loadMetadata();
  return panels;
}
