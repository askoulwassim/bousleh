import { z } from 'zod';
import { IdSchema, ScopeSlugSchema } from '../model/ids.js';
import { KindSchema, PERSON_ROLES } from '../model/kinds.js';
import { LayerSchema } from '../model/layers.js';
import { LinkKindSchema } from '../model/links.js';
import { CommitmentViewSchema } from './commitments.js';
import { defineOp } from './define.js';

/* people.*: owned by @bousleh/vault. A person is an object of kind `person`; everything about them hangs off links. */

const isoDateTime = z.iso.datetime({ offset: true });

export const GrowthNoteViewSchema = z.object({
  id: IdSchema,
  title: z.string(),
  body: z.string(),
  scopes: z.array(ScopeSlugSchema),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});

/** An object linked to a person, as people.get lists it. */
export const LinkedObjectSchema = z.object({
  id: IdSchema,
  kind: KindSchema,
  layer: LayerSchema,
  title: z.string(),
  status: z.string().nullable(),
  /** How the object is tied to the person: each link kind, and whether it points at the person (in) or from them (out). */
  links: z.array(z.object({ kind: LinkKindSchema, direction: z.enum(['in', 'out']) })),
  /** The later of the newest link and the object's current version. */
  last_activity: isoDateTime,
});

export const peopleGet = defineOp({
  name: 'people.get',
  description:
    'Everything kept about one person, by their per_ id: name, role, org, scopes and notes; their growth notes (coaching entries linked to them with about), newest first; the open commitments they owe and the open commitments owed to them; and the other objects most recently linked to them (meetings, decisions, signals and so on), newest first. To find a person id by name, use vault.search with kinds [person].',
  input: z.object({
    id: IdSchema,
    recent: z.number().int().min(0).max(50).default(10).describe('How many recently linked objects to return.'),
  }),
  output: z.object({
    person: z.object({
      id: IdSchema,
      name: z.string(),
      role: z.enum(PERSON_ROLES).nullable(),
      org: z.string().nullable(),
      scopes: z.array(ScopeSlugSchema),
      body: z.string(),
      created_at: isoDateTime,
      updated_at: isoDateTime,
    }),
    growth_notes: z.array(GrowthNoteViewSchema),
    commitments: z.object({
      /** Open commitments this person owes. */
      owes: z.array(CommitmentViewSchema),
      /** Open commitments owed to this person. */
      owed: z.array(CommitmentViewSchema),
    }),
    /** Other objects linked to the person, newest activity first. The growth notes and open commitments above are left out. */
    recent: z.array(LinkedObjectSchema),
  }),
  readOnly: true,
});

export const peopleOps = {
  'people.get': peopleGet,
} as const;
