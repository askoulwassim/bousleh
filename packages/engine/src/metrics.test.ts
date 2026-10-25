import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type MetricReading, type MetricSummary, OPS, type OpContext, type OpOutcome } from '@bousleh/contracts';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* End to end through runOp: the metrics registry (metrics.upsert, metrics.list) and its readings (metrics.reading). */

let clock = Date.parse('2026-10-25T09:00:00.000Z');
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
let peter: string;
let wassim: string;
let strategy: string;

function ok<T = Record<string, unknown>>(outcome: OpOutcome): T {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.code}: ${outcome.message}`);
  return outcome.output as T;
}
function failed(outcome: OpOutcome): { code: string; message: string } {
  if (outcome.status !== 'error') throw new Error('expected an error');
  return outcome;
}
const run = (name: string, input: unknown) => engine.runOp(name, input, ctx);
const idOf = async (name: string, input: unknown) => ok<{ id: string }>(await run(name, input)).id;
const count = (sql: string): number => {
  const db = new Database(join(home, 'vault.db'), { readonly: true });
  try {
    return (db.prepare(sql).get() as { n: number }).n;
  } finally {
    db.close();
  }
};
const list = async (input: unknown = {}) => ok<{ metrics: MetricSummary[] }>(await run('metrics.list', input)).metrics;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-metrics-'));
  engine = openEngine({ home });
  ok(await run('scopes.add', { slug: 'bousleh', name: 'Bousleh', kind: 'project' }));
  ok(await run('scopes.add', { slug: 'specdr', name: 'Specdr', kind: 'product' }));
  peter = await idOf('deposits.write', { kind: 'person', title: 'Peter', altitude: 50000 });
  wassim = await idOf('deposits.write', { kind: 'person', title: 'Wassim', altitude: 1000 });
  strategy = await idOf('deposits.write', { kind: 'strategy', title: 'Automate the analysts', altitude: 50000, scopes: ['bousleh'] });
});
afterEach(() => {
  engine.close();
  rmSync(home, { recursive: true, force: true });
});

describe('metrics.upsert', () => {
  it('creates a metric with its fields, owner and the strategy it serves', async () => {
    const created = ok(
      await run('metrics.upsert', {
        title: 'Hours saved per analyst',
        altitude: 10000,
        scopes: ['bousleh'],
        status: 'defined',
        cadence: 'weekly',
        unit: 'hours',
        body: 'Self-reported in the Friday survey.',
        owner: peter,
        serves: strategy,
      }),
    );
    expect(created).toMatchObject({ kind: 'metric', layer: 'anchors', version: { n: 1 }, created: true, new_version: true });

    const object = ok<{
      version: { status: string; attrs: Record<string, unknown>; body: string };
      links: { out: { kind: string; to: string }[] };
    }>(await run('vault.get', { id: created.id }));
    expect(object.version).toMatchObject({
      status: 'defined',
      attrs: { cadence: 'weekly', unit: 'hours' },
      body: 'Self-reported in the Friday survey.',
    });
    expect(object.links.out.map((link) => [link.kind, link.to])).toEqual([
      ['owned_by', peter],
      ['serves', strategy],
    ]);
  });

  it('starts a new metric as an idea, and needs a title, an altitude and a scope', async () => {
    const id = await idOf('metrics.upsert', { title: 'Time to first insight', altitude: 1000, scopes: ['bousleh'] });
    expect((await list())[0]).toMatchObject({ id, status: 'idea', cadence: null, unit: null, owner: null, serves: null });
    expect(failed(await run('metrics.upsert', { altitude: 1000, scopes: ['bousleh'] })).code).toBe('invalid_input');
    expect(failed(await run('metrics.upsert', { title: 'No scope', altitude: 1000 })).code).toBe('invalid_input');
    expect(failed(await run('metrics.upsert', { title: 'Bad owner', altitude: 1000, scopes: ['bousleh'], owner: strategy })).code).toBe(
      'invalid_input',
    );
  });

  it('updates by id as a new version, carrying over what it does not change', async () => {
    const id = await idOf('metrics.upsert', {
      title: 'Hours saved',
      altitude: 10000,
      scopes: ['bousleh'],
      cadence: 'weekly',
      unit: 'hours',
      body: 'v1',
    });
    const updated = ok(await run('metrics.upsert', { id, status: 'instrumented', cadence: 'monthly', unit: null, owner: peter }));
    expect(updated).toMatchObject({ id, version: { n: 2 }, created: false, new_version: true });

    const object = ok<{
      version: { title: string; status: string; attrs: Record<string, unknown>; body: string };
      history: { n: number; status: string }[];
    }>(await run('vault.get', { id, history: true }));
    expect(object.version).toMatchObject({ title: 'Hours saved', status: 'instrumented', attrs: { cadence: 'monthly' }, body: 'v1' });
    expect(object.version.attrs).not.toHaveProperty('unit');
    expect(object.history.map((v) => [v.n, v.status])).toEqual([
      [1, 'idea'],
      [2, 'instrumented'],
    ]);
    expect((await list())[0]).toMatchObject({ owner: { id: peter, title: 'Peter' }, unit: null });
  });

  it('writes nothing new when an update changes nothing, and replaces the owner', async () => {
    const id = await idOf('metrics.upsert', { title: 'Hours saved', altitude: 10000, scopes: ['bousleh'], owner: peter });
    const same = ok(await run('metrics.upsert', { id, title: 'Hours saved', altitude: 10000, scopes: ['bousleh'], owner: peter }));
    expect(same).toMatchObject({ version: { n: 1 }, new_version: false });
    expect(count(`SELECT count(*) AS n FROM versions WHERE object_id = '${id}'`)).toBe(1);
    expect(count(`SELECT count(*) AS n FROM links WHERE from_id = '${id}' AND kind = 'owned_by'`)).toBe(1);

    // A new owner replaces the old one: the old link is retracted, not deleted.
    expect(ok(await run('metrics.upsert', { id, status: 'defined', owner: wassim }))).toMatchObject({ version: { n: 2 } });
    expect(count(`SELECT count(*) AS n FROM links WHERE from_id = '${id}' AND kind = 'owned_by'`)).toBe(2);
    expect(count('SELECT count(*) AS n FROM link_retractions')).toBe(1);
    expect((await list())[0]).toMatchObject({ owner: { id: wassim } });

    expect(ok(await run('metrics.upsert', { id, serves: strategy }))).toMatchObject({ new_version: false });
    expect((await list())[0]).toMatchObject({ serves: { id: strategy, title: 'Automate the analysts' } });
  });

  it('refuses unknown ids, objects that are not metrics, and scope changes', async () => {
    const id = await idOf('metrics.upsert', { title: 'Hours saved', altitude: 10000, scopes: ['bousleh'] });
    expect(failed(await run('metrics.upsert', { id: 'met_01JBX0000000000000000000AB', title: 'x' })).code).toBe('not_found');
    expect(failed(await run('metrics.upsert', { id: strategy, title: 'x' })).code).toBe('invalid_input');
    expect(failed(await run('metrics.upsert', { id, scopes: ['specdr'] })).message).toMatch(/scopes/);
    expect(failed(await run('metrics.upsert', { id, status: 'won' })).code).toBe('invalid_input');
  });
});

describe('metrics.reading', () => {
  let metric: string;
  beforeEach(async () => {
    metric = await idOf('metrics.upsert', { title: 'Hours saved', altitude: 10000, scopes: ['bousleh'], unit: 'hours' });
  });
  const reading = async (input: Record<string, unknown>) =>
    ok<MetricReading>(await run('metrics.reading', { metric_id: metric, ...input }));

  it("records readings with the metric's unit by default, and the latest by observed_at wins", async () => {
    const first = await reading({ value: 3, observed_at: '2026-10-11', source: 'Friday survey' });
    expect(first).toMatchObject({ value: 3, unit: 'hours', observed_at: '2026-10-11', source: 'Friday survey', supersedes: null });
    expect(first.id).toMatch(/^rdg_/);
    await reading({ value: 5, observed_at: '2026-10-18T17:00:00+02:00' });
    await reading({ value: 4, observed_at: '2026-10-04' });
    expect((await list())[0]?.latest_reading).toMatchObject({ value: 5, observed_at: '2026-10-18T15:00:00.000Z' });
  });

  it('applies a correction: a new row that supersedes the wrong one, carrying over what it does not change', async () => {
    await reading({ value: 3, observed_at: '2026-10-11' });
    const wrong = await reading({ value: 50, observed_at: '2026-10-18', source: 'Friday survey' });
    expect((await list())[0]?.latest_reading?.value).toBe(50);

    const fixed = await reading({ value: 5, corrects: wrong.id });
    expect(fixed).toMatchObject({ value: 5, supersedes: wrong.id, observed_at: '2026-10-18', source: 'Friday survey', unit: 'hours' });
    expect((await list())[0]?.latest_reading).toMatchObject({ id: fixed.id, value: 5 });
    expect(count('SELECT count(*) AS n FROM metric_readings')).toBe(3);

    // A correction can also move a reading in time; the latest effective one then changes.
    const moved = await reading({ value: 5, observed_at: '2026-10-01', corrects: fixed.id });
    expect((await list())[0]?.latest_reading).toMatchObject({ value: 3, observed_at: '2026-10-11' });
    expect(moved.supersedes).toBe(fixed.id);
  });

  it('refuses to correct a reading twice, or a reading of another metric', async () => {
    const wrong = await reading({ value: 50, observed_at: '2026-10-18' });
    const fixed = await reading({ value: 5, corrects: wrong.id });
    const again = failed(await run('metrics.reading', { metric_id: metric, value: 6, corrects: wrong.id }));
    expect(again.code).toBe('conflict');
    expect(again.message).toContain(fixed.id);

    const other = await idOf('metrics.upsert', { title: 'Reports drafted', altitude: 1000, scopes: ['bousleh'] });
    expect(failed(await run('metrics.reading', { metric_id: other, value: 1, corrects: fixed.id })).code).toBe('invalid_input');
    expect(failed(await run('metrics.reading', { metric_id: metric, value: 1, corrects: 'rdg_01JBX0000000000000000000AB' })).code).toBe(
      'not_found',
    );
  });

  it('refuses readings for objects that are not metrics, and defaults observed_at to now', async () => {
    expect(failed(await run('metrics.reading', { metric_id: strategy, value: 1 })).code).toBe('invalid_input');
    expect(failed(await run('metrics.reading', { metric_id: 'met_01JBX0000000000000000000AB', value: 1 })).code).toBe('not_found');
    const now = await reading({ value: 2 });
    expect(now.observed_at).toBe(now.created_at);
    expect(count("SELECT count(*) AS n FROM op_log WHERE op = 'metrics.reading' AND result = 'ok'")).toBe(1);
  });
});

describe('metrics.list', () => {
  it('filters by status and scope, and is read-only', async () => {
    expect(OPS['metrics.list'].readOnly).toBe(true);
    const a = await idOf('metrics.upsert', { title: 'A: hours saved', altitude: 10000, scopes: ['bousleh'], status: 'measured' });
    const b = await idOf('metrics.upsert', { title: 'B: weekly actives', altitude: 1000, scopes: ['specdr'], status: 'measured' });
    const c = await idOf('metrics.upsert', { title: 'C: drafts accepted', altitude: 1000, scopes: ['bousleh', 'specdr'] });
    ok(await run('metrics.reading', { metric_id: b, value: 120 }));

    expect((await list()).map((m) => m.id)).toEqual([a, b, c]);
    expect((await list({ status: ['measured'] })).map((m) => m.id)).toEqual([a, b]);
    expect((await list({ scope: 'specdr' })).map((m) => m.id)).toEqual([b, c]);
    expect((await list({ scope: 'bousleh', status: ['idea', 'defined'] })).map((m) => m.id)).toEqual([c]);
    expect((await list({ scope: 'specdr' })).map((m) => m.latest_reading?.value ?? null)).toEqual([120, null]);
    expect((await list({ scope: 'bousleh' }))[1]?.scopes).toEqual(['bousleh', 'specdr']);

    expect(failed(await run('metrics.list', { scope: 'nowhere' })).code).toBe('invalid_input');
    expect(failed(await run('metrics.list', { status: ['won'] })).code).toBe('invalid_input');
  });
});
