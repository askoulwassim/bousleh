import { type CommitmentView, effectiveStatus, NO_DUE_LIMIT, type OpOutput, pulseToday, TOUCHPOINT_DUE_DAYS } from '@bousleh/contracts';
import { defineHandler, instantOf, OpError } from '@bousleh/vault';
import { addDays, call, coverScopes, dayOf, daysBetween, inCover, localDay, Objects, shorten, startOfDay } from './shared.js';

/* pulse.today: the daily picture. Built from commitments.list, metrics.list, people.list, watch.digest, inbox.list and queue.list. */

type Output = OpOutput<'pulse.today'>;
type Me = NonNullable<Output['me']>;
type Direction = 'by_me' | 'to_me' | 'other';

/** How many days a metric may go without a reading, by cadence. */
export const CADENCE_DAYS = { daily: 1, weekly: 7, monthly: 31, quarterly: 92 } as const;
/** For a metric with no cadence. */
export const DEFAULT_STALE_DAYS = 30;
/** The roles Pulse keeps in touch with. */
const TOUCHPOINT_ROLES = ['pm', 'stakeholder', 'engineer'] as const;
/** Lifecycle statuses where readings are expected. */
const MEASURED = ['instrumented', 'measured', 'reviewed'] as const;
const SUMMARY_CHARS = 280;

/**
 * Who "me" is: the person given; else the person marked `is_user`; else, as a fallback, the one
 * person on the most open commitments (returned with inferred: true).
 */
function resolveMe(
  objects: Objects,
  given: string | undefined,
  user: { id: string; name: string } | undefined,
  open: CommitmentView[],
): Me | null {
  if (given !== undefined) {
    const person = objects.get(given);
    if (!person) throw new OpError('not_found', `me: no object with id ${given}`);
    if (person.kind !== 'person') throw new OpError('invalid_input', `me: ${given} is a ${person.kind}, not a person`);
    return { id: person.id, name: person.version.title, inferred: false };
  }
  if (user) return { id: user.id, name: user.name, inferred: false };
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
  const me = resolveMe(objects, input.me, h.store.userPerson(), allOpen);
  const open = allOpen.filter((c) => inCover(cover, c.scopes));
  const group = () => ({ by_me: [], to_me: [], other: [] }) as Output['commitments']['overdue'];
  const overdue = group();
  const dueToday = group();
  const counts = { by_me: 0, to_me: 0, other: 0 };
  const undated: Record<'by_me' | 'to_me', Output['commitments']['no_due']['by_me']> = { by_me: [], to_me: [] };
  for (const commitment of open) {
    const side = direction(commitment, me);
    counts[side] += 1;
    if (commitment.due === null) {
      const filedAt = objects.get(commitment.id)?.created_at;
      if (side !== 'other' && filedAt) undated[side].push({ ...commitment, filed_at: filedAt });
      continue;
    }
    const late = daysBetween(commitment.due, day);
    if (late > 0) overdue[side].push({ ...commitment, days_late: late });
    else if (late === 0) dueToday[side].push({ ...commitment, days_late: 0 });
  }
  for (const side of ['by_me', 'to_me', 'other'] as const) overdue[side].sort((a, b) => b.days_late - a.days_late);
  // No due date: oldest filed first, capped per side.
  const noDue: Output['commitments']['no_due'] = { by_me: [], to_me: [], more: { by_me: 0, to_me: 0 } };
  for (const side of ['by_me', 'to_me'] as const) {
    const sorted = undated[side].sort((a, b) => a.filed_at.localeCompare(b.filed_at) || a.id.localeCompare(b.id));
    noDue[side] = sorted.slice(0, NO_DUE_LIMIT);
    noDue.more[side] = Math.max(0, sorted.length - NO_DUE_LIMIT);
  }

  // ------------------------------------------------------------ meetings that day, planned or held
  const meetings: Output['meetings'] = [];
  for (const meeting of objects.ofKinds(['meeting'])) {
    const heldAt = meeting.version.attrs.held_at;
    if (typeof heldAt !== 'string' || dayOf(heldAt) !== day || !inCover(cover, meeting.scopes)) continue;
    meetings.push({
      id: meeting.id,
      title: meeting.version.title,
      held_at: heldAt,
      status: effectiveStatus('meeting', meeting.version.status) as Output['meetings'][number]['status'],
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

  // ------------------------------------------------------------ metrics that moved at their last reading
  const metricMovement: Output['metric_movement'] = [];
  for (const metric of (await call(h, 'metrics.list', {})).metrics) {
    if (!inCover(cover, metric.scopes) || !metric.latest_reading || !metric.change || metric.change.delta === 0) continue;
    const ref = (r: { value: number; unit: string | null; observed_at: string }) => ({
      value: r.value,
      unit: r.unit,
      observed_at: r.observed_at,
    });
    metricMovement.push({
      id: metric.id,
      title: metric.title,
      status: metric.status,
      altitude: metric.altitude,
      scopes: metric.scopes,
      cadence: metric.cadence,
      unit: metric.unit,
      latest_reading: ref(metric.latest_reading),
      previous_reading: ref(metric.change.previous),
      delta: metric.change.delta,
      owner: metric.owner,
    });
  }
  // Most recently read first.
  const readAt = (m: (typeof metricMovement)[number]) => instantOf(m.latest_reading.observed_at)?.getTime() ?? 0;
  metricMovement.sort((a, b) => readAt(b) - readAt(a) || a.title.localeCompare(b.title));

  // ------------------------------------------------------------ people not touched for a while
  const touchpointsDue: Output['touchpoints_due'] = [];
  const people = await call(h, 'people.list', {
    role: [...TOUCHPOINT_ROLES],
    ...(cover.slugs ? { scopes: [...cover.slugs] } : {}),
    limit: 200,
  });
  for (const person of people.people) {
    if (person.id === me?.id || person.is_user || person.role === null) continue;
    const touchDay = person.last_touchpoint ? dayOf(person.last_touchpoint.at) : null;
    const daysSince = touchDay === null ? null : daysBetween(touchDay, day);
    if (daysSince !== null && daysSince <= TOUCHPOINT_DUE_DAYS) continue;
    touchpointsDue.push({
      id: person.id,
      name: person.name,
      role: person.role,
      org: person.org,
      last_touchpoint: person.last_touchpoint,
      days_since: daysSince,
    });
  }
  // Never touched first, then the longest ago.
  touchpointsDue.sort(
    (a, b) => (b.days_since ?? Number.POSITIVE_INFINITY) - (a.days_since ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name),
  );

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

  // ------------------------------------------------------------ open bets, and ideas being tried right now
  const BET_ORDER = ['bet', 'running'] as const;
  type BetStatus = (typeof BET_ORDER)[number];
  const openBets: Output['open_bets'] = objects
    .ofKinds(['idea'])
    .filter((idea) => BET_ORDER.includes(idea.version.status as BetStatus) && inCover(cover, idea.scopes))
    .map((idea) => ({
      id: idea.id,
      title: idea.version.title,
      status: idea.version.status as BetStatus,
      altitude: idea.version.altitude,
      scopes: idea.scopes,
      hypothesis: (idea.version.attrs.hypothesis as string | undefined) ?? null,
      kill_criteria: (idea.version.attrs.kill_criteria as string | undefined) ?? null,
      updated_at: idea.version.created_at,
    }))
    .sort((a, b) => BET_ORDER.indexOf(a.status) - BET_ORDER.indexOf(b.status) || b.altitude - a.altitude || a.title.localeCompare(b.title));

  return {
    date: day,
    scopes: cover.slugs ? [...cover.slugs].sort() : [],
    me,
    commitments: { overdue, due_today: dueToday, no_due: noDue, open: counts },
    meetings,
    inbox: { waiting: inbox.files.length, oldest_arrived_at: inbox.files[0]?.arrived_at ?? null, queued: queue.items.length },
    stale_metrics: staleMetrics,
    new_findings: { since: since.toISOString(), total: findings.length, findings },
    metric_movement: metricMovement,
    touchpoints_due: touchpointsDue,
    open_bets: openBets,
  };
});
