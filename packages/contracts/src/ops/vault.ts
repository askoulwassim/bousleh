import { z } from 'zod';
import { IdSchema, ScopeSlugSchema } from '../model/ids.js';
import { KindSchema } from '../model/kinds.js';
import { AltitudeSchema, LayerSchema } from '../model/layers.js';
import { LinkKindSchema } from '../model/links.js';
import { defineOp, NoInput } from './define.js';
import { ObjectViewSchema, WrittenSchema } from './shapes.js';

/* vault.*: owned by @bousleh/vault. */

export const vaultHealth = defineOp({
  name: 'vault.health',
  description:
    'Health check for Bousleh: engine version, where your data lives (~/.bousleh unless configured otherwise) and whether it exists yet, how many ops are registered, and the latest backup snapshot. Call it first if any other tool fails.',
  input: NoInput,
  output: z.object({
    ok: z.boolean(),
    version: z.string(),
    home: z.string(),
    data: z.object({
      exists: z.boolean(),
      db: z.boolean(),
    }),
    ops: z.number().int(),
    backups: z.object({
      dir: z.string(),
      latest: z.string().nullable().describe('Folder name of the newest complete snapshot, or null if none yet.'),
      count: z.number().int(),
    }),
    now: z.iso.datetime(),
  }),
  readOnly: true,
});

export const vaultBackup = defineOp({
  name: 'vault.backup',
  description:
    'Take a snapshot of your data now: a consistent copy of vault.db plus every markdown and inbox file, in a new dated folder next to your data (~/.bousleh-backups unless BOUSLEH_BACKUPS says otherwise). Keeps the newest `keep` snapshots and removes older ones. The engine already takes one automatically once a day, so call this only before something risky or when asked. To restore, close Claude Desktop and Claude Code, move ~/.bousleh aside, and copy a snapshot folder into its place.',
  input: z.object({
    keep: z.number().int().min(1).max(365).default(14).describe('How many snapshots to keep, newest first. Default 14.'),
  }),
  output: z.object({
    path: z.string(),
    files: z.number().int(),
    bytes: z.number().int(),
    pruned: z.array(z.string()),
  }),
  readOnly: true,
});

export const vaultGet = defineOp({
  name: 'vault.get',
  description:
    'Read one object by id: its current version (title, altitude, status, kind-specific fields and markdown body), its scopes and its links in both directions. Pass history: true to list every version too.',
  input: z.object({
    id: IdSchema,
    history: z.boolean().default(false),
  }),
  output: ObjectViewSchema,
  readOnly: true,
});

export const vaultSupersede = defineOp({
  name: 'vault.supersede',
  description:
    'Write a new version of an existing object. Fields you leave out carry over from the current version. attrs merge into the current ones (set a key to null to remove it). Nothing is overwritten: the old version stays in history. An idea cannot be set to concluded here; link a decision to it with concludes instead.',
  input: z.object({
    id: IdSchema,
    title: z.string().trim().min(1).max(200).optional(),
    altitude: AltitudeSchema.optional(),
    status: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    body: z.string().optional(),
  }),
  output: WrittenSchema.extend({ supersedes: IdSchema }),
});

export const SearchHitSchema = z.object({
  id: IdSchema,
  kind: KindSchema,
  layer: LayerSchema,
  title: z.string(),
  status: z.string().nullable(),
  altitude: AltitudeSchema,
  scopes: z.array(ScopeSlugSchema),
  /** A few words of the body around the match, matched words wrapped in **. Empty when the body is. */
  snippet: z.string(),
});
export type SearchHit = z.output<typeof SearchHitSchema>;

export const vaultSearch = defineOp({
  name: 'vault.search',
  description:
    'Full-text search over the current version of every object (titles and markdown bodies). Pass plain words, not search syntax: punctuation and words like AND, OR and NOT are treated as ordinary text. Objects that contain every word come first; if none do, objects that contain any of the words are returned instead, and match says which happened. Narrow with kinds, layers and scopes (slugs). Best match first. Use vault.get on a hit for the full object.',
  input: z.object({
    query: z.string().trim().min(1).max(500),
    kinds: z.array(KindSchema).optional(),
    layers: z.array(LayerSchema).optional(),
    scopes: z.array(ScopeSlugSchema).optional().describe('Only objects in at least one of these scopes or a scope below one of them.'),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  output: z.object({
    hits: z.array(SearchHitSchema),
    /** all: every word matched. any: no object had every word, so these match at least one. */
    match: z.enum(['all', 'any']),
  }),
  readOnly: true,
});

export const vaultLink = defineOp({
  name: 'vault.link',
  description:
    'Link two existing objects with a typed link, from one object to another (for example a signal evidence_for a problem, a commitment owed_by a person). Only allowed pairs are accepted. Linking the same pair with the same kind again returns the existing link with created: false. A decision linked to an idea with concludes moves the idea to concluded (the idea must be a bet); the result then carries the new version of the idea under concluded.',
  input: z.object({
    from: IdSchema,
    kind: LinkKindSchema,
    to: IdSchema,
    note: z.string().trim().min(1).optional(),
  }),
  output: z.object({
    id: IdSchema,
    created: z.boolean(),
    /** Only for a new concludes link: the idea and the version that set it to concluded. */
    concluded: z.object({ idea: IdSchema, version: z.object({ id: IdSchema, n: z.number().int().min(1) }) }).optional(),
  }),
});

export const vaultUnlink = defineOp({
  name: 'vault.unlink',
  description:
    'Retract a link by its id (the lnk_ id from vault.get or vault.link), with an optional reason. Nothing is deleted: the link stays in history as retracted and no longer shows on either object. A concludes link cannot be retracted, because a concluded idea stays concluded; link a new decision instead.',
  input: z.object({
    id: IdSchema,
    reason: z.string().trim().min(1).optional(),
  }),
  output: z.object({
    id: IdSchema,
    kind: LinkKindSchema,
    from: IdSchema,
    to: IdSchema,
    /** True when the link had already been retracted; nothing new was written. */
    already_retracted: z.boolean(),
  }),
});

export const vaultOps = {
  'vault.health': vaultHealth,
  'vault.get': vaultGet,
  'vault.search': vaultSearch,
  'vault.supersede': vaultSupersede,
  'vault.link': vaultLink,
  'vault.unlink': vaultUnlink,
  'vault.backup': vaultBackup,
} as const;
