import { vaultActivity } from '@bousleh/contracts';
import { windowEnd, windowStart } from './days.js';
import { defineHandler } from './handler.js';

/*
 * vault.activity: the op_log over a window, oldest first. Read only. Inputs are returned as sent, so a
 * reviewer can read the reasons and notes behind corrections (unlinks, supersedes, dropped commitments).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** The default window: this many days back from until. */
export const ACTIVITY_WINDOW_DAYS = 7;

interface LogRow {
  id: number;
  op: string;
  actor: 'human' | 'agent' | 'schedule';
  input_json: string;
  result: string;
  created_at: string;
}

function parse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

export const vaultActivityHandler = defineHandler(vaultActivity, (input, h) => {
  const until = input.until !== undefined ? windowEnd(input.until) : h.ctx.now();
  const since = input.since !== undefined ? windowStart(input.since) : new Date(until.getTime() - ACTIVITY_WINDOW_DAYS * DAY_MS);
  // windowEnd gives the next local midnight for a date, which is outside the window; a date-time until is inside it.
  const endOp = input.until !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(input.until) ? '<' : '<=';
  const rows = h.store.db
    .prepare(`SELECT id, op, actor, input_json, result, created_at FROM op_log WHERE created_at >= ? AND created_at ${endOp} ? ORDER BY id`)
    .all(since.toISOString(), until.toISOString()) as LogRow[];

  const counts: Record<string, { ok: number; failed: number }> = {};
  for (const row of rows) {
    const tally = counts[row.op] ?? { ok: 0, failed: 0 };
    if (row.result === 'ok') tally.ok += 1;
    else tally.failed += 1;
    counts[row.op] = tally;
  }

  const wanted = input.ops === undefined ? undefined : new Set(input.ops);
  const kept = rows.filter((row) => (wanted === undefined || wanted.has(row.op)) && (!input.failed_only || row.result !== 'ok'));
  const entries = kept.slice(0, input.limit).map((row) => ({
    id: row.id,
    at: row.created_at,
    op: row.op,
    actor: row.actor,
    result: row.result,
    input: parse(row.input_json),
  }));

  return { since: since.toISOString(), until: until.toISOString(), entries, more: kept.length - entries.length, counts };
});
