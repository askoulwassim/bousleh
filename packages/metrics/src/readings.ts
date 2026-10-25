import { type MetricReading, metricsReading, ROW_PREFIXES } from '@bousleh/contracts';
import { defineHandler, instantOf, newId, OpError, type Store } from '@bousleh/vault';

/*
 * metrics.reading: readings live in `metric_readings`, a table this package owns. Rows are never
 * updated: a correction is a new row whose `supersedes_id` points at the reading it corrects, and
 * a reading is effective while nothing supersedes it.
 */

interface ReadingRow {
  id: string;
  metric_id: string;
  value: number;
  unit: string | null;
  observed_at: string;
  source: string | null;
  supersedes_id: string | null;
  created_at: string;
}

export function toReading(row: ReadingRow): MetricReading {
  return {
    id: row.id,
    metric_id: row.metric_id,
    value: row.value,
    unit: row.unit,
    observed_at: row.observed_at,
    source: row.source,
    supersedes: row.supersedes_id,
    created_at: row.created_at,
  };
}

/** When a reading was observed, as a moment: a plain date at local midnight, so dates and date-times sort together. */
const observedAt = (reading: MetricReading) => instantOf(reading.observed_at)?.getTime() ?? 0;

/**
 * A metric's effective readings, oldest first: a reading a correction supersedes is left out, and
 * the correction stands in its place. Ordered by observed_at (a plain date counts from local
 * midnight), then by when each was recorded.
 */
export function effectiveReadings(store: Store, metricId: string): MetricReading[] {
  const rows = store.db
    .prepare(
      `SELECT r.* FROM metric_readings r
       WHERE r.metric_id = ? AND NOT EXISTS (SELECT 1 FROM metric_readings c WHERE c.supersedes_id = r.id)`,
    )
    .all(metricId) as ReadingRow[];
  return rows
    .map(toReading)
    .sort((a, b) => observedAt(a) - observedAt(b) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/** The newest effective reading of a metric: by observed_at, then by when it was recorded. */
export function latestReading(store: Store, metricId: string): MetricReading | null {
  return effectiveReadings(store, metricId).at(-1) ?? null;
}

/** Dates stay dates; date-times are stored in UTC so they sort as text. */
function normaliseObservedAt(value: string): string {
  return value.includes('T') ? new Date(value).toISOString() : value;
}

export const metricsReadingHandler = defineHandler(metricsReading, (input, h) => {
  if (!h.store.writable) throw new Error('metrics.reading needs a writable store');
  const db = h.store.db;
  const metric = db.prepare('SELECT kind FROM objects WHERE id = ?').get(input.metric_id) as { kind: string } | undefined;
  if (!metric) throw new OpError('not_found', `no object with id ${input.metric_id}`);
  if (metric.kind !== 'metric') throw new OpError('invalid_input', `${input.metric_id} is a ${metric.kind}, not a metric`);

  let corrected: ReadingRow | undefined;
  if (input.corrects !== undefined) {
    corrected = db.prepare('SELECT * FROM metric_readings WHERE id = ?').get(input.corrects) as ReadingRow | undefined;
    if (!corrected) throw new OpError('not_found', `no reading with id ${input.corrects}`);
    if (corrected.metric_id !== input.metric_id) {
      throw new OpError('invalid_input', `reading ${input.corrects} belongs to metric ${corrected.metric_id}, not ${input.metric_id}`);
    }
    const later = db.prepare('SELECT id FROM metric_readings WHERE supersedes_id = ?').get(input.corrects) as { id: string } | undefined;
    if (later) {
      throw new OpError('conflict', `reading ${input.corrects} was already corrected by ${later.id}; correct that one instead`);
    }
  }

  const metricAttrs = db.prepare('SELECT attrs_json FROM current WHERE object_id = ?').get(input.metric_id) as
    | { attrs_json: string }
    | undefined;
  const metricUnit = (JSON.parse(metricAttrs?.attrs_json ?? '{}') as { unit?: string }).unit;

  const now = h.ctx.now();
  const row: ReadingRow = {
    id: newId(ROW_PREFIXES.reading, now),
    metric_id: input.metric_id,
    value: input.value,
    unit: input.unit ?? corrected?.unit ?? metricUnit ?? null,
    observed_at: input.observed_at !== undefined ? normaliseObservedAt(input.observed_at) : (corrected?.observed_at ?? now.toISOString()),
    source: input.source ?? corrected?.source ?? null,
    supersedes_id: corrected?.id ?? null,
    created_at: now.toISOString(),
  };
  db.prepare(
    `INSERT INTO metric_readings (id, metric_id, value, unit, observed_at, source, supersedes_id, op, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.metric_id,
    row.value,
    row.unit,
    row.observed_at,
    row.source,
    row.supersedes_id,
    h.def.name,
    h.ctx.actor,
    row.created_at,
  );
  return toReading(row);
});
