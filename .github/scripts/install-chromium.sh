#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd)

if ! command -v strace >/dev/null; then
  echo "::error::strace is missing from the runner image" >&2
  exit 1
fi

npx playwright install chromium
node "$root/.github/scripts/browser-font-cache.mjs"
