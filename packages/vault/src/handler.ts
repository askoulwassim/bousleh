import type { OpContext, OpDef, RunOp } from '@bousleh/contracts';
import type { z } from 'zod';

/*
 * The handler contract. Op handlers are the only code allowed to write to your data, and your data
 * is only reachable through the HandlerContext the engine passes in. Handlers live in the package
 * that owns their op's namespace and are registered by @bousleh/engine.
 */

/** What a handler gets from `runOp`. Storage access is added here once the data schema lands. */
export interface HandlerContext {
  /** The op being run. */
  def: OpDef;
  ctx: OpContext;
  /** Your data home (BOUSLEH_HOME or ~/.bousleh). */
  home: string;
  /** Names of every op the engine serves. */
  ops: readonly string[];
  /** Run another op from inside this one. */
  runOp: RunOp;
}

export interface OpHandler<D extends OpDef = OpDef> {
  op: D['name'];
  /** Gets validated input; its return value is validated against the op's output schema. Throw `OpError` to fail. */
  run(input: z.output<D['input']>, h: HandlerContext): z.input<D['output']> | Promise<z.input<D['output']>>;
}

export function defineHandler<D extends OpDef>(def: D, run: OpHandler<D>['run']): OpHandler {
  return { op: def.name, run } as OpHandler;
}

/** A handled failure: `runOp` returns it as `{ status: 'error', code, message }`. */
export class OpError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'invalid_input',
    message: string,
  ) {
    super(message);
    this.name = 'OpError';
  }
}
