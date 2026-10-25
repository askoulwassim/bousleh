import { type OpOutput, signalsPatterns } from '@bousleh/contracts';
import { defineHandler, isDateOnly, windowEnd, windowStart } from '@bousleh/vault';

/*
 * signals.patterns: feedback counted by tag. Reads signals filed in the window (by when they were
 * filed), leaves out those another signal replaced (supersedes), and groups the rest by tag.
 */

type Output = OpOutput<'signals.patterns'>;
type Pattern = Output['patterns'][number];
type Sentiment = keyof Pattern['sentiment'];

const DAY_MS = 24 * 60 * 60 * 1000;
/** The default window: this many days back from until. */
export const PATTERN_WINDOW_DAYS = 30;
const EXAMPLES = 5;
const SENTIMENTS: readonly Sentiment[] = ['positive', 'neutral', 'negative', 'mixed'];

interface Group {
  tag: string;
  signals: { id: string; title: string; source: string | null; sentiment: string | null; filed_at: string }[];
  sources: Map<string, number>;
  people: Map<string, { name: string; n: number }>;
  sentiment: Pattern['sentiment'];
}

/** Keys of a count map, most frequent first, then alphabetically. */
function byCount<T>(entries: [string, T][], n: (value: T) => number, name: (key: string, value: T) => string): [string, T][] {
  return entries.sort((a, b) => n(b[1]) - n(a[1]) || name(a[0], a[1]).localeCompare(name(b[0], b[1])));
}

export const signalsPatternsHandler = defineHandler(signalsPatterns, (input, h) => {
  const until = input.until !== undefined ? windowEnd(input.until) : h.ctx.now();
  const since = input.since !== undefined ? windowStart(input.since) : new Date(until.getTime() - PATTERN_WINDOW_DAYS * DAY_MS);
  const inScope = input.scopes === undefined || input.scopes.length === 0 ? undefined : h.store.expandScopes(input.scopes);
  // A date until ends at the next local midnight, which is outside the window; a date-time until is inside it.
  const endExclusive = input.until !== undefined && isDateOnly(input.until);
  const inWindow = (filed: number) => filed >= since.getTime() && (endExclusive ? filed < until.getTime() : filed <= until.getTime());

  const rows = h.store.db.prepare("SELECT id, created_at FROM objects WHERE kind = 'signal' ORDER BY created_at DESC, id DESC").all() as {
    id: string;
    created_at: string;
  }[];

  let total = 0;
  let untagged = 0;
  const groups = new Map<string, Group>();
  for (const row of rows) {
    if (!inWindow(Date.parse(row.created_at))) continue;
    const signal = h.store.getObject(row.id);
    if (!signal) continue;
    if (inScope !== undefined && !signal.scopes.some((slug) => inScope.has(slug))) continue;
    if (signal.links.in.some((link) => link.kind === 'supersedes')) continue;

    total += 1;
    const attrs = signal.version.attrs as { tags?: string[]; source?: string; sentiment?: string };
    const tags = [...new Set(attrs.tags ?? [])];
    if (tags.length === 0) {
      untagged += 1;
      continue;
    }
    const source = attrs.source?.trim() || null;
    const sentiment = attrs.sentiment ?? null;
    const people = new Map(
      signal.links.out.filter((link) => link.kind === 'about' && link.to_kind === 'person').map((link) => [link.to, link.to_title]),
    );
    for (const tag of tags) {
      let group = groups.get(tag);
      if (!group) {
        group = {
          tag,
          signals: [],
          sources: new Map(),
          people: new Map(),
          sentiment: { positive: 0, neutral: 0, negative: 0, mixed: 0, unknown: 0 },
        };
        groups.set(tag, group);
      }
      group.signals.push({ id: signal.id, title: signal.version.title, source, sentiment, filed_at: signal.created_at });
      if (source !== null) group.sources.set(source, (group.sources.get(source) ?? 0) + 1);
      for (const [id, name] of people) group.people.set(id, { name, n: (group.people.get(id)?.n ?? 0) + 1 });
      const mood = SENTIMENTS.find((s) => s === sentiment) ?? 'unknown';
      group.sentiment[mood] += 1;
    }
  }

  const patterns: Pattern[] = [...groups.values()]
    .filter((group) => group.signals.length >= input.min_count)
    .map((group) => ({
      tag: group.tag,
      count: group.signals.length,
      sources: byCount(
        [...group.sources],
        (n) => n,
        (key) => key,
      ).map(([source]) => source),
      people: byCount(
        [...group.people],
        (p) => p.n,
        (_, p) => p.name,
      ).map(([id, p]) => ({ id, name: p.name })),
      sentiment: group.sentiment,
      // rows run newest first, so each group's signals do too.
      newest_at: group.signals[0]?.filed_at as string,
      examples: group.signals.slice(0, EXAMPLES),
    }))
    .sort(
      (a, b) =>
        b.count - a.count || b.people.length - a.people.length || b.newest_at.localeCompare(a.newest_at) || a.tag.localeCompare(b.tag),
    );

  return {
    since: since.toISOString(),
    until: until.toISOString(),
    scopes: inScope ? [...inScope].sort() : [],
    signals: total,
    untagged,
    patterns: patterns.slice(0, input.limit),
    more: Math.max(0, patterns.length - input.limit),
  };
});
