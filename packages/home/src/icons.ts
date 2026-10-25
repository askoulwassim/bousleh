import { tokens } from './tokens.js';
import type { Mode } from './types.js';

/* The Ba Ring mark (geometry from docs/design/home/Logo.dc.html) and the 24-grid stroke icons. */

const c = tokens.color;

const DISC = `<circle cx="50" cy="50" r="49" fill="${c.panel}" stroke="${c['line-2']}" stroke-width="1.5"/>`;
const TRACK = `<circle cx="50" cy="50" r="38" fill="none" stroke="${c.line}" stroke-width="7"/>`;
const ARC = `<circle cx="50" cy="50" r="38" fill="none" stroke="${c.accent}" stroke-width="7" stroke-linecap="round" stroke-dasharray="195.8 238.8" transform="rotate(-90 50 50)"/>`;
const BA = 'M31,42 L31,46 Q31,54 39,54 L61,54 Q69,54 69,46 L69,32';
const DOT = `<circle cx="15.6" cy="33.8" r="6.5" fill="${c.fg}" stroke="${c.panel}" stroke-width="3"/>`;

/** The full mark: disc, track, arc, the cut ب, its dot as the needle, the end dot. Rail size (40). */
export function logoFull(size: number, label = 'Bousleh'): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" role="img" aria-label="${label}">${DISC}${TRACK}${ARC}<path d="${BA}" fill="none" stroke="${c.panel}" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/><path d="${BA}" fill="none" stroke="${c.fg}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><polygon points="50,61 55.5,68 50,75 44.5,68" fill="${c['accent-hi']}" stroke="${c.panel}" stroke-width="2"/>${DOT}</svg>`;
}

/** The phone header mark (28): no cut under the ب. */
export function logoSmall(size: number): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100" aria-hidden="true">${DISC}${TRACK}${ARC}<path d="${BA}" fill="none" stroke="${c.fg}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><polygon points="50,61 55.5,68 50,75 44.5,68" fill="${c['accent-hi']}"/>${DOT}</svg>`;
}

const stroke = (paths: string, color = 'currentColor', extra = 'stroke-linejoin="round"') =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" ${extra} aria-hidden="true">${paths}</svg>`;

export const icons = {
  home: stroke('<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'),
  docs: stroke('<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/>'),
  mic: (size = 20) =>
    `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`,
};

const MODE_PATHS: Record<Mode, { d: string; cap: 'round' | 'join' }> = {
  Shape: { d: '<path d="M6 3v15h15M3 6h15v15"/>', cap: 'round' },
  Horizon: { d: '<path d="M3 18h18M7 18a5 5 0 0 1 10 0M12 5v3M5.6 9.6l1.8 1.8M18.4 9.6l-1.8 1.8"/>', cap: 'round' },
  Communicate: { d: '<path d="M3 10v4h4l6 4V6L7 10H3z"/><path d="M17 9a4 4 0 0 1 0 6"/>', cap: 'join' },
  Workshop: { d: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>', cap: 'join' },
  Pulse: { d: '<path d="M3 12h4l2-5 4 10 2-5h6"/>', cap: 'round' },
  Coach: { d: '<circle cx="9" cy="7" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M18 14V6M15 9l3-3 3 3"/>', cap: 'round' },
  Counsel: { d: '<path d="M4 5h11v8H8l-4 3z"/><path d="M15 9h5v8l-3-2h-6v-2"/>', cap: 'join' },
  Capture: { d: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>', cap: 'round' },
};

/** The mode's icon at 18, in accent-hi (Horizon in teal), or dim when disabled. */
export function modeIcon(mode: Mode, disabled = false): string {
  const p = MODE_PATHS[mode];
  const color = disabled ? c.dim : mode === 'Horizon' ? c.moving : c['accent-hi'];
  const extra = p.cap === 'round' ? 'stroke-linecap="round" stroke-linejoin="round"' : 'stroke-linejoin="round"';
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" ${extra} aria-hidden="true">${p.d}</svg>`;
}
