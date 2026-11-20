import { type Altitude, type CommitmentView, effectiveStatus, FOCUS_LIMIT, type OpOutput } from '@bousleh/contracts';
import { dayOf, daysBetween, type Objects } from './shared.js';

/*
 * pulse.today's focus: the few things to do first, so Pulse and Home lead with them instead of
 * listing every bucket. The engine scores; Claude still says it out loud and judges the rest.
 * Candidates are open commitments owed by me or to me (snoozed ones never reach here) and today's
 * planned meetings. Minor commitments (small follow-ups) score lower, and never as undated. The weights are a first version (Nov 13): tune them here, with the tests.
 */

type Output = OpOutput<'pulse.today'>;
type FocusItem = Output['focus'][number];
type Meeting = Output['meetings'][number];

export const FOCUS_WEIGHTS = {
  /** Owed by me and past due, plus a little per day late (capped). */
  overdueByMe: 60,
  perDayLate: 4,
  maxLateDays: 10,
  dueTodayByMe: 55,
  /** Owed by me and due within dueSoonDays. */
  dueSoonByMe: 35,
  dueSoonDays: 2,
  /** Owed by me, no due date, back from a snooze today or earlier. */
  surfacedByMe: 45,
  /** Owed by me, no date at all, filed more than undatedAfterDays ago; a little more per week (capped). */
  undatedByMe: 15,
  undatedAfterDays: 7,
  perWeekUndated: 3,
  maxUndatedWeeks: 4,
  /** Owed to me and past due: a nudge. */
  overdueToMe: 30,
  /** Owed to me, no due date, back from a snooze: the follow-up he asked for. */
  surfacedToMe: 40,
  /** A meeting filed as planned for the day; more when its body holds no prep yet. */
  plannedMeeting: 45,
  noPrep: 10,
  /** Fewer characters than this in a planned meeting's body reads as no prep. */
  prepChars: 40,
  /** The other side is my manager, or a stakeholder. */
  manager: 15,
  stakeholder: 8,
  /** I see the other side today (a meeting filed in Bousleh for the day). */
  seeToday: 12,
  /** Linked to a bet or a running idea. */
  onBet: 10,
  altitude: { 50000: 8, 10000: 4, 1000: 0, 100: -4 } as Record<Altitude, number>,
  /** Nov 20: a minor commitment (a small follow-up) ranks below an equally late major one. Undated minor ones are never candidates. */
  minor: -25,
} as const;

const W = FOCUS_WEIGHTS;

export interface FocusInput {
  day: string;
  me: { id: string } | null;
  /** Open, not snoozed, in scope: each with its direction relative to me. */
  commitments: { commitment: CommitmentView; side: 'by_me' | 'to_me' | 'other' }[];
  /** The day's meetings, as pulse.today lists them. */
  meetings: Meeting[];
  objects: Objects;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const names = (people: { name: string }[]) => people.map((p) => p.name).join(' and ');
const pad = (n: number) => String(n).padStart(2, '0');

/** "today at 14:00" for a date-time on this machine's clock; "today" for a plain date. */
function todayAt(heldAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(heldAt)) return 'today';
  const at = new Date(heldAt);
  return Number.isNaN(at.getTime()) ? 'today' : `today at ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

export function rankFocus(input: FocusInput): { focus: FocusItem[]; more: number } {
  const { day, me, objects } = input;
  const meObject = me ? objects.get(me.id) : undefined;
  const managers = new Set(meObject?.links.out.filter((l) => l.kind === 'reports_to').map((l) => l.to) ?? []);
  const seenToday = new Map<string, string>();
  for (const meeting of input.meetings) for (const person of meeting.attendees) seenToday.set(person.id, person.name);

  /** Boosts for who is on the other side: my manager or a stakeholder, and whether I see them today. */
  function peopleBoost(people: { id: string; name: string }[], side: 'by_me' | 'to_me'): { score: number; why: string[] } {
    let score = 0;
    const why: string[] = [];
    const boss = people.find((p) => managers.has(p.id));
    const stakeholder = people.find((p) => objects.get(p.id)?.version.attrs.role === 'stakeholder');
    if (boss) {
      score += W.manager;
      why.push(`${side === 'by_me' ? 'owed to' : 'from'} ${boss.name}, your manager`);
    } else if (stakeholder) {
      score += W.stakeholder;
      why.push(`${side === 'by_me' ? 'owed to' : 'from'} ${stakeholder.name}, a stakeholder`);
    }
    const seen = people.find((p) => seenToday.has(p.id));
    if (seen) {
      score += W.seeToday;
      why.push(`you see ${seen.name} today`);
    }
    return { score, why };
  }

  /** A live link, either way, to a bet or a running idea. */
  function betOf(id: string): { title: string; status: string } | null {
    const object = objects.get(id);
    if (!object) return null;
    const linked = [...object.links.out.map((l) => l.to), ...object.links.in.map((l) => l.from)];
    for (const other of linked) {
      const idea = objects.get(other);
      if (idea?.kind !== 'idea' || idea.links.in.some((l) => l.kind === 'supersedes')) continue;
      const status = effectiveStatus('idea', idea.version.status);
      if (status === 'bet' || status === 'running') return { title: idea.version.title, status };
    }
    return null;
  }

  const candidates: FocusItem[] = [];

  // ------------------------------------------------------------ commitments
  for (const { commitment: c, side } of input.commitments) {
    if (side === 'other') continue;
    const counterpart = side === 'by_me' ? c.owed_to : c.owed_by;
    const surfaced = c.due === null && c.surface_on !== null;
    const when = c.due ?? c.surface_on;
    let base: number | null = null;
    const why: string[] = [];

    const back = (late: number) => (late === 0 ? 'back from snooze today' : `back from snooze ${plural(late, 'day')} ago`);
    if (side === 'by_me') {
      if (when !== null) {
        const late = daysBetween(when, day);
        if (surfaced) {
          // Snoozed ones never reach here, so a surfaced one has late >= 0.
          base = W.surfacedByMe + W.perDayLate * Math.min(late, W.maxLateDays);
          why.push(back(late));
        } else if (late > 0) {
          base = W.overdueByMe + W.perDayLate * Math.min(late, W.maxLateDays);
          why.push(`${plural(late, 'day')} late`);
        } else if (late === 0) {
          base = W.dueTodayByMe;
          why.push('due today');
        } else if (-late <= W.dueSoonDays) {
          base = W.dueSoonByMe;
          why.push(late === -1 ? 'due tomorrow' : `due in ${plural(-late, 'day')}`);
        }
      } else if (c.size === 'major') {
        const filedAt = objects.get(c.id)?.created_at;
        const filedDay = filedAt ? dayOf(filedAt) : null;
        const age = filedDay ? daysBetween(filedDay, day) : 0;
        if (age > W.undatedAfterDays) {
          base = W.undatedByMe + W.perWeekUndated * Math.min(Math.floor(age / 7), W.maxUndatedWeeks);
          why.push(`no due date for ${plural(age, 'day')}`);
        }
      }
    } else if (when !== null) {
      const late = daysBetween(when, day);
      const who = counterpart.length > 0 ? names(counterpart) : null;
      if (surfaced) {
        base = W.surfacedToMe + W.perDayLate * Math.min(late, W.maxLateDays);
        why.push(who ? `follow up with ${who}` : 'follow-up due', back(late));
      } else if (late > 0) {
        base = W.overdueToMe + W.perDayLate * Math.min(late, W.maxLateDays);
        why.push(`${who ?? 'it'} is ${plural(late, 'day')} late: nudge`);
      }
    }
    if (base === null) continue;

    const boost = peopleBoost(counterpart, side);
    const bet = betOf(c.id);
    const minor = c.size === 'minor';
    const score = base + boost.score + (bet ? W.onBet : 0) + W.altitude[c.altitude] + (minor ? W.minor : 0);
    why.push(...boost.why);
    if (bet) why.push(`part of ${bet.status === 'bet' ? 'the bet' : 'the running idea'} "${bet.title}"`);
    if (minor) why.push('small follow-up');
    candidates.push({
      kind: 'commitment',
      id: c.id,
      title: c.title,
      altitude: c.altitude,
      scopes: c.scopes,
      score,
      why,
      owed: side,
      size: c.size,
      people: counterpart,
      when,
    });
  }

  // ------------------------------------------------------------ today's planned meetings
  for (const meeting of input.meetings) {
    if (meeting.status !== 'planned') continue;
    const others = meeting.attendees.filter((p) => p.id !== me?.id);
    const body = objects.get(meeting.id)?.version.body.trim() ?? '';
    const prepped = body.length >= W.prepChars;
    const why = [todayAt(meeting.held_at), prepped ? 'prep ready to review' : 'no prep yet'];
    let score = W.plannedMeeting + (prepped ? 0 : W.noPrep) + W.altitude[meeting.altitude];
    const boss = others.find((p) => managers.has(p.id));
    const stakeholder = others.find((p) => objects.get(p.id)?.version.attrs.role === 'stakeholder');
    if (boss) {
      score += W.manager;
      why.push(`with ${boss.name}, your manager`);
    } else if (stakeholder) {
      score += W.stakeholder;
      why.push(`with ${stakeholder.name}, a stakeholder`);
    }
    candidates.push({
      kind: 'meeting',
      id: meeting.id,
      title: meeting.title,
      altitude: meeting.altitude,
      scopes: meeting.scopes,
      score,
      why,
      owed: null,
      size: null,
      people: others,
      when: meeting.held_at,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
  return { focus: candidates.slice(0, FOCUS_LIMIT), more: Math.max(0, candidates.length - FOCUS_LIMIT) };
}
