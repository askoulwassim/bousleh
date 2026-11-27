import { chmodSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Your data is readable only by your account: every folder Bousleh creates in your data home or
 * its backups is 0700, every file it writes 0600. SQLite gives `vault.db-wal` and `-shm` the
 * mode of `vault.db`, so creating the database 0600 covers them too.
 */
export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

/** Create `dir` and any missing parents as 0700. Leaves an existing folder as it is. */
export function makePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
}

/**
 * If `dir` gives any access to group or others, set it to 0700 and say so in one line on stderr
 * (stdout belongs to the MCP protocol). Returns true when it tightened.
 */
export function tightenDir(dir: string, log: (line: string) => void = (line) => process.stderr.write(`${line}\n`)): boolean {
  const mode = statSync(dir).mode & 0o777;
  if ((mode & 0o077) === 0) return false;
  chmodSync(dir, PRIVATE_DIR_MODE);
  log(`bousleh: ${dir} was readable by other accounts (mode ${mode.toString(8)}); set it to 700`);
  return true;
}

/** Set every folder under `root` (itself included) to 0700 and every file to 0600. */
export function makePrivateTree(root: string): void {
  chmodSync(root, PRIVATE_DIR_MODE);
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isDirectory()) chmodSync(path, PRIVATE_DIR_MODE);
    else if (entry.isFile()) chmodSync(path, PRIVATE_FILE_MODE);
  }
}
