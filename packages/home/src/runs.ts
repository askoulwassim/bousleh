/*
 * The fixed runs on this Mac: Tune now, the health check and Rerun setup. Home only ever runs these
 * commands, in the repo folder, through the user's login shell. Nothing from data goes into a
 * command: the repo path is only the working folder. Pure; tested.
 */

export type RunKind = 'tune' | 'check' | 'setup';

/** Where scripts/setup-mac.sh tells Home the repo is. Never inside the repo. */
export const APP_JSON = '~/.bousleh/app.json';

export const SETUP_COMMAND = 'scripts/setup-mac.sh';

/**
 * Tune: Claude Code, headless, on the repo. acceptEdits lets it edit files in the repo; the allowed
 * tools let it call the bousleh MCP tools and run git, gh and pnpm without asking (no one is there to
 * answer); stream-json (which needs --verbose with -p) prints each step as it happens.
 */
export const TUNE_COMMAND =
  'claude -p "Tune: run the Friday tune-up now." --permission-mode acceptEdits --output-format stream-json --verbose --allowedTools "mcp__bousleh" "Bash(git *)" "Bash(gh *)" "Bash(pnpm *)"';

export const COMMANDS: Record<RunKind, string> = {
  tune: TUNE_COMMAND,
  check: `${SETUP_COMMAND} --check`,
  setup: SETUP_COMMAND,
};

export interface RunSpec {
  command: string;
  args: string[];
  cwd: string;
}

/** The process to spawn: the login shell running one fixed command, in the repo folder. */
export function runSpec(kind: RunKind, repo: string): RunSpec {
  return { command: '/bin/zsh', args: ['-lc', COMMANDS[kind]], cwd: repo };
}

/** The repo folder from ~/.bousleh/app.json's text: an absolute path with no control characters; else null. */
export function readAppJson(text: string): string | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const repo = (data as { repo?: unknown } | null)?.repo;
  if (typeof repo !== 'string' || !repo.startsWith('/') || repo.length > 1024) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is refused
  if (/[\u0000-\u001f\u007f]/.test(repo)) return null;
  return repo.replace(/\/+$/, '') || '/';
}

/** Splits streamed output into whole lines: returns the lines and what is left of an unfinished one. */
export function splitLines(pending: string, chunk: string): { lines: string[]; rest: string } {
  const parts = (pending + chunk).split(/\r?\n/);
  const rest = parts.pop() ?? '';
  return { lines: parts, rest };
}

export type LineTone = 'plain' | 'muted' | 'ok' | 'needs' | 'error';

export interface RunLine {
  text: string;
  tone: LineTone;
}

/** Strips terminal colour codes and the like from a line of script output. */
export function plainText(line: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes start with ESC
  return line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\s+$/, '');
}

/** A setup-mac.sh line: ✓ lines read as ok, ! lines as needing a look. */
export function scriptLine(raw: string): RunLine | null {
  const text = plainText(raw);
  if (text.trim() === '') return null;
  const t = text.trim();
  if (t.startsWith('✓')) return { text, tone: 'ok' };
  if (t.startsWith('!')) return { text, tone: 'needs' };
  return { text, tone: 'plain' };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A tool's name as a person reads it: mcp__bousleh__vault_activity → vault_activity. */
function toolName(name: string): string {
  const m = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(name);
  return m?.[1] ?? name;
}

function clipLine(text: string, max = 160): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

/**
 * One line of `claude -p --output-format stream-json` as lines for the log: what Claude says, each
 * tool it calls, and how the run ended. Anything that isn't one of its JSON events is shown as is.
 */
export function tuneLines(raw: string): RunLine[] {
  const text = plainText(raw);
  if (text.trim() === '') return [];
  let event: unknown;
  try {
    event = JSON.parse(text);
  } catch {
    return [{ text, tone: 'plain' }];
  }
  if (!isObject(event)) return [{ text, tone: 'plain' }];
  switch (event.type) {
    case 'system':
      return event.subtype === 'init' ? [{ text: 'Claude Code started on the repo', tone: 'muted' }] : [];
    case 'assistant': {
      const content = isObject(event.message) && Array.isArray(event.message.content) ? event.message.content : [];
      const out: RunLine[] = [];
      for (const part of content) {
        if (!isObject(part)) continue;
        if (part.type === 'text' && typeof part.text === 'string') {
          for (const line of part.text.split('\n')) if (line.trim()) out.push({ text: clipLine(line, 400), tone: 'plain' });
        } else if (part.type === 'tool_use' && typeof part.name === 'string') {
          const input = isObject(part.input) ? part.input : {};
          const detail = typeof input.command === 'string' ? `: ${clipLine(input.command, 120)}` : '';
          out.push({ text: `→ ${toolName(part.name)}${detail}`, tone: 'muted' });
        }
      }
      return out;
    }
    case 'user': {
      const content = isObject(event.message) && Array.isArray(event.message.content) ? event.message.content : [];
      const failed = content.some((part) => isObject(part) && part.type === 'tool_result' && part.is_error === true);
      return failed ? [{ text: '  that step failed', tone: 'needs' }] : [];
    }
    case 'result': {
      if (event.is_error === true || (typeof event.subtype === 'string' && event.subtype !== 'success')) {
        return [{ text: `Ended: ${String(event.subtype ?? 'error').replace(/_/g, ' ')}`, tone: 'error' }];
      }
      return [{ text: 'Tune finished', tone: 'ok' }];
    }
    default:
      return [];
  }
}

/** "1:53" for a run that has gone on that long. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
