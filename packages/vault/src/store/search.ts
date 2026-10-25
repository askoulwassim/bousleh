import type { Altitude, Kind, Layer, SearchHit } from '@bousleh/contracts';
import { OpError } from '../handler.js';
import type { Store } from './store.js';

/*
 * Full-text search over the FTS5 `search` table (one row per object, its current version).
 * Callers pass plain words, never FTS syntax: every word becomes a quoted phrase, so operators,
 * parentheses, quotes and column filters in the text are just text and can't break the query.
 */

/** At most this many words of a query are used. */
const MAX_TERMS = 32;

/**
 * Turn plain words into an FTS5 query over titles and bodies. `all` needs every word, `any` at
 * least one. Undefined when the text has no searchable word (only punctuation).
 */
export function ftsQuery(text: string, mode: 'all' | 'any'): string | undefined {
  const terms = text
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word))
    .slice(0, MAX_TERMS)
    .map((word) => `"${word.replaceAll('"', '""')}"`);
  if (terms.length === 0) return undefined;
  return `{title body} : (${terms.join(mode === 'all' ? ' ' : ' OR ')})`;
}

export interface SearchFilter {
  query: string;
  kinds?: readonly Kind[] | undefined;
  layers?: readonly Layer[] | undefined;
  scopes?: readonly string[] | undefined;
  limit: number;
}

interface HitRow {
  id: string;
  kind: Kind;
  layer: Layer;
  scopes: string;
  title: string;
  status: string | null;
  altitude: Altitude;
  snippet: string | null;
}

/** Best match first: every word if anything has them all, else any word. */
export function searchObjects(store: Store, filter: SearchFilter): { hits: SearchHit[]; match: 'all' | 'any' } {
  if (filter.scopes?.length) {
    const known = new Set(store.listScopes().map((scope) => scope.slug));
    const unknown = filter.scopes.filter((slug) => !known.has(slug));
    if (unknown.length > 0) throw new OpError('invalid_input', `no scope named ${unknown.join(', ')}; scopes.list shows them all`);
  }

  const all = run(store, filter, 'all');
  if (all.length > 0) return { hits: all, match: 'all' };
  return { hits: run(store, filter, 'any'), match: 'any' };
}

function run(store: Store, filter: SearchFilter, mode: 'all' | 'any'): SearchHit[] {
  const match = ftsQuery(filter.query, mode);
  if (match === undefined) return [];

  const where = ['search MATCH ?'];
  const params: unknown[] = [match];
  if (filter.kinds?.length) {
    where.push(`search.kind IN (${filter.kinds.map(() => '?').join(', ')})`);
    params.push(...filter.kinds);
  }
  if (filter.layers?.length) {
    where.push(`search.layer IN (${filter.layers.map(() => '?').join(', ')})`);
    params.push(...filter.layers);
  }
  if (filter.scopes?.length) {
    // `search.scopes` holds the object's current scope slugs, space-separated (kept by Store.refreshSearch).
    where.push(`(${filter.scopes.map(() => "instr(' ' || search.scopes || ' ', ?) > 0").join(' OR ')})`);
    params.push(...filter.scopes.map((slug) => ` ${slug} `));
  }
  params.push(filter.limit);

  // bm25 weights, one per column: object_id, title, body, kind, layer, scopes. A title hit counts ten times a body hit.
  const rows = store.db
    .prepare(
      `SELECT search.object_id AS id, search.kind, search.layer, search.scopes, c.title, c.status, c.altitude,
              snippet(search, 2, '**', '**', '…', 12) AS snippet
       FROM search JOIN current c ON c.object_id = search.object_id
       WHERE ${where.join(' AND ')}
       ORDER BY bm25(search, 0, 10.0, 1.0, 0, 0, 0), search.object_id
       LIMIT ?`,
    )
    .all(...params) as HitRow[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    layer: row.layer,
    title: row.title,
    status: row.status,
    altitude: row.altitude,
    scopes: row.scopes.split(' ').filter(Boolean),
    snippet: row.snippet ?? '',
  }));
}
