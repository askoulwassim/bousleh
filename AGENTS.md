# Bousleh

Bousleh (بوصلة, "compass") is Wassim's personal operating system for product leadership. This file is for any agent or person working in this repo.

**Source of truth:** the Claude Doc "Bousleh: Mental Model and Scope". The main tab covers scope, the "Build plan" tab the stages, and the **"Package map" tab the packages, the ops each one owns, and which skill calls which ops**. The tables below mirror that doc as of Oct 24, 2026. If this file and the doc disagree, or something is unclear, ask Wassim before deciding.

## What it is

- **One engine (code), two sets of data, two doors (Claude accounts).** The personal instance runs on Wassim's personal Mac. The work instance (Alethea, from Nov 9, 2026) runs the same build on the work Mac with its own separate data. Work data never touches the personal side.
- **MCP first.** Claude reaches everything through one local MCP server over stdio. There is no custom UI: Claude's own artifact types (Docs, Slides, Dashboard, Design, Claude pages, and Whiteboard or Tasks where the account has them) are the surfaces. Oct 25: the personal account has no Whiteboard or Tasks type, so what would go on a whiteboard goes in a tab of the scope's Claude Doc.

## Two core rules (both from Perfect Placement)

1. **Claude supplies the judgment, the engine does the mechanics.** Filing, moving, deduplicating, history and scoring are code. Deciding what a dump means is Claude, through the MCP tools.
2. **Every action is an op.** `contracts` defines every op: a dotted name plus typed zod input and output schemas. Each domain package owns the handlers for its ops. `engine` opens your data, registers every handler, and runs `runOp(name, input, ctx)` with schema checks. Nothing writes to your data except op handlers called through `runOp`. The MCP server is generated from the registry. Any later door (a UI, an HTTP API, a CLI, scheduled runs) calls the same ops, so a new door never means new logic.

Perfect Placement (`askoulwassim/perfect-placement`) is the reference: `packages/contracts` for the registry, `packages/engine` for `runOp` and handlers, `packages/mcp` generated from ops.

Two more rules follow from these. **Nothing is overwritten:** history uses "supersedes" links. **Your data never enters this repo:** it lives in `~/.bousleh` (or `BOUSLEH_HOME`), local only, never committed, never pushed, not a git repo. The MCP server snapshots it once a day to `~/.bousleh-backups` on the same disk (newest 14 kept; `vault.backup` takes one on demand). That guards against a bad op, a bug or a slip, not a lost disk; Time Machine is optional.

## Naming

- Packages are lowercase nouns: `intake`, `watch`.
- Skills are one capitalised word: Capture, Horizon.
- Scheduled tasks are named in plain words with their rhythm: "Hourly inbox sweep", "Weekly Horizon scan".
- The data is "your data" or `~/.bousleh`, never just "vault". The `vault` package, `vault.db` and `vault.*` ops keep their names, since they're code.
- Op names are dotted (`inbox.sweep`). MCP tool names are the same with underscores (`inbox_sweep`), because MCP clients mishandle dots.

`intake` and `watch` were renamed from `capture` and `horizon` so that Capture and Horizon only ever mean the skills.

## Packages and the ops they own

Op names are provisional; the "Package map" tab is the source of truth.

| Package | Owns | Op namespaces | Depends on |
| --- | --- | --- | --- |
| contracts | Object kinds, layers, altitude, scope; every op's name and schemas | none (definitions only) | nothing |
| vault | Storage, migrations, history, typed objects, scopes, assets, people | `vault.*` (health, get, search, supersede, link, unlink), `deposits.*` (write), `scopes.*` (list, add), `commitments.*` (list, close), `people.*` (get, list), `assets.*` (add, list) | contracts |
| intake | Inbox files, Drive sweep, content-hash dedupe, the ambiguity queue, feedback patterns for v0 | `inbox.*` (drop, list, take, sweep, settle), `queue.*` (add, list, resolve), `signals.*` (patterns) | contracts, vault |
| context | The brief at a given altitude, Home's strata (every scope at every altitude in one call), and Pulse's daily picture | `context.*` (brief, strata), `pulse.*` (today) | contracts, vault, metrics, watch |
| metrics | The registry, its lifecycle and readings | `metrics.*` (upsert, reading, list, history) | contracts, vault |
| watch | Watch lists per scope, applying a scan's proposed changes, filing scan findings, the digest | `watchlists.*` (get, set, apply), `watch.*` (file, digest) | contracts, vault |
| engine | Opens `~/.bousleh`, registers every handler, `runOp` with schema checks | none of its own | every package above |
| mcp-server | One MCP tool per op, generated; no logic of its own | none | engine |

Only `vault` and `intake` touch your data on disk directly. Every package imports `contracts`, and `contracts` imports nothing.

### Which skill calls which ops

| Skill | Reads | Writes | Hands off to |
| --- | --- | --- | --- |
| Capture | `inbox.list`, `inbox.take`, `vault.search`, `signals.patterns` (to reuse signal tags); the Google Drive connector for "Bousleh Inbox" | `inbox.drop`, `inbox.settle`, `deposits.write`, `queue.add`, `queue.resolve`, `vault.link`, `assets.add` | nothing |
| Drop (phone) | nothing | a new `.md` file in "Bousleh Inbox", through the Google Drive connector | Capture |
| Pulse | `pulse.today`, `commitments.list`, `metrics.list`, `metrics.history`; the Google Calendar connector for today's events | `commitments.close`; `vault.supersede` or `deposits.write` once, to mark the user; `vault.supersede` to add an email to a person, on Wassim's yes | Home |
| Counsel | `context.brief`, `people.get`; the Google Calendar connector for the meeting's event | `deposits.write` | nothing |
| Shape | `context.brief`, `metrics.list`, `signals.patterns` | `deposits.write`, `vault.supersede`, `metrics.upsert`, `vault.link`, `assets.add` | Docs |
| Workshop | `context.brief`, `metrics.list`, `signals.patterns` | `deposits.write`, `vault.link`, `assets.add` | Whiteboard where the account has it, else a tab in the scope's Claude Doc; Specdr POC lane |
| Communicate | `context.brief` | `assets.add` | Docs, Slides |
| Coach | `people.list`, `people.get`, `context.brief` | `deposits.write`, `assets.add` | Docs |
| Horizon | `watchlists.get`, `watch.digest`, `queue.list` | `watchlists.set`, `watchlists.apply`, `watch.file`, `queue.resolve` (removals it queued), `vault.link`, `assets.add`; `Bousleh Watch Lists.md` in the Drive folder "Bousleh", through the Google Drive connector | Home, Docs |

The calendar is the source for Wassim's schedule: Pulse and Counsel read it through the Google Calendar connector, match attendees to people by their `emails` attr (else by name), and Bousleh keeps only meetings with prep or notes (a planned meeting is Counsel's prep, a held one the debrief). Every Doc, deck, whiteboard, design, dashboard or page a mode creates or updates is registered with `assets.add` right away, linked with `documents` to the objects it is about, so `context.brief` can list it. Home reads `pulse.today`, `commitments.list` and `watch.digest`, and writes nothing. The Hourly inbox sweep runs the Capture skill on the Mac: Drive captures come in through the Google Drive connector and `inbox.drop`, then the inbox is filed. The Weekly Horizon scan runs in the cloud and can't reach the Mac: it reads the watch lists from `Bousleh Watch Lists.md` in the Drive folder "Bousleh" (which Horizon rewrites after every watch list change, and the Hourly inbox sweep after it files a scan) and only writes files to the Drive inbox. Each scan file proposes watch list changes; filing it on the Mac runs `watchlists.apply`, which applies the scan's adds, removes only entries the scan added, and queues any removal of Wassim's own entries for him (the rule is in the op, not only the skill).

### Adding an op

1. Define it with `defineOp` in its namespace's file, `packages/contracts/src/ops/<namespace>.ts`, and add it to that file's ops object (`vaultOps`, `depositOps`, …). A new namespace gets a new file and one spread line in `ops/registry.ts`. An op needs a dotted name in its package's namespace, a description written for the model that calls it, zod `input` and `output`, and `readOnly` if it writes nothing. Reuse the shared shapes in `ops/shapes.ts` and the object model in `contracts/src/model/` (kinds, layers, altitude, link kinds).
2. Write the handler with `defineHandler` in the package that owns that namespace (`vault`, `intake`, `context`, `metrics` or `watch`; never `engine` or `mcp-server`), and add it to that package's exported `handlers` list. Handlers reach your data only through `h.store`; to use another package's op, call `h.runOp`, which joins the caller's transaction.
3. That's all. The engine refuses to start if an op has no handler, and the MCP tool appears automatically. Never add per-op code to `packages/mcp-server`; a test fails if an op name shows up there.

### How writes work

- Every op that isn't `readOnly` runs in one SQLite transaction that holds the write lock (so a second Bousleh process waits). Files are written through `h.store.stagedFiles` while it's held and undone on rollback, so a failed op leaves no rows and no files. A nested `h.runOp` write runs in a SAVEPOINT: if it fails, its rows and files are undone even if your handler carries on.
- Top-level calls run one at a time. Every top-level write, ok or failed, lands in `op_log`.
- A `readOnly` op gets a store that refuses writes, including through `h.runOp` and raw SQL (`query_only`). Tables are append-only by trigger.
- Don't call `h.runOp` after your handler returns; it's refused.
- Kind rules (statuses, attrs, the bet rules) live in `contracts` (`checkKindFields`), link rules too (`checkLink`); the store enforces both, so every door gets the same answers.

## Layout

```
bousleh.nosync/              this repo (private GitHub: askoulwassim/bousleh)
  AGENTS.md
  packages/
    contracts/               typed schemas and the ops registry
    vault/                   schema, storage, history
    intake/                  inbox, Drive sweep, dedupe, the queue
    context/                 the brief: links, search, altitude
    metrics/                 registry and readings
    watch/                   watch lists, filing scan results
    engine/                  opens your data, registers handlers, runs ops
    mcp-server/              tools generated from the ops registry
  plugin/
    skills/                  capture, pulse, counsel, shape, workshop, communicate, coach, horizon
  home/                      Home page source, after the design session (no Home code before it)
  docs/design/               design notes
```

```
~/.bousleh/                  your data (local only, never pushed, no git)
  vault.db                   objects, links, versions, scopes, metrics
  anchors/ evidence/ work/ people/ moments/
                             long-form markdown, one file per object id
  inbox/                     raw input; filed files move to inbox/processed
```

## Decided

| Area | Choice |
| --- | --- |
| Code | Private TypeScript monorepo `bousleh` in Wassim's personal GitHub (askoulwassim), one package per module, AGENTS.md (no CLAUDE.md) |
| Repo location | `~/Documents/Claude/Projects/Bousleh/bousleh.nosync/` (Documents syncs to iCloud; the `.nosync` folder name keeps node_modules and build output out of iCloud) |
| Toolchain | Mirrors Perfect Placement: pnpm workspaces, TypeScript, Biome, Vitest, zod 4, better-sqlite3, `@modelcontextprotocol/sdk`, Node 22 |
| Storage | SQLite for structure, markdown for long-form, linked by id |
| History | "Supersedes" links; nothing is overwritten |
| Data home | `~/.bousleh`, outside the code repo, never committed, local only, never pushed anywhere, no git |
| Host | Personal Mac; the work Mac runs the same build later |
| MCP transport | stdio, local only, no tunnel |
| Actions | One ops registry (core rule 2). Op names are dotted (`inbox.sweep`); MCP tool names are the same with underscores (`inbox_sweep`) |
| Packages | `contracts`, `vault`, `intake`, `context`, `metrics`, `watch`, `engine`, `mcp-server` (see the package table) |
| Search v0 | SQLite full-text search plus links; no embeddings. Graphiti is the next step later, not vectors |
| Modes | Eight skills in one Claude plugin: Capture, Pulse, Counsel, Shape, Workshop, Communicate, Coach, Horizon |
| Phone capture | The Drop skill in the Claude app saves each dictation as a new `.md` file in the Google Drive folder "Bousleh Inbox" (one file per capture, never appended), through the Claude account's Google Drive connector. On the Mac, Capture reads the folder through the same connector, hands each file to `inbox.drop`, then trashes it in Drive (moved, not copied). No Google Drive desktop app and no Full Disk Access (Oct 25: macOS blocks other apps from the synced Drive folder). The engine never calls Google itself |
| Inbox processing | The Hourly inbox sweep (a scheduled task that runs Capture) plus on demand from any session; silent, in the background. Each file is logged by content hash in SQLite, skipped if already seen, then moved to `inbox/processed` |
| Backups | Daily snapshot to `~/.bousleh-backups` on the same disk, newest 14 kept, taken by the MCP server; `vault.backup` on demand. Restore: quit Claude, move `~/.bousleh` aside, copy a snapshot folder into its place |
| Setup | `scripts/setup-mac.sh` sets up a Mac end to end (see SETUP.md); the work Mac runs the same script |
| Scheduled tasks | Defined only in `docs/scheduled-tasks.md` (each task's place, schedule, needs and exact prompt). In Claude Desktop's Code tab on the repo, "Set up the scheduled tasks in docs/scheduled-tasks.md" creates or updates them; nobody sets one up by hand. Claude Desktop keeps a task's schedule outside any file a script could write, and headless `claude -p` can't reach claude.ai connectors, so a script can't do this step. The Hourly inbox sweep needs the Mac and runs hourly from 07:00 to 22:00 (a run that can't reach the Mac ends at once; captures wait in Drive); the Weekly Horizon scan runs in the cloud on Mondays at 06:40 |
| Horizon scan | The Weekly Horizon scan (daily until Oct 25: too noisy), a Claude scheduled task in the cloud: web search over the last seven days, findings and proposed watch list changes written to the Drive inbox. Watch lists reach it through `Bousleh Watch Lists.md` in the Drive folder "Bousleh", not its prompt. Podcasts: show notes, plus a transcript only when the show publishes one; no transcription |
| Voice | Dictation in Claude, plus meeting transcripts handed to Capture. No Voicebox, no messaging gateway |
| Home | A Claude page. No Home code before a Claude Design session exists. Live engine data in the Claude desktop app, a daily snapshot elsewhere |
| Later | Graphiti, the signal bridge between accounts, live phone access, open-sourcing |

## Set up a Mac

`scripts/setup-mac.sh` does the whole setup (build, MCP server in Claude Desktop and Claude Code, the plugin in Claude Code, a health check); `--check` reports what is already set up without changing anything. The Claude account gets the plugin from this repo as a marketplace (`.claude-plugin/marketplace.json`). SETUP.md has the ten-minute walkthrough. Rerun the script after `git pull`; it never registers anything twice.

## Run and test

```sh
pnpm install
pnpm build        # tsc for every package (packages resolve each other through dist)
pnpm typecheck    # includes test files; run after build
pnpm test         # vitest in every package; run after build
pnpm lint         # biome check (pnpm format to fix formatting)
```

Before opening a pull request, `pnpm build && pnpm typecheck && pnpm lint && pnpm test` must all pass, from a fresh clone when the change touches `.gitignore` or package layout.

The MCP server runs with `node packages/mcp-server/dist/bin.js` (stdio; logs go to stderr only). It reads your data at `--home <dir>`, else `BOUSLEH_HOME`, else `~/.bousleh`. Tests always use a temporary home, never your real data.

## Workflow

- Every change goes on a branch and opens a pull request. Wassim tests locally and merges. Agents do not merge.
- Changes to `packages/contracts` update schemas, tests and docs together in the same pull request.
- Propose new tooling or infrastructure; do not build it unasked.
