# Bousleh

Bousleh (بوصلة, "compass") is Wassim's personal operating system for product leadership. This file is for any agent or person working in this repo. The source of truth for scope is the Claude Doc "Bousleh: Mental Model and Scope" (main tab plus "Build plan"). If this file and that doc disagree, or something is unclear, ask Wassim before deciding.

## What it is

- **One engine (code), two vaults (data), two doors (Claude accounts).** The personal instance runs on Wassim's personal Mac. The work instance (Alethea, from Nov 9, 2026) runs the same build on the work Mac with its own separate vault. Work data never touches the personal side.
- **MCP first.** Claude reaches everything through one local MCP server over stdio. There is no custom UI: Claude's own artifact types (Docs, Slides, Dashboard, Whiteboard, Tasks, Design, Claude pages) are the surfaces.

## Core rules

1. **Claude supplies the judgment, the engine does the mechanics.** Filing, moving, deduplicating, history and scoring are code. Deciding what a dump means is Claude, through the MCP tools.
2. **Every action is an op.** One ops registry (`packages/contracts`) holds every action as a named op with typed zod input and output schemas. Everything runs through a single `runOp(name, input, ctx)` (`packages/engine`). Nothing writes to the vault except op handlers. The MCP server is generated from the registry, and any later door (UI, HTTP API, CLI, scheduled runs) calls the same ops, so a new door never means new logic. The pattern follows Perfect Placement (`askoulwassim/perfect-placement`: `packages/contracts`, `packages/engine/ops`, `packages/mcp`).
3. **Nothing is overwritten.** History uses "supersedes" links.
4. **The vault never enters this repo.** Vault data lives in `~/.bousleh` (or `BOUSLEH_HOME`), local only, never committed, never pushed anywhere, and not a git repo.

### Adding an op

1. Define it in `packages/contracts/src/ops/registry.ts` with `defineOp` (dotted name such as `vault.search`, description, zod `input` and `output`, `readOnly` if it writes nothing) and add it to `OPS`.
2. Write the handler with `defineHandler` in the module package that owns it (`vault`, `capture`, `context`, `metrics`, `horizon`, or `engine` for `system.*`) and export it in that package's `handlers` list.
3. That's all. The engine refuses to start if an op has no handler. The MCP tool appears automatically (the tool name is the op name with dots as underscores: `vault.search` is `vault_search`). Never add per-op code to `packages/mcp-server`.

## Layout

```
bousleh.nosync/              this repo (private GitHub: askoulwassim/bousleh)
  AGENTS.md
  packages/
    contracts/               typed schemas and the ops registry
    engine/                  composes handlers, exports runOp (system.* handlers live here)
    vault/                   schema, storage, history; the handler contract
    capture/                 inbox handling, deposit mechanics (feedback patterns live here for v0)
    context/                 the brief: links, search, altitude
    metrics/                 registry and readings
    horizon/                 watch lists, filing scan results
    mcp-server/              tools generated from the ops registry
  plugin/
    skills/                  capture, pulse, counsel, shape, workshop, communicate, coach, horizon
  home/                      Home page source, after the design session (no Home code before it)
```

Dependencies only point down: `contracts` ← `vault` ← `capture` / `context` / `metrics` / `horizon` ← `engine` ← `mcp-server`.

```
~/.bousleh/                  data (local only, never pushed, no git)
  vault.db                   objects, links, versions, scopes, metrics
  anchors/ evidence/ work/ people/ moments/
                             long-form markdown, one file per object id
  inbox/                     raw input; filed files move to inbox/processed
```

## Decided

| Area | Choice |
| --- | --- |
| Code | Private TypeScript monorepo `bousleh` in Wassim's personal GitHub (askoulwassim), one package per module, AGENTS.md (no CLAUDE.md) |
| Repo location | `~/Documents/Claude/Projects/Bousleh/bousleh.nosync/` (the `.nosync` name keeps node_modules and build output out of iCloud) |
| Toolchain | Mirrors Perfect Placement: pnpm workspaces, TypeScript, Biome, Vitest, zod 4, better-sqlite3, `@modelcontextprotocol/sdk`, Node 22 |
| Storage | SQLite for structure, markdown for long-form, linked by id |
| History | "Supersedes" links; nothing is overwritten |
| Vault home | `~/.bousleh`, outside the code repo, never committed, local only, never pushed anywhere, no git |
| Host | Personal Mac; the work Mac runs the same build later |
| MCP transport | stdio, local only, no tunnel |
| Actions | One ops registry; every action is a typed op through `runOp`; MCP tools generated from it; tool names use underscores, op names stay dotted (MCP clients mishandle dots) |
| Search v0 | SQLite full-text search plus links; no embeddings. Graphiti is the next step later, not vectors |
| Modes | Eight skills in one Claude plugin: Capture, Pulse, Counsel, Shape, Workshop, Communicate, Coach, Horizon |
| Phone capture | Claude app dictation into a Google Drive folder named "Bousleh Inbox", one file per capture, never appended |
| Inbox processing | A daily scheduled task on the Mac plus on demand from any session; silent, in the background. Each file logged by content hash in SQLite, skipped if already seen, then moved to `inbox/processed` |
| Horizon scan | A daily Claude scheduled task in the cloud, web search, writes findings to the Drive inbox. Podcasts: show notes, plus a transcript only when the show publishes one; no transcription |
| Voice | Dictation in Claude, plus meeting transcripts handed to Capture. No Voicebox, no messaging gateway |
| Home | A Claude page. No Home code before a Claude Design session exists. Live engine data in the Claude desktop app, a daily snapshot elsewhere |
| Later | Graphiti, the signal bridge between accounts, live phone access, open-sourcing |

## Run and test

```sh
pnpm install
pnpm build        # tsc for every package (packages resolve each other through dist)
pnpm typecheck    # includes test files; run after build
pnpm test         # vitest in every package; run after build
pnpm lint         # biome check (pnpm format to fix formatting)
```

Before opening a pull request: `pnpm build && pnpm typecheck && pnpm lint && pnpm test` all pass.

The MCP server runs with `node packages/mcp-server/dist/bin.js` (stdio; logs go to stderr only). It reads the vault at `--home <dir>`, else `BOUSLEH_HOME`, else `~/.bousleh`. Tests always use a temporary home, never the real vault.

## Workflow

- Every change goes on a branch and opens a pull request. Wassim tests locally and merges. Agents do not merge.
- Changes to `packages/contracts` update schemas, tests and docs together in the same pull request.
- Propose new tooling or infrastructure; do not build it unasked.
