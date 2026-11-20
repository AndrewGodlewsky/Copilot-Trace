import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDiagnostics } from '../com.github.copilot/extensions/trace/web/diagnostics.mjs';

test('diagnostics retain only known codes and bounded numeric support fields', () => {
  const log = createDiagnostics();
  log.record('history_failed', { status: 500, count: 3, message: 'secret prompt', url: 'http://secret/token', path: 'private', durationMs: Infinity });
  log.record('secret prompt', { status: 200 });
  log.record('refresh_failed', { status: 'secret', count: -1 });
  const result = log.snapshot();
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries[0].data, { status: 500, count: 3 });
  assert.deepEqual(result.entries[1].data, {});
  assert.doesNotMatch(JSON.stringify(result), /secret|private|Infinity/);
  result.entries[0].data.status = 100;
  assert.equal(log.snapshot().entries[0].data.status, 500);
});

test('diagnostics bound memory and count entries omitted from exports', () => {
  const log = createDiagnostics();
  for (let i = 0; i < 215; i++) log.record('refresh_ok', { count: i });
  const result = log.snapshot();
  assert.equal(result.limit, 200);
  assert.equal(result.dropped, 15);
  assert.equal(result.entries.length, 200);
  assert.equal(result.entries[0].data.count, 15);
});
