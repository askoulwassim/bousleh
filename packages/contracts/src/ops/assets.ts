import { z } from 'zod';
import { IdSchema, ScopeSlugSchema } from '../model/ids.js';
import { KINDS, KindSchema } from '../model/kinds.js';
import { AltitudeSchema } from '../model/layers.js';
import { defineOp } from './define.js';

/*
 * assets.*: owned by @bousleh/vault. An asset (kind `asset`) is something outside Bousleh that
 * documents work kept in it: a Claude Doc, a Slides deck, a dashboard, a whiteboard, a design, a
 * published page, a repo, a file. It links with `documents` to the objects it documents.
 */

/** What an asset is, straight from the asset kind so the two never drift. */
export const AssetTypeSchema = KINDS.asset.attrs.shape.type;

/** One asset, as assets.list shows it. */
export const AssetViewSchema = z.object({
  id: IdSchema,
  title: z.string(),
  type: AssetTypeSchema,
  url: z.string(),
  scopes: z.array(ScopeSlugSchema),
  altitude: AltitudeSchema,
  /** The objects it documents (live `documents` links). */
  documents: z.array(z.object({ id: IdSchema, kind: KindSchema, title: z.string() })),
});
export type AssetView = z.output<typeof AssetViewSchema>;

export const assetsAdd = defineOp({
  name: 'assets.add',
  description: [
    'Register an outside asset in your data: a Claude Doc, Slides deck, sheet, dashboard, whiteboard, design or published page, a GitHub repo, or a file. Call it every time you create or find one (right after creating or updating a Doc, deck, whiteboard, dashboard, design or page, and when a dump or inbox file mentions the url of one), and link it with documents to the objects it is about: the strategy, problem, idea, initiative, decision or person it documents.',
    'url is its link; type is doc, slides, sheet, dashboard, whiteboard, design, page, repo, file or other. scopes (at least one slug) and altitude (default 1000) say where it belongs; body is optional notes.',
    'Safe to call again: urls are compared without their #fragment, utm_* parameters and a trailing slash, and an asset already registered for the url is returned with created: false. Then any new documents links are added (links it already has are fine), and a new version is written only when the title or type changed; its scopes, altitude and body are left as they are (vault.supersede changes those).',
  ].join(' '),
  input: z.object({
    url: z.url().describe('The link to the asset. Fragments, utm_* parameters and a trailing slash are dropped.'),
    title: z.string().trim().min(1).max(200),
    type: AssetTypeSchema,
    scopes: z.array(ScopeSlugSchema).min(1),
    altitude: AltitudeSchema.default(1000),
    body: z.string().default(''),
    documents: z.array(IdSchema).max(50).default([]).describe('Ids of the objects it documents.'),
  }),
  output: z.object({
    id: IdSchema,
    /** The url as stored, normalised. */
    url: z.string(),
    /** True when this call registered the asset. */
    created: z.boolean(),
    /** True when this call wrote a version (always true on create). */
    new_version: z.boolean(),
    /** The objects this call linked it to with documents. Links it already had are left out. */
    linked: z.array(IdSchema),
  }),
});

export const assetsList = defineOp({
  name: 'assets.list',
  description:
    'List registered assets (Docs, decks, dashboards, whiteboards, designs, pages, repos, files), newest first, each with its url, type, scopes, altitude and the objects it documents. Narrow with scopes (slugs; child scopes included), type, and documents (one object id: only the assets that document it). Use it to find the Doc or deck that already exists for an object before making a new one.',
  input: z.object({
    scopes: z.array(ScopeSlugSchema).optional().describe('Only assets in these scopes or a scope below one of them.'),
    type: AssetTypeSchema.optional(),
    documents: IdSchema.optional().describe('Only assets that document this object.'),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.object({ assets: z.array(AssetViewSchema) }),
  readOnly: true,
});

export const assetOps = {
  'assets.add': assetsAdd,
  'assets.list': assetsList,
} as const;
