/* @bousleh/vault: storage, migrations, history and typed objects in ~/.bousleh. Owns vault.*, deposits.*, commitments.*, people.* */
import type { OpHandler } from './handler.js';
import { vaultHealthHandler } from './health.js';

export * from './handler.js';
export { vaultHealthHandler } from './health.js';
export * from './home.js';

/** Handlers for `vault.*`, `deposits.*`, `commitments.*` and `people.*` ops. */
export const handlers: readonly OpHandler[] = [vaultHealthHandler];
