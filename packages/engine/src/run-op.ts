import type { OpContext, OpOutcome, OpRegistry, RunOp } from '@bousleh/contracts';
import { type HandlerContext, OpError, type OpHandler } from '@bousleh/vault';
import { z } from 'zod';

/*
 * The single entry point: `runOp(name, input, ctx)`.
 * 1. look up the op; refuse unknown and unimplemented ones
 * 2. validate the input with the op's zod schema
 * 3. run the op's handler (OpError becomes a typed error, anything else `internal`)
 * 4. validate the output against the op's contract
 * Write ops will run inside one SQLite transaction per top-level call once the data schema lands.
 */

export interface CreateRunOpOptions {
  registry: OpRegistry;
  handlers: readonly OpHandler[];
  home: string;
}

const err = (code: Extract<OpOutcome, { status: 'error' }>['code'], message: string, issues?: unknown): OpOutcome =>
  issues === undefined ? { status: 'error', code, message } : { status: 'error', code, message, issues };

/** Index handlers by op and check them against the registry. Throws on a duplicate, an orphan, or an op with no handler. */
export function indexHandlers(registry: OpRegistry, handlers: readonly OpHandler[]): Map<string, OpHandler> {
  const byOp = new Map<string, OpHandler>();
  for (const handler of handlers) {
    if (byOp.has(handler.op)) throw new Error(`two handlers for op ${handler.op}`);
    if (!(handler.op in registry)) throw new Error(`handler for ${handler.op}, which is not in the ops registry`);
    byOp.set(handler.op, handler);
  }
  const missing = Object.values(registry).filter((def) => def.unimplemented !== true && !byOp.has(def.name));
  if (missing.length > 0) throw new Error(`ops with no handler: ${missing.map((def) => def.name).join(', ')}`);
  return byOp;
}

export function createRunOp({ registry, handlers, home }: CreateRunOpOptions): RunOp {
  const byOp = indexHandlers(registry, handlers);
  const ops = Object.keys(registry);

  const runOp: RunOp = async (name: string, input: unknown, ctx: OpContext) => {
    const def = Object.hasOwn(registry, name) ? registry[name] : undefined;
    if (!def) return err('unknown_op', `no op named ${name}`);
    const handler = byOp.get(name);
    if (def.unimplemented === true || !handler) return err('unimplemented', `${name} is not implemented yet`);

    const parsed = def.input.safeParse(input ?? {});
    if (!parsed.success) return err('invalid_input', z.prettifyError(parsed.error), parsed.error.issues);

    const h: HandlerContext = { def, ctx, home, ops, runOp };
    let raw: unknown;
    try {
      raw = await handler.run(parsed.data, h);
    } catch (e) {
      if (e instanceof OpError) return err(e.code, e.message);
      return err('internal', e instanceof Error ? e.message : String(e));
    }

    const output = def.output.safeParse(raw);
    if (!output.success) return err('internal', `${name} returned output that breaks its contract: ${z.prettifyError(output.error)}`);
    return { status: 'ok', output: output.data };
  };
  return runOp;
}
