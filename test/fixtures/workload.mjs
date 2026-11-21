// Deterministic synthetic Copilot session events for scale tests and benchmarks.
// Shapes follow the installed SDK event declarations closely enough to reach every Trace analysis;
// payload sizes approximate a busy coding agent. No real session data is used.

export function random(seed = 1) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0; state ^= state >>> 17; state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

const words = 'trace event tool result shell file view grep edit build test agent model turn hook permission compaction skill request chapter lane provenance 日本語 😀 <b>markup</b>'.split(' ');
function text(next, length) {
  let out = '';
  while (out.length < length) out += words[Math.floor(next() * words.length)] + (next() < 0.1 ? '\n' : ' ');
  return out.slice(0, length);
}

/**
 * Returns `count` host-shaped events in emission order. Ephemeral `assistant.usage` receipts are marked
 * `ephemeral: true`; use `persisted()` for a history array. With `anomalies`, the stream also contains
 * duplicate IDs, out-of-order/equal/missing/invalid timestamps, checkpoint copies, oversized IDs,
 * unsupported types, orphaned boundaries, aborts and malformed agent identities. `tools` chooses the requested tool mix.
 */
export function makeSession(count, { seed = 7, start = Date.parse('2026-08-01T00:00:00.000Z'), stepMs = 1500,
  anomalies = false, largeResults = true, tools = ['view', 'grep', 'powershell', 'edit', 'task'] } = {}) {
  const next = random(seed);
  const events = [];
  let time = start, serial = 0, interaction = 0, turn = 0, call = 0, hook = 0, usage = 0, compaction = 0;
  const push = (type, data, extra = {}) => {
    time += Math.floor(next() * stepMs);
    let timestamp = new Date(time).toISOString();
    if (anomalies) {
      const roll = next();
      if (roll < 0.01) timestamp = new Date(time - 60000).toISOString(); // out of order
      else if (roll < 0.02) timestamp = events.at(-1)?.timestamp ?? timestamp; // equal
      else if (roll < 0.025) timestamp = undefined; // missing
      else if (roll < 0.03) timestamp = 'not a time';
    }
    const event = { id: `e${(serial++).toString(36)}-${Math.floor(next() * 1e9).toString(36)}`, type,
      ...(timestamp === undefined ? {} : { timestamp }), parentId: events.at(-1)?.id ?? null, data, ...extra };
    events.push(event);
    if (anomalies) {
      const roll = next();
      if (roll < 0.01 && events.length > 2) events.push(events[events.length - 2]); // duplicate ID
      else if (roll < 0.015) events.push({ ...event, checkpoint: true });
      else if (roll < 0.018) events.push({ ...event, id: 'x'.repeat(257) });
      else if (roll < 0.025) events.push({ ...event, id: `${event.id}-u`, type: 'assistant.message_delta' });
      else if (roll < 0.027) events.push({ ...event, id: `${event.id}-a`, agentId: 7 });
    }
    return event;
  };
  while (events.length < count) {
    const interactionId = `int-${interaction++}`;
    push('user.message', { content: text(next, 40 + Math.floor(next() * 600)), delivery: next() < 0.85 ? 'idle' : next() < 0.5 ? 'queued' : 'steering', interactionId, source: 'user' });
    const turns = 1 + Math.floor(next() * 6);
    for (let k = 0; k < turns && events.length < count; k++) {
      const turnId = String(turn++ % 50);
      push('assistant.turn_start', { turnId, interactionId });
      if (next() < 0.5) push('assistant.reasoning', { reasoningId: `r${turn}`, content: text(next, 200 + Math.floor(next() * 3000)), reasoningOpaque: 'opaque' });
      if (next() < 0.4) push('assistant.intent', { intent: text(next, 40) });
      const requests = [];
      for (let j = 0, requested = Math.floor(next() * 4); j < requested; j++) {
        requests.push({ toolCallId: `call-${call + j}`, name: tools[Math.floor(next() * tools.length)], arguments: { path: `src/file${j}.mjs` }, type: 'function' });
      }
      const claim = next() < 0.1 ? 'Tests passed.' : text(next, 50 + Math.floor(next() * 1500));
      push('assistant.message', { messageId: `m${turn}`, content: claim, toolRequests: requests, interactionId, encryptedContent: 'protected' });
      push('assistant.usage', { model: 'claude-sonnet-5-5', inputTokens: 1000, outputTokens: 200, cacheReadTokens: 400, duration: 900,
        accountingIdentity: { sourceSessionId: 'main', sequence: usage, usageId: `u${usage++}` } }, { ephemeral: true });
      for (const request of requests) {
        const toolCallId = `call-${call++}`;
        const pre = `hook-${hook++}`;
        push('hook.start', { hookInvocationId: pre, hookType: 'preToolUse', input: { toolName: request.name } });
        push('hook.end', { hookInvocationId: pre, hookType: 'preToolUse', success: next() < 0.97 });
        const command = request.name === 'powershell' ? (next() < 0.4 ? 'npm test' : next() < 0.5 ? 'node --test validation.test.mjs' : 'git status') : undefined;
        const args = command ? { command, description: 'run' }
          : request.name === 'task' ? { prompt: text(next, 400), agent_type: 'explore', description: 'explore' }
            : request.name === 'grep' ? { pattern: 'trace', path: 'src' } : request.arguments;
        if (!(anomalies && next() < 0.02)) push('tool.execution_start', { toolCallId, toolName: request.name, arguments: args,
          ...(next() < 0.1 ? { mcpServerName: 'github', mcpToolName: request.name, mcpConfigServerName: 'github' } : {}) });
        if (command || request.name === 'edit') {
          const requestId = `perm-${toolCallId}`;
          push('permission.requested', { requestId, permissionRequest: { kind: command ? 'shell' : 'write', toolCallId, fullCommandText: command ?? 'edit' } });
          if (!(anomalies && next() < 0.05)) push('permission.completed', { requestId, toolCallId,
            result: next() < 0.85 ? { kind: 'approved' } : next() < 0.5 ? { kind: 'approved-for-session', approval: { kind: 'commands', commandIdentifiers: ['node'] } } : { kind: 'denied-interactively-by-user' } });
        }
        if (request.name === 'task') {
          const agentId = `agent-${toolCallId}`;
          push('subagent.started', { toolCallId, agentName: 'explore', agentDisplayName: 'Explore', agentDescription: 'search' }, { agentId });
          push('assistant.turn_start', { turnId: '0' }, { agentId });
          push('assistant.message', { messageId: `sub-${toolCallId}`, content: text(next, 600), toolRequests: [], parentToolCallId: toolCallId }, { agentId });
          push('assistant.turn_end', { turnId: '0' }, { agentId });
          const roll = next();
          if (!(anomalies && roll < 0.05)) push(roll < 0.9 ? 'subagent.completed' : 'subagent.failed', { toolCallId, agentName: 'explore', agentDisplayName: 'Explore', error: 'failed', ...(roll < 0.2 ? { cancelled: true } : {}) }, { agentId });
        }
        if (anomalies && next() < 0.01) push('abort', { reason: 'user interrupted' });
        // 70% under 2 KB, 25% 2–40 KB, 5% 100 KB–1 MB (only with largeResults).
        const roll = next();
        const size = roll < 0.7 || !largeResults ? 100 + Math.floor(next() * 1900) : roll < 0.95 ? 2000 + Math.floor(next() * 38000) : 100000 + Math.floor(next() * 900000);
        const content = text(next, size);
        const success = next() < 0.92;
        const contents = command ? [{ type: 'shell_exit', shellId: 's1', exitCode: success ? 0 : 1, outputPreview: content.slice(0, 500), outputTruncated: content.length > 500 }]
          : [{ type: 'text', text: content.slice(0, 200) }];
        if (!(anomalies && next() < 0.02)) push('tool.execution_complete', { toolCallId, success, result: { content, ...(next() < 0.3 ? { detailedContent: content } : {}), contents }, toolTelemetry: { lines: size } });
        const post = `hook-${hook++}`;
        const type = success ? 'postToolUse' : 'postToolUseFailure';
        push('hook.start', { hookInvocationId: post, hookType: type });
        push('hook.end', { hookInvocationId: post, hookType: type, success: true, output: { additionalContext: 'ok' } });
      }
      push('assistant.turn_end', { turnId });
    }
    if (next() < 0.05) push('skill.invoked', { name: 'trace', path: 'skills/trace/SKILL.md', content: text(next, 4000), trigger: ['agent-invoked', 'user-invoked', 'context-load'][Math.floor(next() * 3)] });
    if (next() < 0.02) {
      const compactionAttemptId = `c${compaction++}`;
      push('session.compaction_start', { compactionAttemptId });
      push('session.compaction_complete', { compactionAttemptId, success: true, summaryContent: text(next, 3000), preCompactionTokens: 120000, postCompactionTokens: 20000, tokenAccountingBasis: 'local_full_context_estimate' });
    }
    if (next() < 0.01) push(next() < 0.5 ? 'session.error' : 'session.warning', { message: 'rate limited', errorType: 'rate_limit' });
  }
  return events.slice(0, count);
}

export const persisted = events => events.filter(event => !event.ephemeral);

// A minimal joined-session double: one subscription, history resolved on demand.
export function host(history) {
  let listener;
  return {
    session: { on(fn) { listener = fn; return () => { listener = undefined; }; }, getEvents: () => Promise.resolve(history) },
    emit(event) { listener?.(event); },
  };
}
