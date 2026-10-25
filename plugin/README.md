# Bousleh plugin

The eight Bousleh modes, plus Drop for phone captures, as Claude skills in one plugin named `bousleh`.

| Skill | Job | Surface |
| --- | --- | --- |
| Capture | Raw input and inbox files to typed, linked deposits; ambiguity to the queue | Conversation |
| Pulse | Where Wassim stands: commitments, meetings (calendar and Bousleh), metrics, findings, bets; closes commitments | Conversation, Home |
| Counsel | Prep for a hard conversation: interests, alternatives, balance point, opener; reads the meeting's calendar event | Conversation |
| Shape | Spar on strategy and problems; bets, decisions, metrics | Docs |
| Workshop | Ideas against a problem, ranked against metrics and strategy | Whiteboard where the account has it, else a tab in the scope's Doc; Design; Specdr POC lane |
| Communicate | One truth rendered per audience | Docs, Slides |
| Coach | Coaching the PMs he leads; growth notes | Conversation, Docs |
| Horizon | The outside view: digest, watch lists, the reading queue, the Weekly Horizon scan and the watch list changes it proposes | Home, Docs |
| Drop | Phone dictation saved verbatim to the Drive folder "Bousleh Inbox" for Capture | Google Drive |

## Requirements

The eight modes expect the Bousleh MCP server, registered locally as `bousleh` on the Mac. Drop needs only the Google Drive connector, so it works on the phone. Pulse and Counsel also read the Google Calendar connector when the account has it (read-only: they never create, change or answer events); without it they work from Bousleh alone and say the calendar wasn't read. `scripts/setup-mac.sh` sets all of it up (see SETUP.md at the repo root).

Skills name tools as the server exposes them, with underscores (`inbox_drop`), and the dotted op name alongside (`inbox.drop`). Claude Code shows them as `mcp__bousleh__inbox_drop`.

## Install

- **Claude Code:** the setup script registers the repo as a local marketplace (`.claude-plugin/marketplace.json` at the repo root) and installs `bousleh@bousleh`. Skills are read from the repo, so edits show up at the next session or after `/reload-plugins`. For a quick try without installing, run `claude --plugin-dir plugin`.
- **Your Claude account (Desktop chat, web, phone):** add this repo as a marketplace once per account (Customize > Plugins > Add > Add marketplace > Add from a repository: `askoulwassim/bousleh`), then add Bousleh. Updates come from GitHub. Fallback: upload `dist/bousleh.plugin`, which the setup script builds.

`claude plugin validate plugin` passes.

## Rules every skill follows

- Claude supplies the judgment, the engine does the mechanics. Skills say what to judge (kind, altitude, scope, links, what matters). They never write files or SQL.
- Ops follow the "Which skill calls which ops" table in `AGENTS.md`. Additions are listed below.
- At most one question to Wassim at a time. Answers are short enough to listen to.
- Assets: every Doc, Slides deck, whiteboard, design, dashboard or page a skill creates or updates is registered with `assets_add` (assets.add) right after, with its url and `documents` links to the objects it is about. Capture registers artifact and repo urls it finds in dumps and inbox files. `context_brief` lists them in its `assets` section.
- Altitude: `50000` company, `10000` cross-team, `1000` own surfaces, `100` one engineer or requirement. Each skill names the altitude it works at and when to change it.

## Ops beyond the AGENTS.md table

| Skill | Op | Why |
| --- | --- | --- |
| Capture | `inbox.settle` (write) | Closes out each inbox file after filing. On the intake branch. |
| Capture | `inbox.sweep` (write) | Only when Wassim asks for a fresh sweep in a session; the Hourly inbox sweep already runs it. |
| Capture | `queue.list` (read) | Needed to clear the queue with `queue.resolve`. |
| Capture | `vault.get` (read) | To check a candidate before linking or queueing. |
| Capture, Counsel, Shape, Workshop, Communicate, Coach, Horizon | `scopes.list` (read) | Every deposit and asset needs scope slugs. |
| Counsel, Shape, Workshop, Communicate, Coach | `vault.search` (read) | To find an id by name; `people.get` itself says to. |
| Shape | `vault.get` (read) | To read the object being shaped and its history. |
| Shape, Workshop, Communicate, Coach, Horizon, Pulse | `assets.list` (read) | To find the Doc, deck or whiteboard already registered for an object or scope before making a new one (Workshop adds a tab to the scope's Doc instead of a second Doc), and to answer "where's the doc on X?". |
| Capture, Counsel | `vault.supersede` (write) | To move a planned meeting to `held` once it has happened (Counsel also updates the prep on it), and to add an email address to a person who exists (Counsel only on Wassim's yes). |
| Pulse, Counsel | `people.list` (read) | To match calendar attendees to people by their `emails`. |
| Pulse, Counsel | Google Calendar connector (read) | The calendar is the source for the schedule; Bousleh keeps only meetings with prep or notes. Pulse reads today's events, Counsel the event for the meeting it preps. |
| Workshop | `vault.supersede` (write) | Only to set `rank` on ideas that already exist, and to mark an idea `running` when Wassim says he is starting it. |
| Horizon | `vault.supersede` (write) | Only to move a finding through the reading queue (`to_read`, `read`, `dismissed`). |
| Horizon | `queue.list` (read), `queue.resolve` (write) | Only for the removals `watchlists.apply` queued for Wassim: list them, and resolve one once he has decided. |

## Gaps

Ops or data a mode needs that don't exist yet. Not invented here.

1. ~~Linking existing objects outside Capture.~~ Resolved Oct 25: Shape, Workshop and Horizon have `vault.link`.
2. **Capture can't change existing objects.** No `vault.supersede` (except to move a planned meeting to held, or to add a person's email) or `commitments.close` in its row, so "park that idea" or "that's done" said in a dump is read back as "for Shape" or "for Pulse" (or deposited as a linked observation in unattended runs).
3. ~~Coach has no list of people by role.~~ Resolved Oct 25: `people.list` filters by role, scope and org, with each person's manager, open commitments and last touchpoint.
4. ~~Pulse has no metric history.~~ Resolved Oct 25: `metrics.history` returns every effective reading; `metrics.list` gives each metric's last change, and `pulse.today` has `metric_movement` (and `touchpoints_due`).
5. **Horizon scan files cross two skills.** Reading and settling inbox files are Capture's ops; filing findings (`watch.file`) is Horizon's. The skills hand off: Capture takes the file, Horizon files it, Capture settles.
6. ~~The cloud scan can't read watch lists.~~ Resolved Oct 25: the Mac writes them to `Bousleh Watch Lists.md` in the Drive folder "Bousleh" (Horizon after every `watchlists.set`, the Hourly inbox sweep after it files a scan), and the Weekly Horizon scan reads that file instead of a copy in its prompt. Each scan proposes watch list changes, which filing applies with `watchlists.apply`: entries carry `added_by`, and the op itself refuses to remove one of Wassim's entries (it queues the suggestion for him instead).
7. ~~Idea ranking has no field.~~ Resolved Oct 25: ideas have a `rank` attr (1 the top), which Workshop sets and the brief sorts by. (Ideas link to their problem with `addresses`, also Oct 25.)
8. ~~Horizon's reading and listening queue has no op or kind.~~ Resolved Oct 25: a finding's status is the queue (new, to_read, read, dismissed), and `watch.digest` filters by it.
9. ~~Feedback patterns.~~ Resolved Oct 25: `signals.patterns` counts signals by tag ("heard N times from M people"). **Load across both worlds** (the signal bridge) still isn't built, so Pulse leaves it out.
10. ~~A planned meeting.~~ Resolved Oct 25: meetings are `planned` or `held`. Counsel deposits prep as a planned meeting, superseded to held once it happens.
11. ~~Initiatives in the brief.~~ Resolved Oct 25: initiatives have a status, `started_at` and `target_date`, and `context.brief` has an `initiatives` section with each one's owner. People in the brief carry `reports_to`.
12. ~~Recurring meetings.~~ Resolved Oct 25: Bousleh doesn't store the schedule. Pulse and Counsel read the Google Calendar connector and merge its events with Bousleh's planned and held meetings, matching attendees by the person `emails` attr. `pulse.today` also lists open commitments with no due date (`no_due`).
13. ~~Problems that are done, ideas under way.~~ Resolved Oct 25: problems are `open`, `solved` or `dropped` (old ones read as open), and the brief leaves solved and dropped ones out unless they're near its centre. Ideas can be `running` (being tried now); a decision with `concludes` ends a bet or a running idea, and `pulse.today`'s `open_bets` lists both.
