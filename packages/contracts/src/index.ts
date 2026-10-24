/* @bousleh/contracts: object kinds, layers, altitude and scope, and every op's name and zod schemas. Imports nothing. */
export * from './ops/define.js';
export * from './ops/registry.js';
export * from './ops/schema.js';

/** Engine version, reported by `vault.health` and the MCP server. */
export const BOUSLEH_VERSION = '0.0.0';
