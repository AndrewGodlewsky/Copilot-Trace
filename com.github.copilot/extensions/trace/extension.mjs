import { createCanvas, joinSession } from '@github/copilot-sdk/extension';
import { traceCanvas } from './canvas.mjs';

let session;
const extension = traceCanvas({ createCanvas, getSession: () => session });
session = await joinSession({ canvases: [extension.canvas] });
process.stderr.write('[Trace] Canvas registered.\n');

let closing;
function close() {
  return closing ??= extension.close().finally(() => session.disconnect());
}
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => void close().catch(() => {
    process.stderr.write('[Trace] Shutdown failed.\n');
    process.exitCode = 1;
  }));
}
