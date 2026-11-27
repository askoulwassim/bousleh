---
name: communicate
description: Renders one source of truth for a specific audience - leadership, engineering, design, operations, analysts - as a doc, a deck or a short message, at the altitude that audience works at. Use when you say "tell engineering", "brief Rowan", "write this up for leadership", "make a deck on...", "slides for the all-hands", "update for the analysts", "how do I explain X to Y", or "draft the message to...".
---

# Communicate

Take what the user's data holds and render it for one audience. The truth doesn't change between audiences; the altitude, the order and the level of detail do. You judge what this audience needs to know, decide or do. The engine supplies the brief. Communicate writes nothing to the user's data except the record of what it produced (`assets_add`).

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `context_brief` (context.brief)
- Writes: `assets_add` (assets.add) to register every Doc, deck or page you produce
- Added, read-only: `vault_search` (vault.search) to find the object or person the message is about; `vault_get` (vault.get) to read a decision in full (the Product Weekly rules); `assets_list` (assets.list) to find the doc or deck that already exists for it; `scopes_list` (scopes.list) for scope slugs

`context_brief(focus?, scopes?, altitude?, ids?)` returns anchors, problems, ideas, decisions, metrics, people, commitments, evidence and assets (the Docs, decks, whiteboards and other artifacts that document them, with their urls) around a focus at an altitude.

## Altitude by audience

| Audience | Altitude | Lead with |
| --- | --- | --- |
| CEO, CTPO, leadership | `50000` | The decision or ask, the bet, the metric it moves |
| Other PMs, the data team, cross-team leads | `10000` | What changes for them, dependencies, dates |
| The user's own PMs, design, operations | `1000` | The problem, the evidence, what's decided and what's open |
| An engineer, analysts on one question | `100` | The requirement, the acceptance test, who to ask |

If one message goes to a mixed room, pitch it at the highest altitude present and put the detail in an appendix.

## Flow

1. Audience and ask. If the audience is missing, ask one question: "Who's it for?".
2. `context_brief` with the topic as `focus`, at that audience's altitude, in the right scope. Add ids from `vault_search` if the user names a specific strategy, problem or decision.
3. Judge:
   - What this audience must decide or do, in one sentence. Lead with it.
   - Only what the brief holds. Where a fact or number is missing, mark it as a gap; never fill it in.
   - Status honesty: a `forming` or `contested` strategy is presented as a draft. An idea that's a `bet` shows its hypothesis and kill criteria; a `running` one is presented as being tried, not as decided. A `solved` or `dropped` problem is presented as closed, with the decision behind it.
   - What to leave out for this audience.
4. Pick the surface:
   - **Docs** for written briefs, updates, one-pagers and anything people will comment on.
   - **Slides** for a room: leadership reviews, all-hands, a pitch.
   - A short email or chat message stays in the conversation.
5. Produce it, then read back the headline and the one ask in a sentence each.

If the user makes a new decision or commitment while drafting, hand it to Capture. Once a strategy has been shared, Shape moves it to `communicated`.

## The Product Weekly

A recurring update, such as a weekly email to the user's manager, the exec team and the other PMs, can have rules of its own: a format and the points the user pushed back on before, never to be repeated. They live in a `decision` named for the update (here "Product Weekly"), and optionally in a playbook in the user's Claude Project. Before drafting an issue:

1. Load the rules: `vault_search` "Product Weekly" with `kinds: [decision]` and read the newest decision with `vault_get`; also read the playbook in the user's Claude Project when there is one and the Projects tool is available. The playbook holds the last approved issue (use it as the template) and the carry-over items for the next issue. If neither can be read, say so before drafting.
2. Draft only from what the user lists, plus the playbook's carry-over. Offer anything else once, as a suggestion, outside the draft.
3. Before showing the draft, check it line by line against every rule in the decision and the playbook, and fix what fails. The usual misses: pitched below the most senior reader (versions, internal jargon), a current-state gap that reads as alarming, an overclaim ("fully aligned") or a date the user didn't give, items the user didn't ask for, a sign-off that doesn't match the calendar, and a missing thank-you (ask the user who helped).
4. When the user pushes back on a new point, add it to the playbook so the next issue starts from it, and hand the new rule to Capture to file against the decision.

## Rules

- Artifacts are written from the data, never edited as the truth. Comments on them come back through Capture.
- Work artifacts live in the work account and are shared from there; personal ones stay personal.

## Registering assets

Right after you create or update a Claude Doc, a Slides deck or a page, call `assets_add` with its url, a short title, its `type` (`doc`, `slides`, `page`), the scope slugs, and `documents` → the ids of the objects it renders: the strategy, problem, decision or bet it is about. Do it every time, including for an update: calling it again for the same url is safe, adds any new `documents` links and records a changed title. If the asset already exists, `assets_list` with `documents` set to the object's id finds it, so update it rather than making a second one.

A short message that stays in the conversation is not an asset.

## Output

Claude Docs or Slides, or a message in the conversation.
