/* @bousleh/watch: Watch lists per scope, filing scan findings, and the digest. Owns watchlists.*, watch.*. */
import type { OpHandler } from '@bousleh/vault';
import { watchDigestHandler, watchFileHandler } from './findings.js';
import { watchlistsGetHandler, watchlistsSetHandler } from './lists.js';

export { cleanUrl, urlKey, watchDigestHandler, watchFileHandler } from './findings.js';
export { DEFAULT_WATCH_LIST_ALTITUDE, watchlistsGetHandler, watchlistsSetHandler } from './lists.js';

/** Handlers for `watchlists.*` and `watch.*` ops. */
export const handlers: readonly OpHandler[] = [watchlistsGetHandler, watchlistsSetHandler, watchFileHandler, watchDigestHandler];
