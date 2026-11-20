import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as presentation from '../com.github.copilot/extensions/trace/web/presentation.mjs';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';

async function observed(data, extra = {}) {
  const trace = createTrace({ on() { return () => {}; }, getEvents: async () => [{
    id: 'skill', type: 'skill.invoked', timestamp: '2026-11-20T12:00:00Z',
    data: { name: 'fixture', path: '', ...data }, ...extra,
  }] });
  await trace.ready;
  const entry = trace.snapshot().entries[0];
  trace.close();
  return entry;
}

test('skill instructions expose exact literal body and separate recorded arguments', async () => {
  assert.equal(typeof presentation.skillInstructions, 'function');
  const content = '# Café 🧪\r\n\r\n```sh\n  <script>literal only</script>\n```\nhttps://example.invalid/\t';
  const result = presentation.skillInstructions(await observed({ content, arguments: '  exact 🧪 inputs\n', trigger: 'user-invoked' }));
  assert.equal(result.name, 'fixture');
  assert.equal(result.trigger, 'user-invoked');
  assert.equal(result.status, 'complete');
  assert.equal(result.content, content);
  assert.equal(result.preview, content);
  assert.equal(result.previewTruncated, false);
  assert.equal(result.arguments, '  exact 🧪 inputs\n');
  for (const entry of [{}, { type: 'tool.execution_start' }, { type: 'skill.future' }]) {
    assert.equal(presentation.skillInstructions(entry), null);
  }
});

test('skill triggers distinguish user action, agent request, context loading and unknown attribution', async () => {
  for (const [trigger, meaning] of [
    ['user-invoked', /explicit user action/i], ['agent-invoked', /agent requested/i],
    ['context-load', /part of another context/i], ['future <script>', /unknown.*unrecognized/i],
    ['__proto__', /unknown.*unrecognized/i], [undefined, /unknown.*not recorded/i], ['', /unknown.*empty/i],
  ]) {
    const entry = await observed({ content: 'Instructions', trigger });
    const result = presentation.skillInstructions(entry);
    assert.equal(result.trigger, trigger ?? null);
    assert.match(result.triggerExplanation, meaning);
    const lesson = presentation.explainStep(entry);
    assert.match(lesson.unknown, /referenced.*(?:script|command).*ran/i);
    assert.match(lesson.unknown, /instructions were followed/i);
    assert.match(lesson.unknown, /selection reason.*unknown/i);
  }
});

test('empty skill bodies and arguments remain different from absent or nontext fields', async () => {
  const empty = presentation.skillInstructions(await observed({ content: '', arguments: '' }));
  assert.equal(empty.status, 'empty');
  assert.equal(empty.content, '');
  assert.equal(empty.arguments, '');
  assert.match(empty.note, /recorded.*empty/i);
  for (const content of [undefined, null, 0, [], {}, false]) {
    const result = presentation.skillInstructions(await observed({ content, arguments: content }));
    assert.equal(result.status, 'unavailable');
    assert.equal(result.content, null);
    assert.equal(result.preview, null);
    assert.equal(result.arguments, null);
    assert.match(result.note, /not record.*text instruction body/i);
  }
});

test('long skill previews stop before a surrogate pair while preserving the full retained body', async () => {
  const content = 'x'.repeat(599) + '🧪\n' + '日本語 '.repeat(1000);
  const name = 'n'.repeat(178) + '🧪long name';
  const trigger = 't'.repeat(78) + '🧪future trigger';
  const result = presentation.skillInstructions(await observed({ content, name, trigger }));
  assert.equal(result.content, content);
  assert.equal(result.name, name);
  assert.equal(result.trigger, trigger);
  assert.equal(result.preview, 'x'.repeat(599));
  assert.equal(result.previewTruncated, true);
  assert.match(result.note, /preview shortened/i);
});

test('clipped, malformed and identity-mismatched skill evidence never supplies a reconstructed body', async () => {
  const entry = await observed({ content: 'Historical instructions', trigger: 'agent-invoked' });
  const raw = JSON.parse(entry.evidence);
  const changed = (field, value) => ({ evidence: JSON.stringify({ ...raw, [field]: value }) });
  for (const extra of [
    { truncated: true }, { evidence: '{' }, { evidence: 'null' }, { evidence: '[]' },
    { evidence: ' '.repeat(12001) }, { id: '' }, { id: 'x'.repeat(257) }, { agentId: null },
    changed('id', 'different'), changed('type', 'tool.execution_start'), changed('agentId', 'other'),
    changed('timestamp', 'different'), changed('data', []),
    { displayName: 'different' }, { trigger: 'user-invoked' },
    changed('data', { ...raw.data, name: 'different' }), changed('data', { ...raw.data, trigger: 'context-load' }),
  ]) {
    const result = presentation.skillInstructions({ ...entry, ...extra });
    assert.equal(result.status, 'unavailable', JSON.stringify(extra));
    assert.equal(result.content, null);
    assert.equal(result.arguments, null);
    assert.match(result.note, /shortened|complete matching/i);
    assert.match(presentation.explainStep({ ...entry, ...extra }).means, /trigger.*unavailable|unknown/i);
  }
  for (const data of [
    { padding: 'x'.repeat(13000), content: 'Body after clipped field' },
    { content: '🧪'.repeat(6500) },
    { content: 'Body before clipped field', padding: 'x'.repeat(13000) },
  ]) {
    const clipped = await observed(data);
    assert.equal(clipped.truncated, true);
    const result = presentation.skillInstructions(clipped);
    assert.equal(result.content, null);
    assert.match(result.note, /shortened.*cannot recover/i);
  }
});

test('recorded skill instructions stay historical after the referenced disposable file changes or disappears', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'trace-skill-'));
  const path = join(directory, 'SKILL.md');
  try {
    await writeFile(path, 'Original instructions 🧪\n');
    const entry = await observed({ path, content: await readFile(path, 'utf8') });
    await writeFile(path, 'A different current version');
    assert.equal(presentation.skillInstructions(entry).content, 'Original instructions 🧪\n');
    const absent = await observed({ path });
    assert.equal(presentation.skillInstructions(absent).content, null);
    await rm(path);
    assert.equal(presentation.skillInstructions(entry).content, 'Original instructions 🧪\n');
    assert.equal(presentation.skillInstructions(absent).content, null);
  } finally { await rm(path, { force: true }); await rmdir(directory); }
});
