#!/usr/bin/env node
/*
 * Fresh-install smoke test, run by CI after `pnpm build`:
 *   node scripts/smoke.mjs
 * Starts the built MCP server over stdio on a temporary BOUSLEH_HOME (never your data), lists its
 * tools, calls vault_health, and fails unless every op in the registry is a tool. It speaks the MCP
 * stdio protocol (one JSON-RPC message per line) by hand, so it needs nothing beyond the build.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const bin = join(repo, 'packages', 'mcp-server', 'dist', 'bin.js');
const { OPS } = await import(pathToFileURL(join(repo, 'packages', 'contracts', 'dist', 'index.js')).href);

const root = mkdtempSync(join(tmpdir(), 'bousleh-smoke-'));
const home = join(root, '.bousleh');
const server = spawn(process.execPath, [bin], {
  env: { ...process.env, BOUSLEH_HOME: home, BOUSLEH_BACKUPS: join(root, 'backups') },
  stdio: ['pipe', 'pipe', 'inherit'],
});

const pending = new Map();
let buffer = '';
server.stdout.setEncoding('utf8');
server.stdout.on('data', (chunk) => {
  buffer += chunk;
  for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    const waiting = pending.get(message.id);
    if (!waiting) continue;
    pending.delete(message.id);
    if (message.error) waiting.reject(new Error(`${message.error.code}: ${message.error.message}`));
    else waiting.resolve(message.result);
  }
});
server.on('exit', (code) => {
  for (const { reject } of pending.values()) reject(new Error(`the server exited (code ${code})`));
  pending.clear();
});

let nextId = 1;
function request(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}
function notify(method, params) {
  server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

function fail(message) {
  throw new Error(message);
}

const timer = setTimeout(() => {
  console.error('smoke: no answer from the server within 30 seconds');
  server.kill();
  process.exit(1);
}, 30_000);

let failed = false;
try {
  const init = await request('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'bousleh-smoke', version: '0.0.0' },
  });
  if (init.serverInfo?.name !== 'bousleh') fail(`unexpected server: ${JSON.stringify(init.serverInfo)}`);
  notify('notifications/initialized', {});

  const tools = [];
  let cursor;
  do {
    const page = await request('tools/list', cursor ? { cursor } : {});
    tools.push(...page.tools);
    cursor = page.nextCursor;
  } while (cursor);
  const names = new Set(tools.map((tool) => tool.name));
  const ops = Object.keys(OPS);
  const missing = ops.filter((op) => !names.has(op.replaceAll('.', '_')));
  if (missing.length > 0) fail(`ops with no tool: ${missing.join(', ')}`);
  console.log(`smoke: ${tools.length} tools, one for each of the ${ops.length} ops`);

  const result = await request('tools/call', { name: 'vault_health', arguments: {} });
  if (result.isError) fail(`vault_health failed: ${JSON.stringify(result.content)}`);
  const health = result.structuredContent?.output;
  if (!health?.ok) fail(`vault_health is not ok: ${JSON.stringify(result.structuredContent)}`);
  if (health.home !== home) fail(`vault_health reads ${health.home}, not the temporary home ${home}`);
  if (health.ops !== ops.length) fail(`vault_health counts ${health.ops} ops, the registry has ${ops.length}`);
  console.log(`smoke: vault_health ok (version ${health.version}, ${health.ops} ops)`);

  // A write op creates the data home, readable only by this account.
  const scopes = await request('tools/call', { name: 'scopes_add', arguments: { slug: 'smoke', name: 'Smoke', kind: 'project' } });
  if (scopes.isError) fail(`scopes_add failed: ${JSON.stringify(scopes.content)}`);
  const mode = statSync(home).mode & 0o777;
  if (mode !== 0o700) fail(`the data home is mode ${mode.toString(8)}, not 700`);
  console.log('smoke: a write created the data home, mode 700');
} catch (error) {
  failed = true;
  console.error(`smoke: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  clearTimeout(timer);
  server.stdin.end();
  await new Promise((resolve) => (server.exitCode === null ? server.once('exit', resolve) : resolve()));
  rmSync(root, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
