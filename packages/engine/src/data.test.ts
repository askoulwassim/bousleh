import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineOp, OPS, type OpContext, type OpOutcome } from '@bousleh/contracts';
import { defineHandler, STAGING_DIR } from '@bousleh/vault';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ALL_HANDLERS, type Engine, openEngine } from './engine.js';

/* End to end through runOp: the write path, history, rollback, the audit trail and the bet rules. */

let clock = Date.parse('2026-10-25T09:00:00.000Z');
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-data-'));
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
const query = <T>(sql: string): T[] => {
  const db = new Database(join(home, 'vault.db'), { readonly: true });
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
};

describe('deposits.write and vault.get', () => {
  it('writes the object, its version file and its current file, and reads it back', async () => {
    const written = ok(
      await run('deposits.write', {
        kind: 'problem',
        title: 'Analysts rebuild the same report',
        altitude: 1000,
        scopes: ['bousleh'],
        body: 'Every week.',
      }),
    );
    expect(written).toMatchObject({ kind: 'problem', layer: 'work', version: { n: 1 } });
    const id = written.id as string;
    expect(readFileSync(join(home, 'work', `${id}.md`), 'utf8')).toContain('Every week.');
    expect(existsSync(join(home, 'work', '.versions', id, '1.md'))).toBe(true);
    expect(readdirSync(join(home, STAGING_DIR))).toEqual([]);

    const object = ok(await run('vault.get', { id }));
    expect(object).toMatchObject({
      id,
      scopes: ['bousleh'],
      version: { title: 'Analysts rebuild the same report', altitude: 1000, body: 'Every week.', status: 'open' },
    });
  });

  it('needs a scope for everything but people', async () => {
    expect(failed(await run('deposits.write', { kind: 'problem', title: 'No scope', altitude: 100 })).code).toBe('invalid_input');
    ok(await run('deposits.write', { kind: 'person', title: 'Rowan', altitude: 50000, attrs: { role: 'stakeholder' } }));
  });

  it('refuses unknown scopes, altitudes outside the four and attrs a kind does not have', async () => {
    expect(failed(await run('deposits.write', { kind: 'problem', title: 't', altitude: 1000, scopes: ['nowhere'] })).message).toMatch(
      /scopes.add/,
    );
    expect(failed(await run('deposits.write', { kind: 'problem', title: 't', altitude: 5000, scopes: ['bousleh'] })).code).toBe(
      'invalid_input',
    );
    expect(
      failed(await run('deposits.write', { kind: 'problem', title: 't', altitude: 1000, scopes: ['bousleh'], attrs: { x: 1 } })).code,
    ).toBe('invalid_input');
  });

  it('finds what it wrote through the search index', async () => {
    ok(
      await run('deposits.write', {
        kind: 'signal',
        title: 'Exports are slow',
        altitude: 100,
        scopes: ['bousleh'],
        body: 'The quarterly export takes an hour.',
      }),
    );
    const hits = query<{ title: string }>("SELECT title FROM search WHERE search MATCH 'quarterly'");
    expect(hits.map((hit) => hit.title)).toEqual(['Exports are slow']);
  });
});

describe('vault.supersede', () => {
  it('writes a new version, keeps the old one, and carries over what it does not change', async () => {
    const { id } = ok(
      await run('deposits.write', { kind: 'strategy', title: 'Automate the analysts', altitude: 50000, scopes: ['bousleh'], body: 'v1' }),
    ) as {
      id: string;
    };
    const second = ok(await run('vault.supersede', { id, status: 'aligned' }));
    expect(second).toMatchObject({ version: { n: 2 } });

    const object = ok(await run('vault.get', { id, history: true })) as {
      version: { status: string; body: string };
      history: { n: number; status: string }[];
    };
    expect(object.version).toMatchObject({ status: 'aligned', body: 'v1' });
    expect(object.history.map((v) => [v.n, v.status])).toEqual([
      [1, 'forming'],
      [2, 'aligned'],
    ]);
    expect(readFileSync(join(home, 'anchors', '.versions', id, '1.md'), 'utf8')).toContain('"forming"');
    expect(readFileSync(join(home, 'anchors', `${id}.md`), 'utf8')).toContain('"aligned"');
    expect(query<{ n: number }>('SELECT count(*) AS n FROM versions')[0]?.n).toBe(2);
  });

  it('answers not_found for an unknown id', async () => {
    expect(failed(await run('vault.supersede', { id: 'prb_01JBX0000000000000000000AB', title: 'x' })).code).toBe('not_found');
  });
});

describe('bets and decisions (Oct 25)', () => {
  it('concludes a bet only through a decision linked with concludes', async () => {
    const { id: idea } = ok(
      await run('deposits.write', { kind: 'idea', title: 'Auto-draft weekly reports', altitude: 1000, scopes: ['bousleh'] }),
    ) as { id: string };
    expect(failed(await run('vault.supersede', { id: idea, status: 'concluded' })).code).toBe('invalid_input');
    expect(failed(await run('vault.supersede', { id: idea, status: 'bet' })).code).toBe('invalid_input');

    const early = await run('deposits.write', {
      kind: 'decision',
      title: 'Too early',
      altitude: 1000,
      scopes: ['bousleh'],
      links: [{ kind: 'concludes', to: idea }],
    });
    expect(failed(early).code).toBe('conflict');
    expect(query<{ n: number }>("SELECT count(*) AS n FROM objects WHERE kind = 'decision'")[0]?.n).toBe(0);

    ok(
      await run('vault.supersede', {
        id: idea,
        status: 'bet',
        attrs: { hypothesis: 'Drafts save a day a week', kill_criteria: 'No time saved after a month' },
      }),
    );
    const decision = ok(
      await run('deposits.write', {
        kind: 'decision',
        title: 'Scale auto-drafts',
        altitude: 1000,
        scopes: ['bousleh'],
        links: [{ kind: 'concludes', to: idea }],
      }),
    );
    const concluded = ok(await run('vault.get', { id: idea })) as {
      version: { n: number; status: string };
      links: { in: { kind: string; from: string }[] };
    };
    expect(concluded.version).toMatchObject({ n: 3, status: 'concluded' });
    expect(concluded.links.in).toEqual([expect.objectContaining({ kind: 'concludes', from: decision.id })]);
    expect(failed(await run('vault.supersede', { id: idea, status: 'open' })).code).toBe('invalid_input');
  });

  it('refuses concluded on a new idea', async () => {
    expect(
      failed(await run('deposits.write', { kind: 'idea', title: 'x', altitude: 100, scopes: ['bousleh'], status: 'concluded' })).code,
    ).toBe('invalid_input');
  });
});

describe('transactions and the audit trail', () => {
  const twoThenFail = defineOp({
    name: 'test.two_then_fail',
    description: 'Writes two problems through nested ops, then fails.',
    input: z.object({}),
    output: z.object({}),
  });
  const sneaky = defineOp({
    name: 'test.sneaky_read',
    description: 'A read-only op that tries to write.',
    input: z.object({}),
    output: z.object({}),
    readOnly: true,
  });

  function testEngine(): Engine {
    return openEngine({
      home,
      registry: { ...OPS, [twoThenFail.name]: twoThenFail, [sneaky.name]: sneaky },
      handlers: [
        ...ALL_HANDLERS,
        defineHandler(twoThenFail, async (_input, h) => {
          for (const title of ['one', 'two']) {
            const outcome = await h.runOp('deposits.write', { kind: 'problem', title, altitude: 100, scopes: ['bousleh'] }, h.ctx);
            if (outcome.status !== 'ok') throw new Error(outcome.message);
          }
          throw new Error('boom');
        }),
        defineHandler(sneaky, async (_input, h) => {
          const outcome = await h.runOp('deposits.write', { kind: 'problem', title: 'x', altitude: 100, scopes: ['bousleh'] }, h.ctx);
          if (outcome.status !== 'ok') throw new Error(outcome.message);
          return {};
        }),
      ],
    });
  }

  it('rolls a failed op back completely: no rows, no files, and the failure is logged', async () => {
    const test = testEngine();
    try {
      expect(failed(await test.runOp('test.two_then_fail', {}, ctx)).message).toBe('boom');
    } finally {
      test.close();
    }
    expect(query<{ n: number }>("SELECT count(*) AS n FROM objects WHERE kind = 'problem'")[0]?.n).toBe(0);
    expect(existsSync(join(home, 'work'))).toBe(false);
    expect(readdirSync(join(home, STAGING_DIR))).toEqual([]);
    expect(query<{ op: string; result: string }>('SELECT op, result FROM op_log ORDER BY id').map((row) => [row.op, row.result])).toEqual([
      ['scopes.add', 'ok'],
      ['test.two_then_fail', 'internal'],
    ]);
  });

  it("won't let a read-only op write", async () => {
    const test = testEngine();
    try {
      expect(failed(await test.runOp('test.sneaky_read', {}, ctx)).message).toMatch(/can't run inside a read-only op/);
    } finally {
      test.close();
    }
  });

  it('runs concurrent writes one at a time', async () => {
    const titles = ['a', 'b', 'c', 'd', 'e'];
    const outcomes = await Promise.all(
      titles.map((title) => run('deposits.write', { kind: 'problem', title, altitude: 100, scopes: ['bousleh'] })),
    );
    for (const outcome of outcomes) ok(outcome);
    expect(query<{ n: number }>("SELECT count(*) AS n FROM objects WHERE kind = 'problem'")[0]?.n).toBe(5);
  });

  it('leaves your data alone for vault.health', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'bousleh-fresh-'));
    rmSync(fresh, { recursive: true });
    const other = openEngine({ home: fresh });
    try {
      ok(await other.runOp('vault.health', {}, ctx));
      expect(existsSync(fresh)).toBe(false);
    } finally {
      other.close();
    }
  });
});
