import type { Kind, Layer, LinkKind, OpOutput } from '@bousleh/contracts';
import { OpError } from '../handler.js';
import { LIVE_LINK, listCommitments } from './commitments.js';
import type { Store } from './store.js';

/* The read behind people.get: one person and what hangs off their links. */

type PersonProfile = OpOutput<'people.get'>;

interface LinkedRow {
  other: string;
  kind: LinkKind;
  direction: 'in' | 'out';
  linked_at: string;
  other_kind: Kind;
  other_layer: Layer;
  other_created_at: string;
  title: string;
  status: string | null;
  updated_at: string;
}

export function personProfile(store: Store, id: string, recent: number): PersonProfile {
  const object = store.getObject(id);
  if (!object) throw new OpError('not_found', `no person with id ${id}`);
  if (object.kind !== 'person') throw new OpError('invalid_input', `${id} is a ${object.kind}, not a person`);

  const attrs = object.version.attrs as { role?: PersonProfile['person']['role']; org?: string };
  const person: PersonProfile['person'] = {
    id,
    name: object.version.title,
    role: attrs.role ?? null,
    org: attrs.org ?? null,
    scopes: object.scopes,
    body: object.version.body,
    created_at: object.created_at,
    updated_at: object.version.created_at,
  };

  // Every live link touching the person, with the object on the other end in its current state.
  const rows = store.db
    .prepare(
      `SELECT x.other, x.kind, x.direction, x.linked_at, o.kind AS other_kind, o.layer AS other_layer,
              o.created_at AS other_created_at, c.title, c.status, c.created_at AS updated_at
       FROM (
         SELECT l.from_id AS other, l.kind, 'in' AS direction, l.created_at AS linked_at, l.id AS link_id
           FROM links l WHERE l.to_id = ? AND ${LIVE_LINK}
         UNION ALL
         SELECT l.to_id AS other, l.kind, 'out' AS direction, l.created_at AS linked_at, l.id AS link_id
           FROM links l WHERE l.from_id = ? AND ${LIVE_LINK}
       ) x
       JOIN objects o ON o.id = x.other JOIN current c ON c.object_id = x.other
       ORDER BY x.linked_at, x.link_id`,
    )
    .all(id, id) as LinkedRow[];

  const growthNotes = rows
    .filter((row) => row.other_kind === 'growth_note' && row.kind === 'about' && row.direction === 'in')
    .filter((row, index, list) => list.findIndex((other) => other.other === row.other) === index)
    .map((row) => ({
      id: row.other,
      title: row.title,
      body: store.currentBody(row.other),
      scopes: store.scopeSlugsOf(row.other),
      created_at: row.other_created_at,
      updated_at: row.updated_at,
    }))
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));

  const owes = listCommitments(store, { status: 'open', owed_by: id });
  const owed = listCommitments(store, { status: 'open', owed_to: id });

  const shown = new Set([...growthNotes, ...owes, ...owed].map((item) => item.id));
  const others = new Map<string, PersonProfile['recent'][number]>();
  for (const row of rows) {
    if (shown.has(row.other)) continue;
    let entry = others.get(row.other);
    if (!entry) {
      entry = {
        id: row.other,
        kind: row.other_kind,
        layer: row.other_layer,
        title: row.title,
        status: row.status,
        links: [],
        last_activity: row.updated_at,
      };
      others.set(row.other, entry);
    }
    entry.links.push({ kind: row.kind, direction: row.direction });
    if (row.linked_at > entry.last_activity) entry.last_activity = row.linked_at;
  }
  const recentObjects = [...others.values()]
    .sort((a, b) => b.last_activity.localeCompare(a.last_activity) || b.id.localeCompare(a.id))
    .slice(0, recent);

  return { person, growth_notes: growthNotes, commitments: { owes, owed }, recent: recentObjects };
}
