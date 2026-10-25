# Set up Bousleh on a Mac

About ten minutes, on the personal Mac or the work Mac alike. Each Mac gets its own data in `~/.bousleh`; nothing is shared between them.

## You need

- Node 22 or newer (`brew install node@22`) and git.
- Claude Desktop, signed in to the Claude account this Mac belongs to (personal or work).
- Claude Code, optional but recommended (`claude` on the PATH).
- Google Drive connected to that Claude account (in Claude's Settings, under Connectors). No Google Drive desktop app is needed.

## Run

```sh
git clone https://github.com/askoulwassim/bousleh.git bousleh.nosync   # inside a Documents folder, keep the .nosync name
cd bousleh.nosync
scripts/setup-mac.sh
```

The script:

1. checks Node and pnpm;
2. builds the engine and the MCP server;
3. creates `~/.bousleh` (empty; daily backups will go to `~/.bousleh-backups`, the newest 14 kept);
4. registers the `bousleh` MCP server in Claude Desktop, after backing up its config;
5. registers it in Claude Code and installs the plugin there, straight from this repo;
6. builds `dist/bousleh.plugin` for your Claude account, and checks that the engine answers.

It's safe to rerun. After `git pull`, run it again to rebuild.

## Then, by hand (about 3 minutes)

1. Quit Claude Desktop (Cmd-Q) and open it again.
2. Upload `dist/bousleh.plugin` to your Claude account from Claude Desktop (where plugins are added in Settings). That brings the nine skills to Desktop, the web and your phone, including Drop for phone captures. Re-upload it after the skills change.
3. In a Claude Desktop chat: "Bousleh: mark me as the user, I'm <your name>."
4. Phone test: in the Claude app, say "Drop this: test from my phone." Then, in Claude Desktop on the Mac: "Process my Bousleh inbox." The note should be filed (or skipped), and gone from Drive's "Bousleh Inbox".

## Backups and restore

The MCP server snapshots your data once a day to `~/.bousleh-backups/<date-time>/`, on the same disk; ask for one any time with "take a Bousleh backup" (`vault.backup`). To restore: quit Claude Desktop and Claude Code, rename `~/.bousleh` to `~/.bousleh-broken`, and copy the snapshot folder you want to `~/.bousleh`.

## The work Mac

Same steps, with the work Claude account and the work Google Drive connected to it. Work captures go to that Drive's own "Bousleh Inbox" (Drop creates it on first use), and work data stays on the work Mac.
