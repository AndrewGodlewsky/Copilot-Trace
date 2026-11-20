import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { agentLanes } from '../com.github.copilot/extensions/trace/web/presentation.mjs';

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
let fixtureError;
let releaseFirst;
const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
let releaseAgents;
const agentResponses = new Promise(resolve => { releaseAgents = resolve; });
const fixture = createServer(async (req, res) => {
  const number = ++requests;
  if (!allowSyntheticResponses || number > (allowAgentResponses ? 7 : 3)) {
    req.resume(); res.writeHead(500); res.end('Unexpected fixture inference request.'); return;
  }
  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (number === 1) await firstResponse;
    let message = { role: 'assistant', content: 'Synthetic local fixture response.' }, reason = 'stop';
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
    onPermissionRequest: () => ({ kind: 'denied-by-rules', rules: [] }),
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
  for (const asset of ['footer.mjs', 'diagnostics.mjs', 'polling.mjs', 'follow.mjs']) assert.equal((await fetch(first.url + asset)).status, 200);
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
    onPermissionRequest: () => ({ kind: 'denied-by-rules', rules: [] }),
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
    value => value.history === 'ready' && value.entries.filter(entry => entry.type === 'subagent.completed').length === 2, 'agent lifecycle projection');
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
  }
  await session.rpc.canvas.close({ instanceId: input.instanceId });
  await until(() => fetch(agentPanel.url).then(() => false, () => true), Boolean, 'agent fixture server shutdown');
  assert.equal(expired, false);
  console.log('PASS: installed SDK discovery, plugin ownership, history/live events, open/reopen/close, assets and zero automatic inference; actual input delivery/interaction and overlapping agent/delegation projection verified with seven fixed local responses across two disposable sessions, no paid inference. Native rendering and /trace discovery remain manual checks.');
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
