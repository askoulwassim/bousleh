import { z } from 'zod';
import { IdSchema, ScopeSlugSchema } from '../model/ids.js';
import { KINDS } from '../model/kinds.js';
import { AltitudeSchema } from '../model/layers.js';
import { defineOp } from './define.js';
import { ObjectRefSchema } from './metrics.js';

/*
 * watchlists.* and watch.*: owned by @bousleh/watch. A watch list (kind `watch_list`) says what
 * Horizon watches for a scope; each thing a scan finds is a `finding` linked to its watch list
 * with `from_watch_list`.
 */

const isoDateTime = z.iso.datetime({ offset: true });

/** One thing on a watch list, straight from the watch_list kind so the two never drift. */
export const WatchEntrySchema = KINDS.watch_list.attrs.shape.entries.unwrap().element;
export type WatchEntry = z.output<typeof WatchEntrySchema>;

/** A date (2026-10-25) or a date-time with an offset, as findings store published_at. */
export const PublishedAtSchema = KINDS.finding.attrs.shape.published_at.unwrap();

export const WatchListViewSchema = z.object({
  id: IdSchema,
  title: z.string(),
  altitude: AltitudeSchema,
  scopes: z.array(ScopeSlugSchema),
  entries: z.array(WatchEntrySchema),
  version: z.object({ id: IdSchema, n: z.number().int().min(1) }),
  /** When the current version was written. */
  updated_at: isoDateTime,
});
export type WatchListView = z.output<typeof WatchListViewSchema>;

export const watchlistsGet = defineOp({
  name: 'watchlists.get',
  description:
    'Read watch lists with their entries (type, name, url, notes): the one for a scope (by slug), one by id, or every watch list when you give neither. Each scope normally has one watch list.',
  input: z.object({
    id: IdSchema.optional(),
    scope: ScopeSlugSchema.optional(),
  }),
  output: z.object({ watch_lists: z.array(WatchListViewSchema) }),
  readOnly: true,
});

export const watchlistsSet = defineOp({
  name: 'watchlists.set',
  description:
    "Set what a watch list holds. Give a scope slug to create that scope's watch list, or to replace its entries if it already has one; or give the id of an existing watch list. Give one of the two, not both. entries is the complete new list (each with a type: competitor, topic, outlet, person or podcast; a name; and optionally a url and notes), and it replaces the old entries as a new version, so send every entry you want to keep. title, altitude (default 10000) and body are optional. Nothing is written when nothing changes.",
  input: z.object({
    id: IdSchema.optional(),
    scope: ScopeSlugSchema.optional(),
    entries: z.array(WatchEntrySchema).max(200),
    title: z.string().trim().min(1).max(200).optional(),
    altitude: AltitudeSchema.optional(),
    body: z.string().optional(),
  }),
  output: WatchListViewSchema.extend({
    /** True when this call created the watch list. */
    created: z.boolean(),
    /** True when this call wrote a version (always true on create). */
    new_version: z.boolean(),
  }),
});

export const FindingInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  url: z.url(),
  published_at: PublishedAtSchema.optional(),
  /** A few sentences on what it is and why it matters; stored as the finding's body. */
  summary: z.string().trim().max(4000).optional(),
});

export const watchFile = defineOp({
  name: 'watch.file',
  description:
    "File what a Horizon scan found into a watch list, named by its id or by its scope's slug (give one). Each finding has a title, its url, optionally when it was published, and a short summary of what it is and why it matters. Each becomes a finding in the watch list's scopes, at the watch list's altitude, linked to the watch list. A finding whose url is already filed (anywhere, ignoring tracking parameters, the #fragment, a trailing slash and www.) is skipped, so filing the same scan twice is safe. The answer lists what was filed and what was skipped.",
  input: z.object({
    watch_list_id: IdSchema.optional(),
    scope: ScopeSlugSchema.optional(),
    findings: z.array(FindingInputSchema).min(1).max(100),
  }),
  output: z.object({
    watch_list: ObjectRefSchema.extend({ scopes: z.array(ScopeSlugSchema) }),
    filed: z.array(z.object({ id: IdSchema, title: z.string(), url: z.string() })),
    skipped: z.array(
      z.object({
        title: z.string(),
        url: z.string(),
        /** already_filed: an earlier finding has this url. repeated: it came twice in this call. */
        reason: z.enum(['already_filed', 'repeated']),
        /** The finding that already has this url. */
        existing_id: IdSchema,
      }),
    ),
  }),
});

export const DigestFindingSchema = z.object({
  id: IdSchema,
  title: z.string(),
  url: z.string(),
  published_at: z.string().nullable(),
  filed_at: isoDateTime,
  summary: z.string(),
});

export const watchDigest = defineOp({
  name: 'watch.digest',
  description:
    'Recent findings, grouped by the watch list they were filed under: each with its title, url, published date and a short summary. Covers findings filed since a date (default: the last 7 days), optionally only one scope (by slug) or one watch list (by id). Findings filed without a watch list come last, under a null watch list. Newest first within each group, at most limit findings in all.',
  input: z.object({
    since: z.union([z.iso.date(), isoDateTime]).optional(),
    scope: ScopeSlugSchema.optional(),
    watch_list_id: IdSchema.optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  output: z.object({
    since: isoDateTime,
    until: isoDateTime,
    /** How many findings matched, even when limit cut the list short. */
    total: z.number().int().min(0),
    groups: z.array(
      z.object({
        watch_list: ObjectRefSchema.nullable(),
        findings: z.array(DigestFindingSchema),
      }),
    ),
  }),
  readOnly: true,
});

export const watchOps = {
  'watchlists.get': watchlistsGet,
  'watchlists.set': watchlistsSet,
  'watch.file': watchFile,
  'watch.digest': watchDigest,
} as const;
