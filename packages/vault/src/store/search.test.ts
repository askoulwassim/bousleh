import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from './migrations.js';
import { ftsQuery } from './search.js';

describe('ftsQuery', () => {
  it('quotes every word and limits the match to titles and bodies', () => {
    expect(ftsQuery('weekly report', 'all')).toBe('{title body} : ("weekly" "report")');
    expect(ftsQuery('weekly report', 'any')).toBe('{title body} : ("weekly" OR "report")');
  });

  it('turns FTS syntax into plain text and drops words with no letters or digits', () => {
    expect(ftsQuery('"foo AND (', 'all')).toBe('{title body} : ("""foo" "AND")');
    expect(ftsQuery('( ) * - " :', 'all')).toBeUndefined();
  });

  it('never makes a query SQLite refuses', () => {
    const db = new Database(':memory:');
    migrate(db);
    db.prepare(
      "INSERT INTO search (object_id, title, body, kind, layer, scopes) VALUES ('x', 'foo and bar', 'body', 'problem', 'work', 'b')",
    ).run();
    const nasty = [
      '"foo AND (',
      'title:secret',
      'NEAR(foo bar, 2)',
      'foo*',
      '^foo',
      '-foo +bar',
      '{title}: foo',
      'a"b"c',
      "it's",
      'OR AND NOT',
      'émigré 東京 🚀',
      '_ __',
    ];
    for (const text of nasty) {
      for (const mode of ['all', 'any'] as const) {
        const query = ftsQuery(text, mode);
        if (query === undefined) continue;
        expect(() => db.prepare('SELECT object_id FROM search WHERE search MATCH ?').all(query), text).not.toThrow();
      }
    }
    db.close();
  });
});
