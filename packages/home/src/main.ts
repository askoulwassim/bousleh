import { cancelPending, forgetSettled, onAct, supersedeFinding } from './actions.js';
import { app, refreshReach } from './app.js';
import { closeCapture, initCapture, onCaptureAction, onCaptureDictation, openCapture, paint as paintCapture } from './capture.js';
import { closeSheet, openClaude, openSheet, sheetCopy } from './claude.js';
import { clock } from './format.js';
import { buildViewModel } from './model.js';
import { type CallToolResult, type Db, type DocumentReference, type McpError, runtime, type WatchEvent } from './platform.js';
import { prompts } from './prompts.js';
import { renderPage } from './render.js';
import { allow, continueFirst, firstShown, initShell, install, manage, paintShell, permissionsButton } from './shell.js';
import { ask, closeSide, initSide, onAskAction, onAskDictation, onRunAction, paintSide, toggleSide } from './side.js';
import { readSnapshot, SNAPSHOT_PATH, type SnapshotDoc, shouldWrite, snapshotDoc } from './snapshot.js';
import { calendarArgs, normalizeCalendar, unwrapBousleh } from './sources.js';
import type { Sources } from './types.js';

/*
 * Home's runtime. First paint needs nothing: the page draws itself, then lights up as capabilities
 * resolve. Live: the bousleh server on this device (host:bousleh, the Claude desktop app only),
 * read with watchTool so the page stays current; the Google Calendar connector for today's events.
 * Elsewhere: the last snapshot from the db, stamped with its time.
 *
 * Where each button's work happens is a rule, not a setting (launch.ts): one op on a press, a
 * read-only answer (Ask) or a fixed run on this Mac happens here; anything that makes a Claude output,
 * needs a connector or the web, or writes on Claude's judgment opens Claude with the prompt typed in.
 * Without the installed app and full access, those buttons copy the prompt instead.
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

const ui = app.ui;
const sources = app.sources;
let stored: SnapshotDoc | null = null;
let storedRead: Promise<void> = Promise.resolve();
let snapshotRef: DocumentReference | null = null;
let unwatch: (() => void)[] = [];
const settled = new Set<string>();
let wrote = false;

const appEl = document.getElementById('app') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;
const _sheetEl = document.getElementById('sheet') as HTMLElement;

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
  if (ui.mode === 'live') app.view = buildViewModel(sources, new Date());
  else if (ui.mode === 'snapshot' && stored) app.view = stored.view;
  const html = renderPage(app.view, ui);
  if (html !== last) {
    const focus = focusKey(document.activeElement);
    last = html;
    appEl.innerHTML = html;
    if (focus) (appEl.querySelector(focus) as HTMLElement | null)?.focus();
  }
  paintSide();
  paintCapture();
  paintShell();
}

function focusKey(el: Element | null): string | null {
  if (!(el instanceof HTMLElement) || !appEl.contains(el)) return null;
  const act = el.getAttribute('data-act');
  const id = el.getAttribute('data-id');
  if (act !== null && id !== null) return `[data-act="${CSS.escape(act)}"][data-id="${CSS.escape(id)}"]`;
  for (const attr of ['data-day-input', 'data-prompt', 'data-ask', 'data-filter', 'data-action', 'data-id']) {
    const value = el.getAttribute(attr);
    if (value !== null) return `[${attr}="${CSS.escape(value)}"]`;
  }
  return null;
}

let toastTimer = 0;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), 3200);
}

app.schedule = schedule;
app.toast = toast;

// ---------------------------------------------------------------- live

function watchRead(key: keyof Sources, tool: string, input: Record<string, unknown>): () => void {
  const mcp = app.caps.mcp;
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
          // A fresh Pulse read shows what the acts changed: forget those whose Undo has closed.
          if (key === 'pulse') forgetSettled();
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
  if (ui.mode !== 'live') {
    ui.mode = 'live';
    refreshReach();
  }
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
    app.view = buildViewModel({}, new Date());
  }
  refreshReach();
  schedule();
}

function watchCalendar(): void {
  const mcp = app.caps.mcp;
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

// ---------------------------------------------------------------- buttons

/** A button with a prompt: answered here when it has an Ask question and Ask can answer, else to Claude (or copied). */
function onPrompt(target: HTMLElement): void {
  const askKey = target.dataset.ask;
  const question = askKey ? app.view.prompts[askKey] : undefined;
  if (question && ui.reach.ask) {
    void ask(question);
    return;
  }
  const text = app.view.prompts[target.dataset.prompt ?? ''] ?? question;
  if (!text) return;
  // The old capture prompt (snapshots taken before Capture lived here) opens Capture.
  if (text === prompts.capture()) {
    openCapture(true);
    return;
  }
  void openClaude(text);
}

async function allowRead(): Promise<void> {
  const mcp = app.caps.mcp;
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

function onAction(action: string, target: HTMLElement): void {
  if (action.startsWith('ask-')) {
    onAskAction(action, target);
    return;
  }
  if (action.startsWith('cap-')) {
    void onCaptureAction(action);
    return;
  }
  if (action.startsWith('run-') || action.startsWith('copy-') || action === 'publish-home' || action === 'health-refresh') {
    void onRunAction(action);
    return;
  }
  switch (action) {
    case 'side-ask':
    case 'side-tune':
    case 'side-health':
      toggleSide(action.slice(5) as 'ask' | 'tune' | 'health');
      break;
    case 'side-close':
      closeSide();
      break;
    case 'capture':
      openCapture(true);
      break;
    case 'docs':
      ui.docsOpen = !ui.docsOpen;
      schedule();
      break;
    case 'drop':
      // The phone's Drop: a prompt for the Drop skill, finished in the box, then copied.
      openSheet('Drop', prompts.drop(), true);
      break;
    case 'allow':
      void allowRead();
      break;
    case 'install':
      void install();
      break;
    case 'perm': {
      const name = target.dataset.perm;
      if (name === 'full-access' || name === 'menu-bar' || name === 'shortcuts') void allow(name);
      break;
    }
    case 'perm-full':
      void allow('full-access');
      break;
    case 'permissions-manage':
      void manage();
      break;
    case 'permissions':
      permissionsButton();
      break;
    case 'first-continue':
      void continueFirst();
      break;
    case 'sheet-copy':
      void sheetCopy();
      break;
    case 'sheet-close':
      closeSheet();
      break;
  }
}

document.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-act],[data-prompt],[data-ask],[data-op],[data-filter],[data-action]',
  );
  if (!target || (target as HTMLButtonElement).disabled) return;
  if (target.dataset.act && target.dataset.id) {
    const surface = target.closest('#side') ? 'ask' : target.dataset.surface === 'ask' ? 'ask' : 'first';
    onAct(target.dataset.act, target.dataset.id, surface, target.dataset.day);
  } else if (target.dataset.action) {
    onAction(target.dataset.action, target);
  } else if (target.dataset.prompt !== undefined || target.dataset.ask !== undefined) {
    onPrompt(target);
  } else if (target.dataset.op && target.dataset.id) {
    void supersedeFinding(target.dataset.id, target.dataset.op === 'save' ? 'save' : 'skip');
  } else if (target.dataset.filter) {
    ui.filter = target.dataset.filter;
    schedule();
  }
});

// The day picker's date input: keep what is typed, so a repaint doesn't lose it.
document.addEventListener('input', (event) => {
  const el = event.target as HTMLElement;
  if (el instanceof HTMLInputElement && el.dataset.dayInput && ui.picker?.id === el.dataset.dayInput) ui.picker.value = el.value;
});

function closeDocs(): boolean {
  if (!ui.docsOpen) return false;
  ui.docsOpen = false;
  schedule();
  return true;
}

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  // Each Escape closes one thing; claiming it keeps it from also stopping a reading aloud.
  const handled = closeSheet() || closeCapture() || cancelPending() || closeDocs() || (!firstShown() && closeSide());
  if (handled) event.preventDefault();
});

// ---------------------------------------------------------------- boot

async function boot(): Promise<void> {
  ui.version = document.querySelector<HTMLMetaElement>('meta[name="bousleh-version"]')?.content ?? '';
  initSide();
  initCapture();
  paint();
  const claude = runtime();
  if (!claude) {
    ui.mode = 'empty';
    schedule();
    return;
  }
  const use = <K extends Parameters<typeof claude.use>[0]>(name: K) => claude.use(name).catch(() => null);
  const dbPromise = use('db');
  storedRead = dbPromise.then(readStored);
  void dbPromise.then((db) => {
    app.caps.db = db;
  });
  void use('sample').then((s) => {
    app.caps.sample = s;
    refreshReach();
  });
  void use('tts').then((t) => {
    app.caps.tts = t;
    schedule();
  });
  void use('dictation').then((d) => {
    app.caps.dictation = d;
    if (!d) return;
    d.onPartial(({ text }) => {
      if (app.dictTarget === 'capture') onCaptureDictation('partial', text);
    });
    d.onFinal(({ text }) => {
      if (app.dictTarget === 'capture') onCaptureDictation('final', text);
      else if (app.dictTarget === 'ask') onAskDictation('final', text);
    });
    d.onState(({ state }) => {
      if (app.dictTarget === 'capture') onCaptureDictation('state', '', state);
      else if (app.dictTarget === 'ask') onAskDictation('state', '', state);
      if (state === 'idle') app.dictTarget = null;
    });
    schedule();
  });
  void Promise.all([use('desktop'), dbPromise]).then(([d]) => {
    app.caps.desktop = d;
    return initShell(d);
  });
  app.caps.mcp = await use('mcp');
  if (!app.caps.mcp) {
    await showSnapshot();
    return;
  }
  for (const [key, tool, input] of READS) unwatch.push(watchRead(key, tool, input));
  watchCalendar();
}

void boot();
