import { depositsWrite, scopesAdd, scopesList, scopesMove, scopesRename, vaultGet, vaultSupersede } from '@bousleh/contracts';
import { localDay } from './days.js';
import { defineHandler, OpError } from './handler.js';

/* Handlers for the core object ops: deposits.write, vault.get, vault.supersede, scopes.list, scopes.add, scopes.move, scopes.rename. */

export const depositsWriteHandler = defineHandler(depositsWrite, (input, h) => h.store.createObject(input));

export const vaultGetHandler = defineHandler(vaultGet, (input, h) => {
  const object = h.store.getObject(input.id, { history: input.history });
  if (!object) throw new OpError('not_found', `no object with id ${input.id}`);
  return object;
});

export const vaultSupersedeHandler = defineHandler(vaultSupersede, (input, h) => {
  const { id, ...patch } = input;
  // Nov 27: dating a commitment that is already back from its snooze (surface_on today or earlier) ends the
  // snooze, so it isn't counted both as back from snooze and as due on its new date. A snooze still ahead stays.
  const newDue = patch.attrs?.due;
  if (typeof newDue === 'string' && patch.attrs && !('surface_on' in patch.attrs)) {
    const current = h.store.getObject(id);
    const surfaceOn = current?.kind === 'commitment' ? current.version.attrs.surface_on : undefined;
    if (typeof surfaceOn === 'string' && surfaceOn <= localDay(h.ctx.now())) {
      patch.attrs = { ...patch.attrs, surface_on: null };
    }
  }
  return h.store.supersede(id, patch);
});

export const scopesListHandler = defineHandler(scopesList, (_input, h) => ({ scopes: h.store.listScopes() }));

export const scopesAddHandler = defineHandler(scopesAdd, (input, h) => h.store.addScope(input));

export const scopesMoveHandler = defineHandler(scopesMove, (input, h) => h.store.moveScope(input));

export const scopesRenameHandler = defineHandler(scopesRename, (input, h) => h.store.renameScope(input));
