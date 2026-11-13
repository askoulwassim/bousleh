import { type Altitude, type CommitmentView, isSnoozed, type Kind } from '@bousleh/contracts';
import { OpError } from '../handler.js';
import type { Store } from './store.js';

/* Reads for commitments.list and people.get. A commitment's people are its live owed_by and owed_to links. */

/** SQL condition: link `l` has not been retracted. */
export const LIVE_LINK = 'NOT EXISTS (SELECT 1 FROM link_retractions r WHERE r.link_id = l.id)';

export interface CommitmentFilter {
  status: 'open' | 'done' | 'dropped' | 'any';
  owed_by?: string | undefined;
  owed_to?: string | undefined;
  scope?: string | undefined;
  /** Due on or before this date (YYYY-MM-DD); commitments without a due date are left out. */
  due_before?: string | undefined;
  /** What to do with commitments snoozed past `as_of`: keep them (default), leave them out, or list only them. */
  snoozed?: 'include' | 'exclude' | 'only' | undefined;
  /** The day `snoozed` is judged on (YYYY-MM-DD). Needed unless snoozed is include. */
  as_of?: string | undefined;
  limit?: number | undefined;
}

interface CommitmentRow {
  id: string;
  title: string;
  status: CommitmentView['status'];
  altitude: Altitude;
  due: string | null;
  surface_on: string | null;
}

/** Refuse an id that isn't an existing person, so a typo doesn't read as "nothing owed". */
export function requirePerson(store: Store, id: string, field: string): void {
  const row = store.db.prepare('SELECT kind FROM objects WHERE id = ?').get(id) as { kind: Kind } | undefined;
  if (!row) throw new OpError('not_found', `${field}: no object with id ${id}`);
  if (row.kind !== 'person') throw new OpError('invalid_input', `${field}: ${id} is a ${row.kind}, not a person`);
}

/** Commitments matching the filter, soonest due first, those with no due date last. */
export function listCommitments(store: Store, filter: CommitmentFilter): CommitmentView[] {
  if (filter.owed_by !== undefined) requirePerson(store, filter.owed_by, 'owed_by');
  if (filter.owed_to !== undefined) requirePerson(store, filter.owed_to, 'owed_to');
  const inScope = filter.scope === undefined ? undefined : store.expandScopes([filter.scope]);

  const where = ["o.kind = 'commitment'"];
  const params: unknown[] = [];
  if (filter.status !== 'any') {
    where.push('c.status = ?');
    params.push(filter.status);
  }
  if (filter.due_before !== undefined) {
    where.push("json_extract(c.attrs_json, '$.due') IS NOT NULL AND json_extract(c.attrs_json, '$.due') <= ?");
    params.push(filter.due_before);
  }
  for (const kind of ['owed_by', 'owed_to'] as const) {
    const person = filter[kind];
    if (person === undefined) continue;
    where.push(`EXISTS (SELECT 1 FROM links l WHERE l.from_id = o.id AND l.kind = '${kind}' AND l.to_id = ? AND ${LIVE_LINK})`);
    params.push(person);
  }

  const rows = store.db
    .prepare(
      `SELECT o.id, c.title, c.status, c.altitude, json_extract(c.attrs_json, '$.due') AS due,
              json_extract(c.attrs_json, '$.surface_on') AS surface_on
       FROM objects o JOIN current c ON c.object_id = o.id
       WHERE ${where.join(' AND ')}
       ORDER BY due IS NULL, due, o.created_at, o.id`,
    )
    .all(...params) as CommitmentRow[];

  const views: CommitmentView[] = [];
  for (const row of rows) {
    if (filter.limit !== undefined && views.length >= filter.limit) break;
    if (filter.snoozed !== undefined && filter.snoozed !== 'include') {
      if (filter.as_of === undefined) throw new Error('listCommitments: as_of is needed to judge snoozed');
      const snoozed = row.status === 'open' && isSnoozed(row.surface_on, filter.as_of);
      if ((filter.snoozed === 'only') !== snoozed) continue;
    }
    // Scope membership has its own history (adds and retractions); the store resolves it.
    const scopes = store.scopeSlugsOf(row.id);
    if (inScope !== undefined && !scopes.some((slug) => inScope.has(slug))) continue;
    views.push({ ...row, scopes, ...peopleOf(store, row.id) });
  }
  return views;
}

function peopleOf(store: Store, commitmentId: string): Pick<CommitmentView, 'owed_by' | 'owed_to'> {
  const rows = store.db
    .prepare(
      `SELECT l.kind, l.to_id AS id, p.title AS name
       FROM links l JOIN current p ON p.object_id = l.to_id
       WHERE l.from_id = ? AND l.kind IN ('owed_by', 'owed_to') AND ${LIVE_LINK}
       ORDER BY l.created_at, l.id`,
    )
    .all(commitmentId) as { kind: 'owed_by' | 'owed_to'; id: string; name: string }[];
  return {
    owed_by: rows.filter((row) => row.kind === 'owed_by').map(({ id, name }) => ({ id, name })),
    owed_to: rows.filter((row) => row.kind === 'owed_to').map(({ id, name }) => ({ id, name })),
  };
}
