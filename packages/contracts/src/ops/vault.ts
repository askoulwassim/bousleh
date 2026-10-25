import { z } from 'zod';
import { IdSchema } from '../model/ids.js';
import { AltitudeSchema } from '../model/layers.js';
import { defineOp, NoInput } from './define.js';
import { ObjectViewSchema, WrittenSchema } from './shapes.js';

/* vault.*: owned by @bousleh/vault. */

export const vaultHealth = defineOp({
  name: 'vault.health',
  description:
    'Health check for Bousleh: engine version, where your data lives (~/.bousleh unless configured otherwise) and whether it exists yet, and how many ops are registered. Call it first if any other tool fails.',
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
    now: z.iso.datetime(),
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

export const vaultOps = {
  'vault.health': vaultHealth,
  'vault.get': vaultGet,
  'vault.supersede': vaultSupersede,
} as const;
