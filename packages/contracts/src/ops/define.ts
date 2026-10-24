import { z } from 'zod';

/** Who is running an op. An MCP client is always `agent`; a scheduled run is `schedule`. */
export const ACTORS = ['human', 'agent', 'schedule'] as const;
export type Actor = (typeof ACTORS)[number];

export interface OpDef<N extends string = string, I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  /** Dotted op name (`vault.search`). Doors may rename it (MCP uses `vault_search`), the registry never does. */
  name: N;
  /** What the op does, written for the model that will call it. */
  description: string;
  /** Input schema. Must be a zod object so every door can render it as named arguments. */
  input: I;
  output: O;
  /** Writes nothing. */
  readOnly?: true;
  /** In the registry but intentionally without a handler yet: `runOp` answers `unimplemented`. */
  unimplemented?: true;
}

export function defineOp<const N extends string, I extends z.ZodType, O extends z.ZodType>(def: OpDef<N, I, O>): OpDef<N, I, O> {
  return def;
}

/** A set of ops keyed by name. `OPS` is the real one; tests build their own. */
export type OpRegistry = Readonly<Record<string, OpDef>>;

/** Passed to every op by `runOp`. */
export interface OpContext {
  actor: Actor;
  /** Injected clock so tests are deterministic. */
  now: () => Date;
}

export const OP_ERROR_CODES = ['unknown_op', 'invalid_input', 'not_found', 'conflict', 'unimplemented', 'internal'] as const;
export type OpErrorCode = (typeof OP_ERROR_CODES)[number];

/** Result of `runOp(name, input, ctx)`. Every door renders both variants. */
export type OpOutcome<O = unknown> =
  | { status: 'ok'; output: O }
  | { status: 'error'; code: OpErrorCode; message: string; issues?: unknown };

/** The single entry point, implemented in `@bousleh/engine`. */
export type RunOp = (name: string, input: unknown, ctx: OpContext) => Promise<OpOutcome>;

/** Shared input for ops that take no arguments. */
export const NoInput = z.object({});
