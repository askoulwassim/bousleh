/* @bousleh/vault: storage, migrations, history and typed objects in ~/.bousleh. Owns vault.*, deposits.*, scopes.*, commitments.*, people.* */
import type { OpHandler } from './handler.js';
import { vaultHealthHandler } from './health.js';
import { depositsWriteHandler, scopesAddHandler, scopesListHandler, vaultGetHandler, vaultSupersedeHandler } from './objects.js';

export * from './handler.js';
export { vaultHealthHandler } from './health.js';
export * from './home.js';
export { depositsWriteHandler, scopesAddHandler, scopesListHandler, vaultGetHandler, vaultSupersedeHandler } from './objects.js';
export { FileStager, OPEN_MARKER_PREFIX, STAGING_DIR, type StagerMark, safeDataPath } from './store/files.js';
export { bodyOf, currentPath, renderMarkdown, versionPath } from './store/markdown.js';
export { MIGRATIONS, type Migration, migrate } from './store/migrations.js';
export { type NewObject, Store, Vault, type VersionPatch, type WriteMeta, type Written } from './store/store.js';
export { newId, ulid } from './store/ulid.js';

/** Handlers for `vault.*`, `deposits.*`, `scopes.*`, `commitments.*` and `people.*` ops. */
export const handlers: readonly OpHandler[] = [
  vaultHealthHandler,
  vaultGetHandler,
  vaultSupersedeHandler,
  depositsWriteHandler,
  scopesListHandler,
  scopesAddHandler,
];
