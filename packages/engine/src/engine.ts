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
  const runOp = createRunOp({ registry, handlers: options.handlers ?? ALL_HANDLERS, vault: data });
  return { runOp, home, registry, close: () => data.close() };
}
