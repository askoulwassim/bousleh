import {
  type ObjectView,
  type OpInput,
  type ScopeView,
  type WatchEntry,
  type WatchListView,
  watchlistsGet,
  watchlistsSet,
} from '@bousleh/contracts';
import { defineHandler, type HandlerContext, OpError } from '@bousleh/vault';
import { call } from './call.js';

/* watchlists.get and watchlists.set. A watch list is a `watch_list` object; its entries are its attrs. */

/** The altitude a new watch list gets when the caller gives none. */
export const DEFAULT_WATCH_LIST_ALTITUDE = 10000;

export function toWatchListView(object: ObjectView): WatchListView {
  return {
    id: object.id,
    title: object.version.title,
    altitude: object.version.altitude,
    scopes: object.scopes,
    entries: (object.version.attrs.entries as WatchEntry[] | undefined) ?? [],
    version: { id: object.version.id, n: object.version.n },
    updated_at: object.version.created_at,
  };
}

export async function loadWatchList(h: HandlerContext, id: string): Promise<ObjectView> {
  const object = await call(h, 'vault.get', { id });
  if (object.kind !== 'watch_list') throw new OpError('invalid_input', `${id} is a ${object.kind}, not a watch list`);
  return object;
}

/** Every watch list, oldest first. */
export async function allWatchLists(h: HandlerContext): Promise<ObjectView[]> {
  const rows = h.store.db.prepare("SELECT id FROM objects WHERE kind = 'watch_list' ORDER BY created_at, id").all() as { id: string }[];
  const lists: ObjectView[] = [];
  for (const row of rows) lists.push(await call(h, 'vault.get', { id: row.id }));
  return lists;
}

export function requireScope(h: HandlerContext, slug: string): ScopeView {
  const scope = h.store.listScopes().find((s) => s.slug === slug);
  if (!scope) throw new OpError('invalid_input', `no scope named ${slug}; scopes.list shows them all`);
  return scope;
}

/** The watch lists in a scope (normally one). */
export async function watchListsInScope(h: HandlerContext, slug: string): Promise<ObjectView[]> {
  requireScope(h, slug);
  return (await allWatchLists(h)).filter((list) => list.scopes.includes(slug));
}

/** The one watch list a call names, by id or by scope. */
export async function resolveWatchList(
  h: HandlerContext,
  by: { id?: string | undefined; scope?: string | undefined },
): Promise<ObjectView> {
  if ((by.id === undefined) === (by.scope === undefined)) {
    throw new OpError('invalid_input', 'name the watch list by its id or by its scope slug: one of the two');
  }
  if (by.id !== undefined) return loadWatchList(h, by.id);
  const scope = by.scope as string;
  const lists = await watchListsInScope(h, scope);
  if (lists.length === 0) throw new OpError('not_found', `${scope} has no watch list yet; create it with watchlists.set`);
  if (lists.length > 1) {
    throw new OpError('conflict', `${scope} has ${lists.length} watch lists (${lists.map((l) => l.id).join(', ')}); name one by id`);
  }
  return lists[0] as ObjectView;
}

export const watchlistsGetHandler = defineHandler(watchlistsGet, async (input, h) => {
  if (input.id !== undefined) {
    const list = await loadWatchList(h, input.id);
    if (input.scope !== undefined && !list.scopes.includes(input.scope)) return { watch_lists: [] };
    return { watch_lists: [toWatchListView(list)] };
  }
  const lists = input.scope !== undefined ? await watchListsInScope(h, input.scope) : await allWatchLists(h);
  return { watch_lists: lists.map(toWatchListView) };
});

export const watchlistsSetHandler = defineHandler(watchlistsSet, async (input, h) => {
  if ((input.id === undefined) === (input.scope === undefined)) {
    throw new OpError('invalid_input', 'give either the id of a watch list or a scope slug, not both and not neither');
  }
  let existing: ObjectView | undefined;
  if (input.id !== undefined) {
    existing = await loadWatchList(h, input.id);
  } else {
    const scope = requireScope(h, input.scope as string);
    const lists = await watchListsInScope(h, scope.slug);
    if (lists.length > 1) {
      throw new OpError('conflict', `${scope.slug} has ${lists.length} watch lists (${lists.map((l) => l.id).join(', ')}); name one by id`);
    }
    existing = lists[0];
    if (!existing) {
      const written = await call(h, 'deposits.write', {
        kind: 'watch_list',
        title: input.title ?? `Watch list: ${scope.name}`,
        altitude: input.altitude ?? DEFAULT_WATCH_LIST_ALTITUDE,
        scopes: [scope.slug],
        attrs: { entries: input.entries },
        body: input.body ?? '',
      });
      const created = await loadWatchList(h, written.id);
      return { ...toWatchListView(created), created: true, new_version: true };
    }
  }

  const current = toWatchListView(existing);
  const patch: OpInput<'vault.supersede'> = { id: existing.id };
  if (JSON.stringify(input.entries) !== JSON.stringify(current.entries)) patch.attrs = { entries: input.entries };
  if (input.title !== undefined && input.title !== current.title) patch.title = input.title;
  if (input.altitude !== undefined && input.altitude !== current.altitude) patch.altitude = input.altitude;
  if (input.body !== undefined && input.body !== existing.version.body) patch.body = input.body;
  if (Object.keys(patch).length === 1) return { ...current, created: false, new_version: false };

  await call(h, 'vault.supersede', patch);
  return { ...toWatchListView(await loadWatchList(h, existing.id)), created: false, new_version: true };
});
