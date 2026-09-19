#!/bin/bash
# Weekly white-box Strix scan of local Hypertask source via the ChatGPT subscription.
# Cron: Sun 03:00. Findings are filed as tickets after the scan.
set -uo pipefail

APP=${STRIX_APP:-/home/valentin/projects/hypertasks}
LOG=${STRIX_LOG:-/home/valentin/logs/strix-weekly-$(date +%F).log}
LOCK=${STRIX_LOCK:-/tmp/strix-weekly.lock}
SANDBOX_IMAGE=${STRIX_IMAGE:-ghcr.io/usestrix/strix-sandbox:1.1.0}
BUDGET=${STRIX_BUDGET:-10}
mkdir -p "$(dirname "$LOG")"
exec >>"$LOG" 2>&1
echo "=== strix-weekly $(date -Is) subscription=chatgpt budget=\$$BUDGET ==="

cd "$APP" || exit 1

exec 9>"$LOCK"
flock -n 9 || {
  echo "Another weekly Strix scan is already running"
  exit 0
}

systemctl --user start strix-chatgpt-proxy.service
for _ in $(seq 1 30); do
  curl -sf -o /dev/null --connect-timeout 2 --max-time 2 http://127.0.0.1:48100/health && break
  sleep 1
done
curl -sf -o /dev/null --connect-timeout 2 --max-time 2 http://127.0.0.1:48100/health || {
  echo "ChatGPT proxy did not become healthy"
  exit 1
}

SANDBOX_NETWORK="strix-weekly-$(date +%s)-$$"
docker network create "$SANDBOX_NETWORK" >/dev/null || exit 1
DIFF_FILES=""
cleanup() {
  status=$?
  cleanup_failed=0
  trap - EXIT
  [ -z "$DIFF_FILES" ] || rm -f "$DIFF_FILES"
  docker ps -aq --filter "network=$SANDBOX_NETWORK" --filter "ancestor=$SANDBOX_IMAGE" \
    | xargs -r docker rm -f || cleanup_failed=1
  docker network rm "$SANDBOX_NETWORK" >/dev/null 2>&1 || {
    echo "Failed to remove sandbox network $SANDBOX_NETWORK" >&2
    cleanup_failed=1
  }
  if [ "$status" -eq 0 ] && [ "$cleanup_failed" -ne 0 ]; then
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# The unique network is both the sandbox's port namespace and its cleanup ownership marker.
export STRIX_DOCKER_SANDBOX_NETWORK="$SANDBOX_NETWORK"
export STRIX_IMAGE="$SANDBOX_IMAGE"
export STRIX_LLM="openai/gpt-5.6-sol"
export LLM_API_KEY="chatgpt-oauth"
export LLM_API_BASE="http://127.0.0.1:48100/v1"
export STRIX_REASONING_EFFORT="medium"

DIFF_BASE_REF=${STRIX_DIFF_BASE:-production@{7 days ago}}
DIFF_BASE=$(git rev-parse --verify "$DIFF_BASE_REF") || {
  echo "Could not resolve weekly diff base: $DIFF_BASE_REF"
  exit 1
}
DIFF_FILES=$(mktemp) || {
  echo "Could not create changed-file list"
  exit 1
}
if ! git diff --name-only --diff-filter=ACMR -z "$DIFF_BASE"...HEAD >"$DIFF_FILES"; then
  echo "Could not list files changed since $DIFF_BASE_REF"
  exit 1
fi
mapfile -d '' -t CHANGED_FILES <"$DIFF_FILES"
rm -f "$DIFF_FILES"
DIFF_FILES=""
if [ "${#CHANGED_FILES[@]}" -eq 0 ]; then
  echo "No files changed since $DIFF_BASE_REF; nothing to scan"
  echo "=== done $(date -Is) ==="
  exit 0
fi
printf 'Scanning %d file(s) changed since %s:\n' "${#CHANGED_FILES[@]}" "$DIFF_BASE_REF"
printf '  %s\n' "${CHANGED_FILES[@]}"

if ! strix -n -m standard \
  --scope-mode diff \
  --diff-base "$DIFF_BASE" \
  --target . \
  --max-budget-usd "$BUDGET" \
  --instruction "Authorized white-box security review of our local Next.js source only. Analyze and report findings only when they relate to files in the injected changed-file scope. Prioritize JWT and Firebase authentication, MCP bearer-token scoping, IDOR and broken authorization on API routes, secret exposure, injection, SSRF, and unsafe deserialization. Report concrete file:line findings. Do not access any live or remote application URL."; then
  echo "Strix scan failed; no findings will be filed"
  exit 1
fi

RUN=$(ls -dt "$APP"/strix_runs/*/ 2>/dev/null | head -1)
if [ -z "$RUN" ]; then
  echo "Strix produced no run directory; no findings will be filed"
  exit 1
fi
echo "run dir: $RUN"
python3 "$APP/scripts/strix-file-tickets.py" "$RUN"
echo "=== done $(date -Is) ==="
