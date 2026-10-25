import type Database from 'better-sqlite3';

/*
 * Schema migrations, applied in order, each in its own transaction, recorded in
 * `schema_migrations`. Never edit a shipped migration: add a new one.
 * The tables follow docs/design/data-schema.md, section 2. Every table is append-only (triggers refuse
 * UPDATE and DELETE) except the FTS index `search`, which is rebuilt per object in the same
 * transaction as the change.
 */

/** Every table except the FTS index. Nothing in them is ever updated or deleted. */
export const APPEND_ONLY_TABLES = [
  'objects',
  'versions',
  'scopes',
  'object_scopes',
  'object_scope_retractions',
  'links',
  'link_retractions',
  'metric_readings',
  'inbox_log',
  'deposit_queue',
  'deposit_resolutions',
  'op_log',
] as const;

/** Triggers that make each table refuse UPDATE and DELETE, so "nothing is overwritten" holds even for raw SQL. */
function appendOnly(tables: readonly string[]): string {
  return tables
    .map(
      (table) => `
CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;
CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT, '${table} is append-only'); END;`,
    )
    .join('');
}

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'initial schema',
    sql: `
CREATE TABLE objects (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  layer       TEXT NOT NULL CHECK (layer IN ('anchors', 'evidence', 'work', 'people', 'moments')),
  created_at  TEXT NOT NULL,
  created_by  TEXT NOT NULL CHECK (created_by IN ('human', 'agent', 'schedule'))
) STRICT;

CREATE TABLE versions (
  id            TEXT PRIMARY KEY,
  object_id     TEXT NOT NULL REFERENCES objects(id),
  n             INTEGER NOT NULL CHECK (n >= 1),
  supersedes_id TEXT UNIQUE REFERENCES versions(id),
  title         TEXT NOT NULL,
  altitude      INTEGER NOT NULL CHECK (altitude IN (50000, 10000, 1000, 100)),
  status        TEXT,
  attrs_json    TEXT NOT NULL DEFAULT '{}',
  body_path     TEXT NOT NULL,
  body_sha256   TEXT NOT NULL,
  op            TEXT NOT NULL,
  actor         TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'schedule')),
  created_at    TEXT NOT NULL,
  UNIQUE (object_id, n),
  CHECK ((n = 1) = (supersedes_id IS NULL))
) STRICT;
CREATE INDEX versions_object ON versions(object_id);

CREATE VIEW current AS
  SELECT v.* FROM versions v
  WHERE NOT EXISTS (SELECT 1 FROM versions s WHERE s.supersedes_id = v.id);

CREATE TABLE scopes (
  id            TEXT PRIMARY KEY,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('company', 'product', 'project', 'team', 'life')),
  parent_id     TEXT REFERENCES scopes(id),
  supersedes_id TEXT UNIQUE REFERENCES scopes(id),
  op            TEXT NOT NULL,
  actor         TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'schedule')),
  created_at    TEXT NOT NULL
) STRICT;
CREATE INDEX scopes_slug ON scopes(slug);

CREATE TABLE object_scopes (
  object_id   TEXT NOT NULL REFERENCES objects(id),
  scope_id    TEXT NOT NULL REFERENCES scopes(id),
  seq         INTEGER NOT NULL,
  op          TEXT NOT NULL,
  actor       TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'schedule')),
  created_at  TEXT NOT NULL,
  UNIQUE (object_id, seq)
) STRICT;
CREATE INDEX object_scopes_object ON object_scopes(object_id);

CREATE TABLE object_scope_retractions (
  object_id   TEXT NOT NULL REFERENCES objects(id),
  scope_id    TEXT NOT NULL REFERENCES scopes(id),
  seq         INTEGER NOT NULL,
  reason      TEXT,
  op          TEXT NOT NULL,
  actor       TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'schedule')),
  created_at  TEXT NOT NULL,
  UNIQUE (object_id, seq)
) STRICT;
CREATE INDEX object_scope_retractions_object ON object_scope_retractions(object_id);

CREATE TABLE links (
  id          TEXT PRIMARY KEY,
  from_id     TEXT NOT NULL REFERENCES objects(id),
  to_id       TEXT NOT NULL REFERENCES objects(id),
  kind        TEXT NOT NULL,
  note        TEXT,
  op          TEXT NOT NULL,
  actor       TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'schedule')),
  created_at  TEXT NOT NULL,
  CHECK (from_id <> to_id)
) STRICT;
CREATE INDEX links_from ON links(from_id);
CREATE INDEX links_to ON links(to_id);

CREATE TABLE link_retractions (
  link_id     TEXT PRIMARY KEY REFERENCES links(id),
  reason      TEXT,
  op          TEXT NOT NULL,
  actor       TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'schedule')),
  created_at  TEXT NOT NULL
) STRICT;

CREATE TABLE metric_readings (
  id            TEXT PRIMARY KEY,
  metric_id     TEXT NOT NULL REFERENCES objects(id),
  value         REAL NOT NULL,
  unit          TEXT,
  observed_at   TEXT NOT NULL,
  source        TEXT,
  supersedes_id TEXT UNIQUE REFERENCES metric_readings(id),
  op            TEXT NOT NULL,
  actor         TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'schedule')),
  created_at    TEXT NOT NULL
) STRICT;
CREATE INDEX metric_readings_metric ON metric_readings(metric_id);

CREATE TABLE inbox_log (
  sha256          TEXT PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('drive', 'local', 'transcript')),
  original_name   TEXT NOT NULL,
  seen_at         TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK (outcome IN ('filed', 'queued', 'skipped', 'failed')),
  object_id       TEXT REFERENCES objects(id),
  processed_path  TEXT
) STRICT;

CREATE TABLE deposit_queue (
  id               TEXT PRIMARY KEY,
  payload_json     TEXT NOT NULL,
  reason           TEXT NOT NULL,
  candidates_json  TEXT,
  source_sha256    TEXT REFERENCES inbox_log(sha256),
  op               TEXT NOT NULL,
  actor            TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'schedule')),
  created_at       TEXT NOT NULL
) STRICT;

CREATE TABLE deposit_resolutions (
  queue_id         TEXT PRIMARY KEY REFERENCES deposit_queue(id),
  resolution_json  TEXT NOT NULL,
  object_id        TEXT REFERENCES objects(id),
  op               TEXT NOT NULL,
  actor            TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'schedule')),
  created_at       TEXT NOT NULL
) STRICT;

CREATE TABLE op_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  op          TEXT NOT NULL,
  actor       TEXT NOT NULL CHECK (actor IN ('human', 'agent', 'schedule')),
  input_json  TEXT NOT NULL,
  result      TEXT NOT NULL,
  created_at  TEXT NOT NULL
) STRICT;

CREATE VIRTUAL TABLE search USING fts5(
  object_id UNINDEXED,
  title,
  body,
  kind UNINDEXED,
  layer UNINDEXED,
  scopes,
  tokenize = 'porter unicode61'
);

-- A new version supersedes the current version of the same object: n - 1, never another object's.
CREATE TRIGGER versions_supersede_same_object BEFORE INSERT ON versions
WHEN NEW.supersedes_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM versions p WHERE p.id = NEW.supersedes_id AND p.object_id = NEW.object_id AND p.n = NEW.n - 1
)
BEGIN
  SELECT RAISE(ABORT, 'a version must supersede version n - 1 of the same object');
END;
${appendOnly(APPEND_ONLY_TABLES)}
`,
  },
];

/** Apply every migration not yet recorded. Returns the versions applied. */
/**
 * Apply every migration not yet recorded. Returns the versions applied. Runs under the database
 * write lock (BEGIN IMMEDIATE), so two Bousleh processes opening the same data home can't both
 * apply the same migration.
 */
export function migrate(db: Database.Database, now: () => Date = () => new Date()): number[] {
  return db
    .transaction(() => {
      db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT');
      const applied = new Set(
        (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((row) => row.version),
      );
      const ran: number[] = [];
      for (const migration of MIGRATIONS) {
        if (applied.has(migration.version)) continue;
        db.exec(migration.sql);
        db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(migration.version, now().toISOString());
        ran.push(migration.version);
      }
      return ran;
    })
    .immediate();
}
