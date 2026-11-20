import { describeActor, explainStep, skillInstructions, guidanceComparison, retrievalLedger, toolExtents, describeHookGroup, hookInvocations, describeToolGroup, toolProvenance, toolOperations, actionStages, describeStep, describeTurn, groupSteps, requestChapters, agentLanes, turnContext, summarize, observerScope, filterLabels, matchesFilter, navigationLabels, latestRetainedEvent } from './presentation.mjs';
import { createDiagnostics } from './diagnostics.mjs';
import { createPoller } from './polling.mjs';
import { initFooter } from './footer.mjs';
import { createFollow } from './follow.mjs';
import { initCapabilities } from './capabilities.mjs';
import { initInstructionSources } from './instructions.mjs';
import { vocabulary, conceptForEntry, glossaryExample, retainedExample } from './glossary.mjs';

const diagnostics = createDiagnostics();
diagnostics.record('panel_started');
window.addEventListener('error', () => diagnostics.record('client_error'));
window.addEventListener('unhandledrejection', () => diagnostics.record('client_error'));

const timeline = document.querySelector('#timeline');
const connection = document.querySelector('#connection');
const empty = document.querySelector('#empty');
const follow = document.querySelector('#follow');
const eventOrder = document.querySelector('#event-order');
const activityFilter = document.querySelector('#activity-filter');
const filterStatus = document.querySelector('#filter-status');
const filterEmpty = document.querySelector('#filter-empty');
const laneHelp = document.querySelector('#lane-help');
const eventTarget = document.querySelector('#event-target');
const jumpEvent = document.querySelector('#jump-event');
const navigationStatus = document.querySelector('#navigation-status');
const actorLegend = document.querySelector('#actor-legend');
actorLegend.addEventListener('toggle', () => { if (actorLegend.open) follow.checked = false; });
const statValues = new Map();
const retrievalRows = new Map(), retrievalUnknown = new Map();
const retrievalDisclosure = document.querySelector('#retrieval-ledger');
retrievalDisclosure.addEventListener('toggle', () => { if (retrievalDisclosure.open) follow.checked = false; });
for (const [key, label] of [['turns', 'Model turns'], ['hooks', 'Hook pipelines'], ['tools', 'Tool calls'], ['skills', 'Skill loads']]) {
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
let lanes = [];
let etag;
let lastSnapshot;
let feedState;
for (const selector of ['#evidence-scope', '#stat-evidence-scope']) {
  const disclosure = document.querySelector(selector);
  disclosure.addEventListener('toggle', () => { if (disclosure.open) follow.checked = false; });
}
const capabilityView = initCapabilities({ onInspect: () => { follow.checked = false; } });
const instructionView = initInstructionSources({ onInspect: () => { follow.checked = false; }, onOriginal(entry) {
  footerPanels.closePanel('statistics-panel', { restoreFocus: false });
  showBoundary(entry.id, 'Showing the instruction view’s original retained skill load. Follow live is paused.', entry);
} });
let navigationState;
const glossaryButton = document.querySelector('#glossary-button');
const glossaryPanel = document.querySelector('#glossary-panel');
const glossaryConcept = document.querySelector('#glossary-concept');
const glossarySource = document.querySelector('#glossary-source');
let glossaryTarget;
let glossaryExpired = false;
let guidanceExamples = [];
for (const [id, concept] of Object.entries(vocabulary)) {
  const option = element('option', concept.label); option.value = id; glossaryConcept.append(option);
}
glossaryButton.addEventListener('click', () => openGlossary('model-turn', null, glossaryButton));
glossaryConcept.addEventListener('change', () => selectGlossary(glossaryConcept.value));
glossarySource.addEventListener('click', () => {
  updateGlossary();
  if (!glossaryTarget || glossaryExpired) return;
  footerPanels.closePanel('glossary-panel', { restoreFocus: false });
  showBoundary(glossaryTarget.id, 'Showing the glossary’s original retained example. Follow live is paused.', glossaryTarget);
});

function openGlossary(concept, preferred, opener) {
  if (!footerPanels.openPanel('glossary-panel', opener, glossaryButton)) return;
  selectGlossary(concept, preferred);
}

function selectGlossary(id, preferred) {
  if (!Object.hasOwn(vocabulary, id)) return;
  const concept = vocabulary[id];
  glossaryConcept.value = id;
  document.querySelector('#glossary-definition').textContent = concept.definition;
  const deeper = document.querySelector('#glossary-deeper');
  deeper.textContent = concept.deeper;
  deeper.closest('details').open = false;
  glossaryTarget = glossaryExample(lastSnapshot?.entries || [], id, preferred);
  glossaryExpired = false;
  document.querySelector('#glossary-example').textContent = glossaryTarget
    ? `Current chat example: ${glossaryTarget.type} · ${glossaryTarget.agentId ? `Agent ${glossaryTarget.agentId}` : 'Main chat'} · ${glossaryTarget.timestamp || 'Time unavailable'}`
    : `Static example — not from this chat: ${concept.example}`;
  glossarySource.hidden = !glossaryTarget;
  selectGuidance(preferred);
  updateGlossary();
}

function selectGuidance(preferred) {
  const container = document.querySelector('#guidance-examples');
  container.replaceChildren();
  document.querySelector('#guidance-comparison').open = false;
  guidanceExamples = guidanceComparison(lastSnapshot?.entries || [], preferred).map(card => {
    const row = element('section', '', 'guidance-example');
    row.append(element('h3', card.label), element('p', card.lesson), element('p', card.example));
    for (const fact of card.facts) row.append(element('p', fact));
    for (const report of card.reported) row.append(element('p', report.field === 'additionalContext'
      ? 'Supplied context recorded (additionalContext). Supplied text is not a permission decision.' : `${report.label}: ${report.value}`));
    if (card.body !== null) {
      const body = element('details', '', 'glossary-depth');
      body.append(element('summary', card.bodyLabel), element('pre', card.body)); row.append(body);
    }
    const status = element('p'); status.setAttribute('role', 'status'); status.setAttribute('aria-atomic', 'true');
    const selection = { card, status, expired: false };
    if (card.target) {
      const button = element('button', `Open ${card.concept} example`); button.type = 'button';
      button.addEventListener('click', () => {
        updateGlossary();
        if (selection.expired) return;
        footerPanels.closePanel('glossary-panel', { restoreFocus: false });
        showBoundary(card.target.id, 'Showing the comparison’s original retained example. Follow live is paused.', card.target);
      });
      selection.button = button; row.append(button);
    }
    row.append(status); container.append(row);
    return selection;
  });
}

function updateGlossary() {
  if (!glossaryPanel.open) return;
  if (glossaryTarget && !retainedExample(lastSnapshot?.entries || [], glossaryTarget)) glossaryExpired = true;
  const message = !glossaryTarget ? 'No retained example is available for this concept. The example is authored teaching material.'
    : glossaryExpired ? 'This example is no longer available or its evidence changed. Reading position unchanged. Choose a concept again to look for a current example.'
    : 'Retained event from this chat. Open its original evidence to inspect what was recorded.';
  const status = document.querySelector('#glossary-status');
  if (status.textContent !== message) status.textContent = message;
  glossarySource.textContent = glossaryExpired ? 'Example unavailable' : 'Open current chat example';
  for (const selection of guidanceExamples) {
    const { card, status, button } = selection;
    if (card.evidence.some(entry => !retainedExample(lastSnapshot?.entries || [], entry))) selection.expired = true;
    const message = !card.target ? 'Authored illustration; no retained example was available when selected.'
      : selection.expired ? 'This example or its supporting evidence is no longer available or changed. The lesson remains as selected; choose a concept again to select current evidence.'
      : 'Retained evidence when selected. The lesson does not link these examples to each other.';
    if (status.textContent !== message) status.textContent = message;
    if (button) {
      button.textContent = selection.expired ? `${card.concept} example unavailable` : `Open ${card.concept} example`;
      button.setAttribute('aria-disabled', String(selection.expired));
    }
  }
}
eventOrder.addEventListener('change', () => {
  follow.checked = false;
  if (lastSnapshot) render(lastSnapshot);
});
activityFilter.addEventListener('change', () => {
  follow.checked = false;
  if (lastSnapshot) render(lastSnapshot);
});
document.querySelector('#reset-filter').addEventListener('click', () => {
  follow.checked = false;
  activityFilter.value = 'everything';
  if (lastSnapshot) render(lastSnapshot);
  activityFilter.focus({ preventScroll: true });
});
eventTarget.addEventListener('change', updateNavigation);
jumpEvent.addEventListener('click', () => {
  const target = updateNavigation();
  if (!target) {
    navigationStatus.textContent = unavailableTarget();
    return;
  }
  showBoundary(target.id, `Showing latest retained ${navigationLabels[eventTarget.value]}. Follow live is paused.`);
});

function unavailableTarget() {
  return Object.hasOwn(navigationLabels, eventTarget.value)
    ? `No retained ${navigationLabels[eventTarget.value]} is available. Reading position unchanged.`
    : 'Choose an event category. Reading position unchanged.';
}

function updateNavigation() {
  const target = latestRetainedEvent(lastSnapshot?.entries || [], eventTarget.value);
  jumpEvent.disabled = !target;
  const state = `${eventTarget.value}:${Boolean(target)}`;
  if (navigationState !== state) {
    navigationStatus.textContent = target ? `Latest retained ${navigationLabels[eventTarget.value]} is available.` : unavailableTarget();
    navigationState = state;
  }
  return target;
}

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
  const provenanceBadge = actor.role === 'Tool' ? element('span', 'Origin: Unknown', 'provenance-badge') : null;
  const operationBadge = actor.role === 'Tool' ? element('span', 'Requested: Unclassified', 'operation-badge') : null;
  if (provenanceBadge) copy.append(operationBadge, provenanceBadge);
  const chevron = element('span', undefined, 'chevron');
  chevron.setAttribute('aria-hidden', 'true');
  summary.append(icon(display.kind), copy, chevron);
  details.append(summary);
  details.addEventListener('toggle', () => {
    item.classList.toggle('expanded', details.open);
    if (details.open) follow.checked = false;
  });
  item.append(details);
  return { item, details, summary, title, subtitle, context, provenanceBadge, operationBadge };
}

function applyContext(node, context, entry) {
  node.item.dataset.turn = context?.role || (entry?.type === 'assistant.turn_end' ? 'end' : '');
  node.context.hidden = context?.role !== 'inside';
  const text = context?.role === 'inside'
    ? `Within turn ${context.turn.id} · ${context.turn.agent ? `Agent ${context.turn.agent}` : 'Main chat'}` : '';
  if (node.context.textContent !== text) node.context.textContent = text;
}

function renderObserverScope() {
  const stats = summarize(lastSnapshot?.entries || []);
  const scope = observerScope(lastSnapshot, feedState, stats);
  for (const [key, value] of statValues) {
    const text = scope.countsAvailable ? String(stats[key]) : '—';
    if (value.textContent !== text) value.textContent = text;
  }
  const preview = !scope.countsAvailable ? 'Counts unavailable · Open Statistics for scope'
    : `${scope.stale ? 'Stale retained' : scope.degraded ? 'Partial retained' : 'Retained'}: ${stats.turns} ${stats.turns === 1 ? 'turn' : 'turns'} · ${stats.tools} ${stats.tools === 1 ? 'tool call' : 'tool calls'}`;
  for (const [selector, text] of [
    ['#statistics-peek', preview], ['#scope-summary', `${scope.label} · Scope and limits`],
    ['#stat-scope-summary', `${scope.label} · Count scope`], ['#notice', scope.detail],
    ['#stat-scope', `${scope.detail} Tool calls and hook pipeline invocations count once per exact source and call ID, including partial calls. Hook pipelines are not counts of configured scripts or callbacks. A pipeline can span hook groups, so group counts do not add up to this total. Conflicting boundaries count once; their outcome is unknown.`],
  ]) {
    const node = document.querySelector(selector); if (node.textContent !== text) node.textContent = text;
  }
  if (feedState === 'disconnected') setConnection('Disconnected · retrying', 'error');
  else if (lastSnapshot) setConnection(lastSnapshot.history === 'unsupported' ? 'Events unavailable' : `Connected · ${lastSnapshot.entries.length} events`,
    lastSnapshot.history === 'unsupported' ? 'error' : 'connected');
}

function renderStatistics(snapshot) {
  capabilityView.update(snapshot);
  instructionView.update(snapshot);
  renderRetrieval(snapshot);
  const stats = summarize(snapshot.entries);
  for (const [selector, values] of [['#stat-hooks', stats.hookNames], ['#stat-skills', stats.skillNames]]) {
    const list = document.querySelector(selector);
    const rows = values.length ? values.map(([name, count]) => `${name} · ${count}`) : ['None recorded'];
    // Preserve selections and scroll positions when the visible list has not changed.
    if (JSON.stringify([...list.children].map(row => row.textContent)) !== JSON.stringify(rows)) {
      list.replaceChildren(...rows.map(text => element('li', text)));
    }
  }
}

function renderRetrieval(snapshot) {
  const ledger = retrievalLedger(snapshot.entries, snapshot);
  const list = document.querySelector('#retrieval-list'), unknownList = document.querySelector('#retrieval-unknown-list');
  const panel = document.querySelector('#statistics-panel'), focused = document.activeElement;
  const inspected = retrievalDisclosure.contains(focused), scroll = panel.scrollTop;
  const summary = ledger.rows.length
    ? `${ledger.rows.length} recognized operation occurrence${ledger.rows.length === 1 ? '' : 's'} · ${ledger.references} distinct recorded target reference${ledger.references === 1 ? '' : 's'}`
    : 'No recognized retrieval requests in retained evidence.';
  for (const [selector, text] of [['#retrieval-summary', summary], ['#retrieval-scope', ledger.note]]) {
    const node = document.querySelector(selector); if (node.textContent !== text) node.textContent = text;
  }
  const unclassified = document.querySelector('#retrieval-unclassified');
  unclassified.hidden = !ledger.unclassified.length;
  const unknownSummary = unclassified.querySelector('summary');
  const unknownText = `${ledger.unclassified.length} unclassified tool call${ledger.unclassified.length === 1 ? '' : 's'} · retrieval unknown`;
  if (unknownSummary.textContent !== unknownText) unknownSummary.textContent = unknownText;
  for (const [records, cache, parent, recognized] of [[ledger.rows, retrievalRows, list, true], [ledger.unclassified, retrievalUnknown, unknownList, false]]) {
    let previous;
    for (const record of records) {
      let node = cache.get(record.id);
      if (!node) {
        const item = element('li'), details = element('details'), title = element('summary');
        const status = element('p'), request = element('pre'), note = element('p'), content = element('details', undefined, 'retrieval-content');
        request.tabIndex = 0; request.setAttribute('aria-label', 'Exact recorded retrieval request');
        const text = element('pre'); text.tabIndex = 0; text.setAttribute('aria-label', 'Retained returned text');
        content.append(element('summary', 'Retained returned text'), text);
        const links = element('div', undefined, 'boundary-links');
        links.setAttribute('role', 'group'); links.setAttribute('aria-label', 'Original retrieval evidence');
        const extent = element('div');
        details.append(title, status, request, note, extent, content, links); item.append(details);
        for (const disclosure of [details, content]) disclosure.addEventListener('toggle', () => { if (disclosure.open) follow.checked = false; });
        node = { item, title, status, request, note, content, text, links, body: extent, buttons: new Map() }; cache.set(record.id, node);
      }
      const values = [[node.title, recognized ? `${record.toolName} · ${record.source} · ${record.statusLabel}` : 'Unclassified tool call · retrieval unknown'],
        [node.status, recognized ? (record.targets.length ? `${record.targets.length} recorded target reference${record.targets.length === 1 ? '' : 's'} in this request.` : 'Target not recorded; no directory or resource is assumed.') : 'This call is not counted as a recognized retrieval request.'],
        [node.request, record.request || ''], [node.note, record.scopeNote || record.note], [node.text, record.content ?? '']];
      for (const [target, value] of values) if (target.textContent !== value) target.textContent = value;
      renderExtent(node, record.extent);
      node.request.hidden = !recognized; node.content.hidden = record.content === null || !recognized;
      let previousButton;
      for (const link of record.links) {
        let button = node.buttons.get(link.id);
        if (!button) {
          button = element('button', link.label); button.type = 'button';
          button.addEventListener('click', () => {
            if (!retainedExample(lastSnapshot?.entries || [], button.entry)) {
              showBoundary(link.id, undefined, button.entry); return;
            }
            footerPanels.closePanel('statistics-panel', { restoreFocus: false });
            showBoundary(link.id, 'Showing the retrieval ledger’s original retained evidence. Follow live is paused.', button.entry);
          });
          node.buttons.set(link.id, button);
        }
        button.entry = snapshot.entries.find(entry => entry.id === link.id);
        previousButton = place(node.links, button, previousButton);
      }
      const linkIds = new Set(record.links.map(link => link.id));
      for (const [id, button] of node.buttons) if (!linkIds.has(id)) { button.remove(); node.buttons.delete(id); }
      previous = place(parent, node.item, previous);
    }
    const ids = new Set(records.map(record => record.id));
    for (const [id, node] of cache) if (!ids.has(id)) { node.item.remove(); cache.delete(id); }
  }
  if (inspected && !unhidden(focused)) { follow.checked = false; list.focus({ preventScroll: true }); }
  panel.scrollTop = scroll;
}

function row(entry) {
  const actor = describeActor(entry);
  const node = nodeShell(describeStep(entry), actor);
  const body = element('div', undefined, 'evidence');
  node.body = body;
  if (entry.type === 'assistant.turn_start') {
    node.activityBox = element('div', undefined, 'activity-source');
    node.activityBox.hidden = true;
    node.activityLink = element('button', 'View reported activity evidence');
    node.activityLink.type = 'button';
    node.activityLink.addEventListener('click', () => { if (node.activityId) showBoundary(node.activityId); });
    node.activityBox.append(element('p', 'Recorded assistant statement, not a verified reason or a summary of all work in this turn.'), node.activityLink);
    body.append(node.activityBox);
  }
  const lesson = explainStep(entry);
  body.append(element('h3', 'Understand this step'));
  const concept = conceptForEntry(entry);
  if (concept) {
    node.glossary = element('button', `Learn about ${vocabulary[concept].label.toLowerCase()}`, 'glossary-term');
    node.glossary.type = 'button';
    node.glossary.setAttribute('aria-haspopup', 'dialog');
    node.glossary.setAttribute('aria-controls', 'glossary-panel');
    node.glossary.setAttribute('aria-expanded', 'false');
    node.glossary.addEventListener('click', () => openGlossary(conceptForEntry(node.entry), node.entry, node.glossary));
    body.append(node.glossary);
  }
  node.lesson = new Map();
  for (const [key, heading] of [['happened', 'What happened'], ['means', 'What the recorded result means'], ['unknown', 'What remains unknown']]) {
    const paragraph = element('p', lesson[key], `step-${key}`);
    node.lesson.set(key, paragraph);
    body.append(element('h4', heading), paragraph);
  }
  const general = element('details', undefined, 'general-definition');
  node.explanation = element('p', lesson.general);
  general.append(element('summary', 'General definition'), node.explanation);
  body.append(general);
  renderSkillInstructions(node, entry);
  const metadata = element('dl', undefined, 'metadata');
  node.metadata = new Map();
  for (const [label, value] of metadataValues(entry)) {
    const text = element('dd', value);
    node.metadata.set(label, text);
    metadata.append(element('dt', label), text);
  }
  body.append(metadata);
  node.recordedEvidence = element('details', undefined, 'recorded-evidence');
  node.recordedEvidence.append(element('summary', 'Recorded evidence'));
  node.truncated = element('p', 'Trace clipped raw evidence to at most 12,000 UTF-16 code units. The complete raw event is not retained by this panel.', 'evidence-truncated');
  node.truncated.hidden = !entry.truncated;
  node.pre = element('pre', entry.evidence);
  node.pre.tabIndex = 0;
  node.pre.setAttribute('aria-label', 'Recorded event data');
  node.recordedEvidence.append(node.truncated, node.pre);
  body.append(node.recordedEvidence);
  node.details.append(body);
  return node;
}

function renderExtent(node, extent) {
  if (!extent) return;
  if (!node.extent) {
    const section = element('section', undefined, 'extent-evidence');
    const badges = element('p', undefined, 'extent-badges'), requested = element('p'), returned = element('p');
    const details = element('details'), notes = element('p');
    details.append(element('summary', 'How these limits are known'), notes);
    details.addEventListener('toggle', () => { if (details.open) follow.checked = false; });
    section.append(element('h3', 'Scope and limits'), badges, requested, returned, details);
    node.body.insertBefore(section, node.recordedEvidence || null);
    node.extent = { badges, requested, returned, notes };
  }
  for (const [target, value] of [
    [node.extent.badges, extent.badges.join(' · ')],
    [node.extent.requested, extent.requested.join('. ') || 'Requested range or limit unavailable in a recognized complete request.'],
    [node.extent.returned, extent.returned], [node.extent.notes, extent.notes.join(' ')],
  ]) if (target.textContent !== value) target.textContent = value;
}

function renderSkillInstructions(node, entry) {
  const instructions = skillInstructions(entry);
  if (!instructions) return;
  if (!node.skill) {
    const section = element('div', undefined, 'skill-instructions');
    const metadata = element('dl', undefined, 'metadata');
    const name = element('dd'), trigger = element('dd'), explanation = element('p'), note = element('p');
    metadata.append(element('dt', 'Recorded name'), name, element('dt', 'Recorded trigger'), trigger);
    const preview = element('pre', '', 'skill-preview');
    preview.tabIndex = 0;
    preview.setAttribute('aria-label', 'Skill instruction preview');
    const full = element('details', undefined, 'skill-full');
    const content = element('pre');
    content.tabIndex = 0;
    content.setAttribute('aria-label', 'Exact retained skill instructions');
    full.append(element('summary', 'Exact retained instructions'), content);
    const inputs = element('details', undefined, 'skill-arguments');
    const inputNote = element('p'), args = element('pre');
    args.tabIndex = 0;
    args.setAttribute('aria-label', 'Recorded skill invocation arguments');
    inputs.append(element('summary', 'Recorded invocation arguments'), inputNote, args);
    for (const disclosure of [full, inputs]) disclosure.addEventListener('toggle', () => {
      if (disclosure.open) follow.checked = false;
    });
    const sources = element('button', 'Inspect instruction sources'); sources.type = 'button';
    sources.setAttribute('aria-haspopup', 'dialog'); sources.setAttribute('aria-controls', 'statistics-panel'); sources.setAttribute('aria-expanded', 'false');
    sources.addEventListener('click', () => {
      if (footerPanels.openPanel('statistics-panel', sources, document.querySelector('#statistics-button'))) instructionView.inspectSkill(node.entry);
    });
    section.append(element('h3', 'Supplied skill instructions'), metadata, explanation, note, preview, full, inputs, sources);
    node.body.append(section);
    node.skill = { name, trigger, explanation, note, preview, full, content, inputs, inputNote, args };
  }
  const skill = node.skill;
  for (const [target, value] of [
    [skill.name, instructions.name === '' ? 'Recorded empty name' : instructions.name ?? 'Unavailable in complete matching evidence'],
    [skill.trigger, instructions.trigger === '' ? 'Recorded empty trigger' : instructions.trigger ?? 'Not recorded in complete matching evidence'],
    [skill.explanation, instructions.triggerExplanation], [skill.note, instructions.note],
    [skill.preview, instructions.preview ?? ''], [skill.content, instructions.content ?? ''],
    [skill.args, instructions.arguments ?? ''],
    [skill.inputNote, instructions.arguments === '' ? 'The host recorded empty invocation arguments.'
      : 'These recorded invocation inputs are separate from the reusable instruction body.'],
  ]) if (target.textContent !== value) target.textContent = value;
  skill.preview.hidden = instructions.status !== 'complete';
  skill.full.hidden = instructions.status !== 'complete';
  skill.inputs.hidden = instructions.arguments === null;
}

function metadataValues(entry) {
  const actor = describeActor(entry);
  const time = typeof entry.timestamp === 'string' && entry.timestamp ? entry.timestamp : 'Not recorded';
  return [['Recorded time', time], ['Actor', actor.role], ['Source', actor.source], ['Event', entry.type]];
}

function renderHookInvocation(owner, call) {
  if (!owner.hook) {
    owner.hook = element('details', undefined, 'hook-invocation');
    owner.hookTitle = element('summary');
    owner.hookSource = element('p');
    owner.hookTiming = element('p');
    owner.hookOutcome = element('p');
    owner.hookNotes = element('p', '', 'hook-notes');
    owner.hookReported = element('dl', undefined, 'metadata hook-reported');
    owner.hookFields = new Map();
    owner.hookLinks = element('div', undefined, 'boundary-links');
    owner.hookLinks.setAttribute('role', 'group');
    owner.hookLinks.setAttribute('aria-label', 'Original hook boundaries in recorded event order');
    owner.hookButtons = new Map();
    owner.hookRaw = element('details', undefined, 'hook-output');
    owner.hookRaw.append(element('summary', 'Recorded output and error'));
    owner.hookOutput = element('pre');
    owner.hookOutput.tabIndex = 0;
    owner.hookOutput.setAttribute('aria-label', 'Recorded hook output');
    owner.hookError = element('pre');
    owner.hookError.tabIndex = 0;
    owner.hookError.setAttribute('aria-label', 'Recorded hook error');
    owner.hookRaw.append(element('p', 'Output'), owner.hookOutput, element('p', 'Error'), owner.hookError);
    owner.hook.append(owner.hookTitle, owner.hookSource, element('h4', 'General lifecycle timing'), owner.hookTiming,
      element('h4', 'Recorded pipeline result'), owner.hookOutcome, owner.hookReported, owner.hookRaw,
      element('p', 'A reported result or decision request does not verify downstream effects, approval, blocking or instruction compliance. Supplied context is shown only when output exposes it; callback returns may be absent from pipeline output.'),
      owner.hookNotes, owner.hookLinks);
    owner.hook.addEventListener('toggle', () => { if (owner.hook.open) follow.checked = false; });
  }
  const title = `${call.title} · ${call.linked ? 'Pipeline invocation' : 'Unlinked boundary'}`;
  const source = `${describeActor(call.entries[0]).source} · Invocation ID: ${call.hookInvocationId ?? 'Unavailable'}`;
  const result = call.outcome === 'unknown' ? 'Pipeline outcome unknown.' : `Reported pipeline ${call.outcome}.`;
  const status = `${result} ${call.entries.length} retained boundary ${call.entries.length === 1 ? 'event' : 'events'} · ${call.status}.`;
  for (const [node, text] of [[owner.hookTitle, title], [owner.hookSource, source], [owner.hookTiming, call.timing],
    [owner.hookOutcome, status], [owner.hookNotes, call.notes.join(' ')],
    [owner.hookOutput, call.output ?? 'Output not exposed in complete matching evidence.'],
    [owner.hookError, call.error ?? 'No typed error exposed in complete matching evidence.']]) {
    if (node.textContent !== text) node.textContent = text;
  }
  const fields = new Set(call.reported.map(item => item.field));
  for (const [key, row] of owner.hookFields) if (!fields.has(key)) {
    row.label.remove(); row.value.remove(); owner.hookFields.delete(key);
  }
  let previousField;
  for (const field of call.reported) {
    let row = owner.hookFields.get(field.field);
    if (!row) {
      row = { label: element('dt'), value: element('dd') };
      owner.hookFields.set(field.field, row);
    }
    if (row.label.textContent !== field.label) row.label.textContent = field.label;
    if (row.value.textContent !== field.value) row.value.textContent = field.value;
    previousField = place(owner.hookReported, row.label, previousField);
    previousField = place(owner.hookReported, row.value, previousField);
  }
  let previousButton;
  const ids = new Set(call.entries.map(entry => entry.id));
  for (const entry of call.entries) {
    let button = owner.hookButtons.get(entry.id);
    if (!button) {
      button = element('button'); button.type = 'button';
      button.addEventListener('click', () => showBoundary(entry.id));
      owner.hookButtons.set(entry.id, button);
    }
    const label = `${entry.type === 'hook.start' ? 'Start' : 'End'} evidence · ${entry.timestamp || 'Time unavailable'}`;
    if (button.textContent !== label) button.textContent = label;
    previousButton = place(owner.hookLinks, button, previousButton);
  }
  for (const [id, button] of owner.hookButtons) if (!ids.has(id)) { button.remove(); owner.hookButtons.delete(id); }
}

function renderHookGroup(group, calls, chronological, previousRows, usedRows, focused) {
  if (!group.invocations) {
    group.invocations = element('ol', undefined, 'hook-invocations');
    group.invocations.setAttribute('aria-label', 'Retained hook pipeline invocations');
    group.hookRows = new Map();
    group.details.insertBefore(element('p', 'Summaries link matching retained boundaries across groups. Original events below remain in their recorded order; invocation counts across groups are not additive.', 'group-note'), group.children);
    group.details.insertBefore(group.invocations, group.children);
  }
  const nextRows = new Map();
  let previous;
  for (const call of calls) {
    const local = call.entries.filter(entry => group.ids.has(entry.id));
    const candidates = previousRows.filter(old => old.id === call.id && local.some(entry => old.ids.has(entry.id)));
    const available = candidates.filter(old => !usedRows.has(old.row));
    const prior = available.find(old => old.row.hook.contains(focused))
      || available.find(old => old.open) || available.find(old => old.group === group) || available[0];
    const row = prior?.row || { item: element('li') };
    renderHookInvocation(row, call);
    row.hook.open = candidates.some(old => old.open);
    row.hookRaw.open = candidates.some(old => old.rawOpen);
    row.ids = new Set(local.map(entry => entry.id));
    nextRows.set(call.id, row);
    usedRows.add(row);
    const boundary = local.find(entry => matchesFilter(entry, activityFilter.value)) || local[0];
    const target = chronological ? nodes.get(boundary.id).body : row.item;
    if (row.hook.parentElement !== target) target.append(row.hook);
    previous = place(group.invocations, row.item, previous);
  }
  group.hookRows = nextRows;
}

function renderToolProvenance(group, description) {
  if (!group.provenance) {
    group.provenance = element('details', undefined, 'tool-provenance');
    group.provenance.append(element('summary', 'Tool origin and provider'));
    group.provenance.addEventListener('toggle', () => { if (group.provenance.open) follow.checked = false; });
    group.provenanceBasis = element('p');
    group.provenanceMetadata = element('dl', undefined, 'metadata provenance-metadata');
    group.provenanceFields = new Map();
    for (const [key, label] of [['origin', 'Origin'], ['provider', 'Provider display name'], ['serverKey', 'Configured server key'],
      ['serverName', 'Recorded server name'], ['toolName', 'Original MCP tool'], ['modelToolName', 'Model-facing tool'],
      ['configSource', 'MCP configuration source'], ['transport', 'Recorded transport']]) {
      const value = element('dd');
      group.provenanceFields.set(key, value);
      group.provenanceMetadata.append(element('dt', label), value);
    }
    group.provenanceUncertainty = element('p');
    group.provenanceLink = element('button', 'View invocation metadata evidence');
    group.provenanceLink.type = 'button';
    group.provenanceLink.addEventListener('click', () => { if (group.provenanceId) showBoundary(group.provenanceId); });
    group.provenance.append(group.provenanceBasis, group.provenanceMetadata, group.provenanceUncertainty, group.provenanceLink);
  }
  if (group.provenanceBadge.textContent !== description.label) group.provenanceBadge.textContent = description.label;
  if (group.provenanceBasis.textContent !== description.basis) group.provenanceBasis.textContent = description.basis;
  if (group.provenanceUncertainty.textContent !== description.uncertainty) group.provenanceUncertainty.textContent = description.uncertainty;
  for (const [key, value] of group.provenanceFields) {
    const text = description[key] ?? 'Unknown';
    if (value.textContent !== text) value.textContent = text;
  }
  group.provenanceMetadata.hidden = description.origin === 'Unknown';
  group.provenanceId = description.basisId;
  group.provenanceLink.hidden = !description.basisId;
}

function renderActionStages(group, description, operation) {
  if (!group.actions) {
    group.actions = element('details', undefined, 'action-stages');
    group.actions.append(element('summary', 'Observed action stages and category limits'));
    group.actions.addEventListener('toggle', () => { if (group.actions.open) follow.checked = false; });
    group.permission = element('p', '', 'action-permission');
    group.operationBasis = element('p', '', 'operation-basis');
    group.operationLimits = element('p', '', 'operation-limits');
    group.stages = element('ol', undefined, 'action-stage-list');
    group.stages.setAttribute('aria-label', 'Observed stages in recorded event order');
    group.stageNotes = element('p', '', 'action-stage-notes');
    group.stageRows = new Map();
    group.actions.append(group.operationBasis, group.operationLimits, group.permission, group.stages, group.stageNotes);
  }
  if (group.operationBadge.textContent !== operation.label) group.operationBadge.textContent = operation.label;
  if (group.operationBasis.textContent !== operation.basis) group.operationBasis.textContent = operation.basis;
  if (group.operationLimits.textContent !== operation.limits) group.operationLimits.textContent = operation.limits;
  if (group.permission.textContent !== description.permission) group.permission.textContent = description.permission;
  const notes = description.notes.join(' ');
  if (group.stageNotes.textContent !== notes) group.stageNotes.textContent = notes;
  const retained = new Set(description.stages.map(stage => stage.id));
  for (const [id, row] of group.stageRows) if (!retained.has(id)) { row.item.remove(); group.stageRows.delete(id); }
  let previous;
  for (const stage of description.stages) {
    let row = group.stageRows.get(stage.id);
    if (!row) {
      row = { item: element('li'), button: element('button'), time: element('span', '', 'stage-time'), detail: element('p') };
      row.button.type = 'button';
      row.button.addEventListener('click', () => showBoundary(stage.id));
      row.item.append(row.button, row.time, row.detail);
      group.stageRows.set(stage.id, row);
    }
    const label = `${stage.label} — view evidence`;
    if (row.button.textContent !== label) row.button.textContent = label;
    const time = stage.timestamp || 'Recorded time unavailable';
    if (row.time.textContent !== time) row.time.textContent = time;
    if (row.detail.textContent !== stage.detail) row.detail.textContent = stage.detail;
    row.detail.hidden = !stage.detail;
    previous = place(group.stages, row.item, previous);
  }
}

function place(parent, item, previous) {
  const expected = previous ? previous.nextElementSibling : parent.firstElementChild;
  if (expected !== item) parent.insertBefore(item, expected);
  return item;
}

function showBoundary(id, message = 'Showing original retained event. Follow live is paused.', expected) {
  const node = nodes.get(id);
  if (typeof id !== 'string' || !id.length || id.length > 256 || !node || !lastSnapshot?.entries.some(entry => entry.id === id)
    || (expected && !retainedExample(lastSnapshot.entries, expected))) {
    navigationStatus.textContent = 'That event is no longer retained. Reading position unchanged.';
    return;
  }
  follow.checked = false;
  eventOrder.value = 'chronological';
  activityFilter.value = 'everything';
  render(lastSnapshot);
  node.details.open = true;
  node.recordedEvidence.open = true;
  node.summary.focus({ preventScroll: true });
  node.summary.scrollIntoView({ block: 'center' });
  navigationStatus.textContent = message;
}

function unhidden(node) {
  if (!node?.isConnected) return false;
  for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) if (ancestor.hidden) return false;
  return true;
}

function applyFilter(snapshot) {
  const filter = Object.hasOwn(filterLabels, activityFilter.value) ? activityFilter.value : 'everything';
  const active = filter !== 'everything';
  activityFilter.value = filter;
  const matching = new Set(snapshot.entries.filter(entry => matchesFilter(entry, filter)).map(entry => entry.id));
  for (const [id, node] of nodes) node.item.hidden = !matching.has(id);
  for (const group of [...groups, ...chapters, ...lanes]) {
    const count = [...group.ids].filter(id => matching.has(id)).length;
    group.item.hidden = count === 0;
    if (!group.filterNote) {
      group.filterNote = element('span', '', 'filter-context');
      group.subtitle.parentElement.append(group.filterNote);
    }
    group.filterNote.hidden = !active;
    const note = `Retained ${group.kind === 'tool' ? 'call' : group.kind === 'hooks' ? 'hook group' : group.kind === 'lane' ? 'lane' : 'chapter'} context · ${count} matching · ${group.ids.size - count} hidden events`;
    if (group.filterNote.textContent !== note) group.filterNote.textContent = note;
  }
  timeline.dataset.filtered = String(active);
  const status = `${filterLabels[filter]} · ${matching.size} matching · ${snapshot.entries.length - matching.size} hidden · ${snapshot.entries.length} retained events. Statistics always covers retained events.`
    + (active ? ' Hidden events may leave gaps; order connectors are off. Group, chapter and lane headers show retained context. Evidence links reset filters.' : '');
  if (filterStatus.textContent !== status) filterStatus.textContent = status;
  filterEmpty.hidden = !snapshot.entries.length || matching.size > 0;
  const message = `No retained events match ${filterLabels[filter]}. Choose another filter or Reset filters to see all retained activity.`;
  if (filterEmpty.textContent !== message) filterEmpty.textContent = message;
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

function reconcileLanes(snapshot, visible) {
  const result = agentLanes(snapshot.entries, snapshot), next = [];
  const { scale } = result;
  laneHelp.hidden = !visible;
  const explanation = result.note + (scale
    ? ` Shared scale: ${new Date(scale.start).toISOString()} to ${new Date(scale.end).toISOString()} (${(scale.end - scale.start) / 1000} s wall time).`
    : ' Shared scale unavailable until positive reliable intervals are retained.');
  if (laneHelp.textContent !== explanation) laneHelp.textContent = explanation;
  for (const section of result.lanes) {
    const subtitle = `${section.entries.length} retained events · ${section.status}`;
    let lane = lanes.find(previous => previous.id === section.id);
    if (!lane) {
      lane = nodeShell({ kind: 'Subagent', title: section.title, subtitle, tone: 'agent' },
        { role: section.agentId === '' ? 'Main chat lane' : section.agentId === null ? 'Unassigned records' : 'Subagent lane' });
      lane.kind = 'lane'; lane.id = section.id;
      lane.item.classList.add('agent-lane');
      lane.context.className = 'lane-timing';
      lane.graph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      lane.graph.setAttribute('viewBox', '0 0 1000 24');
      lane.graph.setAttribute('preserveAspectRatio', 'none');
      lane.graph.setAttribute('aria-hidden', 'true');
      lane.graph.setAttribute('focusable', 'false');
      lane.graph.setAttribute('class', 'lane-graph');
      lane.context.parentElement.append(lane.graph);
      lane.parentNote = element('p', '', 'group-note');
      lane.links = element('div', undefined, 'boundary-links');
      lane.links.setAttribute('role', 'group');
      lane.links.setAttribute('aria-label', 'Original lane boundaries and recorded delegation');
      lane.buttons = new Map();
      lane.children = element('ol', undefined, 'lane-events');
      lane.children.setAttribute('aria-label', 'Original events for this source in recorded order');
      lane.details.append(lane.parentNote, lane.links, lane.children);
    }
    lane.ids = new Set(section.entries.map(entry => entry.id));
    if (lane.title.textContent !== section.title) lane.title.textContent = section.title;
    if (lane.subtitle.textContent !== subtitle) lane.subtitle.textContent = subtitle;
    const intervals = section.intervals.map(interval => `${(interval.start - scale.start) / 1000}–${(interval.end - scale.start) / 1000} s on shared scale · ${(interval.end - interval.start) / 1000} s elapsed`);
    const timing = intervals.length ? `${section.timing}: ${intervals.join('; ')}` : section.timing;
    if (lane.context.textContent !== timing) lane.context.textContent = timing;
    lane.context.hidden = false;
    const graphKey = JSON.stringify([scale, section.intervals]);
    if (lane.graphKey !== graphKey) {
      lane.graphKey = graphKey;
      const marks = [];
      if (scale && section.intervals.length) {
        for (const x of [0, 250, 500, 750, 1000]) {
          const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          for (const [key, value] of Object.entries({ x1: x, x2: x, y1: 0, y2: 24 })) tick.setAttribute(key, String(value));
          marks.push(tick);
        }
        for (const interval of section.intervals) {
          const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          const span = scale.end - scale.start;
          for (const [key, value] of Object.entries({ x: (interval.start - scale.start) / span * 1000,
            width: (interval.end - interval.start) / span * 1000, y: 6, height: 12 })) bar.setAttribute(key, String(value));
          marks.push(bar);
        }
      }
      lane.graph.replaceChildren(...marks);
    }
    lane.graph.setAttribute('data-empty', String(!section.intervals.length));
    const parentNote = section.agentId === '' ? 'Main-chat bars are paired model turns, not whole-request or CPU time.'
      : section.parentId ? 'Parent delegation is linked by its recorded spawning-tool ID; completion does not establish task success.'
        : 'Parent delegation unavailable or ambiguous in retained evidence; no relationship is inferred.';
    if (lane.parentNote.textContent !== parentNote) lane.parentNote.textContent = parentNote;
    const links = [...section.links.map(link => ({ ...link, key: `source:${link.id}` })),
      ...(section.parentId ? [{ id: section.parentId, key: `parent:${section.parentId}`, label: 'Parent delegation evidence' }] : [])];
    let previousButton;
    for (const link of links) {
      let button = lane.buttons.get(link.key);
      if (!button) {
        button = element('button', link.label); button.type = 'button';
        button.addEventListener('click', () => showBoundary(link.id));
        lane.buttons.set(link.key, button);
      }
      previousButton = place(lane.links, button, previousButton);
    }
    const keys = new Set(links.map(link => link.key));
    for (const [key, button] of lane.buttons) if (!keys.has(key)) { button.remove(); lane.buttons.delete(key); }
    let previous;
    for (const entry of visible ? section.entries : []) previous = place(lane.children, nodes.get(entry.id).item, previous);
    next.push(lane);
  }
  return next;
}

function render(snapshot) {
  updateGlossary();
  const focused = document.activeElement;
  const focusedId = [...nodes].find(([, node]) => node.item.contains(focused))?.[0];
  const focusedGroup = groups.find(group => group.item.contains(focused) || group.ids.has(focusedId));
  const focusedChapter = chapters.find(chapter => chapter.item.contains(focused) || chapter.ids.has(focusedId));
  const focusedLane = lanes.find(lane => lane.item.contains(focused) || lane.ids.has(focusedId));
  const chapterView = eventOrder.value === 'chapters';
  const laneView = eventOrder.value === 'lanes';
  const chronological = eventOrder.value !== 'grouped';
  const contexts = turnContext(snapshot.entries, snapshot);
  const stages = actionStages(snapshot.entries, snapshot);
  const provenance = toolProvenance(snapshot.entries);
  const operations = toolOperations(snapshot.entries);
  const extents = toolExtents(snapshot.entries, snapshot);
  const hooks = hookInvocations(snapshot.entries);
  const hookByEvent = new Map(hooks.flatMap(call => call.entries.map(entry => [entry.id, call])));
  renderStatistics(snapshot);
  const oldGroups = groups.map(group => ({ group, ids: group.ids, open: group.details.open }));
  const oldHookRows = groups.flatMap(group => [...(group.hookRows || [])].map(([id, row]) => ({
    id, row, group, ids: row.ids, open: row.hook.open, rawOpen: row.hookRaw.open,
  })));
  const usedHookRows = new Set();
  const retained = new Set(snapshot.entries.map(entry => entry.id));
  for (const [id, node] of nodes) {
    if (!retained.has(id)) { node.item.remove(); nodes.delete(id); }
  }
  for (const entry of snapshot.entries) {
    let node = nodes.get(entry.id);
    if (!node) { node = row(entry); nodes.set(entry.id, node); }
    node.entry = entry;
    renderExtent(node, extents.get(entry.id));
    if (node.glossary) {
      const concept = conceptForEntry(entry);
      node.glossary.hidden = !concept;
      if (concept) node.glossary.textContent = `Learn about ${vocabulary[concept].label.toLowerCase()}`;
    }
    const context = contexts.get(entry.id);
    const display = describeTurn(entry, context, operations.get(entry.id));
    if (node.title.textContent !== display.title) node.title.textContent = display.title;
    if (node.subtitle.textContent !== display.subtitle) node.subtitle.textContent = display.subtitle;
    if (node.provenanceBadge && node.provenanceBadge.textContent !== provenance.get(entry.id).label) {
      node.provenanceBadge.textContent = provenance.get(entry.id).label;
    }
    if (node.operationBadge && node.operationBadge.textContent !== operations.get(entry.id).label) {
      node.operationBadge.textContent = operations.get(entry.id).label;
    }
    node.item.dataset.tone = display.tone;
    node.item.dataset.activity = display.activityId ? 'reported' : '';
    if (node.activityBox) {
      node.activityId = display.activityId;
      node.activityBox.hidden = !display.activityId;
    }
    for (const [label, value] of metadataValues(entry)) {
      if (node.metadata.get(label).textContent !== value) node.metadata.get(label).textContent = value;
    }
    const lesson = explainStep(entry);
    for (const [key, paragraph] of node.lesson) if (paragraph.textContent !== lesson[key]) paragraph.textContent = lesson[key];
    if (node.explanation.textContent !== lesson.general) node.explanation.textContent = lesson.general;
    renderSkillInstructions(node, entry);
    if (node.pre.textContent !== (entry.evidence || '')) node.pre.textContent = entry.evidence || '';
    node.truncated.hidden = !entry.truncated;
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
    const display = tool ? describeToolGroup(section.entries, operations.get(section.entries[0].id)) : describeHookGroup(section.entries);
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
      group.children.setAttribute('aria-label', tool ? 'Original tool boundary events' : 'Original hook boundaries in recorded event order');
      group.details.append(group.children);
      group.details.open = Boolean(prior?.open || section.entries.some(entry => nodes.get(entry.id).details.open));
    }
    group.id = section.id;
    if (group.title.textContent !== display.title) group.title.textContent = display.title;
    if (group.subtitle.textContent !== display.subtitle) group.subtitle.textContent = display.subtitle;
    group.item.dataset.tone = display.tone;
    applyContext(group, tool ? null : contexts.get(section.entries[0].id));
    group.ids = new Set(section.entries.map(entry => entry.id));
    if (!tool) renderHookGroup(group, [...new Set(section.entries.map(entry => hookByEvent.get(entry.id)))], chronological,
      oldHookRows, usedHookRows, focused);
    if (tool) {
      renderActionStages(group, stages.get(section.entries[0].id), operations.get(section.entries[0].id));
      renderToolProvenance(group, provenance.get(section.entries[0].id));
      if (oldGroups.some(old => old.group.actions?.open && section.entries.some(entry => old.ids.has(entry.id)))) group.actions.open = true;
      if (oldGroups.some(old => old.group.provenance?.open && section.entries.some(entry => old.ids.has(entry.id)))) group.provenance.open = true;
      const visibleBoundary = section.entries.find(entry => matchesFilter(entry, activityFilter.value)) || section.entries[0];
      const target = chronological ? nodes.get(visibleBoundary.id).body : group.details;
      if (group.provenance.parentElement !== target) {
        if (chronological) target.append(group.provenance);
        else target.insertBefore(group.provenance, group.children);
      }
      if (group.actions.parentElement !== target) {
        if (chronological) target.append(group.actions);
        else target.insertBefore(group.actions, group.children);
      }
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
  const nextLanes = reconcileLanes(snapshot, laneView);
  timeline.dataset.lanes = String(laneView);
  let previous;
  if (laneView) {
    for (const lane of nextLanes) previous = place(timeline, lane.item, previous);
  } else if (chapterView) {
    for (const chapter of nextChapters) previous = place(timeline, chapter.item, previous);
  } else {
    for (const section of chronological ? groupSteps(snapshot.entries, true) : sections) {
      previous = place(timeline, section.group?.item || nodes.get(section.entries[0].id).item, previous);
    }
  }
  for (const group of groups) {
    if (chronological || !nextGroups.includes(group)) group.item.remove();
    if (!nextGroups.includes(group)) group.actions?.remove();
    if (!nextGroups.includes(group)) group.provenance?.remove();
  }
  // History can split or merge groups; release only disclosures no new group retained.
  for (const { row } of oldHookRows) if (!usedHookRows.has(row)) { row.hook.remove(); row.item.remove(); }
  for (const chapter of chapters) if (!chapterView || !nextChapters.includes(chapter)) chapter.item.remove();
  for (const lane of lanes) if (!laneView || !nextLanes.includes(lane)) lane.item.remove();
  for (const group of nextGroups) {
    const wanted = new Set([...group.ids].map(id => nodes.get(id).item));
    for (const item of [...group.children.children]) if (!wanted.has(item)) item.remove();
  }
  groups = nextGroups;
  chapters = nextChapters;
  lanes = nextLanes;
  applyFilter(snapshot);
  updateNavigation();
  // Moving an existing disclosure into a group must not strand keyboard focus.
  const focusedNode = nodes.get(focusedId);
  let focusTarget = focusedNode?.activityLink === focused && focusedNode?.activityBox.hidden
    ? focusedNode.summary : unhidden(focused) ? focused : null;
  if (focusTarget && !unhidden(focusTarget)) focusTarget = null;
  const filtered = activityFilter.value !== 'everything';
  if (!focusTarget && filtered && (focusedId || focusedGroup || focusedChapter || focusedLane)) focusTarget = activityFilter;
  if (!focusTarget && focusedGroup) {
    const group = groups.find(group => group === focusedGroup);
    focusTarget = chronological ? nodes.get(group?.ids.values().next().value)?.summary : group?.summary;
  }
  if (!focusTarget && focusedChapter) {
    const chapter = chapters.find(chapter => chapter === focusedChapter)
      || chapters.find(chapter => [...chapter.ids].some(id => focusedChapter.ids.has(id)));
    focusTarget = chapterView ? chapter?.summary : nodes.get(chapter?.ids.values().next().value)?.summary;
  }
  if (!focusTarget && focusedLane) {
    const lane = lanes.find(lane => lane === focusedLane);
    focusTarget = laneView ? lane?.summary : nodes.get(lane?.ids.values().next().value)?.summary;
  }
  if (!focusTarget && (focusedId || focusedGroup || focusedChapter || focusedLane)) focusTarget = eventOrder;
  if (focusTarget && document.activeElement !== focusTarget) {
    follow.checked = false;
    let ancestor = focusTarget.tagName.toLowerCase() === 'summary'
      ? focusTarget.parentElement?.parentElement?.closest('details') : focusTarget.parentElement?.closest('details');
    while (ancestor) { ancestor.open = true; ancestor = ancestor.parentElement?.closest('details'); }
    focusTarget.focus({ preventScroll: true });
  }
  empty.hidden = snapshot.entries.length > 0;
  const viewHelp = chapterView ? 'Request chapters are chronological intervals, not causal groups or completion reports.'
    : laneView ? 'Lanes keep exact recorded sources separate. Open a lane for its chronological events; lane order does not establish event order or parentage.'
    : 'Indented steps were recorded within a model turn. Open any step for its evidence.';
  const scopeView = document.querySelector('#scope-view');
  if (scopeView.textContent !== viewHelp) scopeView.textContent = viewHelp;
  renderObserverScope();
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

const poller = createPoller({
  async load() {
    const response = await fetch('events', { headers: etag ? { 'If-None-Match': etag } : {}, signal: AbortSignal.timeout(5000) });
    if (response.status === 200) {
      lastSnapshot = await response.json();
      etag = response.headers.get('etag');
      if (feedState !== 'connected') diagnostics.record('connected');
      feedState = 'connected';
      render(lastSnapshot);
    } else if (response.status === 304 && lastSnapshot) {
      if (feedState !== 'connected') diagnostics.record('connected');
      feedState = 'connected';
      renderObserverScope();
    } else {
      if (feedState !== 'disconnected') diagnostics.record('disconnected', { status: response.status });
      feedState = 'disconnected';
      throw new Error('Event feed unavailable.');
    }
    following.sync();
    return true;
  },
  onError() {
    if (feedState !== 'disconnected') diagnostics.record('disconnected');
    feedState = 'disconnected';
    renderObserverScope();
  },
});
const footerPanels = initFooter({ diagnostics, refresh: poller.refresh, onInspect: () => { follow.checked = false; } });
window.addEventListener('pagehide', () => { poller.stop(); capabilityView.close(); instructionView.close(); pageSize.disconnect(); });
renderObserverScope();
void poller.refresh();
