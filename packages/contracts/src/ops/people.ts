import { z } from 'zod';
import { IdSchema, ScopeSlugSchema } from '../model/ids.js';
import { KindSchema, PERSON_ROLES } from '../model/kinds.js';
import { LayerSchema } from '../model/layers.js';
import { LinkKindSchema } from '../model/links.js';
import { CommitmentViewSchema, PersonRefSchema } from './commitments.js';
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

export const PersonRoleSchema = z.enum(PERSON_ROLES);

/** An open commitment as people.list shows it: enough to name it. */
export const CommitmentRefSchema = z.object({ id: IdSchema, title: z.string(), due: z.iso.date().nullable() });

/** The latest moment Wassim was in touch with someone, as far as the data shows. */
export const TouchpointSchema = z.object({
  /** A held meeting's held_at as stored (a date or a date-time), or when the object about them was filed. */
  at: z.string(),
  /** attended: a held meeting they attended. about: the newest object linked about them. */
  via: z.enum(['attended', 'about']),
  object: z.object({ id: IdSchema, kind: KindSchema, title: z.string() }),
});
export type Touchpoint = z.output<typeof TouchpointSchema>;

export const PersonSummarySchema = z.object({
  id: IdSchema,
  name: z.string(),
  role: PersonRoleSchema.nullable(),
  org: z.string().nullable(),
  scopes: z.array(ScopeSlugSchema),
  /** True for the person this Bousleh belongs to. */
  is_user: z.boolean(),
  /** Who they report to; null when not known. */
  reports_to: PersonRefSchema.nullable(),
  commitments: z.object({
    /** Open commitments they owe, soonest due first. */
    owes: z.array(CommitmentRefSchema),
    /** Open commitments owed to them, soonest due first. */
    owed: z.array(CommitmentRefSchema),
  }),
  /** The later of the newest held meeting they attended and the newest object linked about them; null when there is neither. */
  last_touchpoint: TouchpointSchema.nullable(),
});
export type PersonSummary = z.output<typeof PersonSummarySchema>;

export const peopleList = defineOp({
  name: 'people.list',
  description: [
    'List people, by name, each with role, org, who they report to, the open commitments they owe and are owed, and last_touchpoint: the later of the newest held meeting they attended and the newest object linked about them (a growth note, an observation, a signal…). Use it for "how are my PMs doing?" (role pm), to see who has gone quiet, or to map who reports to whom; then people.get on one id for everything about them.',
    'role is one role or a list (stakeholder, pm, engineer, analyst, other). org matches the org exactly, ignoring case. scopes (slugs) includes child scopes: a person is in a scope when they belong to it, or, for people with no scope of their own, when something linked to them is in it.',
  ].join(' '),
  input: z.object({
    role: z.union([PersonRoleSchema, z.array(PersonRoleSchema).min(1)]).optional(),
    scopes: z.array(ScopeSlugSchema).optional().describe('Only people in these scopes or their child scopes. Default: everyone.'),
    org: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.object({
    people: z.array(PersonSummarySchema),
    /** People beyond limit. */
    more: z.number().int().min(0),
  }),
  readOnly: true,
});

export const peopleOps = {
  'people.get': peopleGet,
  'people.list': peopleList,
} as const;
