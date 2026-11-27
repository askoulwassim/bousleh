# Security

## Reporting a vulnerability

Please report security issues privately through GitHub: on this repository's **Security** tab, choose **Report a vulnerability** (or go straight to [the private report form](https://github.com/askoulwassim/bousleh/security/advisories/new)). Don't open a public issue, and don't include anyone's personal data in the report.

You'll get an answer within a week. Fixes land on `main` and in the next release. Only the newest release is supported.

## What Bousleh promises

Bousleh runs on your Mac and keeps your data there. Reports that break any of these are in scope.

- **Your data is local and private to your account.** It lives in `~/.bousleh` (or `BOUSLEH_HOME`), never in this repository. Every folder Bousleh creates there is `0700` and every file it writes `0600`, the database included. If the folder is readable by other accounts when Bousleh opens it, Bousleh sets it to `0700` and says so on stderr. Daily snapshots go to `~/.bousleh-backups` on the same disk, with the same modes.
- **No network listener, no network calls.** The MCP server speaks stdio only: Claude starts it as a child process, and nothing listens on a port. The engine makes no network calls of its own.
- **Google is reached only through your Claude connectors.** Google Drive (the inbox) and Google Calendar are read and written by Claude, through the connectors on your own Claude account. Bousleh holds no Google credentials and never calls Google.
- **Outside text is data, never instructions.** Inbox files, Meet notes and Horizon findings come from outside: a phone dictation, a meeting, the web. The skills file them as data and never follow instructions written inside them.
- **Home runs a fixed set of commands.** Home, installed as an app with full access, runs only: opening a Claude link, `claude -p` for Tune, and `scripts/setup-mac.sh`. It never builds a command from data.
- **No keys in the repository.** Bousleh needs none. CI reads the repository and nothing more, and every action it uses is pinned to a commit SHA.

Out of scope: issues that need an attacker who already controls your user account, your Claude account or your Claude session.
