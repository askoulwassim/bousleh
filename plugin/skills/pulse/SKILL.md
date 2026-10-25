---
name: pulse
description: Wassim's picture of where he stands - commitments due or undated, today's meetings (from his calendar and Bousleh), metrics that are stale or moving, new Horizon findings, open bets, and what's waiting in the inbox and queue. Also closes commitments as done or dropped. Use when he says "where am I?", "morning", "what's on today", "what's due", "what do I owe", "who am I waiting on", "how's my week", "Friday review", "that's done", "mark that done", or "drop that one".
---

# Pulse

Give Wassim a short, honest picture of where he stands, so he picks the next move without opening anything. You judge what matters today. The engine assembles the facts.

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `pulse_today` (pulse.today), `commitments_list` (commitments.list), `metrics_list` (metrics.list), `metrics_history` (metrics.history) when he asks how a metric has moved, `people_list` (people.list) to match calendar attendees to people by email
- Writes: `commitments_close` (commitments.close); `vault_supersede` (vault.supersede) on a person only, to mark the user or, on his yes, to add an email address
- Added, read-only: `assets_list` (assets.list) for "where's the doc on X?"
- Google Calendar connector (your Claude account's calendar), read-only: today's events. Pulse never creates, changes or answers events.

`pulse_today(date?, scopes?, me?)` returns the commitment buckets (overdue and due today, split into owed by me, owed to me and other; `no_due`, open ones with no due date owed by him or to him, oldest first, at most ten a side with `more` counting the rest), the meetings filed in Bousleh for the day (each `planned` or `held`), the inbox and queue counts, stale metrics, `metric_movement` (metrics whose last reading moved, with the previous reading and the delta), `touchpoints_due` (stakeholders, PMs and engineers he hasn't met or noted anything about in over 14 days, never-touched first), new findings and open bets. "Me" is the person marked `is_user` (the person this Bousleh belongs to), so you don't pass it. If `me` comes back `inferred: true` or null, no one is marked yet: ask Wassim to confirm it's him, then `vault_supersede` his person with attrs `is_user: true` (or `deposits_write` a person for him with it). Only one person can be marked.

The Docs, decks, dashboards and whiteboards the other modes make are registered as assets, and `context_brief` lists them with their links. Pulse only reads them and registers none. For "where's the doc on X?", call `assets_list` with `documents` set to X's id when you have it (`pulse_today` and `commitments_list` carry the ids of bets, meetings and commitments), otherwise with the scope, and give the link.

## Meetings: the calendar and Bousleh

The calendar is the source for his schedule. Bousleh keeps only meetings that have prep or notes: a `planned` meeting holds Counsel's prep, a `held` one the debrief. So a standing meeting like a weekly sync is on the calendar and usually not in Bousleh. Build today's list from both:

1. If the Google Calendar connector is available, list today's events from his primary calendar (skip declined events and ones with no other attendees, unless they look like real work blocks he'd want named).
2. Merge with `pulse_today`'s `meetings`: a calendar event and a Bousleh meeting with the same start time (or, for a date-only Bousleh meeting, the same day and title) and overlapping attendees are the same meeting. Show it once, with the Bousleh status and the calendar time.
3. Match attendees to people: by email first (`people_list` gives each person's `emails`), else by name. When a known person matches by name and has no email yet, suggest adding it ("Peter's calendar email is peter@alethea.com: add it?"); on his yes, `vault_supersede` the person with `attrs: { emails: [...] }`, the whole list (attrs replace the key, they don't append). Pulse does this; a new person is Capture's.
4. A `planned` Bousleh meeting with no calendar event is still shown: say it isn't on the calendar.
5. Don't file meetings from the calendar. For a meeting worth prepping, offer Counsel; Counsel's prep creates the planned meeting.

If the Calendar connector isn't available in this session, work from `pulse_today` alone and say the calendar wasn't read.

## Altitude

Work at `1000` (his own surfaces) by default. For a Friday review or "how are we doing overall", go up to `10000` (cross-team). Go to `50000` only when he asks about company-level bets. Drop to `100` only when he asks about one specific commitment.

## Flow: morning, or "where am I?"

1. `pulse_today` for today, and today's calendar events (see "Meetings: the calendar and Bousleh"). Pass `scopes` only if he names a project or area ("where am I on Specdr?").
2. Judge what matters, in this order:
   1. Overdue commitments, then those due today. Name who each is owed to. Then the open commitments with no due date (`no_due`), oldest first: name the oldest one or two he owes (and any owed to him that have sat a while), and ask whether one needs a date.
   2. Today's meetings, merged from the calendar and `pulse_today`, that need prep. A `planned` meeting already has Counsel's prep in its body: offer to go over it. Offer Counsel for the hardest meeting that has none. A meeting from an earlier day still `planned` was never debriefed: offer Capture.
   3. Commitments others owe him that are overdue: who to nudge.
   4. Stale metrics (missed their cadence), metrics that moved (name the direction and size, and whether it's the way the strategy wants), and open bets that need a look.
   5. Touchpoints due: at most two people, the most important first (a stakeholder long untouched beats an engineer a few days over). Suggest a concrete touch: a 1:1, a message, sharing something he owes them.
   6. New findings worth acting on. Offer Horizon.
   7. Inbox and queue counts if above zero. Offer Capture.
3. Say it in about eight short lines he can listen to. Skip empty sections; don't list everything.
4. End with one question: the single most useful next move ("Want to prep the 2pm?").

Across both worlds: the signal bridge between the personal and work instances isn't built yet. If he has told you his load on the other side, use it; otherwise don't ask.

## Flow: Friday review

1. `pulse_today`, then `commitments_list` with `due_before` next Friday for what's coming. Next week's calendar, if the connector is available, for the meetings worth prepping.
2. `metrics_list` for the registry: which have a fresh reading, which are stale, which moved (`change`), which are still `idea` or `defined` and need instrumentation. For a metric that moved a lot, `metrics_history` shows whether it's a trend or one noisy reading.
3. `touchpoints_due` from `pulse_today`: who to see next week.
4. Judge: what slipped this week and why (from what he's said), what's at risk next week, the undated commitments (`no_due`) that need a date or should be dropped, and one thing to drop or renegotiate.
5. Ask one question at a time about anything that should be closed or dropped.

## Flow: closing a commitment

1. "That's done" or "drop it": find the commitment in `commitments_list` (filter by `owed_to`, `owed_by` or `scope` if he names them).
2. If more than one could match, ask which, naming each by title and who it's owed to.
3. `commitments_close` with `done` or `dropped`, and a one-line `note` on how it ended if he gave one.

A new commitment said during Pulse ("I also owe Lisa a reply") goes to Capture. Pulse only closes.

## Output

The answer stays in the conversation. Home, the Claude page, is where Pulse lives day to day: it reads `pulse_today` itself, so Pulse writes nothing for it. If Home exists, point him there for the full view.
