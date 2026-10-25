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
function failed(outcome: OpOutcome): { code: string } {
  if (outcome.status !== 'error') throw new Error('expected an error');
  return outcome;
}
const run = (name: string, input: unknown = {}) => engine.runOp(name, input, ctx);
const list = async (input: unknown = {}) => ok<People>(await run('people.list', input));
const deposit = async (kind: string, title: string, more: Record<string, unknown> = {}) =>
  ok<{ id: string }>(await run('deposits.write', { kind, title, altitude: 1000, scopes: kind === 'person' ? [] : ['narratives'], ...more }))
    .id;

describe('people.list', () => {
  it('lists people by name with role, org, manager and open commitments both ways', async () => {
    expect(OPS['people.list'].readOnly).toBe(true);
    const peter = await deposit('person', 'Peter', { attrs: { role: 'stakeholder', org: 'Alethea' } });
    const lisa = await deposit('person', 'lisa', { attrs: { role: 'pm', org: 'alethea' }, links: [{ kind: 'reports_to', to: peter }] });
    const wassim = await deposit('person', 'Wassim', { attrs: { role: 'pm', is_user: true } });
    const sam = await deposit('person', 'Sam', { attrs: { role: 'engineer', org: 'Contractor' } });
    const memo = await deposit('commitment', 'Send the memo', {
      attrs: { due: '2026-10-28' },
      links: [
        { kind: 'owed_by', to: lisa },
        { kind: 'owed_to', to: wassim },
      ],
    });
    await deposit('commitment', 'Closed one', { status: 'done', links: [{ kind: 'owed_by', to: lisa }] });

    const everyone = await list();
    expect(everyone.people.map((p) => p.name)).toEqual(['lisa', 'Peter', 'Sam', 'Wassim']);
    const lisaRow = everyone.people[0];
    expect(lisaRow).toMatchObject({
      id: lisa,
      role: 'pm',
      org: 'alethea',
      is_user: false,
      reports_to: { id: peter, name: 'Peter' },
      commitments: { owes: [{ id: memo, title: 'Send the memo', due: '2026-10-28' }], owed: [] },
    });
    expect(everyone.people.find((p) => p.id === wassim)).toMatchObject({
      is_user: true,
      reports_to: null,
      commitments: { owes: [], owed: [{ id: memo }] },
    });

    expect((await list({ role: 'pm' })).people.map((p) => p.id)).toEqual([lisa, wassim]);
    expect((await list({ role: ['pm', 'engineer'] })).people.map((p) => p.id)).toEqual([lisa, sam, wassim]);
    expect((await list({ org: 'ALETHEA' })).people.map((p) => p.id)).toEqual([lisa, peter]);
    const capped = await list({ limit: 1 });
    expect(capped.people).toHaveLength(1);
    expect(capped.more).toBe(3);
    expect(failed(await run('people.list', { role: 'ceo' })).code).toBe('invalid_input');
  });

  it('puts a person in a scope by their own scopes, or, with none, by what is linked to them', async () => {
    const own = await deposit('person', 'Owns a scope', { scopes: ['narratives'] });
    const elsewhere = await deposit('person', 'Elsewhere', { scopes: ['bousleh'] });
    const linked = await deposit('person', 'Linked in');
    await deposit('person', 'Floating');
    await deposit('observation', 'Linked cares about provenance', { links: [{ kind: 'about', to: linked }] });

    expect((await list({ scopes: ['alethea'] })).people.map((p) => p.id)).toEqual([linked, own]);
    expect((await list({ scopes: ['bousleh'] })).people.map((p) => p.id)).toEqual([elsewhere]);
    expect(failed(await run('people.list', { scopes: ['nowhere'] })).code).toBe('invalid_input');
  });

  it('takes the later of the newest held meeting they attended and the newest object about them', async () => {
    const peter = await deposit('person', 'Peter', { attrs: { role: 'stakeholder' } });
    const touch = async () => (await list()).people.find((p) => p.id === peter)?.last_touchpoint;
    expect(await touch()).toBeNull();

    at(10, 5);
    const note = await deposit('observation', 'Peter wants weekly numbers', { links: [{ kind: 'about', to: peter }] });
    expect(await touch()).toMatchObject({ via: 'about', object: { id: note, kind: 'observation' } });

    at(10, 10);
    // Filed on the 10th, held on the 8th: the meeting's held_at counts, so the observation (the 5th) is older.
    const meeting = await deposit('meeting', 'Steering', { attrs: { held_at: '2026-10-08' }, links: [{ kind: 'attended_by', to: peter }] });
    expect(await touch()).toEqual({ at: '2026-10-08', via: 'attended', object: { id: meeting, kind: 'meeting', title: 'Steering' } });

    // Planned meetings and meetings dated after now haven't happened.
    await deposit('meeting', '1:1 next week', {
      status: 'planned',
      attrs: { held_at: '2026-10-15' },
      links: [{ kind: 'attended_by', to: peter }],
    });
    await deposit('meeting', 'Old-style prep', { attrs: { held_at: '2026-11-01' }, links: [{ kind: 'attended_by', to: peter }] });
    expect((await touch())?.object.id).toBe(meeting);

    at(10, 12);
    const growth = await deposit('growth_note', 'Peter asked for less detail', { links: [{ kind: 'about', to: peter }] });
    expect((await touch())?.object.id).toBe(growth);
    expect((await touch())?.via).toBe('about');
  });
});

describe('person emails (Oct 25)', () => {
  it('stores them lower-cased and each once, shows them in people.get and people.list, and reads none on older people', async () => {
    const peter = await deposit('person', 'Peter', { attrs: { role: 'stakeholder', emails: [' Peter@Alethea.COM '] } });
    const lisa = await deposit('person', 'Lisa', { attrs: { role: 'pm' } });

    const profile = ok<OpOutput<'people.get'>>(await run('people.get', { id: peter }));
    expect(profile.person).toMatchObject({ role: 'stakeholder', emails: ['peter@alethea.com'] });
    expect((await list()).people.map((p) => [p.name, p.emails])).toEqual([
      ['Lisa', []],
      ['Peter', ['peter@alethea.com']],
    ]);

    // A new version replaces the whole list; null removes it.
    ok(await run('vault.supersede', { id: lisa, attrs: { emails: ['lisa@alethea.com', 'lisa.k@gmail.com'] } }));
    expect((await list()).people[0]?.emails).toEqual(['lisa@alethea.com', 'lisa.k@gmail.com']);
    ok(await run('vault.supersede', { id: lisa, attrs: { emails: null } }));
    expect((await list()).people[0]?.emails).toEqual([]);

    expect(failed(await run('vault.supersede', { id: lisa, attrs: { emails: ['a@b.co', 'A@B.co'] } })).code).toBe('invalid_input');
    expect(failed(await run('vault.supersede', { id: lisa, attrs: { emails: ['not an email'] } })).code).toBe('invalid_input');
    const many = Array.from({ length: 6 }, (_, i) => `p${i}@x.io`);
    expect(failed(await run('deposits.write', { kind: 'person', title: 'Many', altitude: 1000, attrs: { emails: many } })).code).toBe(
      'invalid_input',
    );
  });
});
