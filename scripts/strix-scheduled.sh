#!/bin/bash
# Always run the live checks, even when the source review needs another batch.
set -uo pipefail
umask 077
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_exit=0
/bin/bash "$SCRIPT_DIR/strix-weekly.sh" || source_exit=$?
live_exit=0
/bin/bash "$SCRIPT_DIR/strix-assess.sh" --live-only || live_exit=$?
printf 'Strix scheduled checks: source_exit=%s live_exit=%s\n' "$source_exit" "$live_exit"
if [ "$source_exit" -ne 0 ]; then exit "$source_exit"; fi
exit "$live_exit"
