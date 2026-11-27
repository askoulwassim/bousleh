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
    findings: { id: string; title: string; status: string; url: string; published_at: string | null; filed_at: string; summary: string }[];
  }[];
}

const competitors = [
  { type: 'competitor', name: 'Lumen Search', url: 'https://www.lumensearch.example' },
  { type: 'topic', name: 'Agentic analytics', notes: 'Anything on agents replacing dashboards' },
];

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-watch-'));
  engine = openEngine({ home });
  ok(await run('scopes.add', { slug: 'bousleh', name: 'Bousleh', kind: 'project' }));
  ok(await run('scopes.add', { slug: 'harbor', name: 'Harbor', kind: 'product' }));
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
    const harbor = ok<SetResult>(
      await run('watchlists.set', { scope: 'harbor', entries: [{ type: 'podcast', name: 'Product Loop' }], altitude: 1000 }),
    );
    expect(harbor.id).not.toBe(bousleh.id);

    const byScope = ok<{ watch_lists: WatchListView[] }>(await run('watchlists.get', { scope: 'harbor' })).watch_lists;
    expect(byScope).toEqual([
      expect.objectContaining({ id: harbor.id, entries: [{ type: 'podcast', name: 'Product Loop', added_by: 'user' }] }),
    ]);
    const byId = ok<{ watch_lists: WatchListView[] }>(await run('watchlists.get', { id: bousleh.id })).watch_lists;
    expect(byId.map((list) => list.id)).toEqual([bousleh.id]);
    const all = ok<{ watch_lists: WatchListView[] }>(await run('watchlists.get', {})).watch_lists;
    expect(all.map((list) => list.scopes)).toEqual([['bousleh'], ['harbor']]);
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
    expect(ok<{ watch_lists: unknown[] }>(await run('watchlists.get', { scope: 'harbor' })).watch_lists).toEqual([]);
  });
});

describe('watch list entries: who added them', () => {
  const entries = async (scope = 'bousleh') =>
    ok<{ watch_lists: WatchListView[] }>(await run('watchlists.get', { scope })).watch_lists[0]?.entries ?? [];

  it("are Alex's by default, and take horizon with a reason", async () => {
    const created = ok<SetResult>(
      await run('watchlists.set', {
        scope: 'bousleh',
        entries: [
          { type: 'competitor', name: 'Lumen Search', url: 'https://www.lumensearch.example' },
          { type: 'outlet', name: 'Signal Weekly', added_by: 'horizon', reason: 'cited in 3 findings as the source' },
        ],
      }),
    );
    expect(created.entries).toEqual([
      { type: 'competitor', name: 'Lumen Search', url: 'https://www.lumensearch.example', added_by: 'user' },
      { type: 'outlet', name: 'Signal Weekly', added_by: 'horizon', reason: 'cited in 3 findings as the source' },
    ]);
    const stored = ok<{ version: { attrs: { entries: unknown[] } } }>(await run('vault.get', { id: created.id }));
    expect(stored.version.attrs.entries).toEqual(created.entries);
    expect(failed(await run('watchlists.set', { scope: 'bousleh', entries: [{ type: 'topic', name: 'x', added_by: 'bot' }] })).code).toBe(
      'invalid_input',
    );
  });

  it('keep their added_by and reason when watchlists.set leaves them out, matched by url or by type and name', async () => {
    const first = ok<SetResult>(
      await run('watchlists.set', {
        scope: 'bousleh',
        entries: [
          { type: 'competitor', name: 'Lumen Search', url: 'https://www.lumensearch.example' },
          {
            type: 'competitor',
            name: 'Quarry AI',
            url: 'https://quarryai.example',
            added_by: 'horizon',
            reason: 'direct alternative in 3 articles',
          },
          { type: 'podcast', name: 'Product Loop', added_by: 'horizon', reason: 'two episodes on agent memory' },
        ],
      }),
    );

    // The complete list again, as a model would send it after adding one entry: nothing marked.
    const second = ok<SetResult>(
      await run('watchlists.set', {
        id: first.id,
        entries: [
          { type: 'competitor', name: 'Lumen Search', url: 'https://lumensearch.example/' },
          { type: 'competitor', name: 'Quarry AI Inc', url: 'https://www.quarryai.example' },
          { type: 'podcast', name: 'product loop', notes: 'show notes only' },
          { type: 'topic', name: 'Agent memory' },
        ],
      }),
    );
    expect(second.version.n).toBe(2);
    expect(second.entries.map((e) => [e.name, e.added_by, e.reason ?? null])).toEqual([
      ['Lumen Search', 'user', null],
      ['Quarry AI Inc', 'horizon', 'direct alternative in 3 articles'],
      ['product loop', 'horizon', 'two episodes on agent memory'],
      ['Agent memory', 'user', null],
    ]);

    // The same list again writes nothing; an explicit added_by wins (Alex adopts an entry).
    const same = ok<SetResult>(await run('watchlists.set', { id: first.id, entries: second.entries.map(({ added_by, ...e }) => e) }));
    expect(same.new_version).toBe(false);
    const adopted = ok<SetResult>(
      await run('watchlists.set', {
        id: first.id,
        entries: second.entries.map((e) => (e.name === 'Quarry AI Inc' ? { ...e, added_by: 'user' as const } : e)),
      }),
    );
    expect(adopted.entries.find((e) => e.name === 'Quarry AI Inc')?.added_by).toBe('user');
    expect((await entries()).map((e) => e.added_by)).toEqual(['user', 'user', 'horizon', 'user']);

    // Every change is a version: the history shows what the list held before.
    const history = ok<{ history: { n: number }[] }>(await run('vault.get', { id: first.id, history: true })).history;
    expect(history.map((v) => v.n)).toEqual([1, 2, 3]);
  });
});

describe('watchlists.apply: the scan learns, Alex keeps the last word', () => {
  interface ApplyResult {
    watch_list: WatchListView;
    new_version: boolean;
    results: { action: string; type: string; name: string; outcome: string; queue_id?: string }[];
  }
  interface QueueItems {
    items: {
      id: string;
      reason: string;
      draft: { kind: string; title: string; scopes: string[]; altitude: number; body: string };
      candidates: { id: string }[];
    }[];
  }

  async function seedList(): Promise<SetResult> {
    return ok<SetResult>(
      await run('watchlists.set', {
        scope: 'bousleh',
        entries: [
          { type: 'competitor', name: 'Lumen Search', url: 'https://www.lumensearch.example' },
          { type: 'outlet', name: 'Some Blog', url: 'https://someblog.example', added_by: 'horizon', reason: 'covered agent memory twice' },
          { type: 'topic', name: 'Agentic analytics' },
        ],
      }),
    );
  }

  it('adds as horizon, removes only what horizon added, and queues removing one of Alex’s entries once', async () => {
    const list = await seedList();
    const applied = ok<ApplyResult>(
      await run('watchlists.apply', {
        id: list.id,
        source: 'horizon-scan-bousleh-2026-10-26.md',
        changes: [
          {
            action: 'add',
            type: 'competitor',
            name: 'Quarry AI',
            url: 'https://quarryai.example',
            reason: 'direct alternative in 3 articles',
          },
          { action: 'add', type: 'competitor', name: 'Lumen Search', url: 'https://lumensearch.example/', reason: 'again' },
          { action: 'remove', type: 'outlet', name: 'Some Blog', url: 'https://www.someblog.example/', reason: 'now covers crypto' },
          { action: 'remove', type: 'topic', name: 'agentic analytics', reason: 'quiet for 4 weeks' },
          { action: 'remove', type: 'podcast', name: 'Not There', reason: 'n/a' },
        ],
      }),
    );
    expect(applied.new_version).toBe(true);
    expect(applied.results.map((r) => [r.name, r.outcome])).toEqual([
      ['Quarry AI', 'added'],
      ['Lumen Search', 'already_on_list'],
      ['Some Blog', 'removed'],
      ['agentic analytics', 'queued'],
      ['Not There', 'not_on_list'],
    ]);
    expect(applied.watch_list.version.n).toBe(2);
    expect(applied.watch_list.entries).toEqual([
      { type: 'competitor', name: 'Lumen Search', url: 'https://www.lumensearch.example', added_by: 'user' },
      { type: 'topic', name: 'Agentic analytics', added_by: 'user' },
      {
        type: 'competitor',
        name: 'Quarry AI',
        url: 'https://quarryai.example',
        added_by: 'horizon',
        reason: 'direct alternative in 3 articles',
      },
    ]);

    // The suggestion waits in the queue for Alex, tied to the watch list.
    const queue = ok<QueueItems>(await run('queue.list', {})).items;
    expect(queue).toHaveLength(1);
    const item = queue[0];
    expect(item?.id).toBe(applied.results[3]?.queue_id);
    expect(item?.reason).toBe('Horizon suggests removing an entry the user added; the user decides');
    expect(item?.candidates.map((c) => c.id)).toEqual([list.id]);
    expect(item?.draft).toMatchObject({
      kind: 'observation',
      title: 'Remove "Agentic analytics" from the bousleh watch list?',
      scopes: ['bousleh'],
      altitude: 10000,
    });
    expect(item?.draft.body).toContain('quiet for 4 weeks');
    expect(item?.draft.body).toContain('horizon-scan-bousleh-2026-10-26.md');

    // Next week's scan says the same: nothing new is written or queued.
    const again = ok<ApplyResult>(
      await run('watchlists.apply', {
        id: list.id,
        changes: [
          { action: 'add', type: 'competitor', name: 'quarry ai', url: 'https://www.quarryai.example', reason: 'still' },
          { action: 'remove', type: 'topic', name: 'Agentic analytics', reason: 'still quiet' },
          { action: 'remove', type: 'outlet', name: 'Some Blog', reason: 'gone' },
        ],
      }),
    );
    expect(again.new_version).toBe(false);
    expect(again.results.map((r) => r.outcome)).toEqual(['already_on_list', 'already_queued', 'not_on_list']);
    expect(again.results[1]?.queue_id).toBe(item?.id);
    expect(ok<QueueItems>(await run('queue.list', {})).items).toHaveLength(1);

    // Once Alex has decided (the item is resolved), a later scan may ask again.
    ok(await run('queue.resolve', { id: item?.id, action: 'discard', note: 'keeping it' }));
    const later = ok<ApplyResult>(
      await run('watchlists.apply', {
        id: list.id,
        changes: [{ action: 'remove', type: 'topic', name: 'Agentic analytics', reason: 'quiet for 8 weeks' }],
      }),
    );
    expect(later.results[0]?.outcome).toBe('queued');
  });

  it('needs a watch list and at least one change, and writes nothing when refused', async () => {
    const list = await seedList();
    const problem = ok<{ id: string }>(
      await run('deposits.write', { kind: 'problem', title: 'Not a list', altitude: 1000, scopes: ['bousleh'], body: '' }),
    );
    expect(
      failed(await run('watchlists.apply', { id: problem.id, changes: [{ action: 'add', type: 'topic', name: 'x', reason: 'y' }] })).code,
    ).toBe('invalid_input');
    expect(failed(await run('watchlists.apply', { id: list.id, changes: [] })).code).toBe('invalid_input');
    const unchanged = ok<{ watch_lists: WatchListView[] }>(await run('watchlists.get', { id: list.id })).watch_lists[0];
    expect(unchanged?.version.n).toBe(1);
  });
});

describe('watch.file', () => {
  it("files findings in the watch list's scopes, linked to it, and skips urls already filed", async () => {
    const list = ok<SetResult>(await run('watchlists.set', { scope: 'harbor', entries: competitors, altitude: 1000 }));
    const first = ok<FileResult>(
      await run('watch.file', {
        scope: 'harbor',
        findings: [
          {
            title: 'Lumen Search ships agent builder',
            url: 'https://www.lumensearch.example/blog/agents/?utm_source=x#top',
            published_at: '2026-10-24',
            summary: 'Lumen Search now lets customers build agents on their index.',
          },
          { title: 'Dashboards are dead', url: 'https://example.com/dashboards' },
        ],
      }),
    );
    expect(first.watch_list).toEqual({ id: list.id, title: 'Watch list: Harbor', scopes: ['harbor'] });
    expect(first.filed.map((f) => f.url)).toEqual(['https://www.lumensearch.example/blog/agents/', 'https://example.com/dashboards']);
    expect(first.skipped).toEqual([]);

    const finding = ok<{
      kind: string;
      scopes: string[];
      version: { altitude: number; attrs: Record<string, unknown>; body: string };
      links: { out: { kind: string; to: string }[] };
    }>(await run('vault.get', { id: first.filed[0]?.id }));
    expect(finding).toMatchObject({
      kind: 'finding',
      scopes: ['harbor'],
      version: {
        altitude: 1000,
        attrs: { url: 'https://www.lumensearch.example/blog/agents/', published_at: '2026-10-24' },
        body: 'Lumen Search now lets customers build agents on their index.',
      },
    });
    expect(finding.links.out).toEqual([expect.objectContaining({ kind: 'from_watch_list', to: list.id })]);

    const second = ok<FileResult>(
      await run('watch.file', {
        watch_list_id: list.id,
        findings: [
          { title: 'Lumen Search agents (again)', url: 'http://lumensearch.example/blog/agents' },
          { title: 'New one', url: 'https://example.com/new' },
          { title: 'New one, twice', url: 'https://example.com/new/' },
        ],
      }),
    );
    expect(second.filed.map((f) => f.title)).toEqual(['New one']);
    expect(second.skipped).toEqual([
      {
        title: 'Lumen Search agents (again)',
        url: 'http://lumensearch.example/blog/agents',
        reason: 'already_filed',
        existing_id: first.filed[0]?.id,
      },
      { title: 'New one, twice', url: 'https://example.com/new/', reason: 'repeated', existing_id: second.filed[0]?.id },
    ]);
  });

  it('dedupes across watch lists', async () => {
    ok(await run('watchlists.set', { scope: 'bousleh', entries: [] }));
    const harbor = ok<SetResult>(await run('watchlists.set', { scope: 'harbor', entries: [] }));
    ok(await run('watch.file', { scope: 'bousleh', findings: [{ title: 'Shared news', url: 'https://example.com/shared' }] }));
    const again = ok<FileResult>(
      await run('watch.file', { watch_list_id: harbor.id, findings: [{ title: 'Shared news', url: 'https://example.com/shared' }] }),
    );
    expect(again.filed).toEqual([]);
    expect(again.skipped.map((s) => s.reason)).toEqual(['already_filed']);
  });

  it('needs a watch list that exists', async () => {
    const finding = { title: 'x', url: 'https://example.com/x' };
    expect(failed(await run('watch.file', { scope: 'harbor', findings: [finding] })).message).toMatch(/watchlists.set/);
    expect(failed(await run('watch.file', { findings: [finding] })).code).toBe('invalid_input');
    expect(failed(await run('watch.file', { scope: 'harbor', findings: [{ title: 'x', url: 'not a url' }] })).code).toBe('invalid_input');
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
    const harbor = ok<SetResult>(await run('watchlists.set', { scope: 'harbor', entries: [] }));

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
        scope: 'harbor',
        findings: [{ title: 'Harbor news', url: 'https://example.com/c', summary: 'C. '.repeat(300) }],
      }),
    );

    at('2026-10-25T09:00:00.000Z');
    const digest = ok<Digest>(await run('watch.digest', {}));
    expect(digest.since).toBe('2026-10-18T09:00:01.000Z');
    expect(digest.total).toBe(3);
    expect(digest.groups.map((g) => g.watch_list?.id)).toEqual([bousleh.id, harbor.id]);
    expect(digest.groups[0]?.findings.map((f) => [f.title, f.published_at])).toEqual([
      ['Fresh article', '2026-10-21T08:00:00Z'],
      ['Older article, found this week', '2026-09-30'],
    ]);
    const harborFinding = digest.groups[1]?.findings[0];
    expect(harborFinding).toMatchObject({ title: 'Harbor news', url: 'https://example.com/c', published_at: null });
    expect(harborFinding?.summary.length).toBeLessThanOrEqual(501);
    expect(harborFinding?.summary.endsWith('…')).toBe(true);

    const wider = ok<Digest>(await run('watch.digest', { since: '2026-10-10' }));
    expect(wider.total).toBe(4);
    expect(wider.groups[0]?.findings.map((f) => f.title)).toContain('Old news');
  });

  it('filters by scope and by watch list, and honours the limit', async () => {
    const bousleh = ok<SetResult>(await run('watchlists.set', { scope: 'bousleh', entries: [] }));
    ok(await run('watchlists.set', { scope: 'harbor', entries: [] }));
    ok(
      await run('watch.file', {
        scope: 'bousleh',
        findings: [
          { title: 'One', url: 'https://example.com/1' },
          { title: 'Two', url: 'https://example.com/2' },
        ],
      }),
    );
    ok(await run('watch.file', { scope: 'harbor', findings: [{ title: 'Three', url: 'https://example.com/3' }] }));

    const byScope = ok<Digest>(await run('watch.digest', { scope: 'harbor' }));
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

  it('keeps a reading queue: findings start new, move with vault.supersede, and filter by status across all time', async () => {
    at('2026-10-01T09:00:00.000Z');
    ok(await run('watchlists.set', { scope: 'bousleh', entries: [] }));
    const filed = ok<FileResult>(
      await run('watch.file', {
        scope: 'bousleh',
        findings: [
          { title: 'Long read', url: 'https://example.com/long' },
          { title: 'Noise', url: 'https://example.com/noise' },
        ],
      }),
    ).filed;
    const [long, noise] = filed.map((f) => f.id) as [string, string];
    ok(await run('vault.supersede', { id: long, status: 'to_read' }));
    ok(await run('vault.supersede', { id: noise, status: 'dismissed' }));
    expect(failed(await run('vault.supersede', { id: noise, status: 'archived' })).code).toBe('invalid_input');

    at('2026-10-24T09:00:00.000Z');
    ok(await run('watch.file', { scope: 'bousleh', findings: [{ title: 'Fresh', url: 'https://example.com/fresh' }] }));

    at('2026-10-25T09:00:00.000Z');
    const recent = ok<Digest>(await run('watch.digest', {}));
    expect(recent.groups.flatMap((g) => g.findings.map((f) => [f.title, f.status]))).toEqual([['Fresh', 'new']]);

    // The reading queue: status with no since covers every finding ever filed.
    const queue = ok<Digest>(await run('watch.digest', { status: ['to_read'] }));
    expect(queue.since).toBe('1970-01-01T00:00:00.000Z');
    expect(queue.groups.flatMap((g) => g.findings.map((f) => [f.id, f.status]))).toEqual([[long, 'to_read']]);
    const unread = ok<Digest>(await run('watch.digest', { status: ['new', 'to_read'] }));
    expect(unread.total).toBe(2);
    const windowed = ok<Digest>(await run('watch.digest', { status: ['to_read'], since: '2026-10-20' }));
    expect(windowed.total).toBe(0);
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
