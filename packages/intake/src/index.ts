/* @bousleh/intake: Inbox files, the Drive sweep, content-hash dedupe, the ambiguity queue, and feedback patterns for v0. Owns inbox.*, queue.*, signals.*. */
import type { OpHandler } from '@bousleh/vault';
import { type IntakeOptions, inboxHandlers } from './inbox.js';
import { queueHandlers } from './queue.js';

export * from './files.js';
export { DRIVE_INBOX_ENV, type IntakeOptions, inboxHandlers } from './inbox.js';
export { queueAddHandler, queueHandlers, queueListHandler, queueResolveHandler } from './queue.js';

/**
 * Handlers for `inbox.*` and `queue.*` ops (`signals.*` comes later). Pass `driveInbox` to point
 * the sweep at another Drive folder, as tests do; by default it reads `BOUSLEH_DRIVE_INBOX` on every call.
 */
export function intakeHandlers(options: IntakeOptions = {}): OpHandler[] {
  return [...inboxHandlers(options), ...queueHandlers];
}

/** Handlers for `inbox.*` and `queue.*` ops, reading the Drive inbox from `BOUSLEH_DRIVE_INBOX`. */
export const handlers: readonly OpHandler[] = intakeHandlers();
