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
/** Oct 25: no won/lost. `concluded` is reached only through a `concludes` link from a decision. */
export const IDEA_STATUSES = ['open', 'bet', 'parked', 'dropped', 'concluded'] as const;
export const COMMITMENT_STATUSES = ['open', 'done', 'dropped'] as const;

export const WATCH_ENTRY_TYPES = ['competitor', 'topic', 'outlet', 'person', 'podcast'] as const;
export const PERSON_ROLES = ['stakeholder', 'pm', 'engineer', 'analyst', 'other'] as const;

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
    description: 'What Horizon watches for a scope: competitors, topics, outlets, people and podcasts.',
    attrs: z.strictObject({
      entries: z
        .array(
          z.strictObject({
            type: z.enum(WATCH_ENTRY_TYPES),
            name: text,
            url: z.url().optional(),
            notes: text.optional(),
          }),
        )
        .default([]),
    }),
    scopeRequired: true,
  },
  // ------------------------------------------------------------ evidence
  signal: {
    layer: 'evidence',
    prefix: 'sig',
    description: 'A piece of feedback, atomised: one thing someone said or asked for.',
    attrs: z.strictObject({
      source: text.optional(),
      sentiment: z.enum(['positive', 'neutral', 'negative', 'mixed']).optional(),
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
    description: 'Something Horizon found outside: an article, a launch, a podcast episode. Links to its watch list.',
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
    description: 'A problem definition, with its evidence linked.',
    attrs: z.strictObject({}),
    scopeRequired: true,
  },
  idea: {
    layer: 'work',
    prefix: 'ida',
    description:
      'An idea. As a bet it needs a hypothesis and kill criteria. It is concluded only by linking a decision to it with `concludes`.',
    statuses: IDEA_STATUSES,
    defaultStatus: 'open',
    reservedStatuses: ['concluded'],
    attrs: z.strictObject({
      hypothesis: text.optional(),
      kill_criteria: text.optional(),
    }),
    scopeRequired: true,
  },
  initiative: {
    layer: 'work',
    prefix: 'ini',
    description: 'An initiative that problems, ideas and decisions are part of.',
    attrs: z.strictObject({}),
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
  // ------------------------------------------------------------ people
  person: {
    layer: 'people',
    prefix: 'per',
    description: 'A person: a stakeholder, a PM, an engineer, an analyst. People may have no scope.',
    attrs: z.strictObject({
      role: z.enum(PERSON_ROLES).optional(),
      org: text.optional(),
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
    description: 'A meeting. Attendees are `attended_by` links to people.',
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
 * when this writes a new version of an existing object.
 * Rules: statuses must belong to the kind; reserved statuses can't be set directly; a bet needs a
 * hypothesis and kill criteria; a concluded idea stays concluded.
 */
export function checkKindFields(
  kind: Kind,
  input: { status?: string | null | undefined; attrs?: Record<string, unknown> | undefined },
  previous?: { status: string | null },
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

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { status, attrs } };
}
