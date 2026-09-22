#!/bin/bash
# Install only after the focused tests pass. Does not edit cron or credentials.
set -euo pipefail
umask 077
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DESTINATION=${STRIX_INSTALL_DIR:-$HOME/.local/lib/strix-runner}
install -d -m 700 "$DESTINATION" "$HOME/.local/state/strix/weekly" "$HOME/.config/strix"
VERIFY_SOURCE=${STRIX_VERIFY_SOURCE:-$HOME/projects/hypertask-verify-app}
for name in app-auth.mjs config.mjs node_modules/playwright/index.mjs node_modules/playwright-core/package.json; do
  test -f "$VERIFY_SOURCE/$name" || { echo "Missing verification dependency: $VERIFY_SOURCE/$name"; exit 1; }
done
install -d -m 700 "$DESTINATION/verification-auth" "$DESTINATION/node_modules"
install -m 600 "$VERIFY_SOURCE/app-auth.mjs" "$VERIFY_SOURCE/config.mjs" "$DESTINATION/verification-auth/"
for package in playwright playwright-core; do
  # Copy dependency code, never the verification account's credentials or logs.
  cp -a "$VERIFY_SOURCE/node_modules/$package/." "$DESTINATION/node_modules/$package/"
done
for name in strix-weekly.sh strix-check-run.py strix-file-tickets.py \
  strix-review-batches.py strix-assess.sh strix-assess.py strix-assessment.json \
  strix-live-check.mjs strix-cli-check.py strix-scheduled.sh; do
  install -m 700 "$SCRIPT_DIR/$name" "$DESTINATION/$name"
done
printf 'Installed Strix runner at %s\n' "$DESTINATION"
