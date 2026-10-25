# @bousleh/mcp-server

The Bousleh MCP server: stdio, local only. Every tool is generated from the ops registry in `@bousleh/contracts`. The tool name is the op name with dots as underscores. Every call goes through `runOp` in `@bousleh/engine`. This package has no per-op code, and a test fails if an op name shows up in its source.

Build first (`pnpm install && pnpm build` at the repo root), then register the built `dist/bin.js`. Use absolute paths: Claude Desktop does not start servers with your shell's `PATH`.

## Claude Desktop

Add this to `~/Library/Application Support/Claude/claude_desktop_config.json` (merge it into `mcpServers` if that key already exists), then restart Claude Desktop:

```json
{
  "mcpServers": {
    "bousleh": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/wassimaskoul/Documents/Claude/Projects/Bousleh/bousleh.nosync/packages/mcp-server/dist/bin.js"]
    }
  }
}
```

## Claude Code

```sh
claude mcp add bousleh --scope user -- /opt/homebrew/bin/node /Users/wassimaskoul/Documents/Claude/Projects/Bousleh/bousleh.nosync/packages/mcp-server/dist/bin.js
```

`--scope user` makes it available in every project. Check it with `claude mcp list`, or `/mcp` inside a session.

## Where your data lives

The server reads your data at `--home <dir>` (add it to `args`), else `BOUSLEH_HOME` (add `"env": { "BOUSLEH_HOME": "…" }` in the Desktop config), else `~/.bousleh`. The work Mac uses the same config with its own data.

## Try it

Ask Claude to call `vault_health`. It reports the engine version, where your data lives, whether it exists yet, and how many ops are registered.
