import { z } from 'zod';
import { ScopeSlugSchema } from '../model/ids.js';
import { KindSchema } from '../model/kinds.js';
import { AltitudeSchema } from '../model/layers.js';
import { defineOp } from './define.js';
import { LinkInputSchema, WrittenSchema } from './shapes.js';

/* deposits.*: owned by @bousleh/vault. */

export const depositsWrite = defineOp({
  name: 'deposits.write',
  description:
    'Create one new object in your data: a typed deposit with a kind, a title, an altitude (50000 company, 10000 cross-team, 1000 own surfaces, 100 one engineer or requirement), its scopes by slug, optional status, kind-specific fields (attrs), a markdown body, and links to existing objects. Every kind except person needs at least one scope. To change an existing object, use vault.supersede.',
  input: z.object({
    kind: KindSchema,
    title: z.string().trim().min(1).max(200),
    altitude: AltitudeSchema,
    scopes: z.array(ScopeSlugSchema).default([]),
    status: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    body: z.string().default(''),
    links: z.array(LinkInputSchema).default([]),
  }),
  output: WrittenSchema,
});

export const depositOps = {
  'deposits.write': depositsWrite,
} as const;
