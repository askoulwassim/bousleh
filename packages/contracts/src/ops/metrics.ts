import { z } from 'zod';
import { IdSchema, ScopeSlugSchema } from '../model/ids.js';
import { KINDS, METRIC_STATUSES } from '../model/kinds.js';
import { AltitudeSchema } from '../model/layers.js';
import { defineOp } from './define.js';
import { ObjectRefSchema, WrittenSchema } from './shapes.js';

/* metrics.*: owned by @bousleh/metrics. A metric is an object (kind `metric`); its readings live in `metric_readings`. */

const isoDateTime = z.iso.datetime({ offset: true });
const dateOrDateTime = z.union([z.iso.date(), isoDateTime]);

/** How often a metric is read, straight from the metric kind so the two never drift. */
export const MetricCadenceSchema = KINDS.metric.attrs.shape.cadence.unwrap();
export const MetricStatusSchema = z.enum(METRIC_STATUSES);

/** One row of `metric_readings`. */
export const MetricReadingSchema = z.object({
  id: IdSchema,
  metric_id: IdSchema,
  value: z.number(),
  unit: z.string().nullable(),
  /** A date (2026-10-25) or a UTC date-time. */
  observed_at: z.string(),
  source: z.string().nullable(),
  /** The reading this one corrects, if it is a correction. */
  supersedes: IdSchema.nullable(),
  created_at: isoDateTime,
});
export type MetricReading = z.output<typeof MetricReadingSchema>;

export const MetricSummarySchema = z.object({
  id: IdSchema,
  title: z.string(),
  status: MetricStatusSchema,
  altitude: AltitudeSchema,
  cadence: MetricCadenceSchema.nullable(),
  unit: z.string().nullable(),
  scopes: z.array(ScopeSlugSchema),
  owner: ObjectRefSchema.nullable(),
  serves: ObjectRefSchema.nullable(),
  /** The newest reading by observed_at, after corrections. Null when the metric has none. */
  latest_reading: MetricReadingSchema.nullable(),
  /** When the current version was written. */
  updated_at: isoDateTime,
});
export type MetricSummary = z.output<typeof MetricSummarySchema>;

export const metricsUpsert = defineOp({
  name: 'metrics.upsert',
  description:
    'Create a metric in the registry, or update one by id. To create, leave out id and give a title, an altitude (50000 company, 10000 cross-team, 1000 own surfaces, 100 one engineer or requirement) and at least one scope slug. To update, give the id and only the fields that change; an update that changes nothing writes no new version. status is the lifecycle: idea, defined, instrumented, measured, reviewed (new metrics start as idea). cadence is daily, weekly, monthly or quarterly; set cadence or unit to null to clear it. owner is the id of the person who owns the metric and serves is the id of the strategy it serves; both are links, and giving a different one replaces the old link (it is retracted, not deleted). Scopes are set when the metric is created.',
  input: z.object({
    id: IdSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    status: MetricStatusSchema.optional(),
    cadence: MetricCadenceSchema.nullable().optional(),
    unit: z.string().trim().min(1).max(40).nullable().optional(),
    altitude: AltitudeSchema.optional(),
    scopes: z.array(ScopeSlugSchema).optional(),
    body: z.string().optional(),
    owner: IdSchema.optional(),
    serves: IdSchema.optional(),
  }),
  output: WrittenSchema.extend({
    /** True when this call created the metric. */
    created: z.boolean(),
    /** True when this call wrote a version (always true on create). */
    new_version: z.boolean(),
  }),
});

export const metricsReading = defineOp({
  name: 'metrics.reading',
  description:
    "Record one reading of a metric: its value, and optionally the unit (default: the metric's unit), when it was observed (a date or date-time, default now) and where the number came from. Readings are never edited. To fix a wrong reading, record a new one with corrects set to the wrong reading's id; the correction replaces it, and fields you leave out carry over from it.",
  input: z.object({
    metric_id: IdSchema,
    value: z.number(),
    unit: z.string().trim().min(1).max(40).optional(),
    observed_at: dateOrDateTime.optional(),
    source: z.string().trim().min(1).max(500).optional(),
    corrects: IdSchema.optional(),
  }),
  output: MetricReadingSchema,
});

export const metricsList = defineOp({
  name: 'metrics.list',
  description:
    'List metrics in the registry, optionally only those with the given lifecycle statuses and only those in one scope (by slug). Each comes with its cadence, unit, owner, the strategy it serves, and its latest reading with any corrections applied. Use vault.get on an id for the full body.',
  input: z.object({
    status: z.array(MetricStatusSchema).min(1).optional(),
    scope: ScopeSlugSchema.optional(),
  }),
  output: z.object({ metrics: z.array(MetricSummarySchema) }),
  readOnly: true,
});

export const metricOps = {
  'metrics.upsert': metricsUpsert,
  'metrics.reading': metricsReading,
  'metrics.list': metricsList,
} as const;
