import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpContext, OpOutcome, OpOutput } from '@bousleh/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* End to end through runOp: context.brief (altitude, scopes, one hop out) and pulse.today (its buckets around day boundaries). */

type Brief = OpOutput<'context.brief'>;
type Pulse = OpOutput<'pulse.today'>;

/*
 * The clock runs on this machine's time zone, as Pulse does: local 2026-10-25 09:00, one second
 * per op. `at` moves it to a local moment (never backwards) so filing times land where a test needs them.
 */
let clock = new Date(2026, 9, 25, 9, 0).getTime();
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const at = (y: number, month: number, d: number, h = 0, min = 0) => {
  const next = new Date(y, month - 1, d, h, min).getTime();
  if (next < clock) throw new Error('the test clock only moves forward');
  clock = next;
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;

beforeEach(async () => {
  clock = new Date(2026, 9, 20, 9, 0).getTime();
  home = mkdtempSync(join(tmpdir(), 'bousleh-context-'));
  engine = openEngine({ home });
  ok(await run('scopes.add', { slug: 'northwind', name: 'Northwind', kind: 'company' }));
  ok(await run('scopes.add', { slug: 'logistics', name: 'Logistics', kind: 'product', parent: 'northwind' }));
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
function failed(outcome: OpOutcome): { code: string; message: string } {
  if (outcome.status !== 'error') throw new Error('expected an error');
  return outcome;
}
const run = (name: string, input: unknown = {}) => engine.runOp(name, input, ctx);
const idOf = async (name: string, input: unknown) => ok<{ id: string }>(await run(name, input)).id;
const brief = async (input: unknown = {}) => ok<Brief>(await run('context.brief', input));
const pulse = async (input: unknown = {}) => ok<Pulse>(await run('pulse.today', input));
const ids = (refs: { id: string }[]) => refs.map((ref) => ref.id);

interface Deposit {
  altitude?: number;
  scopes?: string[];
  status?: string;
  attrs?: Record<string, unknown>;
  body?: string;
  links?: { kind: string; to: string }[];
}
const deposit = (kind: string, title: string, more: Deposit = {}) =>
  idOf('deposits.write', { kind, title, altitude: 10000, scopes: kind === 'person' ? [] : ['logistics'], ...more });
const link = async (from: string, kind: string, to: string) => ok(await run('vault.link', { from, kind, to }));

describe('context.brief', () => {
  it('answers an empty vault with empty sections', async () => {
    for (const input of [{}, { focus: 'anything at all' }, { scopes: ['northwind'], altitude: 100 }]) {
      const result = await brief(input);
      expect(result).toMatchObject({
        centre: [],
        match: null,
        anchors: [],
        problems: [],
        ideas: [],
        decisions: [],
        metrics: [],
        people: [],
        commitments: [],
        evidence: [],
        assets: [],
      });
      expect(Object.values(result.more).every((n) => n === 0)).toBe(true);
    }
  });

  it('refuses unknown scopes and ids that do not exist', async () => {
    expect(failed(await run('context.brief', { scopes: ['nowhere'] })).code).toBe('invalid_input');
    expect(failed(await run('context.brief', { ids: ['prb_01JBX00000000000000000000A'] })).code).toBe('not_found');
    expect(failed(await run('context.brief', { altitude: 5000 })).code).toBe('invalid_input');
  });

  it('shows the altitude asked for and one level either side; anchors from every level above', async () => {
    const problems: Record<number, string> = {};
    for (const altitude of [50000, 10000, 1000, 100]) problems[altitude] = await deposit('problem', `Problem at ${altitude}`, { altitude });
    const company = await deposit('strategy', 'Win the mid-market freight lane', { altitude: 50000 });
    const surface = await deposit('principle', 'Every chart cites its source', { altitude: 1000 });
    const detail = await deposit('principle', 'Name tables in the singular', { altitude: 100 });

    const crossTeam = await brief({ altitude: 10000 });
    expect(crossTeam.altitudes).toEqual([50000, 10000, 1000]);
    expect(ids(crossTeam.problems).sort()).toEqual([problems[50000], problems[10000], problems[1000]].sort());
    // Anchors: everything at or above one level below; highest first.
    expect(ids(crossTeam.anchors)).toEqual([company, surface]);

    const engineer = await brief({ altitude: 100 });
    expect(engineer.altitudes).toEqual([1000, 100]);
    expect(ids(engineer.problems).sort()).toEqual([problems[1000], problems[100]].sort());
    expect(ids(engineer.anchors)).toEqual([company, surface, detail]);

    const top = await brief({ altitude: 50000 });
    expect(top.altitudes).toEqual([50000, 10000]);
    expect(ids(top.anchors)).toEqual([company]);
    expect(top.anchors[0]?.why).toEqual(['anchor']);
  });

  it('includes child scopes, and anchors of parent scopes', async () => {
    const child = await deposit('problem', 'Dispatchers cannot trace a load', { scopes: ['logistics'] });
    const parent = await deposit('problem', 'Churn in the analyst tier', { scopes: ['northwind'] });
    const elsewhere = await deposit('problem', 'Capture is slow', { scopes: ['bousleh'] });
    const companyStrategy = await deposit('strategy', 'Be the system of record for logistics', { altitude: 50000, scopes: ['northwind'] });
    await deposit('strategy', 'Voice first', { scopes: ['bousleh'] });

    const company = await brief({ scopes: ['northwind'] });
    expect(company.scopes).toEqual(['logistics', 'northwind']);
    expect(ids(company.problems).sort()).toEqual([child, parent].sort());
    expect(ids(company.problems)).not.toContain(elsewhere);
    expect(company.problems.find((p) => p.id === child)?.why).toEqual(['in scope logistics']);

    const product = await brief({ scopes: ['logistics'] });
    expect(product.scopes).toEqual(['logistics']);
    expect(ids(product.problems)).toEqual([child]);
    expect(product.anchors.map((a) => [a.id, a.why])).toEqual([[companyStrategy, ['anchor of parent scope northwind']]]);
  });

  it('walks one hop out from the ids it centres on, and finds the people and evidence around them', async () => {
    const alex = await deposit('person', 'Alex', { attrs: { role: 'pm' } });
    const rowan = await deposit('person', 'Rowan', { attrs: { role: 'stakeholder', org: 'Northwind' } });
    const jen = await deposit('person', 'Jen');
    const meeting = await deposit('meeting', 'Analyst council', { attrs: { held_at: '2026-10-19' } });
    await link(meeting, 'attended_by', rowan);

    const problem = await deposit('problem', 'Dispatchers cannot trace a load', {
      body: 'They rebuild the chain of sources by hand every week.',
      links: [{ kind: 'from_moment', to: meeting }],
    });
    await link(problem, 'owned_by', alex);
    const signal = await deposit('signal', 'Where did this claim start?', {
      altitude: 1000,
      links: [{ kind: 'evidence_for', to: problem }],
    });
    const decision = await deposit('decision', 'Build provenance first', {
      attrs: { decided_at: '2026-10-18' },
      links: [{ kind: 'related', to: problem }],
    });
    const observation = await deposit('observation', 'Two analysts built their own trackers', {
      links: [{ kind: 'related', to: decision }],
    });
    const twoHops = await deposit('idea', 'Auto-cite every chart', { links: [{ kind: 'related', to: decision }] });
    const commitment = await deposit('commitment', 'Send Rowan the provenance memo', {
      altitude: 1000,
      attrs: { due: '2026-10-28' },
      links: [
        { kind: 'related', to: problem },
        { kind: 'owed_by', to: alex },
        { kind: 'owed_to', to: rowan },
      ],
    });
    const unrelated = await deposit('problem', 'Exports time out');
    await deposit('commitment', 'Book the offsite', { links: [{ kind: 'owed_by', to: jen }] });

    const result = await brief({ ids: [problem] });
    expect(result.centre).toEqual([{ id: problem, kind: 'problem', title: 'Dispatchers cannot trace a load', why: 'asked for' }]);
    expect(result.problems).toEqual([
      expect.objectContaining({ id: problem, why: ['asked for'], snippet: 'They rebuild the chain of sources by hand every week.' }),
    ]);
    expect(ids(result.problems)).not.toContain(unrelated);
    expect(result.decisions).toEqual([
      expect.objectContaining({ id: decision, decided_at: '2026-10-18', why: ['linked to "Dispatchers cannot trace a load" (related)'] }),
    ]);
    // The idea is two hops out, through the decision.
    expect(result.ideas).toEqual([]);
    expect(ids(result.ideas)).not.toContain(twoHops);
    expect(result.commitments).toEqual([
      expect.objectContaining({
        id: commitment,
        due: '2026-10-28',
        size: 'major',
        owed_by: [{ id: alex, name: 'Alex' }],
        owed_to: [{ id: rowan, name: 'Rowan' }],
      }),
    ]);

    // Evidence: linked to the centre, and linked to what the brief shows.
    expect(result.evidence.map((e) => [e.id, e.why])).toEqual([
      [signal, ['evidence for "Dispatchers cannot trace a load"']],
      [observation, ['linked to "Build provenance first" (related)']],
    ]);

    // People: the owner, the attendee of the meeting it came from, the commitment's counterparties. Not Jen.
    const people = Object.fromEntries(result.people.map((p) => [p.title, p.why]));
    expect(Object.keys(people).sort()).toEqual(['Alex', 'Rowan']);
    expect(people.Alex).toEqual(['owns "Dispatchers cannot trace a load"', 'owes "Send Rowan the provenance memo"']);
    expect(people.Rowan).toEqual(['is owed "Send Rowan the provenance memo"', 'attended "Analyst council"']);
    expect(result.people.find((p) => p.title === 'Rowan')).toMatchObject({ role: 'stakeholder', org: 'Northwind' });
  });

  it('centres on the best matches for focus, and keeps them to the altitude band', async () => {
    const match = await deposit('problem', 'Provenance is lost between tools', { body: 'Nobody can say where a claim came from.' });
    const low = await deposit('problem', 'Provenance column is nullable', { altitude: 100 });
    const signal = await deposit('signal', 'Customer asked about provenance', { links: [{ kind: 'evidence_for', to: match }] });
    await deposit('problem', 'Exports time out');

    const result = await brief({ focus: 'provenance' });
    expect(result.match).toBe('all');
    expect(ids(result.centre).sort()).toEqual([match, signal].sort());
    expect(ids(result.problems)).toEqual([match]);
    expect(ids(result.problems)).not.toContain(low);
    expect(result.problems[0]?.snippet).toBeDefined();
    expect(result.evidence[0]?.why).toEqual(['matches focus', 'evidence for "Provenance is lost between tools"']);

    // Nothing matches: the brief covers the scopes as a whole.
    const fallback = await brief({ focus: 'zeppelin' });
    expect(fallback.centre).toEqual([]);
    expect(fallback.match).toBeNull();
    expect(fallback.problems).toHaveLength(2);
  });

  it('lists bets first with their hypothesis, leaves out replaced objects and closed work, and caps sections', async () => {
    const open = await deposit('idea', 'Weekly digest');
    const bet = await deposit('idea', 'Provenance graph', {
      status: 'bet',
      attrs: { hypothesis: 'Analysts trust traced claims more', kill_criteria: 'No lift in trust score by Q1' },
    });
    await deposit('idea', 'Parked idea', { status: 'parked' });
    const old = await deposit('decision', 'Use Neo4j', { attrs: { decided_at: '2026-09-01' } });
    const successor = await deposit('decision', 'Use SQLite plus links', { attrs: { decided_at: '2026-10-01' } });
    await link(successor, 'supersedes', old);
    const done = await deposit('commitment', 'Done already', { status: 'done' });
    const metric = await idOf('metrics.upsert', {
      title: 'Trust score',
      altitude: 10000,
      scopes: ['logistics'],
      cadence: 'weekly',
      unit: 'pts',
    });
    ok(await run('metrics.reading', { metric_id: metric, value: 42, observed_at: '2026-10-19' }));

    const result = await brief();
    expect(result.ideas.map((i) => [i.id, i.status, i.hypothesis])).toEqual([
      [bet, 'bet', 'Analysts trust traced claims more'],
      [open, 'open', null],
    ]);
    expect(result.ideas[0]?.kill_criteria).toBe('No lift in trust score by Q1');
    expect(ids(result.decisions)).toEqual([successor]);
    expect(ids(result.commitments)).not.toContain(done);
    expect(result.metrics).toEqual([
      expect.objectContaining({
        id: metric,
        cadence: 'weekly',
        unit: 'pts',
        latest_reading: { value: 42, unit: 'pts', observed_at: '2026-10-19' },
      }),
    ]);

    const capped = await brief({ limit: 1 });
    expect(capped.ideas).toHaveLength(1);
    expect(capped.more.ideas).toBe(1);
  });

  it('adds the metrics that serve the anchors it shows', async () => {
    const strategy = await deposit('strategy', 'Be the system of record', { altitude: 50000, scopes: ['northwind'] });
    const problem = await deposit('problem', 'Dispatchers cannot trace a load');
    const metric = await idOf('metrics.upsert', { title: 'Traced claims', altitude: 10000, scopes: ['northwind'], serves: strategy });

    const result = await brief({ ids: [problem] });
    expect(ids(result.anchors)).toEqual([strategy]);
    expect(result.anchors[0]?.why).toEqual(['anchor of parent scope northwind']);
    expect(result.metrics.map((m) => [m.id, m.why])).toEqual([[metric, ['serves "Be the system of record"']]]);
  });
});

describe('context.brief: initiatives and the people map', () => {
  it('lists initiatives one hop out from the centre, with status, dates and owner', async () => {
    const mira = await deposit('person', 'Mira', { attrs: { role: 'pm' } });
    const provenance = await deposit('initiative', 'Provenance everywhere', {
      attrs: { started_at: '2026-10-01', target_date: '2027-01-31' },
      links: [{ kind: 'owned_by', to: mira }],
    });
    const problem = await deposit('problem', 'Dispatchers cannot trace a load', { links: [{ kind: 'part_of', to: provenance }] });
    const unrelated = await deposit('initiative', 'Exports rework');

    const result = await brief({ ids: [problem] });
    expect(result.initiatives).toEqual([
      expect.objectContaining({
        id: provenance,
        kind: 'initiative',
        status: 'active',
        started_at: '2026-10-01',
        target_date: '2027-01-31',
        owner: { id: mira, name: 'Mira' },
        why: ['linked to "Dispatchers cannot trace a load" (part_of)'],
      }),
    ]);
    expect(ids(result.initiatives)).not.toContain(unrelated);
    // The owner is among the people involved.
    expect(result.people.find((p) => p.id === mira)?.why).toEqual(['owns "Provenance everywhere"']);
    expect(result.more.initiatives).toBe(0);
  });

  it('with no centre, lists the live initiatives in scope: active first, soonest target first', async () => {
    const later = await deposit('initiative', 'Later', { attrs: { target_date: '2027-06-30' } });
    const sooner = await deposit('initiative', 'Sooner', { attrs: { target_date: '2026-12-31' } });
    const proposed = await deposit('initiative', 'Maybe', { status: 'proposed' });
    const paused = await deposit('initiative', 'On hold', { status: 'paused' });
    const done = await deposit('initiative', 'Shipped', { status: 'done' });
    const dropped = await deposit('initiative', 'Abandoned', { status: 'dropped' });
    const elsewhere = await deposit('initiative', 'Elsewhere', { scopes: ['bousleh'] });

    const result = await brief({ scopes: ['northwind'] });
    expect(result.initiatives.map((i) => [i.id, i.status, i.owner])).toEqual([
      [sooner, 'active', null],
      [later, 'active', null],
      [proposed, 'proposed', null],
      [paused, 'paused', null],
    ]);
    expect(result.initiatives[0]?.why).toEqual(['in scope logistics']);
    for (const left of [done, dropped, elsewhere]) expect(ids(result.initiatives)).not.toContain(left);

    // Asked for, a done initiative is shown.
    const centred = await brief({ ids: [done] });
    expect(centred.initiatives.map((i) => [i.id, i.status])).toEqual([[done, 'done']]);
  });

  it('says who each person reports to', async () => {
    const rowan = await deposit('person', 'Rowan', { attrs: { role: 'stakeholder' } });
    const mira = await deposit('person', 'Mira', { attrs: { role: 'pm' }, links: [{ kind: 'reports_to', to: rowan }] });
    const sam = await deposit('person', 'Sam', { attrs: { role: 'engineer' } });
    const meeting = await deposit('meeting', 'Provenance sync', { attrs: { held_at: '2026-10-19' } });
    await link(meeting, 'attended_by', mira);
    await link(meeting, 'attended_by', sam);

    const result = await brief({ ids: [meeting] });
    const people = Object.fromEntries(result.people.map((p) => [p.title, p]));
    expect(people.Mira?.reports_to).toEqual({ id: rowan, name: 'Rowan' });
    expect(people.Sam?.reports_to).toBeNull();

    const aroundMira = await brief({ ids: [mira] });
    expect(aroundMira.people.find((p) => p.id === mira)?.reports_to).toEqual({ id: rowan, name: 'Rowan' });
    expect(aroundMira.people.find((p) => p.id === rowan)?.why).toEqual(['"Mira" reports to them']);
  });

  it('orders ideas of the same status by rank', async () => {
    const third = await deposit('idea', 'Third', { attrs: { rank: 3 } });
    const unranked = await deposit('idea', 'Unranked');
    const first = await deposit('idea', 'First', { attrs: { rank: 1 } });
    const result = await brief();
    expect(result.ideas.map((i) => [i.id, i.rank])).toEqual([
      [first, 1],
      [third, 3],
      [unranked, null],
    ]);
  });
});

describe('statuses: solved and dropped problems, running ideas', () => {
  it('leaves solved and dropped problems out with no centre, and shows them with their status near the centre', async () => {
    const open = await deposit('problem', 'Dispatchers cannot trace a load');
    const solved = await deposit('problem', 'Exports time out', { status: 'solved' });
    const dropped = await deposit('problem', 'Nobody reads the weekly email', { status: 'dropped' });
    const decision = await deposit('decision', 'Stream exports', { links: [{ kind: 'related', to: solved }] });

    const whole = await brief();
    expect(whole.problems.map((p) => [p.id, p.status])).toEqual([[open, 'open']]);

    // In the centre, or one hop out from it, they show with their status.
    expect((await brief({ ids: [solved] })).problems.map((p) => [p.id, p.status])).toEqual([[solved, 'solved']]);
    const near = await brief({ ids: [decision] });
    expect(near.problems.map((p) => [p.id, p.status])).toEqual([[solved, 'solved']]);
    // Open first, then solved, then dropped.
    ok(await run('vault.link', { from: decision, kind: 'related', to: dropped }));
    ok(await run('vault.link', { from: decision, kind: 'related', to: open }));
    expect((await brief({ ids: [decision] })).problems.map((p) => p.status)).toEqual(['open', 'solved', 'dropped']);
  });

  it('lists running ideas right after bets, and keeps them with no centre', async () => {
    const open = await deposit('idea', 'Weekly digest');
    const running = await deposit('idea', 'Provenance spike', { status: 'running' });
    const bet = await deposit('idea', 'Provenance graph', { status: 'bet', attrs: { hypothesis: 'h', kill_criteria: 'k' } });
    await deposit('idea', 'Parked idea', { status: 'parked' });

    expect((await brief()).ideas.map((i) => [i.id, i.status])).toEqual([
      [bet, 'bet'],
      [running, 'running'],
      [open, 'open'],
    ]);
  });

  it('concludes a running idea with a decision, but never an open one', async () => {
    const running = await deposit('idea', 'Provenance spike');
    ok(await run('vault.supersede', { id: running, status: 'running' }));
    await deposit('decision', 'The spike worked: build it', { links: [{ kind: 'concludes', to: running }] });
    const idea = ok<OpOutput<'vault.get'>>(await run('vault.get', { id: running }));
    expect(idea.version).toMatchObject({ status: 'concluded', attrs: {} });
    // A concluded idea from running still takes a new rank, and stays concluded.
    ok(await run('vault.supersede', { id: running, attrs: { rank: 2 } }));
    expect(failed(await run('vault.supersede', { id: running, status: 'running' })).code).toBe('invalid_input');

    const open = await deposit('idea', 'Still open');
    const other = await deposit('decision', 'Not yet');
    expect(failed(await run('vault.link', { from: other, kind: 'concludes', to: open })).code).toBe('conflict');
    // concluded stays reserved.
    expect(failed(await run('vault.supersede', { id: open, status: 'concluded' })).code).toBe('invalid_input');
  });

  it('lists running ideas in pulse with the bets, each with its status, bets first', async () => {
    const running = await deposit('idea', 'Provenance spike', { status: 'running' });
    const bet = await deposit('idea', 'Provenance graph', { status: 'bet', attrs: { hypothesis: 'h', kill_criteria: 'k' } });
    await deposit('idea', 'Still open');
    const result = await pulse({ date: '2026-10-25' });
    expect(result.open_bets.map((b) => [b.id, b.status, b.hypothesis])).toEqual([
      [bet, 'bet', 'h'],
      [running, 'running', null],
    ]);
  });
});

describe('pulse.today', () => {
  it('answers an empty vault', async () => {
    at(2026, 10, 25, 9);
    const result = await pulse();
    expect(result).toMatchObject({
      date: '2026-10-25',
      scopes: [],
      me: null,
      commitments: {
        overdue: { by_me: [], to_me: [], other: [] },
        due_today: { by_me: [], to_me: [], other: [] },
        no_due: { by_me: [], to_me: [], more: { by_me: 0, to_me: 0 }, minor: { by_me: 0, to_me: 0 } },
        open: { by_me: 0, to_me: 0, other: 0 },
        snoozed: { by_me: 0, to_me: 0, other: 0, next: null },
      },
      focus: [],
      focus_more: 0,
      meetings: [],
      inbox: { waiting: 0, oldest_arrived_at: null, queued: 0 },
      stale_metrics: [],
      new_findings: { total: 0, findings: [] },
      metric_movement: [],
      touchpoints_due: [],
      open_bets: [],
    });
  });

  it('lists metrics whose last reading moved, most recently read first', async () => {
    const metric = (title: string, scopes = ['logistics']) =>
      idOf('metrics.upsert', { title, altitude: 10000, scopes, status: 'measured', unit: 'pts', cadence: 'weekly' });
    const reading = (metric_id: string, value: number, observed_at: string) =>
      run('metrics.reading', { metric_id, value, observed_at }).then(ok);
    const up = await metric('Trust score');
    const down = await metric('Time to first chart');
    const flat = await metric('Flat');
    const single = await metric('Only one reading');
    const elsewhere = await metric('Elsewhere', ['bousleh']);
    await reading(up, 40, '2026-10-11');
    await reading(up, 42, '2026-10-18');
    await reading(down, 9, '2026-10-12');
    await reading(down, 8, '2026-10-19');
    await reading(flat, 5, '2026-10-11');
    await reading(flat, 5, '2026-10-18');
    await reading(single, 1, '2026-10-18');
    await reading(elsewhere, 1, '2026-10-11');
    await reading(elsewhere, 2, '2026-10-18');

    at(2026, 10, 25, 9);
    const result = await pulse({ scopes: ['northwind'] });
    expect(result.metric_movement.map((m) => [m.id, m.delta])).toEqual([
      [down, -1],
      [up, 2],
    ]);
    expect(result.metric_movement[1]).toMatchObject({
      title: 'Trust score',
      unit: 'pts',
      latest_reading: { value: 42, unit: 'pts', observed_at: '2026-10-18' },
      previous_reading: { value: 40, observed_at: '2026-10-11' },
    });
    // Read on the same day: by title.
    expect(ids((await pulse()).metric_movement)).toEqual([down, elsewhere, up]);
  });

  it('lists the stakeholders, PMs and engineers not touched for more than 14 days, never touched first', async () => {
    const alex = await deposit('person', 'Alex', { attrs: { role: 'pm', is_user: true } });
    const sam = await deposit('person', 'Sam', { attrs: { role: 'engineer' }, scopes: ['logistics'] });
    const mira = await deposit('person', 'Mira', { attrs: { role: 'pm' }, scopes: ['logistics'] });
    const jo = await deposit('person', 'Jo', { attrs: { role: 'pm' }, scopes: ['logistics'] });
    const rowan = await deposit('person', 'Rowan', { attrs: { role: 'stakeholder' }, scopes: ['logistics'] });
    await deposit('person', 'Ana', { attrs: { role: 'analyst' }, scopes: ['logistics'] });
    await deposit('person', 'Outside', { attrs: { role: 'pm' }, scopes: ['bousleh'] });
    const meeting = (title: string, held_at: string, who: string) =>
      deposit('meeting', title, { altitude: 1000, attrs: { held_at }, links: [{ kind: 'attended_by', to: who }] });
    const miraMeeting = await meeting('Mira 1:1', '2026-10-05', mira);
    // Exactly 14 days before: not due yet. A late-evening meeting counts on its local day.
    await meeting('Jo 1:1', new Date(2026, 9, 11, 23, 30).toISOString(), jo);
    await deposit('observation', 'Rowan wants weekly numbers', { links: [{ kind: 'about', to: rowan }] });
    await meeting('Alex alone', '2026-09-01', alex);

    at(2026, 10, 25, 9);
    const result = await pulse({ scopes: ['northwind'] });
    expect(result.touchpoints_due.map((p) => [p.name, p.days_since])).toEqual([
      ['Sam', null],
      ['Mira', 20],
    ]);
    expect(result.touchpoints_due[0]).toMatchObject({ id: sam, role: 'engineer', last_touchpoint: null });
    expect(result.touchpoints_due[1]?.last_touchpoint).toEqual({
      at: '2026-10-05',
      via: 'attended',
      object: { id: miraMeeting, kind: 'meeting', title: 'Mira 1:1' },
    });
    expect((await pulse()).touchpoints_due.map((p) => p.name)).toEqual(['Outside', 'Sam', 'Mira']);
    expect((await pulse({ date: '2026-10-26', scopes: ['northwind'] })).touchpoints_due.map((p) => p.name)).toEqual(['Sam', 'Mira', 'Jo']);
  });

  it('buckets commitments by due day and direction', async () => {
    const alex = await deposit('person', 'Alex');
    const rowan = await deposit('person', 'Rowan');
    const jen = await deposit('person', 'Jen');
    const commit = (title: string, due: string | undefined, by: string, to: string, more: Deposit = {}) =>
      deposit('commitment', title, {
        altitude: 1000,
        ...(due ? { attrs: { due } } : {}),
        links: [
          { kind: 'owed_by', to: by },
          { kind: 'owed_to', to: to },
        ],
        ...more,
      });
    const yesterday = await commit('Send the memo', '2026-10-24', alex, rowan);
    const lastWeek = await commit('Intro to the data team', '2026-10-20', rowan, alex);
    const today = await commit('Review the spec', '2026-10-25', alex, rowan);
    const sam = await deposit('person', 'Sam');
    const othersToday = await commit('Jen sends Sam the deck', '2026-10-25', jen, sam);
    await commit('Book the offsite', '2026-10-26', alex, jen);
    await commit('Someday', undefined, rowan, alex);
    await commit('Closed', '2026-10-24', alex, rowan, { status: 'done' });
    await commit('Elsewhere', '2026-10-24', alex, rowan, { scopes: ['bousleh'] });

    at(2026, 10, 25, 23, 59);
    const result = await pulse({ me: alex, scopes: ['northwind'] });
    expect(result.date).toBe('2026-10-25');
    expect(result.me).toEqual({ id: alex, name: 'Alex', inferred: false });
    expect(result.commitments.overdue.by_me.map((c) => [c.id, c.days_late])).toEqual([[yesterday, 1]]);
    expect(result.commitments.overdue.to_me.map((c) => [c.id, c.days_late])).toEqual([[lastWeek, 5]]);
    expect(ids(result.commitments.due_today.by_me)).toEqual([today]);
    expect(ids(result.commitments.due_today.other)).toEqual([othersToday]);
    expect(result.commitments.open).toEqual({ by_me: 3, to_me: 2, other: 1 });

    // Without me, the person on the most open commitments is taken as me.
    expect((await pulse()).me).toEqual({ id: alex, name: 'Alex', inferred: true });
    // Marked as the user, he is me without being passed, and not inferred.
    ok(await run('vault.supersede', { id: alex, attrs: { is_user: true } }));
    expect((await pulse()).me).toEqual({ id: alex, name: 'Alex', inferred: false });
    // Only one person can be the user.
    expect(failed(await run('vault.supersede', { id: jen, attrs: { is_user: true } })).code).toBe('conflict');
    expect(failed(await run('deposits.write', { kind: 'person', title: 'Other me', altitude: 10000, attrs: { is_user: true } })).code).toBe(
      'conflict',
    );
    // Unmarking frees the flag.
    ok(await run('vault.supersede', { id: alex, attrs: { is_user: null } }));
    ok(await run('vault.supersede', { id: jen, attrs: { is_user: true } }));
    expect((await pulse()).me).toMatchObject({ id: jen, inferred: false });
    // A past date moves the boundary: on Oct 24 the memo is due today, not overdue.
    const before = await pulse({ me: alex, date: '2026-10-24', scopes: ['northwind'] });
    expect(ids(before.commitments.due_today.by_me)).toEqual([yesterday]);
    expect(ids(before.commitments.overdue.by_me)).toEqual([]);
    expect(failed(await run('pulse.today', { me: yesterday })).code).toBe('invalid_input');
  });

  it('lists open commitments with no due date, by me and to me, oldest first, capped', async () => {
    const alex = await deposit('person', 'Alex', { attrs: { is_user: true } });
    const rowan = await deposit('person', 'Rowan');
    const jen = await deposit('person', 'Jen');
    const commit = (title: string, by: string, to: string, more: Deposit = {}) =>
      deposit('commitment', title, {
        altitude: 1000,
        links: [
          { kind: 'owed_by', to: by },
          { kind: 'owed_to', to: to },
        ],
        ...more,
      });
    const oldest = await commit('Write up the Harbor roles', alex, rowan);
    const owedToMe = await commit('Rowan sends the org chart', rowan, alex);
    await commit('Jen owes Rowan a reply', jen, rowan);
    await commit('Dated', alex, rowan, { attrs: { due: '2026-11-30' } });
    await commit('Closed', alex, rowan, { status: 'done' });
    await commit('Elsewhere', alex, rowan, { scopes: ['bousleh'] });
    const more: string[] = [];
    for (let i = 1; i <= 10; i += 1) more.push(await commit(`Later ${i}`, alex, jen));

    const result = await pulse({ date: '2026-10-25', scopes: ['northwind'] });
    expect(ids(result.commitments.no_due.by_me)).toEqual([oldest, ...more.slice(0, 9)]);
    expect(result.commitments.no_due.more).toEqual({ by_me: 1, to_me: 0 });
    expect(ids(result.commitments.no_due.to_me)).toEqual([owedToMe]);
    expect(result.commitments.no_due.by_me[0]).toMatchObject({
      title: 'Write up the Harbor roles',
      due: null,
      owed_by: [{ id: alex, name: 'Alex' }],
      owed_to: [{ id: rowan, name: 'Rowan' }],
      filed_at: expect.any(String),
    });
    // Between other people: counted, not listed.
    expect(result.commitments.open).toEqual({ by_me: 12, to_me: 1, other: 1 });
    // Nothing is due today or overdue, so these were invisible before.
    expect(result.commitments.overdue.by_me).toEqual([]);
    expect(result.commitments.due_today.by_me).toEqual([]);
  });

  it("lists the day's meetings by held_at, on this machine's clock", async () => {
    const rowan = await deposit('person', 'Rowan');
    const local = (d: number, h: number, min: number) => new Date(2026, 9, d, h, min).toISOString();
    const meeting = (title: string, held_at: string) => deposit('meeting', title, { altitude: 1000, attrs: { held_at } });
    await meeting('Late the night before', local(24, 23, 30));
    const midnight = await meeting('Midnight standup', local(25, 0, 0));
    const allDay = await meeting('Offsite', '2026-10-25');
    const lastMinute = await meeting('Last call', local(25, 23, 59));
    await meeting('Next morning', local(26, 0, 0));
    await meeting('Tomorrow', '2026-10-26');
    await link(midnight, 'attended_by', rowan);

    const result = await pulse({ date: '2026-10-25' });
    expect(ids(result.meetings)).toEqual([allDay, midnight, lastMinute]);
    expect(result.meetings[1]?.attendees).toEqual([{ id: rowan, name: 'Rowan' }]);
    expect(result.meetings.map((m) => m.status)).toEqual(['held', 'held', 'held']);
  });

  it('shows a planned meeting with its status, so its prep is easy to find', async () => {
    const planned = await deposit('meeting', '1:1 with Rowan', { status: 'planned', altitude: 1000, attrs: { held_at: '2026-10-25' } });
    const result = await pulse({ date: '2026-10-25' });
    expect(result.meetings.map((m) => [m.id, m.status])).toEqual([[planned, 'planned']]);
  });

  it('keeps snoozed commitments out until their day, then shows them as due on it', async () => {
    const alex = await deposit('person', 'Alex', { attrs: { is_user: true } });
    const rowan = await deposit('person', 'Rowan');
    const ian = await deposit('person', 'Ian');
    const commit = (title: string, by: string, to: string, attrs: Record<string, unknown> = {}) =>
      deposit('commitment', title, {
        altitude: 1000,
        attrs,
        links: [
          { kind: 'owed_by', to: by },
          { kind: 'owed_to', to: to },
        ],
      });
    // Ian's reply on the metering doc: Alex wants to hear about it only on the 28th.
    const followUp = await commit('Ian replies on the metering doc', ian, alex, { surface_on: '2026-10-28' });
    // Overdue, but snoozed: out of sight until the 27th, then overdue again.
    const asleep = await commit('Send Rowan the memo', alex, rowan, { due: '2026-10-22', surface_on: '2026-10-27' });
    const wakesToday = await commit('Check the export numbers', alex, rowan, { surface_on: '2026-10-25' });
    const wokeEarlier = await commit('Ian sends the schema', ian, alex, { surface_on: '2026-10-23' });
    const undated = await commit('Write up the roles', alex, rowan);

    const result = await pulse({ date: '2026-10-25', scopes: ['northwind'] });
    expect(result.commitments.overdue.by_me).toEqual([]);
    expect(result.commitments.overdue.to_me.map((c) => [c.id, c.days_late])).toEqual([[wokeEarlier, 2]]);
    expect(ids(result.commitments.due_today.by_me)).toEqual([wakesToday]);
    expect(result.commitments.due_today.by_me[0]).toMatchObject({ due: null, surface_on: '2026-10-25', days_late: 0 });
    expect(ids(result.commitments.no_due.by_me)).toEqual([undated]);
    expect(result.commitments.no_due.to_me).toEqual([]);
    expect(result.commitments.open).toEqual({ by_me: 2, to_me: 1, other: 0 });
    expect(result.commitments.snoozed).toEqual({
      by_me: 1,
      to_me: 1,
      other: 0,
      next: { id: asleep, title: 'Send Rowan the memo', surface_on: '2026-10-27' },
    });
    expect(ids(result.focus)).not.toContain(followUp);
    expect(ids(result.focus)).not.toContain(asleep);

    // On the 28th both are back: the memo overdue from its own due date, Ian's reply due that day.
    const later = await pulse({ date: '2026-10-28', scopes: ['northwind'] });
    expect(later.commitments.overdue.by_me.map((c) => [c.id, c.days_late])).toEqual([
      [asleep, 6],
      [wakesToday, 3],
    ]);
    expect(ids(later.commitments.due_today.to_me)).toEqual([followUp]);
    expect(later.commitments.snoozed).toEqual({ by_me: 0, to_me: 0, other: 0, next: null });

    // The strata leaves snoozed ones off the grid, and flags the ones back from a snooze, whichever way they're owed.
    const strata = ok<OpOutput<'context.strata'>>(await run('context.strata', { date: '2026-10-25' }));
    const shown = new Map(strata.cells.flatMap((c) => c.objects).map((o) => [o.id, o]));
    expect(shown.has(followUp)).toBe(false);
    expect(shown.has(asleep)).toBe(false);
    expect(shown.get(wakesToday)).toMatchObject({ needs_you: true, surface_on: '2026-10-25', owed: 'by_me' });
    expect(shown.get(wokeEarlier)).toMatchObject({ needs_you: true, surface_on: '2026-10-23', owed: 'to_me' });
    expect(shown.get(undated)).toMatchObject({ needs_you: true });
    expect(shown.get(undated)?.surface_on).toBeUndefined();
  });

  it('ranks a few things to do first: late, soon, who for, who I see today, bets, and planned meetings', async () => {
    const rowan = await deposit('person', 'Rowan', { attrs: { role: 'stakeholder' } });
    const alex = await deposit('person', 'Alex', { attrs: { role: 'pm', is_user: true }, links: [{ kind: 'reports_to', to: rowan }] });
    const mira = await deposit('person', 'Mira', { attrs: { role: 'stakeholder' } });
    const jen = await deposit('person', 'Jen', { attrs: { role: 'pm' } });
    const ian = await deposit('person', 'Ian', { attrs: { role: 'engineer' } });
    const commit = (title: string, by: string, to: string, attrs: Record<string, unknown>, altitude = 1000) =>
      deposit('commitment', title, {
        altitude,
        attrs,
        links: [
          { kind: 'owed_by', to: by },
          { kind: 'owed_to', to: to },
        ],
      });
    const late = await commit('Send Rowan the one-pager', alex, rowan, { due: '2026-10-23' });
    const today = await commit("Review Jen's spec", alex, jen, { due: '2026-10-25' });
    const soon = await commit('Draft the customer report', alex, mira, { due: '2026-10-27' }, 10000);
    const followUp = await commit('Ian replies on the metering doc', ian, alex, { surface_on: '2026-10-25' });
    await commit('Jen owes Ian a review', jen, ian, { due: '2026-10-20' });
    await deposit('idea', 'Customer learnings loop', { status: 'running', links: [{ kind: 'related', to: soon }] });
    const sync = await deposit('meeting', 'Mira sync', {
      status: 'planned',
      altitude: 1000,
      attrs: { held_at: '2026-10-25' },
      links: [
        { kind: 'attended_by', to: mira },
        { kind: 'attended_by', to: alex },
      ],
    });

    const result = await pulse({ date: '2026-10-25', scopes: ['northwind'] });
    expect(ids(result.focus)).toEqual([late, soon, sync]);
    expect(result.focus_more).toBe(2);
    expect(result.focus[0]).toMatchObject({
      kind: 'commitment',
      owed: 'by_me',
      when: '2026-10-23',
      people: [{ id: rowan, name: 'Rowan' }],
      why: ['2 days late', 'owed to Rowan, your manager'],
    });
    expect(result.focus[1]?.why).toEqual([
      'due in 2 days',
      'owed to Mira, a stakeholder',
      'you see Mira today',
      'part of the running idea "Customer learnings loop"',
    ]);
    expect(result.focus[2]).toMatchObject({
      kind: 'meeting',
      owed: null,
      when: '2026-10-25',
      people: [{ id: mira, name: 'Mira' }],
      why: ['today', 'no prep yet', 'with Mira, a stakeholder'],
    });
    // Scores are strictly ordered.
    const scores = result.focus.map((f) => f.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);

    // With the meeting prepped and the first two closed, today's work and the follow-up come up.
    ok(await run('vault.supersede', { id: sync, body: 'Ask Mira which customers to interview first, and what she needs by Friday.' }));
    ok(await run('commitments.close', { id: late, status: 'done' }));
    ok(await run('commitments.close', { id: soon, status: 'done' }));
    const next = await pulse({ date: '2026-10-25', scopes: ['northwind'] });
    expect(ids(next.focus)).toEqual([today, sync, followUp]);
    expect(next.focus[1]?.why).toEqual(['today', 'prep ready to review', 'with Mira, a stakeholder']);
    expect(next.focus[2]).toMatchObject({ owed: 'to_me', why: ['follow up with Ian', 'back from snooze today'] });
    expect(next.focus_more).toBe(0);
  });

  it('brings an undated commitment I owe into focus once it has sat for over a week', async () => {
    const alex = await deposit('person', 'Alex', { attrs: { is_user: true } });
    const rowan = await deposit('person', 'Rowan');
    const undated = await deposit('commitment', 'Write up the roles', {
      altitude: 1000,
      links: [
        { kind: 'owed_by', to: alex },
        { kind: 'owed_to', to: rowan },
      ],
    });
    expect((await pulse({ date: '2026-10-27' })).focus).toEqual([]);
    const later = await pulse({ date: '2026-11-05' });
    expect(later.focus).toMatchObject([{ id: undated, owed: 'by_me', when: null, why: ['no due date for 16 days'] }]);
  });

  it('ranks a minor commitment below an equally late major one, and never brings an undated minor one into focus', async () => {
    const alex = await deposit('person', 'Alex', { attrs: { is_user: true } });
    const rowan = await deposit('person', 'Rowan');
    const commit = (title: string, attrs: Record<string, unknown>) =>
      deposit('commitment', title, {
        altitude: 1000,
        attrs,
        links: [
          { kind: 'owed_by', to: alex },
          { kind: 'owed_to', to: rowan },
        ],
      });
    const ask = await commit('Ask Rowan about the offsite', { due: '2026-10-23', size: 'minor' });
    const roadmap = await commit('Finalize the Q1 roadmap', { due: '2026-10-23', size: 'major' });
    const share = await commit('Share the deck with Jen', { size: 'minor' });
    const plan = await commit('Write the launch plan', {});

    // Two weeks on, both undated ones have sat long enough, but only the major one is a candidate.
    const result = await pulse({ date: '2026-11-04' });
    expect(ids(result.focus)).toEqual([roadmap, ask, plan]);
    expect(result.focus_more).toBe(0);
    expect(ids(result.focus)).not.toContain(share);
    const [major, minor] = result.focus;
    expect(major).toMatchObject({ size: 'major', why: ['12 days late'] });
    expect(minor).toMatchObject({ size: 'minor', why: ['12 days late', 'small follow-up'] });
    expect((major?.score ?? 0) - (minor?.score ?? 0)).toBe(25);
    // A commitment filed without a size reads as major.
    expect(result.focus[2]).toMatchObject({ id: plan, size: 'major' });

    // Undated: only the major one is listed; the minor one is counted.
    expect(ids(result.commitments.no_due.by_me)).toEqual([plan]);
    expect(result.commitments.no_due.minor).toEqual({ by_me: 1, to_me: 0 });
    // Overdue lists both sizes, each tagged.
    expect(result.commitments.overdue.by_me.map((c) => [c.id, c.size])).toEqual([
      [ask, 'minor'],
      [roadmap, 'major'],
    ]);
    expect(result.commitments.open).toEqual({ by_me: 4, to_me: 0, other: 0 });
  });

  it('counts the inbox and the queue', async () => {
    mkdirSync(join(home, 'inbox'), { recursive: true });
    writeFileSync(join(home, 'inbox', 'one.md'), 'A phone capture.');
    writeFileSync(join(home, 'inbox', 'two.md'), 'Another.');
    ok(await run('queue.add', { draft: { title: 'Unplaced thought' }, reason: 'No scope yet.' }));

    const result = await pulse();
    expect(result.inbox.waiting).toBe(2);
    expect(result.inbox.oldest_arrived_at).not.toBeNull();
    expect(result.inbox.queued).toBe(1);
  });

  it('flags metrics in use with no reading within their cadence', async () => {
    const metric = async (title: string, status: string, cadence: string | null, observed?: string) => {
      const id = await idOf('metrics.upsert', {
        title,
        status,
        altitude: 10000,
        scopes: ['logistics'],
        ...(cadence ? { cadence } : {}),
      });
      if (observed) ok(await run('metrics.reading', { metric_id: id, value: 1, observed_at: observed }));
      return id;
    };
    await metric('Weekly, read a week ago', 'measured', 'weekly', '2026-10-18');
    const weeklyLate = await metric('Weekly, read eight days ago', 'measured', 'weekly', '2026-10-17');
    await metric('Daily, read yesterday', 'instrumented', 'daily', '2026-10-24');
    const never = await metric('Monthly, never read', 'reviewed', 'monthly');
    await metric('Just an idea', 'idea', 'daily');
    const noCadenceLate = await metric('No cadence, 31 days', 'measured', null, '2026-09-24');
    await metric('No cadence, 30 days', 'measured', null, '2026-09-25');

    const result = await pulse({ date: '2026-10-25' });
    expect(result.stale_metrics.map((m) => [m.id, m.days_since, m.expected_within_days])).toEqual([
      [never, null, 31],
      [noCadenceLate, 31, 30],
      [weeklyLate, 8, 7],
    ]);
  });

  it('lists findings filed since the start of the day before, and open bets', async () => {
    ok(await run('watchlists.set', { scope: 'logistics', entries: [{ type: 'competitor', name: 'Graphika' }] }));
    const file = async (title: string) =>
      ok<{ filed: { id: string }[] }>(
        await run('watch.file', { scope: 'logistics', findings: [{ title, url: `https://example.com/${encodeURIComponent(title)}` }] }),
      ).filed[0]?.id as string;
    at(2026, 10, 23, 23, 59);
    await file('Two days ago');
    at(2026, 10, 24, 0, 0);
    const startOfYesterday = await file('Just after midnight yesterday');
    at(2026, 10, 25, 12, 0);
    const today = await file('Today at noon');
    at(2026, 10, 26, 0, 0);
    await file('Tomorrow');

    const bet = await deposit('idea', 'Provenance graph', { status: 'bet', attrs: { hypothesis: 'h', kill_criteria: 'k' } });
    await deposit('idea', 'Still open');
    await deposit('idea', 'Elsewhere', { status: 'bet', scopes: ['bousleh'], attrs: { hypothesis: 'h', kill_criteria: 'k' } });

    const result = await pulse({ date: '2026-10-25', scopes: ['northwind'] });
    expect(result.new_findings.since).toBe(new Date(2026, 9, 24).toISOString());
    expect(ids(result.new_findings.findings)).toEqual([today, startOfYesterday]);
    expect(result.new_findings.findings[0]?.watch_list?.title).toBeDefined();
    expect(result.open_bets).toEqual([expect.objectContaining({ id: bet, hypothesis: 'h', kill_criteria: 'k' })]);
    expect((await pulse({ date: '2026-10-25', scopes: ['bousleh'] })).new_findings.findings).toEqual([]);
  });
});
