# Changelog

All notable changes are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## 0.2.0 (2026-11-27)

The first public release. Home becomes an installable Claude app, and the repo is ready for anyone to clone and run with their own data.

### Added
- **Home as a Claude app.** Install it from Home's footer: its own window, a Dock icon with the needs-you count, a menu bar item and a Capture shortcut (⌥⇧B). A first-launch screen asks for each permission (full access, menu bar, shortcut); every one is optional. No notifications.
- **Where work happens is a rule, not a setting.** Home acts itself for one op on a press, a read-only answer or a fixed run on this Mac, and opens Claude for everything else, with the prompt typed in and never sent. Every launcher is tagged Here, In Claude, On this Mac or Copy. Without the app or without full access, every Claude-bound button copies its prompt.
- **Commitment actions** in First: Done, Date, Snooze and Close, with a second press for Done and Close, and Undo for 5 seconds.
- **Ask** in the rail: read-only questions answered with Claude on your own account, using only Bousleh's read tools.
- **Capture** panel: dictation where offered, a box to type in otherwise, sent to the inbox with Undo, or filed now in a chat.
- **One setup path:** `scripts/setup-mac.sh` ends by opening Claude's Code tab with "Finish setting up Bousleh from docs/finish-setup.md." typed in, which publishes Home and creates or updates all four scheduled tasks from `node scripts/scheduled-tasks.mjs` (their exact names, crons and prompts as JSON), the same way every time. Rerunning the script after `git pull` brings everything back in line. Health's Finish setup opens the same step.
- **Tune and Health** run on this Mac and stream into the side panel. `scripts/setup-mac.sh` writes `~/.bousleh/app.json` so Home can find the repo. macOS guards Documents, Desktop, Downloads and iCloud Drive per app, so Home can't run them in a clone there: both say so, and `docs/move.md` moves a clone out, data untouched.
- **Demo data:** `pnpm demo` seeds `~/.bousleh-demo` with a fictional cast, `pnpm demo:home` shows Home on it at http://localhost:4173, and `scripts/setup-mac.sh --demo` adds it to Claude as the `bousleh-demo` server (`--demo --remove` takes it out).
- **First run:** "Bousleh: set me up" in Capture files who you are, your first scopes with a line of strategy each, and a starter watch list per scope. Pulse suggests it when your data is empty.
- README, brand assets (`docs/assets/`: logos, social preview, screenshots and a GIF of Home), THIRD_PARTY_NOTICES.md, `docs/decisions.md`.
- Open-source files: MIT license, CONTRIBUTING (issues welcome; pull requests only from the owner, closed automatically otherwise), Code of Conduct, SECURITY (private reporting and the threat model), issue forms, Dependabot.
- CI on every push and pull request: build, typecheck, lint and test on macOS; a fresh-install smoke test of the MCP server; and a personal-data check against a private denylist. Every action is pinned to a commit.

### Changed
- Skills, docs, design boards and test fixtures speak to "you" and use a fictional cast; the repo holds no personal or employer data.
- Watch list entries record `added_by` as `user` or `horizon`. Data written by 0.1 reads back correctly and is stored as `user` on the next write.
- Workshop hands a POC to a POC plugin only when one is installed, and offers a brief in the conversation otherwise.
- Tune and the Friday tune-up open pull requests on your own clone or fork, never upstream.
- Home's fonts are self-hosted: inlined from the `@fontsource` packages, so opening Home pings nobody.
- Clone the repo anywhere: the `.nosync` name is now a tip for iCloud folders, not a step.
- Dependencies: Biome 2.6.9, esbuild 0.28.2.

### Security
- Your data is readable only by your account: `~/.bousleh`, `~/.bousleh-backups` and everything under them are created `0700` (folders) and `0600` (files), including `vault.db` and its `-wal` and `-shm` files. A data home that lets other accounts in is tightened when it is opened.
- `pnpm audit` is clean (hono 4.13.23, @hono/node-server 2.1.11).
- Skills treat captured and fetched text as data, never as instructions.
- Home builds every Claude link itself and checks it against a strict pattern before it reaches a shell; your data only fills the encoded prompt. Home only ever runs its fixed commands.

## 0.1.0 (2026-11-27)

Private baseline. Tagged before the open-source work.
