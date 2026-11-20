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
export function turnContext(entries) {
  const active = new Map();
  const context = new Map();
  for (const entry of entries) {
    const agent = entry.agentId ?? '';
    if (entry.type === 'abort') { active.clear(); continue; }
    if (entry.type === 'user.message') { active.delete(agent); continue; }
    if (entry.agentId === null) continue;
    if (entry.type === 'assistant.turn_start') {
      active.delete(agent);
      if (!entry.turnId) continue;
      const turn = { id: entry.turnId, agent, model: entry.model, count: 0, ended: false };
      active.set(agent, turn);
      context.set(entry.id, { role: 'start', turn });
    } else if (entry.type === 'assistant.turn_end') {
      const turn = active.get(agent);
      if (turn && entry.turnId === turn.id) {
        turn.ended = true;
        context.set(entry.id, { role: 'end', turn });
      }
      active.delete(agent);
    } else if (active.has(agent) && !entry.type.startsWith('session.')) {
      const turn = active.get(agent);
      turn.count++;
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
  return { kind: 'Model', tone: 'model',
    title: role === 'start' ? `Model turn ${turn.id}` : `Turn ${turn.id} complete`,
    subtitle: role === 'start'
      ? `${turn.model ? `${turn.model} · ` : ''}${source} · ${turn.count} ${turn.count === 1 ? 'event' : 'events'} · ${turn.ended ? 'Completed' : 'End not observed'}`
      : `${source} · This iteration ended; more turns may follow.`,
  };
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
  if (title.length <= 180) return title;
  let prefix = title.slice(0, 179);
  if (/[\uD800-\uDBFF]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return prefix + '…';
}

export function describeStep(entry) {
  const type = entry.type;
  if (type === 'user.message') return { kind: 'You', title: entry.preview || 'User message', subtitle: 'Message sent', tone: 'user' };
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
