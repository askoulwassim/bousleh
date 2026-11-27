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
  schedule: (): void => {},
  toast: (_text: string): void => {},
};

/** Work out what this view can do from the facts, and the footer's note for the installed app. */
export function refreshReach(): void {
  app.facts.live = app.ui.mode === 'live' && app.caps.mcp !== null;
  app.facts.sample = app.caps.sample !== null && !app.askOff;
  app.ui.reach = reachOf(app.facts);
  app.schedule();
}
