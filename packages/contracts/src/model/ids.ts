import { z } from 'zod';
import { KINDS, type Kind } from './kinds.js';

/*
 * Ids are a three-letter prefix plus a ULID (`prb_01JBX…`): they sort by time, and the prefix
 * shows what an id points at. Objects use their kind's prefix; the other rows use these.
 */
export const ROW_PREFIXES = {
  version: 'ver',
  scope: 'scp',
  link: 'lnk',
  reading: 'rdg',
  queue: 'que',
} as const;

const ULID = '[0-9A-HJKMNP-TV-Z]{26}';
export const ID_PATTERN = new RegExp(`^[a-z]{3}_${ULID}$`);

export const IdSchema = z.string().regex(ID_PATTERN, 'an id looks like prb_01JBX… (prefix, underscore, 26-character ULID)');

const KIND_BY_PREFIX: ReadonlyMap<string, Kind> = new Map(
  (Object.entries(KINDS) as [Kind, { prefix: string }][]).map(([kind, def]) => [def.prefix, kind]),
);

/** The object kind an id belongs to, from its prefix; undefined for non-object ids. */
export function kindOfId(id: string): Kind | undefined {
  return KIND_BY_PREFIX.get(id.slice(0, 3));
}

/** Scope slugs: lower-case words joined by hyphens (`perfect-placement`). */
export const ScopeSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'a scope slug is lower-case words joined by hyphens, like perfect-placement');

export const SCOPE_KINDS = ['company', 'product', 'project', 'team', 'life'] as const;
