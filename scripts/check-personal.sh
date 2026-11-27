#!/usr/bin/env bash
# Fail if the tracked tree holds personal data: names, emails or companies from a private denylist.
#
#   scripts/check-personal.sh
#
# Patterns are case-insensitive extended regexes, one per line. They come from $BOUSLEH_DENYLIST
# (the BOUSLEH_DENYLIST repository secret in CI) or, locally, from .bousleh-denylist at the repo root,
# which is gitignored. Blank lines and lines starting with # are skipped. The patterns themselves are
# never printed, so CI logs don't leak them: a match reports "pattern #N matched" and file:line.
# With no patterns (a fork without the secret), it prints a notice and passes.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

if [[ -n "${BOUSLEH_DENYLIST:-}" ]]; then
  LIST="$BOUSLEH_DENYLIST"
elif [[ -f .bousleh-denylist ]]; then
  LIST="$(cat .bousleh-denylist)"
else
  LIST=""
fi

PATTERNS=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ -z "${line//[[:space:]]/}" || "$line" == \#* ]] && continue
  PATTERNS+=("$line")
done <<< "$LIST"

if (( ${#PATTERNS[@]} == 0 )); then
  if [[ -n "${GITHUB_ACTIONS:-}" ]]; then echo "::notice::No personal-data denylist (BOUSLEH_DENYLIST is empty); skipping the check."; fi
  echo "check-personal: no denylist set (BOUSLEH_DENYLIST or .bousleh-denylist); nothing checked."
  exit 0
fi

FOUND=0
for i in "${!PATTERNS[@]}"; do
  n=$((i + 1))
  # Only file:line is kept, and git grep stays quiet on stderr, so nothing echoes the pattern into the log.
  if matches="$(git grep -n -i -E -e "${PATTERNS[$i]}" -- . ':(exclude)pnpm-lock.yaml' 2>/dev/null | cut -d: -f1,2)"; then
    FOUND=1
    echo "pattern #$n matched:"
    while IFS= read -r where; do echo "  $where"; done <<< "$matches"
  else
    status=$?
    if (( status != 1 )); then echo "pattern #$n could not be checked (git grep exit $status; is it a valid regex?)" >&2; FOUND=1; fi
  fi
done

if (( FOUND )); then
  echo "check-personal: personal data found in the tracked tree (${#PATTERNS[@]} patterns checked)." >&2
  exit 1
fi
echo "check-personal: clean (${#PATTERNS[@]} patterns checked)."
