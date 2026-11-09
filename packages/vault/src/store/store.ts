import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Actor,
  type Altitude,
  CONCLUDABLE_IDEA_STATUSES,
  checkKindFields,
  checkLink,
  KINDS,
  type Kind,
  LAYERS,
  type Layer,
  type LinkKind,
  type ObjectView,
  ROW_PREFIXES,
  type ScopeView,
} from '@bousleh/contracts';
import Database from 'better-sqlite3';
import { OpError } from '../handler.js';
import { VAULT_DB } from '../home.js';
import { type FileStager, OPEN_MARKER_PREFIX, STAGING_DIR, writeAtomic } from './files.js';
import { bodyOf, currentPath, renderMarkdown, versionPath } from './markdown.js';
import { migrate } from './migrations.js';
import { newId } from './ulid.js';

/*
 * Your data on disk: one SQLite database (`vault.db`) plus one markdown file per version.
 * `Vault` owns the connection (opened lazily, migrated on open). `Store` is what op handlers get:
 * one per op call, carrying who is writing and with which op. Writes only work when the engine has
 * opened a transaction and handed the store a FileStager.
 */

export class Vault {
  private connection: Database.Database | undefined;
  private queryOnly = false;

  constructor(readonly home: string) {}

  /** True once the database has been opened in this process. */
  get isOpen(): boolean {
    return this.connection !== undefined;
  }

  /** The connection; opening it creates the data home and applies migrations. */
  get db(): Database.Database {
    if (!this.connection) {
      mkdirSync(this.home, { recursive: true });
      const db = new Database(join(this.home, VAULT_DB));
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.pragma('busy_timeout = 5000');
      migrate(db);
      recover(db, this.home);
      if (this.queryOnly) db.pragma('query_only = ON');
      this.connection = db;
    }
    return this.connection;
  }

  /**
   * Run `fn` with the connection refusing every write (SQLite `query_only`), for read-only ops.
   * The database still opens lazily: a read-only op that never touches it doesn't create it.
   */
  async readOnly<T>(fn: () => Promise<T>): Promise<T> {
    this.queryOnly = true;
    this.connection?.pragma('query_only = ON');
    try {
      return await fn();
    } finally {
      this.queryOnly = false;
      this.connection?.pragma('query_only = OFF');
    }
  }

  close(): void {
    this.connection?.close();
    this.connection = undefined;
  }

  /** The audit trail: one row per top-level write op, ok or failed. */
  logOp(entry: { op: string; actor: Actor; input: unknown; result: string; at: Date }): void {
    this.db
      .prepare('INSERT INTO op_log (op, actor, input_json, result, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(entry.op, entry.actor, JSON.stringify(entry.input ?? null), entry.result, entry.at.toISOString());
  }
}

export interface WriteMeta {
  op: string;
  actor: Actor;
  now: () => Date;
}

interface ObjectRow {
  id: string;
  kind: Kind;
  layer: Layer;
  created_at: string;
  created_by: Actor;
}

interface VersionRow {
  id: string;
  object_id: string;
  n: number;
  supersedes_id: string | null;
  title: string;
  altitude: Altitude;
  status: string | null;
  attrs_json: string;
  body_path: string;
  body_sha256: string;
  op: string;
  actor: Actor;
  created_at: string;
}

interface ScopeRow {
  id: string;
  slug: string;
  name: string;
  kind: ScopeView['kind'];
  parent_id: string | null;
}

export interface NewObject {
  kind: Kind;
  title: string;
  altitude: Altitude;
  status?: string | undefined;
  attrs?: Record<string, unknown> | undefined;
  body: string;
  scopes: readonly string[];
  links: readonly { kind: LinkKind; to: string; note?: string | undefined }[];
}

export interface VersionPatch {
  title?: string | undefined;
  altitude?: Altitude | undefined;
  status?: string | undefined;
  attrs?: Record<string, unknown> | undefined;
  body?: string | undefined;
}

export interface Written {
  id: string;
  kind: Kind;
  layer: Layer;
  version: { id: string; n: number };
  path: string;
}

export interface AddedLink {
  id: string;
  created: boolean;
  /** A new `concludes` link: the idea and the version that set it to concluded. */
  concluded?: { idea: string; version: { id: string; n: number } };
}

export interface RetractedLink {
  id: string;
  kind: LinkKind;
  from: string;
  to: string;
  already_retracted: boolean;
}

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export class Store {
  /**
   * @param stager the op's staged files. Present in write ops; read-only ops nested in a write op
   *   get it too, so they read what the op has written so far.
   * @param canWrite false for read-only ops: every write method throws.
   */
  constructor(
    readonly vault: Vault,
    readonly meta: WriteMeta,
    private readonly stager?: FileStager,
    private readonly canWrite: boolean = stager !== undefined,
  ) {}

  get home(): string {
    return this.vault.home;
  }

  /**
   * The SQLite connection, for a package's own tables (intake: inbox_log and the deposit queue;
   * metrics: metric_readings). Objects, versions, scopes and links go through this class's methods
   * or through ops (`h.runOp('deposits.write', …)`), never through raw SQL from other packages.
   * Inside a write op this runs in the op's transaction.
   */
  get db(): Database.Database {
    return this.vault.db;
  }

  /** The op's file writes (write ops only): written now, undone if the op rolls back. */
  get stagedFiles(): FileStager {
    return this.files();
  }

  /** True when this op may write. */
  get writable(): boolean {
    return this.stager !== undefined && this.canWrite;
  }

  private now(): string {
    return this.meta.now().toISOString();
  }

  private files(): FileStager {
    if (!this.stager || !this.canWrite) throw new Error(`${this.meta.op} is read-only and cannot write`);
    return this.stager;
  }

  // ---------------------------------------------------------------- scopes

  /** Current scopes: rows nothing supersedes. */
  listScopes(): ScopeView[] {
    const rows = this.db
      .prepare(
        `SELECT s.id, s.slug, s.name, s.kind, s.parent_id FROM scopes s
         WHERE NOT EXISTS (SELECT 1 FROM scopes n WHERE n.supersedes_id = s.id)
         ORDER BY s.slug`,
      )
      .all() as ScopeRow[];
    // A child's parent_id names the parent row current when the child was written; a parent moved
    // since has a newer row with the same slug, so resolve parents through every row, not only current ones.
    const allRows = this.db.prepare('SELECT id, slug FROM scopes').all() as { id: string; slug: string }[];
    const slugById = new Map(allRows.map((row) => [row.id, row.slug]));
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      kind: row.kind,
      parent: row.parent_id ? (slugById.get(row.parent_id) ?? null) : null,
    }));
  }

  /**
   * The slugs a scope filter covers: each named scope plus every scope below it (a filter on
   * `alethea` also covers its products and teams). Refuses an unknown slug.
   */
  expandScopes(slugs: readonly string[]): Set<string> {
    const scopes = this.listScopes();
    const known = new Set(scopes.map((scope) => scope.slug));
    const unknown = slugs.filter((slug) => !known.has(slug));
    if (unknown.length > 0) throw new OpError('invalid_input', `no scope named ${unknown.join(', ')}; scopes.list shows them all`);
    const covered = new Set(slugs);
    let grew = true;
    while (grew) {
      grew = false;
      for (const scope of scopes) {
        if (scope.parent !== null && covered.has(scope.parent) && !covered.has(scope.slug)) {
          covered.add(scope.slug);
          grew = true;
        }
      }
    }
    return covered;
  }

  private scopeBySlug(slug: string): ScopeRow | undefined {
    return this.db
      .prepare(
        `SELECT s.id, s.slug, s.name, s.kind, s.parent_id FROM scopes s
         WHERE s.slug = ? AND NOT EXISTS (SELECT 1 FROM scopes n WHERE n.supersedes_id = s.id)`,
      )
      .get(slug) as ScopeRow | undefined;
  }

  addScope(input: { slug: string; name: string; kind: ScopeView['kind']; parent?: string | undefined }): ScopeView {
    this.files();
    if (this.scopeBySlug(input.slug)) throw new OpError('conflict', `a scope named ${input.slug} already exists`);
    let parentId: string | null = null;
    if (input.parent !== undefined) {
      const parent = this.scopeBySlug(input.parent);
      if (!parent) throw new OpError('invalid_input', `no scope named ${input.parent}`);
      parentId = parent.id;
    }
    const id = newId(ROW_PREFIXES.scope, this.meta.now());
    this.db
      .prepare(
        'INSERT INTO scopes (id, slug, name, kind, parent_id, supersedes_id, op, actor, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)',
      )
      .run(id, input.slug, input.name, input.kind, parentId, this.meta.op, this.meta.actor, this.now());
    return { id, slug: input.slug, name: input.name, kind: input.kind, parent: input.parent ?? null };
  }

  /**
   * Move a scope under a new parent (or to the top with null) as a new scope row that supersedes the
   * current one. Memberships and children resolve by slug, so everything filed in it, and every scope
   * below it, moves with it.
   */
  /** Give a scope a new display name as a new scope row that supersedes the current one; the slug, parent and memberships stay. */
  renameScope(input: { slug: string; name: string }): ScopeView & { renamed: boolean } {
    this.files();
    const current = this.scopeBySlug(input.slug);
    if (!current) throw new OpError('invalid_input', `no scope named ${input.slug}; scopes.list shows them all`);
    const parent = this.listScopes().find((scope) => scope.slug === input.slug)?.parent ?? null;
    const view = { slug: current.slug, kind: current.kind, parent };
    if (current.name === input.name) return { id: current.id, ...view, name: current.name, renamed: false };
    const parentId = parent === null ? null : (this.scopeBySlug(parent)?.id ?? null);
    const id = newId(ROW_PREFIXES.scope, this.meta.now());
    this.db
      .prepare(
        'INSERT INTO scopes (id, slug, name, kind, parent_id, supersedes_id, op, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, current.slug, input.name, current.kind, parentId, current.id, this.meta.op, this.meta.actor, this.now());
    return { id, ...view, name: input.name, renamed: true };
  }

  moveScope(input: { slug: string; parent: string | null }): ScopeView & { moved: boolean } {
    this.files();
    const current = this.scopeBySlug(input.slug);
    if (!current) throw new OpError('invalid_input', `no scope named ${input.slug}; scopes.list shows them all`);
    let parentId: string | null = null;
    if (input.parent !== null) {
      const parent = this.scopeBySlug(input.parent);
      if (!parent) throw new OpError('invalid_input', `no scope named ${input.parent}`);
      if (this.expandScopes([input.slug]).has(input.parent)) {
        throw new OpError('invalid_input', `${input.parent} is ${input.slug} or below it, so it can't be its parent`);
      }
      parentId = parent.id;
    }
    const currentParent = this.listScopes().find((scope) => scope.slug === input.slug)?.parent ?? null;
    const view = { slug: current.slug, name: current.name, kind: current.kind };
    if (currentParent === input.parent) return { id: current.id, ...view, parent: currentParent, moved: false };
    const id = newId(ROW_PREFIXES.scope, this.meta.now());
    this.db
      .prepare(
        'INSERT INTO scopes (id, slug, name, kind, parent_id, supersedes_id, op, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, current.slug, current.name, current.kind, parentId, current.id, this.meta.op, this.meta.actor, this.now());
    return { id, ...view, parent: input.parent, moved: true };
  }

  /**
   * The next membership event number for an object, shared by adds and retractions, so the order of
   * events never depends on the clock. Safe because writes hold the database write lock.
   */
  private nextScopeSeq(objectId: string): number {
    const row = this.db
      .prepare(
        `SELECT max(seq) AS seq FROM (
           SELECT max(seq) AS seq FROM object_scopes WHERE object_id = ?
           UNION ALL SELECT max(seq) FROM object_scope_retractions WHERE object_id = ?)`,
      )
      .get(objectId, objectId) as { seq: number | null };
    return (row.seq ?? 0) + 1;
  }

  /** Slugs of an object's current scopes: for each scope, the latest add or retraction wins. */
  scopeSlugsOf(objectId: string): string[] {
    const events = this.db
      .prepare(
        `SELECT scope_id, 1 AS added, seq FROM object_scopes WHERE object_id = ?
         UNION ALL
         SELECT scope_id, 0 AS added, seq FROM object_scope_retractions WHERE object_id = ?
         ORDER BY seq`,
      )
      .all(objectId, objectId) as { scope_id: string; added: number }[];
    const member = new Map<string, boolean>();
    for (const event of events) member.set(event.scope_id, event.added === 1);
    const ids = [...member].filter(([, isMember]) => isMember).map(([id]) => id);
    if (ids.length === 0) return [];
    const rows = this.db.prepare(`SELECT id, slug FROM scopes WHERE id IN (${ids.map(() => '?').join(', ')})`).all(...ids) as {
      id: string;
      slug: string;
    }[];
    return rows.map((row) => row.slug).sort();
  }

  // ---------------------------------------------------------------- objects

  private objectRow(id: string): ObjectRow | undefined {
    return this.db.prepare('SELECT id, kind, layer, created_at, created_by FROM objects WHERE id = ?').get(id) as ObjectRow | undefined;
  }

  private currentVersion(objectId: string): VersionRow | undefined {
    return this.db.prepare('SELECT * FROM current WHERE object_id = ?').get(objectId) as VersionRow | undefined;
  }

  /** The markdown body of an object's current version ('' when the object doesn't exist). */
  currentBody(objectId: string): string {
    const version = this.currentVersion(objectId);
    return version ? this.readBody(version) : '';
  }

  /** The body of one version, from its markdown file. Refuses a missing file or one whose hash doesn't match. */
  private readBody(version: VersionRow): string {
    const file = join(this.home, version.body_path);
    if (!existsSync(file))
      throw new Error(`the markdown file for ${version.object_id} version ${version.n} is missing (${version.body_path})`);
    const content = readFileSync(file, 'utf8');
    if (sha256(content) !== version.body_sha256) {
      throw new Error(`the markdown file for ${version.object_id} version ${version.n} was changed outside Bousleh (${version.body_path})`);
    }
    return bodyOf(content);
  }

  /** The person marked `is_user` (the person this Bousleh belongs to), if any. */
  userPerson(): { id: string; name: string } | undefined {
    return this.db
      .prepare(
        `SELECT c.object_id AS id, c.title AS name FROM current c JOIN objects o ON o.id = c.object_id
         WHERE o.kind = 'person' AND json_extract(c.attrs_json, '$.is_user') = 1
         ORDER BY c.created_at LIMIT 1`,
      )
      .get() as { id: string; name: string } | undefined;
  }

  /** Only one person may be the user. */
  private checkSingleUser(kind: Kind, attrs: Record<string, unknown>, self?: string): void {
    if (kind !== 'person' || attrs.is_user !== true) return;
    const user = this.userPerson();
    if (user && user.id !== self) {
      throw new OpError(
        'conflict',
        `${user.name} (${user.id}) is already marked as the user; unmark them first with vault.supersede (attrs is_user: null)`,
      );
    }
  }

  /** Create one object with its first version, scopes and links. */
  createObject(input: NewObject): Written {
    this.files();
    const def = KINDS[input.kind];
    const checked = checkKindFields(input.kind, { status: input.status, attrs: input.attrs });
    if (!checked.ok) throw new OpError('invalid_input', `the ${input.kind} doesn't fit its kind`, checked.issues);
    this.checkSingleUser(input.kind, checked.value.attrs);

    const slugs = [...new Set(input.scopes)];
    if (def.scopeRequired && slugs.length === 0) {
      throw new OpError('invalid_input', `a ${input.kind} needs at least one scope (only people may have none)`);
    }
    const scopeIds = slugs.map((slug) => {
      const scope = this.scopeBySlug(slug);
      if (!scope) throw new OpError('invalid_input', `no scope named ${slug}; add it with scopes.add first`);
      return scope.id;
    });

    const now = this.now();
    const object: ObjectRow = {
      id: newId(def.prefix, this.meta.now()),
      kind: input.kind,
      layer: def.layer,
      created_at: now,
      created_by: this.meta.actor,
    };
    this.db
      .prepare('INSERT INTO objects (id, kind, layer, created_at, created_by) VALUES (?, ?, ?, ?, ?)')
      .run(object.id, object.kind, object.layer, object.created_at, object.created_by);
    const version = this.writeVersion(object, {
      title: input.title,
      altitude: input.altitude,
      status: checked.value.status,
      attrs: checked.value.attrs,
      body: input.body,
    });
    const addScope = this.db.prepare(
      'INSERT INTO object_scopes (object_id, scope_id, seq, op, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const scopeId of scopeIds) addScope.run(object.id, scopeId, this.nextScopeSeq(object.id), this.meta.op, this.meta.actor, now);
    for (const link of input.links) this.addLink(object.id, link.kind, link.to, link.note);
    this.refreshSearch(object.id);
    return { id: object.id, kind: object.kind, layer: object.layer, version, path: currentPath(object.layer, object.id) };
  }

  /** Write a new version of an existing object. Left-out fields carry over; attrs merge (null removes a key). */
  supersede(id: string, patch: VersionPatch): Written & { supersedes: string } {
    this.files();
    const object = this.objectRow(id);
    const previous = object ? this.currentVersion(id) : undefined;
    if (!object || !previous) throw new OpError('not_found', `no object with id ${id}`);

    const previousAttrs = JSON.parse(previous.attrs_json) as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...previousAttrs };
    for (const [key, value] of Object.entries(patch.attrs ?? {})) {
      if (value === null) delete merged[key];
      else merged[key] = value;
    }
    const checked = checkKindFields(
      object.kind,
      { status: patch.status, attrs: merged },
      { status: previous.status, attrs: previousAttrs },
    );
    if (!checked.ok) throw new OpError('invalid_input', `the new version doesn't fit a ${object.kind}`, checked.issues);
    this.checkSingleUser(object.kind, checked.value.attrs, id);

    const version = this.writeVersion(
      object,
      {
        title: patch.title ?? previous.title,
        altitude: patch.altitude ?? previous.altitude,
        status: checked.value.status,
        attrs: checked.value.attrs,
        body: patch.body ?? this.readBody(previous),
      },
      previous,
    );
    this.refreshSearch(id);
    return { id, kind: object.kind, layer: object.layer, version, path: currentPath(object.layer, id), supersedes: previous.id };
  }

  /**
   * Link two existing objects. Allowed pairs come from contracts. An identical live link is
   * returned as is. `concludes` also moves the idea to `concluded` (the idea must be a bet or running).
   */
  addLink(fromId: string, kind: LinkKind, toId: string, note?: string): AddedLink {
    this.files();
    if (fromId === toId) throw new OpError('invalid_input', 'an object cannot link to itself');
    const from = this.objectRow(fromId);
    if (!from) throw new OpError('not_found', `no object with id ${fromId}`);
    const to = this.objectRow(toId);
    if (!to) throw new OpError('not_found', `no object with id ${toId}`);
    const problem = checkLink(kind, from.kind, to.kind);
    if (problem) throw new OpError('invalid_input', problem);

    const existing = this.db
      .prepare(
        `SELECT l.id FROM links l WHERE l.from_id = ? AND l.to_id = ? AND l.kind = ?
         AND NOT EXISTS (SELECT 1 FROM link_retractions r WHERE r.link_id = l.id)`,
      )
      .get(fromId, toId, kind) as { id: string } | undefined;
    if (existing) return { id: existing.id, created: false };

    let concluded: AddedLink['concluded'];
    if (kind === 'concludes') {
      const idea = this.currentVersion(toId);
      if (!idea) throw new OpError('not_found', `no object with id ${toId}`);
      if (idea.status === 'concluded') throw new OpError('conflict', 'this idea is already concluded');
      if (!(CONCLUDABLE_IDEA_STATUSES as readonly (string | null)[]).includes(idea.status))
        throw new OpError('conflict', `only a bet or a running idea can be concluded (this idea is ${idea.status ?? 'without status'})`);
      const version = this.writeVersion(
        to,
        {
          title: idea.title,
          altitude: idea.altitude,
          status: 'concluded',
          attrs: JSON.parse(idea.attrs_json) as Record<string, unknown>,
          body: this.readBody(idea),
        },
        idea,
      );
      this.refreshSearch(toId);
      concluded = { idea: toId, version };
    }

    const id = newId(ROW_PREFIXES.link, this.meta.now());
    this.db
      .prepare('INSERT INTO links (id, from_id, to_id, kind, note, op, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, fromId, toId, kind, note ?? null, this.meta.op, this.meta.actor, this.now());
    return concluded ? { id, created: true, concluded } : { id, created: true };
  }

  /**
   * Retract a link: a `link_retractions` row, never a delete. A `concludes` link can't be
   * retracted, because a concluded idea stays concluded. Retracting twice writes nothing.
   */
  retractLink(linkId: string, reason?: string): RetractedLink {
    this.files();
    const link = this.db
      .prepare(
        `SELECT l.id, l.kind, l.from_id, l.to_id, EXISTS (SELECT 1 FROM link_retractions r WHERE r.link_id = l.id) AS retracted
         FROM links l WHERE l.id = ?`,
      )
      .get(linkId) as { id: string; kind: LinkKind; from_id: string; to_id: string; retracted: number } | undefined;
    if (!link) throw new OpError('not_found', `no link with id ${linkId}`);
    if (link.kind === 'concludes') {
      throw new OpError('conflict', 'a concludes link cannot be retracted: a concluded idea stays concluded');
    }
    const base = { id: link.id, kind: link.kind, from: link.from_id, to: link.to_id };
    if (link.retracted === 1) return { ...base, already_retracted: true };
    this.db
      .prepare('INSERT INTO link_retractions (link_id, reason, op, actor, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(link.id, reason ?? null, this.meta.op, this.meta.actor, this.now());
    return { ...base, already_retracted: false };
  }

  /** One object with its current version, scopes and live links, or undefined. */
  getObject(id: string, options: { history?: boolean } = {}): ObjectView | undefined {
    const object = this.objectRow(id);
    if (!object) return undefined;
    const version = this.currentVersion(id);
    if (!version) return undefined;

    const out = this.db
      .prepare(
        `SELECT l.id, l.kind, l.to_id AS other, o.kind AS other_kind, c.title AS other_title, l.note, l.created_at
         FROM links l JOIN objects o ON o.id = l.to_id JOIN current c ON c.object_id = l.to_id
         WHERE l.from_id = ? AND NOT EXISTS (SELECT 1 FROM link_retractions r WHERE r.link_id = l.id)
         ORDER BY l.created_at, l.id`,
      )
      .all(id) as LinkRow[];
    const incoming = this.db
      .prepare(
        `SELECT l.id, l.kind, l.from_id AS other, o.kind AS other_kind, c.title AS other_title, l.note, l.created_at
         FROM links l JOIN objects o ON o.id = l.from_id JOIN current c ON c.object_id = l.from_id
         WHERE l.to_id = ? AND NOT EXISTS (SELECT 1 FROM link_retractions r WHERE r.link_id = l.id)
         ORDER BY l.created_at, l.id`,
      )
      .all(id) as LinkRow[];

    const view: ObjectView = {
      id: object.id,
      kind: object.kind,
      layer: object.layer,
      created_at: object.created_at,
      created_by: object.created_by,
      version: {
        id: version.id,
        n: version.n,
        title: version.title,
        altitude: version.altitude,
        status: version.status,
        attrs: JSON.parse(version.attrs_json) as Record<string, unknown>,
        body: this.readBody(version),
        created_at: version.created_at,
        actor: version.actor,
        op: version.op,
      },
      scopes: this.scopeSlugsOf(id),
      links: {
        out: out.map((row) => ({
          id: row.id,
          kind: row.kind,
          to: row.other,
          to_kind: row.other_kind,
          to_title: row.other_title,
          note: row.note,
          created_at: row.created_at,
        })),
        in: incoming.map((row) => ({
          id: row.id,
          kind: row.kind,
          from: row.other,
          from_kind: row.other_kind,
          from_title: row.other_title,
          note: row.note,
          created_at: row.created_at,
        })),
      },
      path: currentPath(object.layer, object.id),
    };
    if (options.history) {
      view.history = (
        this.db.prepare('SELECT id, n, title, status, created_at, actor, op FROM versions WHERE object_id = ? ORDER BY n').all(id) as Pick<
          VersionRow,
          'id' | 'n' | 'title' | 'status' | 'created_at' | 'actor' | 'op'
        >[]
      ).map((row) => ({ ...row }));
    }
    return view;
  }

  // ---------------------------------------------------------------- internals

  private writeVersion(
    object: ObjectRow,
    fields: { title: string; altitude: Altitude; status: string | null; attrs: Record<string, unknown>; body: string },
    previous?: VersionRow,
  ): { id: string; n: number } {
    const n = previous ? previous.n + 1 : 1;
    const id = newId(ROW_PREFIXES.version, this.meta.now());
    const now = this.now();
    const content = renderMarkdown(
      {
        id: object.id,
        kind: object.kind,
        layer: object.layer,
        title: fields.title,
        altitude: fields.altitude,
        status: fields.status,
        version: n,
        version_id: id,
        created: object.created_at,
        updated: now,
      },
      fields.body,
    );
    const bodyPath = versionPath(object.layer, object.id, n);
    const files = this.files();
    files.stage(bodyPath, content, { allowVersions: true });
    files.stage(currentPath(object.layer, object.id), content);
    this.db
      .prepare(
        `INSERT INTO versions (id, object_id, n, supersedes_id, title, altitude, status, attrs_json, body_path, body_sha256, op, actor, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        object.id,
        n,
        previous?.id ?? null,
        fields.title,
        fields.altitude,
        fields.status,
        JSON.stringify(fields.attrs),
        bodyPath,
        sha256(content),
        this.meta.op,
        this.meta.actor,
        now,
      );
    return { id, n };
  }

  /** Rebuild the FTS row for one object from its current version and scopes. */
  refreshSearch(objectId: string): void {
    this.files();
    const object = this.objectRow(objectId);
    const version = this.currentVersion(objectId);
    this.db.prepare('DELETE FROM search WHERE object_id = ?').run(objectId);
    if (!object || !version) return;
    this.db
      .prepare('INSERT INTO search (object_id, title, body, kind, layer, scopes) VALUES (?, ?, ?, ?, ?, ?)')
      .run(objectId, version.title, this.readBody(version), object.kind, object.layer, this.scopeSlugsOf(objectId).join(' '));
  }
}

interface LinkRow {
  id: string;
  kind: LinkKind;
  other: string;
  other_kind: Kind;
  other_title: string;
  note: string | null;
  created_at: string;
}

/**
 * Repair files after a process died with a transaction open (an `open-*` marker left in `.staging`).
 * Runs when the database opens, under the write lock, so it never races a live write:
 * - version files with no row in `versions` (written by a transaction that never committed) are removed;
 * - each object's current copy is rewritten from its current version file;
 * - leftover temporary files and markers are cleared.
 * What it did is recorded in op_log as `vault.recover`.
 */
export function recover(db: Database.Database, home: string): void {
  const staging = join(home, STAGING_DIR);
  if (!existsSync(staging)) return;
  const leftovers = () => readdirSync(staging);
  if (!leftovers().some((name) => name.startsWith(OPEN_MARKER_PREFIX))) return;

  db.transaction(() => {
    const markers = leftovers().filter((name) => name.startsWith(OPEN_MARKER_PREFIX));
    if (markers.length === 0) return;
    const known = new Set((db.prepare('SELECT body_path FROM versions').all() as { body_path: string }[]).map((row) => row.body_path));
    const removed: string[] = [];
    for (const layer of LAYERS) {
      const versionsDir = join(home, layer, '.versions');
      if (!existsSync(versionsDir)) continue;
      for (const id of readdirSync(versionsDir)) {
        for (const file of readdirSync(join(versionsDir, id))) {
          const rel = `${layer}/.versions/${id}/${file}`;
          if (!known.has(rel)) {
            rmSync(join(home, rel), { force: true });
            removed.push(rel);
          }
        }
        if (readdirSync(join(versionsDir, id)).length === 0) rmSync(join(versionsDir, id), { recursive: true, force: true });
      }
    }
    const rewritten: string[] = [];
    const missing: string[] = [];
    const current = db
      .prepare('SELECT c.object_id, o.layer, c.body_path, c.body_sha256 FROM current c JOIN objects o ON o.id = c.object_id')
      .all() as {
      object_id: string;
      layer: Layer;
      body_path: string;
      body_sha256: string;
    }[];
    for (const row of current) {
      const source = join(home, row.body_path);
      if (!existsSync(source)) {
        missing.push(row.body_path);
        continue;
      }
      const content = readFileSync(source, 'utf8');
      const copy = join(home, currentPath(row.layer, row.object_id));
      if (!existsSync(copy) || readFileSync(copy, 'utf8') !== content) {
        writeAtomic(home, copy, content);
        rewritten.push(currentPath(row.layer, row.object_id));
      }
    }
    for (const name of leftovers()) rmSync(join(staging, name), { force: true });
    db.prepare('INSERT INTO op_log (op, actor, input_json, result, created_at) VALUES (?, ?, ?, ?, ?)').run(
      'vault.recover',
      'agent',
      JSON.stringify({ markers: markers.length, removed, rewritten, missing }),
      missing.length > 0 ? 'missing_files' : 'ok',
      new Date().toISOString(),
    );
  }).immediate();
}
