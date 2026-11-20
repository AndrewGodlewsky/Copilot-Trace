import { freezeLearningSnapshot } from './learning.mjs';

export const EXAMPLE_BYTES = 256 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max, empty = false) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0);
function require(value) { if (!value) throw new Error('Example library is missing, malformed or exceeds its supported bounds.'); }
function keys(value, required, optional = []) {
  require(object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => [...required, ...optional].includes(key)));
}
const relative = value => text(value, 256) && value.startsWith('demo/') && !value.includes('..') && !/[\\:?#]/.test(value);
const definitions = {
  'user.message': ['chat', 'User message'], 'assistant.message': ['model', 'Assistant message'],
  'tool.execution_start': ['tool', 'Tool started'], 'tool.execution_complete': ['tool', 'Tool completed'],
  'permission.completed': ['host', 'Permission decision recorded'],
};
function entryFor(event, namespace, calls, messages, requests) {
  keys(event, ['id', 'type', 'timestamp', 'data'], ['agentId']);
  const identity = value => text(value, 128) && value.startsWith(namespace) && /^[a-z0-9:-]+$/.test(value);
  require(identity(event.id) && Object.hasOwn(definitions, event.type));
  require(event.agentId === undefined || identity(event.agentId));
  require(text(event.timestamp, 32) && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.timestamp)
    && Number.isFinite(Date.parse(event.timestamp)) && new Date(event.timestamp).toISOString() === event.timestamp);
  const data = event.data, source = event.agentId ?? '', key = JSON.stringify([source, data?.toolCallId]);
  let toolName = '';
  if (event.type === 'user.message') {
    keys(data, ['content', 'delivery']); require(text(data.content, 4000) && data.delivery === 'idle');
  } else if (event.type === 'assistant.message') {
    keys(data, ['messageId', 'content']); require(identity(data.messageId) && !messages.has(data.messageId) && text(data.content, 4000));
    messages.add(data.messageId);
  } else if (event.type === 'tool.execution_start') {
    keys(data, ['toolCallId', 'toolName', 'arguments']); require(identity(data.toolCallId) && !calls.has(key));
    toolName = data.toolName;
    if (toolName === 'view') { keys(data.arguments, ['path']); require(relative(data.arguments.path)); }
    else if (toolName === 'edit') {
      keys(data.arguments, ['path', 'old_str', 'new_str']);
      require(relative(data.arguments.path) && text(data.arguments.old_str, 2000, true) && text(data.arguments.new_str, 2000, true));
    } else if (toolName === 'powershell') {
      keys(data.arguments, ['command', 'description']); require(text(data.arguments.command, 1000) && text(data.arguments.description, 300));
    } else require(false);
    calls.set(key, { toolName, complete: false, permission: false });
  } else if (event.type === 'tool.execution_complete') {
    keys(data, ['toolCallId', 'success', 'result']);
    const call = calls.get(key); require(identity(data.toolCallId) && call && !call.complete && typeof data.success === 'boolean');
    keys(data.result, ['content'], ['contents']); require(text(data.result.content, 4000, true));
    if (data.result.contents !== undefined) {
      require(call.toolName === 'powershell' && Array.isArray(data.result.contents) && data.result.contents.length === 1);
      const result = data.result.contents[0]; keys(result, ['type', 'shellId', 'exitCode']);
      require(result.type === 'shell_exit' && identity(result.shellId) && Number.isSafeInteger(result.exitCode) && result.exitCode >= 0 && result.exitCode <= 255);
    }
    toolName = call.toolName; call.complete = true;
  } else {
    keys(data, ['requestId', 'toolCallId', 'result']); keys(data.result, ['kind']);
    const call = calls.get(key);
    require(identity(data.requestId) && !requests.has(data.requestId) && identity(data.toolCallId) && call && !call.complete && !call.permission && data.result.kind === 'approved');
    requests.add(data.requestId); call.permission = true;
  }
  const evidence = JSON.stringify(event, null, 2); require(evidence.length <= 12000);
  const [category, label] = definitions[event.type];
  const preview = data.content || '';
  let clipped = preview.slice(0, 179); if (/[\uD800-\uDBFF]$/.test(clipped)) clipped = clipped.slice(0, -1);
  return { id: event.id, type: event.type, timestamp: event.timestamp, category,
    title: toolName ? `${label} · ${toolName}` : label,
    explanation: 'Synthetic demonstration fact, authored for this lesson; not activity from your current chat.',
    displayName: data.toolName || '', model: '', trigger: '', preview: preview.length > 180 ? clipped + '…' : preview,
    agentId: source, turnId: '', hookInvocationId: '', delivery: data.delivery || '', interactionId: '',
    toolCallId: data.toolCallId || '', toolName, success: typeof data.success === 'boolean' ? data.success : null,
    evidence, truncated: false, protectedContentOmitted: false };
}

export function parseExampleLibrary(source) {
  require(typeof source === 'string' && source.length <= EXAMPLE_BYTES && new TextEncoder().encode(source).length <= EXAMPLE_BYTES);
  let library; try { library = JSON.parse(source); } catch { require(false); }
  keys(library, ['schemaVersion', 'examples']); require(library.schemaVersion === 1 && Array.isArray(library.examples) && library.examples.length > 0 && library.examples.length <= 3);
  const ids = new Set();
  return Object.freeze(library.examples.map(example => {
    keys(example, ['id', 'kind', 'title', 'lesson', 'provenance', 'events', 'annotations']);
    require(text(example.id, 40) && /^[a-z][a-z0-9-]*$/.test(example.id) && !ids.has(example.id)); ids.add(example.id);
    require(example.kind === 'synthetic' && text(example.title, 100) && text(example.lesson, 1200) && text(example.provenance, 1000));
    require(Array.isArray(example.events) && example.events.length > 0 && example.events.length <= 30);
    const calls = new Map(), eventIds = new Set(), messages = new Set(), requests = new Set(); let previous = '';
    const entries = example.events.map(event => {
      const entry = entryFor(event, `synthetic:${example.id}:`, calls, messages, requests);
      require(!eventIds.has(entry.id) && entry.timestamp >= previous); eventIds.add(entry.id); previous = entry.timestamp; return entry;
    });
    require(Array.isArray(example.annotations) && example.annotations.length > 0 && example.annotations.length <= 30);
    const annotated = new Set();
    for (const annotation of example.annotations) {
      keys(annotation, ['eventId', 'note', 'alternative']);
      require(eventIds.has(annotation.eventId) && !annotated.has(annotation.eventId) && text(annotation.note, 1200) && text(annotation.alternative, 1200));
      annotated.add(annotation.eventId);
    }
    const { events, ...metadata } = example;
    return Object.freeze({ ...metadata, annotations: Object.freeze(example.annotations.map(annotation => Object.freeze(annotation))),
      snapshot: freezeLearningSnapshot({ history: 'ready', omitted: 0, limit: 300, liveReceipt: null, entries }) });
  }));
}
