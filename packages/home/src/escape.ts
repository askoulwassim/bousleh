/* Every string drawn into the page goes through esc(): the data (live or from the db) is never markup. */

const MAP: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => MAP[ch] ?? ch);
}
