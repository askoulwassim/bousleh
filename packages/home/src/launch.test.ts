import { describe, expect, it } from 'vitest';
import {
  chatUrl,
  claudeTag,
  clipPrompt,
  codeUrl,
  enc,
  MAX_PROMPT,
  NO_REACH,
  openCommand,
  type ReachFacts,
  reachOf,
  runBlocker,
} from './launch.js';

/* Where work happens, and the links and the one command that open Claude. */

const APP: ReachFacts = { installed: true, fullAccess: 'granted', platform: 'darwin', repo: '/opt/bousleh', sample: true, live: true };

describe('reach: the rule, not a setting', () => {
  it('opens Claude and runs on this Mac only in the installed app with full access', () => {
    expect(reachOf(APP)).toEqual({ open: true, run: true, ask: true });
    // Beside a chat, on the web, on the phone: every Claude-bound button copies.
    expect(reachOf({ ...APP, installed: false })).toEqual({ open: false, run: false, ask: true });
    for (const fullAccess of ['prompt', 'denied', 'unavailable'] as const) {
      expect(reachOf({ ...APP, fullAccess })).toMatchObject({ open: false, run: false });
    }
    // Windows opens Claude but runs nothing; Linux does neither.
    expect(reachOf({ ...APP, platform: 'win32' })).toMatchObject({ open: true, run: false });
    expect(reachOf({ ...APP, platform: 'linux' })).toMatchObject({ open: false, run: false });
    // No repo known: open Claude, but no runs.
    expect(reachOf({ ...APP, repo: null })).toMatchObject({ open: true, run: false });
    // Ask answers here only with sample and live data.
    expect(reachOf({ ...APP, sample: false }).ask).toBe(false);
    expect(reachOf({ ...APP, live: false }).ask).toBe(false);
  });

  it('tags a Claude-bound launcher In Claude, or Copy as the fallback', () => {
    expect(claudeTag(reachOf(APP))).toBe('claude');
    expect(claudeTag(NO_REACH)).toBe('copy');
  });

  it('says why a run is not offered', () => {
    expect(runBlocker(APP)).toBeNull();
    expect(runBlocker({ ...APP, installed: false })).toMatch(/installed as an app/);
    expect(runBlocker({ ...APP, fullAccess: 'prompt' })).toMatch(/full access/);
    expect(runBlocker({ ...APP, repo: null })).toBe('Run scripts/setup-mac.sh once, so Home knows where the repo is.');
    expect(runBlocker({ ...APP, platform: 'win32' })).toMatch(/macOS/);
  });
});

describe('deep links', () => {
  it('opens a new chat with the prompt typed in, encoded', () => {
    expect(chatUrl('Shape: push back on "Harbor"')).toBe('claude://claude.ai/new?q=Shape%3A%20push%20back%20on%20%22Harbor%22');
    // Every mode opens a new chat; only Health's Finish setup opens the Code tab, on the repo folder.
    expect(codeUrl('Publish Home from docs/home.md.', '/Volumes/work/bousleh.nosync')).toBe(
      'claude://code/new?q=Publish%20Home%20from%20docs%2Fhome.md.&folder=%2FVolumes%2Fwork%2Fbousleh.nosync',
    );
  });

  it('encodes everything a shell could read: quotes, $, backticks, ! and parentheses', () => {
    const nasty = `a"b'c$(rm -rf ~)\`x\`!*;&|<>\\\n`;
    const e = enc(nasty);
    expect(e).toMatch(/^[A-Za-z0-9\-_.~%]+$/);
    expect(decodeURIComponent(e)).toBe(nasty);
    expect(chatUrl(nasty)).toMatch(/^claude:\/\/claude\.ai\/new\?q=[A-Za-z0-9\-_.~%]+$/);
    expect(enc('é ü 漢字')).toBe(encodeURIComponent('é ü 漢字'));
  });

  it('keeps prompts under 5,000 characters', () => {
    expect(clipPrompt('  short  ')).toBe('short');
    const long = `${'word '.repeat(1500)}end`;
    const clipped = clipPrompt(long);
    expect(clipped.length).toBeLessThanOrEqual(MAX_PROMPT);
    expect(clipped.endsWith('…')).toBe(true);
    expect(decodeURIComponent(chatUrl(long).split('q=')[1] ?? '').length).toBeLessThanOrEqual(MAX_PROMPT);
  });
});

describe('openCommand', () => {
  it('builds the one fixed command per platform, the url in double quotes', () => {
    const url = chatUrl('Pulse: where am I?');
    expect(openCommand(url, 'darwin')).toBe(`open "${url}"`);
    expect(openCommand(url, 'win32')).toBe(`start "" "${url}"`);
    expect(openCommand(url, 'linux')).toBeNull();
    expect(openCommand(codeUrl('x', '/opt/b'), 'darwin')).toBe(`open "claude://code/new?q=x&folder=%2Fopt%2Fb"`);
  });

  it('refuses anything that is not a link Home built', () => {
    for (const bad of [
      'https://example.com',
      'claude://claude.ai/new?q=a b',
      'claude://claude.ai/new?q=a"; rm -rf ~; "',
      'claude://claude.ai/new?q=$(whoami)',
      'claude://evil/new?q=x',
      'claude://claude.ai/new?q=x&folder=',
      'claude://claude.ai/new?q=x\nopen /Applications',
    ]) {
      expect(openCommand(bad, 'darwin')).toBeNull();
    }
  });
});
