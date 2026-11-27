---
name: capture
description: Files what you say or drop in into your Bousleh data. Splits voice dumps, brain dumps, meeting transcripts and inbox files into typed, linked deposits (feedback, problems, ideas, decisions, commitments, notes on people) and queues anything ambiguous instead of guessing. Use when you say "capture this", "file this", "note that", "remember that I owe Rowan the deck by Friday", "I just got out of a meeting with...", "here's the transcript", "brain dump", "process my inbox", "what's in the inbox", "clear the queue", or when the Hourly inbox sweep hands over.
---

# Capture

Turn raw input into typed, linked deposits. You decide what the input means. The engine files, dedupes, moves files and keeps history. Never write files or SQL yourself, and never move, copy or delete files in the local inbox: `inbox_settle` moves each one to `inbox/processed`. The one thing you carry by hand is Drive captures: you read them through the Google Drive connector, hand each one to `inbox_drop`, then move the Drive file to Drive's trash (moved, not copied; see "Flow: Google Drive").

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `inbox_list` (inbox.list), `inbox_take` (inbox.take), `vault_search` (vault.search), `signals_patterns` (signals.patterns) for the signal tags already in use
- Writes: `deposits_write` (deposits.write), `queue_add` (queue.add), `queue_resolve` (queue.resolve), `vault_link` (vault.link), `inbox_settle` (inbox.settle), `assets_add` (assets.add) for links to artifacts
- Added, read-only: `scopes_list` (scopes.list) for scope slugs, `queue_list` (queue.list) to clear the queue, `vault_get` (vault.get) to check a candidate, `commitments_list` (commitments.list) to find open commitments a new one repeats or a meeting resolved
- Added, write: `commitments_close` (commitments.close) with `done` only, for a commitment a filed meeting plainly shows was delivered (see "Commitments a meeting resolved")
- Added, write: `inbox_drop` (inbox.drop) for Drive captures; `inbox_sweep` (inbox.sweep) only to tidy duplicates out of the local inbox; `vault_supersede` (vault.supersede) for three things only: moving a planned meeting to `held` once it has happened (see "Meetings"), adding an email address to a person who exists (see "People's emails"), and giving a person filed by first name their full name (see "People's full names").
- Google Drive connector (your Claude account's Drive): search the folder, read each file, and trash it after `inbox_drop` succeeds.

## What to judge

**Relevance first.** File only what the user is involved in, directly or indirectly, or what affects their work. Skip the rest; it is noise on Home. A commitment between two other people (one colleague owes another a screenshot), an attendee who only appears because they were in the room, a team update on work none of their scopes touch: leave them out. When a meeting has nothing for them at all (an HR session, another team's standup), settle the file `skipped` and write nothing. When unsure whether something touches their work, file it; the Friday tune-up looks for noise.

**Whose commitment.** A commitment is only something a named person said they will do. Never file as one: a team intent ("we should look at..."), the user thinking aloud, Gemini's suggested next steps with no owner, a follow-up another person owns that doesn't come back to the user, or a step everyone else in the room does but the user doesn't (other PMs send their quarter's highlight and slides; the user has just joined and owes neither). A passing remark worth keeping is an `observation`; otherwise leave it out. If you can't tell whether the user really owes it, queue it with the reason "is this yours?" rather than filing it as theirs.

**Commitment size.** Every new commitment gets attrs `size`: `major` for a real deliverable, `minor` for a quick follow-up from a call. Major: "ship the 2.4 release", "finalize the Q1 roadmap", "write the metering requirements". Minor: "ask Ian about the Zitadel roles", "send Rowan the deck link", "add Mira to the #harbor channel". Pulse and Home give minor ones less room, so when unsure, pick `major`. The user can resize one later through Pulse.

**One piece of work, one commitment.** This holds whatever the size: when several actions are steps toward one deliverable (connect to the bucket, move the flow into code, send the first report), file one `major` commitment for the deliverable and list the steps in its body, not a minor commitment per step. Before writing any commitment, `commitments_list` with `owed_by` (and `owed_to`) set to the people on it: if an open one already covers the same work, from this meeting or an earlier one, `vault_link` the new moment to it (`related`) and don't write a second one. Not sure it's the same work: queue it with the existing one as a candidate.

**Kind.** One atom, one object:

| The user says | Kind |
| --- | --- |
| Something someone said, asked for or complained about | `signal` (attrs `source`, `sentiment`, `tags`) |
| Something they noticed first-hand | `observation` |
| A pain or gap, stated as a problem | `problem` (status `open`, the default) |
| "What if we...", a possible move | `idea` (status `open`) |
| "We decided...", "we're going with..." | `decision` (attrs `decided_at`, `reversible`) |
| "I owe...", "X owes me...", "I'll send..." | `commitment` (attrs `due`, `size` major or minor; see "Commitment size"), links `owed_by`, `owed_to` |
| "Remind me in a week if X hasn't...", "check back on this Monday", "don't show me this until..." | `commitment` with attrs `surface_on` (the day to bring it back; see "Snoozed follow-ups"), links `owed_by`, `owed_to` |
| Feedback the user gave one of their PMs, or that PM's growth | `growth_note`, link `about` the person |
| A fact about a stakeholder (what they care about, how they decide) | `observation`, link `about` the person |
| Someone new | `person` (attrs `role`, `org`, `emails` when an address is known); people may have no scope. `role` is exactly one of `stakeholder`, `pm`, `engineer`, `analyst`, `other`, lower-case, or left out: a job title ("CEO", "Analyst", "head of sales") is refused by the engine, so put it in the body. The person this Bousleh belongs to is marked `is_user: true`, once |
| "X reports to Y", "Y is X's manager" | a `reports_to` link from X to Y (both people; deposit either one first if new) |
| A company word or acronym and what it means | `term` (attrs `aliases`, `definition`), usually at `50000` in the company's scope |
| A meeting coming up ("I'm seeing Rowan Thursday about...") | `meeting` with status `planned`, `held_at` the day or time it will happen, `attended_by` links |

Strategy, principles, metrics and watch lists belong to Shape and Horizon. If a dump states one, queue it with the reason "for Shape" or "for Horizon".

**Altitude.** Every deposit needs one: `50000` company (CEO, CTPO, company bets), `10000` cross-team (other PMs, the data team), `1000` the user's own surfaces, `100` one engineer or one requirement. Use the altitude the atom lives at, not the altitude of the meeting it came from.

**Scope.** Use slugs from `scopes_list`. A work instance has the company's scopes (`northwind` and its products); a personal one has projects such as `harbor`, `atlas`, `hiring`, `platform` and `bousleh`. Never guess between two scopes.

**Links.** Every atom links `from_moment` to the dump or meeting it came from. Also: `evidence_for` (signal, observation or finding to a problem or idea), `about` (to a person), `attended_by` (meeting to person), `owed_by` / `owed_to`, `reports_to` (a person to their manager), `part_of` (to an initiative or strategy), `addresses` (an idea to the problem it answers; optional, since an idea can be a pure opportunity), `related` when nothing else fits. Put links on the `deposits_write` call. Use `vault_link` only to link two objects that already exist.

**Assets.** When a dump, transcript or inbox file mentions the url of a Claude artifact (a Doc, deck, dashboard, whiteboard, design or page), a Google Doc or sheet, or a GitHub repo, register it with `assets_add`: the url, a short title, its `type` (`doc`, `slides`, `sheet`, `dashboard`, `whiteboard`, `design`, `page`, `repo`, `file`, `other`), the scope, and `documents` → the atoms it relates to (write them first, then add the asset). It is never its own atom: no `signal` or `observation` just to hold a link. The same url twice is safe; `assets_add` returns the one already registered and adds the new links. If you can't tell what it documents, register it with no `documents` and say so in the read-back.

**Signal tags.** Give every signal one to three `tags`: short lower-case slugs for what it is about (`export-speed`, `onboarding`, `pricing`), so the same feedback from different people can be counted as a pattern. Tag consistently, or the patterns split:
- Before tagging, call `signals_patterns` with `min_count: 1` and a wide window (`since` a year back) in the signal's scope, once per session or run: it lists every tag in use. Reuse one that fits before inventing a new one, even if your word would be slightly better.
- One concept, one tag: singular nouns or noun phrases (`export-speed`, not `slow-exports` next to `export-performance`).
- A new tag only when nothing in use fits; say so in the read-back ("new tag: data-residency").
- Never put a person's name, a customer or a sentiment in a tag; those have their own fields and links (`source`, `sentiment`, `about`).

**Glossary terms.** When a dump defines a word or acronym the company uses, deposit a `term`: the term as the title, other spellings and expansions in `aliases`, one or two sentences in `definition`. `vault_search` with `kinds: [term]` first; if it exists with a different meaning, queue it ("conflicting definition") with the existing id as a candidate.

**People map.** When a dump names someone's manager, link the person `reports_to` the manager. For two people who already exist, use `vault_link`. If the person already reports to someone else, queue it instead of adding a second manager.

**People's emails.** A person's `emails` attr (lower-cased, each once, at most five) lets Pulse and Counsel match calendar attendees to people. When you create a person and their email is known (a transcript's attendee list, an email signature, a calendar invite in the dump), set `emails`. When a person already exists and the input gives an email they don't have, `vault_supersede` them with `attrs: { emails: [...] }`: the whole list, their current addresses plus the new one, since a new version replaces the key. Never guess an address from a name and a domain.

**People's full names.** People are often filed by first name only ("Rowan", "Priya"), then a Meet notes attendee list or a calendar invite gives the full name ("Rowan Vale", "Priya Nair"). Never write a second person for that full name. When exactly one person has that first name as their title, and nothing in the input says it's someone else, `vault_supersede` them with the full name as `title` (keep the body; add the email in the same version if the input gives one). Take full names only from an attendee list or an invite, which spell names as the account does, never from a dictation or a transcript body, which mis-hear them. Queue it instead, with the person as a candidate, when two people share the first name, when the record has a short form of it ("Sam" for "Samuel Ortiz"), or when the person already has a different surname.

**Duplicates.** Before writing a problem, idea, person, term or decision, `vault_search` for it. If it exists, link the new evidence to it instead of writing a second one. If you aren't sure it's the same thing, queue it with the existing ids as candidates.

**Snoozed follow-ups.** When the user wants something kept out of sight until a day ("remind me next Thursday if Ian hasn't replied on the metering doc"), deposit the commitment with `surface_on` set to that day (YYYY-MM-DD). Until then it stays out of Pulse, Home's needs-you count and the strata; on that day it shows up as due. Set `due` only if they also name a real deadline. Work out the day from today's date ("in a week" is seven days from today; "Monday" is the next Monday) and say the date in the read-back. Snoozing a commitment that already exists is Pulse's (`commitments_snooze`): say "for Pulse" in the read-back.

## When to queue

Call `queue_add` rather than guess when the kind, altitude or scope is unclear, when it might duplicate an existing object, when a name could be two people, or when the dump hints that a bet ended but not which one. Give the draft as far as you know it, the reason in one sentence, candidate ids, and `source_sha256` when it came from an inbox file.

## Ideas and bets

- New ideas are `open`. Write one as `bet` only when the user states both a hypothesis and kill criteria (attrs `hypothesis`, `kill_criteria`). Otherwise write it `open` and say which is missing.
- New ideas are written `open`, or `running` when they say it is already being tried (an experiment under way, a build in progress); never `running` on a guess.
- Statuses are `open`, `running`, `bet`, `parked`, `dropped`, `concluded`. There is no won or lost.
- A bet ends only through a `decision`: deposit the decision with a `concludes` link to the idea (or `vault_link` decision → idea if the decision exists). The engine moves the idea to `concluded`. Never set `concluded` yourself. Only a `bet` or a `running` idea can be concluded; if it is neither, queue the decision.
- Capture doesn't change existing objects (the exceptions: a planned meeting that has happened, under "Meetings", a person's email, under "People's emails", a person's full name, under "People's full names", and a commitment a meeting plainly delivered, under "Commitments a meeting resolved"). A request to park, drop, start or reword an idea, a problem said to be solved or no longer worth solving, or a commitment to close or snooze, goes in your read-back as "for Shape" or "for Pulse" (starting an existing idea and marking a problem solved or dropped are Shape's). In an unattended run, deposit it as an `observation` linked `related` to the object so it isn't lost.

## Meetings

- A meeting that happened: `meeting` (status `held`, the default), `held_at`, `attended_by` links.
- A meeting mentioned ahead of time: `meeting` with status `planned` and `held_at` set to when it will be. Counsel keeps its prep in the body of the same planned meeting.
- When a transcript or debrief arrives for a meeting that already exists as `planned` (`vault_search` with `kinds: [meeting]`, then check its status and `held_at`), don't write a second meeting: `vault_supersede` it with status `held` (and the real `held_at` if it moved), keeping the prep body, then file the atoms with `from_moment` → that meeting. If you aren't sure it's the same meeting, write a new one and queue the pair.

### Commitments a meeting resolved

After filing a held meeting, `commitments_list` (open) with `owed_by`, then `owed_to`, set to each attendee, the user included. For each one the notes resolve:

- The notes say plainly it was done (asked and answered, sent, granted, delivered): `commitments_close` with `done` and a note starting "Closed by Capture:" that names the meeting and day and says what happened ("Closed by Capture: Ian added Alex as a Zitadel org owner at their Nov 17 1:1.").
- It only looks resolved, or the notes say it no longer applies: don't close it. Say it in the read-back "for Pulse"; in an unattended run, deposit an `observation` linked `related` to the commitment, titled "Looks resolved by <meeting>", so Pulse can close or drop it.

Never close a commitment as `dropped`, and never close one the notes only mention.

## Flow: something said in this conversation

1. Deposit the raw input as a `dump`: body exactly as said, at the altitude most of it lives at, in its scope.
2. Split it into atoms. For each: search, judge kind, altitude, scope and links, then `deposits_write` with `from_moment` → the dump, or `queue_add`.
3. Read back in a few spoken-style lines: what was filed, what was queued and why. Then ask at most one question, about the queued item that matters most.

## Flow: Google Drive

Phone captures (the Drop skill), the Weekly Horizon scan and the Hourly Meet notes mirror land in the Google Drive folder "Bousleh Inbox". Only that folder: the file `Bousleh Watch Lists.md` in the Drive folder `Bousleh` is Horizon's, never swept or trashed. Bring them in before working the inbox:

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
3. A file whose frontmatter has `bousleh: horizon-scan` came from the Weekly Horizon scan. Follow "Flow: filing a scan file" in the Horizon skill: `watch_file` the findings, apply its `## Watch list changes` with `watchlists_apply` (the engine marks the scan's adds `added_by: horizon`, removes only entries the scan added, and queues a removal of one of the user's for them), then refresh `Bousleh Watch Lists.md` in Drive. Then settle the file `filed` with the first filed finding's id, or `skipped` if every finding was already filed and no watch list change applied. Say the watch list changes in your summary.
4. A file whose frontmatter has `bousleh: meet-notes` is a Google Meet notes doc (Gemini's notes, often with the transcript after them) that the Hourly Meet notes mirror copied from Drive. Treat it as a meeting transcript (next step), with these specifics:
   - `meeting` is the meeting's title, `held_at` when it started; the notes name the attendees (match people by `emails` first, as the notes give addresses). Put the frontmatter's `notes_url` in the meeting body as its source; don't register it as an asset.
   - Apply **Relevance first** before anything else: a meeting with nothing for the user is settled `skipped`.
   - Gemini's summary and "Suggested next steps" are drafts: a next step with no owner, or one owned by someone else that doesn't touch the user, follows the relevance rule, not the notes. Gemini mis-expands acronyms (it has called MCP "Multiplexed Chat Protocol"); use the glossary (`vault_search` with `kinds: [term]`).
   - If the meeting was already filed by hand (a held `meeting` with the same title and day), don't file it again: settle `skipped` and say so.
5. A meeting transcript: deposit a `meeting` (status `held`, attrs `held_at`, `attended_by` links to people, body a short summary), or move the planned one to `held` (see "Meetings"). The raw transcript stays in `inbox/processed`. Then file its atoms with `from_moment` → the meeting.
6. Anything else (a phone dictation, a note): the dump flow above.
7. Settle every file once with `inbox_settle`:
   - Objects written: `filed`, with the dump or meeting as `object_id`. If some atoms were ambiguous, settle `filed` first, then `queue_add` them.
   - Nothing could be placed: `queue_add` with `source_sha256`, which settles it as `queued`.
   - Nothing worth keeping: `skipped`.

## Flow: clearing the queue

`queue_list`, then one item at a time: say what it is and why it was queued, ask the one missing thing, then `queue_resolve` with `file` and the overrides, or `discard` with a note.

## Unattended runs

When the Hourly inbox sweep starts Capture, nobody is there to answer. Ask nothing: queue whatever you would have asked about, and end with a short summary of filed, queued, skipped and failed counts.

## Output

Stays in the conversation: a short read-back the user can listen to. No artifact.
