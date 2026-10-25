import type { z } from 'zod';
import { assetOps } from './assets.js';
import { commitmentOps } from './commitments.js';
import { contextOps } from './context.js';
import { depositOps } from './deposits.js';
import { inboxOps } from './inbox.js';
import { metricOps } from './metrics.js';
import { peopleOps } from './people.js';
import { queueOps } from './queue.js';
import { scopeOps } from './scopes.js';
import { signalOps } from './signals.js';
import { vaultOps } from './vault.js';
import { watchOps } from './watch.js';

/*
 * The ops registry. Every action in Bousleh is one of these.
 * MCP tools, and any later door (UI, HTTP, CLI, scheduled runs), call `runOp(name, input, ctx)`.
 * Each namespace has its own file in this folder (`vault.ts`, `deposits.ts`, …), and its handlers
 * live in the package that owns it (see the package table in AGENTS.md); `@bousleh/engine`
 * registers them. Adding a namespace means adding its file and one spread line here.
 */

/** Every op, keyed by its dotted name. Registry order is the order doors list them in. */
export const OPS = {
  ...vaultOps,
  ...depositOps,
  ...scopeOps,
  ...commitmentOps,
  ...peopleOps,
  ...assetOps,
  ...metricOps,
  ...watchOps,
  ...inboxOps,
  ...queueOps,
  ...signalOps,
  ...contextOps,
} as const;

export type Ops = typeof OPS;
export type OpName = keyof Ops;
export type OpInput<N extends OpName> = z.input<Ops[N]['input']>;
export type OpOutput<N extends OpName> = z.output<Ops[N]['output']>;
export const OP_NAMES = Object.keys(OPS) as OpName[];
