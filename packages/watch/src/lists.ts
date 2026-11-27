import {
  LEGACY_USER_ADDED_BY,
  type ObjectView,
  type OpInput,
  type OpOutput,
  type ScopeView,
  type WatchEntry,
  type WatchEntryInput,
  WatchEntrySchema,
  type WatchListView,
  watchlistsApply,
  watchlistsGet,
  watchlistsSet,
} from '@bousleh/contracts';
import { defineHandler, type HandlerContext, OpError } from '@bousleh/vault';
import { call } from './call.js';
import { urlKey } from './findings.js';

/* watchlists.get, watchlists.set and watchlists.apply. A watch list is a `watch_list` object; its entries are its attrs. */

/** The altitude a new watch list gets when the caller gives none. */
export const DEFAULT_WATCH_LIST_ALTITUDE = 10000;

/**
 * A stored entry as it reads today. The oldest entries have no added_by, and v0.1 stored the
 * owner's name for the user's own: both read as the user's. The schema handles both; this fallback
 * covers an entry that fails it for another reason.
 */
function readEntry(raw: unknown): WatchEntry {
  const parsed = WatchEntrySchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const entry = raw as Record<string, unknown>;
  const addedBy = entry.added_by === undefined || entry.added_by === LEGACY_USER_ADDED_BY ? 'user' : entry.added_by;
  return { ...entry, added_by: addedBy } as WatchEntry;
}

export function toWatchListView(object: ObjectView): WatchListView {
  return {
    id: object.id,
    title: object.version.title,
    altitude: object.version.altitude,
    scopes: object.scopes,
    entries: ((object.version.attrs.entries as unknown[] | undefined) ?? []).map(readEntry),
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

/** What makes two entries the same thing: the url when both have one, else the type and the name. */
function sameEntry(
  a: { type: string; name: string; url?: string | undefined },
  b: { type: string; name: string; url?: string | undefined },
) {
  if (a.url !== undefined && b.url !== undefined) {
    try {
      return urlKey(a.url) === urlKey(b.url);
    } catch {
      return a.url === b.url;
    }
  }
  return a.type === b.type && a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

/**
 * The entries to store: an entry given without added_by keeps the added_by (and, if it gives none,
 * the reason) of the same entry already on the list; a new one is the user's.
 */
export function resolveEntries(input: readonly WatchEntryInput[], current: readonly WatchEntry[]): WatchEntry[] {
  return input.map((entry) => {
    if (entry.added_by !== undefined) return WatchEntrySchema.parse(entry);
    const existing = current.find((c) => sameEntry(c, entry));
    if (!existing) return WatchEntrySchema.parse({ ...entry, added_by: 'user' });
    const reason = entry.reason ?? existing.reason;
    // Parsed again so keys come out in the schema's order, as stored entries do.
    return WatchEntrySchema.parse({ ...entry, added_by: existing.added_by, ...(reason !== undefined ? { reason } : {}) });
  });
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
        attrs: { entries: resolveEntries(input.entries, []) },
        body: input.body ?? '',
      });
      const created = await loadWatchList(h, written.id);
      return { ...toWatchListView(created), created: true, new_version: true };
    }
  }

  const current = toWatchListView(existing);
  const entries = resolveEntries(input.entries, current.entries);
  const patch: OpInput<'vault.supersede'> = { id: existing.id };
  if (JSON.stringify(entries) !== JSON.stringify(current.entries)) patch.attrs = { entries };
  if (input.title !== undefined && input.title !== current.title) patch.title = input.title;
  if (input.altitude !== undefined && input.altitude !== current.altitude) patch.altitude = input.altitude;
  if (input.body !== undefined && input.body !== existing.version.body) patch.body = input.body;
  if (Object.keys(patch).length === 1) return { ...current, created: false, new_version: false };

  await call(h, 'vault.supersede', patch);
  return { ...toWatchListView(await loadWatchList(h, existing.id)), created: false, new_version: true };
});

/** The title of a queued suggestion to remove one of the user's entries; also how a repeat is recognised. */
export function removalSuggestionTitle(entryName: string, list: WatchListView): string {
  const scope = list.scopes.join(', ');
  return `Remove "${entryName}" from the ${scope} watch list?`;
}

type ApplyResult = OpOutput<'watchlists.apply'>['results'][number];

export const watchlistsApplyHandler = defineHandler(watchlistsApply, async (input, h) => {
  const list = toWatchListView(await loadWatchList(h, input.id));
  let entries = [...list.entries];
  const results: ApplyResult[] = [];
  let openQueue: { id: string; title: string | undefined; candidates: string[] }[] | undefined;

  for (const change of input.changes) {
    const base = { action: change.action, type: change.type, name: change.name };
    const match = entries.find((e) => sameEntry(e, change));
    if (change.action === 'add') {
      if (match) {
        results.push({ ...base, outcome: 'already_on_list' });
        continue;
      }
      entries.push(
        WatchEntrySchema.parse({
          type: change.type,
          name: change.name,
          ...(change.url !== undefined ? { url: change.url } : {}),
          added_by: 'horizon',
          reason: change.reason,
        }),
      );
      results.push({ ...base, outcome: 'added' });
      continue;
    }

    if (!match) {
      results.push({ ...base, outcome: 'not_on_list' });
      continue;
    }
    if (match.added_by === 'horizon') {
      entries = entries.filter((e) => e !== match);
      results.push({ ...base, outcome: 'removed' });
      continue;
    }

    // One of the user's: never removed here. Suggest it once, in the queue.
    const title = removalSuggestionTitle(match.name, list);
    if (openQueue === undefined) {
      openQueue = (await call(h, 'queue.list', {})).items.map((item) => ({
        id: item.id,
        title: item.draft.title,
        candidates: item.candidates.map((c) => c.id),
      }));
    }
    const existing = openQueue.find((item) => item.title === title && item.candidates.includes(list.id));
    if (existing) {
      results.push({ ...base, outcome: 'already_queued', queue_id: existing.id });
      continue;
    }
    const what = `${match.type} "${match.name}"${match.url !== undefined ? ` (${match.url})` : ''}`;
    const queued = await call(h, 'queue.add', {
      draft: {
        kind: 'observation',
        title,
        altitude: list.altitude,
        scopes: list.scopes,
        body: [
          `The Weekly Horizon scan suggests removing ${what} from ${list.title}: ${change.reason}`,
          input.source !== undefined ? `Source: ${input.source}.` : undefined,
          'You added this entry, so it stays on the list until you decide.',
        ]
          .filter((line) => line !== undefined)
          .join('\n\n'),
        links: [{ kind: 'related', to: list.id }],
      },
      reason: 'Horizon suggests removing an entry the user added; the user decides',
      candidates: [list.id],
    });
    openQueue.push({ id: queued.id, title, candidates: [list.id] });
    results.push({ ...base, outcome: 'queued', queue_id: queued.id });
  }

  if (JSON.stringify(entries) === JSON.stringify(list.entries)) {
    return { watch_list: list, new_version: false, results };
  }
  await call(h, 'vault.supersede', { id: list.id, attrs: { entries } });
  return { watch_list: toWatchListView(await loadWatchList(h, list.id)), new_version: true, results };
});
