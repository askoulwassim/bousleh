# Data schema

Status: **updated with Wassim's decisions of Oct 24** (KICKOFF.md, "Schema decisions", and the review of PR #2). Migrations and `vault.search` follow in the next PR once this version is accepted. Two small questions remain open at the end.

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
| `object_scopes` | which scopes an object belongs to (many-to-many), append-only | `object_id`, `scope_id`, `op`, `actor`, `created_at` |
| `object_scope_retractions` | an object taken out of a scope, without deleting the row | `object_id`, `scope_id`, `reason`, `op`, `actor`, `created_at` |
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

**Scopes.** An object can belong to several scopes, for example a person who sits in both Alethea and Specdr, or a decision that spans two projects. Every object needs at least one scope, except people, who may have none because they span scopes. SQLite can't express "at least one row elsewhere" as a constraint, so `deposits.write` enforces it per kind (a zod rule in contracts), and a later `vault.doctor` reports violations. An object's current scopes are its `object_scopes` rows with no matching retraction. Scope changes don't create a new version: membership has its own append-only history, as links do.

**Altitude** is stored as feet and limited by a CHECK constraint to four values: `50000` company, `10000` cross-team, `1000` own surfaces, `100` one engineer or requirement. It lives on the version, so an object can change altitude over time. Altitude is required. Anything Capture can't place goes to `deposit_queue` and doesn't become an object until it's placed.

**IDs** are a short kind prefix plus a ULID, e.g. `prb_01JBX…`. They sort by time, and the prefix shows what a link points at.

## 3. Kinds per layer (v0)

| Layer | Kinds | Kind-specific fields (in `attrs_json`) |
| --- | --- | --- |
| anchors | `strategy`, `principle`, `metric`, `watch_list` | strategy: `status` forming / contested / aligned / communicated. metric: lifecycle idea / defined / instrumented / measured / reviewed, `cadence`, `unit`; its owner and the strategy line it serves are links. watch_list: `entries`, each with a `type` (competitor, topic, outlet, person, podcast), `name`, optional `url` and `notes`; tied to its scope through `object_scopes` |
| evidence | `signal` (feedback), `observation`, `finding` (Horizon) | signal: `source`, `sentiment`. finding: `url`, `published_at`; linked to its watch list with `from_watch_list`. Readings live in `metric_readings`, not as objects |
| work | `problem`, `idea`, `initiative`, `decision` | idea: `status` (open question 2 below), plus `hypothesis` and `kill_criteria` once it becomes a bet (required at that status). decision: `decided_at`, `reversible` |
| people | `person`, `growth_note` | person: `role` (stakeholder, pm, engineer, analyst, other), `org`. A growth note is one coaching entry about a person |
| moments | `dump`, `meeting`, `commitment`, `daily_note` | meeting: `held_at`, `attendees` (links). commitment: `status` open / done / dropped, `due`, owed to/by (links) |

**Link kinds (v0):**
- `evidence_for`: evidence to a problem or idea
- `about`: anything to a person or topic
- `part_of`: to an initiative or strategy
- `serves`: metric to strategy
- `owned_by`: to a person
- `from_moment`: an object to the dump or meeting it came from
- `from_watch_list`: a finding to its watch list
- `supersedes`
- `related`

New link kinds are added in contracts, not freehand.

## 4. Markdown conventions

- One file per object: `~/.bousleh/<layer>/<id>.md`, for example `work/prb_01JBX….md`. It always holds the **current** version.
- Frontmatter mirrors the version: id, kind, layer, title, altitude, status, version `n`, version id, created, updated. SQLite is authoritative; the frontmatter is there so a file reads on its own. Scopes and links change without a new version, so they live only in SQLite and stay out of the frontmatter. That way a file never needs rewriting.
- The body is the long-form: free markdown, no required headings in v0.
- A file's content is never edited in place. On a new version, the old file moves to `<layer>/.versions/<id>/<n>.md` and a fresh file is written. Every past body stays on disk as markdown, and `versions.body_path` and `body_sha256` point at each one. Markdown stays the long-form store.
- Short objects (a commitment, a link-only note) may have an empty body. The file still exists, so every object has a home.

## 5. The inbox

- **Local inbox:** `~/.bousleh/inbox/`, for files dropped on the Mac and meeting transcripts handed over directly (`source` `local` or `transcript`).
- **Drive inbox:** the Google Drive desktop app syncs the "Bousleh Inbox" folder to the Mac. The inbox sweep reads that local copy (`source = 'drive'`). The engine never calls the Drive connector, and file contents never pass through Claude on their way in. Phone dictations and the Daily Horizon scan's findings both arrive this way.
- **Config:** the synced folder's path is set by `BOUSLEH_DRIVE_INBOX`, next to `BOUSLEH_HOME`: in the MCP server's `env` and in the Daily inbox sweep's environment. Google Drive puts it under `~/Library/CloudStorage/GoogleDrive-<account>/My Drive/Bousleh Inbox`. There's no auto-detection: if the variable is unset, `inbox.sweep` reports that the Drive inbox isn't configured and sweeps only the local inbox.
- Each file is hashed, then logged in `inbox_log` and skipped if its hash has been seen. Once filed or queued it moves to `~/.bousleh/inbox/processed/<yyyy-mm>/<sha256-prefix>-<original name>` (open question 1 covers files from Drive).

## 6. Writes and safety

- Each top-level write op runs in one SQLite transaction (WAL mode). File writes are staged, then moved into place after commit. If a write fails before commit, nothing lands.
- **No hand edits in v0.** Your data is engine-written only. A later `vault.doctor` op checks every current file's `body_sha256` against disk. On a mismatch (a hand-edited file), it records the file's content as a new version through an op, so even a hand edit goes through the engine and keeps history. It also reports objects outside any scope, other than people.

## Decisions (Oct 24)

1. **Past bodies** stay as moved markdown files under `<layer>/.versions/<id>/<n>.md`. Markdown stays the long-form store.
2. **No hand edits in v0.** A later `vault.doctor` records drift as a new version (section 6).
3. **Kinds:** `bet` is folded into `idea`. `growth_note` stays, and readings stay in `metric_readings`.
4. **Scopes:** several per object, through `object_scopes`, at least one each; people may have none.
5. **Watch lists:** a `watch_list` kind under anchors, tied to a scope; findings link to it.
6. **Drive inbox:** read from the locally synced Google Drive folder, set by `BOUSLEH_DRIVE_INBOX`.
7. **Altitude:** limited to 50000, 10000, 1000 and 100 by a CHECK constraint.

## Still open

1. **What happens to a Drive file after the sweep.** Moving it into `~/.bousleh/inbox/processed` takes it out of Google Drive. Drive keeps it in its trash for 30 days, and after that it exists only on the Mac. That matches "moved to `inbox/processed`" and keeps Drive empty. The alternative copies it into `processed` and moves the Drive original to a `Bousleh Inbox/processed` subfolder, so Drive keeps a copy forever. I recommend the move.
2. **Idea statuses.** I propose `open`, `bet`, `parked` and `dropped`, with `hypothesis` and `kill_criteria` required once an idea is a `bet`. Should there be a status after a bet plays out (e.g. `won` / `lost`), or does that become a `decision` linked to the idea?
