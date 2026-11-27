#!/usr/bin/env bash
# Set up Bousleh on this Mac, end to end. Safe to rerun, e.g. after `git pull`.
#
#   scripts/setup-mac.sh [--home <dir>]
#   scripts/setup-mac.sh --check           only report what is already set up; change nothing
#   scripts/setup-mac.sh --demo            add the demo data (~/.bousleh-demo) as a second server, bousleh-demo
#   scripts/setup-mac.sh --demo --remove   take the bousleh-demo server out again (the demo data stays)
#   scripts/setup-mac.sh --no-claude       don't open Claude at the end (print the hand-off instead)
#
# Builds the engine, registers the Bousleh MCP server in Claude Desktop and Claude Code, installs the
# plugin in Claude Code, builds the plugin file for your Claude account, and checks the server. Then it
# opens Claude's Code tab on this repo with "Finish setting up Bousleh from docs/finish-setup.md." typed in:
# pressing Enter publishes Home and sets up the scheduled tasks, the same way every time.
# It never touches your data beyond creating the empty folder. --demo never touches the bousleh
# entry or ~/.bousleh. Clone the repo anywhere. See SETUP.md.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="${BOUSLEH_HOME:-$HOME/.bousleh}"
CHECK=0
DEMO=0
REMOVE=0
OPEN_CLAUDE=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) DATA="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    --demo) DEMO=1; shift ;;
    --remove) REMOVE=1; shift ;;
    --no-claude) OPEN_CLAUDE=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done
if (( REMOVE && !DEMO )); then echo "--remove goes with --demo: scripts/setup-mac.sh --demo --remove" >&2; exit 2; fi
# The demo data and its server name. The demo server reads it with --home, never BOUSLEH_HOME.
DEMO_DATA="$HOME/.bousleh-demo"
DEMO_NAME="bousleh-demo"
DESKTOP_CONFIG="${BOUSLEH_DESKTOP_CONFIG:-$HOME/Library/Application Support/Claude/claude_desktop_config.json}"
# Where Home (installed as an app) finds this repo, to run Tune and the checks. Never inside the repo.
APP_JSON="${BOUSLEH_APP_JSON:-$HOME/.bousleh/app.json}"
LEFT=()

# The folder macOS guards per app that holds this repo (Documents, Desktop, Downloads, iCloud Drive), if any.
# Home, installed as an app, is its own app to macOS: it can run Tune and the checks here only once that
# folder is allowed for it.
GUARDED=""
case "$REPO/" in
  "$HOME/Documents/"*) GUARDED="Documents" ;;
  "$HOME/Desktop/"*) GUARDED="Desktop" ;;
  "$HOME/Downloads/"*) GUARDED="Downloads" ;;
  "$HOME/Library/Mobile Documents/"*) GUARDED="iCloud Drive" ;;
esac
GUARDED_NOTE="This repo is in your $GUARDED folder, which macOS guards per app: Home, installed as an app, can't run Tune or its health check here. Move the clone out: in Claude Code on this repo, say \"Move this clone as docs/move.md says.\""

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
      const ours = Object.entries(servers).filter(([name, s]) => name === "bousleh" || name === "bousleh-demo" || JSON.stringify(s.args ?? []).includes("mcp-server/dist/bin.js"));
      if (!ours.some(([name]) => name !== "bousleh-demo")) console.log("  Claude Desktop: no Bousleh server registered");
      for (const [name, s] of ours) console.log(`  Claude Desktop: "${name}" runs ${[s.command, ...(s.args ?? [])].join(" ")}${s.env ? `, env ${Object.keys(s.env).join(", ")}` : ""}${name === "bousleh-demo" ? " (the demo data)" : ""}`);
      if (ours.filter(([name]) => name !== "bousleh-demo").length > 1) console.log("  ! more than one entry: setup keeps only \"bousleh\"");
    ' "$DESKTOP_CONFIG"
  else
    echo "  Claude Desktop: no config file yet"
  fi
  if command -v claude >/dev/null 2>&1; then
    for dir in "${CODE_DIRS[@]}"; do
      echo "  Claude Code, seen from $dir:"
      (cd "$dir" && claude mcp get bousleh 2>&1 | sed 's/^/    /') || true
    done
    if claude mcp get "$DEMO_NAME" >/dev/null 2>&1; then echo "  Claude Code: $DEMO_NAME registered (the demo data)"; fi
    echo "  Claude Code plugins:"
    claude plugin list 2>/dev/null | grep -i bousleh | sed 's/^/    /' || echo "    none named bousleh"
  else
    echo "  Claude Code: the claude command isn't installed"
  fi
  if [[ -f "$REPO/packages/home/dist/home.html" ]]; then echo "  Home page: built (packages/home/dist/home.html); publish it with docs/home.md"; else echo "  Home page: not built yet (packages/home/dist/home.html is missing; run this script)"; fi
  if [[ -n "$GUARDED" ]]; then echo "  ! $GUARDED_NOTE"; fi
  echo "  Scheduled tasks this repo defines (docs/scheduled-tasks.md; the finish step creates or updates them):"
  node "$REPO/scripts/scheduled-tasks.mjs" --list 2>&1 | sed 's/^/    /' || true
  if [[ -f "$APP_JSON" ]]; then echo "  Home app: $APP_JSON points at $(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).repo' "$APP_JSON" 2>/dev/null || echo 'an unreadable path')"; else echo "  Home app: $APP_JSON not written yet (run this script without --check)"; fi
  if [[ -d "$DATA" ]]; then echo "  Data folder: $DATA ($(find "$DATA" -type f | wc -l | tr -d ' ') files, vault.db $([[ -f "$DATA/vault.db" ]] && echo present || echo absent))"; else echo "  Data folder: $DATA (not created yet)"; fi
  if [[ -d "$DATA-backups" ]]; then echo "  Backups: $(ls "$DATA-backups" | wc -l | tr -d ' ') snapshots in $DATA-backups"; else echo "  Backups: none yet"; fi
  if [[ -f "$DEMO_DATA/demo.json" ]]; then echo "  Demo data: $DEMO_DATA (pnpm demo --reset re-seeds it; scripts/setup-mac.sh --demo --remove unregisters it)"; fi
  exit 0
fi

# --demo --remove: take the bousleh-demo server out of Claude Desktop and Claude Code. Nothing else.
if (( DEMO && REMOVE )); then
  step "Remove the demo server ($DEMO_NAME)"
  if [[ -f "$DESKTOP_CONFIG" ]]; then
    node -e '
      const fs = require("node:fs");
      const [file, name] = process.argv.slice(1);
      const config = JSON.parse(fs.readFileSync(file, "utf8") || "{}");
      if (!config.mcpServers?.[name]) { console.log(`  ✓ Claude Desktop: no ${name} entry`); process.exit(0); }
      fs.copyFileSync(file, `${file}.bak-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}`);
      delete config.mcpServers[name];
      fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
      console.log(`  ✓ Claude Desktop: removed ${name} (config backed up first)`);
    ' "$DESKTOP_CONFIG" "$DEMO_NAME"
  else
    ok "Claude Desktop: no config file"
  fi
  if command -v claude >/dev/null 2>&1; then
    claude mcp remove -s user "$DEMO_NAME" >/dev/null 2>&1 && ok "Claude Code: removed $DEMO_NAME" || ok "Claude Code: no $DEMO_NAME entry"
  fi
  ok "the demo data stays in $DEMO_DATA; delete that folder (and $DEMO_DATA-backups) when you're done with it"
  printf '\n\033[1mLeft for you\033[0m\n  1. Quit Claude Desktop (Cmd-Q) and open it again.\n'
  exit 0
fi

TOTAL=$(( DEMO ? 5 : 6 ))
step "1/$TOTAL Tools"
NODE="$(command -v node || true)"
if [[ -z "$NODE" ]]; then echo "  Node 22 or newer is needed (brew install node@22), then rerun." >&2; exit 1; fi
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
if (( MAJOR < 22 )); then echo "  Node $MAJOR found; 22 or newer is needed." >&2; exit 1; fi
ok "node $("$NODE" -v) at $NODE"
if ! command -v pnpm >/dev/null 2>&1; then corepack enable >/dev/null 2>&1 || npm install -g pnpm >/dev/null; fi
ok "pnpm $(pnpm -v)"

step "2/$TOTAL Build"
(cd "$REPO" && pnpm install --frozen-lockfile --reporter=silent && pnpm -s build)
BIN="$REPO/packages/mcp-server/dist/bin.js"
[[ -f "$BIN" ]] || { echo "  build did not produce $BIN" >&2; exit 1; }
HOME_PAGE="$REPO/packages/home/dist/home.html"
[[ -f "$HOME_PAGE" ]] || { echo "  build did not produce $HOME_PAGE" >&2; exit 1; }
ok "engine, MCP server and Home page built"

if (( DEMO )); then
  # The demo: its own data and its own server entry. The real bousleh entry and ~/.bousleh are never touched.
  step "3/5 Demo data"
  "$NODE" "$REPO/scripts/demo.mjs" | sed 's/^/  /;/^  $/,$d'
  [[ -f "$DEMO_DATA/demo.json" ]] || { echo "  no demo data in $DEMO_DATA" >&2; exit 1; }
  DEMO_JSON="$("$NODE" -e '
    const [command, bin, home] = process.argv.slice(1);
    process.stdout.write(JSON.stringify({ type: "stdio", command, args: [bin, "--home", home] }));
  ' "$NODE" "$BIN" "$DEMO_DATA")"

  step "4/5 Claude Desktop"
  if [[ "$(uname)" == "Darwin" || -n "${BOUSLEH_DESKTOP_CONFIG:-}" ]]; then
    mkdir -p "$(dirname "$DESKTOP_CONFIG")"
    if [[ -f "$DESKTOP_CONFIG" ]]; then
      BACKUP="$DESKTOP_CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
      cp "$DESKTOP_CONFIG" "$BACKUP"
      ok "backed up the config to $(basename "$BACKUP")"
    fi
    "$NODE" -e '
      const fs = require("node:fs");
      const [file, name, server] = process.argv.slice(1);
      const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8") || "{}") : {};
      const { type, ...entry } = JSON.parse(server);
      config.mcpServers = { ...(config.mcpServers ?? {}), [name]: entry };
      fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
    ' "$DESKTOP_CONFIG" "$DEMO_NAME" "$DEMO_JSON"
    ok "$DEMO_NAME MCP server registered in Claude Desktop (the bousleh entry is left as it is)"
    LEFT+=("Quit Claude Desktop (Cmd-Q) and open it again, so it starts the $DEMO_NAME server.")
  else
    note "not a Mac: skipped"
  fi

  step "5/5 Claude Code"
  if command -v claude >/dev/null 2>&1; then
    claude mcp remove -s user "$DEMO_NAME" >/dev/null 2>&1 || true
    claude mcp add-json -s user "$DEMO_NAME" "$DEMO_JSON" >/dev/null
    ok "$DEMO_NAME MCP server registered once, at user scope"
    if claude plugin list 2>/dev/null | grep -q 'bousleh@'; then
      ok "plugin already installed; left as is"
    else
      claude plugin marketplace add "$REPO" >/dev/null
      claude plugin install bousleh@bousleh >/dev/null
      ok "plugin installed: bousleh@bousleh"
    fi
  else
    note "Claude Code (the claude command) not found: skipped."
  fi
  LEFT+=("For Claude Desktop chat, add the plugin once per Claude account: Customize > Plugins > Add > Add marketplace > Add from a repository, enter askoulwassim/bousleh, then add Bousleh. Claude Code already has it.")
  LEFT+=("In Claude, say: \"Pulse: where am I?\" If the real bousleh server is registered too, add \"use bousleh-demo\".")
  LEFT+=("To look at Home on the demo data without Claude: pnpm demo:home. To start over with fresh dates: pnpm demo --reset. To take the demo out: scripts/setup-mac.sh --demo --remove.")

  step "Check"
  OPS="$("$NODE" --input-type=module -e '
    const { openEngine } = await import(process.argv[1]);
    const engine = openEngine({ home: process.argv[2] });
    const out = await engine.runOp("vault.health", {}, { actor: "human", now: () => new Date() });
    engine.close();
    if (out.status !== "ok") { console.error(out.message); process.exit(1); }
    process.stdout.write(String(out.output.ops));
  ' "$REPO/packages/engine/dist/index.js" "$DEMO_DATA")"
  ok "the engine answers on the demo data with $OPS ops"
  printf '\n\033[1mLeft for you\033[0m\n'
  for i in "${!LEFT[@]}"; do printf '  %d. %s\n' "$((i + 1))" "${LEFT[$i]}"; done
  exit 0
fi

step "3/6 Your data"
mkdir -p "$DATA"
ok "data folder: $DATA"
mkdir -p "$(dirname "$APP_JSON")"
"$NODE" -e '
  const fs = require("node:fs");
  const [file, repo] = process.argv.slice(1);
  fs.writeFileSync(file, `${JSON.stringify({ repo, updated: new Date().toISOString() }, null, 2)}\n`);
' "$APP_JSON" "$REPO"
ok "Home knows where this repo is: $APP_JSON"
if [[ -n "$GUARDED" ]]; then note "$GUARDED_NOTE"; LEFT+=("$GUARDED_NOTE"); fi
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
    // One Bousleh entry only: drop any other name that runs this server. The demo (bousleh-demo) is its own entry and stays.
    for (const [name, s] of Object.entries(servers)) {
      if (name !== "bousleh" && name !== "bousleh-demo" && JSON.stringify(s?.args ?? []).includes("mcp-server/dist/bin.js")) {
        delete servers[name];
        console.log(`  ✓ removed a second Bousleh entry named "${name}"`);
      }
    }
    config.mcpServers = { ...servers, bousleh: entry };
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  ' "$DESKTOP_CONFIG" "$SERVER_JSON"
  ok "bousleh MCP server registered in Claude Desktop"
  LEFT+=("When the Code tab says it's done, quit Claude Desktop (Cmd-Q) and open it again, so its chats start the Bousleh server.")
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

"$NODE" "$REPO/scripts/scheduled-tasks.mjs" --repo "$REPO" >/dev/null || { echo "  docs/scheduled-tasks.md doesn't parse; fix it before the finish step" >&2; exit 1; }
ok "the scheduled tasks are defined ($("$NODE" "$REPO/scripts/scheduled-tasks.mjs" --list | wc -l | tr -d ' ') in docs/scheduled-tasks.md)"

# The part that lives in the Claude account (Home, the scheduled tasks) takes Claude: hand it over, same words every time.
FINISH="Finish setting up Bousleh from docs/finish-setup.md."
FINISH_URL="$("$NODE" -e '
  const enc = (s) => encodeURIComponent(s).replace(/[!'"'"'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  process.stdout.write(`claude://code/new?q=${enc(process.argv[1])}&folder=${enc(process.argv[2])}`);
' "$FINISH" "$REPO")"
step "Finish in Claude"
if (( OPEN_CLAUDE )) && [[ "$(uname)" == "Darwin" ]] && open "$FINISH_URL" >/dev/null 2>&1; then
  ok "opened Claude's Code tab on this repo with \"$FINISH\" typed in: press Enter there"
  LEFT=("In the Code tab that just opened, press Enter on \"$FINISH\" It publishes Home and creates or updates the scheduled tasks, then lists the rest." "${LEFT[@]}")
else
  note "open Claude's Code tab on $REPO and say: \"$FINISH\""
  LEFT=("In Claude Desktop's Code tab, on $REPO, say: \"$FINISH\" It publishes Home and creates or updates the scheduled tasks, then lists the rest." "${LEFT[@]}")
fi

printf '\n\033[1mLeft for you\033[0m\n'
for i in "${!LEFT[@]}"; do printf '  %d. %s\n' "$((i + 1))" "${LEFT[$i]}"; done
