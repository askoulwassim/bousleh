#!/usr/bin/env bash
# Set up Bousleh on this Mac, end to end. Safe to rerun, e.g. after `git pull`.
#
#   scripts/setup-mac.sh [--home <dir>]
#
# Builds the engine, registers the Bousleh MCP server in Claude Desktop and Claude Code, installs the
# plugin in Claude Code, builds the plugin file for your Claude account, and checks the server.
# It never touches your data beyond creating the empty folder. See SETUP.md.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${BOUSLEH_HOME:-$HOME/.bousleh}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) DATA="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
DESKTOP_CONFIG="${BOUSLEH_DESKTOP_CONFIG:-$HOME/Library/Application Support/Claude/claude_desktop_config.json}"
LEFT=()

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
note() { printf '  ! %s\n' "$*"; }

step "1/6 Tools"
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then echo "  Node 22 or newer is needed (brew install node@22), then rerun." >&2; exit 1; fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if (( MAJOR < 22 )); then echo "  Node $MAJOR found; 22 or newer is needed." >&2; exit 1; fi
ok "node $("$NODE" -v) at $NODE"
if ! command -v pnpm >/dev/null 2>&1; then corepack enable >/dev/null 2>&1 || npm install -g pnpm >/dev/null; fi
ok "pnpm $(pnpm -v)"

step "2/6 Build"
(cd "$REPO" && pnpm install --frozen-lockfile --reporter=silent && pnpm -s build)
BIN="$REPO/packages/mcp-server/dist/bin.js"
[[ -f "$BIN" ]] || { echo "  build did not produce $BIN" >&2; exit 1; }
ok "engine and MCP server built"

step "3/6 Your data"
mkdir -p "$DATA"
ok "data folder: $DATA"
ok "daily backups go to ${DATA}-backups (the newest 14 are kept)"

SERVER_JSON="$("$NODE" -e '
  const [command, bin, home] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({ type: "stdio", command, args: [bin], env: { BOUSLEH_HOME: home } }));
' "$NODE" "$BIN" "$DATA")"

step "4/6 Claude Desktop"
if [[ "$(uname)" == "Darwin" || -n "${BOUSLEH_DESKTOP_CONFIG:-}" ]]; then
  mkdir -p "$(dirname "$DESKTOP_CONFIG")"
  if [[ -f "$DESKTOP_CONFIG" ]]; then
    BACKUP="$DESKTOP_CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$DESKTOP_CONFIG" "$BACKUP"
    ok "backed up the config to $(basename "$BACKUP")"
  fi
  "$NODE" -e '
    const fs = require("node:fs");
    const [file, server] = process.argv.slice(1);
    const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8") || "{}") : {};
    const { type, ...entry } = JSON.parse(server);
    config.mcpServers = { ...(config.mcpServers ?? {}), bousleh: entry };
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  ' "$DESKTOP_CONFIG" "$SERVER_JSON"
  ok "bousleh MCP server registered in Claude Desktop"
  LEFT+=("Quit Claude Desktop (Cmd-Q) and open it again, so it starts the Bousleh server.")
else
  note "not a Mac: skipped"
fi

step "5/6 Claude Code"
if command -v claude >/dev/null 2>&1; then
  claude mcp remove -s user bousleh >/dev/null 2>&1 || true
  claude mcp add-json -s user bousleh "$SERVER_JSON" >/dev/null
  ok "bousleh MCP server registered (user scope)"
  if claude plugin list 2>/dev/null | grep -q 'bousleh@'; then
    ok "plugin already installed; it reads the skills from this repo"
  else
    claude plugin marketplace add "$REPO" >/dev/null
    claude plugin install bousleh@bousleh >/dev/null
    ok "plugin installed: bousleh@bousleh"
  fi
else
  note "Claude Code (the claude command) not found: skipped. Rerun this script after installing it."
fi

step "6/6 Plugin file for your Claude account"
mkdir -p "$REPO/dist"
rm -f "$REPO/dist/bousleh.plugin"
(cd "$REPO/plugin" && zip -qr "$REPO/dist/bousleh.plugin" .claude-plugin skills README.md)
ok "built dist/bousleh.plugin"
LEFT+=("Upload dist/bousleh.plugin to your Claude account in Claude Desktop (where plugins are added in Settings). It brings the nine skills, Drop included, to Desktop, web and phone. Re-upload after skill changes.")
LEFT+=("Check that Google Drive is connected to this Claude account (Settings, Connectors). Capture and Drop use it for the \"Bousleh Inbox\" folder; Drop creates the folder on first use.")
LEFT+=("In a Claude Desktop chat, say: \"Bousleh: mark me as the user, I'm <your name>.\"")

step "Check"
OPS="$("$NODE" --input-type=module -e '
  const { openEngine } = await import(process.argv[1]);
  const engine = openEngine({ home: process.argv[2] });
  const out = await engine.runOp("vault.health", {}, { actor: "human", now: () => new Date() });
  engine.close();
  if (out.status !== "ok") { console.error(out.message); process.exit(1); }
  process.stdout.write(String(out.output.ops));
' "$REPO/packages/engine/dist/index.js" "$DATA")"
ok "the engine answers with $OPS ops"

printf '\n\033[1mLeft for you\033[0m\n'
for i in "${!LEFT[@]}"; do printf '  %d. %s\n' "$((i + 1))" "${LEFT[$i]}"; done
if [[ "$(uname)" == "Darwin" ]]; then open "$REPO/dist" >/dev/null 2>&1 || true; fi
