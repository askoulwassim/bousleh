---
name: communicate
description: Renders one source of truth for a specific audience - leadership, engineering, design, operations, analysts - as a doc, a deck or a short message, at the altitude that audience works at. Use when he says "tell engineering", "brief Peter", "write this up for leadership", "make a deck on...", "slides for the all-hands", "update for the analysts", "how do I explain X to Y", or "draft the message to...".
---

# Communicate

Take what Wassim's data holds and render it for one audience. The truth doesn't change between audiences; the altitude, the order and the level of detail do. You judge what this audience needs to know, decide or do. The engine supplies the brief. Communicate writes nothing to his data.

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `context_brief` (context.brief)
- Writes: none
- Added, read-only: `vault_search` (vault.search) to find the object or person the message is about

`context_brief(focus?, scopes?, altitude?, ids?)` returns anchors, problems, ideas, decisions, metrics, people, commitments and evidence around a focus at an altitude.

## Altitude by audience

| Audience | Altitude | Lead with |
| --- | --- | --- |
| CEO, CTPO, leadership | `50000` | The decision or ask, the bet, the metric it moves |
| Other PMs, the data team, cross-team leads | `10000` | What changes for them, dependencies, dates |
| His own PMs, design, operations | `1000` | The problem, the evidence, what's decided and what's open |
| An engineer, analysts on one question | `100` | The requirement, the acceptance test, who to ask |

If one message goes to a mixed room, pitch it at the highest altitude present and put the detail in an appendix.

## Flow

1. Audience and ask. If the audience is missing, ask one question: "Who's it for?".
2. `context_brief` with the topic as `focus`, at that audience's altitude, in the right scope. Add ids from `vault_search` if he names a specific strategy, problem or decision.
3. Judge:
   - What this audience must decide or do, in one sentence. Lead with it.
   - Only what the brief holds. Where a fact or number is missing, mark it as a gap; never fill it in.
   - Status honesty: a `forming` or `contested` strategy is presented as a draft. An idea that's a `bet` shows its hypothesis and kill criteria.
   - What to leave out for this audience.
4. Pick the surface:
   - **Docs** for written briefs, updates, one-pagers and anything people will comment on.
   - **Slides** for a room: leadership reviews, all-hands, a pitch.
   - A short email or chat message stays in the conversation.
5. Produce it, then read back the headline and the one ask in a sentence each.

If Wassim makes a new decision or commitment while drafting, hand it to Capture. Once a strategy has been shared, Shape moves it to `communicated`.

## Rules

- Artifacts are written from the data, never edited as the truth. Comments on them come back through Capture.
- Work artifacts live in the work account and are shared from there; personal ones stay personal.

## Output

Claude Docs or Slides, or a message in the conversation.
