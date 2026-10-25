import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpContext, OpOutcome, OpOutput } from '@bousleh/contracts';
import { newId } from '@bousleh/vault';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/*
 * Data written before a kind gained statuses or attrs (initiatives, meetings and findings had no
 * status before Oct 25) must still read and supersede. `makeOld` stands in for that data: it
 * appends a version that keeps the current body but stores the given status and attrs exactly,
 * without the kind check, as an older build of Bousleh would have written them.
 */

let clock = new Date(2026, 9, 20, 9, 0).getTime();
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
beforeEach(async () => {
  clock = new Date(2026, 9, 20, 9, 0).getTime();
  home = mkdtempSync(join(tmpdir(), 'bousleh-old-data-'));
  engine = openEngine({ home });
  ok(await run('scopes.add', { slug: 'bousleh', name: 'Bousleh', kind: 'project' }));
});
afterEach(() => {
  engine.close();
  rmSync(home, { recursive: true, force: true });
});

function ok<T = Record<string, unknown>>(outcome: OpOutcome): T {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.code}: ${outcome.message}`);
  return outcome.output as T;
}
const run = (name: string, input: unknown = {}) => engine.runOp(name, input, ctx);
const deposit = async (kind: string, title: string, more: Record<string, unknown> = {}) =>
  ok<{ id: string }>(await run('deposits.write', { kind, title, altitude: 1000, scopes: ['bousleh'], ...more })).id;
const get = async (id: string) => ok<OpOutput<'vault.get'>>(await run('vault.get', { id }));

/** Append a version with this status and these attrs exactly, as an older build stored them. */
function makeOld(dataHome: string, id: string, fields: { status: string | null; attrs: Record<string, unknown> }): void {
  const db = new Database(join(dataHome, 'vault.db'));
  try {
    const current = db.prepare('SELECT * FROM current WHERE object_id = ?').get(id) as Record<string, unknown>;
    db.prepare(
      `INSERT INTO versions (id, object_id, n, supersedes_id, title, altitude, status, attrs_json, body_path, body_sha256, op, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      newId('ver', tick()),
      id,
      (current.n as number) + 1,
      current.id,
      current.title,
      current.altitude,
      fields.status,
      JSON.stringify(fields.attrs),
      current.body_path,
      current.body_sha256,
      'test.make_old',
      'agent',
      tick().toISOString(),
    );
  } finally {
    db.close();
  }
}

describe('objects written before Oct 25', () => {
  it('an initiative with no status reads, shows as active in the brief, and supersedes', async () => {
    const id = await deposit('initiative', 'Provenance everywhere');
    makeOld(home, id, { status: null, attrs: {} });

    expect((await get(id)).version).toMatchObject({ n: 2, status: null, attrs: {} });
    const brief = ok<OpOutput<'context.brief'>>(await run('context.brief', { altitude: 1000 }));
    expect(brief.initiatives.map((i) => [i.id, i.status])).toEqual([[id, 'active']]);

    // A new version without a status takes the default; one with a status takes that.
    ok(await run('vault.supersede', { id, title: 'Provenance in every product' }));
    expect((await get(id)).version).toMatchObject({ n: 3, status: 'active', title: 'Provenance in every product' });
    ok(await run('vault.supersede', { id, status: 'done', attrs: { target_date: '2026-12-31' } }));
    expect((await get(id)).version).toMatchObject({ n: 4, status: 'done', attrs: { target_date: '2026-12-31' } });
  });

  it('a problem with no status reads as open in the brief and search, and supersedes', async () => {
    const id = await deposit('problem', 'Analysts rebuild the same report');
    makeOld(home, id, { status: null, attrs: {} });

    expect((await get(id)).version.status).toBeNull();
    const brief = ok<OpOutput<'context.brief'>>(await run('context.brief', { altitude: 1000 }));
    expect(brief.problems.map((p) => [p.id, p.status])).toEqual([[id, 'open']]);
    const search = ok<OpOutput<'vault.search'>>(await run('vault.search', { query: 'rebuild report', kinds: ['problem'] }));
    expect(search.hits.map((hit) => [hit.id, hit.status])).toEqual([[id, 'open']]);

    ok(await run('vault.supersede', { id, body: 'Every single week.' }));
    expect((await get(id)).version).toMatchObject({ n: 3, status: 'open' });
    ok(await run('vault.supersede', { id, status: 'solved' }));
    expect((await get(id)).version).toMatchObject({ n: 4, status: 'solved' });
  });

  it('a meeting with no status reads as held in Pulse, and supersedes', async () => {
    const id = await deposit('meeting', 'Analyst council', { attrs: { held_at: '2026-10-20' } });
    makeOld(home, id, { status: null, attrs: { held_at: '2026-10-20' } });

    expect((await get(id)).version.status).toBeNull();
    const pulse = ok<OpOutput<'pulse.today'>>(await run('pulse.today', { date: '2026-10-20' }));
    expect(pulse.meetings.map((m) => [m.id, m.status])).toEqual([[id, 'held']]);

    ok(await run('vault.supersede', { id, body: 'Notes added later.' }));
    expect((await get(id)).version).toMatchObject({ n: 3, status: 'held', attrs: { held_at: '2026-10-20' } });
  });

  it('a finding and a signal written before still read and supersede', async () => {
    const list = ok<{ id: string }>(await run('watchlists.set', { scope: 'bousleh', entries: [] })).id;
    const finding = ok<{ filed: { id: string }[] }>(
      await run('watch.file', { watch_list_id: list, findings: [{ title: 'Launch', url: 'https://example.com/launch' }] }),
    ).filed[0]?.id as string;
    makeOld(home, finding, { status: null, attrs: { url: 'https://example.com/launch' } });
    ok(await run('vault.supersede', { id: finding, status: 'to_read' }));
    expect((await get(finding)).version).toMatchObject({ status: 'to_read' });

    const signal = await deposit('signal', 'Exports are slow', { attrs: { source: 'Peter' } });
    makeOld(home, signal, { status: null, attrs: { source: 'Peter' } });
    expect((await get(signal)).version.attrs).toEqual({ source: 'Peter' });
    ok(await run('vault.supersede', { id: signal, attrs: { tags: ['export-speed'] } }));
    expect((await get(signal)).version.attrs).toEqual({ source: 'Peter', tags: ['export-speed'] });
  });

  it("watch list entries without added_by read as Wassim's, and set keeps them his", async () => {
    const list = ok<{ id: string }>(await run('watchlists.set', { scope: 'bousleh', entries: [{ type: 'competitor', name: 'Glean' }] })).id;
    const old = [
      { type: 'competitor', name: 'Glean', url: 'https://www.glean.com' },
      { type: 'outlet', name: 'Stratechery', notes: 'weekly' },
    ];
    makeOld(home, list, { status: null, attrs: { entries: old } });

    const read = ok<OpOutput<'watchlists.get'>>(await run('watchlists.get', { id: list })).watch_lists[0];
    expect(read?.entries).toEqual(old.map((entry) => ({ ...entry, added_by: 'wassim' })));
    expect((await get(list)).version.attrs.entries).toEqual(old);

    // Sending the same entries back changes nothing; adding a scan's entry keeps the old ones Wassim's.
    expect(ok<{ new_version: boolean }>(await run('watchlists.set', { id: list, entries: old })).new_version).toBe(false);
    const added = ok<OpOutput<'watchlists.set'>>(
      await run('watchlists.set', {
        id: list,
        entries: [...old, { type: 'competitor', name: 'Hebbia', added_by: 'horizon', reason: 'direct alternative in 3 articles' }],
      }),
    );
    expect(added.entries.map((e) => [e.name, e.added_by])).toEqual([
      ['Glean', 'wassim'],
      ['Stratechery', 'wassim'],
      ['Hebbia', 'horizon'],
    ]);
  });
});
