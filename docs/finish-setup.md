# Finish setting up Bousleh

`scripts/setup-mac.sh` does everything on the Mac. Then it opens Claude's Code tab on your clone with this typed in:

> Finish setting up Bousleh from docs/finish-setup.md.

Press Enter. That does the part that lives in your Claude account: it publishes Home and creates or updates the scheduled tasks. A script can't do that part, but this file makes it the same steps every time. The run is safe to repeat. Rerun `scripts/setup-mac.sh` after every `git pull`, and it brings everything back in line with the repo.

The run happens in the Code tab because only a session on this Mac can let Home use new Bousleh tools.

## Steps (for Claude)

Do these in order, exactly as the linked files say. Make no choices of your own, and ask nothing except the approvals the app itself shows. If a step can't be done, say which step and why, then go on to the next one.

1. **The server.** Call `vault_health` on the `bousleh` MCP server. It must answer with every Bousleh op. If it doesn't, stop and say to rerun `scripts/setup-mac.sh`, quit Claude Desktop (Cmd-Q), open it again, and press Enter here again.
2. **Home.** Publish Home as [home.md](home.md) says under "How to publish it (for Claude)". It updates the same Home every time.
3. **Scheduled tasks.** Apply [scheduled-tasks.md](scheduled-tasks.md) as it says under "How to apply this file (for Claude)": every task, by its exact name, from `node scripts/scheduled-tasks.mjs`.
4. **First run only.** If `scopes_list` returns no scopes, say that the next step is "Bousleh: set me up" in a Claude Desktop chat. It asks who you are and adds your first scopes and watch lists.
5. **Report** in one short table: Home (link, published or unchanged) and each scheduled task (created, updated or unchanged, where it runs, its next run). Under the table, list only what's left for the user, in this order:
   1. Quit Claude Desktop (Cmd-Q) and open it again, so its chats load the Bousleh server. Skip this if this run changed nothing on the Mac.
   2. If Home isn't installed as an app yet: open it, press **Install as app** in its footer, and allow what you want on its first screen.
   3. Any approval a scheduled task still needs: press **Run now** on it once and choose "always allow".
   4. Anything a step above couldn't do.
