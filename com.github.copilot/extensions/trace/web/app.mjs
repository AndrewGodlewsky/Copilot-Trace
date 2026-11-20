import { describeActor, describeHookGroup, describeToolGroup, describeStep, describeTurn, groupSteps, requestChapters, turnContext, summarize } from './presentation.mjs';
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
const eventOrder = document.querySelector('#event-order');
const actorLegend = document.querySelector('#actor-legend');
actorLegend.addEventListener('toggle', () => { if (actorLegend.open) follow.checked = false; });
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
let groups = [];
let chapters = [];
let etag;
let lastSnapshot;
eventOrder.addEventListener('change', () => {
  follow.checked = false;
  if (lastSnapshot) render(lastSnapshot);
});

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

function nodeShell(display, actor) {
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
  copy.append(element('span', actor.role, 'node-kind'), title, subtitle, context);
  const chevron = element('span', undefined, 'chevron');
  chevron.setAttribute('aria-hidden', 'true');
  summary.append(icon(display.kind), copy, chevron);
  details.append(summary);
  details.addEventListener('toggle', () => {
    item.classList.toggle('expanded', details.open);
    if (details.open) follow.checked = false;
  });
  item.append(details);
  return { item, details, summary, title, subtitle, context };
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
  document.querySelector('#stat-scope').textContent = `${snapshot.entries.length} retained events only; not whole-chat totals. Tool and hook calls count once per exact source and call ID, including partial calls. Tool cards with conflicting boundaries count once; their outcome is unknown.${snapshot.history !== 'ready' ? ' History is incomplete or unavailable.' : ''}${snapshot.omitted ? ' Older events have been omitted.' : ''}`;
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
  const actor = describeActor(entry);
  const node = nodeShell(describeStep(entry), actor);
  const timeText = typeof entry.timestamp === 'string' && entry.timestamp ? entry.timestamp : 'Not recorded';
  const body = element('div', undefined, 'evidence');
  body.append(element('h3', 'What this step means'), element('p', entry.explanation));
  const metadata = element('dl', undefined, 'metadata');
  for (const [label, value] of [['Recorded time', timeText], ['Actor', actor.role], ['Source', actor.source], ['Event', entry.type]]) {
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

function showBoundary(id) {
  follow.checked = false;
  eventOrder.value = 'chronological';
  render(lastSnapshot);
  const node = nodes.get(id);
  if (!node) return;
  node.details.open = true;
  node.summary.focus({ preventScroll: true });
  node.item.scrollIntoView({ block: 'center' });
}

function reconcileChapters(snapshot, visible) {
  const next = [];
  const old = chapters.map(chapter => ({ chapter, id: chapter.id, ids: chapter.ids, open: chapter.details.open }));
  for (const section of requestChapters(snapshot.entries, snapshot)) {
    const overlaps = old.filter(previous => section.entries.some(entry => previous.ids.has(entry.id)));
    const prior = old.find(previous => previous.id === section.id) || overlaps[0];
    let chapter = prior && !next.includes(prior.chapter) ? prior.chapter : null;
    const { stats } = section;
    const title = section.prompt ? section.prompt.preview || 'Recorded input' : 'Unattributed activity';
    const subtitle = `${section.entries.length} retained events · ${stats.turns} model turns · ${stats.tools} tool calls · ${stats.hooks} hook calls · ${stats.skills} skill loads`;
    if (!chapter) {
      chapter = nodeShell({ kind: 'Request', title, subtitle, tone: 'user' }, { role: 'Request chapter' });
      chapter.item.classList.add('request-chapter');
      chapter.context.className = 'chapter-status';
      chapter.details.append(element('p', 'Chronological interval only: activity here, including other agents, is not attributed to this input. A later chapter does not prove completion. Counts use the same definitions as Statistics on these retained records; calls spanning chapters can appear in both totals, so chapter counts are not additive.', 'group-note'));
      chapter.children = element('ol', undefined, 'chapter-events');
      chapter.children.setAttribute('aria-label', 'Original events in chronological order');
      chapter.details.append(chapter.children);
    }
    const open = overlaps.some(previous => previous.open);
    if (chapter.details.open !== open) chapter.details.open = open;
    chapter.id = section.id;
    chapter.ids = new Set(section.entries.map(entry => entry.id));
    if (chapter.title.textContent !== title) chapter.title.textContent = title;
    if (chapter.subtitle.textContent !== subtitle) chapter.subtitle.textContent = subtitle;
    const status = `${section.partial ? 'Partial first chapter · ' : ''}${section.notes.join(' ')}${stats.unlinked ? ` ${stats.unlinked} events lack usable IDs and are excluded from turn/hook/tool totals.` : ''}`;
    if (chapter.context.textContent !== status) chapter.context.textContent = status;
    chapter.context.hidden = false;
    let previous;
    for (const entry of visible ? section.entries : []) previous = place(chapter.children, nodes.get(entry.id).item, previous);
    next.push(chapter);
  }
  return next;
}

function render(snapshot) {
  const focused = document.activeElement;
  const focusedId = [...nodes].find(([, node]) => node.item.contains(focused))?.[0];
  const focusedGroup = groups.find(group => group.item.contains(focused) || group.ids.has(focusedId));
  const focusedChapter = chapters.find(chapter => chapter.item.contains(focused) || chapter.ids.has(focusedId));
  const chapterView = eventOrder.value === 'chapters';
  const chronological = eventOrder.value !== 'grouped';
  const contexts = turnContext(snapshot.entries);
  renderStatistics(snapshot);
  const oldGroups = groups.map(group => ({ group, ids: group.ids, open: group.details.open }));
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
  const nextGroups = [];
  const sections = groupSteps(snapshot.entries);
  for (const section of sections) {
    if (section.kind === 'event') continue;
    // Reuse overlapping groups when history arrives or the oldest event ages out.
    const prior = oldGroups.find(old => old.group.kind === section.kind
      && (old.group.id === section.id || section.entries.some(entry => old.ids.has(entry.id))));
    const existing = prior?.group;
    let group = existing && !nextGroups.includes(existing) ? existing : null;
    const tool = section.kind === 'tool';
    const display = tool ? describeToolGroup(section.entries) : describeHookGroup(section.entries);
    if (!group) {
      group = nodeShell(display, describeActor(section.entries[0]));
      group.kind = section.kind;
      group.item.classList.add(tool ? 'tool-group' : 'hook-group');
      if (tool) {
        group.links = element('div', undefined, 'boundary-links');
        group.links.setAttribute('role', 'group');
        group.links.setAttribute('aria-label', 'Tool boundaries in recorded event order');
        group.buttons = new Map();
        group.details.append(element('p', 'Positioned at the first retained boundary. View each boundary in event order to inspect intervening activity.', 'group-note'), group.links);
      }
      group.children = element('ol', undefined, tool ? 'tool-events' : 'hook-events');
      group.children.setAttribute('aria-label', tool ? 'Original tool boundary events' : 'Individual hook events');
      group.details.append(group.children);
      group.details.open = Boolean(prior?.open || section.entries.some(entry => nodes.get(entry.id).details.open));
    }
    group.id = section.id;
    if (group.title.textContent !== display.title) group.title.textContent = display.title;
    if (group.subtitle.textContent !== display.subtitle) group.subtitle.textContent = display.subtitle;
    group.item.dataset.tone = display.tone;
    applyContext(group, tool ? null : contexts.get(section.entries[0].id));
    group.ids = new Set(section.entries.map(entry => entry.id));
    if (tool) {
      let previousButton;
      for (const entry of section.entries) {
        let button = group.buttons.get(entry.id);
        if (!button) {
          button = element('button', entry.type === 'tool.execution_start' ? 'Start in event order' : 'Result in event order');
          button.type = 'button';
          button.addEventListener('click', () => showBoundary(entry.id));
          group.buttons.set(entry.id, button);
        }
        previousButton = place(group.links, button, previousButton);
      }
      for (const [id, button] of group.buttons) if (!group.ids.has(id)) { button.remove(); group.buttons.delete(id); }
    }
    let child;
    for (const entry of chronological ? [] : section.entries) {
      const node = nodes.get(entry.id);
      if (!tool) applyContext(node, null);
      child = place(group.children, node.item, child);
    }
    section.group = group;
    nextGroups.push(group);
  }
  const nextChapters = reconcileChapters(snapshot, chapterView);
  let previous;
  if (chapterView) {
    for (const chapter of nextChapters) previous = place(timeline, chapter.item, previous);
  } else {
    for (const section of chronological ? groupSteps(snapshot.entries, true) : sections) {
      previous = place(timeline, section.group?.item || nodes.get(section.entries[0].id).item, previous);
    }
  }
  for (const group of groups) if (chronological || !nextGroups.includes(group)) group.item.remove();
  for (const chapter of chapters) if (!chapterView || !nextChapters.includes(chapter)) chapter.item.remove();
  for (const group of nextGroups) {
    const wanted = new Set([...group.ids].map(id => nodes.get(id).item));
    for (const item of [...group.children.children]) if (!wanted.has(item)) item.remove();
  }
  groups = nextGroups;
  chapters = nextChapters;
  // Moving an existing disclosure into a group must not strand keyboard focus.
  let focusTarget = focused?.isConnected ? focused : null;
  if (!focusTarget && focusedGroup) {
    const group = groups.find(group => group === focusedGroup);
    focusTarget = chronological ? nodes.get(group?.ids.values().next().value)?.summary : group?.summary;
  }
  if (!focusTarget && focusedChapter) {
    const chapter = chapters.find(chapter => chapter === focusedChapter)
      || chapters.find(chapter => [...chapter.ids].some(id => focusedChapter.ids.has(id)));
    focusTarget = chapterView ? chapter?.summary : nodes.get(chapter?.ids.values().next().value)?.summary;
  }
  if (!focusTarget && (focusedId || focusedGroup || focusedChapter)) focusTarget = eventOrder;
  if (focusTarget && document.activeElement !== focusTarget) {
    follow.checked = false;
    let ancestor = focusTarget.tagName.toLowerCase() === 'summary'
      ? focusTarget.parentElement?.parentElement?.closest('details') : focusTarget.parentElement?.closest('details');
    while (ancestor) { ancestor.open = true; ancestor = ancestor.parentElement?.closest('details'); }
    focusTarget.focus({ preventScroll: true });
  }
  empty.hidden = snapshot.entries.length > 0;
  const messages = {
    loading: 'Reading available history; live events are already being collected.',
    ready: 'Indented steps were recorded within a model turn. Open any step for its evidence.',
    unavailable: 'Earlier history is unavailable. Showing live events received since this panel opened.',
    unsupported: 'This host did not expose the session event API. Reopen in a compatible Copilot desktop session.',
  };
  notice.textContent = messages[snapshot.history] ?? 'History status unavailable.';
  if (chapterView) notice.textContent += ' Request chapters are chronological intervals, not causal groups or completion reports.';
  if (snapshot.omitted) notice.textContent += ' Older events were omitted; showing the most recent supported events.';
  setConnection(snapshot.history === 'unsupported' ? 'Events unavailable' : `Connected · ${snapshot.entries.length} events`,
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
      setConnection(lastSnapshot.history === 'unsupported' ? 'Events unavailable' : `Connected · ${lastSnapshot.entries.length} events`,
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
