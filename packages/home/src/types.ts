import type { OpOutput } from '@bousleh/contracts';

/* Types only: the op outputs Home reads (from contracts, erased at build) and Home's own view model. */

export type Strata = OpOutput<'context.strata'>;
export type StrataCell = Strata['cells'][number];
export type StrataObj = StrataCell['objects'][number];
export type Pulse = OpOutput<'pulse.today'>;
export type Digest = OpOutput<'watch.digest'>;
export type WatchLists = OpOutput<'watchlists.get'>;
export type Queue = OpOutput<'queue.list'>;
export type Commitments = OpOutput<'commitments.list'>;
export type Assets = OpOutput<'assets.list'>;

export type Altitude = 50000 | 10000 | 1000 | 100;
export type Layer = 'anchors' | 'evidence' | 'work' | 'people' | 'moments';

/** A calendar event, as Home keeps it from the Google Calendar connector. */
export interface CalendarEvent {
  title: string;
  /** A date-time, or a date for an all-day event. */
  start: string;
  allDay: boolean;
}

/** Everything Home reads. Each source may be missing: the page draws what it has. */
export interface Sources {
  strata?: Strata;
  pulse?: Pulse;
  digest?: Digest;
  reading?: Digest;
  watchlists?: WatchLists;
  queue?: Queue;
  commitments?: Commitments;
  assets?: Assets;
  calendar?: CalendarEvent[];
}

// ---------------------------------------------------------------- the view model (also the snapshot)

/** How a glyph is drawn: layer is the shape, state the colour. */
export type GlyphState = 'idle' | 'yours' | 'needs' | 'moving' | 'closed' | 'ghost';
export interface Glyph {
  layer: Layer;
  state: GlyphState;
}

export type Tone = 'fg' | 'muted' | 'dim' | 'zero' | 'accent' | 'accent-hi' | 'needs' | 'moving' | 'closed';

export interface Readout {
  label: string;
  value: string;
  tone: Tone;
  /** Shown on the phone too. */
  phone: boolean;
}

/** One button: a ready prompt for Claude, by key into ViewModel.prompts. */
export interface Action {
  label: string;
  prompt: string;
  /** A read-only question Home answers itself (Ask), by key; the prompt is then the copy fallback. */
  ask?: string;
}

export type Mode = 'Capture' | 'Pulse' | 'Counsel' | 'Shape' | 'Workshop' | 'Communicate' | 'Coach' | 'Horizon';

export interface Launcher {
  mode: Mode;
  label: string;
  /** Prompt key; absent when disabled. */
  prompt?: string;
  /** Answered here: the Ask question's key (the prompt is the copy fallback). */
  ask?: string;
  /** Here: opens Capture. */
  capture?: boolean;
}

export interface ColumnVM {
  slug: string;
  name: string;
  /** Three letters for the phone grid. */
  short: string;
  eyebrow: string;
  /** Nothing below the strategy yet. */
  quiet: boolean;
  /** fg when it holds a bet, accent when it holds something that needs you. */
  tone: Tone;
}

export interface RowVM {
  altitude: Altitude;
  number: string;
  label: string;
  /** One dot per object in the band, coloured by state; capped. */
  dots: GlyphState[];
  /** The band holding what needs you. */
  here: boolean;
  launchers: Launcher[];
  /** Prompt key: a brief at this altitude. */
  prompt: string;
  /** Ask question key: the same brief, answered here. Absent in older snapshots. */
  ask?: string;
}

export interface ItemVM {
  glyph: Glyph;
  title: string;
  meta: string;
  metaTone: Tone;
  titleTone: Tone;
}

export interface NeedsVM {
  eyebrow: string;
  title: string;
  scope: string;
  altitude: Altitude;
}

/** A cell's small follow-ups: minor commitments, folded away under "Small follow-ups (n)". */
export interface MinorVM {
  items: ItemVM[];
  /** One of them needs you (dated and due, or back from a snooze). */
  needs: boolean;
}

export interface BetGroup {
  label: string;
  glyphs: Glyph[];
  note: string;
}

export interface BetVM {
  title: string;
  eyebrow: string;
  /** Days on the clock and days elapsed; null when the kill criteria name no time. */
  clock: { days: number; elapsed: number } | null;
  line: string;
  groups: BetGroup[];
  scopeName: string;
  altitude: Altitude;
}

export interface CellVM {
  scope: string;
  altitude: Altitude;
  variant: 'void' | 'strategy' | 'needs' | 'bet' | 'filled';
  count: number;
  more: number;
  /** Phone heat: 0 empty, 1 a few, 2 several, 3 many. */
  heat: 0 | 1 | 2 | 3;
  hasNeeds: boolean;
  strategy?: { title: string; status: string; stage: number; strong: boolean };
  needs?: NeedsVM;
  bet?: BetVM;
  items: ItemVM[];
  /** Minor commitments (small follow-ups) in the cell, drawn after the rest in a collapsed group. Absent when there are none. */
  minor?: MinorVM;
  prompt: string;
  /** A filled cell's brief, answered here (Ask question key). */
  ask?: string;
  label: string;
}

export interface MeetingVM {
  title: string;
  when: string;
  /** Sort key: a date-time or a date. */
  at: string;
  planned: boolean;
  /** Already happened and filed with its notes (status held): nothing left to prep. */
  held?: boolean;
}

/** One of the few things to do first, from pulse.today's focus. */
export interface FocusItemVM {
  kind: 'commitment' | 'meeting';
  /** The commitment's or meeting's id: Home acts on a commitment by it. Absent in older snapshots. */
  id?: string;
  /** The first reason, as the eyebrow: "2 days late", "follow up with Ian", "today at 14:00". */
  eyebrow: string;
  title: string;
  /** The other reasons, joined. */
  detail: string;
  scopeName: string;
  altitude: Altitude;
  /** needs: something owed (either way); moving: a meeting to prep. */
  tone: 'needs' | 'moving';
  /** Prompt key. */
  prompt: string;
  label: string;
}

export interface FocusVM {
  items: FocusItemVM[];
  /** Candidates past the few shown. */
  more: number;
  /** "3 snoozed · next Nov 20", or null when nothing is snoozed. */
  snoozed: string | null;
  /** Prompt key for the rest (Pulse). */
  morePrompt: string;
  /** The same, answered here (Ask question key). */
  moreAsk?: string;
}

/** One of today's meetings, in the row under First. */
export interface MeetingRowVM {
  title: string;
  /** "14:00", or "Today" for one filed with a date only. */
  time: string;
  /** "Prep filed", "Notes filed" or "On your calendar". */
  sub: string;
  held: boolean;
  /** Brief me (Here): Ask question key. Absent for a meeting already held. */
  ask?: string;
  /** Prep with Counsel (In Claude): prompt key. Absent for a meeting already held. */
  prompt?: string;
}

export interface StoryVM {
  id: string;
  title: string;
  url: string;
  scope: string | null;
  scopeName: string;
  altitude: Altitude | null;
  source: string;
  age: string;
  summary: string;
  status: string;
  shapePrompt: string;
}

export interface BeatVM {
  name: string;
  count: number;
  horizon: boolean;
}

export interface HorizonVM {
  eyebrow: string;
  /** Watch lists exist; false: nothing is watched yet. */
  watching: boolean;
  lead: StoryVM | null;
  stories: StoryVM[];
  dayBars: number[];
  beat: BeatVM[];
  watched: number;
  changes: { kind: 'add' | 'remove'; text: string }[];
  noWatch: { slug: string; name: string; prompt: string }[];
  readingList: number;
  /** Prompt key for the reading list. */
  readingPrompt: string;
  /** The reading list, answered here (Ask question key). */
  readingAsk?: string;
  filters: { slug: string; name: string }[];
}

export interface ViewModel {
  v: 1;
  date: string;
  dateLabel: string;
  instance: 'Personal' | 'Work';
  hero: { needs: number; altitude: Altitude | null; band: string };
  readouts: Readout[];
  primary: Action | null;
  secondary: Action | null;
  columns: ColumnVM[];
  rows: RowVM[];
  /** Row by row (50,000 first), one per column. */
  cells: CellVM[][];
  stats: { strategies: string; empty: number };
  /** The few things to do first. Absent without pulse.today, and in snapshots taken before Nov 13. */
  focus?: FocusVM;
  phone: { needs: NeedsVM | null; meeting: MeetingVM | null; bet: BetVM | null };
  /** Today's meetings, for the row under First. Absent in older snapshots. */
  meetings?: MeetingRowVM[];
  horizon: HorizonVM;
  docs: { title: string; url: string; type: string }[];
  /** Ready prompts, by key. */
  prompts: Record<string, string>;
  /** Which sources this was built from. */
  have: string[];
}
