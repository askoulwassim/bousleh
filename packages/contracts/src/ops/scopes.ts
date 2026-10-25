import { z } from 'zod';
import { SCOPE_KINDS, ScopeSlugSchema } from '../model/ids.js';
import { defineOp, NoInput } from './define.js';
import { ScopeViewSchema } from './shapes.js';

/* scopes.*: owned by @bousleh/vault. Scopes are what objects belong to (a company, a product, a project). */

export const scopesList = defineOp({
  name: 'scopes.list',
  description: 'List every current scope (slug, name, kind, parent). Objects are filed into scopes by slug.',
  input: NoInput,
  output: z.object({ scopes: z.array(ScopeViewSchema) }),
  readOnly: true,
});

export const scopesAdd = defineOp({
  name: 'scopes.add',
  description:
    'Add a scope objects can belong to: a slug (lower-case words joined by hyphens), a display name, a kind (company, product, project, team, life) and an optional parent scope slug.',
  input: z.object({
    slug: ScopeSlugSchema,
    name: z.string().trim().min(1).max(120),
    kind: z.enum(SCOPE_KINDS),
    parent: ScopeSlugSchema.optional(),
  }),
  output: ScopeViewSchema,
});

export const scopeOps = {
  'scopes.list': scopesList,
  'scopes.add': scopesAdd,
} as const;
