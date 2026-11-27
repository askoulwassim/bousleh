# Move your clone

Moves this Mac's clone of Bousleh to a new folder: `~/Developer/bousleh` unless you name another. Your data doesn't move. It lives in `~/.bousleh`, outside every clone, and the new clone reads the same data.

The usual reason is Home. Installed as an app, Home is its own app to macOS, and macOS guards Documents, Desktop, Downloads and iCloud Drive per app. So in a clone there, Home's Tune and Health end with "Operation not permitted". Allowing Bousleh Home under Full Disk Access didn't let it in on the owner's Mac. Moving the clone out of those folders always works.

To move it, open Claude Code in the clone you have now, in the Code tab or in Terminal (`claude`), and say:

> Pull main, then move this clone as docs/move.md says.

On a second instance, such as a work Mac, it's the same. Each Mac moves its own clone, and its data stays its own.

## What moves, and what doesn't

- **Home:** one Claude page, one link, one installed app. None of them is tied to the clone's folder, so the move makes no second Home. Publishing Home again from the new clone updates the same page.
- **Claude Desktop:** `scripts/setup-mac.sh`, run in the new clone, rewrites the one `bousleh` server entry to point there. It backs up the config first.
- **Claude Code:** the setup script registers the server again, once, at user scope. The Bousleh plugin in Claude Code was installed from the old clone as a local marketplace, and the script leaves an installed plugin alone, so step 5 below repoints it.
- **The plugin on your Claude account** (Desktop chat, the web, the phone) comes from GitHub. The move doesn't touch it.
- **Scheduled tasks** that run on this Mac keep the old clone as their working folder until you change it (step 8).
- **The old clone** stays as it is. Delete it yourself once Health passes in the new one.

## How to move it (for Claude)

Ask nothing you can find out yourself. Stop and ask only where a step says so. Never delete the old clone, and never touch `~/.bousleh` beyond what the Bousleh tools and the setup script do.

1. **Where from, where to.**
   - The old clone is this session's repo (`git rev-parse --show-toplevel`). Check that `~/.bousleh/app.json`, if it exists, names the same folder. If it names another, say so and ask which clone is the live one.
   - The new folder is `~/Developer/bousleh` unless the user named another. Refuse a new folder inside Documents, Desktop, Downloads or `~/Library/Mobile Documents`. If the folder exists and is a clone of this repo, use it. If it exists and is anything else, stop and ask.
2. **Nothing left behind.** In the old clone, list:
   - uncommitted changes (`git status --porcelain`);
   - stashes (`git stash list`);
   - commits on no remote (`git log --branches --not --remotes --oneline`);
   - local files the new clone won't get: `.bousleh-denylist`, and any other untracked file that isn't build output, `node_modules` or `.DS_Store`.

   If there are uncommitted changes, stashes or commits on no remote, stop, show them, and ask what to do. Copy `.bousleh-denylist` across if it exists, and name any other untracked file for the user.
3. **A snapshot of the data.** If the `bousleh` MCP tools are available, call `vault_backup` and report the snapshot it took. If they aren't, say so and go on: the setup script never changes your data.
4. **Clone and set up.**
   - `git clone <the old clone's origin url> <new folder>`, then `git switch main` there.
   - Run `scripts/setup-mac.sh` in the new folder and show its "Left for you" list.
   - Check that `~/.bousleh/app.json` now names the new folder.
   - Check that the `bousleh` entry in `~/Library/Application Support/Claude/claude_desktop_config.json` runs `<new folder>/packages/mcp-server/dist/bin.js`.
5. **The Claude Code plugin.**
   - Run `claude plugin marketplace list` and `claude plugin list`.
   - If the marketplace the `bousleh` plugin comes from points at the old clone, repoint it: remove that marketplace, add `<new folder>` as a marketplace, and install `bousleh@bousleh` from it. Use `claude plugin --help` for the exact commands if these differ.
   - Finish with exactly one Bousleh plugin installed, from the new folder. If something won't go, show the commands and their output, and say what's left for the user.
6. **Check.** Run `scripts/setup-mac.sh --check` in the new folder and show its lines. It mustn't warn that the repo is in a guarded folder.
7. **Hand over to the user.** Tell them, in this order:
   1. Quit Claude Desktop (Cmd-Q) and open it again, so the server runs from the new clone.
   2. Quit Bousleh Home from its Dock icon (right-click, Quit), then open it again.
   3. In Home, open Health (the pulse icon in the rail) and press Check setup. The check should run and end without "Operation not permitted".
   4. From now on, open the Code tab and Claude Code on the new folder. Say "Publish Home from docs/home.md" there after the next `git pull`. It updates the same Home.
   5. If Full Disk Access or a Files & Folders entry was turned on for Bousleh Home for this, it can be turned off again.
8. **Scheduled tasks.** The tasks that run on this Mac (the Hourly inbox sweep and the Friday Bousleh tune-up, from docs/scheduled-tasks.md) have the old clone as their working folder.
   - If this session can see and change scheduled tasks, list the ones whose working folder is the old clone. Ask once before changing them, then point each at the new folder.
   - If it can't, name them for the user: they change each task's folder in its settings in Claude Desktop.
   - The tune-up matters most: it edits the repo and opens pull requests, and it would keep doing that in the old clone.
9. **The old clone.** Say that it's no longer used, and that the user can delete it once Health passes in the new one. Name its path. Don't delete it.

Report in a few lines what moved, the snapshot taken, anything left for the user, and the path of the old clone.
