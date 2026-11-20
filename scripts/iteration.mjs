import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repository = fileURLToPath(new URL('../', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const jsonText = value => `${JSON.stringify(value, null, 2)}\n`;
const slug = value => typeof value === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(value)
  && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value);

function iterationPath(root, id) {
  if (!slug(id)) throw new Error('Invalid iteration ID: use a portable simple slug.');
  return join(resolve(root), '.iteration', id);
}

async function ordinaryPath(root, path, { missing = false, directory = false } = {}) {
  const base = resolve(root);
  const target = resolve(path);
  const rel = relative(base, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Unsafe path outside repository.');
  let current = base;
  const parts = rel.split(sep);
  for (let index = 0; index < parts.length; index++) {
    current = join(current, parts[index]);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (error.code === 'ENOENT' && missing && index === parts.length - 1) return target;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Unsafe symbolic link: ${relative(base, current)}`);
    if (index < parts.length - 1 || directory) {
      if (!info.isDirectory()) throw new Error(`Expected ordinary directory: ${relative(base, current)}`);
    } else if (!info.isFile()) throw new Error(`Expected ordinary file: ${rel}`);
  }
  return target;
}

async function localRead(root, path) {
  return readFile(await ordinaryPath(root, path));
}

async function localJson(root, path) {
  return JSON.parse((await localRead(root, path)).toString('utf8'));
}

async function atomicWrite(root, path, content) {
  await ordinaryPath(root, path, { missing: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await ordinaryPath(root, path, { missing: true });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

async function withLock(root, id, action) {
  const dir = iterationPath(root, id);
  await ordinaryPath(root, dir, { directory: true });
  const path = join(dir, 'operation.lock');
  await ordinaryPath(root, path, { missing: true });
  let handle;
  try { handle = await open(path, 'wx'); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('Iteration operation already running (operation.lock exists).');
    throw error;
  }
  try { return await action(dir); }
  finally { await handle.close(); await unlink(path); }
}

async function git(root, args) {
  return (await exec('git', args, { cwd: root, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })).stdout;
}

async function assertRepositoryRoot(root) {
  const canonical = async path => {
    const value = await realpath(path);
    return process.platform === 'win32' ? value.toLowerCase() : value;
  };
  const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
  if (await canonical(root) !== await canonical(top)) throw new Error('Iteration tooling must run from its own Git repository root, not a packaged or nested copy.');
}

export async function fingerprint(root) {
  await assertRepositoryRoot(root);
  const listed = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard', '-z']);
  const paths = [...new Set(listed.split('\0').filter(Boolean))].sort();
  const hash = createHash('sha256');
  for (const path of paths) {
    if (path === '.iteration' || path.startsWith('.iteration/')) continue;
    const full = resolve(root, path);
    let content;
    try { content = await localRead(root, full); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // Absence must stay identical when a deletion moves from worktree to index to commit.
      continue;
    }
    hash.update(JSON.stringify([path, 'file', digest(content)]));
  }
  return hash.digest('hex');
}

async function completedBrief(root, id) {
  const path = join(iterationPath(root, id), 'brief.json');
  const bytes = await localRead(root, path);
  const brief = JSON.parse(bytes.toString('utf8'));
  if (!brief || brief.schemaVersion !== 1 || brief.id !== id || !nonempty(brief.summary)
    || !nonempty(brief.implementationAgent) || !Array.isArray(brief.acceptance) || !brief.acceptance.length
    || !brief.acceptance.every(nonempty) || typeof brief.ui !== 'boolean' || typeof brief.host !== 'boolean') {
    throw new Error('Complete brief required: summary, acceptance, implementationAgent, ui and host.');
  }
  return { brief, briefHash: digest(bytes) };
}

export async function startIteration(root, id) {
  await assertRepositoryRoot(root);
  const dir = iterationPath(root, id);
  const parent = dirname(dir);
  await ordinaryPath(root, parent, { missing: true, directory: true });
  await mkdir(parent).catch(error => { if (error.code !== 'EEXIST') throw error; });
  await ordinaryPath(root, dir, { missing: true, directory: true });
  await mkdir(dir);
  await atomicWrite(root, join(dir, 'brief.json'), jsonText({
    schemaVersion: 1, id, summary: '', acceptance: [], implementationAgent: '', ui: false, host: false,
  }));
  return { command: 'start', id, brief: `.iteration/${id}/brief.json` };
}

export async function reviewIteration(root, id, reviewer, evidenceFile) {
  return withLock(root, id, async dir => {
    const { brief, briefHash } = await completedBrief(root, id);
    if (!nonempty(reviewer) || reviewer.trim().toLowerCase() === brief.implementationAgent.trim().toLowerCase()) {
      throw new Error('An independent reviewer different from implementationAgent is required.');
    }
    const evidence = await localRead(root, resolve(root, evidenceFile));
    if (!evidence.toString('utf8').trim()) throw new Error('Review evidence is empty.');
    const candidate = await fingerprint(root);
    await atomicWrite(root, join(dir, 'review-evidence.txt'), evidence);
    const approval = {
      schemaVersion: 1, id, decision: 'approved', reviewer: reviewer.trim(), implementationAgent: brief.implementationAgent,
      candidate, briefHash, evidenceHash: digest(evidence), evidence: 'review-evidence.txt', recordedAt: new Date().toISOString(),
    };
    await atomicWrite(root, join(dir, 'review.json'), jsonText(approval));
    return { command: 'review', id, status: 'approved', evidence: `.iteration/${id}/review.json` };
  });
}

export function recordUiAcceptance(root, id, evidenceFile) {
  return recordUiDecision(root, id, evidenceFile, 'accepted');
}

export function recordUiDeferral(root, id, evidenceFile) {
  return recordUiDecision(root, id, evidenceFile, 'deferred');
}

async function recordUiDecision(root, id, evidenceFile, decision) {
  return withLock(root, id, async dir => {
    const { brief, briefHash } = await completedBrief(root, id);
    if (!brief.ui) throw new Error('UI acceptance requires a declared UI change.');
    const evidence = await localRead(root, resolve(root, evidenceFile));
    if (!evidence.toString('utf8').trim()) throw new Error('UI acceptance evidence is empty.');
    const candidate = await fingerprint(root);
    await atomicWrite(root, join(dir, 'ui-evidence.txt'), evidence);
    await atomicWrite(root, join(dir, 'ui.json'), jsonText({
      schemaVersion: 1, id, decision, candidate, briefHash,
      evidence: 'ui-evidence.txt', evidenceHash: digest(evidence), recordedAt: new Date().toISOString(),
    }));
    return { command: decision === 'deferred' ? 'defer-ui' : 'ui', id, status: 'recorded', ui: decision, evidence: `.iteration/${id}/ui.json` };
  });
}

async function reviewedCandidate(root, id) {
  const dir = iterationPath(root, id);
  const { brief, briefHash } = await completedBrief(root, id);
  const approvalBytes = await localRead(root, join(dir, 'review.json'));
  const approval = JSON.parse(approvalBytes.toString('utf8'));
  const candidate = await fingerprint(root);
  if (!approval || approval.schemaVersion !== 1 || approval.id !== id || approval.decision !== 'approved'
    || !nonempty(approval.reviewer) || approval.reviewer.trim().toLowerCase() === brief.implementationAgent.trim().toLowerCase()
    || approval.implementationAgent !== brief.implementationAgent || approval.briefHash !== briefHash
    || approval.candidate !== candidate || approval.evidence !== 'review-evidence.txt') {
    throw new Error('Independent approval is missing, invalid or stale for this candidate/brief.');
  }
  const evidence = await localRead(root, join(dir, 'review-evidence.txt'));
  if (!evidence.toString('utf8').trim() || digest(evidence) !== approval.evidenceHash) throw new Error('Review evidence is modified or empty.');
  let uiHash = null;
  let ui = 'not-required';
  if (brief.ui) {
    try {
      const bytes = await localRead(root, join(dir, 'ui.json'));
      const acceptance = JSON.parse(bytes.toString('utf8'));
      if (!acceptance || acceptance.schemaVersion !== 1 || acceptance.id !== id || !['accepted', 'deferred'].includes(acceptance.decision)
        || acceptance.candidate !== candidate || acceptance.briefHash !== briefHash || acceptance.evidence !== 'ui-evidence.txt') throw new Error('Invalid or stale receipt.');
      const uiEvidence = await localRead(root, join(dir, 'ui-evidence.txt'));
      if (!uiEvidence.toString('utf8').trim() || digest(uiEvidence) !== acceptance.evidenceHash) throw new Error('Modified or empty evidence.');
      uiHash = digest(bytes);
      ui = acceptance.decision;
    } catch (error) { throw new Error('Owner UI acceptance or authorized deferral is missing, invalid or stale for this candidate/brief.', { cause: error }); }
  }
  return { brief, candidate, briefHash, approvalHash: digest(approvalBytes), evidenceHash: digest(evidence), uiHash, ui };
}

function gatesFor(brief) {
  return [
    { name: 'test', command: 'npm test', args: ['test'] },
    { name: 'check', command: 'npm run check', args: ['run', 'check'] },
    ...(brief.host ? [{ name: 'e2e', command: 'npm run e2e', args: ['run', 'e2e'] }] : []),
  ];
}

async function npmCli() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')].filter(Boolean);
  for (const candidate of candidates) {
    try { if ((await lstat(candidate)).isFile()) return candidate; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('Installed npm CLI not found. Run through npm run iteration or set npm_execpath.');
}

async function realRunner(gate, { root, stdoutPath, stderrPath }) {
  const cli = await npmCli();
  const stdout = await open(stdoutPath, 'w');
  const stderr = await open(stderrPath, 'w');
  try {
    return await new Promise((resolveRun, reject) => {
      const child = spawn(process.execPath, [cli, ...gate.args], { cwd: root, shell: false, windowsHide: true, stdio: ['ignore', stdout.fd, stderr.fd] });
      child.once('error', reject);
      child.once('close', (code, signal) => resolveRun({ code, signal }));
    });
  } finally { await stdout.close(); await stderr.close(); }
}

function sameCandidate(left, right) {
  return ['candidate', 'briefHash', 'approvalHash', 'evidenceHash', 'uiHash'].every(key => left[key] === right[key]);
}

export async function verifyIteration(root, id, { runner = realRunner } = {}) {
  return withLock(root, id, async dir => {
    let before;
    try {
      before = await reviewedCandidate(root, id);
    } catch (error) {
      error.evidence = `.iteration/${id}/verification.json`;
      await atomicWrite(root, join(dir, 'verification.json'), jsonText({
        schemaVersion: 1, id, status: 'failed', reason: error.message, gates: [], finishedAt: new Date().toISOString(),
      }));
      throw error;
    }
    const receipt = {
      schemaVersion: 1, id, status: 'failed', candidate: before.candidate, briefHash: before.briefHash,
      approvalHash: before.approvalHash, evidenceHash: before.evidenceHash, uiHash: before.uiHash, ui: before.ui, gates: [], startedAt: new Date().toISOString(),
    };
    try {
      receipt.head = (await git(root, ['rev-parse', 'HEAD'])).trim();
      for (const gate of gatesFor(before.brief)) {
        const stdoutPath = join(dir, `${gate.name}.stdout.log`);
        const stderrPath = join(dir, `${gate.name}.stderr.log`);
        await atomicWrite(root, stdoutPath, '');
        await atomicWrite(root, stderrPath, '');
        let result;
        try { result = await runner(gate, { root: resolve(root), stdoutPath, stderrPath }); }
        catch (error) { result = { code: null, stderr: error.message }; }
        if (typeof result?.stdout === 'string') await atomicWrite(root, stdoutPath, result.stdout);
        if (typeof result?.stderr === 'string') await atomicWrite(root, stderrPath, result.stderr);
        const entry = {
          name: gate.name, command: gate.command, code: result?.code ?? null,
          stdout: { path: `${gate.name}.stdout.log`, hash: digest(await localRead(root, stdoutPath)) },
          stderr: { path: `${gate.name}.stderr.log`, hash: digest(await localRead(root, stderrPath)) },
        };
        receipt.gates.push(entry);
        if (entry.code !== 0) throw new Error(`Required gate failed: ${gate.command}`);
      }
      if (!sameCandidate(before, await reviewedCandidate(root, id))) throw new Error('Candidate, brief or approval changed during verification.');
      receipt.status = 'passed';
    } catch (error) { receipt.reason = error.message; }
    receipt.finishedAt = new Date().toISOString();
    await atomicWrite(root, join(dir, 'verification.json'), jsonText(receipt));
    return { command: 'verify', id, status: receipt.status, ui: before.ui, reason: receipt.reason, evidence: `.iteration/${id}/verification.json`, gates: receipt.gates.map(({ command, code, stdout, stderr }) => ({ command, status: code === 0 ? 'passed' : 'failed', stdout: `.iteration/${id}/${stdout.path}`, stderr: `.iteration/${id}/${stderr.path}` })) };
  });
}

export async function statusIteration(root, id) {
  try {
    const dir = iterationPath(root, id);
    try {
      await lstat(join(dir, 'operation.lock'));
      throw new Error('Iteration operation is running or a stale operation.lock needs inspection.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const current = await reviewedCandidate(root, id);
    const receipt = await localJson(root, join(dir, 'verification.json'));
    if (!receipt || receipt.schemaVersion !== 1 || receipt.id !== id || receipt.status !== 'passed' || !sameCandidate(receipt, current)) {
      throw new Error('Verification is missing, failed or stale.');
    }
    const required = gatesFor(current.brief);
    if (!Array.isArray(receipt.gates) || receipt.gates.length !== required.length) throw new Error('Required verification gate is missing.');
    for (let index = 0; index < required.length; index++) {
      const expected = required[index];
      const gate = receipt.gates[index];
      if (!gate || gate.name !== expected.name || gate.command !== expected.command || gate.code !== 0) throw new Error('Required verification gate is missing or failed.');
      for (const stream of ['stdout', 'stderr']) {
        const evidence = gate[stream];
        if (!evidence || evidence.path !== `${expected.name}.${stream}.log`
          || digest(await localRead(root, join(dir, evidence.path))) !== evidence.hash) throw new Error('Verification log evidence is missing or modified.');
      }
    }
    return { command: 'status', id, ready: true, status: 'ready', ui: current.ui, evidence: `.iteration/${id}/verification.json` };
  } catch (error) { return { command: 'status', id, ready: false, status: 'not-ready', reasons: [error.message] }; }
}

function validateUsage(entry) {
  if (!entry || !slug(entry.id) || !nonempty(entry.model) || !nonempty(entry.source)
    || !['implementation', 'review', 'coordination', 'rework', 'setup'].includes(entry.phase)) throw new Error('Invalid usage id, model, source or phase.');
  for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'coordinationCalls', 'reworkCount']) {
    if ((key === 'coordinationCalls' || key === 'reworkCount') && entry[key] === null) continue;
    if (!Number.isSafeInteger(entry[key]) || entry[key] < 0) throw new Error(`Invalid usage ${key}.`);
  }
  if (entry.cachedInputTokens > entry.inputTokens) throw new Error('Usage cached tokens cannot exceed input tokens.');
}

function usageTotals(entries) {
  const models = new Map();
  for (const entry of entries) {
    let total = models.get(entry.model);
    if (!total) {
      total = { model: entry.model, inputTokens: 0, freshInputTokens: 0, cachedInputTokens: 0, outputTokens: 0, coordinationCalls: 0, reworkCount: 0 };
      models.set(entry.model, total);
    }
    for (const key of ['inputTokens', 'freshInputTokens', 'cachedInputTokens', 'outputTokens', 'coordinationCalls', 'reworkCount']) {
      const value = key === 'freshInputTokens' ? entry.inputTokens - entry.cachedInputTokens : entry[key];
      total[key] = total[key] === null || value === null ? null : total[key] + value;
      if (total[key] !== null && !Number.isSafeInteger(total[key])) throw new Error('Usage totals exceed safe integer range.');
    }
  }
  return [...models.values()].sort((left, right) => left.model.localeCompare(right.model));
}

export async function recordUsage(root, id, entryFile) {
  return withLock(root, id, async dir => {
    const entry = await localJson(root, resolve(root, entryFile));
    validateUsage(entry);
    const path = join(dir, 'usage.json');
    let ledger = { schemaVersion: 1, entries: [] };
    try { ledger = await localJson(root, path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!ledger || ledger.schemaVersion !== 1 || !Array.isArray(ledger.entries)) throw new Error('Invalid existing usage ledger.');
    const ids = new Set();
    for (const existing of ledger.entries) {
      validateUsage(existing);
      if (ids.has(existing.id)) throw new Error('Duplicate existing usage entry ID.');
      ids.add(existing.id);
    }
    if (ids.has(entry.id)) throw new Error('Duplicate usage entry ID.');
    ledger.entries.push(entry);
    const models = usageTotals(ledger.entries);
    await atomicWrite(root, path, jsonText(ledger));
    return { command: 'usage', id, entries: ledger.entries.length, models, evidence: `.iteration/${id}/usage.json` };
  });
}

async function main(args) {
  const [command, id, ...rest] = args;
  let result;
  if (command === 'start' && rest.length === 0) result = await startIteration(repository, id);
  else if (command === 'review' && rest.length === 2) result = await reviewIteration(repository, id, rest[0], resolve(rest[1]));
  else if (command === 'ui' && rest.length === 1) result = await recordUiAcceptance(repository, id, resolve(rest[0]));
  else if (command === 'defer-ui' && rest.length === 1) result = await recordUiDeferral(repository, id, resolve(rest[0]));
  else if (command === 'verify' && rest.length === 0) result = await verifyIteration(repository, id);
  else if (command === 'status' && rest.length === 0) result = await statusIteration(repository, id);
  else if (command === 'usage' && rest.length === 1) result = await recordUsage(repository, id, resolve(rest[0]));
  else throw new Error('Usage: iteration start <id> | review <id> <reviewer> <evidence-file> | ui <id> <owner-report> | defer-ui <id> <owner-authorization-and-pending-checks> | verify <id> | status <id> | usage <id> <entry.json>');
  console.log(JSON.stringify(result));
  if (result.status === 'failed' || result.ready === false) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(JSON.stringify({ status: 'failed', reason: error.message, evidence: error.evidence }));
    process.exitCode = 1;
  });
}
