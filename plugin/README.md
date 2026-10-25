# Bousleh plugin

The eight Bousleh modes as Claude skills, in one plugin named `bousleh`.

| Skill | Job | Surface |
| --- | --- | --- |
| Capture | Raw input and inbox files to typed, linked deposits; ambiguity to the queue | Conversation |
| Pulse | Where Wassim stands: commitments, meetings, metrics, findings, bets; closes commitments | Conversation, Home |
| Counsel | Prep for a hard conversation: interests, alternatives, balance point, opener | Conversation |
| Shape | Spar on strategy and problems; bets, decisions, metrics | Docs |
| Workshop | Ideas against a problem, ranked against metrics and strategy | Whiteboard, Design, Specdr POC lane |
| Communicate | One truth rendered per audience | Docs, Slides |
| Coach | Coaching the PMs he leads; growth notes | Conversation, Docs |
| Horizon | The outside view: digest, watch lists, the Daily Horizon scan | Home, Docs |

## Requirements

The skills expect the Bousleh MCP server, registered locally as `bousleh` on the Mac (stdio; see `AGENTS.md`, "Run and test"). This plugin does not bundle or configure it. Without it, every skill except the Daily Horizon scan setting of Horizon has nothing to call.

Skills name tools as the server exposes them, with underscores (`inbox_sweep`), and the dotted op name alongside (`inbox.sweep`). Claude Code shows them as `mcp__bousleh__inbox_sweep`.

`context.brief` and `pulse.today` are being built in parallel. The skills use them by name and intent:

- `context.brief(focus?, scopes?, altitude?, ids?)`: anchors, problems, ideas, decisions, metrics, people, commitments and evidence around a focus at an altitude.
- `pulse.today(date?, scopes?)`: commitment buckets, today's meetings, inbox and queue counts, stale metrics, new findings, open bets.

## Use

For local testing in Claude Code:

```sh
claude --plugin-dir plugin
```

Skills are then available as `/bousleh:capture`, `/bousleh:pulse` and so on, and load on their own when what Wassim says matches a skill's description. The plugin isn't in a marketplace yet. `claude plugin validate plugin` passes.

## Rules every skill follows

- Claude supplies the judgment, the engine does the mechanics. Skills say what to judge (kind, altitude, scope, links, what matters). They never write files or SQL.
- Ops follow the "Which skill calls which ops" table in `AGENTS.md`. Additions are listed below.
- At most one question to Wassim at a time. Answers are short enough to listen to.
- Altitude: `50000` company, `10000` cross-team, `1000` own surfaces, `100` one engineer or requirement. Each skill names the altitude it works at and when to change it.

## Ops beyond the AGENTS.md table

| Skill | Op | Why |
| --- | --- | --- |
| Capture | `inbox.settle` (write) | Closes out each inbox file after filing. On the intake branch. |
| Capture | `inbox.sweep` (write) | Only when Wassim asks for a fresh sweep in a session; the Daily inbox sweep already runs it. |
| Capture | `queue.list` (read) | Needed to clear the queue with `queue.resolve`. |
| Capture | `vault.get` (read) | To check a candidate before linking or queueing. |
| Capture, Counsel, Shape, Workshop, Coach, Horizon | `scopes.list` (read) | Every deposit needs scope slugs. |
| Counsel, Shape, Workshop, Communicate, Coach | `vault.search` (read) | To find an id by name; `people.get` itself says to. |
| Shape | `vault.get` (read) | To read the object being shaped and its history. |

## Gaps

Ops or data a mode needs that don't exist yet. Not invented here.

1. ~~Linking existing objects outside Capture.~~ Resolved Oct 25: Shape, Workshop and Horizon have `vault.link`.
2. **Capture can't change existing objects.** No `vault.supersede` or `commitments.close` in its row, so "park that idea" or "that's done" said in a dump is read back as "for Shape" or "for Pulse" (or deposited as a linked observation in unattended runs).
3. **Coach has no list of people by role.** "How are my PMs doing?" needs something like a `people.list` filtered by role; `vault.search` needs a word to search for.
4. **Pulse has no metric history.** `metrics.list` returns only the latest reading, so "metric movement" needs the previous readings (a readings-history op).
5. **Horizon scan files cross two skills.** Reading and settling inbox files are Capture's ops; filing findings (`watch.file`) is Horizon's. The skills hand off: Capture takes the file, Horizon files it, Capture settles.
6. **The cloud scan can't read watch lists.** v0 copies them into the "Daily Horizon scan" task prompt, which Horizon must refresh after every `watchlists.set`.
7. **Idea ranking has no field.** Idea attrs are `hypothesis` and `kill_criteria` only, so Workshop keeps the rank in the idea body. (Ideas now link to their problem with `addresses`, added Oct 25.)
8. **Horizon's reading and listening queue** has no op or kind.
9. **Feedback patterns** (`signals.patterns`) and **load across both worlds** (the signal bridge) aren't built, so Pulse leaves them out.
10. **A planned meeting.** `meeting` has only `held_at`; Counsel deposits prep as a meeting dated in the future.
