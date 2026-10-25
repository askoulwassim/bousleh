import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OPS, type OpContext, type OpOutcome, type WatchListView } from '@bousleh/contracts';
import { cleanUrl, urlKey } from '@bousleh/watch';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* End to end through runOp: watch lists per scope (watchlists.get, watchlists.set), filing findings (watch.file) and the digest (watch.digest). */

let clock = Date.parse('2026-10-25T09:00:00.000Z');
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;

function ok<T = Record<string, unknown>>(outcome: OpOutcome): T {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.code}: ${outcome.message}`);
  return outcome.output as T;
}
function failed(outcome: OpOutcome): { code: string; message: string } {
  if (outcome.status !== 'error') throw new Error('expected an error');
  return outcome;
}
const run = (name: string, input: unknown) => engine.runOp(name, input, ctx);

type SetResult = WatchListView & { created: boolean; new_version: boolean };
interface FileResult {
  watch_list: { id: string; title: string; scopes: string[] };
  filed: { id: string; title: string; url: string }[];
  skipped: { title: string; url: string; reason: string; existing_id: string }[];
}
interface Digest {
  since: string;
  until: string;
  total: number;
  groups: {
    watch_list: { id: string; title: string } | null;
    findings: { id: string; title: string; url: string; published_at: string | null; filed_at: string; summary: string }[];
  }[];
}

const competitors = [
  { type: 'competitor', name: 'Glean', url: 'https://www.glean.com' },
  { type: 'topic', name: 'Agentic analytics', notes: 'Anything on agents replacing dashboards' },
];

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-watch-'));
  engine = openEngine({ home });
  ok(await run('scopes.add', { slug: 'bousleh', name: 'Bousleh', kind: 'project' }));
  ok(await run('scopes.add', { slug: 'specdr', name: 'Specdr', kind: 'product' }));
});
afterEach(() => {
  engine.close();
  rmSync(home, { recursive: true, force: true });
});

describe('watchlists.set and watchlists.get', () => {
  it('creates one watch list per scope and reads it back by scope or id', async () => {
    const bousleh = ok<SetResult>(await run('watchlists.set', { scope: 'bousleh', entries: competitors }));
    expect(bousleh).toMatchObject({
      title: 'Watch list: Bousleh',
      altitude: 10000,
      scopes: ['bousleh'],
      entries: competitors,
      version: { n: 1 },
      created: true,
      new_version: true,
    });
    const specdr = ok<SetResult>(
      await run('watchlists.set', { scope: 'specdr', entries: [{ type: 'podcast', name: 'Latent Space' }], altitude: 1000 }),
    );
    expect(specdr.id).not.toBe(bousleh.id);

    const byScope = ok<{ watch_lists: WatchListView[] }>(await run('watchlists.get', { scope: 'specdr' })).watch_lists;
    expect(byScope).toEqual([expect.objectContaining({ id: specdr.id, entries: [{ type: 'podcast', name: 'Latent Space' }] })]);
    const byId = ok<{ watch_lists: WatchListView[] }>(await run('watchlists.get', { id: bousleh.id })).watch_lists;
    expect(byId.map((list) => list.id)).toEqual([bousleh.id]);
    const all = ok<{ watch_lists: WatchListView[] }>(await run('watchlists.get', {})).watch_lists;
    expect(all.map((list) => list.scopes)).toEqual([['bousleh'], ['specdr']]);
    expect(OPS['watchlists.get'].readOnly).toBe(true);
  });

  it("replaces a watch list's entries as a new version, by scope or by id, and skips a no-op", async () => {
    const created = ok<SetResult>(await run('watchlists.set', { scope: 'bousleh', entries: competitors }));
    const replaced = ok<SetResult>(await run('watchlists.set', { scope: 'bousleh', entries: [competitors[1]] }));
    expect(replaced).toMatchObject({ id: created.id, version: { n: 2 }, entries: [competitors[1]], created: false, new_version: true });

    const same = ok<SetResult>(await run('watchlists.set', { id: created.id, entries: [competitors[1]] }));
    expect(same).toMatchObject({ version: { n: 2 }, new_version: false });

    const renamed = ok<SetResult>(await run('watchlists.set', { id: created.id, entries: [], title: 'Horizon: Bousleh' }));
    expect(renamed).toMatchObject({ version: { n: 3 }, entries: [], title: 'Horizon: Bousleh' });
    expect(ok<{ watch_lists: WatchListView[] }>(await run('watchlists.get', { scope: 'bousleh' })).watch_lists).toHaveLength(1);
  });

  it('needs exactly one of id and scope, a known scope, and a watch list id', async () => {
    const created = ok<SetResult>(await run('watchlists.set', { scope: 'bousleh', entries: [] }));
    expect(failed(await run('watchlists.set', { entries: [] })).code).toBe('invalid_input');
    expect(failed(await run('watchlists.set', { id: created.id, scope: 'bousleh', entries: [] })).code).toBe('invalid_input');
    expect(failed(await run('watchlists.set', { scope: 'nowhere', entries: [] })).code).toBe('invalid_input');
    expect(failed(await run('watchlists.get', { scope: 'nowhere' })).code).toBe('invalid_input');
    expect(failed(await run('watchlists.set', { scope: 'bousleh', entries: [{ type: 'rumour', name: 'x' }] })).code).toBe('invalid_input');
    expect(ok<{ watch_lists: unknown[] }>(await run('watchlists.get', { scope: 'specdr' })).watch_lists).toEqual([]);
  });
});

describe('watch.file', () => {
  it("files findings in the watch list's scopes, linked to it, and skips urls already filed", async () => {
    const list = ok<SetResult>(await run('watchlists.set', { scope: 'specdr', entries: competitors, altitude: 1000 }));
    const first = ok<FileResult>(
      await run('watch.file', {
        scope: 'specdr',
        findings: [
          {
            title: 'Glean ships agent builder',
            url: 'https://www.glean.com/blog/agents/?utm_source=x#top',
            published_at: '2026-10-24',
            summary: 'Glean now lets customers build agents on their index.',
          },
          { title: 'Dashboards are dead', url: 'https://example.com/dashboards' },
        ],
      }),
    );
    expect(first.watch_list).toEqual({ id: list.id, title: 'Watch list: Specdr', scopes: ['specdr'] });
    expect(first.filed.map((f) => f.url)).toEqual(['https://www.glean.com/blog/agents/', 'https://example.com/dashboards']);
    expect(first.skipped).toEqual([]);

    const finding = ok<{
      kind: string;
      scopes: string[];
      version: { altitude: number; attrs: Record<string, unknown>; body: string };
      links: { out: { kind: string; to: string }[] };
    }>(await run('vault.get', { id: first.filed[0]?.id }));
    expect(finding).toMatchObject({
      kind: 'finding',
      scopes: ['specdr'],
      version: {
        altitude: 1000,
        attrs: { url: 'https://www.glean.com/blog/agents/', published_at: '2026-10-24' },
        body: 'Glean now lets customers build agents on their index.',
      },
    });
    expect(finding.links.out).toEqual([expect.objectContaining({ kind: 'from_watch_list', to: list.id })]);

    const second = ok<FileResult>(
      await run('watch.file', {
        watch_list_id: list.id,
        findings: [
          { title: 'Glean agents (again)', url: 'http://glean.com/blog/agents' },
          { title: 'New one', url: 'https://example.com/new' },
          { title: 'New one, twice', url: 'https://example.com/new/' },
        ],
      }),
    );
    expect(second.filed.map((f) => f.title)).toEqual(['New one']);
    expect(second.skipped).toEqual([
      { title: 'Glean agents (again)', url: 'http://glean.com/blog/agents', reason: 'already_filed', existing_id: first.filed[0]?.id },
      { title: 'New one, twice', url: 'https://example.com/new/', reason: 'repeated', existing_id: second.filed[0]?.id },
    ]);
  });

  it('dedupes across watch lists', async () => {
    ok(await run('watchlists.set', { scope: 'bousleh', entries: [] }));
    const specdr = ok<SetResult>(await run('watchlists.set', { scope: 'specdr', entries: [] }));
    ok(await run('watch.file', { scope: 'bousleh', findings: [{ title: 'Shared news', url: 'https://example.com/shared' }] }));
    const again = ok<FileResult>(
      await run('watch.file', { watch_list_id: specdr.id, findings: [{ title: 'Shared news', url: 'https://example.com/shared' }] }),
    );
    expect(again.filed).toEqual([]);
    expect(again.skipped.map((s) => s.reason)).toEqual(['already_filed']);
  });

  it('needs a watch list that exists', async () => {
    const finding = { title: 'x', url: 'https://example.com/x' };
    expect(failed(await run('watch.file', { scope: 'specdr', findings: [finding] })).message).toMatch(/watchlists.set/);
    expect(failed(await run('watch.file', { findings: [finding] })).code).toBe('invalid_input');
    expect(failed(await run('watch.file', { scope: 'specdr', findings: [{ title: 'x', url: 'not a url' }] })).code).toBe('invalid_input');
  });

  it('cleans urls without losing what matters', () => {
    expect(cleanUrl('https://Example.com/a?id=1&utm_medium=email#frag')).toBe('https://example.com/a?id=1');
    expect(urlKey('http://www.example.com/a/')).toBe(urlKey('https://example.com/a'));
    expect(urlKey('https://example.com/a?id=1')).not.toBe(urlKey('https://example.com/a?id=2'));
  });
});

describe('watch.digest', () => {
  const at = (iso: string) => {
    clock = Date.parse(iso);
  };

  it('returns findings filed in the window, grouped by watch list, newest first', async () => {
    at('2026-10-01T09:00:00.000Z');
    const bousleh = ok<SetResult>(await run('watchlists.set', { scope: 'bousleh', entries: [] }));
    const specdr = ok<SetResult>(await run('watchlists.set', { scope: 'specdr', entries: [] }));

    at('2026-10-14T09:00:00.000Z');
    ok(await run('watch.file', { scope: 'bousleh', findings: [{ title: 'Old news', url: 'https://example.com/old' }] }));

    at('2026-10-22T09:00:00.000Z');
    ok(
      await run('watch.file', {
        scope: 'bousleh',
        findings: [
          { title: 'Older article, found this week', url: 'https://example.com/a', published_at: '2026-09-30', summary: 'A.' },
          { title: 'Fresh article', url: 'https://example.com/b', published_at: '2026-10-21T08:00:00Z', summary: 'B.' },
        ],
      }),
    );
    ok(
      await run('watch.file', {
        scope: 'specdr',
        findings: [{ title: 'Specdr news', url: 'https://example.com/c', summary: 'C. '.repeat(300) }],
      }),
    );

    at('2026-10-25T09:00:00.000Z');
    const digest = ok<Digest>(await run('watch.digest', {}));
    expect(digest.since).toBe('2026-10-18T09:00:01.000Z');
    expect(digest.total).toBe(3);
    expect(digest.groups.map((g) => g.watch_list?.id)).toEqual([bousleh.id, specdr.id]);
    expect(digest.groups[0]?.findings.map((f) => [f.title, f.published_at])).toEqual([
      ['Fresh article', '2026-10-21T08:00:00Z'],
      ['Older article, found this week', '2026-09-30'],
    ]);
    const specdrFinding = digest.groups[1]?.findings[0];
    expect(specdrFinding).toMatchObject({ title: 'Specdr news', url: 'https://example.com/c', published_at: null });
    expect(specdrFinding?.summary.length).toBeLessThanOrEqual(501);
    expect(specdrFinding?.summary.endsWith('…')).toBe(true);

    const wider = ok<Digest>(await run('watch.digest', { since: '2026-10-10' }));
    expect(wider.total).toBe(4);
    expect(wider.groups[0]?.findings.map((f) => f.title)).toContain('Old news');
  });

  it('filters by scope and by watch list, and honours the limit', async () => {
    const bousleh = ok<SetResult>(await run('watchlists.set', { scope: 'bousleh', entries: [] }));
    ok(await run('watchlists.set', { scope: 'specdr', entries: [] }));
    ok(
      await run('watch.file', {
        scope: 'bousleh',
        findings: [
          { title: 'One', url: 'https://example.com/1' },
          { title: 'Two', url: 'https://example.com/2' },
        ],
      }),
    );
    ok(await run('watch.file', { scope: 'specdr', findings: [{ title: 'Three', url: 'https://example.com/3' }] }));

    const byScope = ok<Digest>(await run('watch.digest', { scope: 'specdr' }));
    expect(byScope.groups.flatMap((g) => g.findings.map((f) => f.title))).toEqual(['Three']);
    const byList = ok<Digest>(await run('watch.digest', { watch_list_id: bousleh.id }));
    expect(byList.groups).toHaveLength(1);
    expect(byList.groups[0]?.findings.map((f) => f.title).sort()).toEqual(['One', 'Two']);
    const limited = ok<Digest>(await run('watch.digest', { limit: 1 }));
    expect(limited.total).toBe(3);
    expect(limited.groups.flatMap((g) => g.findings.map((f) => f.title))).toEqual(['Three']);

    expect(failed(await run('watch.digest', { scope: 'nowhere' })).code).toBe('invalid_input');
    expect(OPS['watch.digest'].readOnly).toBe(true);
  });

  it('puts findings filed without a watch list last, under null', async () => {
    const list = ok<SetResult>(await run('watchlists.set', { scope: 'bousleh', entries: [] }));
    ok(await run('watch.file', { watch_list_id: list.id, findings: [{ title: 'Listed', url: 'https://example.com/listed' }] }));
    ok(
      await run('deposits.write', {
        kind: 'finding',
        title: 'Filed by hand',
        altitude: 1000,
        scopes: ['bousleh'],
        attrs: { url: 'https://example.com/hand' },
      }),
    );
    const digest = ok<Digest>(await run('watch.digest', {}));
    expect(digest.groups.map((g) => g.watch_list?.title ?? null)).toEqual(['Watch list: Bousleh', null]);
  });
});
