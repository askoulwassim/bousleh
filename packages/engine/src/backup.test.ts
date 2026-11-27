import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpContext, OpOutcome } from '@bousleh/contracts';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* Backups on the same disk: vault.backup snapshots and the engine's daily automatic one. */

let clock = Date.parse('2026-10-25T09:00:00.000Z');
const ctx: OpContext = { actor: 'agent', now: () => new Date(clock) };
const advance = (hours: number) => {
  clock += hours * 60 * 60 * 1000;
};

let home: string;
let backups: string;
let engine: Engine;
beforeEach(() => {
  seeded = false;
  home = mkdtempSync(join(tmpdir(), 'bousleh-backup-'));
  backups = `${home}-backups`;
  engine = openEngine({ home });
});
afterEach(() => {
  engine.close();
  rmSync(home, { recursive: true, force: true });
  rmSync(backups, { recursive: true, force: true });
});

function ok(outcome: OpOutcome): Record<string, unknown> {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.code}: ${outcome.message}`);
  return outcome.output as Record<string, unknown>;
}
const run = (name: string, input: unknown) => engine.runOp(name, input, ctx);

let seeded = false;
async function seed(title: string): Promise<string> {
  if (!seeded) {
    ok(await run('scopes.add', { slug: 'bousleh', name: 'Bousleh', kind: 'project' }));
    seeded = true;
  }
  return ok(await run('deposits.write', { kind: 'problem', title, altitude: 1000, scopes: ['bousleh'], body: `Body of ${title}.` }))
    .id as string;
}

describe('vault.backup', () => {
  it('writes a complete snapshot next to your data that opens on its own', async () => {
    const id = await seed('Captures get lost');
    const out = ok(await run('vault.backup', {})) as { path: string; files: number; pruned: string[] };
    expect(out.path).toBe(join(backups, '2026-10-25T09-00-00Z'));
    expect(out.pruned).toEqual([]);
    expect(existsSync(join(out.path, '.staging'))).toBe(false);
    expect(readFileSync(join(out.path, 'work', `${id}.md`), 'utf8')).toContain('Body of Captures get lost.');

    // The snapshot is a data home in its own right.
    const restored = openEngine({ home: out.path });
    try {
      const view = ok(await restored.runOp('vault.get', { id }, ctx)) as { version: { title: string; body: string } };
      expect(view.version.title).toBe('Captures get lost');
      expect(view.version.body.trim()).toBe('Body of Captures get lost.');
    } finally {
      restored.close();
    }
    const health = ok(await run('vault.health', {})) as { backups: { latest: string; count: number } };
    expect(health.backups).toMatchObject({ latest: '2026-10-25T09-00-00Z', count: 1 });
  });

  it('keeps only the newest snapshots', async () => {
    await seed('One');
    for (let i = 0; i < 4; i++) {
      ok(await run('vault.backup', { keep: 2 }));
      advance(1);
    }
    expect(readdirSync(backups).sort()).toEqual(['2026-10-25T11-00-00Z', '2026-10-25T12-00-00Z']);
  });

  it('copies a consistent database', async () => {
    await seed('Consistent');
    const out = ok(await run('vault.backup', {})) as { path: string };
    const db = new Database(join(out.path, 'vault.db'), { readonly: true });
    try {
      expect((db.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check).toBe('ok');
      expect((db.prepare("SELECT count(*) AS n FROM objects WHERE kind = 'problem'").get() as { n: number }).n).toBe(1);
    } finally {
      db.close();
    }
  });
});

describe('backup permissions', () => {
  const mode = (path: string) => statSync(path).mode & 0o777;

  it('makes the backups folder and every snapshot readable only by you', async () => {
    const id = await seed('Private');
    // A data home from before v0.2: folders and files other accounts could read.
    chmodSync(join(home, 'work'), 0o755);
    chmodSync(join(home, 'work', `${id}.md`), 0o644);
    const out = ok(await run('vault.backup', {})) as { path: string };
    expect(mode(backups)).toBe(0o700);
    expect(mode(out.path)).toBe(0o700);
    expect(mode(join(out.path, 'work'))).toBe(0o700);
    expect(mode(join(out.path, 'work', `${id}.md`))).toBe(0o600);
    expect(mode(join(out.path, 'vault.db'))).toBe(0o600);
  });

  it('tightens an existing backups folder, with one line on stderr', async () => {
    await seed('Loose');
    mkdirSync(backups, { mode: 0o755 });
    chmodSync(backups, 0o755);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      ok(await run('vault.backup', {}));
      expect(mode(backups)).toBe(0o700);
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(String(stderr.mock.calls[0]?.[0])).toContain(`bousleh: ${backups} was readable by other accounts (mode 755)`);
    } finally {
      stderr.mockRestore();
    }
  });
});

describe('the daily automatic backup', () => {
  it('runs once a day, only once your data exists', async () => {
    engine.close();
    engine = openEngine({ home, autoBackup: {} });
    ok(await run('vault.health', {}));
    expect(existsSync(backups)).toBe(false);

    await seed('First');
    // The first op after your data exists takes the first snapshot, without waiting for the hourly check.
    ok(await run('scopes.list', {}));
    expect(readdirSync(backups)).toHaveLength(1);

    advance(5);
    ok(await run('scopes.list', {}));
    expect(readdirSync(backups)).toHaveLength(1);

    advance(24);
    ok(await run('scopes.list', {}));
    expect(readdirSync(backups)).toHaveLength(2);
  });
});
