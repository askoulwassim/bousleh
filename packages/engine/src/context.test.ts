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
  ok(await run('scopes.add', { slug: 'alethea', name: 'Alethea', kind: 'company' }));
  ok(await run('scopes.add', { slug: 'narratives', name: 'Narratives', kind: 'product', parent: 'alethea' }));
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
  idOf('deposits.write', { kind, title, altitude: 10000, scopes: kind === 'person' ? [] : ['narratives'], ...more });
const link = async (from: string, kind: string, to: string) => ok(await run('vault.link', { from, kind, to }));

describe('context.brief', () => {
  it('answers an empty vault with empty sections', async () => {
    for (const input of [{}, { focus: 'anything at all' }, { scopes: ['alethea'], altitude: 100 }]) {
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
    const company = await deposit('strategy', 'Win the narrative market', { altitude: 50000 });
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
    const child = await deposit('problem', 'Analysts cannot trace a narrative', { scopes: ['narratives'] });
    const parent = await deposit('problem', 'Churn in the analyst tier', { scopes: ['alethea'] });
    const elsewhere = await deposit('problem', 'Capture is slow', { scopes: ['bousleh'] });
    const companyStrategy = await deposit('strategy', 'Be the system of record for narratives', { altitude: 50000, scopes: ['alethea'] });
    await deposit('strategy', 'Voice first', { scopes: ['bousleh'] });

    const company = await brief({ scopes: ['alethea'] });
    expect(company.scopes).toEqual(['alethea', 'narratives']);
    expect(ids(company.problems).sort()).toEqual([child, parent].sort());
    expect(ids(company.problems)).not.toContain(elsewhere);
    expect(company.problems.find((p) => p.id === child)?.why).toEqual(['in scope narratives']);

    const product = await brief({ scopes: ['narratives'] });
    expect(product.scopes).toEqual(['narratives']);
    expect(ids(product.problems)).toEqual([child]);
    expect(product.anchors.map((a) => [a.id, a.why])).toEqual([[companyStrategy, ['anchor of parent scope alethea']]]);
  });

  it('walks one hop out from the ids it centres on, and finds the people and evidence around them', async () => {
    const wassim = await deposit('person', 'Wassim', { attrs: { role: 'pm' } });
    const peter = await deposit('person', 'Peter', { attrs: { role: 'stakeholder', org: 'Alethea' } });
    const jen = await deposit('person', 'Jen');
    const meeting = await deposit('meeting', 'Analyst council', { attrs: { held_at: '2026-10-19' } });
    await link(meeting, 'attended_by', peter);

    const problem = await deposit('problem', 'Analysts cannot trace a narrative', {
      body: 'They rebuild the chain of sources by hand every week.',
      links: [{ kind: 'from_moment', to: meeting }],
    });
    await link(problem, 'owned_by', wassim);
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
    const commitment = await deposit('commitment', 'Send Peter the provenance memo', {
      altitude: 1000,
      attrs: { due: '2026-10-28' },
      links: [
        { kind: 'related', to: problem },
        { kind: 'owed_by', to: wassim },
        { kind: 'owed_to', to: peter },
      ],
    });
    const unrelated = await deposit('problem', 'Exports time out');
    await deposit('commitment', 'Book the offsite', { links: [{ kind: 'owed_by', to: jen }] });

    const result = await brief({ ids: [problem] });
    expect(result.centre).toEqual([{ id: problem, kind: 'problem', title: 'Analysts cannot trace a narrative', why: 'asked for' }]);
    expect(result.problems).toEqual([
      expect.objectContaining({ id: problem, why: ['asked for'], snippet: 'They rebuild the chain of sources by hand every week.' }),
    ]);
    expect(ids(result.problems)).not.toContain(unrelated);
    expect(result.decisions).toEqual([
      expect.objectContaining({ id: decision, decided_at: '2026-10-18', why: ['linked to "Analysts cannot trace a narrative" (related)'] }),
    ]);
    // The idea is two hops out, through the decision.
    expect(result.ideas).toEqual([]);
    expect(ids(result.ideas)).not.toContain(twoHops);
    expect(result.commitments).toEqual([
      expect.objectContaining({
        id: commitment,
        due: '2026-10-28',
        owed_by: [{ id: wassim, name: 'Wassim' }],
        owed_to: [{ id: peter, name: 'Peter' }],
      }),
    ]);

    // Evidence: linked to the centre, and linked to what the brief shows.
    expect(result.evidence.map((e) => [e.id, e.why])).toEqual([
      [signal, ['evidence for "Analysts cannot trace a narrative"']],
      [observation, ['linked to "Build provenance first" (related)']],
    ]);

    // People: the owner, the attendee of the meeting it came from, the commitment's counterparties. Not Jen.
    const people = Object.fromEntries(result.people.map((p) => [p.title, p.why]));
    expect(Object.keys(people).sort()).toEqual(['Peter', 'Wassim']);
    expect(people.Wassim).toEqual(['owns "Analysts cannot trace a narrative"', 'owes "Send Peter the provenance memo"']);
    expect(people.Peter).toEqual(['is owed "Send Peter the provenance memo"', 'attended "Analyst council"']);
    expect(result.people.find((p) => p.title === 'Peter')).toMatchObject({ role: 'stakeholder', org: 'Alethea' });
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
    const replacement = await deposit('decision', 'Use SQLite plus links', { attrs: { decided_at: '2026-10-01' } });
    await link(replacement, 'supersedes', old);
    const done = await deposit('commitment', 'Done already', { status: 'done' });
    const metric = await idOf('metrics.upsert', {
      title: 'Trust score',
      altitude: 10000,
      scopes: ['narratives'],
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
    expect(ids(result.decisions)).toEqual([replacement]);
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
    const strategy = await deposit('strategy', 'Be the system of record', { altitude: 50000, scopes: ['alethea'] });
    const problem = await deposit('problem', 'Analysts cannot trace a narrative');
    const metric = await idOf('metrics.upsert', { title: 'Traced claims', altitude: 10000, scopes: ['alethea'], serves: strategy });

    const result = await brief({ ids: [problem] });
    expect(ids(result.anchors)).toEqual([strategy]);
    expect(result.anchors[0]?.why).toEqual(['anchor of parent scope alethea']);
    expect(result.metrics.map((m) => [m.id, m.why])).toEqual([[metric, ['serves "Be the system of record"']]]);
  });
});

describe('context.brief: initiatives and the people map', () => {
  it('lists initiatives one hop out from the centre, with status, dates and owner', async () => {
    const lisa = await deposit('person', 'Lisa', { attrs: { role: 'pm' } });
    const provenance = await deposit('initiative', 'Provenance everywhere', {
      attrs: { started_at: '2026-10-01', target_date: '2027-01-31' },
      links: [{ kind: 'owned_by', to: lisa }],
    });
    const problem = await deposit('problem', 'Analysts cannot trace a narrative', { links: [{ kind: 'part_of', to: provenance }] });
    const unrelated = await deposit('initiative', 'Exports rework');

    const result = await brief({ ids: [problem] });
    expect(result.initiatives).toEqual([
      expect.objectContaining({
        id: provenance,
        kind: 'initiative',
        status: 'active',
        started_at: '2026-10-01',
        target_date: '2027-01-31',
        owner: { id: lisa, name: 'Lisa' },
        why: ['linked to "Analysts cannot trace a narrative" (part_of)'],
      }),
    ]);
    expect(ids(result.initiatives)).not.toContain(unrelated);
    // The owner is among the people involved.
    expect(result.people.find((p) => p.id === lisa)?.why).toEqual(['owns "Provenance everywhere"']);
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

    const result = await brief({ scopes: ['alethea'] });
    expect(result.initiatives.map((i) => [i.id, i.status, i.owner])).toEqual([
      [sooner, 'active', null],
      [later, 'active', null],
      [proposed, 'proposed', null],
      [paused, 'paused', null],
    ]);
    expect(result.initiatives[0]?.why).toEqual(['in scope narratives']);
    for (const left of [done, dropped, elsewhere]) expect(ids(result.initiatives)).not.toContain(left);

    // Asked for, a done initiative is shown.
    const centred = await brief({ ids: [done] });
    expect(centred.initiatives.map((i) => [i.id, i.status])).toEqual([[done, 'done']]);
  });

  it('says who each person reports to', async () => {
    const peter = await deposit('person', 'Peter', { attrs: { role: 'stakeholder' } });
    const lisa = await deposit('person', 'Lisa', { attrs: { role: 'pm' }, links: [{ kind: 'reports_to', to: peter }] });
    const sam = await deposit('person', 'Sam', { attrs: { role: 'engineer' } });
    const meeting = await deposit('meeting', 'Provenance sync', { attrs: { held_at: '2026-10-19' } });
    await link(meeting, 'attended_by', lisa);
    await link(meeting, 'attended_by', sam);

    const result = await brief({ ids: [meeting] });
    const people = Object.fromEntries(result.people.map((p) => [p.title, p]));
    expect(people.Lisa?.reports_to).toEqual({ id: peter, name: 'Peter' });
    expect(people.Sam?.reports_to).toBeNull();

    const aroundLisa = await brief({ ids: [lisa] });
    expect(aroundLisa.people.find((p) => p.id === lisa)?.reports_to).toEqual({ id: peter, name: 'Peter' });
    expect(aroundLisa.people.find((p) => p.id === peter)?.why).toEqual(['"Lisa" reports to them']);
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
        no_due: { by_me: [], to_me: [], more: { by_me: 0, to_me: 0 } },
        open: { by_me: 0, to_me: 0, other: 0 },
      },
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
    const metric = (title: string, scopes = ['narratives']) =>
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
    const result = await pulse({ scopes: ['alethea'] });
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
    const wassim = await deposit('person', 'Wassim', { attrs: { role: 'pm', is_user: true } });
    const sam = await deposit('person', 'Sam', { attrs: { role: 'engineer' }, scopes: ['narratives'] });
    const lisa = await deposit('person', 'Lisa', { attrs: { role: 'pm' }, scopes: ['narratives'] });
    const jo = await deposit('person', 'Jo', { attrs: { role: 'pm' }, scopes: ['narratives'] });
    const peter = await deposit('person', 'Peter', { attrs: { role: 'stakeholder' }, scopes: ['narratives'] });
    await deposit('person', 'Ana', { attrs: { role: 'analyst' }, scopes: ['narratives'] });
    await deposit('person', 'Outside', { attrs: { role: 'pm' }, scopes: ['bousleh'] });
    const meeting = (title: string, held_at: string, who: string) =>
      deposit('meeting', title, { altitude: 1000, attrs: { held_at }, links: [{ kind: 'attended_by', to: who }] });
    const lisaMeeting = await meeting('Lisa 1:1', '2026-10-05', lisa);
    // Exactly 14 days before: not due yet. A late-evening meeting counts on its local day.
    await meeting('Jo 1:1', new Date(2026, 9, 11, 23, 30).toISOString(), jo);
    await deposit('observation', 'Peter wants weekly numbers', { links: [{ kind: 'about', to: peter }] });
    await meeting('Wassim alone', '2026-09-01', wassim);

    at(2026, 10, 25, 9);
    const result = await pulse({ scopes: ['alethea'] });
    expect(result.touchpoints_due.map((p) => [p.name, p.days_since])).toEqual([
      ['Sam', null],
      ['Lisa', 20],
    ]);
    expect(result.touchpoints_due[0]).toMatchObject({ id: sam, role: 'engineer', last_touchpoint: null });
    expect(result.touchpoints_due[1]?.last_touchpoint).toEqual({
      at: '2026-10-05',
      via: 'attended',
      object: { id: lisaMeeting, kind: 'meeting', title: 'Lisa 1:1' },
    });
    expect((await pulse()).touchpoints_due.map((p) => p.name)).toEqual(['Outside', 'Sam', 'Lisa']);
    expect((await pulse({ date: '2026-10-26', scopes: ['alethea'] })).touchpoints_due.map((p) => p.name)).toEqual(['Sam', 'Lisa', 'Jo']);
  });

  it('buckets commitments by due day and direction', async () => {
    const wassim = await deposit('person', 'Wassim');
    const peter = await deposit('person', 'Peter');
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
    const yesterday = await commit('Send the memo', '2026-10-24', wassim, peter);
    const lastWeek = await commit('Intro to the data team', '2026-10-20', peter, wassim);
    const today = await commit('Review the spec', '2026-10-25', wassim, peter);
    const sam = await deposit('person', 'Sam');
    const othersToday = await commit('Jen sends Sam the deck', '2026-10-25', jen, sam);
    await commit('Book the offsite', '2026-10-26', wassim, jen);
    await commit('Someday', undefined, peter, wassim);
    await commit('Closed', '2026-10-24', wassim, peter, { status: 'done' });
    await commit('Elsewhere', '2026-10-24', wassim, peter, { scopes: ['bousleh'] });

    at(2026, 10, 25, 23, 59);
    const result = await pulse({ me: wassim, scopes: ['alethea'] });
    expect(result.date).toBe('2026-10-25');
    expect(result.me).toEqual({ id: wassim, name: 'Wassim', inferred: false });
    expect(result.commitments.overdue.by_me.map((c) => [c.id, c.days_late])).toEqual([[yesterday, 1]]);
    expect(result.commitments.overdue.to_me.map((c) => [c.id, c.days_late])).toEqual([[lastWeek, 5]]);
    expect(ids(result.commitments.due_today.by_me)).toEqual([today]);
    expect(ids(result.commitments.due_today.other)).toEqual([othersToday]);
    expect(result.commitments.open).toEqual({ by_me: 3, to_me: 2, other: 1 });

    // Without me, the person on the most open commitments is taken as me.
    expect((await pulse()).me).toEqual({ id: wassim, name: 'Wassim', inferred: true });
    // Marked as the user, he is me without being passed, and not inferred.
    ok(await run('vault.supersede', { id: wassim, attrs: { is_user: true } }));
    expect((await pulse()).me).toEqual({ id: wassim, name: 'Wassim', inferred: false });
    // Only one person can be the user.
    expect(failed(await run('vault.supersede', { id: jen, attrs: { is_user: true } })).code).toBe('conflict');
    expect(failed(await run('deposits.write', { kind: 'person', title: 'Other me', altitude: 10000, attrs: { is_user: true } })).code).toBe(
      'conflict',
    );
    // Unmarking frees the flag.
    ok(await run('vault.supersede', { id: wassim, attrs: { is_user: null } }));
    ok(await run('vault.supersede', { id: jen, attrs: { is_user: true } }));
    expect((await pulse()).me).toMatchObject({ id: jen, inferred: false });
    // A past date moves the boundary: on Oct 24 the memo is due today, not overdue.
    const before = await pulse({ me: wassim, date: '2026-10-24', scopes: ['alethea'] });
    expect(ids(before.commitments.due_today.by_me)).toEqual([yesterday]);
    expect(ids(before.commitments.overdue.by_me)).toEqual([]);
    expect(failed(await run('pulse.today', { me: yesterday })).code).toBe('invalid_input');
  });

  it('lists open commitments with no due date, by me and to me, oldest first, capped', async () => {
    const wassim = await deposit('person', 'Wassim', { attrs: { is_user: true } });
    const peter = await deposit('person', 'Peter');
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
    const oldest = await commit('Write up the Specdr roles', wassim, peter);
    const owedToMe = await commit('Peter sends the org chart', peter, wassim);
    await commit('Jen owes Peter a reply', jen, peter);
    await commit('Dated', wassim, peter, { attrs: { due: '2026-11-30' } });
    await commit('Closed', wassim, peter, { status: 'done' });
    await commit('Elsewhere', wassim, peter, { scopes: ['bousleh'] });
    const more: string[] = [];
    for (let i = 1; i <= 10; i += 1) more.push(await commit(`Later ${i}`, wassim, jen));

    const result = await pulse({ date: '2026-10-25', scopes: ['alethea'] });
    expect(ids(result.commitments.no_due.by_me)).toEqual([oldest, ...more.slice(0, 9)]);
    expect(result.commitments.no_due.more).toEqual({ by_me: 1, to_me: 0 });
    expect(ids(result.commitments.no_due.to_me)).toEqual([owedToMe]);
    expect(result.commitments.no_due.by_me[0]).toMatchObject({
      title: 'Write up the Specdr roles',
      due: null,
      owed_by: [{ id: wassim, name: 'Wassim' }],
      owed_to: [{ id: peter, name: 'Peter' }],
      filed_at: expect.any(String),
    });
    // Between other people: counted, not listed.
    expect(result.commitments.open).toEqual({ by_me: 12, to_me: 1, other: 1 });
    // Nothing is due today or overdue, so these were invisible before.
    expect(result.commitments.overdue.by_me).toEqual([]);
    expect(result.commitments.due_today.by_me).toEqual([]);
  });

  it("lists the day's meetings by held_at, on this machine's clock", async () => {
    const peter = await deposit('person', 'Peter');
    const local = (d: number, h: number, min: number) => new Date(2026, 9, d, h, min).toISOString();
    const meeting = (title: string, held_at: string) => deposit('meeting', title, { altitude: 1000, attrs: { held_at } });
    await meeting('Late the night before', local(24, 23, 30));
    const midnight = await meeting('Midnight standup', local(25, 0, 0));
    const allDay = await meeting('Offsite', '2026-10-25');
    const lastMinute = await meeting('Last call', local(25, 23, 59));
    await meeting('Next morning', local(26, 0, 0));
    await meeting('Tomorrow', '2026-10-26');
    await link(midnight, 'attended_by', peter);

    const result = await pulse({ date: '2026-10-25' });
    expect(ids(result.meetings)).toEqual([allDay, midnight, lastMinute]);
    expect(result.meetings[1]?.attendees).toEqual([{ id: peter, name: 'Peter' }]);
    expect(result.meetings.map((m) => m.status)).toEqual(['held', 'held', 'held']);
  });

  it('shows a planned meeting with its status, so its prep is easy to find', async () => {
    const planned = await deposit('meeting', '1:1 with Peter', { status: 'planned', altitude: 1000, attrs: { held_at: '2026-10-25' } });
    const result = await pulse({ date: '2026-10-25' });
    expect(result.meetings.map((m) => [m.id, m.status])).toEqual([[planned, 'planned']]);
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
        scopes: ['narratives'],
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
    ok(await run('watchlists.set', { scope: 'narratives', entries: [{ type: 'competitor', name: 'Graphika' }] }));
    const file = async (title: string) =>
      ok<{ filed: { id: string }[] }>(
        await run('watch.file', { scope: 'narratives', findings: [{ title, url: `https://example.com/${encodeURIComponent(title)}` }] }),
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

    const result = await pulse({ date: '2026-10-25', scopes: ['alethea'] });
    expect(result.new_findings.since).toBe(new Date(2026, 9, 24).toISOString());
    expect(ids(result.new_findings.findings)).toEqual([today, startOfYesterday]);
    expect(result.new_findings.findings[0]?.watch_list?.title).toBeDefined();
    expect(result.open_bets).toEqual([expect.objectContaining({ id: bet, hypothesis: 'h', kill_criteria: 'k' })]);
    expect((await pulse({ date: '2026-10-25', scopes: ['bousleh'] })).new_findings.findings).toEqual([]);
  });
});
