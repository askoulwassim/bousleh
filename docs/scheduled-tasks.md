# Bousleh scheduled tasks

Bousleh runs two scheduled tasks. This file is their only definition: nobody sets one up by hand, and the same file sets up the personal Mac and the work Mac.

`scripts/setup-mac.sh` ends by pointing here. To apply it, open the Code tab in Claude Desktop on this repo folder (`bousleh.nosync`) and say:

> Set up the scheduled tasks in docs/scheduled-tasks.md.

Say it again after `git pull` changes this file. A watch list change doesn't need it: the Weekly Horizon scan reads the watch lists from Google Drive (below). (A script can't do this step: Claude Desktop keeps a task's schedule outside any file a script could write, and a headless `claude -p` run can't reach your Claude account's connectors.)

## How to apply this file (for Claude)

1. **Check the basics.**
   - Call `vault_health` on the `bousleh` MCP server. It must answer with all Bousleh ops; if it doesn't, stop and say to run `scripts/setup-mac.sh`.
   - Check that the Google Drive connector is available in this account. If it isn't, say so: both tasks need it.
   - Refresh the watch lists file in Drive, as the Horizon skill's "Flow: the watch lists file in Drive" says (`watchlists_get`, then create or replace `Bousleh Watch Lists.md` in the Drive folder `Bousleh`). The Weekly Horizon scan reads it and stops if it is missing. If there are no watch lists yet, skip this and Task 2, and say Horizon has nothing to watch yet.
2. **List what exists:** the scheduled tasks on this Mac and the cloud scheduled tasks (routines) on this account.
3. **For each task below:**
   - If a task with that exact name already exists in the same place (this Mac or the cloud), update its prompt and schedule to match this file. Otherwise create it. Never create a second task with the same name.
   - **Connectors:** a scheduled task gets every connector on the account, and neither the scheduling tools nor the app can limit that (checked Oct 25). Don't try to remove any, and don't report the extra ones as a problem. Each task's prompt limits what it touches instead: Bousleh's own tools, the "Bousleh Inbox" folder and the watch lists file. **Needs** lists what a task actually uses; check those are available.
   - **Tasks that need the Mac:** create a scheduled task that requires this Mac, with this repo folder as its working folder. Set the permission mode so runs don't stall on approvals for the Bousleh tools and the Google Drive connector. If only a mode that asks is available, say so, and tell Wassim to click **Run now** once and choose "always allow" for each tool.
   - **Cloud-only tasks:** give the run no access to the Mac.
4. **Remove strays.** If a scheduled task looks like an older copy of one of these under another name, name it and ask before deleting it.
5. **Report** in a few lines:
   - each task, whether it was created or updated, where it runs, and its next run time;
   - that a task that needs the Mac only does its work while the Mac is awake with Claude Desktop open. A run that finds the Mac asleep ends at once, and the next hour's run picks up.

## Why the sweep needs the Mac

Bousleh's data lives only on the Mac: local, never pushed. So filing into it needs the Mac awake. Capturing doesn't: Drop on the phone and the Weekly Horizon scan write to the Drive folder "Bousleh Inbox" whether the Mac is on or not, and nothing is lost. The sweep runs every hour through the day, so captures are filed within about an hour of the Mac being on. A run with nothing to do, or no Mac to reach, ends in seconds.

## Task 1: Hourly inbox sweep

This task was called "Daily inbox sweep" until Oct 25. If a task by that name exists, update it in place: rename it, and change its schedule and prompt. Don't create a second one.

- **Runs:** as a scheduled task that requires this Mac. It works through the Mac's `bousleh` MCP server.
- **Schedule:** every hour from 07:00 to 22:00, local time.
- **Needs:** the Bousleh MCP server on this Mac, and the Google Drive connector. The other connectors on the account stay attached but unused: the prompt keeps the run to Bousleh and those two Drive locations.
- **Permissions:** runs without asking, for the Bousleh tools and the Google Drive connector.

Prompt:

```text
Bousleh: Hourly inbox sweep. You are running unattended, so ask nothing.

Use the Bousleh plugin's Capture skill (bousleh:capture) and follow its "Unattended runs" rules: queue anything you would have asked about, never guess. The Bousleh tools are the `bousleh` MCP server on this Mac (vault_health, inbox_drop, inbox_list, inbox_take, inbox_settle, deposits_write, queue_add, vault_search, vault_link, scopes_list and so on).

1. Call vault_health. If the Mac or the Bousleh server doesn't answer, end at once with one line ("Mac not reachable; captures wait in Drive"). Leave everything in Google Drive.
   If the "Bousleh Inbox" folder in Drive is empty and inbox_list shows nothing waiting, end at once with one line ("Nothing to file"). Don't write a summary.
2. Bring Drive captures in, following Capture's "Flow: Google Drive":
   - With the Google Drive connector, find the folder titled exactly "Bousleh Inbox" at the top of My Drive. List its files, oldest first.
   - For each markdown or text file, download its exact content (download_file_content, then decode the base64). Never use read_file_content, which reformats markdown. For a Google Doc, download it exported as text/plain.
   - Call inbox_drop with the file's title as name and the exact text as content.
   - Only after inbox_drop returns ok (new or duplicate), move the Drive file to the trash.
   - Leave anything you couldn't read in Drive, and mention it.
3. Work the inbox, following Capture's "Flow: the inbox":
   - Run inbox_list, then take each file, oldest first.
   - File its atoms with the right kind, altitude, scope and links, or queue_add when unsure.
   - Files marked `bousleh: horizon-scan` go through the Horizon skill's "Flow: filing a scan file": file the findings with watch_file, apply the file's "Watch list changes" with watchlists_apply (it marks adds as horizon's, removes only entries horizon added, and queues any removal of an entry Wassim added for him), then refresh "Bousleh Watch Lists.md" in the Drive folder "Bousleh".
   - Settle every file exactly once with inbox_settle.
   - After the last horizon-scan file, check that each one's watch list changes were applied (watchlists_get shows the adds and removes) and that the Drive watch lists file was replaced in this run. If either didn't happen, do it now; if it can't be done, say so in the summary.
4. End with a short summary:
   - how many files were filed, queued, skipped and failed;
   - what's waiting in the queue for Wassim;
   - for each horizon-scan file: the watch list entries added, removed, and suggested to Wassim for removal;
   - anything left in Drive.

Never create, change or delete scheduled tasks. Never touch files outside Bousleh's own tools, the "Bousleh Inbox" folder, and the file "Bousleh Watch Lists.md" in the "Bousleh" folder. Use no connector other than Google Drive: never read or send email, chat messages, calendar events or meetings.
```

## Task 2: Weekly Horizon scan

This task was called "Daily Horizon scan", run every day, until Oct 25: daily was too noisy. If a task by that name exists, update it in place: rename it, and change its schedule and prompt. Don't create a second one.

- **Runs:** in the cloud, as a cloud scheduled task, so it works when the Mac is off.
- **Schedule:** every Monday at 06:40, local time, before the first inbox sweep.
- **Needs:** web search and the Google Drive connector, with no access to the Mac. The other connectors on the account stay attached but unused: the prompt keeps the run to reading the watch lists file and writing to "Bousleh Inbox".
- **Permissions:** runs on its own.
- **Watch lists:** the prompt carries none. Each run reads them from `Bousleh Watch Lists.md` in the Drive folder `Bousleh`, which the Mac keeps current: Horizon rewrites it after every watch list change, and the Hourly inbox sweep after it files a scan. So a watch list change never needs this file applied again.

Prompt:

```text
Bousleh: Weekly Horizon scan. You are running in the cloud, unattended. You can't reach Wassim's Mac or the Bousleh MCP server, so don't try.

Use the Bousleh plugin's Horizon skill (bousleh:horizon), in its "The Weekly Horizon scan" setting.

1. Read the watch lists first. With the Google Drive connector, find the folder titled exactly "Bousleh" at the top of My Drive, and in it the file titled exactly "Bousleh Watch Lists.md". Download its exact content (download_file_content, then decode the base64; never read_file_content, which reformats markdown). It starts with the frontmatter `bousleh: watch-lists`.
   If the folder or the file is missing, or it isn't a watch lists file, write nothing and end with one line: "No watch lists file in Drive (Bousleh/Bousleh Watch Lists.md); on the Mac, run Horizon or apply docs/scheduled-tasks.md to write it."
2. Look back seven days; overlap with last week is fine, because filing dedupes by url. Use public sources only. Podcasts: show notes, plus a transcript link only when the show publishes one; never transcribe.
3. Your only output is new markdown files in the Google Drive folder "Bousleh Inbox" (create it at the top of My Drive if it doesn't exist), written through the Google Drive connector:
   - content type text/markdown, with conversion to a Google Doc turned off;
   - one new file per watch list that has anything new or any watch list change to propose, never appending to an existing file;
   - each file named and formatted exactly as the skill says, including the `bousleh: horizon-scan` frontmatter and the `## Watch list changes` section at the end.
4. In "## Watch list changes", propose adding the competitors, outlets, people, podcasts and topics this week's evidence shows belong on the list, and removing entries the evidence shows are irrelevant. One line each, with the reason grounded in what you found. Propose nothing you can't back with what you found; write `none` when nothing should change.

Never change the watch lists file yourself: the Mac applies your proposals. End with one line per watch list: how many items were written, and how many changes proposed. Never create, change or delete scheduled tasks. Use no connector other than Google Drive, and in Drive touch only the watch lists file (read) and "Bousleh Inbox" (new files): never read or send email, chat messages, calendar events or meetings.
```
