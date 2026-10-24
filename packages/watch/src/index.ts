/* @bousleh/watch: Watch lists per scope, filing scan findings, and the digest. Owns watchlists.*, watch.*. */
import type { OpHandler } from '@bousleh/vault';

/** Handlers for `watchlists.*` and `watch.*` ops. */
export const handlers: readonly OpHandler[] = [];
