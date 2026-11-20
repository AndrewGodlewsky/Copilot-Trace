import { explanationData, toolOperations, retainedRecapEntry } from './presentation.mjs';

export const predictionCategories = Object.freeze({
  'read-search': 'Read / search', edit: 'Edit', execute: 'Execute', delegation: 'Delegation', response: 'Response',
});
const counter = value => Number.isSafeInteger(value) && value >= 0;
const identity = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256;
const unknown = (attempt, note) => ({ ...attempt, status: 'unknown', category: 'unknown', note });

export function createSurpriseBookmarks() {
  const items = [], limit = 20;
  let sequence = 0, closed = false;
  function clear() { for (const mark of items) mark.expected = null; items.length = 0; }
  function sync(entries) {
    for (const mark of items) if (mark.expected && !retainedRecapEntry(entries, mark.expected)) mark.expected = null;
  }
  function find(entry) { return items.find(mark => mark.expected && retainedRecapEntry([entry], mark.expected)); }
  return {
    items, limit, sync, find, clear,
    mark(entry, entries) {
      if (closed || !retainedRecapEntry(entries, entry)) return 'unavailable';
      sync(entries);
      if (find(entry)) return 'duplicate';
      if (items.length === limit) return 'full';
      // Keep an exact comparison copy only while retained; never a digest or expired archive.
      if (JSON.stringify(entry).length > 65536) return 'unavailable';
      items.push({ number: ++sequence, expected: freezeLearningSnapshot({ entries: [entry] }).entries[0] });
      return 'marked';
    },
    unmark(mark) {
      const index = items.indexOf(mark);
      if (index < 0) return false;
      mark.expected = null; items.splice(index, 1); return true;
    },
    close() { closed = true; clear(); },
  };
}

// These categories interpret one record's contract, never later metadata or current catalogs.
export function classifyPredictionEvent(entry) {
  if (!['tool.execution_start', 'assistant.message', 'subagent.started'].includes(entry?.type)) return null;
  const fallback = { category: 'unknown', note: 'The next eligible record has incomplete, ambiguous or unsupported evidence. Its action category is unknown.' };
  if (entry.truncated !== false || entry.protectedContentOmitted !== false
    || !(entry.agentId === '' || identity(entry.agentId))) return fallback;
  const data = explanationData(entry);
  if (!data) return fallback;
  if (entry.type === 'assistant.message') {
    if (!identity(data.messageId) || typeof data.content !== 'string') return fallback;
    if (['chunkIndex', 'chunkCount', 'phase'].some(field => Object.hasOwn(data, field))) return fallback;
    if (data.toolRequests !== undefined && (!Array.isArray(data.toolRequests) || data.toolRequests.some(request => !request || typeof request !== 'object'
      || !identity(request.toolCallId) || !identity(request.name) || !request.arguments || typeof request.arguments !== 'object' || Array.isArray(request.arguments)))) return fallback;
    if (data.toolRequests?.length) return null;
    if (!data.content.trim()) return fallback;
    return { category: 'response', note: 'The host recorded an unsplit assistant text message without tool requests. This is output, not a guarantee that the task is finished or correct.' };
  }
  if (entry.type === 'subagent.started') {
    return identity(entry.agentId) && identity(data.toolCallId) && data.toolCallId === entry.toolCallId
      && identity(data.agentName) && typeof data.agentDisplayName === 'string' && typeof data.agentDescription === 'string'
      ? { category: 'delegation', note: 'The host recorded a subagent starting. This lifecycle record establishes delegation without guessing from a tool name or later child metadata.' } : fallback;
  }
  if (['origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(data, field))) return fallback;
  const operation = toolOperations([entry]).get(entry.id);
  const kinds = operation?.categories || [];
  const category = kinds.includes('Read') || kinds.includes('Search') ? 'read-search'
    : kinds.length === 1 && kinds[0] === 'Edit' ? 'edit' : kinds.length === 1 && kinds[0] === 'Execute' ? 'execute' : 'unknown';
  return category === 'unknown' ? fallback : { category, note: `${operation.basis} This records an invocation request, not approval, execution or completed effects. Actual implementation remains unknown.` };
}

function validSnapshot(snapshot) {
  return snapshot?.history === 'ready' && counter(snapshot.liveReceipt) && counter(snapshot.omitted)
    && Array.isArray(snapshot.entries) && snapshot.entries.length <= 300;
}

export function armLivePrediction(snapshot, choice) {
  const attempt = { mode: 'live', choice, status: 'waiting', baseline: snapshot?.liveReceipt, omitted: snapshot?.omitted,
    seen: Array.isArray(snapshot?.entries) ? snapshot.entries.slice(0, 300).map(entry => entry?.id) : [] };
  return validSnapshot(snapshot) && Object.hasOwn(predictionCategories, choice)
    ? resolveLivePrediction(attempt, snapshot) : unknown(attempt, 'Unanswered: a ready history and safe fresh observation boundary are unavailable.');
}

export function resolveLivePrediction(attempt, snapshot, connected = true) {
  if (attempt.status !== 'waiting') return attempt;
  if (!connected || !validSnapshot(snapshot) || !counter(attempt.baseline) || snapshot.liveReceipt < attempt.baseline
    || snapshot.omitted !== attempt.omitted) return unknown(attempt, 'Unanswered: connection, history or retention changed. The next observed action is unknown.');
  const ids = new Set(), receipts = new Set();
  const arrivals = [];
  for (const entry of snapshot.entries) {
    const observation = entry?.observation;
    if (!identity(entry?.id) || ids.has(entry.id) || !observation || !['history', 'live'].includes(observation.source)
      || (observation.receipt !== null && (!counter(observation.receipt) || observation.receipt === 0 || observation.source !== 'live'
        || observation.receipt > snapshot.liveReceipt || receipts.has(observation.receipt)))) {
      return unknown(attempt, 'Unanswered: recorded observation identities or receipt order are ambiguous.');
    }
    ids.add(entry.id);
    if (observation.receipt !== null) receipts.add(observation.receipt);
    if (observation.receipt > attempt.baseline) {
      if (attempt.seen.includes(entry.id)) return unknown(attempt, 'Unanswered: a previously visible record was repeated.');
      arrivals.push(entry);
    }
  }
  arrivals.sort((a, b) => a.observation.receipt - b.observation.receipt);
  if (arrivals.length !== snapshot.liveReceipt - attempt.baseline
    || arrivals.some((entry, index) => entry.observation.receipt !== attempt.baseline + index + 1)) {
    return unknown(attempt, 'Unanswered: an observation receipt is missing from the retained window.');
  }
  for (const entry of arrivals) {
    const classification = classifyPredictionEvent(entry);
    if (classification) return { ...attempt, ...classification, status: classification.category === 'unknown' ? 'unknown' : 'resolved', entry };
  }
  return attempt;
}

export function freezeLearningSnapshot(snapshot) {
  const copy = JSON.parse(JSON.stringify(snapshot));
  copy.entries = (copy.entries || []).slice(0, 300);
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
  };
  return freeze(copy);
}

function replayView(retained, count) {
  return Object.freeze({ ...retained, entries: Object.freeze(retained.entries.slice(0, count)) });
}

export function createActivityCounter(snapshot) {
  const baseline = snapshot?.liveReceipt;
  let previous = baseline, known = snapshot?.history === 'ready' && counter(baseline);
  return current => {
    known &&= current?.history === 'ready' && counter(current.liveReceipt) && current.liveReceipt >= previous;
    previous = current?.liveReceipt;
    return known ? previous - baseline : null;
  };
}

export function createPlayback(snapshot, { onChange = () => {}, schedule = setTimeout, cancel = clearTimeout, reducedMotion = false } = {}) {
  let retained = freezeLearningSnapshot(snapshot);
  const valid = retained.entries.every(entry => identity(entry?.id))
    && new Set(retained.entries.map(entry => entry.id)).size === retained.entries.length;
  let state = { valid, count: valid ? Math.min(1, retained.entries.length) : 0, total: retained.entries.length, playing: false, reducedMotion };
  state.snapshot = replayView(retained, state.count);
  let timer, generation = 0;
  function stop() { generation++; cancel(timer); timer = undefined; if (state) state.playing = false; }
  function changed() { state.snapshot = replayView(retained, state.count); onChange(state); }
  function advance() {
    const active = generation;
    timer = schedule(() => {
      if (!state || generation !== active || !state.playing) return;
      timer = undefined; state.count++;
      if (state.count === state.total) stop();
      changed();
      if (state?.playing) advance();
    }, 2000);
  }
  function step(direction) {
    if (!state) return;
    stop();
    if (state.valid && state.total) state.count = Math.max(1, Math.min(state.total, state.count + direction));
    changed();
  }
  return {
    get state() { return state; },
    next() { step(1); }, previous() { step(-1); },
    play() {
      if (!state || !state.valid || state.playing || state.reducedMotion || state.count >= state.total) return;
      state.playing = true; changed(); if (state?.playing) advance();
    },
    pause() { if (state) { stop(); changed(); } },
    setReducedMotion(value) { if (state) { state.reducedMotion = value; if (value) stop(); changed(); } },
    close() { stop(); state = null; retained = null; },
  };
}

export function createReplayPractice(snapshot) {
  const retained = freezeLearningSnapshot(snapshot);
  const valid = retained.entries.every(entry => identity(entry?.id))
    && new Set(retained.entries.map(entry => entry.id)).size === retained.entries.length;
  const first = retained.entries.findIndex(entry => classifyPredictionEvent(entry));
  const count = !valid ? 0 : first < 0 ? retained.entries.length : first;
  return { mode: 'replay', retained, valid, count, snapshot: replayView(retained, count), attempt: null };
}

export function chooseReplayPrediction(practice, choice) {
  const index = practice.retained.entries.findIndex((entry, index) => index >= practice.count && classifyPredictionEvent(entry));
  const attempt = { mode: 'replay', choice };
  if (!practice.valid) return { ...practice, attempt: unknown(attempt, 'Unanswered: retained event identities are unavailable or ambiguous.') };
  if (!Object.hasOwn(predictionCategories, choice) || index < 0) return { ...practice,
    attempt: unknown(attempt, 'Unanswered: no next eligible event remains in this retained practice window.') };
  const entry = practice.retained.entries[index], classification = classifyPredictionEvent(entry);
  return { ...practice, count: index + 1, snapshot: replayView(practice.retained, index + 1),
    attempt: { ...attempt, ...classification, status: classification.category === 'unknown' ? 'unknown' : 'resolved', entry } };
}
