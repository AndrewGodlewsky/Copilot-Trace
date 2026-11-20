import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createTrace } from '../com.github.copilot/extensions/trace/trace.mjs';
import { toolOutcomes, actionStages } from '../com.github.copilot/extensions/trace/web/presentation.mjs';

import * as examples from '../com.github.copilot/extensions/trace/web/examples.mjs';
const path = new URL('../com.github.copilot/extensions/trace/web/examples.json', import.meta.url);
const read = () => readFile(path, 'utf8');
const parse = text => { assert.equal(typeof examples.parseExampleLibrary, 'function'); return examples.parseExampleLibrary(text); };

test('three offline synthetic lessons preserve exact source evidence and match the live projector contract', async () => {
  assert.equal(typeof examples.parseExampleLibrary, 'function');
  const text = await read(), library = parse(text), raw = JSON.parse(text);
  assert.deepEqual(library.map(example => example.id), ['exploration', 'bug-fix', 'recovery']);
  for (const example of library) {
    assert.equal(example.kind, 'synthetic'); assert.match(example.provenance, /authored.*Trace/i);
    assert.ok(example.lesson.length); assert.ok(example.annotations.length);
    assert.equal(example.snapshot.liveReceipt, null);
    assert.ok(example.snapshot.entries.every(entry => !entry.observation), 'Synthetic examples never invent host observation receipts.');
    const trace = createTrace({ on() { return () => {}; }, getEvents: async () => raw.examples.find(item => item.id === example.id).events });
    await trace.ready;
    const actual = trace.snapshot().entries;
    example.snapshot.entries.forEach((entry, index) => {
      for (const key of ['id', 'type', 'agentId', 'toolCallId', 'toolName', 'timestamp', 'success', 'preview', 'evidence']) assert.equal(entry[key], actual[index][key], key);
    });
    trace.close();
    assert.throws(() => example.snapshot.entries.push({}), TypeError);
  }
  assert.match(library[0].snapshot.entries.map(entry => entry.evidence).join(''), /café 日本語 🧭/);
  const bug = library[1].snapshot.entries, recovery = library[2].snapshot.entries;
  assert.ok([...toolOutcomes(bug).values()].some(outcome => outcome.kind === 'process'));
  const failed = recovery.find(entry => JSON.parse(entry.evidence).data.result?.contents?.[0]?.exitCode === 2);
  assert.equal(failed.success, true, 'Protocol success and nonzero process exit remain distinct.');
  assert.equal(toolOutcomes(recovery).get(failed.id).kind, 'process');
  assert.ok([...actionStages(bug).values()].some(stage => stage.permission === 'Recorded permission: approved'));
});

test('example validation rejects malformed, oversized and ambiguous content instead of manufacturing a lesson', async () => {
  assert.equal(typeof examples.parseExampleLibrary, 'function');
  const source = JSON.parse(await read());
  for (const text of ['{', 'null', '[]', ' '.repeat(262145)]) assert.throws(() => parse(text), /example/i);
  for (const mutate of [
    data => { data.schemaVersion = 2; }, data => { data.extra = 'unsupported'; }, data => { data.examples = []; },
    data => { data.examples.push(...structuredClone(data.examples)); }, data => { data.examples[1].id = data.examples[0].id; },
    data => { data.examples[0].kind = 'recorded'; }, data => { data.examples[0].lesson = 'x'.repeat(1201); },
    data => { data.examples[0].events[1].id = data.examples[0].events[0].id; },
    data => { data.examples[0].events[1].type = 'assistant.reasoning'; },
    data => { data.examples[0].events[1].data.toolCallId = 'foreign-call'; },
    data => { data.examples[0].events[2].agentId = 'synthetic:foreign'; },
    data => { data.examples[0].events[2].data.toolCallId = 'synthetic:exploration:missing'; },
    data => { data.examples[0].events[1].data.arguments.path = '../private'; },
    data => { data.examples[0].events[1].data.arguments.url = 'https://example.test'; },
    data => { data.examples[0].events[0].data.content = 'x'.repeat(4001); },
    data => { data.examples[0].events[0].timestamp = 'unknown'; },
    data => { data.examples[0].events[0].observation = { source: 'live', receipt: 1 }; },
    data => { data.examples[0].events.push(...Array.from({ length: 30 }, () => data.examples[0].events[0])); },
    data => { data.examples[0].events[2].data.success = 'true'; },
    data => { data.examples[0].events[2].data.result.content = {}; },
    data => { data.examples[2].events[2].data.result.contents[0].exitCode = '2'; },
    data => { data.examples[2].events[2].data.result.contents[0].type = 'text'; },
    data => { data.examples[1].events[4].data.result.kind = 'denied'; },
    data => { data.examples[0].annotations[0].alternative = 'x'.repeat(1201); },
    data => { data.examples[0].annotations[0].eventId = 'synthetic:absent'; },
    data => { data.examples[0].annotations.push(data.examples[0].annotations[0]); },
  ]) {
    const data = structuredClone(source); mutate(data);
    assert.throws(() => parse(JSON.stringify(data)), /example/i, mutate.toString());
  }
  const unicode = JSON.stringify(source).replace('Locally authored', '日'.repeat(90000));
  assert.ok(unicode.length < 262144); assert.throws(() => parse(unicode), /example/i, 'UTF-8 bytes, not just UTF-16 units, are bounded.');
});

test('literal Unicode and markup remain text while annotations stay outside synthetic facts', async () => {
  assert.equal(typeof examples.parseExampleLibrary, 'function');
  const data = JSON.parse(await read()), literal = '<script>日本語 🧭 café</script>\r\n  untouched';
  data.examples[0].events[0].data.content = literal;
  data.examples[0].annotations[0].note = literal;
  const example = parse(JSON.stringify(data))[0];
  assert.equal(JSON.parse(example.snapshot.entries[0].evidence).data.content, literal);
  assert.equal(example.annotations[0].note, literal);
  assert.ok(example.snapshot.entries.every(entry => !Object.hasOwn(JSON.parse(entry.evidence), 'annotations')));
});
