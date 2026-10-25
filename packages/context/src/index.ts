/* @bousleh/context: The brief at a given altitude, and Pulse's daily picture. Owns context.*, pulse.*. */
import type { OpHandler } from '@bousleh/vault';
import { contextBriefHandler } from './brief.js';
import { pulseTodayHandler } from './pulse.js';

export { altitudeBand, CENTRE_FROM_SEARCH, contextBriefHandler } from './brief.js';
export { CADENCE_DAYS, DEFAULT_STALE_DAYS, pulseTodayHandler } from './pulse.js';

/** Handlers for `context.*` and `pulse.*` ops. */
export const handlers: readonly OpHandler[] = [contextBriefHandler, pulseTodayHandler];
