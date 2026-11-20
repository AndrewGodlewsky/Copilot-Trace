import { cp, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
function check(cwd) {
  const result = spawnSync(process.execPath, ['scripts/check.mjs'], { cwd, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Package validation failed.');
}
check(root);
const { version } = JSON.parse(await readFile(join(root, 'plugin.json'), 'utf8'));
await mkdir(join(root, 'dist'), { recursive: true });
const destination = await mkdtemp(join(root, 'dist', `trace-${version}-`));
for (const name of ['plugin.json', '.github/plugin', 'skills', 'assets', 'com.github.copilot', 'release-notes.json', 'README.md', 'AGENTS.md', 'CLAUDE.md', 'docs', 'package.json', 'package-lock.json', 'scripts', 'test', '.gitignore']) {
  await cp(join(root, name), join(destination, name), { recursive: true, errorOnExist: true, force: false });
}
check(destination);
console.log(`Validated plugin directory: ${destination}`);
