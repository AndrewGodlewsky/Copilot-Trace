import { mkdir, lstat, realpath, open, rename, unlink } from 'node:fs/promises';
import { join, resolve, dirname, parse } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { validId, efforts, problem } from './investigation-model.mjs';

const defaults = () => ({ schemaVersion: 1, revision: 0, modelId: null, providerId: null, effort: null });
export function createInvestigationStore(directory = join(process.env.COPILOT_HOME || join(homedir(), '.copilot'), 'plugin-data', 'trace')) {
  directory = resolve(directory);
  const file = join(directory, 'investigation.json'), lock = join(directory, 'investigation.lock');
  let directoryIdentity;
  async function safe() {
    const chain = []; let current = directory;
    while (current !== parse(current).root) { chain.unshift(current); current = dirname(current); }
    for (const path of chain) {
      try { const stat = await lstat(path); if (!stat.isDirectory() || stat.isSymbolicLink()) throw problem('Trace settings path is unsafe.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; await mkdir(path, { mode: 0o700 }); }
    }
    if (resolve(await realpath(directory)).toLowerCase() !== directory.toLowerCase()) throw problem('Trace settings path changed.');
    const identity = await lstat(directory);
    if (directoryIdentity && (identity.dev !== directoryIdentity.dev || identity.ino !== directoryIdentity.ino)) throw problem('Trace settings directory was replaced.');
    directoryIdentity ??= identity;
    for (const path of [file, lock]) try { const stat = await lstat(path); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw problem('Trace settings file is unsafe.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  function validate(value) {
    if (!value || Object.keys(value).some(key => !['schemaVersion', 'revision', 'modelId', 'providerId', 'effort', 'receipts'].includes(key)) || value.schemaVersion !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !((value.modelId === null && value.providerId === null && value.effort === null) || (validId(value.modelId) && validId(value.providerId) && efforts.includes(value.effort))) || !Array.isArray(value.receipts) || value.receipts.length > 100) throw problem('Trace settings are invalid. Existing settings were preserved.');
    for (const item of value.receipts) validateReceipt(item);
    return value;
  }
  function validateReceipt(item) {
    if (!item || Object.keys(item).filter(key => !['recovery', 'modelId', 'providerId', 'effort'].includes(key)).sort().join(',') !== 'cleanup,inputTokens,operation,outcome,outputTokens,usage' || !validId(item.operation) ||
      !['completed', 'failed', 'cancelled'].includes(item.outcome) || !['released', 'uncertain', 'retained'].includes(item.cleanup) || !['known', 'unknown', 'partial'].includes(item.usage) ||
      [item.inputTokens, item.outputTokens].some(value => value !== null && (!Number.isSafeInteger(value) || value < 0)) ||
      (item.recovery != null && (typeof item.recovery !== 'string' || !/^trace-investigation-[a-f0-9-]{36}-[A-Za-z0-9]+$/.test(item.recovery))) ||
      ['modelId', 'providerId'].some(key => item[key] !== undefined && !validId(item[key])) || (item.effort !== undefined && !efforts.includes(item.effort))) throw problem('Trace usage receipt is invalid.');
  }
  async function load() {
    await safe();
    try {
      const before = await lstat(file), handle = await open(file, 'r');
      try {
        const opened = await handle.stat();
        if (opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.size > 32768) throw problem('Trace settings changed or exceed the size limit.');
        const buffer = Buffer.alloc(32769); let size = 0;
        while (size < buffer.length) { const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null); if (!bytesRead) break; size += bytesRead; }
        if (size > 32768) throw problem('Trace settings exceed the size limit.');
        await safe(); const after = await lstat(file);
        if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== size || after.mtimeMs !== before.mtimeMs) throw problem('Trace settings changed while reading.');
        return validate(JSON.parse(buffer.subarray(0, size).toString('utf8')));
      }
      finally { await handle.close(); }
    } catch (error) { if (error.code === 'ENOENT') return { ...defaults(), receipts: [] }; throw error; }
  }
  const preferences = ({ receipts, ...value }) => value;
  async function mutate(change) {
    await safe(); let handle;
    try { handle = await open(lock, 'wx', 0o600); } catch { throw problem('Trace settings are being saved elsewhere. Refresh Settings before retrying.'); }
    const temporary = join(directory, `investigation-${randomUUID()}.tmp`);
    const lockIdentity = await handle.stat();
    try {
      const original = await load(), originalText = JSON.stringify(original), data = change(original);
      while (data.receipts.length > 100 || Buffer.byteLength(JSON.stringify(data)) > 32768) {
        const index = data.receipts.findIndex(item => item.cleanup === 'released');
        if (index < 0) throw problem('Trace recovery ledger is full.'); data.receipts.splice(index, 1);
      }
      validate(data);
      const output = await open(temporary, 'wx', 0o600);
      try { await output.writeFile(JSON.stringify(data)); await output.sync(); } finally { await output.close(); }
      await safe(); if (JSON.stringify(await load()) !== originalText) throw problem('Trace settings changed while saving.');
      await rename(temporary, file); return preferences(data);
    } finally {
      await handle.close(); await unlink(temporary).catch(() => {});
      const currentLock = await lstat(lock);
      if (currentLock.dev === lockIdentity.dev && currentLock.ino === lockIdentity.ino && !currentLock.isSymbolicLink()) await unlink(lock);
    }
  }
  return {
    read: async () => preferences(await load()),
    recoveryStatus: async () => ({ unresolved: (await load()).receipts.filter(item => item.cleanup === 'uncertain').length }),
    begin: receipt => { validateReceipt(receipt); return mutate(data => {
      if (data.receipts.some(item => item.cleanup === 'uncertain')) throw problem('A previous helper has unresolved cleanup. Investigation is blocked until release is confirmed.');
      return { ...data, receipts: [...data.receipts, receipt] };
    }); },
    save: (selection, revision) => mutate(data => {
      if (data.revision !== revision) throw problem('Settings changed in another panel. Refresh before saving.');
      if (Object.keys(selection).sort().join(',') !== 'effort,modelId,providerId') throw problem('Invalid settings fields.');
      return { ...data, ...selection, revision: data.revision + 1 };
    }),
    receipt: receipt => { validateReceipt(receipt); return mutate(data => {
      const rows = [...data.receipts.filter(item => item.operation !== receipt.operation), receipt];
      while (rows.length > 100) { const index = rows.findIndex(item => item.cleanup === 'released'); if (index < 0) throw problem('Trace recovery ledger is full.'); rows.splice(index, 1); }
      return { ...data, receipts: rows };
    }); },
  };
}
