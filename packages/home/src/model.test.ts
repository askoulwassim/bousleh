import { describe, expect, it } from 'vitest';
import { glyphState } from './glyph.js';
import { abbreviate, buildViewModel, clockDays, mergeMeetings, needsAltitude, needsYouCount, shortTitle } from './model.js';
import { renderPage } from './render.js';
import type { Pulse, Sources, Strata, StrataCell, StrataObj } from './types.js';

/* The pure view model: op outputs in, what Home draws out. Data here is invented for the test. */

const NOW = new Date(2026, 9, 25, 9, 30); // Sun 25 Oct 2026, 09:30 local

let n = 0;
const id = (prefix: string) => {
  n += 1;
  return `${prefix}_01JBX${String(n).padStart(21, '0')}`;
};

function obj(kind: StrataObj['kind'], title: string, more: Partial<StrataObj> = {}): StrataObj {
  const layer: StrataObj['layer'] =
    kind === 'strategy' || kind === 'metric' || kind === 'principle' || kind === 'watch_list'
      ? 'anchors'
      : kind === 'finding' || kind === 'signal' || kind === 'observation'
        ? 'evidence'
        : kind === 'person'
          ? 'people'
          : kind === 'meeting' || kind === 'commitment'
            ? 'moments'
            : 'work';
  return {
    id: id(kind.slice(0, 3)),
    kind,
    layer,
    title,
    status: null,
    altitude: 1000,
    scopes: ['lantern'],
    needs_you: false,
    updated_at: '2026-10-24T10:00:00.000Z',
    ...more,
  };
}

function cell(scope: string, altitude: StrataCell['altitude'], objects: StrataObj[], count = objects.length): StrataCell {
  const kinds: Record<string, number> = {};
  for (const o of objects) kinds[o.kind] = (kinds[o.kind] ?? 0) + 1;
  return { scope, altitude, objects, count, more: Math.max(0, count - objects.length), closed: 0, kinds };
}

/** Two columns: Lantern with a strategy, a bet and a meeting; Quill with an undated commitment owed by me. */
function strata(): Strata {
  const strategy = obj('strategy', 'Own the brownfield loop', { altitude: 50000, status: 'forming' });
  const bet = obj('idea', 'The POC lane', {
    status: 'bet',
    kill_criteria: 'Stop if fewer than 3 promoted in 30 days',
    since: '2026-10-15T09:00:00.000Z',
  });
  const ideas = [1, 2, 3].map((rank) => obj('idea', `Experiment ${rank}`, { status: rank === 1 ? 'running' : 'open', rank }));
  const problem = obj('problem', 'Code is truth', { status: 'open' });
  const dana = obj('person', 'Dana Reyes', { altitude: 10000, role: 'stakeholder', scopes: [] });
  const meeting = obj('meeting', 'Lantern Weekly', { altitude: 100, status: 'planned', held_at: '2026-10-30T15:00:00' });
  const owe = obj('commitment', 'Answer the seeding questions', {
    altitude: 100,
    status: 'open',
    needs_you: true,
    due: null,
    owed: 'by_me',
    scopes: ['quill'],
  });
  return {
    date: '2026-10-25',
    me: { id: 'per_01JBX000000000000000000ME1', name: 'Rowan Vale' },
    columns: [
      {
        slug: 'lantern',
        name: 'Lantern',
        kind: 'product',
        strategy: { id: strategy.id, title: strategy.title, status: 'forming' },
        assets: 3,
      },
      { slug: 'quill', name: 'Quill', kind: 'project', strategy: null, assets: 1 },
    ],
    rows: [
      { altitude: 50000, label: 'company' },
      { altitude: 10000, label: 'cross-team' },
      { altitude: 1000, label: 'own surfaces' },
      { altitude: 100, label: 'one engineer or requirement' },
    ],
    cells: [
      cell('lantern', 50000, [strategy]),
      cell('lantern', 10000, [dana]),
      cell('lantern', 1000, [bet, ...ideas, problem]),
      cell('lantern', 100, [meeting]),
      cell('quill', 50000, []),
      cell('quill', 10000, []),
      cell('quill', 1000, []),
      cell('quill', 100, [owe]),
    ],
    totals: { layers: { anchors: 1, evidence: 0, work: 5, people: 1, moments: 2 }, needs_you: 1, empty_cells: 3, closed: 0 },
  };
}

function pulse(over: Partial<Pulse> = {}): Pulse {
  const group = () => ({ by_me: [], to_me: [], other: [] });
  return {
    date: '2026-10-25',
    scopes: [],
    me: { id: 'per_01JBX000000000000000000ME1', name: 'Rowan Vale', inferred: false },
    commitments: {
      overdue: group(),
      due_today: group(),
      no_due: { by_me: [], to_me: [], more: { by_me: 0, to_me: 0 }, minor: { by_me: 0, to_me: 0 } },
      open: { by_me: 2, to_me: 1, other: 0 },
      snoozed: { by_me: 0, to_me: 0, other: 0, next: null },
    },
    focus: [],
    focus_more: 0,
    meetings: [],
    inbox: { waiting: 0, oldest_arrived_at: null, queued: 3 },
    stale_metrics: [],
    new_findings: { since: '2026-10-24T00:00:00.000Z', total: 0, findings: [] },
    metric_movement: [],
    touchpoints_due: [],
    open_bets: [],
    ...over,
  };
}

describe('glyph state', () => {
  it('maps each status to its colour, needs-you first', () => {
    const state = (kind: StrataObj['kind'], status: string | null, needs_you = false) => glyphState({ kind, status, needs_you });
    expect(state('commitment', 'open', true)).toBe('needs');
    expect(state('commitment', 'open')).toBe('idle');
    expect(state('idea', 'bet')).toBe('yours');
    expect(state('idea', 'running')).toBe('moving');
    expect(state('idea', 'open')).toBe('idle');
    expect(state('idea', 'dropped')).toBe('closed');
    expect(state('initiative', 'active')).toBe('moving');
    expect(state('initiative', 'done')).toBe('yours');
    expect(state('strategy', 'forming')).toBe('idle');
    expect(state('strategy', 'aligned')).toBe('yours');
    expect(state('metric', 'measured')).toBe('moving');
    expect(state('finding', 'new')).toBe('moving');
    expect(state('finding', 'dismissed')).toBe('closed');
    expect(state('meeting', 'planned')).toBe('moving');
    expect(state('decision', null)).toBe('yours');
    expect(state('person', null)).toBe('idle');
  });
});

describe('small pieces', () => {
  it('counts what needs you from the strata, else from Pulse', () => {
    expect(needsYouCount({ strata: strata() })).toBe(1);
    const p = pulse();
    p.commitments.overdue.by_me.push({
      id: 'cmt_01JBX000000000000000000001',
      title: 'Late',
      status: 'open',
      altitude: 100,
      surface_on: null,
      size: 'major',
      due: '2026-10-20',
      scopes: ['quill'],
      owed_by: [],
      owed_to: [],
      days_late: 5,
    });
    p.commitments.no_due.more.by_me = 2;
    expect(needsYouCount({ pulse: p })).toBe(3);
    expect(needsYouCount({})).toBe(0);
  });

  it('finds the band that needs you', () => {
    expect(needsAltitude(strata())).toBe(100);
    expect(needsAltitude(undefined)).toBeNull();
  });

  it('reads a clock from kill criteria', () => {
    expect(clockDays('Stop if fewer than 3 promoted in 30 days')).toBe(30);
    expect(clockDays('Kill after 6 weeks')).toBe(42);
    expect(clockDays('Two months, 2 months max')).toBe(60);
    expect(clockDays('If nobody uses it')).toBeNull();
    expect(clockDays(undefined)).toBeNull();
  });

  it('abbreviates scopes and shortens meeting titles', () => {
    expect(['specdr', 'perfect-placement', 'ai-anvil', 'bousleh', 'pandora'].map(abbreviate)).toEqual(['SPC', 'PLC', 'ANV', 'BSL', 'PND']);
    expect(shortTitle('Lantern Weekly', ['Lantern', 'Quill'])).toBe('Weekly');
    expect(shortTitle('Quarterly planning with the whole team', ['Lantern'], 16)).toBe('Quarterly…');
  });

  it('merges calendar events with filed meetings by start time, or by title for a date-only meeting', () => {
    const merged = mergeMeetings(
      [
        {
          id: 'mtg_01JBX000000000000000000001',
          title: 'Dana 1:1',
          held_at: '2026-10-25T14:00:00.000Z',
          status: 'planned',
          altitude: 100,
          scopes: ['lantern'],
          attendees: [],
        },
        {
          id: 'mtg_01JBX000000000000000000002',
          title: 'Design review',
          held_at: '2026-10-25',
          status: 'held',
          altitude: 100,
          scopes: ['lantern'],
          attendees: [],
        },
      ],
      [
        { title: '1:1 Dana / Rowan', start: '2026-10-25T14:00:00Z', allDay: false },
        { title: 'design review', start: '2026-10-25T16:00:00Z', allDay: false },
        { title: 'Offsite', start: '2026-10-25', allDay: true },
        { title: 'Focus', start: '2026-10-25T08:00:00Z', allDay: false },
      ],
      NOW,
    );
    expect(merged.map((m) => [m.title, m.planned, m.held ?? false])).toEqual([
      ['Focus', false, false],
      ['Dana 1:1', true, false],
      ['Design review', false, true],
    ]);
  });
});

describe('buildViewModel', () => {
  const sources = (): Sources => ({
    strata: strata(),
    pulse: pulse(),
    commitments: {
      commitments: [
        {
          id: 'cmt_01JBX000000000000000000003',
          title: 'Plan',
          status: 'open',
          altitude: 1000,
          due: '2026-11-06',
          surface_on: null,
          size: 'major',
          scopes: ['lantern'],
          owed_by: [{ id: 'per_01JBX000000000000000000ME1', name: 'Rowan Vale' }],
          owed_to: [],
        },
      ],
    },
  });

  it('builds the header: hero, readouts and one primary action', () => {
    const vm = buildViewModel(sources(), NOW);
    expect(vm.dateLabel).toBe('Sun 25 Oct');
    expect(vm.instance).toBe('Personal');
    expect(vm.hero).toEqual({ needs: 1, altitude: 100, band: 'at 100 ft' });
    expect(vm.readouts.map((r) => [r.label, r.value, r.tone])).toEqual([
      ['Owed me', '1', 'fg'],
      ['Meetings', '0', 'zero'],
      ['Inbox', '3', 'needs'],
      ['Touch due', 'Clear', 'accent'],
      ['Next due', 'Nov 6', 'fg'],
    ]);
    expect(vm.primary?.label).toBe('Answer 3');
    expect(vm.prompts[vm.primary?.prompt ?? '']).toMatch(/^Capture: let's clear the queue/);
    // The planned Lantern Weekly is the next meeting worth prepping.
    expect(vm.secondary?.label).toBe('Prep Weekly');
    expect(vm.prompts[vm.secondary?.prompt ?? '']).toMatch(/^Counsel: prep me for "Lantern Weekly"/);
  });

  it("never offers to prep a meeting that's already held, even one filed with a date only", () => {
    const held = {
      id: 'mtg_01JBX000000000000000000009',
      title: 'Hannah sync: data quality',
      held_at: '2026-10-25',
      status: 'held' as const,
      altitude: 10000 as const,
      scopes: ['lantern'],
      attendees: [],
    };
    const vm = buildViewModel({ ...sources(), pulse: pulse({ meetings: [held] }) }, NOW);
    // The held call is today's only filed meeting, but the suggestion skips it for the planned Lantern Weekly.
    expect(vm.secondary?.label).toBe('Prep Weekly');
    expect(Object.values(vm.prompts).some((p) => p.includes('Hannah sync'))).toBe(false);
  });

  it('draws each cell in its variant, and every button resolves to a prompt', () => {
    const vm = buildViewModel(sources(), NOW);
    const variant = (r: number, col: number) => vm.cells[r]?.[col]?.variant;
    expect([variant(0, 0), variant(1, 0), variant(2, 0), variant(3, 0)]).toEqual(['strategy', 'filled', 'bet', 'filled']);
    expect([variant(0, 1), variant(3, 1)]).toEqual(['void', 'needs']);
    const bet = vm.cells[2]?.[0]?.bet;
    expect(bet?.clock).toEqual({ days: 30, elapsed: 10 });
    expect(bet?.groups.map((g) => [g.label, g.note])).toEqual([
      ['Experiments', '3 ranked'],
      ['Problems', '1 open'],
    ]);
    expect(vm.cells[3]?.[1]?.needs).toMatchObject({ eyebrow: 'You owe · no date', title: 'Answer the seeding questions', scope: 'Quill' });
    expect(vm.rows.find((r) => r.here)?.altitude).toBe(100);
    expect(vm.columns.map((c) => [c.short, c.tone, c.quiet])).toEqual([
      ['LNT', 'fg', false],
      ['QLL', 'accent', false],
    ]);
    const keys = [
      ...vm.cells.flat().map((c) => c.prompt),
      ...vm.rows.flatMap((r) => [r.prompt, ...r.launchers.flatMap((l) => (l.prompt ? [l.prompt] : []))]),
    ];
    for (const key of keys) expect(vm.prompts[key], key).toBeTruthy();
  });

  it('folds minor commitments into a closed "Small follow-ups" group after the rest, with a major one leading', () => {
    const src = sources();
    const s = src.strata as Strata;
    const minor = (title: string, more: Partial<StrataObj> = {}) =>
      obj('commitment', title, { altitude: 100, status: 'open', size: 'minor', owed: 'by_me', due: null, scopes: ['quill'], ...more });
    const ask = minor('Ask Pat about the export');
    const late = minor('Send Jen the link', { due: '2026-10-22', needs_you: true });
    const quill100 = s.cells.find((c) => c.scope === 'quill' && c.altitude === 100) as StrataCell;
    const major = quill100.objects[0] as StrataObj;
    Object.assign(quill100, cell('quill', 100, [major, late, ask]));
    s.totals.needs_you = 2;
    const vm = buildViewModel(src, NOW);
    const drawn = vm.cells[3]?.[1];
    // The major commitment leads; both minor ones fold away, and the group says one of them needs you.
    expect(drawn?.variant).toBe('needs');
    expect(drawn?.needs?.title).toBe('Answer the seeding questions');
    expect(drawn?.items).toEqual([]);
    expect(drawn?.more).toBe(0);
    expect(drawn?.minor?.items.map((i) => [i.title, i.meta])).toEqual([
      ['Send Jen the link', 'DUE 22 OCT'],
      ['Ask Pat about the export', 'NO DATE'],
    ]);
    expect(drawn?.minor?.needs).toBe(true);
    // The needs-you count stays the strata's.
    expect(vm.hero.needs).toBe(2);
    const html = renderPage(vm, { mode: 'live', stamp: '09:30', filter: 'all', docsOpen: false, errors: {}, approval: false, done: {} });
    expect(html).toContain('<details class="minor"><summary class="eb sm t-needs">Small follow-ups (2)</summary>');
    expect(html).not.toContain('<details class="minor" open');

    // Only minor ones: a late one may lead the cell; the quiet one stays folded.
    Object.assign(quill100, cell('quill', 100, [late, ask]));
    const only = buildViewModel(src, NOW).cells[3]?.[1];
    expect(only?.needs?.title).toBe('Send Jen the link');
    expect(only?.minor).toEqual({ items: [expect.objectContaining({ title: 'Ask Pat about the export' })], needs: false });
    // No minor ones: no group.
    expect(buildViewModel(sources(), NOW).cells[3]?.[1]?.minor).toBeUndefined();
  });

  it('builds launch prompts from the data in view', () => {
    const vm = buildViewModel(sources(), NOW);
    const launch = Object.fromEntries(vm.rows.flatMap((r) => r.launchers).map((l) => [l.mode, l]));
    expect(launch.Shape?.label).toBe('Work the strategy');
    expect(vm.prompts[launch.Shape?.prompt ?? '']).toBe(
      'Shape: let\'s work on the Lantern strategy, "Own the brownfield loop". It is forming. Push back with the evidence.',
    );
    expect(launch.Communicate?.label).toBe('Brief Dana');
    expect(launch.Workshop?.label).toBe('Code is truth');
    expect(vm.prompts[launch.Workshop?.prompt ?? '']).toBe('Workshop: let\'s workshop "Code is truth". Given all this, what could we do?');
    expect(launch.Coach).toEqual({ mode: 'Coach', label: 'No PMs yet' });
    expect(launch.Counsel?.label).toBe('Prep Weekly');
    expect(vm.prompts[launch.Capture?.prompt ?? '']).toBe('Capture this: ');
  });

  it('leads with the few things to do first, each with its prompt, and says what is snoozed', () => {
    const peter = { id: 'per_01JBX000000000000000000P01', name: 'Peter Trennum' };
    const ian = { id: 'per_01JBX000000000000000000I01', name: 'Ian Holt' };
    const p = pulse({
      focus: [
        {
          kind: 'commitment',
          id: 'cmt_01JBX000000000000000000F01',
          title: 'Send Peter the one-pager',
          altitude: 1000,
          scopes: ['lantern'],
          score: 83,
          why: ['2 days late', 'owed to Peter Trennum, your manager'],
          owed: 'by_me',
          size: 'major',
          people: [peter],
          when: '2026-10-23',
        },
        {
          kind: 'meeting',
          id: 'mtg_01JBX000000000000000000F02',
          title: 'Lisa sync',
          altitude: 10000,
          scopes: ['quill'],
          score: 63,
          why: ['today at 14:00', 'no prep yet'],
          owed: null,
          size: null,
          people: [],
          when: '2026-10-25T14:00:00',
        },
        {
          kind: 'commitment',
          id: 'cmt_01JBX000000000000000000F03',
          title: 'Ian replies on the metering doc',
          altitude: 1000,
          scopes: ['lantern'],
          score: 40,
          why: ['follow up with Ian Holt', 'back from snooze today'],
          owed: 'to_me',
          size: 'major',
          people: [ian],
          when: '2026-10-25',
        },
      ],
      focus_more: 2,
    });
    p.commitments.snoozed = {
      by_me: 2,
      to_me: 1,
      other: 0,
      next: { id: 'cmt_01JBX000000000000000000F04', title: 'Later', surface_on: '2026-11-20' },
    };
    const vm = buildViewModel({ ...sources(), pulse: p }, NOW);
    expect(vm.focus?.items.map((f) => [f.eyebrow, f.title, f.detail, f.scopeName, f.tone])).toEqual([
      ['2 days late', 'Send Peter the one-pager', 'owed to Peter Trennum, your manager', 'Lantern', 'needs'],
      ['today at 14:00', 'Lisa sync', 'no prep yet', 'Quill', 'moving'],
      ['follow up with Ian Holt', 'Ian replies on the metering doc', 'back from snooze today', 'Lantern', 'needs'],
    ]);
    const prompt = (i: number) => vm.prompts[vm.focus?.items[i]?.prompt ?? ''];
    expect(prompt(0)).toBe('Pulse: "Send Peter the one-pager" is first today. Help me get it done, give it a new date, or snooze it.');
    expect(prompt(1)).toBe('Counsel: prep me for "Lisa sync" (Today 14:00).');
    expect(prompt(2)).toBe(
      'Pulse: time to follow up on "Ian replies on the metering doc" with Ian. Help me nudge, close it, or snooze it again.',
    );
    expect(vm.focus?.more).toBe(2);
    expect(vm.focus?.snoozed).toBe('3 snoozed · next Nov 20');
    expect(vm.prompts[vm.focus?.morePrompt ?? '']).toBe('Pulse: where am I?');

    // Nothing snoozed, nothing ranked: an empty focus, which the page leaves out.
    expect(buildViewModel(sources(), NOW).focus).toEqual({ items: [], more: 0, snoozed: null, morePrompt: expect.any(String) });
    // Without Pulse there is no focus at all.
    expect(buildViewModel({ strata: sources().strata }, NOW).focus).toBeUndefined();
  });

  it('skips snoozed commitments for Next due, and says when a needs-you item is back from a snooze', () => {
    const src = sources();
    const meId = 'per_01JBX000000000000000000ME1';
    const view = (id: string, title: string, due: string, surface_on: string | null) => ({
      id,
      title,
      status: 'open' as const,
      altitude: 100 as const,
      due,
      surface_on,
      size: 'major' as const,
      scopes: ['quill'],
      owed_by: [{ id: meId, name: 'Rowan Vale' }],
      owed_to: [],
    });
    src.commitments = {
      commitments: [
        view('cmt_01JBX000000000000000000S01', 'Snoozed past its due', '2026-10-28', '2026-11-02'),
        view('cmt_01JBX000000000000000000S02', 'Awake', '2026-11-04', null),
      ],
    };
    const vm = buildViewModel(src, NOW);
    expect(vm.readouts.find((r) => r.label === 'Next due')?.value).toBe('Nov 4');
  });

  it('says nothing it does not know when there is no data', () => {
    const vm = buildViewModel({}, NOW);
    expect(vm.have).toEqual([]);
    expect(vm.columns).toEqual([]);
    expect(vm.readouts.every((r) => r.value === '—')).toBe(true);
    expect(vm.primary?.label).toBe('Where am I?');
    expect(vm.horizon.lead).toBeNull();
    expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
  });

  it('builds Horizon: lead on a scope with a bet, day bars, the beat, list changes, unwatched scopes', () => {
    const src = sources();
    const listId = 'wls_01JBX000000000000000000001';
    src.watchlists = {
      watch_lists: [
        {
          id: listId,
          title: 'Lantern watch list',
          altitude: 10000,
          scopes: ['lantern'],
          entries: [
            { type: 'competitor', name: 'Gizmo Build', url: 'https://gizmo.example.com', added_by: 'wassim' },
            { type: 'topic', name: 'Brownfield agents', added_by: 'horizon', reason: 'Came up' },
          ],
          version: { id: 'ver_01JBX000000000000000000001', n: 1 },
          updated_at: '2026-10-20T08:00:00.000Z',
        },
      ],
    };
    const finding = (title: string, url: string, status: 'new' | 'dismissed' | 'read', filed: string) => ({
      id: id('fnd'),
      title,
      status,
      url,
      published_at: null,
      filed_at: filed,
      summary: `${title}.`,
    });
    src.digest = {
      since: '2026-10-18T00:00:00.000Z',
      until: '2026-10-25T09:30:00.000Z',
      total: 3,
      groups: [
        {
          watch_list: { id: listId, title: 'Lantern watch list' },
          findings: [
            finding('Old read item', 'https://other.example.org/a', 'read', '2026-10-21T07:00:00.000Z'),
            finding('Gizmo Build ships', 'https://gizmo.example.com/blog', 'new', '2026-10-19T07:00:00.000Z'),
            finding('Ignore me', 'https://x.example.org', 'dismissed', '2026-10-24T07:00:00.000Z'),
          ],
        },
      ],
    };
    src.queue = {
      items: [
        {
          id: 'que_01JBX000000000000000000001',
          draft: { title: 'Remove "Gizmo Build" from the lantern watch list?', kind: 'observation' },
          reason: 'Horizon suggests removing an entry Wassim added; Wassim decides',
          candidates: [{ id: listId, kind: 'watch_list', title: 'Lantern watch list' }],
          source: null,
          created_at: '2026-10-21T07:00:00.000Z',
        },
      ],
    };
    const h = buildViewModel(src, NOW).horizon;
    expect(h.lead?.title).toBe('Gizmo Build ships');
    expect(h.lead).toMatchObject({ scopeName: 'Lantern', altitude: 10000, source: 'gizmo.example.com', age: '6d' });
    expect(h.stories.map((s) => s.title)).toEqual(['Old read item']);
    expect(h.dayBars).toEqual([1, 0, 1, 0, 0, 0, 0]);
    expect(h.beat).toEqual([
      { name: 'Gizmo Build', count: 1, horizon: false },
      { name: 'Brownfield agents', count: 0, horizon: true },
    ]);
    expect(h.changes).toEqual([
      { kind: 'add', text: 'Brownfield agents' },
      { kind: 'remove', text: 'Gizmo Build' },
    ]);
    expect(h.noWatch.map((s) => s.name)).toEqual(['Quill']);
    expect(h.eyebrow).toBe('Wk 43 · Wed 21 Oct · Lantern');
  });
});
