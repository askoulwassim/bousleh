import { z } from 'zod';
import { IdSchema } from '../model/ids.js';
import { KindSchema } from '../model/kinds.js';
import { defineOp, NoInput } from './define.js';
import { depositsWrite } from './deposits.js';
import { InboxOutcomeSchema, InboxSourceSchema, Sha256Schema } from './inbox.js';
import { WrittenSchema } from './shapes.js';

/*
 * queue.*: owned by @bousleh/intake. The ambiguity queue: deposits Capture couldn't place.
 * A queued item is not an object; it becomes one only when it is resolved by filing it.
 */

const deposit = depositsWrite.input.shape;

/**
 * A deposits.write input where every field may be missing, and nothing defaults: an item is often
 * queued exactly because a field (altitude, scope, kind) is unknown.
 */
export const DepositDraftSchema = z.object({
  kind: deposit.kind.optional(),
  title: deposit.title.optional(),
  altitude: deposit.altitude.optional(),
  scopes: deposit.scopes.unwrap().optional(),
  status: deposit.status,
  attrs: deposit.attrs,
  body: deposit.body.unwrap().optional(),
  links: deposit.links.unwrap().optional(),
});
export type DepositDraft = z.output<typeof DepositDraftSchema>;

const isoDateTime = z.iso.datetime({ offset: true });

/** One queued item, as queue.list returns it. */
export const QueueItemSchema = z.object({
  id: IdSchema,
  draft: DepositDraftSchema,
  reason: z.string(),
  /** Existing objects it might belong to or duplicate, with their current titles. */
  candidates: z.array(z.object({ id: IdSchema, kind: KindSchema, title: z.string() })),
  /** The inbox file it came from, if any. */
  source: z
    .object({
      sha256: Sha256Schema,
      source: InboxSourceSchema,
      name: z.string(),
      outcome: InboxOutcomeSchema,
      processed_path: z.string().nullable(),
    })
    .nullable(),
  created_at: isoDateTime,
});
export type QueueItem = z.output<typeof QueueItemSchema>;

export const queueAdd = defineOp({
  name: 'queue.add',
  description:
    'Queue a deposit you cannot place with confidence, instead of guessing. Give the draft (the deposits.write input as far as you know it; any field may be missing), the reason it is ambiguous, optionally the ids of existing objects it might belong to or duplicate, and the sha256 of the inbox file it came from. A queued item is not an object until queue.resolve files it. If the source file is still waiting in the inbox, this also settles it as queued; if the file produced objects too, settle it as filed with inbox.settle first.',
  input: z.object({
    draft: DepositDraftSchema,
    reason: z.string().trim().min(1).max(1000),
    candidates: z.array(IdSchema).default([]),
    source_sha256: Sha256Schema.optional(),
  }),
  output: z.object({
    id: IdSchema,
    created_at: isoDateTime,
    /** True when this call also settled the source file as queued. */
    settled_source: z.boolean(),
  }),
});

export const queueList = defineOp({
  name: 'queue.list',
  description:
    'List the open items in the ambiguity queue, oldest first: each draft, why it was queued, the candidate objects it might belong to (with titles) and the inbox file it came from. Read-only. Settle each one with queue.resolve.',
  input: NoInput,
  output: z.object({ items: z.array(QueueItemSchema) }),
  readOnly: true,
});

export const queueResolve = defineOp({
  name: 'queue.resolve',
  description:
    "Settle one queued item. action file writes it as an object through deposits.write: the draft with any overrides applied on top (each field you pass in overrides replaces the draft's), so supply whatever was missing, such as the altitude or a scope. action discard drops it without writing an object. Either way the decision is recorded and the item leaves the queue. Add a note saying why, especially when discarding.",
  input: z.object({
    id: IdSchema,
    action: z.enum(['file', 'discard']),
    overrides: DepositDraftSchema.optional(),
    note: z.string().trim().min(1).max(1000).optional(),
  }),
  output: z.object({
    id: IdSchema,
    action: z.enum(['file', 'discard']),
    /** The object written, when the item was filed. */
    object: WrittenSchema.nullable(),
  }),
});

export const queueOps = {
  'queue.add': queueAdd,
  'queue.list': queueList,
  'queue.resolve': queueResolve,
} as const;
