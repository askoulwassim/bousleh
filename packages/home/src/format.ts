/* Small formatting helpers. Dates are read and shown on the viewer's clock. */

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYY-MM-DD on the local clock. */
export function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A date (read as local midnight) or a date-time. */
export function parseWhen(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t);
}

export const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

/** Whole calendar days from a to b (b later is positive). */
export function daysBetween(a: Date, b: Date): number {
  const start = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const end = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((end - start) / 86_400_000);
}

/** "Sun 25 Oct" */
export function dayLabel(d: Date): string {
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "25 Oct" */
export function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Nov 6" */
export function monthDay(d: Date): string {
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "15:00" */
export function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "Fri 15:00" for a date-time, "Fri" for a date, "Today 15:00" on the day itself. */
export function whenLabel(value: string, now: Date): string {
  const d = parseWhen(value);
  if (!d) return '';
  const away = daysBetween(now, d);
  const day = away === 0 ? 'Today' : away === 1 ? 'Tomorrow' : away > 1 && away < 7 ? (DAYS[d.getDay()] ?? '') : shortDate(d);
  return isDateOnly(value) ? day : `${day} ${clock(d)}`;
}

/** "2d", "today", "3w" */
export function ageLabel(value: string, now: Date): string {
  const d = parseWhen(value);
  if (!d) return '';
  const days = daysBetween(d, now);
  if (days <= 0) return 'today';
  if (days < 14) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}

/** Monday 00:00 of the week holding d. */
export function mondayOf(d: Date): Date {
  const back = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
}

/** ISO 8601 week number. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** 50000 → "50,000" */
export function feet(n: number): string {
  return n.toLocaleString('en-US');
}

/** Cut at a word boundary with an ellipsis. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/** The host of a url without www., or "" when it isn't one. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Only http(s) links are ever put in an href. */
export function safeUrl(url: unknown): string {
  if (typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : '';
  } catch {
    return '';
  }
}
