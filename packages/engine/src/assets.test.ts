import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AssetView, ObjectView, OpContext, OpOutcome, OpOutput } from '@bousleh/contracts';
import { normalizeAssetUrl } from '@bousleh/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* End to end through runOp: assets.add (dedupe by url, documents links, versions), assets.list, and the brief's assets section. */

type Added = OpOutput<'assets.add'>;
type Brief = OpOutput<'context.brief'>;

let clock = Date.parse('2026-10-25T09:00:00.000Z');
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-assets-'));
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
const get = async (id: string, history = false) => ok<ObjectView>(await run('vault.get', { id, history }));
const deposit = async (kind: string, title: string, more: Record<string, unknown> = {}) =>
  ok<{ id: string }>(await run('deposits.write', { kind, title, altitude: 1000, scopes: ['logistics'], ...more })).id;
const add = async (input: Record<string, unknown>) =>
  ok<Added>(await run('assets.add', { title: 'Load provenance', type: 'doc', scopes: ['logistics'], ...input }));
const list = async (input: Record<string, unknown> = {}) => ok<{ assets: AssetView[] }>(await run('assets.list', input)).assets;
const ids = (refs: { id: string }[]) => refs.map((ref) => ref.id);

const DOC = 'https://claude.ai/artifact/0f3c9d2e';

describe('assets.add', () => {
  it('registers an asset in the work layer, linked with documents to what it documents', async () => {
    const problem = await deposit('problem', 'Dispatchers cannot trace a load');
    const added = await add({ url: DOC, documents: [problem], body: 'The write-up for leadership.' });
    expect(added).toMatchObject({ url: DOC, created: true, new_version: true, linked: [problem] });
    expect(added.id).toMatch(/^ast_/);

    const asset = await get(added.id);
    expect(asset).toMatchObject({
      kind: 'asset',
      layer: 'work',
      scopes: ['logistics'],
      version: { title: 'Load provenance', altitude: 1000, status: null, attrs: { url: DOC, type: 'doc' } },
    });
    expect(asset.version.body).toBe('The write-up for leadership.');
    expect(asset.links.out).toEqual([expect.objectContaining({ kind: 'documents', to: problem, to_kind: 'problem' })]);
    expect((await get(problem)).links.in).toEqual([expect.objectContaining({ kind: 'documents', from: added.id, from_kind: 'asset' })]);
  });

  it('needs a scope, a known scope, a url and a known type', async () => {
    expect(failed(await run('assets.add', { url: DOC, title: 'x', type: 'doc', scopes: [] })).code).toBe('invalid_input');
    expect(failed(await run('assets.add', { url: DOC, title: 'x', type: 'doc', scopes: ['nowhere'] })).code).toBe('invalid_input');
    expect(failed(await run('assets.add', { url: 'claude doc', title: 'x', type: 'doc', scopes: ['logistics'] })).code).toBe(
      'invalid_input',
    );
    expect(failed(await run('assets.add', { url: DOC, title: 'x', type: 'video', scopes: ['logistics'] })).code).toBe('invalid_input');
  });

  it('stores the url without its fragment, utm parameters and trailing slash', async () => {
    const added = await add({ url: 'https://docs.example.com/d/1/?utm_source=chat&tab=2&utm_medium=x#heading' });
    expect(added.url).toBe('https://docs.example.com/d/1?tab=2');
    expect((await get(added.id)).version.attrs.url).toBe('https://docs.example.com/d/1?tab=2');
    expect(normalizeAssetUrl('https://github.com/alex-rivera/bousleh/')).toBe('https://github.com/alex-rivera/bousleh');
    expect(normalizeAssetUrl('https://example.com/')).toBe('https://example.com');
  });

  it('returns the asset already registered for a url, whatever its fragment, utm parameters or trailing slash', async () => {
    const first = await add({ url: DOC });
    for (const variant of [`${DOC}#section-2`, `${DOC}?utm_source=slack&utm_campaign=launch`, `${DOC}/`, `${DOC}/?utm_medium=email#top`]) {
      expect(await add({ url: variant })).toEqual({ id: first.id, url: DOC, created: false, new_version: false, linked: [] });
    }
    // Other query parameters make it a different asset.
    expect((await add({ url: `${DOC}?tab=2` })).created).toBe(true);
    expect(await list()).toHaveLength(2);
    expect((await get(first.id, true)).history).toHaveLength(1);
  });

  it('adds new documents links on a re-add, and is fine with the ones it has', async () => {
    const problem = await deposit('problem', 'Dispatchers cannot trace a load');
    const idea = await deposit('idea', 'Cite every chart');
    const first = await add({ url: DOC, documents: [problem] });

    const again = await add({ url: `${DOC}#v2`, documents: [problem, idea, idea] });
    expect(again).toEqual({ id: first.id, url: DOC, created: false, new_version: false, linked: [idea] });
    const asset = await get(first.id, true);
    expect(asset.links.out.map((l) => [l.kind, l.to])).toEqual([
      ['documents', problem],
      ['documents', idea],
    ]);
    expect(asset.history).toHaveLength(1);

    expect((await add({ url: DOC, documents: [problem, idea] })).linked).toEqual([]);
  });

  it('writes a new version only when the title or type changed', async () => {
    const first = await add({ url: DOC });
    const renamed = await add({ url: DOC, title: 'Load provenance v2' });
    expect(renamed).toMatchObject({ id: first.id, created: false, new_version: true });
    const retyped = await add({ url: DOC, title: 'Load provenance v2', type: 'slides' });
    expect(retyped.new_version).toBe(true);
    // Scopes, altitude and body of a registered asset are left as they are.
    const same = await add({ url: DOC, title: 'Load provenance v2', type: 'slides', altitude: 50000, body: 'ignored' });
    expect(same.new_version).toBe(false);

    const asset = await get(first.id, true);
    expect(asset.history?.map((v) => [v.n, v.title])).toEqual([
      [1, 'Load provenance'],
      [2, 'Load provenance v2'],
      [3, 'Load provenance v2'],
    ]);
    expect(asset.version).toMatchObject({ altitude: 1000, body: '', attrs: { url: DOC, type: 'slides' } });
  });

  it('refuses documents to an unknown object and writes nothing', async () => {
    const missing = 'prb_01JBX0000000000000000000AB';
    const outcome = await run('assets.add', { url: DOC, title: 'x', type: 'doc', scopes: ['logistics'], documents: [missing] });
    expect(failed(outcome).code).toBe('not_found');
    expect(await list()).toEqual([]);
  });
});

describe('the documents link', () => {
  it('runs only from an asset, to any kind', async () => {
    const problem = await deposit('problem', 'Dispatchers cannot trace a load');
    const idea = await deposit('idea', 'Cite every chart');
    const person = ok<{ id: string }>(await run('deposits.write', { kind: 'person', title: 'Rowan', altitude: 50000 })).id;
    const asset = (await add({ url: DOC })).id;

    expect(failed(await run('vault.link', { from: idea, kind: 'documents', to: problem })).code).toBe('invalid_input');
    expect(
      failed(
        await run('deposits.write', {
          kind: 'observation',
          title: 'Not an asset',
          altitude: 1000,
          scopes: ['logistics'],
          links: [{ kind: 'documents', to: problem }],
        }),
      ).code,
    ).toBe('invalid_input');
    expect(ok(await run('vault.link', { from: asset, kind: 'documents', to: person }))).toMatchObject({ created: true });
    expect(ok(await run('vault.link', { from: asset, kind: 'documents', to: idea }))).toMatchObject({ created: true });
  });
});

describe('assets.list', () => {
  it('filters by scope (child scopes included), type and the object documented, newest first', async () => {
    const problem = await deposit('problem', 'Dispatchers cannot trace a load');
    const doc = (await add({ url: DOC, documents: [problem] })).id;
    const deck = (await add({ url: 'https://claude.ai/artifact/deck', title: 'Provenance pitch', type: 'slides', scopes: ['northwind'] }))
      .id;
    const repo = (await add({ url: 'https://github.com/alex-rivera/bousleh', title: 'Bousleh', type: 'repo', scopes: ['bousleh'] })).id;

    expect(ids(await list())).toEqual([repo, deck, doc]);
    expect(ids(await list({ scopes: ['northwind'] }))).toEqual([deck, doc]);
    expect(ids(await list({ scopes: ['logistics'] }))).toEqual([doc]);
    expect(ids(await list({ type: 'repo' }))).toEqual([repo]);
    expect(ids(await list({ scopes: ['northwind'], type: 'slides' }))).toEqual([deck]);
    expect(ids(await list({ documents: problem }))).toEqual([doc]);
    expect(ids(await list({ limit: 1 }))).toEqual([repo]);

    expect((await list({ documents: problem }))[0]).toEqual({
      id: doc,
      title: 'Load provenance',
      type: 'doc',
      url: DOC,
      scopes: ['logistics'],
      altitude: 1000,
      documents: [{ id: problem, kind: 'problem', title: 'Dispatchers cannot trace a load' }],
    });
  });

  it('refuses an unknown scope or object', async () => {
    expect(failed(await run('assets.list', { scopes: ['nowhere'] })).code).toBe('invalid_input');
    expect(failed(await run('assets.list', { documents: 'prb_01JBX0000000000000000000AB' })).code).toBe('not_found');
  });
});

describe("the brief's assets section", () => {
  it('with a centre: the assets that document anything in the brief, at any altitude', async () => {
    const problem = await deposit('problem', 'Dispatchers cannot trace a load', { altitude: 100 });
    const decision = await deposit('decision', 'Trace claims at ingest', { altitude: 100, links: [{ kind: 'related', to: problem }] });
    const elsewhere = await deposit('problem', 'Onboarding is slow', { altitude: 100 });
    const doc = (await add({ url: DOC, documents: [problem], altitude: 50000 })).id;
    const adr = (await add({ url: 'https://claude.ai/artifact/adr', title: 'ADR: trace at ingest', documents: [decision] })).id;
    await add({ url: 'https://claude.ai/artifact/onboarding', title: 'Onboarding map', type: 'whiteboard', documents: [elsewhere] });

    const result = ok<Brief>(await run('context.brief', { ids: [problem], altitude: 100 }));
    expect(result.assets.map((a) => [a.id, a.why])).toEqual([
      [doc, ['documents "Dispatchers cannot trace a load"']],
      [adr, ['documents "Trace claims at ingest"']],
    ]);
    expect(result.assets[0]).toMatchObject({ kind: 'asset', url: DOC, type: 'doc', altitude: 50000 });
    expect(result.more.assets).toBe(0);
  });

  it('without a centre: the assets in the covered scopes', async () => {
    const repo = (await add({ url: 'https://github.com/alex-rivera/bousleh', title: 'Bousleh', type: 'repo', scopes: ['bousleh'] })).id;
    const doc = (await add({ url: DOC, altitude: 50000 })).id;

    const bousleh = ok<Brief>(await run('context.brief', { scopes: ['bousleh'], altitude: 100 }));
    expect(bousleh.centre).toEqual([]);
    expect(bousleh.assets).toEqual([
      expect.objectContaining({ id: repo, type: 'repo', url: 'https://github.com/alex-rivera/bousleh', why: ['in scope bousleh'] }),
    ]);

    const northwind = ok<Brief>(await run('context.brief', { scopes: ['northwind'] }));
    expect(ids(northwind.assets)).toEqual([doc]);
    expect(ids(ok<Brief>(await run('context.brief', {})).assets)).toEqual([doc, repo]);
  });
});
