/*
 * The Bousleh MCP server. A thin adapter: each tool maps 1:1 onto `runOp(name, input, ctx)`.
 * Validation, handlers and writes all happen inside runOp. The actor is always `agent`.
 */
import { BOUSLEH_VERSION, OPS, type OpContext, type OpRegistry, type RunOp } from '@bousleh/contracts';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { SERVER_ICONS } from './icon.js';
import { buildTools, outcomeToToolResult, toolNameMap } from './tools.js';

export const SERVER_NAME = 'bousleh';

export interface BouslehMcpServerOptions {
  /** The single ops entry point: `openEngine().runOp` (tests may inject their own). */
  runOp: RunOp;
  /** The ops to expose as tools. Default: OPS. Must be the registry runOp serves. */
  registry?: OpRegistry;
  /** Injected clock (deterministic tests). */
  now?: () => Date;
}

const INSTRUCTIONS = [
  'Bousleh: Wassim’s personal operating system for product leadership. Every tool is one op from the Bousleh ops registry; the tool name is the op name with its dots replaced by underscores.',
  'You supply the judgment; the tools do the mechanics (filing, linking, history). Nothing is overwritten: changes supersede.',
].join(' ');

export function createBouslehMcpServer(options: BouslehMcpServerOptions): McpServer {
  const { runOp } = options;
  const registry = options.registry ?? OPS;
  const now = options.now ?? (() => new Date());
  const ctx = (): OpContext => ({ actor: 'agent', now });

  const mcp = new McpServer(
    { name: SERVER_NAME, version: BOUSLEH_VERSION, icons: SERVER_ICONS },
    { capabilities: { tools: { listChanged: false } }, instructions: INSTRUCTIONS },
  );

  const tools = buildTools(registry);
  const byName = toolNameMap(registry);
  mcp.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  mcp.server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const op = byName.get(req.params.name);
    if (!op) throw new McpError(ErrorCode.InvalidParams, `unknown tool: ${req.params.name}`);
    try {
      return outcomeToToolResult(await runOp(op, req.params.arguments ?? {}, ctx()));
    } catch (err) {
      return outcomeToToolResult({ status: 'error', code: 'internal', message: err instanceof Error ? err.message : String(err) });
    }
  });
  return mcp;
}
