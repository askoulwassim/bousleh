import type { OpContext, OpDef, OpOutcome, OpRegistry, RunOp } from '@bousleh/contracts';
import { FileStager, type HandlerContext, OpError, type OpHandler, Store, type Vault } from '@bousleh/vault';
import { z } from 'zod';

/*
 * The single entry point: `runOp(name, input, ctx)`.
 * 1. look up the op; refuse unknown and unimplemented ones
 * 2. validate the input with the op's zod schema
 * 3. run the handler; a write op runs inside one SQLite transaction (BEGIN IMMEDIATE, so it also holds
 *    the write lock against a second Bousleh process), and its file writes are undone if it rolls back
 * 4. validate the output against the op's contract; a broken output rolls the write back
 * Top-level calls run one at a time, so two writes never interleave on the one connection. Ops a
 * handler runs through `h.runOp` join the caller's transaction inside a SAVEPOINT: if a nested op
 * fails, its rows and files are undone even when the caller carries on. Read-only ops run with the
 * connection set to refuse writes. Every top-level write op, ok or failed, lands in `op_log`.
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
  /** Set once the top-level op has returned; a late `h.runOp` (fire and forget) is refused. */
  closed: boolean;
}

export function createRunOp({ registry, handlers, vault }: CreateRunOpOptions): RunOp {
  const byOp = indexHandlers(registry, handlers);
  const ops = Object.keys(registry);
  let savepoints = 0;

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
      if (session.closed) return err('internal', `${name} was called after the op that started it had finished`);
      const found = resolve(name, input);
      if ('status' in found) return found;
      if (found.def.readOnly === true) return execute(found.def, found.handler, found.input, ctx, session);
      if (session.readOnly || !session.stager) return err('internal', `${name} writes, so it can't run inside a read-only op`);

      const db = vault.db;
      const savepoint = `nested_${++savepoints}`;
      const mark = session.stager.mark();
      db.exec(`SAVEPOINT ${savepoint}`);
      let outcome: OpOutcome;
      try {
        outcome = await execute(found.def, found.handler, found.input, ctx, session);
      } catch (e) {
        outcome = err('internal', describe(e));
      }
      if (outcome.status !== 'ok') {
        db.exec(`ROLLBACK TO ${savepoint}`);
        session.stager.rollbackTo(mark);
      }
      db.exec(`RELEASE ${savepoint}`);
      return outcome;
    };

  const runOp: RunOp = (name, input, ctx) =>
    oneAtATime(async () => {
      const found = resolve(name, input);
      if ('status' in found) {
        if (found.code === 'invalid_input' && registry[name]?.readOnly !== true) log(name, input, ctx, found.code);
        return found;
      }
      const { def, handler } = found;
      if (def.readOnly === true) {
        const session: Session = { stager: undefined, readOnly: true, closed: false };
        try {
          return await vault.readOnly(() => execute(def, handler, found.input, ctx, session));
        } catch (e) {
          return err('internal', describe(e));
        } finally {
          session.closed = true;
        }
      }

      const stager = new FileStager(vault.home);
      const session: Session = { stager, readOnly: false, closed: false };
      let outcome: OpOutcome;
      try {
        const db = vault.db;
        db.exec('BEGIN IMMEDIATE');
        try {
          outcome = await execute(def, handler, found.input, ctx, session);
          if (outcome.status === 'ok') {
            vault.logOp({ op: name, actor: ctx.actor, input, result: 'ok', at: ctx.now() });
            db.exec('COMMIT');
          }
        } catch (e) {
          outcome = err('internal', describe(e));
        }
        if (outcome.status !== 'ok' && db.inTransaction) db.exec('ROLLBACK');
      } catch (e) {
        // Opening the database or BEGIN failed (e.g. another process held the lock past busy_timeout).
        outcome = err('internal', describe(e));
      } finally {
        session.closed = true;
      }

      if (outcome.status !== 'ok') {
        try {
          stager.discard();
        } catch (e) {
          outcome = err('internal', `${outcome.message}; undoing its files also failed: ${describe(e)}`);
        }
        log(name, input, ctx, outcome.code);
        return outcome;
      }
      // Committed. Nothing after this point can turn the op into an error: it is saved.
      try {
        stager.commit();
      } catch (e) {
        log(name, { error: describe(e) }, ctx, 'ok_cleanup_failed');
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
