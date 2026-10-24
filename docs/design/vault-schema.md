# Vault schema: proposal

Status: **proposed, waiting for Wassim's OK.** No migrations get written until this is approved.

The rules this follows: SQLite for structure, markdown for long-form, linked by id. Nothing is overwritten, and history runs through "supersedes" links. Only op handlers write. The work vault on the work Mac uses the same schema in its own `~/.bousleh`.

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
| `versions` | every state, append-only | `id`, `object_id`, `n` (1, 2, …), `supersedes_id` (previous version, unique so history stays a line), `title`, `scope_id`, `altitude`, `status`, `attrs_json` (kind-specific fields, zod-validated per kind), `body_path`, `body_sha256`, `op`, `actor`, `created_at` |
| `current` (view) | latest version per object | versions with no successor |
| `scopes` | what an object belongs to (Perfect Placement, Specdr, Pandora, AI Anvil, Bousleh; Alethea on the work side) | `id`, `slug`, `name`, `kind` (`company`, `product`, `project`, `team`, `life`), `parent_id`, `supersedes_id` (a rename is a new row) |
| `links` | typed edges, immutable | `id`, `from_id`, `to_id`, `kind`, `note`, `op`, `actor`, `created_at` |
| `link_retractions` | a link withdrawn, without deleting it | `link_id`, `reason`, `actor`, `created_at` |
| `metric_readings` | readings, append-only (a correction supersedes) | `id`, `metric_id` (object), `value`, `unit`, `observed_at`, `source`, `supersedes_id`, `created_at` |
| `inbox_log` | one row per inbox file, by content hash | `sha256` (PK), `source` (`drive`, `local`, `transcript`), `original_name`, `seen_at`, `outcome` (`filed`, `queued`, `skipped`, `failed`), `object_id`, `processed_path` |
| `deposit_queue` | ambiguous deposits waiting for Claude or Wassim | `id`, `payload_json`, `reason`, `candidates_json`, `created_at` |
| `deposit_resolutions` | how a queued item was settled | `queue_id`, `resolution_json`, `object_id`, `actor`, `created_at` |
| `op_log` | every write op that ran: the audit trail | `id`, `op`, `actor`, `input_json`, `result` (`ok` or error code), `created_at` |
| `search` (FTS5) | full-text index over current versions | `object_id`, `title`, `body`, plus kind, layer and scope for filtering |
| `schema_migrations` | applied migrations | `version`, `applied_at` |

Nothing gets an `UPDATE` except `search`. It's a rebuildable index, refreshed in the same transaction as the version that changed it.

**Altitude** is stored as feet: `50000` company, `10000` cross-team, `1000` own surfaces, `100` one engineer or requirement. It lives on the version, so an object can change altitude over time. Altitude and scope are required. Anything Capture can't place goes to `deposit_queue` and doesn't become an object until it's placed.

**IDs** are a short kind prefix plus a ULID, e.g. `prb_01JBX…`. They sort by time, and the prefix shows what a link points at.

## 3. Kinds per layer (v0)

| Layer | Kinds | Kind-specific fields (in `attrs_json`) |
| --- | --- | --- |
| anchors | `strategy`, `principle`, `metric` | strategy: `status` forming / contested / aligned / communicated. metric: lifecycle idea / defined / instrumented / measured / reviewed, `cadence`, `unit`; owner and the strategy line it serves are links |
| evidence | `signal` (feedback), `observation`, `finding` (Horizon) | signal: `source`, `sentiment`. finding: `url`, `watch_list`, `published_at`. Readings live in `metric_readings`, not as objects |
| work | `problem`, `idea`, `bet`, `initiative`, `decision` | decision: `decided_at`, `reversible`. bet: `hypothesis`, `kill_criteria` |
| people | `person`, `growth_note` | person: `role` (stakeholder, pm, engineer, analyst, other), `org`. A growth note is one coaching entry about a person |
| moments | `dump`, `meeting`, `commitment`, `daily_note` | meeting: `held_at`, `attendees` (links). commitment: `status` open / done / dropped, `due`, owed to/by (links) |

**Link kinds (v0):** `evidence_for` (evidence to problem or bet), `about` (anything to a person or topic), `part_of` (to an initiative or strategy), `serves` (metric to strategy), `owned_by` (to a person), `from_moment` (an object to the dump or meeting it came from), `supersedes`, `related`. New kinds are added in contracts, not freehand.

## 4. Markdown conventions

- One file per object: `~/.bousleh/<layer>/<id>.md`, for example `work/prb_01JBX….md`. It always holds the **current** version.
- Frontmatter mirrors the structure (id, kind, layer, title, scope slug, altitude, status, version `n`, version id, created, updated). SQLite is authoritative; the frontmatter is there so a file reads on its own.
- The body is the long-form: free markdown, no required headings in v0.
- A file's content is never edited in place. On a new version, the old file moves to `<layer>/.versions/<id>/<n>.md` and a fresh file is written. Every past body stays on disk, and `versions.body_path` and `body_sha256` point at each one.
- Short objects (a commitment, a link-only note) may have an empty body. The file still exists so every object has a home.
- Inbox: raw files land in `inbox/`. Once logged and filed they move to `inbox/processed/<yyyy-mm>/<sha256-prefix>-<original name>`.

## 5. Writes and safety

- Each top-level write op runs in one SQLite transaction (WAL mode). File writes are staged, then moved into place after commit. If a write fails before commit, nothing lands.
- `vault.doctor` (later) checks every `body_sha256` against disk and reports drift.
- Hand edits to vault markdown are not supported in v0; open question 2 below covers this.

## Open questions for Wassim

1. **Where past bodies live.** As proposed, past bodies stay as moved files under `.versions/`, which keeps markdown as the long-form store. The alternative stores every body in SQLite (`versions.body`) and treats the markdown files as a readable mirror of the current version. That's simpler and fully transactional, but SQLite becomes the long-form store.
2. **Hand edits.** Should you be able to edit a vault markdown file directly, with the engine detecting the change (hash mismatch) and recording it as a new version? Or is the vault engine-written only, with every change going through Claude?
3. **Kinds.** Is the v0 kind list right? In particular: `idea` and `bet` as separate kinds, `growth_note` as its own kind for coaching history, and readings in a table rather than as objects.
