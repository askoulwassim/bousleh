import { ACT_STATE_LABEL, type ActState } from './acts.js';
import { esc } from './escape.js';
import { safeUrl } from './format.js';
import { glyphSvg, stateColor } from './glyph.js';
import { icons, logoFull, logoSmall, modeIcon } from './icons.js';
import { SHORT_ALT } from './model.js';
import { tokens } from './tokens.js';
import type {
  BetVM,
  CellVM,
  FocusItemVM,
  FocusVM,
  ItemVM,
  Launcher,
  MeetingVM,
  NeedsVM,
  Readout,
  StoryVM,
  Tone,
  ViewModel,
} from './types.js';

/*
 * View model → markup. One string for the whole page: the desktop layout (rail, header, strata,
 * Horizon) and the phone layout (StrataMini, cards, tab bar); CSS shows one or the other at 720px.
 * Every string from data goes through esc(), every link through safeUrl().
 */

export type PageMode = 'connecting' | 'live' | 'snapshot' | 'empty';

export interface UiState {
  mode: PageMode;
  /** "20:43": when the data on screen was read (live) or taken (snapshot). */
  stamp: string;
  filter: string;
  docsOpen: boolean;
  /** Section-level problems, by tool: the error code. */
  errors: Record<string, string>;
  /** The Bousleh server asked for approval: show the one button that asks. */
  approval: boolean;
  /** Story id → what was done with it on this page. */
  done: Record<string, 'saved' | 'skipped' | 'busy'>;
  /** Commitment id → what was done with it on this page (done, drop, date, snooze), until the next read. */
  acted: Record<string, ActState>;
  /** "id:done" or "id:drop": the act waiting for a second press to confirm. */
  confirm: string | null;
  /** The Claude desktop app offers to install Home as an app: show the button. */
  install: boolean;
}

const c = tokens.color;
const toneClass = (tone: Tone) => `t-${tone}`;
const altShort = (alt: number) => SHORT_ALT[alt as keyof typeof SHORT_ALT] ?? String(alt);

export function renderPage(vm: ViewModel, ui: UiState): string {
  return `${rail(vm, ui)}<main class="main">${desktop(vm, ui)}</main>${phone(vm, ui)}${tabbar()}${ui.docsOpen ? docsPanel(vm) : ''}`;
}

// ---------------------------------------------------------------- shell

function modeWord(ui: UiState): string {
  switch (ui.mode) {
    case 'live':
      return 'Live';
    case 'snapshot':
      return `Snapshot ${ui.stamp}`;
    case 'connecting':
      return 'Connecting';
    default:
      return 'No data';
  }
}

function rail(vm: ViewModel, ui: UiState): string {
  const dot = ui.mode === 'live' ? 'live' : ui.mode === 'snapshot' ? 'snap' : 'off';
  const stampTitle =
    ui.mode === 'live' ? `Live data, read at ${ui.stamp}` : ui.mode === 'snapshot' ? `Snapshot taken at ${ui.stamp}` : 'No data yet';
  return `<nav class="rail" aria-label="Rail"><div class="rail-in">${logoFull(40)}<span class="rail-gap"></span>
<button class="ic on" type="button" aria-label="Home" aria-current="page">${icons.home}</button>
<button class="ic" type="button" data-action="docs" aria-expanded="${ui.docsOpen}" aria-label="Docs and decks, ${vm.docs.length}">${icons.docs}</button>
<span class="rail-fill"></span>
<span class="sweep" title="${esc(stampTitle)}"><span class="sweep-dot ${dot}"></span><span class="mono sweep-t">${esc(ui.stamp || '--:--')}</span></span>
<button class="ic ask" type="button" data-action="ask" aria-label="Ask Claude">›</button></div></nav>`;
}

function docsPanel(vm: ViewModel): string {
  const rows = vm.docs.length
    ? vm.docs
        .map(
          (d) =>
            `<a class="doc" href="${esc(safeUrl(d.url))}" target="_blank" rel="noopener noreferrer"><span class="chip">${esc(d.type)}</span><span class="trunc">${esc(d.title)}</span></a>`,
        )
        .join('')
    : '<span class="muted-note">No docs registered yet.</span>';
  return `<div class="docs-panel card" role="dialog" aria-label="Docs and decks"><div class="docs-h"><span class="eb">Docs and decks · ${vm.docs.length}</span><button class="chip" type="button" data-action="docs">Close</button></div>${rows}</div>`;
}

function tabbar(): string {
  return `<nav class="tabbar" aria-label="Tabs"><a class="tab on" href="#top" aria-current="page">${icons.home.replace('width="24" height="24"', 'width="22" height="22"')}<span class="mono">HOME</span></a>
<button class="drop" type="button" data-action="drop">${icons.mic(20)}Drop</button>
<button class="tab" type="button" data-action="ask" aria-label="Ask Claude"><span class="tab-ask">›</span><span class="mono">ASK</span></button></nav>`;
}

// ---------------------------------------------------------------- desktop

function hero(vm: ViewModel, ui: UiState): string {
  // With nothing read, say so: "Clear" would claim something Home doesn't know.
  if (!vm.have.includes('strata') && !vm.have.includes('pulse')) {
    return ui.mode === 'connecting' ? '<span class="t-muted">Opening Home</span>' : '<span class="t-muted">No data yet</span>';
  }
  if (vm.hero.needs > 0) return `<span class="t-needs">${vm.hero.needs}</span> needs you ${esc(vm.hero.band)}`;
  return '<span class="t-accent">Clear</span> · nothing needs you';
}

function readout(r: Readout): string {
  return `<span class="ro"><span class="eb">${esc(r.label)}</span><span class="disp ro-v ${toneClass(r.tone)}">${esc(r.value)}</span></span>`;
}

function promptBtn(cls: string, key: string | undefined, label: string, extra = ''): string {
  if (!key) return '';
  return `<button class="${cls}" type="button" data-prompt="${esc(key)}"${extra}>${esc(label)}</button>`;
}

function desktop(vm: ViewModel, ui: UiState): string {
  const head = `<header class="hdr" id="top"><div class="hdr-l"><span class="eb">${esc(vm.dateLabel)} · ${esc(vm.instance)} · ${esc(modeWord(ui))}</span><h1 class="disp hero">${hero(vm, ui)}</h1></div>
<div class="hdr-r"><div class="ros">${vm.readouts.map(readout).join('')}</div>${vm.secondary ? promptBtn('btn2', vm.secondary.prompt, vm.secondary.label) : ''}${vm.primary ? promptBtn('btn', vm.primary.prompt, vm.primary.label) : ''}</div></header>`;
  return `${head}${banner(ui)}${focusStrip(vm.focus, ui)}${vm.columns.length ? strata(vm, ui) : emptyCard(ui)}${legend()}${horizon(vm, ui)}${footer(ui)}`;
}

/** The few things to do first, above the grid: always there once Pulse is read; nothing when it wasn't. */
function focusStrip(focus: FocusVM | undefined, ui: UiState): string {
  // Shown whenever Pulse was read, empty or not, so "nothing pressing" never looks like "not working".
  if (!focus) return '';
  const cards = focus.items
    .map(
      (f, i) =>
        `<div class="fc ${f.tone}"><button class="fc-main" type="button" data-prompt="${esc(f.prompt)}" aria-label="${esc(f.label)}"><span class="fc-h"><span class="disp fc-n ${toneClass(f.tone)}">${i + 1}</span><span class="eb xs ${toneClass(f.tone)} trunc">${esc(f.eyebrow)}</span></span><span class="fc-t">${esc(f.title)}</span>${f.detail ? `<span class="fc-d">${esc(f.detail)}</span>` : ''}<span class="eb sm fc-s trunc">${esc(altShort(f.altitude))} · ${esc(f.scopeName)}</span></button>${acts(f, ui)}</div>`,
    )
    .join('');
  const empty = focus.items.length === 0 ? '<span class="muted-note">Nothing pressing today.</span>' : '';
  const more = focus.more > 0 ? promptBtn('chip', focus.morePrompt, `+${focus.more} more`) : '';
  const snoozed = focus.snoozed ? `<span class="mono fc-z">${esc(focus.snoozed)}</span>` : '';
  return `<section class="focus" aria-label="First"><div class="focus-h"><span class="eb">First</span><span class="focus-r">${snoozed}${more}</span></div><div class="focus-g">${cards}${empty}</div></section>`;
}

/**
 * Done, Date, Snooze and Drop on a commitment in focus: one op each, live only (snapshots and
 * meetings get none). Done and Drop ask for a second press. Once acted on, the row says what happened.
 */
export function acts(f: FocusItemVM, ui: UiState): string {
  if (ui.mode !== 'live' || f.kind !== 'commitment' || !f.id) return '';
  const id = esc(f.id);
  const state = ui.acted[f.id];
  if (state === 'busy') return '<div class="fc-a"><span class="mono fc-z">Saving…</span></div>';
  if (state) return `<div class="fc-a"><span class="mono fc-ok">${esc(ACT_STATE_LABEL[state])}</span></div>`;
  const btn = (act: string, label: string, confirmLabel?: string) => {
    const asking = confirmLabel !== undefined && ui.confirm === `${f.id}:${act}`;
    return `<button class="fa${asking ? ' ask' : ''}" type="button" data-act="${act}" data-id="${id}" aria-label="${esc(`${asking ? confirmLabel : label}: ${f.title}`)}">${esc(asking ? confirmLabel : label)}</button>`;
  };
  return `<div class="fc-a">${btn('done', 'Done', 'Mark done?')}${btn('date', 'Date')}${btn('snooze', 'Snooze')}${btn('drop', 'Drop', 'Drop it?')}</div>`;
}

function phoneFocus(focus: FocusVM | undefined, ui: UiState): string {
  if (!focus) return '';
  const rows = focus.items
    .map(
      (f, i) =>
        `<div class="pf-row"><span class="disp fc-n ${toneClass(f.tone)}">${i + 1}</span><span class="pb"><span class="eb xs ${toneClass(f.tone)}">${esc(f.eyebrow)}</span><span class="pc-m">${esc(f.title)}</span>${acts(f, ui)}</span></div>`,
    )
    .join('');
  const foot = [focus.more > 0 ? `+${focus.more} more` : '', focus.snoozed ?? ''].filter(Boolean).join(' · ');
  return `<div class="card pc pf"><span class="eb">First</span>${rows || '<span class="muted-note">Nothing pressing today.</span>'}${foot ? `<span class="mono fc-z">${esc(foot)}</span>` : ''}</div>`;
}

function banner(ui: UiState): string {
  const parts: string[] = [];
  if (ui.approval) {
    parts.push(
      '<div class="banner card"><span>Claude needs your OK to read Bousleh here.</span><button class="btn2 sm" type="button" data-action="allow">Allow Bousleh</button></div>',
    );
  }
  const errs = Object.entries(ui.errors);
  if (errs.length && ui.mode === 'live') {
    parts.push(
      `<div class="banner card mono">${errs.map(([tool, code]) => `<span>${esc(tool)}: ${esc(code.replace(/_/g, ' '))}</span>`).join('')}</div>`,
    );
  }
  return parts.join('');
}

function emptyCard(ui: UiState): string {
  if (ui.mode === 'connecting')
    return '<section class="card notice" aria-label="Strata"><span class="eb">Reading your data</span></section>';
  return `<section class="card notice" aria-label="Strata"><span class="eb">No data here yet</span><p>Home reads your Bousleh data live in the Claude desktop app, with the bousleh server connected. Anywhere else it shows the last snapshot, and none has been taken yet. Open Home once in the desktop app.</p></section>`;
}

function strata(vm: ViewModel, ui: UiState): string {
  const n = vm.columns.length;
  const head = vm.columns
    .map(
      (col) =>
        `<span class="colh"><span class="colh-n ${col.quiet ? 't-muted' : ''} trunc" title="${esc(col.name)}">${esc(col.name)}</span><span class="eb sm">${esc(col.eyebrow)}</span></span>`,
    )
    .join('');
  const note = ui.errors.context_strata
    ? `<span class="eb sm t-needs">Grid: ${esc(ui.errors.context_strata.replace(/_/g, ' '))}</span>`
    : '';
  const body = vm.rows
    .map((row, r) => {
      const dots = row.dots.map((s) => `<span class="dot" style="background:${stateColor(s)}"></span>`).join('');
      const alt = `<button class="alt${row.here ? ' here' : ''}" type="button" data-prompt="${esc(row.prompt)}" aria-label="${esc(row.number)} feet, ${esc(row.label)}${row.here ? ', needs you here' : ''}"><span class="disp alt-n">${esc(row.number)}</span><span class="eb sm">${esc(row.label)}</span><span class="dots">${dots}</span>${row.here ? '<span class="here-mark"></span>' : ''}</button>`;
      const cells = (vm.cells[r] ?? []).map((cell) => cellHtml(cell)).join('');
      return `${alt}${cells}<div class="lch">${row.launchers.map(launcher).join('')}</div>`;
    })
    .join('');
  return `<section class="card strata" aria-label="Strata" style="--cols:${n}"><span>${note}</span>${head}<span class="eb launch-h">Launch here</span>${body}</section>`;
}

function launcher(l: Launcher): string {
  const off = !l.prompt;
  return `<button class="lb${off ? ' off' : ''}" type="button"${off ? ' disabled aria-disabled="true"' : ` data-prompt="${esc(l.prompt)}"`}>${modeIcon(l.mode, off)}<span class="lb-t"><span class="m">${esc(l.mode)}</span><span class="trunc">${esc(l.label)}</span></span></button>`;
}

function item(i: ItemVM): string {
  return `<span class="it">${glyphSvg(i.glyph, 12)}<span class="trunc it-t ${toneClass(i.titleTone)}">${esc(i.title)}</span>${i.meta ? `<span class="mono it-m ${toneClass(i.metaTone)}">${esc(i.meta)}</span>` : ''}</span>`;
}

function moreRow(n: number): string {
  return n > 0 ? `<span class="mono more">+${n} more</span>` : '';
}

/** A cell, with its small follow-ups folded away beneath it when it has any. */
function cellHtml(cell: CellVM): string {
  const button = cellButton(cell);
  if (!cell.minor) return button;
  const m = cell.minor;
  const label = `Small follow-ups (${m.items.length})`;
  return `<div class="cellw">${button}<details class="minor"><summary class="eb sm${m.needs ? ' t-needs' : ''}">${esc(label)}</summary><span class="minor-l">${m.items.map(item).join('')}</span></details></div>`;
}

function cellButton(cell: CellVM): string {
  const attrs = `type="button" data-prompt="${esc(cell.prompt)}" aria-label="${esc(cell.label)}"`;
  if (cell.variant === 'void') return `<button class="void" ${attrs}>·</button>`;
  const items = cell.items.map(item).join('') + moreRow(cell.more);
  if (cell.variant === 'strategy' && cell.strategy) {
    const s = cell.strategy;
    const fill = s.stage >= 2 ? c.accent : c.muted;
    const segs = [0, 1, 2, 3].map((i) => `<span class="seg" style="background:${i <= s.stage ? fill : c.line}"></span>`).join('');
    return `<button class="cell" ${attrs}><span class="segs">${segs}</span><span class="st-t ${s.strong ? 't-fg' : 't-muted'}">${esc(s.title)}</span><span class="eb sm">${esc(s.status)}</span>${items ? `<span class="cell-rest">${items}</span>` : ''}</button>`;
  }
  if (cell.variant === 'needs' && cell.needs) {
    return `<button class="cell needs" ${attrs}><span class="it">${glyphSvg({ layer: 'moments', state: 'needs' }, 14)}<span class="eb xs t-needs">${esc(cell.needs.eyebrow)}</span></span><span class="nd-t">${esc(cell.needs.title)}</span>${items ? `<span class="cell-rest">${items}</span>` : ''}</button>`;
  }
  if (cell.variant === 'bet' && cell.bet) return `<button class="cell bet" ${attrs}>${betBody(cell.bet, 44)}</button>`;
  return `<button class="cell" ${attrs}>${items}</button>`;
}

function clockRing(bet: BetVM, size: number): string {
  if (!bet.clock) return '';
  const { days, elapsed } = bet.clock;
  const left = Math.max(0, days - elapsed);
  const color = left < 7 ? c.needs : c.accent;
  const circ = 113.1;
  const arc =
    elapsed > 0
      ? `<circle cx="22" cy="22" r="18" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${((Math.min(elapsed, days) / days) * circ).toFixed(1)} ${circ}" transform="rotate(-90 22 22)"/>`
      : `<line x1="22" y1="2" x2="22" y2="7" stroke="${c['accent-hi']}" stroke-width="2"/>`;
  const label = elapsed > 0 ? `day ${elapsed} of ${days}` : `${days} day clock, not started`;
  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 44 44" role="img" aria-label="${esc(label)}"><circle cx="22" cy="22" r="18" fill="none" stroke="${c.line}" stroke-width="4"/>${arc}<text x="22" y="26" text-anchor="middle" font-family="Bricolage Grotesque, sans-serif" font-weight="800" font-size="11" fill="${c.fg}">${left}d</text></svg>`;
}

function betBody(bet: BetVM, ring: number): string {
  const groups = bet.groups
    .map(
      (g) =>
        `<span class="grp"><span class="mono grp-l">${esc(g.label)}</span><span class="mono grp-n">${esc(g.note)}</span><span class="gs">${g.glyphs.map((gl) => glyphSvg(gl, 9)).join('')}</span></span>`,
    )
    .join('');
  return `<span class="bet-h"><span class="bet-tt"><span class="eb xs t-accent-hi">${esc(bet.eyebrow)}</span><span class="bet-t">${esc(bet.title)}</span></span>${clockRing(bet, ring)}</span>${bet.line ? `<span class="mono bet-l">${esc(bet.line)}</span>` : ''}${groups ? `<span class="grps">${groups}</span>` : ''}`;
}

function legend(): string {
  const shapes = (
    [
      ['anchors', 'Anchor'],
      ['evidence', 'Evidence'],
      ['work', 'Work'],
      ['people', 'People'],
      ['moments', 'Moment'],
    ] as const
  )
    .map(([layer, name]) => `<span class="lg">${glyphSvg({ layer, state: 'idle' }, 12)}${name}</span>`)
    .join('');
  const states = (
    [
      [c.needs, 'Needs you'],
      [c.accent, 'Yours'],
      [c.moving, 'Moving'],
      [c.closed, 'Closed'],
    ] as const
  )
    .map(([color, name]) => `<span class="lg"><span class="sq" style="background:${color}"></span>${name}</span>`)
    .join('');
  return `<div class="legend eb"><div class="lgs">${shapes}</div><div class="lgs">${states}</div></div>`;
}

// ---------------------------------------------------------------- Horizon

function storyMeta(s: StoryVM): string {
  return [s.scopeName, s.altitude ? altShort(s.altitude) : '', s.source, s.age].filter(Boolean).join(' · ');
}

function storyActions(s: StoryVM, ui: UiState, full: boolean): string {
  const done = ui.done[s.id];
  const open = s.url ? `<a class="btn2 sm" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : '';
  if (!full) return open;
  const canAct = ui.mode === 'live';
  let ops = '';
  if (done === 'saved') ops = '<span class="chip t-accent-hi">Saved</span>';
  else if (done === 'skipped') ops = '<span class="chip t-closed">Skipped</span>';
  else if (canAct && s.status !== 'to_read') {
    const busy = done === 'busy' ? ' disabled' : '';
    ops = `<button class="btn2 sm" type="button" data-op="save" data-id="${esc(s.id)}"${busy}>Save</button><button class="btn2 sm" type="button" data-op="skip" data-id="${esc(s.id)}"${busy}>Skip</button>`;
  } else if (s.status === 'to_read') ops = '<span class="chip t-accent-hi">On the list</span>';
  return `${open}${ops}${promptBtn('btn2 sm shape', s.shapePrompt, 'For Shape')}`;
}

function filtered(vm: ViewModel, ui: UiState): { lead: StoryVM | null; stories: StoryVM[] } {
  const all = [vm.horizon.lead, ...vm.horizon.stories].filter((s): s is StoryVM => s !== null);
  const keep = ui.filter === 'all' ? all : all.filter((s) => s.scope === ui.filter);
  return { lead: keep[0] ?? null, stories: keep.slice(1, 4) };
}

const PLACEHOLDER_LEAD = '[The lead: the newest finding on a scope with an open bet]';
const PLACEHOLDERS = ['[A headline from a watched competitor]', '[A headline on a watched topic]', '[A new post from a watched outlet]'];

function horizonState(vm: ViewModel): string {
  if (!vm.have.includes('watchlists')) return '<span class="chip dashed">Not read</span>';
  if (!vm.horizon.watching) return '<span class="chip dashed">No watch list yet</span>';
  if (!vm.horizon.lead) return '<span class="chip dashed">No findings this week</span>';
  return '';
}

function horizon(vm: ViewModel, ui: UiState): string {
  const h = vm.horizon;
  const { lead, stories } = filtered(vm, ui);
  const filters = h.filters.length
    ? [{ slug: 'all', name: 'All' }, ...h.filters]
        .map(
          (f) =>
            `<button class="chip fchip${ui.filter === f.slug ? ' on' : ''}" type="button" data-filter="${esc(f.slug)}" aria-pressed="${ui.filter === f.slug}">${esc(f.name)}</button>`,
        )
        .join('')
    : '';
  const reading = promptBtn('btn2 sm', h.readingPrompt, `Reading list · ${h.readingList}`);
  const max = Math.max(1, ...h.dayBars);
  const bars = h.dayBars
    .map((n, i) => {
      const pct = n === 0 ? 4 : Math.round(12 + (n / max) * 88);
      const label = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i];
      return `<span class="bar${n === max && n > 0 ? ' hot' : ''}" style="height:${pct}%" title="${label}: ${n}"></span>`;
    })
    .join('');
  const leadHtml = lead
    ? `<span class="hz-meta"><span class="chip ${lead.status === 'new' ? 'c-moving' : ''}">${esc(lead.status.replace('_', ' '))}</span><span class="eb">${esc(storyMeta(lead))}</span></span>
<h2 class="disp hz-lead">${esc(lead.title)}</h2>${lead.summary ? `<p class="hz-sum">${esc(lead.summary)}</p>` : ''}<div class="acts">${storyActions(lead, ui, true)}</div>`
    : `<h2 class="disp hz-lead t-muted">${esc(PLACEHOLDER_LEAD)}</h2><span class="skels"><span class="skel"></span><span class="skel"></span><span class="skel" style="width:55%"></span></span>`;
  const side = (stories.length ? stories : [])
    .map(
      (s) =>
        `<article class="story"><span class="eb">${esc(storyMeta(s))}</span><h3 class="disp hz-story">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>` : esc(s.title)}</h3>${s.summary ? `<p class="hz-sum sm">${esc(s.summary)}</p>` : ''}</article>`,
    )
    .join('');
  const sideHtml =
    side ||
    PLACEHOLDERS.map(
      (t) =>
        `<article class="story"><span class="eb">[scope] · [source] · [age]</span><h3 class="disp hz-story t-muted">${esc(t)}</h3><span class="skel"></span><span class="skel" style="width:65%"></span></article>`,
    ).join('');
  const beatMax = Math.max(1, ...h.beat.map((b) => b.count));
  const beat = h.beat.length
    ? h.beat
        .map(
          (b) =>
            `<div class="beat"><span class="trunc ${b.horizon ? 't-muted' : ''}">${esc(b.name)}</span><span class="beat-bar"><span style="width:${b.count === 0 ? 0 : Math.max(6, Math.round((b.count / beatMax) * 100))}%"></span></span><span class="mono ${b.count ? '' : 't-dim'}">${b.count}</span></div>`,
        )
        .join('')
    : '<span class="muted-note">Nothing watched yet.</span>';
  const changes = h.changes.length
    ? h.changes
        .map(
          (ch) =>
            `<span class="mono chg ${ch.kind === 'add' ? 't-moving' : 't-needs'}">${ch.kind === 'add' ? '+' : '?'} ${esc(ch.text)}</span>`,
        )
        .join('')
    : '<span class="mono chg t-dim">No changes proposed</span>';
  const noWatch = h.noWatch.length
    ? `<div class="hz-block"><span class="eb">No watch list</span><div class="chips">${h.noWatch.map((s) => `<button class="chip dashed" type="button" data-prompt="${esc(s.prompt)}">+ ${esc(s.name)}</button>`).join('')}</div></div>`
    : '';
  return `<section class="hz" aria-label="Horizon"><div class="hz-top"><div class="hz-mast"><span class="disp masthead">Horizon</span><span class="eb">${esc(h.eyebrow)}</span></div><div class="hz-tools">${horizonState(vm)}${filters}${reading}</div></div>
<div class="hz-grid"><article class="hz-lead-col"><span class="eb xs">Findings filed this week · Mon to Sun</span><div class="bars" role="img" aria-label="Findings filed per day this week">${bars}</div>${leadHtml}</article>
<div class="hz-side">${sideHtml}</div>
<div class="hz-beat"><span class="eb">The beat · ${h.watched} watched</span><div class="beats">${beat}</div><div class="hz-block"><span class="eb">List changes</span>${changes}</div>${noWatch}</div></div></section>`;
}

function footer(ui: UiState): string {
  const note =
    ui.mode === 'live'
      ? `Live from the bousleh server · ${esc(ui.stamp)}`
      : ui.mode === 'snapshot'
        ? `Snapshot from ${esc(ui.stamp)}. Live data needs the Claude desktop app with Bousleh connected.`
        : ui.mode === 'connecting'
          ? 'Connecting to the bousleh server'
          : 'No live data and no snapshot yet';
  const install = ui.install ? '<button class="btn2 sm" type="button" data-action="install">Install as app</button>' : '';
  return `<footer class="foot"><span class="lockup"><span class="disp">bousleh</span><span class="ar" lang="ar" dir="rtl">بوصلة</span></span>${install}<span class="mono foot-n">${note}</span></footer>`;
}

// ---------------------------------------------------------------- phone

function needsCard(n: NeedsVM): string {
  return `<div class="card pc needs-card">${'<span class="it">'}${glyphSvg({ layer: 'moments', state: 'needs' }, 14)}<span class="eb t-needs">${esc(altShort(n.altitude))} · ${esc(n.scope)} · ${esc(n.eyebrow.replace(/^You owe · |^Follow up · |^Owed · /, ''))}</span></span><span class="pc-t">${esc(n.title)}</span></div>`;
}

function meetingCard(m: MeetingVM): string {
  return `<div class="card pc row">${glyphSvg({ layer: 'moments', state: m.planned ? 'moving' : 'idle' }, 14)}<span class="pc-m trunc">${esc(m.title)}</span><span class="mono t-moving">${esc(m.when.toUpperCase())}</span></div>`;
}

function phoneBet(b: BetVM): string {
  return `<div class="card pc row bet-card">${clockRing(b, 56)}<span class="pb"><span class="eb xs t-accent-hi">${esc(altShort(b.altitude))} · ${esc(b.scopeName)} · bet</span><span class="pc-m">${esc(b.title)}</span>${b.line ? `<span class="mono bet-l">${esc(b.line)}</span>` : ''}</span></div>`;
}

function strataMini(vm: ViewModel): string {
  const n = vm.columns.length;
  const head = vm.columns
    .map((col) => `<span class="mono mini-h ${toneClass(col.tone === 'accent' ? 'accent-hi' : col.tone)}">${esc(col.short)}</span>`)
    .join('');
  const rows = vm.rows
    .map((row, r) => {
      const cells = (vm.cells[r] ?? [])
        .map((cell) => {
          if (cell.count === 0) return '<span class="mc e"></span>';
          const cls = cell.hasNeeds ? 'needs' : `h${cell.heat}`;
          return `<span class="mc ${cls}">${cell.count}</span>`;
        })
        .join('');
      return `<span class="mono mini-a ${row.here ? 't-accent-hi' : ''}">${esc(altShort(row.altitude))}</span>${cells}`;
    })
    .join('');
  return `<div class="card mini" style="--cols:${n}" role="img" aria-label="Strata: objects by scope and altitude"><span></span>${head}${rows}</div><div class="mini-cap mono"><span>${esc(vm.stats.strategies)}</span><span>${vm.stats.empty} empty</span></div>`;
}

function phone(vm: ViewModel, ui: UiState): string {
  const stamp =
    ui.mode === 'live'
      ? `<span class="chip">Live ${esc(ui.stamp)}</span>`
      : ui.mode === 'snapshot'
        ? `<span class="chip dashed">Snapshot ${esc(ui.stamp)}</span>`
        : ui.mode === 'connecting'
          ? '<span class="chip dashed">Connecting</span>'
          : '<span class="chip dashed">No snapshot</span>';
  const ros = vm.readouts
    .filter((r) => r.phone)
    .map(
      (r) =>
        `<div class="card pro"><span class="eb xs">${esc(r.label)}</span><span class="disp pro-v ${toneClass(r.tone)}">${esc(r.value)}</span></div>`,
    )
    .join('');
  const { lead, stories } = filtered(vm, { ...ui, filter: 'all' });
  const leadHtml = lead
    ? `<article class="p-lead"><span class="eb">${esc(storyMeta(lead))}</span><h2 class="disp p-lead-t">${esc(lead.title)}</h2>${lead.summary ? `<p class="hz-sum">${esc(lead.summary)}</p>` : ''}<div class="acts">${storyActions(lead, ui, false)}</div></article>`
    : `<article class="p-lead"><h2 class="disp p-lead-t t-muted">${esc(PLACEHOLDER_LEAD)}</h2><span class="skel"></span><span class="skel" style="width:65%"></span></article>`;
  const side = stories
    .slice(0, 2)
    .map(
      (s) =>
        `<article class="p-story"><span class="eb">${esc(storyMeta(s))}</span><h3 class="disp p-story-t">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a>` : esc(s.title)}</h3></article>`,
    )
    .join('');
  const body = vm.columns.length
    ? `${phoneFocus(vm.focus, ui)}${strataMini(vm)}${vm.phone.needs && !vm.focus?.items.length ? needsCard(vm.phone.needs) : ''}${vm.phone.meeting ? meetingCard(vm.phone.meeting) : ''}${vm.phone.bet ? phoneBet(vm.phone.bet) : ''}`
    : `<div class="card pc"><span class="eb">${ui.mode === 'connecting' ? 'Reading your data' : 'No snapshot yet'}</span>${ui.mode === 'connecting' ? '' : '<p class="hz-sum">Open Home once in the Claude desktop app with Bousleh connected; the phone then shows its last snapshot.</p>'}</div>`;
  return `<div class="ph"><div class="ph-top"><span class="ph-brand">${logoSmall(28)}<span class="disp ph-word">bousleh</span></span>${stamp}</div>
<div class="ph-hd"><span class="eb">${esc(vm.dateLabel)} · ${esc(vm.instance)}</span><h1 class="disp ph-hero">${hero(vm, ui)}</h1></div>
<div class="pros">${ros}</div>${body}
<section class="p-hz" aria-label="Horizon"><div class="p-hz-top"><span class="disp p-mast">Horizon</span>${horizonState(vm) || `<span class="chip">${vm.horizon.readingList} to read</span>`}</div><span class="eb">${esc(vm.horizon.eyebrow)}</span>${leadHtml}${side}</section>${footer(ui)}</div>`;
}
