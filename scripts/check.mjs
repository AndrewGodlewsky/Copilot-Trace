import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const json = async file => JSON.parse(await readFile(join(root, file), 'utf8'));
const plugin = await json('plugin.json');
assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
assert.equal(plugin.name, 'trace');
assert.equal(plugin.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
assert.equal(plugin.repository, 'https://github.com/AndrewGodlewsky/Copilot-Trace');
const pkg = await json('package.json');
const lock = await json('package-lock.json');
const catalog = await json('.github/plugin/marketplace.json');
const extension = await json('com.github.copilot/extensions/trace/package.json');
const notes = await json('release-notes.json');
assert.equal(pkg.name, 'trace');
assert.equal(lock.name, 'trace');
assert.equal(lock.packages[''].name, 'trace');
assert.equal(catalog.name, 'trace');
assert.equal(catalog.plugins.length, 1);
assert.equal(catalog.plugins[0].name, plugin.name);
assert.equal(catalog.plugins[0].source, './');
for (const version of [pkg.version, lock.version, lock.packages[''].version, catalog.plugins[0].version, extension.version, notes[0].version]) assert.equal(version, plugin.version);
for (const metadata of [pkg, extension]) assert.equal(Object.keys(metadata.dependencies ?? {}).length, 0, 'The host supplies the runtime SDK.');
const seenVersions = new Set();
let previousVersion;
for (const note of notes) {
  assert.match(note.version, /^\d+\.\d+\.\d+$/);
  assert.ok(!seenVersions.has(note.version), 'Release versions must be unique.');
  seenVersions.add(note.version);
  const parts = note.version.split('.').map(Number);
  if (previousVersion) {
    const changed = parts.findIndex((part, i) => part !== previousVersion[i]);
    assert.ok(changed >= 0 && parts[changed] < previousVersion[changed], 'Release notes must be newest first.');
  }
  previousVersion = parts;
  assert.ok(typeof note.summary === 'string' && note.summary.trim().length && note.summary.length <= 400, 'Every release needs a short user-facing explanation.');
}
assert.ok((await readFile(join(root, 'README.md'), 'utf8')).includes(`Current version: **${plugin.version}**`));
const logo = await readFile(join(root, plugin.extensions['com.github.copilot'].logo), 'utf8');
assert.match(logo, /<svg\b/);
assert.equal(plugin.extensions['com.github.copilot'].logo, 'assets/trace.svg');
assert.ok(`data:image/svg+xml;base64,${Buffer.from(logo).toString('base64')}`.length < 350000, 'The native tab selector requires a compact image data URL.');
assert.doesNotMatch(logo, /<(script|foreignObject)\b|\b(?:href|onload)=|<linearGradient|<radialGradient/i, 'Keep the metadata logo self-contained and flat.');
const skill = await readFile(join(root, 'skills/trace/SKILL.md'), 'utf8');
assert.match(skill, /^---\r?\nname: trace\r?\n/);
assert.match(skill, /open_canvas/);
for (const asset of ['index.html', 'style.css', 'app.mjs', 'presentation.mjs', 'host-output.mjs', 'glossary.mjs', 'footer.mjs', 'diagnostics.mjs', 'polling.mjs', 'follow.mjs', 'capabilities.mjs']) await readFile(join(root, 'com.github.copilot/extensions/trace/web', asset));
async function syntax(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) await syntax(path);
    else if (entry.name.endsWith('.mjs')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8', windowsHide: true });
      if (result.error) throw result.error;
      assert.equal(result.status, 0, result.stderr);
    }
  }
}
for (const folder of ['com.github.copilot', 'scripts', 'test']) await syntax(join(root, folder));
console.log(`Trace ${plugin.version}: syntax, manifests, assets, skill and release metadata passed.`);
