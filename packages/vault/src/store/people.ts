import {
  type CommitmentView,
  effectiveStatus,
  type Kind,
  type Layer,
  type LinkKind,
  type ObjectView,
  type OpOutput,
} from '@bousleh/contracts';
import { instantOf } from '../days.js';
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

  const attrs = object.version.attrs as { role?: PersonProfile['person']['role']; org?: string; emails?: string[] };
  const person: PersonProfile['person'] = {
    id,
    name: object.version.title,
    role: attrs.role ?? null,
    org: attrs.org ?? null,
    emails: attrs.emails ?? [],
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
        status: effectiveStatus(row.other_kind, row.status),
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

// ---------------------------------------------------------------- people.list

type PeopleList = OpOutput<'people.list'>;
type PersonSummary = PeopleList['people'][number];
type Role = NonNullable<PersonSummary['role']>;

export interface PeopleFilter {
  roles?: readonly Role[] | undefined;
  scopes?: readonly string[] | undefined;
  org?: string | undefined;
  limit: number;
  now: Date;
}

/**
 * The latest touchpoint with a person: the newest held meeting they attended (by held_at, or when
 * it was filed if it has none), or the newest object linked about them (by when it was filed),
 * whichever is later. Planned meetings don't count; meetings with no status read as held, but one
 * dated after `now` hasn't happened (before Oct 25, Counsel filed prep as a future-dated meeting).
 */
export function lastTouchpoint(store: Store, personId: string, now: Date): PersonSummary['last_touchpoint'] {
  const rows = store.db
    .prepare(
      `SELECT l.kind, o.id, o.kind AS other_kind, o.created_at, c.title, c.status, json_extract(c.attrs_json, '$.held_at') AS held_at
       FROM links l JOIN objects o ON o.id = l.from_id JOIN current c ON c.object_id = o.id
       WHERE l.to_id = ? AND l.kind IN ('attended_by', 'about') AND ${LIVE_LINK}`,
    )
    .all(personId) as {
    kind: 'attended_by' | 'about';
    id: string;
    other_kind: Kind;
    created_at: string;
    title: string;
    status: string | null;
    held_at: string | null;
  }[];
  let best: { touchpoint: NonNullable<PersonSummary['last_touchpoint']>; t: number } | null = null;
  for (const row of rows) {
    let at: string;
    let via: 'attended' | 'about';
    if (row.kind === 'attended_by') {
      if (effectiveStatus('meeting', row.status) !== 'held') continue;
      at = row.held_at ?? row.created_at;
      via = 'attended';
    } else {
      at = row.created_at;
      via = 'about';
    }
    const t = instantOf(at)?.getTime();
    if (t === undefined || (via === 'attended' && t > now.getTime())) continue;
    if (best === null || t > best.t) best = { touchpoint: { at, via, object: { id: row.id, kind: row.other_kind, title: row.title } }, t };
  }
  return best?.touchpoint ?? null;
}

/** True when a person is in one of the covered scopes: their own, or, with none of their own, those of anything linked to them. */
function personInScopes(store: Store, person: ObjectView, covered: Set<string>): boolean {
  if (person.scopes.length > 0) return person.scopes.some((slug) => covered.has(slug));
  const linked = new Set([...person.links.out.map((l) => l.to), ...person.links.in.map((l) => l.from)]);
  for (const id of linked) if (store.scopeSlugsOf(id).some((slug) => covered.has(slug))) return true;
  return false;
}

/** People matching the filter, by name. */
export function listPeople(store: Store, filter: PeopleFilter): PeopleList {
  const covered = filter.scopes && filter.scopes.length > 0 ? store.expandScopes(filter.scopes) : undefined;
  const roles = filter.roles ? new Set<string>(filter.roles) : undefined;
  const org = filter.org?.trim().toLowerCase();

  const ids = store.db.prepare("SELECT id FROM objects WHERE kind = 'person' ORDER BY created_at, id").all() as { id: string }[];
  const matched: ObjectView[] = [];
  for (const { id } of ids) {
    const person = store.getObject(id);
    if (!person) continue;
    // Merged into another person (a live supersedes link points here): the other record speaks for them.
    if (person.links.in.some((l) => l.kind === 'supersedes')) continue;
    const attrs = person.version.attrs as { role?: Role; org?: string; is_user?: true };
    if (roles && (attrs.role === undefined || !roles.has(attrs.role))) continue;
    if (org !== undefined && attrs.org?.trim().toLowerCase() !== org) continue;
    if (covered && !personInScopes(store, person, covered)) continue;
    matched.push(person);
  }
  matched.sort((a, b) => a.version.title.localeCompare(b.version.title, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));

  const ref = (c: CommitmentView) => ({ id: c.id, title: c.title, due: c.due });
  const people = matched.slice(0, filter.limit).map((person): PersonSummary => {
    const attrs = person.version.attrs as { role?: Role; org?: string; emails?: string[]; is_user?: true };
    const manager = person.links.out.filter((l) => l.kind === 'reports_to' && l.to_kind === 'person').at(-1);
    return {
      id: person.id,
      name: person.version.title,
      role: attrs.role ?? null,
      org: attrs.org ?? null,
      emails: attrs.emails ?? [],
      scopes: person.scopes,
      is_user: attrs.is_user === true,
      reports_to: manager ? { id: manager.to, name: manager.to_title } : null,
      commitments: {
        owes: listCommitments(store, { status: 'open', owed_by: person.id }).map(ref),
        owed: listCommitments(store, { status: 'open', owed_to: person.id }).map(ref),
      },
      last_touchpoint: lastTouchpoint(store, person.id, filter.now),
    };
  });
  return { people, more: Math.max(0, matched.length - filter.limit) };
}
