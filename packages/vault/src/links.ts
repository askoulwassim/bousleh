import { vaultLink, vaultSearch, vaultUnlink } from '@bousleh/contracts';
import { defineHandler } from './handler.js';
import { searchObjects } from './store/search.js';

/* Handlers for vault.search, vault.link and vault.unlink. */

export const vaultSearchHandler = defineHandler(vaultSearch, (input, h) => searchObjects(h.store, input));

export const vaultLinkHandler = defineHandler(vaultLink, (input, h) => h.store.addLink(input.from, input.kind, input.to, input.note));

export const vaultUnlinkHandler = defineHandler(vaultUnlink, (input, h) => h.store.retractLink(input.id, input.reason));
