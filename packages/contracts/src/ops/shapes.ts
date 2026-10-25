import { z } from 'zod';
import { IdSchema, SCOPE_KINDS, ScopeSlugSchema } from '../model/ids.js';
import { KindSchema } from '../model/kinds.js';
import { AltitudeSchema, LayerSchema } from '../model/layers.js';
import { LinkKindSchema } from '../model/links.js';

/* Shapes several ops share. Ops in any package can reuse them. */

const isoDateTime = z.iso.datetime({ offset: true });

export const ActorSchema = z.enum(['human', 'agent', 'schedule']);

/** One version of an object, as ops return it. */
export const VersionViewSchema = z.object({
  id: IdSchema,
  n: z.number().int().min(1),
  title: z.string(),
  altitude: AltitudeSchema,
  status: z.string().nullable(),
  attrs: z.record(z.string(), z.unknown()),
  body: z.string(),
  created_at: isoDateTime,
  actor: ActorSchema,
  op: z.string(),
});
export type VersionView = z.output<typeof VersionViewSchema>;

export const VersionSummarySchema = VersionViewSchema.pick({
  id: true,
  n: true,
  title: true,
  status: true,
  created_at: true,
  actor: true,
  op: true,
});

export const LinkOutSchema = z.object({
  id: IdSchema,
  kind: LinkKindSchema,
  to: IdSchema,
  to_kind: KindSchema,
  to_title: z.string(),
  note: z.string().nullable(),
  created_at: isoDateTime,
});
export const LinkInSchema = z.object({
  id: IdSchema,
  kind: LinkKindSchema,
  from: IdSchema,
  from_kind: KindSchema,
  from_title: z.string(),
  note: z.string().nullable(),
  created_at: isoDateTime,
});

/** An object with its current version, scopes and links (live links only, retractions excluded). */
export const ObjectViewSchema = z.object({
  id: IdSchema,
  kind: KindSchema,
  layer: LayerSchema,
  created_at: isoDateTime,
  created_by: ActorSchema,
  version: VersionViewSchema,
  scopes: z.array(ScopeSlugSchema),
  links: z.object({ out: z.array(LinkOutSchema), in: z.array(LinkInSchema) }),
  /** The current markdown file, relative to your data home. */
  path: z.string(),
  /** Every version, oldest first, when asked for. */
  history: z.array(VersionSummarySchema).optional(),
});
export type ObjectView = z.output<typeof ObjectViewSchema>;

export const LinkInputSchema = z.object({
  kind: LinkKindSchema,
  to: IdSchema,
  note: z.string().trim().min(1).optional(),
});

export const ScopeViewSchema = z.object({
  id: IdSchema,
  slug: ScopeSlugSchema,
  name: z.string(),
  kind: z.enum(SCOPE_KINDS),
  parent: ScopeSlugSchema.nullable(),
});
export type ScopeView = z.output<typeof ScopeViewSchema>;

export const WrittenSchema = z.object({
  id: IdSchema,
  kind: KindSchema,
  layer: LayerSchema,
  version: z.object({ id: IdSchema, n: z.number().int().min(1) }),
  path: z.string(),
});
