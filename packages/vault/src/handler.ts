import type { OpContext, OpDef, RunOp } from '@bousleh/contracts';
import type { z } from 'zod';
import type { Store } from './store/store.js';

/*
 * The handler contract. Op handlers are the only code allowed to write to your data, and your data
 * is only reachable through the HandlerContext the engine passes in. Handlers live in the package
 * that owns their op's namespace and are registered by @bousleh/engine.
 */

/** What a handler gets from `runOp`. */
export interface HandlerContext {
  /** The op being run. */
  def: OpDef;
  ctx: OpContext;
  /** Your data home (BOUSLEH_HOME or ~/.bousleh). */
  home: string;
  /** Names of every op the engine serves. */
  ops: readonly string[];
  /** Run another op from inside this one: same transaction, same store. */
  runOp: RunOp;
  /**
   * Your data. Opening it creates the data home on first use, so ops that only report on it
   * (like `vault.health`) leave it alone. Writes work only in ops that aren't `readOnly`: the
   * engine wraps those in one SQLite transaction and moves staged files into place after commit.
   */
  readonly store: Store;
}

export interface OpHandler<D extends OpDef = OpDef> {
  op: D['name'];
  /** Gets validated input; its return value is validated against the op's output schema. Throw `OpError` to fail. */
  run(input: z.output<D['input']>, h: HandlerContext): z.input<D['output']> | Promise<z.input<D['output']>>;
}

export function defineHandler<D extends OpDef>(def: D, run: OpHandler<D>['run']): OpHandler {
  return { op: def.name, run } as OpHandler;
}

/** A handled failure: `runOp` returns it as `{ status: 'error', code, message, issues? }`. */
export class OpError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'invalid_input',
    message: string,
    /** Field-level detail, for example which attrs a kind refused. */
    readonly issues?: unknown,
  ) {
    super(message);
    this.name = 'OpError';
  }
}
