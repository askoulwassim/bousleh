import { z } from 'zod';
import type { Layer } from './layers.js';

/*
 * Object kinds per layer (docs/design/data-schema.md, section 3).
 * Each kind fixes its layer, its id prefix, its statuses (stored in `versions.status`) and the
 * zod schema for its kind-specific fields (stored in `versions.attrs_json`).
 */

const date = z.iso.date();
const dateOrDateTime = z.union([z.iso.date(), z.iso.datetime({ offset: true })]);
const text = z.string().trim().min(1);
/** A short lower-case slug, for signal tags: `onboarding`, `export-speed`. */
export const TagSchema = z
  .string()
  .max(40)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'a tag is a short lower-case slug, words joined by hyphens, like export-speed');

export interface KindDef {
  layer: Layer;
  /** Three lower-case letters; ids are `<prefix>_<ULID>`. */
  prefix: string;
  /** What the kind is, written for the model that files objects. */
  description: string;
  /** Allowed values of `versions.status`. Absent: the kind has no status. */
  statuses?: readonly string[];
  /** Status a new object gets when the caller gives none. */
  defaultStatus?: string;
  /** Statuses a caller may never set directly (they are reached another way). */
  reservedStatuses?: readonly string[];
  /** Kind-specific fields. Strict: unknown keys are refused. */
  attrs: z.ZodObject;
  /** Every object needs at least one scope, except people. */
  scopeRequired: boolean;
}

export const STRATEGY_STATUSES = ['forming', 'contested', 'aligned', 'communicated'] as const;
export const METRIC_STATUSES = ['idea', 'defined', 'instrumented', 'measured', 'reviewed'] as const;
/**
 * Oct 25: no won/lost. `concluded` is reached only through a `concludes` link from a decision.
 * `running`: being tried right now (an experiment under way, a build in progress); no attrs required.
 */
export const IDEA_STATUSES = ['open', 'running', 'bet', 'parked', 'dropped', 'concluded'] as const;
/** Idea statuses a `concludes` link may end. */
export const CONCLUDABLE_IDEA_STATUSES = ['bet', 'running'] as const;
/** Oct 25 (statuses): problems written before this have no status; they read as `open`. */
export const PROBLEM_STATUSES = ['open', 'solved', 'dropped'] as const;
export const COMMITMENT_STATUSES = ['open', 'done', 'dropped'] as const;
/** Oct 25: initiatives written before this have no status; they read as `active`. */
export const INITIATIVE_STATUSES = ['proposed', 'active', 'paused', 'done', 'dropped'] as const;
/** Horizon's reading queue. Findings filed before this have no status; they read as `new`. */
export const FINDING_STATUSES = ['new', 'to_read', 'read', 'dismissed'] as const;
/** A planned meeting is one coming up (Counsel's prep lives on it); held is one that happened. Meetings with no status read as `held`. */
export const MEETING_STATUSES = ['planned', 'held'] as const;

export const WATCH_ENTRY_TYPES = ['competitor', 'topic', 'outlet', 'person', 'podcast'] as const;
/** Who put an entry on a watch list: Wassim, or the Weekly Horizon scan's learning loop. Entries without it are Wassim's. */
export const WATCH_ENTRY_ADDED_BY = ['wassim', 'horizon'] as const;
export const PERSON_ROLES = ['stakeholder', 'pm', 'engineer', 'analyst', 'other'] as const;
/** At most this many email addresses on one person. */
export const MAX_PERSON_EMAILS = 5;
/** An email address, trimmed and lower-cased, so calendar attendees match people whatever the case. */
export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email());
/** What an asset is: a Claude Doc, a Slides deck, a sheet, a dashboard, a whiteboard, a design, a published page, a repo, a file. */
export const ASSET_TYPES = ['doc', 'slides', 'sheet', 'dashboard', 'whiteboard', 'design', 'page', 'repo', 'file', 'other'] as const;

export const KINDS = {
  // ------------------------------------------------------------ anchors
  strategy: {
    layer: 'anchors',
    prefix: 'stg',
    description: 'A product strategy or one of its lines.',
    statuses: STRATEGY_STATUSES,
    defaultStatus: 'forming',
    attrs: z.strictObject({}),
    scopeRequired: true,
  },
  principle: {
    layer: 'anchors',
    prefix: 'prn',
    description: 'A principle decisions get checked against.',
    attrs: z.strictObject({}),
    scopeRequired: true,
  },
  metric: {
    layer: 'anchors',
    prefix: 'met',
    description: 'A metric in the registry. Status is its lifecycle; its owner and the strategy line it serves are links.',
    statuses: METRIC_STATUSES,
    defaultStatus: 'idea',
    attrs: z.strictObject({
      cadence: z.enum(['daily', 'weekly', 'monthly', 'quarterly']).optional(),
      unit: text.optional(),
    }),
    scopeRequired: true,
  },
  watch_list: {
    layer: 'anchors',
    prefix: 'wls',
    description:
      'What Horizon watches for a scope: competitors, topics, outlets, people and podcasts. Each entry says who added it (wassim, the default, or horizon, for one the weekly scan proposed) and optionally why.',
    attrs: z.strictObject({
      entries: z
        .array(
          z.strictObject({
            type: z.enum(WATCH_ENTRY_TYPES),
            name: text,
            url: z.url().optional(),
            notes: text.optional(),
            /** Entries written before Oct 25 have none: they are Wassim's. */
            added_by: z.enum(WATCH_ENTRY_ADDED_BY).default('wassim'),
            /** Why it was added, for an entry the scan proposed. */
            reason: text.optional(),
          }),
        )
        .default([]),
    }),
    scopeRequired: true,
  },
  term: {
    layer: 'anchors',
    prefix: 'trm',
    description:
      'A glossary term: a word or acronym as the company uses it. The title is the term, aliases are other names for it, definition is one or two sentences; the body can hold more.',
    attrs: z.strictObject({
      aliases: z.array(text).default([]),
      definition: text.optional(),
    }),
    scopeRequired: true,
  },
  // ------------------------------------------------------------ evidence
  signal: {
    layer: 'evidence',
    prefix: 'sig',
    description:
      'A piece of feedback, atomised: one thing someone said or asked for. tags are short lower-case slugs naming what it is about, so feedback can be counted as patterns; reuse existing tags.',
    attrs: z.strictObject({
      source: text.optional(),
      sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']).optional(),
      tags: z
        .array(TagSchema)
        .max(10)
        .refine((tags) => new Set(tags).size === tags.length, 'each tag once')
        .default([]),
    }),
    scopeRequired: true,
  },
  observation: {
    layer: 'evidence',
    prefix: 'obs',
    description: 'Something noticed first-hand.',
    attrs: z.strictObject({}),
    scopeRequired: true,
  },
  finding: {
    layer: 'evidence',
    prefix: 'fnd',
    description:
      'Something Horizon found outside: an article, a launch, a podcast episode. Links to its watch list. Status is the reading queue: new, to_read, read, dismissed.',
    statuses: FINDING_STATUSES,
    defaultStatus: 'new',
    attrs: z.strictObject({
      url: z.url(),
      published_at: dateOrDateTime.optional(),
    }),
    scopeRequired: true,
  },
  // ------------------------------------------------------------ work
  problem: {
    layer: 'work',
    prefix: 'prb',
    description:
      'A problem definition, with its evidence linked. Status: open (the default), solved or dropped; record why with a decision linked `related`.',
    statuses: PROBLEM_STATUSES,
    defaultStatus: 'open',
    attrs: z.strictObject({}),
    scopeRequired: true,
  },
  idea: {
    layer: 'work',
    prefix: 'ida',
    description:
      'An idea. Status: open, running (being tried right now: an experiment under way, a build in progress), bet (needs a hypothesis and kill criteria), parked, dropped, concluded. A bet or a running idea is concluded only by linking a decision to it with `concludes`. rank orders ideas against each other: 1 is the top.',
    statuses: IDEA_STATUSES,
    defaultStatus: 'open',
    reservedStatuses: ['concluded'],
    attrs: z.strictObject({
      hypothesis: text.optional(),
      kill_criteria: text.optional(),
      rank: z.number().int().min(1).optional(),
    }),
    scopeRequired: true,
  },
  initiative: {
    layer: 'work',
    prefix: 'ini',
    description:
      'An initiative that problems, ideas and decisions are part of. Status: proposed, active, paused, done, dropped. Its owner is an `owned_by` link to a person.',
    statuses: INITIATIVE_STATUSES,
    defaultStatus: 'active',
    attrs: z.strictObject({
      started_at: date.optional(),
      target_date: date.optional(),
    }),
    scopeRequired: true,
  },
  decision: {
    layer: 'work',
    prefix: 'dec',
    description: 'A decision, product-ADR style.',
    attrs: z.strictObject({
      decided_at: date.optional(),
      reversible: z.boolean().optional(),
    }),
    scopeRequired: true,
  },
  asset: {
    layer: 'work',
    prefix: 'ast',
    description:
      'An outside asset (a Claude Doc, deck, dashboard, whiteboard, design or page, a repo, a file) that documents work kept in Bousleh. Register it with assets.add; it links with `documents` to the objects it documents.',
    attrs: z.strictObject({
      url: z.url(),
      type: z.enum(ASSET_TYPES),
    }),
    scopeRequired: true,
  },
  // ------------------------------------------------------------ people
  person: {
    layer: 'people',
    prefix: 'per',
    description:
      'A person: a stakeholder, a PM, an engineer, an analyst. People may have no scope. Exactly one person may be marked is_user: the person this Bousleh belongs to. emails are their email addresses (lower-cased, each once), so calendar attendees can be matched to them; a new version replaces the whole list.',
    attrs: z.strictObject({
      role: z.enum(PERSON_ROLES).optional(),
      org: text.optional(),
      /** Oct 25: people written before have none. Stored lower-cased, each once. */
      emails: z
        .array(EmailSchema)
        .max(MAX_PERSON_EMAILS)
        .refine((emails) => new Set(emails).size === emails.length, 'each email once')
        .optional(),
      /** The person this instance belongs to ("me" in Pulse). At most one current person has it. */
      is_user: z.literal(true).optional(),
    }),
    scopeRequired: false,
  },
  growth_note: {
    layer: 'people',
    prefix: 'gnt',
    description: 'One coaching entry about a person (link it with `about`).',
    attrs: z.strictObject({}),
    scopeRequired: true,
  },
  // ------------------------------------------------------------ moments
  dump: {
    layer: 'moments',
    prefix: 'dmp',
    description: 'A raw dump: a voice note or a brain dump, kept as said.',
    attrs: z.strictObject({}),
    scopeRequired: true,
  },
  meeting: {
    layer: 'moments',
    prefix: 'mtg',
    description:
      'A meeting. Attendees are `attended_by` links to people. Status planned for one coming up (prep goes in its body), held once it happened. held_at is when it was or will be held.',
    statuses: MEETING_STATUSES,
    defaultStatus: 'held',
    attrs: z.strictObject({
      held_at: dateOrDateTime.optional(),
    }),
    scopeRequired: true,
  },
  commitment: {
    layer: 'moments',
    prefix: 'cmt',
    description: 'Something owed: who owes it and to whom are `owed_by` and `owed_to` links to people.',
    statuses: COMMITMENT_STATUSES,
    defaultStatus: 'open',
    attrs: z.strictObject({
      due: date.optional(),
    }),
    scopeRequired: true,
  },
  daily_note: {
    layer: 'moments',
    prefix: 'dnt',
    description: 'A daily note.',
    attrs: z.strictObject({
      date: date.optional(),
    }),
    scopeRequired: true,
  },
} as const satisfies Record<string, KindDef>;

export type Kind = keyof typeof KINDS;
export const KIND_NAMES = Object.keys(KINDS) as Kind[];
export const KindSchema = z.enum(KIND_NAMES as [Kind, ...Kind[]]);

export function kindDef(kind: Kind): KindDef {
  return KINDS[kind];
}

/**
 * The status an object reads as. Objects written before their kind had statuses (initiatives,
 * meetings and findings until Oct 25, then problems) have none stored; they read as the kind's default.
 */
export function effectiveStatus(kind: Kind, stored: string | null | undefined): string | null {
  const def: KindDef = KINDS[kind];
  if (!def.statuses) return null;
  return stored ?? def.defaultStatus ?? null;
}

/** A problem with what a caller asked to write, phrased for the model that sent it. */
export interface DepositIssue {
  path: string;
  message: string;
}

export interface CheckedFields {
  status: string | null;
  attrs: Record<string, unknown>;
}

/**
 * Validate status and attrs for a kind and apply defaults. `previous` is the current version
 * when this writes a new version of an existing object (`attrs` its attrs, when known).
 * Rules: statuses must belong to the kind; reserved statuses can't be set directly; a bet needs a
 * hypothesis and kill criteria; a concluded idea stays concluded and keeps the hypothesis and kill
 * criteria it had (a running idea may have been concluded without them).
 */
export function checkKindFields(
  kind: Kind,
  input: { status?: string | null | undefined; attrs?: Record<string, unknown> | undefined },
  previous?: { status: string | null; attrs?: Record<string, unknown> | undefined },
): { ok: true; value: CheckedFields } | { ok: false; issues: DepositIssue[] } {
  const def: KindDef = KINDS[kind];
  const issues: DepositIssue[] = [];

  const parsed = def.attrs.safeParse(input.attrs ?? {});
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({ path: ['attrs', ...issue.path].join('.'), message: issue.message });
    }
  }

  let status: string | null = null;
  if (def.statuses) {
    const asked = input.status ?? undefined;
    if (asked === undefined || asked === null) {
      status = previous?.status ?? def.defaultStatus ?? null;
    } else if (!def.statuses.includes(asked)) {
      issues.push({ path: 'status', message: `${kind} status must be one of: ${def.statuses.join(', ')}` });
    } else if (def.reservedStatuses?.includes(asked) && previous?.status !== asked) {
      issues.push({
        path: 'status',
        message:
          kind === 'idea' ? 'an idea is concluded only by linking a decision to it with `concludes`' : `${asked} can't be set directly`,
      });
    } else {
      status = asked;
    }
    if (kind === 'idea' && previous?.status === 'concluded' && status !== null && status !== 'concluded') {
      issues.push({ path: 'status', message: 'a concluded idea stays concluded' });
    }
  } else if (input.status !== undefined && input.status !== null) {
    issues.push({ path: 'status', message: `${kind} has no status` });
  }

  const attrs = parsed.success ? (parsed.data as Record<string, unknown>) : {};
  if (kind === 'idea' && status === 'bet') {
    if (attrs.hypothesis === undefined) issues.push({ path: 'attrs.hypothesis', message: 'a bet needs a hypothesis' });
    if (attrs.kill_criteria === undefined) issues.push({ path: 'attrs.kill_criteria', message: 'a bet needs kill criteria' });
  }
  // A concluded idea keeps the hypothesis and kill criteria it was judged against, if it had them.
  if (kind === 'idea' && status === 'concluded' && previous?.status === 'concluded') {
    for (const key of ['hypothesis', 'kill_criteria'] as const) {
      if (previous.attrs?.[key] !== undefined && attrs[key] === undefined) {
        issues.push({
          path: `attrs.${key}`,
          message: `a concluded idea keeps its ${key === 'hypothesis' ? 'hypothesis' : 'kill criteria'}`,
        });
      }
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { status, attrs } };
}
