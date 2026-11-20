import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, mkdir, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readableEvent } from '../com.github.copilot/extensions/trace/web/event-data.mjs';
import { modelCatalog, selectModel, sameAccount } from '../com.github.copilot/extensions/trace/investigation-model.mjs';
import { captureEvidence, validateResult, createInvestigation } from '../com.github.copilot/extensions/trace/investigation.mjs';
import { createInvestigationStore } from '../com.github.copilot/extensions/trace/investigation-settings.mjs';

export const auth = { isAuthenticated: true, login: 'fixture', host: 'github.com' };
export const catalog = { list: [{ id: 'claude-haiku-5.5', name: 'Claude Haiku 5.5', provider: { kind: 'copilot', id: 'copilot' }, policy: { state: 'enabled' }, capabilities: { supports: { reasoningEffort: true } }, supportedReasoningEfforts: ['low', 'high', 'max'] }] };
export function failed(id = 'failure', extra = {}) {
  const raw = { id, type: 'tool.execution_complete', timestamp: '2026-11-20T12:00:00Z', data: { toolCallId: 'call', success: false, error: { message: '<script>日本語\nfailed' } } };
  return { id, type: raw.type, timestamp: raw.timestamp, agentId: '', toolCallId: 'call', toolName: '', success: false, truncated: false, evidence: JSON.stringify(raw, null, 2), ...extra };
}
const snapshot = entries => ({ entries, history: 'ready', omitted: 0 });
const answer = { what: 'The tool reported failure.', possibleCause: 'The supplied message may explain it.', unknowns: 'The underlying cause is not established.', nextCheck: 'Read the original result.', references: ['E1'] };

test('readable event fields preserve multiline Unicode, duplicate keys and number tokens without changing source', () => {
  const source = '{"n":9007199254740993,"n":-0,"text":"a\\nb\\t日本語<script>","items":[null,true]}';
  const parsed = readableEvent(source);
  assert.equal(parsed.children[0].value, '9007199254740993');
  assert.equal(parsed.children[1].value, '-0');
  assert.equal(parsed.children[2].value, 'a\nb\t日本語<script>');
  assert.equal(parsed.children[3].children[0].value, 'null');
  assert.equal(readableEvent(source.slice(0, -1)), null);
  assert.equal(readableEvent('['.repeat(20) + '0' + ']'.repeat(20)), null);
  assert.equal(readableEvent(JSON.stringify(Array(600).fill(0))), null);
  for (const whitespace of ['\u00a0', '\u2028', '\ufeff']) assert.equal(readableEvent(`${whitespace}{}`), null);
});

test('model choice is exact, eligible and highest supported; stale, ambiguous and foreign providers fail closed', () => {
  const models = modelCatalog(catalog, auth);
  assert.equal(selectModel(models, {}).effort, 'max');
  assert.equal(selectModel(models, { modelId: 'claude-haiku-5.5', providerId: 'copilot', effort: 'high' }).effort, 'high');
  for (const changed of [[], [{ ...catalog.list[0], policy: { state: 'disabled' } }], [{ ...catalog.list[0], provider: { kind: 'custom', id: 'other' } }]]) {
    assert.throws(() => selectModel(modelCatalog({ list: changed }, auth), {}));
  }
  assert.throws(() => modelCatalog({ list: [...catalog.list, catalog.list[0]] }, auth));
  assert.throws(() => selectModel(models, { modelId: 'missing', providerId: 'copilot', effort: 'high' }));
  assert.throws(() => selectModel(models, { modelId: 'claude-haiku-5.5', providerId: 'copilot', effort: 'xhigh' }));
  assert.equal(sameAccount(auth, { ...auth, login: 'other' }), false);
});

test('evidence is selected from retained direct failures and exact matching boundaries with explicit omissions', () => {
  const end = failed(), startRaw = { id: 'start', type: 'tool.execution_start', data: { toolCallId: 'call', toolName: 'shell', arguments: { command: 'echo fixture' } } };
  const start = { ...end, id: 'start', type: startRaw.type, toolName: 'shell', success: undefined, evidence: JSON.stringify(startRaw) };
  const captured = captureEvidence(snapshot([start, end, failed('other', { toolCallId: 'different' })]), 'failure');
  assert.deepEqual(captured.records.map(row => row.id), ['failure', 'start']);
  assert.equal(captured.records[0].evidence, end.evidence);
  assert.match(captured.scope, /retained/i);
  assert.throws(() => captureEvidence(snapshot([end, end]), 'failure'));
  assert.throws(() => captureEvidence(snapshot([failed('failure', { truncated: true })]), 'failure'));
  assert.throws(() => captureEvidence(snapshot([{ ...end, success: true, evidence: JSON.stringify({ id: end.id, type: end.type, data: { success: true } }) }]), 'failure'));
  assert.throws(() => captureEvidence(snapshot([failed('failure', { evidence: '{}' })]), 'failure'));
});

test('model answers reject extra fields, oversized prose, invalid references and non-JSON before display', () => {
  const records = captureEvidence(snapshot([failed()]), 'failure').records;
  assert.deepEqual(validateResult(JSON.stringify(answer), records), answer);
  for (const invalid of [{ ...answer, references: ['made-up'] }, { ...answer, what: 'x'.repeat(501) }, { ...answer, command: 'execute' }, { ...answer, references: [] }]) assert.throws(() => validateResult(JSON.stringify(invalid), records));
  assert.throws(() => validateResult('```json\n' + JSON.stringify(answer) + '\n```', records));
  assert.throws(() => validateResult(JSON.stringify(answer).replace('"what":', '"what":"duplicate","what":'), records));
});

test('persistent preferences serialize revisions and reject conflicting writers without storing chat text', async t => {
  const root = await mkdtemp(join(tmpdir(), 'trace-settings-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = createInvestigationStore(root), other = createInvestigationStore(root);
  assert.equal((await store.read()).revision, 0);
  const saved = await store.save({ modelId: 'claude-haiku-5.5', providerId: 'copilot', effort: 'high' }, 0);
  assert.equal(saved.revision, 1);
  await assert.rejects(other.save({ modelId: 'different', providerId: 'copilot', effort: 'low' }, 0));
  assert.deepEqual(await other.read(), saved);
  await store.receipt({ operation: 'fixed', outcome: 'completed', cleanup: 'released', usage: 'unknown', inputTokens: null, outputTokens: null });
  assert.equal((await store.read()).revision, 1);
  assert.doesNotMatch(await readFile(join(root, 'investigation.json'), 'utf8'), /prompt|answer|account|login/);
});

test('investigation holds its slot through cleanup, rejects stale captures and discards changed evidence', async () => {
  let current = snapshot([failed()]), resolveRun, calls = 0;
  const settings = { revision: 0 }, store = { read: async () => settings };
  const parent = { rpc: { model: { list: async () => catalog }, gitHubAuth: { getStatus: async () => auth } } };
  const helper = { run: async () => { calls++; return new Promise(resolve => { resolveRun = resolve; }); }, close: async () => {} };
  const controller = createInvestigation({ parent, snapshot: () => current, store, helper });
  const preview = await controller.preview('failure');
  assert.equal(calls, 0);
  await controller.start({ captureId: preview.captureId, requestId: 'request-one' });
  assert.equal(calls, 1);
  await assert.rejects(controller.start({ captureId: preview.captureId, requestId: 'request-two' }));
  current = snapshot([failed('failure', { evidence: failed().evidence + ' ' })]);
  resolveRun({ result: answer, receipt: { cleanup: 'released' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await controller.status()).result, undefined);
  assert.equal((await controller.status()).state, 'stale');
  await assert.rejects(controller.start({ captureId: preview.captureId, requestId: 'request-three' }));
  await controller.close();
});

test('several open failures keep their own preview; external preference changes discard completed answers', async () => {
  let revision = 0, prompt;
  const controller = createInvestigation({
    parent: { rpc: { model: { list: async () => catalog }, gitHubAuth: { getStatus: async () => auth } } },
    snapshot: () => snapshot([failed('first'), failed('second')]), store: { read: async () => ({ revision }) },
    helper: { run: async work => { prompt = work.prompt; return { result: answer, receipt: { cleanup: 'released' } }; }, close: async () => {} },
  });
  const first = await controller.preview('first'); await controller.preview('second');
  await controller.start({ captureId: first.captureId, requestId: 'first-request' });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(prompt, /first/); assert.doesNotMatch(prompt, /second/);
  assert.equal((await controller.status()).state, 'completed');
  revision++; assert.equal((await controller.status()).state, 'stale'); assert.equal((await controller.status()).result, undefined);
  await controller.close();
});

test('unresolved persisted helper release blocks a reopened controller without touching imported paths', async t => {
  const root = await mkdtemp(join(tmpdir(), 'trace-recovery-test-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = createInvestigationStore(root);
  await store.begin({ operation: 'pending', outcome: 'failed', cleanup: 'uncertain', usage: 'unknown', inputTokens: null, outputTokens: null, recovery: null });
  const controller = createInvestigation({ parent: { rpc: { model: { list: async () => catalog }, gitHubAuth: { getStatus: async () => auth } } }, snapshot: () => snapshot([failed()]), store, helper: { close: async () => {} } });
  assert.equal((await controller.status()).busy, true);
  assert.match((await controller.settings()).message, /unresolved cleanup/);
  await assert.rejects(controller.preview('failure'), /unresolved cleanup/);
  await assert.rejects(store.begin({ operation: 'second', outcome: 'failed', cleanup: 'uncertain', usage: 'unknown', inputTokens: null, outputTokens: null, recovery: null }));
  await controller.close();
});

test('settings reject unsupported schemas without overwriting prior bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'trace-settings-boundary-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = createInvestigationStore(root);
  await store.read();
  const { writeFile } = await import('node:fs/promises');
  await writeFile(join(root, 'investigation.json'), '{"schemaVersion":99}');
  await assert.rejects(store.save({ modelId: 'x', providerId: 'copilot', effort: 'high' }, 0));
  assert.equal(await readFile(join(root, 'investigation.json'), 'utf8'), '{"schemaVersion":99}');
});

test('settings reject linked or replaced owned directories and overlapping preference writers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'trace-settings-ownership-')); t.after(() => rm(root, { recursive: true, force: true }));
  const own = join(root, 'own'); await mkdir(own);
  const store = createInvestigationStore(own); await store.read();
  const writes = await Promise.allSettled([store.save({ modelId: 'one', providerId: 'copilot', effort: 'high' }, 0), createInvestigationStore(own).save({ modelId: 'two', providerId: 'copilot', effort: 'high' }, 0)]);
  assert.equal(writes.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await store.read()).revision, 1);
  await rename(own, join(root, 'moved')); await mkdir(own); await assert.rejects(store.read(), /replaced/);
  const linked = join(root, 'linked'); await symlink(own, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createInvestigationStore(linked).read(), /unsafe/);
});

test('receipt retention stays byte-bounded and preserves unresolved recovery', async t => {
  const root = await mkdtemp(join(tmpdir(), 'trace-receipt-bound-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = createInvestigationStore(root), receipt = { outcome: 'completed', cleanup: 'released', usage: 'unknown', inputTokens: null, outputTokens: null, modelId: 'm'.repeat(128), providerId: 'p'.repeat(128), effort: 'high' };
  await store.receipt({ ...receipt, operation: 'pending', cleanup: 'uncertain' });
  for (let i = 0; i < 75; i++) await store.receipt({ ...receipt, operation: `operation-${i}` });
  const text = await readFile(join(root, 'investigation.json'), 'utf8'); assert.ok(Buffer.byteLength(text) <= 32768);
  assert.equal((await store.recoveryStatus()).unresolved, 1); assert.equal((await store.read()).revision, 0);
});
