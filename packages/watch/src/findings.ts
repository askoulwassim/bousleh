import { effectiveStatus, type ObjectView, type OpInput, type OpOutput, watchDigest, watchFile } from '@bousleh/contracts';
import { defineHandler, type HandlerContext } from '@bousleh/vault';
import { call } from './call.js';
import { loadWatchList, resolveWatchList } from './lists.js';

/* watch.file and watch.digest: findings from Horizon scans, filed against their watch lists. */

const DAY_MS = 24 * 60 * 60 * 1000;
/** How much of a finding's summary the digest shows. */
export const DIGEST_SUMMARY_CHARS = 500;

/** The url as stored: without its #fragment or utm_* tracking parameters. */
export function cleanUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = '';
  const tracking = [...url.searchParams.keys()].filter((key) => /^utm_/i.test(key));
  for (const key of tracking) url.searchParams.delete(key);
  return url.toString();
}

/** What two urls must share to count as the same finding: also ignores http vs https, www. and a trailing slash. */
export function urlKey(raw: string): string {
  const url = new URL(cleanUrl(raw));
  const protocol = url.protocol === 'http:' ? 'https:' : url.protocol;
  const host = url.host.replace(/^www\./, '');
  const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '';
  return `${protocol}//${host}${path}${url.search}`;
}

/** Every filed finding's url key, mapped to the finding's id. */
function filedUrls(h: HandlerContext): Map<string, string> {
  const rows = h.store.db
    .prepare(
      `SELECT o.id, json_extract(c.attrs_json, '$.url') AS url
       FROM objects o JOIN current c ON c.object_id = o.id
       WHERE o.kind = 'finding' ORDER BY o.created_at, o.id`,
    )
    .all() as { id: string; url: string | null }[];
  const byKey = new Map<string, string>();
  for (const row of rows) {
    if (!row.url) continue;
    try {
      const key = urlKey(row.url);
      if (!byKey.has(key)) byKey.set(key, row.id);
    } catch {
      // A url that no longer parses can't match anything new.
    }
  }
  return byKey;
}

export const watchFileHandler = defineHandler(watchFile, async (input, h) => {
  const list = await resolveWatchList(h, { id: input.watch_list_id, scope: input.scope });
  const known = filedUrls(h);
  const thisCall = new Set<string>();
  const filed: { id: string; title: string; url: string }[] = [];
  const skipped: { title: string; url: string; reason: 'already_filed' | 'repeated'; existing_id: string }[] = [];

  for (const finding of input.findings) {
    const url = cleanUrl(finding.url);
    const key = urlKey(url);
    const existing = known.get(key);
    if (existing !== undefined) {
      skipped.push({ title: finding.title, url, reason: thisCall.has(key) ? 'repeated' : 'already_filed', existing_id: existing });
      continue;
    }
    const attrs: Record<string, unknown> = { url };
    if (finding.published_at !== undefined) attrs.published_at = finding.published_at;
    const deposit: OpInput<'deposits.write'> = {
      kind: 'finding',
      title: finding.title,
      altitude: list.version.altitude,
      scopes: list.scopes,
      attrs,
      body: finding.summary ?? '',
      links: [{ kind: 'from_watch_list', to: list.id }],
    };
    const written = await call(h, 'deposits.write', deposit);
    known.set(key, written.id);
    thisCall.add(key);
    filed.push({ id: written.id, title: finding.title, url });
  }
  return { watch_list: { id: list.id, title: list.version.title, scopes: list.scopes }, filed, skipped };
});

function shorten(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

type FindingStatus = OpOutput<'watch.digest'>['groups'][number]['findings'][number]['status'];

interface DigestItem {
  finding: ObjectView;
  watchList: { id: string; title: string } | null;
}

export const watchDigestHandler = defineHandler(watchDigest, async (input, h) => {
  const until = h.ctx.now();
  // With a status filter and no since, the whole reading queue: no time window.
  const since =
    input.since !== undefined ? new Date(input.since) : input.status !== undefined ? new Date(0) : new Date(until.getTime() - 7 * DAY_MS);
  const statuses = input.status === undefined ? undefined : new Set<string>(input.status);
  const statusOf = (finding: ObjectView) => effectiveStatus('finding', finding.version.status) as FindingStatus;
  const inScope = input.scope === undefined ? undefined : h.store.expandScopes([input.scope]);
  if (input.watch_list_id !== undefined) await loadWatchList(h, input.watch_list_id);

  const rows = h.store.db
    .prepare("SELECT id FROM objects WHERE kind = 'finding' AND created_at >= ? AND created_at <= ? ORDER BY created_at DESC, id DESC")
    .all(since.toISOString(), until.toISOString()) as { id: string }[];

  const matched: DigestItem[] = [];
  for (const row of rows) {
    const finding = await call(h, 'vault.get', { id: row.id });
    if (inScope !== undefined && !finding.scopes.some((slug) => inScope.has(slug))) continue;
    if (statuses !== undefined && !statuses.has(statusOf(finding))) continue;
    const link = finding.links.out.find((l) => l.kind === 'from_watch_list');
    if (input.watch_list_id !== undefined && link?.to !== input.watch_list_id) continue;
    matched.push({ finding, watchList: link ? { id: link.to, title: link.to_title } : null });
  }

  // matched is newest-filed first, so the limit keeps the most recent findings.
  const groups = new Map<string, { watch_list: { id: string; title: string } | null; items: DigestItem[] }>();
  for (const item of matched.slice(0, input.limit)) {
    const key = item.watchList?.id ?? '';
    const group = groups.get(key) ?? { watch_list: item.watchList, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }

  const published = (item: DigestItem) => (item.finding.version.attrs.published_at as string | undefined) ?? null;
  const sortKey = (item: DigestItem) => published(item) ?? item.finding.created_at;
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.watch_list === null) return 1;
    if (b.watch_list === null) return -1;
    return a.watch_list.title.localeCompare(b.watch_list.title) || a.watch_list.id.localeCompare(b.watch_list.id);
  });

  return {
    since: since.toISOString(),
    until: until.toISOString(),
    total: matched.length,
    groups: ordered.map((group) => ({
      watch_list: group.watch_list,
      findings: group.items
        .sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
        .map((item) => ({
          id: item.finding.id,
          title: item.finding.version.title,
          status: statusOf(item.finding),
          url: item.finding.version.attrs.url as string,
          published_at: published(item),
          filed_at: item.finding.created_at,
          summary: shorten(item.finding.version.body, DIGEST_SUMMARY_CHARS),
        })),
    })),
  };
});
