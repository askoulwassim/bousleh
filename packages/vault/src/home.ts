import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** The database file inside your data home. */
export const VAULT_DB = 'vault.db';

/** Where your data lives: `BOUSLEH_HOME` if set, else `~/.bousleh`. */
export function resolveHome(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.BOUSLEH_HOME?.trim();
  return resolve(fromEnv ? fromEnv : join(homedir(), '.bousleh'));
}

export interface DataStatus {
  exists: boolean;
  db: boolean;
}

/** Read-only look at a data home: does the folder exist, does it hold the database. */
export function dataStatus(home: string): DataStatus {
  return { exists: existsSync(home), db: existsSync(join(home, VAULT_DB)) };
}
