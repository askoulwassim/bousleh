import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ObjectView, OpContext, OpOutcome, OpOutput, ScopeView } from '@bousleh/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* End to end through runOp: scopes.move (new parent, top-level, children follow, refusals) and what Home's grid and briefs see after a move. */

type Moved = ScopeView & { moved: boolean };

let clock = Date.parse('2026-11-09T09:00:00.000Z');
const tick = () => {
  clock += 1000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-scopes-'));
  engine = openEngine({ home });
  ok(await run('scopes.add', { slug: 'northwind', name: 'Northwind', kind: 'company' }));
  ok(await run('scopes.add', { slug: 'zephyr', name: 'Zephyr', kind: 'product', parent: 'northwind' }));
  ok(await run('scopes.add', { slug: 'mcp', name: 'MCP', kind: 'product', parent: 'northwind' }));
  ok(await run('scopes.add', { slug: 'mcp-auth', name: 'MCP auth', kind: 'team', parent: 'mcp' }));
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
const move = (slug: string, parent: string | null) => run('scopes.move', { slug, parent });
const scopes = async () => ok<{ scopes: ScopeView[] }>(await run('scopes.list')).scopes;
const parentOf = async (slug: string) => (await scopes()).find((s) => s.slug === slug)?.parent;
const deposit = async (title: string, scope: string) =>
  ok<{ id: string }>(await run('deposits.write', { kind: 'problem', title, altitude: 10000, scopes: [scope] })).id;

describe('scopes.move', () => {
  it('makes a scope top-level, keeping its slug, name, kind and what is filed in it', async () => {
    const problem = await deposit('Legacy Zephyr does not fit dispatchers', 'zephyr');
    const moved = ok<Moved>(await move('zephyr', null));
    expect(moved).toMatchObject({ slug: 'zephyr', name: 'Zephyr', kind: 'product', parent: null, moved: true });
    expect(await parentOf('zephyr')).toBeNull();
    expect((await scopes()).filter((s) => s.slug === 'zephyr')).toHaveLength(1);
    expect(ok<ObjectView>(await run('vault.get', { id: problem })).scopes).toEqual(['zephyr']);
    const hits = ok<{ hits: { id: string }[] }>(await run('vault.search', { query: 'Legacy Zephyr', scopes: ['zephyr'] }));
    expect(hits.hits.map((r) => r.id)).toContain(problem);
  });

  it('gives a top-level scope its own column in the grid, and its parent no longer covers it', async () => {
    const problem = await deposit('Legacy Zephyr does not fit dispatchers', 'zephyr');
    type Strata = OpOutput<'context.strata'>;
    const before = ok<Strata>(await run('context.strata', {}));
    expect(before.columns.map((c) => c.slug)).toEqual(['northwind']);

    ok(await move('zephyr', null));
    const after = ok<Strata>(await run('context.strata', {}));
    expect(after.columns.map((c) => c.slug)).toEqual(['northwind', 'zephyr']);
    const inColumn = (scope: string) => after.cells.filter((c) => c.scope === scope).flatMap((c) => c.objects.map((o) => o.id));
    expect(inColumn('zephyr')).toContain(problem);
    expect(inColumn('northwind')).not.toContain(problem);
  });

  it('moves a scope under a new parent, and its children come along', async () => {
    ok(await run('scopes.add', { slug: 'platform', name: 'Platform', kind: 'team' }));
    ok(await move('mcp', 'platform'));
    expect(await parentOf('mcp')).toBe('platform');
    expect(await parentOf('mcp-auth')).toBe('mcp');
    const covered = await deposit('Token refresh fails', 'mcp-auth');
    const hits = ok<{ hits: { id: string }[] }>(await run('vault.search', { query: 'Token refresh', scopes: ['platform'] }));
    expect(hits.hits.map((r) => r.id)).toContain(covered);
  });

  it('keeps every move in history: each one supersedes the scope row before it', async () => {
    const first = ok<Moved>(await move('zephyr', null));
    const second = ok<Moved>(await move('zephyr', 'northwind'));
    expect(second.id).not.toBe(first.id);
    expect(await parentOf('zephyr')).toBe('northwind');
    expect((await scopes()).filter((s) => s.slug === 'zephyr')).toHaveLength(1);
  });

  it('changes nothing when the scope already has that parent', async () => {
    const before = (await scopes()).find((s) => s.slug === 'zephyr');
    const same = ok<Moved>(await move('zephyr', 'northwind'));
    expect(same).toMatchObject({ id: before?.id, parent: 'northwind', moved: false });
  });

  it('refuses a parent that is the scope itself or below it, and unknown slugs', async () => {
    expect(failed(await move('mcp', 'mcp')).code).toBe('invalid_input');
    expect(failed(await move('mcp', 'mcp-auth')).code).toBe('invalid_input');
    expect(failed(await move('nope', null)).code).toBe('invalid_input');
    expect(failed(await move('zephyr', 'nope')).code).toBe('invalid_input');
    expect(await parentOf('mcp')).toBe('northwind');
  });
});

describe('scopes.rename', () => {
  type Renamed = ScopeView & { renamed: boolean };
  const rename = (slug: string, name: string) => run('scopes.rename', { slug, name });

  it('changes the display name and keeps the slug, parent, children and what is filed in it', async () => {
    const problem = await deposit('Noise, not signal', 'mcp');
    const renamed = ok<Renamed>(await rename('mcp', 'Tidewater'));
    expect(renamed).toMatchObject({ slug: 'mcp', name: 'Tidewater', kind: 'product', parent: 'northwind', renamed: true });
    const list = await scopes();
    expect(list.filter((s) => s.slug === 'mcp')).toEqual([expect.objectContaining({ name: 'Tidewater', parent: 'northwind' })]);
    expect(await parentOf('mcp-auth')).toBe('mcp');
    expect(ok<ObjectView>(await run('vault.get', { id: problem })).scopes).toEqual(['mcp']);
  });

  it('shows the new name on its grid column', async () => {
    ok(await move('zephyr', null));
    ok(await rename('zephyr', 'Zephyr platform'));
    const strata = ok<OpOutput<'context.strata'>>(await run('context.strata', {}));
    expect(strata.columns.find((c) => c.slug === 'zephyr')?.name).toBe('Zephyr platform');
  });

  it('survives a later move, and a move survives a later rename', async () => {
    ok(await rename('zephyr', 'Zephyr platform'));
    ok(await move('zephyr', null));
    expect((await scopes()).find((s) => s.slug === 'zephyr')).toMatchObject({ name: 'Zephyr platform', parent: null });
    ok(await rename('zephyr', 'Zephyr'));
    expect((await scopes()).find((s) => s.slug === 'zephyr')).toMatchObject({ name: 'Zephyr', parent: null });
  });

  it('changes nothing for the same name, and refuses unknown slugs', async () => {
    const before = (await scopes()).find((s) => s.slug === 'zephyr');
    expect(ok<Renamed>(await rename('zephyr', 'Zephyr'))).toMatchObject({ id: before?.id, renamed: false });
    expect(failed(await rename('nope', 'Nope')).code).toBe('invalid_input');
  });
});
