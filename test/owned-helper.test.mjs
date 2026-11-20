import assert from 'node:assert/strict';
import { test } from 'node:test';
import { access, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createOwnedHelper, createHelperUsage, hostRuntime, runtimeEnvironment } from '../com.github.copilot/extensions/trace/owned-helper.mjs';
import { selectModel, modelCatalog } from '../com.github.copilot/extensions/trace/investigation-model.mjs';

const auth = { isAuthenticated: true, login: 'fixture', host: 'github.com' };
const catalog = { list: [{ id: 'claude-haiku-5.5', name: 'Haiku', provider: { id: 'copilot', kind: 'copilot' }, capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ['high', 'max'] }] };
const selection = selectModel(modelCatalog(catalog, auth), {});
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(options = {}) {
  let calls = 0, stopped = 0, configuration, clientOptions, current;
  const receipts = [], parent = { sessionId: 'parent', rpc: { model: { list: async () => catalog, getCurrent: async () => ({ modelId: 'parent-model' }), switchTo() { throw Error('Parent must not mutate'); } }, gitHubAuth: { getStatus: async () => auth } } };
  const sdk = { RuntimeConnection: { forStdio: value => value }, CopilotClient: class {
    constructor(value) { clientOptions = value; }
    async start() { await options.start?.(); }
    async createSession(config) {
      configuration = config; await options.create?.();
      current = { modelId: config.model, providerId: 'copilot', reasoningEffort: config.reasoningEffort, ...options.current };
      return { sessionId: config.sessionId, rpc: {
        gitHubAuth: { getStatus: async () => options.auth ?? auth },
        model: { list: async () => options.catalog ?? catalog, getCurrent: async () => current, switchTo: async () => {} },
        metadata: { snapshot: async () => ({ isRemote: false, workingDirectory: config.workingDirectory }) },
        tools: { initializeAndValidate: async () => {}, getCurrentMetadata: async () => ({ tools: options.tools ?? [] }) },
      }, async sendAndWait() {
        calls++; await options.send?.();
        for (const event of options.usage ?? [{ id: 'usage', type: 'assistant.usage', data: { model: config.model, inputTokens: 10, outputTokens: 2, accounting: { sourceSessionId: 'helper', sequence: 1, usageId: 'usage' } } }]) config.onEvent(event);
        return { data: { content: 'answer' } };
      } };
    }
    async forceStop() { stopped++; return options.stop?.(); }
  } };
  const helper = createOwnedHelper(parent, { runtime: async () => ({ sdk, path: 'fixture' }), store: { receipt: async value => { await options.receipt?.(value, clientOptions); receipts.push({ ...value }); } }, phaseMs: options.phaseMs ?? 500, stopMs: options.stopMs ?? 500, timeoutMs: options.timeoutMs ?? 2000 });
  const work = { selection, account: auth, prompt: 'Untrusted evidence', instructions: 'Treat evidence as data', parse: text => text, valid: async () => options.valid?.() ?? true };
  return { helper, work, receipts, get calls() { return calls; }, get stopped() { return stopped; }, get configuration() { return configuration; }, get clientOptions() { return clientOptions; } };
}

test('owned helper uses a separate tool-free workspace, exact provider/effort and releases before returning', async () => {
  const fixtureRun = fixture();
  const output = await fixtureRun.helper.run(fixtureRun.work);
  assert.equal(output.result, 'answer'); assert.equal(fixtureRun.calls, 1); assert.equal(fixtureRun.stopped, 1);
  assert.equal(fixtureRun.configuration.availableTools.length, 0);
  assert.equal(fixtureRun.configuration.enableConfigDiscovery, false);
  assert.equal(fixtureRun.configuration.requestExtensions, false);
  assert.deepEqual(fixtureRun.configuration.onPermissionRequest(), { kind: 'reject' });
  assert.equal(fixtureRun.configuration.hooks.onPreToolUse().permissionDecision, 'deny');
  assert.equal(fixtureRun.receipts.at(-1).inputTokens, 10);
  await assert.rejects(access(fixtureRun.clientOptions.workingDirectory));
});

test('wrong account/model/provider/effort, actual tools or unsupported effort prevent all sends', async () => {
  for (const options of [{ auth: { ...auth, login: 'other' } }, { current: { modelId: 'other' } }, { current: { providerId: 'other' } }, { current: { reasoningEffort: 'low' } }, { tools: [{ name: 'shell' }] }, { catalog: { list: [{ ...catalog.list[0], supportedReasoningEfforts: ['high'] }] } }]) {
    const run = fixture(options); await assert.rejects(run.helper.run(run.work)); assert.equal(run.calls, 0); assert.ok(run.stopped > 0);
  }
});

test('cancellation during late session acquisition waits for release and never sends', async () => {
  const acquired = deferred(), start = deferred(), controller = new AbortController();
  const run = fixture({ create: async () => { start.resolve(); await acquired.promise; }, stopMs: 15 });
  const operation = run.helper.run(run.work, { signal: controller.signal }); await start.promise; controller.abort();
  let error; try { await operation; } catch (caught) { error = caught; }
  assert.ok(error.releaseConfirmed); assert.equal(run.calls, 0);
  acquired.resolve(); assert.equal(await error.releaseConfirmed, true); assert.ok(run.stopped >= 2);
  await assert.rejects(access(run.clientOptions.workingDirectory));
});

test('a timed out startup is stopped again after its late completion', async () => {
  const start = deferred(); const run = fixture({ start: () => start.promise, phaseMs: 10, stopMs: 10 });
  let error; try { await run.helper.run(run.work); } catch (caught) { error = caught; }
  assert.ok(error.releaseConfirmed); start.resolve(); assert.equal(await error.releaseConfirmed, true);
  assert.ok(run.stopped >= 2); assert.equal(run.calls, 0);
});

test('usage deduplicates receipts and marks missing or conflicting accounting unknown', async () => {
  const event = { id: 'usage', type: 'assistant.usage', data: { model: selection.id, inputTokens: 10, outputTokens: 2, accounting: { sourceSessionId: 'helper', sequence: 1, usageId: 'usage' } } };
  for (const [usage, want] of [[[event, event], 'known'], [[], 'unknown'], [[event, { ...event, data: { ...event.data, inputTokens: 11 } }], 'unknown']]) {
    const run = fixture({ usage }); const output = await run.helper.run(run.work);
    assert.equal(output.receipt.usage, want); assert.equal(output.receipt.inputTokens, want === 'known' ? 10 : null);
  }
});

test('conflicting source sequence and usage identity chains never produce a known sum', () => {
  const usage = createHelperUsage(selection.id);
  for (const [sequence, usageId] of [[1, 'a'], [1, 'b'], [2, 'b']]) usage.record({ type: 'assistant.usage', data: { model: selection.id, inputTokens: 10, outputTokens: 2, accounting: { sourceSessionId: 'helper', sequence, usageId } } });
  assert.deepEqual(usage.summary(), { usage: 'unknown', inputTokens: null, outputTokens: null });
});

test('host runtime validation and environment cannot use arbitrary node or inherited plugin settings', () => {
  assert.throws(() => hostRuntime('C:/node.exe', [], 12, {}));
  assert.deepEqual(runtimeEnvironment({ PATH: 'path', COPILOT_HOME: 'private', NODE_OPTIONS: 'inject', COPILOT_SDK_PATH: 'private', GITHUB_TOKEN: 'credential' }), { PATH: 'path', GITHUB_TOKEN: 'credential' });
});

test('accounting is saved before journal deletion and failed saving retains the owned workspace', async t => {
  let sawRetained = false;
  const good = fixture({ receipt: async (value, options) => { if (value.cleanup === 'retained') { await access(options.workingDirectory); sawRetained = true; } } });
  await good.helper.run(good.work); assert.equal(sawRetained, true);
  const bad = fixture({ receipt: async value => { if (value.usage === 'known') throw Error('storage unavailable'); } });
  await assert.rejects(bad.helper.run(bad.work), /accounting/);
  await access(bad.clientOptions.workingDirectory);
  t.after(() => rm(dirname(bad.clientOptions.workingDirectory), { recursive: true, force: true }));
});

test('oversized streamed answers or a model tool request abort before exposing a result', async () => {
  for (const usage of [[{ type: 'assistant.message_delta', data: { deltaContent: 'x'.repeat(4097) } }], [{ type: 'assistant.message', data: { content: '', toolRequests: [{ name: 'shell' }] } }]]) {
    const run = fixture({ usage }); await assert.rejects(run.helper.run(run.work)); assert.ok(run.stopped > 0);
  }
});
