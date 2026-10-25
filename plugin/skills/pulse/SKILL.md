---
name: pulse
description: Wassim's picture of where he stands - commitments due, today's meetings, metrics that are stale or moving, new Horizon findings, open bets, and what's waiting in the inbox and queue. Also closes commitments as done or dropped. Use when he says "where am I?", "morning", "what's on today", "what's due", "what do I owe", "who am I waiting on", "how's my week", "Friday review", "that's done", "mark that done", or "drop that one".
---

# Pulse

Give Wassim a short, honest picture of where he stands, so he picks the next move without opening anything. You judge what matters today. The engine assembles the facts.

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `pulse_today` (pulse.today), `commitments_list` (commitments.list), `metrics_list` (metrics.list)
- Writes: `commitments_close` (commitments.close)

`pulse_today(date?, scopes?)` returns the commitment buckets, today's meetings, the inbox and queue counts, stale metrics, new findings and open bets.

## Altitude

Work at `1000` (his own surfaces) by default. For a Friday review or "how are we doing overall", go up to `10000` (cross-team). Go to `50000` only when he asks about company-level bets. Drop to `100` only when he asks about one specific commitment.

## Flow: morning, or "where am I?"

1. `pulse_today` for today. Pass `scopes` only if he names a project or area ("where am I on Specdr?").
2. Judge what matters, in this order:
   1. Overdue commitments, then those due today. Name who each is owed to.
   2. Today's meetings that need prep. Offer Counsel for the hardest one.
   3. Commitments others owe him that are overdue: who to nudge.
   4. Stale metrics (missed their cadence) and open bets that need a look.
   5. New findings worth acting on. Offer Horizon.
   6. Inbox and queue counts if above zero. Offer Capture.
3. Say it in about eight short lines he can listen to. Skip empty sections; don't list everything.
4. End with one question: the single most useful next move ("Want to prep the 2pm?").

Across both worlds: the signal bridge between the personal and work instances isn't built yet. If he has told you his load on the other side, use it; otherwise don't ask.

## Flow: Friday review

1. `pulse_today`, then `commitments_list` with `due_before` next Friday for what's coming.
2. `metrics_list` for the registry: which have a fresh reading, which are stale, which are still `idea` or `defined` and need instrumentation.
3. Judge: what slipped this week and why (from what he's said), what's at risk next week, and one thing to drop or renegotiate.
4. Ask one question at a time about anything that should be closed or dropped.

## Flow: closing a commitment

1. "That's done" or "drop it": find the commitment in `commitments_list` (filter by `owed_to`, `owed_by` or `scope` if he names them).
2. If more than one could match, ask which, naming each by title and who it's owed to.
3. `commitments_close` with `done` or `dropped`, and a one-line `note` on how it ended if he gave one.

A new commitment said during Pulse ("I also owe Lisa a reply") goes to Capture. Pulse only closes.

## Output

The answer stays in the conversation. Home, the Claude page, is where Pulse lives day to day: it reads `pulse_today` itself, so Pulse writes nothing for it. If Home exists, point him there for the full view.
