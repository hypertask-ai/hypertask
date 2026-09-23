#!/bin/bash
# Sunday source review. Install this directory at ~/.local/lib/strix-runner.
set -euo pipefail
umask 077
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
STATE=${STRIX_STATE:-$HOME/.local/state/strix/weekly}
REPO=${STRIX_REPO:-https://github.com/hypertask-ai/hypertask.git}
REF=${STRIX_REF:-production}
BUDGET=${STRIX_BUDGET:-30}
mkdir -p "$STATE"
exec 9>"$STATE/runner.lock"
flock -n 9 || { echo 'Strix is already running'; exit 0; }
JOB=$(mktemp -d "$STATE/run-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")
exec > >(tee -a "$JOB/runner.log") 2>&1
STATUS=failed
REVISION=""
NETWORK=""
finish() {
  code=$?
  trap - EXIT
  if [ -n "$NETWORK" ]; then
    docker ps -aq --filter "network=$NETWORK" | xargs -r docker rm -f || code=1
    docker network rm "$NETWORK" >/dev/null 2>&1 || code=1
  fi
  if [ "$code" -eq 3 ] && [ "$STATUS" = pending ]; then :
  elif [ "$code" -ne 0 ]; then STATUS=failed; fi
  # Reports and receipts remain; the public source clone is reproducible from
  # the pinned revision and must not accumulate after every Sunday run.
  if [ -d "$JOB/source" ]; then rm -rf -- "$JOB/source" || { code=1; STATUS=failed; }; fi
  if [ "$STATUS" = completed ]; then
    printf '%s\n' "$REVISION" > "$STATE/last-success.tmp"
    mv "$STATE/last-success.tmp" "$STATE/last-success"
    rm -f "$STATE/pending-scope"
  fi
  python3 - "$STATE" "$JOB" "$STATUS" "$code" "$REVISION" <<'PY'
import datetime,json,os,sys
from pathlib import Path
state,job,status,code,revision=sys.argv[1:]
data=dict(status=status,exit_code=int(code),revision=revision,job=job,finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
for path in [Path(job)/'status.json',Path(state)/'latest.json']:
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,indent=2)+'\n');os.replace(tmp,path)
PY
  echo "Strix status=$STATUS exit=$code report=$JOB"
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
python3 - "$STATE" "$JOB" <<'PY_STATUS'
import datetime,json,os,sys
from pathlib import Path
state,job=sys.argv[1:]
path=Path(state)/'latest.json'
tmp=path.with_suffix('.tmp')
tmp.write_text(json.dumps(dict(status='running',job=job,started_at=datetime.datetime.now(datetime.timezone.utc).isoformat()),indent=2)+'\n')
os.replace(tmp,path)
PY_STATUS
for command in strix docker git curl timeout python3 htbot rg; do command -v "$command" >/dev/null; done
systemctl --user start strix-chatgpt-proxy.service
curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 10 http://127.0.0.1:48100/health >/dev/null
# Fetch into our own mirror. Never scan a developer's dirty checkout or .env files.
if [ ! -d "$STATE/source.git" ]; then git init --bare "$STATE/source.git"; fi
git -C "$STATE/source.git" fetch --force "$REPO" "$REF:refs/heads/scan"
if [ -f "$STATE/pending-scope" ]; then
  read -r REVISION BASE < "$STATE/pending-scope"
else
  REVISION=$(git -C "$STATE/source.git" rev-parse refs/heads/scan)
  BASE=${STRIX_DIFF_BASE:-}
  if [ -z "$BASE" ] && [ -f "$STATE/last-success" ]; then BASE=$(cat "$STATE/last-success"); fi
  if [ -z "$BASE" ]; then BASE=$(git -C "$STATE/source.git" rev-list -1 --before='7 days ago' "$REVISION"); fi
  [ -n "$BASE" ] || BASE=$(git -C "$STATE/source.git" rev-list --max-parents=0 "$REVISION" | tail -1)
fi
git -C "$STATE/source.git" merge-base --is-ancestor "$BASE" "$REVISION"
# Keep the unfinished revision reachable even when production moves ahead.
git -C "$STATE/source.git" update-ref refs/heads/pending "$REVISION"
git clone --quiet --no-hardlinks --no-checkout "$STATE/source.git" "$JOB/source"
git -C "$JOB/source" checkout --quiet --detach "$REVISION"
git -C "$JOB/source" diff --name-only --diff-filter=ACMRT "$BASE" "$REVISION" > "$JOB/changed-files.txt"
printf 'Revision: %s\nBase: %s\n' "$REVISION" "$BASE"
if [ ! -s "$JOB/changed-files.txt" ]; then STATUS=no_changes; exit 0; fi
printf '%s %s\n' "$REVISION" "$BASE" > "$STATE/pending-scope.tmp"
mv "$STATE/pending-scope.tmp" "$STATE/pending-scope"
NETWORK="strix-weekly-$(date +%s)-$$"
docker network create "$NETWORK" >/dev/null
export STRIX_DOCKER_SANDBOX_NETWORK="$NETWORK"
export STRIX_IMAGE="${STRIX_IMAGE:-ghcr.io/usestrix/strix-sandbox:1.1.0}"
export STRIX_LLM=openai/gpt-5.6-sol LLM_API_KEY=chatgpt-oauth LLM_API_BASE=http://127.0.0.1:48100/v1
export STRIX_REASONING_EFFORT=medium STRIX_TELEMETRY=false
export STRIX_SANDBOX_MEM_LIMIT=6g STRIX_SANDBOX_CPUS=3 STRIX_SANDBOX_PIDS_LIMIT=512
cd "$JOB"
scan_exit=0
timeout --signal=TERM --kill-after=60 "${STRIX_TIMEOUT:-2700}" \
  python3 "$SCRIPT_DIR/strix-review-batches.py" --source "$JOB/source" \
  --files "$JOB/changed-files.txt" --state "$STATE/batches" --output "$JOB" \
  --revision "$REVISION" --base "$BASE" --budget "$BUDGET" \
  --batch-budget "${STRIX_BATCH_BUDGET:-6}" --max-files "${STRIX_BATCH_FILES:-6}" || scan_exit=$?
if [ "$scan_exit" -eq 3 ]; then STATUS=pending; exit 3; fi
if [ "$scan_exit" -ne 0 ]; then exit "$scan_exit"; fi
STATUS=completed
