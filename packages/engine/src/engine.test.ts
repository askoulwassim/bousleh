import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BOUSLEH_VERSION, defineOp, OPS, type OpContext } from '@bousleh/contracts';
import { defineHandler, OpError, vaultHealthHandler } from '@bousleh/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ALL_HANDLERS, openEngine } from './engine.js';

const NOW = new Date('2026-10-24T09:00:00.000Z');
const ctx: OpContext = { actor: 'agent', now: () => NOW };

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-engine-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

const echo = defineOp({
  name: 'test.echo',
  description: 'Echo a message back, for tests.',
  input: z.object({ message: z.string().min(1) }),
  output: z.object({ echoed: z.string() }),
  readOnly: true,
});
const broken = defineOp({
  name: 'test.broken',
  description: 'Returns output that breaks its own contract.',
  input: z.object({}),
  output: z.object({ n: z.number() }),
  readOnly: true,
});
const missing = defineOp({
  name: 'test.missing',
  description: 'Fails with a typed not_found error.',
  input: z.object({}),
  output: z.object({}),
  readOnly: true,
});
const later = defineOp({
  name: 'test.later',
  description: 'Registered, no handler yet.',
  input: z.object({}),
  output: z.object({}),
  unimplemented: true,
});

const testRegistry = { ...OPS, 'test.echo': echo, 'test.broken': broken, 'test.missing': missing, 'test.later': later };
const testHandlers = [
  ...ALL_HANDLERS,
  defineHandler(echo, (input) => ({ echoed: input.message })),
  defineHandler(broken, () => ({ n: 'not a number' }) as unknown as { n: number }),
  defineHandler(missing, () => {
    throw new OpError('not_found', 'nothing here');
  }),
];

describe('openEngine', () => {
  it('has a handler for every op in the real registry', () => {
    expect(() => openEngine({ home })).not.toThrow();
  });

  it('refuses to start when an op has no handler, or a handler has no op', () => {
    expect(() => openEngine({ home, registry: { ...OPS, 'test.echo': echo } })).toThrow(/no handler: test.echo/);
    expect(() => openEngine({ home, handlers: [...ALL_HANDLERS, defineHandler(echo, () => ({ echoed: '' }))] })).toThrow(
      /not in the ops registry/,
    );
    expect(() => openEngine({ home, handlers: [...ALL_HANDLERS, vaultHealthHandler] })).toThrow(/two handlers/);
  });
});

describe('runOp', () => {
  const engine = () => openEngine({ home, registry: testRegistry, handlers: testHandlers });

  it('runs vault.health', async () => {
    const out = await openEngine({ home }).runOp('vault.health', {}, ctx);
    expect(out).toEqual({
      status: 'ok',
      output: {
        ok: true,
        version: BOUSLEH_VERSION,
        home,
        data: { exists: true, db: false },
        ops: Object.keys(OPS).length,
        backups: { dir: `${home}-backups`, latest: null, count: 0 },
        now: NOW.toISOString(),
      },
    });
  });

  it('validates input and returns the handler output', async () => {
    expect(await engine().runOp('test.echo', { message: 'hi' }, ctx)).toEqual({ status: 'ok', output: { echoed: 'hi' } });
    const bad = await engine().runOp('test.echo', { message: '' }, ctx);
    expect(bad).toMatchObject({ status: 'error', code: 'invalid_input' });
    expect(bad.status === 'error' && Array.isArray(bad.issues)).toBe(true);
  });

  it('answers unknown, unimplemented, typed failures and broken outputs without throwing', async () => {
    const run = engine().runOp;
    expect(await run('nope.nothing', {}, ctx)).toMatchObject({ status: 'error', code: 'unknown_op' });
    expect(await run('toString', {}, ctx)).toMatchObject({ status: 'error', code: 'unknown_op' });
    expect(await run('test.later', {}, ctx)).toMatchObject({ status: 'error', code: 'unimplemented' });
    expect(await run('test.missing', {}, ctx)).toEqual({ status: 'error', code: 'not_found', message: 'nothing here' });
    expect(await run('test.broken', {}, ctx)).toMatchObject({
      status: 'error',
      code: 'internal',
      message: expect.stringMatching(/breaks its contract/),
    });
  });
});
