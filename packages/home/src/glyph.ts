import { tokens } from './tokens.js';
import type { Glyph, GlyphState, Layer, StrataObj } from './types.js';

/*
 * The glyph grammar: layer is the shape (anchor square, evidence disc, work diamond, person ring,
 * moment triangle); state is the colour (idle line-2 with a muted edge, yours accent, needs gold,
 * moving teal, closed ash with a strike, ghost dashed).
 */

/** Status → state, per kind where it differs. Anything unlisted is idle. */
const STATE_BY_STATUS: Record<string, GlyphState> = {
  // strategy
  aligned: 'yours',
  communicated: 'yours',
  // metric
  instrumented: 'moving',
  measured: 'moving',
  reviewed: 'yours',
  // idea
  bet: 'yours',
  running: 'moving',
  concluded: 'yours',
  // problem
  solved: 'yours',
  // initiative
  active: 'moving',
  done: 'yours',
  // finding
  new: 'moving',
  to_read: 'yours',
  // meeting
  planned: 'moving',
  // closed
  dropped: 'closed',
  dismissed: 'closed',
};

/** The colour an object is drawn in. */
export function glyphState(object: Pick<StrataObj, 'kind' | 'status' | 'needs_you'>): GlyphState {
  if (object.needs_you) return 'needs';
  if (object.kind === 'decision') return 'yours';
  if (object.status === null) return 'idle';
  return STATE_BY_STATUS[object.status] ?? 'idle';
}

export function glyphOf(object: Pick<StrataObj, 'kind' | 'status' | 'needs_you' | 'layer'>): Glyph {
  return { layer: object.layer, state: glyphState(object) };
}

const c = tokens.color;
const FILL: Record<GlyphState, string> = {
  idle: c['line-2'],
  yours: c.accent,
  needs: c.needs,
  moving: c.moving,
  closed: 'none',
  ghost: 'none',
};

/** The colour a state reads as in text and dots. */
export function stateColor(state: GlyphState): string {
  switch (state) {
    case 'yours':
      return c.accent;
    case 'needs':
      return c.needs;
    case 'moving':
      return c.moving;
    case 'closed':
      return c.closed;
    default:
      return c.ghost;
  }
}

/** One glyph as inline SVG. Sizes 9, 12, 14 or 16. */
export function glyphSvg(glyph: Glyph, size = 12): string {
  const { layer, state } = glyph;
  const open = `<svg class="g" width="${size}" height="${size}" viewBox="0 0 12 12" aria-hidden="true">`;
  const fill = FILL[state];
  const edge = state === 'idle' ? ` stroke="${c.muted}"` : '';
  const closed = state === 'closed';
  const ghost = state === 'ghost';
  const lineStroke = closed
    ? ` fill="none" stroke="${c.closed}" stroke-width="1.4"`
    : ` fill="none" stroke="${c.ghost}" stroke-dasharray="2 1.5"`;
  let body: string;
  switch (layer) {
    case 'anchors':
      body =
        closed || ghost
          ? `<rect x="1" y="1" width="10" height="10" rx="1.5"${lineStroke}/>${closed ? strike(2, 10, 10, 2) : ''}`
          : `<rect x="1" y="1" width="10" height="10" rx="1.5" fill="${fill}"${edge}/>`;
      break;
    case 'evidence':
      body =
        closed || ghost
          ? `<circle cx="6" cy="6" r="4.6"${lineStroke}/>${closed ? strike(2.8, 9.2, 9.2, 2.8) : ''}`
          : `<circle cx="6" cy="6" r="5" fill="${fill}"${edge}/>`;
      break;
    case 'work':
      body =
        closed || ghost
          ? `<polygon points="6,1 11,6 6,11 1,6"${lineStroke}/>${closed ? strike(3, 9, 9, 3) : ''}`
          : `<polygon points="6,0.5 11.5,6 6,11.5 0.5,6" fill="${fill}"${edge}/>`;
      break;
    case 'people': {
      const stroke = state === 'idle' ? c.muted : ghost ? c.ghost : closed ? c.closed : fill;
      const dash = ghost ? ' stroke-dasharray="2 1.5"' : '';
      body = `<circle cx="6" cy="6" r="4.5" fill="none" stroke="${stroke}" stroke-width="${ghost ? 1.6 : 2}"${dash}/>${closed ? strike(2.8, 9.2, 9.2, 2.8) : ''}`;
      break;
    }
    default:
      body =
        closed || ghost
          ? `<polygon points="6,1.5 11,10.5 1,10.5"${lineStroke}/>${closed ? strike(3.5, 10, 8.5, 4) : ''}`
          : `<polygon points="6,1 11.5,11 0.5,11" fill="${fill}"${edge}/>`;
  }
  return `${open}${body}</svg>`;
}

function strike(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c.closed}" stroke-width="1.4"/>`;
}

export const LAYER_NAMES: Record<Layer, string> = {
  anchors: 'Anchor',
  evidence: 'Evidence',
  work: 'Work',
  people: 'People',
  moments: 'Moment',
};
