export function groupSteps(entries) {
  const sections = [];
  for (const entry of entries) {
    const hook = entry.type === 'hook.start' || entry.type === 'hook.end';
    const previous = sections.at(-1);
    if (hook && entry.agentId !== null && previous?.kind === 'hooks' && previous.entries[0].agentId !== null && (previous.entries[0].agentId || '') === (entry.agentId || '')) {
      previous.entries.push(entry);
    } else {
      sections.push({ id: `${hook ? 'hooks' : 'event'}:${entry.id}`, kind: hook ? 'hooks' : 'event', entries: [entry] });
    }
  }
  return sections;
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
      if (!id || entry.agentId === null) { unlinked++; continue; }
      const key = JSON.stringify([entry.agentId || '', id]);
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

export function describeStep(entry) {
  const type = entry.type;
  if (type === 'user.message') return { kind: 'You', title: entry.preview || 'User message', subtitle: 'Message sent', tone: 'user' };
  if (entry.category === 'tool') {
    const subtitle = type === 'tool.execution_start' ? 'Started'
      : entry.success === false ? 'Failed' : entry.success === true ? 'Completed' : 'Result recorded';
    return { kind: 'Tool', title: entry.toolName || 'Tool name unavailable', subtitle, tone: entry.success === false ? 'error' : 'tool' };
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
