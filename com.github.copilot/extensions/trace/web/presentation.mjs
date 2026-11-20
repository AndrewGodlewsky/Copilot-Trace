const actorRoles = new Map(Object.entries({
  'user.message': 'User',
  'assistant.turn_start': 'Assistant',
  'assistant.turn_end': 'Assistant',
  'assistant.intent': 'Assistant',
  'assistant.message': 'Assistant',
  'assistant.reasoning': 'Assistant',
  'tool.execution_start': 'Tool',
  'tool.execution_complete': 'Tool',
  'hook.start': 'Configured automation',
  'hook.end': 'Configured automation',
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

export function describeActor(entry) {
  const id = entry.agentId;
  const source = typeof id !== 'string' || id.length > 256 ? 'Source unavailable'
    : id === '' ? 'Main chat' : `Agent ${id}`;
  return { role: actorRoles.get(entry.type) || 'Actor unknown', source };
}

function toolIdentity(entry) {
  return typeof entry.agentId === 'string' && entry.agentId.length <= 256
    && typeof entry.toolCallId === 'string' && entry.toolCallId.length > 0 && entry.toolCallId.length <= 256
    ? JSON.stringify([entry.agentId, entry.toolCallId]) : null;
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
    if (hook && entry.agentId !== null && previous?.kind === 'hooks' && previous.entries.at(-1) === entries[index - 1]
      && previous.entries[0].agentId !== null && (previous.entries[0].agentId || '') === (entry.agentId || '')) {
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

export function describeToolGroup(entries) {
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
  return { kind: 'Tool', title: conflicting ? 'Tool call with conflicting boundaries' : describeStep(start || end).title,
    subtitle: `${source} · ${status} · ${timing}`, tone: !conflicting && end?.success === false ? 'error' : 'tool' };
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
    let calls, id;
    if (['hook.start', 'hook.end'].includes(entry.type)) { calls = hooks; id = entry.hookInvocationId; }
    if (['tool.execution_start', 'tool.execution_complete'].includes(entry.type)) { calls = tools; id = entry.toolCallId; }
    if (calls) {
      const key = calls === tools ? toolIdentity(entry) : !id || entry.agentId === null ? null : JSON.stringify([entry.agentId || '', id]);
      if (key === null) { unlinked++; continue; }
      if (!calls.has(key) || !calls.get(key)) calls.set(key, entry.displayName || '');
    }
    if (entry.type === 'skill.invoked') {
      const name = entry.displayName || 'Name unavailable';
      skills.set(name, (skills.get(name) || 0) + 1);
    }
  }
  const hookNames = new Map();
  for (const value of hooks.values()) {
    const name = value || 'Name unavailable';
    hookNames.set(name, (hookNames.get(name) || 0) + 1);
  }
  return { turns, hooks: hooks.size, tools: tools.size,
    skills: [...skills.values()].reduce((sum, n) => sum + n, 0),
    skillNames: [...skills], hookNames: [...hookNames], unlinked };
}

export function describeTurn(entry, context) {
  if (!context) {
    if (entry.type === 'assistant.turn_end') return { kind: 'Model', tone: 'model',
      title: entry.turnId ? `Turn ${entry.turnId} complete` : 'Turn complete',
      subtitle: 'Matching start unavailable in this view.' };
    if (entry.type === 'assistant.turn_start') return { kind: 'Model', tone: 'model',
      title: 'Model turn', subtitle: 'Start recorded; usable turn or agent ID unavailable.' };
    return describeStep(entry);
  }
  if (context.role === 'inside') return describeStep(entry);
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
  const subtitle = `${count} ${count === 1 ? 'event' : 'events'}${failures ? ` · ${failures} failed` : ''}${names.length ? ` · ${names.slice(0, 2).join(', ')}${names.length > 2 ? '…' : ''}` : ''}`;
  return { kind: 'Hook', title: 'Hooks', subtitle, tone: failures ? 'error' : 'host' };
}

function actionTitle(entry) {
  if (entry.type !== 'tool.execution_start' || entry.truncated
    || typeof entry.evidence !== 'string' || entry.evidence.length > 12000) return '';
  let data;
  try { data = JSON.parse(entry.evidence)?.data; } catch { return ''; }
  const args = data?.arguments;
  if (data?.toolName !== entry.toolName || !args || typeof args !== 'object' || Array.isArray(args)) return '';
  let title = '';
  if (entry.toolName === 'view' && typeof args.path === 'string' && args.path.length) title = `View ${args.path}`;
  if (entry.toolName === 'grep' && typeof args.pattern === 'string' && args.pattern.length) title = `Search for pattern “${args.pattern}”`;
  return shortTitle(title);
}

function shortTitle(title) {
  if (title.length <= 180) return title;
  let prefix = title.slice(0, 179);
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return prefix + '…';
}

export function describeStep(entry) {
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
    return { kind: 'Tool', title: actionTitle(entry) || entry.toolName || 'Tool name unavailable', subtitle, tone: entry.success === false ? 'error' : 'tool' };
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
