/* @bousleh/vault: storage, migrations, history and typed objects in ~/.bousleh. Owns vault.*, deposits.*, scopes.*, commitments.*, people.*, assets.* */

import { assetsAddHandler, assetsListHandler } from './assets.js';
import { vaultBackupHandler } from './backup.js';
import type { OpHandler } from './handler.js';
import { vaultHealthHandler } from './health.js';
import { vaultLinkHandler, vaultSearchHandler, vaultUnlinkHandler } from './links.js';
import {
  depositsWriteHandler,
  scopesAddHandler,
  scopesListHandler,
  scopesMoveHandler,
  vaultGetHandler,
  vaultSupersedeHandler,
} from './objects.js';
import { commitmentsCloseHandler, commitmentsListHandler, peopleGetHandler, peopleListHandler } from './people.js';

export { assetsAddHandler, assetsListHandler, normalizeAssetUrl, toAssetView } from './assets.js';
export { backupDir, latestSnapshotTime, listSnapshots, snapshotName, takeSnapshot, vaultBackupHandler } from './backup.js';
export { addDays, dayOf, daysBetween, instantOf, isDateOnly, localDay, startOfDay, windowEnd, windowStart } from './days.js';
export * from './handler.js';
export { vaultHealthHandler } from './health.js';
export * from './home.js';
export { vaultLinkHandler, vaultSearchHandler, vaultUnlinkHandler } from './links.js';
export {
  depositsWriteHandler,
  scopesAddHandler,
  scopesListHandler,
  scopesMoveHandler,
  vaultGetHandler,
  vaultSupersedeHandler,
} from './objects.js';
export { commitmentsCloseHandler, commitmentsListHandler, peopleGetHandler, peopleListHandler } from './people.js';
export { FileStager, OPEN_MARKER_PREFIX, STAGING_DIR, type StagerMark, safeDataPath } from './store/files.js';
export { bodyOf, currentPath, renderMarkdown, versionPath } from './store/markdown.js';
export { MIGRATIONS, type Migration, migrate } from './store/migrations.js';
export {
  type AddedLink,
  type NewObject,
  type RetractedLink,
  Store,
  Vault,
  type VersionPatch,
  type WriteMeta,
  type Written,
} from './store/store.js';
export { newId, ulid } from './store/ulid.js';

/** Handlers for `vault.*`, `deposits.*`, `scopes.*`, `commitments.*`, `people.*` and `assets.*` ops. */
export const handlers: readonly OpHandler[] = [
  vaultHealthHandler,
  vaultBackupHandler,
  vaultGetHandler,
  vaultSearchHandler,
  vaultSupersedeHandler,
  vaultLinkHandler,
  vaultUnlinkHandler,
  depositsWriteHandler,
  scopesListHandler,
  scopesAddHandler,
  scopesMoveHandler,
  commitmentsListHandler,
  commitmentsCloseHandler,
  peopleGetHandler,
  peopleListHandler,
  assetsAddHandler,
  assetsListHandler,
];
