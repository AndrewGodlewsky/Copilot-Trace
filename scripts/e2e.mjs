import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { actionStages, agentLanes, compactionAttempts, delegationHandoffs, hookInvocations, linkValidationClaim, permissionScope, retainedValidationLink, retrievalLedger, skillInstructions, toolExtents, toolProvenance, summarize, validationChecks, validationClaims, validationOverview } from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { compareCapabilities } from '../com.github.copilot/extensions/trace/web/capabilities.mjs';
import { instructionSources } from '../com.github.copilot/extensions/trace/web/instructions.mjs';

const sdkDirectory = process.env.COPILOT_SDK_DIR;
const cli = process.env.COPILOT_CLI_PATH;
assert.ok(sdkDirectory && cli && isAbsolute(sdkDirectory) && isAbsolute(cli), 'Set COPILOT_SDK_DIR and COPILOT_CLI_PATH to absolute paths for the inspected installed SDK/runtime pair.');
const { CopilotClient, RuntimeConnection } = await import(pathToFileURL(join(sdkDirectory, 'index.js')).href);
const root = fileURLToPath(new URL('../', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'trace-runtime-'));
const project = join(temporary, 'project');
const home = join(temporary, 'home');
await mkdir(project);
let requests = 0;
let allowSyntheticResponses = false;
let allowAgentResponses = false;
let permissionFixture;
let provenanceFixture;
let retrievalFixture;
let nestedFixture;
let validationFixture;
const compactionSummary = 'Fixed local compaction summary. Literal café 🧪 <script>text</script>.';
const nestedPrompt = 'Fixed nested handoff café 🧪 <script>text</script>.';
const nestedLeafResult = 'Fixed leaf result café 🧪 <script>leaf</script>.';
const nestedMiddleResult = 'Fixed middle result café 🧪 <script>middle</script>.';
let mcpRequests = 0;
const mcpMethods = [];
let fixtureError;
let releaseFirst;
const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
let releaseAgents;
const agentResponses = new Promise(resolve => { releaseAgents = resolve; });
async function serveMcpFixture(req, res) {
  mcpRequests++;
  assert.ok(provenanceFixture && ['/mcp/first', '/mcp/second'].includes(req.url));
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  mcpMethods.push({ path: req.url, method: body.method });
  if (body.id === undefined) { res.writeHead(202); res.end(); return; }
  let result;
  if (body.method === 'initialize') result = { protocolVersion: body.params.protocolVersion, capabilities: { tools: {} },
    serverInfo: { name: 'same-fixture-server', version: '1.0.0', title: 'Same fixture provider' } };
  else if (body.method === 'tools/list') result = { tools: [{ name: 'echo', title: 'Same fixture tool',
    description: 'Fixed local text only.', inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true } }] };
  else if (body.method === 'tools/call') {
    assert.equal(provenanceFixture.allowCalls, true);
    assert.equal(body.params.name, 'echo');
    assert.deepEqual(body.params.arguments, {});
    assert.equal(mcpMethods.filter(item => item.path === req.url && item.method === 'tools/call').length, 1);
    result = { content: [{ type: 'text', text: 'Fixed local fixture output.' }] };
  } else if (body.method === 'ping') result = {};
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, ...(result ? { result }
    : { error: { code: -32601, message: 'Method not found in fixture' } }) }));
}
const fixture = createServer(async (req, res) => {
  if (req.url?.startsWith('/mcp/')) {
    try { await serveMcpFixture(req, res); }
    catch (error) { fixtureError = error; if (!res.headersSent) res.writeHead(500); res.end('Synthetic MCP fixture failure.'); }
    return;
  }
  const number = ++requests;
  if (!allowSyntheticResponses || number > (validationFixture ? 22 : nestedFixture ? 20 : retrievalFixture ? 14 + (retrievalFixture.allowCompaction ? 1 : 0) : provenanceFixture ? 12 : permissionFixture ? 10 : allowAgentResponses ? 7 : 3)) {
    req.resume(); res.writeHead(500); res.end('Unexpected fixture inference request.'); return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (number === 1) await firstResponse;
    let message = { role: 'assistant', content: 'Synthetic local fixture response.' }, reason = 'stop';
    if (permissionFixture) {
      assert.ok(++permissionFixture.responses <= (permissionFixture.approved ? 2 : 1));
      assert.deepEqual(body.tools.map(tool => tool.function?.name), ['powershell']);
      if (permissionFixture.responses === 1) {
        message = { role: 'assistant', content: null, tool_calls: [{ id: permissionFixture.callId, type: 'function',
          function: { name: 'powershell', arguments: JSON.stringify({ command: permissionFixture.command,
            description: 'Write one disposable fixture file', timeout_ms: 5000 }) } }] };
        reason = 'tool_calls';
      }
    }
    if (provenanceFixture) {
      assert.ok(provenanceFixture.allowCalls && ++provenanceFixture.responses <= 2);
      assert.deepEqual(body.tools.map(tool => tool.function?.name).sort(), provenanceFixture.tools.map(tool => tool.name).sort());
      const prompt = JSON.stringify(body.messages);
      assert.ok(prompt.includes(provenanceFixture.instructionText), 'The explicit global source reaches the fixed model request.');
      assert.ok(prompt.includes(provenanceFixture.organizationText), 'Organization guidance can reach the model while absent from the source catalog.');
      assert.equal(prompt.includes(provenanceFixture.scopedMarker), false, 'A cataloged conditional body is not necessarily supplied in this turn.');
      if (provenanceFixture.responses === 1) {
        message = { role: 'assistant', content: null, tool_calls: provenanceFixture.tools.map(tool => ({
          id: `fixture-mcp-${tool.mcpServerName}`, type: 'function',
          function: { name: tool.name, arguments: '{}' } })) };
        reason = 'tool_calls';
      }
    }
    if (retrievalFixture) {
      assert.ok(retrievalFixture.allowCalls && ++retrievalFixture.responses <= (retrievalFixture.allowCompaction ? 3 : 2));
      assert.deepEqual(body.tools.map(tool => tool.function?.name).sort(), ['grep', 'view']);
      if (retrievalFixture.responses === 1) {
        message = { role: 'assistant', content: null, tool_calls: retrievalFixture.calls.map(call => ({
          id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) };
        reason = 'tool_calls';
      }
      if (retrievalFixture.responses === 3) {
        assert.equal(retrievalFixture.allowCompaction, true);
        message = { role: 'assistant', content: compactionSummary };
      }
    }
    if (nestedFixture) {
      assert.ok(nestedFixture.allowCalls && ++nestedFixture.responses <= 5);
      const step = nestedFixture.responses;
      assert.deepEqual((body.tools ?? []).map(tool => tool.function?.name), step === 3 ? [] : ['task']);
      if (step === 1 || step === 2) {
        const name = step === 1 ? 'outer' : 'inner';
        message = { role: 'assistant', content: null, tool_calls: [{ id: `fixture-nested-${name}`, type: 'function',
          function: { name: 'task', arguments: JSON.stringify({ name, description: `Owned ${name} delegation`,
            prompt: `${nestedPrompt} ${name}`, agent_type: step === 1 ? 'trace-middle-agent' : 'trace-leaf-agent', mode: 'sync' }) } }] };
        reason = 'tool_calls';
      } else message = { role: 'assistant', content: step === 3 ? nestedLeafResult
        : step === 4 ? nestedMiddleResult : 'Fixed parent response.' };
    }
    if (validationFixture) {
      assert.ok(validationFixture.allowCalls && ++validationFixture.responses <= 2);
      assert.deepEqual((body.tools ?? []).map(tool => tool.function?.name), ['powershell']);
      if (validationFixture.responses === 1) {
        message = { role: 'assistant', content: null, tool_calls: [{ id: validationFixture.callId, type: 'function',
          function: { name: 'powershell', arguments: JSON.stringify({ command: validationFixture.command,
            description: 'Run the owned failing fixture', timeout_ms: 5000 }) } }] };
        reason = 'tool_calls';
      } else message = { role: 'assistant', content: 'Tests passed.' };
    }
    if (number === 4) {
      assert.ok(body.tools.some(tool => tool.function?.name === 'task'));
      message = { role: 'assistant', content: null, tool_calls: ['one', 'two'].map(name => ({
        id: `fixture-task-${name}`, type: 'function', function: { name: 'task', arguments: JSON.stringify({
          name, description: 'Synthetic local fixture', prompt: 'Return the fixed fixture response.',
          agent_type: 'trace-fixture-agent', mode: 'sync' }) } })) };
      reason = 'tool_calls';
    }
    if (number === 5 || number === 6) {
      assert.equal(body.tools?.length ?? 0, 0, 'Synthetic child agents must have no actual model-facing tools.');
      if (number === 6) setTimeout(releaseAgents, 20);
      await agentResponses;
    }
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const first = message.tool_calls ? { ...message, tool_calls: message.tool_calls.map((tool, index) => ({ index, ...tool })) } : message;
      for (const [delta, finish_reason] of [[first, null], [{}, reason]]) {
        res.write('data: ' + JSON.stringify({ id: `fixture-${number}`, object: 'chat.completion.chunk',
          created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
      }
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: `fixture-${number}`, object: 'chat.completion', model: 'fixture',
        choices: [{ index: 0, message, finish_reason: reason }] }));
    }
  } catch (error) {
    fixtureError = error;
    if (!res.headersSent) res.writeHead(500);
    res.end('Synthetic fixture failure.');
  }
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const client = new CopilotClient({
  mode: 'empty', baseDirectory: home, workingDirectory: project, useLoggedInUser: false,
  builtinPluginDirectories: [root],
  connection: RuntimeConnection.forStdio({ path: cli, args: ['--no-auto-update'] }),
  env: { ...process.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, COPILOT_HOME: home, GH_CONFIG_DIR: join(temporary, 'gh') },
});
let session;
let expired = false;
const timer = setTimeout(() => { expired = true; void client.forceStop(); }, 45000);
async function until(read, accept, label) {
  for (let i = 0; i < 80; i++) {
    const result = await read();
    if (accept(result)) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${label}`);
}
try {
  await client.start();
  session = await client.createSession({
    workingDirectory: project, configDirectory: home, availableTools: [],
    requestExtensions: true, requestCanvasRenderer: true,
    extensionSdkPath: sdkDirectory, pluginDirectories: [root], enableConfigDiscovery: false,
    onPermissionRequest: () => ({ kind: 'reject' }),
    model: 'fixture', provider: { type: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'fixture', wireApi: 'completions' },
  });
  const catalog = await until(() => session.rpc.canvas.list(), value => value.canvases?.some(canvas => canvas.canvasId === 'trace'), 'canvas registration');
  const provider = catalog.canvases.find(canvas => canvas.canvasId === 'trace');
  assert.equal(provider.extensionId, 'plugin:trace:trace');
  const historical = await session.rpc.log({ message: 'Trace fixture history 日本語 😀', type: 'trace-fixture' });
  const input = { canvasId: 'trace', instanceId: 'trace-fixture', input: {} };
  const first = await session.rpc.canvas.open(input);
  const page = await fetch(first.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>Trace<\/title>/);
  assert.equal((await fetch(first.url + 'app.mjs')).status, 200);
  assert.equal((await fetch(first.url + 'presentation.mjs')).status, 200);
  for (const asset of ['footer.mjs', 'diagnostics.mjs', 'polling.mjs', 'follow.mjs', 'capabilities.mjs', 'host-output.mjs', 'instructions.mjs']) assert.equal((await fetch(first.url + asset)).status, 200);
  const metadata = await (await fetch(first.url + 'metadata')).json();
  assert.equal(metadata.version, JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8')).version);
  assert.equal(metadata.releases[0].version, metadata.version);
  const diagnostics = await (await fetch(first.url + 'diagnostics')).json();
  assert.ok(diagnostics.diagnostics.entries.some(entry => entry.code === 'server_started'));
  assert.equal(await (await fetch(first.url + 'trace.svg')).text(), await readFile(join(root, 'assets/trace.svg'), 'utf8'));
  const history = await until(() => fetch(first.url + 'events').then(r => r.json()),
    value => value.history !== 'loading', 'history load');
  assert.equal(history.history, 'ready');
  assert.ok(history.entries.some(entry => entry.id === historical.eventId && entry.evidence.includes('日本語 😀')), 'Attached extension must receive actual session history.');
  const live = await session.rpc.log({ message: 'Trace fixture live <script>literal</script>', type: 'trace-fixture' });
  const observed = await until(() => fetch(first.url + 'events').then(r => r.json()),
    value => value.entries.some(entry => entry.id === live.eventId), 'live session event');
  assert.equal(observed.entries.filter(entry => entry.id === live.eventId).length, 1);
  assert.equal((await session.rpc.canvas.open(input)).url, first.url);
  await session.rpc.canvas.close({ instanceId: input.instanceId });
  await until(() => fetch(first.url).then(() => false, () => true), Boolean, 'server shutdown');
  const reopened = await session.rpc.canvas.open(input);
  assert.notEqual(reopened.url, first.url);
  assert.equal((await fetch(reopened.url + 'style.css')).status, 200);
  await session.rpc.canvas.close({ instanceId: input.instanceId });
  await until(() => fetch(reopened.url).then(() => false, () => true), Boolean, 'reopened server shutdown');
  assert.equal(requests, 0);

  // Only this explicit input fixture uses synthetic local responses; opening Trace made no requests.
  allowSyntheticResponses = true;
  const rawInputs = [], rawTurns = [];
  const unsubscribe = session.on(event => {
    if (event.type === 'user.message') rawInputs.push(event);
    if (event.type === 'assistant.turn_start') rawTurns.push(event);
  });
  const chapterPanel = await session.rpc.canvas.open(input);
  await session.send({ prompt: 'Synthetic first request' });
  await until(async () => requests, count => count === 1, 'first local fixture request');
  await session.send({ prompt: 'Synthetic immediate input', mode: 'immediate' });
  await session.send({ prompt: 'Synthetic queued input', mode: 'enqueue' });
  releaseFirst();
  const chapterSnapshot = await until(() => fetch(chapterPanel.url + 'events').then(r => r.json()),
    value => value.entries.filter(entry => entry.type === 'assistant.turn_end').length === 3, 'synthetic request completion');
  unsubscribe();
  assert.equal(requests, 3, 'Only the three expected local synthetic responses are permitted.');
  assert.equal(rawInputs.length, 3);
  assert.equal(rawInputs[0].data.delivery, 'idle');
  assert.ok(['steering', 'queued'].includes(rawInputs[1].data.delivery), 'Use recorded delivery, not requested send mode.');
  assert.equal(rawInputs[2].data.delivery, 'queued');
  for (const raw of rawInputs) {
    const projected = chapterSnapshot.entries.find(entry => entry.id === raw.id);
    assert.ok(projected, 'Actual host user event is retained by the attached extension.');
    assert.equal(projected.delivery, raw.data.delivery);
    assert.ok(typeof raw.data.interactionId === 'string' && raw.data.interactionId.length > 0);
    assert.equal(projected.interactionId, raw.data.interactionId);
    const rawTurn = rawTurns.find(turn => turn.data.interactionId === raw.data.interactionId);
    assert.ok(rawTurn, 'Actual consuming run has a matching interaction ID.');
    const projectedTurn = chapterSnapshot.entries.find(entry => entry.id === rawTurn.id);
    assert.equal(projectedTurn?.interactionId, raw.data.interactionId);
  }
  await session.rpc.canvas.close({ instanceId: input.instanceId });
  await until(() => fetch(chapterPanel.url).then(() => false, () => true), Boolean, 'chapter fixture server shutdown');
  await session.disconnect();

  // A second disposable session verifies actual delegation identities, using only the task tool.
  session = await client.createSession({
    workingDirectory: project, configDirectory: home, availableTools: ['builtin:task'],
    requestExtensions: true, requestCanvasRenderer: true,
    extensionSdkPath: sdkDirectory, pluginDirectories: [root], enableConfigDiscovery: false,
    customAgents: [{ name: 'trace-fixture-agent', displayName: 'Same fixture display name',
      description: 'Synthetic local fixture only.', prompt: 'Return the fixed fixture response.',
      tools: [], model: 'fixture', modelPolicy: 'required', skills: [], mcpServers: {} }],
    onPermissionRequest: () => ({ kind: 'reject' }),
    model: 'fixture', provider: { type: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'fixture', wireApi: 'completions' },
  });
  await session.rpc.tools.initializeAndValidate();
  assert.deepEqual((await session.rpc.tools.getCurrentMetadata()).tools.map(tool => tool.name), ['task']);
  await until(() => session.rpc.canvas.list(), value => value.canvases?.some(canvas => canvas.canvasId === 'trace'), 'agent canvas registration');
  const agentEvents = [];
  const stopAgentEvents = session.on(event => agentEvents.push(event));
  const agentPanel = await session.rpc.canvas.open(input);
  assert.equal(requests, 3, 'Opening the agent fixture canvas must not trigger inference.');
  allowAgentResponses = true;
  await session.sendAndWait({ prompt: 'Synthetic delegation fixture only.' }, 30000);
  if (fixtureError) throw fixtureError;
  const agentSnapshot = await until(() => fetch(agentPanel.url + 'events').then(r => r.json()),
    value => value.history === 'ready' && value.entries.filter(entry => entry.type === 'subagent.completed').length === 2
      && agentEvents.filter(event => ['subagent.started', 'subagent.completed', 'assistant.turn_start', 'tool.execution_start', 'tool.execution_complete'].includes(event.type))
        .every(event => value.entries.some(entry => entry.id === event.id)), 'agent lifecycle and result projection');
  stopAgentEvents();
  assert.equal(requests, 7, 'Only three input and four delegation fixture responses are permitted.');
  assert.equal(agentEvents.some(event => event.type === 'session.error'), false);
  const starts = agentEvents.filter(event => event.type === 'subagent.started');
  const ends = agentEvents.filter(event => event.type === 'subagent.completed');
  assert.equal(starts.length, 2);
  assert.equal(ends.length, 2);
  assert.equal(new Set(starts.map(event => event.agentId)).size, 2, 'Identical display names must still have distinct agent identities.');
  assert.deepEqual([...new Set(starts.map(event => event.data.agentDisplayName))], ['Same fixture display name']);
  for (const start of starts) {
    assert.ok(typeof start.agentId === 'string' && start.agentId.length > 0 && start.agentId.length <= 256);
    const end = ends.find(event => event.agentId === start.agentId);
    assert.equal(end.data.toolCallId, start.data.toolCallId);
    assert.ok(agentEvents.some(event => event.type === 'tool.execution_start' && event.agentId === undefined && event.data.toolCallId === start.data.toolCallId));
    assert.ok(agentEvents.some(event => event.type === 'assistant.turn_start' && event.agentId === start.agentId && event.data.parentToolCallId === start.data.toolCallId));
  }
  assert.ok(Math.max(...starts.map(event => Date.parse(event.timestamp))) < Math.min(...ends.map(event => Date.parse(event.timestamp))), 'Held synthetic responses produce observed overlapping lifecycles.');
  for (const raw of agentEvents.filter(event => ['subagent.started', 'subagent.completed', 'assistant.turn_start', 'tool.execution_start', 'tool.execution_complete'].includes(event.type))) {
    const projected = agentSnapshot.entries.find(entry => entry.id === raw.id);
    assert.ok(projected, 'Attached Trace retains actual agent and delegation records.');
    assert.equal(projected.agentId, raw.agentId ?? '');
    assert.equal(projected.toolCallId, raw.data.toolCallId ?? '');
    assert.equal(projected.timestamp, raw.timestamp);
    const evidence = JSON.parse(projected.evidence);
    assert.equal(evidence.agentId, raw.agentId);
    assert.equal(evidence.data.toolCallId, raw.data.toolCallId);
    assert.equal(evidence.data.parentToolCallId, raw.data.parentToolCallId);
  }
  const laneView = agentLanes(agentSnapshot.entries, agentSnapshot);
  const parallelHandoffs = delegationHandoffs(agentSnapshot.entries, agentSnapshot);
  assert.equal(parallelHandoffs.length, 2);
  assert.ok(laneView.scale && laneView.scale.end > laneView.scale.start);
  assert.ok(laneView.overlaps >= 1, 'Actual retained child lifecycles produce recorded lane overlap.');
  for (const start of starts) {
    const lane = laneView.lanes.find(value => value.agentId === start.agentId);
    const end = ends.find(event => event.agentId === start.agentId);
    const spawning = agentEvents.find(event => event.type === 'tool.execution_start' && event.agentId === undefined && event.data.toolCallId === start.data.toolCallId);
    assert.ok(lane, 'The lane identity comes from the actual child source, not its reused display name.');
    assert.equal(lane.parentId, spawning.id);
    assert.deepEqual(lane.intervals, [{ start: Date.parse(start.timestamp), end: Date.parse(end.timestamp), startId: start.id, endId: end.id }]);
    assert.ok(lane.links.some(link => link.id === start.id) && lane.links.some(link => link.id === end.id));
    const handoff = parallelHandoffs.find(value => value.agentId === start.agentId);
    const returned = agentEvents.find(event => event.type === 'tool.execution_complete' && event.agentId === undefined && event.data.toolCallId === start.data.toolCallId);
    assert.equal(handoff.status, 'linked');
    assert.equal(handoff.lifecycle, 'completed');
    assert.equal(handoff.parentAgentId, '');
    assert.equal(handoff.toolCallId, spawning.data.toolCallId);
    assert.equal(handoff.parentStart.id, spawning.id);
    assert.equal(handoff.parentResult.id, returned.id);
    assert.equal(handoff.handoff.status, 'complete');
    assert.equal(handoff.handoff.prompt, spawning.data.arguments.prompt);
    assert.equal(handoff.handoff.description, spawning.data.arguments.description);
    assert.equal(handoff.result.status, 'complete');
    assert.equal(handoff.result.success, true);
    assert.equal(handoff.result.content, returned.data.result.content);
    assert.ok(handoff.entries.every(entry => entry.agentId === start.agentId));
    for (const id of [spawning.id, start.id, end.id, returned.id]) assert.ok(handoff.links.some(link => link.entry.id === id));
  }
  await session.rpc.canvas.close({ instanceId: input.instanceId });
  await until(() => fetch(agentPanel.url).then(() => false, () => true), Boolean, 'agent fixture server shutdown');
  await session.disconnect();

  // Native invocation starts precede permission evaluation, including when the operation is denied.
  for (const approved of [false, true]) {
    const phase = approved ? 'approved' : 'denied';
    const output = join(project, `permission-${phase}.txt`);
    const callId = `fixture-permission-${phase}`;
    const command = `Set-Content -LiteralPath '${output.replaceAll("'", "''")}' -Value 'Trace fixture'`
      + (approved ? "; Write-Output ('fixture-output-' * 10000)" : '');
    let permissionCalls = 0;
    const actionEvents = [];
    session = await client.createSession({
      workingDirectory: project, configDirectory: home, availableTools: ['builtin:powershell'],
      requestExtensions: true, requestCanvasRenderer: true,
      extensionSdkPath: sdkDirectory, pluginDirectories: [root], enableConfigDiscovery: false,
      onPermissionRequest: async request => {
        assert.equal(request.kind, 'shell');
        assert.equal(request.toolCallId, callId);
        assert.equal(request.fullCommandText, command);
        permissionCalls++;
        const pendingSnapshot = await until(() => fetch(actionPanel.url + 'events').then(response => response.json()),
          value => value.entries.some(entry => entry.type === 'tool.execution_start' && entry.toolCallId === callId), 'pending invocation projection');
        const pendingStages = actionStages(pendingSnapshot.entries, pendingSnapshot)
          .get(pendingSnapshot.entries.find(entry => entry.type === 'tool.execution_start' && entry.toolCallId === callId).id);
        assert.equal(pendingStages.permission, 'Permission unknown', 'An invocation before a decision must not imply authorization.');
        assert.equal(pendingStages.stages.some(stage => stage.type === 'permission.completed' || stage.type === 'tool.execution_complete'), false);
        return { kind: approved ? 'approve-once' : 'reject' };
      },
      model: 'fixture', provider: { type: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'fixture', wireApi: 'completions' },
    });
    await session.rpc.tools.initializeAndValidate();
    assert.deepEqual((await session.rpc.tools.getCurrentMetadata()).tools.map(tool => tool.name), ['powershell']);
    await until(() => session.rpc.canvas.list(), value => value.canvases?.some(canvas => canvas.canvasId === 'trace'), 'permission canvas registration');
    const stopActionEvents = session.on(event => actionEvents.push(event));
    const requestsBeforeOpen = requests;
    const actionPanel = await session.rpc.canvas.open(input);
    assert.equal(requests, requestsBeforeOpen, 'Opening the permission fixture canvas must not trigger inference.');
    permissionFixture = { approved, callId, command, responses: 0 };
    await session.sendAndWait({ prompt: 'Synthetic disposable-file permission fixture only.' }, 25000);
    if (fixtureError) throw fixtureError;
    const actionSnapshot = await until(() => fetch(actionPanel.url + 'events').then(r => r.json()),
      value => value.history === 'ready' && value.entries.some(entry => entry.type === 'tool.execution_complete' && entry.toolCallId === callId), 'permission lifecycle projection');
    stopActionEvents();
    assert.equal(permissionCalls, 1);
    assert.equal(permissionFixture.responses, approved ? 2 : 1);
    assert.equal(actionEvents.some(event => event.type === 'session.error'), false);
    const proposed = actionEvents.find(event => event.type === 'assistant.message' && event.data.toolRequests?.length);
    const started = actionEvents.find(event => event.type === 'tool.execution_start');
    const requested = actionEvents.find(event => event.type === 'permission.requested');
    const decided = actionEvents.find(event => event.type === 'permission.completed');
    const completed = actionEvents.find(event => event.type === 'tool.execution_complete');
    assert.equal(proposed.data.toolRequests[0].toolCallId, callId);
    assert.equal(started.data.toolCallId, callId);
    assert.equal(requested.data.permissionRequest.toolCallId, callId);
    assert.equal(decided.data.requestId, requested.data.requestId);
    assert.equal(decided.data.toolCallId, callId);
    assert.equal(decided.data.result.kind, approved ? 'approved' : 'denied-interactively-by-user');
    assert.equal(completed.data.toolCallId, callId);
    assert.equal(completed.data.success, approved);
    assert.ok(actionEvents.indexOf(started) < actionEvents.indexOf(requested), 'Invocation start is not proof that the underlying operation executed.');
    const outputText = await readFile(output, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    assert.equal(outputText !== null, approved, 'The denied operation creates no file; the approved operation creates only its disposable fixture file.');
    if (approved) {
      assert.equal(outputText.trim(), 'Trace fixture');
      const shellOutput = completed.data.result.contents.find(item => item.type === 'shell_exit');
      assert.equal(shellOutput.exitCode, 0);
      assert.equal(shellOutput.outputTruncated, true, 'The installed host explicitly reports an incomplete output preview.');
      assert.equal(shellOutput.outputPreview.length, 500);
      assert.ok(shellOutput.outputFilePath, 'The host may expose an output file, but Trace must never open it.');
      const projectedOutput = actionSnapshot.entries.find(entry => entry.id === completed.id);
      assert.equal(projectedOutput.hostOutput.previewCodeUnits, 500);
      const extent = toolExtents(actionSnapshot.entries, actionSnapshot).get(completed.id);
      assert.equal(extent.hostShortened, true);
      assert.equal(extent.traceClipped, false);
      assert.ok(extent.badges.includes('Host-shortened preview'));
      assert.equal(extent.coverage, 'Unknown coverage');
    }
    // This attached runtime delivers the request to its owner, but not to Trace's joined observer.
    assert.equal(actionSnapshot.entries.some(entry => entry.id === requested.id), false);
    assert.ok((await session.getEvents()).some(event => event.id === requested.id), 'The owning client retains the request in history despite its absence from Trace live delivery.');
    for (const raw of [proposed, started, decided, completed]) {
      const projected = actionSnapshot.entries.find(entry => entry.id === raw.id);
      assert.ok(projected, `Attached Trace retains ${raw.type} (checkpoint ${String(raw.checkpoint)}); observed ${actionSnapshot.entries.map(entry => entry.type).join(', ')}.`);
      assert.equal(projected.agentId, raw.agentId ?? '');
      assert.equal(projected.timestamp, raw.timestamp);
      const evidence = JSON.parse(projected.evidence);
      assert.equal(evidence.id, raw.id);
      assert.equal(evidence.type, raw.type);
      assert.deepEqual(evidence.data, raw.data);
    }
    const stages = actionStages(actionSnapshot.entries, actionSnapshot).get(started.id);
    assert.equal(toolProvenance(actionSnapshot.entries).get(started.id).origin, 'Unknown',
      'A familiar native tool name without origin metadata must not be attributed by name.');
    assert.deepEqual(stages.stages.map(stage => stage.id), [proposed.id, started.id, decided.id, completed.id]);
    assert.equal(stages.permission, `Recorded permission: ${approved ? 'approved' : 'denied'}`);
    assert.equal(stages.stages.find(stage => stage.id === decided.id).decisionSource, null, 'A result kind mentioning user does not establish who decided.');
    const requestScope = stages.stages.find(stage => stage.id === decided.id).scope;
    assert.equal(requestScope.kind, approved ? 'request' : 'unknown');
    assert.equal(requestScope.approvalKind, null);
    assert.equal(stages.stages.find(stage => stage.id === completed.id).label, `Tool result: reported ${approved ? 'success' : 'failure'}`);
    await session.rpc.canvas.close({ instanceId: input.instanceId });
    await until(() => fetch(actionPanel.url).then(() => false, () => true), Boolean, 'permission fixture server shutdown');
    const historyPanel = await session.rpc.canvas.open(input);
    const historySnapshot = await until(() => fetch(historyPanel.url + 'events').then(response => response.json()),
      value => value.history === 'ready', 'permission history projection');
    const historyRequest = historySnapshot.entries.find(entry => entry.id === requested.id);
    assert.ok(historyRequest, 'Opening a new observer retains the permission request from history.');
    assert.deepEqual(JSON.parse(historyRequest.evidence).data, requested.data);
    assert.equal(requested.data.ownerSessionId, session.sessionId);
    if (approved) {
      const historyCompletion = historySnapshot.entries.find(entry => entry.id === completed.id);
      assert.equal(JSON.parse(historyCompletion.evidence).data.result.contents.find(item => item.type === 'shell_exit').outputTruncated,
        true, 'The immediate fresh observer also retains this installed runtime\'s structured preview flag.');
      assert.equal(historyCompletion.hostOutput.previewCodeUnits, 500);
      assert.equal(toolExtents(historySnapshot.entries, historySnapshot).get(completed.id).hostShortened, true);
    }
    const historyStages = actionStages(historySnapshot.entries, historySnapshot).get(started.id);
    assert.equal(historyStages.permission, 'Permission unknown', 'Recovery ownership cannot be correlated without a verified owner mapping in the snapshot.');
    assert.deepEqual(historyStages.stages.map(stage => stage.id), [proposed.id, started.id, completed.id]);
    assert.ok(historySnapshot.entries.some(entry => entry.id === decided.id), 'Unlinked permission evidence remains available in its original row.');
    await session.rpc.canvas.close({ instanceId: input.instanceId });
    await until(() => fetch(historyPanel.url).then(() => false, () => true), Boolean, 'permission history server shutdown');
    await session.disconnect();
  }
  // Session creation explicitly starts these owned local MCP fixtures; observing Trace must not.
  permissionFixture = undefined;
  provenanceFixture = { tools: [], responses: 0, allowCalls: false };
  const instructionRoot = join(temporary, 'instructions');
  await mkdir(instructionRoot);
  const instructionPath = join(instructionRoot, 'fixture.instructions.md');
  const instructionText = 'Owned global instruction fixture: café 🧪 <script>literal</script>.';
  const organizationText = 'Owned organization guidance fixture: instructions not enumerated by getSources.';
  const scopedMarker = 'Owned conditional instruction body marker 84e9-scope.';
  const initialInstructionBody = `---\napplyTo: "**"\n---\n${instructionText}\n`;
  const scopedInstructionBody = `---\napplyTo: "src/**/*.js"\ndescription: "Owned conditional fixture"\n---\n${scopedMarker}\n`;
  await writeFile(instructionPath, initialInstructionBody);
  await writeFile(join(instructionRoot, 'scoped.instructions.md'), scopedInstructionBody);
  Object.assign(provenanceFixture, { instructionText, organizationText, scopedMarker });
  const mcpEvents = [];
  const hookCalls = [];
  const skillBody = '# Fixture instructions\n\nKeep this exact Unicode text: café 🧪.\n\n<script>literal only</script>\n\n```text\n  preserve whitespace\n```\n';
  let currentSkillBody = skillBody;
  let skillReads = 0;
  let skillLists = 0;
  const fixtureHook = type => input => {
    hookCalls.push({ type, toolName: input.toolName, toolCallId: input.toolCallId });
    return { additionalContext: 'Fixed local hook context.' };
  };
  const fixtureBase = `http://127.0.0.1:${fixture.address().port}`;
  session = await client.createSession({
    workingDirectory: project, configDirectory: home, availableTools: ['mcp:*'],
    requestExtensions: true, requestCanvasRenderer: true,
    extensionSdkPath: sdkDirectory, pluginDirectories: [root], enableConfigDiscovery: false, enableSkills: true,
    skipCustomInstructions: false, instructionDirectories: [instructionRoot], organizationCustomInstructions: organizationText,
    skillProvider: {
      listSkills() {
        skillLists++;
        return [{ name: 'fixture-auto', description: 'Fixed local skill content fixture.' },
          { name: 'fixture-manual', description: 'Fixed manual-only fixture.', disableModelInvocation: true }];
      },
      readSkill(name) { assert.equal(name, 'fixture-auto'); skillReads++; return currentSkillBody; },
    },
    hooks: { onPreToolUse: fixtureHook('preToolUse'), onPostToolUse: fixtureHook('postToolUse'),
      onUserPromptSubmitted: fixtureHook('userPromptSubmitted') },
    mcpServers: Object.fromEntries(['first', 'second'].map(name => [name, { type: 'http', url: `${fixtureBase}/mcp/${name}`, tools: ['*'] }])),
    onPermissionRequest: request => { assert.equal(request.kind, 'mcp'); return { kind: 'approve-once' }; },
    model: 'fixture', provider: { type: 'openai', baseUrl: fixtureBase + '/v1', apiKey: 'fixture', wireApi: 'completions' },
  });
  await until(() => session.rpc.canvas.list(), value => value.canvases?.some(canvas => canvas.canvasId === 'trace'), 'provenance canvas registration');
  const beforeMetadata = mcpRequests;
  const mcpMetadata = await session.rpc.tools.getCurrentMetadata();
  assert.deepEqual(await session.rpc.tools.getCurrentMetadata(), mcpMetadata);
  assert.equal(mcpRequests, beforeMetadata, 'Reading initialized metadata makes no additional MCP requests.');
  assert.equal(mcpMethods.filter(item => item.method === 'initialize').length, 2);
  assert.equal(mcpMethods.filter(item => item.method === 'tools/call').length, 0);
  assert.equal(mcpMetadata.tools.length, 2);
  assert.deepEqual(mcpMetadata.tools.map(tool => tool.mcpServerName).sort(), ['first', 'second']);
  assert.ok(mcpMetadata.tools.every(tool => tool.mcpToolName === 'echo'));
  assert.equal(new Set(mcpMetadata.tools.map(tool => tool.name)).size, 2);
  const stopMcpEvents = session.on(event => mcpEvents.push(event));
  const mcpPanel = await session.rpc.canvas.open(input);
  const initialMcpSnapshot = await until(() => fetch(mcpPanel.url + 'events').then(response => response.json()), value => value.history === 'ready', 'provenance observation');
  assert.equal(mcpRequests, beforeMetadata, 'Opening and observing Trace makes no additional MCP requests.');
  assert.equal(requests, 10, 'Metadata reads and Trace observation make no inference requests.');
  assert.equal(skillReads, 0, 'Observing Trace must not read a skill body.');
  const beforeInventoryLists = skillLists;
  const readInstructionSources = async expectedBody => {
    const response = await fetch(mcpPanel.url + 'instruction-sources');
    assert.equal(response.status, 200);
    const inventory = await response.json();
    assert.equal(inventory.schemaVersion, 1);
    assert.equal(inventory.scope, 'main-session');
    assert.ok(Number.isFinite(Date.parse(inventory.capturedAt)));
    assert.equal(inventory.sources.status, 'ready');
    assert.equal(inventory.sources.items.length, 2, 'Only the explicit owned instruction files are cataloged.');
    assert.equal(inventory.sources.omitted, 0);
    assert.equal(inventory.sources.invalid, 0);
    assert.equal(inventory.sources.clipped, 0);
    const globalSource = inventory.sources.items.find(item => item.id === 'vscode-instructions/external/fixture.instructions.md');
    const scopedSource = inventory.sources.items.find(item => item.id === 'vscode-instructions/external/scoped.instructions.md');
    assert.ok(globalSource?.identityValid && scopedSource?.identityValid);
    assert.equal(globalSource.sourcePath, instructionPath);
    assert.equal(globalSource.type, 'vscode');
    assert.equal(globalSource.location, 'repository');
    assert.equal(globalSource.applyTo, null, 'The runtime omits a universal scope field; omission stays unknown.');
    assert.equal(globalSource.content, expectedBody);
    assert.equal(globalSource.contentStatus, 'complete');
    assert.equal(scopedSource.content, scopedInstructionBody);
    assert.deepEqual(scopedSource.applyTo, ['src/**/*.js']);
    assert.ok(inventory.sources.items.every(item => item.defaultDisabled === null));
    assert.equal(JSON.stringify(inventory).includes(organizationText), false);
    assert.equal(skillLists, beforeInventoryLists, 'Instruction-source reads do not reload skills.');
    return inventory;
  };
  const initialInstructionSources = await readInstructionSources(initialInstructionBody);
  const initialSourcesView = instructionSources(initialInstructionSources, initialMcpSnapshot);
  assert.equal(initialSourcesView.current.length, 2);
  assert.equal(initialSourcesView.loads.length, 0, 'A current source catalog is not a set of historical load occurrences.');
  assert.equal(initialSourcesView.capturedAt, initialInstructionSources.capturedAt);
  await readInstructionSources(initialInstructionBody);
  assert.equal((await fetch(mcpPanel.url + 'instruction-sources', { method: 'HEAD' })).status, 200);
  assert.equal(mcpRequests, beforeMetadata, 'Instruction inspection never starts or calls MCP services.');
  assert.equal(requests, 10, 'Instruction inspection makes no model requests.');
  assert.equal(skillReads, 0, 'Instruction inspection does not invoke skills.');
  const readInventory = async () => {
    const response = await fetch(mcpPanel.url + 'capabilities');
    assert.equal(response.status, 200);
    const inventory = await response.json();
    assert.equal(inventory.schemaVersion, 1);
    assert.equal(inventory.scope, 'main-session');
    assert.ok(Number.isFinite(Date.parse(inventory.capturedAt)));
    assert.equal(inventory.tools.status, 'ready');
    assert.equal(inventory.skills.status, 'ready');
    assert.equal(inventory.tools.omitted, 0);
    assert.equal(inventory.tools.invalid, 0);
    assert.deepEqual(inventory.tools.items.map(tool => tool.name).sort(), mcpMetadata.tools.map(tool => tool.name).sort());
    assert.deepEqual(inventory.tools.items.map(tool => tool.mcpServerName).sort(), ['first', 'second']);
    assert.ok(inventory.tools.items.every(tool => tool.mcpToolName === 'echo' && tool.identityValid));
    assert.deepEqual(inventory.skills.items.map(skill => skill.name).sort(), ['fixture-auto', 'fixture-manual']);
    assert.ok(inventory.skills.items.every(skill => skill.enabled === true && skill.userInvocable === true
      && skill.modelInvocable === 'unknown'), 'The runtime catalog omits the manual-only model-invocation restriction.');
    assert.equal(skillLists, beforeInventoryLists, 'Inventory reads do not reload the skill provider.');
    return inventory;
  };
  const initialInventory = await readInventory();
  const initialComparison = compareCapabilities(initialInventory, initialMcpSnapshot);
  assert.equal(initialComparison.rows.length, 4);
  assert.ok(initialComparison.rows.every(row => row.source === '' && !row.observed && row.count === 0));
  assert.ok(initialComparison.rows.filter(row => row.kind === 'tool').every(row => row.current === 'available'));
  assert.ok(initialComparison.rows.filter(row => row.kind === 'skill').every(row => row.current === 'listed' && row.modelInvocable === 'unknown'));
  await readInventory();
  assert.equal((await fetch(mcpPanel.url + 'capabilities', { method: 'HEAD' })).status, 200);
  assert.equal(mcpRequests, beforeMetadata, 'Trace inventory refresh never starts or calls an MCP service.');
  assert.equal(requests, 10, 'Trace inventory refresh never calls a model.');
  assert.equal(skillReads, 0, 'Trace inventory refresh never reads a skill body.');
  const skillInvocation = await session.rpc.commands.invoke({ name: 'fixture-auto', input: 'exact fixture arguments 🧪' });
  assert.equal(skillInvocation.kind, 'agent-prompt');
  assert.ok(skillInvocation.prompt.includes('exact fixture arguments 🧪'));
  assert.equal(requests, 10, 'Explicit skill loading does not itself invoke the fixture model.');
  assert.equal(skillReads, 1);
  currentSkillBody = 'Changed fixture source after invocation; this is not the historical content.';
  provenanceFixture.tools = mcpMetadata.tools;
  provenanceFixture.allowCalls = true;
  await session.sendAndWait({ prompt: skillInvocation.prompt }, 25000);
  if (fixtureError) throw fixtureError;
  const hookEvents = mcpEvents.filter(event => event.type === 'hook.start' || event.type === 'hook.end');
  const skillEvents = mcpEvents.filter(event => event.type === 'skill.invoked');
  const mcpSnapshot = await until(() => fetch(mcpPanel.url + 'events').then(response => response.json()),
    value => value.entries.filter(entry => entry.type === 'tool.execution_complete').length === 2
      && [...hookEvents, ...skillEvents].every(event => value.entries.some(entry => entry.id === event.id)), 'provenance, hook and skill projection');
  stopMcpEvents();
  assert.equal(provenanceFixture.responses, 2);
  assert.equal(mcpMethods.filter(item => item.method === 'tools/call').length, 2);
  assert.equal(mcpEvents.some(event => event.type === 'session.error'), false);
  assert.equal(skillReads, 1, 'The observer keeps recorded content instead of re-reading the changed source.');
  assert.equal(skillEvents.length, 1);
  const loadedSkill = skillEvents[0];
  assert.equal(loadedSkill.data.name, 'fixture-auto');
  assert.equal(loadedSkill.data.trigger, 'user-invoked');
  assert.equal(loadedSkill.data.source, 'sdk');
  assert.equal(loadedSkill.data.path, '');
  assert.equal(loadedSkill.data.content, skillBody);
  assert.equal(loadedSkill.data.arguments, undefined, 'This runtime does not expose invocation arguments in the skill event.');
  const projectedSkill = mcpSnapshot.entries.find(entry => entry.id === loadedSkill.id);
  assert.equal(projectedSkill.agentId, loadedSkill.agentId ?? '');
  assert.equal(projectedSkill.timestamp, loadedSkill.timestamp);
  assert.equal(projectedSkill.trigger, loadedSkill.data.trigger);
  assert.deepEqual(JSON.parse(projectedSkill.evidence).data, loadedSkill.data);
  const instructions = skillInstructions(projectedSkill);
  assert.equal(instructions.name, loadedSkill.data.name);
  assert.equal(instructions.trigger, loadedSkill.data.trigger);
  assert.equal(instructions.status, 'complete');
  assert.equal(instructions.content, skillBody);
  assert.equal(instructions.preview, skillBody);
  assert.equal(instructions.previewTruncated, false);
  assert.equal(instructions.arguments, null, 'Missing arguments stay unknown, not reconstructed from the prompt.');
  const afterToolMcpRequests = mcpRequests;
  const changedInstructionBody = 'Changed owned source after the recorded turn. This is current source text, not historical evidence.\n';
  await writeFile(instructionPath, changedInstructionBody);
  const changedInstructionSources = await readInstructionSources(changedInstructionBody);
  assert.equal(initialInstructionSources.sources.items.find(item => item.id === 'vscode-instructions/external/fixture.instructions.md').content,
    initialInstructionBody, 'An earlier captured snapshot is not rewritten by refreshing the host source.');
  assert.equal(mcpRequests, afterToolMcpRequests);
  assert.equal(requests, 12, 'Source refresh after a file change makes no inference requests.');
  assert.equal(skillReads, 1, 'Historical skill instructions are not reread when current host files change.');
  assert.equal(skillInstructions(projectedSkill).content, skillBody);
  const sourcesView = instructionSources(changedInstructionSources, mcpSnapshot);
  assert.equal(sourcesView.current.length, 2);
  assert.equal(sourcesView.current.find(item => item.id === 'vscode-instructions/external/fixture.instructions.md').content,
    changedInstructionBody);
  assert.equal(sourcesView.loads.length, 1);
  const recordedLoad = sourcesView.loads[0];
  assert.equal(recordedLoad.name, 'fixture-auto');
  assert.equal(recordedLoad.agentId, '');
  assert.equal(recordedLoad.source, 'sdk');
  assert.equal(recordedLoad.occurrences.length, 1);
  assert.equal(recordedLoad.occurrences[0].entry.id, projectedSkill.id);
  assert.equal(recordedLoad.occurrences[0].timestamp, loadedSkill.timestamp);
  assert.equal(recordedLoad.occurrences[0].content, skillBody, 'The current catalog cannot replace the recorded load body.');
  const observedInventory = await readInventory();
  assert.deepEqual(observedInventory.tools, initialInventory.tools);
  assert.deepEqual(observedInventory.skills, initialInventory.skills);
  assert.equal(mcpRequests, afterToolMcpRequests);
  assert.equal(skillReads, 1);
  assert.equal(requests, 12, 'Comparing observed use does not ask a model to interpret it.');
  const comparison = compareCapabilities(observedInventory, mcpSnapshot);
  assert.equal(comparison.rows.length, 4);
  for (const tool of mcpMetadata.tools) {
    const row = comparison.rows.find(row => row.kind === 'tool' && row.name === tool.name);
    assert.equal(row.source, '');
    assert.equal(row.mcpServerName, tool.mcpServerName);
    assert.equal(row.mcpToolName, 'echo');
    assert.equal(row.current, 'available');
    assert.equal(row.observed, true);
    assert.equal(row.count, 1, 'A start and result represent one observed tool invocation.');
    assert.ok(mcpSnapshot.entries.some(entry => entry.id === row.eventId && entry.type === 'tool.execution_start'));
  }
  const usedSkill = comparison.rows.find(row => row.kind === 'skill' && row.name === 'fixture-auto');
  const unobservedSkill = comparison.rows.find(row => row.kind === 'skill' && row.name === 'fixture-manual');
  assert.equal(usedSkill.catalogSource, 'sdk');
  assert.equal(usedSkill.eventId, projectedSkill.id);
  assert.equal(usedSkill.observed, true);
  assert.equal(usedSkill.count, 1);
  assert.equal(unobservedSkill.observed, false);
  assert.equal(unobservedSkill.count, 0);
  assert.equal(usedSkill.modelInvocable, 'unknown');
  assert.equal(unobservedSkill.modelInvocable, 'unknown');
  assert.equal(hookCalls.filter(call => call.type === 'preToolUse').length, 2);
  assert.equal(hookCalls.filter(call => call.type === 'postToolUse').length, 2);
  assert.equal(hookCalls.filter(call => call.type === 'userPromptSubmitted').length, 1);
  const hookStarts = hookEvents.filter(event => event.type === 'hook.start');
  assert.equal(hookStarts.length, 9, 'Recorded pipeline invocations include lifecycle points without configured callbacks.');
  assert.equal(hookEvents.length, 18);
  assert.equal(summarize(mcpSnapshot.entries).hooks, hookStarts.length, 'Statistics counts pipeline invocations, not boundary events or callbacks.');
  const pipelines = hookInvocations(mcpSnapshot.entries);
  assert.equal(pipelines.length, hookStarts.length);
  for (const start of hookStarts) {
    assert.ok(typeof start.data.hookInvocationId === 'string' && start.data.hookInvocationId.length);
    const ends = hookEvents.filter(event => event.type === 'hook.end' && event.data.hookInvocationId === start.data.hookInvocationId);
    assert.equal(ends.length, 1);
    assert.equal(ends[0].data.hookType, start.data.hookType);
    assert.equal(ends[0].data.success, true);
    const pipeline = pipelines.find(call => call.hookInvocationId === start.data.hookInvocationId
      && call.agentId === (start.agentId ?? ''));
    assert.ok(pipeline);
    assert.deepEqual(pipeline.entries.map(entry => entry.id), [start.id, ends[0].id]);
    assert.equal(pipeline.hookType, start.data.hookType);
    assert.equal(pipeline.status, 'paired');
    assert.equal(pipeline.outcome, 'success');
    if (start.data.hookType === 'preToolUse') {
      assert.equal(pipeline.output, null, 'Unexposed callback context remains unknown.');
      assert.deepEqual(pipeline.reported, []);
    }
    if (start.data.hookType === 'postToolUse') {
      assert.deepEqual(pipeline.reported, [{ field: 'additionalContext',
        label: 'Supplied context (additionalContext)', value: 'Fixed local hook context.' }]);
    }
  }
  const preToolRecords = hookEvents.filter(event => event.data.hookType === 'preToolUse');
  assert.equal(preToolRecords.length, 2, 'One recorded pre-tool pipeline covers two callback requests.');
  assert.equal(preToolRecords[0].data.input.toolCalls.length, 2);
  assert.equal(preToolRecords[1].data.output, undefined, 'Callback context is not necessarily exposed in the pipeline record.');
  assert.equal(hookEvents.filter(event => event.type === 'hook.end' && event.data.hookType === 'postToolUse'
    && event.data.output?.additionalContext === 'Fixed local hook context.').length, 2);
  for (const raw of hookEvents) {
    const projected = mcpSnapshot.entries.find(entry => entry.id === raw.id);
    assert.equal(projected.hookInvocationId, raw.data.hookInvocationId);
    assert.equal(projected.agentId, raw.agentId ?? '');
    assert.equal(projected.timestamp, raw.timestamp);
    assert.deepEqual(JSON.parse(projected.evidence).data, raw.data);
  }
  const origins = toolProvenance(mcpSnapshot.entries);
  for (const tool of mcpMetadata.tools) {
    const start = mcpEvents.find(event => event.type === 'tool.execution_start' && event.data.toolCallId === `fixture-mcp-${tool.mcpServerName}`);
    const complete = mcpEvents.find(event => event.type === 'tool.execution_complete' && event.data.toolCallId === start.data.toolCallId);
    assert.equal(start.data.toolName, tool.name);
    assert.equal(start.data.mcpServerName, tool.mcpServerName);
    assert.equal(start.data.mcpConfigServerName, tool.mcpServerName);
    assert.equal(start.data.mcpToolName, 'echo');
    assert.equal(start.data.toolTitle, 'Same fixture tool');
    assert.equal(start.data.mcpConfigSource, 'user');
    assert.equal(start.data.mcpTransport, 'http');
    assert.equal(complete.data.success, true);
    for (const raw of [start, complete]) {
      const projected = mcpSnapshot.entries.find(entry => entry.id === raw.id);
      assert.ok(projected, 'Attached Trace retains each actual MCP boundary.');
      assert.equal(projected.agentId, raw.agentId ?? '');
      assert.equal(projected.toolCallId, raw.data.toolCallId);
      assert.equal(projected.timestamp, raw.timestamp);
      assert.deepEqual(JSON.parse(projected.evidence).data, raw.data);
      const origin = origins.get(raw.id);
      assert.equal(origin.origin, 'MCP');
      assert.equal(origin.serverKey, tool.mcpServerName);
      assert.equal(origin.toolName, 'echo');
      assert.equal(origin.modelToolName, tool.name);
      assert.equal(origin.configSource, 'user');
      assert.equal(origin.transport, 'http');
      assert.equal(origin.basisId, start.id, 'Both boundaries cite their exact retained invocation, not another same-title tool.');
    }
  }
  await session.rpc.canvas.close({ instanceId: input.instanceId });
  await until(() => fetch(mcpPanel.url).then(() => false, () => true), Boolean, 'provenance fixture server shutdown');
  await session.disconnect();
  assert.equal(requests, 12, 'Only the first twelve expected local synthetic responses are permitted.');
  provenanceFixture = undefined;

  // Owned retrieval fixtures establish the recorded contract without accessing a user project.
  const retrievalDirectory = join(project, 'retrieval');
  await mkdir(retrievalDirectory);
  const fixturePath = join(retrievalDirectory, 'fixture.txt');
  const absentPath = join(retrievalDirectory, 'absent.txt');
  const fixtureLines = Array.from({ length: 30 }, (_, i) => `Line ${i + 1}: fixture café 🧪`);
  await writeFile(fixturePath, fixtureLines.join('\n') + '\n');
  const calls = [
    { id: 'fixture-range-read', name: 'view', arguments: { path: fixturePath, view_range: [3, 5] } },
    { id: 'fixture-limited-search', name: 'grep', arguments: { pattern: 'fixture', paths: retrievalDirectory,
      output_mode: 'content', head_limit: 2, '-n': true } },
    { id: 'fixture-missing-read', name: 'view', arguments: { path: absentPath } },
  ];
  retrievalFixture = { calls, responses: 0, allowCalls: false };
  const retrievalPermissions = [];
  session = await client.createSession({ workingDirectory: retrievalDirectory, configDirectory: home,
    availableTools: ['view', 'grep'], requestExtensions: true, requestCanvasRenderer: true,
    extensionSdkPath: sdkDirectory, pluginDirectories: [root], enableConfigDiscovery: false,
    onPermissionRequest: request => {
      retrievalPermissions.push(request);
      assert.equal(request.kind, 'read');
      assert.ok([retrievalDirectory, fixturePath, absentPath].includes(request.path));
      assert.ok(calls.some(call => call.id === request.toolCallId));
      return { kind: 'approve-once' };
    },
    model: 'fixture', provider: { type: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`,
      apiKey: 'fixture', wireApi: 'completions' } });
  const retrievalEvents = [];
  session.on(event => retrievalEvents.push(event));
  await until(() => session.rpc.canvas.list(), value => value.canvases?.some(canvas => canvas.canvasId === 'trace'), 'retrieval canvas discovery');
  const retrievalPanel = await session.rpc.canvas.open({ canvasId: 'trace', instanceId: 'trace-retrieval-fixture', input: {} });
  await until(() => fetch(retrievalPanel.url + 'events').then(response => response.json()), value => value.history === 'ready', 'retrieval history');
  assert.equal(requests, 12, 'Opening the retrieval ledger does not make model requests.');
  retrievalFixture.allowCalls = true;
  await session.sendAndWait({ prompt: 'Only the fixed local retrieval fixture.' }, 25000);
  if (fixtureError) throw fixtureError;
  const retrievalBoundaries = retrievalEvents.filter(event => event.type.startsWith('tool.execution'));
  assert.equal(retrievalFixture.responses, 2);
  assert.equal(retrievalBoundaries.length, 6);
  assert.ok(retrievalPermissions.length >= 2);
  const retrievalSnapshot = await until(() => fetch(retrievalPanel.url + 'events').then(response => response.json()),
    value => retrievalBoundaries.every(event => value.entries.some(entry => entry.id === event.id)), 'retrieval projection');
  for (const raw of retrievalBoundaries) {
    const projected = retrievalSnapshot.entries.find(entry => entry.id === raw.id);
    assert.equal(projected.toolCallId, raw.data.toolCallId);
    assert.equal(projected.agentId, raw.agentId ?? '');
    assert.equal(projected.timestamp, raw.timestamp);
    assert.deepEqual(JSON.parse(projected.evidence).data, raw.data);
  }
  const retrievalResult = id => retrievalBoundaries.find(event => event.type === 'tool.execution_complete' && event.data.toolCallId === id);
  const readResult = retrievalResult('fixture-range-read');
  const searchResult = retrievalResult('fixture-limited-search');
  const missingResult = retrievalResult('fixture-missing-read');
  assert.equal(readResult.data.success, true);
  assert.equal(readResult.data.result.content, fixtureLines.slice(2, 5).join('\n'));
  assert.equal(searchResult.data.success, true);
  assert.equal(searchResult.data.result.content.split('\n').length, 2);
  assert.ok(searchResult.data.result.content.includes('café 🧪'));
  assert.equal(missingResult.data.success, false);
  assert.equal(typeof missingResult.data.result.content, 'string', 'Failure diagnostics may contain text without retrieving the requested file.');
  const ledger = retrievalLedger(retrievalSnapshot.entries, retrievalSnapshot);
  assert.equal(ledger.rows.length, 3, 'The ledger counts three invocations, not their six boundaries.');
  assert.equal(ledger.references, 3, 'Exact recorded references include the requested missing path and search root, not inferred file contents.');
  for (const call of calls) {
    const start = retrievalBoundaries.find(event => event.type === 'tool.execution_start' && event.data.toolCallId === call.id);
    const complete = retrievalResult(call.id);
    const row = ledger.rows.find(item => item.id === start.id);
    assert.ok(row);
    assert.equal(row.toolName, call.name);
    assert.deepEqual(row.targets, [call.arguments.path ?? call.arguments.paths]);
    assert.ok(row.links.some(link => link.id === start.id));
    assert.ok(row.links.some(link => link.id === complete.id));
    assert.equal(row.status, complete.data.success ? 'returned' : 'failed');
    assert.equal(row.content, complete.data.success ? complete.data.result.content : null);
  }
  const rangeRow = ledger.rows.find(row => row.targets.includes(fixturePath));
  const searchRow = ledger.rows.find(row => row.toolName === 'grep');
  assert.match(rangeRow.request, /3.*5/);
  assert.equal(rangeRow.partial, true, 'A requested line range has limited scope without proving a complete file.');
  assert.match(searchRow.request, /content/);
  assert.match(searchRow.request, /2/);
  assert.equal(searchRow.partial, true, 'A limited search is an excerpt, not a complete file read.');
  const retrievalExtents = toolExtents(retrievalSnapshot.entries, retrievalSnapshot);
  assert.ok(retrievalExtents.get(rangeRow.id).requested.includes('Lines 3–5 requested (1-based, inclusive)'));
  assert.ok(retrievalExtents.get(searchRow.id).requested.includes('First 2 results requested'));
  assert.equal(retrievalExtents.get(rangeRow.id).coverage, 'Unknown coverage');
  assert.equal(retrievalExtents.get(searchRow.id).hostShortened, false,
    'The requested result limit alone does not establish host truncation.');
  assert.equal(requests, 14, 'Retrieval inspection has no extra model requests.');
  const permissionsBeforeCompaction = retrievalPermissions.length;
  retrievalFixture.allowCompaction = true;
  const compactionResult = await session.rpc.history.compact({ trigger: 'manual', customInstructions: 'Fixed fixture summary only.' });
  retrievalFixture.allowCompaction = false;
  if (fixtureError) throw fixtureError;
  assert.equal(compactionResult.success, true);
  assert.equal(retrievalFixture.responses, 3);
  assert.equal(retrievalPermissions.length, permissionsBeforeCompaction, 'Fixture compaction must not request tool operations.');
  const compactionEvents = retrievalEvents.filter(event => ['session.compaction_start', 'session.compaction_complete'].includes(event.type));
  assert.equal(compactionEvents.length, 2);
  const [compactionStart, compactionEnd] = compactionEvents;
  assert.equal(compactionStart.type, 'session.compaction_start');
  assert.equal(compactionEnd.type, 'session.compaction_complete');
  assert.ok(typeof compactionStart.data.compactionAttemptId === 'string' && compactionStart.data.compactionAttemptId.length > 0);
  assert.equal(compactionEnd.data.compactionAttemptId, compactionStart.data.compactionAttemptId);
  assert.equal(compactionEnd.data.success, true);
  assert.equal(compactionEnd.data.outcome, 'applied');
  assert.equal(compactionEnd.data.summaryContent, compactionSummary);
  assert.equal(compactionEnd.data.tokenAccountingBasis, 'local_full_context_estimate');
  for (const field of ['preCompactionTokens', 'postCompactionTokens', 'tokensRemoved']) {
    assert.ok(Number.isSafeInteger(compactionEnd.data[field]) && compactionEnd.data[field] >= 0);
  }
  assert.equal(compactionEnd.data.tokensRemoved, compactionEnd.data.preCompactionTokens - compactionEnd.data.postCompactionTokens);
  const compactionSnapshot = await until(() => fetch(retrievalPanel.url + 'events').then(response => response.json()),
    value => compactionEvents.every(event => value.entries.some(entry => entry.id === event.id)), 'compaction summary projection');
  for (const raw of compactionEvents) {
    const projected = compactionSnapshot.entries.find(entry => entry.id === raw.id);
    assert.equal(projected.agentId, raw.agentId ?? '');
    assert.equal(projected.timestamp, raw.timestamp);
    assert.equal(projected.truncated, false);
    assert.deepEqual(JSON.parse(projected.evidence).data, raw.data);
  }
  const compactions = compactionAttempts(compactionSnapshot.entries);
  assert.equal(compactions.length, 1);
  const observedCompaction = compactions[0];
  assert.equal(observedCompaction.agentId, '');
  assert.equal(observedCompaction.compactionAttemptId, compactionStart.data.compactionAttemptId);
  assert.equal(observedCompaction.status, 'paired');
  assert.equal(observedCompaction.outcome, 'success');
  assert.equal(observedCompaction.reportedOutcome, 'applied');
  assert.deepEqual(observedCompaction.entries.map(entry => entry.id), compactionEvents.map(event => event.id));
  assert.equal(observedCompaction.summary.status, 'complete');
  assert.equal(observedCompaction.summary.content, compactionSummary);
  assert.equal(observedCompaction.metrics.status, 'comparable');
  assert.equal(observedCompaction.metrics.basis, 'local_full_context_estimate');
  assert.equal(observedCompaction.metrics.before, compactionEnd.data.preCompactionTokens);
  assert.equal(observedCompaction.metrics.after, compactionEnd.data.postCompactionTokens);
  assert.equal(observedCompaction.metrics.change, compactionEnd.data.preCompactionTokens - compactionEnd.data.postCompactionTokens);
  assert.equal(observedCompaction.metrics.tokensRemoved, compactionEnd.data.tokensRemoved);
  assert.equal(observedCompaction.metrics.messagesRemoved, compactionEnd.data.messagesRemoved);
  await session.rpc.canvas.close({ instanceId: 'trace-retrieval-fixture' });
  await until(() => fetch(retrievalPanel.url).then(() => false, () => true), Boolean, 'retrieval fixture server shutdown');
  await session.disconnect();
  assert.equal(requests, 15, 'Only the fifteen expected local synthetic responses are permitted.');

  // A seventh owned session verifies nested handoffs through actual joined Trace evidence.
  retrievalFixture = undefined;
  nestedFixture = { responses: 0, allowCalls: false };
  session = await client.createSession({ workingDirectory: project, configDirectory: home,
    availableTools: ['builtin:task'], requestExtensions: true, requestCanvasRenderer: true,
    extensionSdkPath: sdkDirectory, pluginDirectories: [root], enableConfigDiscovery: false, skipCustomInstructions: true,
    customAgents: [
      { name: 'trace-middle-agent', displayName: 'Same nested fixture agent', description: 'Owned middle fixture.',
        prompt: 'Return the fixed local response.', tools: ['task'], model: 'fixture', modelPolicy: 'required', skills: [], mcpServers: {} },
      { name: 'trace-leaf-agent', displayName: 'Same nested fixture agent', description: 'Owned leaf fixture.',
        prompt: 'Return the fixed local response.', tools: [], model: 'fixture', modelPolicy: 'required', skills: [], mcpServers: {} },
    ],
    onPermissionRequest: () => { throw new Error('No permissions are authorized for the nested fixture.'); },
    model: 'fixture', provider: { type: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'fixture', wireApi: 'completions' } });
  await session.rpc.tools.initializeAndValidate();
  assert.deepEqual((await session.rpc.tools.getCurrentMetadata()).tools.map(tool => tool.name), ['task']);
  const nestedEvents = [];
  session.on(event => nestedEvents.push(event));
  await until(() => session.rpc.canvas.list(), value => value.canvases?.some(canvas => canvas.canvasId === 'trace'), 'nested canvas registration');
  const nestedPanel = await session.rpc.canvas.open({ canvasId: 'trace', instanceId: 'trace-nested-fixture', input: {} });
  assert.equal(requests, 15, 'Opening the nested fixture does not ask a model to act.');
  nestedFixture.allowCalls = true;
  await session.sendAndWait({ prompt: 'Only the fixed nested delegation fixture.' }, 25000);
  if (fixtureError) throw fixtureError;
  assert.equal(nestedFixture.responses, 5);
  assert.equal(nestedEvents.some(event => event.type === 'session.error'), false);
  const nestedBoundaries = nestedEvents.filter(event => ['subagent.started', 'subagent.completed', 'assistant.turn_start',
    'assistant.turn_end', 'assistant.message', 'tool.execution_start', 'tool.execution_complete'].includes(event.type));
  const nestedSnapshot = await until(() => fetch(nestedPanel.url + 'events').then(response => response.json()),
    value => value.history === 'ready' && nestedBoundaries.every(raw => value.entries.some(entry => entry.id === raw.id)), 'nested handoff projection');
  for (const raw of nestedBoundaries) {
    const projected = nestedSnapshot.entries.find(entry => entry.id === raw.id);
    assert.equal(projected.agentId, raw.agentId ?? '');
    assert.equal(projected.timestamp, raw.timestamp);
    assert.equal(projected.truncated, false);
    assert.deepEqual(JSON.parse(projected.evidence).data, raw.data);
  }
  const nestedStarts = nestedEvents.filter(event => event.type === 'subagent.started');
  assert.equal(nestedStarts.length, 2);
  assert.equal(new Set(nestedStarts.map(event => event.agentId)).size, 2);
  assert.deepEqual([...new Set(nestedStarts.map(event => event.data.agentDisplayName))], ['Same nested fixture agent']);
  const middle = nestedStarts.find(event => event.data.toolCallId === 'fixture-nested-outer');
  const leaf = nestedStarts.find(event => event.data.toolCallId === 'fixture-nested-inner');
  const nestedHandoffs = delegationHandoffs(nestedSnapshot.entries, nestedSnapshot);
  assert.equal(nestedHandoffs.length, 2);
  assert.equal(middle.data.parentId, undefined);
  assert.equal(leaf.data.parentId, middle.agentId, 'The nested task-registry parent matches the recorded parent source in this installed build.');
  for (const [start, parentAgentId, name, content] of [[middle, undefined, 'outer', nestedMiddleResult], [leaf, middle.agentId, 'inner', nestedLeafResult]]) {
    const call = nestedEvents.find(event => event.type === 'tool.execution_start' && event.agentId === parentAgentId && event.data.toolCallId === start.data.toolCallId);
    const result = nestedEvents.find(event => event.type === 'tool.execution_complete' && event.agentId === parentAgentId && event.data.toolCallId === start.data.toolCallId);
    const end = nestedEvents.find(event => event.type === 'subagent.completed' && event.agentId === start.agentId);
    assert.equal(call.data.arguments.prompt, `${nestedPrompt} ${name}`);
    assert.equal(result.data.success, true);
    assert.equal(result.data.result.content, content);
    assert.equal(end.data.toolCallId, call.data.toolCallId);
    assert.ok(nestedEvents.some(event => event.type === 'assistant.turn_start' && event.agentId === start.agentId && event.data.parentToolCallId === call.data.toolCallId));
    const handoff = nestedHandoffs.find(value => value.agentId === start.agentId);
    assert.equal(handoff.status, 'linked');
    assert.equal(handoff.lifecycle, 'completed');
    assert.equal(handoff.parentAgentId, parentAgentId ?? '');
    assert.equal(handoff.toolCallId, call.data.toolCallId);
    assert.equal(handoff.parentStart.id, call.id);
    assert.equal(handoff.parentResult.id, result.id);
    assert.equal(handoff.handoff.status, 'complete');
    assert.equal(handoff.handoff.prompt, `${nestedPrompt} ${name}`);
    assert.equal(handoff.handoff.description, `Owned ${name} delegation`);
    assert.equal(handoff.result.status, 'complete');
    assert.equal(handoff.result.content, content);
    assert.equal(handoff.result.success, true);
    assert.ok(handoff.entries.every(entry => entry.agentId === start.agentId));
    for (const id of [call.id, start.id, end.id, result.id]) assert.ok(handoff.links.some(link => link.entry.id === id));
  }
  await session.rpc.canvas.close({ instanceId: 'trace-nested-fixture' });
  await until(() => fetch(nestedPanel.url).then(() => false, () => true), Boolean, 'nested fixture server shutdown');
  await session.disconnect();
  assert.equal(requests, 20, 'Only the twenty expected local synthetic responses are permitted.');

  // An eighth owned session separates recorded permission scope, a claim, tool outcome and process exit.
  nestedFixture = undefined;
  validationFixture = { responses: 0, allowCalls: false, permissions: 0,
    command: 'node --test validation.test.mjs', callId: 'fixture-validation-call' };
  await writeFile(join(project, 'validation.test.mjs'), "import {test} from 'node:test'; import assert from 'node:assert/strict'; test('owned deliberately failing fixture',()=>assert.equal(1,2));\n");
  session = await client.createSession({ workingDirectory: project, configDirectory: home,
    availableTools: ['builtin:powershell'], requestExtensions: true, requestCanvasRenderer: true,
    extensionSdkPath: sdkDirectory, pluginDirectories: [root], enableConfigDiscovery: false, skipCustomInstructions: true,
    onPermissionRequest: request => {
      assert.equal(request.kind, 'shell');
      assert.equal(request.toolCallId, validationFixture.callId);
      assert.equal(request.fullCommandText, validationFixture.command);
      assert.equal(++validationFixture.permissions, 1);
      return { kind: 'approve-for-session', approval: { kind: 'commands', commandIdentifiers: ['node'] } };
    },
    model: 'fixture', provider: { type: 'openai', baseUrl: `http://127.0.0.1:${fixture.address().port}/v1`, apiKey: 'fixture', wireApi: 'completions' } });
  const validationEvents = [];
  session.on(event => validationEvents.push(event));
  await session.rpc.tools.initializeAndValidate();
  assert.deepEqual((await session.rpc.tools.getCurrentMetadata()).tools.map(tool => tool.name), ['powershell']);
  await until(() => session.rpc.canvas.list(), value => value.canvases?.some(canvas => canvas.canvasId === 'trace'), 'validation canvas registration');
  const validationPanel = await session.rpc.canvas.open({ canvasId: 'trace', instanceId: 'trace-validation-fixture', input: {} });
  assert.equal(requests, 20, 'Opening claim inspection does not run a check or ask a model to act.');
  validationFixture.allowCalls = true;
  await session.sendAndWait({ prompt: 'Only the fixed local validation fixture.' }, 25000);
  if (fixtureError) throw fixtureError;
  assert.equal(validationFixture.responses, 2);
  assert.equal(validationFixture.permissions, 1);
  const validationCall = validationEvents.find(event => event.type === 'tool.execution_start' && event.data.toolCallId === validationFixture.callId);
  const validationPermission = validationEvents.find(event => event.type === 'permission.completed' && event.data.toolCallId === validationFixture.callId);
  const validationResult = validationEvents.find(event => event.type === 'tool.execution_complete' && event.data.toolCallId === validationFixture.callId);
  const validationClaim = validationEvents.find(event => event.type === 'assistant.message' && event.data.content === 'Tests passed.');
  assert.ok(validationCall && validationPermission && validationResult && validationClaim);
  assert.deepEqual(validationPermission.data.result, { kind: 'approved-for-session', approval: { kind: 'commands', commandIdentifiers: ['node'] } });
  assert.equal(validationPermission.data.decisionSource, undefined, 'A programmatic session grant does not imply a human response.');
  assert.equal(validationCall.data.arguments.command, validationFixture.command);
  assert.equal(validationResult.data.success, true, 'Tool protocol success does not establish process or test success.');
  const validationExit = validationResult.data.result.contents.find(item => item.type === 'shell_exit');
  assert.equal(validationExit.exitCode, 1, 'The owned test deliberately fails despite the fixed assistant claim.');
  const validationBoundaries = [validationCall, validationPermission, validationResult, validationClaim];
  const validationSnapshot = await until(() => fetch(validationPanel.url + 'events').then(response => response.json()),
    value => validationBoundaries.every(event => value.entries.some(entry => entry.id === event.id)), 'validation claim projection');
  for (const raw of validationBoundaries) {
    const projected = validationSnapshot.entries.find(entry => entry.id === raw.id);
    assert.equal(projected.agentId, raw.agentId ?? '');
    assert.equal(projected.timestamp, raw.timestamp);
    assert.equal(projected.truncated, false);
    assert.deepEqual(JSON.parse(projected.evidence).data, raw.data);
  }
  const validationStages = actionStages(validationSnapshot.entries, validationSnapshot).get(validationCall.id);
  const grantStage = validationStages.stages.find(stage => stage.id === validationPermission.id);
  assert.ok(grantStage, 'The session grant links only through the exact original call and source identity.');
  assert.equal(grantStage.outcome, 'approved');
  assert.equal(grantStage.decisionSource, null);
  assert.equal(grantStage.scope.kind, 'session');
  assert.equal(grantStage.scope.approvalKind, 'commands');
  assert.deepEqual(grantStage.scope, permissionScope(validationSnapshot.entries.find(entry => entry.id === validationPermission.id)));
  assert.match(grantStage.detail, /current authority/i);
  assert.match(grantStage.detail, /reuse/);
  assert.equal(validationStages.stages.find(stage => stage.id === validationResult.id).label, 'Tool result: reported success');
  const observedChecks = validationChecks(validationSnapshot.entries);
  const observedClaims = validationClaims(validationSnapshot.entries, validationSnapshot);
  assert.equal(observedChecks.length, 1);
  assert.equal(observedClaims.length, 1);
  const [observedCheck] = observedChecks, [observedClaim] = observedClaims;
  assert.equal(observedCheck.command, validationFixture.command);
  assert.equal(observedCheck.kind, 'tests');
  assert.equal(observedCheck.source, '');
  assert.equal(observedCheck.start.id, validationCall.id);
  assert.equal(observedCheck.result.id, validationResult.id);
  assert.equal(observedCheck.output, validationResult.data.result.content);
  assert.equal(observedCheck.exitCode, 1);
  assert.equal(observedCheck.toolSuccess, true);
  assert.equal(observedClaim.id, validationClaim.id);
  assert.equal(observedClaim.statement, 'Tests passed.');
  assert.equal(observedClaim.reported, 'passed');
  assert.deepEqual(observedClaim.candidates.map(check => check.id), [validationResult.id]);
  assert.equal(observedClaim.linked, undefined, 'Chronology and matching category do not automatically create a supporting link.');
  assert.equal(observedClaim.verified, undefined, 'The fixed assistant claim does not establish verification.');
  const explicitFixtureLink = linkValidationClaim(validationSnapshot.entries, observedClaim, observedCheck);
  assert.equal(retainedValidationLink(validationSnapshot.entries, explicitFixtureLink), true);
  assert.equal(retainedValidationLink(validationSnapshot.entries.filter(entry => entry.id !== validationResult.id), explicitFixtureLink), false);
  const overview = validationOverview(validationSnapshot.entries, validationSnapshot);
  assert.equal(overview.checks.length, 1, 'The overview counts one invocation, not two tool boundaries.');
  assert.equal(overview.unclassifiedCalls, 0);
  assert.equal(overview.unlinkedBoundaries, 0);
  const [overviewCheck] = overview.checks;
  assert.equal(overviewCheck.id, validationCall.id);
  assert.equal(overviewCheck.source, '');
  assert.equal(overviewCheck.command, validationFixture.command);
  assert.equal(overviewCheck.timestamp, validationCall.timestamp);
  assert.equal(overviewCheck.resultTimestamp, validationResult.timestamp);
  assert.equal(overviewCheck.start.id, validationCall.id);
  assert.equal(overviewCheck.result.id, validationResult.id);
  assert.equal(overviewCheck.toolSuccess, true);
  assert.equal(overviewCheck.exitCode, 1);
  assert.equal(overviewCheck.output, validationResult.data.result.content);
  assert.equal(overviewCheck.assertionCounts, null, 'Shell output does not supply authoritative passed/failed/skipped assertion counts.');
  assert.equal(overviewCheck.latestResult, true);
  await session.rpc.canvas.close({ instanceId: 'trace-validation-fixture' });
  await until(() => fetch(validationPanel.url).then(() => false, () => true), Boolean, 'validation fixture server shutdown');
  await session.disconnect();
  assert.equal(requests, 22, 'Only the twenty-two expected local synthetic responses are permitted.');
  assert.equal(expired, false);
  console.log('PASS: installed SDK discovery, ownership, history/live events, canvas lifecycle, assets and zero automatic inference; input delivery, overlapping/nested agent handoffs and returns, approved/denied action boundaries, distinct MCP provenance, hook pipelines, historical skill instructions, read-only capability comparison, retrieval ledger, host-shortened preview, current instruction sources versus recorded loads, compaction summaries, validation claims and overview versus process exit verified with twenty-two fixed local responses across eight disposable sessions, no paid inference. Native rendering and /trace discovery remain manual checks.');
} finally {
  clearTimeout(timer);
  releaseFirst();
  releaseAgents();
  await session?.disconnect().catch(() => {});
  try { await client.forceStop(); }
  finally { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
