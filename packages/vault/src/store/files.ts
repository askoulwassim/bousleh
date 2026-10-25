import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/*
 * File writes are staged inside your data home, then moved into place only after the SQLite
 * transaction commits. If the op fails, the staged files are discarded and nothing lands.
 */
export const STAGING_DIR = '.staging';

interface Staged {
  temp: string;
  target: string;
  relPath: string;
  content: string;
}

export class FileStager {
  private staged: Staged[] = [];

  constructor(private readonly home: string) {}

  /** Stage `content` for `relPath` (relative to the data home). Later stages of the same path win. */
  stage(relPath: string, content: string): void {
    const dir = join(this.home, STAGING_DIR);
    mkdirSync(dir, { recursive: true });
    const temp = join(dir, randomBytes(12).toString('hex'));
    writeFileSync(temp, content, 'utf8');
    this.staged.push({ temp, target: join(this.home, relPath), relPath, content });
  }

  /** The latest content staged for `relPath` in this op, if any (reads inside an op see its own writes). */
  read(relPath: string): string | undefined {
    for (let i = this.staged.length - 1; i >= 0; i--) {
      const staged = this.staged[i];
      if (staged?.relPath === relPath) return staged.content;
    }
    return undefined;
  }

  /** Move every staged file into place, in staging order. Call after COMMIT. */
  commit(): void {
    for (const { temp, target } of this.staged) {
      mkdirSync(dirname(target), { recursive: true });
      renameSync(temp, target);
    }
    this.staged = [];
  }

  /** Drop every staged file. Call after ROLLBACK. */
  discard(): void {
    for (const { temp } of this.staged) rmSync(temp, { force: true });
    this.staged = [];
  }

  get pending(): number {
    return this.staged.length;
  }
}
