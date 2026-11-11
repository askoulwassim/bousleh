---
name: horizon
description: Wassim's outside view - competitors, industry news, topics, people and podcasts on a watch list per scope. Reads the digest of what changed, flags what's worth acting on, edits watch lists, and files scan findings. Also the instructions the "Weekly Horizon scan" scheduled task runs in the cloud, and how its proposed watch list changes are applied. Use when he says "morning digest", "what's new outside", "what's new with [competitor]", "anything from the scan", "watch [company]", "add [podcast] to the watch list", "stop watching...", "what's on my reading list", "set up the weekly scan", or when the Weekly Horizon scan runs.
---

# Horizon

Watch the outside world for each scope Wassim works on and bring back what matters, tied to that scope, with links to read or listen. You judge relevance and what's worth acting on. The engine stores watch lists, dedupes findings by url, and builds the digest.

This skill runs in two settings. Check which one you're in first:

- **Interactive:** a session on the Mac with the Bousleh MCP server. Use the ops below.
- **The Weekly Horizon scan:** a scheduled task in the cloud, every Monday. It can't reach the Mac or call the MCP server. Skip to "The Weekly Horizon scan".

## Ops (interactive)

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `watchlists_get` (watchlists.get), `watch_digest` (watch.digest)
- Writes: `watchlists_set` (watchlists.set), `watchlists_apply` (watchlists.apply) for a scan's proposed changes, `watch_file` (watch.file), `vault_link` (vault.link) to link a filed finding `evidence_for` a problem or idea it bears on, `assets_add` (assets.add) to register every Doc or dashboard you write
- Added, read-only: `scopes_list` (scopes.list) for scope slugs; `assets_list` (assets.list) to find the competitive brief that already exists for a scope
- Added, write: `vault_supersede` (vault.supersede), only to move a finding through the reading queue; `queue_list` (queue.list) and `queue_resolve` (queue.resolve), only for the removals `watchlists_apply` queued for Wassim
- Google Drive connector: to write `Bousleh Watch Lists.md` in the Drive folder `Bousleh`, the copy of the watch lists the cloud scan reads

## Altitude

Watch lists default to `10000` (cross-team: the market around a product). Use `50000` for a company-level competitor set and `1000` for a list tied to one surface. Findings take their watch list's altitude.

## Flow: the digest

1. `watch_digest`, with `since` set to the last time he looked if he says ("since Friday"), else the default week. Pass `scope` if he names one.
2. Judge each group: what changed, which scope it touches, and whether it matters. Drop noise.
3. Say the top items in a few lines, each with its source. Flag up to three worth acting on:
   - "for Shape" when it bears on a strategy line or a problem,
   - "for Workshop" when it suggests an idea.
4. Ask one question at most ("Want a written brief of this week?").

## Flow: the reading and listening queue

Every finding has a reading-queue status: `new` when filed (findings filed before Oct 25 read as `new` too), `to_read` when Wassim wants to read or listen to it later, `read` once he has, `dismissed` when it isn't worth it.

- "Save that for later", "add it to my reading list": `vault_supersede` the finding with status `to_read`.
- "Read it", "listened to it": status `read`. If it changed his mind about something, offer Capture or Shape for what he took from it.
- "Not interested", "skip it": status `dismissed`. When he dismisses several from the same watch list entry, say so: it's a sign the entry is noise.
- "What's on my reading list?": `watch_digest` with `status: [to_read]` (no `since`: the whole queue). Give titles, sources and links.
- Use the digest's `status` to leave out what he already read or dismissed when you present a digest.

## Flow: editing a watch list

1. `watchlists_get` for the scope.
2. Make the change: each entry has a `type` (`competitor`, `topic`, `outlet`, `person`, `podcast`), a `name`, and optionally a `url` and `notes`. An entry Wassim asks for is his (`added_by: wassim`, the default).
3. Say the change back in one line, then `watchlists_set` with the **complete** list. It replaces the old entries, so send every entry to keep. Entries you send without `added_by` keep the one they have (matched by url, or by type and name), so the scan's entries stay marked as the scan's.
4. Refresh the watch lists file in Drive (below). Do it after every `watchlists_set` or `watchlists_apply`, in every flow.

"Stop watching X" removes the entry whoever added it: Wassim decides. If he wants to keep a scan-added entry for good, set its `added_by` to `wassim`, so later scans can only suggest removing it.

## Flow: the watch lists file in Drive

The cloud scan can't reach the Mac, so it reads the watch lists from a file in Google Drive, and the Mac keeps that file current. You write it right after any `watchlists_set` or `watchlists_apply`; the Hourly inbox sweep writes it after it files a scan; applying `docs/scheduled-tasks.md` writes it too.

1. `watchlists_get` with no arguments: every watch list.
2. Build the file. Fields with nothing in them stay empty; a `|` inside a field becomes `/`. Lists in order of scope slug, entries in the order the list holds them:

   ```markdown
   ---
   bousleh: watch-lists
   updated_at: <ISO date-time, now>
   ---

   # Bousleh watch lists

   Written by Bousleh on the Mac. The Weekly Horizon scan reads this file; don't edit it by hand (edits are lost at the next write).

   ## <scope slug>
   - id: <wls_ id>
   - altitude: <altitude>

   type | name | url | notes | added_by
   competitor | Glean | https://www.glean.com | | wassim
   outlet | Stratechery | https://stratechery.com | weekly | horizon
   ```

3. With the Google Drive connector, find the folder titled exactly `Bousleh` at the top of My Drive (create it if it doesn't exist). Never use `Bousleh Inbox`: that folder is swept and its files trashed.
4. In it, find the file titled exactly `Bousleh Watch Lists.md` (not trashed). The Drive connector can't rewrite a file's content, so replacing it means: create the new file there first, then move the old one to the trash. If it doesn't exist yet, just create it there: content type `text/markdown`, conversion to a Google Doc turned off. Never leave two copies.
5. If the connector isn't available, say the scan will run on the old lists until the file is written.

## Flow: filing a scan file (from Capture)

Capture reads Weekly Horizon scan files from the inbox and hands them here. For each file:

1. Read the frontmatter: `scope` and `watch_list_id`.
2. `watch_file` with the `watch_list_id` (or the `scope`) and one finding per item: `title`, `url`, `published_at` if known, and `summary`. The `## Watch list changes` section at the end is not a finding.
3. Apply the file's watch list changes (below), then refresh the watch lists file in Drive, even if nothing changed.
4. Report what was filed, what was skipped as already filed, and what changed on the watch list. Capture then settles the file.

### Applying the scan's watch list changes

Each line under `## Watch list changes` is `add` or `remove`, then the watch list id, the entry type, its name, its url (`-` when none), and the scan's one-line reason. `none` means nothing to do. Ignore a line you can't read, and say so.

1. Group the lines by watch list id (normally all the file's own), and call `watchlists_apply` once per list: `id`, `source` the scan file's name, and one change per line, `{ action, type, name, url, reason }` (no `url` when the line has `-`).
2. The engine enforces the rules, so don't pre-check or filter: an add is stored as `added_by: horizon` unless a match is already there; a remove takes off only an entry Horizon added; a remove of an entry Wassim added (every entry from before Oct 25 reads as his) is **never applied**, and instead becomes an open queue item for him, once, however many scans repeat it. All of one list's changes land in one new version, so the list's history shows them.
3. In the summary, one line per result: "added competitor Hebbia (horizon: direct alternative in 3 articles)", "removed outlet Y (horizon-added; off-topic for 4 weeks)", "suggested removing Z (Wassim's): queued", and say when one was already on the list or already queued.

When Wassim decides on a queued removal (`queue_list` shows them, titled `Remove "<name>" from the <scope> watch list?`), remove the entry with "Flow: editing a watch list" or keep it, then `queue_resolve` the item with `discard` and a note of what he chose. If he keeps it, a later scan may suggest it again; that's fine.

## Flow: setting up the Weekly Horizon scan

The scan is a Claude scheduled task in the cloud named "Weekly Horizon scan", every Monday at 06:40. It is defined in the repo, in `docs/scheduled-tasks.md`, and never set up by hand: to create it or change its schedule or prompt, tell Wassim to say, in Claude Desktop's Code tab on the repo, "Set up the scheduled tasks in docs/scheduled-tasks.md". Never write the task's prompt yourself.

Its prompt carries no watch lists: the scan reads them from the Drive file. So after a watch list change, refresh the Drive file (above); there's no need to apply `docs/scheduled-tasks.md` again. "Set up the weekly scan" with no task change means: check the Drive file exists and is current.

Work instance: Alethea's competitors and the narrative-intelligence space, from public sources only, set up in the work account.

## The Weekly Horizon scan

You're in the cloud. You can't reach the Mac or the Bousleh MCP server: don't try. You read one file from Google Drive, and your only output is new files in the Google Drive folder "Bousleh Inbox", written with the Google Drive connector (content type `text/markdown`, conversion to a Google Doc turned off). Capture on the Mac brings them in through the same Drive connection and files them, and applies your watch list changes.

1. **Read the watch lists.** Find the folder titled exactly `Bousleh` at the top of My Drive, and in it the file titled exactly `Bousleh Watch Lists.md`. Download its exact content (`download_file_content`, then decode the base64; never `read_file_content`, which reformats markdown). It must start with the frontmatter `bousleh: watch-lists`. Each `## <scope slug>` section is one watch list: its `id`, its `altitude`, and its entries as `type | name | url | notes | added_by`.
   If the folder or the file is missing, or it isn't a watch lists file, write nothing and stop with one line saying so.
2. For each entry, web search for what's new in the last seven days (overlap with last week is fine, filing dedupes by url):
   - competitor: launches, pricing, blog and changelog posts, funding, hires, news coverage
   - topic: notable articles and reports
   - outlet: new posts
   - person: new posts, talks, interviews
   - podcast: new episodes with show notes; a transcript link only when the show publishes one. Never transcribe.
3. Keep items that matter to that scope. For each: title, canonical url, published date if known, and a two- or three-sentence summary of what it is and why it matters to the scope. Public sources only.
4. **Learn the list.** While you search, note what the evidence says about the list itself:
   - **add** a competitor, outlet, person, podcast or topic that keeps coming up and isn't on the list: a company named as a direct alternative in several of this week's items, an outlet or podcast that broke or best covered several of them, a person quoted across them.
   - **remove** an entry that turned out irrelevant: an outlet or podcast with nothing on the scope's topics in the last four weeks (look back that far for this entry before proposing it), a company that pivoted away or shut down, a topic that is off the scope's strategy.
   Only what this run's evidence supports, with the evidence in the reason: rarely more than three of each per list. Never propose an entry that is already on the list, and never remove one you have no evidence about. When nothing should change, propose nothing.
5. Write one new file per watch list with anything new or any change to propose, never appending to an existing file. Name it `horizon-<scope>-<YYYY-MM-DD>.md`:

   ```markdown
   ---
   bousleh: horizon-scan
   scope: <scope slug>
   watch_list_id: <wls_ id>
   scanned_at: <ISO date-time>
   ---

   ## <title>
   - url: <url>
   - published: <YYYY-MM-DD or unknown>

   <summary>

   ## Watch list changes
   add | <wls_ id> | competitor | Hebbia | https://hebbia.ai | named as a direct alternative in 3 articles this week
   remove | <wls_ id> | outlet | Some Blog | https://someblog.example | no posts on the scope's topics in 4 weeks; now covers crypto
   ```

   `## Watch list changes` is always the last section. Write `none` under it when nothing should change.
6. Write nothing for a list with nothing new and no change to propose. End with a one-line count per list: items written, changes proposed.

## Registering assets

Interactive only (the Weekly Horizon scan can't reach the engine). Right after you create or update a Claude Doc or dashboard, such as the weekly competitive brief, call `assets_add` with its url, a short title, its `type` (`doc`, `dashboard`), the scope slugs, and `documents` → the ids of what it covers: the watch list, and the findings it cites. Calling it again for the same url is safe, adds any new `documents` links and records a changed title.

## Output

The digest stays in the conversation, and Home shows it daily (Home reads `watch_digest` itself). For a weekly competitive brief to share with his PMs or leadership, write a Claude Doc from the digest.
