import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { vaultBackup } from '@bousleh/contracts';
import type Database from 'better-sqlite3';
import { defineHandler } from './handler.js';
import { VAULT_DB } from './home.js';
import { STAGING_DIR } from './store/files.js';

/*
 * Backups on the same disk: dated snapshot folders next to your data (~/.bousleh-backups). Not
 * disaster recovery; protection against a bad op, a bug or an accidental delete. A snapshot is
 * written to `<stamp>.partial` and renamed when complete, so only whole snapshots count.
 * The database goes first (SQLite's online backup, consistent even while another process writes),
 * then the files: version files never change once written, so every file the database copy points
 * at is already on disk when the copy runs.
 */

const PARTIAL = '.partial';
/** Leftover partial snapshots older than this are removed. */
const STALE_PARTIAL_MS = 6 * 60 * 60 * 1000;

/** Where snapshots go: BOUSLEH_BACKUPS if set, else `<home>-backups` beside your data. */
export function backupDir(home: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.BOUSLEH_BACKUPS?.trim();
  return fromEnv ? fromEnv : join(dirname(home), `${basename(home)}-backups`);
}

/** Complete snapshots, oldest first (folder names sort by time). */
export function listSnapshots(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.endsWith(PARTIAL))
    .map((entry) => entry.name)
    .sort();
}

/** Folder name for a snapshot taken at `at`: 2026-10-25T15-30-00Z. */
export function snapshotName(at: Date): string {
  return at
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replaceAll(':', '-');
}

/** When the newest snapshot was taken, from its name, or undefined. */
export function latestSnapshotTime(dir: string): Date | undefined {
  const latest = listSnapshots(dir).at(-1);
  if (!latest) return undefined;
  const iso = latest.replace(/T(\d{2})-(\d{2})-(\d{2})Z(-\d+)?$/, 'T$1:$2:$3Z');
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

const SKIP = new Set([VAULT_DB, `${VAULT_DB}-wal`, `${VAULT_DB}-shm`, `${VAULT_DB}-journal`, STAGING_DIR]);

function countFiles(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    files += 1;
    bytes += statSync(join(entry.parentPath, entry.name)).size;
  }
  return { files, bytes };
}

/** Take one snapshot of `home` into `dir`, then keep the newest `keep`. */
export async function takeSnapshot(
  db: Database.Database,
  home: string,
  dir: string,
  at: Date,
  keep: number,
): Promise<{ path: string; files: number; bytes: number; pruned: string[] }> {
  mkdirSync(dir, { recursive: true });
  let name = snapshotName(at);
  for (let n = 2; existsSync(join(dir, name)); n++) name = `${snapshotName(at)}-${n}`;
  const partial = join(dir, `${name}${PARTIAL}`);
  rmSync(partial, { recursive: true, force: true });
  mkdirSync(partial, { recursive: true });
  try {
    await db.backup(join(partial, VAULT_DB));
    cpSync(home, partial, {
      recursive: true,
      filter: (source) => {
        const rel = relative(home, source);
        if (rel === '') return true;
        return !SKIP.has(rel.split(sep)[0] ?? '');
      },
    });
  } catch (e) {
    rmSync(partial, { recursive: true, force: true });
    throw e;
  }
  const path = join(dir, name);
  renameSync(partial, path);

  const pruned: string[] = [];
  const snapshots = listSnapshots(dir);
  for (const old of snapshots.slice(0, Math.max(0, snapshots.length - keep))) {
    rmSync(join(dir, old), { recursive: true, force: true });
    pruned.push(old);
  }
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(PARTIAL)) continue;
    const full = join(dir, entry);
    if (at.getTime() - statSync(full).mtimeMs > STALE_PARTIAL_MS) rmSync(full, { recursive: true, force: true });
  }
  return { path, ...countFiles(path), pruned };
}

export const vaultBackupHandler = defineHandler(vaultBackup, (input, h) =>
  takeSnapshot(h.store.db, h.home, backupDir(h.home), h.ctx.now(), input.keep),
);
