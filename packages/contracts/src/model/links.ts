import { z } from 'zod';
import { KINDS, type Kind } from './kinds.js';
import type { Layer } from './layers.js';

/*
 * Link kinds (docs/design/data-schema.md, section 3). A link points from one object to another,
 * never at a version. New kinds are added here, not freehand.
 */

export interface LinkKindDef {
  description: string;
  /** Allowed source kinds or layers. Absent: any. */
  from?: { kinds?: readonly Kind[]; layers?: readonly Layer[] };
  /** Allowed target kinds or layers. Absent: any. */
  to?: { kinds?: readonly Kind[]; layers?: readonly Layer[] };
  /** Source and target must be the same kind. */
  sameKind?: true;
}

export const LINK_KINDS = {
  evidence_for: {
    description: 'Evidence (a signal, observation or finding) to the problem or idea it supports.',
    from: { layers: ['evidence'] },
    to: { kinds: ['problem', 'idea'] },
  },
  about: { description: 'Anything to the person or topic it is about.' },
  part_of: { description: 'To the initiative or strategy something is part of.', to: { kinds: ['initiative', 'strategy'] } },
  serves: { description: 'A metric to the strategy line it serves.', from: { kinds: ['metric'] }, to: { kinds: ['strategy'] } },
  owned_by: { description: 'To the person who owns it.', to: { kinds: ['person'] } },
  from_moment: { description: 'An object to the dump or meeting it came from.', to: { kinds: ['dump', 'meeting'] } },
  from_watch_list: {
    description: 'A finding to the watch list it came from.',
    from: { kinds: ['finding'] },
    to: { kinds: ['watch_list'] },
  },
  concludes: {
    description:
      "A decision to the idea it concludes: the bet's outcome. Linking it moves the idea to `concluded`; the idea must be a bet.",
    from: { kinds: ['decision'] },
    to: { kinds: ['idea'] },
  },
  attended_by: { description: 'A meeting to a person who attended it.', from: { kinds: ['meeting'] }, to: { kinds: ['person'] } },
  owed_by: { description: 'A commitment to the person who owes it.', from: { kinds: ['commitment'] }, to: { kinds: ['person'] } },
  owed_to: { description: 'A commitment to the person it is owed to.', from: { kinds: ['commitment'] }, to: { kinds: ['person'] } },
  supersedes: { description: 'An object to the object it replaces (same kind).', sameKind: true },
  related: { description: 'Anything to anything, when no other kind fits.' },
} as const satisfies Record<string, LinkKindDef>;

export type LinkKind = keyof typeof LINK_KINDS;
export const LINK_KIND_NAMES = Object.keys(LINK_KINDS) as LinkKind[];
export const LinkKindSchema = z.enum(LINK_KIND_NAMES as [LinkKind, ...LinkKind[]]);

function allows(side: { kinds?: readonly Kind[]; layers?: readonly Layer[] } | undefined, kind: Kind): boolean {
  if (!side) return true;
  if (side.kinds?.includes(kind)) return true;
  if (side.layers?.includes(KINDS[kind].layer)) return true;
  return false;
}

/** Null when the link is allowed, else why not. */
export function checkLink(kind: LinkKind, fromKind: Kind, toKind: Kind): string | null {
  const def: LinkKindDef = LINK_KINDS[kind];
  if (def.sameKind && fromKind !== toKind) return `${kind} links two objects of the same kind (got ${fromKind} and ${toKind})`;
  if (!allows(def.from, fromKind)) return `${kind} can't start from a ${fromKind}`;
  if (!allows(def.to, toKind)) return `${kind} can't point at a ${toKind}`;
  return null;
}
