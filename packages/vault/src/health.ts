import { BOUSLEH_VERSION, vaultHealth } from '@bousleh/contracts';
import { backupDir, listSnapshots } from './backup.js';
import { defineHandler } from './handler.js';
import { dataStatus } from './home.js';

export const vaultHealthHandler = defineHandler(vaultHealth, (_input, h) => ({
  ok: true,
  version: BOUSLEH_VERSION,
  home: h.home,
  data: dataStatus(h.home),
  ops: h.ops.length,
  backups: (() => {
    const dir = backupDir(h.home);
    const snapshots = listSnapshots(dir);
    return { dir, latest: snapshots.at(-1) ?? null, count: snapshots.length };
  })(),
  now: h.ctx.now().toISOString(),
}));
