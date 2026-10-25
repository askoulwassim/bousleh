import type { Kind, ObjectView, OpInput, OpName, OpOutput } from '@bousleh/contracts';
import { type HandlerContext, OpError } from '@bousleh/vault';

/* Helpers both context.brief and pulse.today use. Everything here only reads. */

/**
 * Run another op inside this one and return its output, or rethrow its error so this op fails
 * with the same code and message.
 */
export async function call<N extends OpName>(h: HandlerContext, name: N, input: OpInput<N>): Promise<OpOutput<N>> {
  const outcome = await h.runOp(name, input, h.ctx);
  if (outcome.status === 'ok') return outcome.output as OpOutput<N>;
  if (outcome.code === 'not_found' || outcome.code === 'conflict' || outcome.code === 'invalid_input') {
    throw new OpError(outcome.code, outcome.message, outcome.issues);
  }
  throw new Error(`${name} failed (${outcome.code}): ${outcome.message}`);
}

/** Objects read through the store, each once per op. */
export class Objects {
  private readonly cache = new Map<string, ObjectView | undefined>();
  constructor(private readonly h: HandlerContext) {}

  get(id: string): ObjectView | undefined {
    if (!this.cache.has(id)) this.cache.set(id, this.h.store.getObject(id));
    return this.cache.get(id);
  }

  /** Ids of every object of these kinds, oldest first. The one place this package reads the tables directly. */
  idsOfKinds(kinds: readonly Kind[]): string[] {
    if (kinds.length === 0) return [];
    const rows = this.h.store.db
      .prepare(`SELECT id FROM objects WHERE kind IN (${kinds.map(() => '?').join(', ')}) ORDER BY created_at, id`)
      .all(...kinds) as { id: string }[];
    return rows.map((row) => row.id);
  }

  /** Current objects of these kinds. */
  ofKinds(kinds: readonly Kind[]): ObjectView[] {
    return this.idsOfKinds(kinds).flatMap((id) => {
      const object = this.get(id);
      return object ? [object] : [];
    });
  }
}

/** True when another object replaces this one (a live `supersedes` link points at it). */
export function isReplaced(object: ObjectView): boolean {
  return object.links.in.some((link) => link.kind === 'supersedes');
}

/** The scopes an op covers: the slugs asked for plus every child scope under them. */
export interface ScopeCover {
  /** Null: every scope. */
  slugs: Set<string> | null;
  /** The slug asked for that covers each covered slug (itself, or the ancestor that was asked for). */
  via: Map<string, string>;
  /** Parent slug of every scope. */
  parents: Map<string, string | null>;
}

export function coverScopes(h: HandlerContext, asked: readonly string[] | undefined): ScopeCover {
  const scopes = h.store.listScopes();
  const parents = new Map(scopes.map((scope) => [scope.slug, scope.parent]));
  if (asked === undefined || asked.length === 0) return { slugs: null, via: new Map(), parents };

  const unknown = asked.filter((slug) => !parents.has(slug));
  if (unknown.length > 0) throw new OpError('invalid_input', `no scope named ${unknown.join(', ')}; scopes.list shows them all`);

  const via = new Map<string, string>();
  for (const slug of parents.keys()) {
    // Walk up from each scope; the first ancestor (or itself) that was asked for covers it.
    const seen = new Set<string>();
    for (let at: string | null | undefined = slug; at && !seen.has(at); at = parents.get(at)) {
      seen.add(at);
      if (asked.includes(at)) {
        via.set(slug, at);
        break;
      }
    }
  }
  return { slugs: new Set(via.keys()), via, parents };
}

/** Every ancestor of these scopes, nearest first, excluding the scopes themselves. */
export function ancestorsOf(cover: ScopeCover, slugs: Iterable<string>): string[] {
  const own = new Set(slugs);
  const out: string[] = [];
  for (const slug of own) {
    const seen = new Set<string>([slug]);
    for (let at = cover.parents.get(slug); at && !seen.has(at); at = cover.parents.get(at)) {
      seen.add(at);
      if (!own.has(at) && !out.includes(at)) out.push(at);
    }
  }
  return out;
}

/** True when an object is in at least one covered scope (always, when every scope is covered). */
export function inCover(cover: ScopeCover, scopes: readonly string[]): boolean {
  return cover.slugs === null || scopes.some((slug) => cover.slugs?.has(slug));
}

/** Text cut at a word boundary, whitespace collapsed. */
export function shorten(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

// ---------------------------------------------------------------- days

/* Days are calendar days on this machine's clock; the helpers live in @bousleh/vault so every package reads dates the same way. */
export { addDays, dayOf, daysBetween, localDay, startOfDay } from '@bousleh/vault';
