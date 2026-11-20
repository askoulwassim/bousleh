# Data schema

Status: **approved and implemented** (migration 1). Updated with Wassim's decisions of Oct 24 (the review of PR #2) and Oct 25 (the two remaining questions, then the model gaps: glossary terms, signal tags, idea rank, statuses on initiatives, findings and meetings, and `reports_to`; then the mode runs: person `emails`, problem statuses and running ideas). Kinds, statuses, attrs and link rules live in `contracts`, so the Oct 25 model additions needed no SQL migration. Nothing is open.

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

**Scopes.** An object can belong to several scopes, for example a person who sits in both Alethea and Specdr, or a decision that spans two projects. Every object needs at least one scope, except people, who may have none because they span scopes. SQLite can't express "at least one row elsewhere" as a constraint, so `deposits.write` enforces it per kind (a zod rule in contracts), and a later `vault.doctor` reports violations. An object's current scopes come from replaying its adds and retractions in `seq` order (one counter per object across both tables), latest event per scope wins; the order never depends on the clock. Scope changes don't create a new version: membership has its own append-only history, as links do. Scopes themselves are created with `scopes.add` (slug, name, kind, optional parent) and listed with `scopes.list`; objects name their scopes by slug. `scopes.move` gives a scope a new parent, or makes it top-level, as a new scope row that supersedes the old one (like a rename); memberships and children resolve by slug, so everything filed in it and every scope below it moves with it. Home's grid shows top-level scopes as columns, so a scope gets its own column by being moved to the top. `scopes.rename` changes a scope's display name the same way; its slug never changes, since objects, watch lists and prompts name scopes by slug.

**Altitude** is stored as feet and limited by a CHECK constraint to four values: `50000` company, `10000` cross-team, `1000` own surfaces, `100` one engineer or requirement. It lives on the version, so an object can change altitude over time. Altitude is required. Anything Capture can't place goes to `deposit_queue` and doesn't become an object until it's placed.

**IDs** are a short kind prefix plus a ULID, e.g. `prb_01JBX…`. They sort by time, and the prefix shows what a link points at.

## 3. Kinds per layer (v0)

| Layer | Kinds | Kind-specific fields (in `attrs_json`) |
| --- | --- | --- |
| anchors | `strategy`, `principle`, `metric`, `watch_list`, `term` | strategy: `status` forming / contested / aligned / communicated. metric: lifecycle idea / defined / instrumented / measured / reviewed, `cadence`, `unit`; its owner and the strategy line it serves are links. watch_list: `entries`, each with a `type` (competitor, topic, outlet, person, podcast), `name`, optional `url` and `notes`, `added_by` (`wassim`, the default, or `horizon` for one the weekly scan proposed; entries from before Oct 25 read as Wassim's) and an optional `reason`; tied to its scope through `object_scopes`. Every change is a new version, so the list's history shows what the scan added or removed. term (a glossary term, prefix `trm`): `aliases` (default none), optional `definition`; the title is the term, the body can hold more |
| evidence | `signal` (feedback), `observation`, `finding` (Horizon) | signal: `source`, `sentiment`, `tags` (short lower-case slugs such as `export-speed`, each once, default none) so feedback can be counted as patterns. finding: `url`, `published_at`; `status` is the reading queue new / to_read / read / dismissed (default new); linked to its watch list with `from_watch_list`. Readings live in `metric_readings`, not as objects |
| work | `problem`, `idea`, `initiative`, `decision`, `asset` | problem: `status` open / solved / dropped (default open); why it was solved or dropped is a `decision` linked `related`. idea: `status` open / running / bet / parked / dropped / concluded, plus `hypothesis` and `kill_criteria`, required once it becomes a bet, and an optional `rank` (a positive integer, 1 the top). `running` is an idea being tried right now (an experiment under way, a build in progress) and needs no attrs. An idea reaches `concluded` only when a `decision` is linked to it with `concludes` (see below), never by setting the status directly; a concluded idea keeps the hypothesis and kill criteria it had. initiative: `status` proposed / active / paused / done / dropped (default active), optional `started_at` and `target_date`; its owner is an `owned_by` link. decision: `decided_at`, `reversible`. asset: `url` (required), `type` doc / slides / sheet / dashboard / whiteboard / design / page / repo / file / other; no status; what it documents are `documents` links |
| people | `person`, `growth_note` | person: `role` (stakeholder, pm, engineer, analyst, other), `org`, `emails` (optional, at most five, stored lower-cased, each once; people written before Oct 25 have none), `is_user` (true on the one person this instance belongs to: "me" in Pulse; at most one current person has it, enforced by the store); their manager is a `reports_to` link. A growth note is one coaching entry about a person |
| moments | `dump`, `meeting`, `commitment`, `daily_note` | meeting: `status` planned / held (default held), `held_at` (when it was or will be held); attendees are `attended_by` links. A planned meeting holds Counsel's prep in its body and is superseded to held once it happens. commitment: `status` open / done / dropped, `due`, `surface_on` (snoozed until that day), `size` major / minor (Nov 20; none reads as major); who owes it and to whom are `owed_by` and `owed_to` links |

**Objects written before a kind had statuses (Oct 25).** Initiatives, findings and meetings filed before Oct 25, and problems filed before they had statuses, have no status stored. They read as their kind's default (`effectiveStatus` in contracts): an initiative as `active`, a finding as `new`, a meeting as `held`, a problem as `open`. `context.brief`, `vault.search` and `people.get` show that status; `vault.get` shows the version as stored. Their next version takes that default, or the status it is given. New attrs with a default (`tags`, `aliases`) are filled in on an object's next version; until then they read as empty.

**Link kinds (v0):**
- `evidence_for`: evidence to a problem or idea
- `about`: anything to a person or topic
- `addresses`: an idea to the problem it addresses. Optional: an idea can stand alone as an opportunity (Oct 25)
- `part_of`: to an initiative or strategy
- `serves`: metric to strategy
- `owned_by`: to a person
- `from_moment`: an object to the dump or meeting it came from
- `from_watch_list`: a finding to its watch list
- `concludes`: a decision to the idea it concludes; the idea must be a `bet` or `running`. A bet's outcome (scale it, pivot, kill criteria met), or what trying a running idea showed, is that decision; linking it writes a new version of the idea with status `concluded`, in the same transaction
- `attended_by`: a meeting to a person who attended it
- `owed_by`, `owed_to`: a commitment to the person who owes it and the person it's owed to
- `reports_to`: a person to the person they report to (their manager), for the people map. `context.brief` shows it on every person
- `documents`: an asset to the object it documents (any kind)
- `supersedes`: an object to the object it replaces (same kind)
- `related`

New link kinds are added in contracts, not freehand.

**Assets (Oct 25).** The work itself lives outside Bousleh, in Claude artifacts (Docs, Slides decks, dashboards, whiteboards, designs, published pages), Google files and GitHub repos. An `asset` records one by its url and links with `documents` to the strategy, problem, idea, initiative, decision or person it documents. `assets.add` registers one and dedupes by url (ignoring the `#fragment`, `utm_*` parameters and a trailing slash, which are also dropped from the stored url); `assets.list` lists them; `context.brief` has an `assets` section, which, like people, ignores the altitude band. Every mode that creates or updates an artifact registers it, and Capture registers artifact and repo urls found in dumps.

## 4. Markdown conventions

- One file per object: `~/.bousleh/<layer>/<id>.md`, for example `work/prb_01JBX….md`. It always holds the **current** version.
- Frontmatter mirrors the version: id, kind, layer, title, altitude, status, version `n`, version id, created, updated. SQLite is authoritative; the frontmatter is there so a file reads on its own. Scopes and links change without a new version, so they live only in SQLite and stay out of the frontmatter. That way a file never needs rewriting.
- The body is the long-form: free markdown, no required headings in v0.
- A file's content is never edited in place. Every version is written once, to `<layer>/.versions/<id>/<n>.md`, and never touched again; `versions.body_path` and `body_sha256` point at it, so they never need updating. `<layer>/<id>.md` is a copy of the current version, replaced when a new one is written. Every past body stays on disk as markdown, and markdown stays the long-form store. (This replaces "the old file moves on a new version", which would have needed an UPDATE to `body_path`.)
- Short objects (a commitment, a link-only note) may have an empty body. The file still exists, so every object has a home.

## 5. The inbox

- **Local inbox:** `~/.bousleh/inbox/`, for files dropped on the Mac and meeting transcripts handed over directly (`source` `local` or `transcript`).
- **Drive inbox (Oct 25):** the Google Drive folder "Bousleh Inbox", reached only through the Claude account's Google Drive connector. On the phone, the Drop skill writes each dictation there as a new `.md` file (no Google Doc conversion). On the Mac, Capture lists the folder through the connector, reads each file, hands it to `inbox.drop` (which writes it to `inbox/drive/` under the op's transaction, or reports a duplicate), and only then trashes it in Drive: moved, not copied. Drive keeps it in its trash for 30 days. The Weekly Horizon scan writes its findings there the same way. It reads the watch lists from a separate file, `Bousleh Watch Lists.md` in the Drive folder `Bousleh` (never the inbox folder, which is swept), which the Mac rewrites after every watch list change.
- **No Google Drive desktop app:** macOS blocks other apps (Terminal, Claude) from reading the synced Drive folder without Full Disk Access, so the desktop-app path is legacy. `inbox.sweep` still reads `BOUSLEH_DRIVE_INBOX` if it is set and readable, and otherwise says so and sweeps only the local inbox.
- **Folders:** the folder a file waits in says its source: `inbox/` is `local`, `inbox/transcripts/` is `transcript`, `inbox/drive/` is `drive`. Only top-level files count.
- **Settling:** each file is hashed. It counts as waiting while it sits in an inbox folder and its hash isn't in `inbox_log`. Capture settles it with `inbox.settle`: `filed`, `queued` and `skipped` write the `inbox_log` row and move the file to `inbox/processed/<yyyy-mm>/<sha256-prefix>-<original name>`. A file whose hash is already logged is a duplicate and moves to processed without a second row. `failed` moves the file to `inbox/failed/<yyyy-mm>/` without a log row, so dropping it in again retries it.
- **Crash safety:** file moves run after the transaction commits. If a process dies in between, the file is still in the inbox with its hash logged, and the next sweep moves it as a duplicate.

## 6. Writes and safety

- **Backups (Oct 25).** `~/.bousleh` is local only, never pushed and not a git repo. The MCP server snapshots it once a day to `~/.bousleh-backups` (`BOUSLEH_BACKUPS` overrides) on the same disk: a dated folder per snapshot, the database copied with SQLite's online backup and then the files, newest 14 kept; `vault.backup` takes one on demand and `vault.health` reports the latest. This guards against a bad op, a bug or a slip, not a lost disk; Time Machine is optional. A snapshot folder is a complete data home, so restoring is: quit Claude Desktop and Claude Code, move `~/.bousleh` aside, copy the snapshot into its place.
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

## Decisions (Oct 25, the model gaps)

11. **Glossary terms** are their own kind, `term`, under anchors: the work instance needs the company glossary in its first weeks. Not in `context.brief`; `vault.search` with kinds `[term]` finds them.
12. **Signal tags** are short lower-case slugs, so feedback can be counted as patterns. Existing tags are reused before new ones are made.
13. **Idea rank** is an attr, not body text: 1 is the top. The brief orders ideas of the same status by it.
14. **Initiatives** have a status (proposed, active, paused, done, dropped; default active) and optional `started_at` and `target_date`. The owner stays an `owned_by` link. `context.brief` has an `initiatives` section.
15. **Findings** carry Horizon's reading queue as their status: new, to_read, read, dismissed. `watch.digest` filters by it.
16. **Meetings** are planned or held (default held). Counsel's prep lives on a planned meeting, superseded to held once it happens.
17. **`reports_to`** links a person to their manager.
18. **The Horizon scan is weekly** (Mondays at 06:40, looking back seven days): daily was too noisy. Its watch lists travel through `Bousleh Watch Lists.md` in Drive, not its prompt.
19. **The scan learns.** Each scan proposes watch list adds and removes with a reason. Filing applies adds (marked `added_by: horizon`) and removes only entries the scan added; removing one of Wassim's entries is queued for him to decide.

## Decisions (Oct 25, the mode runs)

20. **The calendar is the source for the schedule.** Bousleh has no recurring meetings and stores only meetings with prep or notes: a planned meeting (Counsel's prep) or a held one (the debrief). Pulse and Counsel read the calendar through the Google Calendar connector and merge its events with those meetings: an event and a meeting at the same start with overlapping attendees are one meeting.
21. **People have `emails`**, so calendar attendees match people by address before name. Optional, lower-cased, each once, at most five; a new version replaces the whole list.
22. **Pulse shows open commitments with no due date** (`no_due` in `pulse.today`), owed by Wassim and to him, oldest first, so an undated commitment never goes missing.
23. **Problems have statuses:** `open` (default), `solved`, `dropped`; problems written before read as open. `context.brief` with no centre leaves solved and dropped problems out (as it does done and dropped initiatives), and shows them with their status in the centre or one hop out.
24. **Ideas can be `running`:** being tried right now. Statuses are open, running, bet, parked, dropped, concluded. A `concludes` link ends a bet or a running idea; `concluded` stays reserved. A concluded idea keeps the hypothesis and kill criteria it had, rather than needing them (a running idea may have had none). `pulse.today`'s `open_bets` lists bets and running ideas, each with its status.

## Decisions (Oct 25, Home)

25. **`context.strata`** gives Home the whole cross-section in one read-only call: scopes as columns (default every top-level scope, oldest first; each covers its child scopes), the four altitudes as rows, and in each cell the live objects there, needs-you first (open commitments owed by the user that are overdue, due on the date or undated), then bets, then what is moving (running ideas, active initiatives, planned meetings), then the newest, capped by `per_cell` (default 6) with `count`, `more`, per-kind counts and a count of closed objects. Closed means what the brief leaves out with no centre: done and dropped initiatives, solved and dropped problems, concluded and dropped ideas, done and dropped commitments, plus dismissed findings. Replaced objects, terms, assets (counted per column), dumps, daily notes, growth notes and meetings held more than 14 days ago are left out. An object in several scopes appears in each column; a person with no scope of their own is placed by the scopes of what links to them, as `people.list` does. Each column carries its strategy and asset count.

## Decisions (Nov 13, focus and snooze)

26. **Commitments can be snoozed.** `surface_on` (a date) keeps an open commitment out of `pulse.today`'s buckets, Home's needs-you count and `context.strata` until that day; `pulse.today` only counts snoozed ones (`commitments.snoozed`, with the next to come back). From that day it counts as due on its `due` date, else on `surface_on`, and the strata flags it as needing Wassim whichever way it is owed (a follow-up he asked for). Capture sets it when a follow-up is filed ("remind me in a week if Ian hasn't replied"); `commitments.snooze` sets or clears it on an open commitment, with an optional note. `commitments.list` shows `surface_on` and filters with `snoozed` (include, exclude, only) as of a day.
27. **Pulse ranks a short focus list.** `pulse.today`'s `focus` holds at most three items (`FOCUS_LIMIT`) with a score and `why`, reasons in words: open commitments Wassim owes that are late, due today or within two days, back from a snooze, or undated for over a week; commitments owed to him that are late or back from a snooze; and the day's planned meetings. The score adds how late or soon, who is on the other side (his manager through `reports_to`, else a stakeholder), whether he sees them today (a meeting filed for the day), a link to a bet or running idea, and the altitude. Commitments between other people never rank. The weights live in one place (`FOCUS_WEIGHTS`, `packages/context`), so the Friday tune-up can adjust them. Pulse and Home lead with focus; Claude can still put something else first when the conversation says so.

## Decisions (Nov 20, commitment size)

28. **Commitments have a size.** `size` is `major` (a real deliverable: ship a release, write or finalize a doc, plan, roadmap, requirements, report, OKRs) or `minor` (a small follow-up from a call: talk to, ask, send, share, schedule, read, add someone to a channel). A commitment with no size reads as major (`commitmentSize` in `contracts`). Capture sets it on every new commitment; Pulse supersedes it when Wassim says something is bigger or smaller. `commitments.list` (and `people.get`) show the effective size and filter with `size`. In `pulse.today`, a minor commitment scores `FOCUS_WEIGHTS.minor` (-25) lower in `focus` with "small follow-up" in its `why`, and an undated minor one is never a focus candidate; `no_due.by_me` and `no_due.to_me` list only major ones, and `no_due.minor` counts the undated minor ones per side; overdue and due-today lists keep both sizes, each tagged. In `context.strata`, an undated minor commitment never needs Wassim: a minor one needs him only when it is dated and overdue or due on the date, or back from a snooze. Home folds a cell's minor commitments into a collapsed "Small follow-ups (n)" group after everything else.
