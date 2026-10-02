#!/usr/bin/env bash
# All public and signed-in flows run in this one VPS cron job, not GitHub CI.
# Usage: ./nightly.sh [--dry-run]. Dry-run never writes to the board.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")" || exit 1

exec 8>/tmp/midscene-nightly.lock
if ! flock -n 8; then
  echo "nightly: another nightly run is already in progress, skipped."
  exit 0
fi

DRY_RUN=0
if [ "${1:-}" = "--dry-run" ]; then DRY_RUN=1; fi
LOG_FILE=~/.cache/midscene-nightly.log
FLAKE_STATE_FILE=flake-state.json
RESULTS_FILE=midscene_run/results-latest.json
mkdir -p "$(dirname "$LOG_FILE")"
log() { echo "$(date -u +%FT%TZ) $*" >>"$LOG_FILE"; }

export MIDSCENE_ENV_FILE="${MIDSCENE_ENV_FILE:-$HOME/.config/hypertask-videos/midscene.env}"
if [ -f "$MIDSCENE_ENV_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$MIDSCENE_ENV_FILE"
  set +a
fi
if [ -z "${OPENAI_API_KEY:-}" ]; then
  log "ABORT: configure OPENAI_API_KEY in MIDSCENE_ENV_FILE."
  echo "nightly: model credentials missing; see README." >&2
  exit 1
fi
export MIDSCENE_STORAGE_STATE="${MIDSCENE_STORAGE_STATE:-$HOME/.config/hypertask-videos/storageState-qa-normal.json}"
if [ ! -r "$MIDSCENE_STORAGE_STATE" ]; then
  log "ABORT: plain QA storage state is missing."
  echo "nightly: plain QA storage state missing." >&2
  exit 1
fi
# Only gateways configured to use the existing SOCKS tunnel need this check.
if [[ "${MIDSCENE_OPENAI_SOCKS_PROXY:-}" == *127.0.0.1:1088* ]] && ! ss -ltn | grep -q ':1088 '; then
  log "ABORT: configured SOCKS tunnel on port 1088 is down."
  echo "nightly: configured SOCKS tunnel is down." >&2
  exit 1
fi

rm -f "$RESULTS_FILE"
RUN_START=$(date -u +%s)
./guarded-run.sh --all
RUN_RC=$?
if [ ! -f "$RESULTS_FILE" ]; then
  log "ABORT: no fresh results (guarded-run exit $RUN_RC)."
  exit 1
fi

# First red run files a bug. The board lookup, not a local boolean, deduplicates.
SUMMARY=$(node postprocess.mjs "$FLAKE_STATE_FILE" "$RESULTS_FILE" 1 15 Bugs "$DRY_RUN" "$RUN_START")
POSTPROCESS_RC=$?
echo "$SUMMARY"
log "run_rc=$RUN_RC postprocess_rc=$POSTPROCESS_RC $SUMMARY"
if [ "$POSTPROCESS_RC" -ne 0 ]; then exit 1; fi
exit "$RUN_RC"
