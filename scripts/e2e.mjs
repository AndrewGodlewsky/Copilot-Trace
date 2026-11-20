import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
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
const fixture = createServer((req, res) => { requests++; req.resume(); res.writeHead(500); res.end('Inference is forbidden in this fixture.'); });
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
  const input = { canvasId: 'trace', instanceId: 'trace-fixture', input: {} };
  const first = await session.rpc.canvas.open(input);
  const page = await fetch(first.url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Copilot Trace/);
  assert.equal((await session.rpc.canvas.open(input)).url, first.url);
  await session.rpc.canvas.close({ instanceId: input.instanceId });
  await until(() => fetch(first.url).then(() => false, () => true), Boolean, 'server shutdown');
  const reopened = await session.rpc.canvas.open(input);
  assert.notEqual(reopened.url, first.url);
  assert.equal((await fetch(reopened.url + 'style.css')).status, 200);
  await session.rpc.canvas.close({ instanceId: input.instanceId });
  await until(() => fetch(reopened.url).then(() => false, () => true), Boolean, 'reopened server shutdown');
  assert.equal(requests, 0);
  assert.equal(expired, false);
  console.log('PASS: installed SDK discovery, plugin ownership, open/reopen/close, assets and zero inference. Native rendering and /trace discovery remain manual checks.');
} finally {
  clearTimeout(timer);
  await session?.disconnect().catch(() => {});
  try { await client.forceStop(); }
  finally { fixture.closeAllConnections(); await new Promise(resolve => fixture.close(resolve)); }
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
}
