---
name: workshop
description: Generates ideas against your problems and ranks them against your metrics and strategy, then lays them out on a whiteboard (or a tab in the scope's Claude Doc) or hands the top one to a POC plugin, when one is installed. Use when you say "given all this, what could we do?", "let's workshop X", "brainstorm", "ideas for...", "what are our options", "rank these", "which one should we bet on", "put it on a whiteboard", "make a POC of this", or "prototype this".
---

# Workshop

Generate options for a problem and rank them against what the user's strategy and metrics say matters. You supply the ideas and the ranking. The engine stores the ones they keep.

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `context_brief` (context.brief), `metrics_list` (metrics.list)
- Writes: `deposits_write` (deposits.write), `vault_link` (vault.link) to tie an existing idea to the problem, `assets_add` (assets.add) to register every whiteboard, Doc or design you make or update
- Added, write: `vault_supersede` (vault.supersede), only to set `rank` on ideas that already exist and to mark an idea `running` when the user starts it
- Reads too: `signals_patterns` (signals.patterns), to weigh the problem's evidence by how often it comes up
- Added, read-only: `vault_search` (vault.search) to find the problem; `scopes_list` (scopes.list) for scope slugs; `assets_list` (assets.list) to find the whiteboard or Doc that already exists for it or its scope

`context_brief(focus?, scopes?, altitude?, ids?)` returns anchors, problems, ideas, decisions, metrics, people, commitments, evidence and assets (the Docs, decks, whiteboards and other artifacts that document them, with their urls) around a focus at an altitude.

## Altitude

Generate at `1000`, the user's own surfaces. Go up to `10000` when the ideas need other teams to move. Drop to `100` when turning one idea into a POC brief.

## Flow

1. **The problem.** `vault_search` with `kinds: [problem]`. Workshop only works on `open` problems (older ones with no status read as open). If several fit, ask which one. If none exists, offer to frame it in Shape first, or work from what they say. If the one they mean is `solved` or `dropped`, don't workshop it: say so, and offer Shape to reopen it if it has come back.
2. **The brief.** `context_brief` with the problem as `focus` and its id in `ids`. `metrics_list` for its scope. Note existing ideas on it so you don't repeat them.
3. **Generate** five to eight distinct ideas: at least one cheap and boring, one ambitious. For each, one line plus:
   - the metric it would move,
   - the strategy line it serves,
   - its riskiest assumption.
4. **Rank** (existing ideas included; the brief shows their current `rank`) by: likely effect on the named metrics, fit with the strategy (an `aligned` line weighs more than a `forming` one), strength of the evidence behind the problem (`signals_patterns`: how many signals, from how many people), and cost and reversibility. Give each rank a one-line reason. Say which ones you'd drop.
5. **Adjust.** Ask one question at a time ("Anything missing before I save these?").
6. **Deposit** the ideas the user keeps with `deposits_write`: kind `idea`, status `open`, at their altitude, in the problem's scope, attrs `rank` (1 is the top), links `addresses` → the problem and `part_of` → its initiative or strategy if there is one. Put the reason for the rank in the body.
   - Ideas already on the problem that you re-ranked: `vault_supersede` each one with only `attrs: { rank }`. Rank the whole set together, so two ideas never share a rank. Leave status alone.
   - An idea the user wants to bet on now can be written as `bet` straight away, but only with a `hypothesis` and `kill_criteria` they agree to.
   - Starting an idea: when the user says they are starting or picking one up (an experiment under way, a build in progress), `vault_supersede` it to `running` right away, without asking, and say so. Never set `running` speculatively, only on their word that it's being tried now. When it finishes, a decision concludes it (Shape), or it's parked or dropped.
   - Any other change to an existing idea (to bet, parked, dropped, concluded) is Shape's job.

## Hand-offs

- **Laying the ideas out:** when the user wants to see or rearrange them, alone or with their PMs:
  - **On a Claude Whiteboard,** when the account has that artifact type: the problem, the ranked ideas, and the metric each moves.
  - **Otherwise in the scope's Claude Doc** (the account may have no Whiteboard type): `assets_list` with the scope (and `documents` set to the problem's id) to find the Doc that already exists for it, and add a tab to it (or a section, if tabs aren't available) named after the problem. Never make a second Doc when one already exists for the scope; make a new Doc only when there is none. In the tab: the problem in two lines with its evidence, then a table with one row per idea: rank, the idea, what it settles or the metric it moves, cost, riskiest assumption, and status (`open`, `running`, `bet`, `parked`, `dropped`, `concluded`, exactly as the data has it, never typed by hand).
  - Either way, the layout mirrors the data. Rank and status changes are made in Bousleh (rank here with `vault_supersede`, status in Shape), then the tab or board is regenerated from the data; changes they make on it come back by saying them here.
- **Design:** when the user needs to see it before building, mock it up in Claude Design first.
- **A POC:** for "make a POC of this", hand off to a POC plugin such as `specdr-poc`, when it is installed, with a short brief: the problem and its evidence in two lines, the idea, the hypothesis and kill criteria, and the metric it should move. Let the plugin ask its own decisions. When no POC plugin is installed, say so and offer a POC brief in the conversation instead.

## Registering assets

Right after you create or update a Claude Whiteboard, a Doc tab, a Design or any other page, call `assets_add` with its url, a short title, its `type` (`whiteboard`, `doc`, `design`, `page`), the scope slugs, and `documents` → the ids of the problem and every idea on it (for a tab in an existing Doc, the Doc's url: the call adds the new `documents` links to it). Do it every time, including for an update: calling it again for the same url is safe, adds any new `documents` links and records a changed title. If the asset already exists, `assets_list` with `documents` set to the object's id finds it, so update it rather than making a second one.

A POC the plugin puts live is registered the same way, as a `page` documenting the idea.

## Output

The ranking stays in the conversation; the Whiteboard or Doc tab and the POC hand-off on request.
