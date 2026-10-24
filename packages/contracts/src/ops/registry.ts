import { z } from 'zod';
import { defineOp, NoInput } from './define.js';

/*
 * The ops registry. Every action in Bousleh is one of these.
 * MCP tools, and any later door (UI, HTTP, CLI, scheduled runs), call `runOp(name, input, ctx)`.
 * Handlers live in the package that owns the op's namespace (see the package table in AGENTS.md);
 * `@bousleh/engine` registers them.
 */

// ---------------------------------------------------------------- vault

export const vaultHealth = defineOp({
  name: 'vault.health',
  description:
    'Health check for Bousleh: engine version, where your data lives (~/.bousleh unless configured otherwise) and whether it exists yet, and how many ops are registered. Call it first if any other tool fails.',
  input: NoInput,
  output: z.object({
    ok: z.boolean(),
    version: z.string(),
    home: z.string(),
    data: z.object({
      exists: z.boolean(),
      db: z.boolean(),
    }),
    ops: z.number().int(),
    now: z.iso.datetime(),
  }),
  readOnly: true,
});

/** Every op, keyed by its dotted name. Registry order is the order doors list them in. */
export const OPS = {
  'vault.health': vaultHealth,
} as const;

export type Ops = typeof OPS;
export type OpName = keyof Ops;
export type OpInput<N extends OpName> = z.input<Ops[N]['input']>;
export type OpOutput<N extends OpName> = z.output<Ops[N]['output']>;
export const OP_NAMES = Object.keys(OPS) as OpName[];
