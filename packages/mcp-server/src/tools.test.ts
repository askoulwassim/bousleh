import { OP_NAMES, OPS, opInputJsonSchema } from '@bousleh/contracts';
import { describe, expect, it } from 'vitest';
import { buildTools, META_KEY, outcomeToToolResult, toolNameFor, toolNameMap } from './tools.js';

describe('generated tools', () => {
  it('has exactly one tool per op, in registry order, named with underscores', () => {
    const tools = buildTools(OPS);
    expect(tools.map((t) => t.title)).toEqual(OP_NAMES);
    expect(tools.map((t) => t.name)).toEqual(OP_NAMES.map(toolNameFor));
    expect(tools.find((t) => t.title === 'vault.health')?.name).toBe('vault_health');
    for (const t of tools) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect((t._meta?.[META_KEY] as { op: string } | undefined)?.op).toBe(t.title);
    }
  });

  it('advertises each op input schema (minus $schema) and its read-only flag', () => {
    for (const tool of buildTools(OPS)) {
      const def = OPS[tool.title as keyof typeof OPS];
      const { $schema: _s, ...expected } = opInputJsonSchema(def);
      expect(tool.inputSchema).toEqual(expected);
      expect(tool.description?.startsWith(def.description)).toBe(true);
      expect(tool.annotations?.readOnlyHint).toBe(def.readOnly === true);
    }
  });

  it('maps tool names back to ops', () => {
    expect(toolNameMap(OPS).get('vault_health')).toBe('vault.health');
  });

  it('renders ok and error outcomes', () => {
    expect(outcomeToToolResult({ status: 'ok', output: { a: 1 } })).toEqual({
      content: [{ type: 'text', text: '{"a":1}' }],
      structuredContent: { status: 'ok', output: { a: 1 } },
    });
    const bad = outcomeToToolResult({ status: 'error', code: 'not_found', message: 'nope' });
    expect(bad.isError).toBe(true);
    expect(bad.content).toEqual([{ type: 'text', text: 'not_found: nope' }]);
  });
});
