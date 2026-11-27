import { type ReachFacts, reachOf } from './launch.js';
import { buildViewModel } from './model.js';
import type { Db, Desktop, Dictation, Mcp, Sample, Tts } from './platform.js';
import { initialUi, type UiState } from './render.js';
import type { Sources, ViewModel } from './types.js';

/*
 * The page's shared state at run time: what was read, what is drawn, which capabilities resolved, and
 * the few functions every part calls (schedule a paint, show a toast). main.ts fills it in at boot;
 * actions.ts, side.ts, capture.ts and shell.ts read and change it. Nothing here touches the DOM.
 */

export interface Caps {
  mcp: Mcp | null;
  db: Db | null;
  desktop: Desktop | null;
  sample: Sample | null;
  dictation: Dictation | null;
  tts: Tts | null;
}

export const app = {
  ui: initialUi() as UiState,
  sources: {} as Sources,
  view: buildViewModel({}, new Date()) as ViewModel,
  caps: { mcp: null, db: null, desktop: null, sample: null, dictation: null, tts: null } as Caps,
  facts: { installed: false, fullAccess: 'unavailable', platform: '', repo: null, sample: false, live: false } as ReachFacts,
  /** Ask's answers were turned off for this view (consent declined, or not offered). */
  askOff: false,
  /** Where dictated words go while dictation runs: the Ask box or the Capture box. */
  dictTarget: null as 'ask' | 'capture' | null,
  /** Why the last dictation start failed, if it did: shown in Capture with what to do. */
  dictRefused: null as DictRefusal,
  schedule: (): void => {},
  toast: (_text: string): void => {},
};

/** A dictation start the window refused: the person said no (or macOS keeps the microphone off), or it couldn't start. */
export type DictRefusal = 'not_granted' | 'unavailable' | null;

/** What Capture says when it can't take dictation, and the way to talk anyway (macOS's own dictation works in any text box). */
export function dictationNote(offered: boolean, refused: DictRefusal): string {
  const mac = "or press the Globe (fn) key twice for your Mac's own dictation";
  if (refused === 'not_granted')
    return `The microphone is off for Bousleh Home: turn it on in System Settings → Privacy & Security → Microphone, then reopen Home. Meanwhile type it, ${mac}.`;
  if (refused === 'unavailable') return `Dictation didn't start: press Dictate to try again, type it, ${mac}.`;
  if (!offered) return `Dictation isn't offered in this window: type it, ${mac}.`;
  return '';
}

/** Work out what this view can do from the facts, and the footer's note for the installed app. */
export function refreshReach(): void {
  app.facts.live = app.ui.mode === 'live' && app.caps.mcp !== null;
  app.facts.sample = app.caps.sample !== null && !app.askOff;
  app.ui.reach = reachOf(app.facts);
  app.schedule();
}
