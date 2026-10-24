/* @bousleh/intake: Inbox files, the Drive sweep, content-hash dedupe, the ambiguity queue, and feedback patterns for v0. Owns inbox.*, queue.*, signals.*. */
import type { OpHandler } from '@bousleh/vault';

/** Handlers for `inbox.*`, `queue.*` and `signals.*` ops. */
export const handlers: readonly OpHandler[] = [];
