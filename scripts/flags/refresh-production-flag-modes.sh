#!/usr/bin/env bash
# Keeps e2e/smoke/production-flag-modes.json fresh. Runs on the VPS (daily timer), where the plain QA
# session is available, never in CI. It regenerates the file from the live modes in a throwaway
# worktree and, only when the content changed, pushes branch flag-modes-refresh for the usual
# pull request checks. It never merges anything.
set -euo pipefail
repo="${HYPERTASK_REPO:-$HOME/projects/hypertask}"
work="$(mktemp -d)"
trap 'git -C "$repo" worktree remove --force "$work" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
git -C "$repo" fetch -q origin production
git -C "$repo" worktree add -q --detach "$work" origin/production
cd "$work"
ln -s "$repo/node_modules" node_modules
node scripts/flags/production-flag-modes.mjs --write
# A new capture date alone is not worth a pull request until the committed copy is 7 days old.
committed_age=$(git show origin/production:e2e/smoke/production-flag-modes.json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(Math.floor((Date.now()-Date.parse(JSON.parse(s).capturedAt))/86400000)))')
if git diff --quiet -I'"capturedAt"' -- e2e/smoke/production-flag-modes.json && [ "$committed_age" -lt 7 ]; then
  echo "live modes unchanged and the copy is $committed_age days old"
  exit 0
fi
git checkout -q -B flag-modes-refresh
git add e2e/smoke/production-flag-modes.json
git -c user.name="Dev 1 (HT)" commit -q -m "YPER4-253 [INFRA] Refresh the live switch settings copy for browser checks"
git push -q --force-with-lease origin flag-modes-refresh
echo "pushed flag-modes-refresh; open or update its pull request"
