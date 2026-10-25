# Data schema

Status: **approved and implemented** (migration 1). Updated with Wassim's decisions of Oct 24 (the review of PR #2) and Oct 25 (the two remaining questions). Nothing is open.

The rules this follows: SQLite for structure, markdown for long-form, linked by id. Nothing is overwritten, and history runs through "supersedes" links. Only op handlers, called through `runOp`, write to your data, and only the `vault` and `intake` packages touch it on disk. The work instance on the work Mac uses the same schema in its own `~/.bousleh`.

## 1. The core idea: objects, versions, links

- An **object** is a stable identity: one problem, one person, one decision. It never changes.
- A **version** is one immutable state of an object. An edit writes a new version that `supersedes` the previous one. The current state is the version nothing supersedes.
- A **link** is a typed edge between two objects, and it points at the object, not a version. Links survive edits.
- An object can also **supersede another object**, for example a new decision that replaces an old one. That's a link of kind `supersedes`.

So history has two levels. Versions cover "this thing changed". The `supersedes` link covers "this thing replaced that thing".

## 2. Tables

| Table | Holds | Key columns |
| --- | --- | --- |
| `objects` | identity, immutable | `id`, `kind`, `layer`, `created_at`, `created_by` |
| `versions` | every state, append-only | `id`, `object_id`, `n` (1, 2, …), `supersedes_id` (previous version, unique so history stays a line), `title`, `altitude` (CHECK `IN (50000, 10000, 1000, 100)`), `status`, `attrs_json` (kind-specific fields, zod-validated per kind), `body_path`, `body_sha256`, `op`, `actor`, `created_at` |
| `current` (view) | latest version per object | versions with no successor |
| `scopes` | what objects belong to (Perfect Placement, Specdr, Pandora, AI Anvil, Bousleh; Alethea on the work side) | `id`, `slug`, `name`, `kind` (`company`, `product`, `project`, `team`, `life`), `parent_id`, `supersedes_id` (a rename is a new row) |
| `object_scopes` | which scopes an object belongs to (many-to-many), append-only | `object_id`, `scope_id`, `seq` (per object, shared with retractions), `op`, `actor`, `created_at` |
| `object_scope_retractions` | an object taken out of a scope, without deleting the row | `object_id`, `scope_id`, `seq`, `reason`, `op`, `actor`, `created_at` |
| `links` | typed edges, immutable | `id`, `from_id`, `to_id`, `kind`, `note`, `op`, `actor`, `created_at` |
| `link_retractions` | a link withdrawn, without deleting it | `link_id`, `reason`, `actor`, `created_at` |
| `metric_readings` | readings, append-only (a correction supersedes) | `id`, `metric_id` (object), `value`, `unit`, `observed_at`, `source`, `supersedes_id`, `created_at` |
| `inbox_log` | one row per inbox file, by content hash | `sha256` (PK), `source` (`drive`, `local`, `transcript`), `original_name`, `seen_at`, `outcome` (`filed`, `queued`, `skipped`, `failed`), `object_id`, `processed_path` |
| `deposit_queue` | ambiguous deposits waiting for Claude or Wassim | `id`, `payload_json`, `reason`, `candidates_json`, `created_at` |
| `deposit_resolutions` | how a queued item was settled | `queue_id`, `resolution_json`, `object_id`, `actor`, `created_at` |
| `op_log` | every write op that ran: the audit trail | `id`, `op`, `actor`, `input_json`, `result` (`ok` or error code), `created_at` |
| `search` (FTS5) | full-text index over current versions | `object_id`, `title`, `body`, plus kind, layer and scope slugs for filtering |
| `schema_migrations` | applied migrations | `version`, `applied_at` |

Nothing gets an `UPDATE` except `search`. It's a rebuildable index, refreshed in the same transaction as the version or scope change that affects it.

**Scopes.** An object can belong to several scopes, for example a person who sits in both Alethea and Specdr, or a decision that spans two projects. Every object needs at least one scope, except people, who may have none because they span scopes. SQLite can't express "at least one row elsewhere" as a constraint, so `deposits.write` enforces it per kind (a zod rule in contracts), and a later `vault.doctor` reports violations. An object's current scopes come from replaying its adds and retractions in `seq` order (one counter per object across both tables), latest event per scope wins; the order never depends on the clock. Scope changes don't create a new version: membership has its own append-only history, as links do. Scopes themselves are created with `scopes.add` (slug, name, kind, optional parent) and listed with `scopes.list`; objects name their scopes by slug.

**Altitude** is stored as feet and limited by a CHECK constraint to four values: `50000` company, `10000` cross-team, `1000` own surfaces, `100` one engineer or requirement. It lives on the version, so an object can change altitude over time. Altitude is required. Anything Capture can't place goes to `deposit_queue` and doesn't become an object until it's placed.

**IDs** are a short kind prefix plus a ULID, e.g. `prb_01JBX…`. They sort by time, and the prefix shows what a link points at.

## 3. Kinds per layer (v0)

| Layer | Kinds | Kind-specific fields (in `attrs_json`) |
| --- | --- | --- |
| anchors | `strategy`, `principle`, `metric`, `watch_list` | strategy: `status` forming / contested / aligned / communicated. metric: lifecycle idea / defined / instrumented / measured / reviewed, `cadence`, `unit`; its owner and the strategy line it serves are links. watch_list: `entries`, each with a `type` (competitor, topic, outlet, person, podcast), `name`, optional `url` and `notes`; tied to its scope through `object_scopes` |
| evidence | `signal` (feedback), `observation`, `finding` (Horizon) | signal: `source`, `sentiment`. finding: `url`, `published_at`; linked to its watch list with `from_watch_list`. Readings live in `metric_readings`, not as objects |
| work | `problem`, `idea`, `initiative`, `decision` | idea: `status` open / bet / parked / dropped / concluded, plus `hypothesis` and `kill_criteria`, required once it becomes a bet. An idea reaches `concluded` only when a `decision` is linked to it with `concludes` (see below), never by setting the status directly. decision: `decided_at`, `reversible` |
| people | `person`, `growth_note` | person: `role` (stakeholder, pm, engineer, analyst, other), `org`, `is_user` (true on the one person this instance belongs to: "me" in Pulse; at most one current person has it, enforced by the store). A growth note is one coaching entry about a person |
| moments | `dump`, `meeting`, `commitment`, `daily_note` | meeting: `held_at`; attendees are `attended_by` links. commitment: `status` open / done / dropped, `due`; who owes it and to whom are `owed_by` and `owed_to` links |

**Link kinds (v0):**
- `evidence_for`: evidence to a problem or idea
- `about`: anything to a person or topic
- `addresses`: an idea to the problem it addresses. Optional: an idea can stand alone as an opportunity (Oct 25)
- `part_of`: to an initiative or strategy
- `serves`: metric to strategy
- `owned_by`: to a person
- `from_moment`: an object to the dump or meeting it came from
- `from_watch_list`: a finding to its watch list
- `concludes`: a decision to the idea it concludes; the idea must be a `bet`. A bet's outcome (scale it, pivot, kill criteria met) is that decision; linking it writes a new version of the idea with status `concluded`, in the same transaction
- `attended_by`: a meeting to a person who attended it
- `owed_by`, `owed_to`: a commitment to the person who owes it and the person it's owed to
- `supersedes`: an object to the object it replaces (same kind)
- `related`

New link kinds are added in contracts, not freehand.

## 4. Markdown conventions

- One file per object: `~/.bousleh/<layer>/<id>.md`, for example `work/prb_01JBX….md`. It always holds the **current** version.
- Frontmatter mirrors the version: id, kind, layer, title, altitude, status, version `n`, version id, created, updated. SQLite is authoritative; the frontmatter is there so a file reads on its own. Scopes and links change without a new version, so they live only in SQLite and stay out of the frontmatter. That way a file never needs rewriting.
- The body is the long-form: free markdown, no required headings in v0.
- A file's content is never edited in place. Every version is written once, to `<layer>/.versions/<id>/<n>.md`, and never touched again; `versions.body_path` and `body_sha256` point at it, so they never need updating. `<layer>/<id>.md` is a copy of the current version, replaced when a new one is written. Every past body stays on disk as markdown, and markdown stays the long-form store. (This replaces "the old file moves on a new version", which would have needed an UPDATE to `body_path`.)
- Short objects (a commitment, a link-only note) may have an empty body. The file still exists, so every object has a home.

## 5. The inbox

- **Local inbox:** `~/.bousleh/inbox/`, for files dropped on the Mac and meeting transcripts handed over directly (`source` `local` or `transcript`).
- **Drive inbox:** the Google Drive desktop app syncs the "Bousleh Inbox" folder to the Mac. The inbox sweep reads that local copy (`source = 'drive'`). The engine never calls the Drive connector, and file contents never pass through Claude on their way in. Phone dictations and the Daily Horizon scan's findings both arrive this way.
- **Config:** the synced folder's path is set by `BOUSLEH_DRIVE_INBOX`, next to `BOUSLEH_HOME`: in the MCP server's `env` and in the Daily inbox sweep's environment. Google Drive puts it under `~/Library/CloudStorage/GoogleDrive-<account>/My Drive/Bousleh Inbox`. There's no auto-detection: if the variable is unset, `inbox.sweep` reports that the Drive inbox isn't configured and sweeps only the local inbox.
- **Folders:** the folder a file waits in says its source. `inbox/` is `local`, `inbox/transcripts/` is `transcript`, and `inbox/drive/` is where `inbox.sweep` puts files it moves in from the synced Drive folder (`drive`). Only top-level files count.
- **Moves, not copies (Oct 25):** files from the Drive inbox are moved, not copied. Moving a file out of the synced folder takes it out of Google Drive, which keeps it in its trash for 30 days; after that it exists only on the Mac.
- **Settling:** each file is hashed. It counts as waiting while it sits in an inbox folder and its hash isn't in `inbox_log`. Capture settles it with `inbox.settle`: `filed`, `queued` and `skipped` write the `inbox_log` row and move the file to `inbox/processed/<yyyy-mm>/<sha256-prefix>-<original name>`. A file whose hash is already logged is a duplicate and moves to processed without a second row. `failed` moves the file to `inbox/failed/<yyyy-mm>/` without a log row, so dropping it in again retries it.
- **Crash safety:** file moves run after the transaction commits. If a process dies in between, the file is still in the inbox with its hash logged, and the next sweep moves it as a duplicate.
- **Phone dictation** must arrive as `.txt` or `.md`. A native Google Doc syncs to the Mac as a `.gdoc` link with no text, which `inbox.take` can't read.

## 6. Writes and safety

- **Backups.** `~/.bousleh` is the only copy of all data: it's local only, never pushed and not a git repo. Time Machine must cover it on the personal Mac; on the work Mac, Alethea's backup does. A later `vault.doctor` check can warn when no recent backup is detected (not built yet).
- Each top-level write op runs in one SQLite transaction (WAL mode, `BEGIN IMMEDIATE`, so it holds the write lock against a second Bousleh process too). Its files are written while that lock is held, and each write remembers what it replaced: if the op rolls back, every file goes back the way it was. An op called from inside another op runs in a SAVEPOINT, so a nested failure is undone even when the caller carries on.
- A marker in `.staging` says a transaction is open. If a process dies mid-op, the next one to open your data removes version files no committed row points at, rewrites each current copy from its version file, and logs `vault.recover` in `op_log`.
- Reading a version checks its file against `body_sha256`. A missing or changed file is an error, never an empty body.
- Every table except `search` refuses UPDATE and DELETE (triggers), and a new version must supersede version n - 1 of the same object. Read-only ops run with SQLite's `query_only` on.
- File writes stay inside the data home: no absolute paths, no `..`, nothing in `.staging` or `vault.db*`, and only the store writes `.versions`.
- **No hand edits in v0.** Your data is engine-written only. A later `vault.doctor` op checks every current file's `body_sha256` against disk. On a mismatch (a hand-edited file), it records the file's content as a new version through an op, so even a hand edit goes through the engine and keeps history. It also reports objects outside any scope, other than people.

## Decisions (Oct 24)

1. **Past bodies** stay as moved markdown files under `<layer>/.versions/<id>/<n>.md`. Markdown stays the long-form store.
2. **No hand edits in v0.** A later `vault.doctor` records drift as a new version (section 6).
3. **Kinds:** `bet` is folded into `idea`. `growth_note` stays, and readings stay in `metric_readings`.
4. **Scopes:** several per object, through `object_scopes`, at least one each; people may have none.
5. **Watch lists:** a `watch_list` kind under anchors, tied to a scope; findings link to it.
6. **Drive inbox:** read from the locally synced Google Drive folder, set by `BOUSLEH_DRIVE_INBOX`.
7. **Altitude:** limited to 50000, 10000, 1000 and 100 by a CHECK constraint.

## Decisions (Oct 25)

8. **Drive files after the sweep** are moved into `~/.bousleh/inbox/processed`, not copied. Drive keeps them in its trash for 30 days (section 5).
9. **Backups:** `~/.bousleh` is the only copy of all data and must be covered by Time Machine (Alethea's backup on the work Mac). Section 6.
10. **Idea statuses:** `open`, `bet`, `parked`, `dropped`, `concluded`. No won/lost statuses: a bet's outcome is a `decision` linked to the idea with the new `concludes` link kind, which moves the idea to `concluded`. That link is the only way to get there.
