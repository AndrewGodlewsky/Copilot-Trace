const actorRoles = new Map(Object.entries({
  'user.message': 'User',
  'assistant.turn_start': 'Assistant',
  'assistant.turn_end': 'Assistant',
  'assistant.intent': 'Assistant',
  'assistant.message': 'Assistant',
  'assistant.reasoning': 'Assistant',
  'tool.execution_start': 'Tool',
  'tool.execution_complete': 'Tool',
  'hook.start': 'Hook system',
  'hook.end': 'Hook system',
  'permission.requested': 'Permission system',
  'permission.completed': 'Permission system',
  'skill.invoked': 'Instruction loading',
  'subagent.started': 'Host',
  'subagent.completed': 'Host',
  'subagent.failed': 'Host',
  'session.compaction_start': 'Host',
  'session.compaction_complete': 'Host',
  'session.error': 'Host',
  'session.info': 'Host',
  'session.warning': 'Host',
  'abort': 'Host',
}));

export const filterLabels = Object.freeze({
  everything: 'Everything', tools: 'Tools', automation: 'Skills and hooks', problems: 'Problems',
});

export function matchesFilter(entry, filter) {
  if (filter === 'tools') return entry.type === 'tool.execution_start' || entry.type === 'tool.execution_complete';
  if (filter === 'automation') return ['skill.invoked', 'hook.start', 'hook.end'].includes(entry.type);
  if (filter === 'problems') return ['session.error', 'session.warning', 'abort', 'subagent.failed'].includes(entry.type)
    || (['tool.execution_complete', 'hook.end'].includes(entry.type) && entry.success === false);
  return true;
}

export const navigationLabels = Object.freeze({
  failure: 'failure', permission: 'permission request', skill: 'skill load', result: 'tool result',
});

export function latestRetainedEvent(entries, category) {
  if (!Object.hasOwn(navigationLabels, category)) return null;
  return entries.findLast(entry => {
    if (typeof entry.id !== 'string' || !entry.id.length || entry.id.length > 256) return false;
    if (category === 'failure') return ['session.error', 'subagent.failed'].includes(entry.type)
      || (['tool.execution_complete', 'hook.end'].includes(entry.type) && entry.success === false);
    if (category === 'permission') return entry.type === 'permission.requested';
    if (category === 'skill') return entry.type === 'skill.invoked';
    return entry.type === 'tool.execution_complete';
  }) || null;
}

export function describeActor(entry) {
  const id = entry.agentId;
  const source = typeof id !== 'string' || id.length > 256 ? 'Source unavailable'
    : id === '' ? 'Main chat' : `Agent ${id}`;
  return { role: actorRoles.get(entry.type) || 'Actor unknown', source };
}

const stepLessons = new Map(Object.entries({
  'user.message': ['The host recorded user input.',
    'Input supplies a request or context; the event is a record of delivery, not a response.',
    'This event does not show whether the assistant read, acted on or correctly answered the input.'],
  'assistant.turn_start': ['The host recorded a model turn starting.',
    'A turn is one iteration of the agent loop; a request can involve several turns.',
    'The end, outcome and reason for this iteration are not established by its start.'],
  'assistant.turn_end': ['The host recorded a model turn ending.',
    'This iteration ended; more turns or tool calls may follow.',
    'A turn ending does not establish that the user’s task is finished or correct.'],
  'assistant.intent': ['The host recorded an assistant’s reported activity.',
    'The activity text is an assistant statement about its work.',
    'This is not an independently verified reason for a choice or a complete account of internal decisions.'],
  'assistant.message': ['The host recorded an assistant message.',
    'This is a reported response; its evidence may also contain tool requests.',
    'The event alone does not verify the response’s claims, correctness or reasons.'],
  'assistant.reasoning': ['The host recorded exposed reasoning text.',
    'This is text the host exposed as reasoning, not a complete view of the model’s internal process.',
    'Unrecorded internal decisions and independently verified reasons remain unknown.'],
  'tool.execution_start': ['The runtime recorded a tool invocation starting.',
    'Arguments describe a requested operation. This start does not prove the operation executed; permission may still be required.',
    'The result and reason for choosing this tool are not established here. A missing result does not mean it is still running.'],
  'tool.execution_complete': ['The runtime recorded a tool result.',
    'The reported outcome is unavailable; a result event alone does not establish success.',
    'A tool result does not establish that the user’s task is correct or complete. Missing boundaries leave the call record partial.'],
  'skill.invoked': ['The host recorded a skill being loaded.',
    'A skill supplies instructions or context. The recorded trigger is unavailable or unrecognized.',
    'Loading does not prove the instructions were followed or that a referenced script or command ran. The selection reason remains unknown; skill metadata does not establish tool approval.'],
  'subagent.started': ['The host recorded a delegated agent starting.',
    'Delegation gives another agent a piece of work; the event records its start.',
    'The outcome is not established here. A missing outcome does not mean the agent is still running.'],
  'subagent.completed': ['The host recorded a delegated agent outcome.',
    'Cancellation status is unavailable; the event type alone does not distinguish completion from cancellation.',
    'This event does not independently verify that the delegated task is correct or that the overall task is complete.'],
  'subagent.failed': ['The host reported a delegated agent failure.',
    'This is a failure report for delegated work; the evidence may provide a recorded error.',
    'The root cause, recovery and effect on the overall task are not established by this event alone.'],
  'hook.start': ['The harness recorded a hook pipeline starting.',
    'Hooks attach automation to lifecycle points. A pipeline record does not prove a configured handler ran.',
    'This start does not establish the result, what changed or why the assistant chose a related operation. A missing end does not mean it is still running.'],
  'hook.end': ['The harness recorded a hook result.',
    'The reported outcome is unavailable; a result event alone does not establish success.',
    'A hook result does not verify the user’s task or prove which later actions it affected.'],
  'permission.requested': ['The harness requested a permission decision.',
    'A permission request asks whether an operation may proceed; it is not approval or proof of execution.',
    'The decision and who or what will make it are not established by the request.'],
  'permission.completed': ['The harness recorded a permission decision.',
    'The recorded decision result is unavailable or unrecognized.',
    'The decision source is unavailable; the result kind alone does not identify a person.'],
  'session.compaction_start': ['The harness recorded context compaction starting.',
    'Compaction attempts to reduce conversation context for later turns.',
    'This start does not establish success or which information later turns will receive.'],
  'session.compaction_complete': ['The harness recorded a context compaction result.',
    'The reported outcome is unavailable; the event type alone does not establish successful compaction.',
    'This result does not by itself establish the exact context or behavior of later turns.'],
  'session.error': ['The host reported a session error.',
    'An error records a problem the host reported; its literal text remains available in evidence.',
    'The root cause, recovery and effect on the user’s task are not established by this event alone.'],
  'session.info': ['The host recorded an informational message.',
    'This is a host notice, not an assistant action or a task outcome.',
    'The notice alone does not establish what caused later activity or whether the task succeeded.'],
  'session.warning': ['The host recorded a warning.',
    'A warning flags a concern reported by the host; it is not by itself a failed task.',
    'The cause, impact and any recovery are not established by this event alone.'],
  'abort': ['The host recorded an interruption.',
    'Work was interrupted; this event is distinct from a successful result.',
    'The initiator, cause and whether other work continued are not established by the event type alone.'],
}));

export function explanationData(entry) {
  if (entry.truncated || typeof entry.id !== 'string' || !entry.id || entry.id.length > 256
    || typeof entry.evidence !== 'string' || entry.evidence.length > 12000) return null;
  let event;
  try { event = JSON.parse(entry.evidence); } catch { return null; }
  const agent = event?.agentId === undefined ? ''
    : typeof event.agentId === 'string' && event.agentId.length > 0 && event.agentId.length <= 256 ? event.agentId : null;
  const data = event?.data;
  return event?.id === entry.id && event.type === entry.type && agent !== null && agent === entry.agentId
    && (event.timestamp ?? '') === entry.timestamp && data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

function skillData(entry) {
  const data = explanationData(entry);
  return data && shortTitle(typeof data.name === 'string' ? data.name : '') === entry.displayName
    && shortTitle(typeof data.trigger === 'string' ? data.trigger : '', 80) === entry.trigger ? data : null;
}

const skillTriggers = new Map(Object.entries({
  'user-invoked': 'The host attributes this load to an explicit user action, such as a slash command or UI action.',
  'agent-invoked': 'The host reports that the agent requested this skill.',
  'context-load': 'The host reports loading the skill as part of another context, such as a custom agent or subagent configuration.',
}));

export function skillInstructions(entry = {}) {
  if (entry.type !== 'skill.invoked') return null;
  const data = skillData(entry);
  const content = typeof data?.content === 'string' ? data.content : null;
  const trigger = typeof data?.trigger === 'string' ? data.trigger : null;
  let preview = content === null ? null : content.slice(0, 600);
  if (preview?.length < content?.length && /[\uD800-\uDBFF]$/.test(preview)) preview = preview.slice(0, -1);
  const previewTruncated = content !== null && preview.length < content.length;
  return {
    name: typeof data?.name === 'string' ? data.name : null,
    trigger,
    triggerExplanation: skillTriggers.get(trigger) || (trigger === null ? 'Trigger unknown: not recorded or unavailable in complete matching evidence.'
      : trigger === '' ? 'Trigger unknown: the recorded field is empty.' : 'Trigger unknown: this recorded value is unrecognized.'),
    status: content === null ? 'unavailable' : content === '' ? 'empty' : 'complete',
    content, preview, previewTruncated,
    arguments: typeof data?.arguments === 'string' ? data.arguments : null,
    note: !data ? entry.truncated
      ? 'Instructions unavailable: this panel shortened the event evidence to 12,000 characters and cannot recover the complete instruction body.'
      : 'Instructions unavailable: complete matching event evidence is not retained.'
      : content === null ? 'Instructions unavailable: the host did not record a text instruction body.'
      : content === '' ? 'The host recorded an empty instruction body.'
      : previewTruncated ? 'Preview shortened. Expand Exact retained instructions for the complete retained text.'
      : 'Complete instruction body retained.',
  };
}

export function explainStep(entry = {}) {
  const lesson = stepLessons.get(entry.type);
  if (!lesson) return {
    happened: 'An unrecognized event type was recorded.',
    means: 'An explanation for this event type is unavailable. Inspect its literal evidence when available.',
    unknown: 'Its meaning, outcome and reason are unknown; no behavior is inferred from its name.',
    general: 'No general definition is available for this event type.',
  };
  let [happened, means, unknown] = lesson;
  const data = explanationData(entry);
  if (['tool.execution_complete', 'hook.end', 'session.compaction_complete'].includes(entry.type)
    && typeof data?.success === 'boolean' && data.success === entry.success) {
    means = `The recorded success field reports ${data.success ? 'success' : 'failure'} for this operation. It is a reported outcome, not an independent check.`;
  }
  if (entry.type === 'subagent.completed' && typeof data?.cancelled === 'boolean') {
    means = data.cancelled ? 'The recorded cancelled field reports cancellation of the delegated work.'
      : 'The recorded cancelled field reports completion without cancellation; this is not a check of the result’s correctness.';
  }
  if (entry.type === 'skill.invoked') {
    const skill = skillInstructions(entry);
    means = `A skill supplies instructions or context. ${skillTriggers.has(skill.trigger)
      ? `The recorded trigger is ${skill.trigger}. ` : ''}${skill.triggerExplanation}`;
  }
  if (entry.type === 'user.message' && ['idle', 'steering', 'queued'].includes(data?.delivery) && data.delivery === entry.delivery) {
    means = `The recorded delivery is ${data.delivery}. ` + {
      idle: 'Idle input starts a request while no run is in flight.',
      steering: 'Steering input is delivered into an existing run.',
      queued: 'Queued input is scheduled for a later run.',
    }[data.delivery];
  }
  if (entry.type === 'permission.completed') {
    const kind = data?.result && typeof data.result === 'object' && !Array.isArray(data.result) ? data.result.kind : null;
    if (permissionApprovals.has(kind)) {
      means = `The recorded decision kind is ${kind}. Approval permits an operation; it does not prove it executed.`;
    } else if (permissionDenials.has(kind) || kind === 'cancelled') {
      means = `The recorded decision kind is ${kind}. This records a refusal or cancellation, not a successful operation.`;
    }
    if (decisionSources.has(data?.decisionSource)) {
      unknown = `Recorded decision source: ${data.decisionSource}. This attribution does not independently prove that a person interacted or that the operation executed.`;
    }
  }
  if (!data) unknown += ' Complete, matching event data is unavailable; only the recorded event type is described.';
  return { happened, means, unknown,
    general: typeof entry.explanation === 'string' && entry.explanation ? entry.explanation : 'No further general definition is available.' };
}

function toolIdentity(entry) {
  return typeof entry.agentId === 'string' && entry.agentId.length <= 256
    && typeof entry.toolCallId === 'string' && entry.toolCallId.length > 0 && entry.toolCallId.length <= 256
    ? JSON.stringify([entry.agentId, entry.toolCallId]) : null;
}

function hookIdentity(entry) {
  return typeof entry.agentId === 'string' && entry.agentId.length <= 256
    && typeof entry.hookInvocationId === 'string' && entry.hookInvocationId.length > 0 && entry.hookInvocationId.length <= 256
    ? JSON.stringify([entry.agentId, entry.hookInvocationId]) : null;
}

const hookTiming = new Map(Object.entries({
  preToolUse: 'Before a tool is executed; one pipeline may cover several tool requests.',
  preMcpToolCall: 'Before an MCP tool is called.',
  postToolUse: 'After a tool returns a successful result; other result kinds use different lifecycle paths.',
  postToolUseFailure: 'After a tool result of type failure; rejected, denied and timeout results do not trigger this hook.',
  userPromptSubmitted: 'When the user submits a prompt.',
  userPromptTransformed: 'After the runtime transforms a submitted prompt, before it is stored or sent to the model.',
  sessionStart: 'When a session starts, including startup, resume or a new session.',
  sessionEnd: 'When a session ends.',
  errorOccurred: 'When an error occurs.',
  agentStop: 'When the main agent reaches a natural terminal stop without pending work, excluding aborts and rejected-tool stops.',
  subagentStart: 'Before a subagent’s first turn.',
  subagentStop: 'After a subagent completes a turn.',
}));

function hookData(entry) {
  const data = explanationData(entry);
  return hookIdentity(entry) !== null && data?.hookInvocationId === entry.hookInvocationId
    && typeof data.hookType === 'string' && data.hookType.length > 0 && shortTitle(data.hookType) === entry.displayName
    ? data : null;
}

// Pipeline identities span retained groups; original boundary rows always keep their recorded order.
export function hookInvocations(entries) {
  const invocations = new Map();
  for (const entry of entries) {
    if (!['hook.start', 'hook.end'].includes(entry.type)) continue;
    const identity = hookIdentity(entry);
    const id = identity === null ? `unlinked-hook:${entry.id}` : `hook:${identity}`;
    if (!invocations.has(id)) invocations.set(id, { id, linked: identity !== null,
      agentId: entry.agentId, hookInvocationId: identity === null ? null : entry.hookInvocationId, entries: [] });
    invocations.get(id).entries.push(entry);
  }
  for (const call of invocations.values()) {
    const starts = call.entries.filter(entry => entry.type === 'hook.start');
    const ends = call.entries.filter(entry => entry.type === 'hook.end');
    const records = call.entries.map(hookData);
    const types = [...new Set(call.entries.map((entry, index) => records[index]?.hookType || entry.displayName).filter(Boolean))];
    call.hookType = types.length === 1 ? types[0] : null;
    call.title = call.hookType || (types.length > 1 ? 'Conflicting hook types' : 'Hook type unavailable');
    call.timing = hookTiming.get(call.hookType) || 'Timing unknown for this hook type; no lifecycle is inferred from its name.';
    call.notes = [];
    call.status = starts.length && ends.length ? 'paired' : starts.length ? 'start-only' : 'end-only';
    if (!call.linked) {
      call.status = 'unlinked';
      call.notes.push('Source or invocation ID unavailable; this boundary is unlinked and excluded from invocation totals.');
    } else if (starts.length > 1 || ends.length > 1 || types.length > 1
      || (starts.length && ends.length && call.entries.indexOf(ends[0]) < call.entries.indexOf(starts[0]))) {
      call.status = 'conflict';
      call.notes.push('Duplicate boundaries, conflicting hook types or an end before its start make the invocation outcome unknown. Inspect the original events.');
    }
    if (!starts.length) call.notes.push('Start boundary not retained; this invocation is partial.');
    if (!ends.length) call.notes.push('End boundary not retained; the outcome is unknown. This does not mean it is still running.');
    if (records.some(data => !data)) call.notes.push('Complete matching evidence is unavailable for one or more boundaries.');
    call.notes.push('Whether a configured handler ran is unknown from pipeline events alone. One pipeline can include multiple callbacks; counts are not scripts. Timing does not explain why the assistant chose a related operation.');
    const end = call.status !== 'conflict' && call.linked && ends.length === 1 ? ends[0] : null;
    const data = end ? hookData(end) : null;
    call.outcome = typeof data?.success === 'boolean' && data.success === end.success ? data.success ? 'success' : 'failure' : 'unknown';
    call.output = data && Object.hasOwn(data, 'output') ? JSON.stringify(data.output, null, 2) : null;
    call.error = data?.error && typeof data.error === 'object' && !Array.isArray(data.error) && typeof data.error.message === 'string'
      ? JSON.stringify(data.error, null, 2) : null;
    call.reported = [];
    const output = data?.output;
    if (!output || typeof output !== 'object' || Array.isArray(output)) continue;
    const add = (field, label) => call.reported.push({ field, label, value: output[field] });
    if (['preToolUse', 'postToolUse', 'postToolUseFailure', 'userPromptSubmitted', 'sessionStart', 'subagentStart'].includes(call.hookType)
      && typeof output.additionalContext === 'string') add('additionalContext', 'Supplied context (additionalContext)');
    if (call.hookType === 'preToolUse' && ['allow', 'deny', 'ask'].includes(output.permissionDecision)) {
      add('permissionDecision', 'Recorded permission decision request');
    }
    if ((['userPromptSubmitted', 'agentStop'].includes(call.hookType) && output.decision === 'block')
      || (call.hookType === 'subagentStop' && ((output.decision === 'allow' && output.reason === undefined)
        || (output.decision === 'block' && typeof output.reason === 'string' && output.reason.trim())))) {
      add('decision', call.hookType === 'userPromptSubmitted' ? 'Recorded prompt decision request' : 'Recorded stop decision request');
    }
    if (call.hookType === 'errorOccurred' && ['retry', 'skip', 'abort'].includes(output.errorHandling)) {
      add('errorHandling', 'Recorded error-handling request');
    }
  }
  return [...invocations.values()];
}

export function groupSteps(entries, chronological = false) {
  if (chronological) return entries.map(entry => ({ id: `event:${entry.id}`, kind: 'event', entries: [entry] }));
  const sections = [];
  const tools = new Map();
  for (const [index, entry] of entries.entries()) {
    if (entry.type === 'tool.execution_start' || entry.type === 'tool.execution_complete') {
      const key = toolIdentity(entry);
      if (key !== null && tools.has(key)) tools.get(key).entries.push(entry);
      else {
        const section = { id: key === null ? `unlinked-tool:${entry.id}` : `tool:${key}`, kind: 'tool', entries: [entry] };
        sections.push(section);
        if (key !== null) tools.set(key, section);
      }
      continue;
    }
    const hook = entry.type === 'hook.start' || entry.type === 'hook.end';
    const previous = sections.at(-1);
    if (hook && typeof entry.agentId === 'string' && entry.agentId.length <= 256
      && previous?.kind === 'hooks' && previous.entries.at(-1) === entries[index - 1]
      && previous.entries[0].agentId === entry.agentId) {
      previous.entries.push(entry);
    } else {
      sections.push({ id: `${hook ? 'hooks' : 'event'}:${entry.id}`, kind: hook ? 'hooks' : 'event', entries: [entry] });
    }
  }
  return sections;
}

// Chapters describe retained time intervals, not causal ownership or request completion.
export function requestChapters(entries, { history = 'ready', omitted = 0 } = {}) {
  const usableId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const inputCounts = new Map();
  for (const entry of entries) {
    if ((entry.agentId === '' || !usableId(entry.agentId)) && entry.type === 'user.message' && usableId(entry.interactionId)) {
      inputCounts.set(entry.interactionId, (inputCounts.get(entry.interactionId) || 0) + 1);
    }
  }
  const chapters = [], queued = new Map(), seenInteractions = new Set(), linkedInputs = new Set();
  let current;
  function begin(entry, boundary = 'unknown', prompt = null) {
    current = { id: `chapter:${entry.id}`, boundary, prompt, entries: [], notes: [],
      partial: chapters.length === 0 && (boundary === 'unknown' || history !== 'ready' || omitted > 0) };
    if (boundary === 'unknown') current.notes.push('Request boundary unknown; attribution unavailable.');
    if (boundary === 'idle') current.notes.push('Idle input begins this interval.');
    if (boundary === 'queued') current.notes.push('Queued interaction starts here; preview refers to an earlier input record.');
    chapters.push(current);
  }
  for (const entry of entries) {
    const root = entry.agentId === '';
    if (root && entry.type === 'user.message' && entry.delivery === 'idle') begin(entry, 'idle', entry);
    if (root && entry.type === 'assistant.turn_start' && usableId(entry.interactionId)) {
      const prompt = queued.get(entry.interactionId);
      if (prompt && !seenInteractions.has(entry.interactionId)) {
        begin(entry, 'queued', prompt);
        linkedInputs.add(prompt.id);
        queued.delete(entry.interactionId);
      }
      seenInteractions.add(entry.interactionId);
    }
    if (!current) begin(entry);
    current.entries.push(entry);
    if (root && entry.type === 'user.message' && entry.delivery === 'queued'
      && inputCounts.get(entry.interactionId) === 1 && !seenInteractions.has(entry.interactionId)) {
      queued.set(entry.interactionId, entry);
    }
    if (entry.type === 'abort' && (root || entry.agentId === null)) {
      current.notes.push('Interruption recorded; request outcome unknown.');
      current = null;
    }
  }
  for (const chapter of chapters) {
    const notes = new Set(chapter.notes);
    for (const entry of chapter.entries) {
      if (entry.type === 'user.message') {
        if (entry.delivery === 'steering') notes.add('Steering input remains within this interval.');
        if (entry.agentId === '' && entry.delivery === 'queued') notes.add(linkedInputs.has(entry.id)
          ? 'Queued input stays here in event order; its interaction begins in a later chapter.'
          : 'Queued input retained here; its own interaction start is not linked in this window.');
        if (entry.agentId === null || (entry.agentId === '' && !['idle', 'steering', 'queued'].includes(entry.delivery))) {
          notes.add('Input delivery or source unavailable; later request boundaries may be unknown.');
        }
      }
      if (entry.type === 'assistant.turn_start' && entry.agentId === '' && !usableId(entry.interactionId)) {
        notes.add('Interaction linkage unavailable; interval only.');
      }
    }
    chapter.notes = [...notes];
    chapter.stats = summarize(chapter.entries);
  }
  return chapters;
}

function timestampMilliseconds(value) {
  if (typeof value !== 'string') return NaN;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return NaN;
  const [year, month, day, hour, minute, second, offsetHour, offsetMinute] = parts.slice(1).map(part => Number(part || 0));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]
    || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return NaN;
  return Date.parse(value);
}

// Lane membership is source identity; bars describe recorded intervals, not continuous execution.
export function agentLanes(entries, { history = 'ready', omitted = 0 } = {}) {
  const usableId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const source = entry => typeof entry.agentId === 'string' && entry.agentId.length <= 256 ? entry.agentId : null;
  const bySource = new Map();
  for (const entry of entries) {
    const agent = source(entry);
    if (!bySource.has(agent)) bySource.set(agent, { id: `lane:${JSON.stringify(agent)}`, agentId: agent, entries: [],
      title: agent === null ? 'Source unavailable' : agent === '' ? 'Main chat' : `Agent ${agent}`,
      intervals: [], parentId: null, links: [] });
    bySource.get(agent).entries.push(entry);
  }
  const lanes = [...bySource.values()].sort((a, b) => (a.agentId === '' ? -1 : a.agentId === null ? 1 : 0)
    - (b.agentId === '' ? -1 : b.agentId === null ? 1 : 0));
  function interval(start, end, records) {
    const from = timestampMilliseconds(start.timestamp), to = timestampMilliseconds(end.timestamp);
    const times = records.map(entry => timestampMilliseconds(entry.timestamp));
    if (!(to > from) || records.indexOf(start) >= records.indexOf(end)
      || times.some((time, i) => !Number.isFinite(time) || time < from || time > to || (i > 0 && time < times[i - 1]))) return null;
    return { start: from, end: to, startId: start.id, endId: end.id };
  }
  for (const lane of lanes) {
    if (lane.agentId === null) {
      lane.status = 'Unknown identity; these records are not assigned to one agent';
    } else if (lane.agentId === '') {
      lane.status = 'Recorded model-turn intervals; whole-run boundaries unavailable';
      let active = null;
      for (const entry of entries) {
        if (entry.type === 'abort' && (source(entry) === '' || source(entry) === null)) active = null;
        if (source(entry) !== '') continue;
        if (entry.type === 'user.message' && !['steering', 'queued'].includes(entry.delivery)) active = null;
        if (entry.type === 'assistant.turn_start') active = usableId(entry.turnId) ? [entry] : null;
        else if (active) {
          active.push(entry);
          if (entry.type === 'assistant.turn_end') {
            const observed = entry.turnId === active[0].turnId ? interval(active[0], entry, active) : null;
            if (observed) lane.intervals.push(observed);
            active = null;
          }
        }
      }
      for (const observed of lane.intervals) lane.links.push(
        { id: observed.startId, label: 'Turn start evidence' }, { id: observed.endId, label: 'Turn end evidence' });
    } else {
      const starts = lane.entries.filter(entry => entry.type === 'subagent.started');
      const ends = lane.entries.filter(entry => ['subagent.completed', 'subagent.failed'].includes(entry.type));
      const boundaries = [...starts, ...ends];
      const records = boundaries.map(recordedLaneData);
      const callIds = records.map(data => data?.toolCallId);
      const linked = boundaries.length > 0 && records.every(Boolean) && callIds.every(usableId)
        && callIds.every(id => id === callIds[0]);
      const conflicting = starts.length > 1 || ends.length > 1 || !linked;
      const end = ends[0], data = end && recordedLaneData(end);
      lane.status = conflicting ? 'Conflicting or unavailable boundaries · Outcome unknown'
        : !end ? 'Completion not observed'
          : end.type === 'subagent.failed' ? 'Failed'
            : data.cancelled === true ? 'Cancelled'
              : data.cancelled === undefined || data.cancelled === false ? 'Completed · Task success not established' : 'Outcome unknown';
      if (!starts.length) lane.status += ' · Start unavailable';
      const names = [...new Set(records.map(data => data?.agentDisplayName).filter(name => typeof name === 'string' && name.length))];
      if (names.length === 1) lane.title = `${shortTitle(names[0])} · Agent ${lane.agentId}`;
      if (!conflicting && starts.length === 1 && ends.length === 1) {
        const observed = interval(starts[0], end, lane.entries);
        if (observed) lane.intervals.push(observed);
      }
      for (const entry of boundaries) lane.links.push({ id: entry.id,
        label: entry.type === 'subagent.started' ? 'Agent start evidence' : 'Agent outcome evidence' });
      if (!conflicting) {
        const calls = entries.filter(entry => ['tool.execution_start', 'tool.execution_complete'].includes(entry.type)
          && entry.toolCallId === callIds[0]);
        const toolStarts = calls.filter(entry => entry.type === 'tool.execution_start');
        const parent = toolStarts[0];
        if (toolStarts.length === 1 && source(parent) !== null && source(parent) !== lane.agentId
          && calls.every(entry => source(entry) === source(parent))
          && recordedLaneData(parent)?.toolCallId === callIds[0]) lane.parentId = parent.id;
      }
    }
    lane.timing = lane.intervals.length ? `${lane.intervals.length} observed ${lane.agentId === '' ? 'turn' : 'agent'} interval${lane.intervals.length === 1 ? '' : 's'}`
      : 'Timing unknown · Missing, conflicting or unreliable boundaries';
  }
  const intervals = lanes.flatMap(lane => lane.intervals);
  const scale = intervals.length ? { start: Math.min(...intervals.map(item => item.start)), end: Math.max(...intervals.map(item => item.end)) } : null;
  let overlaps = 0;
  for (let i = 0; i < lanes.length; i++) for (let j = i + 1; j < lanes.length; j++) {
    if (lanes[i].intervals.some(a => lanes[j].intervals.some(b => Math.min(a.end, b.end) > Math.max(a.start, b.start)))) overlaps++;
  }
  return { lanes, scale, overlaps, note: `${overlaps} pairs of lanes have positive recorded overlap. Bars share one timestamp scale; they do not establish continuous execution. Wall time covers the observed span; the sum of overlapping intervals can be larger. Missing, equal or reversed boundaries have unknown timing. Only retained events are shown; absence of a bar does not establish inactivity.${history !== 'ready' ? ' History is incomplete or unavailable.' : ''}${omitted ? ' Older events were omitted.' : ''}` };
}

function recordedLaneData(entry) {
  if (entry.truncated || typeof entry.id !== 'string' || !entry.id || entry.id.length > 256
    || typeof entry.evidence !== 'string' || entry.evidence.length > 12000) return null;
  let event;
  try { event = JSON.parse(entry.evidence); } catch { return null; }
  const agent = event?.agentId === undefined ? ''
    : typeof event.agentId === 'string' && event.agentId.length > 0 && event.agentId.length <= 256 ? event.agentId : null;
  const data = event?.data;
  return event?.id === entry.id && event.type === entry.type && event.timestamp === entry.timestamp && agent === entry.agentId
    && data && typeof data === 'object' && !Array.isArray(data) && data.toolCallId === entry.toolCallId ? data : null;
}

export function describeToolGroup(entries, operation = toolOperations(entries).get(entries[0]?.id)) {
  const starts = entries.filter(entry => entry.type === 'tool.execution_start');
  const ends = entries.filter(entry => entry.type === 'tool.execution_complete');
  const conflicting = starts.length > 1 || ends.length > 1;
  const linked = toolIdentity(entries[0]) !== null;
  const start = starts[0], end = ends[0];
  const source = describeActor(entries[0]).source;
  let status = conflicting ? 'Conflicting boundaries · Outcome unknown'
    : end ? end.success === false ? 'Failed' : end.success === true ? 'Completed' : 'Result recorded'
      : 'Completion not observed';
  if (!start) status += ' · Start unavailable';
  if (!linked) status += ' · IDs unavailable; not paired';
  const elapsed = linked && !conflicting && start && end
    ? timestampMilliseconds(end.timestamp) - timestampMilliseconds(start.timestamp) : NaN;
  const timing = Number.isFinite(elapsed) && elapsed >= 0 ? `${elapsed / 1000} s elapsed` : 'Elapsed unknown';
  return { kind: 'Tool', title: conflicting ? 'Tool call with conflicting boundaries' : describeStep(start || end, operation).title,
    subtitle: `${source} · ${status} · ${timing}`, tone: !conflicting && end?.success === false ? 'error' : 'tool' };
}

const identityText = (value, limit = 256) => typeof value === 'string' && value.trim().length > 0 && value.length <= limit;
const mcpFields = ['mcpConfigServerName', 'mcpServerName', 'mcpToolName', 'mcpServerDisplayName', 'mcpConfigSource', 'mcpTransport'];

function validMcpMetadata(data) {
  return identityText(data.mcpToolName) && (identityText(data.mcpConfigServerName) || identityText(data.mcpServerName))
    && mcpFields.slice(0, 4).every(field => data[field] === undefined || identityText(data[field], field === 'mcpServerDisplayName' ? 180 : 256))
    && (data.mcpConfigSource === undefined || ['user', 'workspace', 'plugin', 'builtin', 'managed', 'account'].includes(data.mcpConfigSource))
    && (data.mcpTransport === undefined || ['stdio', 'http', 'sse', 'memory'].includes(data.mcpTransport));
}

export function toolBuckets(entries) {
  return groupSteps(entries).filter(section => section.kind === 'tool').map(section => {
    const boundaries = section.entries;
    const starts = boundaries.filter(entry => entry.type === 'tool.execution_start');
    const ends = boundaries.filter(entry => entry.type === 'tool.execution_complete');
    const start = starts[0], key = toolIdentity(boundaries[0]);
    const data = start && explanationData(start);
    const matched = key !== null && starts.length === 1 && ends.length <= 1 && boundaries.every(entry => {
      const record = entry === start ? data : explanationData(entry);
      return toolIdentity(entry) === key && record?.toolCallId === entry.toolCallId
        && (record.toolName === undefined || record.toolName === start.toolName)
        && (entry === start || entry.toolName === '' || entry.toolName === start.toolName);
    }) && identityText(data?.toolName, 180) && data.toolName === start.toolName;
    return { boundaries, start, data: matched ? data : null };
  });
}

// Invocation evidence is historical; a current inventory cannot establish a past tool's origin.
export function toolProvenance(entries) {
  const result = new Map();
  for (const { boundaries, start, data } of toolBuckets(entries)) {
    let description = {
      origin: 'Unknown', label: 'Origin: Unknown', provider: null, serverKey: null, serverName: null,
      toolName: null, modelToolName: null, configSource: null, transport: null, basisId: null,
      basis: data ? 'This invocation has no supported, complete MCP origin metadata.'
        : 'A unique invocation with complete, matching source and call evidence is unavailable.',
      uncertainty: 'Native built-in and plugin origins are unknown without a verified host discriminator. Names, titles and absent MCP fields do not establish origin.',
    };
    if (data && validMcpMetadata(data)) {
      const provider = data.mcpServerDisplayName ?? null;
      const serverKey = data.mcpConfigServerName ?? null;
      description = {
        origin: 'MCP', label: `Origin: MCP${provider ? ` · ${provider}` : ''}`, provider, serverKey,
        serverName: data.mcpServerName ?? null, toolName: data.mcpToolName, modelToolName: data.toolName,
        configSource: data.mcpConfigSource ?? null, transport: data.mcpTransport ?? null, basisId: start.id,
        basis: 'Recorded tool.execution_start fields mcpConfigServerName or mcpServerName, plus mcpToolName, matched to this retained source and tool-call ID. A paired result uses this invocation’s metadata.',
        uncertainty: 'MCP origin does not prove a network request, safety, authorization or successful effects. Configuration source describes the MCP configuration, not native built-in or plugin tool origin.'
          + (serverKey ? '' : ' Legacy mcpServerName may be a display name; an exact configured server key is unknown.'),
      };
    }
    for (const entry of boundaries) result.set(entry.id, description);
  }
  return result;
}

const argumentString = value => typeof value === 'string';
const argumentText = value => argumentString(value) && value.length > 0;
const argumentBoolean = value => typeof value === 'boolean';
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const argumentPaths = value => argumentText(value) || (Array.isArray(value) && value.length > 0 && value.every(argumentText));
const operationContracts = new Map(Object.entries({
  view: { required: ['path'], fields: { path: argumentText, forceReadLargeFiles: argumentBoolean,
    view_range: value => Array.isArray(value) && value.length === 2 && value.every(Number.isSafeInteger)
      && value[0] >= 1 && (value[1] === -1 || value[1] >= value[0]) }, categories: ['Read'], title: args => `View ${args.path}` },
  grep: { required: ['pattern'], fields: { pattern: argumentText, paths: argumentPaths, glob: argumentString, type: argumentString,
    output_mode: value => ['content', 'files_with_matches', 'count'].includes(value), '-i': argumentBoolean,
    '-A': nonnegativeInteger, '-B': nonnegativeInteger, '-C': nonnegativeInteger, '-n': argumentBoolean,
    head_limit: nonnegativeInteger, multiline: argumentBoolean }, categories: ['Search'], title: args => `Search for pattern “${args.pattern}”` },
  glob: { required: ['pattern'], fields: { pattern: argumentText, paths: argumentPaths }, categories: ['Search'] },
  create: { required: ['path', 'file_text'], fields: { path: argumentText, file_text: argumentString }, categories: ['Edit'] },
  edit: { required: ['path'], fields: { path: argumentText, old_str: argumentString, new_str: argumentString }, categories: ['Edit'] },
  powershell: { required: ['command', 'description'], fields: { command: argumentText,
    description: value => argumentText(value) && value.length <= 100, shellId: argumentText,
    mode: value => ['sync', 'async'].includes(value), detach: argumentBoolean,
    initial_wait: value => typeof value === 'number' && value >= 30 && value <= 600 }, categories: ['Execute'],
    valid: args => args.detach === undefined || args.mode === 'async' },
  web_fetch: { required: ['url'], fields: { url: value => {
    if (!argumentText(value)) return false;
    try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
  }, max_length: value => nonnegativeInteger(value) && value > 0 && value <= 20000,
  start_index: nonnegativeInteger, raw: argumentBoolean }, categories: ['Read', 'External access'] },
}));

function requestedOperation(data) {
  const args = data?.arguments;
  if (!args || typeof args !== 'object' || Array.isArray(args)) return null;
  if (mcpFields.some(field => Object.hasOwn(data, field))) {
    return validMcpMetadata(data) ? { categories: ['External access'], title: '',
      basis: 'Recorded MCP invocation requests service interaction; its tool-specific operation is unknown.',
      limits: 'The service may be local or in-process; this does not prove a network request.' } : null;
  }
  const contract = operationContracts.get(data.toolName);
  if (!contract || !contract.required.every(field => Object.hasOwn(args, field))
    || !Object.entries(args).every(([field, value]) => Object.hasOwn(contract.fields, field) && contract.fields[field](value))
    || (contract.valid && !contract.valid(args))) return null;
  return { categories: [...contract.categories], title: shortTitle(contract.title?.(args) || ''),
    basis: `Authored schema interpretation of recorded ${data.toolName} arguments; the name does not verify its implementation.`,
    limits: data.toolName === 'powershell' ? 'Shell text is opaque; possible read, write and network effects are unknown.' : '' };
}

export function toolOperations(entries) {
  const result = new Map();
  for (const { boundaries, start, data } of toolBuckets(entries)) {
    const operation = data && requestedOperation(data);
    const description = { categories: operation?.categories || [], title: operation?.title || '',
      label: `Requested: ${operation ? operation.categories.join(' · ') : 'Unclassified'}`,
      basisId: operation ? start.id : null,
      basis: operation?.basis || 'A recognized request with complete, unambiguous source, call and argument evidence is unavailable.',
      limits: 'Categories describe requested operations, not approval or completed effects. Actual implementation and effects remain unknown; this is not a security guarantee.'
        + (operation?.limits ? ` ${operation.limits}` : '') };
    for (const entry of boundaries) result.set(entry.id, description);
  }
  return result;
}

const permissionApprovals = new Set(['approved', 'approved-read-only-for-session', 'approved-for-session', 'approved-for-location']);
const permissionDenials = new Set(['denied-by-rules', 'denied-no-approval-rule-and-could-not-request-from-user',
  'denied-interactively-by-user', 'denied-by-content-exclusion-policy', 'denied-by-permission-request-hook']);
const decisionSources = new Set(['assisted_approval', 'human_response', 'host_policy', 'unattended_fallback', 'authorization_carry_forward']);

// One bounded parse per retained event; neither chronology nor recovery ownership is a correlation key.
export function actionStages(entries, { history = 'ready', omitted = 0 } = {}) {
  const usableId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const identity = (entry, call) => toolIdentity({ agentId: entry.agentId, toolCallId: call });
  const records = new Map(entries.map(entry => [entry.id, explanationData(entry)]));
  const proposals = new Map(), permissions = new Map();
  const add = (map, key, value) => {
    if (key === null) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const entry of entries) {
    const data = records.get(entry.id);
    if (!data) continue;
    if (entry.type === 'assistant.message' && Array.isArray(data.toolRequests)) {
      const valid = data.toolRequests.length <= 300 && data.toolRequests.every(request => object(request)
        && usableId(request.toolCallId) && typeof request.name === 'string' && request.name.length > 0 && request.name.length <= 180);
      for (const request of data.toolRequests) {
        if (object(request)) add(proposals, identity(entry, request.toolCallId), { entry, name: request.name, valid });
      }
    }
    if (['permission.requested', 'permission.completed'].includes(entry.type) && usableId(data.requestId)) {
      add(permissions, identity(entry, data.requestId), { entry, data });
    }
  }
  const permissionCalls = new Map();
  for (const bucket of permissions.values()) {
    const requests = bucket.filter(record => record.entry.type === 'permission.requested');
    const decisions = bucket.filter(record => record.entry.type === 'permission.completed');
    const request = requests[0]?.data, decision = decisions[0]?.data;
    const requestCall = request?.permissionRequest?.toolCallId, decisionCall = decision?.toolCallId;
    const calls = [...new Set(bucket.map(({ entry, data }) => entry.type === 'permission.requested'
      ? data.permissionRequest?.toolCallId : data.toolCallId).filter(usableId))];
    const valid = requests.length <= 1 && decisions.length <= 1 && calls.length === 1
      && (!request || (object(request.permissionRequest) && (requestCall === undefined || usableId(requestCall))
        && request.ownerAgentId === undefined && request.ownerSessionId === undefined))
      && (!decision || decisionCall === undefined || usableId(decisionCall));
    for (const call of calls) add(permissionCalls, identity(bucket[0].entry, call), { bucket, valid });
  }
  const result = new Map();
  for (const section of groupSteps(entries).filter(section => section.kind === 'tool')) {
    const boundaries = section.entries, key = toolIdentity(boundaries[0]);
    const starts = boundaries.filter(entry => entry.type === 'tool.execution_start');
    const ends = boundaries.filter(entry => entry.type === 'tool.execution_complete');
    const linked = key !== null && starts.length <= 1 && ends.length <= 1 && boundaries.every(entry => {
      const data = records.get(entry.id);
      return toolIdentity(entry) === key && data?.toolCallId === entry.toolCallId;
    });
    const selected = new Map();
    const notes = ['Recorded order only; these stages are not a required sequence.',
      'Invocation entry and approval do not prove the operation executed. A tool result reports an outcome, not overall task success.',
      'Only complete matching retained evidence is linked. Missing, ambiguous or unsupported ownership links remain separate.'];
    const stage = (entry, label, detail = '', extra = {}) => selected.set(entry.id,
      { id: entry.id, type: entry.type, timestamp: entry.timestamp, label, detail, ...extra });
    for (const entry of boundaries) {
      const data = records.get(entry.id);
      if (!data || data.toolCallId !== entry.toolCallId) continue;
      if (entry.type === 'tool.execution_start') stage(entry, 'Tool invocation entered');
      else stage(entry, data.success === true && entry.success === true ? 'Tool result: reported success'
        : data.success === false && entry.success === false ? 'Tool result: reported failure' : 'Tool result: outcome unknown');
    }
    if (!linked) notes.push('Call boundaries are conflicting or unavailable; other stages are not linked to this card.');
    if (linked) {
      const candidates = proposals.get(key) || [], proposal = candidates[0];
      const startData = starts[0] && records.get(starts[0].id);
      if (candidates.length === 1 && proposal.valid && (!startData || proposal.name === startData.toolName)) {
        stage(proposal.entry, 'Assistant requested a tool');
      } else if (candidates.length) notes.push('Assistant tool requests are duplicated, conflicting or unusable; their original rows remain separate.');
      for (const { bucket, valid } of permissionCalls.get(key) || []) {
        if (!valid) {
          notes.push('Permission IDs or recovery ownership are ambiguous or unsupported; these records remain separate.');
          continue;
        }
        for (const { entry, data } of bucket) {
          if (entry.type === 'permission.requested') stage(entry, 'Permission requested', 'A request is not a decision.');
          else {
            const kind = object(data.result) ? data.result.kind : null;
            const outcome = permissionApprovals.has(kind) ? 'approved' : permissionDenials.has(kind) ? 'denied'
              : kind === 'cancelled' ? 'cancelled' : 'unknown';
            const decisionSource = decisionSources.has(data.decisionSource) ? data.decisionSource : null;
            const detail = `Recorded kind: ${usableId(kind) ? kind : 'unknown'}. `
              + (decisionSource ? `Recorded decision source: ${decisionSource}.` : 'Decision source unknown; the kind does not identify a person.');
            stage(entry, `Permission ${outcome}`, detail, { outcome, decisionSource });
          }
        }
      }
    }
    const stages = entries.filter(entry => selected.has(entry.id)).map(entry => selected.get(entry.id));
    const decisions = stages.filter(stage => stage.type === 'permission.completed');
    const requests = stages.filter(stage => stage.type === 'permission.requested');
    const settled = new Set(decisions.map(stage => records.get(stage.id).requestId));
    let permission = decisions.length === 1 ? `Recorded permission: ${decisions[0].outcome}`
      : decisions.length ? 'Multiple permission decisions; no overall authorization inferred' : 'Permission unknown';
    if (requests.some(stage => !settled.has(records.get(stage.id).requestId))
      || (permissionCalls.get(key) || []).some(record => !record.valid)) permission = 'Permission unknown';
    if (!stages.some(stage => stage.type === 'assistant.message')) notes.push('Assistant tool request not linked in retained evidence.');
    if (!requests.length) notes.push('Permission request unknown; no request is linked in retained evidence.');
    if (!starts.length) notes.push('Invocation entry unknown; no start boundary is retained.');
    if (!ends.length) notes.push('Tool outcome unknown; no result boundary is retained.');
    if (permission === 'Permission unknown') notes.push('Missing permission evidence does not establish approval or preauthorization.');
    if (history !== 'ready' || omitted) notes.push('History is incomplete or older events were omitted; only retained evidence is shown.');
    const description = { stages, notes: [...new Set(notes)], permission };
    for (const entry of boundaries) result.set(entry.id, description);
  }
  return result;
}

// Temporal membership only: keep interleaved agents in their original event order.
export function turnContext(entries, { history = 'ready', omitted = 0 } = {}) {
  const active = new Map();
  const context = new Map();
  const completeHistory = history === 'ready' && omitted === 0;
  const invalidate = turn => { if (turn) turn.activitySupported = false; };
  for (const entry of entries) {
    const agent = entry.agentId ?? '';
    const knownSource = typeof entry.agentId === 'string' && entry.agentId.length <= 256;
    if (entry.type === 'abort') { active.forEach(invalidate); active.clear(); continue; }
    if (entry.type === 'user.message') {
      if (!knownSource) active.forEach(invalidate);
      if (!['steering', 'queued'].includes(entry.delivery)) { invalidate(active.get(agent)); active.delete(agent); }
      continue;
    }
    if (!knownSource) {
      if (entry.type === 'assistant.turn_start' || entry.type === 'assistant.turn_end') active.forEach(invalidate);
      continue;
    }
    if (entry.type === 'assistant.turn_start') {
      const previous = active.get(agent);
      invalidate(previous);
      active.delete(agent);
      if (typeof entry.turnId !== 'string' || !entry.turnId || entry.turnId.length > 256) continue;
      const startTime = timestampMilliseconds(entry.timestamp);
      const turn = { id: entry.turnId, agent, model: entry.model, count: 0, ended: false, startTime,
        activitySupported: completeHistory && !previous && Number.isFinite(startTime), activity: null };
      active.set(agent, turn);
      context.set(entry.id, { role: 'start', turn });
    } else if (entry.type === 'assistant.turn_end') {
      const turn = active.get(agent);
      if (turn && entry.turnId === turn.id) {
        turn.ended = true;
        const endTime = timestampMilliseconds(entry.timestamp);
        if (!(endTime > (turn.activity?.time ?? turn.startTime))) invalidate(turn);
        context.set(entry.id, { role: 'end', turn });
      } else invalidate(turn);
      active.delete(agent);
    } else if (active.has(agent) && !entry.type.startsWith('session.')) {
      const turn = active.get(agent);
      turn.count++;
      if (!turn.activity && turn.activitySupported && entry.type === 'assistant.intent') {
        const activity = recordedIntent(entry);
        if (activity && activity.time > turn.startTime) turn.activity = activity;
      }
      context.set(entry.id, { role: 'inside', turn });
    }
  }
  return context;
}

export function summarize(entries) {
  const activeTurns = new Map(), hooks = new Map(), tools = new Map(), skills = new Map();
  let turns = 0, unlinked = 0;
  for (const entry of entries) {
    const agent = entry.agentId ?? '';
    if (['assistant.turn_start', 'assistant.turn_end'].includes(entry.type)) {
      if (!entry.turnId || entry.agentId === null) {
        unlinked++;
        if (entry.agentId !== null) activeTurns.delete(agent);
      } else if (entry.type === 'assistant.turn_start') {
        turns++;
        activeTurns.set(agent, entry.turnId);
      } else {
        if (activeTurns.get(agent) !== entry.turnId) turns++;
        activeTurns.delete(agent);
      }
      continue;
    }
    let calls;
    if (['hook.start', 'hook.end'].includes(entry.type)) calls = hooks;
    if (['tool.execution_start', 'tool.execution_complete'].includes(entry.type)) calls = tools;
    if (calls) {
      const key = calls === tools ? toolIdentity(entry) : hookIdentity(entry);
      if (key === null) { unlinked++; continue; }
      if (!calls.has(key) || !calls.get(key)) calls.set(key, entry.displayName || '');
    }
    if (entry.type === 'skill.invoked') {
      const name = entry.displayName || 'Name unavailable';
      skills.set(name, (skills.get(name) || 0) + 1);
    }
  }
  const hookNames = new Map();
  for (const call of hookInvocations(entries).filter(call => call.linked)) {
    const name = call.hookType || (call.status === 'conflict' ? call.title : 'Name unavailable');
    hookNames.set(name, (hookNames.get(name) || 0) + 1);
  }
  return { turns, hooks: hooks.size, tools: tools.size,
    skills: [...skills.values()].reduce((sum, n) => sum + n, 0),
    skillNames: [...skills], hookNames: [...hookNames], unlinked };
}

export function describeTurn(entry, context, operation) {
  if (!context) {
    if (entry.type === 'assistant.turn_end') return { kind: 'Model', tone: 'model',
      title: entry.turnId ? `Turn ${entry.turnId} complete` : 'Turn complete',
      subtitle: 'Matching start unavailable in this view.' };
    if (entry.type === 'assistant.turn_start') return { kind: 'Model', tone: 'model',
      title: 'Model turn', subtitle: 'Start recorded; usable turn or agent ID unavailable.' };
    return describeStep(entry, operation);
  }
  if (context.role === 'inside') return describeStep(entry, operation);
  const { turn, role } = context;
  const source = turn.agent ? `Agent ${turn.agent}` : 'Main chat';
  const activity = role === 'start' && turn.activitySupported ? turn.activity : null;
  return { kind: 'Model', tone: 'model',
    title: activity ? shortTitle(`Reported activity: ${activity.text}`)
      : role === 'start' ? `Model turn ${turn.id}` : `Turn ${turn.id} complete`,
    subtitle: role === 'start'
      ? `${activity ? `Model turn ${turn.id} · ` : ''}${turn.model ? `${turn.model} · ` : ''}${source} · ${turn.count} ${turn.count === 1 ? 'event' : 'events'} · ${turn.ended ? 'Completed' : 'End not observed'}`
      : `${source} · This iteration ended; more turns may follow.`,
    ...(activity ? { activityId: activity.id } : {}),
  };
}

function recordedIntent(entry) {
  if (entry.truncated || typeof entry.id !== 'string' || !entry.id || entry.id.length > 256
    || typeof entry.evidence !== 'string' || entry.evidence.length > 12000) return null;
  let event;
  try { event = JSON.parse(entry.evidence); } catch { return null; }
  const agent = event?.agentId === undefined ? ''
    : typeof event.agentId === 'string' && event.agentId.length > 0 && event.agentId.length <= 256 ? event.agentId : null;
  const data = event?.data;
  const time = timestampMilliseconds(entry.timestamp);
  if (event?.id !== entry.id || event?.type !== 'assistant.intent' || agent !== entry.agentId
    || event.timestamp !== entry.timestamp || !Number.isFinite(time)
    || !data || typeof data !== 'object' || Array.isArray(data) || typeof data.intent !== 'string' || !data.intent.trim()) return null;
  return { id: entry.id, text: data.intent, time };
}

export function describeHookGroup(entries) {
  const names = [...new Set(entries.map(entry => entry.displayName).filter(Boolean))];
  const failures = entries.filter(entry => entry.type === 'hook.end' && entry.success === false).length;
  const count = entries.length;
  const calls = new Set(entries.map(hookIdentity).filter(id => id !== null)).size;
  const subtitle = `${calls ? `${calls} pipeline ${calls === 1 ? 'invocation' : 'invocations'} · ` : ''}${count} ${count === 1 ? 'event' : 'events'}${failures ? ` · ${failures} failed` : ''}${names.length ? ` · ${names.slice(0, 2).join(', ')}${names.length > 2 ? '…' : ''}` : ''}`;
  return { kind: 'Hook', title: 'Hooks', subtitle, tone: failures ? 'error' : 'host' };
}

function actionTitle(entry, operation) {
  if (entry.type !== 'tool.execution_start') return '';
  return (operation || toolOperations([entry]).get(entry.id))?.title || '';
}

function shortTitle(title, limit = 180) {
  if (title.length <= limit) return title;
  let prefix = title.slice(0, limit - 1);
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return prefix + '…';
}

export function describeStep(entry, operation) {
  const type = entry.type;
  if (type === 'user.message') {
    const delivery = { idle: 'Idle input · Starts its own run', steering: 'Steering input · Injected into an in-flight run',
      queued: 'Queued input · Own run follows later' };
    return { kind: 'You', title: entry.preview || 'User message',
      subtitle: Object.hasOwn(delivery, entry.delivery) ? delivery[entry.delivery] : 'Delivery unknown · Request boundary unavailable', tone: 'user' };
  }
  if (entry.category === 'tool') {
    const subtitle = type === 'tool.execution_start' ? 'Started'
      : entry.success === false ? 'Failed' : entry.success === true ? 'Completed' : 'Result recorded';
    return { kind: 'Tool', title: actionTitle(entry, operation) || entry.toolName || 'Tool name unavailable', subtitle, tone: entry.success === false ? 'error' : 'tool' };
  }
  if (entry.category === 'skill') {
    const triggers = { 'user-invoked': 'Invoked by you', 'agent-invoked': 'Invoked by agent', 'context-load': 'Loaded into context' };
    const subtitle = Object.hasOwn(triggers, entry.trigger) ? triggers[entry.trigger]
      : entry.trigger ? 'See recorded trigger' : 'Trigger not recorded';
    return { kind: 'Skill', title: entry.displayName || 'Skill loaded', subtitle, tone: 'skill' };
  }
  if (entry.category === 'turn' || entry.category === 'model') {
    const states = {
      'assistant.turn_start': ['Model turn', 'Turn started'],
      'assistant.turn_end': ['Model turn', 'Turn ended'],
      'assistant.message': ['Assistant response', entry.preview || 'Response recorded'],
      'assistant.intent': ['Assistant activity', entry.preview || 'Activity reported'],
      'assistant.reasoning': ['Reported reasoning', 'Reasoning shared by host'],
    };
    const [fallback, subtitle] = states[type] || ['Model activity', 'Recorded by host'];
    return { kind: 'Model', title: entry.model || fallback, subtitle, tone: 'model' };
  }
  if (type?.startsWith('hook.')) return {
    kind: 'Hook', title: entry.displayName || 'Hook',
    subtitle: type === 'hook.start' ? 'Started' : entry.success === false ? 'Failed' : 'Finished',
    tone: entry.success === false ? 'error' : 'host',
  };
  if (entry.category === 'agent') return {
    kind: 'Subagent', title: entry.displayName || 'Subagent',
    subtitle: type === 'subagent.started' ? 'Started' : type === 'subagent.failed' ? 'Failed' : 'Completed',
    tone: type === 'subagent.failed' ? 'error' : 'agent',
  };
  return { kind: 'Harness', title: entry.title || 'Host activity', subtitle: 'Recorded by host',
    tone: type === 'session.error' ? 'error' : type === 'session.warning' ? 'warning' : 'host' };
}
