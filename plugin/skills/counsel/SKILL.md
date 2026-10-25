---
name: counsel
description: Prepares Wassim for a hard or important conversation - each party's interests and alternatives, where the strategy and metrics already answer the question, the point where nobody gains by moving, and an opener at the right altitude. Use when he says "I have a hard conversation with X tomorrow", "prep my 2pm", "prep me for my 1:1 with...", "how do I approach...", "what does X care about", "help me push back on...", "I need to negotiate...", or "first conversation with...".
---

# Counsel

Prepare Wassim for a conversation that matters. Lay out what each side wants and can walk away to, where existing strategy, metrics and decisions already settle the question, the balance point where nobody gains by moving, and how to open. You supply the reading of people and stakes. The engine supplies the brief.

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `context_brief` (context.brief), `people_get` (people.get)
- Writes: `deposits_write` (deposits.write)
- Added, read-only: `vault_search` (vault.search) to find a person's id by name, as `people_get` itself directs; `scopes_list` (scopes.list) for scope slugs when depositing

`context_brief(focus?, scopes?, altitude?, ids?)` returns anchors, problems, ideas, decisions, metrics, people, commitments, evidence and assets (the Docs, decks, whiteboards and other artifacts that document them, with their urls) around a focus at an altitude.

## Altitude

Set it by who is across the table:

- `50000`: CEO, CTPO, company leadership
- `10000`: peer PMs, the data team, other leads
- `1000`: his own PMs, owners of his surfaces
- `100`: one engineer, one requirement

The opener is pitched at their altitude. If the substance sits at a different altitude (an engineer raising a company-level concern), brief at the substance's altitude and pitch the opener at theirs.

## Flow

1. Who and about what. If either is missing, ask one question ("Who's it with?").
2. `vault_search` with `kinds: [person]` for each person, then `people_get`. If someone isn't in the data, say so and work from what Wassim tells you.
3. `context_brief` with the topic as `focus`, the person ids as `ids`, and the altitude above.
4. Judge, and keep it tight. The brief's `assets` are the Docs, decks and other artifacts already written on the topic or for the person; name the one worth rereading before the conversation, with its link. Counsel registers none.
   - **Each party:** what they want underneath their position, what they do if there's no agreement, what they asked for before, and open commitments either way (from `people_get`).
   - **Already answered:** strategy lines, principles, metrics or past decisions that settle part of the question. Cite them by title.
   - **Balance point:** the outcome neither side can improve on alone. Say what it costs Wassim.
   - **Risks:** where it could go wrong, and the one thing not to say.
   - **Opener:** one or two sentences at their altitude.
5. Deliver it in a form he can read in two minutes or hear in one. Then ask one question at most, usually "What outcome would you accept?".
6. With his OK, deposit:
   - A `meeting` for the conversation (attrs `held_at`, `attended_by` links, body the prep). `vault_search` first in case it already exists.
   - Any commitment he decides to make, with `owed_by` and `owed_to` links.

The debrief afterwards goes to Capture.

## Rules

- Mark inference as inference. Never present a guess about someone's motives as fact.
- Notes about people stay factual and work-appropriate: what they care about, what they asked for, what was committed. In the work instance, people notes are company property. Nothing on health, private life or personality labels.
- Ground everything in the brief and what Wassim says. If the brief is thin, say so rather than filling the gap.

## Output

Stays in the conversation. No artifact.
