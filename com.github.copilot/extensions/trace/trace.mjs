const LIMIT = 300;
const EVIDENCE_LIMIT = 12000;
const definitions = new Map(Object.entries({
  'user.message': ['chat', 'User message', 'The host recorded input from the user.'],
  'assistant.turn_start': ['turn', 'Model turn started', 'A model turn is one step in the agent loop. A chat request can involve several turns and tool calls.'],
  'assistant.turn_end': ['turn', 'Model turn ended', 'This model turn ended. More turns may follow before the chat request is finished.'],
  'assistant.intent': ['model', 'Reported activity', 'This is the activity description reported by the assistant, not an independently verified reason for a decision.'],
  'assistant.message': ['model', 'Assistant message', 'The host recorded an assistant response. It may also contain tool requests.'],
  'assistant.reasoning': ['model', 'Reported reasoning', 'This is reasoning text exposed by the host. It is not a complete account of internal decisions.'],
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

function project(event) {
  if (!event || event.checkpoint || typeof event.id !== 'string' || event.id.length > 256 || !definitions.has(event.type)) return null;
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
  const evidence = JSON.stringify({ id: event.id, type: event.type, timestamp: event.timestamp,
    agentId: event.agentId, parentId: event.parentId, data }, (key, value) =>
    ['encryptedContent', 'reasoningOpaque'].includes(key) ? undefined : value, 2);
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
    evidence: clip(evidence, EVIDENCE_LIMIT), truncated: evidence.length > EVIDENCE_LIMIT,
  };
}

function identifier(value) {
  return typeof value === 'string' && value.length <= 256 ? value : '';
}

export function createTrace(session, diagnostics = { record() {} }) {
  let events = new Map();
  let history = 'loading';
  let revision = 0;
  let omitted = 0;
  let closed = false;
  let unsubscribe;
  let timer;
  let stopWaiting;
  function insert(entry) {
    if (!entry || events.has(entry.id)) return;
    events.set(entry.id, entry);
    // Ephemeral events are absent from history; merge by recorded time before trimming.
    // Equal times keep insertion order. Missing/invalid times stay at the end.
    const time = entry => {
      const parsed = Date.parse(entry.timestamp);
      return Number.isFinite(parsed) ? parsed : Infinity;
    };
    events = new Map([...events].sort((a, b) => time(a[1]) - time(b[1])));
    if (events.size > LIMIT) { events.delete(events.keys().next().value); omitted++; }
    revision++;
  }
  let ready = Promise.resolve();
  if (typeof session?.on !== 'function' || typeof session?.getEvents !== 'function') {
    history = 'unsupported';
    diagnostics.record('observer_unsupported');
  } else {
    try {
      unsubscribe = session.on(event => { if (!closed) insert(project(event)); });
      diagnostics.record('observer_started');
      const timeout = new Promise((_, reject) => {
        stopWaiting = () => reject(new Error('History unavailable.'));
        timer = setTimeout(() => { diagnostics.record('history_timeout'); stopWaiting(); }, 10000);
        timer.unref?.();
      });
      ready = Promise.race([Promise.resolve().then(() => session.getEvents()), timeout]).then(past => {
        if (closed) return;
        if (!Array.isArray(past)) throw new Error('Invalid history.');
        const live = events;
        const liveOmitted = omitted;
        events = new Map();
        omitted = 0;
        const historyIds = new Set();
        for (const event of past) {
          const entry = project(event);
          if (entry) { historyIds.add(entry.id); insert(entry); }
        }
        for (const entry of live.values()) if (!historyIds.has(entry.id)) insert(entry);
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
    snapshot() {
      const tools = new Map();
      const entries = [...events.values()].map(entry => {
        const key = JSON.stringify([entry.agentId, entry.toolCallId]);
        if (entry.type === 'tool.execution_start' && entry.toolCallId && entry.agentId !== null) tools.set(key, entry.toolName);
        if (entry.type !== 'tool.execution_complete') return entry;
        const toolName = entry.agentId !== null && entry.toolCallId ? tools.get(key) || '' : '';
        const name = toolName || 'name unavailable';
        const result = entry.success === false ? 'failed' : entry.success === true ? 'completed' : 'result recorded';
        return { ...entry, toolName, title: `Tool ${result} · ${name}` };
      });
      return { revision, history, omitted, limit: LIMIT, entries };
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      stopWaiting?.();
      unsubscribe?.();
      events.clear();
    },
  };
}
