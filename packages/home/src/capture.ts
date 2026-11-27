import { captureName, captureText, failure } from './acts.js';
import { app } from './app.js';
import { SERVER } from './ask.js';
import { openClaude } from './claude.js';
import { icons, logoSmall } from './icons.js';
import { claudeTag } from './launch.js';
import { prompts } from './prompts.js';
import { whereTag } from './render.js';
import { unwrapBousleh } from './sources.js';

/*
 * Capture: a focused panel in the Home window, opened by the header's Capture button, the menu bar
 * item's "Capture…" and the shortcut ⌥⇧B. Dictation where the window offers it, with a live
 * transcript; otherwise a box to type in. Send to inbox is one op (inbox_drop) and the next sweep
 * files it, with Undo for a few seconds (inbox_settle, skipped). File it now opens a chat instead.
 */

type Phase = 'typing' | 'listening' | 'sending' | 'sent';

interface CaptureState {
  phase: Phase;
  /** The words so far: typed, or settled dictation. */
  text: string;
  /** Dictation's live guess for the phrase being spoken. */
  partial: string;
  sha256: string | null;
  /** The file was already in the inbox: nothing to undo. */
  duplicate: boolean;
  closesAt: number;
  note: string;
}

const UNDO_MS = 5000;
let state: CaptureState | null = null;
let closeTimer = 0;
let countdown = 0;

const wrap = () => document.getElementById('capture') as HTMLElement;
const part = <T extends HTMLElement>(selector: string) => wrap().querySelector(selector) as T;

export function initCapture(): void {
  wrap().innerHTML = `<section class="card cap" role="dialog" aria-modal="true" aria-label="Capture">
<div class="cap-h"><span class="cap-brand">${logoSmall(20)}<span>Capture</span></span><span class="eb cap-state"></span><button class="ic sm" type="button" data-action="cap-close" aria-label="Close Capture">${icons.close}</button></div>
<div class="cap-b">
<div class="cap-listen"><button class="listen" type="button" data-action="cap-mic" aria-label="Stop dictating">${icons.mic(18)}</button><span class="cap-lt"><span>Say it the way you'd tell a colleague</span><span class="mono">Tap the mic to stop and edit · Esc closes, nothing kept</span></span></div>
<div class="cap-live" aria-live="polite"><span class="cap-final"></span><span class="cap-partial"></span><span class="log-cursor">▍</span></div>
<span class="eb cap-nodict">Dictation isn't offered in this window: type it</span>
<textarea class="cap-text" aria-label="What to capture" placeholder="Say what you owe, who said what, what you decided…"></textarea>
<div class="cap-sent"><span class="cap-ok">${icons.check}</span><span class="cap-st"><span class="cap-st-t">In the inbox</span><span class="cap-st-d">The next sweep files it.</span></span></div>
<div class="cap-excerpt"></div>
<span class="mono cap-note" role="status"></span>
<div class="cap-f"><span class="mono cap-hint"></span><span class="cap-a">
<button class="btn2 sm cap-dict" type="button" data-action="cap-dictate">${icons.mic(16)}Dictate</button>
<button class="btn2 sm cap-undo" type="button" data-action="cap-undo">Undo</button>
<button class="btn2 sm cap-file" type="button" data-action="cap-file">File it now<span class="cap-tag"></span></button>
<button class="btn sm cap-send" type="button" data-action="cap-send">Send to inbox</button>
</span></div></div></section>`;
  const area = part<HTMLTextAreaElement>('.cap-text');
  area.addEventListener('input', () => {
    if (state) state.text = area.value;
  });
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  });
}

export function captureOpen(): boolean {
  return state !== null;
}

/** Can Send to inbox work here: the bousleh server, live. */
const canSend = () => app.caps.mcp !== null && app.ui.mode === 'live';

/**
 * Open Capture. `gesture` is true when this runs straight from a click in the page: only then can
 * dictation start at once. From the menu bar or the shortcut it opens ready to type, with Dictate.
 */
export function openCapture(gesture: boolean): void {
  clearTimeout(closeTimer);
  if (state && state.phase !== 'sent') {
    paint();
    part<HTMLTextAreaElement>('.cap-text').focus();
    return;
  }
  state = { phase: 'typing', text: '', partial: '', sha256: null, duplicate: false, closesAt: 0, note: '' };
  if (gesture && app.caps.dictation) startDictation();
  paint();
  if (state.phase === 'typing') requestAnimationFrame(() => part<HTMLTextAreaElement>('.cap-text').focus());
}

function startDictation(): void {
  const d = app.caps.dictation;
  if (!d || !state) return;
  app.dictTarget = 'capture';
  state.phase = 'listening';
  // Called straight from the click: nothing awaited before start().
  d.start().catch((err: { code?: string }) => {
    if (err?.code === 'not_granted' || err?.code === 'unavailable') app.caps.dictation = null;
    if (state?.phase === 'listening') state.phase = 'typing';
    paint();
  });
}

/** Dictation events, routed here by main.ts while Capture is the target. */
export function onCaptureDictation(kind: 'partial' | 'final' | 'state', text: string, dstate?: string): void {
  if (!state) return;
  if (kind === 'partial') state.partial = text;
  else if (kind === 'final') {
    state.text = `${state.text}${state.text ? text : text.trimStart()}`;
    state.partial = '';
  } else if (dstate === 'idle' && state.phase === 'listening') {
    state.phase = 'typing';
    state.partial = '';
    requestAnimationFrame(() => part<HTMLTextAreaElement>('.cap-text').focus());
  } else if ((dstate === 'listening' || dstate === 'starting') && state.phase === 'typing') {
    state.phase = 'listening';
  }
  paint();
}

async function stopDictation(): Promise<void> {
  if (app.dictTarget === 'capture') await app.caps.dictation?.stop().catch(() => {});
}

export function closeCapture(): boolean {
  if (!state) return false;
  if (state.phase === 'sending') return true;
  void stopDictation();
  state = null;
  clearTimeout(closeTimer);
  clearInterval(countdown);
  paint();
  return true;
}

async function send(): Promise<void> {
  if (!state || state.phase === 'sending' || state.phase === 'sent') return;
  if (state.phase === 'listening') {
    await stopDictation();
    if (!state) return;
  }
  const content = captureText(state.text);
  if (!content) {
    state.note = 'Nothing to send yet.';
    paint();
    return;
  }
  const mcp = app.caps.mcp;
  if (!mcp || !canSend()) return;
  state.phase = 'sending';
  state.note = '';
  paint();
  try {
    const out = unwrapBousleh(await mcp.callTool(SERVER, 'inbox_drop', { name: captureName(new Date()), content, source: 'local' }));
    if (!out.ok) throw { code: out.code };
    const o = out.output as { sha256?: string; duplicate?: boolean };
    if (!state) return;
    state.phase = 'sent';
    state.sha256 = typeof o.sha256 === 'string' ? o.sha256 : null;
    state.duplicate = o.duplicate === true;
    state.closesAt = Date.now() + UNDO_MS;
    void mcp.invalidate(SERVER, 'pulse_today').catch(() => {});
    closeTimer = window.setTimeout(() => {
      if (state?.phase === 'sent') closeCapture();
    }, UNDO_MS);
    countdown = window.setInterval(paint, 1000);
  } catch (err) {
    if (!state) return;
    state.phase = 'typing';
    state.note = `Not sent: ${failure(err)}. File it now opens a chat instead.`;
  }
  paint();
}

/** Undo a send: settle the inbox file as skipped, and give the words back to edit. */
async function undoSend(): Promise<boolean> {
  const mcp = app.caps.mcp;
  if (state?.phase !== 'sent' || !state.sha256 || state.duplicate || !mcp) return false;
  clearTimeout(closeTimer);
  clearInterval(countdown);
  try {
    const out = unwrapBousleh(await mcp.callTool(SERVER, 'inbox_settle', { sha256: state.sha256, outcome: 'skipped' }));
    if (!out.ok) throw { code: out.code };
    void mcp.invalidate(SERVER, 'pulse_today').catch(() => {});
    return true;
  } catch (err) {
    app.toast(`Couldn't take it back: ${failure(err)}. The sweep will file it.`);
    return false;
  }
}

async function fileNow(): Promise<void> {
  if (!state) return;
  if (state.phase === 'listening') await stopDictation();
  if (!state) return;
  const text = captureText(state.text);
  if (!text) {
    state.note = 'Nothing to file yet.';
    paint();
    return;
  }
  // Already sent: take it out of the inbox first, so it isn't filed twice.
  if (state.phase === 'sent' && !state.duplicate && !(await undoSend())) return;
  closeCapture();
  await openClaude(`${prompts.capture()}${text}`);
}

export async function onCaptureAction(action: string): Promise<void> {
  switch (action) {
    case 'cap-close':
      closeCapture();
      return;
    case 'cap-send':
      await send();
      return;
    case 'cap-file':
      await fileNow();
      return;
    case 'cap-mic':
      await stopDictation();
      return;
    case 'cap-dictate':
      startDictation();
      paint();
      return;
    case 'cap-undo':
      if (await undoSend()) {
        if (state) {
          state.phase = 'typing';
          state.note = '';
        }
        app.toast('Taken back out of the inbox.');
        paint();
        requestAnimationFrame(() => part<HTMLTextAreaElement>('.cap-text')?.focus());
      }
      return;
  }
}

const LABEL: Record<Phase, string> = { typing: 'Typing', listening: 'Listening', sending: 'Sending', sent: 'Sent' };

export function paint(): void {
  const el = wrap();
  el.hidden = state === null;
  if (!state) return;
  const s = state;
  const typing = s.phase === 'typing' || s.phase === 'sending';
  part<HTMLElement>('.cap-state').textContent = LABEL[s.phase];
  part<HTMLElement>('.cap-listen').hidden = s.phase !== 'listening';
  part<HTMLElement>('.cap-live').hidden = s.phase !== 'listening';
  part<HTMLElement>('.cap-final').textContent = s.text;
  part<HTMLElement>('.cap-partial').textContent = s.partial ? `${s.text ? ' ' : ''}${s.partial}` : '';
  part<HTMLElement>('.cap-nodict').hidden = !(typing && app.caps.dictation === null);
  const area = part<HTMLTextAreaElement>('.cap-text');
  area.hidden = !typing;
  if (typing && area.value !== s.text) area.value = s.text;
  area.disabled = s.phase === 'sending';
  part<HTMLElement>('.cap-sent').hidden = s.phase !== 'sent';
  part<HTMLElement>('.cap-st-d').textContent = s.duplicate ? 'It was already there: the next sweep files it.' : 'The next sweep files it.';
  part<HTMLElement>('.cap-excerpt').hidden = s.phase !== 'sent';
  part<HTMLElement>('.cap-excerpt').textContent = s.phase === 'sent' ? captureText(s.text) : '';
  part<HTMLElement>('.cap-note').textContent = s.note;
  const left = Math.max(0, Math.ceil((s.closesAt - Date.now()) / 1000));
  part<HTMLElement>('.cap-hint').textContent =
    s.phase === 'sent'
      ? `Closes in ${left} s`
      : canSend()
        ? '⌘↩ sends to the inbox'
        : 'Bousleh is not live here: File it now copies it for a chat';
  part<HTMLElement>('.cap-dict').hidden = !(typing && app.caps.dictation !== null);
  part<HTMLElement>('.cap-undo').hidden = !(s.phase === 'sent' && s.sha256 && !s.duplicate);
  part<HTMLElement>('.cap-send').hidden = s.phase === 'sent' || !canSend();
  part<HTMLButtonElement>('.cap-send').disabled = s.phase === 'sending';
  part<HTMLElement>('.cap-tag').innerHTML = whereTag(claudeTag(app.ui.reach));
}
