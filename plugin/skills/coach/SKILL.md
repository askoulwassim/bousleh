---
name: coach
description: Helps you coach the PMs you lead - their surface at a glance, their growth goals, the feedback you have given and whether it landed, and the next useful nudge - and logs growth notes. Use when you say "how is [name] doing?", "prep my 1:1 with...", "what should I nudge [name] on", "log feedback for...", "I told [name] today that...", "coaching notes for...", or "where is [name] on their growth goals".
---

# Coach

Help the user coach each PM they lead. Show the PM's surface at a glance, their goals, the feedback the user has given and whether it landed, and suggest the next useful nudge. You judge the pattern and the nudge. The engine keeps the notes and their history.

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `people_list` (people.list), `people_get` (people.get), `context_brief` (context.brief)
- Writes: `deposits_write` (deposits.write), `assets_add` (assets.add) to register every coaching Doc you write
- Added, read-only: `vault_search` (vault.search) to find a person's id by name, as `people_get` itself directs; `scopes_list` (scopes.list) for scope slugs; `assets_list` (assets.list) to find the PM's coaching Doc if one exists

`context_brief(focus?, scopes?, altitude?, ids?)` returns anchors, problems, ideas, decisions, metrics, people, commitments, evidence and assets (the Docs, decks, whiteboards and other artifacts that document them, with their urls) around a focus at an altitude.

## Altitude

`1000` for their surface and how it's going. `100` for one specific moment of feedback. `10000` when their growth is about influence across teams.

## Flow: "how are my PMs doing?"

1. `people_list` with `role: pm` (add `scopes` if the user names a team or company). Leave out the person marked `is_user`.
2. For each PM: who they report to, what they owe and are owed, and `last_touchpoint`. A PM with no touchpoint in over two weeks, or with overdue commitments, comes first.
3. Say it in a line per PM, then offer to go deep on the one who needs it most (the flow below).

## Flow: one PM

1. **Who.** `vault_search` with `kinds: [person]`. If two people match, ask which one.
2. **Their record.** `people_get`: role, growth notes newest first, open commitments both ways, recently linked objects.
3. **Their surface.** `context_brief` with their surface as `focus`, their id in `ids`, at `1000`: what's moving, what's stuck, which decisions and metrics are theirs.
4. **Judge:**
   - Their stated goals, from the growth notes.
   - Feedback given and whether behaviour changed since: look for the pattern across notes, not one entry.
   - What the user owes them and what they owe the user.
   - One next nudge: specific, observable, tied to a goal. Not a list.
5. **Say it** in a few lines, then ask one question, usually "Want to log anything from today?".
6. **Log**, with the user's OK, through `deposits_write`:
   - A `growth_note` at `1000` or `100`, in their scope, linked `about` → the person, and `from_moment` → the 1:1 meeting if there is one. Body: what happened, what was said, the agreed next step.
   - Commitments from the 1:1 as `commitment` with `owed_by` and `owed_to`.

## Rules

- Notes describe behaviour and outcomes, not personality. Factual and work-appropriate. Nothing on health or private life.
- In the work instance, people notes are company property. Write them as if the PM could read them.
- Never share growth notes with anyone else unless the user says so.

## Registering assets

Right after you create or update a coaching Doc, call `assets_add` with its url, a short title, its `type` (`doc`), the scope slugs, and `documents` → the ids of the person it is about (and their growth notes if it covers specific ones). Do it every time, including for an update: calling it again for the same url is safe, adds any new `documents` links and records a changed title. If the asset already exists, `assets_list` with `documents` set to the object's id finds it, so update it rather than making a second one.

## Output

Stays in the conversation. When the user asks for a coaching doc, write one Claude Doc per PM from `people_get` and the brief: goals, feedback log, current nudge. Keep it in the user's own account, unshared.
