#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" != "--run" ]]; then
  started=$SECONDS
  status=0
  timeout -k 5 "${CHROMIUM_INSTALL_TIMEOUT:-110}" bash "${BASH_SOURCE[0]}" --run || status=$?
  if ((status == 124 || status == 137)); then
    echo "::error::Chromium installation timed out after $((SECONDS - started))s; check this runner's outside network"
    exit 1
  fi
  if ((status == 0)); then
    echo "::notice::Chromium ready in $((SECONDS - started))s"
  fi
  exit "$status"
fi

root=$(cd "$(dirname "$0")/../.." && pwd)

if ! command -v strace >/dev/null; then
  echo "::error::strace is missing from the runner image" >&2
  exit 1
fi

npx playwright install chromium
node "$root/.github/scripts/browser-font-cache.mjs"
