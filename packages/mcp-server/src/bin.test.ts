import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The built server, spawned the way Claude Desktop and Claude Code spawn it. Run `pnpm build` first.
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'bin.js');

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'bousleh-bin-'));
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe.skipIf(!existsSync(BIN))('bousleh-mcp over stdio', () => {
  it('answers vault_health for the data home in BOUSLEH_HOME', async () => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [BIN], env: { BOUSLEH_HOME: home }, stderr: 'pipe' });
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(transport);
    try {
      expect((await client.listTools()).tools.map((t) => t.name)).toContain('vault_health');
      const res = await client.callTool({ name: 'vault_health', arguments: {} });
      expect(res.structuredContent).toMatchObject({ status: 'ok', output: { ok: true, home } });
    } finally {
      await client.close();
    }
  });
});
