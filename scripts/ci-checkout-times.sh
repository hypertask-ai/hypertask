#!/usr/bin/env bash
# Checkout step time per job, measured from a real run's log and split into setup,
# fetch (network) and checkout (writing the working tree). A CI speed change quotes
# these numbers before and after instead of estimating them. One log download per run
# id; no polling.
set -euo pipefail
if [ "$#" -eq 0 ]; then
  echo "Usage: $0 <run-id...>" >&2
  echo "Example: $0 \$(gh run list --workflow ci-tests.yml --limit 1 --json databaseId --jq '.[0].databaseId')" >&2
  exit 2
fi
repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
for run in "$@"; do
  [[ "$run" =~ ^[1-9][0-9]*$ ]] || { echo "Invalid run id: $run" >&2; exit 2; }
  printf 'run %s https://github.com/%s/actions/runs/%s\n' "$run" "$repo" "$run"
  gh run view "$run" --repo "$repo" --log |
    awk -F'\t' '
      # A log line starts with a byte-order mark on some steps, so find the stamp.
      function seconds(text, parts) {
        if (!match(text, /[0-9][0-9]:[0-9][0-9]:[0-9][0-9]\.[0-9]+Z/)) return -1
        split(substr(text, RSTART, RLENGTH - 1), parts, ":")
        return parts[1] * 3600 + parts[2] * 60 + parts[3]
      }
      {
        at = seconds($3)
        if (at < 0) next
        job = $1
        # A run that crosses midnight keeps counting up instead of going negative.
        if ((job in last) && at < last[job]) at += 86400
        last[job] = at
        if ($3 ~ /Initializing the repository/) init[job] = at
        else if ($3 ~ /Fetching the repository/) start[job] = at
        else if ($3 ~ /Determining the checkout info/) fetched[job] = at
        else if ($3 ~ /Checking out the ref/) checkout[job] = at
        # The last command of the checkout action, present with and without stored credentials.
        else if ($3 ~ /git log -1 --format=%H/ && (job in checkout)) {
          printf "%-28s setup=%5.2fs fetch=%5.2fs checkout=%5.2fs\n", job,
            start[job] - init[job], fetched[job] - start[job], at - checkout[job]
          delete init[job]; delete start[job]
          delete fetched[job]; delete checkout[job]
        }
      }
    ' | sort
done
