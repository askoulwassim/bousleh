# Bousleh scheduled tasks

Bousleh runs four scheduled tasks. This file is their only definition: nobody sets one up by hand, and the same file sets up every Mac that runs Bousleh, a personal one or a work one.

`scripts/setup-mac.sh` applies this file for you: it ends by opening Claude's Code tab on your clone with "Finish setting up Bousleh from docs/finish-setup.md." typed in, and that runs the steps below. Rerun the script after every `git pull`.

Each task below has an exact name, a place (this Mac or the cloud), a cron in local time and a prompt. `node scripts/scheduled-tasks.mjs` prints them as JSON, and Claude applies that JSON literally: same names, same schedules, same prompts on every Mac, created or updated by name, never duplicated. To change a task, change this file. `node scripts/scheduled-tasks.mjs --list` shows them in one line each. (Creating the tasks takes Claude: they live in your Claude account, not in a file a script can write.)

## How to apply this file (for Claude)

Apply it exactly. Take every name, cron and prompt from the script's JSON, never from memory, and change nothing in them. Ask nothing except the approvals the app itself shows.

1. **Read the definitions.** Run `node scripts/scheduled-tasks.mjs --repo <this clone's absolute path>` in this clone and use its JSON. If it fails, stop and show its error.
2. **Check the basics.**
   - Call `vault_health` on the `bousleh` MCP server. It must answer with all Bousleh ops. If it doesn't, stop and say to run `scripts/setup-mac.sh`.
   - Check that the Google Drive connector is available on this account. If it isn't, stop and say so: three of the tasks need it.
   - Write the watch lists file: `watchlists_get`, then create or replace `Bousleh Watch Lists.md` in the Drive folder `Bousleh`, as the Horizon skill's "Flow: the watch lists file in Drive" says. If there are no watch lists yet, skip it and say Horizon has nothing to watch yet.
   - Seed the Meet ledger, once. If the Drive folder `Bousleh` has no file titled exactly `Bousleh Meet Ledger.md`, create it (content type `text/markdown`, conversion to a Google Doc turned off) in the format under Task 3, listing every Gemini notes doc already in the "Google Meet" folder, so only meetings from now on flow in. If there's no "Google Meet" folder at the top of My Drive, create the ledger with no entries. If the ledger exists, leave it alone.
3. **List what exists:** every scheduled task on this account, with its name, schedule, prompt, whether it needs this Mac, its working folder and whether it's on.
4. **For each task in the JSON, in order:**
   - The schedule is the task's `cron` in the user's local time zone (`CRON_TZ=<their IANA zone> <cron>`), unchanged. Never move the minute.
   - A task that `runs` on `mac` requires this Mac, with `folder` as its working folder. One that `runs` in the `cloud` gets no access to the Mac.
   - Set the permission mode so runs don't stall on approvals, where the app allows it.
   - **Exists, same name, same place, same folder:** update its schedule and prompt to the JSON's where they differ, and turn it on.
   - **Exists, same name, but needs this Mac with another working folder** (an older clone): a task's folder can't be changed in place, so create the new one first, then delete the old one.
   - **Missing:** create it.
   - Never create a second task with a name already in the JSON.
5. **Older names.** These were renamed: "Daily inbox sweep" is now the Hourly inbox sweep, and "Daily Horizon scan" is now the Weekly Horizon scan. If one exists, update it in place to the new name, schedule and prompt. Name any other task that looks like a stray copy of these, and leave it alone.
6. **Report** as a table: each task, created, updated or unchanged, where it runs, and its next run. Then one line: a task that needs the Mac does its work only while the Mac is awake with Claude Desktop open; a run that finds it asleep ends at once, and the next run picks up.

## Why the sweep needs the Mac

Bousleh's data lives only on the Mac: local, never pushed. So filing into it needs the Mac awake. Capturing doesn't: Drop on the phone and the Weekly Horizon scan write to the Drive folder "Bousleh Inbox" whether the Mac is on or not, and nothing is lost. The sweep runs every hour through the day, so captures are filed within about an hour of the Mac being on. A run with nothing to do, or no Mac to reach, ends in seconds.

## Task 1: Hourly inbox sweep

An older version of this task was called "Daily inbox sweep". If a task by that name exists, update it in place: rename it, and change its schedule and prompt. Don't create a second one.

- **Runs:** as a scheduled task that requires this Mac. It works through the Mac's `bousleh` MCP server.
- **Schedule:** every hour at :43, from 06:43 to 21:43, local time.
- **Cron:** `43 6-21 * * *`
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
   - Files marked `bousleh: horizon-scan` go through the Horizon skill's "Flow: filing a scan file": file the findings with watch_file, apply the file's "Watch list changes" with watchlists_apply (it marks adds as horizon's, removes only entries horizon added, and queues any removal of an entry the user added for them), then refresh "Bousleh Watch Lists.md" in the Drive folder "Bousleh".
   - Files marked `bousleh: meet-notes` come from the Hourly Meet notes mirror: follow Capture's step for them. Settle a meeting with nothing for the user as skipped, and don't file again a meeting already filed by hand.
   - Settle every file exactly once with inbox_settle.
   - After the last horizon-scan file, check that each one's watch list changes were applied (watchlists_get shows the adds and removes) and that the Drive watch lists file was replaced in this run. If either didn't happen, do it now; if it can't be done, say so in the summary.
4. End with a short summary:
   - how many files were filed, queued, skipped and failed;
   - what's waiting in the queue for the user;
   - for each horizon-scan file: the watch list entries added, removed, and suggested to the user for removal;
   - anything left in Drive.

Never create, change or delete scheduled tasks. Never touch files outside Bousleh's own tools, the "Bousleh Inbox" folder, and the file "Bousleh Watch Lists.md" in the "Bousleh" folder. Use no connector other than Google Drive: never read or send email, chat messages, calendar events or meetings.
```

## Task 2: Weekly Horizon scan

An older version of this task was called "Daily Horizon scan" and ran every day, which was too noisy. If a task by that name exists, update it in place: rename it, and change its schedule and prompt. Don't create a second one.

- **Runs:** in the cloud, as a cloud scheduled task, so it works when the Mac is off.
- **Schedule:** every Monday at 06:40, local time, before the first inbox sweep.
- **Cron:** `40 6 * * 1`
- **Needs:** web search and the Google Drive connector, with no access to the Mac. The other connectors on the account stay attached but unused: the prompt keeps the run to reading the watch lists file and writing to "Bousleh Inbox".
- **Permissions:** runs on its own.
- **Watch lists:** the prompt carries none. Each run reads them from `Bousleh Watch Lists.md` in the Drive folder `Bousleh`, which the Mac keeps current: Horizon rewrites it after every watch list change, and the Hourly inbox sweep after it files a scan. So a watch list change never needs this file applied again.

Prompt:

```text
Bousleh: Weekly Horizon scan. You are running in the cloud, unattended. You can't reach the user's Mac or the Bousleh MCP server, so don't try.

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

## Task 3: Hourly Meet notes mirror

- **Runs:** in the cloud, as a cloud scheduled task, so it works when the Mac is off.
- **Schedule:** every hour at :20, from 07:20 to 21:20, Monday to Friday, local time, so the Hourly inbox sweep files what it copies at :43.
- **Cron:** `20 7-21 * * 1-5`
- **Needs:** the Google Drive connector, with no access to the Mac. The other connectors on the account stay attached but unused.
- **Permissions:** runs on its own.
- **What it does:** Google Meet saves Gemini's notes (with the transcript, when one was recorded) as a Google Doc in a subfolder of the Drive folder "Google Meet", one subfolder per meeting (a recurring meeting keeps one subfolder). For a meeting the user owns the doc itself sits there; for others' meetings, a shortcut to it. This task copies each new notes doc, as plain text, into "Bousleh Inbox"; Capture files it on the Mac, skips meetings with nothing for the user, and moves a planned meeting to held.
- **The ledger:** `Bousleh Meet Ledger.md` in the Drive folder `Bousleh` lists every notes doc already copied, so each is copied once even though the originals stay put. Applying this file seeds it (step 1). Format:

```markdown
---
bousleh: meet-ledger
updated_at: <ISO date-time>
---

# Bousleh Meet ledger

Written by the Hourly Meet notes mirror. Each line is a Google Meet notes doc already copied to Bousleh Inbox, or marked done when the mirror was set up. Don't edit by hand.

doc_id | meeting folder | doc title | mirrored_at
1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcdEf | Alex / Rowan - Roadmap sync - 2026/11/10 15:03 EST | Alex / Rowan - Roadmap sync - 2026/11/10 15:03 EST - Notes by Gemini | 2026-11-11T12:00:00-05:00
```

Prompt:

```text
Bousleh: Hourly Meet notes mirror. You are running in the cloud, unattended, so ask nothing. You can't reach the user's Mac or the Bousleh MCP server, so don't try. Use only the Google Drive connector.

1. Read the ledger. Find the folder titled exactly "Bousleh" at the top of My Drive, and in it the file titled exactly "Bousleh Meet Ledger.md" (not trashed). Download its exact content (download_file_content, then decode the base64; never read_file_content). It starts with the frontmatter `bousleh: meet-ledger`; each line after the header row is `doc_id | meeting folder | doc title | mirrored_at`.
   If the folder or the ledger is missing, or it isn't a ledger, write nothing and end with one line: "No Meet ledger in Drive (Bousleh/Bousleh Meet Ledger.md); on the Mac, apply docs/scheduled-tasks.md to seed it."
2. Find the new notes docs. Find the folder titled exactly "Google Meet" at the top of My Drive (if there's none, end with "No Google Meet folder yet"), and list all its subfolders (every page), for their ids and names.
   - Then search for Gemini notes created in the last 14 days, in one or two searches: Google Docs, and shortcuts, whose title contains "Notes by Gemini" or "Transcript" and whose createdTime is within 14 days. Keep only those whose parent is "Google Meet" or one of its subfolders.
   - When the user owns the meeting, the notes are a Google Doc in the subfolder; otherwise they're a shortcut to someone else's doc. A shortcut stands for its target: use shortcutDetails.targetFileId as the doc id.
   - Don't go by a subfolder's modified time: a recurring meeting's subfolder keeps the date it was first made, even as new notes land in it.
   - Skip every doc id already in the ledger. If there's nothing new, end at once with one line: "No new Meet notes." Don't write a summary.
3. For each new doc, oldest first:
   - Download it exported as text/plain (download_file_content with exportMimeType "text/plain", then decode the base64). If you can't read it, leave it out of the ledger, so the next run tries again, and mention it.
   - The meeting title and start come from the subfolder name, which reads "<title> - YYYY/MM/DD HH:MM <zone>" (a recurring meeting's subfolder has no date: take them from the doc title, which has the same pattern). Convert the start to an ISO date-time with its offset (EST is -05:00, EDT -04:00).
   - Create one new file in the folder titled exactly "Bousleh Inbox" at the top of My Drive (create it if it doesn't exist): title `meet-YYYY-MM-DD-HHMM-<slug>.md` from the start and a three-to-five-word slug of the title; content type text/markdown, with conversion to a Google Doc turned off. Content, exactly:

     ---
     bousleh: meet-notes
     meeting: "<meeting title>"
     held_at: <ISO date-time with offset>
     notes_url: https://docs.google.com/document/d/<doc id>/edit
     folder: "<subfolder name>"
     ---

     <the exported text, unchanged>

   - Never copy the same doc twice in one run, and never append to an existing file.
4. Update the ledger, once, after the last copy: build the new ledger text (the old lines plus one line per doc copied in this run, with mirrored_at now, and updated_at now), create it as a new "Bousleh Meet Ledger.md" in the "Bousleh" folder (text/markdown, conversion off), and only then move the old ledger file to the trash. Never leave two ledgers, and never trash the old one before the new one exists.
5. End with one line: how many notes docs were copied, and any you couldn't read.

Never read, move, rename or delete anything in "Google Meet" or its subfolders; only read them. Never touch any Drive file other than the ledger and the new files in "Bousleh Inbox". Never create, change or delete scheduled tasks. Never read or send email, chat messages, calendar events or meetings.
```

## Task 4: Friday Bousleh tune-up

- **Runs:** as a scheduled task that requires this Mac, with this repo folder as its working folder. It works on your data through the Mac's `bousleh` MCP server, and only reads the repo folder, for the setup check. It never changes the repo.
- **Schedule:** every Friday at 16:47, local time (end of day; off the hour, since runs on the hour can be delayed).
- **Cron:** `47 16 * * 5`
- **Needs:** the Bousleh MCP server on this Mac, and `scripts/setup-mac.sh --check` in this folder. No connectors, no `git`, no `gh`.
- **Permissions:** runs without asking, for the Bousleh tools and the read-only setup check.
- **What it may do on its own:** safe, reversible data fixes that follow rules the user has already set (each with a reason starting `Friday tune-up:`, nothing deleted); judgment calls (duplicates, stale commitments and plans) go to the user's queue; anything off in the setup goes in its report. It never edits files, runs `git`, `gh` or `pnpm`, or opens a pull request or an issue: changes to Bousleh are the user's, by hand. It reports only when it did something or found something off.

Prompt:

```text
Bousleh: Friday Bousleh tune-up. You are running unattended, so ask nothing.

Use the Bousleh plugin's Tune skill (bousleh:tune) and follow it exactly: read the week with vault_activity, fix only what its "What you may fix on your own" table allows (at most ten fixes), queue at most five judgment calls, and check this Mac's setup with `scripts/setup-mac.sh --check`. The Bousleh tools are the `bousleh` MCP server on this Mac. The working folder is the Bousleh repo, and you only read it.

1. Call vault_health. If the Mac or the Bousleh server doesn't answer, end at once with one line ("Mac not reachable; tune-up skipped this week").
2. Follow the Tune skill's steps 1 to 5.
3. If nothing needed fixing or queuing and the setup is in order, end with one line: "Nothing to tune this week." Otherwise end with the skill's short report.

Every write you make to Bousleh carries a reason or note starting "Friday tune-up:". Never delete anything, never change the user's dumps or their own commitments, and never undo something the user did. Never change the repo: don't edit any file, don't run git, gh, pnpm or any command other than `scripts/setup-mac.sh --check`, and never open a pull request or an issue. Never create, change or delete scheduled tasks. Use no connector: never read or send email, chat messages, calendar events, meetings or Drive files.
```
