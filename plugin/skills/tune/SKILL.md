---
name: tune
description: Keeps Bousleh clean and getting better. Reviews the week's activity in Wassim's data, fixes safe, reversible noise on its own, queues judgment calls for him, and opens a pull request when the week shows a repeated correction or manual step that a change to Bousleh would remove. Use when he says "tune up Bousleh", "clean up my data", "what should we improve in Bousleh", "review the week's filing", or when the Friday Bousleh tune-up runs.
---

# Tune

Make Bousleh a little better every week without adding noise. You judge what's wrong and what would fix it. The engine keeps history, so every fix is reversible and nothing is ever deleted.

Three kinds of output, in this order of preference:

1. **Fix it** when the fix is safe, reversible and follows a rule Wassim already set.
2. **Queue it** when it needs his judgment.
3. **Change Bousleh** (a pull request) when the same problem would keep coming back.

Say nothing when there's nothing to do. A run that finds nothing ends with one line.

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `vault_activity` (vault.activity) for what changed this week, `vault_health`, `scopes_list`, `context_strata` (context.strata) with a high `per_cell` for the whole picture, `people_list`, `commitments_list`, `queue_list`, `inbox_list`, `assets_list`, `vault_search`, `vault_get`
- Writes, only as "What you may fix" allows: `vault_unlink` (vault.unlink), `commitments_close` (commitments.close) with `dropped`, `queue_add` (queue.add)
- In the repo (this folder): git, `pnpm`, and `gh` for a pull request

Every write you make carries a reason or note that starts `Friday tune-up:`, so the next run, and Wassim, can tell your changes apart.

## Step 1: read the week

1. `vault_health`. If it fails, stop with one line.
2. `vault_activity` for the last 7 days (no `since`), with a `limit` of 1000. Read it for:
   - **Corrections:** `vault.unlink`, `vault.supersede`, `commitments.close` with `dropped`, `queue.resolve` with `discard`, `scopes.move`, `scopes.rename`. Their reasons and notes say what was wrong. A correction made right after a filing (same objects, same day) means the filing got it wrong.
   - **Manual work:** `inbox.drop` calls Wassim asked for by hand (not from a scheduled run), the same kind of fix repeated, the same question asked twice.
   - **Failures:** `failed_only: true`. Repeated errors on the same op point at a skill or op problem.
   - Skip your own past changes (notes starting `Friday tune-up:`) unless Wassim reversed one: a reversed tune-up fix is a correction of you, and you don't make that fix again.
3. The current state: `context_strata` (every scope, `per_cell` 50), `commitments_list` (open), `people_list`, `queue_list`, `inbox_list`.

## Step 2: fix what's safe

**What you may fix on your own** (nothing else):

| Noise | Fix |
| --- | --- |
| An open commitment between two other people: Wassim is neither `owed_by` nor `owed_to`, and its scope work isn't his (his relevance rule, Nov 10) | `commitments_close` with `dropped` and a note saying why |
| A person who shows up in every column only because their sole link is `from_moment` to a dump that spans several scopes | `vault_unlink` that link, with a reason; if they belong to particular scopes, queue a note saying which you think, rather than guessing |
| An `attended_by` link to someone who was only in the room, on a meeting where nothing filed involves them, when Wassim has already removed that kind of link once | `vault_unlink`, with a reason |

Fix at most ten things a run. If you'd fix more, fix the ten clearest and say how many are left.

Never: delete anything, change a dump (dumps keep Wassim's words), retitle or rescope objects, move or rename scopes, close a commitment as `done`, touch his own commitments, or undo something he did.

## Step 3: queue the judgment calls

Queue at most five items a run, the most useful first, each with `queue_add`, a draft as far as you know it, candidate ids, and a reason starting `Friday tune-up:`. Good candidates:

- Two objects that look like the same thing (two people with the same first name, two problems saying the same thing).
- A commitment Wassim owes with no date, open for more than 14 days: should it get a date or be dropped?
- A planned meeting whose day has passed with no debrief: debrief, or drop the plan?
- An open idea or running idea untouched for 30 days: park it, or start it? (for Shape)
- A queue item open for more than 7 days: mention it in the report, don't queue it again.

Don't queue what's already queued (`queue_list`), and don't queue what Wassim already decided (a discarded item with the same subject).

## Step 4: change Bousleh when the week shows a pattern

Only with evidence from this week's activity: the same correction at least twice, or one correction Wassim had to explain, or a manual step he did by hand that a schedule or skill could do. No evidence, no change. Don't invent improvements.

For each pattern, find the smallest change that would have prevented it, in this order of preference:

1. A sentence in a skill (`plugin/skills/<name>/SKILL.md`): a rule, an example, a "never".
2. A scheduled task's prompt or schedule in `docs/scheduled-tasks.md`.
3. Code (an op, Home) only when no skill wording could fix it. Follow AGENTS.md: contracts, handler and tests together.

Then:

1. `git checkout main && git pull`, then a branch `tune/<YYYY-MM-DD>`.
2. Make the changes. Run `pnpm build && pnpm typecheck && pnpm lint && pnpm test`; all must pass.
3. Commit, push, and open one pull request with `gh pr create` for all of the week's changes. The body says, per change: the evidence (dates and what happened), the change, and what it prevents. Never merge: Wassim merges.
4. If you can't push or `gh` isn't signed in, don't keep trying: put each proposed change in the report, in a few lines.
5. A change to a scheduled task's prompt only takes effect when Wassim applies `docs/scheduled-tasks.md` again after merging; say so in the PR.

## Step 5: report

Only when you fixed, queued or proposed something. In a few lines:

- what you fixed, with a count;
- what you queued, one line each;
- the pull request link and what it changes, or the proposals if you couldn't open one;
- anything left over (fixes past the ten).

Otherwise end with one line: "Nothing to tune this week."

## Unattended runs

When the Friday Bousleh tune-up starts Tune, nobody is there to answer. Ask nothing: queue what you'd have asked.

## Output

Stays in the run's output and the pull request. No artifact.
