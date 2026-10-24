import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataStatus, resolveHome, VAULT_DB } from './home.js';

describe('data home', () => {
  it('defaults to ~/.bousleh and honours BOUSLEH_HOME', () => {
    expect(resolveHome({})).toBe(join(homedir(), '.bousleh'));
    expect(resolveHome({ BOUSLEH_HOME: '  ' })).toBe(join(homedir(), '.bousleh'));
    expect(resolveHome({ BOUSLEH_HOME: '/tmp/somewhere' })).toBe('/tmp/somewhere');
  });

  it('reports whether the home and its database exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'bousleh-'));
    try {
      expect(dataStatus(join(home, 'missing'))).toEqual({ exists: false, db: false });
      expect(dataStatus(home)).toEqual({ exists: true, db: false });
      writeFileSync(join(home, VAULT_DB), '');
      expect(dataStatus(home)).toEqual({ exists: true, db: true });
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
