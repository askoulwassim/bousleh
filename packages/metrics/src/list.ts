import { type MetricSummary, metricsList, type ObjectView } from '@bousleh/contracts';
import { defineHandler } from '@bousleh/vault';
import { call } from './call.js';
import { effectiveReadings } from './readings.js';

/* metrics.list: the registry, filtered by lifecycle status and scope, each metric with its latest effective reading. */

export const metricsListHandler = defineHandler(metricsList, async (input, h) => {
  const inScope = input.scope === undefined ? undefined : h.store.expandScopes([input.scope]);
  const statuses = input.status ?? [];
  const where = statuses.length > 0 ? `AND c.status IN (${statuses.map(() => '?').join(', ')})` : '';
  const ids = h.store.db
    .prepare(
      `SELECT o.id FROM objects o JOIN current c ON c.object_id = o.id
       WHERE o.kind = 'metric' ${where}
       ORDER BY c.title COLLATE NOCASE, o.id`,
    )
    .all(...statuses) as { id: string }[];

  const metrics: MetricSummary[] = [];
  for (const { id } of ids) {
    const metric = await call(h, 'vault.get', { id });
    if (inScope !== undefined && !metric.scopes.some((slug) => inScope.has(slug))) continue;
    metrics.push(summarise(metric, effectiveReadings(h.store, id)));
  }
  return { metrics };
});

function summarise(metric: ObjectView, readings: NonNullable<MetricSummary['latest_reading']>[]): MetricSummary {
  const latest = readings.at(-1) ?? null;
  const previous = readings.at(-2);
  const { version } = metric;
  const linked = (kind: string) => {
    const link = metric.links.out.filter((l) => l.kind === kind).at(-1);
    return link ? { id: link.to, title: link.to_title } : null;
  };
  return {
    id: metric.id,
    title: version.title,
    status: version.status as MetricSummary['status'],
    altitude: version.altitude,
    cadence: (version.attrs.cadence as MetricSummary['cadence'] | undefined) ?? null,
    unit: (version.attrs.unit as string | undefined) ?? null,
    scopes: metric.scopes,
    owner: linked('owned_by'),
    serves: linked('serves'),
    latest_reading: latest,
    change: latest && previous ? { previous, delta: latest.value - previous.value } : null,
    updated_at: version.created_at,
  };
}
