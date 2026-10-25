/* @bousleh/contracts: the object model and the ops registry. Imports nothing from the other packages. */
export * from './model/index.js';
export * from './ops/commitments.js';
export * from './ops/define.js';
export * from './ops/deposits.js';
export * from './ops/metrics.js';
export * from './ops/people.js';
export * from './ops/registry.js';
export * from './ops/schema.js';
export * from './ops/scopes.js';
export * from './ops/shapes.js';
export * from './ops/vault.js';
export * from './ops/watch.js';

/** Engine version, reported by `vault.health` and the MCP server. */
export const BOUSLEH_VERSION = '0.0.0';
