import { z } from 'zod';
import { IdSchema, ScopeSlugSchema } from '../model/ids.js';
import { COMMITMENT_STATUSES } from '../model/kinds.js';
import { AltitudeSchema } from '../model/layers.js';
import { defineOp } from './define.js';
import { WrittenSchema } from './shapes.js';

/* commitments.*: owned by @bousleh/vault. A commitment is an object of kind `commitment`; who owes it and to whom are links. */

/** A person on the other end of an owed_by or owed_to link. */
export const PersonRefSchema = z.object({
  id: IdSchema,
  name: z.string(),
});

/** One commitment as commitments.list and people.get show it. */
export const CommitmentViewSchema = z.object({
  id: IdSchema,
  title: z.string(),
  status: z.enum(COMMITMENT_STATUSES),
  altitude: AltitudeSchema,
  due: z.iso.date().nullable(),
  scopes: z.array(ScopeSlugSchema),
  owed_by: z.array(PersonRefSchema),
  owed_to: z.array(PersonRefSchema),
});
export type CommitmentView = z.output<typeof CommitmentViewSchema>;

export const commitmentsList = defineOp({
  name: 'commitments.list',
  description:
    'List commitments: things someone owes someone. Defaults to open ones; pass status done, dropped or any for the others. Filter by who owes it (owed_by, a person id), who it is owed to (owed_to, a person id), a scope slug, and due_before (a date, YYYY-MM-DD: keeps commitments due on or before that date and leaves out those with no due date). Soonest due first; commitments with no due date come last. Each one names who owes it and to whom.',
  input: z.object({
    status: z.enum([...COMMITMENT_STATUSES, 'any']).default('open'),
    owed_by: IdSchema.optional(),
    owed_to: IdSchema.optional(),
    scope: ScopeSlugSchema.optional(),
    due_before: z.iso.date().optional(),
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

export const commitmentOps = {
  'commitments.list': commitmentsList,
  'commitments.close': commitmentsClose,
} as const;
