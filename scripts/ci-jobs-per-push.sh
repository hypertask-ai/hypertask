#!/usr/bin/env bash
# Snapshot before and after pushing: check runs are attached to each PR's current head.
set -euo pipefail
if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <pr-number...>" >&2
  exit 2
fi
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
for pr in "$@"; do
  [[ "$pr" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid PR number: $pr" >&2; exit 2; }
  head=$(gh api "repos/$repo/pulls/$pr" --jq .head.sha)
  # filter=all counts reruns too. Paginate so large queues never truncate the count.
  runs=$(gh api --paginate --slurp "repos/$repo/commits/$head/check-runs?filter=all&per_page=100")
  printf 'PR #%s %s\n' "$pr" "$head"
  jq -r '[.[].check_runs[] | select(.started_at != null and .conclusion != "skipped")] |
    "  started (non-skipped): \(length)",
    (.[] | "  \(.name)\t\(.conclusion // .status)\t\(.started_at)")' <<<"$runs"
done
