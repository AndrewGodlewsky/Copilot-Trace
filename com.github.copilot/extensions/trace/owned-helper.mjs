import { mkdtemp, mkdir, realpath, lstat, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { modelCatalog, selectModel, sameAccount, problem, InvestigationError } from './investigation-model.mjs';

export function hostRuntime(executable = process.execPath, argv = process.argv, parentPid = process.ppid, env = process.env) {
  if (!isAbsolute(executable) || !['copilot.exe', 'copilot', 'copilot-runtime.exe', 'copilot-runtime'].includes(basename(executable).toLowerCase()) ||
    !argv.some(arg => arg === 'extension_bootstrap.mjs' || (isAbsolute(arg) && basename(arg) === 'extension_bootstrap.mjs')) ||
    !env.COPILOT_SDK_PATH || !Number.isSafeInteger(parentPid) || parentPid <= 0 || String(parentPid) !== env.COPILOT_EXTENSION_PARENT_PID) throw problem('Investigation requires the host-paired Copilot runtime. Reopen Trace in an updated Copilot app.');
  return executable;
}
async function desktopRuntime() {
  const path = await realpath(hostRuntime()), sdk = await import('@github/copilot-sdk');
  if (typeof sdk.CopilotClient !== 'function' || typeof sdk.RuntimeConnection?.forStdio !== 'function') throw problem('This Copilot SDK cannot create an isolated investigation.');
  return { sdk, path };
}
export function runtimeEnvironment(source = process.env) {
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|HOME|USERPROFILE|LOCALAPPDATA|APPDATA|XDG_CONFIG_HOME|XDG_CACHE_HOME|LANG|LC_ALL|GH_TOKEN|GITHUB_TOKEN|GH_HOST|GITHUB_HOST|GH_CONFIG_DIR|HTTPS_PROXY|HTTP_PROXY|ALL_PROXY|NO_PROXY|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR)$/i;
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.test(key) && typeof value === 'string'));
}
function limited(promise, milliseconds, signal) {
  let timer, abort;
  return Promise.race([promise, new Promise((_, reject) => {
    abort = () => reject(problem('Investigation was cancelled or timed out.'));
    if (signal?.aborted) return abort();
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => reject(problem('Investigation setup or cleanup timed out.')), milliseconds); timer.unref?.();
  })]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', abort); });
}

export function createHelperUsage(model) {
  const receipts = [], validIdentity = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
  const count = value => Number.isSafeInteger(value) && value >= 0;
  let overflow = false;
  return {
    record(event) {
      if (event?.type !== 'assistant.usage') return;
      if (receipts.length >= 100) { overflow = true; return; }
      const data = event.data ?? {}, accounting = data.accounting ?? {}, keys = [];
      if (validIdentity(accounting.sourceSessionId)) {
        if (count(accounting.sequence)) keys.push(JSON.stringify(['sequence', accounting.sourceSessionId, accounting.sequence]));
        if (validIdentity(accounting.usageId)) keys.push(JSON.stringify(['usage', accounting.sourceSessionId, accounting.usageId]));
      }
      const provider = data.provider;
      const valid = keys.length === 2 && data.model === model && count(data.inputTokens) && count(data.outputTokens) &&
        (data.reasoningTokens === undefined || count(data.reasoningTokens) && data.reasoningTokens <= data.outputTokens) &&
        (provider === undefined || validIdentity(provider.id) && validIdentity(provider.kind) && validIdentity(provider.label));
      const signature = valid ? JSON.stringify([accounting.sourceSessionId, accounting.sequence, accounting.usageId, data.model, provider ?? null, data.modelProvider ?? null, event.agentId ?? '', data.inputTokens, data.outputTokens, data.reasoningTokens ?? null]) : null;
      receipts.push({ keys, signature, inputTokens: data.inputTokens, outputTokens: data.outputTokens });
    },
    summary() {
      const seen = new Set(); let inputTokens = 0, outputTokens = 0, valid = 0, invalid = overflow;
      for (const row of receipts) {
        if (seen.has(row)) continue;
        const component = [], pending = [row];
        while (pending.length) {
          const item = pending.pop(); if (seen.has(item)) continue; seen.add(item); component.push(item);
          pending.push(...receipts.filter(other => !seen.has(other) && item.keys.some(key => other.keys.includes(key))));
        }
        if (!row.signature || component.some(item => item.signature !== row.signature)) { invalid = true; continue; }
        valid++; inputTokens += row.inputTokens; outputTokens += row.outputTokens;
      }
      const known = valid > 0 && !invalid && count(inputTokens) && count(outputTokens);
      return { usage: known ? 'known' : valid ? 'partial' : 'unknown', inputTokens: known ? inputTokens : null, outputTokens: known ? outputTokens : null };
    },
  };
}

export function createOwnedHelper(parent, { store, runtime = desktopRuntime, timeoutMs = 120000, phaseMs = 20000, stopMs = 10000 } = {}) {
  const active = new Map(); let closed = false;
  async function execute(work, controller, progress) {
    let client, session, directory, ownedDirectory, phase = 'Checking Copilot access', sent = false, outcome = 'failed', streamedBytes = 0, boundaryFailure;
    const pending = new Set(), operation = randomUUID(), accounting = createHelperUsage(work.selection.id);
    const check = async () => { if (closed || controller.signal.aborted || !await work.valid()) throw problem('The investigation was cancelled or its evidence/settings changed.'); };
    const step = async (label, action) => {
      phase = label; progress(label); await check();
      const promise = Promise.resolve().then(action); pending.add(promise);
      promise.finally(() => pending.delete(promise)).catch(() => {});
      const value = await limited(promise, phaseMs, controller.signal); await check(); return value;
    };
    const timer = setTimeout(() => controller.abort(), timeoutMs); timer.unref?.();
    let stopAttempt;
    const stopNow = () => {
      if (!client) return Promise.resolve(true);
      return stopAttempt ??= Promise.resolve().then(() => client.forceStop()).then(() => true, () => false);
    };
    controller.signal.addEventListener('abort', () => { void stopNow(); }, { once: true });
    function usage(event) {
      if (!sent) return;
      accounting.record(event);
      if (event?.type === 'assistant.message_delta' && typeof event.data?.deltaContent === 'string') streamedBytes += Buffer.byteLength(event.data.deltaContent);
      if (streamedBytes > 4096 || event?.type === 'assistant.message' && typeof event.data?.content === 'string' && Buffer.byteLength(event.data.content) > 4096) boundaryFailure = problem('The helper exceeded the answer size limit. The answer was discarded.');
      if (event?.type === 'tool.execution_start' || event?.type === 'assistant.message' && event.data?.toolRequests?.length) boundaryFailure = problem('The helper requested a tool despite its empty tool set. The investigation was stopped.');
      if (boundaryFailure) controller.abort();
    }
    let result, failure;
    const pendingReceipt = { operation, outcome: 'failed', cleanup: 'uncertain', usage: 'unknown', inputTokens: null, outputTokens: null, recovery: null,
      modelId: work.selection.id, providerId: work.selection.providerId, effort: work.selection.effort };
    try {
      await store.begin?.(pendingReceipt);
      if (Buffer.byteLength(work.prompt) > 40000 || Buffer.byteLength(work.instructions) > 4000) throw problem('The investigation input exceeds its byte limit.');
      const paired = await step('Checking Copilot runtime', runtime);
      const [catalog, auth] = await step('Checking Copilot access', () => Promise.all([parent.rpc.model.list({ skipCache: true }), parent.rpc.gitHubAuth.getStatus(), parent.rpc.model.getCurrent()]));
      const selected = selectModel(modelCatalog(catalog, auth), { modelId: work.selection.id, providerId: work.selection.providerId, effort: work.selection.effort });
      if (!sameAccount(auth, work.account)) throw problem('The Copilot account changed. Inspect a new investigation preview.');
      await step('Creating isolated workspace', async () => {
        directory = await mkdtemp(join(tmpdir(), `trace-investigation-${operation}-`));
        ownedDirectory = { path: await realpath(directory), stat: await lstat(directory), root: await realpath(tmpdir()) };
        await mkdir(join(directory, 'workspace')); await mkdir(join(directory, 'home'));
        await store.receipt({ ...pendingReceipt, recovery: basename(directory) });
      });
      const workspace = join(directory, 'workspace'), home = join(directory, 'home');
      client = new paired.sdk.CopilotClient({ mode: 'empty', workingDirectory: workspace, baseDirectory: home,
        connection: paired.sdk.RuntimeConnection.forStdio({ path: paired.path, args: ['--no-auto-update'] }),
        env: runtimeEnvironment(), useLoggedInUser: true, builtinPluginDirectories: [], logLevel: 'error' });
      await step('Starting isolated runtime', () => client.start());
      const sessionId = randomUUID();
      session = await step('Creating tool-free investigation', () => client.createSession({
        sessionId, workingDirectory: workspace, configDirectory: home, model: selected.id, reasoningEffort: selected.effort,
        systemMessage: { mode: 'replace', content: work.instructions }, onEvent: usage,
        availableTools: [], tools: [], customAgents: [], requestExtensions: false, requestCanvasRenderer: false, pluginDirectories: [], mcpServers: {},
        enableConfigDiscovery: false, skipCustomInstructions: true, enableSkills: false, enableFileHooks: false,
        enableOnDemandInstructionDiscovery: false, enableSessionStore: false, enableHostGitOperations: false,
        skipEmbeddingRetrieval: true, embeddingCacheStorage: 'in-memory', enableSessionTelemetry: false,
        memory: { enabled: false }, skillDirectories: [], agentDirectories: [], instructionDirectories: [], hookDirectories: [],
        infiniteSessions: { enabled: false }, enableManagedSettings: true, enforceManagedModelDefaults: true,
        onPermissionRequest: () => ({ kind: 'reject' }),
        hooks: { onPreToolUse: () => ({ permissionDecision: 'deny', permissionDecisionReason: 'Trace investigation has no tools.' }) },
      }));
      if (session.sessionId !== sessionId || session.sessionId === parent.sessionId) throw problem('The helper session was not isolated.');
      const [helperAuth, helperCatalog, metadata] = await step('Verifying account and workspace', () => Promise.all([
        session.rpc.gitHubAuth.getStatus(), session.rpc.model.list({ skipCache: true }), session.rpc.metadata.snapshot(),
      ]));
      selectModel(modelCatalog(helperCatalog, helperAuth), { modelId: selected.id, providerId: selected.providerId, effort: selected.effort });
      if (!sameAccount(auth, helperAuth) || metadata.isRemote !== false || await realpath(metadata.workingDirectory) !== await realpath(workspace)) throw problem('The helper account or isolated workspace could not be verified.');
      await step('Selecting exact model and reasoning', () => session.rpc.model.switchTo({ modelId: selected.id, providerId: selected.providerId, reasoningEffort: selected.effort }));
      await step('Initializing the empty tool set', () => session.rpc.tools.initializeAndValidate());
      const [tools, current, parentAuth, currentAuth, finalCatalog] = await step('Checking final isolation', () => Promise.all([
        session.rpc.tools.getCurrentMetadata(), session.rpc.model.getCurrent(), parent.rpc.gitHubAuth.getStatus(), session.rpc.gitHubAuth.getStatus(), parent.rpc.model.list({ skipCache: true }),
      ]));
      selectModel(modelCatalog(finalCatalog, parentAuth), { modelId: selected.id, providerId: selected.providerId, effort: selected.effort });
      if (!Array.isArray(tools.tools) || tools.tools.length !== 0) throw problem('The helper exposed tools. No evidence was sent.');
      if (current.modelId !== selected.id || current.providerId !== selected.providerId || current.reasoningEffort !== selected.effort || !sameAccount(auth, parentAuth) || !sameAccount(auth, currentAuth)) throw problem('The helper model, reasoning or account differs from the inspected selection. No evidence was sent.');
      await check(); phase = 'Reading the supplied evidence'; progress(phase); sent = true;
      const send = session.sendAndWait({ prompt: work.prompt }, timeoutMs); pending.add(send); send.finally(() => pending.delete(send)).catch(() => {});
      const response = await limited(send, timeoutMs, controller.signal); await check();
      result = work.parse(response?.data?.content); outcome = 'completed';
    } catch (error) {
      if (controller.signal.aborted) outcome = 'cancelled';
      failure = boundaryFailure ?? (error instanceof InvestigationError ? error : problem(`Investigation could not finish: ${phase}. No automatic retry was made.`));
      controller.abort();
    } finally { clearTimeout(timer); }

    progress('Releasing isolated helper');
    // Starting/stopping the runtime are asynchronous. Wait for late acquisitions, then stop again before deleting its files.
    const release = (async () => {
      const firstStop = await stopNow();
      await Promise.allSettled([...pending]);
      if (client && (pending.size || !firstStop || controller.signal.aborted)) {
        stopAttempt = undefined; if (!await stopNow()) return false;
      }
      if (!firstStop && !client) return false;
      return true;
    })().catch(() => false);
    let released = await limited(release, stopMs).catch(() => false);
    const receipt = { ...pendingReceipt, outcome, cleanup: released ? 'retained' : 'uncertain', ...accounting.summary(), recovery: directory ? basename(directory) : null };
    async function finishRelease() {
      receipt.cleanup = 'retained'; receipt.recovery = directory ? basename(directory) : null;
      // Retain accounting and a private recovery name before removing any runtime journal.
      await store.receipt(receipt);
      if (directory) {
        const target = await realpath(directory), stat = await lstat(directory);
        if (!ownedDirectory || target !== ownedDirectory.path || dirname(target) !== ownedDirectory.root || stat.isSymbolicLink() || !stat.isDirectory() || stat.dev !== ownedDirectory.stat.dev || stat.ino !== ownedDirectory.stat.ino) throw problem('The helper cleanup path changed. Its temporary files were retained.');
        await rm(target, { recursive: true, force: true, maxRetries: 3 });
      }
      receipt.cleanup = 'released'; receipt.recovery = null; await store.receipt(receipt);
    }
    try { if (released) await finishRelease(); else await store.receipt(receipt); }
    catch { failure = problem('Helper cleanup or usage accounting could not finish. Recovery data was retained when possible. No automatic retry was made.'); }
    if (!released) {
      const error = problem('Helper release is uncertain. No automatic retry was made.');
      error.releaseConfirmed = release.then(async confirmed => {
        if (confirmed) await finishRelease().catch(() => {});
        return confirmed;
      });
      throw error;
    }
    if (failure) throw failure;
    return { result, receipt };
  }
  return {
    run(work, { signal, progress = () => {} } = {}) {
      if (closed) return Promise.reject(problem('The helper is closed.'));
      const controller = new AbortController(), abort = () => controller.abort();
      if (signal?.aborted) abort(); signal?.addEventListener('abort', abort, { once: true });
      const task = execute(work, controller, progress).finally(() => { signal?.removeEventListener('abort', abort); active.delete(controller); });
      active.set(controller, task); return task;
    },
    async close() { closed = true; for (const controller of active.keys()) controller.abort(); await Promise.allSettled([...active.values()]); },
  };
}
