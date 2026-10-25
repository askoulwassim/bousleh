import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPS, type OpContext, type OpOutcome, type OpOutput } from '@bousleh/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* End to end through runOp: signals.patterns, feedback counted by tag. */

type Patterns = OpOutput<'signals.patterns'>;

/* The clock runs on this machine's time zone, as the windows do. `at` moves it to a local moment, never backwards. */
let clock = 0;
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const at = (month: number, d: number, h = 9, min = 0) => {
  const next = new Date(2026, month - 1, d, h, min).getTime();
  if (next < clock) throw new Error('the test clock only moves forward');
  clock = next;
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
beforeEach(async () => {
  clock = new Date(2026, 8, 1, 9, 0).getTime();
  home = mkdtempSync(join(tmpdir(), 'bousleh-signals-'));
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
const patterns = async (input: unknown = {}) => ok<Patterns>(await run('signals.patterns', input));
const person = async (name: string) => ok<{ id: string }>(await run('deposits.write', { kind: 'person', title: name, altitude: 10000 })).id;
const signal = async (title: string, attrs: Record<string, unknown>, more: { about?: string[]; scopes?: string[] } = {}): Promise<string> =>
  ok<{ id: string }>(
    await run('deposits.write', {
      kind: 'signal',
      title,
      altitude: 1000,
      scopes: more.scopes ?? ['narratives'],
      attrs,
      links: (more.about ?? []).map((to) => ({ kind: 'about', to })),
    }),
  ).id;

describe('signals.patterns', () => {
  it('answers an empty vault', async () => {
    expect(OPS['signals.patterns'].readOnly).toBe(true);
    at(10, 25);
    expect(await patterns()).toMatchObject({ signals: 0, untagged: 0, patterns: [], more: 0, scopes: [] });
  });

  it('groups by tag: count, sources, people, sentiment, newest and examples, strongest first', async () => {
    const peter = await person('Peter');
    const lisa = await person('Lisa');
    at(10, 10);
    const first = await signal(
      'Exports take minutes',
      { tags: ['export-speed'], source: 'Peter', sentiment: 'negative' },
      { about: [peter] },
    );
    at(10, 12);
    await signal('CSV export timed out', { tags: ['export-speed', 'reliability'], source: 'Support ticket', sentiment: 'negative' });
    at(10, 20);
    const newest = await signal(
      'Export is fine now?',
      { tags: ['export-speed'], source: 'Peter', sentiment: 'mixed' },
      { about: [peter, lisa] },
    );
    await signal('Love the new chart', { tags: ['charts'], source: 'Lisa', sentiment: 'positive' }, { about: [lisa] });
    await signal('Charts are cluttered', { tags: ['charts'], source: 'Sam' });
    await signal('Something untagged', { source: 'Peter' });
    await signal('One-off', { tags: ['pricing'] });

    at(10, 25);
    const result = await patterns();
    expect(result.signals).toBe(7);
    expect(result.untagged).toBe(1);
    expect(result.patterns.map((p) => [p.tag, p.count])).toEqual([
      ['export-speed', 3],
      ['charts', 2],
    ]);
    const exports = result.patterns[0];
    expect(exports?.sources).toEqual(['Peter', 'Support ticket']);
    expect(exports?.people).toEqual([
      { id: peter, name: 'Peter' },
      { id: lisa, name: 'Lisa' },
    ]);
    expect(exports?.sentiment).toEqual({ positive: 0, neutral: 0, negative: 2, mixed: 1, unknown: 0 });
    expect(exports?.examples.map((e) => e.id)).toHaveLength(3);
    expect(exports?.examples[0]).toMatchObject({ id: newest, title: 'Export is fine now?', source: 'Peter', sentiment: 'mixed' });
    expect(exports?.examples.at(-1)?.id).toBe(first);
    expect(exports?.newest_at).toBe(exports?.examples[0]?.filed_at);
    expect(result.patterns[1]?.sentiment).toEqual({ positive: 1, neutral: 0, negative: 0, mixed: 0, unknown: 1 });

    // min_count 1 lists every tag in use, so Capture can reuse one; limit caps them.
    const all = await patterns({ min_count: 1 });
    expect(all.patterns.map((p) => p.tag)).toEqual(['export-speed', 'charts', 'pricing', 'reliability']);
    const capped = await patterns({ min_count: 1, limit: 2 });
    expect(capped.patterns).toHaveLength(2);
    expect(capped.more).toBe(2);
  });

  it('keeps up to five examples and leaves out signals another signal replaced', async () => {
    at(10, 20);
    const ids: string[] = [];
    for (let i = 1; i <= 7; i += 1) ids.push(await signal(`Onboarding pain ${i}`, { tags: ['onboarding'] }));
    const replacement = await signal('Onboarding pain, restated', { tags: ['onboarding'] });
    ok(await run('vault.link', { from: replacement, kind: 'supersedes', to: ids[0] }));

    at(10, 25);
    const [onboarding] = (await patterns()).patterns;
    expect(onboarding?.count).toBe(7);
    expect(onboarding?.examples.map((e) => e.id)).toEqual([replacement, ...ids.slice(3).reverse()]);
  });

  it('defaults to the last 30 days, and reads since and until as whole local days', async () => {
    at(9, 20, 23, 30);
    await signal('Too old by a little', { tags: ['latency'] });
    at(9, 26, 0, 0);
    await signal('Day one of the window', { tags: ['latency'] });
    at(10, 24, 23, 59);
    await signal('Late on the 24th', { tags: ['latency'] });
    at(10, 25, 0, 0);
    await signal('Midnight on the 25th', { tags: ['latency'] });

    at(10, 25, 9, 0);
    const recent = await patterns({ min_count: 1 });
    expect(recent.until).toBe(new Date(2026, 9, 25, 9, 0, 1).toISOString());
    expect(recent.patterns[0]?.count).toBe(3);

    const days = await patterns({ since: '2026-09-26', until: '2026-10-24', min_count: 1 });
    expect(days.since).toBe(new Date(2026, 8, 26).toISOString());
    expect(days.until).toBe(new Date(2026, 9, 25).toISOString());
    expect(days.patterns[0]?.examples.map((e) => e.title)).toEqual(['Late on the 24th', 'Day one of the window']);

    // Date-times are instants: the window runs from one to the other, both included.
    const instant = await patterns({
      since: new Date(2026, 9, 25).toISOString(),
      until: new Date(2026, 9, 25, 0, 1).toISOString(),
      min_count: 1,
    });
    expect(instant.patterns[0]?.examples.map((e) => e.title)).toEqual(['Midnight on the 25th']);
  });

  it('narrows to scopes, child scopes included', async () => {
    at(10, 20);
    await signal('Product feedback', { tags: ['search'] }, { scopes: ['narratives'] });
    await signal('Company feedback', { tags: ['search'] }, { scopes: ['alethea'] });
    await signal('Elsewhere', { tags: ['search'] }, { scopes: ['bousleh'] });

    at(10, 25);
    const company = await patterns({ scopes: ['alethea'] });
    expect(company.scopes).toEqual(['alethea', 'narratives']);
    expect(company.patterns.map((p) => [p.tag, p.count])).toEqual([['search', 2]]);
    expect((await patterns({ scopes: ['narratives'] })).patterns).toEqual([]);
    expect(failed(await run('signals.patterns', { scopes: ['nowhere'] })).code).toBe('invalid_input');
  });
});
