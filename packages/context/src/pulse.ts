import { type CommitmentView, type OpOutput, pulseToday } from '@bousleh/contracts';
import { defineHandler, OpError } from '@bousleh/vault';
import { addDays, call, coverScopes, dayOf, daysBetween, inCover, localDay, Objects, shorten, startOfDay } from './shared.js';

/* pulse.today: the daily picture. Built from commitments.list, metrics.list, watch.digest, inbox.list and queue.list. */

type Output = OpOutput<'pulse.today'>;
type Me = NonNullable<Output['me']>;
type Direction = 'by_me' | 'to_me' | 'other';

/** How many days a metric may go without a reading, by cadence. */
export const CADENCE_DAYS = { daily: 1, weekly: 7, monthly: 31, quarterly: 92 } as const;
/** For a metric with no cadence. */
export const DEFAULT_STALE_DAYS = 30;
/** Lifecycle statuses where readings are expected. */
const MEASURED = ['instrumented', 'measured', 'reviewed'] as const;
const SUMMARY_CHARS = 280;

/** Who "me" is: the person given, or else the one person on the most open commitments. */
function resolveMe(objects: Objects, given: string | undefined, open: CommitmentView[]): Me | null {
  if (given !== undefined) {
    const person = objects.get(given);
    if (!person) throw new OpError('not_found', `me: no object with id ${given}`);
    if (person.kind !== 'person') throw new OpError('invalid_input', `me: ${given} is a ${person.kind}, not a person`);
    return { id: person.id, name: person.version.title, inferred: false };
  }
  const counts = new Map<string, { name: string; n: number }>();
  for (const commitment of open) {
    const people = new Map([...commitment.owed_by, ...commitment.owed_to].map((p) => [p.id, p.name]));
    for (const [id, name] of people) counts.set(id, { name, n: (counts.get(id)?.n ?? 0) + 1 });
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const [first, second] = ranked;
  if (!first || (second && second[1].n === first[1].n)) return null;
  return { id: first[0], name: first[1].name, inferred: true };
}

function direction(commitment: CommitmentView, me: Me | null): Direction {
  if (me === null) return 'other';
  if (commitment.owed_by.some((p) => p.id === me.id)) return 'by_me';
  if (commitment.owed_to.some((p) => p.id === me.id)) return 'to_me';
  return 'other';
}

export const pulseTodayHandler = defineHandler(pulseToday, async (input, h) => {
  const day = input.date ?? localDay(h.ctx.now());
  const cover = coverScopes(h, input.scopes);
  const objects = new Objects(h);

  // ------------------------------------------------------------ commitments
  const allOpen = (await call(h, 'commitments.list', { status: 'open', limit: 200 })).commitments;
  const me = resolveMe(objects, input.me, allOpen);
  const open = allOpen.filter((c) => inCover(cover, c.scopes));
  const group = () => ({ by_me: [], to_me: [], other: [] }) as Output['commitments']['overdue'];
  const overdue = group();
  const dueToday = group();
  const counts = { by_me: 0, to_me: 0, other: 0 };
  for (const commitment of open) {
    const side = direction(commitment, me);
    counts[side] += 1;
    if (commitment.due === null) continue;
    const late = daysBetween(commitment.due, day);
    if (late > 0) overdue[side].push({ ...commitment, days_late: late });
    else if (late === 0) dueToday[side].push({ ...commitment, days_late: 0 });
  }
  for (const side of ['by_me', 'to_me', 'other'] as const) overdue[side].sort((a, b) => b.days_late - a.days_late);

  // ------------------------------------------------------------ meetings held that day
  const meetings: Output['meetings'] = [];
  for (const meeting of objects.ofKinds(['meeting'])) {
    const heldAt = meeting.version.attrs.held_at;
    if (typeof heldAt !== 'string' || dayOf(heldAt) !== day || !inCover(cover, meeting.scopes)) continue;
    meetings.push({
      id: meeting.id,
      title: meeting.version.title,
      held_at: heldAt,
      altitude: meeting.version.altitude,
      scopes: meeting.scopes,
      attendees: meeting.links.out.filter((l) => l.kind === 'attended_by').map((l) => ({ id: l.to, name: l.to_title })),
    });
  }
  // Date-only meetings first (time unknown), then by time.
  const sortKey = (heldAt: string) => (heldAt.length === 10 ? '' : new Date(heldAt).toISOString());
  meetings.sort((a, b) => sortKey(a.held_at).localeCompare(sortKey(b.held_at)) || a.title.localeCompare(b.title));

  // ------------------------------------------------------------ inbox and queue (no scopes)
  const inbox = await call(h, 'inbox.list', {});
  const queue = await call(h, 'queue.list', {});

  // ------------------------------------------------------------ metrics without a recent reading
  const metrics = (await call(h, 'metrics.list', { status: [...MEASURED] })).metrics;
  const staleMetrics: Output['stale_metrics'] = [];
  for (const metric of metrics) {
    if (!inCover(cover, metric.scopes)) continue;
    const within = metric.cadence ? CADENCE_DAYS[metric.cadence] : DEFAULT_STALE_DAYS;
    const reading = metric.latest_reading;
    const readDay = reading ? dayOf(reading.observed_at) : null;
    const since = readDay === null ? null : daysBetween(readDay, day);
    if (since !== null && since <= within) continue;
    staleMetrics.push({
      id: metric.id,
      title: metric.title,
      status: metric.status,
      altitude: metric.altitude,
      scopes: metric.scopes,
      cadence: metric.cadence,
      expected_within_days: within,
      latest_reading: reading ? { value: reading.value, unit: reading.unit, observed_at: reading.observed_at } : null,
      days_since: since,
      owner: metric.owner,
    });
  }
  // Never read first, then the longest overdue relative to the cadence.
  staleMetrics.sort((a, b) => {
    const lateness = (m: (typeof staleMetrics)[number]) =>
      m.days_since === null ? Number.POSITIVE_INFINITY : m.days_since - m.expected_within_days;
    return lateness(b) - lateness(a) || a.title.localeCompare(b.title);
  });

  // ------------------------------------------------------------ findings filed since the start of yesterday
  const since = startOfDay(addDays(day, -1));
  const until = startOfDay(addDays(day, 1));
  const digest = await call(h, 'watch.digest', { since: since.toISOString(), limit: 500 });
  const findings: Output['new_findings']['findings'] = [];
  for (const groupOf of digest.groups) {
    for (const finding of groupOf.findings) {
      if (Date.parse(finding.filed_at) >= until.getTime()) continue;
      const object = objects.get(finding.id);
      if (!object || !inCover(cover, object.scopes)) continue;
      findings.push({ ...finding, summary: shorten(finding.summary, SUMMARY_CHARS), watch_list: groupOf.watch_list });
    }
  }
  findings.sort((a, b) => b.filed_at.localeCompare(a.filed_at) || a.id.localeCompare(b.id));

  // ------------------------------------------------------------ open bets
  const openBets: Output['open_bets'] = objects
    .ofKinds(['idea'])
    .filter((idea) => idea.version.status === 'bet' && inCover(cover, idea.scopes))
    .map((idea) => ({
      id: idea.id,
      title: idea.version.title,
      altitude: idea.version.altitude,
      scopes: idea.scopes,
      hypothesis: (idea.version.attrs.hypothesis as string | undefined) ?? null,
      kill_criteria: (idea.version.attrs.kill_criteria as string | undefined) ?? null,
      updated_at: idea.version.created_at,
    }))
    .sort((a, b) => b.altitude - a.altitude || a.title.localeCompare(b.title));

  return {
    date: day,
    scopes: cover.slugs ? [...cover.slugs].sort() : [],
    me,
    commitments: { overdue, due_today: dueToday, open: counts },
    meetings,
    inbox: { waiting: inbox.files.length, oldest_arrived_at: inbox.files[0]?.arrived_at ?? null, queued: queue.items.length },
    stale_metrics: staleMetrics,
    new_findings: { since: since.toISOString(), total: findings.length, findings },
    open_bets: openBets,
  };
});
