import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileStager } from '@bousleh/vault';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clampName, isWithin, partition, whyUnreadable } from './files.js';

let home: string;
let elsewhere: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-files-'));
  elsewhere = mkdtempSync(join(tmpdir(), 'bousleh-elsewhere-'));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(elsewhere, { recursive: true, force: true });
});

const exdev = () => {
  throw Object.assign(new Error('EXDEV: cross-device link not permitted'), { code: 'EXDEV' });
};

describe('FileStager moves', () => {
  it('moves only on commit, and across volumes copies, keeps the modification time, then unlinks', () => {
    const source = join(elsewhere, 'dictation.md');
    writeFileSync(source, 'from the phone');
    const mtime = new Date('2026-10-20T08:00:00.000Z');
    utimesSync(source, mtime, mtime);

    const stager = new FileStager(home, { rename: exdev });
    stager.stageMove(source, 'inbox/drive/dictation.md');
    expect(stager.pending).toBe(1);
    expect(stager.isFree('inbox/drive/dictation.md')).toBe(false);
    expect(existsSync(join(home, 'inbox'))).toBe(false);

    stager.commit();
    const target = join(home, 'inbox', 'drive', 'dictation.md');
    expect(readFileSync(target, 'utf8')).toBe('from the phone');
    expect(statSync(target).mtime.toISOString()).toBe(mtime.toISOString());
    expect(existsSync(source)).toBe(false);
  });

  it('drops staged moves on discard', () => {
    const source = join(elsewhere, 'a.md');
    writeFileSync(source, 'a');
    const stager = new FileStager(home);
    stager.stageMove(source, 'inbox/a.md');
    stager.discard();
    stager.commit();
    expect(existsSync(source)).toBe(true);
    expect(existsSync(join(home, 'inbox', 'a.md'))).toBe(false);
  });

  it('refuses a taken target, a source staged twice and a missing source', () => {
    const source = join(elsewhere, 'a.md');
    writeFileSync(source, 'a');
    mkdirSync(join(home, 'inbox'), { recursive: true });
    writeFileSync(join(home, 'inbox', 'taken.md'), 'x');
    const stager = new FileStager(home);
    expect(() => stager.stageMove(source, 'inbox/taken.md')).toThrow(/taken/);
    stager.stageMove(source, 'inbox/a.md');
    expect(() => stager.stageMove(source, 'inbox/b.md')).toThrow(/already staged/);
    expect(() => stager.stageMove(join(elsewhere, 'nope.md'), 'inbox/c.md')).toThrow(/not a file/);
  });
});

describe('inbox file helpers', () => {
  it('tells text from what inbox.take cannot read', () => {
    expect(whyUnreadable('a.md', Buffer.from('hello'))).toBeNull();
    expect(whyUnreadable('a.pdf', Buffer.from([1, 0, 2]))).toMatch(/binary/);
    expect(whyUnreadable('a.txt', Buffer.from([0xff, 0xfe, 0x41]))).toMatch(/UTF-8/);
    expect(whyUnreadable('Plan.GDOC', Buffer.from('{}'))).toMatch(/shortcut/);
  });

  it('keeps the oldest of identical files and treats logged hashes as seen', () => {
    const file = (abs: string, sha256: string) => ({
      abs,
      name: abs,
      source: 'local' as const,
      size: 1,
      mtime: new Date(0),
      sha256,
      unreadable: null,
    });
    const { waiting, duplicates } = partition([file('a', '1'), file('b', '2'), file('c', '1'), file('d', '3')], (h) => h === '3');
    expect(waiting.map((f) => f.abs)).toEqual(['a', 'b']);
    expect(duplicates.map((f) => f.abs)).toEqual(['c', 'd']);
  });

  it('clamps long names and keeps the extension', () => {
    const long = `${'x'.repeat(300)}.md`;
    expect(Buffer.byteLength(clampName(long))).toBe(200);
    expect(clampName(long).endsWith('.md')).toBe(true);
    expect(clampName('short.md')).toBe('short.md');
  });

  it('knows when one folder is inside another', () => {
    expect(isWithin('/a/b/c', '/a/b')).toBe(true);
    expect(isWithin('/a/b', '/a/b')).toBe(true);
    expect(isWithin('/a/bc', '/a/b')).toBe(false);
    expect(isWithin('/a', '/a/b')).toBe(false);
  });
});
