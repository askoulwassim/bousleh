import type { CalendarEvent } from './types.js';

/* Reading what the connectors answer. Pure; tested. */

export type Unwrapped = { ok: true; output: unknown } | { ok: false; code: string; message: string };

interface ResultLike {
  structuredContent?: unknown;
  payload?: unknown;
  content?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * A Bousleh tool result. The server answers `structuredContent: {status: 'ok', output}` or
 * `{status: 'error', code, message}`, with the output's JSON (or "code: message") as the first text
 * block. Accepts the whole mcp result, or a tool_error rejection's `result`.
 */
export function unwrapBousleh(result: unknown): Unwrapped {
  if (!isObject(result)) return { ok: false, code: 'empty', message: 'no result' };
  const r = result as ResultLike;
  const structured = isObject(r.structuredContent) ? r.structuredContent : isObject(r.payload) ? r.payload : undefined;
  if (structured && (structured.status === 'ok' || structured.status === 'error')) {
    if (structured.status === 'ok') return { ok: true, output: structured.output };
    return { ok: false, code: String(structured.code ?? 'error'), message: String(structured.message ?? '') };
  }
  const first = Array.isArray(r.content) ? r.content[0] : undefined;
  if (isObject(first) && typeof first.text === 'string') {
    try {
      return { ok: true, output: JSON.parse(first.text) };
    } catch {
      const m = /^([a-z_]+): (.*)$/s.exec(first.text);
      return { ok: false, code: m?.[1] ?? 'error', message: m?.[2] ?? first.text };
    }
  }
  return { ok: false, code: 'empty', message: 'no output' };
}

/**
 * Events from the Google Calendar connector's list_events, whatever envelope it uses (`events`,
 * `items` or a bare list). Declined and cancelled events are left out.
 */
export function normalizeCalendar(payload: unknown): CalendarEvent[] {
  let list: unknown = payload;
  if (isObject(payload)) list = payload.events ?? payload.items ?? payload.results ?? [];
  if (!Array.isArray(list)) return [];
  const out: CalendarEvent[] = [];
  for (const raw of list) {
    if (!isObject(raw)) continue;
    if (raw.status === 'cancelled') continue;
    const attendees = Array.isArray(raw.attendees) ? raw.attendees : [];
    const self = attendees.find((a) => isObject(a) && a.self === true) as Record<string, unknown> | undefined;
    if (self?.responseStatus === 'declined') continue;
    const start = raw.start ?? raw.startTime ?? raw.start_time;
    let when: string | undefined;
    let allDay = false;
    if (typeof start === 'string') {
      when = start;
      allDay = /^\d{4}-\d{2}-\d{2}$/.test(start);
    } else if (isObject(start)) {
      if (typeof start.dateTime === 'string') when = start.dateTime;
      else if (typeof start.date === 'string') {
        when = start.date;
        allDay = true;
      }
    }
    if (raw.allDay === true || raw.all_day === true) allDay = true;
    const title = raw.summary ?? raw.title ?? raw.name;
    if (!when || typeof title !== 'string' || title.trim() === '') continue;
    out.push({ title: title.trim(), start: when, allDay });
  }
  return out;
}

/** The list_events arguments for one local day: local times with no offset, as the connector asks. */
export function calendarArgs(day: Date): { startTime: string; endTime: string; pageSize: number; orderBy: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T00:00:00`;
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return { startTime: iso(day), endTime: iso(next), pageSize: 50, orderBy: 'startTime' };
}
