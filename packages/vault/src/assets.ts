import { type AssetView, assetsAdd, assetsList, type ObjectView, type OpInput } from '@bousleh/contracts';
import { call } from './call.js';
import { defineHandler, type HandlerContext, OpError } from './handler.js';

/* Handlers for assets.add and assets.list. An asset is an `asset` object; its url and type are its attrs. */

/**
 * The url as assets store and compare it: without its #fragment, its utm_* tracking parameters
 * and a trailing slash.
 */
export function normalizeAssetUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  // Only a url with tracking parameters is rewritten, so other queries keep their exact spelling.
  const tracking = [...url.searchParams.keys()].filter((key) => /^utm_/i.test(key));
  for (const key of tracking) url.searchParams.delete(key);
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  const out = url.toString();
  return url.search === '' && out.endsWith('/') ? out.slice(0, -1) : out;
}

/** The oldest asset whose current version has this url (compared normalised), if any. */
function assetWithUrl(h: HandlerContext, url: string): string | undefined {
  const rows = h.store.db
    .prepare(
      `SELECT o.id, json_extract(c.attrs_json, '$.url') AS url
       FROM objects o JOIN current c ON c.object_id = o.id
       WHERE o.kind = 'asset' ORDER BY o.created_at, o.id`,
    )
    .all() as { id: string; url: string | null }[];
  for (const row of rows) {
    if (!row.url) continue;
    try {
      if (normalizeAssetUrl(row.url) === url) return row.id;
    } catch {
      // A url that no longer parses can't match anything.
    }
  }
  return undefined;
}

export function toAssetView(object: ObjectView): AssetView {
  return {
    id: object.id,
    title: object.version.title,
    type: object.version.attrs.type as AssetView['type'],
    url: object.version.attrs.url as string,
    scopes: object.scopes,
    altitude: object.version.altitude,
    documents: object.links.out
      .filter((link) => link.kind === 'documents')
      .map((link) => ({ id: link.to, kind: link.to_kind, title: link.to_title })),
  };
}

export const assetsAddHandler = defineHandler(assetsAdd, async (input, h) => {
  const url = normalizeAssetUrl(input.url);
  const documents = [...new Set(input.documents)];
  const existing = assetWithUrl(h, url);

  if (existing === undefined) {
    const written = await call(h, 'deposits.write', {
      kind: 'asset',
      title: input.title,
      altitude: input.altitude,
      scopes: input.scopes,
      attrs: { url, type: input.type },
      body: input.body,
      links: documents.map((to) => ({ kind: 'documents' as const, to })),
    });
    return { id: written.id, url, created: true, new_version: true, linked: documents };
  }

  const asset = await call(h, 'vault.get', { id: existing });
  const linked: string[] = [];
  for (const to of documents) {
    const link = await call(h, 'vault.link', { from: existing, kind: 'documents', to });
    if (link.created) linked.push(to);
  }

  const patch: OpInput<'vault.supersede'> = { id: existing };
  if (input.title !== asset.version.title) patch.title = input.title;
  if (input.type !== asset.version.attrs.type) patch.attrs = { type: input.type };
  const changed = Object.keys(patch).length > 1;
  if (changed) await call(h, 'vault.supersede', patch);
  return { id: existing, url: asset.version.attrs.url as string, created: false, new_version: changed, linked };
});

export const assetsListHandler = defineHandler(assetsList, (input, h) => {
  const inScope = input.scopes === undefined || input.scopes.length === 0 ? undefined : h.store.expandScopes(input.scopes);
  if (input.documents !== undefined && !h.store.getObject(input.documents)) {
    throw new OpError('not_found', `documents: no object with id ${input.documents}`);
  }
  const rows = h.store.db.prepare("SELECT id FROM objects WHERE kind = 'asset' ORDER BY created_at DESC, id DESC").all() as {
    id: string;
  }[];
  const assets: AssetView[] = [];
  for (const row of rows) {
    if (assets.length >= input.limit) break;
    const object = h.store.getObject(row.id);
    if (!object) continue;
    const view = toAssetView(object);
    if (inScope !== undefined && !view.scopes.some((slug) => inScope.has(slug))) continue;
    if (input.type !== undefined && view.type !== input.type) continue;
    if (input.documents !== undefined && !view.documents.some((d) => d.id === input.documents)) continue;
    assets.push(view);
  }
  return { assets };
});
