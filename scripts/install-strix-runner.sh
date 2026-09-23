#!/bin/bash
# Install only after the focused tests pass. Does not edit cron or credentials.
set -euo pipefail
umask 077
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
DESTINATION=${STRIX_INSTALL_DIR:-$HOME/.local/lib/strix-runner}
install -d -m 700 "$DESTINATION" "$HOME/.local/state/strix/weekly" "$HOME/.config/strix"
python3 - "$HOME" <<'PY'
import json, os, pathlib, sys
home = pathlib.Path(sys.argv[1])
paths = [home / '.cache/strix-filed-titles.json',
         home / '.local/state/strix/assessment/filed-titles.json',
         home / '.local/state/strix/weekly/filed-titles.json',
         home / '.local/state/strix/filed-titles.json']
titles = set()
for path in paths:
    if path.exists():
        value = json.loads(path.read_text())
        if not isinstance(value, list):
            raise ValueError(f'invalid filed-title state: {path}')
        titles.update(value)
destination = paths[-1]
destination.parent.mkdir(parents=True, exist_ok=True)
temporary = destination.with_suffix('.tmp')
temporary.write_text(json.dumps(sorted(titles)) + '\n')
os.chmod(temporary, 0o600)
temporary.replace(destination)
PY
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
