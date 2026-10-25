#!/usr/bin/env node
/*
 * bousleh-mcp: the Bousleh MCP server over stdio, on the real engine.
 *   bousleh-mcp [--home <dir>]    vault at --home, else BOUSLEH_HOME, else ~/.bousleh
 * stdout belongs to the stdio protocol: log to stderr only.
 */
import { openEngine } from '@bousleh/engine';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createBouslehMcpServer } from './server.js';

function flag(name: string): string | undefined {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const home = flag('--home');
  // Daily backup snapshot next to your data (~/.bousleh-backups), keeping 14.
  const engine = openEngine(home ? { home, autoBackup: {} } : { autoBackup: {} });
  process.stderr.write(`bousleh-mcp: vault ${engine.home}\n`);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    engine.close();
  };
  const shutdown = () => {
    close();
    process.exit(0);
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  // When the client closes stdin, in-flight calls finish, the loop drains, then the engine closes.
  process.once('beforeExit', close);

  const server = createBouslehMcpServer({ runOp: engine.runOp, registry: engine.registry });
  await server.connect(new StdioServerTransport());
}

main().catch((err: unknown) => {
  process.stderr.write(`bousleh-mcp: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
