import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { InboxFile, InboxSource } from '@bousleh/contracts';
import type { FileStager } from '@bousleh/vault';

/*
 * The inbox on disk (docs/design/data-schema.md, section 5). Everything waiting sits in your data
 * home's `inbox/` folder, and the folder a file sits in says where it came from:
 *
 *   inbox/               files dropped on the Mac          source local
 *   inbox/transcripts/   meeting transcripts handed over   source transcript
 *   inbox/drive/         files inbox.sweep brought in from the synced Google Drive folder   source drive
 *   inbox/processed/<yyyy-mm>/<sha256 prefix>-<name>   settled files and duplicates
 *   inbox/failed/<yyyy-mm>/<sha256 prefix>-<name>      files that could not be read; not logged, so
 *                                                      dropping one in the inbox again retries it
 *
 * A file is waiting while it sits in one of the first three folders and its content hash is not in
 * `inbox_log`. Only top-level files count; hidden files (`.DS_Store`), Office lock files (`~$…`) and
 * half-finished cross-volume copies (`….partial`) are ignored.
 */

export const INBOX_DIR = 'inbox';
export const PROCESSED_DIR = join(INBOX_DIR, 'processed');
export const FAILED_DIR = join(INBOX_DIR, 'failed');

/** Where each source waits, relative to the data home. */
export const SOURCE_DIRS: Readonly<Record<InboxSource, string>> = {
  local: INBOX_DIR,
  transcript: join(INBOX_DIR, 'transcripts'),
  drive: join(INBOX_DIR, 'drive'),
};

/** inbox.take returns text up to this size. A long meeting transcript is well under it. */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** Characters of the sha256 that prefix a processed file's name. */
export const HASH_PREFIX_LENGTH = 12;

/** Google Drive for desktop shows native Google files as small shortcut files that hold a link, not the text. */
const GOOGLE_SHORTCUTS = new Set(['.gdoc', '.gsheet', '.gslides', '.gdraw', '.gform', '.gmap', '.gsite', '.gjam', '.gtable', '.gscript']);

/** One file found in an inbox folder, hashed. */
export interface Found {
  abs: string;
  name: string;
  source: InboxSource;
  size: number;
  mtime: Date;
  sha256: string;
  /** Null when the content is text inbox.take can return; otherwise why not. */
  unreadable: string | null;
}

export function ignored(name: string): boolean {
  return name.startsWith('.') || name.startsWith('~$') || name.endsWith('.partial');
}

/** Top-level regular files of a folder, ignoring the ones above. Missing folder: none. */
export function filesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !ignored(entry.name))
    .map((entry) => join(dir, entry.name));
}

export function sha256Of(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

/** Null when `content` is text inbox.take can hand over; otherwise a plain reason. */
export function whyUnreadable(name: string, content: Buffer): string | null {
  if (GOOGLE_SHORTCUTS.has(extname(name).toLowerCase())) {
    return 'This is a Google Docs shortcut, which holds only a link: the document text is not on the Mac. Save the document as a text or markdown file into the Bousleh Inbox folder instead, then settle this one as skipped.';
  }
  if (content.length > MAX_TEXT_BYTES) {
    return `This file is ${content.length} bytes; inbox.take reads text files up to ${MAX_TEXT_BYTES} bytes.`;
  }
  if (content.includes(0)) {
    return 'This is a binary file (for example a PDF, an image, audio or a Word document), not text. Only text files can be read.';
  }
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(content);
  } catch {
    return 'This file is not UTF-8 text, so it cannot be read.';
  }
  return null;
}

export function decodeText(content: Buffer): string {
  return new TextDecoder('utf-8', { ignoreBOM: false }).decode(content);
}

/** Hash and inspect one file. */
export function inspect(abs: string, source: InboxSource): Found & { content: Buffer } {
  const content = readFileSync(abs);
  const stat = statSync(abs);
  const name = abs.slice(abs.lastIndexOf(sep) + 1);
  return {
    abs,
    name,
    source,
    size: content.length,
    mtime: stat.mtime,
    sha256: sha256Of(content),
    unreadable: whyUnreadable(name, content),
    content,
  };
}

const byArrival = (a: Found, b: Found) => a.mtime.getTime() - b.mtime.getTime() || a.abs.localeCompare(b.abs);

/** Every file in the local inbox folders, oldest first. */
export function scanInbox(home: string): Found[] {
  const found: Found[] = [];
  for (const [source, dir] of Object.entries(SOURCE_DIRS) as [InboxSource, string][]) {
    for (const abs of filesIn(join(home, dir))) {
      const { content: _content, ...file } = inspect(abs, source);
      found.push(file);
    }
  }
  return found.sort(byArrival);
}

/** Files of the synced Drive folder, oldest first. */
export function scanDrive(dir: string): (Found & { content: Buffer })[] {
  return filesIn(dir)
    .map((abs) => inspect(abs, 'drive'))
    .sort(byArrival);
}

/**
 * Split inbox files into waiting ones and duplicates: a file is a duplicate when its hash is already
 * in the inbox log, or when an older waiting file has the same content.
 */
export function partition<F extends Found>(files: readonly F[], isLogged: (sha256: string) => boolean): { waiting: F[]; duplicates: F[] } {
  const seen = new Set<string>();
  const waiting: F[] = [];
  const duplicates: F[] = [];
  for (const file of files) {
    if (seen.has(file.sha256) || isLogged(file.sha256)) duplicates.push(file);
    else {
      seen.add(file.sha256);
      waiting.push(file);
    }
  }
  return { waiting, duplicates };
}

export function toView(file: Found, home: string): InboxFile {
  return {
    sha256: file.sha256,
    source: file.source,
    name: file.name,
    path: relative(home, file.abs).split(sep).join('/'),
    size: file.size,
    arrived_at: file.mtime.toISOString(),
    text: file.unreadable === null,
  };
}

/** Keep a file name within `maxBytes` (UTF-8), keeping a short extension. */
export function clampName(name: string, maxBytes = 200): string {
  if (Buffer.byteLength(name) <= maxBytes) return name;
  const ext = extname(name);
  const keepExt = Buffer.byteLength(ext) <= 20 ? ext : '';
  let stem = keepExt ? name.slice(0, -keepExt.length) : name;
  while (stem.length > 0 && Buffer.byteLength(stem + keepExt) > maxBytes) stem = stem.slice(0, -1);
  return stem + keepExt;
}

const toPosix = (path: string) => path.split(sep).join('/');

/**
 * A free path under `inbox/processed/<yyyy-mm>/` for a file: `<sha256 prefix>-<name>`, or
 * `<sha256 prefix>-<n>-<name>` when that is taken (a duplicate of a file settled the same month).
 * The month is UTC.
 */
export function processedPath(stager: FileStager, sha256: string, name: string, now: Date, dir: string = PROCESSED_DIR): string {
  const month = now.toISOString().slice(0, 7);
  const prefix = sha256.slice(0, HASH_PREFIX_LENGTH);
  const base = clampName(name);
  for (let n = 1; ; n++) {
    const candidate = toPosix(join(dir, month, n === 1 ? `${prefix}-${base}` : `${prefix}-${n}-${base}`));
    if (stager.isFree(candidate)) return candidate;
  }
}

/** A free path in `inbox/drive/` for a file coming in from the Drive folder: its name, or `name (2).ext`. */
export function driveArrivalPath(stager: FileStager, name: string): string {
  return arrivalPath(stager, SOURCE_DIRS.drive, name);
}

/** A free path in `dir` for a new file: its name, or `name (2).ext`. */
export function arrivalPath(stager: FileStager, dir: string, name: string): string {
  const base = clampName(name);
  const ext = extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  for (let n = 1; ; n++) {
    const candidate = toPosix(join(dir, n === 1 ? base : `${stem} (${n})${ext}`));
    if (stager.isFree(candidate)) return candidate;
  }
}

/**
 * A safe file name for a dropped file: no folders, no control characters, not hidden, and a text
 * extension (.md unless it already ends in .md, .markdown or .txt).
 */
export function dropName(raw: string): string {
  let name = raw.split(/[\\/]/).pop() ?? '';
  name = name
    .split('')
    .filter((ch) => ch.charCodeAt(0) > 0x1f && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .trim()
    .replace(/^[.~$]+/, '');
  if (name === '') name = 'capture';
  if (!/\.(md|markdown|txt)$/i.test(name)) name = `${name.replace(/\.[^.]*$/, '')}.md`;
  return clampName(name);
}

/** True when `inner` is `outer` or inside it. */
export function isWithin(inner: string, outer: string): boolean {
  const rel = relative(resolve(outer), resolve(inner));
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
