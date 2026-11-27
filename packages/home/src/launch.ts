/*
 * Where a button's work happens, and how Home opens Claude. Pure; tested.
 *
 * The rule (not a setting): Home does the work itself when it is one op on a press, a read-only
 * answer, or a fixed run on this Mac. It opens Claude when the work makes a Claude output (a Doc,
 * slides, a whiteboard, an artifact), needs a connector or the web, or writes to Bousleh on
 * Claude's judgment. Opening Claude types the prompt into a new chat and never sends it.
 */

/** Where a launcher's work happens, as its tag says. */
export type Where = 'here' | 'claude' | 'mac' | 'copy';

export const WHERE_LABEL: Record<Where, string> = { here: 'Here', claude: 'In Claude', mac: 'On this Mac', copy: 'Copy' };

/** What this view can do beyond copying. */
export interface Reach {
  /** Open Claude with a prompt typed in: the installed app, with full access, on macOS or Windows. */
  open: boolean;
  /** Run Tune and the health checks: the installed app, with full access, on macOS, with the repo known. */
  run: boolean;
  /** Answer in place: the sample capability and live data. */
  ask: boolean;
}

export const NO_REACH: Reach = { open: false, run: false, ask: false };

/** The facts Reach is worked out from. */
export interface ReachFacts {
  /** In the installed app's own window (desktop.fs exists). */
  installed: boolean;
  fullAccess: 'granted' | 'prompt' | 'denied' | 'unavailable';
  /** os.platform(): darwin, win32, linux… Empty when not known. */
  platform: string;
  /** The repo folder, from ~/.bousleh/app.json; null when that file is missing or unreadable. */
  repo: string | null;
  sample: boolean;
  live: boolean;
}

export function reachOf(f: ReachFacts): Reach {
  const open = f.installed && f.fullAccess === 'granted' && (f.platform === 'darwin' || f.platform === 'win32');
  return { open, run: open && f.platform === 'darwin' && f.repo !== null, ask: f.sample && f.live };
}

/** A Claude-bound launcher's tag: In Claude when Home can open it, else Copy (the fallback). */
export function claudeTag(reach: Reach): Where {
  return reach.open ? 'claude' : 'copy';
}

/** Why a run on this Mac isn't offered, in a few words; null when it is. */
export function runBlocker(f: ReachFacts): string | null {
  if (!f.installed) return 'Runs on this Mac need Home installed as an app, from the Claude desktop app.';
  if (f.platform && f.platform !== 'darwin') return 'Runs on this Mac are for macOS.';
  if (f.fullAccess !== 'granted') return 'Needs full access: allow "Open Claude and run Bousleh".';
  if (f.repo === null) return 'Run scripts/setup-mac.sh once, so Home knows where the repo is.';
  return null;
}

/** Prompts stay under this many characters, so the link stays well inside what the OS passes on. */
export const MAX_PROMPT = 5000;

/** A prompt cut to MAX_PROMPT characters (on a word when it can be), with an ellipsis when cut. */
export function clipPrompt(text: string): string {
  const t = text.trim();
  if (t.length <= MAX_PROMPT) return t;
  const cut = t.slice(0, MAX_PROMPT - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > MAX_PROMPT - 200 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Percent-encodes everything but letters, digits and - _ . ~ : stricter than encodeURIComponent,
 * which leaves ! ' ( ) * alone. The result holds no quote, space, $, backtick or backslash, so it is
 * safe inside double quotes in a shell command.
 */
export function enc(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** A new chat with the prompt typed in. Every mode opens one. */
export function chatUrl(prompt: string): string {
  return `claude://claude.ai/new?q=${enc(clipPrompt(prompt))}`;
}

/** The Code tab on a folder with the prompt typed in. Only Publish Home opens it. */
export function codeUrl(prompt: string, folder: string): string {
  return `claude://code/new?q=${enc(clipPrompt(prompt))}&folder=${enc(folder)}`;
}

/** What a URL from chatUrl or codeUrl looks like; anything else is never handed to a shell. */
const SAFE_URL = /^claude:\/\/(claude\.ai|code)\/new\?q=[A-Za-z0-9\-_.~%]*(&folder=[A-Za-z0-9\-_.~%]+)?$/;

/**
 * The one command that opens a Claude link: `open "<url>"` on macOS, `start "" "<url>"` on Windows.
 * Null for any other platform, or for a URL that isn't one Home built.
 */
export function openCommand(url: string, platform: string): string | null {
  if (!SAFE_URL.test(url)) return null;
  if (platform === 'darwin') return `open "${url}"`;
  if (platform === 'win32') return `start "" "${url}"`;
  return null;
}

/** The prompt for the one launcher that opens the Code tab. */
export const PUBLISH_HOME = 'Publish Home from docs/home.md.';
