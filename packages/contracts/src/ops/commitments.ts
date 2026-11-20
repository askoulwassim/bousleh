import { z } from 'zod';
import { IdSchema, ScopeSlugSchema } from '../model/ids.js';
import { COMMITMENT_SIZES, COMMITMENT_STATUSES } from '../model/kinds.js';
import { AltitudeSchema } from '../model/layers.js';
import { defineOp } from './define.js';
import { WrittenSchema } from './shapes.js';

/* commitments.*: owned by @bousleh/vault. A commitment is an object of kind `commitment`; who owes it and to whom are links. */

/** A person on the other end of an owed_by or owed_to link. */
export const PersonRefSchema = z.object({
  id: IdSchema,
  name: z.string(),
});

/** major: a real deliverable; minor: a small follow-up. */
export const CommitmentSizeSchema = z.enum(COMMITMENT_SIZES);

/** One commitment as commitments.list and people.get show it. */
export const CommitmentViewSchema = z.object({
  id: IdSchema,
  title: z.string(),
  status: z.enum(COMMITMENT_STATUSES),
  altitude: AltitudeSchema,
  due: z.iso.date().nullable(),
  /** Snoozed until this day (YYYY-MM-DD): before it, Pulse, Home and the strata leave the commitment out. Null when not snoozed. */
  surface_on: z.iso.date().nullable(),
  /** major (a deliverable) or minor (a small follow-up). A commitment filed without a size reads as major. */
  size: CommitmentSizeSchema,
  scopes: z.array(ScopeSlugSchema),
  owed_by: z.array(PersonRefSchema),
  owed_to: z.array(PersonRefSchema),
});
export type CommitmentView = z.output<typeof CommitmentViewSchema>;

export const commitmentsList = defineOp({
  name: 'commitments.list',
  description:
    'List commitments: things someone owes someone. Defaults to open ones; pass status done, dropped or any for the others. Filter by who owes it (owed_by, a person id), who it is owed to (owed_to, a person id), a scope slug (scopes below it count too), and due_before (a date, YYYY-MM-DD: keeps commitments due on or before that date and leaves out those with no due date). snoozed decides what happens to commitments snoozed past as_of (default today): include them (the default), exclude them, or list only them. Soonest due first; commitments with no due date come last. size keeps only major ones (real deliverables) or only minor ones (small follow-ups); a commitment filed without a size counts as major. Each one names who owes it and to whom, its size, and surface_on when it is snoozed.',
  input: z.object({
    status: z.enum([...COMMITMENT_STATUSES, 'any']).default('open'),
    owed_by: IdSchema.optional(),
    owed_to: IdSchema.optional(),
    scope: ScopeSlugSchema.optional(),
    due_before: z.iso.date().optional(),
    snoozed: z.enum(['include', 'exclude', 'only']).default('include'),
    size: CommitmentSizeSchema.optional().describe('Only major (deliverables) or only minor (small follow-ups). Default: both.'),
    as_of: z.iso.date().optional().describe("The day snoozed is judged on, YYYY-MM-DD. Default: today on this machine's clock."),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.object({ commitments: z.array(CommitmentViewSchema) }),
  readOnly: true,
});

export const commitmentsClose = defineOp({
  name: 'commitments.close',
  description:
    'Close an open commitment as done or dropped, with an optional note on how it ended. The note is added to the end of the commitment body with the date. This writes a new version, and the open version stays in history. A commitment that is already done or dropped cannot be closed again.',
  input: z.object({
    id: IdSchema,
    status: z.enum(['done', 'dropped']),
    note: z.string().trim().min(1).optional(),
  }),
  output: WrittenSchema.extend({ supersedes: IdSchema, status: z.enum(['done', 'dropped']) }),
});

export const commitmentsSnooze = defineOp({
  name: 'commitments.snooze',
  description:
    'Snooze an open commitment until a day (until, YYYY-MM-DD, today or later): until then it stays out of Pulse, Home\'s needs-you count and the strata, and on that day it shows up as due (a follow-up). Use it for "remind me in a week if Ian hasn\'t replied" or "snooze that till Monday". Pass until: null to wake it now. An optional note is added to the end of the body with the date. Writes a new version; the old one stays in history. Its due date, if it has one, is kept.',
  input: z.object({
    id: IdSchema,
    until: z.iso.date().nullable(),
    note: z.string().trim().min(1).optional(),
  }),
  output: WrittenSchema.extend({ supersedes: IdSchema, surface_on: z.iso.date().nullable() }),
});

export const commitmentOps = {
  'commitments.list': commitmentsList,
  'commitments.close': commitmentsClose,
  'commitments.snooze': commitmentsSnooze,
} as const;
