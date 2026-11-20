import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpContext, OpOutcome, OpOutput } from '@bousleh/contracts';
import { newId } from '@bousleh/vault';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* context.strata end to end: columns, rows, cells, what is left out, needs-you, old rows and the cap. */

type Strata = OpOutput<'context.strata'>;

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
  home = mkdtempSync(join(tmpdir(), 'bousleh-strata-'));
  engine = openEngine({ home });
  ok(await run('scopes.add', { slug: 'acme', name: 'Acme', kind: 'company' }));
  ok(await run('scopes.add', { slug: 'widgets', name: 'Widgets', kind: 'product', parent: 'acme' }));
  ok(await run('scopes.add', { slug: 'garden', name: 'Garden', kind: 'project' }));
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
const strata = async (input: unknown = {}) => ok<Strata>(await run('context.strata', { date: '2026-10-25', ...(input as object) }));
const deposit = async (kind: string, title: string, more: Record<string, unknown> = {}) =>
  ok<{ id: string }>(await run('deposits.write', { kind, title, altitude: 1000, scopes: kind === 'person' ? [] : ['widgets'], ...more }))
    .id;
const cell = (result: Strata, scope: string, altitude: number) => {
  const found = result.cells.find((c) => c.scope === scope && c.altitude === altitude);
  if (!found) throw new Error(`no cell ${scope} ${altitude}`);
  return found;
};
const titles = (c: Strata['cells'][number]) => c.objects.map((o) => o.title);

/** Append a version with this status stored exactly, as a build from before statuses wrote it. */
function makeOld(id: string, status: string | null): void {
  const db = new Database(join(home, 'vault.db'));
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
      status,
      current.attrs_json,
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

describe('context.strata', () => {
  it('answers an empty vault with every top-level scope as a column and every cell empty', async () => {
    const result = await strata();
    expect(result.columns.map((c) => [c.slug, c.name, c.kind, c.strategy, c.assets])).toEqual([
      ['acme', 'Acme', 'company', null, 0],
      ['garden', 'Garden', 'project', null, 0],
    ]);
    expect(result.rows).toEqual([
      { altitude: 50000, label: 'company' },
      { altitude: 10000, label: 'cross-team' },
      { altitude: 1000, label: 'own surfaces' },
      { altitude: 100, label: 'one engineer or requirement' },
    ]);
    expect(result.cells).toHaveLength(8);
    expect(result.cells.every((c) => c.count === 0 && c.objects.length === 0 && c.closed === 0)).toBe(true);
    expect(result.totals).toEqual({
      layers: { anchors: 0, evidence: 0, work: 0, people: 0, moments: 0 },
      needs_you: 0,
      empty_cells: 8,
      closed: 0,
    });
    expect(result.me).toBeNull();
  });

  it('places objects by scope (child scopes in their parent column) and altitude, multi-scope objects in each column', async () => {
    const strategy = await deposit('strategy', 'Win the widget market', { altitude: 50000, scopes: ['acme'] });
    await deposit('strategy', 'A child strategy', { altitude: 50000, status: 'aligned' });
    const problem = await deposit('problem', 'Widgets jam', { altitude: 10000 });
    const shared = await deposit('idea', 'Sell widgets for gardens', { altitude: 1000, scopes: ['widgets', 'garden'] });
    ok(await run('assets.add', { url: 'https://docs.example.com/widget-plan', title: 'Widget plan', type: 'doc', scopes: ['widgets'] }));

    const result = await strata();
    expect(result.columns[0]?.strategy).toEqual({ id: strategy, title: 'Win the widget market', status: 'forming' });
    expect(result.columns[0]?.assets).toBe(1);
    expect(titles(cell(result, 'acme', 50000)).sort()).toEqual(['A child strategy', 'Win the widget market']);
    expect(cell(result, 'acme', 10000).objects.map((o) => [o.id, o.kind, o.layer, o.status])).toEqual([
      [problem, 'problem', 'work', 'open'],
    ]);
    expect(cell(result, 'acme', 1000).objects.map((o) => o.id)).toEqual([shared]);
    expect(cell(result, 'garden', 1000).objects.map((o) => o.id)).toEqual([shared]);
    expect(cell(result, 'garden', 1000).kinds).toEqual({ idea: 1 });
    // Assets are counted on the column, not drawn in a cell.
    expect(result.cells.flatMap((c) => c.objects).some((o) => o.kind === 'asset')).toBe(false);
    // Distinct objects: the shared idea counts once.
    expect(result.totals.layers).toEqual({ anchors: 2, evidence: 0, work: 2, people: 0, moments: 0 });
    expect(result.totals.empty_cells).toBe(4);

    const picked = await strata({ scopes: ['garden', 'widgets'] });
    expect(picked.columns.map((c) => c.slug)).toEqual(['garden', 'widgets']);
    expect(titles(cell(picked, 'widgets', 50000))).toEqual(['A child strategy']);
    expect(picked.columns[1]?.strategy?.status).toBe('aligned');
    expect((await run('context.strata', { scopes: ['nowhere'] })).status).toBe('error');
  });

  it('orders a cell needs-you first, then bets, then what is moving, then the newest; caps it with more and kinds', async () => {
    const me = await deposit('person', 'Me', { attrs: { is_user: true } });
    const other = await deposit('person', 'Pat', { attrs: { role: 'stakeholder' } });
    const old = await deposit('problem', 'An old problem');
    const bet = await deposit('idea', 'The big bet', {
      status: 'bet',
      attrs: { hypothesis: 'It works', kill_criteria: 'No users in 30 days' },
    });
    const running = await deposit('idea', 'A running experiment', { status: 'running', attrs: { rank: 2 } });
    const owed = await deposit('commitment', 'Send the deck', { links: [{ kind: 'owed_by', to: me }] });
    const later = await deposit('commitment', 'Write the plan', { attrs: { due: '2026-11-30' }, links: [{ kind: 'owed_by', to: me }] });
    const late = await deposit('commitment', 'Review the doc', { attrs: { due: '2026-10-21' }, links: [{ kind: 'owed_by', to: me }] });
    const theirs = await deposit('commitment', 'Pat sends numbers', {
      links: [
        { kind: 'owed_by', to: other },
        { kind: 'owed_to', to: me },
      ],
    });
    const newest = await deposit('decision', 'Ship on Fridays');

    const result = await strata();
    expect(result.me).toEqual({ id: me, name: 'Me' });
    const c = cell(result, 'acme', 1000);
    const ids = c.objects.map((o) => o.id);
    expect(ids.slice(0, 2).sort()).toEqual([late, owed].sort());
    expect(ids.slice(2, 4)).toEqual([bet, running]);
    expect(ids.slice(4)).toEqual([newest, theirs]);
    expect(c.count).toBe(10);
    expect(c.more).toBe(4);
    expect(c.kinds).toEqual({ problem: 1, idea: 2, commitment: 4, decision: 1, person: 2 });
    expect(ids).not.toContain(old);
    expect(ids).not.toContain(later);

    const byId = new Map(c.objects.map((o) => [o.id, o]));
    expect(byId.get(owed)).toMatchObject({ needs_you: true, due: null, owed: 'by_me' });
    expect(byId.get(late)).toMatchObject({ needs_you: true, due: '2026-10-21' });
    expect(byId.get(theirs)).toMatchObject({ needs_you: false, owed: 'to_me' });
    expect(byId.get(bet)).toMatchObject({ hypothesis: 'It works', kill_criteria: 'No users in 30 days' });
    expect(byId.get(bet)?.since).toBeDefined();
    expect(byId.get(running)).toMatchObject({ rank: 2, status: 'running' });
    expect(result.totals.needs_you).toBe(2);

    const wide = await strata({ per_cell: 50 });
    const all = cell(wide, 'acme', 1000);
    expect(all.more).toBe(0);
    expect(all.objects.map((o) => o.id)).toContain(later);
    // Pat has no scope of their own: placed by what they are linked to.
    expect(all.objects.find((o) => o.id === other)).toMatchObject({ kind: 'person', role: 'stakeholder', layer: 'people' });
    expect(cell(wide, 'garden', 1000).count).toBe(0);
  });

  it('counts a minor commitment as needing me only once it is dated and due, or back from a snooze', async () => {
    const me = await deposit('person', 'Me', { attrs: { is_user: true } });
    const pat = await deposit('person', 'Pat');
    const mine = (title: string, attrs: Record<string, unknown>) =>
      deposit('commitment', title, {
        attrs,
        links: [
          { kind: 'owed_by', to: me },
          { kind: 'owed_to', to: pat },
        ],
      });
    const undatedMinor = await mine('Ask Pat about the export', { size: 'minor' });
    const lateMinor = await mine('Send Pat the link', { size: 'minor', due: '2026-10-24' });
    const todayMinor = await mine('Schedule the review', { size: 'minor', due: '2026-10-25' });
    const laterMinor = await mine('Read the RFC', { size: 'minor', due: '2026-10-30' });
    const surfacedMinor = await mine('Add Pat to the channel', { size: 'minor', surface_on: '2026-10-25' });
    const undatedMajor = await mine('Write the requirements', { size: 'major' });
    const unsized = await mine('Finalize the OKRs', {});

    const result = await strata({ per_cell: 50 });
    const byId = new Map(cell(result, 'acme', 1000).objects.map((o) => [o.id, o]));
    expect(byId.get(undatedMinor)).toMatchObject({ size: 'minor', needs_you: false });
    expect(byId.get(lateMinor)).toMatchObject({ size: 'minor', needs_you: true });
    expect(byId.get(todayMinor)).toMatchObject({ size: 'minor', needs_you: true });
    expect(byId.get(laterMinor)).toMatchObject({ size: 'minor', needs_you: false });
    expect(byId.get(surfacedMinor)).toMatchObject({ size: 'minor', needs_you: true, surface_on: '2026-10-25' });
    expect(byId.get(undatedMajor)).toMatchObject({ size: 'major', needs_you: true });
    // Filed without a size: major.
    expect(byId.get(unsized)).toMatchObject({ size: 'major', needs_you: true });
    expect(result.totals.needs_you).toBe(5);
    // Only commitments carry a size.
    expect(byId.get(pat)?.size).toBeUndefined();
  });

  it('leaves out closed, replaced and old objects, counting the closed ones', async () => {
    await deposit('initiative', 'Done initiative', { status: 'done' });
    await deposit('problem', 'Solved problem', { status: 'solved' });
    await deposit('idea', 'Dropped idea', { status: 'dropped' });
    await deposit('commitment', 'Done commitment', { status: 'done' });
    const watch = ok<{ id: string }>(
      await run('watchlists.set', { scope: 'widgets', altitude: 1000, entries: [{ type: 'competitor', name: 'Gizmo Co' }] }),
    ).id;
    const filed = ok<{ filed: { id: string }[] }>(
      await run('watch.file', {
        watch_list_id: watch,
        findings: [
          { title: 'Gizmo launches', url: 'https://news.example.com/a' },
          { title: 'Gizmo hires', url: 'https://news.example.com/b' },
        ],
      }),
    ).filed;
    ok(await run('vault.supersede', { id: filed[0]?.id, status: 'dismissed' }));
    await deposit('term', 'Widget');
    await deposit('dump', 'A voice note');
    await deposit('meeting', 'Old sync', { attrs: { held_at: '2026-09-01' } });
    const recent = await deposit('meeting', 'Recent sync', { attrs: { held_at: '2026-10-20T10:00:00Z' } });
    const planned = await deposit('meeting', 'Next sync', { status: 'planned', attrs: { held_at: '2026-10-27T15:00:00Z' } });
    const replaced = await deposit('decision', 'Use paper');
    const replacing = await deposit('decision', 'Use digital', { links: [{ kind: 'supersedes', to: replaced }] });

    const c = cell(await strata(), 'acme', 1000);
    const ids = c.objects.map((o) => o.id);
    expect(ids[0]).toBe(planned);
    expect(ids).toContain(recent);
    expect(ids).toContain(replacing);
    expect(ids).toContain(watch);
    expect(ids).not.toContain(replaced);
    expect(c.objects.find((o) => o.id === watch)).toMatchObject({ entries: 1, new_findings: 1 });
    expect(c.objects.find((o) => o.id === planned)?.held_at).toBe('2026-10-27T15:00:00Z');
    expect(c.objects.map((o) => o.title)).not.toEqual(expect.arrayContaining(['Widget']));
    expect(c.objects.map((o) => o.title)).not.toEqual(expect.arrayContaining(['Old sync']));
    expect(c.objects.map((o) => o.title)).not.toEqual(expect.arrayContaining(['A voice note']));
    expect(c.closed).toBe(5);
    expect(c.kinds).toEqual({ meeting: 2, decision: 1, watch_list: 1, finding: 1 });
  });

  it('reads objects written before their kind had statuses as the default', async () => {
    const initiative = await deposit('initiative', 'Old initiative');
    const problem = await deposit('problem', 'Old problem');
    makeOld(initiative, null);
    makeOld(problem, null);
    const decision = await deposit('decision', 'Newer decision');

    const c = cell(await strata(), 'acme', 1000);
    // The initiative reads as active, so it is moving and comes before the newer decision.
    expect(c.objects.map((o) => [o.id, o.status])).toEqual([
      [initiative, 'active'],
      [decision, null],
      [problem, 'open'],
    ]);
  });
});
