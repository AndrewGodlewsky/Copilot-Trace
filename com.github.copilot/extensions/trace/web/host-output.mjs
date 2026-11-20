const object = value => value && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;

// Preserve only a documented fact that can occur after the raw evidence cap.
export function projectHostOutput(event) {
  const data = event?.data, contents = data?.result?.contents;
  const agentId = event?.agentId === undefined ? '' : id(event.agentId) ? event.agentId : null;
  if (event?.type !== 'tool.execution_complete' || !id(event.id) || agentId === null
    || !object(data) || !id(data.toolCallId) || typeof data.success !== 'boolean'
    || (event.timestamp !== undefined && (typeof event.timestamp !== 'string' || event.timestamp.length > 80))
    || !object(data.result) || typeof data.result.content !== 'string' || !Array.isArray(contents) || contents.length > 64) return null;
  let shell;
  for (const block of contents) {
    if (!object(block) || !id(block.type)) return null;
    if (block.type !== 'shell_exit') continue;
    if (shell || !id(block.shellId) || !Number.isSafeInteger(block.exitCode)
      || (block.outputPreview !== undefined && typeof block.outputPreview !== 'string')
      || (block.outputTruncated !== undefined && typeof block.outputTruncated !== 'boolean')) return null;
    shell = block;
  }
  if (shell?.outputTruncated !== true) return null;
  return { eventId: event.id, type: 'shell_exit', agentId, toolCallId: data.toolCallId,
    timestamp: event.timestamp ?? '', outputTruncated: true,
    previewCodeUnits: typeof shell.outputPreview === 'string' ? shell.outputPreview.length : null };
}

export function retainedHostOutput(entry) {
  const fact = entry.hostOutput;
  if (!object(fact) || entry.type !== 'tool.execution_complete' || !id(entry.id) || !id(entry.toolCallId)
    || typeof entry.truncated !== 'boolean' || typeof entry.evidence !== 'string' || entry.evidence.length > 12000
    || typeof entry.timestamp !== 'string' || entry.timestamp.length > 80
    || !(entry.agentId === '' || id(entry.agentId)) || fact.eventId !== entry.id || fact.agentId !== entry.agentId
    || fact.toolCallId !== entry.toolCallId || fact.timestamp !== entry.timestamp
    || fact.type !== 'shell_exit' || fact.outputTruncated !== true
    || !(fact.previewCodeUnits === null || (Number.isSafeInteger(fact.previewCodeUnits) && fact.previewCodeUnits >= 0))
    || Object.keys(fact).length !== 7) return null;
  if (!entry.truncated) {
    let raw;
    try { raw = JSON.parse(entry.evidence); } catch { return null; }
    const checked = projectHostOutput(raw);
    if (!checked || Object.keys(checked).some(key => checked[key] !== fact[key])) return null;
  }
  return fact;
}
