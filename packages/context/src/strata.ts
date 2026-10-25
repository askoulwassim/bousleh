import {
  ALTITUDE_LABELS,
  ALTITUDES,
  contextStrata,
  effectiveStatus,
  type Kind,
  LAYERS,
  type ObjectView,
  type OpOutput,
  STRATA_HELD_MEETING_DAYS,
  type StrataObject,
} from '@bousleh/contracts';
import { defineHandler } from '@bousleh/vault';
import { call, coverScopes, dayOf, daysBetween, isReplaced, localDay, Objects } from './shared.js';

/*
 * context.strata: the cross-section Home draws. Columns are scopes (each covering its child
 * scopes), rows are the four altitudes, and each cell lists the live objects there. It reads the
 * same objects context.brief does, with the same idea of what is closed, but keeps every layer
 * and every altitude, so the page makes one call instead of twenty briefs.
 */

type Output = OpOutput<'context.strata'>;
type Cell = Output['cells'][number];

/** The kinds the strata shows. Terms, assets, dumps, daily notes and growth notes are left out. */
const SHOWN: readonly Kind[] = [
  'strategy',
  'principle',
  'metric',
  'watch_list',
  'signal',
  'observation',
  'finding',
  'problem',
  'idea',
  'initiative',
  'decision',
  'person',
  'meeting',
  'commitment',
];

/** Statuses that close an object: it leaves the grid and counts as closed. */
const CLOSED: Partial<Record<Kind, readonly string[]>> = {
  initiative: ['done', 'dropped'],
  problem: ['solved', 'dropped'],
  idea: ['concluded', 'dropped'],
  commitment: ['done', 'dropped'],
  finding: ['dismissed'],
};

const STRATEGY_ORDER = ['communicated', 'aligned', 'contested', 'forming'];

/** 0 needs you, 1 a bet, 2 moving (running, active, planned), 3 the rest. */
function tier(object: StrataObject): number {
  if (object.needs_you) return 0;
  if (object.kind === 'idea' && object.status === 'bet') return 1;
  if (
    (object.kind === 'idea' && object.status === 'running') ||
    (object.kind === 'initiative' && object.status === 'active') ||
    (object.kind === 'meeting' && object.status === 'planned')
  ) {
    return 2;
  }
  return 3;
}

export const contextStrataHandler = defineHandler(contextStrata, async (input, h) => {
  const day = input.date ?? localDay(h.ctx.now());
  const objects = new Objects(h);
  const me = h.store.userPerson() ?? null;

  // ------------------------------------------------------------ columns
  const scopes = h.store.listScopes();
  // Scope ids are ULIDs, so sorting by id is oldest first.
  const slugs =
    input.scopes ??
    scopes
      .filter((s) => s.parent === null)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((s) => s.slug);
  const covers = slugs.map((slug) => ({ slug, cover: coverScopes(h, [slug]).slugs ?? new Set<string>() }));
  const scopeBySlug = new Map(scopes.map((s) => [s.slug, s]));

  // ------------------------------------------------------------ people: last touchpoints, and placement for those with no scope
  const touch = new Map((await call(h, 'people.list', { limit: 200 })).people.map((p) => [p.id, p.last_touchpoint?.at]));
  const placedScopes = (object: ObjectView): string[] => {
    if (object.kind !== 'person' || object.scopes.length > 0) return object.scopes;
    const linked = new Set([...object.links.out.map((l) => l.to), ...object.links.in.map((l) => l.from)]);
    const out = new Set<string>();
    for (const id of linked) for (const slug of objects.get(id)?.scopes ?? []) out.add(slug);
    return [...out];
  };

  // ------------------------------------------------------------ every shown object, live or closed
  interface Placed {
    object: StrataObject;
    scopes: string[];
  }
  const live: Placed[] = [];
  const closed: Placed[] = [];
  for (const object of objects.ofKinds(SHOWN)) {
    if (isReplaced(object)) continue;
    const status = effectiveStatus(object.kind, object.version.status);
    const attrs = object.version.attrs;
    const placed = placedScopes(object);
    if (CLOSED[object.kind]?.includes(status ?? '')) {
      closed.push({ object: summarise(object, status), scopes: placed });
      continue;
    }
    if (object.kind === 'meeting' && status === 'held') {
      const heldDay = typeof attrs.held_at === 'string' ? dayOf(attrs.held_at) : dayOf(object.version.created_at);
      if (daysBetween(heldDay, day) > STRATA_HELD_MEETING_DAYS) continue;
    }
    live.push({ object: summarise(object, status), scopes: placed });
  }

  function summarise(object: ObjectView, status: string | null): StrataObject {
    const attrs = object.version.attrs;
    const base: StrataObject = {
      id: object.id,
      kind: object.kind,
      layer: object.layer,
      title: object.version.title,
      status,
      altitude: object.version.altitude,
      scopes: object.scopes,
      needs_you: false,
      updated_at: object.version.created_at,
    };
    switch (object.kind) {
      case 'idea': {
        if (typeof attrs.rank === 'number') base.rank = attrs.rank;
        if (typeof attrs.hypothesis === 'string') base.hypothesis = attrs.hypothesis;
        if (typeof attrs.kill_criteria === 'string') base.kill_criteria = attrs.kill_criteria;
        if (status === 'bet' || status === 'running') base.since = statusSince(object.id, status);
        break;
      }
      case 'commitment': {
        const due = typeof attrs.due === 'string' ? attrs.due : null;
        const by = object.links.out.filter((l) => l.kind === 'owed_by').map((l) => l.to);
        const to = object.links.out.filter((l) => l.kind === 'owed_to').map((l) => l.to);
        base.due = due;
        base.owed = me === null ? 'other' : by.includes(me.id) ? 'by_me' : to.includes(me.id) ? 'to_me' : 'other';
        const mine = me === null || base.owed === 'by_me';
        base.needs_you = status === 'open' && mine && (due === null || daysBetween(due, day) >= 0);
        break;
      }
      case 'meeting':
        if (typeof attrs.held_at === 'string') base.held_at = attrs.held_at;
        break;
      case 'person': {
        if (typeof attrs.role === 'string') base.role = attrs.role as NonNullable<StrataObject['role']>;
        const at = touch.get(object.id);
        if (at) base.last_touchpoint = at;
        break;
      }
      case 'watch_list': {
        base.entries = Array.isArray(attrs.entries) ? attrs.entries.length : 0;
        base.new_findings = object.links.in.filter((l) => {
          if (l.kind !== 'from_watch_list') return false;
          const finding = objects.get(l.from);
          return finding !== undefined && !isReplaced(finding) && effectiveStatus('finding', finding.version.status) === 'new';
        }).length;
        break;
      }
      case 'finding':
        if (typeof attrs.url === 'string') base.url = attrs.url;
        break;
    }
    return base;
  }

  /** When an object entered its current status: the first version of the latest run with that status. */
  function statusSince(id: string, status: string): string | undefined {
    const history = h.store.getObject(id, { history: true })?.history ?? [];
    let since: string | undefined;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const version = history[i];
      if (!version || version.status !== status) break;
      since = version.created_at;
    }
    return since;
  }

  // ------------------------------------------------------------ cells
  const cells: Cell[] = [];
  const shownIds = new Map<string, StrataObject>();
  const closedIds = new Set<string>();
  const inCover = (placed: Placed, cover: Set<string>) => placed.scopes.some((slug) => cover.has(slug));
  for (const { slug, cover } of covers) {
    for (const altitude of ALTITUDES) {
      const here = live
        .filter((p) => p.object.altitude === altitude && inCover(p, cover))
        .map((p) => p.object)
        .sort((a, b) => tier(a) - tier(b) || b.updated_at.localeCompare(a.updated_at) || a.id.localeCompare(b.id));
      const shut = closed.filter((p) => p.object.altitude === altitude && inCover(p, cover));
      const kinds: Record<string, number> = {};
      for (const object of here) {
        kinds[object.kind] = (kinds[object.kind] ?? 0) + 1;
        shownIds.set(object.id, object);
      }
      for (const p of shut) closedIds.add(p.object.id);
      cells.push({
        scope: slug,
        altitude,
        objects: here.slice(0, input.per_cell),
        count: here.length,
        more: Math.max(0, here.length - input.per_cell),
        closed: shut.length,
        kinds,
      });
    }
  }

  // ------------------------------------------------------------ column headers
  const columns: Output['columns'] = covers.map(({ slug, cover }) => {
    const scope = scopeBySlug.get(slug);
    const strategies = objects
      .ofKinds(['strategy'])
      .filter((s) => !isReplaced(s) && s.scopes.some((x) => cover.has(x)))
      .sort(
        (a, b) =>
          b.version.altitude - a.version.altitude ||
          // The column's own scope before its children, then the furthest along, then the newest.
          Number(b.scopes.includes(slug)) - Number(a.scopes.includes(slug)) ||
          STRATEGY_ORDER.indexOf(effectiveStatus('strategy', a.version.status) ?? 'forming') -
            STRATEGY_ORDER.indexOf(effectiveStatus('strategy', b.version.status) ?? 'forming') ||
          b.version.created_at.localeCompare(a.version.created_at),
      );
    const top = strategies[0];
    const assets = objects.ofKinds(['asset']).filter((a) => !isReplaced(a) && a.scopes.some((x) => cover.has(x))).length;
    return {
      slug,
      name: scope?.name ?? slug,
      kind: scope?.kind ?? 'project',
      strategy: top
        ? {
            id: top.id,
            title: top.version.title,
            status: (effectiveStatus('strategy', top.version.status) ?? 'forming') as NonNullable<
              Output['columns'][number]['strategy']
            >['status'],
          }
        : null,
      assets,
    };
  });

  const layers = Object.fromEntries(LAYERS.map((layer) => [layer, 0])) as Output['totals']['layers'];
  for (const object of shownIds.values()) layers[object.layer] += 1;

  return {
    date: day,
    me,
    columns,
    rows: ALTITUDES.map((altitude) => ({ altitude, label: ALTITUDE_LABELS[altitude] })),
    cells,
    totals: {
      layers,
      needs_you: [...shownIds.values()].filter((o) => o.needs_you).length,
      empty_cells: cells.filter((c) => c.count === 0).length,
      closed: closedIds.size,
    },
  };
});
