export const vocabulary = Object.freeze(Object.fromEntries(Object.entries({
  'model-turn': {
    label: 'Model turn',
    definition: 'One iteration of the agent loop. A single user request can involve several model turns.',
    deeper: 'Turn markers record the start or end of one iteration for an agent. Events between matching markers show timing, not why an action happened. A turn ending does not establish that the user’s task is complete or correct.',
    example: 'A request to fix a bug may involve a turn that asks to read a file, followed by another turn that uses the tool result.',
    types: ['assistant.turn_start', 'assistant.turn_end'],
  },
  tool: {
    label: 'Tool',
    definition: 'A callable operation that lets an agent request work, such as reading a file or running a command.',
    deeper: 'Arguments describe the requested operation. An invocation start does not prove it executed; permission may still be needed. A result reports an outcome, not an independent check that the overall task is correct. A missing result does not mean the tool is still running.',
    example: 'A successful read reports returned data, whose usefulness is unknown. A successful edit reports a change, whose correctness needs separate evidence. A typed zero process exit describes that command; it does not establish assertion counts or task success.',
    types: ['tool.execution_start', 'tool.execution_complete'],
  },
  hook: {
    label: 'Hook',
    definition: 'An automation entry point at a lifecycle moment, such as before a tool call.',
    deeper: 'Trace records hook pipeline boundaries. A pipeline record does not prove a configured handler or script ran. Missing results leave the outcome unknown, and recorded order alone does not establish that a hook caused a later action.',
    example: 'A pre-tool hook pipeline is recorded before a tool operation. Its presence alone does not show that a custom script ran.',
    comparison: 'Configured hooks execute code or callbacks at supported lifecycle moments. They may observe, supply context or request a documented decision. A recorded pipeline can have zero or multiple configured callbacks; its presence or success does not prove a rule was enforced.',
    types: ['hook.start', 'hook.end'],
  },
  skill: {
    label: 'Skill',
    definition: 'A reusable set of instructions that can be loaded to guide an agent’s work.',
    deeper: 'A skill load makes instructions available. Loading does not prove they were followed or that a referenced command or script executed. A recorded trigger can describe how loading was requested; it does not explain the selection reason or grant tool permission.',
    example: 'A review skill is loaded with instructions to examine a diff. The load is evidence of available instructions, not proof a review was performed.',
    comparison: 'Instructions supply guidance; a loaded skill supplies task-specific instructions and may reference resources or scripts. Use instructions for broad conventions and skills for reusable workflows. Loading does not prove the guidance was followed; script execution needs separate evidence.',
    types: ['skill.invoked'],
  },
  context: {
    label: 'Context',
    definition: 'Information made available to a model, such as messages, instructions or tool results.',
    deeper: 'An input event is one example of context being supplied. Trace does not expose the full active prompt or prove which information a model used, understood or still retains. Its recent event history is not the model’s context window.',
    example: 'A user supplies a code excerpt with a question. That excerpt is supplied context; the message alone cannot prove how the model used it.',
    types: ['user.message'],
  },
  subagent: {
    label: 'Subagent',
    definition: 'Another agent given a piece of delegated work.',
    deeper: 'Lifecycle records can show a delegated agent starting, completing, failing or being cancelled. Missing outcomes remain unknown. A completion report does not independently verify the work, and a name or nearby event does not establish who delegated it.',
    example: 'An agent delegates a focused review. A subagent start records that boundary; a later outcome may report completion or cancellation.',
    types: ['subagent.started', 'subagent.completed', 'subagent.failed'],
  },
  permission: {
    label: 'Permission',
    definition: 'A decision about whether a requested operation may proceed.',
    deeper: 'A request asks for a decision; it is not approval. Approval does not prove the operation executed or had an effect. A recorded decision kind alone does not identify a person, and a missing permission record is unknown rather than assumed approval.',
    example: 'A file-write operation requests permission. An approval would allow it to proceed; separate tool evidence is needed to inspect the reported result.',
    comparison: 'Permissions are a separate authorization mechanism for requested operations. Approval permits an operation, but does not prove execution, effects or task correctness. A missing decision is unknown, never assumed approval. A hook decision request is not itself the applied permission decision.',
    types: ['permission.requested', 'permission.completed'],
  },
  compaction: {
    label: 'Compaction',
    definition: 'An attempt to reduce conversation context for later model turns.',
    deeper: 'A start records an attempt; a result may report success or failure. Reported success does not prove all meaning was preserved, reveal the exact later prompt or establish how later turns behaved. Missing or shortened evidence leaves those details unknown.',
    example: 'The host reports compacting a long conversation. Even a success report does not independently show which details later turns will receive.',
    types: ['session.compaction_start', 'session.compaction_complete'],
  },
}).map(([id, concept]) => [id, Object.freeze({ ...concept, types: Object.freeze(concept.types) })])));

export function conceptForEntry(entry) {
  return Object.keys(vocabulary).find(id => vocabulary[id].types.includes(entry?.type)) || null;
}

const identityFields = ['id', 'type', 'agentId', 'timestamp', 'evidence', 'truncated'];

function usable(entry) {
  return entry && typeof entry.id === 'string' && entry.id.length > 0 && entry.id.length <= 256
    && typeof entry.agentId === 'string' && entry.agentId.length <= 256 && typeof entry.timestamp === 'string'
    && typeof entry.evidence === 'string' && entry.evidence.length <= 12000;
}

export function retainedExample(entries, example) {
  if (!usable(example)) return false;
  const matches = entries.filter(entry => entry.id === example.id);
  return matches.length === 1 && identityFields.every(key => matches[0][key] === example[key])
    && JSON.stringify(matches[0].hostOutput) === JSON.stringify(example.hostOutput);
}

export function glossaryExample(entries, concept, preferred) {
  if (!Object.hasOwn(vocabulary, concept)) return null;
  const matches = entry => vocabulary[concept].types.includes(entry?.type) && retainedExample(entries, entry);
  const entry = matches(preferred) ? preferred : entries.findLast(matches);
  return entry ? Object.freeze({ ...Object.fromEntries(identityFields.map(key => [key, entry[key]])),
    ...(entry.hostOutput ? { hostOutput: Object.freeze({ ...entry.hostOutput }) } : {}) }) : null;
}
