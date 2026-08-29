#!/usr/bin/env bash
# HTPR-5715: resource-guarded entry point for the Midscene smoke test.
# This is the ONLY documented way to run the smoke test -- it exists so a stray
# or repeated run can never eat the VPS's RAM/CPU or leave a zombie Chrome behind.
#
# Guards, in order:
#   1. Single-flight lock (flock), held for the whole script -- a second
#      concurrent run exits 0 immediately. The lock file is never unlinked.
#   2. Pre-run sweep (cleanup.sh --locked) runs under that SAME held lock, so
#      a sweep can never race a run starting between probe and cleanup.
#   3. Cgroup caps via `systemd-run --user --scope` (2G RAM, no swap, 1.5 CPU,
#      256 tasks). If systemd-run --user isn't available, FAILS CLOSED --
#      there is no unguarded execution path on this box.
#   4. Hard wall-clock timeout (10 min, SIGTERM then SIGKILL after grace).
#   5. Cleanup trap: kills only the Chrome instance launched with OUR dedicated
#      --user-data-dir, then removes that profile dir. Never touches other
#      Chrome/Chromium processes on the box.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")"

LOCK_FILE=/tmp/midscene-e2e.lock
PROFILE_DIR="/tmp/midscene-profile-$$"
export MIDSCENE_PROFILE_DIR="$PROFILE_DIR"

if [ -f .env ]; then
  set -a; . ./.env; set +a
fi

cleanup() {
  pkill -f -- "--user-data-dir=$PROFILE_DIR" 2>/dev/null || true
  rm -rf "$PROFILE_DIR"
  # Keep only the 10 most recent Midscene HTML reports so output can't grow unbounded.
  if [ -d "midscene_run/report" ]; then
    find midscene_run/report -maxdepth 1 -type f -printf '%T@ %p\n' 2>/dev/null \
      | sort -rn | tail -n +11 | cut -d' ' -f2- | xargs -r rm -f
  fi
}
trap cleanup EXIT

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "guarded-run: another Midscene run is already in progress, skipped."
  exit 0
fi

# Sweep while still holding the lock -- cleanup.sh --locked runs its body
# directly, no separate flock acquisition, so there's no gap for a second
# run to slip in between the sweep and the cgroup-wrapped run below.
./cleanup.sh --locked

if ! command -v systemd-run >/dev/null 2>&1 || ! systemd-run --user --scope -- /bin/true >/dev/null 2>&1; then
  echo "guarded-run: cgroup limits unavailable (systemd-run --user --scope doesn't work on this box), refusing to run unguarded; see README." >&2
  exit 1
fi

timeout --signal=TERM --kill-after=30 600 \
  systemd-run --user --scope \
    -p MemoryMax=2G \
    -p MemorySwapMax=0 \
    -p CPUQuota=150% \
    -p TasksMax=256 \
    -- node runner.mjs "$@"
RC=$?

exit $RC
