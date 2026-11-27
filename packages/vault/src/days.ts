/*
 * Days are calendar days on this machine's clock (the Mac's time zone), so "today" is the user's
 * today, not UTC's. Plain dates (2026-10-25) are taken as they are; date-times are instants.
 * Shared by every package that reads dates: context (Pulse), intake (signal patterns), metrics
 * (history) and vault (people).
 */

const pad = (n: number) => String(n).padStart(2, '0');
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** True for a plain date (YYYY-MM-DD), false for a date-time. */
export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

/** The local calendar day of a moment, YYYY-MM-DD. */
export function localDay(at: Date): string {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** Local midnight at the start of a day. */
export function startOfDay(day: string): Date {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

/** The day `n` days after (or before) a day. */
export function addDays(day: string, n: number): string {
  const start = startOfDay(day);
  return localDay(new Date(start.getFullYear(), start.getMonth(), start.getDate() + n));
}

/** Whole days from one day to another (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((day) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  }) as [number, number];
  return Math.round((b - a) / 86_400_000);
}

/** The calendar day a stored date or date-time falls on: a plain date as is, a date-time on this machine's clock. */
export function dayOf(value: string): string | null {
  if (isDateOnly(value)) return value;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : localDay(at);
}

/** When a window starts: a plain date at its local midnight, a date-time as given. */
export function windowStart(value: string): Date {
  return isDateOnly(value) ? startOfDay(value) : new Date(value);
}

/** When a window ends (exclusive): a plain date includes that whole day, so it ends at the next local midnight. */
export function windowEnd(value: string): Date {
  return isDateOnly(value) ? startOfDay(addDays(value, 1)) : new Date(value);
}

/** A stored date or date-time as a moment: a plain date at its local midnight. Null when it doesn't parse. */
export function instantOf(value: string): Date | null {
  const at = windowStart(value);
  return Number.isNaN(at.getTime()) ? null : at;
}
