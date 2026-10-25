import {
  type DepositDraft,
  type InboxOutcome,
  type InboxSource,
  type OpOutcome,
  type QueueItem,
  queueAdd,
  queueList,
  queueResolve,
  ROW_PREFIXES,
} from '@bousleh/contracts';
import { defineHandler, type HandlerContext, newId, OpError, type OpHandler, type Written } from '@bousleh/vault';
import { logRow, waitingFile } from './inbox.js';

/* Handlers for queue.add, queue.list and queue.resolve: the ambiguity queue (deposit_queue, deposit_resolutions). */

interface QueueRow {
  id: string;
  payload_json: string;
  reason: string;
  candidates_json: string | null;
  source_sha256: string | null;
  created_at: string;
  log_source: InboxSource | null;
  log_name: string | null;
  log_outcome: InboxOutcome | null;
  log_processed_path: string | null;
}

interface ResolutionRow {
  resolution_json: string;
  object_id: string | null;
  created_at: string;
}

/** A failed nested op becomes this op's failure, so the whole call rolls back. */
function rethrow(outcome: Extract<OpOutcome, { status: 'error' }>, what: string): never {
  const message = `${what}: ${outcome.message}`;
  if (outcome.code === 'invalid_input' || outcome.code === 'not_found' || outcome.code === 'conflict') {
    throw new OpError(outcome.code, message, outcome.issues);
  }
  throw new Error(message);
}

function requireObject(h: HandlerContext, id: string) {
  const object = h.store.getObject(id);
  if (!object) throw new OpError('not_found', `no object with id ${id}`);
  return object;
}

export const queueAddHandler = defineHandler(queueAdd, async (input, h) => {
  const candidates = [...new Set(input.candidates)];
  for (const id of candidates) requireObject(h, id);

  let settledSource = false;
  if (input.source_sha256 !== undefined && !logRow(h, input.source_sha256)) {
    // Not settled yet: it must be waiting in the inbox, and queueing it settles it as queued.
    waitingFile(h, input.source_sha256);
    const settled = await h.runOp('inbox.settle', { sha256: input.source_sha256, outcome: 'queued' }, h.ctx);
    if (settled.status !== 'ok') rethrow(settled, 'could not settle the source file');
    settledSource = true;
  }

  const now = h.ctx.now();
  const id = newId(ROW_PREFIXES.queue, now);
  h.store.db
    .prepare(
      `INSERT INTO deposit_queue (id, payload_json, reason, candidates_json, source_sha256, op, actor, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      JSON.stringify(input.draft),
      input.reason,
      JSON.stringify(candidates),
      input.source_sha256 ?? null,
      h.def.name,
      h.ctx.actor,
      now.toISOString(),
    );
  return { id, created_at: now.toISOString(), settled_source: settledSource };
});

export const queueListHandler = defineHandler(queueList, (_input, h) => {
  const rows = h.store.db
    .prepare(
      `SELECT q.id, q.payload_json, q.reason, q.candidates_json, q.source_sha256, q.created_at,
              l.source AS log_source, l.original_name AS log_name, l.outcome AS log_outcome, l.processed_path AS log_processed_path
       FROM deposit_queue q LEFT JOIN inbox_log l ON l.sha256 = q.source_sha256
       WHERE NOT EXISTS (SELECT 1 FROM deposit_resolutions r WHERE r.queue_id = q.id)
       ORDER BY q.created_at, q.id`,
    )
    .all() as QueueRow[];
  const items: QueueItem[] = rows.map((row) => {
    const candidateIds = row.candidates_json ? (JSON.parse(row.candidates_json) as string[]) : [];
    const candidates = candidateIds.flatMap((id) => {
      const object = h.store.getObject(id);
      return object ? [{ id, kind: object.kind, title: object.version.title }] : [];
    });
    return {
      id: row.id,
      draft: JSON.parse(row.payload_json) as DepositDraft,
      reason: row.reason,
      candidates,
      source:
        row.source_sha256 && row.log_source && row.log_name && row.log_outcome
          ? {
              sha256: row.source_sha256,
              source: row.log_source,
              name: row.log_name,
              outcome: row.log_outcome,
              processed_path: row.log_processed_path,
            }
          : null,
      created_at: row.created_at,
    };
  });
  return { items };
});

export const queueResolveHandler = defineHandler(queueResolve, async (input, h) => {
  const row = h.store.db.prepare('SELECT id, payload_json FROM deposit_queue WHERE id = ?').get(input.id) as
    | Pick<QueueRow, 'id' | 'payload_json'>
    | undefined;
  if (!row) throw new OpError('not_found', `no queued item with id ${input.id}; queue.list shows the open ones`);
  const resolved = h.store.db
    .prepare('SELECT resolution_json, object_id, created_at FROM deposit_resolutions WHERE queue_id = ?')
    .get(input.id) as ResolutionRow | undefined;
  if (resolved) {
    const how = resolved.object_id ? `filed as ${resolved.object_id}` : 'discarded';
    throw new OpError('conflict', `that item was already resolved (${how}) at ${resolved.created_at}`);
  }

  let objectId: string | null = null;
  let object: Written | null = null;
  if (input.action === 'file') {
    const draft = JSON.parse(row.payload_json) as DepositDraft;
    const deposit = { ...draft, ...(input.overrides ?? {}) };
    const written = await h.runOp('deposits.write', deposit, h.ctx);
    if (written.status !== 'ok') rethrow(written, 'the queued draft could not be filed; pass the missing or corrected fields in overrides');
    object = written.output as Written;
    objectId = object.id;
  } else if (input.overrides !== undefined) {
    throw new OpError('invalid_input', 'overrides only apply when filing; leave them out to discard');
  }

  const resolution = {
    action: input.action,
    ...(input.overrides ? { overrides: input.overrides } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  h.store.db
    .prepare('INSERT INTO deposit_resolutions (queue_id, resolution_json, object_id, op, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.id, JSON.stringify(resolution), objectId, h.def.name, h.ctx.actor, h.ctx.now().toISOString());
  return { id: input.id, action: input.action, object };
});

export const queueHandlers: readonly OpHandler[] = [queueAddHandler, queueListHandler, queueResolveHandler];
