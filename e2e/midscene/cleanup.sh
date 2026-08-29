#!/usr/bin/env bash
# HTPR-5715: force-clean every trace a Midscene run can leave behind.
# Safe to run any time (cron, by hand, or as guarded-run.sh's pre-run sweep) --
# only ever touches things tagged with our own "midscene-profile" marker.
#
# Locking: this script's entire body runs under the SAME flock guarded-run.sh
# uses, held for the whole operation (never just probed-then-released) so a
# run can never start between the probe and the cleanup. The lock file itself
# is NEVER unlinked -- removing it would let a second process lock a freshly
# recreated inode while the first still holds the original one, defeating
# single-flight. Call with --locked when the caller (guarded-run.sh) already
# holds the lock, to avoid a self-deadlock re-locking the same fd.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")"

LOCK_FILE=/tmp/midscene-e2e.lock

if [ "${1:-}" != "--locked" ]; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "cleanup: a Midscene run is currently active, skipping."
    exit 0
  fi
fi

# 1. Kill any orphan Chrome/Chromium still holding one of our profile dirs
#    (e.g. left over from a run that got SIGKILLed before its trap could run).
pgrep -af 'midscene-profile' | awk '{print $1}' | while read -r pid; do
  kill -9 "$pid" 2>/dev/null || true
done

# 2. Remove orphan profile dirs.
rm -rf /tmp/midscene-profile-* 2>/dev/null || true

# 3. Prune old Midscene HTML reports -- keep the 10 most recent, drop the rest.
if [ -d "midscene_run/report" ]; then
  find midscene_run/report -maxdepth 1 -type f -printf '%T@ %p\n' 2>/dev/null \
    | sort -rn | tail -n +11 | cut -d' ' -f2- | xargs -r rm -f
fi

echo "cleanup: done."
