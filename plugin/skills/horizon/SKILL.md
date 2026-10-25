---
name: horizon
description: Wassim's outside view - competitors, industry news, topics, people and podcasts on a watch list per scope. Reads the digest of what changed, flags what's worth acting on, edits watch lists, and files scan findings. Also the instructions the "Daily Horizon scan" scheduled task runs in the cloud. Use when he says "morning digest", "what's new outside", "what's new with [competitor]", "anything from the scan", "watch [company]", "add [podcast] to the watch list", "stop watching...", "set up the daily scan", or when the Daily Horizon scan runs.
---

# Horizon

Watch the outside world for each scope Wassim works on and bring back what matters, tied to that scope, with links to read or listen. You judge relevance and what's worth acting on. The engine stores watch lists, dedupes findings by url, and builds the digest.

This skill runs in two settings. Check which one you're in first:

- **Interactive:** a session on the Mac with the Bousleh MCP server. Use the ops below.
- **The Daily Horizon scan:** a scheduled task in the cloud. It can't reach the Mac or call the MCP server. Skip to "The Daily Horizon scan".

## Ops (interactive)

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `watchlists_get` (watchlists.get), `watch_digest` (watch.digest)
- Writes: `watchlists_set` (watchlists.set), `watch_file` (watch.file), `vault_link` (vault.link) to link a filed finding `evidence_for` a problem or idea it bears on, `assets_add` (assets.add) to register every Doc or dashboard you write
- Added, read-only: `scopes_list` (scopes.list) for scope slugs; `assets_list` (assets.list) to find the competitive brief that already exists for a scope
- Added, write: `vault_supersede` (vault.supersede), only to move a finding through the reading queue

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
2. Make the change: each entry has a `type` (`competitor`, `topic`, `outlet`, `person`, `podcast`), a `name`, and optionally a `url` and `notes`.
3. Say the change back in one line, then `watchlists_set` with the **complete** list. It replaces the old entries, so send every entry to keep.
4. Refresh the scan's copy of the lists (below).

## Flow: filing a scan file (from Capture)

Capture reads Daily Horizon scan files from the inbox and hands them here. For each file:

1. Read the frontmatter: `scope` and `watch_list_id`.
2. `watch_file` with the `watch_list_id` (or the `scope`) and one finding per item: `title`, `url`, `published_at` if known, and `summary`.
3. Report what was filed and what was skipped as already filed. Capture then settles the file.

## Flow: setting up the Daily Horizon scan

The scan is a Claude scheduled task in the cloud named "Daily Horizon scan". It is defined in the repo, in `docs/scheduled-tasks.md`, and never set up by hand. It can't read watch lists, so its prompt carries a copy of them.

After every `watchlists_set`, tell Wassim to say, in Claude Desktop's Code tab on the repo, "Set up the scheduled tasks in docs/scheduled-tasks.md", so the scan carries the current lists. Never write the task's prompt yourself.

Work instance: Alethea's competitors and the narrative-intelligence space, from public sources only, set up in the work account.

## The Daily Horizon scan

You're in the cloud. You can't reach the Mac or the Bousleh MCP server: don't try. Your only output is new files in the Google Drive folder "Bousleh Inbox", written with the Google Drive connector (content type `text/markdown`, conversion to a Google Doc turned off). Capture on the Mac brings them in through the same Drive connection and files them.

1. Take the watch lists from the task prompt.
2. For each entry, web search for what's new since the last run (default: the last two days; overlap is fine, filing dedupes by url):
   - competitor: launches, pricing, blog and changelog posts, funding, hires, news coverage
   - topic: notable articles and reports
   - outlet: new posts
   - person: new posts, talks, interviews
   - podcast: new episodes with show notes; a transcript link only when the show publishes one. Never transcribe.
3. Keep items that matter to that scope. For each: title, canonical url, published date if known, and a two- or three-sentence summary of what it is and why it matters to the scope. Public sources only.
4. Write one new file per watch list with anything new, never appending to an existing file. Name it `horizon-<scope>-<YYYY-MM-DD>.md`:

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
   ```

5. Write nothing for a list with nothing new. End with a one-line count per list.

## Registering assets

Interactive only (the Daily Horizon scan can't reach the engine). Right after you create or update a Claude Doc or dashboard, such as the weekly competitive brief, call `assets_add` with its url, a short title, its `type` (`doc`, `dashboard`), the scope slugs, and `documents` → the ids of what it covers: the watch list, and the findings it cites. Calling it again for the same url is safe, adds any new `documents` links and records a changed title.

## Output

The digest stays in the conversation, and Home shows it daily (Home reads `watch_digest` itself). For a weekly competitive brief to share with his PMs or leadership, write a Claude Doc from the digest.
