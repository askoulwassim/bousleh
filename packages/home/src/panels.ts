import type { AskBlock } from './ask.js';
import { toolsLine } from './ask.js';
import { esc } from './escape.js';
import { icons, logoFull } from './icons.js';
import { claudeTag } from './launch.js';
import type { DesktopPermission, PermissionState } from './platform.js';
import { actRow, type UiState, whereTag } from './render.js';
import type { LineTone, RunKind } from './runs.js';

/*
 * Markup for the parts outside the page grid: the Ask answer, the Tune and Health panels, and the
 * first-launch screen. Pure (tested); every string from data or from Claude goes through esc().
 */

export interface AskState {
  q: string;
  status: 'reading' | 'done' | 'stopped' | 'error';
  /** The tool being read right now, for "Reading pulse_today…". */
  reading: string;
  tools: string[];
  blocks: AskBlock[];
  error: string;
}

/** What Home knows to draw an answer's commitments and findings with their buttons. */
export interface AskLookups {
  /** Open commitments read live, by id. */
  commitments: Map<string, { title: string }>;
  /** Findings read live, by id. */
  findings: Map<string, { title: string; status: string; url: string }>;
  tts: boolean;
  speaking: boolean;
}

function block(b: AskBlock, i: number, ui: UiState, look: AskLookups): string {
  switch (b.type) {
    case 'p':
      return `<p class="ask-p${b.quiet ? ' quiet' : ''}">${esc(b.text)}</p>`;
    case 'li':
      return `<div class="ask-li"><span class="ask-dot"></span><span>${esc(b.text)}</span></div>`;
    case 'commitment': {
      const known = look.commitments.get(b.id);
      const acted = ui.acted[b.id];
      const title = known?.title ?? b.title;
      // Buttons only on a commitment Home read itself and that is still open (or was just acted on here).
      const row = known || acted ? actRow(b.id, title, ui, 'ask') : '';
      return `<div class="ask-item"><span class="ask-it">${esc(title || 'A commitment')}</span>${b.why ? `<span class="ask-why">${esc(b.why)}</span>` : ''}${row}</div>`;
    }
    case 'finding': {
      const known = look.findings.get(b.id);
      const title = known?.title ?? b.title;
      const done = ui.done[b.id];
      let acts = '';
      if (done === 'saved') acts = `<span class="mono fa-ok">${icons.check}Saved to your reading list</span>`;
      else if (done === 'skipped') acts = `<span class="mono t-closed">Skipped</span>`;
      else if (known && known.status === 'new' && ui.mode === 'live') {
        const busy = done === 'busy' ? ' disabled' : '';
        acts = `<button class="fa" type="button" data-op="save" data-id="${esc(b.id)}"${busy}>Save</button><button class="fa" type="button" data-op="skip" data-id="${esc(b.id)}"${busy}>Skip</button>`;
      }
      return `<div class="ask-item"><span class="ask-it">${esc(title || 'A finding')}</span>${b.source ? `<span class="eb sm">${esc(b.source)}</span>` : ''}${acts ? `<div class="fa-row">${acts}</div>` : ''}</div>`;
    }
    case 'handoff': {
      const open = ui.reach.open;
      return `<div class="ask-handoff"><div class="ask-prompt"><span class="eb">Prompt · ${esc(b.mode)}</span><p class="mono">${esc(b.prompt)}</p></div><div class="ask-acts">${whereTag(claudeTag(ui.reach))}<button class="btn2 sm" type="button" data-action="ask-copy" data-i="${i}">Copy</button><button class="btn sm" type="button" data-action="ask-open" data-i="${i}">${open ? 'Open in Claude' : 'Copy for Claude'}${open ? icons.out : ''}</button></div></div>`;
    }
  }
}

/** The Ask answer: the question, then reading, the blocks, or what went wrong; the footer once done. */
export function askHtml(a: AskState | null, ui: UiState, look: AskLookups): string {
  if (!a) return '';
  const q = `<div class="ask-q">${esc(a.q)}</div>`;
  if (a.status === 'reading') {
    const what = a.reading ? `Reading ${a.reading}…` : 'Thinking…';
    return `${q}<div class="ask-reading"><span class="mono t-moving">${esc(what)}</span><span class="skel"></span><span class="skel" style="width:80%"></span><span class="skel" style="width:60%"></span></div><div class="ask-acts"><button class="btn2 sm" type="button" data-action="ask-stop">${icons.stop}Stop</button></div>`;
  }
  const body = a.blocks.map((b, i) => block(b, i, ui, look)).join('');
  const error = a.status === 'error' ? `<p class="ask-p t-needs">${esc(a.error)}</p>` : '';
  const stopped = a.status === 'stopped' ? '<p class="ask-p quiet">Stopped.</p>' : '';
  const speak = look.tts
    ? `<button class="btn2 sm" type="button" data-action="ask-speak">${icons.speaker}${look.speaking ? 'Stop reading' : 'Read it to me'}</button>`
    : '';
  const cont = `<button class="btn2 sm" type="button" data-action="ask-continue">${ui.reach.open ? 'Continue in Claude' : 'Copy for Claude'}${ui.reach.open ? icons.out : ''}</button>`;
  const line = a.status === 'stopped' ? 'Stopped · changed nothing' : toolsLine(a.tools);
  const foot = `<div class="ask-foot"><span class="mono ask-tools">${esc(line)}</span><div class="ask-acts">${a.blocks.length ? speak : ''}${cont}</div></div>`;
  return `${q}<div class="ask-a">${body}${error}${stopped}</div>${foot}`;
}

export interface LogLine {
  /** "15:40:02" */
  t: string;
  text: string;
  tone: LineTone;
}

export interface RunState {
  kind: RunKind;
  status: 'running' | 'done' | 'failed' | 'stopped';
  lines: LogLine[];
  started: number;
  ended: number;
  code: number | null;
}

const TONE_CLASS: Record<LineTone, string> = { plain: '', muted: 't-muted', ok: 't-moving', needs: 't-needs', error: 't-accent-hi' };

export function logHtml(lines: readonly LogLine[], running: boolean): string {
  const rows = lines
    .map((l) => `<div class="log-l"><span class="t-dim">${esc(l.t)}</span><span class="${TONE_CLASS[l.tone]}">${esc(l.text)}</span></div>`)
    .join('');
  return `${rows}${running ? '<span class="log-cursor">▍</span>' : ''}`;
}

/** "Running · 1:53", "Finished", "Stopped", "Failed (exit 1)". */
export function runStatus(r: RunState, now: number, elapsed: (ms: number) => string): string {
  if (r.status === 'running') return `Running · ${elapsed(now - r.started)}`;
  if (r.status === 'stopped') return 'Stopped';
  if (r.status === 'failed') return r.code === null ? 'Failed' : `Failed (exit ${r.code})`;
  return 'Finished';
}

/** Why a run isn't offered here, and the one button that helps, if any. */
export function blockedHtml(reason: string, action: { action: string; label: string } | null): string {
  return `<div class="blocked"><span class="t-needs">${icons.warn}</span><span>${esc(reason)}</span>${action ? `<button class="btn2 sm" type="button" data-action="${esc(action.action)}">${esc(action.label)}</button>` : ''}</div>`;
}

export interface HealthRow {
  ok: boolean;
  name: string;
  detail: string;
}

export function healthRowsHtml(rows: readonly HealthRow[]): string {
  return rows
    .map(
      (r) =>
        `<div class="hl-row"><span class="${r.ok ? 't-moving' : 't-needs'}">${r.ok ? icons.check : icons.warn}</span><span class="hl-b"><span class="hl-n">${esc(r.name)}</span><span class="hl-d">${esc(r.detail)}</span></span></div>`,
    )
    .join('');
}

/** vault_health's answer as rows. */
export function healthRows(h: unknown, repo: string | null): HealthRow[] {
  const o = (typeof h === 'object' && h !== null ? h : {}) as {
    version?: string;
    home?: string;
    ops?: number;
    data?: { exists?: boolean; db?: boolean };
    backups?: { count?: number; latest?: string | null };
  };
  const rows: HealthRow[] = [];
  rows.push({
    ok: typeof o.ops === 'number',
    name: 'Bousleh server',
    detail: typeof o.ops === 'number' ? `v${o.version ?? '?'} · ${o.ops} ops answered` : 'Not read',
  });
  rows.push({
    ok: o.data?.db === true,
    name: 'Your data',
    detail: o.home ? `${o.home} · ${o.data?.db ? 'vault.db present' : 'no vault.db yet'} · private to this Mac` : 'Not read',
  });
  const count = o.backups?.count ?? 0;
  rows.push({
    ok: count > 0,
    name: 'Backups',
    detail: count > 0 ? `${count} snapshots · newest ${o.backups?.latest ?? '?'}` : 'None yet: the server takes one a day',
  });
  rows.push({ ok: repo !== null, name: 'Repo', detail: repo ?? 'Not known: run scripts/setup-mac.sh once' });
  return rows;
}

export const PERMISSION_ROWS: { name: DesktopPermission; title: string; what: string }[] = [
  {
    name: 'full-access',
    title: 'Open Claude and run Bousleh',
    what: 'Opens a chat or the Code tab with the prompt typed in, and runs Tune and health checks. Never sends a message for you.',
  },
  { name: 'menu-bar', title: 'Menu bar item', what: 'The needs-you count and quick actions.' },
  { name: 'shortcuts', title: 'Capture shortcut', what: '⌥⇧B opens Capture from anywhere.' },
];

/** First launch, in the installed window: each permission with Allow or Allowed; Open Home continues. */
export function firstLaunchHtml(states: Partial<Record<DesktopPermission, PermissionState>>): string {
  const rows = PERMISSION_ROWS.map((p) => {
    const state = states[p.name] ?? 'unavailable';
    const right =
      state === 'granted'
        ? `<span class="mono fa-ok">${icons.check}Allowed</span>`
        : state === 'prompt'
          ? `<button class="btn2 sm" type="button" data-action="perm" data-perm="${p.name}">Allow</button>`
          : state === 'denied'
            ? '<button class="btn2 sm" type="button" data-action="permissions-manage">Turned off · Change</button>'
            : '<span class="mono t-dim">Not available here</span>';
    return `<div class="fl-row"><div class="fl-b"><span class="fl-n">${esc(p.title)}</span><span class="fl-d">${esc(p.what)}</span></div>${right}</div>`;
  }).join('');
  return `<section class="card fl-card" role="dialog" aria-modal="true" aria-labelledby="fl-t">${logoFull(48)}<h1 id="fl-t" class="disp fl-t">Let Bousleh work on this Mac</h1><p class="fl-p">Each one is optional. Without them, Home works as it does today and every button copies a prompt.</p>${rows}<div class="fl-a"><button class="btn" type="button" data-action="first-continue">Open Home</button></div></section>`;
}
