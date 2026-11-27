import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  constants,
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { makePrivateDir, PRIVATE_FILE_MODE } from './private.js';

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
 * File moves (an inbox file to inbox/processed, a Drive file into the local inbox) are different:
 * they run only after COMMIT, and never if the op fails. If a process dies between the two, the
 * file is still in the inbox with its hash logged, and the next sweep moves it as a duplicate.
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

interface StagedMove {
  /** Absolute path of the file to move. It may live outside the data home (the synced Drive folder). */
  source: string;
  target: string;
}

/** A point to roll back to: `FileStager.mark()`. */
export interface StagerMark {
  writes: number;
  moves: number;
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

/** Write a file atomically (0600): a temporary file in `.staging`, then a rename over the target. */
export function writeAtomic(home: string, target: string, content: string): void {
  const staging = join(home, STAGING_DIR);
  makePrivateDir(staging);
  makePrivateDir(dirname(target));
  const temp = join(staging, `tmp-${randomBytes(8).toString('hex')}`);
  writeFileSync(temp, content, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  renameSync(temp, target);
}

/**
 * Move a file, also across volumes: `rename` first, and on `EXDEV` (the synced Google Drive folder can
 * sit on another volume) copy to a temporary name beside the target, keep the modification time,
 * rename it into place and only then unlink the source. Never overwrites an existing target. The
 * moved file ends up 0600, like every file in your data home. `rename` is injectable so tests can simulate a cross-volume move.
 */
export function moveFile(source: string, target: string, rename: (from: string, to: string) => void = renameSync): void {
  makePrivateDir(dirname(target));
  if (existsSync(target)) throw new Error(`cannot move ${source}: ${target} already exists`);
  try {
    rename(source, target);
    chmodSync(target, PRIVATE_FILE_MODE);
    return;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e;
  }
  const partial = `${target}.${randomBytes(6).toString('hex')}.partial`;
  try {
    copyFileSync(source, partial, constants.COPYFILE_EXCL);
    chmodSync(partial, PRIVATE_FILE_MODE);
    const { atime, mtime } = statSync(source);
    utimesSync(partial, atime, mtime);
    renameSync(partial, target);
  } catch (e) {
    rmSync(partial, { force: true });
    throw e;
  }
  unlinkSync(source);
}

export class FileStager {
  private undo: Undo[] = [];
  private moves: StagedMove[] = [];
  private marker: string | undefined;

  /**
   * @param options.rename what staged moves use to rename a file; tests pass one that fails with
   *   `EXDEV` to exercise the cross-volume path.
   */
  constructor(
    private readonly home: string,
    private readonly options: { rename?: (from: string, to: string) => void } = {},
  ) {}

  /** Write `content` to `relPath` (relative to the data home) now; undone if the op rolls back. */
  stage(relPath: string, content: string, options: { allowVersions?: boolean } = {}): void {
    const target = safeDataPath(this.home, relPath, options);
    this.open();
    const previous = existsSync(target) ? readFileSync(target, 'utf8') : null;
    this.undo.push({ target, previous });
    writeAtomic(this.home, target, content);
  }

  /**
   * Stage a move of the file at `source` (absolute; it may be outside the data home) to `relPath`
   * (relative to the data home). It runs after COMMIT and never if the op fails. Refuses a source
   * that isn't a file, a source already staged to move, and a target that exists or that this op
   * already claimed (check with `isFree` first).
   */
  stageMove(source: string, relPath: string): void {
    const target = safeDataPath(this.home, relPath);
    const from = resolve(source);
    if (!existsSync(from) || !statSync(from).isFile()) throw new Error(`cannot move ${from}: it is not a file`);
    if (this.isMoving(from)) throw new Error(`${from} is already staged to move`);
    if (!this.isFree(relPath)) throw new Error(`cannot move ${from} to ${relPath}: that path is taken`);
    this.moves.push({ source: from, target });
  }

  /** True when nothing exists at `relPath` and no staged move in this op targets it. */
  isFree(relPath: string): boolean {
    const target = join(this.home, relPath);
    return !existsSync(target) && !this.moves.some((m) => m.target === target);
  }

  /** True when the file at `source` is staged to move in this op. */
  isMoving(source: string): boolean {
    const from = resolve(source);
    return this.moves.some((m) => m.source === from);
  }

  /** Where a nested op starts, so its writes and moves alone can be undone. */
  mark(): StagerMark {
    return { writes: this.undo.length, moves: this.moves.length };
  }

  /** Undo every write made after `mark`, newest first, and drop the moves staged after it. */
  rollbackTo(mark: StagerMark): void {
    this.moves.length = Math.min(this.moves.length, mark.moves);
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

  /**
   * The op committed: keep every write, then run the staged moves. Call after COMMIT. A move that
   * fails doesn't stop the others; the failures are reported together at the end.
   */
  commit(): void {
    this.undo = [];
    this.close();
    const moves = this.moves;
    this.moves = [];
    const failures: string[] = [];
    for (const { source, target } of moves) {
      try {
        moveFile(source, target, this.options.rename);
      } catch (e) {
        failures.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (failures.length > 0) throw new Error(`some files did not move: ${failures.join('; ')}`);
  }

  /** The op rolled back: undo every write. Call after ROLLBACK. */
  discard(): void {
    try {
      this.rollbackTo({ writes: 0, moves: 0 });
    } finally {
      this.close();
    }
  }

  /** Writes this op has made so far, plus moves not yet run. */
  get pending(): number {
    return this.undo.length + this.moves.length;
  }

  private open(): void {
    if (this.marker) return;
    const staging = join(this.home, STAGING_DIR);
    makePrivateDir(staging);
    this.marker = join(staging, `${OPEN_MARKER_PREFIX}${process.pid}-${randomBytes(6).toString('hex')}`);
    writeFileSync(this.marker, new Date().toISOString(), { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
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
