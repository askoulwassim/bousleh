#!/usr/bin/env bash
# Set up Bousleh on this Mac, end to end. Safe to rerun, e.g. after `git pull`.
#
#   scripts/setup-mac.sh [--home <dir>]
#   scripts/setup-mac.sh --check      only report what is already set up; change nothing
#
# Builds the engine, registers the Bousleh MCP server in Claude Desktop and Claude Code, installs the
# plugin in Claude Code, builds the plugin file for your Claude account, and checks the server.
# It never touches your data beyond creating the empty folder. See SETUP.md.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${BOUSLEH_HOME:-$HOME/.bousleh}"
CHECK=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) DATA="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
DESKTOP_CONFIG="${BOUSLEH_DESKTOP_CONFIG:-$HOME/Library/Application Support/Claude/claude_desktop_config.json}"
LEFT=()

step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  ✓ %s\n' "$*"; }
note() { printf '  ! %s\n' "$*"; }

# Folders where an earlier Claude Code session may have registered the server at local scope.
CODE_DIRS=()
for dir in "$REPO" "$(dirname "$REPO")" "$PWD"; do
  [[ " ${CODE_DIRS[*]-} " == *" $dir "* ]] || CODE_DIRS+=("$dir")
done

if (( CHECK )); then
  step "What is set up already (nothing is changed)"
  if [[ -f "$DESKTOP_CONFIG" ]]; then
    node -e '
      const fs = require("node:fs");
      const servers = JSON.parse(fs.readFileSync(process.argv[1], "utf8") || "{}").mcpServers ?? {};
      const ours = Object.entries(servers).filter(([name, s]) => name === "bousleh" || JSON.stringify(s.args ?? []).includes("mcp-server/dist/bin.js"));
      if (ours.length === 0) console.log("  Claude Desktop: no Bousleh server registered");
      for (const [name, s] of ours) console.log(`  Claude Desktop: "${name}" runs ${[s.command, ...(s.args ?? [])].join(" ")}${s.env ? `, env ${Object.keys(s.env).join(", ")}` : ""}`);
      if (ours.length > 1) console.log("  ! more than one entry: setup keeps only \"bousleh\"");
    ' "$DESKTOP_CONFIG"
  else
    echo "  Claude Desktop: no config file yet"
  fi
  if command -v claude >/dev/null 2>&1; then
    for dir in "${CODE_DIRS[@]}"; do
      echo "  Claude Code, seen from $dir:"
      (cd "$dir" && claude mcp get bousleh 2>&1 | sed 's/^/    /') || true
    done
    echo "  Claude Code plugins:"
    claude plugin list 2>/dev/null | grep -i bousleh | sed 's/^/    /' || echo "    none named bousleh"
  else
    echo "  Claude Code: the claude command isn't installed"
  fi
  if [[ -d "$DATA" ]]; then echo "  Data folder: $DATA ($(find "$DATA" -type f | wc -l | tr -d ' ') files, vault.db $([[ -f "$DATA/vault.db" ]] && echo present || echo absent))"; else echo "  Data folder: $DATA (not created yet)"; fi
  if [[ -d "$DATA-backups" ]]; then echo "  Backups: $(ls "$DATA-backups" | wc -l | tr -d ' ') snapshots in $DATA-backups"; else echo "  Backups: none yet"; fi
  exit 0
fi

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
    const servers = { ...(config.mcpServers ?? {}) };
    // One Bousleh entry only: drop any other name that runs this server.
    for (const [name, s] of Object.entries(servers)) {
      if (name !== "bousleh" && JSON.stringify(s?.args ?? []).includes("mcp-server/dist/bin.js")) {
        delete servers[name];
        console.log(`  ✓ removed a second Bousleh entry named "${name}"`);
      }
    }
    config.mcpServers = { ...servers, bousleh: entry };
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  ' "$DESKTOP_CONFIG" "$SERVER_JSON"
  ok "bousleh MCP server registered in Claude Desktop"
  LEFT+=("Quit Claude Desktop (Cmd-Q) and open it again, so it starts the Bousleh server.")
else
  note "not a Mac: skipped"
fi

step "5/6 Claude Code"
if command -v claude >/dev/null 2>&1; then
  # One registration only: clear local-scope entries an earlier session may have made, then user scope.
  for dir in "${CODE_DIRS[@]}"; do (cd "$dir" && claude mcp remove -s local bousleh >/dev/null 2>&1) || true; done
  claude mcp remove -s user bousleh >/dev/null 2>&1 || true
  claude mcp add-json -s user bousleh "$SERVER_JSON" >/dev/null
  ok "bousleh MCP server registered once, at user scope"
  INSTALLED="$(claude plugin list 2>/dev/null | grep -o 'bousleh@[A-Za-z0-9_-]*' | sort -u || true)"
  if [[ -n "$INSTALLED" ]]; then
    ok "plugin already installed ($(echo "$INSTALLED" | tr '\n' ' ' | sed 's/ $//')); left as is"
    if (( $(echo "$INSTALLED" | wc -l) > 1 )); then note "more than one Bousleh plugin is installed; keep one with: claude plugin uninstall <name>"; fi
  else
    claude plugin marketplace add "$REPO" >/dev/null
    claude plugin install bousleh@bousleh >/dev/null
    ok "plugin installed: bousleh@bousleh"
  fi
else
  note "Claude Code (the claude command) not found: skipped. Rerun this script after installing it."
fi

step "6/6 Plugin for your Claude account"
mkdir -p "$REPO/dist"
rm -f "$REPO/dist/bousleh.plugin"
(cd "$REPO/plugin" && zip -qr "$REPO/dist/bousleh.plugin" .claude-plugin skills README.md)
ok "the repo is a plugin marketplace (.claude-plugin/marketplace.json); dist/bousleh.plugin is built as a fallback"
LEFT+=("Once per Claude account, in Claude Desktop: Customize > Plugins > Add > Add marketplace > Add from a repository, enter askoulwassim/bousleh, then add the Bousleh plugin. It brings the nine skills, Drop included, to Desktop chat and the web, and updates from GitHub. Skip this if the account already has it. Fallback, if that option is missing or the repo can't be reached: upload dist/bousleh.plugin there instead.")
LEFT+=("Check that Google Drive is connected to this Claude account (Settings, Connectors). Capture and Drop use it for the \"Bousleh Inbox\" folder; Drop creates the folder on first use.")
LEFT+=("In a Claude Desktop chat, say: \"Bousleh: mark me as the user, I'm <your name>.\" (Once per Mac; skip if done.)")
LEFT+=("In Claude Desktop's Code tab, on this repo folder, say: \"Set up the scheduled tasks in docs/scheduled-tasks.md.\" That file is the only definition of the Hourly inbox sweep (needs this Mac, hourly) and the Daily Horizon scan (cloud); saying it again updates them, never duplicates. Repeat after git pull or a watch list change.")

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
