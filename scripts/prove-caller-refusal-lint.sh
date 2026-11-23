#!/usr/bin/env bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
output=$(mktemp)
trap 'rm -f "$output"' EXIT
flagged=0
while read -r commit file; do
  if git show "${commit}^:${file}" | timeout 900 npx eslint --stdin --stdin-filename "$file" >"$output" 2>&1; then
    printf 'FAIL %s^ %s was not flagged\n' "$commit" "$file"
    exit 1
  fi
  if ! grep -q 'caller-refusals/boundary' "$output"; then
    cat "$output"
    exit 1
  fi
  printf 'FLAGGED %s^ %s (caller-refusals/boundary)\n' "$commit" "$file"
  flagged=$((flagged + 1))
  git show "HEAD:${file}" | timeout 900 npx eslint --stdin --stdin-filename "$file" >"$output" 2>&1 || { cat "$output"; exit 1; }
  printf 'HEAD PASS %s\n' "$file"
done <<'CASES'
eb1d2c0892 src/lib/mcp/operations/tasks/attachments/operation.ts
bf5064671f src/lib/mcp/tasks/fields/section.ts
2910335837 src/lib/mcp/tasks/agentMutationFence.ts
CASES
printf 'PASS: %s/3 past bug versions flagged; HEAD pass\n' "$flagged"
