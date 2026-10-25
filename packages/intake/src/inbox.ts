import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type InboxOutcome, type InboxSource, inboxList, inboxSettle, inboxSweep, inboxTake } from '@bousleh/contracts';
import { defineHandler, type HandlerContext, OpError, type OpHandler } from '@bousleh/vault';
import {
  decodeText,
  driveArrivalPath,
  FAILED_DIR,
  type Found,
  INBOX_DIR,
  isWithin,
  PROCESSED_DIR,
  partition,
  processedPath,
  scanDrive,
  scanInbox,
  toView,
} from './files.js';

/* Handlers for inbox.sweep, inbox.list, inbox.take and inbox.settle. */

export const DRIVE_INBOX_ENV = 'BOUSLEH_DRIVE_INBOX';

export interface IntakeOptions {
  /**
   * The synced Google Drive "Bousleh Inbox" folder. Called on every sweep, so a change is picked up
   * without a restart. Default: the `BOUSLEH_DRIVE_INBOX` environment variable, read at call time.
   */
  driveInbox?: () => string | undefined;
}

const fromEnv = () => process.env[DRIVE_INBOX_ENV];

export interface LogRow {
  sha256: string;
  source: InboxSource;
  original_name: string;
  seen_at: string;
  outcome: InboxOutcome;
  object_id: string | null;
  processed_path: string | null;
}

/** The inbox log row for a hash, if the file was settled. */
export function logRow(h: HandlerContext, sha256: string): LogRow | undefined {
  return h.store.db.prepare('SELECT * FROM inbox_log WHERE sha256 = ?').get(sha256) as LogRow | undefined;
}

/** Inbox files split into waiting ones and duplicates. Touches the database only when there are files. */
function inboxState(h: HandlerContext): { waiting: Found[]; duplicates: Found[] } {
  const files = scanInbox(h.home);
  if (files.length === 0) return { waiting: [], duplicates: [] };
  return partition(files, (sha256) => logRow(h, sha256) !== undefined);
}

/** The waiting file with this hash, or a clear error. */
export function waitingFile(h: HandlerContext, sha256: string): Found {
  const file = inboxState(h).waiting.find((f) => f.sha256 === sha256);
  if (file) return file;
  const row = logRow(h, sha256);
  if (row) {
    throw new OpError(
      'conflict',
      `that file was already settled as ${row.outcome}${row.processed_path ? `; it is at ${row.processed_path}` : ''}`,
    );
  }
  throw new OpError('not_found', `no file with sha256 ${sha256} is waiting in the inbox; inbox.list shows what is waiting`);
}

interface DriveStatus {
  configured: boolean;
  path: string | null;
  available: boolean;
  message: string;
}

function driveStatus(raw: string | undefined, home: string): DriveStatus {
  const value = raw?.trim();
  if (!value) {
    return {
      configured: false,
      path: null,
      available: false,
      message: `The Drive inbox isn't configured: set ${DRIVE_INBOX_ENV} to the synced "Bousleh Inbox" folder (under ~/Library/CloudStorage/GoogleDrive-<account>/My Drive/). Only the local inbox was swept.`,
    };
  }
  const path = resolve(value);
  if (isWithin(path, join(home, INBOX_DIR)) || isWithin(join(home, INBOX_DIR), path)) {
    return {
      configured: true,
      path,
      available: false,
      message: `${DRIVE_INBOX_ENV} points at or around the local inbox (${path}); it must be the synced Google Drive folder. Only the local inbox was swept.`,
    };
  }
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return {
      configured: true,
      path,
      available: false,
      message: `The Drive inbox folder was not found at ${path}. Check that Google Drive for desktop is running and syncing the "Bousleh Inbox" folder. Only the local inbox was swept.`,
    };
  }
  return { configured: true, path, available: true, message: `Swept the Drive inbox at ${path} and the local inbox.` };
}

export function inboxHandlers(options: IntakeOptions = {}): OpHandler[] {
  const driveInbox = options.driveInbox ?? fromEnv;

  const sweep = defineHandler(inboxSweep, (_input, h) => {
    const stager = h.store.stagedFiles;
    const now = h.ctx.now();
    const isLogged = (sha256: string) => logRow(h, sha256) !== undefined;

    const local = partition(scanInbox(h.home), isLogged);
    const known = new Set(local.waiting.map((f) => f.sha256));
    const waiting = local.waiting.map((f) => toView(f, h.home));
    const duplicates: { sha256: string; source: InboxSource; name: string; moved_to: string }[] = [];

    const moveDuplicate = (file: Found) => {
      const target = processedPath(stager, file.sha256, file.name, now);
      stager.stageMove(file.abs, target);
      duplicates.push({ sha256: file.sha256, source: file.source, name: file.name, moved_to: target });
    };
    for (const file of local.duplicates) moveDuplicate(file);

    const drive = driveStatus(driveInbox(), h.home);
    const movedIn = [];
    if (drive.available && drive.path) {
      for (const file of scanDrive(drive.path)) {
        if (known.has(file.sha256) || isLogged(file.sha256)) {
          moveDuplicate(file);
          continue;
        }
        known.add(file.sha256);
        const target = driveArrivalPath(stager, file.name);
        stager.stageMove(file.abs, target);
        const view = toView({ ...file, abs: join(h.home, target), name: target.slice(target.lastIndexOf('/') + 1) }, h.home);
        movedIn.push(view);
        waiting.push(view);
      }
    }
    waiting.sort((a, b) => a.arrived_at.localeCompare(b.arrived_at) || a.path.localeCompare(b.path));
    return { drive, moved_in: movedIn, duplicates, waiting };
  });

  const list = defineHandler(inboxList, (_input, h) => {
    const { waiting, duplicates } = inboxState(h);
    return { files: waiting.map((f) => toView(f, h.home)), duplicates: duplicates.length };
  });

  const take = defineHandler(inboxTake, (input, h) => {
    const file = waitingFile(h, input.sha256);
    const view = toView(file, h.home);
    if (file.unreadable !== null) return { file: view, content: null, reason: file.unreadable };
    return { file: view, content: decodeText(readFileSync(file.abs)), reason: null };
  });

  const settle = defineHandler(inboxSettle, (input, h) => {
    const file = waitingFile(h, input.sha256);
    if (input.outcome === 'filed' && input.object_id === undefined) {
      throw new OpError('invalid_input', 'a filed file needs object_id: the main object you wrote from it');
    }
    if (input.object_id !== undefined && !h.store.getObject(input.object_id)) {
      throw new OpError('not_found', `no object with id ${input.object_id}`);
    }
    const stager = h.store.stagedFiles;
    // A failed file goes to inbox/failed without a log row, so it stays retryable: drop it in again.
    const failed = input.outcome === 'failed';
    const target = processedPath(stager, file.sha256, file.name, h.ctx.now(), failed ? FAILED_DIR : PROCESSED_DIR);
    stager.stageMove(file.abs, target);
    if (!failed) {
      h.store.db
        .prepare(
          'INSERT INTO inbox_log (sha256, source, original_name, seen_at, outcome, object_id, processed_path) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(file.sha256, file.source, file.name, file.mtime.toISOString(), input.outcome, input.object_id ?? null, target);
    }
    return {
      sha256: file.sha256,
      source: file.source,
      name: file.name,
      outcome: input.outcome,
      object_id: input.object_id ?? null,
      processed_path: target,
    };
  });

  return [sweep, list, take, settle];
}
