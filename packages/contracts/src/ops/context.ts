import { z } from 'zod';
import { IdSchema, SCOPE_KINDS, ScopeSlugSchema } from '../model/ids.js';
import {
  CONCLUDABLE_IDEA_STATUSES,
  INITIATIVE_STATUSES,
  KindSchema,
  MEETING_STATUSES,
  METRIC_STATUSES,
  PERSON_ROLES,
  PROBLEM_STATUSES,
  STRATEGY_STATUSES,
} from '../model/kinds.js';
import { AltitudeSchema, LAYERS, type Layer, LayerSchema } from '../model/layers.js';
import { AssetTypeSchema } from './assets.js';
import { CommitmentSizeSchema, CommitmentViewSchema, PersonRefSchema } from './commitments.js';
import { defineOp } from './define.js';
import { MetricCadenceSchema } from './metrics.js';
import { PersonRoleSchema, TouchpointSchema } from './people.js';
import { ObjectRefSchema } from './shapes.js';

/*
 * context.* and pulse.*: owned by @bousleh/context. Both only read: they assemble what other ops
 * keep (vault.search, commitments.list, metrics.list, watch.digest, inbox.list, queue.list) into
 * one picture, so a skill makes one call instead of ten.
 */

const isoDateTime = z.iso.datetime({ offset: true });

/** A reading as briefs show it: just the number and when. */
export const ReadingRefSchema = z.object({
  value: z.number(),
  unit: z.string().nullable(),
  /** A date (2026-10-25) or a UTC date-time. */
  observed_at: z.string(),
});

// ---------------------------------------------------------------- context.brief

/** One object in a brief: enough to reason with. vault.get on its id gives the rest. */
export const BriefRefSchema = z.object({
  id: IdSchema,
  kind: KindSchema,
  title: z.string(),
  altitude: AltitudeSchema,
  status: z.string().nullable(),
  scopes: z.array(ScopeSlugSchema),
  /** The start of the body, or for a search match the words around it with matched words in **. Absent when there is nothing useful. */
  snippet: z.string().optional(),
  /** Why it is in the brief, most important first: "asked for", "matches focus", "linked to \"X\" (evidence_for)", "anchor of scope y"… */
  why: z.array(z.string()).min(1),
});
export type BriefRef = z.output<typeof BriefRefSchema>;

/** An initiative. status is never null: an initiative written before initiatives had statuses reads as active. */
export const BriefInitiativeSchema = BriefRefSchema.extend({
  status: z.enum(INITIATIVE_STATUSES),
  started_at: z.iso.date().nullable(),
  target_date: z.iso.date().nullable(),
  /** The person it is owned_by; null when no owner is linked. */
  owner: PersonRefSchema.nullable(),
});
/** A problem. status is never null: a problem written before problems had statuses reads as open. */
export const BriefProblemSchema = BriefRefSchema.extend({
  status: z.enum(PROBLEM_STATUSES),
});
export const BriefIdeaSchema = BriefRefSchema.extend({
  hypothesis: z.string().nullable(),
  kill_criteria: z.string().nullable(),
  /** Its rank among ideas, 1 the top; null when unranked. */
  rank: z.number().int().min(1).nullable(),
});
export const BriefDecisionSchema = BriefRefSchema.extend({
  decided_at: z.iso.date().nullable(),
  reversible: z.boolean().nullable(),
});
export const BriefMetricSchema = BriefRefSchema.extend({
  cadence: MetricCadenceSchema.nullable(),
  unit: z.string().nullable(),
  latest_reading: ReadingRefSchema.nullable(),
});
export const BriefPersonSchema = BriefRefSchema.extend({
  role: z.enum(PERSON_ROLES).nullable(),
  org: z.string().nullable(),
  /** Who they report to (their reports_to link); null when not known. */
  reports_to: PersonRefSchema.nullable(),
});
export const BriefCommitmentSchema = BriefRefSchema.extend({
  due: z.iso.date().nullable(),
  /** major (a deliverable) or minor (a small follow-up). */
  size: CommitmentSizeSchema,
  owed_by: z.array(PersonRefSchema),
  owed_to: z.array(PersonRefSchema),
});
export const BriefEvidenceSchema = BriefRefSchema.extend({
  url: z.string().nullable(),
  published_at: z.string().nullable(),
  /** When it was filed. */
  filed_at: isoDateTime,
});

/** An asset (a Doc, deck, dashboard, whiteboard, design, page, repo or file) with its link. */
export const BriefAssetSchema = BriefRefSchema.extend({
  url: z.string(),
  type: AssetTypeSchema,
});

export const BRIEF_SECTIONS = [
  'anchors',
  'initiatives',
  'problems',
  'ideas',
  'decisions',
  'metrics',
  'people',
  'commitments',
  'evidence',
  'assets',
] as const;
export type BriefSection = (typeof BRIEF_SECTIONS)[number];

const sectionCounts = z.object(
  Object.fromEntries(BRIEF_SECTIONS.map((section) => [section, z.number().int().min(0)])) as Record<BriefSection, z.ZodNumber>,
);

export const contextBrief = defineOp({
  name: 'context.brief',
  description: [
    'What to know before advising at a given altitude, in one call. Call it before giving advice, shaping a problem or idea, running a workshop, drafting a message or coaching someone, then use vault.get or people.get on any id for the full object.',
    'Centre it with focus (the question or topic in plain words; its best search matches become the centre) and/or ids (objects to centre on, such as a problem, an idea or a person). Everything linked one hop out from the centre is included, with why. With neither, or when focus matches nothing, the brief covers the scopes as a whole: initiatives not done or dropped, open problems (solved and dropped ones only show in the centre or one hop out), open, running and bet ideas, recent decisions, metrics and open commitments.',
    'scopes (slugs) narrows it, and includes their child scopes. altitude is the level you are advising at (50000 company, 10000 cross-team, the default, 1000 own surfaces, 100 one engineer or requirement): items one level above and below are shown too, and anchors (strategies and principles) from every level above, including those of parent scopes.',
    'Sections: anchors; initiatives in the centre or one hop out (or, with no centre, those in the scopes), each with its status (proposed, active, paused, done, dropped), started_at, target_date and owner; problems, each with its status (open, solved, dropped), open first; ideas (bets first, with hypothesis and kill criteria, then running ones, being tried right now, then the rest, each status by rank); decisions (newest first); metrics with their latest reading; people involved (owners, attendees, who owes and is owed what), each with who they report to; open commitments, each with its size (major or minor); recent evidence and findings linked to the rest; assets (Docs, decks, dashboards, whiteboards, designs, pages, repos) with their url and type: those that document anything in the brief, or with no centre every asset in the scopes, at any altitude. Objects replaced by another (supersedes) are left out. limit caps each section; more says how many were cut.',
  ].join(' '),
  input: z.object({
    focus: z.string().trim().min(1).max(500).optional().describe('The question or topic, in plain words. Searched like vault.search.'),
    ids: z.array(IdSchema).max(20).optional().describe('Objects to centre the brief on. Always included, whatever their altitude.'),
    scopes: z.array(ScopeSlugSchema).optional().describe('Only these scopes and their child scopes. Default: every scope.'),
    altitude: AltitudeSchema.default(10000),
    limit: z.number().int().min(1).max(50).default(8).describe('Most items per section.'),
  }),
  output: z.object({
    altitude: AltitudeSchema,
    /** The altitudes shown outside anchors: the one asked for, one above and one below. */
    altitudes: z.array(AltitudeSchema),
    /** The scopes covered, child scopes included. Empty: every scope. */
    scopes: z.array(ScopeSlugSchema),
    /** What the brief is centred on. Empty: the brief covers the scopes as a whole. */
    centre: z.array(z.object({ id: IdSchema, kind: KindSchema, title: z.string(), why: z.string() })),
    /** How focus matched (as vault.search reports it); null when there was no focus or nothing matched. */
    match: z.enum(['all', 'any']).nullable(),
    anchors: z.array(BriefRefSchema),
    initiatives: z.array(BriefInitiativeSchema),
    problems: z.array(BriefProblemSchema),
    ideas: z.array(BriefIdeaSchema),
    decisions: z.array(BriefDecisionSchema),
    metrics: z.array(BriefMetricSchema),
    people: z.array(BriefPersonSchema),
    commitments: z.array(BriefCommitmentSchema),
    evidence: z.array(BriefEvidenceSchema),
    assets: z.array(BriefAssetSchema),
    /** How many more items each section had beyond limit. */
    more: sectionCounts,
  }),
  readOnly: true,
});

// ---------------------------------------------------------------- pulse.today

/** A commitment in Pulse: as commitments.list shows it, plus how late it is. */
export const PulseCommitmentSchema = CommitmentViewSchema.extend({
  /** Days past due: 0 when due today. */
  days_late: z.number().int().min(0),
});

/** Commitments split by direction, relative to me. */
export const PulseCommitmentGroupSchema = z.object({
  /** Owed by me. */
  by_me: z.array(PulseCommitmentSchema),
  /** Owed to me. */
  to_me: z.array(PulseCommitmentSchema),
  /** Between other people, or with no one linked (and everything when me is unknown). */
  other: z.array(PulseCommitmentSchema),
});

/** An open commitment with no due date: as commitments.list shows it, plus when it was filed. */
export const PulseUndatedCommitmentSchema = CommitmentViewSchema.extend({
  /** When the commitment was filed (its first version). */
  filed_at: isoDateTime,
});

/** Pulse lists at most this many open commitments with no due date on each side (by me, to me). */
export const NO_DUE_LIMIT = 10;

/** Pulse lists a stakeholder, PM or engineer under touchpoints_due when the last touchpoint is more than this many days old. */
export const TOUCHPOINT_DUE_DAYS = 14;

/** pulse.today ranks at most this many items in focus. */
export const FOCUS_LIMIT = 3;

/** One thing Pulse puts first: a commitment or a planned meeting, scored by the engine. */
export const FocusItemSchema = z.object({
  kind: z.enum(['commitment', 'meeting']),
  id: IdSchema,
  title: z.string(),
  altitude: AltitudeSchema,
  scopes: z.array(ScopeSlugSchema),
  /** Higher first. The weights are in @bousleh/context (FOCUS_WEIGHTS); the number is only for ordering. */
  score: z.number(),
  /** Short reasons, most important first, ready to say out loud: "2 days late", "owed to Peter, your manager", "you see Peter today". */
  why: z.array(z.string()).min(1),
  /** A commitment's direction relative to me; null for a meeting. */
  owed: z.enum(['by_me', 'to_me']).nullable(),
  /** A commitment's size (major or minor); null for a meeting. */
  size: CommitmentSizeSchema.nullable(),
  /** The other side of a commitment (who it is owed to, or who owes it), or a meeting's attendees other than me. */
  people: z.array(PersonRefSchema),
  /** A commitment's effective due day (due, else surface_on); a meeting's held_at. Null for an undated commitment. */
  when: z.string().nullable(),
});

export const pulseToday = defineOp({
  name: 'pulse.today',
  description: [
    "The daily picture for Pulse and Home, for one day (date, default today on this machine's clock).",
    `focus: at most ${FOCUS_LIMIT} things to do first, ranked by the engine: open commitments owed by me (overdue, due today, due in the next two days, back from a snooze, or undated for over a week) and owed to me (overdue, or back from a snooze: a follow-up), and today's planned meetings. The score weighs how late, how soon, how senior the other person is (my manager, a stakeholder), whether I see them today, whether it is part of a bet or running idea, and the altitude, and puts a minor commitment (a small follow-up) below an equally late major one; an undated minor commitment is never a candidate. why gives the reasons in words. focus_more counts the candidates past the limit.`,
    `commitments: open ones overdue and due that day, each split into owed by me, owed to me and other; open major ones with no due date (no_due), owed by me and owed to me, oldest filed first, at most ${NO_DUE_LIMIT} a side with more counting the rest, and no_due.minor counting the undated minor ones (small follow-ups) a side; every commitment carries its size (major or minor), and overdue and due_today list both sizes; plus counts of every open commitment by direction. Snoozed commitments (surface_on after the date) are left out of all of these and only counted under snoozed, with the next one to surface; once surface_on comes, a commitment counts as due on its due date, else on surface_on. me is the person marked is_user (the person this Bousleh belongs to); pass me to override. With neither, the person on the most open commitments is taken as me, and me.inferred says so.`,
    'meetings: meetings filed in Bousleh on that day (by their held_at), planned or held, with attendees. Bousleh keeps only meetings with prep or notes, not the schedule: read the calendar for the rest of the day and merge. inbox: files waiting for Capture and open items in the ambiguity queue. stale_metrics: metrics in use (instrumented, measured or reviewed) with no reading within their cadence (daily 1 day, weekly 7, monthly 31, quarterly 92; 30 days when they have no cadence). new_findings: Horizon findings filed since the start of the day before. open_bets: ideas that are bets or running (being tried right now: an experiment under way, a build in progress), each with its status, bets first, with hypothesis and kill criteria (a running idea may have neither).',
    'metric_movement: metrics with at least two readings whose last change is not zero, with the latest and previous readings and the delta, most recently read first.',
    `touchpoints_due: the stakeholders, PMs and engineers (not me) whose last touchpoint (the newest held meeting they attended, or the newest object linked about them) is more than ${TOUCHPOINT_DUE_DAYS} days before the date, or who have none; never touched first, then the longest ago.`,
    'scopes (slugs, child scopes included) narrows everything except the inbox and the queue, which have no scope. Read-only.',
  ].join(' '),
  input: z.object({
    date: z.iso.date().optional().describe("The day, YYYY-MM-DD. Default: today on this machine's clock."),
    scopes: z.array(ScopeSlugSchema).optional().describe('Only these scopes and their child scopes. Default: every scope.'),
    me: IdSchema.optional().describe('A person id (per_…) to treat as me. Default: the person marked is_user.'),
  }),
  output: z.object({
    date: z.iso.date(),
    /** The scopes covered, child scopes included. Empty: every scope. */
    scopes: z.array(ScopeSlugSchema),
    /** Who "me" is. inferred: taken as the person on the most open commitments, because me was not given. Null when unknown. */
    me: PersonRefSchema.extend({ inferred: z.boolean() }).nullable(),
    commitments: z.object({
      /** Open and due before the date, most overdue first. */
      overdue: PulseCommitmentGroupSchema,
      /** Open and due on the date. */
      due_today: PulseCommitmentGroupSchema,
      /** Major, open, with no due date, owed by me or to me (not between other people), oldest filed first. */
      no_due: z.object({
        by_me: z.array(PulseUndatedCommitmentSchema),
        to_me: z.array(PulseUndatedCommitmentSchema),
        /** How many more major ones each side had beyond the ones listed. */
        more: z.object({ by_me: z.number().int().min(0), to_me: z.number().int().min(0) }),
        /** Nov 20: undated minor commitments (small follow-ups), only counted: "plus 4 small follow-ups". */
        minor: z.object({ by_me: z.number().int().min(0), to_me: z.number().int().min(0) }),
      }),
      /** Every open commitment in scope that is not snoozed, counted by direction. */
      open: z.object({ by_me: z.number().int().min(0), to_me: z.number().int().min(0), other: z.number().int().min(0) }),
      /** Open commitments snoozed past the date (surface_on later), counted by direction, and the next one to surface. */
      snoozed: z.object({
        by_me: z.number().int().min(0),
        to_me: z.number().int().min(0),
        other: z.number().int().min(0),
        next: z.object({ id: IdSchema, title: z.string(), surface_on: z.iso.date() }).nullable(),
      }),
    }),
    /** The few things to do first, highest score first. */
    focus: z.array(FocusItemSchema).max(FOCUS_LIMIT),
    /** Candidates for focus past the limit. */
    focus_more: z.number().int().min(0),
    meetings: z.array(
      z.object({
        id: IdSchema,
        title: z.string(),
        /** As stored: a date, or a date-time. */
        held_at: z.string(),
        /** planned: coming up (its prep is in the body); held: it happened. */
        status: z.enum(MEETING_STATUSES),
        altitude: AltitudeSchema,
        scopes: z.array(ScopeSlugSchema),
        attendees: z.array(PersonRefSchema),
      }),
    ),
    inbox: z.object({
      /** Files waiting in the local inbox (inbox.list). Files still in the Drive folder count once inbox.sweep brings them in. */
      waiting: z.number().int().min(0),
      oldest_arrived_at: isoDateTime.nullable(),
      /** Open items in the ambiguity queue (queue.list). */
      queued: z.number().int().min(0),
    }),
    stale_metrics: z.array(
      z.object({
        id: IdSchema,
        title: z.string(),
        status: z.enum(METRIC_STATUSES),
        altitude: AltitudeSchema,
        scopes: z.array(ScopeSlugSchema),
        cadence: MetricCadenceSchema.nullable(),
        /** A reading was expected at least this often, in days. */
        expected_within_days: z.number().int().min(1),
        latest_reading: ReadingRefSchema.nullable(),
        /** Days from the latest reading to the date; null when there has never been one. */
        days_since: z.number().int().nullable(),
        owner: ObjectRefSchema.nullable(),
      }),
    ),
    new_findings: z.object({
      /** Findings filed from this moment (the start of the day before) up to the end of the date. */
      since: isoDateTime,
      total: z.number().int().min(0),
      findings: z.array(
        z.object({
          id: IdSchema,
          title: z.string(),
          url: z.string(),
          published_at: z.string().nullable(),
          filed_at: isoDateTime,
          watch_list: ObjectRefSchema.nullable(),
          summary: z.string(),
        }),
      ),
    }),
    metric_movement: z.array(
      z.object({
        id: IdSchema,
        title: z.string(),
        status: z.enum(METRIC_STATUSES),
        altitude: AltitudeSchema,
        scopes: z.array(ScopeSlugSchema),
        cadence: MetricCadenceSchema.nullable(),
        unit: z.string().nullable(),
        latest_reading: ReadingRefSchema,
        previous_reading: ReadingRefSchema,
        /** Latest minus previous. Never zero. */
        delta: z.number(),
        owner: ObjectRefSchema.nullable(),
      }),
    ),
    touchpoints_due: z.array(
      z.object({
        id: IdSchema,
        name: z.string(),
        role: PersonRoleSchema,
        org: z.string().nullable(),
        last_touchpoint: TouchpointSchema.nullable(),
        /** Days from the last touchpoint to the date; null when there has never been one. */
        days_since: z.number().int().nullable(),
      }),
    ),
    open_bets: z.array(
      z.object({
        id: IdSchema,
        title: z.string(),
        /** bet, or running: being tried right now. */
        status: z.enum(CONCLUDABLE_IDEA_STATUSES),
        altitude: AltitudeSchema,
        scopes: z.array(ScopeSlugSchema),
        hypothesis: z.string().nullable(),
        kill_criteria: z.string().nullable(),
        /** When its current version was written. */
        updated_at: isoDateTime,
      }),
    ),
  }),
  readOnly: true,
});

// ---------------------------------------------------------------- context.strata

/** context.strata puts at most this many objects in a cell unless per_cell says otherwise. */
export const STRATA_PER_CELL = 6;

/** Held meetings older than this many days (before the date) are left out of the strata. */
export const STRATA_HELD_MEETING_DAYS = 14;

/** One object in a strata cell: enough to draw it. vault.get on its id gives the rest. */
export const StrataObjectSchema = z.object({
  id: IdSchema,
  kind: KindSchema,
  layer: LayerSchema,
  title: z.string(),
  /** The status it reads as: objects written before their kind had statuses get the kind's default. Null for kinds with no status. */
  status: z.string().nullable(),
  altitude: AltitudeSchema,
  scopes: z.array(ScopeSlugSchema),
  /** True when it needs Wassim now: an open commitment he owes that is overdue, due on the date or (a major one only) has no due date, or any commitment back from a snooze (a follow-up). An undated minor commitment never needs him. */
  needs_you: z.boolean(),
  /** When it is updated: its current version's time. */
  updated_at: isoDateTime,
  /** An idea's rank among ideas, 1 the top. */
  rank: z.number().int().min(1).optional(),
  /** A commitment's due date; null when it has none. */
  due: z.iso.date().nullable().optional(),
  /** A commitment back from a snooze: the day it surfaced. Snoozed commitments are not in the strata at all. */
  surface_on: z.iso.date().optional(),
  /** A commitment's size: major (a deliverable) or minor (a small follow-up). */
  size: CommitmentSizeSchema.optional(),
  /** A commitment's direction relative to me: owed by me, owed to me, or other. */
  owed: z.enum(['by_me', 'to_me', 'other']).optional(),
  /** A meeting's held_at, as stored (a date or a date-time). */
  held_at: z.string().optional(),
  /** A bet or running idea: when it entered its current status (the first version of the run of versions with that status). */
  since: isoDateTime.optional(),
  /** A bet's hypothesis and kill criteria, when it has them. */
  hypothesis: z.string().optional(),
  kill_criteria: z.string().optional(),
  /** A person's role. */
  role: z.enum(PERSON_ROLES).optional(),
  /** A person's last touchpoint (as people.list reports it). */
  last_touchpoint: z.string().optional(),
  /** A watch list's entry count, and how many of its findings are still new. */
  entries: z.number().int().min(0).optional(),
  new_findings: z.number().int().min(0).optional(),
  /** A finding's url. */
  url: z.string().optional(),
});
export type StrataObject = z.output<typeof StrataObjectSchema>;

/** Objects per layer. */
const layerCounts = z.object(Object.fromEntries(LAYERS.map((layer) => [layer, z.number().int().min(0)])) as Record<Layer, z.ZodNumber>);

export const contextStrata = defineOp({
  name: 'context.strata',
  description: [
    'The whole cross-section in one call, for Home: altitude as rows (50000, 10000, 1000, 100) and scopes as columns. Each cell holds the live objects of that scope (child scopes included) at that altitude (commitments snoozed past the date are left out), needs-you first (open commitments owed by me that are overdue, due on the date or, for a major one, undated, and any commitment back from a snooze on or after its surface_on day; an undated minor commitment, a small follow-up, never needs you; each commitment carries its size), then bets, then what is moving (running ideas, active initiatives, planned meetings), then the newest.',
    'Left out, and counted as closed in each cell: done and dropped initiatives, solved and dropped problems, concluded and dropped ideas, done and dropped commitments, dismissed findings. Also left out: objects another object replaces, glossary terms, assets (counted per column instead), dumps, daily notes, growth notes, and meetings held more than 14 days before the date. An object in several scopes appears in each column. A person with no scope of their own is placed in the columns of the objects linked to them, as people.list does.',
    'scopes (slugs) picks the columns in that order; default: every top-level scope, oldest first. per_cell caps each cell (count and more say how many there are). date (default today) decides what is overdue. Read-only.',
  ].join(' '),
  input: z.object({
    scopes: z
      .array(ScopeSlugSchema)
      .min(1)
      .max(12)
      .optional()
      .describe('The columns, in order. Default: every top-level scope, oldest first.'),
    per_cell: z.number().int().min(1).max(50).default(STRATA_PER_CELL).describe('Most objects listed in one cell.'),
    date: z.iso.date().optional().describe("The day, YYYY-MM-DD. Default: today on this machine's clock."),
  }),
  output: z.object({
    date: z.iso.date(),
    /** The person marked is_user; null when nobody is, and then needs_you counts any open commitment overdue, due or (major) undated. */
    me: PersonRefSchema.nullable(),
    columns: z.array(
      z.object({
        slug: ScopeSlugSchema,
        name: z.string(),
        kind: z.enum(SCOPE_KINDS),
        /** The column's strategy (the highest, newest live one in the scope or its child scopes); null when it has none. */
        strategy: z.object({ id: IdSchema, title: z.string(), status: z.enum(STRATEGY_STATUSES) }).nullable(),
        /** Registered assets (Docs, decks, pages…) in the scope or its child scopes. */
        assets: z.number().int().min(0),
      }),
    ),
    rows: z.array(z.object({ altitude: AltitudeSchema, label: z.string() })),
    /** One per column and row, column by column, rows from 50000 down. */
    cells: z.array(
      z.object({
        scope: ScopeSlugSchema,
        altitude: AltitudeSchema,
        objects: z.array(StrataObjectSchema),
        /** Live objects in the cell. */
        count: z.number().int().min(0),
        /** Live objects beyond per_cell. */
        more: z.number().int().min(0),
        /** Objects left out as closed (done, dropped, solved, concluded, dismissed). */
        closed: z.number().int().min(0),
        /** Live objects in the cell by kind, the ones beyond per_cell included. */
        kinds: z.record(z.string(), z.number().int().min(1)),
      }),
    ),
    totals: z.object({
      /** Distinct live objects in the grid, per layer. */
      layers: layerCounts,
      /** Distinct objects that need you. */
      needs_you: z.number().int().min(0),
      /** Cells with no live object. */
      empty_cells: z.number().int().min(0),
      /** Distinct objects left out as closed. */
      closed: z.number().int().min(0),
    }),
  }),
  readOnly: true,
});

export const contextOps = {
  'context.brief': contextBrief,
  'context.strata': contextStrata,
  'pulse.today': pulseToday,
} as const;
