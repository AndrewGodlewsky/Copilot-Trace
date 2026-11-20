import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startServer } from '../com.github.copilot/extensions/trace/server.mjs';
import { createInvestigation } from '../com.github.copilot/extensions/trace/investigation.mjs';
import { createOwnedHelper } from '../com.github.copilot/extensions/trace/owned-helper.mjs';
import { createInvestigationStore } from '../com.github.copilot/extensions/trace/investigation-settings.mjs';

// Auth/catalog/provider identity are synthetic adapters only. Workspace, tools, session, model effort,
// HTTP authorization, evidence selection, response validation, accounting and cleanup use production code and the installed runtime.
export async function runInvestigationFixture({ sdk, cli, parent, failureId, temporary }) {
  const result = { what: 'The recorded command exited with code 1.', possibleCause: 'The supplied test output suggests an assertion failed.', unknowns: 'This fixture does not establish the real cause.', nextCheck: 'Inspect the original failing assertion.', references: ['E1', 'E2'] };
  let requests = 0, sent, helperWorkspace, helperSessionId, actualTools;
  const auth = { isAuthenticated: true, login: 'synthetic-fixture', host: 'fixture.invalid' };
  const models = { list: [{ id: 'trace-fixture', name: 'Local fixed-response fixture', provider: { kind: 'copilot', id: 'fixture-copilot' },
    capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ['high'] }] };
  const provider = createServer(async (req, res) => {
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') { res.writeHead(404); res.end(); return; }
    let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 100000) { res.writeHead(413); res.end(); return; } }
    sent = JSON.parse(body); requests++;
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    if (!sent.stream) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'helper-fixture', object: 'chat.completion', created: 1, model: sent.model,
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }], usage })); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const part of [
      { id: 'helper-fixture', object: 'chat.completion.chunk', created: 1, model: sent.model, choices: [{ index: 0, delta: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: null }] },
      { id: 'helper-fixture', object: 'chat.completion.chunk', created: 1, model: sent.model, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage },
    ]) res.write(`data: ${JSON.stringify(part)}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const parentModel = await parent.rpc.model.getCurrent();
  const parentFacade = { sessionId: parent.sessionId, getEvents: () => parent.getEvents(), on: callback => parent.on(callback), rpc: {
    ...parent.rpc, model: { ...parent.rpc.model, list: async () => models }, gitHubAuth: { getStatus: async () => auth },
  } };
  const fixtureSdk = { RuntimeConnection: sdk.RuntimeConnection, CopilotClient: class {
    constructor(options) {
      helperWorkspace = options.workingDirectory;
      this.client = new sdk.CopilotClient({ ...options, useLoggedInUser: false,
        env: { ...options.env, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, COPILOT_HOME: options.baseDirectory, GH_CONFIG_DIR: join(temporary, 'fixture-no-auth') } });
    }
    start() { return this.client.start(); }
    forceStop() { return this.client.forceStop(); }
    async createSession(config) {
      const session = await this.client.createSession({ ...config,
        modelCapabilities: { supports: { reasoningEffort: true } },
        provider: { type: 'openai', wireApi: 'completions', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, apiKey: 'fixture' },
      });
      helperSessionId = session.sessionId;
      const getCurrent = session.rpc.model.getCurrent, switchTo = session.rpc.model.switchTo, tools = session.rpc.tools.getCurrentMetadata;
      session.rpc.model.list = async () => models;
      session.rpc.gitHubAuth.getStatus = async () => auth;
      session.rpc.model.switchTo = async input => {
        assert.equal(input.providerId, 'fixture-copilot');
        return switchTo({ modelId: input.modelId, reasoningEffort: input.reasoningEffort });
      };
      session.rpc.model.getCurrent = async () => {
        const actual = await getCurrent(); assert.equal(actual.modelId, 'trace-fixture'); assert.equal(actual.reasoningEffort, 'high');
        return { ...actual, providerId: 'fixture-copilot' };
      };
      session.rpc.tools.getCurrentMetadata = async () => { const value = await tools(); actualTools = value.tools; return value; };
      return session;
    }
  } };
  const storeDirectory = join(temporary, 'investigation-settings'), store = createInvestigationStore(storeDirectory);
  await store.save({ modelId: 'trace-fixture', providerId: 'fixture-copilot', effort: 'high' }, 0);
  const helper = createOwnedHelper(parentFacade, { store, runtime: async () => ({ sdk: fixtureSdk, path: cli }) });
  let server;
  try {
    server = await startServer(parentFacade, { investigationFactory: options => createInvestigation({ ...options, store, helper }) });
    const post = async (action, values = {}) => {
      const response = await fetch(server.url + 'investigation', { method: 'POST', headers: { Origin: new URL(server.url).origin, 'Content-Type': 'application/json', 'X-Trace-Request': 'investigation' }, body: JSON.stringify({ action, ...values }) });
      const value = await response.json(); assert.equal(response.status, 200, JSON.stringify(value)); return value;
    };
    let events;
    for (let i = 0; i < 40; i++) {
      events = await (await fetch(server.url + 'events')).json(); if (events.history === 'ready') break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(events.entries.some(entry => entry.id === failureId));
    for (const asset of ['investigation.mjs', 'event-data.mjs']) assert.equal((await fetch(server.url + asset)).status, 200);
    const settings = await post('settings'); assert.equal(settings.selected.effort, 'high');
    const preview = await post('preview', { eventId: failureId });
    assert.equal(preview.records[0].id, failureId); assert.equal(preview.records.length, 2);
    assert.equal(requests, 0, 'Opening Trace, reading Settings and preparing scope must not perform inference.');
    await post('start', { captureId: preview.captureId, requestId: 'installed-investigation-fixture' });
    let status;
    for (let i = 0; i < 200; i++) {
      status = await post('status'); if (!status.busy) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(status.state, 'completed', JSON.stringify(status)); assert.deepEqual(status.result, result);
    assert.equal(requests, 1); assert.deepEqual(actualTools, []); assert.equal(sent.tools?.length ?? 0, 0);
    assert.equal(sent.reasoning_effort, 'high'); assert.notEqual(helperSessionId, parent.sessionId);
    assert.equal(status.receipt.usage, 'known'); assert.equal(status.receipt.inputTokens, 100); assert.equal(status.receipt.outputTokens, 20);
    assert.equal(status.receipt.cleanup, 'released'); await assert.rejects(access(helperWorkspace));
    assert.deepEqual(await parent.rpc.model.getCurrent(), parentModel);
    const saved = await readFile(join(storeDirectory, 'investigation.json'), 'utf8');
    assert.doesNotMatch(saved, /assertion failed|original failing|tool.execution|fixture-no-auth/);
    assert.equal(JSON.parse(saved).receipts.at(-1).cleanup, 'released');
    console.log('PASS: investigation HTTP/evidence/settings path, separate installed SDK helper, actual empty tools, high effort transmitted, one fixed local answer, usage 100/20, parent model unchanged and cleanup. Auth/catalog/provider identity are synthetic adapters; no paid inference, live entitlement or model-quality claim.');
  } finally {
    await server?.close(); await helper.close(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
  }
}
