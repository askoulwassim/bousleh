import {
  ALTITUDES,
  type Altitude,
  BRIEF_SECTIONS,
  type BriefRef,
  type BriefSection,
  type CommitmentView,
  contextBrief,
  type Kind,
  type MetricSummary,
  type ObjectView,
  type OpOutput,
} from '@bousleh/contracts';
import { defineHandler, OpError } from '@bousleh/vault';
import { ancestorsOf, call, coverScopes, inCover, isReplaced, Objects, shorten } from './shared.js';

/*
 * context.brief: what to know before advising at an altitude.
 * 1. The centre: the ids asked for, and the best matches for focus (vault.search).
 * 2. One hop out: everything linked to the centre, in either direction.
 * 3. With no centre, the scopes as a whole: open problems and ideas, decisions, metrics, open commitments.
 * 4. Anchors of the scopes (and their parent scopes) at or above one level below the altitude, and
 *    the metrics that serve them.
 * 5. Evidence linked to what is shown, then the people involved in it.
 * Everything else keeps to the altitude band: the altitude asked for, one level above and one below.
 */

type Output = OpOutput<'context.brief'>;

const SECTION_OF: Partial<Record<Kind, BriefSection>> = {
  strategy: 'anchors',
  principle: 'anchors',
  problem: 'problems',
  idea: 'ideas',
  decision: 'decisions',
  metric: 'metrics',
  person: 'people',
  commitment: 'commitments',
  signal: 'evidence',
  observation: 'evidence',
  finding: 'evidence',
};
const ANCHOR_KINDS: readonly Kind[] = ['strategy', 'principle'];
const EVIDENCE_KINDS: readonly Kind[] = ['signal', 'observation', 'finding'];
/** Sections that carry a snippet of the body. */
const SNIPPETS: ReadonlySet<BriefSection> = new Set(['anchors', 'problems', 'ideas', 'decisions', 'evidence']);
/** How many search matches become the centre. */
export const CENTRE_FROM_SEARCH = 5;
const SNIPPET_CHARS = 200;
const MAX_REASONS = 4;
/** Idea statuses, in the order the ideas section lists them. */
const IDEA_ORDER = ['bet', 'open', 'parked', 'concluded', 'dropped'];

/** How close an object is to the centre: 0 the centre, 1 linked to it, 2 the rest. */
type Tier = 0 | 1 | 2;

interface Entry {
  object: ObjectView;
  tier: Tier;
  why: string[];
  snippet?: string;
}

/** What the brief has picked so far, each object once, with every reason it was picked. */
class Picked {
  readonly entries = new Map<string, Entry>();

  add(object: ObjectView, tier: Tier, why: string, snippet?: string): void {
    const entry = this.entries.get(object.id);
    if (!entry) {
      this.entries.set(object.id, { object, tier, why: [why], ...(snippet ? { snippet } : {}) });
      return;
    }
    if (tier < entry.tier) entry.tier = tier;
    if (!entry.why.includes(why)) entry.why.push(why);
    if (snippet && !entry.snippet) entry.snippet = snippet;
  }

  inSection(section: BriefSection): Entry[] {
    return [...this.entries.values()].filter((entry) => SECTION_OF[entry.object.kind] === section);
  }
}

/** The altitude asked for, one level above and one below. */
export function altitudeBand(altitude: Altitude): Altitude[] {
  const i = ALTITUDES.indexOf(altitude);
  return ALTITUDES.slice(Math.max(0, i - 1), i + 2);
}

const quoted = (object: ObjectView) => `"${object.version.title}"`;

/** Why an object linked to another is included. `fromLinked`: the link runs from it to the other object. */
function linkedTo(kind: string, other: ObjectView, fromLinked: boolean): string {
  if (kind === 'evidence_for' && fromLinked) return `evidence for ${quoted(other)}`;
  return `linked to ${quoted(other)} (${kind})`;
}

/** Why a person is involved in an object, from the link between them. */
function involvement(kind: string, object: ObjectView): string {
  switch (kind) {
    case 'owned_by':
      return `owns ${quoted(object)}`;
    case 'attended_by':
      return `attended ${quoted(object)}`;
    case 'owed_by':
      return `owes ${quoted(object)}`;
    case 'owed_to':
      return `is owed ${quoted(object)}`;
    case 'about':
      return `${quoted(object)} is about them`;
    default:
      return `linked to ${quoted(object)} (${kind})`;
  }
}

export const contextBriefHandler = defineHandler(contextBrief, async (input, h) => {
  const objects = new Objects(h);
  const cover = coverScopes(h, input.scopes);
  const band = altitudeBand(input.altitude);
  const floor = Math.min(...band);

  /** Within the altitude band (anchors: at or above its floor). People have no meaningful altitude. */
  const fits = (object: ObjectView) => {
    if (object.kind === 'person') return true;
    if (ANCHOR_KINDS.includes(object.kind)) return object.version.altitude >= floor;
    return band.includes(object.version.altitude);
  };
  /** In the band, in the covered scopes (people may have none), and not replaced by another object. */
  const eligible = (object: ObjectView) =>
    fits(object) && (object.kind === 'person' || inCover(cover, object.scopes)) && !isReplaced(object);
  const scopeReason = (object: ObjectView) => {
    const slug = cover.slugs ? object.scopes.find((s) => cover.slugs?.has(s)) : undefined;
    return slug ? `in scope ${slug}` : 'in your data';
  };

  const picked = new Picked();
  const centre: Output['centre'] = [];

  // ------------------------------------------------------------ 1. the centre
  for (const id of new Set(input.ids ?? [])) {
    const object = objects.get(id);
    if (!object) throw new OpError('not_found', `ids: no object with id ${id}`);
    picked.add(object, 0, 'asked for');
    centre.push({ id, kind: object.kind, title: object.version.title, why: 'asked for' });
  }

  let match: Output['match'] = null;
  if (input.focus !== undefined) {
    const search = await call(h, 'vault.search', {
      query: input.focus,
      ...(cover.slugs ? { scopes: [...cover.slugs] } : {}),
      limit: 50,
    });
    let taken = 0;
    for (const hit of search.hits) {
      if (taken >= CENTRE_FROM_SEARCH) break;
      const object = objects.get(hit.id);
      if (!object || !eligible(object)) continue;
      taken += 1;
      picked.add(object, 0, 'matches focus', hit.snippet || undefined);
      if (!centre.some((c) => c.id === hit.id))
        centre.push({ id: hit.id, kind: object.kind, title: object.version.title, why: 'matches focus' });
    }
    if (taken > 0) match = search.match;
  }

  // ------------------------------------------------------------ 2. one hop out from the centre
  const centreObjects = centre.flatMap((c) => objects.get(c.id) ?? []);
  for (const object of centreObjects) {
    const neighbours = [
      ...object.links.out.map((link) => ({ id: link.to, kind: link.kind, otherKind: link.to_kind, fromLinked: false })),
      ...object.links.in.map((link) => ({ id: link.from, kind: link.kind, otherKind: link.from_kind, fromLinked: true })),
    ];
    for (const neighbour of neighbours) {
      // People get their reasons below, from what they own, attend and owe.
      if (neighbour.otherKind === 'person') continue;
      const other = objects.get(neighbour.id);
      if (other && eligible(other)) picked.add(other, 1, linkedTo(neighbour.kind, object, neighbour.fromLinked));
    }
  }

  // ------------------------------------------------------------ 3. no centre: the scopes as a whole
  if (centre.length === 0) {
    for (const object of objects.ofKinds(['problem', 'idea', 'decision', 'metric', 'commitment'])) {
      if (!eligible(object)) continue;
      if (object.kind === 'idea' && !['open', 'bet'].includes(object.version.status ?? '')) continue;
      if (object.kind === 'commitment' && object.version.status !== 'open') continue;
      picked.add(object, 2, scopeReason(object));
    }
  }

  // ------------------------------------------------------------ 4. anchors, and the metrics that serve them
  // Whose anchors: the scopes asked for; else the centre's scopes (or, for a centre with none, such
  // as a person, the scopes of what it links to); else every scope. Parent scopes' anchors come too.
  let ownScopes: Set<string> | null = cover.slugs;
  if (ownScopes === null && centreObjects.length > 0) {
    ownScopes = new Set(centreObjects.flatMap((object) => object.scopes));
    if (ownScopes.size === 0) ownScopes = new Set([...picked.entries.values()].flatMap((entry) => entry.object.scopes));
  }
  const anchorScopes = ownScopes === null ? null : new Set([...ownScopes, ...ancestorsOf(cover, ownScopes)]);
  for (const anchor of objects.ofKinds(ANCHOR_KINDS)) {
    if (!fits(anchor) || isReplaced(anchor)) continue;
    if (anchorScopes === null) {
      picked.add(anchor, 2, 'anchor');
      continue;
    }
    const own = anchor.scopes.find((slug) => ownScopes?.has(slug));
    const parent = anchor.scopes.find((slug) => anchorScopes?.has(slug));
    if (own) picked.add(anchor, 2, `anchor of scope ${own}`);
    else if (parent) picked.add(anchor, 2, `anchor of parent scope ${parent}`);
  }
  for (const { object: strategy } of picked.inSection('anchors')) {
    for (const link of strategy.links.in) {
      if (link.kind !== 'serves') continue;
      const metric = objects.get(link.from);
      if (metric && eligible(metric)) picked.add(metric, 2, `serves ${quoted(strategy)}`);
    }
  }

  // ------------------------------------------------------------ assemble the sections
  const commitments = new Map<string, CommitmentView>(
    (await call(h, 'commitments.list', { status: 'open', limit: 200 })).commitments.map((c) => [c.id, c]),
  );
  const metrics = new Map<string, MetricSummary>((await call(h, 'metrics.list', {})).metrics.map((m) => [m.id, m]));

  const more = Object.fromEntries(BRIEF_SECTIONS.map((section) => [section, 0])) as Output['more'];
  const take = (section: BriefSection, entries: Entry[], order: (a: Entry, b: Entry) => number): Entry[] => {
    const sorted = [...entries].sort((a, b) => a.tier - b.tier || order(a, b) || a.object.id.localeCompare(b.object.id));
    more[section] = Math.max(0, sorted.length - input.limit);
    return sorted.slice(0, input.limit);
  };
  const updated = (entry: Entry) => entry.object.version.created_at;
  const newestFirst = (a: Entry, b: Entry) => updated(b).localeCompare(updated(a));

  const anchors = take('anchors', picked.inSection('anchors'), (a, b) => b.object.version.altitude - a.object.version.altitude);
  const problems = take('problems', picked.inSection('problems'), newestFirst);
  const ideas = take('ideas', picked.inSection('ideas'), (a, b) => {
    const rank = (entry: Entry) => IDEA_ORDER.indexOf(entry.object.version.status ?? 'open');
    return rank(a) - rank(b) || newestFirst(a, b);
  });
  const decidedAt = (entry: Entry) => (entry.object.version.attrs.decided_at as string | undefined) ?? updated(entry);
  const decisions = take('decisions', picked.inSection('decisions'), (a, b) => decidedAt(b).localeCompare(decidedAt(a)));
  const metricEntries = take(
    'metrics',
    picked.inSection('metrics').filter((entry) => metrics.has(entry.object.id)),
    (a, b) => a.object.version.title.localeCompare(b.object.version.title),
  );
  const due = (entry: Entry) => commitments.get(entry.object.id)?.due ?? '9999-12-31';
  const commitmentEntries = take(
    'commitments',
    picked.inSection('commitments').filter((entry) => commitments.has(entry.object.id)),
    (a, b) => due(a).localeCompare(due(b)),
  );

  // ------------------------------------------------------------ 5. evidence linked to what is shown
  const shown = [...anchors, ...problems, ...ideas, ...decisions, ...metricEntries, ...commitmentEntries];
  for (const { object } of [...centreObjects.map((object) => ({ object })), ...shown]) {
    const linked = [
      ...object.links.out.map((link) => ({ id: link.to, kind: link.kind, otherKind: link.to_kind, fromLinked: false })),
      ...object.links.in.map((link) => ({ id: link.from, kind: link.kind, otherKind: link.from_kind, fromLinked: true })),
    ];
    for (const link of linked) {
      if (!EVIDENCE_KINDS.includes(link.otherKind)) continue;
      const evidence = objects.get(link.id);
      if (evidence && eligible(evidence)) picked.add(evidence, 2, linkedTo(link.kind, object, link.fromLinked));
    }
  }
  const evidence = take('evidence', picked.inSection('evidence'), (a, b) => b.object.created_at.localeCompare(a.object.created_at));

  // ------------------------------------------------------------ the people involved
  // The centre, everything shown, and what the centre links to that has no section of its own (meetings, initiatives…).
  const involved = [
    ...[...picked.entries.values()].filter((entry) => entry.tier === 0),
    ...shown,
    ...evidence,
    ...[...picked.entries.values()].filter((entry) => entry.tier <= 1 && SECTION_OF[entry.object.kind] === undefined),
  ];
  for (const { object, tier } of involved) {
    for (const link of object.links.out) {
      if (link.to_kind !== 'person') continue;
      const person = objects.get(link.to);
      if (person) picked.add(person, tier === 0 ? 1 : 2, involvement(link.kind, object));
    }
    for (const link of object.links.in) {
      if (link.from_kind !== 'person') continue;
      const person = objects.get(link.from);
      if (person) picked.add(person, tier === 0 ? 1 : 2, linkedTo(link.kind, object, true));
    }
  }
  const people = take(
    'people',
    picked.inSection('people'),
    (a, b) => b.why.length - a.why.length || a.object.version.title.localeCompare(b.object.version.title),
  );

  // ------------------------------------------------------------ refs
  const ref = (entry: Entry, section: BriefSection): BriefRef => {
    const { object } = entry;
    const snippet = entry.snippet ?? (SNIPPETS.has(section) ? shorten(object.version.body, SNIPPET_CHARS) : '');
    return {
      id: object.id,
      kind: object.kind,
      title: object.version.title,
      altitude: object.version.altitude,
      status: object.version.status,
      scopes: object.scopes,
      ...(snippet ? { snippet } : {}),
      why: entry.why.slice(0, MAX_REASONS),
    };
  };
  const attr = <T>(object: ObjectView, key: string): T | null => (object.version.attrs[key] as T | undefined) ?? null;

  return {
    altitude: input.altitude,
    altitudes: band,
    scopes: cover.slugs ? [...cover.slugs].sort() : [],
    centre,
    match,
    anchors: anchors.map((entry) => ref(entry, 'anchors')),
    problems: problems.map((entry) => ref(entry, 'problems')),
    ideas: ideas.map((entry) => ({
      ...ref(entry, 'ideas'),
      hypothesis: attr<string>(entry.object, 'hypothesis'),
      kill_criteria: attr<string>(entry.object, 'kill_criteria'),
    })),
    decisions: decisions.map((entry) => ({
      ...ref(entry, 'decisions'),
      decided_at: attr<string>(entry.object, 'decided_at'),
      reversible: attr<boolean>(entry.object, 'reversible'),
    })),
    metrics: metricEntries.map((entry) => {
      const metric = metrics.get(entry.object.id) as MetricSummary;
      const reading = metric.latest_reading;
      return {
        ...ref(entry, 'metrics'),
        cadence: metric.cadence,
        unit: metric.unit,
        latest_reading: reading ? { value: reading.value, unit: reading.unit, observed_at: reading.observed_at } : null,
      };
    }),
    people: people.map((entry) => ({
      ...ref(entry, 'people'),
      role: attr<NonNullable<Output['people'][number]['role']>>(entry.object, 'role'),
      org: attr<string>(entry.object, 'org'),
    })),
    commitments: commitmentEntries.map((entry) => {
      const commitment = commitments.get(entry.object.id) as CommitmentView;
      return { ...ref(entry, 'commitments'), due: commitment.due, owed_by: commitment.owed_by, owed_to: commitment.owed_to };
    }),
    evidence: evidence.map((entry) => ({
      ...ref(entry, 'evidence'),
      url: attr<string>(entry.object, 'url'),
      published_at: attr<string>(entry.object, 'published_at'),
      filed_at: entry.object.created_at,
    })),
    more,
  };
});
