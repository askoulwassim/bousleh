# Bousleh

Bousleh (بوصلة, "compass") is a personal operating system for product leadership, on Claude. This file is for any agent working in this repo: the owner's own Claude sessions, and agents working in a fork. If something here is unclear, ask the person you are working for before deciding.

## What it is

- **One engine (code), one set of data per instance, one door per instance (a Claude account).** Each Mac that runs Bousleh has its own data in `~/.bousleh`. A second instance, such as a work Mac with its own Claude account, runs the same build with its own separate data. Data never crosses between instances.
- **MCP first.** Claude reaches everything through one local MCP server over stdio. There is no custom UI: Claude's own artifact types (Docs, Slides, Dashboard, Design, Claude pages, and Whiteboard or Tasks where the account has them) are the surfaces. Where an account has no Whiteboard or Tasks type, what would go on a whiteboard goes in a tab of the scope's Claude Doc.

## Two core rules

1. **Claude supplies the judgment, the engine does the mechanics.** Filing, moving, deduplicating, history and scoring are code. Deciding what a dump means is Claude, through the MCP tools.
2. **Every action is an op.** `contracts` defines every op: a dotted name plus typed zod input and output schemas. Each domain package owns the handlers for its ops. `engine` opens your data, registers every handler, and runs `runOp(name, input, ctx)` with schema checks. Nothing writes to your data except op handlers called through `runOp`. The MCP server is generated from the registry. Any later door (a UI, an HTTP API, a CLI, scheduled runs) calls the same ops, so a new door never means new logic.

Two more rules follow from these. **Nothing is overwritten:** history uses "supersedes" links. **Your data never enters this repo:** it lives in `~/.bousleh` (or `BOUSLEH_HOME`), local only, never committed, never pushed, not a git repo. The MCP server snapshots it once a day to `~/.bousleh-backups` on the same disk (newest 14 kept; `vault.backup` takes one on demand). That guards against a bad op, a bug or a slip, not a lost disk; Time Machine is optional.

The design choices behind all this, and why, are in `docs/decisions.md`.

## Naming

- Packages are lowercase nouns: `intake`, `watch`.
- Skills are one capitalised word: Capture, Horizon.
- Scheduled tasks are named in plain words with their rhythm: "Hourly inbox sweep", "Weekly Horizon scan".
- The data is "your data" or `~/.bousleh`, never just "vault". The `vault` package, `vault.db` and `vault.*` ops keep their names, since they're code.
- Op names are dotted (`inbox.sweep`). MCP tool names are the same with underscores (`inbox_sweep`), because MCP clients mishandle dots.

`intake` and `watch` were renamed from `capture` and `horizon` so that Capture and Horizon only ever mean the skills.

## Packages and the ops they own

| Package | Owns | Op namespaces | Depends on |
| --- | --- | --- | --- |
| contracts | Object kinds, layers, altitude, scope; every op's name and schemas | none (definitions only) | nothing |
| vault | Storage, migrations, history, typed objects, scopes, assets, people | `vault.*` (health, get, search, supersede, link, unlink, backup, activity), `deposits.*` (write), `scopes.*` (list, add, move, rename), `commitments.*` (list, close, snooze), `people.*` (get, list), `assets.*` (add, list) | contracts |
| intake | Inbox files, Drive sweep, content-hash dedupe, the ambiguity queue, feedback patterns for v0 | `inbox.*` (drop, list, take, sweep, settle), `queue.*` (add, list, resolve), `signals.*` (patterns) | contracts, vault |
| context | The brief at a given altitude, Home's strata (every scope at every altitude in one call), and Pulse's daily picture | `context.*` (brief, strata), `pulse.*` (today) | contracts, vault, metrics, watch |
| metrics | The registry, its lifecycle and readings | `metrics.*` (upsert, reading, list, history) | contracts, vault |
| watch | Watch lists per scope, applying a scan's proposed changes, filing scan findings, the digest | `watchlists.*` (get, set, apply), `watch.*` (file, digest) | contracts, vault |
| engine | Opens `~/.bousleh`, registers every handler, `runOp` with schema checks | none of its own | every package above |
| mcp-server | One MCP tool per op, generated; no logic of its own | none | engine |
| home | The Home page: one self-contained HTML file (`dist/home.html`) published as a Claude page; reads ops through the MCP server, no engine logic of its own | none (calls ops through MCP) | contracts (types only) |

Only `vault` and `intake` touch your data on disk directly. Every package imports `contracts`, and `contracts` imports nothing. `home` never imports the engine: it runs in Claude and reaches the engine only through the MCP server, like any other door.

### Which skill calls which ops

| Skill | Reads | Writes | Hands off to |
| --- | --- | --- | --- |
| Capture | `inbox.list`, `inbox.take`, `vault.search`, `signals.patterns` (to reuse signal tags), `commitments.list` (open commitments a new one repeats or a meeting resolved); the Google Drive connector for "Bousleh Inbox" (phone captures, Horizon scans, Meet notes) | `inbox.drop`, `inbox.settle`, `deposits.write` (a follow-up snoozed from the start gets `surface_on`), `queue.add`, `queue.resolve`, `vault.link`, `assets.add`; `vault.supersede` only to mark a planned meeting held, add a person's email, or give a person filed by first name their full name; `commitments.close` (`done` only) for a commitment a filed meeting plainly delivered; in "Bousleh: set me up" only, `people.list`, `scopes.add`, `deposits.write` for the user and a first strategy per scope, and `watchlists.set` through Horizon's flows | Horizon (starter watch lists) |
| Drop (phone) | nothing | a new `.md` file in "Bousleh Inbox", through the Google Drive connector | Capture |
| Pulse | `pulse.today`, `commitments.list`, `metrics.list`, `metrics.history`, `scopes.list` (empty data: it suggests "Bousleh: set me up"); the Google Calendar connector for today's events | `commitments.close`, `commitments.snooze`; `vault.supersede` or `deposits.write` once, to mark the user; `vault.supersede` to add an email to a person, on the user's yes, to set an open commitment's `due`, or to change its `size` when the user says it is bigger or smaller | Home |
| Counsel | `context.brief`, `people.get`; the Google Calendar connector for the meeting's event | `deposits.write` | nothing |
| Shape | `context.brief`, `metrics.list`, `signals.patterns` | `deposits.write`, `vault.supersede`, `metrics.upsert`, `vault.link`, `assets.add` | Docs |
| Workshop | `context.brief`, `metrics.list`, `signals.patterns` | `deposits.write`, `vault.link`, `assets.add` | Whiteboard where the account has it, else a tab in the scope's Claude Doc; a POC plugin, when one is installed |
| Communicate | `context.brief`; `vault.get` for the Product Weekly rules (a decision) | `assets.add` | Docs, Slides |
| Coach | `people.list`, `people.get`, `context.brief` | `deposits.write`, `assets.add` | Docs |
| Tune | `vault.activity`, `vault.health`, `context.strata`, `people.list`, `commitments.list`, `queue.list`, `inbox.list`, `assets.list`, `vault.search`, `vault.get` | `vault.unlink`, `commitments.close` (`dropped` only), `queue.add`, each within its fix rules; runs only `scripts/setup-mac.sh --check` in the repo folder, read-only. Never changes the repo: no file edits, no git, gh or pnpm, no pull requests or issues | Capture, Shape (through the queue) |
| Horizon | `watchlists.get`, `watch.digest`, `queue.list` | `watchlists.set`, `watchlists.apply`, `watch.file`, `queue.resolve` (removals it queued), `vault.link`, `assets.add`; `Bousleh Watch Lists.md` in the Drive folder "Bousleh", through the Google Drive connector | Home, Docs |

The calendar is the source for the user's schedule: Pulse and Counsel read it through the Google Calendar connector, match attendees to people by their `emails` attr (else by name), and Bousleh keeps only meetings with prep or notes (a planned meeting is Counsel's prep, a held one the debrief). Every Doc, deck, whiteboard, design, dashboard or page a mode creates or updates is registered with `assets.add` right away, linked with `documents` to the objects it is about, so `context.brief` can list it. Home (`packages/home`, published per `docs/home.md`) reads `context.strata`, `pulse.today`, `watch.digest`, `watchlists.get`, `queue.list`, `commitments.list` and `assets.list` through the MCP server, plus today's events from the Google Calendar connector. Where things happen is a rule: it does the work itself when it is one op on a press, a read-only answer or a fixed run on this Mac, and opens Claude (a new chat with the prompt typed in, never sent) for anything that makes a Claude output, needs a connector or the web, or writes on Claude's judgment. Its writes, live only and each one op on a press: `vault.supersede` on a finding (Save: `to_read`, Skip: `dismissed`); on a commitment, `commitments.close` (Done; Close is `dropped`), `vault.supersede` setting `due` (Date) and `commitments.snooze` (Snooze), each with an Undo that calls the reverse op (`vault.supersede` status `open`, the old `due`, `commitments.snooze` until `null`); `inbox.drop` for a capture (Undo: `inbox.settle` `skipped`). Ask answers read-only questions in Home with the `sample` capability, passing Claude only read ops (`pulse.today`, `commitments.list`, `context.brief`, `context.strata`, `watch.digest`, `vault.search`, `people.get`). Installed as a Claude app with full access, it runs Tune (`claude -p` on the repo) and `scripts/setup-mac.sh` on this Mac and reads `vault.health`; without that, every Claude-bound button copies its prompt. The Hourly inbox sweep runs the Capture skill on the Mac: Drive captures come in through the Google Drive connector and `inbox.drop`, then the inbox is filed. The Weekly Horizon scan runs in the cloud and can't reach the Mac: it reads the watch lists from `Bousleh Watch Lists.md` in the Drive folder "Bousleh" (which Horizon rewrites after every watch list change, and the Hourly inbox sweep after it files a scan) and only writes files to the Drive inbox. Each scan file proposes watch list changes; filing it on the Mac runs `watchlists.apply`, which applies the scan's adds, removes only entries the scan added, and queues any removal of the user's own entries for them (the rule is in the op, not only the skill).

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
<repo>/                      this repo (clone it anywhere; SETUP.md has a tip for iCloud)
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
    home/                    the Home page (dist/home.html, a Claude page; docs/home.md)
  plugin/
    skills/                  capture, pulse, counsel, shape, workshop, communicate, coach, horizon, tune; drop
  docs/                      decisions.md, scheduled-tasks.md, home.md, move.md, finish-setup.md
  docs/design/               design notes; docs/design/home/ holds the Claude Design boards for Home
```

```
~/.bousleh/                  your data (local only, never pushed, no git)
  vault.db                   objects, links, versions, scopes, metrics
  anchors/ evidence/ work/ people/ moments/
                             long-form markdown, one file per object id
  inbox/                     raw input; filed files move to inbox/processed
```

## Set up a Mac

`scripts/setup-mac.sh` does the whole setup (build, MCP server in Claude Desktop and Claude Code, the plugin in Claude Code, a health check); `--check` reports what is already set up without changing anything; `--demo` registers the demo data (`~/.bousleh-demo`, seeded by `pnpm demo`) as a second server, `bousleh-demo`, and `--demo --remove` takes it out, never touching the `bousleh` entry. The Claude account gets the plugin from this repo as a marketplace (`.claude-plugin/marketplace.json`). It ends by opening Claude's Code tab with "Finish setting up Bousleh from docs/finish-setup.md." typed in, which publishes Home and creates or updates the scheduled tasks from `node scripts/scheduled-tasks.mjs` (the JSON form of `docs/scheduled-tasks.md`, applied literally). SETUP.md has the ten-minute walkthrough. Rerun the script after `git pull`; it never registers anything twice.

## Run and test

```sh
pnpm install
pnpm build        # tsc for every package (packages resolve each other through dist); esbuild for Home
pnpm typecheck    # includes test files; run after build
pnpm test         # vitest in every package; run after build
pnpm lint         # biome check (pnpm format to fix formatting)
```

Before opening a pull request, `pnpm build && pnpm typecheck && pnpm lint && pnpm test` must all pass, from a fresh clone when the change touches `.gitignore` or package layout.

The MCP server runs with `node packages/mcp-server/dist/bin.js` (stdio; logs go to stderr only). It reads your data at `--home <dir>`, else `BOUSLEH_HOME`, else `~/.bousleh`. Tests always use a temporary home, never your real data. Fixtures, examples and docs use a fictional cast (Alex Rivera, Northwind, the Harbor and Atlas scopes, `.example` addresses), never real people or companies. The demo data is that cast: `packages/home/preview/demo-data.mjs`, written through the ops by `pnpm demo` (to `~/.bousleh-demo`, never your data) and by the Home preview (to a throwaway home). `pnpm demo:home` serves Home on it at http://localhost:4173.

## Workflow

- Every change goes on a branch and opens a pull request, on your own clone or fork. The owner tests locally and merges. Agents do not merge; the owner merges.
- Changes to `packages/contracts` update schemas, tests and docs together in the same pull request.
- Propose new tooling or infrastructure; do not build it unasked.
