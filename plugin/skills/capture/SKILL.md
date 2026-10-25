---
name: capture
description: Files what Wassim says or drops in into his Bousleh data. Splits voice dumps, brain dumps, meeting transcripts and inbox files into typed, linked deposits (feedback, problems, ideas, decisions, commitments, notes on people) and queues anything ambiguous instead of guessing. Use when he says "capture this", "file this", "note that", "remember that I owe Peter the deck by Friday", "I just got out of a meeting with...", "here's the transcript", "brain dump", "process my inbox", "what's in the inbox", "clear the queue", or when the Hourly inbox sweep hands over.
---

# Capture

Turn raw input into typed, linked deposits. You decide what the input means. The engine files, dedupes, moves files and keeps history. Never write files or SQL yourself, and never move, copy or delete files in the local inbox: `inbox_settle` moves each one to `inbox/processed`. The one thing you carry by hand is Drive captures: you read them through the Google Drive connector, hand each one to `inbox_drop`, then move the Drive file to Drive's trash (moved, not copied; see "Flow: Google Drive").

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `inbox_list` (inbox.list), `inbox_take` (inbox.take), `vault_search` (vault.search)
- Writes: `deposits_write` (deposits.write), `queue_add` (queue.add), `queue_resolve` (queue.resolve), `vault_link` (vault.link), `inbox_settle` (inbox.settle)
- Added, read-only: `scopes_list` (scopes.list) for scope slugs, `queue_list` (queue.list) to clear the queue, `vault_get` (vault.get) to check a candidate
- Added, write: `inbox_drop` (inbox.drop) for Drive captures; `inbox_sweep` (inbox.sweep) only to tidy duplicates out of the local inbox.
- Google Drive connector (your Claude account's Drive): search the folder, read each file, and trash it after `inbox_drop` succeeds.

## What to judge

**Kind.** One atom, one object:

| He says | Kind |
| --- | --- |
| Something someone said, asked for or complained about | `signal` (attrs `source`, `sentiment`) |
| Something he noticed first-hand | `observation` |
| A pain or gap, stated as a problem | `problem` |
| "What if we...", a possible move | `idea` (status `open`) |
| "We decided...", "we're going with..." | `decision` (attrs `decided_at`, `reversible`) |
| "I owe...", "X owes me...", "I'll send..." | `commitment` (attrs `due`), links `owed_by`, `owed_to` |
| Feedback he gave one of his PMs, or their growth | `growth_note`, link `about` the person |
| A fact about a stakeholder (what they care about, how they decide) | `observation`, link `about` the person |
| Someone new | `person` (attrs `role`, `org`); people may have no scope. The person this Bousleh belongs to is marked `is_user: true`, once |

Strategy, principles, metrics and watch lists belong to Shape and Horizon. If a dump states one, queue it with the reason "for Shape" or "for Horizon".

**Altitude.** Every deposit needs one: `50000` company (CEO, CTPO, company bets), `10000` cross-team (other PMs, the data team), `1000` his own surfaces, `100` one engineer or one requirement. Use the altitude the atom lives at, not the altitude of the meeting it came from.

**Scope.** Use slugs from `scopes_list`. The work instance has Alethea's scopes; the personal one has Perfect Placement, Specdr, Pandora, AI Anvil, Bousleh and so on. Never guess between two scopes.

**Links.** Every atom links `from_moment` to the dump or meeting it came from. Also: `evidence_for` (signal, observation or finding to a problem or idea), `about` (to a person), `attended_by` (meeting to person), `owed_by` / `owed_to`, `part_of` (to an initiative or strategy), `addresses` (an idea to the problem it answers; optional, since an idea can be a pure opportunity), `related` when nothing else fits. Put links on the `deposits_write` call. Use `vault_link` only to link two objects that already exist.

**Duplicates.** Before writing a problem, idea, person or decision, `vault_search` for it. If it exists, link the new evidence to it instead of writing a second one. If you aren't sure it's the same thing, queue it with the existing ids as candidates.

## When to queue

Call `queue_add` rather than guess when the kind, altitude or scope is unclear, when it might duplicate an existing object, when a name could be two people, or when the dump hints that a bet ended but not which one. Give the draft as far as you know it, the reason in one sentence, candidate ids, and `source_sha256` when it came from an inbox file.

## Ideas and bets

- New ideas are `open`. Write one as `bet` only when Wassim states both a hypothesis and kill criteria (attrs `hypothesis`, `kill_criteria`). Otherwise write it `open` and say which is missing.
- Statuses are `open`, `bet`, `parked`, `dropped`, `concluded`. There is no won or lost.
- A bet ends only through a `decision`: deposit the decision with a `concludes` link to the idea (or `vault_link` decision → idea if the decision exists). The engine moves the idea to `concluded`. Never set `concluded` yourself. If the idea isn't a bet yet, queue the decision.
- Capture doesn't change existing objects. A request to park, drop or reword an idea, or to close a commitment, goes in your read-back as "for Shape" or "for Pulse". In an unattended run, deposit it as an `observation` linked `related` to the object so it isn't lost.

## Flow: something said in this conversation

1. Deposit the raw input as a `dump`: body exactly as said, at the altitude most of it lives at, in its scope.
2. Split it into atoms. For each: search, judge kind, altitude, scope and links, then `deposits_write` with `from_moment` → the dump, or `queue_add`.
3. Read back in a few spoken-style lines: what was filed, what was queued and why. Then ask at most one question, about the queued item that matters most.

## Flow: Google Drive

Phone captures (the Drop skill) and the Daily Horizon scan land in the Google Drive folder "Bousleh Inbox". Bring them in before working the inbox:

1. With the Google Drive connector, find the folder titled exactly `Bousleh Inbox` in My Drive, then list the files in it (`parentId` = that folder, not trashed), oldest first.
2. For each file, get its exact text:
   - Markdown and plain-text files: **download** the file's content (`download_file_content`) and decode it from base64. Don't use `read_file_content` for these: it returns a reformatted rendering (escaped `\---`, `captured\_at`, extra spaces), which breaks frontmatter and the content hash.
   - A Google Doc: download it exported as `text/plain`.
   Then `inbox_drop` with its title as `name` and the exact text as `content`.
3. Only when `inbox_drop` returned ok (a new file or a duplicate), move the Drive file to the trash with the connector. If the drop failed, leave the file in Drive and say so.
4. A file you can't read as text (a PDF, an image): leave it in Drive and mention it.

If the Google Drive connector isn't available in this session, skip this and say Drive captures are waiting.

## Flow: the inbox

1. Run "Flow: Google Drive" first, then `inbox_list`.
2. Take files oldest first with `inbox_take`. If `content` is null, `inbox_settle` it as `failed` (unreadable) or `skipped`, and mention it.
3. A file whose frontmatter has `bousleh: horizon-scan` came from the Daily Horizon scan. Follow "File a scan" in the Horizon skill (`watch_file`), then settle it `filed` with the first filed finding's id, or `skipped` if every finding was already filed.
4. A meeting transcript: deposit a `meeting` (attrs `held_at`, `attended_by` links to people, body a short summary). The raw transcript stays in `inbox/processed`. Then file its atoms with `from_moment` → the meeting.
5. Anything else (a phone dictation, a note): the dump flow above.
6. Settle every file once with `inbox_settle`:
   - Objects written: `filed`, with the dump or meeting as `object_id`. If some atoms were ambiguous, settle `filed` first, then `queue_add` them.
   - Nothing could be placed: `queue_add` with `source_sha256`, which settles it as `queued`.
   - Nothing worth keeping: `skipped`.

## Flow: clearing the queue

`queue_list`, then one item at a time: say what it is and why it was queued, ask the one missing thing, then `queue_resolve` with `file` and the overrides, or `discard` with a note.

## Unattended runs

When the Hourly inbox sweep starts Capture, nobody is there to answer. Ask nothing: queue whatever you would have asked about, and end with a short summary of filed, queued, skipped and failed counts.

## Output

Stays in the conversation: a short read-back Wassim can listen to. No artifact.
