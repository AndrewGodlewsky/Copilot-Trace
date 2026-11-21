import { projectHostOutput } from './web/host-output.mjs';

const LIMIT = 300;
const EVIDENCE_LIMIT = 12000;
const definitions = new Map(Object.entries({
  'user.message': ['chat', 'User message', 'The host recorded input from the user.'],
  'assistant.turn_start': ['turn', 'Model turn started', 'A model turn is one step in the agent loop. A chat request can involve several turns and tool calls.'],
  'assistant.turn_end': ['turn', 'Model turn ended', 'This model turn ended. More turns may follow before the chat request is finished.'],
  'assistant.intent': ['model', 'Reported activity', 'This is the activity description reported by the assistant, not an independently verified reason for a decision.'],
  'assistant.message': ['model', 'Assistant message', 'The host recorded an assistant response. It may also contain tool requests.'],
  'assistant.reasoning': ['model', 'Reported reasoning', 'This is reasoning text exposed by the host. It is not a complete account of internal decisions.'],
  'assistant.usage': ['host', 'Reported model usage', 'The host reported usage for one model call. Live receipts cover only this observation window; missing usage is unavailable, not zero. Token measures are not billing amounts.'],
  'tool.execution_start': ['tool', 'Tool started', 'The runtime recorded the start of a tool invocation. Its arguments describe the requested operation; this event alone does not prove the operation executed or explain why it was selected.'],
  'tool.execution_complete': ['tool', 'Tool completed', 'The runtime recorded a tool result. The tool-call ID links it to a matching start when available.'],
  'skill.invoked': ['skill', 'Skill loaded', 'A skill supplies instructions or context to the agent.'],
  'subagent.started': ['agent', 'Subagent started', 'The host started another agent for delegated work. Its recorded configuration is shown below.'],
  'subagent.completed': ['agent', 'Subagent completed', 'The host recorded an outcome for delegated work. Inspect the cancellation and result fields; this event alone does not establish task success.'],
  'subagent.failed': ['agent', 'Subagent failed', 'The host reported a failure in delegated work.'],
  'hook.start': ['host', 'Hook started', 'The harness recorded a hook pipeline starting at a workflow point. A pipeline can have no configured handler or multiple callbacks; this event does not identify scripts that ran.'],
  'hook.end': ['host', 'Hook finished', 'The harness recorded a hook pipeline result. Reported success does not establish which callbacks ran or what effects they had.'],
  'permission.requested': ['host', 'Permission requested', 'The harness requested a permission decision before continuing an operation.'],
  'permission.completed': ['host', 'Permission decision recorded', 'The harness recorded a permission decision. See the evidence for the result and any recorded decision source.'],
  'session.compaction_start': ['host', 'Context compaction started', 'The harness began reducing conversation context to fit the available context window.'],
  'session.compaction_complete': ['host', 'Context compaction finished', 'The harness recorded a compaction result. This can change the context available to later turns.'],
  'session.error': ['host', 'Session error', 'The host reported an error.'],
  'session.info': ['host', 'Host information', 'The host recorded an informational message.'],
  'session.warning': ['host', 'Host warning', 'The host recorded a warning.'],
  'abort': ['host', 'Work interrupted', 'The host recorded an interruption.'],
}));

function clip(value, limit) {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= limit) return text;
  let prefix = text.slice(0, limit - 1);
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return prefix + '…';
}

// The same acceptance rule as project(), without serializing evidence.
function projectable(event) {
  return Boolean(event) && !event.checkpoint && typeof event.id === 'string' && event.id.length <= 256 && definitions.has(event.type);
}

// Retained order key: recorded time, with missing/invalid times last. Equal keys keep insertion order.
function retainedTime(timestamp) {
  const parsed = Date.parse(clip(timestamp, 80));
  return Number.isFinite(parsed) ? parsed : Infinity;
}

function project(event) {
  if (!projectable(event)) return null;
  const data = event.data && typeof event.data === 'object' ? event.data : {};
  const [category, label, general] = definitions.get(event.type);
  let title = label;
  let explanation = general;
  const detail = data.toolName ?? data.name ?? data.agentDisplayName ?? data.hookType;
  if (typeof detail === 'string' && detail) title += ` · ${clip(detail, 180)}`;
  if (event.type === 'assistant.turn_start' && typeof data.turnId === 'string') title += ` · ${clip(data.turnId, 80)}`;
  if (event.type === 'assistant.intent' && typeof data.intent === 'string') title += ` · ${clip(data.intent, 180)}`;
  if (event.type === 'skill.invoked') {
    const origins = {
      'user-invoked': 'The host records this skill as explicitly invoked by the user.',
      'agent-invoked': 'The host records this skill as invoked by the agent.',
      'context-load': 'The host records this skill as loaded into context.',
    };
    const origin = Object.hasOwn(origins, data.trigger) ? origins[data.trigger]
      : data.trigger ? 'The host supplied an unrecognized trigger; see the evidence.' : 'The invocation trigger was not recorded.';
    explanation += ` ${origin} The event does not record which instruction caused the choice.`;
  }
  let protectedContentOmitted = false;
  const evidence = JSON.stringify({ id: event.id, type: event.type, timestamp: event.timestamp,
    agentId: event.agentId, parentId: event.parentId, data }, (key, value) => {
    if (!['encryptedContent', 'reasoningOpaque'].includes(key)) return value;
    if (value !== undefined) protectedContentOmitted = true;
    return undefined;
  }, 2);
  const hostOutput = projectHostOutput(event);
  return {
    id: event.id, type: event.type, category, title, explanation,
    displayName: clip(detail, 180), model: clip(data.model, 180), trigger: clip(data.trigger, 80),
    preview: ['user.message', 'assistant.message', 'assistant.intent'].includes(event.type) ? clip(data.content ?? data.intent, 180) : '',
    timestamp: clip(event.timestamp, 80),
    agentId: event.agentId === undefined ? '' : identifier(event.agentId) || null,
    turnId: identifier(data.turnId), hookInvocationId: identifier(data.hookInvocationId),
    delivery: ['idle', 'steering', 'queued'].includes(data.delivery) ? data.delivery : '',
    interactionId: identifier(data.interactionId),
    toolCallId: identifier(data.toolCallId), toolName: clip(data.toolName, 180),
    success: typeof data.success === 'boolean' ? data.success : null,
    ...(hostOutput ? { hostOutput } : {}),
    evidence: clip(evidence, EVIDENCE_LIMIT), truncated: evidence.length > EVIDENCE_LIMIT, protectedContentOmitted,
  };
}

function identifier(value) {
  return typeof value === 'string' && value.length <= 256 ? value : '';
}

// Retained records ordered by (time, insertion). Each insert lands after equal times, then the
// oldest record is trimmed past `limit`, so the window always holds the `limit` greatest keys.
// Trimming advances `head` instead of shifting, so in-order appends stay O(log n) amortized.
function createWindow(limit) {
  let records = [], times = [], head = 0, ids = new Map(), trimmed = 0;
  return {
    has: id => ids.has(id),
    get size() { return records.length - head; },
    get trimmed() { return trimmed; },
    values: () => records.slice(head),
    insert(id, time, record) {
      let low = head, high = times.length;
      while (low < high) { const mid = (low + high) >>> 1; if (times[mid] <= time) low = mid + 1; else high = mid; }
      if (low === times.length) { records.push(record); times.push(time); } else { records.splice(low, 0, record); times.splice(low, 0, time); }
      ids.set(id, record);
      if (records.length - head > limit) {
        ids.delete(records[head].id); records[head] = undefined; head++; trimmed++;
        if (head > limit) { records = records.slice(head); times = times.slice(head); head = 0; }
      }
    },
    clear() { records = []; times = []; head = 0; ids = new Map(); },
  };
}

export function createTrace(session, diagnostics = { record() {} }) {
  let events = createWindow(LIMIT);
  let history = 'loading';
  let revision = 0;
  let omitted = 0;
  let liveReceipt = 0;
  let closed = false;
  let unsubscribe;
  let timer;
  let stopWaiting;
  let cached;
  function insert(entry, source) {
    if (!entry || events.has(entry.id)) return;
    if (source) {
      if (source === 'live' && history === 'ready') liveReceipt = Number.isSafeInteger(liveReceipt) && liveReceipt < Number.MAX_SAFE_INTEGER ? liveReceipt + 1 : null;
      entry = { ...entry, observation: { source, receipt: source === 'live' && history === 'ready' ? liveReceipt : null } };
    }
    // Ephemeral events are absent from history; merge by recorded time before trimming.
    const before = events.trimmed;
    events.insert(entry.id, retainedTime(entry.timestamp), entry);
    omitted += events.trimmed - before;
    revision++;
  }
  // History can hold a whole long-running chat. Select the retained window from cheap keys first and
  // serialize evidence only for survivors. project() is pure, so for JSON-RPC (JSON-safe) history the result
  // equals projecting every event; only a non-serializable older event could have made the old path fail.
  function hydrate(past) {
    const selection = createWindow(LIMIT), historyIds = new Set();
    let inserted = 0;
    for (const event of past) {
      if (event?.type === 'assistant.usage' || !projectable(event)) continue;
      historyIds.add(event.id);
      if (selection.has(event.id)) continue;
      selection.insert(event.id, retainedTime(event.timestamp), { id: event.id, event });
      inserted++;
    }
    events = createWindow(LIMIT);
    for (const { event } of selection.values()) {
      const entry = project(event);
      events.insert(entry.id, retainedTime(entry.timestamp), { ...entry, observation: { source: 'history', receipt: null } });
    }
    return { historyIds, inserted, trimmed: selection.trimmed };
  }
  let ready = Promise.resolve();
  if (typeof session?.on !== 'function' || typeof session?.getEvents !== 'function') {
    history = 'unsupported';
    diagnostics.record('observer_unsupported');
  } else {
    try {
      unsubscribe = session.on(event => { if (!closed) insert(project(event), 'live'); });
      diagnostics.record('observer_started');
      const timeout = new Promise((_, reject) => {
        stopWaiting = () => reject(new Error('History unavailable.'));
        timer = setTimeout(() => { diagnostics.record('history_timeout'); stopWaiting(); }, 10000);
        timer.unref?.();
      });
      ready = Promise.race([Promise.resolve().then(() => session.getEvents()), timeout]).then(past => {
        if (closed) return;
        if (!Array.isArray(past)) throw new Error('Invalid history.');
        const live = events.values();
        const liveOmitted = omitted;
        const { historyIds, inserted, trimmed } = hydrate(past);
        omitted = trimmed;
        revision += inserted;
        for (const entry of live) if (!historyIds.has(entry.id)) insert(entry);
        omitted = Math.max(omitted, liveOmitted);
        history = 'ready';
        diagnostics.record('history_ready', { count: events.size });
        revision++;
      }).catch(() => {
        if (!closed) { history = 'unavailable'; revision++; diagnostics.record('history_failed'); }
      }).finally(() => clearTimeout(timer));
    } catch {
      history = 'unsupported';
      diagnostics.record('observer_unsupported');
    }
  }
  return {
    ready,
    // Built once per revision; each caller receives its own top-level object and entry array.
    snapshot() {
      if (cached?.revision !== revision || cached.history !== history) cached = build();
      return { ...cached, entries: [...cached.entries] };
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      stopWaiting?.();
      unsubscribe?.();
      events.clear();
      cached = undefined;
    },
  };
  function build() {
    const tools = new Map();
    const entries = events.values().map(entry => {
      const key = JSON.stringify([entry.agentId, entry.toolCallId]);
      if (entry.type === 'tool.execution_start' && entry.toolCallId && entry.agentId !== null) tools.set(key, entry.toolName);
      if (entry.type !== 'tool.execution_complete') return entry;
      const toolName = entry.agentId !== null && entry.toolCallId ? tools.get(key) || '' : '';
      const name = toolName || 'name unavailable';
      const result = entry.success === false ? 'failed' : entry.success === true ? 'completed' : 'result recorded';
      return { ...entry, toolName, title: `Tool ${result} · ${name}` };
    });
    return { revision, history, omitted, limit: LIMIT, liveReceipt, entries };
  }
}
