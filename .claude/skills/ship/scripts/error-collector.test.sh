#!/usr/bin/env bash
# No live CLI calls: tests use private HOME and fake vcc, ht, systemctl and runner-deliver.
set -euo pipefail
HERE=$(cd -- "$(dirname -- "$0")" && pwd)
export ERROR_COLLECTOR_TEST_SUITE=${1:-all}
"${NODE:-node}" --test "$HERE/error-collector/collector.test.mjs" "$HERE/error-collector/sources.test.mjs" "$HERE/error-collector/vercel-logs.test.mjs"
