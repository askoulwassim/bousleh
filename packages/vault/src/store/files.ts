import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';

/*
 * File writes inside your data home, tied to the op's SQLite transaction.
 *
 * Files are written straight to their place while the op's transaction is open (and so while it
 * holds the database write lock, which also keeps a second Bousleh process out). Each write
 * remembers what it replaced, so a rollback, of the whole op or of one nested op, puts every file
 * back the way it was. A marker in `.staging` says a transaction is open; if a process dies before
 * clearing it, the next one to open your data repairs the files from the database
 * (see `Vault.recover`).
 *
 * Version files (`<layer>/.versions/…`) are only written by the store. Other packages get the same
 * stager through `Store.stagedFiles` and may write anywhere else inside the data home.
 */
export const STAGING_DIR = '.staging';
export const OPEN_MARKER_PREFIX = 'open-';

interface Undo {
  target: string;
  /** What the file held before this write; null when it didn't exist. */
  previous: string | null;
}

/** A point to roll back to: `FileStager.mark()`. */
export interface StagerMark {
  writes: number;
}

/** Resolve `relPath` inside `home`, refusing anything that escapes it or touches Bousleh's own files. */
export function safeDataPath(home: string, relPath: string, options: { allowVersions?: boolean } = {}): string {
  if (relPath.length === 0 || isAbsolute(relPath)) throw new Error(`not a path inside your data home: ${relPath}`);
  const clean = normalize(relPath);
  const parts = clean.split(sep);
  if (parts.includes('..') || clean.startsWith('..')) throw new Error(`not a path inside your data home: ${relPath}`);
  const first = parts[0] ?? '';
  if (first === STAGING_DIR || first.startsWith('vault.db')) throw new Error(`${relPath} is reserved for Bousleh itself`);
  if (!options.allowVersions && parts.includes('.versions')) throw new Error(`${relPath} is a version file; only the store writes those`);
  const target = join(home, clean);
  const back = relative(home, target);
  if (back.startsWith('..') || isAbsolute(back)) throw new Error(`not a path inside your data home: ${relPath}`);
  return target;
}

/** Write a file atomically: a temporary file in `.staging`, then a rename over the target. */
export function writeAtomic(home: string, target: string, content: string): void {
  const staging = join(home, STAGING_DIR);
  mkdirSync(staging, { recursive: true });
  mkdirSync(dirname(target), { recursive: true });
  const temp = join(staging, `tmp-${randomBytes(8).toString('hex')}`);
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, target);
}

export class FileStager {
  private undo: Undo[] = [];
  private marker: string | undefined;

  constructor(private readonly home: string) {}

  /** Write `content` to `relPath` (relative to the data home) now; undone if the op rolls back. */
  stage(relPath: string, content: string, options: { allowVersions?: boolean } = {}): void {
    const target = safeDataPath(this.home, relPath, options);
    this.open();
    const previous = existsSync(target) ? readFileSync(target, 'utf8') : null;
    this.undo.push({ target, previous });
    writeAtomic(this.home, target, content);
  }

  /** Where a nested op starts, so its writes alone can be undone. */
  mark(): StagerMark {
    return { writes: this.undo.length };
  }

  /** Undo every write made after `mark`, newest first. */
  rollbackTo(mark: StagerMark): void {
    while (this.undo.length > mark.writes) {
      const entry = this.undo.pop();
      if (!entry) break;
      if (entry.previous === null) {
        rmSync(entry.target, { force: true });
        this.pruneEmptyDirs(dirname(entry.target));
      } else {
        writeAtomic(this.home, entry.target, entry.previous);
      }
    }
  }

  /** The op committed: keep every write. Call after COMMIT. */
  commit(): void {
    this.undo = [];
    this.close();
  }

  /** The op rolled back: undo every write. Call after ROLLBACK. */
  discard(): void {
    try {
      this.rollbackTo({ writes: 0 });
    } finally {
      this.close();
    }
  }

  /** Writes this op has made so far. */
  get pending(): number {
    return this.undo.length;
  }

  private open(): void {
    if (this.marker) return;
    const staging = join(this.home, STAGING_DIR);
    mkdirSync(staging, { recursive: true });
    this.marker = join(staging, `${OPEN_MARKER_PREFIX}${process.pid}-${randomBytes(6).toString('hex')}`);
    writeFileSync(this.marker, new Date().toISOString(), 'utf8');
  }

  private close(): void {
    if (this.marker) rmSync(this.marker, { force: true });
    this.marker = undefined;
  }

  /** Remove directories a rolled-back write created, up to (not including) the data home. */
  private pruneEmptyDirs(dir: string): void {
    let current = dir;
    while (current.startsWith(this.home + sep) && current !== this.home) {
      if (!existsSync(current) || readdirSync(current).length > 0) return;
      rmdirSync(current);
      current = dirname(current);
    }
  }
}
