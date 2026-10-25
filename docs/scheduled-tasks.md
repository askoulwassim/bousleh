# Bousleh scheduled tasks

Bousleh runs two scheduled tasks. This file is their only definition: nobody sets one up by hand, and the same file sets up the personal Mac and the work Mac.

`scripts/setup-mac.sh` ends by pointing here. To apply it, open the Code tab in Claude Desktop on this repo folder (`bousleh.nosync`) and say:

> Set up the scheduled tasks in docs/scheduled-tasks.md.

Say it again after `git pull` changes this file, or after a watch list changes. (A script can't do this step: Claude Desktop keeps a task's schedule outside any file a script could write, and a headless `claude -p` run can't reach your Claude account's connectors.)

## How to apply this file (for Claude)

1. **Check the basics.**
   - Call `vault_health` on the `bousleh` MCP server. It must answer with all Bousleh ops; if it doesn't, stop and say to run `scripts/setup-mac.sh`.
   - Check that the Google Drive connector is available in this account. If it isn't, say so: both tasks need it.
2. **List what exists:** the scheduled tasks on this Mac and the cloud scheduled tasks (routines) on this account.
3. **For each task below:**
   - If a task with that exact name already exists in the same place (this Mac or the cloud), update its prompt and schedule to match this file. Otherwise create it. Never create a second task with the same name.
   - **On this Mac:** use this repo folder as the working folder. Set the permission mode so runs don't stall on approvals for the Bousleh tools and the Google Drive connector. If only a mode that asks is available, say so, and tell Wassim to click **Run now** once and choose "always allow" for each tool.
   - **In the cloud:** attach the Google Drive connector. Give the run no access to the Mac.
   - Fill placeholders (`{{…}}`) as the task says.
4. **Remove strays.** If a scheduled task looks like an older copy of one of these under another name, name it and ask before deleting it.
5. **Report** in a few lines:
   - each task, whether it was created or updated, where it runs, and its next run time;
   - that the task on this Mac runs only while the Mac is awake and Claude Desktop is open, and that a missed run catches up once on wake.

## Task 1: Daily inbox sweep

- **Runs:** on this Mac, as a Claude Desktop scheduled task.
- **Schedule:** every day at 07:40, local time.
- **Needs:** the Bousleh MCP server and the Google Drive connector.
- **Permissions:** runs without asking, for the Bousleh tools and the Google Drive connector.

Prompt:

```text
Bousleh: Daily inbox sweep. You are running unattended, so ask nothing.

Use the Bousleh plugin's Capture skill (bousleh:capture) and follow its "Unattended runs" rules: queue anything you would have asked about, never guess. The Bousleh tools are the `bousleh` MCP server on this Mac (vault_health, inbox_drop, inbox_list, inbox_take, inbox_settle, deposits_write, queue_add, vault_search, vault_link, scopes_list and so on).

1. Call vault_health. If the Bousleh server doesn't answer, stop, say so in one line, and leave everything in Google Drive.
2. Bring Drive captures in, following Capture's "Flow: Google Drive":
   - With the Google Drive connector, find the folder titled exactly "Bousleh Inbox" at the top of My Drive. List its files, oldest first.
   - For each markdown or text file, download its exact content (download_file_content, then decode the base64). Never use read_file_content, which reformats markdown. For a Google Doc, download it exported as text/plain.
   - Call inbox_drop with the file's title as name and the exact text as content.
   - Only after inbox_drop returns ok (new or duplicate), move the Drive file to the trash.
   - Leave anything you couldn't read in Drive, and mention it.
3. Work the inbox, following Capture's "Flow: the inbox":
   - Run inbox_list, then take each file, oldest first.
   - File its atoms with the right kind, altitude, scope and links, or queue_add when unsure.
   - Files marked `bousleh: horizon-scan` go through the Horizon skill's "File a scan".
   - Settle every file exactly once with inbox_settle.
4. End with a short summary:
   - how many files were filed, queued, skipped and failed;
   - what's waiting in the queue for Wassim;
   - anything left in Drive.

Never create, change or delete scheduled tasks. Never touch files outside Bousleh's own tools and the "Bousleh Inbox" folder.
```

## Task 2: Daily Horizon scan

- **Runs:** in the cloud, as a cloud scheduled task, so it works when the Mac is off.
- **Schedule:** every day at 06:40, local time, before the inbox sweep.
- **Needs:** web search and the Google Drive connector, with no access to the Mac.
- **Permissions:** runs on its own.
- **Placeholder:** fill `{{watch_lists}}` from `watchlists_get`, called with no arguments.
  - For each watch list, give its scope slug, its watch list id (`wls_…`), its altitude, and every entry as `type | name | url | notes`.
  - Fill it again every time this file is applied, so the task always carries the current lists.
  - If there are no watch lists yet, don't create the task; say Horizon has nothing to watch yet.

Prompt:

```text
Bousleh: Daily Horizon scan. You are running in the cloud, unattended. You can't reach Wassim's Mac or the Bousleh MCP server, so don't try.

Use the Bousleh plugin's Horizon skill (bousleh:horizon), in its "The Daily Horizon scan" setting. Your only output is new markdown files in the Google Drive folder "Bousleh Inbox", written through the Google Drive connector:
- content type text/markdown, with conversion to a Google Doc turned off;
- one new file per watch list that has anything new, never appending to an existing file;
- each file named and formatted exactly as the skill says, including the `bousleh: horizon-scan` frontmatter.

If the "Bousleh Inbox" folder doesn't exist, create it at the top of My Drive.

Look back two days; overlap is fine, because filing dedupes by url. Use public sources only. Podcasts: show notes, plus a transcript link only when the show publishes one; never transcribe.

The watch lists, as of the last time Bousleh's schedules were set up:

{{watch_lists}}

End with one line per watch list: how many items were written. Never create, change or delete scheduled tasks.
```
