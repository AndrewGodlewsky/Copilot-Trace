import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = process.env.COPILOT_CLI_PATH || 'copilot';
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw new Error(`Could not launch ${command}. Set COPILOT_CLI_PATH to your installed executable if Copilot is not on PATH.`, { cause: result.error });
  if (result.status !== 0) throw new Error(`Command failed (exit ${result.status}); installation stopped.`);
}
run(process.execPath, ['scripts/check.mjs']);
run(cli, ['plugin', 'marketplace', 'add', root]);
run(cli, ['plugin', 'install', 'trace@trace']);
run(cli, ['plugin', 'list', '--json']);
console.log('Start a new Copilot desktop session and use /trace. Keep this checkout: the local marketplace loads it live.');
