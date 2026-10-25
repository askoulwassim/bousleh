import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpContext, OpOutcome } from '@bousleh/contracts';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* End to end through runOp: vault.search, vault.link, vault.unlink, commitments.list, commitments.close and people.get. */

let clock = Date.parse('2026-10-25T09:00:00.000Z');
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-vault-ops-'));
  engine = openEngine({ home });
  ok(await engine.runOp('scopes.add', { slug: 'bousleh', name: 'Bousleh', kind: 'project' }, ctx));
  ok(await engine.runOp('scopes.add', { slug: 'specdr', name: 'Specdr', kind: 'product' }, ctx));
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

async function write(input: Record<string, unknown>): Promise<string> {
  return ok(await run('deposits.write', { altitude: 1000, scopes: ['bousleh'], ...input })).id as string;
}
const person = (title: string) =>
  write({ kind: 'person', title, altitude: 10000, scopes: [], attrs: { role: 'stakeholder', org: 'Alethea' } });

describe('vault.search', () => {
  it('finds current versions, title matches first, with a snippet, status, altitude and scopes', async () => {
    const inBody = await write({ kind: 'problem', title: 'Analysts rebuild things', body: 'The weekly export is rebuilt by hand.' });
    const inTitle = await write({ kind: 'signal', title: 'Export takes an hour', scopes: ['bousleh', 'specdr'], altitude: 100 });
    const { hits, match } = ok(await run('vault.search', { query: 'export' }));
    expect(match).toBe('all');
    expect(hits.map((hit: { id: string }) => hit.id)).toEqual([inTitle, inBody]);
    expect(hits[0]).toMatchObject({ kind: 'signal', layer: 'evidence', altitude: 100, status: null, scopes: ['bousleh', 'specdr'] });
    expect(hits[1].snippet).toContain('**export**');

    ok(await run('vault.supersede', { id: inTitle, title: 'Downloads take an hour' }));
    const after = ok(await run('vault.search', { query: 'export' }));
    expect(after.hits.map((hit: { id: string }) => hit.id)).toEqual([inBody]);
  });

  it('wants every word, and falls back to any word when nothing has them all', async () => {
    const both = await write({ kind: 'problem', title: 'Pricing page confuses buyers' });
    const one = await write({ kind: 'problem', title: 'Pricing calculator is slow' });
    expect(ok(await run('vault.search', { query: 'pricing buyers' }))).toMatchObject({ match: 'all', hits: [{ id: both }] });
    const any = ok(await run('vault.search', { query: 'calculator unicorns' }));
    expect(any).toMatchObject({ match: 'any', hits: [{ id: one }] });
  });

  it('treats search syntax as plain text instead of failing', async () => {
    const id = await write({ kind: 'problem', title: 'foo bar', body: 'and more' });
    for (const text of ['"foo AND (', 'title:foo', 'NEAR(foo bar)', 'foo*', '{title} : foo', '-foo', "foo's", ')(']) {
      const outcome = await run('vault.search', { query: text });
      expect(outcome.status, text).toBe('ok');
    }
    expect(ok(await run('vault.search', { query: '"foo AND (' })).hits.map((hit: { id: string }) => hit.id)).toEqual([id]);
    expect(ok(await run('vault.search', { query: '( ) "' }))).toEqual({ hits: [], match: 'any' });
  });

  it('does not match scope names or kinds as words', async () => {
    await write({ kind: 'problem', title: 'Unrelated', scopes: ['specdr'] });
    expect(ok(await run('vault.search', { query: 'specdr' })).hits).toEqual([]);
    expect(ok(await run('vault.search', { query: 'problem' })).hits).toEqual([]);
  });

  it('filters by kinds, layers and scopes, and honours the limit', async () => {
    const problem = await write({ kind: 'problem', title: 'Roadmap drift', scopes: ['bousleh'] });
    const idea = await write({ kind: 'idea', title: 'Roadmap review ritual', scopes: ['specdr'] });
    const signal = await write({ kind: 'signal', title: 'Roadmap feels stale', scopes: ['specdr'] });
    const ids = async (input: Record<string, unknown>) =>
      (ok(await run('vault.search', { query: 'roadmap', ...input })).hits as { id: string }[]).map((hit) => hit.id).sort();

    expect(await ids({ kinds: ['idea'] })).toEqual([idea]);
    expect(await ids({ kinds: ['idea', 'problem'] })).toEqual([idea, problem].sort());
    expect(await ids({ layers: ['evidence'] })).toEqual([signal]);
    expect(await ids({ scopes: ['specdr'] })).toEqual([idea, signal].sort());
    expect(await ids({ scopes: ['specdr'], layers: ['work'] })).toEqual([idea]);
    expect(await ids({ scopes: ['bousleh', 'specdr'] })).toEqual([problem, idea, signal].sort());
    expect(await ids({ limit: 2 })).toHaveLength(2);
  });

  it('refuses an unknown scope and an empty query, and writes nothing to the audit trail', async () => {
    expect(failed(await run('vault.search', { query: 'x', scopes: ['nowhere'] })).code).toBe('invalid_input');
    expect(failed(await run('vault.search', { query: '   ' })).code).toBe('invalid_input');
    expect(query<{ n: number }>("SELECT count(*) AS n FROM op_log WHERE op = 'vault.search'")[0]?.n).toBe(0);
  });
});

describe('vault.link', () => {
  it('links two objects once; linking again returns the same link', async () => {
    const problem = await write({ kind: 'problem', title: 'Slow exports' });
    const signal = await write({ kind: 'signal', title: 'Customer says exports are slow' });
    const first = ok(await run('vault.link', { from: signal, kind: 'evidence_for', to: problem, note: 'from the QBR' }));
    expect(first).toEqual({ id: expect.stringMatching(/^lnk_/), created: true });
    expect(ok(await run('vault.link', { from: signal, kind: 'evidence_for', to: problem }))).toEqual({ id: first.id, created: false });

    const object = ok(await run('vault.get', { id: problem }));
    expect(object.links.in).toEqual([expect.objectContaining({ id: first.id, kind: 'evidence_for', from: signal, note: 'from the QBR' })]);
  });

  it('refuses pairs the link rules do not allow, unknown ids and self-links', async () => {
    const problem = await write({ kind: 'problem', title: 'p' });
    const other = await write({ kind: 'problem', title: 'q' });
    expect(failed(await run('vault.link', { from: problem, kind: 'evidence_for', to: other })).code).toBe('invalid_input');
    expect(failed(await run('vault.link', { from: problem, kind: 'related', to: problem })).code).toBe('invalid_input');
    expect(failed(await run('vault.link', { from: problem, kind: 'related', to: 'prb_01JBX0000000000000000000AB' })).code).toBe(
      'not_found',
    );
    expect(failed(await run('vault.link', { from: problem, kind: 'sideways', to: other })).code).toBe('invalid_input');
  });

  it('concludes a bet and returns the idea version that did it; refuses an idea that is not a bet', async () => {
    const open = await write({ kind: 'idea', title: 'Not yet a bet' });
    const bet = await write({ kind: 'idea', title: 'Auto-drafts', status: 'bet', attrs: { hypothesis: 'h', kill_criteria: 'k' } });
    const decision = await write({ kind: 'decision', title: 'Scale auto-drafts' });

    expect(failed(await run('vault.link', { from: decision, kind: 'concludes', to: open })).code).toBe('conflict');
    const linked = ok(await run('vault.link', { from: decision, kind: 'concludes', to: bet }));
    expect(linked).toEqual({
      id: expect.stringMatching(/^lnk_/),
      created: true,
      concluded: { idea: bet, version: { id: expect.stringMatching(/^ver_/), n: 2 } },
    });
    expect(ok(await run('vault.get', { id: bet })).version).toMatchObject({ id: linked.concluded.version.id, status: 'concluded' });
    expect(ok(await run('vault.link', { from: decision, kind: 'concludes', to: bet }))).toEqual({ id: linked.id, created: false });
  });
});

describe('vault.unlink', () => {
  it('retracts a link without deleting it, and is safe to repeat', async () => {
    const meeting = await write({ kind: 'meeting', title: 'Roadmap review' });
    const peter = await person('Peter');
    const { id } = ok(await run('vault.link', { from: meeting, kind: 'attended_by', to: peter }));

    expect(ok(await run('vault.unlink', { id, reason: 'he missed it' }))).toEqual({
      id,
      kind: 'attended_by',
      from: meeting,
      to: peter,
      already_retracted: false,
    });
    expect(ok(await run('vault.get', { id: meeting })).links.out).toEqual([]);
    expect(query<{ n: number }>('SELECT count(*) AS n FROM links')[0]?.n).toBe(1);
    expect(query<{ reason: string; op: string }>('SELECT reason, op FROM link_retractions')).toEqual([
      { reason: 'he missed it', op: 'vault.unlink' },
    ]);
    expect(ok(await run('vault.unlink', { id })).already_retracted).toBe(true);
    expect(query<{ n: number }>('SELECT count(*) AS n FROM link_retractions')[0]?.n).toBe(1);

    const again = ok(await run('vault.link', { from: meeting, kind: 'attended_by', to: peter }));
    expect(again).toMatchObject({ created: true });
    expect(again.id).not.toBe(id);
  });

  it('refuses to retract a concludes link, and answers not_found for an unknown link', async () => {
    const bet = await write({ kind: 'idea', title: 'Bet', status: 'bet', attrs: { hypothesis: 'h', kill_criteria: 'k' } });
    const decision = await write({ kind: 'decision', title: 'Kill it' });
    const { id } = ok(await run('vault.link', { from: decision, kind: 'concludes', to: bet }));

    const refused = failed(await run('vault.unlink', { id }));
    expect(refused.code).toBe('conflict');
    expect(refused.message).toMatch(/concluded idea stays concluded/);
    expect(query<{ n: number }>('SELECT count(*) AS n FROM link_retractions')[0]?.n).toBe(0);
    expect(ok(await run('vault.get', { id: bet })).version.status).toBe('concluded');

    expect(failed(await run('vault.unlink', { id: 'lnk_01JBX0000000000000000000AB' })).code).toBe('not_found');
  });
});

describe('commitments', () => {
  async function setup() {
    const wassim = await person('Wassim');
    const peter = await person('Peter');
    const commit = async (title: string, extra: Record<string, unknown>, owedBy: string, owedTo: string) =>
      write({
        kind: 'commitment',
        title,
        altitude: 100,
        ...extra,
        links: [
          { kind: 'owed_by', to: owedBy },
          { kind: 'owed_to', to: owedTo },
        ],
      });
    const deck = await commit('Send the roadmap deck', { attrs: { due: '2026-10-28' } }, wassim, peter);
    const intro = await commit('Intro to the data team', { scopes: ['specdr'] }, peter, wassim);
    const spec = await commit('Review the POC spec', { attrs: { due: '2026-11-15' }, scopes: ['specdr'] }, wassim, peter);
    const old = await commit('Book the offsite', { status: 'done', attrs: { due: '2026-10-01' } }, wassim, peter);
    return { wassim, peter, deck, intro, spec, old };
  }
  const ids = (output: { commitments: { id: string }[] }) => output.commitments.map((c) => c.id);

  it('lists open commitments by due date, undated last, with who owes whom', async () => {
    const { wassim, peter, deck, intro, spec } = await setup();
    const listed = ok(await run('commitments.list', {}));
    expect(ids(listed)).toEqual([deck, spec, intro]);
    expect(listed.commitments[0]).toEqual({
      id: deck,
      title: 'Send the roadmap deck',
      status: 'open',
      altitude: 100,
      due: '2026-10-28',
      scopes: ['bousleh'],
      owed_by: [{ id: wassim, name: 'Wassim' }],
      owed_to: [{ id: peter, name: 'Peter' }],
    });
    expect(listed.commitments[2]).toMatchObject({ due: null, owed_by: [{ id: peter }], owed_to: [{ id: wassim }] });
  });

  it('filters by status, owed_by, owed_to, scope and due_before', async () => {
    const { wassim, peter, deck, intro, spec, old } = await setup();
    const list = async (input: Record<string, unknown>) => ids(ok(await run('commitments.list', input)));
    expect(await list({ status: 'done' })).toEqual([old]);
    expect(await list({ status: 'any' })).toEqual([old, deck, spec, intro]);
    expect(await list({ owed_by: wassim })).toEqual([deck, spec]);
    expect(await list({ owed_to: wassim })).toEqual([intro]);
    expect(await list({ owed_by: peter, owed_to: wassim })).toEqual([intro]);
    expect(await list({ scope: 'specdr' })).toEqual([spec, intro]);
    expect(await list({ due_before: '2026-10-28' })).toEqual([deck]);
    expect(await list({ due_before: '2026-10-27' })).toEqual([]);
    expect(await list({ status: 'any', due_before: '2026-10-31' })).toEqual([old, deck]);
    expect(await list({ limit: 1 })).toEqual([deck]);
  });

  it('follows retracted links', async () => {
    const { wassim, deck } = await setup();
    const link = ok(await run('vault.get', { id: deck })).links.out.find((l: { kind: string }) => l.kind === 'owed_by');
    ok(await run('vault.unlink', { id: link.id, reason: 'Peter took it' }));
    expect(ids(ok(await run('commitments.list', { owed_by: wassim })))).not.toContain(deck);
    expect(ok(await run('commitments.list', {})).commitments[0]).toMatchObject({ id: deck, owed_by: [] });
  });

  it('refuses unknown people, ids that are not people, and unknown scopes', async () => {
    const { deck } = await setup();
    expect(failed(await run('commitments.list', { owed_by: 'per_01JBX0000000000000000000AB' })).code).toBe('not_found');
    expect(failed(await run('commitments.list', { owed_to: deck })).code).toBe('invalid_input');
    expect(failed(await run('commitments.list', { scope: 'nowhere' })).code).toBe('invalid_input');
    expect(failed(await run('commitments.list', { status: 'late' })).code).toBe('invalid_input');
    expect(failed(await run('commitments.list', { due_before: 'Friday' })).code).toBe('invalid_input');
  });

  it('closes a commitment as a new version, with the note appended to the body', async () => {
    const id = await write({ kind: 'commitment', title: 'Send notes', body: 'From the Monday sync.' });
    const closed = ok(await run('commitments.close', { id, status: 'done', note: 'Sent by email.' }));
    expect(closed).toMatchObject({ id, kind: 'commitment', status: 'done', version: { n: 2 }, supersedes: expect.stringMatching(/^ver_/) });

    const object = ok(await run('vault.get', { id, history: true }));
    expect(object.version.status).toBe('done');
    expect(object.version.body).toMatch(/^From the Monday sync\.\n\n\*\*Done on 2026-10-25:\*\* Sent by email\.$/);
    expect(object.history.map((v: { status: string }) => v.status)).toEqual(['open', 'done']);
  });

  it('drops a commitment without a note, keeping the body as it was', async () => {
    const id = await write({ kind: 'commitment', title: 'Draft the memo', body: 'Short one.' });
    ok(await run('commitments.close', { id, status: 'dropped' }));
    expect(ok(await run('vault.get', { id })).version).toMatchObject({ status: 'dropped', body: 'Short one.' });
  });

  it('refuses to close twice, to reopen, and to close something that is not a commitment', async () => {
    const id = await write({ kind: 'commitment', title: 'Once' });
    ok(await run('commitments.close', { id, status: 'done' }));
    expect(failed(await run('commitments.close', { id, status: 'dropped' })).code).toBe('conflict');
    expect(failed(await run('commitments.close', { id, status: 'open' })).code).toBe('invalid_input');
    const problem = await write({ kind: 'problem', title: 'Not a commitment' });
    expect(failed(await run('commitments.close', { id: problem, status: 'done' })).code).toBe('invalid_input');
    expect(failed(await run('commitments.close', { id: 'cmt_01JBX0000000000000000000AB', status: 'done' })).code).toBe('not_found');
    expect(query<{ n: number }>(`SELECT count(*) AS n FROM versions WHERE object_id = '${problem}'`)[0]?.n).toBe(1);
  });
});

describe('people.get', () => {
  it('returns the person, their growth notes, open commitments both ways, and recent linked objects', async () => {
    const sara = await write({
      kind: 'person',
      title: 'Sara',
      altitude: 1000,
      scopes: ['bousleh'],
      attrs: { role: 'pm', org: 'Alethea' },
      body: 'Joined in October.',
    });
    const wassim = await person('Wassim');
    const firstNote = await write({
      kind: 'growth_note',
      title: 'Strong discovery instincts',
      body: 'Asked the right why.',
      links: [{ kind: 'about', to: sara }],
    });
    const secondNote = await write({ kind: 'growth_note', title: 'Practise saying no', links: [{ kind: 'about', to: sara }] });
    const owes = await write({
      kind: 'commitment',
      title: 'Share the discovery plan',
      links: [
        { kind: 'owed_by', to: sara },
        { kind: 'owed_to', to: wassim },
      ],
    });
    const owed = await write({
      kind: 'commitment',
      title: 'Intro Sara to Peter',
      links: [
        { kind: 'owed_by', to: wassim },
        { kind: 'owed_to', to: sara },
      ],
    });
    const done = await write({ kind: 'commitment', title: 'Old one', status: 'done', links: [{ kind: 'owed_by', to: sara }] });
    const meeting = await write({ kind: 'meeting', title: 'Sara 1:1', links: [{ kind: 'attended_by', to: sara }] });
    const decision = await write({ kind: 'decision', title: 'Sara owns onboarding', links: [{ kind: 'owned_by', to: sara }] });
    ok(await run('vault.link', { from: decision, kind: 'about', to: sara }));
    const elsewhere = await write({ kind: 'problem', title: 'Unrelated' });

    const profile = ok(await run('people.get', { id: sara }));
    expect(profile.person).toMatchObject({
      id: sara,
      name: 'Sara',
      role: 'pm',
      org: 'Alethea',
      scopes: ['bousleh'],
      body: 'Joined in October.',
    });
    expect(profile.growth_notes.map((note: { id: string }) => note.id)).toEqual([secondNote, firstNote]);
    expect(profile.growth_notes[1]).toMatchObject({
      title: 'Strong discovery instincts',
      body: 'Asked the right why.',
      scopes: ['bousleh'],
    });
    expect(profile.commitments.owes.map((c: { id: string }) => c.id)).toEqual([owes]);
    expect(profile.commitments.owes[0].owed_to).toEqual([{ id: wassim, name: 'Wassim' }]);
    expect(profile.commitments.owed.map((c: { id: string }) => c.id)).toEqual([owed]);

    const recent = profile.recent as { id: string; links: { kind: string; direction: string }[] }[];
    expect(recent.map((item) => item.id)).toEqual([decision, meeting, done]);
    expect(recent[0]).toMatchObject({ kind: 'decision', layer: 'work', title: 'Sara owns onboarding' });
    expect(recent[0]?.links).toEqual([
      { kind: 'owned_by', direction: 'in' },
      { kind: 'about', direction: 'in' },
    ]);
    expect(recent.map((item) => item.id)).not.toContain(elsewhere);

    expect(ok(await run('people.get', { id: sara, recent: 1 })).recent.map((item: { id: string }) => item.id)).toEqual([decision]);
  });

  it('works for a person with nothing linked, and refuses anything that is not a person', async () => {
    const lone = await person('Lone');
    expect(ok(await run('people.get', { id: lone }))).toMatchObject({
      person: { name: 'Lone', role: 'stakeholder', org: 'Alethea', scopes: [], body: '' },
      growth_notes: [],
      commitments: { owes: [], owed: [] },
      recent: [],
    });
    const problem = await write({ kind: 'problem', title: 'p' });
    expect(failed(await run('people.get', { id: problem })).code).toBe('invalid_input');
    expect(failed(await run('people.get', { id: 'per_01JBX0000000000000000000AB' })).code).toBe('not_found');
  });
});
