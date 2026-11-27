# Contributing to Bousleh

Bousleh is a personal project. It is built for its owner, and for Claude only: it runs on Claude's apps, Claude's connectors and a Claude plugin, and no work goes toward other models or tools.

## Issues are welcome

Open an issue for a bug or an idea. Each one is read, and taken as inspiration rather than a request. Use the forms: they ask which Claude surface you were on and, for a bug, for the output of `scripts/setup-mac.sh --check`. Leave out personal data. For a security issue, don't open an issue; follow [SECURITY.md](SECURITY.md).

## Pull requests aren't accepted

Pull requests from anyone but the owner are closed by a workflow, with a pointer to this page. It isn't about the quality of the change: the project simply has one maintainer and one user.

## Fork it and make it yours

Bousleh is [MIT-licensed](LICENSE), so you can do anything with it: change it, rename it, run it for your own work. A fork is the intended way to use it.

## Running your own copy from a fork

You need a Mac, Node 22 or newer, git, Claude Desktop and, ideally, Claude Code. [SETUP.md](SETUP.md) has the full walkthrough; with a fork, change only the steps below.

1. **Clone your fork**, anywhere (see SETUP.md for a tip if the folder syncs to iCloud):

   ```sh
   git clone https://github.com/<your-account>/bousleh.git
   cd bousleh
   scripts/setup-mac.sh
   ```

   The script builds the engine, registers the MCP server in Claude Desktop and Claude Code, and installs the plugin in Claude Code from your clone. Your data goes in `~/.bousleh`, never in the repo.

2. **Add the plugin from your fork.** In Claude Desktop: **Customize > Plugins > Add > Add marketplace > Add from a repository**, enter `<your-account>/bousleh`, then add **Bousleh**. The skills then update from your fork, not this repo. If you rename the plugin, change `.claude-plugin/marketplace.json` and `plugin/.claude-plugin/plugin.json` to match.

3. **Publish your own Home.** In Claude Desktop's Code tab, on your clone, say "Publish Home from docs/home.md." It becomes a page in your own Claude account, on your own data.

4. **Set up the scheduled tasks**, if you want them: in the same Code tab, say "Set up the scheduled tasks in docs/scheduled-tasks.md."

After a `git pull` from your fork, run `scripts/setup-mac.sh` again. It never registers anything twice.

## Code of conduct

Issues and discussions follow the [Contributor Covenant](CODE_OF_CONDUCT.md).
