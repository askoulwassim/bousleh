import { depositsWrite, scopesAdd, scopesList, scopesMove, vaultGet, vaultSupersede } from '@bousleh/contracts';
import { defineHandler, OpError } from './handler.js';

/* Handlers for the core object ops: deposits.write, vault.get, vault.supersede, scopes.list, scopes.add, scopes.move. */

export const depositsWriteHandler = defineHandler(depositsWrite, (input, h) => h.store.createObject(input));

export const vaultGetHandler = defineHandler(vaultGet, (input, h) => {
  const object = h.store.getObject(input.id, { history: input.history });
  if (!object) throw new OpError('not_found', `no object with id ${input.id}`);
  return object;
});

export const vaultSupersedeHandler = defineHandler(vaultSupersede, (input, h) => {
  const { id, ...patch } = input;
  return h.store.supersede(id, patch);
});

export const scopesListHandler = defineHandler(scopesList, (_input, h) => ({ scopes: h.store.listScopes() }));

export const scopesAddHandler = defineHandler(scopesAdd, (input, h) => h.store.addScope(input));

export const scopesMoveHandler = defineHandler(scopesMove, (input, h) => h.store.moveScope(input));
