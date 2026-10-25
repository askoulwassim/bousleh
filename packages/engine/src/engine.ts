import { existsSync } from 'node:fs';
import { join } from 'node:path';
import * as context from '@bousleh/context';
import { OPS, type OpRegistry, type RunOp } from '@bousleh/contracts';
import * as intake from '@bousleh/intake';
import * as metrics from '@bousleh/metrics';
import * as vault from '@bousleh/vault';
import * as watch from '@bousleh/watch';
import { createRunOp } from './run-op.js';

/** Every package's handlers. The engine owns no ops of its own; adding a package means adding its list here, once. */
export const ALL_HANDLERS: readonly vault.OpHandler[] = [
  ...vault.handlers,
  ...intake.handlers,
  ...context.handlers,
  ...metrics.handlers,
  ...watch.handlers,
];

export interface OpenEngineOptions {
  /** Your data home. Default: BOUSLEH_HOME, else ~/.bousleh. */
  home?: string;
  /** Default: OPS. Tests pass their own. */
  registry?: OpRegistry;
  /** Default: ALL_HANDLERS. */
  handlers?: readonly vault.OpHandler[];
  /**
   * Take a backup snapshot (vault.backup) before the first op once the newest snapshot is older
   * than `everyHours` (default 24), keeping `keep` (default 14). Off unless given; the MCP server
   * turns it on. Checked at most once an hour; never runs before your data exists.
   */
  autoBackup?: { everyHours?: number; keep?: number };
}

export interface Engine {
  runOp: RunOp;
  readonly home: string;
  readonly registry: OpRegistry;
  close(): void;
}

/** Open the engine on a data home. Throws if any op in the registry has no handler. */
export function openEngine(options: OpenEngineOptions = {}): Engine {
  const home = options.home ?? vault.resolveHome();
  const registry = options.registry ?? OPS;
  const data = new vault.Vault(home);
  const inner = createRunOp({ registry, handlers: options.handlers ?? ALL_HANDLERS, vault: data });
  const auto = options.autoBackup;
  if (!auto || !('vault.backup' in registry)) return { runOp: inner, home, registry, close: () => data.close() };

  const everyMs = (auto.everyHours ?? 24) * 60 * 60 * 1000;
  let lastCheck = Number.NEGATIVE_INFINITY;
  const maybeBackup = async (ctx: Parameters<RunOp>[2]) => {
    const now = ctx.now().getTime();
    if (now - lastCheck < 60 * 60 * 1000) return;
    lastCheck = now;
    if (!existsSync(join(home, vault.VAULT_DB))) return;
    const latest = vault.latestSnapshotTime(vault.backupDir(home));
    if (latest && now - latest.getTime() < everyMs) return;
    const outcome = await inner('vault.backup', { keep: auto.keep ?? 14 }, { ...ctx, actor: 'schedule' });
    if (outcome.status !== 'ok') process.stderr.write(`bousleh: daily backup failed: ${outcome.message}\n`);
  };
  const runOp: RunOp = async (name, input, ctx) => {
    if (name !== 'vault.backup' && name !== 'vault.health') await maybeBackup(ctx);
    return inner(name, input, ctx);
  };
  return { runOp, home, registry, close: () => data.close() };
}
