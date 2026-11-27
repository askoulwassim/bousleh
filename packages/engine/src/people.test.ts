import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPS, type OpContext, type OpOutcome, type OpOutput } from '@bousleh/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* End to end through runOp: people.list, with roles, scopes, reports_to, open commitments and the last touchpoint. */

type People = OpOutput<'people.list'>;

/* Local clock, as Pulse reads it. `at` moves it to a local moment, never backwards. */
let clock = 0;
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const at = (month: number, d: number, h = 9) => {
  const next = new Date(2026, month - 1, d, h).getTime();
  if (next < clock) throw new Error('the test clock only moves forward');
  clock = next;
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
beforeEach(async () => {
  clock = new Date(2026, 9, 1, 9).getTime();
  home = mkdtempSync(join(tmpdir(), 'bousleh-people-'));
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
function failed(outcome: OpOutcome): { code: string } {
  if (outcome.status !== 'error') throw new Error('expected an error');
  return outcome;
}
const run = (name: string, input: unknown = {}) => engine.runOp(name, input, ctx);
const list = async (input: unknown = {}) => ok<People>(await run('people.list', input));
const deposit = async (kind: string, title: string, more: Record<string, unknown> = {}) =>
  ok<{ id: string }>(await run('deposits.write', { kind, title, altitude: 1000, scopes: kind === 'person' ? [] : ['logistics'], ...more }))
    .id;

describe('people.list', () => {
  it('lists people by name with role, org, manager and open commitments both ways', async () => {
    expect(OPS['people.list'].readOnly).toBe(true);
    const rowan = await deposit('person', 'Rowan', { attrs: { role: 'stakeholder', org: 'Northwind' } });
    const mira = await deposit('person', 'mira', { attrs: { role: 'pm', org: 'northwind' }, links: [{ kind: 'reports_to', to: rowan }] });
    const alex = await deposit('person', 'Alex', { attrs: { role: 'pm', is_user: true } });
    const sam = await deposit('person', 'Sam', { attrs: { role: 'engineer', org: 'Contractor' } });
    const memo = await deposit('commitment', 'Send the memo', {
      attrs: { due: '2026-10-28' },
      links: [
        { kind: 'owed_by', to: mira },
        { kind: 'owed_to', to: alex },
      ],
    });
    await deposit('commitment', 'Closed one', { status: 'done', links: [{ kind: 'owed_by', to: mira }] });

    const everyone = await list();
    expect(everyone.people.map((p) => p.name)).toEqual(['Alex', 'mira', 'Rowan', 'Sam']);
    const miraRow = everyone.people[1];
    expect(miraRow).toMatchObject({
      id: mira,
      role: 'pm',
      org: 'northwind',
      is_user: false,
      reports_to: { id: rowan, name: 'Rowan' },
      commitments: { owes: [{ id: memo, title: 'Send the memo', due: '2026-10-28' }], owed: [] },
    });
    expect(everyone.people.find((p) => p.id === alex)).toMatchObject({
      is_user: true,
      reports_to: null,
      commitments: { owes: [], owed: [{ id: memo }] },
    });

    expect((await list({ role: 'pm' })).people.map((p) => p.id)).toEqual([alex, mira]);
    expect((await list({ role: ['pm', 'engineer'] })).people.map((p) => p.id)).toEqual([alex, mira, sam]);
    expect((await list({ org: 'NORTHWIND' })).people.map((p) => p.id)).toEqual([mira, rowan]);
    const capped = await list({ limit: 1 });
    expect(capped.people).toHaveLength(1);
    expect(capped.more).toBe(3);
    expect(failed(await run('people.list', { role: 'ceo' })).code).toBe('invalid_input');
  });

  it('leaves out a person merged into another, so a duplicate never shows as a touchpoint due', async () => {
    const mira = await deposit('person', 'Mira Chen', { attrs: { role: 'stakeholder' } });
    const duplicate = await deposit('person', 'Mira', { attrs: { role: 'stakeholder' } });
    expect((await list()).people.map((p) => p.id).sort()).toEqual([mira, duplicate].sort());
    ok(await run('vault.link', { from: mira, kind: 'supersedes', to: duplicate }));
    expect((await list()).people.map((p) => p.id)).toEqual([mira]);
    expect((await list({ role: 'stakeholder' })).people.map((p) => p.id)).toEqual([mira]);
    const pulse = ok<OpOutput<'pulse.today'>>(await run('pulse.today', {}));
    expect(pulse.touchpoints_due.map((p) => p.id)).toEqual([mira]);
  });

  it('puts a person in a scope by their own scopes, or, with none, by what is linked to them', async () => {
    const own = await deposit('person', 'Owns a scope', { scopes: ['logistics'] });
    const elsewhere = await deposit('person', 'Elsewhere', { scopes: ['bousleh'] });
    const linked = await deposit('person', 'Linked in');
    await deposit('person', 'Floating');
    await deposit('observation', 'Linked cares about provenance', { links: [{ kind: 'about', to: linked }] });

    expect((await list({ scopes: ['northwind'] })).people.map((p) => p.id)).toEqual([linked, own]);
    expect((await list({ scopes: ['bousleh'] })).people.map((p) => p.id)).toEqual([elsewhere]);
    expect(failed(await run('people.list', { scopes: ['nowhere'] })).code).toBe('invalid_input');
  });

  it('takes the later of the newest held meeting they attended and the newest object about them', async () => {
    const rowan = await deposit('person', 'Rowan', { attrs: { role: 'stakeholder' } });
    const touch = async () => (await list()).people.find((p) => p.id === rowan)?.last_touchpoint;
    expect(await touch()).toBeNull();

    at(10, 5);
    const note = await deposit('observation', 'Rowan wants weekly numbers', { links: [{ kind: 'about', to: rowan }] });
    expect(await touch()).toMatchObject({ via: 'about', object: { id: note, kind: 'observation' } });

    at(10, 10);
    // Filed on the 10th, held on the 8th: the meeting's held_at counts, so the observation (the 5th) is older.
    const meeting = await deposit('meeting', 'Steering', { attrs: { held_at: '2026-10-08' }, links: [{ kind: 'attended_by', to: rowan }] });
    expect(await touch()).toEqual({ at: '2026-10-08', via: 'attended', object: { id: meeting, kind: 'meeting', title: 'Steering' } });

    // Planned meetings and meetings dated after now haven't happened.
    await deposit('meeting', '1:1 next week', {
      status: 'planned',
      attrs: { held_at: '2026-10-15' },
      links: [{ kind: 'attended_by', to: rowan }],
    });
    await deposit('meeting', 'Old-style prep', { attrs: { held_at: '2026-11-01' }, links: [{ kind: 'attended_by', to: rowan }] });
    expect((await touch())?.object.id).toBe(meeting);

    at(10, 12);
    const growth = await deposit('growth_note', 'Rowan asked for less detail', { links: [{ kind: 'about', to: rowan }] });
    expect((await touch())?.object.id).toBe(growth);
    expect((await touch())?.via).toBe('about');
  });
});

describe('person emails (Oct 25)', () => {
  it('stores them lower-cased and each once, shows them in people.get and people.list, and reads none on older people', async () => {
    const rowan = await deposit('person', 'Rowan', { attrs: { role: 'stakeholder', emails: [' Rowan@Northwind.EXAMPLE '] } });
    const mira = await deposit('person', 'Mira', { attrs: { role: 'pm' } });

    const profile = ok<OpOutput<'people.get'>>(await run('people.get', { id: rowan }));
    expect(profile.person).toMatchObject({ role: 'stakeholder', emails: ['rowan@northwind.example'] });
    expect((await list()).people.map((p) => [p.name, p.emails])).toEqual([
      ['Mira', []],
      ['Rowan', ['rowan@northwind.example']],
    ]);

    // A new version replaces the whole list; null removes it.
    ok(await run('vault.supersede', { id: mira, attrs: { emails: ['mira@northwind.example', 'mira.c@example.com'] } }));
    expect((await list()).people[0]?.emails).toEqual(['mira@northwind.example', 'mira.c@example.com']);
    ok(await run('vault.supersede', { id: mira, attrs: { emails: null } }));
    expect((await list()).people[0]?.emails).toEqual([]);

    expect(failed(await run('vault.supersede', { id: mira, attrs: { emails: ['a@b.co', 'A@B.co'] } })).code).toBe('invalid_input');
    expect(failed(await run('vault.supersede', { id: mira, attrs: { emails: ['not an email'] } })).code).toBe('invalid_input');
    const many = Array.from({ length: 6 }, (_, i) => `p${i}@x.io`);
    expect(failed(await run('deposits.write', { kind: 'person', title: 'Many', altitude: 1000, attrs: { emails: many } })).code).toBe(
      'invalid_input',
    );
  });
});
