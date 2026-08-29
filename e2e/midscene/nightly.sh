#!/usr/bin/env bash
# HTPR-5720: nightly cron entry point. NOT called by CI -- this is the cron
# job only. Runs the full flow pack through guarded-run.sh, then tracks
# consecutive failures per flow and auto-files ONE Hypertask bug ticket the
# moment a flow crosses the flake threshold.
#
# Install with (03:30 daily, see README for the exact crontab line):
#   30 3 * * * /home/valentin/projects/hypertasks/e2e/midscene/nightly.sh
#
# Usage: ./nightly.sh [--dry-run]
#   --dry-run  print the `hypertask` CLI command instead of running it
#              (used for testing the ticket-filing logic without touching
#              the board). Dry runs never mark a flow's ticket as filed, so
#              the real filing still happens on the next real failing night.
#
# Locking: the whole script runs under its own single-flight flock (separate
# lock file from guarded-run.sh's, since nightly.sh's own bookkeeping -- state
# read/ticket-file/state write -- must never race a second nightly invocation
# even though guarded-run.sh already serializes the browser run itself). Same
# discipline as guarded-run.sh: lock file is never unlinked.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")"

NIGHTLY_LOCK_FILE=/tmp/midscene-nightly.lock
exec 8>"$NIGHTLY_LOCK_FILE"
if ! flock -n 8; then
  echo "nightly: another nightly run is already in progress, skipped."
  exit 0
fi

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
fi

LOG_FILE=~/.cache/midscene-nightly.log
FLAKE_STATE_FILE=flake-state.json
RESULTS_FILE=midscene_run/results-latest.json
CONSECUTIVE_FAIL_THRESHOLD=2
HT_PROJECT=15
HT_SECTION="Bugs"

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  echo "$(date -u +%FT%TZ) $*" >>"$LOG_FILE"
}

# 1. Make sure the SOCKS tunnel to the AI gateway is up (port 1088).
if ! ss -ltn 2>/dev/null | grep -q ':1088 '; then
  ssh -f -N -D 1088 vps
  sleep 2
  if ! ss -ltn 2>/dev/null | grep -q ':1088 '; then
    log "ABORT: SOCKS tunnel on port 1088 is down and could not be started (ssh -f -N -D 1088 vps failed)."
    echo "nightly: SOCKS tunnel down, ssh -f -N -D 1088 vps failed. See $LOG_FILE." >&2
    exit 1
  fi
fi

# 2. Credentials for the AI gateway.
if [ ! -f ~/.config/val-staging/credentials.env ]; then
  log "ABORT: ~/.config/val-staging/credentials.env not found."
  echo "nightly: credentials file missing." >&2
  exit 1
fi
set -a
. ~/.config/val-staging/credentials.env
set +a
export OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://ai-gateway.vercel.sh/v1}"
export OPENAI_API_KEY="${OPENAI_API_KEY:-$GATEWAY_KEY_HYPERTASK}"
export MIDSCENE_MODEL_NAME="${MIDSCENE_MODEL_NAME:-google/gemini-2.5-flash}"
export MIDSCENE_OPENAI_SOCKS_PROXY="${MIDSCENE_OPENAI_SOCKS_PROXY:-socks5h://127.0.0.1:1088}"

# 3. Run the full flow pack. guarded-run.sh already applies lock/cgroup/timeout
# guards; nightly.sh does not duplicate them.
#
# Remove any leftover results file BEFORE the run, and record the run's start
# time. runner.mjs stamps its own startedAt into the results file; the
# postprocessor below refuses to process a file whose startedAt predates
# RUN_START, so a runner that crashes/times out without writing a fresh file
# is treated as a failed run instead of silently reprocessing the previous
# night's results.
rm -f "$RESULTS_FILE"
RUN_START=$(date -u +%s)
./guarded-run.sh --all
RUN_RC=$?

if [ ! -f "$RESULTS_FILE" ]; then
  log "ABORT: run did not produce $RESULTS_FILE (guarded-run exit $RUN_RC)."
  echo "nightly: no results file, guarded-run exited $RUN_RC." >&2
  exit 1
fi

# 4. Post-process: track consecutive fails per flow, file a ticket at
# threshold, reset on the next pass. Pulled into postprocess.mjs (a real
# file, not an inline `node -` heredoc) because ESM import syntax in a
# stdin script can be misdetected as CommonJS.
SUMMARY=$(node postprocess.mjs "$FLAKE_STATE_FILE" "$RESULTS_FILE" "$CONSECUTIVE_FAIL_THRESHOLD" "$HT_PROJECT" "$HT_SECTION" "$DRY_RUN" "$RUN_START")
POSTPROCESS_RC=$?

if [ $POSTPROCESS_RC -ne 0 ]; then
  log "postprocess FAILED (rc=$POSTPROCESS_RC): $SUMMARY"
  echo "nightly: postprocess FAILED, see $LOG_FILE." >&2
  exit 1
fi

log "run_rc=$RUN_RC $SUMMARY"

exit $RUN_RC
