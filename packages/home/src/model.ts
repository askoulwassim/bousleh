import {
  ageLabel,
  clip,
  dayLabel,
  daysBetween,
  feet,
  firstName,
  hostOf,
  isDateOnly,
  isoWeek,
  localDay,
  mondayOf,
  monthDay,
  parseWhen,
  safeUrl,
  shortDate,
  whenLabel,
} from './format.js';
import { glyphOf, glyphState } from './glyph.js';
import { prompts } from './prompts.js';
import type {
  Action,
  Altitude,
  BeatVM,
  BetGroup,
  BetVM,
  CalendarEvent,
  CellVM,
  ColumnVM,
  Glyph,
  GlyphState,
  HorizonVM,
  ItemVM,
  Launcher,
  MeetingVM,
  NeedsVM,
  Pulse,
  Readout,
  RowVM,
  Sources,
  StoryVM,
  Strata,
  StrataCell,
  StrataObj,
  Tone,
  ViewModel,
} from './types.js';

/*
 * Op outputs → the view model Home draws. Pure: no DOM, no clock but `now`. The same model is the
 * snapshot the phone shows, so everything it holds is plain JSON.
 */

export const ALTITUDES: readonly Altitude[] = [50000, 10000, 1000, 100];
export const BAND_LABELS: Record<Altitude, string> = { 50000: 'Company', 10000: 'Cross-team', 1000: 'My surfaces', 100: 'One thing' };
const SHORT_ALT: Record<Altitude, string> = { 50000: '50K', 10000: '10K', 1000: '1K', 100: '100' };
const STRATEGY_STAGES = ['forming', 'contested', 'aligned', 'communicated'];
/** Most item rows in a cell before "+ n more". */
const CELL_ROWS = 4;

/** Ready prompts, each kept once, by key. */
class PromptBook {
  readonly byKey: Record<string, string> = {};
  private readonly keys = new Map<string, string>();
  add(text: string): string {
    const known = this.keys.get(text);
    if (known) return known;
    const key = `p${this.keys.size + 1}`;
    this.keys.set(text, key);
    this.byKey[key] = text;
    return key;
  }
}

// ---------------------------------------------------------------- small pure pieces (tested)

/** How many things need you: the strata's count, else Pulse's commitments owed by me that are late, due or undated. */
export function needsYouCount(src: Pick<Sources, 'strata' | 'pulse'>): number {
  if (src.strata) return src.strata.totals.needs_you;
  const c = src.pulse?.commitments;
  if (!c) return 0;
  return c.overdue.by_me.length + c.due_today.by_me.length + c.no_due.by_me.length + c.no_due.more.by_me;
}

/** The band holding the most needs-you items (the lower one on a tie); null when nothing needs you. */
export function needsAltitude(strata: Strata | undefined): Altitude | null {
  if (!strata) return null;
  const counts = new Map<Altitude, number>();
  for (const cell of strata.cells) {
    const n = cell.objects.filter((o) => o.needs_you).length;
    if (n > 0) counts.set(cell.altitude as Altitude, (counts.get(cell.altitude as Altitude) ?? 0) + n);
  }
  let best: Altitude | null = null;
  for (const altitude of ALTITUDES) {
    const n = counts.get(altitude) ?? 0;
    if (n > 0 && (best === null || n >= (counts.get(best) ?? 0))) best = altitude;
  }
  return best;
}

/** Days on a bet's clock, read from its kill criteria ("30 days", "6 weeks", "2 months"); null when it names no time. */
export function clockDays(text: string | undefined): number | null {
  if (!text) return null;
  const days = /(\d+)\s*-?\s*(?:days?|d)\b/i.exec(text);
  if (days) return Number(days[1]);
  const weeks = /(\d+)\s*-?\s*(?:weeks?|wks?|w)\b/i.exec(text);
  if (weeks) return Number(weeks[1]) * 7;
  const months = /(\d+)\s*-?\s*months?\b/i.exec(text);
  if (months) return Number(months[1]) * 30;
  return null;
}

/** Three letters for a scope: the first letter of its last word, then its consonants ("perfect-placement" → PLC). */
export function abbreviate(slug: string): string {
  const word = slug.split('-').filter(Boolean).at(-1) ?? slug;
  const head = word[0] ?? '';
  const rest = [...word.slice(1)].filter((ch) => !'aeiou'.includes(ch));
  const letters = [head, ...rest, ...word.slice(1)].join('').slice(0, 3);
  return letters.toUpperCase();
}

/** A meeting title without a leading scope name, short enough for a button ("Specdr Weekly" → "Weekly"). */
export function shortTitle(title: string, scopeNames: readonly string[], max = 16): string {
  let out = title.trim();
  for (const name of scopeNames) {
    if (name && out.toLowerCase().startsWith(`${name.toLowerCase()} `)) {
      out = out.slice(name.length).trim();
      break;
    }
  }
  return clip(out || title, max);
}

/**
 * Today's meetings: the calendar's events merged with the meetings filed in Bousleh. An event and a
 * filed meeting with the same start time (or, for a meeting filed with a date only, the same title)
 * are one meeting; the filed one gives the title and whether it is planned (has prep).
 */
export function mergeMeetings(filed: Pulse['meetings'], calendar: CalendarEvent[] | undefined, now: Date): MeetingVM[] {
  const out: (MeetingVM & { key: number | null })[] = [];
  for (const event of calendar ?? []) {
    if (event.allDay) continue;
    const at = parseWhen(event.start);
    out.push({ title: event.title, at: event.start, when: whenLabel(event.start, now), planned: false, key: at?.getTime() ?? null });
  }
  for (const meeting of filed) {
    const at = parseWhen(meeting.held_at);
    const dateOnly = isDateOnly(meeting.held_at);
    const same = out.find((m) =>
      dateOnly ? m.title.trim().toLowerCase() === meeting.title.trim().toLowerCase() : m.key !== null && m.key === at?.getTime(),
    );
    if (same) {
      same.title = meeting.title;
      same.planned = meeting.status === 'planned';
      continue;
    }
    out.push({
      title: meeting.title,
      at: meeting.held_at,
      when: whenLabel(meeting.held_at, now),
      planned: meeting.status === 'planned',
      key: at?.getTime() ?? null,
    });
  }
  return out
    .sort((a, b) => (parseWhen(a.at)?.getTime() ?? 0) - (parseWhen(b.at)?.getTime() ?? 0))
    .map(({ key: _key, ...meeting }) => meeting);
}

const toneOf = (state: GlyphState): Tone =>
  state === 'needs' ? 'needs' : state === 'yours' ? 'accent' : state === 'moving' ? 'moving' : state === 'closed' ? 'closed' : 'dim';

const upper = (s: string | null | undefined) => (s ?? '').replace(/_/g, ' ').toUpperCase();

/** One row in a cell. */
export function itemOf(o: StrataObj, now: Date): ItemVM {
  const glyph = glyphOf(o);
  const state = glyph.state;
  const titleTone: Tone = state === 'idle' || state === 'ghost' ? 'muted' : 'fg';
  const at = (value: string | undefined) => {
    const d = value ? parseWhen(value) : null;
    return d ? upper(shortDate(d)) : '';
  };
  let title = o.title;
  let meta = '';
  let metaTone = toneOf(state);
  switch (o.kind) {
    case 'person':
      meta = o.last_touchpoint ? at(o.last_touchpoint) : upper(o.role);
      metaTone = 'dim';
      return { glyph, title, meta, metaTone, titleTone: 'fg' };
    case 'watch_list':
      title = `Watching ${o.entries ?? 0}`;
      return { glyph, title, meta: `${o.new_findings ?? 0} NEW`, metaTone: 'moving', titleTone: 'muted' };
    case 'meeting':
      meta = o.held_at ? upper(whenLabel(o.held_at, now)) : '';
      metaTone = o.status === 'planned' ? 'moving' : 'dim';
      break;
    case 'commitment': {
      const due = o.due ? parseWhen(o.due) : null;
      meta = due ? `DUE ${upper(shortDate(due))}` : o.owed === 'to_me' ? 'OWED ME' : 'NO DATE';
      break;
    }
    case 'idea':
      meta = o.status === 'open' && o.rank ? `#${o.rank}` : upper(o.status);
      break;
    case 'decision':
    case 'signal':
    case 'observation':
    case 'principle':
      meta = at(o.updated_at);
      metaTone = 'dim';
      break;
    default:
      meta = upper(o.status);
  }
  return { glyph, title, meta, metaTone, titleTone };
}

/** A cell's rows: decisions folded into one line when there are several. */
function itemsOf(objects: StrataObj[], cell: StrataCell, now: Date, max: number): { items: ItemVM[]; drawn: number } {
  const decisions = objects.filter((o) => o.kind === 'decision');
  const fold = decisions.length >= 2;
  const items: ItemVM[] = [];
  let drawn = 0;
  for (const o of objects) {
    if (items.length >= max) break;
    if (fold && o.kind === 'decision') continue;
    items.push(itemOf(o, now));
    drawn += 1;
  }
  if (fold && items.length < max) {
    const total = cell.kinds.decision ?? decisions.length;
    const today = decisions.every((d) => {
      const at = parseWhen(d.updated_at);
      return at !== null && daysBetween(at, now) === 0;
    });
    items.push({
      glyph: { layer: 'work', state: 'yours' },
      title: `${total} decided${today && total === decisions.length ? ' today' : ''}`,
      meta: '',
      metaTone: 'dim',
      titleTone: 'muted',
    });
    drawn += total;
  }
  return { items, drawn };
}

const KIND_GROUP: Record<string, string> = {
  idea: 'Ideas',
  problem: 'Problems',
  metric: 'Metrics',
  commitment: 'Owed',
  meeting: 'Meetings',
  person: 'People',
  decision: 'Decisions',
  finding: 'Findings',
  signal: 'Evidence',
  observation: 'Evidence',
  initiative: 'Initiatives',
  strategy: 'Anchors',
  principle: 'Anchors',
  watch_list: 'Watching',
};
const LAYER_OF: Record<string, Glyph['layer']> = {
  idea: 'work',
  problem: 'work',
  initiative: 'work',
  decision: 'work',
  metric: 'anchors',
  strategy: 'anchors',
  principle: 'anchors',
  watch_list: 'anchors',
  finding: 'evidence',
  signal: 'evidence',
  observation: 'evidence',
  person: 'people',
  commitment: 'moments',
  meeting: 'moments',
};

/** A bet's card: its clock and what else sits in its cell, grouped. */
export function betOf(bet: StrataObj, cell: StrataCell, scopeName: string, now: Date): BetVM {
  const days = clockDays(bet.kill_criteria);
  const since = bet.since ? parseWhen(bet.since) : null;
  const elapsed = since ? Math.max(0, daysBetween(since, now)) : 0;
  const groups = new Map<string, { glyphs: Glyph[]; n: number; kinds: string[] }>();
  for (const [kind, n] of Object.entries(cell.kinds)) {
    const label = KIND_GROUP[kind] ?? kind;
    const count = kind === 'idea' ? n - 1 : n;
    if (count <= 0) continue;
    const group = groups.get(label) ?? { glyphs: [], n: 0, kinds: [] };
    group.n += count;
    group.kinds.push(kind);
    groups.set(label, group);
  }
  const visible = cell.objects.filter((o) => o.id !== bet.id);
  for (const [, group] of groups) {
    const mine = visible.filter((o) => group.kinds.includes(o.kind));
    group.glyphs = mine.map(glyphOf);
    const layer = LAYER_OF[group.kinds[0] ?? ''] ?? 'work';
    while (group.glyphs.length < group.n) group.glyphs.push({ layer, state: 'idle' });
    group.glyphs = group.glyphs.slice(0, 9);
  }
  const ideas = visible.filter((o) => o.kind === 'idea');
  const order = ['Ideas', 'Problems', 'Metrics'];
  const out: BetGroup[] = [...groups.entries()]
    .sort((a, b) => {
      const ia = order.indexOf(a[0]);
      const ib = order.indexOf(b[0]);
      return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib) || b[1].n - a[1].n;
    })
    .slice(0, 4)
    .map(([label, group]) => {
      let note = String(group.n);
      if (label === 'Ideas') {
        const ranked = ideas.filter((o) => o.rank !== undefined).length;
        note = ranked > 0 ? `${group.n} ranked` : `${group.n} open`;
        if (ideas.some((o) => o.status === 'running')) label = 'Experiments';
      } else if (label === 'Problems') note = `${group.n} open`;
      else if (label === 'Metrics') note = (visible.find((o) => o.kind === 'metric')?.status ?? String(group.n)).replace(/_/g, ' ');
      return { label, glyphs: group.glyphs, note };
    });
  const line = bet.kill_criteria ? `Kill · ${clip(bet.kill_criteria, 90)}` : bet.hypothesis ? clip(bet.hypothesis, 90) : '';
  return {
    title: bet.title,
    eyebrow: 'Bet',
    clock: days === null ? null : { days, elapsed },
    line,
    groups: out,
    scopeName,
    altitude: cell.altitude as Altitude,
  };
}

function needsOf(o: StrataObj, scopeName: string, now: Date): NeedsVM {
  const due = o.due ? parseWhen(o.due) : null;
  const late = due ? daysBetween(due, now) : null;
  const detail = late === null ? 'no date' : late > 0 ? `${late}d late` : 'due today';
  const who = o.owed === 'by_me' ? 'You owe' : 'Owed';
  return { eyebrow: `${who} · ${detail}`, title: o.title, scope: scopeName, altitude: o.altitude as Altitude };
}

function heatOf(count: number): CellVM['heat'] {
  if (count === 0) return 0;
  if (count <= 2) return 1;
  if (count <= 9) return 2;
  return 3;
}

// ---------------------------------------------------------------- the whole page

export function buildViewModel(src: Sources, now: Date): ViewModel {
  const book = new PromptBook();
  const strata = src.strata;
  const pulse = src.pulse;
  const columns = strata?.columns ?? [];
  const scopeNames = columns.map((c) => c.name);
  const nameOf = (slug: string | null | undefined) => columns.find((c) => c.slug === slug)?.name ?? (slug ? titleCase(slug) : '');
  const cellAt = (slug: string, altitude: Altitude) => strata?.cells.find((c) => c.scope === slug && c.altitude === altitude);
  const allObjects = dedupe((strata?.cells ?? []).flatMap((c) => c.objects));
  const meId = strata?.me?.id ?? pulse?.me?.id ?? null;

  // ------------------------------------------------------------ header
  const needs = needsYouCount(src);
  const hereAlt = needsAltitude(strata);
  const meetings = mergeMeetings(pulse?.meetings ?? [], src.calendar, now).filter((m) => {
    const at = parseWhen(m.at);
    return at !== null && daysBetween(now, at) === 0;
  });
  const upcoming = nextMeeting(meetings, allObjects, now);

  const readouts: Readout[] = [];
  const missing = (label: string, phone = false): Readout => ({ label, value: '—', tone: 'zero', phone });
  if (pulse) {
    const owed = pulse.commitments.open.to_me;
    readouts.push({ label: 'Owed me', value: String(owed), tone: owed === 0 ? 'zero' : 'fg', phone: false });
  } else readouts.push(missing('Owed me'));
  if (pulse || src.calendar) {
    readouts.push({ label: 'Meetings', value: String(meetings.length), tone: meetings.length === 0 ? 'zero' : 'fg', phone: false });
  } else readouts.push(missing('Meetings'));
  if (pulse) {
    const waiting = pulse.inbox.waiting + pulse.inbox.queued;
    readouts.push({
      label: 'Inbox',
      value: waiting === 0 ? 'Clear' : String(waiting),
      tone: waiting === 0 ? 'accent' : pulse.inbox.queued > 0 ? 'needs' : 'fg',
      phone: true,
    });
    const due = pulse.touchpoints_due;
    const first = due[0];
    readouts.push({
      label: 'Touch due',
      value: first ? `${firstName(first.name)}${due.length > 1 ? ` +${due.length - 1}` : ''}` : 'Clear',
      tone: first ? 'fg' : 'accent',
      phone: true,
    });
  } else {
    readouts.push(missing('Inbox', true), missing('Touch due', true));
  }
  if (src.commitments) {
    const today = localDay(now);
    const next = src.commitments.commitments.find(
      (c) => c.due !== null && c.due >= today && (meId === null || c.owed_by.some((p) => p.id === meId)),
    );
    const due = next?.due ? parseWhen(next.due) : null;
    readouts.push({ label: 'Next due', value: due ? monthDay(due) : 'None', tone: due ? 'fg' : 'zero', phone: true });
  } else readouts.push(missing('Next due', true));

  const queued = pulse?.inbox.queued ?? src.queue?.items.length ?? 0;
  const waiting = pulse?.inbox.waiting ?? 0;
  let primary: Action;
  if (queued > 0) primary = { label: `Answer ${queued}`, prompt: book.add(prompts.captureQueue(queued)) };
  else if (waiting > 0) primary = { label: `File ${waiting}`, prompt: book.add(prompts.captureInbox()) };
  else if (needs > 0) primary = { label: `Close ${needs}`, prompt: book.add(prompts.pulseNeeds(needs)) };
  else primary = { label: 'Where am I?', prompt: book.add(prompts.pulse()) };
  let secondary: Action;
  if (upcoming) {
    secondary = {
      label: `Prep ${shortTitle(upcoming.title, scopeNames, 14)}`,
      prompt: book.add(prompts.counselMeeting(upcoming.title, upcoming.when)),
    };
  } else if (primary.label !== 'Where am I?') secondary = { label: 'Where am I?', prompt: book.add(prompts.pulse()) };
  else secondary = { label: 'Brain dump', prompt: book.add(prompts.capture()) };

  // ------------------------------------------------------------ columns and cells
  const columnVMs: ColumnVM[] = columns.map((column) => {
    const own = (strata?.cells ?? []).filter((c) => c.scope === column.slug);
    const hasNeeds = own.some((c) => c.objects.some((o) => o.needs_you));
    const hasBet = own.some((c) => c.objects.some((o) => o.kind === 'idea' && o.status === 'bet'));
    return {
      slug: column.slug,
      name: column.name,
      short: abbreviate(column.slug),
      eyebrow: `${titleCase(column.kind)} · ${column.assets} ${column.assets === 1 ? 'doc' : 'docs'}`,
      quiet: own.filter((c) => c.altitude !== 50000).every((c) => c.count === 0),
      tone: hasNeeds ? 'accent' : hasBet ? 'fg' : 'muted',
    };
  });

  const cells: CellVM[][] = ALTITUDES.map((altitude) =>
    columns.map((column) => {
      const cell = cellAt(column.slug, altitude);
      return cellOf(cell, column, altitude);
    }),
  );

  function cellOf(cell: StrataCell | undefined, column: Strata['columns'][number], altitude: Altitude): CellVM {
    const label = `${column.name} at ${feet(altitude)} ft`;
    const base = { scope: column.slug, altitude, count: cell?.count ?? 0, heat: heatOf(cell?.count ?? 0), items: [] as ItemVM[], more: 0 };
    if (!cell || cell.count === 0) {
      return {
        ...base,
        variant: 'void',
        hasNeeds: false,
        prompt: book.add(prompts.shapeGap(column.name, altitude)),
        label: `${label}: nothing yet`,
      };
    }
    const objs = cell.objects;
    const firstNeeds = objs.find((o) => o.needs_you);
    const strategy = altitude === 50000 && column.strategy ? objs.find((o) => o.id === column.strategy?.id) : undefined;
    const bet = objs.find((o) => o.kind === 'idea' && o.status === 'bet');
    const hasNeeds = firstNeeds !== undefined;
    if (firstNeeds) {
      const rest = itemsOf(
        objs.filter((o) => o !== firstNeeds),
        cell,
        now,
        CELL_ROWS - 1,
      );
      return {
        ...base,
        variant: 'needs',
        hasNeeds,
        needs: needsOf(firstNeeds, column.name, now),
        items: rest.items,
        more: Math.max(0, cell.count - 1 - rest.drawn),
        prompt: book.add(prompts.pulseClose(firstNeeds.title)),
        label: `${label}: ${firstNeeds.title}`,
      };
    }
    if (strategy) {
      const stage = Math.max(0, STRATEGY_STAGES.indexOf(strategy.status ?? 'forming'));
      const rest = itemsOf(
        objs.filter((o) => o !== strategy),
        cell,
        now,
        CELL_ROWS - 2,
      );
      return {
        ...base,
        variant: 'strategy',
        hasNeeds,
        strategy: {
          title: strategy.title,
          status: strategy.status ?? 'forming',
          stage,
          strong: columnVMs.find((c) => c.slug === column.slug)?.tone !== 'muted',
        },
        items: rest.items,
        more: Math.max(0, cell.count - 1 - rest.drawn),
        prompt: book.add(prompts.shapeStrategy(column.name, strategy.title, strategy.status ?? 'forming')),
        label: `${label}: strategy ${strategy.title}`,
      };
    }
    if (bet) {
      return {
        ...base,
        variant: 'bet',
        hasNeeds,
        bet: betOf(bet, cell, column.name, now),
        prompt: book.add(prompts.shapeBet(bet.title, column.name)),
        label: `${label}: bet ${bet.title}`,
      };
    }
    const rows = itemsOf(objs, cell, now, CELL_ROWS);
    return {
      ...base,
      variant: 'filled',
      hasNeeds,
      items: rows.items,
      more: Math.max(0, cell.count - rows.drawn),
      prompt: book.add(prompts.brief(column.name, altitude)),
      label: `${label}: ${cell.count} ${cell.count === 1 ? 'thing' : 'things'}`,
    };
  }

  // ------------------------------------------------------------ rows and launchers
  const launchers = launchersFor(src, allObjects, upcoming, meId, columns, book, scopeNames);
  const rows: RowVM[] = ALTITUDES.map((altitude) => {
    const dots: GlyphState[] = [];
    for (const column of columns) {
      const cell = cellAt(column.slug, altitude);
      if (!cell) continue;
      for (const o of cell.objects) {
        const state = glyphState(o);
        dots.push(state === 'needs' || state === 'yours' || state === 'moving' ? state : 'ghost');
      }
      for (let i = cell.objects.length; i < cell.count; i += 1) dots.push('ghost');
    }
    return {
      altitude,
      number: feet(altitude),
      label: BAND_LABELS[altitude],
      dots: dots.slice(0, 18),
      here: altitude === hereAlt,
      launchers: launchers[altitude],
      prompt: book.add(prompts.briefBand(altitude)),
    };
  });

  // ------------------------------------------------------------ stats, phone
  const strategies = columns.flatMap((c) => (c.strategy ? [c.strategy] : []));
  const aligned = strategies.filter((s) => s.status === 'aligned' || s.status === 'communicated').length;
  const strategiesLine =
    strategies.length === 0
      ? 'No strategy yet'
      : `${strategies.length} ${strategies.length === 1 ? 'strategy' : 'strategies'} · ${
          strategies.every((s) => s.status === 'forming') ? (strategies.length === 1 ? 'forming' : 'all forming') : `${aligned} aligned`
        }`;

  const flat = cells.flat();
  const needsCell =
    (hereAlt !== null ? flat.find((c) => c.altitude === hereAlt && c.needs) : undefined) ?? flat.find((c) => c.needs !== undefined);
  const betCell = flat.find((c) => c.bet !== undefined);

  return {
    v: 1,
    date: localDay(now),
    dateLabel: dayLabel(now),
    instance: columns.length === 1 && columns[0]?.kind === 'company' ? 'Work' : 'Personal',
    hero: { needs, altitude: hereAlt, band: hereAlt === null ? '' : `at ${feet(hereAlt)} ft` },
    readouts,
    primary,
    secondary,
    columns: columnVMs,
    rows,
    cells,
    stats: { strategies: strategiesLine, empty: strata?.totals.empty_cells ?? 0 },
    phone: { needs: needsCell?.needs ?? null, meeting: upcoming, bet: betCell?.bet ?? null },
    horizon: horizonOf(src, columns, allObjects, now, book, nameOf),
    docs: (src.assets?.assets ?? [])
      .slice(0, 12)
      .map((a) => ({ title: a.title, url: safeUrl(a.url), type: a.type }))
      .filter((a) => a.url !== ''),
    prompts: book.byKey,
    have: (Object.keys(src) as (keyof Sources)[]).filter((k) => src[k] !== undefined),
  };
}

function dedupe(objects: StrataObj[]): StrataObj[] {
  const seen = new Map<string, StrataObj>();
  for (const o of objects) if (!seen.has(o.id)) seen.set(o.id, o);
  return [...seen.values()];
}

function titleCase(s: string): string {
  return s
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ');
}

/** The next meeting worth prepping: the rest of today's, else the soonest planned meeting filed in Bousleh. */
function nextMeeting(today: MeetingVM[], objects: StrataObj[], now: Date): MeetingVM | null {
  const later = today.find((m) => {
    const at = parseWhen(m.at);
    return at !== null && (isDateOnly(m.at) || at.getTime() >= now.getTime());
  });
  if (later) return later;
  const planned = objects
    .filter((o) => o.kind === 'meeting' && o.status === 'planned' && o.held_at)
    .map((o) => ({ o, at: parseWhen(o.held_at as string) }))
    .filter((x) => x.at !== null && daysBetween(now, x.at) >= 0)
    .sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))[0];
  if (!planned) return null;
  const heldAt = planned.o.held_at as string;
  return { title: planned.o.title, at: heldAt, when: whenLabel(heldAt, now), planned: true };
}

function launchersFor(
  src: Sources,
  objects: StrataObj[],
  upcoming: MeetingVM | null,
  meId: string | null,
  columns: Strata['columns'],
  book: PromptBook,
  scopeNames: string[],
): Record<Altitude, Launcher[]> {
  // Shape: the strategy furthest from aligned in the busiest column.
  const busy = (slug: string) => (src.strata?.cells ?? []).filter((c) => c.scope === slug).reduce((n, c) => n + c.count, 0);
  const withStrategy = columns
    .filter((c) => c.strategy)
    .sort(
      (a, b) =>
        STRATEGY_STAGES.indexOf(a.strategy?.status ?? '') - STRATEGY_STAGES.indexOf(b.strategy?.status ?? '') ||
        busy(b.slug) - busy(a.slug),
    );
  const target = withStrategy[0];
  const shape: Launcher =
    target?.strategy !== undefined && target.strategy !== null
      ? {
          mode: 'Shape',
          label: 'Work the strategy',
          prompt: book.add(prompts.shapeStrategy(target.name, target.strategy.title, target.strategy.status)),
        }
      : { mode: 'Shape', label: 'Write a strategy', prompt: book.add(prompts.shapeFirstStrategy(columns[0]?.name ?? 'this scope')) };

  const lists = src.watchlists?.watch_lists ?? [];
  const unwatched = columns.find((c) => !lists.some((l) => l.scopes.includes(c.slug)));
  const horizon: Launcher =
    lists.length > 0 || !unwatched
      ? { mode: 'Horizon', label: 'Read the scan', prompt: book.add(prompts.horizonScan()) }
      : { mode: 'Horizon', label: 'Start watching', prompt: book.add(prompts.horizonWatch(unwatched.name)) };

  const people = objects.filter((o) => o.kind === 'person' && o.id !== meId);
  const stakeholder = people.find((p) => p.role === 'stakeholder' && p.altitude === 10000) ?? people.find((p) => p.role === 'stakeholder');
  const communicate: Launcher = stakeholder
    ? { mode: 'Communicate', label: `Brief ${firstName(stakeholder.title)}`, prompt: book.add(prompts.communicateBrief(stakeholder.title)) }
    : { mode: 'Communicate', label: 'Write an update', prompt: book.add(prompts.communicateUpdate()) };

  const betScopes = new Set(objects.filter((o) => o.kind === 'idea' && o.status === 'bet').flatMap((o) => o.scopes));
  const problems = objects.filter((o) => o.kind === 'problem');
  const problem =
    problems.find((p) => p.altitude === 1000 && p.scopes.some((s) => betScopes.has(s))) ??
    problems.find((p) => p.altitude === 1000) ??
    problems[0];
  const workshop: Launcher = problem
    ? { mode: 'Workshop', label: clip(problem.title, 20), prompt: book.add(prompts.workshop(problem.title)) }
    : { mode: 'Workshop', label: 'What could we do?', prompt: book.add(prompts.workshopOpen()) };

  const pm = people.find((p) => p.role === 'pm');
  const coach: Launcher = pm
    ? { mode: 'Coach', label: `Coach ${firstName(pm.title)}`, prompt: book.add(prompts.coach(pm.title)) }
    : { mode: 'Coach', label: 'No PMs yet' };

  const counsel: Launcher = upcoming
    ? {
        mode: 'Counsel',
        label: `Prep ${shortTitle(upcoming.title, scopeNames, 14)}`,
        prompt: book.add(prompts.counselMeeting(upcoming.title, upcoming.when)),
      }
    : { mode: 'Counsel', label: 'Hard talk', prompt: book.add(prompts.counselTalk()) };

  return {
    50000: [shape],
    10000: [horizon, communicate],
    1000: [workshop, { mode: 'Pulse', label: 'Where am I?', prompt: book.add(prompts.pulse()) }, coach],
    100: [counsel, { mode: 'Capture', label: 'Brain dump', prompt: book.add(prompts.capture()) }],
  };
}

// ---------------------------------------------------------------- Horizon's front page

function horizonOf(
  src: Sources,
  columns: Strata['columns'],
  objects: StrataObj[],
  now: Date,
  book: PromptBook,
  nameOf: (slug: string | null | undefined) => string,
): HorizonVM {
  const lists = src.watchlists?.watch_lists ?? [];
  const listById = new Map(lists.map((l) => [l.id, l]));
  const betScopes = new Set([
    ...(src.pulse?.open_bets ?? []).filter((b) => b.status === 'bet').flatMap((b) => b.scopes),
    ...objects.filter((o) => o.kind === 'idea' && o.status === 'bet').flatMap((o) => o.scopes),
  ]);

  const findings = (src.digest?.groups ?? [])
    .flatMap((group) => {
      const list = group.watch_list ? listById.get(group.watch_list.id) : undefined;
      return group.findings.map((f) => ({ f, scope: list?.scopes[0] ?? null, altitude: (list?.altitude ?? null) as Altitude | null }));
    })
    .filter(({ f }) => f.status !== 'dismissed')
    .sort((a, b) => b.f.filed_at.localeCompare(a.f.filed_at));

  const story = ({ f, scope, altitude }: (typeof findings)[number]): StoryVM => {
    const url = safeUrl(f.url);
    return {
      id: f.id,
      title: f.title,
      url,
      scope,
      scopeName: nameOf(scope),
      altitude,
      source: hostOf(url),
      age: ageLabel(f.published_at ?? f.filed_at, now),
      summary: clip(f.summary, 240),
      status: f.status,
      shapePrompt: book.add(prompts.shapeFinding(f.title, nameOf(scope) || 'my scopes', url)),
    };
  };
  const lead =
    findings.find((x) => x.f.status === 'new' && x.scope !== null && betScopes.has(x.scope)) ??
    findings.find((x) => x.f.status === 'new') ??
    findings[0];

  const monday = mondayOf(now);
  const dayBars = [0, 0, 0, 0, 0, 0, 0];
  for (const { f } of findings) {
    const at = parseWhen(f.filed_at);
    if (!at) continue;
    const i = daysBetween(monday, at);
    if (i >= 0 && i < 7) dayBars[i] = (dayBars[i] ?? 0) + 1;
  }

  const matches = (name: string, url: string | undefined, f: (typeof findings)[number]['f']) => {
    const host = url ? hostOf(url) : '';
    if (host && hostOf(f.url).endsWith(host)) return true;
    const needle = name.trim().toLowerCase();
    return needle.length >= 3 && `${f.title} ${f.summary}`.toLowerCase().includes(needle);
  };
  const entries = lists.flatMap((l) => l.entries);
  const beat: BeatVM[] = entries
    .map((e, i) => ({ e, i, count: findings.filter(({ f }) => matches(e.name, e.url, f)).length }))
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .slice(0, 10)
    .map(({ e, count }) => ({ name: e.name, count, horizon: e.added_by === 'horizon' }));

  const listIds = new Set(lists.map((l) => l.id));
  const changes: HorizonVM['changes'] = [
    ...entries
      .filter((e) => e.added_by === 'horizon')
      .slice(0, 3)
      .map((e) => ({ kind: 'add' as const, text: e.name })),
    ...(src.queue?.items ?? [])
      .filter((item) => item.candidates.some((c) => listIds.has(c.id)))
      .map((item) => ({
        kind: 'remove' as const,
        text: /^Remove "(.+)" from/.exec(item.draft.title ?? '')?.[1] ?? item.draft.title ?? 'an entry',
      }))
      .slice(0, 3),
  ];

  const watchedScopes = [...new Set(lists.flatMap((l) => l.scopes))];
  const latest = findings[0] ? parseWhen(findings[0].f.filed_at) : null;
  const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
  const issueDate = latest ? dayLabel(latest) : `Next scan ${dayLabel(nextMonday)}`;
  const eyebrow = [`Wk ${isoWeek(now)}`, issueDate, ...watchedScopes.map((s) => nameOf(s))].join(' · ');

  return {
    eyebrow,
    watching: lists.length > 0,
    lead: lead ? story(lead) : null,
    stories: findings
      .filter((x) => x !== lead)
      .slice(0, 3)
      .map(story),
    dayBars,
    beat,
    watched: entries.length,
    changes,
    noWatch: columns
      .filter((c) => !watchedScopes.includes(c.slug))
      .map((c) => ({ slug: c.slug, name: c.name, prompt: book.add(prompts.horizonWatch(c.name)) })),
    readingList: src.reading?.total ?? 0,
    readingPrompt: book.add(prompts.horizonReading()),
    filters: watchedScopes.map((slug) => ({ slug, name: nameOf(slug) })),
  };
}

export { SHORT_ALT };
