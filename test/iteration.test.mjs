import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import * as iteration from '../scripts/iteration.mjs';

const git = (root, ...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
const json = async path => JSON.parse(await readFile(path, 'utf8'));
const putJson = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
const pass = async () => ({ code: 0, stdout: 'passed\n', stderr: '' });

async function fixture(t, flags = {}) {
  const root = await mkdtemp(join(tmpdir(), 'trace-iteration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  git(root, 'config', 'core.autocrlf', 'false');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(join(root, '.gitignore'), '.iteration/\nignored/\n');
  await writeFile(join(root, 'source.mjs'), 'export const answer = 42;\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'fixture');
  await iteration.startIteration(root, 'change');
  const dir = join(root, '.iteration', 'change');
  const brief = { schemaVersion: 1, id: 'change', summary: 'Improve a thing', acceptance: ['It works'], implementationAgent: 'builder', ui: false, host: false, ...flags };
  await putJson(join(dir, 'brief.json'), brief);
  await writeFile(join(dir, 'report.md'), 'Independent review: approved.\n');
  const approve = () => iteration.reviewIteration(root, 'change', 'reviewer', join(dir, 'report.md'));
  await approve();
  return { root, dir, brief, approve };
}

test('start preserves existing work and incomplete briefs cannot be approved', async t => {
  const { root, dir } = await fixture(t);
  const before = await readFile(join(dir, 'brief.json'), 'utf8');
  await assert.rejects(iteration.startIteration(root, 'change'), /exist/i);
  assert.equal(await readFile(join(dir, 'brief.json'), 'utf8'), before);
  await iteration.startIteration(root, 'new');
  const template = await json(join(root, '.iteration', 'new', 'brief.json'));
  assert.equal(template.schemaVersion, 1);
  assert.equal(template.id, 'new');
  assert.equal(typeof template.ui, 'boolean');
  await assert.rejects(iteration.reviewIteration(root, 'new', 'reviewer', join(dir, 'report.md')), /brief/i);
});

test('approval requires separate reviewer and ordinary nonempty evidence, copied locally', async t => {
  const { root, dir } = await fixture(t);
  for (const reviewer of ['', 'builder', ' builder ']) {
    await assert.rejects(iteration.reviewIteration(root, 'change', reviewer, join(dir, 'report.md')), /reviewer|independent/i);
  }
  await writeFile(join(dir, 'empty.md'), ' \n');
  await assert.rejects(iteration.reviewIteration(root, 'change', 'reviewer', join(dir, 'empty.md')), /empty/i);
  await assert.rejects(iteration.reviewIteration(root, 'change', 'reviewer', dir), /ordinary|file/i);
  const approval = await json(join(dir, 'review.json'));
  assert.equal(approval.reviewer, 'reviewer');
  await rm(join(dir, 'report.md'));
  assert.equal((await iteration.verifyIteration(root, 'change', { runner: pass })).status, 'passed');
  assert.equal((await iteration.statusIteration(root, 'change')).ready, true);
});

test('verification runs fixed gates in order and binds successful logs to content', async t => {
  const { root, dir } = await fixture(t);
  const seen = [];
  const result = await iteration.verifyIteration(root, 'change', { runner: async gate => { seen.push(gate.command); return pass(); } });
  assert.deepEqual(seen, ['npm test', 'npm run check']);
  assert.equal(result.status, 'passed');
  assert.equal((await iteration.statusIteration(root, 'change')).ready, true);
  git(root, 'commit', '--allow-empty', '-qm', 'no content changes');
  assert.equal((await iteration.statusIteration(root, 'change')).ready, true);
  const receipt = await json(join(dir, 'verification.json'));
  await writeFile(join(dir, receipt.gates[0].stdout.path), 'altered evidence');
  assert.equal((await iteration.statusIteration(root, 'change')).ready, false);
});

test('declared host and UI gates require real check results and recorded owner acceptance', async t => {
  const { root, dir } = await fixture(t, { host: true, ui: true });
  let runs = 0;
  await assert.rejects(iteration.verifyIteration(root, 'change', { runner: async () => { runs++; return pass(); } }), /UI acceptance/i);
  assert.equal(runs, 0);
  assert.equal((await json(join(dir, 'verification.json'))).status, 'failed');
  await writeFile(join(dir, 'owner.md'), 'Owner confirmed native narrow/short, keyboard and theme acceptance.');
  await iteration.recordUiAcceptance(root, 'change', join(dir, 'owner.md'));
  const seen = [];
  const result = await iteration.verifyIteration(root, 'change', { runner: async gate => { seen.push(gate.command); return pass(); } });
  assert.equal(result.status, 'passed');
  assert.deepEqual(seen, ['npm test', 'npm run check', 'npm run e2e']);
  assert.equal((await iteration.statusIteration(root, 'change')).ready, true);
  await writeFile(join(dir, 'ui-evidence.txt'), 'edited report');
  assert.equal((await iteration.statusIteration(root, 'change')).ready, false);
});

test('UI acceptance rejects empty evidence and cannot follow a changed candidate or brief', async t => {
  const { root, dir, brief, approve } = await fixture(t, { ui: true });
  const report = join(dir, 'owner.md');
  await writeFile(report, ' ');
  await assert.rejects(iteration.recordUiAcceptance(root, 'change', report), /empty/i);
  await writeFile(report, 'Owner confirmed UI checks pass.');
  await iteration.recordUiAcceptance(root, 'change', report);
  await writeFile(join(root, 'source.mjs'), 'new candidate');
  await approve();
  await assert.rejects(iteration.verifyIteration(root, 'change', { runner: pass }), /UI acceptance/i);
  await iteration.recordUiAcceptance(root, 'change', report);
  await putJson(join(dir, 'brief.json'), { ...brief, summary: 'new requirement' });
  await approve();
  await assert.rejects(iteration.verifyIteration(root, 'change', { runner: pass }), /UI acceptance/i);
});

test('changing UI evidence during verification fails the receipt', async t => {
  const { root, dir } = await fixture(t, { ui: true });
  await iteration.recordUiAcceptance(root, 'change', join(dir, 'report.md'));
  const result = await iteration.verifyIteration(root, 'change', { runner: async () => {
    await writeFile(join(dir, 'ui-evidence.txt'), 'changed');
    return pass();
  } });
  assert.equal(result.status, 'failed');
  assert.equal((await iteration.statusIteration(root, 'change')).ready, false);
});

test('explicit owner UI deferral preserves automated gates and reports pending acceptance', async t => {
  const { root, dir } = await fixture(t, { ui: true, host: true });
  const report = join(dir, 'deferral.md');
  await writeFile(report, 'Owner explicitly deferred native UI acceptance for this batch. Pending: narrow layout and keyboard focus.');
  assert.equal(typeof iteration.recordUiDeferral, 'function');
  await iteration.recordUiDeferral(root, 'change', report);
  assert.equal((await json(join(dir, 'ui.json'))).decision, 'deferred');
  const seen = [];
  const result = await iteration.verifyIteration(root, 'change', { runner: async gate => { seen.push(gate.command); return pass(); } });
  assert.deepEqual(seen, ['npm test', 'npm run check', 'npm run e2e']);
  assert.equal(result.status, 'passed');
  assert.equal(result.ui, 'deferred');
  const status = await iteration.statusIteration(root, 'change');
  assert.equal(status.ready, true);
  assert.equal(status.ui, 'deferred');
  const failure = await iteration.verifyIteration(root, 'change', { runner: async () => ({ code: 1, stdout: 'failed' }) });
  assert.equal(failure.status, 'failed');
  assert.equal((await iteration.statusIteration(root, 'change')).ready, false);
});

test('UI deferral rejects empty evidence and becomes stale after candidate changes', async t => {
  const { root, dir, approve } = await fixture(t, { ui: true });
  const report = join(dir, 'deferral.md');
  await writeFile(report, ' ');
  assert.equal(typeof iteration.recordUiDeferral, 'function');
  await assert.rejects(iteration.recordUiDeferral(root, 'change', report), /empty/i);
  await writeFile(report, 'Owner explicitly defers native checks; narrow layout remains pending.');
  await iteration.recordUiDeferral(root, 'change', report);
  await writeFile(join(dir, 'ui-evidence.txt'), 'changed authorization');
  await assert.rejects(iteration.verifyIteration(root, 'change', { runner: pass }), /UI acceptance/i);
  await iteration.recordUiDeferral(root, 'change', report);
  await writeFile(join(root, 'source.mjs'), 'changed candidate');
  await approve();
  await assert.rejects(iteration.verifyIteration(root, 'change', { runner: pass }), /UI acceptance/i);
});

test('a missing approval records a failed preflight without executing gates', async t => {
  const { root, dir } = await fixture(t);
  await rm(join(dir, 'review.json'));
  let runs = 0;
  await assert.rejects(iteration.verifyIteration(root, 'change', { runner: async () => { runs++; return pass(); } }));
  assert.equal(runs, 0);
  assert.equal((await json(join(dir, 'verification.json'))).status, 'failed');
});

test('CLI uses its repository rather than cwd and reports non-ready status as a failure', async t => {
  const { root, dir } = await fixture(t);
  await mkdir(join(root, 'scripts'));
  await writeFile(join(root, 'scripts', 'iteration.mjs'), await readFile(new URL('../scripts/iteration.mjs', import.meta.url)));
  const cli = (...args) => spawnSync(process.execPath, [join(root, 'scripts', 'iteration.mjs'), ...args], { cwd: dir, encoding: 'utf8', windowsHide: true });
  const started = cli('start', 'from-cli');
  assert.equal(started.status, 0, started.stderr);
  assert.equal((await json(join(root, '.iteration', 'from-cli', 'brief.json'))).id, 'from-cli');
  const status = cli('status', 'from-cli');
  assert.equal(status.status, 1);
  assert.equal(JSON.parse(status.stdout).ready, false);
  const invalid = cli('start', '../escaped');
  assert.equal(invalid.status, 1);
});

test('packaged tooling inside an ignored folder cannot claim repository verification', async t => {
  const { root } = await fixture(t);
  const nested = join(root, 'ignored', 'package');
  await mkdir(nested, { recursive: true });
  await writeFile(join(nested, 'source.mjs'), 'untracked packaged code');
  await assert.rejects(iteration.fingerprint(nested), /repository root/i);
  await assert.rejects(iteration.startIteration(nested, 'packaged'), /repository root/i);
});

test('staging and committing tested edits, additions and deletions preserves content freshness', async t => {
  const { root, approve } = await fixture(t);
  await writeFile(join(root, 'deleted.mjs'), 'to delete');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'deletion baseline');
  await writeFile(join(root, 'new.mjs'), 'new source');
  await writeFile(join(root, 'source.mjs'), 'edited source');
  await rm(join(root, 'deleted.mjs'));
  await approve();
  await iteration.verifyIteration(root, 'change', { runner: pass });
  git(root, 'add', '.');
  assert.equal((await iteration.statusIteration(root, 'change')).ready, true);
  git(root, 'commit', '-qm', 'tested candidate');
  assert.equal((await iteration.statusIteration(root, 'change')).ready, true);
});

test('review and usage reject external files without changing existing records', async t => {
  const { root, dir } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'trace-external-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'review.md'), 'approved');
  await putJson(join(outside, 'usage.json'), usageEntry);
  const approval = await readFile(join(dir, 'review.json'), 'utf8');
  await assert.rejects(iteration.reviewIteration(root, 'change', 'reviewer', join(outside, 'review.md')), /unsafe|outside/i);
  await assert.rejects(iteration.recordUsage(root, 'change', join(outside, 'usage.json')), /unsafe|outside/i);
  assert.equal(await readFile(join(dir, 'review.json'), 'utf8'), approval);
});

for (const change of ['edit', 'new', 'delete', 'brief', 'approval', 'review-evidence']) {
  test(`${change} invalidates verified candidate`, async t => {
    const { root, dir, brief } = await fixture(t);
    await iteration.verifyIteration(root, 'change', { runner: pass });
    if (change === 'edit') await writeFile(join(root, 'source.mjs'), 'changed');
    if (change === 'new') await writeFile(join(root, 'new.mjs'), 'new');
    if (change === 'delete') await rm(join(root, 'source.mjs'));
    if (change === 'brief') await putJson(join(dir, 'brief.json'), { ...brief, summary: 'Changed' });
    if (change === 'approval') {
      const approval = await json(join(dir, 'review.json'));
      await putJson(join(dir, 'review.json'), { ...approval, reviewer: 'different' });
    }
    if (change === 'review-evidence') await writeFile(join(dir, 'review-evidence.txt'), 'changed');
    const status = await iteration.statusIteration(root, 'change');
    assert.equal(status.ready, false);
    assert.ok(status.reasons.length > 0);
  });
}

test('ignored output does not invalidate content but deleted tracked paths affect fingerprint', async t => {
  const { root } = await fixture(t);
  const initial = await iteration.fingerprint(root);
  await mkdir(join(root, 'ignored'));
  await writeFile(join(root, 'ignored', 'output'), 'ignored');
  assert.equal(await iteration.fingerprint(root), initial);
  await rm(join(root, 'source.mjs'));
  assert.notEqual(await iteration.fingerprint(root), initial);
});

for (const mutation of ['source', 'brief', 'approval']) {
  test(`mid-run ${mutation} mutation fails and retains failure evidence`, async t => {
    const { root, dir, brief } = await fixture(t);
    let ran = false;
    const runner = async () => {
      if (!ran) {
        ran = true;
        if (mutation === 'source') await writeFile(join(root, 'source.mjs'), 'changed');
        if (mutation === 'brief') await putJson(join(dir, 'brief.json'), { ...brief, summary: 'changed' });
        if (mutation === 'approval') await writeFile(join(dir, 'review.json'), '{}');
      }
      return pass();
    };
    const result = await iteration.verifyIteration(root, 'change', { runner });
    assert.equal(result.status, 'failed');
    assert.equal((await json(join(dir, 'verification.json'))).status, 'failed');
    assert.equal((await iteration.statusIteration(root, 'change')).ready, false);
  });
}

for (const failure of ['exit', 'throw', 'missing-gate', 'failed-gate']) {
  test(`${failure} cannot produce a ready receipt`, async t => {
    const { root, dir } = await fixture(t);
    const runner = failure === 'exit' ? async () => ({ code: 2, stdout: '', stderr: 'failure' })
      : failure === 'throw' ? async () => { throw new Error('runner failed'); } : pass;
    const result = await iteration.verifyIteration(root, 'change', { runner });
    if (failure === 'exit' || failure === 'throw') assert.equal(result.status, 'failed');
    else {
      const receipt = await json(join(dir, 'verification.json'));
      if (failure === 'missing-gate') receipt.gates.pop();
      else receipt.gates[0].code = 9;
      await putJson(join(dir, 'verification.json'), receipt);
    }
    assert.equal((await iteration.statusIteration(root, 'change')).ready, false);
  });
}

test('overlapping verification is rejected without overwriting the running operation', async t => {
  const { root } = await fixture(t);
  let release;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  const first = iteration.verifyIteration(root, 'change', { runner: async () => { entered(); await barrier; return pass(); } });
  await waiting;
  try { await assert.rejects(iteration.verifyIteration(root, 'change', { runner: pass }), /locked|running|operation/i); }
  finally { release(); }
  assert.equal((await first).status, 'passed');
});

test('unsafe iteration IDs and symlinked local directories are rejected', async t => {
  const { root } = await fixture(t);
  for (const id of ['../escape', '/absolute', 'a/b', 'a\\b', '.', 'CON', 'a:stream', '']) {
    await assert.rejects(iteration.startIteration(root, id), /id/i);
  }
  const outside = await mkdtemp(join(tmpdir(), 'trace-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, '.iteration', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(iteration.startIteration(root, 'linked'), /symbolic|symlink|unsafe/i);
  await symlink(outside, join(root, 'linked-source'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(outside, 'evidence.md'), 'approval');
  await assert.rejects(iteration.reviewIteration(root, 'change', 'reviewer', join(root, 'linked-source', 'evidence.md')), /symbolic|symlink|unsafe/i);
  await assert.rejects(iteration.fingerprint(root), /symbolic|symlink|ordinary|unsafe/i);
});

const usageEntry = { id: 'build-1', model: 'example-model', source: 'manual usage receipt', inputTokens: 100, cachedInputTokens: 25, outputTokens: 10, coordinationCalls: null, reworkCount: 0, phase: 'implementation' };

test('usage retains unknown metrics, separates fresh/cached tokens and rejects duplicates atomically', async t => {
  const { root, dir } = await fixture(t);
  const entryPath = join(dir, 'entry.json');
  await putJson(entryPath, usageEntry);
  const result = await iteration.recordUsage(root, 'change', entryPath);
  assert.deepEqual(result.models, [{ model: 'example-model', inputTokens: 100, freshInputTokens: 75, cachedInputTokens: 25, outputTokens: 10, coordinationCalls: null, reworkCount: 0 }]);
  const before = await readFile(join(dir, 'usage.json'), 'utf8');
  await assert.rejects(iteration.recordUsage(root, 'change', entryPath), /duplicate/i);
  assert.equal(await readFile(join(dir, 'usage.json'), 'utf8'), before);
  await putJson(entryPath, { ...usageEntry, id: 'build-2', coordinationCalls: 2, reworkCount: null });
  const combined = await iteration.recordUsage(root, 'change', entryPath);
  assert.equal(combined.models[0].inputTokens, 200);
  assert.equal(combined.models[0].freshInputTokens, 150);
  assert.equal(combined.models[0].coordinationCalls, null);
  assert.equal(combined.models[0].reworkCount, null);
});

test('malformed usage preserves prior records', async t => {
  const { root, dir } = await fixture(t);
  const entryPath = join(dir, 'entry.json');
  await putJson(entryPath, usageEntry);
  await iteration.recordUsage(root, 'change', entryPath);
  const before = await readFile(join(dir, 'usage.json'), 'utf8');
  for (const bad of [{ inputTokens: -1 }, { cachedInputTokens: 101 }, { outputTokens: 1.5 }, { outputTokens: Number.MAX_SAFE_INTEGER + 1 }, { source: '' }, { model: '' }, { phase: 'other' }, { coordinationCalls: -1 }, { reworkCount: 'unknown' }]) {
    await putJson(entryPath, { ...usageEntry, id: 'bad', ...bad });
    await assert.rejects(iteration.recordUsage(root, 'change', entryPath), /usage|tokens|source|model|phase|coordination|rework/i);
    assert.equal(await readFile(join(dir, 'usage.json'), 'utf8'), before);
  }
});
