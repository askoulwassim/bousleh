import { describe, expect, it } from 'vitest';
import {
  COMMANDS,
  elapsed,
  plainText,
  privacyHint,
  protectedFolder,
  readAppJson,
  runSpec,
  scriptLine,
  splitLines,
  TUNE_COMMAND,
  tuneLines,
} from './runs.js';

/* The fixed runs on this Mac: the commands, where they run, and reading what they print. */

describe('the commands', () => {
  it('runs only fixed commands, in the repo, through the login shell', () => {
    expect(runSpec('tune', '/opt/bousleh')).toEqual({ command: '/bin/zsh', args: ['-lc', TUNE_COMMAND], cwd: '/opt/bousleh' });
    expect(runSpec('check', '/opt/bousleh').args).toEqual(['-lc', 'scripts/setup-mac.sh --check']);
    expect(runSpec('setup', '/opt/bousleh').args).toEqual(['-lc', 'scripts/setup-mac.sh']);
    // The repo path is the working folder, never part of a command, however odd it is.
    const odd = '/opt/my "repo"; rm -rf ~';
    for (const kind of ['tune', 'check', 'setup'] as const) {
      expect(runSpec(kind, odd).args.join(' ')).not.toContain('rm -rf');
      expect(runSpec(kind, odd).cwd).toBe(odd);
    }
  });

  it('lets Tune use only the bousleh tools and the read-only setup check, and stream its steps', () => {
    expect(COMMANDS.tune).toContain('claude -p "Tune: run the Friday tune-up now."');
    expect(COMMANDS.tune).toContain('--output-format stream-json --verbose');
    expect(COMMANDS.tune).toContain('--allowedTools "mcp__bousleh" "Bash(scripts/setup-mac.sh --check)" --disallowedTools');
    expect(COMMANDS.tune).not.toContain('bypassPermissions');
    expect(COMMANDS.tune).not.toContain('acceptEdits');
  });

  it('never lets Tune change the repo', () => {
    const allowed = COMMANDS.tune.slice(COMMANDS.tune.indexOf('--allowedTools'), COMMANDS.tune.indexOf('--disallowedTools'));
    for (const tool of ['git', 'gh', 'pnpm', 'Edit', 'Write']) expect(allowed).not.toContain(tool);
    expect(COMMANDS.tune).toContain('--disallowedTools "Bash(git *)" "Bash(gh *)" "Bash(pnpm *)" "Edit" "Write" "NotebookEdit"');
  });
});

describe('readAppJson', () => {
  it('reads the repo path setup-mac.sh wrote, and nothing else', () => {
    expect(readAppJson('{"repo":"/Volumes/work/bousleh.nosync","updated":"2026-11-27T15:00:00Z"}')).toBe('/Volumes/work/bousleh.nosync');
    expect(readAppJson('{"repo":"/opt/bousleh/"}')).toBe('/opt/bousleh');
    expect(readAppJson('{"repo":"relative/path"}')).toBeNull();
    expect(readAppJson('{"repo":"/opt/a\\nb"}')).toBeNull();
    expect(readAppJson('{"repo":42}')).toBeNull();
    expect(readAppJson('not json')).toBeNull();
    expect(readAppJson('')).toBeNull();
  });
});

describe('streamed output', () => {
  it('splits chunks into whole lines and keeps the unfinished one', () => {
    expect(splitLines('', 'a\nb\nc')).toEqual({ lines: ['a', 'b'], rest: 'c' });
    expect(splitLines('c', 'd\r\n')).toEqual({ lines: ['cd'], rest: '' });
  });

  it("reads setup-mac.sh's lines, colours and marks", () => {
    expect(plainText('\u001b[1m1/6 Tools\u001b[0m  ')).toBe('1/6 Tools');
    expect(scriptLine('  ✓ engine built')).toEqual({ text: '  ✓ engine built', tone: 'ok' });
    expect(scriptLine('  ! not a Mac: skipped')).toEqual({ text: '  ! not a Mac: skipped', tone: 'needs' });
    expect(scriptLine('   ')).toBeNull();
  });

  it("reads claude -p's stream-json events as log lines", () => {
    expect(tuneLines('{"type":"system","subtype":"init","model":"x"}')).toEqual([
      { text: 'Claude Code started on the repo', tone: 'muted' },
    ]);
    expect(
      tuneLines(
        JSON.stringify({
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'Reading the week.\n\nFixed: 2 people merged.' },
              { type: 'tool_use', name: 'mcp__bousleh__vault_activity', input: {} },
              { type: 'tool_use', name: 'Bash', input: { command: 'git checkout -b tune/2026-11-27' } },
            ],
          },
        }),
      ),
    ).toEqual([
      { text: 'Reading the week.', tone: 'plain' },
      { text: 'Fixed: 2 people merged.', tone: 'plain' },
      { text: '→ vault_activity', tone: 'muted' },
      { text: '→ Bash: git checkout -b tune/2026-11-27', tone: 'muted' },
    ]);
    expect(tuneLines('{"type":"user","message":{"content":[{"type":"tool_result","is_error":true}]}}')[0]?.tone).toBe('needs');
    expect(tuneLines('{"type":"user","message":{"content":[{"type":"tool_result"}]}}')).toEqual([]);
    expect(tuneLines('{"type":"result","subtype":"success","is_error":false}')).toEqual([{ text: 'Tune finished', tone: 'ok' }]);
    expect(tuneLines('{"type":"result","subtype":"error_max_turns","is_error":true}')).toEqual([
      { text: 'Ended: error max turns', tone: 'error' },
    ]);
    // Anything else (a shell error, a warning) shows as it is.
    expect(tuneLines('zsh: command not found: claude')).toEqual([{ text: 'zsh: command not found: claude', tone: 'plain' }]);
  });

  it('says how long a run has gone on', () => {
    expect(elapsed(113_400)).toBe('1:53');
    expect(elapsed(-5)).toBe('0:00');
  });
});

describe('macOS privacy refusals', () => {
  const refused = [
    { text: '$ scripts/setup-mac.sh --check' },
    { text: 'shell-init: error retrieving current directory: getcwd: cannot access parent directories: Operation not permitted' },
    { text: 'bash: scripts/setup-mac.sh: Operation not permitted' },
  ];

  it('names the guarded folder the repo sits in', () => {
    expect(protectedFolder('/Users/alex/Documents/Claude/Projects/Bousleh/bousleh.nosync')).toBe('Documents');
    expect(protectedFolder('/Users/alex/Desktop/bousleh')).toBe('Desktop');
    expect(protectedFolder('/Users/alex/Downloads')).toBe('Downloads');
    expect(protectedFolder('/Users/alex/Library/Mobile Documents/com~apple~CloudDocs/bousleh')).toBe('iCloud Drive');
    expect(protectedFolder('/Users/alex/Code/bousleh')).toBeNull();
    expect(protectedFolder('/Users/alex/DocumentsOld/bousleh')).toBeNull();
    expect(protectedFolder(null)).toBeNull();
  });

  it('says what to allow when macOS refused the run', () => {
    const hint = privacyHint(refused, '/Users/alex/Documents/bousleh');
    expect(hint?.tone).toBe('needs');
    expect(hint?.text).toContain('your Documents folder, where the repo is');
    expect(hint?.text).toContain('Move the clone outside Documents, Desktop, Downloads and iCloud Drive');
    expect(hint?.text).toContain('docs/move.md');
    expect(privacyHint(refused, '/Users/alex/Code/bousleh')?.text).toContain('out of the repo folder');
  });

  it('stays quiet when nothing was refused', () => {
    expect(privacyHint([{ text: 'bash: pnpm: command not found' }], '/Users/alex/Documents/bousleh')).toBeNull();
  });
});
