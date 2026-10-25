import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineOp, OP_NAMES, OPS } from '@bousleh/contracts';
import { ALL_HANDLERS, openEngine } from '@bousleh/engine';
import { defineHandler } from '@bousleh/vault';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type BouslehMcpServerOptions, createBouslehMcpServer } from './server.js';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-mcp-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

async function connect(options: BouslehMcpServerOptions): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createBouslehMcpServer(options).connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  return client;
}

describe('MCP server', () => {
  it('serves vault_health through runOp', async () => {
    const client = await connect({ runOp: openEngine({ home }).runOp });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(['vault_health']);
    const res = await client.callTool({ name: 'vault_health', arguments: {} });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ status: 'ok', output: { ok: true, home, data: { exists: true, db: false } } });
  });

  it('exposes an op added to the registry as a tool, with no MCP code changes', async () => {
    const notesCount = defineOp({
      name: 'notes.count_words',
      description: 'Count the words in a piece of text.',
      input: z.object({ text: z.string() }),
      output: z.object({ words: z.number().int() }),
      readOnly: true,
    });
    const registry = { ...OPS, 'notes.count_words': notesCount };
    const handler = defineHandler(notesCount, ({ text }) => ({ words: text.split(/\s+/).filter(Boolean).length }));
    const engine = openEngine({ home, registry, handlers: [...ALL_HANDLERS, handler] });

    const client = await connect({ runOp: engine.runOp, registry: engine.registry });
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'notes_count_words');
    expect(tool).toMatchObject({
      title: 'notes.count_words',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      annotations: { readOnlyHint: true },
    });

    const ok = await client.callTool({ name: 'notes_count_words', arguments: { text: 'one compass, two vaults' } });
    expect(ok.structuredContent).toEqual({ status: 'ok', output: { words: 4 } });
    const bad = await client.callTool({ name: 'notes_count_words', arguments: { text: 42 } });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent).toMatchObject({ status: 'error', code: 'invalid_input' });
  });

  it('rejects unknown tools', async () => {
    const client = await connect({ runOp: openEngine({ home }).runOp });
    await expect(client.callTool({ name: 'nope_nothing', arguments: {} })).rejects.toThrow(/unknown tool/);
  });

  it('turns a throwing runOp into an internal error result', async () => {
    const client = await connect({
      runOp: async () => {
        throw new Error('boom');
      },
    });
    const res = await client.callTool({ name: 'vault_health', arguments: {} });
    expect(res.structuredContent).toEqual({ status: 'error', code: 'internal', message: 'boom' });
  });

  it('has no per-op code: no op name appears in the server source', () => {
    const src = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
    for (const file of files) {
      const text = readFileSync(join(src, file), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
      for (const op of OP_NAMES) {
        expect(text, `${file} mentions ${op}`).not.toContain(op);
        expect(text, `${file} mentions ${op}`).not.toContain(op.replaceAll('.', '_'));
      }
    }
  });
});
