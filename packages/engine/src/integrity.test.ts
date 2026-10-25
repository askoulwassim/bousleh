import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defineOp, OPS, type OpContext, type OpOutcome, type RunOp } from '@bousleh/contracts';
import { defineHandler, OPEN_MARKER_PREFIX, STAGING_DIR, safeDataPath, Vault } from '@bousleh/vault';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ALL_HANDLERS, type Engine, openEngine } from './engine.js';

/* The guarantees behind "a failed op leaves no rows and no files" and "nothing is overwritten" (PR #6 review). */

let clock = Date.parse('2026-10-25T09:00:00.000Z');
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-integrity-'));
  engine = openEngine({ home });
  ok(await engine.runOp('scopes.add', { slug: 'bousleh', name: 'Bousleh', kind: 'project' }, ctx));
});
afterEach(() => {
  engine.close();
  rmSync(home, { recursive: true, force: true });
});

function ok(outcome: OpOutcome): Record<string, unknown> {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.code}: ${outcome.message}`);
  return outcome.output as Record<string, unknown>;
}
function failed(outcome: OpOutcome): { code: string; message: string } {
  if (outcome.status !== 'error') throw new Error('expected an error');
  return outcome;
}
const run = (name: string, input: unknown) => engine.runOp(name, input, ctx);
const db = () => new Database(join(home, 'vault.db'));
const count = (sql: string): number => {
  const conn = db();
  try {
    return (conn.prepare(sql).get() as { n: number }).n;
  } finally {
    conn.close();
  }
};
const problem = (title: string, extra: Record<string, unknown> = {}) => ({
  kind: 'problem',
  title,
  altitude: 100,
  scopes: ['bousleh'],
  ...extra,
});

describe('nested ops', () => {
  const caught = defineOp({ name: 'test.caught', description: 'test', input: z.object({}), output: z.object({ inner: z.string() }) });
  const raw = defineOp({ name: 'test.raw_read', description: 'test', readOnly: true, input: z.object({}), output: z.object({}) });
  let late: Promise<OpOutcome> | undefined;
  const fireAndForget = defineOp({ name: 'test.fire_and_forget', description: 'test', input: z.object({}), output: z.object({}) });

  function testEngine(): Engine {
    return openEngine({
      home,
      registry: { ...OPS, [caught.name]: caught, [raw.name]: raw, [fireAndForget.name]: fireAndForget },
      handlers: [
        ...ALL_HANDLERS,
        defineHandler(caught, async (_input, h) => {
          // The object row and its version are inserted before the bad link fails the nested op.
          const inner = await h.runOp(
            'deposits.write',
            problem('half written', { links: [{ kind: 'related', to: 'prb_01JAAAAAAAAAAAAAAAAAAAAAAA' }] }),
            h.ctx,
          );
          if (inner.status === 'ok') throw new Error('expected the nested write to fail');
          const fine = await h.runOp('deposits.write', problem('kept'), h.ctx);
          if (fine.status !== 'ok') throw new Error(fine.message);
          return { inner: inner.code };
        }),
        defineHandler(raw, async (_input, h) => {
          h.store.db
            .prepare("INSERT INTO op_log (op, actor, input_json, result, created_at) VALUES ('forged', 'agent', '{}', 'ok', 'x')")
            .run();
          return {};
        }),
        defineHandler(fireAndForget, async (_input, h) => {
          const runLater: RunOp = h.runOp;
          late = new Promise((resolve) => setTimeout(() => resolve(runLater('deposits.write', problem('late'), h.ctx)), 5));
          return {};
        }),
      ],
    });
  }

  it('undoes a failed nested op even when the caller carries on', async () => {
    engine.close();
    const test = testEngine();
    try {
      expect(ok(await test.runOp('test.caught', {}, ctx)).inner).toBe('not_found');
    } finally {
      test.close();
    }
    const titles = (() => {
      const conn = db();
      try {
        return (
          conn.prepare("SELECT title FROM current c JOIN objects o ON o.id = c.object_id WHERE o.kind = 'problem'").all() as {
            title: string;
          }[]
        ).map((row) => row.title);
      } finally {
        conn.close();
      }
    })();
    expect(titles).toEqual(['kept']);
    expect(readdirSync(join(home, 'work')).filter((name) => name.endsWith('.md'))).toHaveLength(1);
    expect(readdirSync(join(home, 'work', '.versions'))).toHaveLength(1);
  });

  it('refuses raw SQL writes inside a read-only op', async () => {
    engine.close();
    const test = testEngine();
    try {
      expect(failed(await test.runOp('test.raw_read', {}, ctx)).message).toMatch(/readonly|read-only/i);
      // The connection is writable again afterwards.
      ok(await test.runOp('deposits.write', problem('after'), ctx));
    } finally {
      test.close();
    }
    expect(count("SELECT count(*) AS n FROM op_log WHERE op = 'forged'")).toBe(0);
  });

  it('refuses a nested op called after its op finished', async () => {
    engine.close();
    const test = testEngine();
    try {
      ok(await test.runOp('test.fire_and_forget', {}, ctx));
      const outcome = await late;
      expect(outcome && failed(outcome).message).toMatch(/after the op that started it had finished/);
    } finally {
      test.close();
    }
    expect(count("SELECT count(*) AS n FROM current WHERE title = 'late'")).toBe(0);
    const staging = join(home, STAGING_DIR);
    expect(existsSync(staging) ? readdirSync(staging) : []).toEqual([]);
  });
});

describe('markdown files', () => {
  it('refuses to read a version whose file is missing, instead of treating it as empty', async () => {
    const written = ok(await run('deposits.write', problem('has a body', { body: 'Important detail.' })));
    const id = written.id as string;
    rmSync(join(home, 'work', '.versions', id, '1.md'));
    expect(failed(await run('vault.get', { id })).message).toMatch(/is missing/);
    expect(failed(await run('vault.supersede', { id, title: 'renamed' })).message).toMatch(/is missing/);
    expect(count(`SELECT count(*) AS n FROM versions WHERE object_id = '${id}'`)).toBe(1);
  });

  it('refuses a version file edited outside Bousleh', async () => {
    const id = ok(await run('deposits.write', problem('edited'))).id as string;
    const file = join(home, 'work', '.versions', id, '1.md');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nsneaky`, 'utf8');
    expect(failed(await run('vault.get', { id })).message).toMatch(/changed outside Bousleh/);
  });

  it('repairs files after a process died mid-op', async () => {
    const id = ok(await run('deposits.write', problem('survivor', { body: 'v1' }))).id as string;
    ok(await run('vault.supersede', { id, body: 'v2' }));
    engine.close();

    // What a crash leaves: an open marker, a version file from a transaction that never committed,
    // a current copy pointing at that uncommitted version, and a temporary file.
    const staging = join(home, STAGING_DIR);
    writeFileSync(join(staging, `${OPEN_MARKER_PREFIX}999-dead`), 'x');
    writeFileSync(join(staging, 'tmp-dead'), 'x');
    writeFileSync(join(home, 'work', '.versions', id, '3.md'), 'uncommitted');
    mkdirSync(join(home, 'work', '.versions', 'prb_01JORPHANORPHANORPHANORPHA'), { recursive: true });
    writeFileSync(join(home, 'work', '.versions', 'prb_01JORPHANORPHANORPHANORPHA', '1.md'), 'uncommitted');
    writeFileSync(join(home, 'work', `${id}.md`), 'uncommitted');

    engine = openEngine({ home });
    const view = ok(await run('vault.get', { id })) as { version: { n: number; body: string } };
    expect(view.version).toMatchObject({ n: 2 });
    expect(view.version.body.trim()).toBe('v2');
    expect(readFileSync(join(home, 'work', `${id}.md`), 'utf8')).toBe(readFileSync(join(home, 'work', '.versions', id, '2.md'), 'utf8'));
    expect(existsSync(join(home, 'work', '.versions', id, '3.md'))).toBe(false);
    expect(existsSync(join(home, 'work', '.versions', 'prb_01JORPHANORPHANORPHANORPHA'))).toBe(false);
    expect(readdirSync(staging)).toEqual([]);
    expect(count("SELECT count(*) AS n FROM op_log WHERE op = 'vault.recover' AND result = 'ok'")).toBe(1);

    // The next supersede writes version 3 cleanly.
    ok(await run('vault.supersede', { id, body: 'v3' }));
  });

  it('keeps file writes inside the data home and away from Bousleh’s own files', () => {
    for (const bad of ['../escaped.txt', '/etc/passwd', '.staging/x', 'vault.db', 'vault.db-wal', 'work/.versions/x/1.md', 'a/../../b']) {
      expect(() => safeDataPath(home, bad), bad).toThrow();
    }
    expect(safeDataPath(home, 'inbox/processed/2026-10/note.md')).toBe(join(home, 'inbox/processed/2026-10/note.md'));
    expect(safeDataPath(home, 'work/.versions/x/1.md', { allowVersions: true })).toBe(join(home, 'work/.versions/x/1.md'));
  });
});

describe('append-only tables', () => {
  it('refuses UPDATE and DELETE, even through raw SQL', async () => {
    ok(await run('deposits.write', problem('fixed in stone')));
    const conn = db();
    try {
      expect(() => conn.prepare("UPDATE versions SET title = 'changed'").run()).toThrow(/append-only/);
      expect(() => conn.prepare('DELETE FROM objects').run()).toThrow(/append-only/);
      expect(() => conn.prepare('DELETE FROM op_log').run()).toThrow(/append-only/);
    } finally {
      conn.close();
    }
  });

  it("refuses a version that supersedes another object's version", async () => {
    const a = ok(await run('deposits.write', problem('a'))) as { id: string; version: { id: string } };
    const b = ok(await run('deposits.write', problem('b'))) as { id: string };
    const conn = db();
    try {
      expect(() =>
        conn
          .prepare(
            `INSERT INTO versions (id, object_id, n, supersedes_id, title, altitude, status, attrs_json, body_path, body_sha256, op, actor, created_at)
             VALUES ('ver_x', ?, 2, ?, 't', 100, NULL, '{}', 'p', 's', 'op', 'agent', 'now')`,
          )
          .run(b.id, a.version.id),
      ).toThrow(/same object/);
    } finally {
      conn.close();
    }
  });
});

describe('scope membership', () => {
  it('orders adds and retractions by sequence, not by clock', async () => {
    const id = ok(await run('deposits.write', problem('scoped'))).id as string;
    const conn = db();
    try {
      const scope = (conn.prepare("SELECT id FROM scopes WHERE slug = 'bousleh'").get() as { id: string }).id;
      // Same timestamp, retraction then re-add: the re-add wins. A clock running backwards changes nothing.
      conn
        .prepare(
          "INSERT INTO object_scope_retractions (object_id, scope_id, seq, op, actor, created_at) VALUES (?, ?, 2, 'op', 'agent', '2026-01-01')",
        )
        .run(id, scope);
      conn
        .prepare(
          "INSERT INTO object_scopes (object_id, scope_id, seq, op, actor, created_at) VALUES (?, ?, 3, 'op', 'agent', '2025-01-01')",
        )
        .run(id, scope);
    } finally {
      conn.close();
    }
    expect((ok(await run('vault.get', { id })) as { scopes: string[] }).scopes).toEqual(['bousleh']);
  });
});

describe('two processes on one data home', () => {
  // Claude Desktop and Claude Code each start their own server. Run real child processes: within one
  // process, SQLite's busy wait blocks the event loop, so it can't stand in for two.
  const writer = (fresh: string, prefix: string) =>
    new Promise<number>((resolve, reject) => {
      const engineUrl = pathToFileURL(join(import.meta.dirname, '..', 'dist', 'index.js')).href;
      const script = `
        const { openEngine } = await import(${JSON.stringify(engineUrl)});
        const engine = openEngine({ home: ${JSON.stringify(fresh)} });
        const ctx = { actor: 'agent', now: () => new Date() };
        let bad = 0;
        for (let i = 0; i < 15; i++) {
          const out = await engine.runOp('deposits.write', { kind: 'problem', title: '${prefix}-' + i, altitude: 100, scopes: ['s'] }, ctx);
          if (out.status !== 'ok') { bad++; console.error(out.message); }
        }
        engine.close();
        process.exit(bad);`;
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'ignore', 'inherit'] });
      child.on('error', reject);
      child.on('exit', (code) => resolve(code ?? 1));
    });

  it('migrates once', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'bousleh-two-'));
    try {
      const first = new Vault(fresh);
      const second = new Vault(fresh);
      expect((first.db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(1);
      expect((second.db.prepare('SELECT count(*) AS n FROM schema_migrations').get() as { n: number }).n).toBe(1);
      first.close();
      second.close();
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });

  it('serialises writes from two processes, files included', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'bousleh-two-'));
    try {
      const setup = openEngine({ home: fresh });
      ok(await setup.runOp('scopes.add', { slug: 's', name: 'S', kind: 'project' }, ctx));
      setup.close();
      expect(await Promise.all([writer(fresh, 'a'), writer(fresh, 'b')])).toEqual([0, 0]);

      const check = openEngine({ home: fresh });
      try {
        const conn = new Database(join(fresh, 'vault.db'), { readonly: true });
        const ids = (conn.prepare("SELECT id FROM objects WHERE kind = 'problem'").all() as { id: string }[]).map((row) => row.id);
        conn.close();
        expect(ids).toHaveLength(30);
        for (const id of ids) ok(await check.runOp('vault.get', { id }, ctx));
      } finally {
        check.close();
      }
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  }, 30000);
});
