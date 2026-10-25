import { z } from 'zod';
import { IdSchema } from '../model/ids.js';
import { defineOp, NoInput } from './define.js';

/* inbox.*: owned by @bousleh/intake. Raw input waiting to be read by Capture (docs/design/data-schema.md, section 5). */

/** Where an inbox file came from: the synced Google Drive folder, a file dropped on the Mac, or a meeting transcript. */
export const INBOX_SOURCES = ['drive', 'local', 'transcript'] as const;
export const InboxSourceSchema = z.enum(INBOX_SOURCES);
export type InboxSource = z.output<typeof InboxSourceSchema>;

/** How a file was settled once Capture handled it. */
export const INBOX_OUTCOMES = ['filed', 'queued', 'skipped', 'failed'] as const;
export const InboxOutcomeSchema = z.enum(INBOX_OUTCOMES);
export type InboxOutcome = z.output<typeof InboxOutcomeSchema>;

/** A file's content hash: sha256, 64 lower-case hex characters. It is the file's handle in every inbox and queue op. */
export const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/, 'a sha256 is 64 lower-case hex characters');

const isoDateTime = z.iso.datetime({ offset: true });

/** One file waiting in the inbox. */
export const InboxFileSchema = z.object({
  sha256: Sha256Schema,
  source: InboxSourceSchema,
  name: z.string(),
  /** Where it waits, relative to your data home (`inbox/drive/note.md`). */
  path: z.string(),
  size: z.number().int().min(0),
  /** When the file arrived: its modification time. */
  arrived_at: isoDateTime,
  /** True when inbox.take can return its content as text. */
  text: z.boolean(),
});
export type InboxFile = z.output<typeof InboxFileSchema>;

/** Whether the synced Google Drive inbox is set up, as inbox.sweep reports it. */
export const DriveInboxStatusSchema = z.object({
  configured: z.boolean(),
  path: z.string().nullable(),
  available: z.boolean(),
  message: z.string(),
});

export const inboxSweep = defineOp({
  name: 'inbox.sweep',
  description:
    'Bring everything waiting into the local inbox and report it. Moves each file from the synced Google Drive "Bousleh Inbox" folder (set by BOUSLEH_DRIVE_INBOX) into the local inbox; moved, not copied, so it leaves Google Drive. Files whose content was already seen are not handed to you again: they move straight to inbox/processed and are listed as duplicates. If the Drive inbox is not configured or not found, says so and sweeps only the local inbox. Run it before inbox.list when you want new phone captures and Horizon findings included.',
  input: NoInput,
  output: z.object({
    drive: DriveInboxStatusSchema,
    /** Files that came in from the Drive inbox in this sweep. */
    moved_in: z.array(InboxFileSchema),
    /** Files skipped because their content was already seen, and where each one went. */
    duplicates: z.array(
      z.object({
        sha256: Sha256Schema,
        source: InboxSourceSchema,
        name: z.string(),
        moved_to: z.string(),
      }),
    ),
    /** Everything now waiting for Capture, oldest first. */
    waiting: z.array(InboxFileSchema),
  }),
});

export const inboxList = defineOp({
  name: 'inbox.list',
  description:
    'List the files waiting in the local inbox, oldest first: source (drive, local or transcript), name, size, sha256 and when each arrived, plus whether inbox.take can read it as text. Read-only. Files still sitting in the Google Drive folder are not listed until inbox.sweep brings them in. Read one with inbox.take, then settle it with inbox.settle.',
  input: NoInput,
  output: z.object({
    files: z.array(InboxFileSchema),
    /** Files in the inbox whose content was already seen; the next inbox.sweep moves them out. */
    duplicates: z.number().int().min(0),
  }),
  readOnly: true,
});

export const inboxTake = defineOp({
  name: 'inbox.take',
  description:
    'Read one waiting inbox file by its sha256 (from inbox.list or inbox.sweep): its details and its full text. Only text files (plain text, markdown, transcripts) can be read. For anything else, such as a PDF, an image or a Google Docs shortcut, content is null and reason says why; settle that file with inbox.settle (outcome failed or skipped). Read-only: the file stays waiting until you settle it.',
  input: z.object({ sha256: Sha256Schema }),
  output: z.object({
    file: InboxFileSchema,
    content: z.string().nullable(),
    /** Why there is no content, when content is null. */
    reason: z.string().nullable(),
  }),
  readOnly: true,
});

export const inboxSettle = defineOp({
  name: 'inbox.settle',
  description:
    'Close out one inbox file once you have handled it: records the outcome in the inbox log and moves the file to inbox/processed/<yyyy-mm>/. Outcomes: filed (you wrote objects from it; pass the main one as object_id), queued (it went to the ambiguity queue), skipped (nothing worth keeping) or failed (it could not be read). A file is settled once; after that its content is never handed to you again. If a file produced both objects and queue items, settle it as filed first, then queue the rest with queue.add.',
  input: z.object({
    sha256: Sha256Schema,
    outcome: InboxOutcomeSchema,
    /** The main object written from this file. Required when the outcome is filed. */
    object_id: IdSchema.optional(),
  }),
  output: z.object({
    sha256: Sha256Schema,
    source: InboxSourceSchema,
    name: z.string(),
    outcome: InboxOutcomeSchema,
    object_id: IdSchema.nullable(),
    /** Where the file now lives, relative to your data home. */
    processed_path: z.string(),
  }),
});

export const inboxOps = {
  'inbox.sweep': inboxSweep,
  'inbox.list': inboxList,
  'inbox.take': inboxTake,
  'inbox.settle': inboxSettle,
} as const;
