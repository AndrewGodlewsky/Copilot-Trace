import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

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
let releaseFirst;
const firstResponse = new Promise(resolve => { releaseFirst = resolve; });
const fixture = createServer(async (req, res) => {
  requests++;
  if (!allowSyntheticResponses || requests > 3) {
    req.resume(); res.writeHead(500); res.end('Unexpected fixture inference request.'); return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString());
  if (requests === 1) await firstResponse;
  const content = 'Synthetic local fixture response.';
  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [delta, finish_reason] of [[{ role: 'assistant', content }, null], [{}, 'stop']]) {
      res.write('data: ' + JSON.stringify({ id: `fixture-${requests}`, object: 'chat.completion.chunk',
        created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
    }
    res.end('data: [DONE]\n\n');
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id: `fixture-${requests}`, object: 'chat.completion', model: 'fixture',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
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
  assert.equal(expired, false);
  console.log('PASS: installed SDK discovery, plugin ownership, real history/live events, open/reopen/close, assets and zero automatic inference; actual input delivery/interaction projection verified with three explicit synthetic local responses and no paid inference. Native rendering and /trace discovery remain manual checks.');
} finally {
  clearTimeout(timer);
  releaseFirst();
  await session?.disconnect().catch(() => {});
  try { await client.forceStop(); }
  finally { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
