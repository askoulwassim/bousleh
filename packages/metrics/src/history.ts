import { metricsHistory } from '@bousleh/contracts';
import { defineHandler, instantOf, OpError, windowStart } from '@bousleh/vault';
import { effectiveReadings } from './readings.js';

/* metrics.history: every effective reading of one metric, oldest first, corrections applied. */

export const metricsHistoryHandler = defineHandler(metricsHistory, (input, h) => {
  const metric = h.store.getObject(input.id);
  if (!metric) throw new OpError('not_found', `no metric with id ${input.id}`);
  if (metric.kind !== 'metric') throw new OpError('invalid_input', `${input.id} is a ${metric.kind}, not a metric`);

  const from = input.since === undefined ? null : windowStart(input.since).getTime();
  const readings = effectiveReadings(h.store, input.id).filter(
    (reading) => from === null || (instantOf(reading.observed_at)?.getTime() ?? 0) >= from,
  );
  const attrs = metric.version.attrs as { unit?: string; cadence?: 'daily' | 'weekly' | 'monthly' | 'quarterly' };
  return {
    metric: { id: metric.id, title: metric.version.title, unit: attrs.unit ?? null, cadence: attrs.cadence ?? null },
    readings,
  };
});
