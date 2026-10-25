import type { OpContext, OpDef, OpOutcome, OpRegistry, RunOp } from '@bousleh/contracts';
import { FileStager, type HandlerContext, OpError, type OpHandler, Store, type Vault } from '@bousleh/vault';
import { z } from 'zod';

/*
 * The single entry point: `runOp(name, input, ctx)`.
 * 1. look up the op; refuse unknown and unimplemented ones
 * 2. validate the input with the op's zod schema
 * 3. run the handler; a write op runs inside one SQLite transaction, with its files staged and moved
 *    into place only after COMMIT
 * 4. validate the output against the op's contract; a broken output rolls the write back
 * Top-level calls run one at a time, so two writes never interleave on the one connection. Ops a
 * handler runs through `h.runOp` join the caller's transaction instead. Every top-level write op,
 * ok or failed, lands in `op_log`.
 */

export interface CreateRunOpOptions {
  registry: OpRegistry;
  handlers: readonly OpHandler[];
  vault: Vault;
}

type ErrorCode = Extract<OpOutcome, { status: 'error' }>['code'];
type ErrorOutcome = Extract<OpOutcome, { status: 'error' }>;

const err = (code: ErrorCode, message: string, issues?: unknown): ErrorOutcome =>
  issues === undefined ? { status: 'error', code, message } : { status: 'error', code, message, issues };

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

/** What one call runs with: its store, and the staged files of the write op it belongs to. */
interface Session {
  stager: FileStager | undefined;
  /** True when the outermost op of this call is read-only. */
  readOnly: boolean;
}

export function createRunOp({ registry, handlers, vault }: CreateRunOpOptions): RunOp {
  const byOp = indexHandlers(registry, handlers);
  const ops = Object.keys(registry);

  let queue: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = queue.then(fn, fn);
    queue = next.catch(() => undefined);
    return next;
  };

  const resolve = (name: string, input: unknown): ErrorOutcome | { def: OpDef; handler: OpHandler; input: unknown } => {
    const def = Object.hasOwn(registry, name) ? registry[name] : undefined;
    if (!def) return err('unknown_op', `no op named ${name}`);
    const handler = byOp.get(name);
    if (def.unimplemented === true || !handler) return err('unimplemented', `${name} is not implemented yet`);
    const parsed = def.input.safeParse(input ?? {});
    if (!parsed.success) return err('invalid_input', z.prettifyError(parsed.error), parsed.error.issues);
    return { def, handler, input: parsed.data };
  };

  const execute = async (def: OpDef, handler: OpHandler, input: unknown, ctx: OpContext, session: Session): Promise<OpOutcome> => {
    const writes = def.readOnly !== true;
    const store = new Store(vault, { op: def.name, actor: ctx.actor, now: ctx.now }, session.stager, writes);
    const h: HandlerContext = { def, ctx, home: vault.home, ops, runOp: nested(session), store };
    let raw: unknown;
    try {
      raw = await handler.run(input as never, h);
    } catch (e) {
      if (e instanceof OpError) return err(e.code, e.message, e.issues);
      return err('internal', describe(e));
    }
    const output = def.output.safeParse(raw);
    if (!output.success) return err('internal', `${def.name} returned output that breaks its contract: ${z.prettifyError(output.error)}`);
    return { status: 'ok', output: output.data };
  };

  /** `h.runOp`: runs inside the caller's call, sharing its transaction and staged files. */
  const nested =
    (session: Session): RunOp =>
    async (name, input, ctx) => {
      const found = resolve(name, input);
      if ('status' in found) return found;
      if (found.def.readOnly !== true && session.readOnly) return err('internal', `${name} writes, so it can't run inside a read-only op`);
      return execute(found.def, found.handler, found.input, ctx, session);
    };

  const runOp: RunOp = (name, input, ctx) =>
    oneAtATime(async () => {
      const found = resolve(name, input);
      if ('status' in found) {
        if (found.code === 'invalid_input' && registry[name]?.readOnly !== true) log(name, input, ctx, found.code);
        return found;
      }
      const { def, handler } = found;
      if (def.readOnly === true) return execute(def, handler, found.input, ctx, { stager: undefined, readOnly: true });

      const stager = new FileStager(vault.home);
      const db = vault.db;
      db.exec('BEGIN IMMEDIATE');
      let outcome: OpOutcome;
      try {
        outcome = await execute(def, handler, found.input, ctx, { stager, readOnly: false });
        if (outcome.status === 'ok') {
          vault.logOp({ op: name, actor: ctx.actor, input, result: 'ok', at: ctx.now() });
          db.exec('COMMIT');
        }
      } catch (e) {
        outcome = err('internal', describe(e));
      }
      if (outcome.status !== 'ok') {
        if (db.inTransaction) db.exec('ROLLBACK');
        stager.discard();
        log(name, input, ctx, outcome.code);
        return outcome;
      }
      try {
        stager.commit();
      } catch (e) {
        return err('internal', `${name} was saved, but its markdown files did not all land: ${describe(e)}`);
      }
      return outcome;
    });

  /** Record a failed top-level write in op_log, outside the rolled-back transaction. Never throws. */
  const log = (op: string, input: unknown, ctx: OpContext, result: string) => {
    try {
      vault.logOp({ op, actor: ctx.actor, input, result, at: ctx.now() });
    } catch {
      // The audit trail is best effort for failures; the caller still gets the real error.
    }
  };

  return runOp;
}
