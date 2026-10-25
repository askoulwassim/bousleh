---
name: workshop
description: Generates ideas against Wassim's problems and ranks them against his metrics and strategy, then lays them out on a whiteboard or hands the top one to the Specdr POC lane. Use when he says "given all this, what could we do?", "let's workshop X", "brainstorm", "ideas for...", "what are our options", "rank these", "which one should we bet on", "put it on a whiteboard", "make a POC of this", or "prototype this".
---

# Workshop

Generate options for a problem and rank them against what Wassim's strategy and metrics say matters. You supply the ideas and the ranking. The engine stores the ones he keeps.

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `context_brief` (context.brief), `metrics_list` (metrics.list)
- Writes: `deposits_write` (deposits.write), `vault_link` (vault.link) to tie an existing idea to the problem, `assets_add` (assets.add) to register every whiteboard or design you make
- Added, write: `vault_supersede` (vault.supersede), only to set `rank` on ideas that already exist
- Reads too: `signals_patterns` (signals.patterns), to weigh the problem's evidence by how often it comes up
- Added, read-only: `vault_search` (vault.search) to find the problem; `scopes_list` (scopes.list) for scope slugs; `assets_list` (assets.list) to find a whiteboard that already exists for it

`context_brief(focus?, scopes?, altitude?, ids?)` returns anchors, problems, ideas, decisions, metrics, people, commitments, evidence and assets (the Docs, decks, whiteboards and other artifacts that document them, with their urls) around a focus at an altitude.

## Altitude

Generate at `1000`, his own surfaces. Go up to `10000` when the ideas need other teams to move. Drop to `100` when turning one idea into a POC brief.

## Flow

1. **The problem.** `vault_search` with `kinds: [problem]`. If several fit, ask which one. If none exists, offer to frame it in Shape first, or work from what he says.
2. **The brief.** `context_brief` with the problem as `focus` and its id in `ids`. `metrics_list` for its scope. Note existing ideas on it so you don't repeat them.
3. **Generate** five to eight distinct ideas: at least one cheap and boring, one ambitious. For each, one line plus:
   - the metric it would move,
   - the strategy line it serves,
   - its riskiest assumption.
4. **Rank** (existing ideas included; the brief shows their current `rank`) by: likely effect on the named metrics, fit with the strategy (an `aligned` line weighs more than a `forming` one), strength of the evidence behind the problem (`signals_patterns`: how many signals, from how many people), and cost and reversibility. Give each rank a one-line reason. Say which ones you'd drop.
5. **Adjust.** Ask one question at a time ("Anything missing before I save these?").
6. **Deposit** the ideas he keeps with `deposits_write`: kind `idea`, status `open`, at their altitude, in the problem's scope, attrs `rank` (1 is the top), links `addresses` → the problem and `part_of` → its initiative or strategy if there is one. Put the reason for the rank in the body.
   - Ideas already on the problem that you re-ranked: `vault_supersede` each one with only `attrs: { rank }`. Rank the whole set together, so two ideas never share a rank. Leave status alone.
   - An idea he wants to bet on now can be written as `bet` straight away, but only with a `hypothesis` and `kill_criteria` he agrees to.
   - Changing an existing idea (to bet, parked, dropped) is Shape's job.

## Hand-offs

- **Whiteboard:** when he wants to rearrange things, alone or with his PMs, lay out the problem, the ranked ideas, and the metric each moves on a Claude Whiteboard. The data stays the truth; changes he makes there come back by saying them here.
- **Design:** when he needs to see it before building, mock it up in Claude Design first.
- **Specdr POC lane:** for "make a POC of this", run `/specdr-poc:go` with a short brief: the problem and its evidence in two lines, the idea, the hypothesis and kill criteria, and the metric it should move. Let the POC lane ask its own decisions. Use it only in the instance where the Specdr Hub is connected.

## Registering assets

Right after you create or update a Claude Whiteboard, a Design or any other page, call `assets_add` with its url, a short title, its `type` (`whiteboard`, `design`, `page`), the scope slugs, and `documents` → the ids of the problem and the ideas on it. Do it every time, including for an update: calling it again for the same url is safe, adds any new `documents` links and records a changed title. If the asset already exists, `assets_list` with `documents` set to the object's id finds it, so update it rather than making a second one.

A POC the Specdr lane puts live is registered the same way, as a `page` documenting the idea.

## Output

The ranking stays in the conversation; Whiteboard and the POC lane on request.
