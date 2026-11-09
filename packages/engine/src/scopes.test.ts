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
  ok(await run('scopes.add', { slug: 'alethea', name: 'Alethea', kind: 'company' }));
  ok(await run('scopes.add', { slug: 'zeus', name: 'Zeus', kind: 'product', parent: 'alethea' }));
  ok(await run('scopes.add', { slug: 'mcp', name: 'MCP', kind: 'product', parent: 'alethea' }));
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
    const problem = await deposit('Legacy Artemis does not fit analysts', 'zeus');
    const moved = ok<Moved>(await move('zeus', null));
    expect(moved).toMatchObject({ slug: 'zeus', name: 'Zeus', kind: 'product', parent: null, moved: true });
    expect(await parentOf('zeus')).toBeNull();
    expect((await scopes()).filter((s) => s.slug === 'zeus')).toHaveLength(1);
    expect(ok<ObjectView>(await run('vault.get', { id: problem })).scopes).toEqual(['zeus']);
    const hits = ok<{ hits: { id: string }[] }>(await run('vault.search', { query: 'Legacy Artemis', scopes: ['zeus'] }));
    expect(hits.hits.map((r) => r.id)).toContain(problem);
  });

  it('gives a top-level scope its own column in the grid, and its parent no longer covers it', async () => {
    const problem = await deposit('Legacy Artemis does not fit analysts', 'zeus');
    type Strata = OpOutput<'context.strata'>;
    const before = ok<Strata>(await run('context.strata', {}));
    expect(before.columns.map((c) => c.slug)).toEqual(['alethea']);

    ok(await move('zeus', null));
    const after = ok<Strata>(await run('context.strata', {}));
    expect(after.columns.map((c) => c.slug)).toEqual(['alethea', 'zeus']);
    const inColumn = (scope: string) => after.cells.filter((c) => c.scope === scope).flatMap((c) => c.objects.map((o) => o.id));
    expect(inColumn('zeus')).toContain(problem);
    expect(inColumn('alethea')).not.toContain(problem);
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
    const first = ok<Moved>(await move('zeus', null));
    const second = ok<Moved>(await move('zeus', 'alethea'));
    expect(second.id).not.toBe(first.id);
    expect(await parentOf('zeus')).toBe('alethea');
    expect((await scopes()).filter((s) => s.slug === 'zeus')).toHaveLength(1);
  });

  it('changes nothing when the scope already has that parent', async () => {
    const before = (await scopes()).find((s) => s.slug === 'zeus');
    const same = ok<Moved>(await move('zeus', 'alethea'));
    expect(same).toMatchObject({ id: before?.id, parent: 'alethea', moved: false });
  });

  it('refuses a parent that is the scope itself or below it, and unknown slugs', async () => {
    expect(failed(await move('mcp', 'mcp')).code).toBe('invalid_input');
    expect(failed(await move('mcp', 'mcp-auth')).code).toBe('invalid_input');
    expect(failed(await move('nope', null)).code).toBe('invalid_input');
    expect(failed(await move('zeus', 'nope')).code).toBe('invalid_input');
    expect(await parentOf('mcp')).toBe('alethea');
  });
});
