import type { ViewModel } from './types.js';

/*
 * The snapshot: one db document, `snapshot/latest`, holding the last view model built from live
 * data. Written by the owner's desktop app when the view changed; read wherever the Bousleh server
 * can't be reached (the phone, the web). What comes back from the db is untrusted: it is checked
 * here and every string is escaped where it is drawn.
 */

export const SNAPSHOT_PATH = 'snapshot/latest';
/** Leave room under the db's 256 KiB document limit. */
export const SNAPSHOT_MAX_BYTES = 200_000;

export interface SnapshotDoc {
  v: 1;
  taken_at: string;
  hash: string;
  view: ViewModel;
}

/** FNV-1a over the view's JSON: enough to tell whether it changed. */
export function hashView(view: ViewModel): string {
  const text = JSON.stringify(view);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The document to write, or null when it would be too big. */
export function snapshotDoc(view: ViewModel, takenAt: Date): SnapshotDoc | null {
  const doc: SnapshotDoc = { v: 1, taken_at: takenAt.toISOString(), hash: hashView(view), view };
  return JSON.stringify(doc).length > SNAPSHOT_MAX_BYTES ? null : doc;
}

/** Write only when the view differs from the stored one. */
export function shouldWrite(view: ViewModel, stored: SnapshotDoc | null): boolean {
  return stored === null || stored.hash !== hashView(view);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A stored snapshot, if it has the shape Home draws; null otherwise. */
export function readSnapshot(data: unknown): SnapshotDoc | null {
  if (!isObject(data) || data.v !== 1 || typeof data.taken_at !== 'string' || Number.isNaN(Date.parse(data.taken_at))) return null;
  const view = data.view;
  if (!isObject(view) || view.v !== 1) return null;
  const arrays = ['readouts', 'columns', 'rows', 'cells', 'docs'];
  if (!arrays.every((key) => Array.isArray(view[key]))) return null;
  if (!isObject(view.hero) || !isObject(view.horizon) || !isObject(view.prompts) || !isObject(view.phone) || !isObject(view.stats))
    return null;
  if (!(view.cells as unknown[]).every((row) => Array.isArray(row))) return null;
  return { v: 1, taken_at: data.taken_at, hash: typeof data.hash === 'string' ? data.hash : '', view: view as unknown as ViewModel };
}
