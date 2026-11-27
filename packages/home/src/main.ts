import { type Act, actCall, actDoneState, captureName, captureText, minDay, quickDays } from './acts.js';
import { clock } from './format.js';
import { buildViewModel } from './model.js';
import {
  type CallToolResult,
  type Db,
  type Desktop,
  type DocumentReference,
  type Mcp,
  type McpError,
  runtime,
  type WatchEvent,
} from './platform.js';
import { prompts } from './prompts.js';
import { renderPage, type UiState } from './render.js';
import { readSnapshot, SNAPSHOT_PATH, type SnapshotDoc, shouldWrite, snapshotDoc } from './snapshot.js';
import { calendarArgs, normalizeCalendar, unwrapBousleh } from './sources.js';
import type { Sources, ViewModel } from './types.js';

/*
 * Home's runtime. First paint needs nothing: the page draws itself, then lights up as capabilities
 * resolve. Live: the bousleh server on this device (host:bousleh, the Claude desktop app only),
 * read with watchTool so the page stays current; the Google Calendar connector for today's events.
 * Elsewhere: the last snapshot from the db, stamped with its time. Every button is one op or one prompt:
 * live, a commitment in focus is closed, dropped, dated or snoozed in place, and a capture goes straight
 * to the inbox; everything that needs judgment is still a prompt to paste into Claude.
 */

const SERVER = 'host:bousleh';
const CALENDAR = 'Google Calendar';
const REFRESH_MS = 5 * 60_000;
/** Codes that mean the bousleh server can't be reached from this view: show the snapshot. */
const NO_HOST = new Set([
  'server_not_connected',
  'server_not_found',
  'not_granted',
  'capability_disabled',
  'capability_removed',
  'not_in_manifest',
  'blocked_by_policy',
  'selection_required',
  'consent_required',
  'user_changed',
  'needs_reauth',
]);

/** What the page reads from the bousleh server, keyed by the Sources field it fills. */
const READS: [keyof Sources, string, Record<string, unknown>][] = [
  ['strata', 'context_strata', { per_cell: 10 }],
  ['pulse', 'pulse_today', {}],
  ['digest', 'watch_digest', {}],
  ['reading', 'watch_digest', { status: ['to_read'], limit: 1 }],
  ['watchlists', 'watchlists_get', {}],
  ['queue', 'queue_list', {}],
  ['commitments', 'commitments_list', { status: 'open', limit: 200 }],
  ['assets', 'assets_list', { limit: 50 }],
];

const sources: Sources = {};
const ui: UiState = {
  mode: 'connecting',
  stamp: '',
  filter: 'all',
  docsOpen: false,
  errors: {},
  approval: false,
  done: {},
  acted: {},
  confirm: null,
  install: false,
};
let view: ViewModel = buildViewModel({}, new Date());
let stored: SnapshotDoc | null = null;
let storedRead: Promise<void> = Promise.resolve();
let snapshotRef: DocumentReference | null = null;
let mcp: Mcp | null = null;
let desktop: Desktop | null = null;
let unwatch: (() => void)[] = [];
const settled = new Set<string>();
let wrote = false;

const app = document.getElementById('app') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;
const sheetEl = document.getElementById('sheet') as HTMLElement;

// ---------------------------------------------------------------- render

let queued = false;
let last = '';
function schedule(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    paint();
  });
}

function paint(): void {
  if (ui.mode === 'live' || ui.mode === 'connecting') {
    if (ui.mode === 'live') view = buildViewModel(sources, new Date());
  } else if (ui.mode === 'snapshot' && stored) {
    view = stored.view;
  }
  updateBadge();
  const html = renderPage(view, ui);
  if (html === last) return;
  const focus = focusKey(document.activeElement);
  last = html;
  app.innerHTML = html;
  if (focus) (app.querySelector(focus) as HTMLElement | null)?.focus();
}

function focusKey(el: Element | null): string | null {
  if (!(el instanceof HTMLElement) || !app.contains(el)) return null;
  for (const attr of ['data-prompt', 'data-filter', 'data-action', 'data-act', 'data-id']) {
    const value = el.getAttribute(attr);
    if (value !== null) return `[${attr}="${CSS.escape(value)}"]`;
  }
  return null;
}

// ---------------------------------------------------------------- live

function watchRead(key: keyof Sources, tool: string, input: Record<string, unknown>): () => void {
  if (!mcp) return () => {};
  return mcp.watchTool(
    SERVER,
    tool,
    input,
    (ev: WatchEvent) => {
      if (ev.type === 'data') {
        const out = unwrapBousleh(ev.result);
        if (out.ok) {
          (sources as Record<string, unknown>)[key] = out.output;
          // A fresh Pulse read shows what the acts changed: drop their "Marked done" lines.
          if (key === 'pulse') for (const [id, state] of Object.entries(ui.acted)) if (state !== 'busy') delete ui.acted[id];
          delete ui.errors[tool];
          ui.approval = false;
          goLive(ev.result);
        } else {
          ui.errors[tool] = out.code;
        }
      } else {
        onReadError(tool, ev.error);
      }
      settled.add(key);
      schedule();
      void maybeWriteSnapshot();
    },
    { refetchInterval: REFRESH_MS },
  );
}

function goLive(result: CallToolResult): void {
  if (ui.mode !== 'live') ui.mode = 'live';
  const at = result.cache?.storedAt ? new Date(result.cache.storedAt) : new Date();
  ui.stamp = clock(at);
}

function onReadError(tool: string, error: McpError): void {
  if (NO_HOST.has(error.code)) {
    void showSnapshot();
    return;
  }
  if (error.code === 'approval_required') {
    ui.approval = true;
    return;
  }
  if (error.code === 'tool_error') {
    const out = unwrapBousleh(error.result);
    ui.errors[tool] = out.ok ? 'tool_error' : out.code;
    return;
  }
  // Transient: keep the last good data, note the section.
  ui.errors[tool] = error.code;
}

async function showSnapshot(): Promise<void> {
  for (const stop of unwatch) stop();
  unwatch = [];
  await storedRead;
  if (Object.keys(sources).length > 0 && ui.mode === 'live') {
    // Access went away after live data arrived: drop it.
    for (const key of Object.keys(sources)) delete (sources as Record<string, unknown>)[key];
  }
  ui.errors = {};
  ui.approval = false;
  if (stored) {
    ui.mode = 'snapshot';
    ui.stamp = clock(new Date(stored.taken_at));
  } else {
    ui.mode = 'empty';
    view = buildViewModel({}, new Date());
  }
  schedule();
}

function watchCalendar(): void {
  if (!mcp) return;
  unwatch.push(
    mcp.watchTool(
      CALENDAR,
      'list_events',
      calendarArgs(new Date()),
      (ev) => {
        // No calendar (not connected, declined, lapsed): Home shows the meetings filed in Bousleh only.
        sources.calendar = ev.type === 'data' ? normalizeCalendar(ev.result.payload ?? ev.result.structuredContent) : undefined;
        schedule();
      },
      { refetchInterval: 10 * 60_000 },
    ),
  );
}

// ---------------------------------------------------------------- snapshot

async function maybeWriteSnapshot(): Promise<void> {
  if (wrote || ui.mode !== 'live' || !sources.strata || settled.size < READS.length) return;
  wrote = true;
  await storedRead;
  const claude = runtime();
  const user = claude ? await claude.use('user') : null;
  if (!snapshotRef || !user || !(await user.isOwner())) return;
  const current = buildViewModel(sources, new Date());
  if (!shouldWrite(current, stored)) return;
  const doc = snapshotDoc(current, new Date());
  if (!doc) return;
  try {
    await snapshotRef.set(doc as unknown as Record<string, unknown>);
    stored = doc;
  } catch (err) {
    console.warn('Bousleh Home: snapshot not saved', (err as { code?: string }).code ?? err);
  }
}

async function readStored(db: Db | null): Promise<void> {
  if (!db) return;
  try {
    snapshotRef = db.doc(SNAPSHOT_PATH);
    const snap = await snapshotRef.get();
    stored = snap.exists ? readSnapshot(snap.data()) : null;
  } catch {
    stored = null;
  }
  // Until live data arrives, the last snapshot is better than nothing.
  if (ui.mode === 'connecting' && stored) {
    ui.mode = 'snapshot';
    ui.stamp = clock(new Date(stored.taken_at));
    schedule();
  }
}

// ---------------------------------------------------------------- actions

let toastTimer = 0;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 2600);
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * A prompt goes to the clipboard; if the clipboard is refused, it shows in a box to select. A capture
 * prompt ("Capture this: ", "Drop this: ") opens the capture box instead, which sends live.
 */
async function launch(text: string): Promise<void> {
  if (text === prompts.capture() || text === prompts.drop()) {
    openCapture(text === prompts.drop() ? 'Drop' : 'Capture', text);
    return;
  }
  if (await copy(text)) toast('Copied. Paste it into Claude.');
  else openSheet('Copy this prompt', text, false);
}

type SheetKind = 'copy' | 'compose' | 'capture' | 'when';
/** For the when sheet: which act and which commitment. */
let pending: { act: 'date' | 'snooze'; id: string } | null = null;

const part = <T extends HTMLElement>(selector: string) => sheetEl.querySelector(selector) as T;

function showSheet(kind: SheetKind, title: string, note: string): void {
  part<HTMLElement>('.sheet-t').textContent = title;
  part<HTMLElement>('.sheet-n').textContent = note;
  part<HTMLElement>('.sheet-q').hidden = kind !== 'when';
  part<HTMLInputElement>('.sheet-day').hidden = kind !== 'when';
  part<HTMLTextAreaElement>('textarea').hidden = kind === 'when';
  const copyBtn = part<HTMLButtonElement>('[data-action="sheet-copy"]');
  copyBtn.hidden = kind === 'when';
  // Copy is the main button unless the sheet can send or set in place.
  copyBtn.className = kind === 'capture' ? 'btn2 sm' : 'btn';
  part<HTMLButtonElement>('[data-action="sheet-inbox"]').hidden = kind !== 'capture';
  part<HTMLButtonElement>('[data-action="sheet-set"]').hidden = kind !== 'when';
  sheetEl.hidden = false;
}

function openSheet(title: string, text: string, editable: boolean): void {
  showSheet(
    editable ? 'compose' : 'copy',
    title,
    editable ? 'Finish it here, copy it, then paste it into Claude.' : 'The clipboard was not available. Select the text and copy it.',
  );
  const area = part<HTMLTextAreaElement>('textarea');
  area.value = text;
  area.readOnly = !editable;
  area.focus();
  if (editable) area.setSelectionRange(text.length, text.length);
  else area.select();
}

/** Capture or Drop: live, the note goes straight to the inbox, where the Hourly inbox sweep files it. */
function openCapture(title: string, text: string): void {
  if (!mcp || ui.mode !== 'live') {
    openSheet(title, text, true);
    return;
  }
  showSheet('capture', title, 'Send puts it in your Bousleh inbox; the hourly sweep files it. Or copy it into Claude to file it now.');
  const area = part<HTMLTextAreaElement>('textarea');
  area.value = text;
  area.readOnly = false;
  area.focus();
  area.setSelectionRange(text.length, text.length);
}

/** Date or Snooze: pick a day for one commitment. */
function openWhen(act: 'date' | 'snooze', id: string): void {
  const now = new Date();
  pending = { act, id };
  const quick = part<HTMLElement>('.sheet-q');
  quick.replaceChildren(
    ...quickDays(act, now).map(({ label, day }) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.action = 'sheet-day';
      b.dataset.day = day;
      b.textContent = label;
      return b;
    }),
  );
  const input = part<HTMLInputElement>('.sheet-day');
  input.min = minDay(act, now);
  input.value = quickDays(act, now)[act === 'date' ? 1 : 0]?.day ?? input.min;
  showSheet(
    'when',
    act === 'date' ? 'Due when?' : 'Snooze until?',
    act === 'date' ? 'Sets its due date.' : 'It stays out of sight until that day, then comes back as due.',
  );
  input.focus();
}

function closeSheet(): void {
  sheetEl.hidden = true;
  pending = null;
}

async function sendCapture(): Promise<void> {
  const area = part<HTMLTextAreaElement>('textarea');
  const content = captureText(area.value);
  if (!content) {
    part<HTMLElement>('.sheet-n').textContent = 'Write something first.';
    return;
  }
  if (!mcp) return;
  const button = part<HTMLButtonElement>('[data-action="sheet-inbox"]');
  button.disabled = true;
  try {
    const out = unwrapBousleh(await mcp.callTool(SERVER, 'inbox_drop', { name: captureName(new Date()), content, source: 'local' }));
    if (!out.ok) throw { code: out.code };
    closeSheet();
    toast('In the inbox. The hourly sweep files it.');
    void mcp.invalidate(SERVER, 'pulse_today').catch(() => {});
  } catch (err) {
    part<HTMLElement>('.sheet-n').textContent = `Not sent (${failure(err)}). Copy it into Claude instead.`;
  } finally {
    button.disabled = false;
  }
}

function failure(err: unknown): string {
  const code = (err as { code?: string }).code ?? 'error';
  return code === 'cancelled'
    ? 'cancelled in the app'
    : code === 'approval_required'
      ? 'needs your OK in the Claude app'
      : code.replace(/_/g, ' ');
}

let confirmTimer = 0;
/** Done and Drop ask for a second press; Date and Snooze open the day picker. */
function onAct(act: Act, id: string): void {
  if (!mcp || ui.mode !== 'live' || ui.acted[id]) return;
  if (act === 'date' || act === 'snooze') {
    openWhen(act, id);
    return;
  }
  const key = `${id}:${act}`;
  if (ui.confirm !== key) {
    ui.confirm = key;
    clearTimeout(confirmTimer);
    confirmTimer = window.setTimeout(() => {
      ui.confirm = null;
      schedule();
    }, 4000);
    schedule();
    return;
  }
  ui.confirm = null;
  void runAct(act, id);
}

async function runAct(act: Act, id: string, day?: string): Promise<void> {
  if (!mcp) return;
  const { tool, input } = actCall(act, id, day);
  ui.acted[id] = 'busy';
  schedule();
  try {
    const out = unwrapBousleh(await mcp.callTool(SERVER, tool, input));
    if (!out.ok) throw { code: out.code };
    ui.acted[id] = actDoneState(act);
    for (const read of ['pulse_today', 'context_strata', 'commitments_list']) void mcp.invalidate(SERVER, read).catch(() => {});
  } catch (err) {
    delete ui.acted[id];
    toast(`Not changed (${failure(err)})`);
  }
  schedule();
}

async function install(): Promise<void> {
  if (!desktop) return;
  const answer = await desktop.install.request().catch(() => 'failed' as const);
  if (answer === 'installed') ui.install = false;
  else if (answer === 'failed') toast('Could not install. Try Install as app from the artifact menu.');
  schedule();
}

/** In the installed app's window: its own icon, and the number of things that need you on the Dock. */
async function dressApp(d: Desktop): Promise<void> {
  if (!d.app) return;
  const src = document.querySelector<HTMLMetaElement>('meta[name="bousleh-app-icon"]')?.content;
  if (src) {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      canvas.getContext('2d')?.drawImage(img, 0, 0, 256, 256);
      void d.app?.dock.setIcon(canvas.toDataURL('image/png')).catch(() => {});
    };
    img.src = src;
  }
}

let badge = '';
function updateBadge(): void {
  if (!desktop?.app || ui.mode !== 'live') return;
  const text = view.hero.needs > 0 ? String(view.hero.needs) : '';
  if (text === badge) return;
  badge = text;
  void desktop.app.dock.setBadge(text).catch(() => {});
}

async function supersede(id: string, op: 'save' | 'skip'): Promise<void> {
  if (!mcp || ui.mode !== 'live') return;
  ui.done[id] = 'busy';
  schedule();
  try {
    const result = await mcp.callTool(SERVER, 'vault_supersede', { id, status: op === 'save' ? 'to_read' : 'dismissed' });
    const out = unwrapBousleh(result);
    if (!out.ok) throw { code: out.code, message: out.message };
    ui.done[id] = op === 'save' ? 'saved' : 'skipped';
    toast(op === 'save' ? 'Saved to the reading list' : 'Skipped');
    void mcp.invalidate(SERVER, 'watch_digest').catch(() => {});
    void mcp.invalidate(SERVER, 'context_strata').catch(() => {});
  } catch (err) {
    delete ui.done[id];
    const code = (err as { code?: string }).code ?? 'error';
    toast(
      code === 'cancelled'
        ? 'Cancelled in the app'
        : code === 'approval_required'
          ? 'Needs your OK in the Claude app'
          : `Not changed (${code.replace(/_/g, ' ')})`,
    );
  }
  schedule();
}

async function allow(): Promise<void> {
  if (!mcp) return;
  try {
    const result = await mcp.callTool(SERVER, 'context_strata', { per_cell: 10 });
    const out = unwrapBousleh(result);
    if (out.ok) {
      sources.strata = out.output as Sources['strata'];
      ui.approval = false;
      goLive(result);
      void mcp.invalidate(SERVER).catch(() => {});
    }
  } catch (err) {
    onReadError('context_strata', err as McpError);
  }
  schedule();
}

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-prompt],[data-op],[data-act],[data-filter],[data-action]');
  if (!target) return;
  if (target.dataset.act && target.dataset.id) {
    onAct(target.dataset.act as Act, target.dataset.id);
  } else if (target.dataset.prompt !== undefined) {
    const text = view.prompts[target.dataset.prompt];
    if (text) void launch(text);
  } else if (target.dataset.op && target.dataset.id) {
    void supersede(target.dataset.id, target.dataset.op === 'save' ? 'save' : 'skip');
  } else if (target.dataset.filter) {
    ui.filter = target.dataset.filter;
    schedule();
  } else {
    switch (target.dataset.action) {
      case 'docs':
        ui.docsOpen = !ui.docsOpen;
        schedule();
        break;
      case 'ask':
        openSheet('Ask Claude', prompts.ask(), true);
        break;
      case 'drop':
        openCapture('Drop', prompts.drop());
        break;
      case 'install':
        void install();
        break;
      case 'sheet-inbox':
        void sendCapture();
        break;
      case 'sheet-day':
        part<HTMLInputElement>('.sheet-day').value = target.dataset.day ?? '';
        if (pending && target.dataset.day) {
          const { act, id } = pending;
          closeSheet();
          void runAct(act, id, target.dataset.day);
        }
        break;
      case 'sheet-set': {
        const day = part<HTMLInputElement>('.sheet-day').value;
        if (!pending || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          part<HTMLElement>('.sheet-n').textContent = 'Pick a day.';
          break;
        }
        const { act, id } = pending;
        closeSheet();
        void runAct(act, id, day);
        break;
      }
      case 'allow':
        void allow();
        break;
      case 'sheet-copy': {
        const area = part<HTMLTextAreaElement>('textarea');
        void copy(area.value).then((done) => {
          if (done) {
            closeSheet();
            toast('Copied. Paste it into Claude.');
          } else {
            area.select();
            (sheetEl.querySelector('.sheet-n') as HTMLElement).textContent =
              'The clipboard was not available. Select the text and copy it.';
          }
        });
        break;
      }
      case 'sheet-close':
        closeSheet();
        break;
    }
  }
});

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (!sheetEl.hidden) closeSheet();
  else if (ui.confirm) {
    ui.confirm = null;
    schedule();
  } else if (ui.docsOpen) {
    ui.docsOpen = false;
    schedule();
  }
});

// ---------------------------------------------------------------- boot

async function boot(): Promise<void> {
  paint();
  const claude = runtime();
  if (!claude) {
    ui.mode = 'empty';
    schedule();
    return;
  }
  void claude
    .use('desktop')
    .catch(() => null)
    .then(async (d) => {
      desktop = d;
      if (!d) return;
      void dressApp(d);
      ui.install = (await d.install.state().catch(() => 'unavailable')) === 'available';
      schedule();
    });
  const dbPromise = claude.use('db').catch(() => null);
  storedRead = dbPromise.then(readStored);
  mcp = await claude.use('mcp').catch(() => null);
  if (!mcp) {
    await showSnapshot();
    return;
  }
  for (const [key, tool, input] of READS) unwatch.push(watchRead(key, tool, input));
  watchCalendar();
}

void boot();
