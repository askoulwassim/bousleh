import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OpContext, OpOutcome, OpOutput } from '@bousleh/contracts';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Engine, openEngine } from './engine.js';

/* End to end through runOp: vault.activity reads the audit trail back, with inputs, counts and filters. */

type Activity = OpOutput<'vault.activity'>;

let clock = Date.parse('2026-11-09T09:00:00.000Z');
const tick = () => {
  clock += 60_000;
  return new Date(clock);
};
const ctx: OpContext = { actor: 'agent', now: tick };

let home: string;
let engine: Engine;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-activity-'));
  engine = openEngine({ home });
});
afterEach(() => {
  engine.close();
  rmSync(home, { recursive: true, force: true });
});

function ok<T>(outcome: OpOutcome): T {
  if (outcome.status !== 'ok') throw new Error(`expected ok, got ${outcome.code}: ${outcome.message}`);
  return outcome.output as T;
}
const run = (name: string, input: unknown = {}) => engine.runOp(name, input, ctx);
const activity = async (input: unknown = {}) => ok<Activity>(await run('vault.activity', input));

describe('vault.activity', () => {
  it('returns write ops oldest first, with their inputs and reasons, and leaves out reads', async () => {
    ok(await run('scopes.add', { slug: 'mcp', name: 'MCP', kind: 'product' }));
    const { id } = ok<{ id: string }>(await run('deposits.write', { kind: 'person', title: 'Jo', altitude: 10000 }));
    const { id: problem } = ok<{ id: string }>(
      await run('deposits.write', { kind: 'problem', title: 'No shared answer', altitude: 10000, scopes: ['mcp'] }),
    );
    const { id: link } = ok<{ id: string }>(await run('vault.link', { from: id, kind: 'related', to: problem }));
    ok(await run('vault.unlink', { id: link, reason: 'Linked in error' }));
    ok(await run('scopes.list'));

    const out = await activity({ until: new Date(clock + 60_000).toISOString() });
    expect(out.entries.map((e) => e.op)).toEqual(['scopes.add', 'deposits.write', 'deposits.write', 'vault.link', 'vault.unlink']);
    expect(out.entries.at(-1)).toMatchObject({ actor: 'agent', result: 'ok', input: { id: link, reason: 'Linked in error' } });
    expect(out.counts['deposits.write']).toEqual({ ok: 2, failed: 0 });
    expect(out.more).toBe(0);
  });

  it('records failed writes, and filters by op and failures', async () => {
    ok(await run('scopes.add', { slug: 'mcp', name: 'MCP', kind: 'product' }));
    expect((await run('scopes.move', { slug: 'nope', parent: null })).status).toBe('error');
    const until = new Date(clock + 60_000).toISOString();

    const failed = await activity({ until, failed_only: true });
    expect(failed.entries).toEqual([expect.objectContaining({ op: 'scopes.move', result: 'invalid_input' })]);
    expect(failed.counts['scopes.move']).toEqual({ ok: 0, failed: 1 });

    const only = await activity({ until, ops: ['scopes.add'] });
    expect(only.entries.map((e) => e.op)).toEqual(['scopes.add']);
  });

  it('keeps to the window, and counts what limit cut off', async () => {
    ok(await run('scopes.add', { slug: 'a', name: 'A', kind: 'team' }));
    const middle = new Date(clock + 30_000).toISOString();
    ok(await run('scopes.add', { slug: 'b', name: 'B', kind: 'team' }));
    ok(await run('scopes.add', { slug: 'c', name: 'C', kind: 'team' }));
    const until = new Date(clock + 60_000).toISOString();

    expect((await activity({ since: middle, until })).entries.map((e) => (e.input as { slug: string }).slug)).toEqual(['b', 'c']);
    const cut = await activity({ until, limit: 1 });
    expect(cut.entries).toHaveLength(1);
    expect(cut.more).toBe(2);
    expect(cut.counts['scopes.add']).toEqual({ ok: 3, failed: 0 });
  });
});
