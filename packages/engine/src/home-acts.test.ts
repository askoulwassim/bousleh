import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpContext, OpOutcome } from '@bousleh/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/*
 * The ops Home runs on a press, and the reverse op each Undo calls (packages/home/src/acts.ts and
 * capture.ts), end to end through runOp: every Undo must be accepted by the store as it is.
 */

// Friday Nov 27, 2026, 15:42 UTC; the store's "today" is the local day of this clock.
let clock = Date.parse('2026-11-27T15:42:00.000Z');
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-home-acts-'));
  engine = openEngine({ home });
  ok(await engine.runOp('scopes.add', { slug: 'harbor', name: 'Harbor', kind: 'product' }, ctx));
});
afterEach(() => {
  engine.close();
  rmSync(home, { recursive: true, force: true });
});

// biome-ignore lint/suspicious/noExplicitAny: test outputs are checked with matchers
type Out = any;
function ok(outcome: OpOutcome): Out {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.code}: ${outcome.message}`);
  return outcome.output;
}
const run = (name: string, input: unknown) => engine.runOp(name, input, ctx);
const commitment = async (attrs: Record<string, unknown> = {}) =>
  ok(await run('deposits.write', { kind: 'commitment', title: 'Send Rowan the Q1 plan', altitude: 10000, scopes: ['harbor'], attrs }))
    .id as string;
const current = async (id: string) => ok(await run('vault.get', { id })).version;

describe("Home's acts and their Undo", () => {
  it('reopens a commitment marked done, or closed with its note, with vault.supersede status open', async () => {
    for (const close of [{ status: 'done' }, { status: 'dropped', note: 'Closed from Home.' }]) {
      const id = await commitment({ due: '2026-11-26' });
      ok(await run('commitments.close', { id, ...close }));
      expect((await current(id)).status).toBe(close.status);
      ok(await run('vault.supersede', { id, status: 'open' }));
      const back = await current(id);
      expect(back.status).toBe('open');
      expect(back.attrs).toEqual({ due: '2026-11-26' });
      expect(ok(await run('commitments.list', {})).commitments.map((c: { id: string }) => c.id)).toContain(id);
    }
  });

  it('puts back the due date a Date replaced, even none, and the snooze it ended', async () => {
    const undated = await commitment();
    ok(await run('vault.supersede', { id: undated, attrs: { due: '2026-11-30' } }));
    ok(await run('vault.supersede', { id: undated, attrs: { due: null, surface_on: null } }));
    expect((await current(undated)).attrs).toEqual({});

    // Back from a snooze: dating it ends the snooze; Undo brings both back as they were.
    const back = await commitment({ due: '2026-11-20', surface_on: '2026-11-25' });
    ok(await run('vault.supersede', { id: back, attrs: { due: '2026-12-02' } }));
    expect((await current(back)).attrs).toEqual({ due: '2026-12-02' });
    ok(await run('vault.supersede', { id: back, attrs: { due: '2026-11-20', surface_on: '2026-11-25' } }));
    expect((await current(back)).attrs).toEqual({ due: '2026-11-20', surface_on: '2026-11-25' });
  });

  it('wakes a snooze with until null, or puts back the earlier snooze day', async () => {
    const id = await commitment();
    ok(await run('commitments.snooze', { id, until: '2026-11-30' }));
    ok(await run('commitments.snooze', { id, until: null }));
    expect((await current(id)).attrs).toEqual({});

    const again = await commitment({ surface_on: '2026-11-25' });
    ok(await run('commitments.snooze', { id: again, until: '2026-12-04' }));
    ok(await run('vault.supersede', { id: again, attrs: { surface_on: '2026-11-25' } }));
    expect((await current(again)).attrs).toEqual({ surface_on: '2026-11-25' });
  });

  it('takes a capture back out of the inbox with inbox.settle skipped', async () => {
    const dropped = ok(
      await run('inbox.drop', {
        name: 'capture-2026-11-27-1542-home.md',
        content: 'I owe Rowan the Q1 plan by Wednesday.',
        source: 'local',
      }),
    );
    expect(dropped.duplicate).toBe(false);
    expect(ok(await run('inbox.list', {})).files.map((f: { sha256: string }) => f.sha256)).toEqual([dropped.sha256]);
    expect(ok(await run('inbox.settle', { sha256: dropped.sha256, outcome: 'skipped' }))).toMatchObject({
      outcome: 'skipped',
      source: 'local',
    });
    expect(ok(await run('inbox.list', {})).files).toEqual([]);
  });
});
