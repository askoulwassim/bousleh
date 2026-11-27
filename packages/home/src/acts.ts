import { localDay } from './format.js';

/*
 * Acting on a commitment from Home, without Claude: done, drop, date, snooze. Each is one Bousleh op,
 * live only. Pure helpers here (tested); the calls are in main.ts.
 */

export type Act = 'done' | 'drop' | 'date' | 'snooze';

/** What happened to a commitment on this page, by id, until the next read drops it from focus. */
export type ActState = 'busy' | 'done' | 'dropped' | 'dated' | 'snoozed';

export const ACT_STATE_LABEL: Record<Exclude<ActState, 'busy'>, string> = {
  done: 'Marked done',
  dropped: 'Dropped',
  dated: 'Dated',
  snoozed: 'Snoozed',
};

/** The Bousleh tool and input for one act. date and snooze need a day (YYYY-MM-DD). */
export function actCall(act: Act, id: string, day?: string): { tool: string; input: Record<string, unknown> } {
  switch (act) {
    case 'done':
      return { tool: 'commitments_close', input: { id, status: 'done' } };
    case 'drop':
      return { tool: 'commitments_close', input: { id, status: 'dropped', note: 'Dropped from Home.' } };
    case 'date':
      return { tool: 'vault_supersede', input: { id, attrs: { due: day } } };
    case 'snooze':
      return { tool: 'commitments_snooze', input: { id, until: day } };
  }
}

export function actDoneState(act: Act): Exclude<ActState, 'busy'> {
  return act === 'done' ? 'done' : act === 'drop' ? 'dropped' : act === 'date' ? 'dated' : 'snoozed';
}

/** The day `n` days after `d`, local. */
function plus(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** The next given weekday (0 Sunday … 6 Saturday) strictly after `d`. */
function next(d: Date, weekday: number): Date {
  const ahead = (weekday - d.getDay() + 7) % 7 || 7;
  return plus(d, ahead);
}

/**
 * Quick picks for the date sheet. A due date may be today; a snooze starts tomorrow at the earliest,
 * since commitments.snooze until today would only hide it until now.
 */
export function quickDays(act: 'date' | 'snooze', now: Date): { label: string; day: string }[] {
  const picks =
    act === 'date'
      ? [
          { label: 'Today', d: now },
          { label: 'Tomorrow', d: plus(now, 1) },
          { label: 'Friday', d: next(now, 5) },
          { label: 'Next Monday', d: next(now, 1) },
        ]
      : [
          { label: 'Tomorrow', d: plus(now, 1) },
          { label: 'Monday', d: next(now, 1) },
          { label: 'In a week', d: plus(now, 7) },
          { label: 'In two weeks', d: plus(now, 14) },
        ];
  const seen = new Set<string>();
  const out: { label: string; day: string }[] = [];
  for (const p of picks) {
    const day = localDay(p.d);
    if (seen.has(day)) continue;
    seen.add(day);
    out.push({ label: p.label, day });
  }
  return out;
}

/** The earliest day the date input accepts: today for a due date, tomorrow for a snooze. */
export function minDay(act: 'date' | 'snooze', now: Date): string {
  return localDay(act === 'date' ? now : plus(now, 1));
}

/** A capture's text without the prompt's lead-in ("Capture this: ", "Drop this: "). */
export function captureText(text: string): string {
  return text.replace(/^\s*(Capture this|Drop this)\s*:\s*/i, '').trim();
}

/** The inbox file name for a capture made in Home: capture-2026-11-27-1532-home.md. */
export function captureName(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `capture-${localDay(now)}-${pad(now.getHours())}${pad(now.getMinutes())}-home.md`;
}
