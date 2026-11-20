import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../com.github.copilot/extensions/trace/server.mjs';

test('investigation writes require exact origin, capability, marker, JSON bounds and allowlisted schemas', async t => {
  let previews = 0, closes = 0;
  const server = await startServer({ getEvents: async () => [], on: () => () => {} }, { investigationFactory: () => ({
    preview: async eventId => { previews++; return { eventId }; }, status: () => ({ state: 'idle' }), close: async () => { closes++; },
  }) });
  t.after(() => server.close()); const origin = new URL(server.url).origin;
  const post = (body, headers = {}) => fetch(server.url + 'investigation', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Trace-Request': 'investigation', ...headers }, body });
  assert.equal((await post(JSON.stringify({ action: 'preview', eventId: 'failure' }))).status, 200);
  assert.equal(previews, 1);
  for (const headers of [{ Origin: '' }, { Origin: 'http://evil.test' }, { 'X-Trace-Request': '' }, { 'Content-Type': 'text/plain' }, { 'Sec-Fetch-Site': 'cross-site' }]) assert.ok([403, 415].includes((await post('{"action":"preview","eventId":"failure"}', headers)).status));
  assert.equal((await post(JSON.stringify({ action: 'preview', eventId: 'failure', evidence: 'injected' }))).status, 400);
  assert.equal((await post('{"action":"preview","eventId":3}')).status, 400);
  assert.equal((await post('{"action":"__proto__"}')).status, 400);
  assert.equal((await post('x'.repeat(4097))).status, 413);
  assert.equal((await fetch(origin + '/wrong/investigation', { method: 'POST', body: '{}' })).status, 404);
  assert.equal(previews, 1);
  await server.close(); assert.equal(closes, 1);
});
