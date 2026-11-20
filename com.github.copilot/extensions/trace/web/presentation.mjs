import { vocabulary, conceptForEntry, glossaryExample, retainedExample } from './glossary.mjs';
import { retainedHostOutput } from './host-output.mjs';
export { vocabulary, conceptForEntry, glossaryExample, retainedExample } from './glossary.mjs';

const actorRoles = new Map(Object.entries({
  'user.message': 'User',
  'assistant.turn_start': 'Assistant',
  'assistant.turn_end': 'Assistant',
  'assistant.intent': 'Assistant',
  'assistant.message': 'Assistant',
  'assistant.reasoning': 'Assistant',
  'assistant.usage': 'Host accounting',
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
    vocabulary['model-turn'].definition,
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
  'assistant.usage': ['The host reported usage for one model call.',
    'This live receipt covers reported token measures in the retained observation window. Earlier ephemeral usage history is not backfilled.',
    'Missing measures are unavailable, not zero. This receipt is not a complete chat usage or billing total; token measures do not establish a monetary charge.'],
  'tool.execution_start': ['The runtime recorded a tool invocation starting.',
    'Arguments describe a requested operation. This start does not prove the operation executed; permission may still be required.',
    'The result and reason for choosing this tool are not established here. A missing result does not mean it is still running.'],
  'tool.execution_complete': ['The runtime recorded a tool result.',
    'The reported outcome is unavailable; a result event alone does not establish success.',
    'A tool result does not establish that the user’s task is correct or complete. Missing boundaries leave the call record partial.'],
  'skill.invoked': ['The host recorded a skill being loaded.',
    `${vocabulary.skill.definition} The recorded trigger is unavailable or unrecognized.`,
    'Loading does not prove the instructions were followed or that a referenced script or command ran. The selection reason remains unknown; skill metadata does not establish tool approval.'],
  'subagent.started': ['The host recorded a delegated agent starting.',
    `${vocabulary.subagent.definition} This event records its start.`,
    'The outcome is not established here. A missing outcome does not mean the agent is still running.'],
  'subagent.completed': ['The host recorded a delegated agent outcome.',
    'Cancellation status is unavailable; the event type alone does not distinguish completion from cancellation.',
    'This event does not independently verify that the delegated task is correct or that the overall task is complete.'],
  'subagent.failed': ['The host reported a delegated agent failure.',
    'This is a failure report for delegated work; the evidence may provide a recorded error.',
    'The root cause, recovery and effect on the overall task are not established by this event alone.'],
  'hook.start': ['The harness recorded a hook pipeline starting.',
    `${vocabulary.hook.definition} A pipeline record does not prove a configured handler ran.`,
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
    vocabulary.compaction.definition,
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

function compactionMetrics(data) {
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const basis = typeof data?.tokenAccountingBasis === 'string' ? data.tokenAccountingBasis : null;
  const before = data?.preCompactionTokens, after = data?.postCompactionTokens;
  const removed = data?.tokensRemoved, messages = data?.messagesRemoved, length = data?.preCompactionMessagesLength;
  const tokenConflict = removed !== undefined && (!count(removed)
    || (count(before) && count(after) && removed !== before - after));
  const messageConflict = messages !== undefined && (!count(messages)
    || (length !== undefined && (!count(length) || messages > length)));
  const comparable = basis === 'local_full_context_estimate' && count(before) && count(after) && !tokenConflict;
  return {
    status: comparable ? 'comparable' : !data || basis === null ? 'unavailable' : 'incomparable', basis,
    before: comparable ? before : null, after: comparable ? after : null, change: comparable ? before - after : null,
    tokensRemoved: count(removed) && !tokenConflict ? removed : null,
    messagesRemoved: count(messages) && !messageConflict ? messages : null,
    note: (comparable ? 'Comparable context-token estimates, measured on the reported local_full_context_estimate basis.'
      : tokenConflict ? 'Context comparison unavailable: reported token measurements are invalid or inconsistent.'
      : basis !== null && basis !== 'local_full_context_estimate' ? 'Context comparison unavailable: the reported accounting basis is unrecognized.'
      : 'Context comparison unavailable: a recognized accounting basis and valid paired context-token estimates are not retained.')
      + (messageConflict ? ' Reported message reduction is invalid or inconsistent and is unavailable.' : '')
      + ' These are separate from summarizer inference usage and do not measure memory retention.',
  };
}

export function compactionAttempts(entries) {
  const attempts = [], byIdentity = new Map(), dataByEntry = new Map();
  for (const entry of entries) {
    if (!['session.compaction_start', 'session.compaction_complete'].includes(entry.type)) continue;
    let data = explanationData(entry);
    if (entry.type === 'session.compaction_complete'
      && (typeof data?.success === 'boolean' ? data.success : null) !== entry.success) data = null;
    dataByEntry.set(entry, data);
    const id = typeof data?.compactionAttemptId === 'string' && data.compactionAttemptId.trim().length > 0
      && data.compactionAttemptId.length <= 256 ? data.compactionAttemptId : null;
    const identity = id === null ? null : JSON.stringify([entry.agentId, id]);
    let attempt = identity === null ? null : byIdentity.get(identity);
    if (!attempt) {
      attempt = { id: identity === null ? `unlinked-compaction:${entry.id}` : `compaction:${identity}`,
        agentId: entry.agentId, compactionAttemptId: id, entries: [] };
      attempts.push(attempt);
      if (identity !== null) byIdentity.set(identity, attempt);
    }
    attempt.entries.push(entry);
  }
  for (const attempt of attempts) {
    const starts = attempt.entries.filter(entry => entry.type === 'session.compaction_start');
    const ends = attempt.entries.filter(entry => entry.type === 'session.compaction_complete');
    const conflict = starts.length > 1 || ends.length > 1
      || (starts.length === 1 && ends.length === 1 && attempt.entries[0] !== starts[0]);
    attempt.status = conflict ? 'conflict' : attempt.compactionAttemptId === null ? 'unlinked'
      : !starts.length ? 'complete-only' : !ends.length ? 'start-only' : 'paired';
    const data = !conflict && ends.length === 1 ? dataByEntry.get(ends[0]) : null;
    attempt.outcome = data?.success === true ? 'success' : data?.success === false ? 'failure' : 'unknown';
    attempt.reportedOutcome = typeof data?.outcome === 'string' ? data.outcome : null;
    const content = typeof data?.summaryContent === 'string' ? data.summaryContent : null;
    attempt.summary = {
      status: content === null ? 'unavailable' : content === '' ? 'empty' : 'complete', content,
      note: content !== null ? content === '' ? 'The host recorded an empty summary.'
        : `${content.length} UTF-16 code units of exact host-reported LLM summary retained.`
        : attempt.entries.some(entry => entry.truncated) ? 'Summary unavailable: Trace clipped event evidence to at most 12,000 UTF-16 code units and cannot recover the complete summary.'
        : !data ? 'Summary unavailable: a unique completion with complete matching evidence is not retained.'
        : 'Summary unavailable: the host did not record a text summary.',
    };
    attempt.metrics = compactionMetrics(data);
    attempt.notes = [conflict ? starts.length > 1 || ends.length > 1
      ? 'Duplicate boundaries for this source and attempt ID conflict; no unique attempt result is inferred.'
      : 'The completion appears before its start in retained event order; the boundary record conflicts.'
      : attempt.status === 'unlinked' ? 'Pairing unavailable: complete matching evidence, a known source and a nonempty bounded attempt ID are required. Time, names and chronological parent IDs do not establish a match.'
      : attempt.status === 'start-only' ? 'Completion not retained. This does not mean compaction is still running.'
      : attempt.status === 'complete-only' ? 'Start not retained. This completion can report its own result; no start is inferred.'
      : 'Start and completion share the exact recorded source and compaction attempt ID.',
    'The summary is a host-reported LLM summary, not all context or proof of what future turns retain. Whether any instruction or fact was preserved, followed or forgotten remains unknown.'];
  }
  return attempts;
}

export function explainStep(entry = {}, outcome) {
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
  if (entry.type === 'tool.execution_complete' && outcome) {
    means = outcome.means;
    unknown = outcome.unknown;
  }
  if (entry.type === 'subagent.completed' && typeof data?.cancelled === 'boolean') {
    means = data.cancelled ? 'The recorded cancelled field reports cancellation of the delegated work.'
      : 'The recorded cancelled field reports completion without cancellation; this is not a check of the result’s correctness.';
  }
  if (entry.type === 'skill.invoked') {
    const skill = skillInstructions(entry);
    means = `${vocabulary.skill.definition} ${skillTriggers.has(skill.trigger)
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
      means = `The recorded decision kind is ${kind}. Approval permits an operation; it does not prove it executed. ${permissionResultScope(data.result).detail}`;
    } else if (permissionDenials.has(kind) || kind === 'cancelled') {
      means = `The recorded decision kind is ${kind}. This records a refusal or cancellation, not a successful operation.`;
    }
    if (decisionSources.has(data?.decisionSource)) {
      unknown = `Recorded decision source: ${data.decisionSource}. This attribution does not independently prove that a person interacted or that the operation executed.`;
    }
  }
  if (!data) unknown += ' Complete, matching event data is unavailable; only the recorded event type is described.';
  return { happened, means, unknown,
    general: vocabulary[conceptForEntry(entry)]?.definition
      || (typeof entry.explanation === 'string' && entry.explanation ? entry.explanation : 'No further general definition is available.') };
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

export function guidanceComparison(entries, preferred) {
  return ['skill', 'hook', 'permission'].map(concept => {
    const definition = vocabulary[concept], target = glossaryExample(entries, concept, preferred);
    const card = { concept, label: concept === 'skill' ? 'Instructions and skills: guidance'
      : concept === 'hook' ? 'Hooks: configured automation' : 'Permissions: authorization',
      lesson: definition.comparison, target, evidence: target ? [target] : [], facts: [], reported: [], body: null,
      example: target ? `Current chat example: ${target.type} · ${target.agentId ? `Agent ${target.agentId}` : 'Main chat'} · ${target.timestamp || 'Time unavailable'}`
        : `Static example — not from this chat: ${definition.example}` };
    if (!target) return card;
    const entry = entries.find(item => item.id === target.id);
    if (concept === 'skill') {
      const skill = skillInstructions(entry);
      card.facts = [skill.name === null ? 'Skill name unavailable in complete matching evidence.' : `Recorded skill: ${skill.name}`,
        skill.previewTruncated ? 'Preview shortened to 600 characters; open the skill example for exact retained instructions.' : skill.note];
      card.body = skill.preview;
      card.bodyLabel = 'Retained instruction preview';
    } else if (concept === 'hook') {
      const call = hookInvocations(entries).find(item => item.entries.includes(entry));
      card.evidence = call.entries.map(item => {
        const frozen = glossaryExample(entries, 'hook', item);
        return frozen?.id === item.id ? frozen : null;
      });
      if (card.evidence.includes(null)) {
        card.facts = ['Hook output and outcome are unknown: supporting original evidence is unavailable or ambiguous.'];
        return card;
      }
      card.facts = [`Recorded hook type: ${call.title}. Pipeline outcome: ${call.outcome}.`, call.timing, ...call.notes,
        'A recorded hook request does not establish the applied permission decision or an operation’s effect.'];
      card.reported = call.reported;
      if (!call.reported.some(item => item.field !== 'additionalContext')) {
        card.facts.push('No supported decision request is recorded in this pipeline output. Effects remain unknown.');
      }
      if (call.output === null) card.facts.push('Output is unavailable or was not recorded; this does not prove that the hook did nothing.');
      card.body = call.output;
      card.bodyLabel = 'Retained pipeline output';
    } else {
      const explanation = explainStep(entry);
      card.facts = [explanation.means, explanation.unknown];
    }
    return card;
  });
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

const usageFields = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'];
const safeCount = value => Number.isSafeInteger(value) && value >= 0;
const safeSum = values => {
  let total = 0;
  for (const value of values) { if (!safeCount(value) || !safeCount(total + value)) return null; total += value; }
  return total;
};
const usageProvider = provider => provider && typeof provider === 'object' && !Array.isArray(provider)
  && identityText(provider.id) && identityText(provider.label) && ['copilot', 'loki'].includes(provider.kind)
  ? { id: provider.id, kind: provider.kind, label: provider.label } : null;

// Inputs are exactly the caller's retained capture; no current clock or session metrics are consulted.
export function observedTimeAndUsage(entries, { history = 'ready', omitted = 0 } = {}) {
  const ids = new Map(), records = new Map(), positions = new Map();
  for (const [index, entry] of entries.entries()) { ids.set(entry.id, (ids.get(entry.id) || 0) + 1); positions.set(entry, index); }
  for (const entry of entries) records.set(entry, identityText(entry.id) && ids.get(entry.id) === 1
    && (entry.agentId === '' || identityText(entry.agentId)) ? explanationData(entry) : null);
  const timing = { window: null, intervals: [], sumMs: null, coveredMs: null, unaccountedMs: null, gaps: [], excluded: [], windowExcluded: [] };
  const timed = [];
  for (const entry of entries) {
    const time = timestampMilliseconds(entry.timestamp);
    if (records.get(entry) && Number.isSafeInteger(time)) timed.push({ entry, time });
    else timing.windowExcluded.push({ entries: [entry], reason: 'Window timestamp or matching source evidence unavailable.' });
  }
  if (timed.length) {
    const ordered = [...timed].sort((a, b) => a.time - b.time), first = ordered[0], last = ordered.at(-1);
    const wallMs = last.time - first.time;
    if (safeCount(wallMs)) timing.window = { startMs: first.time, endMs: last.time, wallMs,
      entries: [...new Set([first.entry, last.entry])] };
  }
  const buckets = new Map();
  for (const entry of entries) {
    const kind = ['tool.execution_start', 'tool.execution_complete'].includes(entry.type) ? 'tool'
      : ['subagent.started', 'subagent.completed', 'subagent.failed'].includes(entry.type) ? 'agent' : null;
    if (!kind) continue;
    const key = JSON.stringify([kind, entry.agentId, entry.toolCallId]);
    if (!buckets.has(key)) buckets.set(key, { kind, entries: [] });
    buckets.get(key).entries.push(entry);
  }
  for (const bucket of buckets.values()) {
    const boundaries = bucket.entries, starts = boundaries.filter(entry => ['tool.execution_start', 'subagent.started'].includes(entry.type));
    const ends = boundaries.filter(entry => !starts.includes(entry)), start = starts[0], end = ends[0];
    const exclude = reason => timing.excluded.push({ entries: boundaries, reason });
    if (starts.length !== 1 || ends.length !== 1) { exclude('Exactly one start and one end are required; boundaries are missing or ambiguous.'); continue; }
    const startData = records.get(start), endData = records.get(end);
    if (!startData || !endData || !identityText(start.toolCallId) || startData.toolCallId !== start.toolCallId
      || endData.toolCallId !== end.toolCallId || (bucket.kind === 'agent' && !identityText(start.agentId))) {
      exclude('Source, invocation ID or complete matching raw evidence unavailable.'); continue;
    }
    const fields = bucket.kind === 'tool' ? ['toolName', ...mcpFields] : ['agentName', 'agentType', 'executionMode'];
    const contradiction = fields.some(field => (startData[field] !== undefined && !identityText(startData[field]))
      || (endData[field] !== undefined && (!identityText(endData[field]) || (startData[field] !== undefined && endData[field] !== startData[field]))));
    if (contradiction || (bucket.kind === 'tool' && (!identityText(startData.toolName, 180) || startData.toolName !== start.toolName
      || (end.toolName !== '' && end.toolName !== start.toolName)
      || [startData, endData].some(data => ['origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(data, field)))
      || (mcpFields.some(field => startData[field] !== undefined) && !validMcpMetadata(startData))
      || mcpFields.some(field => endData[field] !== undefined && endData[field] !== startData[field])))) {
      exclude('Tool, agent or provider boundary metadata is invalid or contradictory.'); continue;
    }
    const startMs = timestampMilliseconds(start.timestamp), endMs = timestampMilliseconds(end.timestamp), elapsedMs = endMs - startMs;
    if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || !safeCount(elapsedMs) || positions.get(end) < positions.get(start)) {
      exclude('Boundary timestamps are missing, invalid or reversed.'); continue;
    }
    timing.intervals.push({ kind: bucket.kind, start, end, startMs, endMs, elapsedMs, entries: [start, end] });
  }
  if (timing.intervals.length) {
    timing.sumMs = safeSum(timing.intervals.map(row => row.elapsedMs));
    const union = [];
    for (const interval of [...timing.intervals].sort((a, b) => a.startMs - b.startMs)) {
      const last = union.at(-1);
      if (last && interval.startMs <= last.endMs) last.endMs = Math.max(last.endMs, interval.endMs);
      else union.push({ startMs: interval.startMs, endMs: interval.endMs });
    }
    timing.coveredMs = safeSum(union.map(row => row.endMs - row.startMs));
    if (timing.window && timing.coveredMs !== null) {
      timing.unaccountedMs = timing.window.wallMs - timing.coveredMs;
      let cursor = timing.window.startMs;
      for (const interval of union) {
        if (cursor < interval.startMs) timing.gaps.push({ startMs: cursor, endMs: interval.startMs, elapsedMs: interval.startMs - cursor });
        cursor = interval.endMs;
      }
      if (cursor < timing.window.endMs) timing.gaps.push({ startMs: cursor, endMs: timing.window.endMs, elapsedMs: timing.window.endMs - cursor });
    }
  }
  const usage = { receipts: [], groups: [], excluded: [], duplicates: [] }, candidates = [], identities = new Map();
  for (const entry of entries.filter(entry => entry.type === 'assistant.usage')) {
    const data = explanationData(entry), accounting = data?.accounting;
    const validAccounting = accounting && typeof accounting === 'object' && !Array.isArray(accounting)
      && identityText(accounting.sourceSessionId) && identityText(accounting.usageId) && safeCount(accounting.sequence);
    const provider = usageProvider(data?.provider);
    const valid = records.get(entry) && entry.observation?.source === 'live' && validAccounting && identityText(data.model, 180)
      && data.model === entry.model && (data.provider === undefined || provider)
      && (data.modelProvider === undefined || identityText(data.modelProvider))
      && usageFields.every(field => data[field] === undefined || safeCount(data[field]))
      && !(data.reasoningTokens !== undefined && data.outputTokens !== undefined && data.reasoningTokens > data.outputTokens);
    const receipt = valid ? { entry, entries: [entry], accounting: { sourceSessionId: accounting.sourceSessionId, sequence: accounting.sequence, usageId: accounting.usageId },
      agentId: entry.agentId, model: data.model, provider, providerFamily: data.modelProvider ?? null,
      values: Object.fromEntries(usageFields.map(field => [field, data[field] ?? null])) } : null;
    const signature = receipt && JSON.stringify([receipt.accounting, receipt.agentId, receipt.model, provider, receipt.providerFamily, receipt.values]);
    const candidate = { entry, receipt, signature, keys: [] }; candidates.push(candidate);
    if (identityText(accounting?.sourceSessionId)) {
      if (safeCount(accounting.sequence)) candidate.keys.push(JSON.stringify(['sequence', accounting.sourceSessionId, accounting.sequence]));
      if (identityText(accounting.usageId)) candidate.keys.push(JSON.stringify(['usageId', accounting.sourceSessionId, accounting.usageId]));
    }
    for (const key of candidate.keys) { if (!identities.has(key)) identities.set(key, []); identities.get(key).push(candidate); }
  }
  const visited = new Set();
  for (const candidate of candidates) {
    if (visited.has(candidate)) continue;
    const component = [], pending = [candidate];
    while (pending.length) {
      const item = pending.pop(); if (visited.has(item)) continue;
      visited.add(item); component.push(item);
      for (const key of item.keys) pending.push(...identities.get(key).filter(other => !visited.has(other)));
    }
    if (component.some(item => !item.receipt || item.signature !== candidate.signature)) {
      usage.excluded.push({ entries: component.map(item => item.entry), reason: component.length > 1
        ? 'Conflicting accounting identity chain or invalid consumed fields; all connected receipts excluded.'
        : 'Live receipt source, accounting, model, provider or token fields unavailable or invalid.' });
      continue;
    }
    candidate.receipt.entries = component.map(item => item.entry);
    usage.receipts.push(candidate.receipt);
    if (component.length > 1) usage.duplicates.push({ entries: component.map(item => item.entry), reason: 'Identical interpreted receipt repeated; counted once.' });
  }
  const groups = new Map();
  for (const receipt of usage.receipts) {
    const key = JSON.stringify([receipt.accounting.sourceSessionId, receipt.agentId, receipt.model, receipt.provider, receipt.providerFamily,
      receipt.provider ? null : receipt.accounting.usageId]);
    if (!groups.has(key)) groups.set(key, { sourceSessionId: receipt.accounting.sourceSessionId, agentId: receipt.agentId,
      model: receipt.model, provider: receipt.provider, providerFamily: receipt.providerFamily, receipts: [], entries: [], measures: {} });
    const group = groups.get(key); group.receipts.push(receipt); group.entries.push(...receipt.entries);
  }
  for (const group of groups.values()) {
    for (const field of usageFields) {
      const values = group.receipts.map(receipt => receipt.values[field]).filter(value => value !== null), reported = values.length;
      const missing = group.receipts.length - reported, value = reported ? safeSum(values) : null;
      group.measures[field] = { value, reported, missing, status: !reported ? 'unavailable' : value === null ? 'overflow' : missing ? 'partial' : 'complete' };
    }
    usage.groups.push(group);
  }
  return { timing, usage, notes: [
    'Frozen displayed retained window only, across filters. Timing supports unique tool start/completion and delegated-agent start/completion/failure pairs. Other activity is not timed. At most 300 retained records are available.',
    'Wall span uses the earliest and latest valid matching retained timestamps. Summed operation intervals can exceed wall span because tools and agents overlap. Covered time is their union; unaccounted gaps are its complement inside this window, not idle or thinking time. These measures do not establish compute time, causality or productivity.',
    'Usage covers retained live assistant.usage receipts only. Earlier ephemeral receipts are not backfilled from history. Missing fields are unavailable; partial sums include only reported values. Exact accounting sources and envelope agents are different identities. Unknown exact providers keep receipts separate, even when provider families match.',
    'All usage measures are host-reported tokens. Cache read/write remain separate provider-specific measures; no universal subtraction from input is assumed. Reasoning tokens are already part of output, never extra output. No combined token, credit or monetary total is calculated.',
    'Session metrics, checkpoints, shutdown totals and subagent totalTokens overlap receipts and are not added. API duration and reported agent durationMs are not added to boundary intervals. Other host fields remain uninterpreted raw evidence.',
    ...(history !== 'ready' ? ['Earlier history is unavailable or loading.'] : []),
    ...(omitted ? [`${omitted} older records were omitted before this capture; timing and usage are partial.`] : []),
  ] };
}

// Link retained records, never reconstruct a child transcript or infer a causal tree.
export function delegationHandoffs(entries, { history = 'ready', omitted = 0 } = {}) {
  const rows = [], byAgent = new Map(), tools = new Map(), records = new Map(), positions = new Map(), counts = new Map();
  const source = entry => entry.agentId === '' || identityText(entry.agentId) ? entry.agentId : null;
  const lifecycleEvent = entry => ['subagent.started', 'subagent.completed', 'subagent.failed'].includes(entry.type);
  const key = (agent, call) => JSON.stringify([agent, call]);
  for (const [index, entry] of entries.entries()) {
    positions.set(entry, index); counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
    records.set(entry, source(entry) !== null && identityText(entry.id) ? explanationData(entry) : null);
    if (['tool.execution_start', 'tool.execution_complete'].includes(entry.type) && identityText(entry.toolCallId)) {
      const identity = key(source(entry), entry.toolCallId);
      if (!tools.has(identity)) tools.set(identity, []);
      tools.get(identity).push(entry);
    }
    const agent = source(entry);
    if (agent === '' || (agent === null && !lifecycleEvent(entry))) continue;
    let row = agent === null ? null : byAgent.get(agent);
    if (!row) {
      row = { id: `delegation:${agent === null ? `unknown:${entry.id}` : JSON.stringify(agent)}`,
        anchorId: entry.id, agentId: agent, entries: [] };
      rows.push(row);
      if (agent !== null) byAgent.set(agent, row);
    }
    row.entries.push(entry);
  }
  const claims = new Map();
  for (const row of rows) {
    const starts = row.entries.filter(entry => entry.type === 'subagent.started');
    const ends = row.entries.filter(entry => ['subagent.completed', 'subagent.failed'].includes(entry.type));
    const boundaries = row.entries.filter(lifecycleEvent);
    const calls = boundaries.map(entry => records.get(entry)?.toolCallId);
    const activityCalls = row.entries.filter(entry => !lifecycleEvent(entry) && records.get(entry)?.parentToolCallId !== undefined)
      .map(entry => records.get(entry).parentToolCallId);
    const call = calls[0] ?? activityCalls[0];
    const valid = row.agentId !== null && identityText(call) && [...calls, ...activityCalls].every(value => value === call)
      && boundaries.every(entry => records.get(entry)?.toolCallId === entry.toolCallId);
    const names = boundaries.map(entry => records.get(entry)?.agentName).filter(value => value !== undefined);
    let conflict = starts.length > 1 || ends.length > 1 || row.entries.some(entry => counts.get(entry.id) > 1)
      || (calls.length > 1 && calls.some(value => value !== calls[0]))
      || (identityText(call) && activityCalls.some(value => value !== call))
      || names.some(value => !identityText(value) || value !== names[0])
      || (starts.length === 1 && ends.length === 1 && positions.get(ends[0]) < positions.get(starts[0]));
    const startData = starts.length === 1 ? records.get(starts[0]) : null;
    let parent = null, candidates = [];
    if (valid && !conflict) {
      if (startData) {
        parent = startData.parentId === undefined ? '' : identityText(startData.parentId) ? startData.parentId : null;
        candidates = parent === null ? [] : tools.get(key(parent, call)) || [];
        if (parent === row.agentId || parent === null
          || (!candidates.length && [...tools.values()].some(items => items[0].toolCallId === call))) conflict = true;
      } else {
        const sources = [...tools.values()].filter(items => items[0].toolCallId === call && source(items[0]) !== row.agentId);
        if (sources.length === 1) { candidates = sources[0]; parent = source(candidates[0]); }
        else if (sources.length > 1) conflict = true;
      }
    }
    const toolStarts = candidates.filter(entry => entry.type === 'tool.execution_start');
    const toolEnds = candidates.filter(entry => entry.type === 'tool.execution_complete');
    const task = toolStarts[0], result = toolEnds[0], data = task && records.get(task);
    if (toolStarts.length > 1 || toolEnds.length > 1 || candidates.some(entry => counts.get(entry.id) > 1)
      || (task && result && positions.get(result) < positions.get(task))
      || (task && starts[0] && positions.get(task) > positions.get(starts[0]))) conflict = true;
    const linked = valid && !conflict && parent !== null && task && data?.toolCallId === call
      && data.toolName === task.toolName && source(task) === parent;
    row.status = conflict ? 'conflict' : linked ? 'linked' : 'unlinked';
    row.toolCallId = valid ? call : null;
    row.parentAgentId = linked ? parent : null;
    row.parentStart = linked ? task : null;
    row.parentResult = null;
    row._candidate = { starts, ends, startData, task, result, data, candidates, valid };
    if (linked) {
      const identity = key(parent, call);
      if (!claims.has(identity)) claims.set(identity, []);
      claims.get(identity).push(row);
    }
  }
  for (const sharing of claims.values()) if (sharing.length > 1) for (const row of sharing) {
    row.status = 'conflict'; row.parentAgentId = null; row.parentStart = null;
  }
  for (const row of rows) {
    const { starts, ends, startData, task, result, data, candidates, valid } = row._candidate;
    delete row._candidate;
    const linked = row.status === 'linked';
    const end = ends[0], endData = end && records.get(end);
    row.lifecycle = !valid || ends.length > 1 || starts.length > 1 ? 'unknown' : !end ? 'missing'
      : !endData ? 'unknown' : end.type === 'subagent.failed' ? 'failed'
        : endData.cancelled === true ? 'cancelled'
          : endData.cancelled === undefined || endData.cancelled === false ? 'completed' : 'unknown';
    const args = data?.arguments;
    const recognized = linked && startData && data.toolName === 'task' && mcpFields.every(field => data[field] === undefined)
      && args && typeof args === 'object' && !Array.isArray(args) && args.mode === 'sync'
      && identityText(args.agent_type) && args.agent_type === startData.agentName
      && (startData.agentType === undefined || startData.agentType === args.agent_type)
      && (startData.executionMode === undefined || startData.executionMode === 'sync')
      && typeof args.prompt === 'string' && typeof args.description === 'string';
    const clipped = label => `${label} unavailable: Trace clipped event evidence to at most 12,000 UTF-16 code units and cannot recover the complete text.`;
    row.handoff = {
      status: !recognized ? 'unavailable' : args.prompt === '' && args.description === '' ? 'empty' : 'complete',
      prompt: recognized ? args.prompt : null, description: recognized ? args.description : null,
      note: recognized ? 'Exact recorded parent task arguments; these are the delegated prompt and description, not the child’s entire context.'
        : task?.truncated ? clipped('Handoff') : linked ? 'Handoff unavailable: the retained task contract is unrecognized or incomplete.'
          : 'Handoff unavailable: a unique parent task with complete matching evidence is not retained.',
    };
    const resultData = result && records.get(result);
    const matchedResult = recognized && resultData?.toolCallId === row.toolCallId
      && (resultData.toolName === undefined || resultData.toolName === 'task')
      && (typeof resultData.success === 'boolean' ? resultData.success : null) === result.success;
    const content = matchedResult && typeof resultData.result?.content === 'string' ? resultData.result.content : null;
    if (linked && resultData?.toolCallId === row.toolCallId) row.parentResult = result;
    row.result = {
      status: content === null ? 'unavailable' : content === '' ? 'empty' : 'complete', content,
      success: matchedResult && typeof resultData.success === 'boolean' ? resultData.success : null,
      note: (content !== null ? content === '' ? 'The parent recorded an empty result.content.' : 'Exact parent task result.content retained.'
        : result?.truncated ? clipped('Result') : !result ? 'Parent result not retained: it may be late, absent or omitted. This does not mean the child is still running.'
          : 'Parent result text unavailable: a recognized task contract and a unique complete matching text result are required.')
        + ' Child lifecycle completion is separate from the parent’s returned text. Reported success and text do not establish task correctness.',
    };
    row.notes = [row.status === 'conflict' ? 'Conflicting or duplicate source, call or child boundaries; parent unknown and no handoff/result association is inferred.'
      : linked ? 'Parent and child are linked by explicit recorded source and spawning tool-call identities.'
        : 'Parent unknown: matching evidence is missing or invalid. Names, proximity and chronological envelope parent IDs do not establish parentage.',
    'Delegation uses separate context. This does not prove that a particular file, instruction or parent message was included or excluded.',
    ...(history !== 'ready' ? ['History is incomplete or unavailable.'] : []), ...(omitted ? ['Older events were omitted.'] : [])];
    const selected = new Set([...row.entries, ...(linked ? [row.parentStart, row.parentResult].filter(Boolean) : [])]);
    row.links = entries.filter(entry => selected.has(entry) && counts.get(entry.id) === 1).map(entry => ({ entry,
      label: entry === row.parentStart ? 'Parent task arguments' : entry === row.parentResult ? 'Parent returned result'
        : entry.type === 'subagent.started' ? 'Child start' : lifecycleEvent(entry) ? 'Child lifecycle outcome' : 'Child activity' }));
  }
  return rows;
}

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

function relatedTarget(data) {
  if (!data || !data.arguments || typeof data.arguments !== 'object' || Array.isArray(data.arguments)) return null;
  if (mcpFields.some(field => Object.hasOwn(data, field))) {
    if (!validMcpMetadata(data) || !identityText(data.mcpConfigServerName)) return null;
    return { provider: `Configured MCP server: ${data.mcpConfigServerName} · Tool: ${data.mcpToolName}`,
      key: JSON.stringify([data.toolName, ...mcpFields.map(field => data[field] ?? null), data.arguments]),
      rule: 'Same exact source, recorded tool name and MCP provider metadata, including configured server key and server tool name; identical serialized arguments.' };
  }
  if (!requestedOperation(data) || ['origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(data, field))) return null;
  const fields = { view: ['path'], create: ['path'], edit: ['path'], web_fetch: ['url'],
    grep: ['pattern', 'paths', 'glob', 'type'], glob: ['pattern', 'paths'], powershell: ['command', 'shellId'] }[data.toolName];
  if (!fields) return null;
  return { provider: 'Provider / origin unknown; matching names do not establish the same implementation.',
    key: JSON.stringify([data.toolName, 'provider-unrecorded', ...fields.map(field => data.arguments[field] ?? null)]),
    rule: `Same exact source and recorded tool name; no MCP/provider markers on either call; identical literal ${fields.join(', ')} fields (including absence). Other supported options may differ. Provider and implementation equality remain unknown.` };
}

// Suggestions compare retained requests; the SDK does not expose a generic tool retry-of link.
export function recoveryAttempts(entries, options = {}, observedStages = actionStages(entries, options)) {
  const positions = new Map(entries.map((entry, index) => [entry, index])), counts = new Map();
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  const calls = toolBuckets(entries).map(({ boundaries, start }) => {
    const starts = boundaries.filter(entry => entry.type === 'tool.execution_start');
    const ends = boundaries.filter(entry => entry.type === 'tool.execution_complete'), end = ends[0];
    const source = boundaries[0].agentId, identity = toolIdentity(boundaries[0]);
    const unique = identity !== null && (source === '' || identityText(source)) && identityText(boundaries[0].toolCallId)
      && starts.length <= 1 && ends.length <= 1
      && boundaries.every(entry => counts.get(entry.id) === 1 && identityText(entry.id))
      && !(start && end && positions.get(end) < positions.get(start));
    const startData = start && explanationData(start), endData = end && explanationData(end);
    const data = unique && startData?.toolCallId === start?.toolCallId && identityText(startData?.toolName, 180)
      && startData.toolName === start.toolName && (!endData || (endData.toolCallId === end.toolCallId
        && (endData.toolName === undefined || endData.toolName === startData.toolName))) ? startData : null;
    const validResult = unique && endData && endData.toolCallId === end.toolCallId;
    const outcome = validResult && typeof endData.success === 'boolean' && endData.success === end.success
      ? endData.success ? 'success' : 'failure' : 'unknown';
    const stages = unique ? observedStages.get(boundaries[0].id) : null;
    const decisions = (stages?.stages || []).filter(stage => stage.type === 'permission.completed'
      && counts.get(stage.id) === 1);
    const adverse = decisions.filter(stage => ['denied', 'cancelled'].includes(stage.outcome));
    const linkedDecisions = decisions.slice(0, 3);
    const links = entries.filter(entry => boundaries.includes(entry) || linkedDecisions.some(stage => stage.id === entry.id))
      .filter(entry => counts.get(entry.id) === 1 && identityText(entry.id))
      .map(entry => ({ entry, label: entry.type === 'tool.execution_start' ? 'Arguments'
        : entry.type === 'tool.execution_complete' ? 'Result / error' : 'Permission decision' }));
    const notes = [];
    if (decisions.length > linkedDecisions.length) notes.push(`${decisions.length - linkedDecisions.length} additional permission decisions are not linked here (limit: 3); inspect their original timeline rows.`);
    if (!unique) notes.push('Conflicting, duplicated or unusable source/call identities; no related attempts are suggested.');
    if (!start) notes.push('Start not retained; arguments and matching target are unavailable.');
    else if (!data) notes.push('Complete matching arguments are unavailable or clipped; no target is inferred.');
    if (!end) notes.push('Result not retained; outcome unknown, not necessarily still running.');
    else if (!validResult) notes.push('Result evidence is incomplete, clipped or conflicting; outcome and result body are unknown.');
    const target = data && relatedTarget(data);
    if (!target) notes.push('Matching rule unavailable for this request or provider metadata; no suggestions are made.');
    const result = validResult ? Object.fromEntries(['result', 'error'].filter(field => Object.hasOwn(endData, field))
      .map(field => [field, endData[field]])) : null;
    const anchor = end || entries.find(entry => entry.id === adverse[0]?.id) || start || boundaries[0];
    return { id: (start || boundaries[0]).id, identity: identity ?? `unlinked:${boundaries[0].id}`, anchorId: anchor.id, anchorPosition: positions.get(anchor),
      startPosition: positions.get(start), source, toolName: data?.toolName || start?.toolName || 'Unknown tool',
      provider: target?.provider || 'Provider identity unavailable for matching.',
      arguments: data && Object.hasOwn(data, 'arguments') ? JSON.stringify(data.arguments, null, 2) : null,
      result: result && Object.keys(result).length ? JSON.stringify(result, null, 2) : null,
      outcome, permission: (stages?.stages || []).some(stage => stage.type === 'permission.completed' && counts.get(stage.id) !== 1)
        ? 'Permission unknown' : stages?.permission || 'Permission unknown', notes, links, target,
      failed: outcome === 'failure' || adverse.length > 0 };
  });
  return calls.filter(call => call.failed).map(original => {
    const matches = original.target ? calls.filter(call => call !== original && call.target
      && call.source === original.source && call.target.key === original.target.key
      && call.startPosition > original.anchorPosition) : [];
    return { id: original.identity, anchorId: original.anchorId, original, candidates: matches.slice(0, 3), omittedCandidates: Math.max(0, matches.length - 3),
      rule: original.target?.rule || 'No supported matching rule for this retained request.',
      notes: ['Related-attempt suggestions are not recorded retries or proof of recovery. No generic tool retry-of relationship is available in the inspected SDK.',
        'Only retained data is compared; missing attempts and results cannot be reconstructed. A later reported success does not change the earlier failure or prove process, tests or task success.',
        ...(options.history && options.history !== 'ready' ? ['Earlier history is unavailable or still loading.'] : []),
        ...(options.omitted ? ['Older events were omitted from the retained window.'] : [])] };
  });
}

const validationStatements = new Map(['Tests', 'Build', 'Checks'].flatMap(subject => ['passed', 'failed']
  .map(reported => [`${subject} ${reported}.`, { kind: subject.toLowerCase(), reported }])));

function validationCommand(data) {
  if (data?.toolName !== 'powershell' || [...mcpFields, 'origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(data, field))) return null;
  const args = data.arguments;
  const fields = { command: argumentText, description: value => argumentText(value) && value.length <= 100,
    timeout_ms: value => Number.isSafeInteger(value) && value > 0, mode: value => value === 'sync',
    shellId: value => identityText(value), detach: value => value === false,
    initial_wait: value => typeof value === 'number' && value >= 30 && value <= 600 };
  if (!args || typeof args !== 'object' || Array.isArray(args) || !argumentText(args.command) || !fields.description(args.description)
    || !Object.entries(args).every(([key, value]) => Object.hasOwn(fields, key) && fields[key](value))) return null;
  const kind = new Map([['npm test', 'tests'], ['npm run build', 'build'], ['npm run check', 'checks'], ['npm run lint', 'lint']]).get(args.command)
    || (/^node --test(?: [A-Za-z0-9_.][A-Za-z0-9_./\\-]*)?$/.test(args.command) ? 'tests' : null);
  return kind ? { kind, command: args.command } : null;
}

function validationExit(data) {
  const contents = data?.result?.contents;
  if (!Array.isArray(contents) || contents.length > 64 || contents.some(block => !block || typeof block !== 'object'
    || Array.isArray(block) || !identityText(block.type))) return null;
  const exits = contents.filter(block => block.type === 'shell_exit'), shell = exits[0];
  if (exits.length !== 1 || !identityText(shell.shellId) || !Number.isSafeInteger(shell.exitCode)
    || (shell.outputTruncated !== undefined && typeof shell.outputTruncated !== 'boolean')
    || (shell.outputPreview !== undefined && typeof shell.outputPreview !== 'string')
    || (shell.cwd !== undefined && typeof shell.cwd !== 'string')
    || (data.shellExecution !== undefined && (!data.shellExecution || !Number.isSafeInteger(data.shellExecution.exitCode)
      || data.shellExecution.exitCode !== shell.exitCode))) return null;
  return shell;
}

// Interpret one matched result per invocation; output prose never establishes a process or task outcome.
export function toolOutcomes(entries) {
  const outcomes = new Map(), counts = new Map(), positions = new Map(entries.map((entry, index) => [entry, index]));
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  for (const { boundaries, start, data } of toolBuckets(entries)) {
    const result = boundaries.find(entry => entry.type === 'tool.execution_complete');
    if (!data || !result || positions.get(start) >= positions.get(result)
      || boundaries.some(entry => counts.get(entry.id) !== 1 || !identityText(entry.id) || !identityText(entry.toolCallId)
        || !(entry.agentId === '' || identityText(entry.agentId)) || entry.truncated !== false
        || (Object.hasOwn(entry, 'protectedContentOmitted') && entry.protectedContentOmitted !== false))) continue;
    const end = explanationData(result);
    if (!end || typeof end.success !== 'boolean' || end.success !== result.success || Object.hasOwn(end, 'error')
      || [data, end].some(record => [...mcpFields, 'origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(record, field)))) continue;
    const operation = requestedOperation(data), validation = validationCommand(data);
    if (!operation && !validation) continue;
    const basis = 'This uses an authored argument contract; provider and implementation remain unknown. ';
    const separate = 'Missing validation is unknown. The validation overview shows separate retained observations, not checks linked to this operation.';
    let kind, means, unknown;
    if (data.toolName === 'powershell') {
      const shell = validationExit(end);
      if (!shell || (data.arguments.shellId !== undefined && data.arguments.shellId !== shell.shellId)) continue;
      kind = 'process';
      means = `The tool protocol reports ${end.success ? 'success' : 'failure'}. The typed process exit ${shell.exitCode} reports ${shell.exitCode === 0 ? 'a zero' : 'a nonzero'} exit for this command only.`;
      unknown = `Test assertion counts and coverage remain unknown. Output text and assistant assertions do not verify the task. ${basis}${separate}`;
    } else if (end.success === true && typeof end.result?.content === 'string' && !Array.isArray(end.result)) {
      if (operation.categories.includes('Read')) {
        kind = 'read'; means = 'For this supported read contract, tool success reports returned data. Inspect the literal result for what was returned.';
        unknown = `Whether the returned data is relevant, useful or sufficient for the request remains unknown. ${basis}${separate}`;
      } else if (operation.categories.includes('Edit')) {
        kind = 'edit'; means = 'Tool success for this supported edit contract means the operation reported a change. Inspect the literal result for its report.';
        unknown = `The change’s correctness and the overall task outcome remain unknown. ${basis}${separate}`;
      }
    }
    if (kind) outcomes.set(result.id, { kind, means, unknown });
  }
  return outcomes;
}

function canonicalArguments(value) {
  let nodes = 0;
  function encode(value, depth) {
    if (depth > 12 || ++nodes > 512) throw new Error('Argument bound');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
    if (typeof value === 'number' && Number.isFinite(value)) return Object.is(value, -0) ? '-0' : JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(item => encode(item, depth + 1)).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort()
      .map(key => `${JSON.stringify(key)}:${encode(value[key], depth + 1)}`).join(',')}}`;
    throw new Error('Unsupported argument');
  }
  try { const encoded = encode(value, 0); return encoded.length <= 8000 ? encoded : null; } catch { return null; }
}

export function argumentComparisonCalls(retained) {
  const entries = retained.slice(-300), counts = new Map(), positions = new Map(entries.map((entry, index) => [entry, index]));
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  return toolBuckets(entries).filter(bucket => bucket.start).map(({ boundaries, start }) => {
    const ends = boundaries.filter(entry => entry.type === 'tool.execution_complete'), end = ends[0];
    const identityValid = boundaries.filter(entry => entry.type === 'tool.execution_start').length === 1 && ends.length <= 1
      && (!end || positions.get(start) < positions.get(end)) && boundaries.every(entry => counts.get(entry.id) === 1
        && identityText(entry.id) && identityText(entry.toolCallId) && (entry.agentId === '' || identityText(entry.agentId))
        && typeof entry.timestamp === 'string' && typeof entry.truncated === 'boolean'
        && typeof entry.evidence === 'string' && entry.evidence.length <= 12000);
    const data = explanationData(start), result = end && explanationData(end);
    const matched = identityValid && data?.toolCallId === start.toolCallId && data?.toolName === start.toolName
      && identityText(data?.toolName, 180) && (!end || ((end.toolName === '' || end.toolName === data.toolName)
        && (!result || (result.toolCallId === end.toolCallId && (result.toolName === undefined || result.toolName === data.toolName)
          && [...mcpFields, 'origin', 'overridesBuiltInTool'].every(field => !Object.hasOwn(result, field)
            || (Object.hasOwn(data, field) && result[field] === data[field]))))));
    const hasMcp = data && mcpFields.some(field => Object.hasOwn(data, field));
    const args = data?.arguments;
    let limitation = !identityValid ? 'Conflicting, duplicated or unusable source/call boundaries; comparison unavailable.'
      : Object.hasOwn(start, 'protectedContentOmitted') && typeof start.protectedContentOmitted !== 'boolean'
        ? 'Protected-content omission status is invalid; completeness of the arguments and original evidence is unknown.'
      : start.protectedContentOmitted === true ? 'Protected fields were omitted from this event, so complete arguments cannot be established. Original evidence is also incomplete and cannot recover the omitted values.'
      : start.truncated ? 'Trace clipped this invocation; complete arguments are unavailable.'
        : !matched ? 'Complete matching source, call and tool evidence is unavailable.'
          : ['origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(data, field)) ? 'Unsupported provider markers; historical contract unknown.'
            : !args || typeof args !== 'object' || Array.isArray(args) ? 'A complete JSON argument object is not recorded.'
              : hasMcp ? !validMcpMetadata(data) || !identityText(data.mcpConfigServerName)
                ? 'Exact configured MCP server and tool identity unavailable; display names cannot establish compatibility.' : ''
                : !requestedOperation(data) ? 'Unsupported or differing ordinary argument schema; unknown fields, types or required values prevent a precise comparison.' : '';
    if (!limitation && canonicalArguments(args) === null) limitation = 'Argument bound exceeded: depth 12, 512 values or 8,000 serialized characters. Inspect the original evidence.';
    const key = limitation ? null : JSON.stringify([data.toolName, hasMcp
      ? mcpFields.map(field => Object.hasOwn(data, field) ? [field, data[field]] : [field]) : 'provider-unrecorded']);
    return { start: Object.freeze({ ...start, ...(start.hostOutput ? { hostOutput: Object.freeze({ ...start.hostOutput }) } : {}) }),
      source: start.agentId === '' ? 'Main chat' : identityText(start.agentId) ? `Agent ${start.agentId}` : 'Source unavailable',
      identityValid, key, arguments: limitation ? null : args, limitation,
      mode: hasMcp ? 'literal-json' : 'ordinary-contract',
      provider: hasMcp ? `Recorded MCP metadata: ${JSON.stringify(Object.fromEntries(mcpFields.filter(field => Object.hasOwn(data, field)).map(field => [field, data[field]])))}`
        : 'Provider / origin unknown; the recorded name does not establish implementation identity.' };
  });
}

export function retainedArgumentCall(entries, selected) {
  if (!selected?.identityValid) return false;
  const current = argumentComparisonCalls(entries).find(call => call.start.id === selected.start.id);
  return Boolean(current?.identityValid && current.key === selected.key && current.limitation === selected.limitation
    && ['id', 'type', 'timestamp', 'agentId', 'toolCallId', 'toolName', 'evidence', 'truncated', 'protectedContentOmitted']
      .every(field => current.start[field] === selected.start[field])
    && JSON.stringify(current.start.hostOutput) === JSON.stringify(selected.start.hostOutput));
}

// JSON members and array indexes only: selection establishes neither retry intent nor schema history.
export function compareToolArguments(first, second) {
  const unavailable = note => ({ status: 'unavailable', rows: [], note, omittedRows: 0, omittedValues: 0 });
  if (!first || !second) return unavailable('Choose two retained invocations.');
  if (toolIdentity(first.start) === toolIdentity(second.start)) return unavailable('Choose two distinct invocations.');
  if (first.limitation || second.limitation) return unavailable([first.limitation, second.limitation].filter(Boolean).join(' '));
  if (!first.key || first.key !== second.key) return unavailable('Recorded tool/provider identities or supported request contracts differ; no precise comparison is available. Inspect both originals.');
  const rows = [], counts = { added: 0, removed: 0, changed: 0, identical: 0 };
  let omittedRows = 0, omittedValues = 0, characters = 0;
  function walk(before, after, path, hasBefore = true, hasAfter = true) {
    const object = value => value !== null && typeof value === 'object';
    if (hasBefore && hasAfter && object(before) && object(after) && Array.isArray(before) === Array.isArray(after)) {
      const keys = Array.isArray(before) ? Array.from({ length: Math.max(before.length, after.length) }, (_, index) => index)
        : [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
      if (keys.length) {
        for (const key of keys) walk(before[key], after[key], `${path}[${JSON.stringify(key)}]`, Object.hasOwn(before, key), Object.hasOwn(after, key));
        return;
      }
    }
    const left = hasBefore ? canonicalArguments(before) : 'Absent', right = hasAfter ? canonicalArguments(after) : 'Absent';
    const status = !hasBefore ? 'added' : !hasAfter ? 'removed' : left === right ? 'identical' : 'changed';
    counts[status]++;
    if (rows.length >= 80 || characters + (path || '$').length > 12000) { omittedRows++; return; }
    characters += (path || '$').length;
    function display(value) {
      if (value.length > 1000 || characters + value.length > 12000) { omittedValues++; return null; }
      characters += value.length; return value;
    }
    rows.push({ path: path || '$', status, before: display(left), after: display(right) });
  }
  walk(first.arguments, second.arguments, '');
  return { status: 'compared', rows, counts, omittedRows, omittedValues,
    note: (first.mode === 'literal-json'
      ? 'Literal JSON comparison only. Exact recorded MCP identity matches; historical tool schema and field meaning are unknown. These are JSON member differences, not verified parameter changes.'
      : 'Both requests match the same authored ordinary argument contract. Provider and implementation identity remain unknown.')
      + ' Object key order is ignored; arrays compare by index, so an insertion can change later indexes. Strings, types and whitespace remain literal; JSON escapes represent newlines and quotes. Reasons for changes and retry relationships are unknown.'
      + ' Display limits: 80 rows, 1,000 characters per value and 12,000 total path/value characters. Omitted values are not previews; inspect both original calls for retained evidence.' };
}

// Exact recorded requests only; a repeated request is not evidence of a retry or a loop.
export function repeatedActivity(retained, { history = 'ready', omitted = 0 } = {}) {
  const entries = retained.slice(-300), counts = new Map(), positions = new Map(entries.map((entry, index) => [entry, index]));
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  const patterns = new Map(); let unclassifiedCalls = 0, unlinkedBoundaries = 0;
  for (const { boundaries, start } of toolBuckets(entries)) {
    if (toolIdentity(boundaries[0]) === null) { unlinkedBoundaries++; continue; }
    const starts = boundaries.filter(entry => entry.type === 'tool.execution_start');
    const ends = boundaries.filter(entry => entry.type === 'tool.execution_complete'), end = ends[0];
    const unique = starts.length === 1 && ends.length <= 1 && (!end || positions.get(start) < positions.get(end))
      && boundaries.every(entry => counts.get(entry.id) === 1 && identityText(entry.id) && identityText(entry.toolCallId)
        && typeof entry.truncated === 'boolean' && (entry.agentId === '' || identityText(entry.agentId)));
    const data = unique && explanationData(start), args = data?.arguments;
    const hasMcp = data && mcpFields.some(field => Object.hasOwn(data, field));
    const supported = data && data.toolCallId === start.toolCallId && data.toolName === start.toolName && identityText(data.toolName, 180)
      && (!Object.hasOwn(start, 'protectedContentOmitted') || start.protectedContentOmitted === false)
      && !['origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(data, field))
      && args && typeof args === 'object' && !Array.isArray(args)
      && (hasMcp ? validMcpMetadata(data) && identityText(data.mcpConfigServerName) : requestedOperation(data));
    const canonical = supported ? canonicalArguments(args) : null;
    if (canonical === null) { unclassifiedCalls++; continue; }
    const providerKey = hasMcp ? mcpFields.map(field => Object.hasOwn(data, field) ? [field, data[field]] : [field]) : 'provider-unrecorded';
    const key = JSON.stringify([start.agentId, data.toolName, providerKey, canonical]);
    if (!patterns.has(key)) patterns.set(key, { id: key, toolName: data.toolName, source: start.agentId,
      provider: hasMcp ? `Configured MCP server: ${data.mcpConfigServerName} · Tool: ${data.mcpToolName}`
        : 'Provider / origin unknown; matching names do not establish the same implementation.',
      rule: 'Same exact source, recorded tool name and provider metadata; all supported recorded arguments equal after object key order only is normalized. Array order, types, literal Unicode and whitespace remain significant.'
        + (hasMcp ? ' MCP arguments are compared as recorded JSON; their historical tool schema and meaning are unknown.' : ' Ordinary requests use the supported authored argument contracts; their implementation is unknown.'),
      arguments: JSON.stringify(args, null, 2), occurrences: [], count: 0, toolFailures: 0, processFailures: 0, missingResults: 0, unknownResults: 0 });
    const pattern = patterns.get(key), endData = end && explanationData(end);
    const validResult = endData && endData.toolCallId === end.toolCallId
      && (endData.toolName === undefined || endData.toolName === data.toolName)
      && (end.toolName === '' || end.toolName === data.toolName)
      && typeof endData.success === 'boolean' && endData.success === end.success
      && [...mcpFields, 'origin', 'overridesBuiltInTool'].every(field => !Object.hasOwn(endData, field)
        || (Object.hasOwn(data, field) && endData[field] === data[field]));
    const result = validResult ? end : null, toolSuccess = result ? endData.success : null;
    const exitCode = result && !hasMcp && data.toolName === 'powershell' ? validationExit(endData)?.exitCode ?? null : null;
    const freeze = entry => Object.freeze({ ...entry, ...(entry.hostOutput ? { hostOutput: Object.freeze({ ...entry.hostOutput }) } : {}) });
    const originalStart = freeze(start), originalResult = result ? freeze(result) : null;
    pattern.occurrences.push({ id: toolIdentity(start), start: originalStart, result: originalResult, toolSuccess, exitCode,
      resultState: result ? 'recorded' : end ? 'unknown' : 'missing', links: [originalStart, originalResult].filter(Boolean) });
    pattern.count++;
    if (toolSuccess === false) pattern.toolFailures++;
    if (exitCode !== null && exitCode !== 0) pattern.processFailures++;
    if (!end) pattern.missingResults++; else if (!result) pattern.unknownResults++;
  }
  return { patterns: [...patterns.values()].filter(pattern => pattern.count >= 2), unclassifiedCalls, unlinkedBoundaries,
    notes: [`Only up to 300 retained events are compared (${entries.length} here), across all timeline filters and views. Two or more distinct usable call IDs form a pattern; start and result count as one invocation.`,
      'Argument comparison is bounded to depth 12, 512 values and 8,000 serialized characters. Unsupported requests, clipped starts, protected-content omissions or invalid omission markers, incomplete MCP identities, unsupported provider markers and ambiguous identities remain unclassified; they may conceal repetition.',
      'Counts describe exact recorded requests, not semantic similarity, retry intent, cause, wasted work or an agent being stuck. No action is taken. Later success does not change an earlier failure or establish recovery.',
      'Tool protocol failure and typed nonzero process exit are separate counts and can overlap. Missing or conflicting results remain unknown, not necessarily still running. Process exit is inspected only for supported ordinary powershell requests, never from output text.',
      ...(history !== 'ready' ? ['Earlier history is unavailable or still loading.'] : []),
      ...(omitted ? [`${omitted} older events were omitted from the retained window.`] : []),
      ...(retained.length > entries.length ? [`${retained.length - entries.length} additional supplied events are outside this comparison window.`] : [])] };
}

// These literal requests describe scope only; neither a tool name nor exit zero verifies a suite.
export function validationChecks(entries, { includeIncomplete = false } = {}) {
  const counts = new Map(), positions = new Map(entries.map((entry, index) => [entry, index]));
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  const checks = [];
  for (const { boundaries, start } of toolBuckets(entries)) {
    const starts = boundaries.filter(entry => entry.type === 'tool.execution_start');
    const ends = boundaries.filter(entry => entry.type === 'tool.execution_complete'), result = ends[0];
    if (starts.length !== 1 || ends.length > 1 || (!includeIncomplete && ends.length !== 1)
      || (result && positions.get(start) >= positions.get(result))
      || boundaries.some(entry => counts.get(entry.id) !== 1 || !identityText(entry.id) || !identityText(entry.toolCallId)
        || typeof entry.truncated !== 'boolean' || !(entry.agentId === '' || identityText(entry.agentId)))) continue;
    const data = explanationData(start), recordedEnd = result && explanationData(result), request = validationCommand(data);
    if (!request || data.toolCallId !== start.toolCallId || data.toolName !== start.toolName) continue;
    const validEnd = result && (result.truncated || (recordedEnd && recordedEnd.toolCallId === result.toolCallId
      && typeof recordedEnd.success === 'boolean' && recordedEnd.success === result.success
      && (recordedEnd.toolName === undefined || recordedEnd.toolName === data.toolName)))
      && !(recordedEnd && [...mcpFields, 'origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(recordedEnd, field)))
      && (result.toolName === '' || result.toolName === data.toolName);
    if (!includeIncomplete && !validEnd) continue;
    const end = validEnd ? recordedEnd : null;
    const shell = validationExit(end), output = typeof end?.result?.content === 'string' ? end.result.content : null;
    checks.push({ id: validEnd ? result.id : start.id, source: start.agentId, ...request, start, result: validEnd ? result : null, output,
      exitCode: shell?.exitCode ?? null, toolSuccess: typeof end?.success === 'boolean' ? end.success : null,
      notes: ['Literal command scope only; package scripts, selected suites, assertion counts and suite coverage are not inspected. Provider / implementation origin remains unknown.',
        'Tool success describes the tool protocol. A typed process exit describes this command only; exit zero does not prove tests or the whole task correct. Output text is not authoritative assertion counts.',
        'Only result.content is displayed literally. Complete capture of process output is unknown, even when no shortening flag is present.',
        ...(validEnd && (shell?.outputTruncated === true || retainedHostOutput(result)) ? ['Host-shortened output: the recorded shell preview is incomplete.'] : []),
        ...(validEnd && result.truncated ? ['Trace clipped the raw result; literal output and process status are unavailable.'] : []),
        ...(!result ? ['Completion not retained; outcome unknown, not necessarily still running.']
          : !validEnd ? ['Result evidence is incomplete or conflicting; it is not linked to this request. Tool status, process exit and output are unknown; inspect the original timeline boundaries.'] : []),
        ...(!shell ? ['Process exit unknown: a unique valid typed shell_exit is absent, malformed or conflicts with another recorded status.'] : [])] });
  }
  return checks;
}

export function validationOverview(entries, { history = 'ready', omitted = 0 } = {}) {
  const positions = new Map(entries.map((entry, index) => [entry, index])), latest = new Map();
  const checks = validationChecks(entries, { includeIncomplete: true }).map(check => ({ ...check,
    id: check.start.id, timestamp: check.start.timestamp, resultTimestamp: check.result?.timestamp ?? null,
    assertionCounts: null, latestResult: false,
    notes: [...check.notes, 'Test and suite assertion counts, skipped tests and coverage remain unknown; no authoritative complete result schema is inspected.'] }));
  for (const check of checks.filter(check => check.result).sort((a, b) => positions.get(a.result) - positions.get(b.result))) {
    latest.set(JSON.stringify([check.source, check.command]), check);
  }
  for (const check of latest.values()) check.latestResult = true;
  const buckets = toolBuckets(entries), unlinkedBoundaries = buckets.filter(bucket => toolIdentity(bucket.boundaries[0]) === null).length;
  return { checks, unclassifiedCalls: buckets.length - unlinkedBoundaries - checks.length, unlinkedBoundaries,
    notes: [`Only up to 300 retained events are considered (${entries.length} here); no checks are run by Trace.`,
      'One recognized operation per exact usable source and call ID, not per start/result boundary. Conflicting identities stay unclassified; unusable IDs leave separate boundaries, not an inferred operation count.',
      'Unclassified tool calls have unknown validation status: unsupported commands or schemas, wrappers, missing starts, clipped or conflicting evidence may conceal validation.',
      'Latest result means the last compatible retained completion for this exact source and literal command in recorded order. It does not establish the same shell, environment, package script or suite. Inspect original arguments for differences; missing or invalid timestamps leave chronological time unknown.',
      ...(history !== 'ready' ? ['Earlier history is unavailable or still loading.'] : []),
      ...(omitted ? [`${omitted} older events were omitted from the retained window.`] : [])] };
}

export function validationClaims(entries, { history = 'ready', omitted = 0 } = {}) {
  const checks = validationChecks(entries), counts = new Map();
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  return entries.flatMap(entry => {
    if (entry.type !== 'assistant.message' || counts.get(entry.id) !== 1 || !identityText(entry.id)
      || !(entry.agentId === '' || identityText(entry.agentId))) return [];
    const data = explanationData(entry), statement = data?.content, rule = validationStatements.get(statement);
    if (!rule || Object.hasOwn(data, 'chunkCount') || Object.hasOwn(data, 'chunkIndex')) return [];
    const candidates = checks.filter(check => check.source === entry.agentId && check.kind === rule.kind);
    return [{ id: entry.id, entry, statement, source: entry.agentId, ...rule, candidates: candidates.slice(0, 3),
      omittedCandidates: Math.max(0, candidates.length - 3),
      notes: ['Recognition rule: the entire assistant message exactly equals Tests, Build or Checks followed by passed. or failed. Case, spacing and punctuation are literal.',
        'Candidate results are not supporting links. Same recorded source and command category only; first three in recorded order. No proximity, name, citation or chronological parent establishes support.',
        'Link a result only if you recognize it as the intended evidence. A user-linked result is not verification of the statement.',
        'A result missing from retained history is not proof that no check ran.',
        ...(history !== 'ready' ? ['Earlier history is unavailable or still loading.'] : []), ...(omitted ? ['Older events were omitted.'] : [])] }];
  });
}

function sameValidationEntry(entries, expected) {
  if (!expected) return false;
  const matches = entries.filter(entry => entry.id === expected.id);
  return matches.length === 1 && JSON.stringify(matches[0]) === JSON.stringify(expected);
}

export function retainedValidationLink(entries, link) {
  if (!link || ![link.claim, link.start, link.result].every(entry => sameValidationEntry(entries, entry))) return false;
  const claim = validationClaims([link.claim])[0];
  const boundaries = entries.filter(entry => entry.agentId === link.start.agentId && entry.toolCallId === link.start.toolCallId);
  return Boolean(claim && validationChecks(boundaries).some(check => check.start.id === link.start.id && check.id === link.result.id
    && check.source === claim.source && check.kind === claim.kind));
}

export function linkValidationClaim(entries, claim, check) {
  const freeze = entry => Object.freeze({ ...entry, ...(entry.hostOutput ? { hostOutput: Object.freeze({ ...entry.hostOutput }) } : {}) });
  if (!claim?.entry || !check?.start || !check?.result) return null;
  const link = { claim: claim.entry, start: check.start, result: check.result };
  return retainedValidationLink(entries, link) ? Object.freeze(Object.fromEntries(Object.entries(link).map(([key, entry]) => [key, freeze(entry)]))) : null;
}

const retrievalNames = new Set(['view', 'grep', 'glob', 'web_fetch']);

function requestedExtent(data) {
  if (!data || !requestedOperation(data) || !retrievalNames.has(data.toolName)
    || [...mcpFields, 'origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(data, field))) return { requested: [], limited: false };
  const args = data.arguments, requested = [];
  let limited = false;
  if (data.toolName === 'view') {
    if (args.view_range) {
      const [first, last] = args.view_range;
      requested.push(last === -1 ? `Line ${first} through end requested (1-based)` : `Lines ${first}–${last} requested (1-based, inclusive)`);
      limited = first > 1 || last !== -1;
    }
    if (args.forceReadLargeFiles !== undefined) requested.push(args.forceReadLargeFiles
      ? 'Large-file limit override requested' : 'Large-file limit override not requested');
  } else if (data.toolName === 'grep') {
    requested.push({ content: 'Matching-line excerpts requested', files_with_matches: 'Matching file paths requested', count: 'Per-file counts requested' }[args.output_mode]
      || 'Search output mode not recorded');
    limited = args.output_mode === 'content' || args.head_limit > 0;
    if (args.head_limit !== undefined) requested.push(args.head_limit > 0 ? `First ${args.head_limit} results requested` : 'Requested head_limit: 0; returned count unknown');
    for (const [field, direction] of [['-A', 'after'], ['-B', 'before'], ['-C', 'around']]) {
      if (args[field] !== undefined) requested.push(`${args[field]} context line${args[field] === 1 ? '' : 's'} ${direction} matches requested`);
    }
    if (args['-n'] !== undefined) requested.push(args['-n'] ? 'Line numbers requested' : 'Line numbers not requested');
  } else if (data.toolName === 'web_fetch') {
    if (args.start_index !== undefined) requested.push(`Start index ${args.start_index} requested (character pagination)`);
    if (args.max_length !== undefined) requested.push(`At most ${args.max_length} characters requested`);
    limited = args.start_index > 0 || args.max_length !== undefined;
  }
  return { requested, limited };
}

export function toolExtents(entries, { history = 'ready', omitted = 0 } = {}) {
  const descriptions = new Map();
  for (const { boundaries, data } of toolBuckets(entries)) {
    const request = requestedExtent(data);
    const ends = boundaries.filter(entry => entry.type === 'tool.execution_complete');
    const end = ends.length === 1 ? ends[0] : null;
    const result = end && explanationData(end);
    const matching = result?.toolCallId === end?.toolCallId && result?.success === end?.success;
    const text = matching && typeof result?.result?.content === 'string' ? result.result.content : null;
    const successful = matching && result?.success === true && result.error === undefined;
    const returned = matching && result?.success === false ? 'Reported failure; output is diagnostic evidence, not retrieved extent.'
      : successful && text !== null ? `${text.length} UTF-16 code units retained in result.content; resource extent unknown.`
      : 'Returned extent unknown; complete matching result text is unavailable.';
    for (const entry of boundaries) {
      const host = retainedHostOutput(entry);
      const badges = ['Unknown coverage'], notes = [
        'Resource total and returned coverage are unknown. Requested ranges and limits do not prove what was returned; overlapping requests are not merged into coverage.',
      ];
      if (request.limited) {
        badges.unshift('Requested limited scope');
        notes.push('The request selects a range, excerpt or limit; this does not establish host-shortened output.');
      }
      if (data?.toolName === 'grep' || data?.toolName === 'glob') notes.push('Search excerpts, file lists and per-file counts are not file contents or proof of complete coverage.');
      if (successful && text === '') notes.push('An empty recorded response does not prove an empty file or search space.');
      if (host) {
        badges.push('Host-shortened preview');
        notes.push(`The host recorded result.contents shell_exit.outputTruncated: true; the shell output preview is incomplete.${host.previewCodeUnits === null ? ' Preview length unavailable.' : ` Recorded preview: ${host.previewCodeUnits} UTF-16 code units.`}`);
        if (entry.truncated) notes.push('This host fact is a separate validated projection from the original event; the corresponding raw payload is clipped. The JSON is not reconstructed.');
      } else notes.push('Host shortening is unknown. An absent or false preview flag does not prove complete output; result prose and detailedContent length are not truncation evidence.');
      if (entry.truncated) {
        badges.push('Trace-clipped evidence');
        notes.push('Trace clipped this event’s raw evidence to at most 12,000 UTF-16 code units, preserving surrogate pairs. This is separate from host output shortening.');
      }
      if (omitted > 0) notes.push(`Trace retains at most 300 events; ${omitted} older event${omitted === 1 ? '' : 's'} omitted. This history limit is separate from result shortening.`);
      if (history !== 'ready') notes.push(historyScopeState(history)[1]);
      descriptions.set(entry.id, { requested: request.requested, requestedLimited: request.limited,
        coverage: 'Unknown coverage', returned, hostShortened: Boolean(host), traceClipped: Boolean(entry.truncated), badges, notes });
    }
  }
  return descriptions;
}

function combinedExtent(boundaries, extents) {
  const values = boundaries.map(entry => extents.get(entry.id));
  const end = boundaries.find(entry => entry.type === 'tool.execution_complete');
  const hostShortened = values.some(value => value.hostShortened);
  return { ...extents.get(end?.id || boundaries[0].id),
    hostShortened, traceClipped: values.some(value => value.traceClipped),
    badges: [...new Set(values.flatMap(value => value.badges))],
    notes: [...new Set(values.flatMap(value => value.notes))].filter(note => !hostShortened || !note.startsWith('Host shortening is unknown.')) };
}

export function retrievalLedger(entries, { history = 'ready', omitted = 0 } = {}) {
  const rows = [], unclassified = [], references = new Set();
  const extents = toolExtents(entries, { history, omitted });
  const ids = new Map(), positions = new Map(entries.map((entry, index) => [entry, index]));
  for (const entry of entries) ids.set(entry.id, (ids.get(entry.id) || 0) + 1);
  let other = 0;
  for (const { boundaries, start, data } of toolBuckets(entries)) {
    const end = boundaries.find(entry => entry.type === 'tool.execution_complete');
    const compatible = data && (!end || positions.get(start) < positions.get(end)) && boundaries.every(entry => {
      const record = explanationData(entry);
      return ids.get(entry.id) === 1 && identityText(entry.id) && identityText(entry.toolCallId)
        && (entry.agentId === '' || identityText(entry.agentId)) && entry.truncated === false
        && (!Object.hasOwn(entry, 'protectedContentOmitted') || entry.protectedContentOmitted === false)
        && record && ![...mcpFields, 'origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(record, field));
    });
    const operation = compatible && requestedOperation(data);
    const links = boundaries.map(entry => ({ id: entry.id,
      label: entry.type === 'tool.execution_start' ? 'Original request evidence' : 'Original result evidence' }));
    if (!operation) {
      const hostShortened = boundaries.some(entry => retainedHostOutput(entry));
      const traceClipped = boundaries.some(entry => entry.truncated === true);
      unclassified.push({ id: boundaries[0].id, links, extent: { requested: [], requestedLimited: false,
        coverage: 'Unknown coverage', returned: 'Returned extent unknown; complete compatible request/result evidence is unavailable.',
        hostShortened, traceClipped,
        badges: ['Unknown coverage', ...(hostShortened ? ['Host-shortened preview'] : []), ...(traceClipped ? ['Trace-clipped evidence'] : [])],
        notes: ['No requested or returned resource extent is inferred from these unclassified boundaries.',
          ...(hostShortened ? ['A boundary has a validated host-shortened output preview; this does not establish compatible retrieval.'] : []),
          ...(traceClipped ? ['Trace clipped a boundary’s raw evidence; complete evidence cannot be recovered.'] : [])] },
        note: boundaries.some(entry => entry.truncated)
          ? 'Evidence shortened. Request and retrieval outcome are unknown; the complete event cannot be recovered.'
          : 'Retrieval status unknown. Complete, unambiguous recognized request and source evidence is unavailable.' });
      continue;
    }
    if (!retrievalNames.has(data.toolName)) { other++; continue; }
    const args = data.arguments, name = data.toolName;
    const targets = name === 'view' ? [args.path] : name === 'web_fetch' ? [args.url]
      : args.paths === undefined ? [] : Array.isArray(args.paths) ? [...args.paths] : [args.paths];
    for (const target of targets) references.add(JSON.stringify([start.agentId, name === 'web_fetch' ? 'url' : 'path', target]));
    const extent = combinedExtent(boundaries, extents), partial = extent.requestedLimited;
    const request = `Requested ${name}${name === 'grep' && args.output_mode === undefined ? ' · output mode not recorded' : ''}`
      + Object.entries(args).map(([key, value]) => `\n${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`).join('');
    const result = end && explanationData(end);
    const success = result && result.success === end.success ? result.success : undefined;
    const text = typeof result?.result?.content === 'string' ? result.result.content : null;
    const status = !end ? 'missing' : success === false ? 'failed'
      : success !== true || result.error !== undefined || text === null ? 'unavailable' : text === '' ? 'empty' : 'returned';
    const statusLabel = { missing: 'Completion not observed', failed: 'Reported failure',
      unavailable: success === true && result.error === undefined ? 'Reported success · text unavailable' : 'Outcome unknown · returned text unavailable',
      empty: 'Reported success · empty response', returned: 'Reported success · text returned' }[status];
    const kindNote = name === 'view' ? 'A view may target a file, image or directory; returned extent and resource type remain unknown.'
      : name === 'glob' || (name === 'grep' && args.output_mode === 'files_with_matches') ? 'File-list output is not file contents; filenames are not extracted from result prose.'
      : name === 'grep' && args.output_mode === 'count' ? 'Count output is not file contents; coverage and matching resources are not inferred from result prose.'
      : name === 'grep' && args.output_mode === 'content' ? 'Search snippets are excerpts, not complete file contents; total matches and coverage remain unknown.'
      : name === 'grep' ? 'Search output mode is not recorded; result prose does not establish file contents or coverage.'
      : 'External response text is recorded evidence; document completeness and current contents remain unknown.';
    const resultNote = status === 'missing' ? 'A missing completion does not mean the operation is still running.'
      : status === 'failed' ? 'Returned text, if any, is failure diagnostic evidence, not retrieved content.'
      : status === 'unavailable' ? 'A success flag with no text, unknown or contradictory outcome cannot establish returned information. Display-only detailedContent is not used.'
      : status === 'empty' ? 'An empty recorded response does not prove that the target or search space was empty.'
      : 'Only result.content is shown. It may already be shortened by the host; detailedContent is separate display data, not proof of complete or model-delivered information.';
    rows.push({ id: start.id, toolName: name, source: describeActor(start).source, targets, request, status, statusLabel,
      content: status === 'returned' || status === 'empty' ? text : null, partial, links, extent,
      scopeNote: `${partial ? 'Requested scope is limited; this is not confirmation that the host truncated the output. ' : ''}${kindNote} ${resultNote}` });
  }
  return { rows, references: references.size, unclassified, other,
    note: 'Retained events only, up to 300 events with 12,000 UTF-16 code units of raw evidence each. References count exact literal target strings with their source-agent scope and path/URL kind; they are not unique physical files or resources. Relative paths, aliases and current directories are not resolved. Repeated operations remain separate occurrences. Contracts describe requested semantics; actual implementation and tool origin remain unknown. Returned information does not prove it was understood, used or remains in active context.'
      + (history !== 'ready' ? ` ${historyScopeState(history)[1]}` : '') + (omitted ? ' Older events were omitted.' : '') };
}

const permissionApprovals = new Set(['approved', 'approved-read-only-for-session', 'approved-for-session', 'approved-for-location']);
const permissionDenials = new Set(['denied-by-rules', 'denied-no-approval-rule-and-could-not-request-from-user',
  'denied-interactively-by-user', 'denied-by-content-exclusion-policy', 'denied-by-permission-request-hook']);
const decisionSources = new Set(['assisted_approval', 'human_response', 'host_policy', 'unattended_fallback', 'authorization_carry_forward']);

function permissionResultScope(result) {
  const unknown = { kind: 'unknown', approvalKind: null, detail: 'Recorded grant scope unknown; no supported complete approval scope is recorded.' };
  const text = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 12000;
  const list = value => Array.isArray(value) && value.length > 0 && value.length <= 300 && value.every(text);
  const fields = (value, required, optional = {}) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => key === 'kind' || Object.hasOwn(required, key) || Object.hasOwn(optional, key))
    && Object.entries(required).every(([key, valid]) => valid(value[key]))
    && Object.entries(optional).every(([key, valid]) => !Object.hasOwn(value, key) || valid(value[key]));
  const managed = { managedApprovalHandled: value => typeof value === 'boolean' };
  const limits = 'Current authority, successful storage and later reuse are not established.';
  if (result?.kind === 'approved' && fields(result, {}, managed)) return { kind: 'request', approvalKind: null,
    detail: 'Recorded scope: single request, without an added approval rule. Existing authority is not described.' };
  if (result?.kind === 'approved-read-only-for-session' && fields(result, { directories: list })) {
    return { kind: 'session-read-only', approvalKind: null,
      detail: `Recorded scope: reusable read-only directory grant for this session. ${limits}` };
  }
  if (!['approved-for-session', 'approved-for-location'].includes(result?.kind)) return unknown;
  const location = result.kind === 'approved-for-location';
  if (!fields(result, { approval: value => value && typeof value === 'object' && !Array.isArray(value),
    ...(location ? { locationKey: text } : {}) }, managed)) return unknown;
  const approval = result.approval;
  let category;
  switch (approval.kind) {
    case 'commands':
      if (fields(approval, { commandIdentifiers: list })) category = 'command identifiers';
      break;
    case 'read':
      if (fields(approval, {})) category = 'read-only filesystem operations';
      break;
    case 'write':
      if (fields(approval, {})) category = 'filesystem write operations';
      break;
    case 'mcp':
      if (fields(approval, { serverName: text, toolName: value => value === null || text(value) })) {
        category = approval.toolName === null ? 'all tools on one MCP server' : 'one MCP server tool';
      }
      break;
    case 'memory':
      if (fields(approval, {})) category = 'long-term memory writes';
      break;
    case 'custom-tool':
      if (fields(approval, { toolName: text })) category = 'one custom tool';
      break;
    case 'extension-management':
      if (fields(approval, {}, { operation: text })) category = approval.operation ? 'one extension-management operation' : 'extension-management operations';
      break;
    case 'workflow':
      if (fields(approval, {}, { approvalKey: text })) category = approval.approvalKey ? 'one workflow approval key' : 'workflow operations';
      break;
    case 'extension-permission-access':
      if (fields(approval, { extensionName: text })) category = "one extension's permission-gated access";
      break;
    case 'extension-env-access':
      if (fields(approval, { extensionName: text, environmentVariables: list })) category = 'named environment variables for one extension';
      break;
  }
  return category ? { kind: location ? 'location' : 'session', approvalKind: approval.kind,
    detail: `Recorded scope: reusable ${location ? 'project-location' : 'session'} grant for ${category}. ${limits}` } : unknown;
}

export function permissionScope(entry = {}) {
  return permissionResultScope(entry.type === 'permission.completed' ? explanationData(entry)?.result : null);
}

function permissionGroups(entries, records, unique) {
  const usableId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const permissions = new Map();
  for (const entry of entries) {
    const data = records.get(entry);
    if (!['permission.requested', 'permission.completed'].includes(entry.type) || !usableId(data?.requestId)) continue;
    const key = toolIdentity({ agentId: entry.agentId, toolCallId: data.requestId });
    if (key === null) continue;
    if (!permissions.has(key)) permissions.set(key, []);
    permissions.get(key).push({ entry, data });
  }
  return [...permissions.values()].map(bucket => {
    const requests = bucket.filter(record => record.entry.type === 'permission.requested');
    const decisions = bucket.filter(record => record.entry.type === 'permission.completed');
    const request = requests[0]?.data, decision = decisions[0]?.data;
    const requestCall = request?.permissionRequest?.toolCallId, decisionCall = decision?.toolCallId;
    const calls = [...new Set(bucket.map(({ entry, data }) => entry.type === 'permission.requested'
      ? data.permissionRequest?.toolCallId : data.toolCallId).filter(usableId))];
    const valid = bucket.every(({ entry }) => unique(entry)) && requests.length <= 1 && decisions.length <= 1 && calls.length <= 1
      && (!request || (object(request.permissionRequest) && (requestCall === undefined || usableId(requestCall))
        && request.ownerAgentId === undefined && request.ownerSessionId === undefined))
      && (!decision || decisionCall === undefined || usableId(decisionCall));
    return { bucket, calls, valid };
  });
}

// One bounded parse per retained event; neither chronology nor recovery ownership is a correlation key.
export function actionStages(entries, { history = 'ready', omitted = 0 } = {}) {
  const usableId = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const identity = (entry, call) => toolIdentity({ agentId: entry.agentId, toolCallId: call });
  const counts = new Map();
  for (const entry of entries) counts.set(entry.id, (counts.get(entry.id) || 0) + 1);
  const unique = entry => counts.get(entry.id) === 1;
  const records = new Map(entries.map(entry => [entry, explanationData(entry)]));
  const proposals = new Map();
  const add = (map, key, value) => {
    if (key === null) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  for (const entry of entries) {
    const data = records.get(entry);
    if (!data) continue;
    if (entry.type === 'assistant.message' && Array.isArray(data.toolRequests)) {
      const valid = unique(entry) && data.toolRequests.length <= 300 && data.toolRequests.every(request => object(request)
        && usableId(request.toolCallId) && typeof request.name === 'string' && request.name.length > 0 && request.name.length <= 180);
      for (const request of data.toolRequests) {
        if (object(request)) add(proposals, identity(entry, request.toolCallId), { entry, name: request.name, valid });
      }
    }
  }
  const permissionCalls = new Map();
  for (const { bucket, calls, valid } of permissionGroups(entries, records, unique)) {
    for (const call of calls) add(permissionCalls, identity(bucket[0].entry, call), { bucket, valid });
  }
  const result = new Map();
  for (const section of groupSteps(entries).filter(section => section.kind === 'tool')) {
    const boundaries = section.entries, key = toolIdentity(boundaries[0]);
    const starts = boundaries.filter(entry => entry.type === 'tool.execution_start');
    const ends = boundaries.filter(entry => entry.type === 'tool.execution_complete');
    const linked = key !== null && starts.length <= 1 && ends.length <= 1 && boundaries.every(entry => {
      const data = records.get(entry);
      return unique(entry) && toolIdentity(entry) === key && data?.toolCallId === entry.toolCallId;
    });
    const selected = new Map();
    const notes = ['Recorded order only; these stages are not a required sequence.',
      'Invocation entry and approval do not prove the operation executed. A tool result reports an outcome, not overall task success.',
      'Only complete matching retained evidence is linked. Missing, ambiguous or unsupported ownership links remain separate.'];
    const stage = (entry, label, detail = '', extra = {}) => selected.set(entry.id,
      { id: entry.id, type: entry.type, timestamp: entry.timestamp, label, detail, ...extra });
    for (const entry of boundaries) {
      const data = records.get(entry);
      if (!unique(entry) || !data || data.toolCallId !== entry.toolCallId) continue;
      if (entry.type === 'tool.execution_start') stage(entry, 'Tool invocation entered');
      else stage(entry, data.success === true && entry.success === true ? 'Tool result: reported success'
        : data.success === false && entry.success === false ? 'Tool result: reported failure' : 'Tool result: outcome unknown');
    }
    if (!linked) notes.push('Call boundaries are conflicting or unavailable; other stages are not linked to this card.');
    if (linked) {
      const candidates = proposals.get(key) || [], proposal = candidates[0];
      const startData = starts[0] && records.get(starts[0]);
      if (candidates.length === 1 && proposal.valid && (!startData || proposal.name === startData.toolName)) {
        stage(proposal.entry, 'Assistant requested a tool');
      } else if (candidates.length) notes.push('Assistant tool requests are duplicated, conflicting or unusable; their original rows remain separate.');
      for (const { bucket, valid } of permissionCalls.get(key) || []) {
        if (!valid) {
          notes.push('Permission IDs or recovery ownership are ambiguous or unsupported; these records remain separate.');
          continue;
        }
        for (const { entry, data } of bucket) {
          if (entry.type === 'permission.requested') stage(entry, 'Permission requested', 'A request is not a decision.', { requestId: data.requestId });
          else {
            const kind = object(data.result) ? data.result.kind : null;
            const outcome = permissionApprovals.has(kind) ? 'approved' : permissionDenials.has(kind) ? 'denied'
              : kind === 'cancelled' ? 'cancelled' : 'unknown';
            const decisionSource = decisionSources.has(data.decisionSource) ? data.decisionSource : null;
            const scope = permissionResultScope(data.result);
            const detail = `Recorded kind: ${usableId(kind) ? kind : 'unknown'}. `
              + (decisionSource ? `Recorded decision source: ${decisionSource}.` : 'Decision source unknown; the kind does not identify a person.')
              + ` ${scope.detail}`;
            stage(entry, `Permission ${outcome}`, detail, { outcome, decisionSource, scope, requestId: data.requestId });
          }
        }
      }
    }
    const stages = entries.filter(entry => selected.has(entry.id)).map(entry => selected.get(entry.id));
    const decisions = stages.filter(stage => stage.type === 'permission.completed');
    const requests = stages.filter(stage => stage.type === 'permission.requested');
    const settled = new Set(decisions.map(stage => stage.requestId));
    let permission = decisions.length === 1 ? `Recorded permission: ${decisions[0].outcome}`
      : decisions.length ? 'Multiple permission decisions; no overall authorization inferred' : 'Permission unknown';
    if (requests.some(stage => !settled.has(stage.requestId))
      || (permissionCalls.get(key) || []).some(record => !record.valid)) permission = 'Permission unknown';
    if (!stages.some(stage => stage.type === 'assistant.message')) notes.push('Assistant tool request not linked in retained evidence.');
    if (!requests.length) notes.push('Permission request unknown; no request is linked in retained evidence.');
    if (!starts.length) notes.push('Invocation entry unknown; no start boundary is retained.');
    if (!ends.length) notes.push('Tool outcome unknown; no result boundary is retained.');
    if (permission === 'Permission unknown') notes.push('Missing permission evidence does not establish approval or preauthorization.');
    if (history !== 'ready') notes.push(historyScopeState(history)[1]);
    if (omitted) notes.push('Older events were omitted; only retained evidence is shown.');
    const description = { stages, notes: [...new Set(notes)], permission };
    for (const entry of boundaries) result.set(entry.id, description);
  }
  return result;
}

export function observedActivity(entries, { history = 'ready', omitted = 0, now = Date.now() } = {}) {
  const items = [], handled = new Set(), counts = new Map(), positions = new Map();
  for (const [index, entry] of entries.entries()) { counts.set(entry.id, (counts.get(entry.id) || 0) + 1); positions.set(entry, index); }
  const unique = entry => counts.get(entry.id) === 1;
  const records = new Map(entries.map(entry => [entry, explanationData(entry)]));
  const source = entry => entry.agentId === '' || identityText(entry.agentId) ? entry.agentId : null;
  const add = (kind, entry, label, detail, links = [entry]) => {
    const interruption = kind !== 'unknown' && entries.findLast(candidate => candidate.type === 'abort'
      && source(candidate) === source(entry) && unique(candidate) && records.get(candidate)
      && positions.get(candidate) > positions.get(entry));
    if (interruption) {
      detail += ' An interruption was recorded for this source; this operation’s outcome remains unknown. The interruption has no call ID.';
      links.push(interruption);
    }
    items.push({ id: `${kind}:${JSON.stringify([source(entry), entry.id])}${unique(entry) ? '' : `:${positions.get(entry)}`}`, kind, source: source(entry), entry, label, detail,
      links: [...new Set(links)].filter(unique) });
  };
  const unknown = boundaries => {
    boundaries.forEach(entry => handled.add(entry));
    add('unknown', boundaries[0], 'Activity unknown',
      'Source, identity or lifecycle evidence is unavailable or ambiguous. No current activity is inferred.', boundaries);
  };
  const stages = actionStages(entries, { history, omitted });
  for (const section of groupSteps(entries).filter(section => section.kind === 'tool')) {
    const boundaries = section.entries, starts = boundaries.filter(entry => entry.type === 'tool.execution_start');
    const ends = boundaries.filter(entry => entry.type === 'tool.execution_complete');
    const valid = starts.length <= 1 && ends.length <= 1 && boundaries.every(entry => unique(entry)
      && source(entry) !== null && identityText(entry.toolCallId) && records.get(entry)?.toolCallId === entry.toolCallId);
    if (!valid) { unknown(boundaries); continue; }
    boundaries.forEach(entry => handled.add(entry));
    if (!starts.length || ends.length) continue;
    const entry = starts[0], action = stages.get(entry.id);
    const decisions = action.stages.filter(stage => stage.type === 'permission.completed');
    const links = [entry, ...decisions.map(stage => entries.find(candidate => candidate.id === stage.id))];
    add('tool', entry, 'Tool completion not observed',
      `${action.permission}. An invocation entry does not prove execution; a result may be absent, late or outside the retained window.`, links);
  }
  for (const { bucket, valid } of permissionGroups(entries, records, unique)) {
    const boundaries = bucket.map(record => record.entry);
    const usable = bucket.every(({ entry, data }) => source(entry) !== null && identityText(data.requestId)
      && (data.permissionRequest?.toolCallId === undefined || identityText(data.permissionRequest.toolCallId))
      && (data.toolCallId === undefined || identityText(data.toolCallId)));
    if (!valid || !usable) { unknown(boundaries); continue; }
    boundaries.forEach(entry => handled.add(entry));
    const request = boundaries.find(entry => entry.type === 'permission.requested');
    if (request && !boundaries.some(entry => entry.type === 'permission.completed')) {
      add('permission', request, 'Permission decision not observed',
        'A retained request has no matching recorded decision. It may be old or incomplete; current waiting and approval are unknown.');
    }
  }
  for (const row of delegationHandoffs(entries, { history, omitted })) {
    const boundaries = row.entries.filter(entry => ['subagent.started', 'subagent.completed', 'subagent.failed'].includes(entry.type));
    if (!boundaries.length) continue;
    if (row.status === 'conflict' || row.lifecycle === 'unknown') { unknown(boundaries); continue; }
    boundaries.forEach(entry => handled.add(entry));
    const entry = boundaries.find(entry => entry.type === 'subagent.started');
    if (entry && row.lifecycle === 'missing') add('delegation', entry, 'Delegated outcome not observed',
      'A retained child start has no matching lifecycle outcome. Parent tool results are separate; current child execution is unknown.');
  }
  for (const entry of entries) if (['permission.requested', 'permission.completed', 'subagent.started', 'subagent.completed', 'subagent.failed'].includes(entry.type)
    && !handled.has(entry)) unknown([entry]);
  items.sort((a, b) => positions.get(a.entry) - positions.get(b.entry));
  const entry = entries.at(-1), time = entry && timestampMilliseconds(entry.timestamp);
  const knownTime = Number.isFinite(time) && Number.isFinite(now) && time <= now;
  return { items, lastEvent: entry ? { entry, timestamp: knownTime ? entry.timestamp : null,
    elapsedSeconds: knownTime ? Math.floor((now - time) / 1000) : null } : null,
  notes: ['Retained boundaries do not establish that work is currently running or waiting. Absence of an item does not establish inactivity or success.',
    'Missing, late or omitted records can leave an outcome unknown. Trace cannot diagnose thinking, failure or completion from silence.',
    ...(history !== 'ready' ? ['History is incomplete or unavailable.'] : []), ...(omitted ? ['Older events were omitted.'] : [])] };
}

const actionLessons = {
  failure: { title: 'A recorded failure', concept: 'tool', options: [
    { action: 'Inspect the reported failure and the original request.', when: 'If the error or typed exit leaves the cause unclear, compare the literal result with the requested operation.' },
    { action: 'Gather a missing prerequisite or clarify the scope.', when: 'If inspection identifies missing information or an unmet prerequisite, resolve that gap before considering another authorized attempt.' },
  ] },
  retrieval: { title: 'A successful retrieval report', concept: 'tool', options: [
    { action: 'Compare the returned information with the question.', when: 'If the data addresses the requested scope, identify which parts support an answer and which remain unverified.' },
    { action: 'Seek a more relevant source or clarify the question.', when: 'If the returned data is irrelevant, incomplete or conflicting, name that gap before considering another authorized retrieval.' },
  ] },
  permission: { title: 'A permission evidence gap', concept: 'permission', options: [
    { action: 'Inspect the request and check the host’s current permission state.', when: 'If the operation is still needed, establish its current state and requested scope before treating it as authorized.' },
    { action: 'Explain the missing decision and consider an authorized alternative.', when: 'If permission cannot be established, clarify the limitation or use an already authorized approach; never infer approval from silence.' },
  ] },
  check: { title: 'A completed check process', concept: 'tool', options: [
    { action: 'Report the command and its bounded result.', when: 'If this check answers a requested validation question, describe its exact scope and the observed exit without claiming overall correctness.' },
    { action: 'Identify a remaining validation gap.', when: 'If requirements extend beyond this command’s coverage, name the missing evidence before considering another authorized check.' },
  ] },
};
const generalActions = {
  title: 'General guidance', concept: 'tool', observation: 'A supported scenario is unknown in this displayed window.',
  limit: 'Missing or unsupported evidence cannot establish a personalized next action.', evidence: [], options: [
    { action: 'Inspect the available evidence and its limits.', when: 'If a retained event is relevant, separate what it records from what remains unknown.' },
    { action: 'Clarify the question or missing information.', when: 'If the available evidence cannot answer the question, describe the gap before choosing any authorized action.' },
  ],
};

function actionScenarios(retained) {
  const entries = retained.slice(-300), positions = new Map(entries.map((entry, index) => [entry, index])), scenarios = [];
  const complete = entry => retainedExample(entries, entry) && identityText(entry.id)
    && (entry.agentId === '' || identityText(entry.agentId)) && entry.truncated === false
    && (!Object.hasOwn(entry, 'protectedContentOmitted') || entry.protectedContentOmitted === false);
  const add = (kind, evidence, observation, limit) => scenarios.push({ kind, id: `${kind}:${evidence[0].id}`,
    ...actionLessons[kind], evidence, observation, limit });
  const outcomes = toolOutcomes(entries), checks = validationChecks(entries);
  for (const { boundaries, start, data } of toolBuckets(entries)) {
    const result = boundaries.find(entry => entry.type === 'tool.execution_complete'), end = result && explanationData(result);
    if (!data || !result || !boundaries.every(entry => complete(entry) && identityText(entry.toolCallId)) || positions.get(start) >= positions.get(result)
      || typeof end?.success !== 'boolean' || end.success !== result.success
      || [...mcpFields, 'origin', 'overridesBuiltInTool'].some(field => Object.hasOwn(end, field)
        && (!Object.hasOwn(data, field) || end[field] !== data[field]))
      || [data, end].some(record => ['ownerAgentId', 'ownerSessionId'].some(field => Object.hasOwn(record, field)))) continue;
    const outcome = outcomes.get(result.id), shell = outcome?.kind === 'process' ? validationExit(end) : null;
    const evidence = [start, result];
    if (end.success === false || (shell && shell.exitCode !== 0)) {
      add('failure', evidence, `The tool protocol reports ${end.success ? 'success' : 'failure'}.${shell ? ` Typed process exit ${shell.exitCode} describes this command only.` : ''}`,
        'The cause, current need for another attempt and overall task outcome remain unknown. A later success does not erase this recorded failure.');
    } else if (outcome?.kind === 'read') {
      add('retrieval', evidence, 'A supported read request has a matching tool-success report with returned data.',
        'Relevance, usefulness and sufficiency remain unknown. Returned data does not prove overall task correctness.');
    } else if (shell && checks.some(check => check.start === start && check.result === result && check.exitCode === shell.exitCode)) {
      add('check', evidence, `A supported validation command has a matching typed process exit ${shell.exitCode} and a tool-success report.`,
        'Assertion counts and coverage remain unknown. Exit zero does not prove tests or the overall task correct.');
    }
  }
  for (const item of observedActivity(entries).items) if (item.kind === 'permission' && item.links.every(complete)) {
    add('permission', item.links, 'A retained permission request has no matching recorded decision.',
      'It may be old or incomplete; current waiting and approval are unknown. A request does not prove execution.');
  }
  return scenarios.sort((a, b) => positions.get(a.evidence.at(-1)) - positions.get(b.evidence.at(-1)));
}

export function plausibleActions(entries, { history = 'ready', omitted = 0 } = {}) {
  const scenarios = actionScenarios(entries), selected = scenarios.slice(-3);
  return { scenarios: selected, omittedScenarios: Math.max(0, scenarios.length - selected.length), general: generalActions,
    scope: `Up to three latest supported observations from at most 300 displayed retained events, selected when opened. ${Math.max(0, scenarios.length - selected.length)} other supported observations not shown. These are separate observations, not a combined plan or a complete current action set; overlapping activity does not establish which action comes next. ${omitted} older events omitted.`
      + (history !== 'ready' ? ' Earlier history is unavailable or loading.' : '') };
}

export function retainedPlausibleScenario(entries, scenario) {
  return scenario.evidence.every(entry => retainedExample(entries, entry)) && actionScenarios(entries).some(current =>
    current.id === scenario.id && current.evidence.length === scenario.evidence.length
      && scenario.evidence.every(entry => retainedExample(current.evidence, entry)));
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

const historyScope = {
  loading: ['History loading', 'Available history is still loading; live events may already be retained.'],
  ready: ['', 'Available history was read; this covers retained supported events only, not the whole chat.'],
  unavailable: ['Earlier history unavailable', 'Earlier history could not be read. Retained live events remain available.'],
  unsupported: ['Event API unsupported', 'This host did not expose the session event API. Reopen in a compatible Copilot desktop session.'],
};

function historyScopeState(history) {
  return Object.hasOwn(historyScope, history) ? historyScope[history]
    : ['History status unknown', 'History status is unknown; available records do not establish full history.'];
}

export function observerScope(snapshot, feedState = 'connected', stats = summarize(snapshot?.entries || [])) {
  const entries = snapshot?.entries || [];
  const [historyLabel, historyReason] = historyScopeState(snapshot?.history);
  const stale = Boolean(snapshot) && feedState === 'disconnected';
  const omitted = Number.isSafeInteger(snapshot?.omitted) && snapshot.omitted > 0 ? snapshot.omitted : 0;
  const clipped = entries.filter(entry => entry.truncated === true).length;
  const invalidIds = entries.filter(entry => typeof entry.id !== 'string' || !entry.id || entry.id.length > 256).length;
  const countsAvailable = Boolean(snapshot) && (entries.length > 0 || snapshot.history === 'ready');
  const reasons = [];
  const labels = [];
  if (!snapshot) {
    labels.push(feedState === 'disconnected' ? 'Counts unavailable' : 'Waiting for event feed');
    reasons.push('No event snapshot is available; counts are unknown.');
  } else {
    labels.push(`${entries.length} retained event${entries.length === 1 ? '' : 's'}`);
    if (stale) {
      labels.push('Stale snapshot');
      reasons.push('The event feed is disconnected. These records and counts come from the previous snapshot and may be out of date.');
    }
    if (historyLabel) labels.push(historyLabel);
    reasons.push(historyReason);
    if (!entries.length) reasons.push('No retained supported events is not proof that nothing happened.');
  }
  if (omitted) {
    labels.push('Older events omitted');
    reasons.push(`Older events were omitted: ${omitted} older event${omitted === 1 ? '' : 's'} outside the retained window.`);
  }
  if (clipped) {
    labels.push('Clipped evidence');
    reasons.push(`${clipped} retained record${clipped === 1 ? ' has' : 's have'} Trace-clipped raw evidence. Host-shortened output is a separate fact, shown where recorded.`);
  }
  if (stats.unlinked) {
    labels.push('Unlinked records');
    reasons.push(`${stats.unlinked} turn, hook or tool events lack usable IDs and are excluded from those totals. Their retained evidence and reported outcomes remain available.`);
  }
  if (invalidIds) {
    labels.push('Event IDs unavailable');
    reasons.push(`${invalidIds} retained record${invalidIds === 1 ? ' has' : 's have'} no usable event ID; original-evidence links may be unavailable.`);
  }
  reasons.push('Trace records selected supported event types from this chat, keeps at most 300 recent events in memory and clips raw evidence to 12,000 UTF-16 code units per record, preserving surrogate pairs. Unsupported event types and malformed records may be absent; their number is unknown. Missing completion is unknown, not success or proof of running. Trace does not recover hidden context or unrecorded reasons, and event order does not establish cause. Capability snapshots have their own freshness, separate from this event feed.');
  return { label: labels.join(' · '), detail: reasons.join(' '), countsAvailable, stale,
    degraded: !snapshot || stale || snapshot.history !== 'ready' || Boolean(omitted || clipped || stats.unlinked || invalidIds) };
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

export function retainedRecapEntry(entries, expected) {
  return Boolean(expected && identityText(expected.id) && sameValidationEntry(entries, expected));
}

// The caller freezes the selected interval; each projection uses exactly that same scope.
export function observedRecap(entries, { history = 'ready', omitted = 0 } = {}) {
  const stats = summarize(entries), scope = { history, omitted };
  const turn = entry => ['assistant.turn_start', 'assistant.turn_end'].includes(entry.type);
  const tool = entry => ['tool.execution_start', 'tool.execution_complete'].includes(entry.type);
  const hook = entry => ['hook.start', 'hook.end'].includes(entry.type);
  const metrics = [
    ['turns', 'Model turns', entry => turn(entry) && entry.turnId && entry.agentId !== null],
    ['tools', 'Tool calls', entry => tool(entry) && toolIdentity(entry) !== null],
    ['hooks', 'Hook pipelines', entry => hook(entry) && hookIdentity(entry) !== null],
    ['skills', 'Skill loads', entry => entry.type === 'skill.invoked'],
    ['unlinked', 'Unlinked boundaries', entry => (turn(entry) && (!entry.turnId || entry.agentId === null))
      || (tool(entry) && toolIdentity(entry) === null) || (hook(entry) && hookIdentity(entry) === null)],
  ].map(([key, label, includes]) => ({ key, label, count: stats[key], entries: entries.filter(includes) }));
  const ids = new Map();
  for (const entry of entries) ids.set(entry.id, (ids.get(entry.id) || 0) + 1);
  const protocol = entry => {
    const data = explanationData(entry);
    const identity = entry.type === 'tool.execution_complete' ? 'toolCallId' : 'hookInvocationId';
    return ids.get(entry.id) === 1 && identityText(entry.id) && (entry.agentId === '' || identityText(entry.agentId))
      && data && identityText(entry[identity]) && data[identity] === entry[identity]
      && (!Object.hasOwn(entry, 'protectedContentOmitted') || entry.protectedContentOmitted === false)
      && typeof data.success === 'boolean' && data.success === entry.success ? data.success : null;
  };
  const failures = [
    ['tools', 'Tool protocol failure records', entry => entry.type === 'tool.execution_complete' && protocol(entry) === false],
    ['hooks', 'Hook pipeline failure records', entry => entry.type === 'hook.end' && protocol(entry) === false],
    ['errors', 'Host error records', entry => entry.type === 'session.error'],
    ['agents', 'Delegated failure records', entry => entry.type === 'subagent.failed'],
    ['interruptions', 'Interruption records', entry => entry.type === 'abort'],
  ].map(([key, label, includes]) => ({ key, label, entries: entries.filter(includes) }));
  const clipped = entries.filter(entry => entry.truncated).length;
  const validation = validationOverview(entries, scope);
  const checks = new Set(validation.checks.map(check => check.start));
  const validationUnknown = toolBuckets(entries).filter(bucket => toolIdentity(bucket.boundaries[0]) !== null
    && !checks.has(bucket.start)).flatMap(bucket => bucket.boundaries);
  return { entries, stats, metrics, failures, retrieval: retrievalLedger(entries, scope),
    validation, validationUnknown, claims: validationClaims(entries, scope),
    unknownToolResults: entries.filter(entry => entry.type === 'tool.execution_complete' && protocol(entry) === null),
    notes: [
      'Frozen retained observations only, across all views and filters. Request completion, task success, causality and overall elapsed time remain unknown. No durations are added together.',
      'Counts use Statistics definitions on exactly these entries. Tool calls and hook pipelines use exact source and call identities, including completion-only calls; model turns use retained turn boundaries; skill loads count individual records. Counts from separate intervals are not additive.',
      'Failure counts describe records, not unique failed tasks. Tool protocol status, typed process exits and assistant claims are separate observations. Missing, unclassified or conflicting results remain unknown; zero observed records does not prove nothing happened.',
      'At most 300 retained events are available. Unsupported or malformed events may be absent. Resource coverage, validation assertions, skipped tests and suite coverage remain unknown.',
      `${clipped} selected records have Trace-clipped evidence. Host output may also be shortened; retained text does not establish complete output.`,
      ...(history !== 'ready' ? ['Earlier history is unavailable or still loading.'] : []),
      ...(omitted ? [`${omitted} older events were omitted from the captured retained window.`] : []),
    ] };
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
