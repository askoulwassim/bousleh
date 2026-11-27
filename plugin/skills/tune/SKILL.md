---
name: tune
description: Keeps your Bousleh data and this Mac's setup healthy. Reviews the week's activity in your data, fixes safe, reversible noise on its own, queues judgment calls for you (duplicates, stale commitments and plans), and checks the setup. Never changes the repo. Use when you say "tune up Bousleh", "clean up my data", "what should we improve in Bousleh", "review the week's filing", or when the Friday Bousleh tune-up runs.
---

# Tune

Keep the user's data healthy every week without adding noise, and check that this Mac's setup is in order. You judge what's wrong and what would fix it. The engine keeps history, so every fix is reversible and nothing is ever deleted.

Two kinds of output, in this order of preference:

1. **Fix it** when the fix is safe, reversible and follows a rule the user already set.
2. **Queue it** when it needs the user's judgment.

**Never touch the repo.** Tune works on the user's data through the Bousleh tools, and nothing else. Don't edit files, and don't run `git`, `gh`, `pnpm` or any other command except the one read-only setup check below. Don't open pull requests or issues, and don't propose changes to Bousleh itself: changes to Bousleh are the user's to make, by hand.

Say nothing when there's nothing to do. A run that finds nothing ends with one line.

## Ops

Tools on the Bousleh MCP server (op names in brackets):

- Reads: `vault_activity` (vault.activity) for what changed this week, `vault_health`, `scopes_list`, `context_strata` (context.strata) with a high `per_cell` for the whole picture, `people_list`, `commitments_list`, `queue_list`, `inbox_list`, `assets_list`, `vault_search`, `vault_get`
- Writes, only as "What you may fix" allows: `vault_unlink` (vault.unlink), `commitments_close` (commitments.close) with `dropped`, `queue_add` (queue.add)
- In the repo folder: only `scripts/setup-mac.sh --check` (read-only; it changes nothing)

Every write you make carries a reason or note that starts `Friday tune-up:`, so the next run, and the user, can tell your changes apart.

## Step 1: read the week

1. `vault_health`. If it fails, stop with one line.
2. `vault_activity` for the last 7 days (no `since`), with a `limit` of 1000. Read it for:
   - **Corrections:** `vault.unlink`, `vault.supersede`, `commitments.close` with `dropped`, `queue.resolve` with `discard`, `scopes.move`, `scopes.rename`. Their reasons and notes say what was wrong. A correction made right after a filing (same objects, same day) means the filing got it wrong.
   - **Manual work:** the same kind of fix repeated, the same question asked twice. Tell the user in the report when one keeps coming back, in a line, without proposing a change to Bousleh.
   - **Failures:** `failed_only: true`. Repeated errors on the same op point at a skill or op problem.
   - Skip your own past changes (notes starting `Friday tune-up:`) unless the user reversed one: a reversed tune-up fix is a correction of you, and you don't make that fix again.
3. The current state: `context_strata` (every scope, `per_cell` 50), `commitments_list` (open), `people_list`, `queue_list`, `inbox_list`.

## Step 2: fix what's safe

**What you may fix on your own** (nothing else):

| Noise | Fix |
| --- | --- |
| An open commitment between two other people: the user is neither `owed_by` nor `owed_to`, and its scope work isn't theirs (the relevance rule) | `commitments_close` with `dropped` and a note saying why |
| A person who shows up in every column only because their sole link is `from_moment` to a dump that spans several scopes | `vault_unlink` that link, with a reason; if they belong to particular scopes, queue a note saying which you think, rather than guessing |
| An `attended_by` link to someone who was only in the room, on a meeting where nothing filed involves them, when the user has already removed that kind of link once | `vault_unlink`, with a reason |

Fix at most ten things a run. If you'd fix more, fix the ten clearest and say how many are left.

Never: delete anything, change a dump (dumps keep the user's words), retitle or rescope objects, move or rename scopes, close a commitment as `done`, touch the user's own commitments, or undo something the user did.

## Step 3: queue the judgment calls

Queue at most five items a run, the most useful first, each with `queue_add`, a draft as far as you know it, candidate ids, and a reason starting `Friday tune-up:`. Good candidates:

- Two objects that look like the same thing (two people with the same first name, two problems saying the same thing).
- A commitment the user owes with no date, open for more than 14 days: should it get a date or be dropped?
- A planned meeting whose day has passed with no debrief: debrief, or drop the plan?
- An open idea or running idea untouched for 30 days: park it, or start it? (for Shape)
- A queue item open for more than 7 days: mention it in the report, don't queue it again.

Don't queue what's already queued (`queue_list`), and don't queue what the user already decided (a discarded item with the same subject).

## Step 4: check this Mac's setup

Run `scripts/setup-mac.sh --check` in the repo folder (the working folder). It only reports. Read it for anything off: the Bousleh server missing from Claude Desktop or Claude Code, more than one Bousleh entry, Home not built, `~/.bousleh/app.json` missing or pointing at another folder, the repo in a folder macOS guards, no backups. Don't fix any of it: say in the report what's off, and that rerunning `scripts/setup-mac.sh` puts it right. If the check can't run, say so in one line and go on.

Also flag from what you read in Step 1: `vault_health` missing ops, a backup older than two days, or op failures that repeat (the same op failing on the same kind of input). Report them; don't fix them.

## Step 5: report

Only when you fixed or queued something, or found something off in the setup. In a few lines:

- what you fixed, with a count;
- what you queued, one line each;
- anything off in the setup or the server, and the fix (rerun `scripts/setup-mac.sh`);
- anything left over (fixes past the ten).

Otherwise end with one line: "Nothing to tune this week."

## Unattended runs

When the Friday Bousleh tune-up starts Tune, nobody is there to answer. Ask nothing: queue what you'd have asked.

## Output

Stays in the run's output. No artifact, no pull request, no issue.
