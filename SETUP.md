# Set up Bousleh on a Mac

About ten minutes, on the personal Mac or the work Mac alike. Each Mac gets its own data in `~/.bousleh`; nothing is shared between them.

## You need

- Node 22 or newer (`brew install node@22`) and git. pnpm comes through `corepack enable`, or the script installs it.
- Claude Desktop, signed in to the Claude account this Mac belongs to (personal or work), on a paid plan (the README's Requirements say which).
- Claude Code, optional but recommended (`claude` on the PATH).
- Google Drive and Google Calendar connected to that Claude account (in Claude's Settings, under Connectors). No Google Drive desktop app is needed.

Want to look first? `pnpm install && pnpm demo` seeds fictional demo data in `~/.bousleh-demo`, `pnpm demo:home` shows Home on it at http://localhost:4173, and `scripts/setup-mac.sh --demo` adds it to Claude as a second server, `bousleh-demo`, so you can say "Pulse: where am I?" on it. It never touches `~/.bousleh` or the `bousleh` entry; `scripts/setup-mac.sh --demo --remove` takes it out again.

## Run

```sh
git clone https://github.com/askoulwassim/bousleh.git ~/Developer/bousleh   # or anywhere outside Documents, Desktop and Downloads
cd ~/Developer/bousleh
scripts/setup-mac.sh --check   # optional: shows what is already set up, changes nothing
scripts/setup-mac.sh
```

Tip: if you clone inside a folder that syncs to iCloud, name the clone with a `.nosync` ending (`git clone … bousleh.nosync`), so iCloud skips `node_modules` and the build. Anywhere else, the name doesn't matter. An existing clone keeps working where it is: the script finds the repo from its own path. But keep it out of Documents, Desktop, Downloads and iCloud Drive if you'll install Home as an app: macOS guards those folders per app, and Home's Tune and health check can't run there ("Operation not permitted"), Full Disk Access or not. A clone already in one of them moves with [docs/move.md](docs/move.md).

The script:

1. checks Node and pnpm;
2. builds the engine, the MCP server and the Home page;
3. creates `~/.bousleh` (empty; daily backups will go to `~/.bousleh-backups`, the newest 14 kept), and writes `~/.bousleh/app.json` with this repo's path, so Home installed as an app can run Tune and the setup check here;
4. registers the `bousleh` MCP server in Claude Desktop, after backing up its config;
5. registers it in Claude Code and installs the plugin there, straight from this repo;
6. builds `dist/bousleh.plugin` as a fallback, and checks that the engine answers.

It's safe to rerun: it replaces its own Claude Desktop entry rather than adding one (and removes any second entry that runs the same server), clears earlier Claude Code registrations at local scope before registering once at user scope, and leaves an installed plugin alone. After `git pull`, run it again to rebuild.

## Then, by hand (about 3 minutes)

1. Quit Claude Desktop (Cmd-Q) and open it again.
2. Once per Claude account, add the plugin from GitHub: in Claude Desktop, **Customize > Plugins > Add > Add marketplace > Add from a repository**, enter `askoulwassim/bousleh`, then add **Bousleh**. That brings the nine skills, Drop included, to Desktop chat and the web, and they update from GitHub. If that option is missing or the private repo can't be reached from this account, upload `dist/bousleh.plugin` there instead. Check on the phone that Drop is listed; if it isn't, add Drop on its own as a skill.
3. In a Claude Desktop chat, say: "Bousleh: set me up." One question at a time, it files who you are (your name, role and work emails, so your calendar matches), your first two or three scopes with one line of strategy each, and a starter watch list per scope. It ends with what is left for you: the two Drive folders ("Bousleh Inbox" and "Bousleh", at the top of My Drive) and the next two steps. Saying it again skips what is done.
4. In Claude Desktop's Code tab, on this repo folder, say: "Set up the scheduled tasks in docs/scheduled-tasks.md." That file is the only definition of the four tasks: the Hourly inbox sweep (needs this Mac, hourly from 07:00 to 22:00), the Weekly Horizon scan (in the cloud, Mondays 06:40), the Hourly Meet notes mirror (in the cloud) and the Friday Bousleh tune-up (needs this Mac). It also writes `Bousleh Watch Lists.md` to the Drive folder "Bousleh", where the scan reads the watch lists. Saying it again updates them and never adds a second copy. Repeat it after `git pull`; a watch list change doesn't need it, since Horizon rewrites the Drive file itself.
5. In the same Code tab, say: "Publish Home from docs/home.md." That publishes `packages/home/dist/home.html` as your Home page (to the same link every time) and registers it. Open it once in Claude Desktop so it saves its first snapshot for the phone. Repeat after `git pull`. To make it an app, press Install as app in its footer, then allow what you want on its first screen (see docs/home.md).
6. Phone test: in the Claude app, say "Drop this: test from my phone." Then, in Claude Desktop on the Mac: "Process my Bousleh inbox." The note should be filed (or skipped), and gone from Drive's "Bousleh Inbox".

## Backups and restore

The MCP server snapshots your data once a day to `~/.bousleh-backups/<date-time>/`, on the same disk; ask for one any time with "take a Bousleh backup" (`vault.backup`). To restore: quit Claude Desktop and Claude Code, rename `~/.bousleh` to `~/.bousleh-broken`, and copy the snapshot folder you want to `~/.bousleh`.

## The work Mac

Same steps, with the work Claude account and the work Google Drive connected to it. Work captures go to that Drive's own "Bousleh Inbox" (Drop creates it on first use), and work data stays on the work Mac.
