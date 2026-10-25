/* @bousleh/metrics: The metrics registry, its lifecycle and readings. Owns metrics.*. */
import type { OpHandler } from '@bousleh/vault';

/** Handlers for `metrics.*` ops. */
export const handlers: readonly OpHandler[] = [];
