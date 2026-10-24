import { z } from 'zod';
import type { OpDef } from './define.js';

/** JSON Schema of an op's input, as doors (MCP) advertise it. */
export function opInputJsonSchema(def: OpDef): Record<string, unknown> {
  return z.toJSONSchema(def.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
}

/** JSON Schema of an op's output. */
export function opOutputJsonSchema(def: OpDef): Record<string, unknown> {
  return z.toJSONSchema(def.output, { io: 'output', unrepresentable: 'any' }) as Record<string, unknown>;
}
