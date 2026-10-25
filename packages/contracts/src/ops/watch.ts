import { z } from 'zod';
import { IdSchema, ScopeSlugSchema } from '../model/ids.js';
import { FINDING_STATUSES, KINDS } from '../model/kinds.js';
import { AltitudeSchema } from '../model/layers.js';
import { defineOp } from './define.js';
import { ObjectRefSchema } from './shapes.js';

/*
 * watchlists.* and watch.*: owned by @bousleh/watch. A watch list (kind `watch_list`) says what
 * Horizon watches for a scope; each thing a scan finds is a `finding` linked to its watch list
 * with `from_watch_list`.
 */

const isoDateTime = z.iso.datetime({ offset: true });

/** One thing on a watch list, straight from the watch_list kind so the two never drift. */
export const WatchEntrySchema = KINDS.watch_list.attrs.shape.entries.unwrap().element;
export type WatchEntry = z.output<typeof WatchEntrySchema>;

/**
 * An entry as watchlists.set takes it: added_by may be left out, and then an entry already on the
 * list (same url, or same type and name) keeps its added_by and reason; a new one is Wassim's.
 */
export const WatchEntryInputSchema = WatchEntrySchema.extend({ added_by: WatchEntrySchema.shape.added_by.unwrap().optional() });
export type WatchEntryInput = z.output<typeof WatchEntryInputSchema>;

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
    'Read watch lists with their entries (type, name, url, notes, added_by, reason): the one for a scope (by slug), one by id, or every watch list when you give neither. Each scope normally has one watch list. added_by is wassim for entries Wassim added (every entry from before Oct 25) and horizon for entries the Weekly Horizon scan proposed and Bousleh applied.',
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
    "Set what a watch list holds. Give a scope slug to create that scope's watch list, or to replace its entries if it already has one; or give the id of an existing watch list. Give one of the two, not both. entries is the complete new list (each with a type: competitor, topic, outlet, person or podcast; a name; and optionally a url, notes, added_by and reason), and it replaces the old entries as a new version, so send every entry you want to keep. added_by is wassim or horizon: leave it out and an entry already on the list (same url, or same type and name) keeps its own, while a new entry is Wassim's; set horizon on an entry the scan proposed, with its reason. title, altitude (default 10000) and body are optional. Nothing is written when nothing changes; every change is a new version, so the list's history shows what changed and when.",
  input: z.object({
    id: IdSchema.optional(),
    scope: ScopeSlugSchema.optional(),
    entries: z.array(WatchEntryInputSchema).max(200),
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

/** One change a Weekly Horizon scan proposes for a watch list. */
export const WatchListChangeSchema = z.object({
  action: z.enum(['add', 'remove']),
  type: WatchEntrySchema.shape.type,
  name: WatchEntrySchema.shape.name,
  url: WatchEntrySchema.shape.url,
  /** The scan's one-line reason. */
  reason: z.string().trim().min(1).max(500),
});
export type WatchListChange = z.output<typeof WatchListChangeSchema>;

/** What watchlists.apply did with one change. */
export const WatchListChangeOutcomeSchema = z.enum([
  /** add: now on the list, marked added_by horizon. */
  'added',
  /** remove: a horizon-added entry, now off the list. */
  'removed',
  /** remove: an entry Wassim added, so it stays; a suggestion to remove it is in the queue. */
  'queued',
  /** add: a matching entry is already on the list. */
  'already_on_list',
  /** remove: nothing on the list matches. */
  'not_on_list',
  /** remove: an open queue item already suggests removing this entry. */
  'already_queued',
]);

export const watchlistsApply = defineOp({
  name: 'watchlists.apply',
  description:
    "Apply the watch list changes a Weekly Horizon scan proposed (its \"## Watch list changes\" lines), to the watch list with this id. Each change is add or remove, with the entry's type, name, url (if any) and the scan's reason. An entry matches when its url matches (ignoring www., https and a trailing slash) or, without urls, its type and name match (ignoring case). add puts the entry on the list marked added_by horizon with the reason, unless a match is already there. remove takes an entry off only when Horizon added it. An entry Wassim added is never removed here: instead the suggestion is queued for him (an observation draft linked to the watch list), once, however many scans repeat it; he decides, then edits the list with watchlists.set and resolves the queue item. All the applied changes go in one new version of the list, so its history shows them; nothing is written when nothing changes. source (such as the scan file's name) goes in the queued suggestion's body.",
  input: z.object({
    id: IdSchema,
    changes: z.array(WatchListChangeSchema).min(1).max(50),
    source: z.string().trim().min(1).max(200).optional(),
  }),
  output: z.object({
    watch_list: WatchListViewSchema,
    /** True when this call wrote a version of the watch list. */
    new_version: z.boolean(),
    results: z.array(
      z.object({
        action: z.enum(['add', 'remove']),
        type: WatchEntrySchema.shape.type,
        name: z.string(),
        outcome: WatchListChangeOutcomeSchema,
        /** The queue item suggesting the removal (queued and already_queued). */
        queue_id: IdSchema.optional(),
      }),
    ),
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

/** Where a finding is in the reading queue. Findings filed before Oct 25 read as new. */
export const FindingStatusSchema = z.enum(FINDING_STATUSES);

export const DigestFindingSchema = z.object({
  id: IdSchema,
  title: z.string(),
  status: FindingStatusSchema,
  url: z.string(),
  published_at: z.string().nullable(),
  filed_at: isoDateTime,
  summary: z.string(),
});

export const watchDigest = defineOp({
  name: 'watch.digest',
  description:
    'Recent findings, grouped by the watch list they were filed under: each with its title, url, reading-queue status (new, to_read, read, dismissed), published date and a short summary. Covers findings filed since a date (default: the last 7 days), optionally only one scope (by slug) or one watch list (by id). status keeps only findings in those reading-queue statuses; with status and no since, there is no time window, so status [to_read] is the whole reading queue. Move a finding through the queue with vault.supersede (status). Findings filed without a watch list come last, under a null watch list. Newest first within each group, at most limit findings in all.',
  input: z.object({
    since: z.union([z.iso.date(), isoDateTime]).optional(),
    scope: ScopeSlugSchema.optional(),
    watch_list_id: IdSchema.optional(),
    status: z.array(FindingStatusSchema).min(1).optional(),
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
  'watchlists.apply': watchlistsApply,
  'watch.file': watchFile,
  'watch.digest': watchDigest,
} as const;
