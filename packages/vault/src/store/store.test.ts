import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ID_PATTERN } from '@bousleh/contracts';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bodyOf, renderMarkdown } from './markdown.js';
import { MIGRATIONS, migrate } from './migrations.js';
import { newId, ulid } from './ulid.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-store-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe('migrations', () => {
  it('apply once, in order, and record themselves', () => {
    const db = new Database(join(home, 'vault.db'));
    expect(migrate(db)).toEqual(MIGRATIONS.map((m) => m.version));
    expect(migrate(db)).toEqual([]);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')").all() as { name: string }[]).map(
      (r) => r.name,
    );
    for (const table of [
      'objects',
      'versions',
      'current',
      'scopes',
      'object_scopes',
      'links',
      'inbox_log',
      'deposit_queue',
      'op_log',
      'search',
    ]) {
      expect(tables).toContain(table);
    }
    db.close();
  });

  it('limit altitude to its four values', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.prepare("INSERT INTO objects VALUES ('prb_1', 'problem', 'work', 'now', 'agent')").run();
    const insert = (altitude: number) =>
      db
        .prepare(
          "INSERT INTO versions (id, object_id, n, title, altitude, body_path, body_sha256, op, actor, created_at) VALUES (?, 'prb_1', 1, 't', ?, 'p', 's', 'o', 'agent', 'now')",
        )
        .run(`ver_${altitude}`, altitude);
    expect(() => insert(5000)).toThrow(/CHECK/);
    expect(() => insert(1000)).not.toThrow();
    db.close();
  });
});

describe('ids', () => {
  it('are a prefix plus a ULID that sorts by time', () => {
    const early = newId('prb', new Date('2026-10-25T10:00:00Z'));
    const later = newId('prb', new Date('2026-10-25T10:00:01Z'));
    expect(early).toMatch(ID_PATTERN);
    expect(early < later).toBe(true);
    expect(ulid(0, new Uint8Array(10))).toBe('00000000000000000000000000');
  });
});

describe('markdown', () => {
  it('round-trips the body under a frontmatter that reads on its own', () => {
    const content = renderMarkdown(
      {
        id: 'prb_x',
        kind: 'problem',
        layer: 'work',
        title: 'A "quoted" title',
        altitude: 1000,
        status: null,
        version: 1,
        version_id: 'ver_x',
        created: 'c',
        updated: 'u',
      },
      '# Heading\n\nBody text.\n',
    );
    expect(content).toContain('title: "A \\"quoted\\" title"');
    expect(bodyOf(content)).toBe('# Heading\n\nBody text.');
    expect(
      bodyOf(
        renderMarkdown(
          {
            id: 'a',
            kind: 'k',
            layer: 'l',
            title: 't',
            altitude: 100,
            status: 'open',
            version: 1,
            version_id: 'v',
            created: 'c',
            updated: 'u',
          },
          '',
        ),
      ),
    ).toBe('');
  });
});
