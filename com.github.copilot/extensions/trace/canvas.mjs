import { startServer as serve } from './server.mjs';

export function traceCanvas({ createCanvas, getSession, startServer = serve }) {
  const instances = new Map();
  let closed = false;
  function assertSession(ctx) {
    if (!getSession()?.sessionId || ctx.sessionId !== getSession().sessionId) throw new Error('Session mismatch.');
  }
  function closeInstance(id, entry) {
    entry.closed = true;
    return entry.closing ??= (async () => {
      const server = await entry.ready.catch(() => null);
      try { await server?.close(); }
      finally { if (instances.get(id) === entry) instances.delete(id); }
    })();
  }
  const canvas = createCanvas({
    id: 'trace',
    displayName: 'Copilot Trace',
    description: 'Open the Copilot Trace starter panel.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async open(ctx) {
      assertSession(ctx);
      if (closed) throw new Error('Trace is closed.');
      let entry = instances.get(ctx.instanceId);
      if (!entry) {
        entry = { ready: startServer(), closed: false };
        instances.set(ctx.instanceId, entry);
      }
      try {
        const server = await entry.ready;
        if (closed || entry.closed) throw new Error('Canvas was closed while opening.');
        return { url: server.url, title: 'Copilot Trace' };
      } catch (error) {
        if (!entry.closed && instances.get(ctx.instanceId) === entry) instances.delete(ctx.instanceId);
        throw error;
      }
    },
    async onClose(ctx) {
      assertSession(ctx);
      const entry = instances.get(ctx.instanceId);
      if (entry) await closeInstance(ctx.instanceId, entry);
    },
  });
  return {
    canvas,
    async close() {
      closed = true;
      await Promise.all([...instances].map(([id, entry]) => closeInstance(id, entry)));
    },
  };
}
