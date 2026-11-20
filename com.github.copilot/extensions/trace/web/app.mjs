import { describeHookGroup, describeStep, describeTurn, groupSteps, turnContext, summarize } from './presentation.mjs';
import { createDiagnostics } from './diagnostics.mjs';
import { createPoller } from './polling.mjs';
import { initFooter } from './footer.mjs';
import { createFollow } from './follow.mjs';

const diagnostics = createDiagnostics();
diagnostics.record('panel_started');
window.addEventListener('error', () => diagnostics.record('client_error'));
window.addEventListener('unhandledrejection', () => diagnostics.record('client_error'));

const timeline = document.querySelector('#timeline');
const connection = document.querySelector('#connection');
const notice = document.querySelector('#notice');
const empty = document.querySelector('#empty');
const follow = document.querySelector('#follow');
const statValues = new Map();
for (const [key, label] of [['turns', 'Model turns'], ['hooks', 'Hook calls'], ['tools', 'Tool calls'], ['skills', 'Skill loads']]) {
  const cell = element('div');
  cell.dataset.metric = key;
  const value = element('dd', '—');
  cell.append(element('dt', label), value);
  document.querySelector('#stat-counts').append(cell);
  statValues.set(key, value);
}
const nodes = new Map();
let hookGroups = [];
let etag;
let lastSnapshot;

function setConnection(message, state) {
  if (connection.textContent !== message) connection.textContent = message;
  connection.dataset.state = state;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function icon(kind) {
  const paths = {
    You: 'M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z',
    Model: 'M7 7h10v10H7z M9 3v4m6-4v4M9 17v4m6-4v4M3 9h4m-4 6h4m10-6h4m-4 6h4',
    Tool: 'm5 7 5 5-5 5m8 0h6',
    Skill: 'M5 4h11a3 3 0 0 1 3 3v14H7a3 3 0 0 1-3-3V5a1 1 0 0 1 1-1Zm-1 13h15M8 8h7m-7 4h5',
    Hook: 'M8 4v9a5 5 0 0 0 10 0V9m-4 4 4-4 4 4',
    Subagent: 'M6 3v8h12v10M6 11v10M3 18l3 3 3-3m6 0 3 3 3-3',
    Harness: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  };
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[kind] || paths.Harness);
  svg.append(path);
  const wrapper = element('span', undefined, 'node-icon');
  wrapper.append(svg);
  return wrapper;
}

function nodeShell(display) {
  const item = element('li', undefined, 'step');
  item.dataset.tone = display.tone;
  item.dataset.kind = display.kind;
  const details = element('details');
  details.className = 'node';
  const summary = element('summary');
  const title = element('span', display.title, 'node-title');
  const subtitle = element('span', display.subtitle, 'node-subtitle');
  const context = element('span', '', 'turn-context');
  context.hidden = true;
  const copy = element('span', undefined, 'node-copy');
  copy.append(element('span', display.kind, 'node-kind'), title, subtitle, context);
  const chevron = element('span', undefined, 'chevron');
  chevron.setAttribute('aria-hidden', 'true');
  summary.append(icon(display.kind), copy, chevron);
  details.append(summary);
  details.addEventListener('toggle', () => {
    item.classList.toggle('expanded', details.open);
    if (details.open) follow.checked = false;
  });
  item.append(details);
  return { item, details, title, subtitle, context };
}

function applyContext(node, context, entry) {
  node.item.dataset.turn = context?.role || (entry?.type === 'assistant.turn_end' ? 'end' : '');
  node.context.hidden = context?.role !== 'inside';
  const text = context?.role === 'inside'
    ? `Within turn ${context.turn.id} · ${context.turn.agent ? `Agent ${context.turn.agent}` : 'Main chat'}` : '';
  if (node.context.textContent !== text) node.context.textContent = text;
}

function renderStatistics(snapshot) {
  const stats = summarize(snapshot.entries);
  for (const [key, value] of statValues) value.textContent = String(stats[key]);
  const preview = snapshot.history === 'unsupported' ? 'Events unavailable'
    : `Retained: ${stats.turns} ${stats.turns === 1 ? 'turn' : 'turns'} · ${stats.tools} ${stats.tools === 1 ? 'tool call' : 'tool calls'}`;
  const peek = document.querySelector('#statistics-peek');
  if (peek.textContent !== preview) peek.textContent = preview;
  document.querySelector('#stat-scope').textContent = `${snapshot.entries.length} retained events only; not whole-chat totals. Paired starts and ends count once by recorded ID, including calls with only one boundary available.${snapshot.history !== 'ready' ? ' History is incomplete or unavailable.' : ''}${snapshot.omitted ? ' Older events have been omitted.' : ''}`;
  const unlinked = document.querySelector('#stat-unlinked');
  unlinked.hidden = !stats.unlinked;
  unlinked.textContent = `${stats.unlinked} turn, hook or tool events lack usable IDs and are excluded from those totals.`;
  for (const [selector, values] of [['#stat-hooks', stats.hookNames], ['#stat-skills', stats.skillNames]]) {
    const list = document.querySelector(selector);
    const rows = values.length ? values.map(([name, count]) => `${name} · ${count}`) : ['None recorded'];
    // Preserve selections and scroll positions when the visible list has not changed.
    if (JSON.stringify([...list.children].map(row => row.textContent)) !== JSON.stringify(rows)) {
      list.replaceChildren(...rows.map(text => element('li', text)));
    }
  }
}

function row(entry) {
  const node = nodeShell(describeStep(entry));
  const time = new Date(entry.timestamp);
  const timeText = Number.isNaN(time.getTime()) ? 'Not recorded' : time.toLocaleString();
  const body = element('div', undefined, 'evidence');
  body.append(element('h3', 'What this step means'), element('p', entry.explanation));
  const metadata = element('dl', undefined, 'metadata');
  for (const [label, value] of [['Time', timeText], ['Source', entry.agentId === null ? 'Source unavailable' : entry.agentId ? `Agent ${entry.agentId}` : 'Main chat'], ['Event', entry.type]]) {
    metadata.append(element('dt', label), element('dd', value));
  }
  body.append(metadata);
  body.append(element('h3', 'Recorded evidence'));
  if (entry.truncated) body.append(element('p', 'Evidence shortened to 12,000 characters. The complete event is not retained by this panel.'));
  const pre = element('pre', entry.evidence);
  pre.tabIndex = 0;
  pre.setAttribute('aria-label', 'Recorded event data');
  body.append(pre);
  node.details.append(body);
  return node;
}

function place(parent, item, previous) {
  const expected = previous ? previous.nextElementSibling : parent.firstElementChild;
  if (expected !== item) parent.insertBefore(item, expected);
  return item;
}

function render(snapshot) {
  const focused = document.activeElement;
  const contexts = turnContext(snapshot.entries);
  renderStatistics(snapshot);
  const oldGroups = hookGroups.map(group => ({ group, ids: group.ids, open: group.details.open }));
  const retained = new Set(snapshot.entries.map(entry => entry.id));
  for (const [id, node] of nodes) {
    if (!retained.has(id)) { node.item.remove(); nodes.delete(id); }
  }
  for (const entry of snapshot.entries) {
    let node = nodes.get(entry.id);
    if (!node) { node = row(entry); nodes.set(entry.id, node); }
    const context = contexts.get(entry.id);
    const display = describeTurn(entry, context);
    if (node.title.textContent !== display.title) node.title.textContent = display.title;
    if (node.subtitle.textContent !== display.subtitle) node.subtitle.textContent = display.subtitle;
    applyContext(node, context, entry);
  }
  let previous;
  const nextGroups = [];
  for (const section of groupSteps(snapshot.entries)) {
    if (section.kind === 'event') {
      previous = place(timeline, nodes.get(section.entries[0].id).item, previous);
      continue;
    }
    // Reuse overlapping groups when history arrives or the oldest event ages out.
    const prior = oldGroups.find(old => section.entries.some(entry => old.ids.has(entry.id)));
    const existing = prior?.group;
    let group = existing && !nextGroups.includes(existing) ? existing : null;
    if (!group) {
      group = nodeShell({ kind: 'Hook', title: 'Hooks', subtitle: '', tone: 'host' });
      group.item.classList.add('hook-group');
      group.children = element('ol', undefined, 'hook-events');
      group.children.setAttribute('aria-label', 'Individual hook events');
      group.details.append(group.children);
      group.details.open = Boolean(prior?.open || section.entries.some(entry => nodes.get(entry.id).details.open));
    }
    const display = describeHookGroup(section.entries);
    if (group.subtitle.textContent !== display.subtitle) group.subtitle.textContent = display.subtitle;
    group.item.dataset.tone = display.tone;
    applyContext(group, contexts.get(section.entries[0].id));
    group.ids = new Set(section.entries.map(entry => entry.id));
    let child;
    for (const entry of section.entries) {
      const node = nodes.get(entry.id);
      applyContext(node, null);
      child = place(group.children, node.item, child);
    }
    const wanted = new Set(section.entries.map(entry => nodes.get(entry.id).item));
    for (const element of [...group.children.children]) if (!wanted.has(element)) element.remove();
    previous = place(timeline, group.item, previous);
    nextGroups.push(group);
  }
  for (const group of hookGroups) if (!nextGroups.includes(group)) group.item.remove();
  hookGroups = nextGroups;
  // Moving an existing disclosure into a group must not strand keyboard focus.
  if (focused?.isConnected && document.activeElement !== focused) {
    follow.checked = false;
    let ancestor = focused.parentElement?.closest('details');
    while (ancestor) { ancestor.open = true; ancestor = ancestor.parentElement?.closest('details'); }
    focused.focus({ preventScroll: true });
  }
  empty.hidden = snapshot.entries.length > 0;
  const messages = {
    loading: 'Reading available history; live events are already being collected.',
    ready: 'Indented steps were recorded within a model turn. Open any step for its evidence.',
    unavailable: 'Earlier history is unavailable. Showing live events received since this panel opened.',
    unsupported: 'This host did not expose the session event API. Reopen in a compatible Copilot desktop session.',
  };
  notice.textContent = messages[snapshot.history] ?? 'History status unavailable.';
  if (snapshot.omitted) notice.textContent += ' Older events were omitted; showing the most recent supported events.';
  setConnection(snapshot.history === 'unsupported' ? 'Events unavailable' : `Connected · ${snapshot.entries.length} steps`,
    snapshot.history === 'unsupported' ? 'error' : 'connected');
}

const following = createFollow(follow, () => document.scrollingElement);
follow.addEventListener('change', following.onChange);
window.addEventListener('scroll', following.onScroll, { passive: true });
window.addEventListener('resize', following.sync);
// Reserve the dock's actual height, including wrapped controls and status messages.
const dock = document.querySelector('#footer-dock');
let dockHeight = 0;
const pageSize = new ResizeObserver(() => {
  const height = Math.ceil(dock.getBoundingClientRect().height);
  if (height !== dockHeight) {
    dockHeight = height;
    document.documentElement.style.setProperty('--dock-height', `${height}px`);
  }
  following.sync();
});
pageSize.observe(document.querySelector('main'));
pageSize.observe(dock);

let feedState;
const poller = createPoller({
  async load() {
    const response = await fetch('events', { headers: etag ? { 'If-None-Match': etag } : {}, signal: AbortSignal.timeout(5000) });
    if (response.status === 200) {
      lastSnapshot = await response.json();
      etag = response.headers.get('etag');
      render(lastSnapshot);
    } else if (response.status === 304 && lastSnapshot) {
      setConnection(lastSnapshot.history === 'unsupported' ? 'Events unavailable' : `Connected · ${lastSnapshot.entries.length} steps`,
        lastSnapshot.history === 'unsupported' ? 'error' : 'connected');
    } else {
      if (feedState !== 'disconnected') diagnostics.record('disconnected', { status: response.status });
      feedState = 'disconnected';
      throw new Error('Event feed unavailable.');
    }
    if (feedState !== 'connected') diagnostics.record('connected');
    feedState = 'connected';
    following.sync();
    return true;
  },
  onError() {
    if (feedState !== 'disconnected') diagnostics.record('disconnected');
    feedState = 'disconnected';
    setConnection('Disconnected · retrying', 'error');
  },
});
initFooter({ diagnostics, refresh: poller.refresh, onInspect: () => { follow.checked = false; } });
window.addEventListener('pagehide', () => { poller.stop(); pageSize.disconnect(); });
void poller.refresh();
