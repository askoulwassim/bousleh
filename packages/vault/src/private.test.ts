import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VAULT_DB } from './home.js';
import { FileStager } from './store/files.js';
import { makePrivateTree, tightenDir } from './store/private.js';
import { Vault } from './store/store.js';

/* Your data is readable only by your account: folders 0700, files 0600. */

const mode = (path: string) => statSync(path).mode & 0o777;

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bousleh-private-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(root, { recursive: true, force: true });
});

describe('a new data home', () => {
  it('is created 0700 with the database and its WAL files 0600', () => {
    const home = join(root, 'nested', '.bousleh');
    const vault = new Vault(home);
    try {
      vault.db.exec('CREATE TABLE IF NOT EXISTS probe (x)');
      expect(mode(home)).toBe(0o700);
      expect(mode(join(root, 'nested'))).toBe(0o700);
      for (const file of [VAULT_DB, `${VAULT_DB}-wal`, `${VAULT_DB}-shm`]) expect(mode(join(home, file))).toBe(0o600);
    } finally {
      vault.close();
    }
  });

  it('gets 0700 folders and 0600 files from staged writes and moves', () => {
    const home = join(root, 'home');
    const outside = join(root, 'drive');
    mkdirSync(outside);
    writeFileSync(join(outside, 'note.md'), 'From the phone.', { mode: 0o644 });

    const stager = new FileStager(home);
    stager.stage('work/deep/a.md', 'Body.');
    expect(mode(join(home, '.staging'))).toBe(0o700);
    stager.stageMove(join(outside, 'note.md'), 'inbox/processed/note.md');
    stager.commit();

    expect(mode(join(home, 'work'))).toBe(0o700);
    expect(mode(join(home, 'work', 'deep'))).toBe(0o700);
    expect(mode(join(home, 'work', 'deep', 'a.md'))).toBe(0o600);
    expect(mode(join(home, 'inbox', 'processed'))).toBe(0o700);
    expect(mode(join(home, 'inbox', 'processed', 'note.md'))).toBe(0o600);
  });

  it('keeps a file moved across volumes 0600', () => {
    const home = join(root, 'home');
    writeFileSync(join(root, 'scan.md'), 'A finding.', { mode: 0o644 });
    const exdev = () => {
      throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
    };
    const stager = new FileStager(home, { rename: exdev });
    stager.stageMove(join(root, 'scan.md'), 'inbox/scan.md');
    stager.commit();
    expect(mode(join(home, 'inbox', 'scan.md'))).toBe(0o600);
  });
});

describe('an existing data home', () => {
  it('is tightened to 0700 on open, with one line on stderr', () => {
    const home = join(root, 'home');
    mkdirSync(home);
    chmodSync(home, 0o755);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const vault = new Vault(home);
    try {
      expect(vault.db.open).toBe(true);
      expect(mode(home)).toBe(0o700);
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(String(stderr.mock.calls[0]?.[0])).toBe(`bousleh: ${home} was readable by other accounts (mode 755); set it to 700\n`);
    } finally {
      vault.close();
    }
  });

  it('is left alone, and quiet, when already private', () => {
    const home = join(root, 'home');
    mkdirSync(home, { mode: 0o700 });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const vault = new Vault(home);
    try {
      expect(vault.db.open).toBe(true);
      expect(mode(home)).toBe(0o700);
      expect(stderr).not.toHaveBeenCalled();
    } finally {
      vault.close();
    }
  });

  it('tightens any access for group or others, not only read', () => {
    const lines: string[] = [];
    const dir = join(root, 'dir');
    mkdirSync(dir);
    chmodSync(dir, 0o701);
    expect(tightenDir(dir, (line) => lines.push(line))).toBe(true);
    expect(mode(dir)).toBe(0o700);
    expect(tightenDir(dir, (line) => lines.push(line))).toBe(false);
    expect(lines).toHaveLength(1);
  });
});

describe('makePrivateTree', () => {
  it('sets every folder 0700 and every file 0600', () => {
    const tree = join(root, 'tree');
    mkdirSync(join(tree, 'a', 'b'), { recursive: true, mode: 0o755 });
    writeFileSync(join(tree, 'top.md'), 'x', { mode: 0o644 });
    writeFileSync(join(tree, 'a', 'b', 'deep.md'), 'y', { mode: 0o666 });
    makePrivateTree(tree);
    expect([tree, join(tree, 'a'), join(tree, 'a', 'b')].map(mode)).toEqual([0o700, 0o700, 0o700]);
    expect([join(tree, 'top.md'), join(tree, 'a', 'b', 'deep.md')].map(mode)).toEqual([0o600, 0o600]);
  });
});
