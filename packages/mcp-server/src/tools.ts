/*
 * Tool generation. Every MCP tool is derived from an ops registry (`OPS` by default): name,
 * description, read-only hint and JSON Schema. Nothing here is written per op, and nothing here
 * decides anything: the result of a call is whatever `runOp` returns.
 */
import { type OpDef, type OpOutcome, type OpRegistry, opInputJsonSchema } from '@bousleh/contracts';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';

export const META_KEY = 'bousleh/op';

/**
 * `vault.search` is exposed as `vault_search`. Dots are valid per the MCP spec, but the model APIs
 * behind MCP clients only accept `[a-zA-Z0-9_-]`, so tool names use underscores. Op names stay
 * dotted everywhere else (registry, runOp, the tool `title`, `_meta`).
 */
export function toolNameFor(op: string): string {
  return op.replaceAll('.', '_');
}

/** Tool name -> op name. Throws if two ops would share a tool name. */
export function toolNameMap(registry: OpRegistry): Map<string, string> {
  const map = new Map<string, string>();
  for (const op of Object.keys(registry)) {
    const name = toolNameFor(op);
    const taken = map.get(name);
    if (taken) throw new Error(`tool name collision: ${name} (${taken} and ${op})`);
    map.set(name, op);
  }
  return map;
}

/** The input JSON Schema clients see: the op's, minus the `$schema` key some clients reject. */
export function toolInputSchema(def: OpDef): Tool['inputSchema'] {
  const { $schema: _ignored, ...schema } = opInputJsonSchema(def);
  if (schema.type !== 'object') throw new Error(`op ${def.name} input is not an object schema`);
  return schema as Tool['inputSchema'];
}

export function buildTool(def: OpDef): Tool {
  const notes = [def.readOnly ? 'Read only.' : undefined, def.unimplemented ? 'Not implemented yet.' : undefined].filter(Boolean);
  return {
    name: toolNameFor(def.name),
    title: def.name,
    description: [def.description, ...notes].join(' '),
    inputSchema: toolInputSchema(def),
    annotations: {
      title: def.name,
      readOnlyHint: def.readOnly === true,
      // Nothing in Bousleh is overwritten (supersedes links), so no op is destructive.
      destructiveHint: false,
      idempotentHint: def.readOnly === true,
      openWorldHint: false,
    },
    _meta: { [META_KEY]: { op: def.name, readOnly: def.readOnly === true } },
  };
}

/** One tool per op, in registry order. */
export function buildTools(registry: OpRegistry): Tool[] {
  return Object.values(registry).map(buildTool);
}

/** Render an `OpOutcome` as an MCP tool result; the outcome is passed through in `structuredContent`. */
export function outcomeToToolResult(outcome: OpOutcome): CallToolResult {
  if (outcome.status === 'ok') {
    return {
      content: [{ type: 'text', text: JSON.stringify(outcome.output) }],
      structuredContent: { status: 'ok', output: outcome.output },
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `${outcome.code}: ${outcome.message}` }],
    structuredContent: {
      status: 'error',
      code: outcome.code,
      message: outcome.message,
      ...(outcome.issues === undefined ? {} : { issues: outcome.issues }),
    },
  };
}
