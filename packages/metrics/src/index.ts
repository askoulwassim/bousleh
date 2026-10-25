/* @bousleh/metrics: The metrics registry, its lifecycle and readings. Owns metrics.*. */
import type { OpHandler } from '@bousleh/vault';
import { metricsHistoryHandler } from './history.js';
import { metricsListHandler } from './list.js';
import { metricsReadingHandler } from './readings.js';
import { metricsUpsertHandler } from './upsert.js';

export { metricsHistoryHandler } from './history.js';
export { metricsListHandler } from './list.js';
export { effectiveReadings, latestReading, metricsReadingHandler } from './readings.js';
export { metricsUpsertHandler } from './upsert.js';

/** Handlers for `metrics.*` ops. */
export const handlers: readonly OpHandler[] = [metricsUpsertHandler, metricsReadingHandler, metricsListHandler, metricsHistoryHandler];
