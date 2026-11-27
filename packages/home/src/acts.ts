import { localDay } from './format.js';

/*
 * Acting on a commitment from Home, without Claude: Done, Date, Snooze and Close. Each is one Bousleh
 * op on a press, live only, and each has an Undo that calls the reverse op. Pure helpers (tested);
 * the calls are made in main.ts.
 */

export type Act = 'done' | 'date' | 'snooze' | 'close';

export interface ToolCall {
  tool: string;
  input: Record<string, unknown>;
}

/** What Home knew about a commitment before acting on it, so Undo can put it back. */
export interface Before {
  due: string | null;
  surface_on: string | null;
}

/** A commitment acted on in this page, by id, until the next read takes it out of First. */
export interface Acted {
  act: Act;
  state: 'busy' | 'done' | 'error';
  /** "Marked done", "Closed", "Due Mon 30 Nov", "Snoozed till Mon 30 Nov"; the error line on error. */
  label: string;
  /** The reverse op, offered as Undo until `undoUntil` (ms since epoch). */
  undo: ToolCall | null;
  undoUntil: number;
  /** On error: the call to retry. */
  retry: ToolCall | null;
  /** The day picked, for Date and Snooze. */
  day?: string;
}

/** How long Undo stays on a card. */
export const UNDO_MS = 5000;
/** How long a Done or Close waits for its second press. */
export const CONFIRM_MS = 4000;

export const CLOSE_NOTE = 'Closed from Home.';

/** The Bousleh tool and input for one act. date and snooze need a day (YYYY-MM-DD). */
export function actCall(act: Act, id: string, day?: string): ToolCall {
  switch (act) {
    case 'done':
      return { tool: 'commitments_close', input: { id, status: 'done' } };
    case 'close':
      return { tool: 'commitments_close', input: { id, status: 'dropped', note: CLOSE_NOTE } };
    case 'date':
      return { tool: 'vault_supersede', input: { id, attrs: { due: day } } };
    case 'snooze':
      return { tool: 'commitments_snooze', input: { id, until: day } };
  }
}

/**
 * The reverse of an act, from what the commitment held before it. Done and Close reopen it. Date puts
 * back its due date and its snooze (dating one back from a snooze ends the snooze). Snooze wakes it, or
 * puts back the earlier snooze day it had.
 */
export function undoCall(act: Act, id: string, before: Before): ToolCall {
  switch (act) {
    case 'done':
    case 'close':
      return { tool: 'vault_supersede', input: { id, status: 'open' } };
    case 'date':
      return { tool: 'vault_supersede', input: { id, attrs: { due: before.due, surface_on: before.surface_on } } };
    case 'snooze':
      return before.surface_on === null
        ? { tool: 'commitments_snooze', input: { id, until: null } }
        : { tool: 'vault_supersede', input: { id, attrs: { surface_on: before.surface_on } } };
  }
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Mon 30 Nov" for a YYYY-MM-DD day. */
export function dayWords(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const at = new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12);
  return `${DOW[at.getDay()]} ${at.getDate()} ${MON[at.getMonth()]}`;
}

/** What a card says once the act went through. */
export function resultLabel(act: Act, day: string | undefined, today: string): string {
  if (act === 'done') return 'Marked done';
  if (act === 'close') return 'Closed';
  if (act === 'date') return day === today ? 'Due today' : `Due ${dayWords(day ?? today)}`;
  return `Snoozed till ${dayWords(day ?? today)}`;
}

/** The day `n` days after `d`, local. */
function plus(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** The next given weekday (0 Sunday … 6 Saturday) strictly after `d`. */
function next(d: Date, weekday: number): Date {
  return plus(d, (weekday - d.getDay() + 7) % 7 || 7);
}

export interface DayPick {
  label: string;
  day: string;
}

/**
 * Quick picks for the day picker. Date: today, then the coming Monday, Wednesday and Friday, in date
 * order, labelled by day ("Mon 30 Nov"). Snooze: tomorrow, Monday, in a week, in two weeks; a snooze
 * starts tomorrow at the earliest, since until today would only hide it until now. Each day once.
 */
export function quickDays(act: 'date' | 'snooze', now: Date): DayPick[] {
  const picks =
    act === 'date'
      ? [
          { label: 'Today', d: now },
          ...[1, 3, 5]
            .map((w) => next(now, w))
            .sort((a, b) => a.getTime() - b.getTime())
            .map((d) => ({ label: dayWords(localDay(d)), d })),
        ]
      : [
          { label: 'Tomorrow', d: plus(now, 1) },
          { label: 'Monday', d: next(now, 1) },
          { label: 'In a week', d: plus(now, 7) },
          { label: 'In two weeks', d: plus(now, 14) },
        ];
  const seen = new Set<string>();
  const out: DayPick[] = [];
  for (const p of picks) {
    const day = localDay(p.d);
    if (seen.has(day)) continue;
    seen.add(day);
    out.push({ label: p.label, day });
  }
  return out;
}

/** The earliest day the date input takes: today for a due date, tomorrow for a snooze. */
export function minDay(act: 'date' | 'snooze', now: Date): string {
  return localDay(act === 'date' ? now : plus(now, 1));
}

/** A day typed into the date input, if it is a real day on or after `min`. */
export function validDay(value: string, min: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T12:00:00`))) return null;
  return value >= min ? value : null;
}

/** A failure, in a few words for the card or a toast. */
export function failure(err: unknown): string {
  const code = (err as { code?: string } | null)?.code ?? 'error';
  if (code === 'cancelled') return 'Cancelled in the app';
  if (code === 'approval_required') return 'Needs your OK in the Claude app';
  if (code === 'server_not_connected' || code === 'server_not_found') return "Couldn't reach Bousleh";
  return `Not changed (${code.replace(/_/g, ' ')})`;
}

/** A capture's text without a prompt's lead-in ("Capture this: ", "Drop this: "). */
export function captureText(text: string): string {
  return text.replace(/^\s*(Capture this|Drop this)\s*:\s*/i, '').trim();
}

/** The inbox file name for a capture made in Home: capture-2026-11-27-1532-home.md. */
export function captureName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `capture-${localDay(now)}-${pad(now.getHours())}${pad(now.getMinutes())}-home.md`;
}
