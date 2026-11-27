# Bousleh Home

Home is one Claude page: every scope at every altitude, what needs you, and what Horizon found this week. It is built from `packages/home` into one self-contained file, `packages/home/dist/home.html`, and published with Claude's Artifact tool. This file is the only definition of how it is published; nobody publishes it by hand.

To publish it, or to update it after `git pull`, open the Code tab in Claude Desktop on this repo folder (`bousleh.nosync`) and say:

> Publish Home from docs/home.md.

Saying it again republishes to the same link. (A script can't do this step: publishing a Claude page and granting it the bousleh server and the Google Calendar connector happens through Claude, not the file system.)

## What it does

- **In the Claude desktop app, with the bousleh server connected:** live. It reads the engine through the local server (`host:bousleh`): `context_strata`, `pulse_today`, `watch_digest`, `watchlists_get`, `queue_list`, `commitments_list` and `assets_list` (and writes with `vault_supersede`, `commitments_close`, `commitments_snooze` and `inbox_drop`, below), and today's events from the Google Calendar connector (`list_events`), merged with the meetings filed in Bousleh. It refreshes itself every few minutes and stamps the time it last read.
- **On the phone and on the web:** the last snapshot. Each live load saves one snapshot of what it drew (when it changed) to the page's own storage, readable only by you; elsewhere Home shows that snapshot, stamped "Snapshot 20:43". With no snapshot yet it says so.
- **Every button is one op or one prompt.** Ops run live only, each on one press:
  - Save and Skip on a Horizon story call `vault_supersede` (status `to_read` or `dismissed`).
  - Each commitment in First has Done, Date, Snooze and Drop. Done and Drop call `commitments_close` (`done`, or `dropped` with the note "Dropped from Home.") and ask for a second press. Date opens a day picker and sets `due` with `vault_supersede`; Snooze opens one and calls `commitments_snooze`. The card then says what happened until the next read takes it out of First. Meetings in First keep their Counsel prompt.
  - Capture and Drop open a box with Send to inbox: the text goes to `inbox_drop` (source `local`, named `capture-<date>-<time>-home.md`) and the Hourly inbox sweep files it. Copy is still there to file it now in a chat.
  - Every other button copies a ready prompt for the mode it names ("Counsel: prep me for …", "Workshop: let's workshop …") to the clipboard, or shows it in a box to copy if the clipboard is refused. On the phone and the web (a snapshot) every button is a prompt, and Drop copies "Drop this: " for the Drop skill.
- **Install as app.** Where the Claude desktop app offers it, the footer has Install as app (the `desktop` capability). The installed app has Home's own icon and shows the needs-you count on its Dock tile. It asks for no desktop permission.

## How to publish it (for Claude)

1. **Build and check.**
   - Run `pnpm build` in the repo (or confirm `scripts/setup-mac.sh` ran since the last `git pull`; `scripts/setup-mac.sh --check` says whether `packages/home/dist/home.html` exists). Never edit `dist/home.html` by hand.
   - Call `vault_health` on the `bousleh` MCP server. It must answer with all Bousleh ops, `context_strata` among them; if it doesn't, stop and say to run `scripts/setup-mac.sh` and restart Claude Desktop.
2. **Find the existing Home.** Call `assets_list` with `type: "page"` and `scopes: ["bousleh"]`, and look for the asset titled "Bousleh Home". On the work Mac, use that instance's own scope instead of `bousleh` (the one Home is registered under, else ask).
3. **Publish.** Publish `packages/home/dist/home.html` with the Artifact tool, using the title, icon word and the `capabilities` object exactly as `packages/home/artifact.json` gives them (and its description). When step 2 found a Home, publish to its url so the link stays the same; otherwise publish a new one. Read the file first, as the Artifact tool requires; it holds no data, only the page.
4. **Register it, on first publish only.** Call `assets_add` with the artifact's url, title "Bousleh Home", `type: "page"`, `scopes: ["bousleh"]`, and `documents` set to the id of the Bousleh strategy (find it with `context_brief` on scope `bousleh` at altitude 50000, or `vault_search` kinds `["strategy"]`). A republish to the same url needs no `assets_add`; calling it again is safe.
5. **Report** in a few lines: the link, whether it was a new page or an update, and that:
   - live data needs the Claude desktop app with the bousleh server connected (the page asks once to use it and the Google Calendar connector);
   - the phone and the web show the last snapshot, taken the last time Home was open in the desktop app;
   - the first live open saves the first snapshot, so open it once on the Mac before checking the phone.

## The work instance

The work Mac publishes its own Home the same way, from the same repo, in its own Claude account: same page, its own data, its own snapshot and link. It shows Alethea's scopes because its engine holds them. Register it under the work instance's scope in step 4.

## Developing Home

- `pnpm --filter @bousleh/home build` builds the page; `pnpm --filter @bousleh/home test` runs its view-model tests.
- `node packages/home/preview/shoot.mjs [out-dir]` seeds a throwaway engine with fake data (never `~/.bousleh`), renders the page against it with a stand-in for the Claude page runtime (live, snapshot and no-data), and screenshots it at 1440 and 390 px next to the Claude Design boards. Its output (`preview/out/`) is not committed.
- The design: `docs/design/home.md` and the boards in `docs/design/home/`.
- `node packages/home/scripts/render-icon.mjs` re-renders `assets/app-icon-1024.png` from `assets/app-icon.svg`.
