#!/bin/bash
# Weekly white-box Strix scan of local Hypertask source via the ChatGPT subscription.
# Cron: Sun 03:00. Findings are filed as tickets after the scan.
set -uo pipefail

APP=/home/valentin/projects/hypertasks
LOG=/home/valentin/logs/strix-weekly-$(date +%F).log
BUDGET=${STRIX_BUDGET:-10}
mkdir -p /home/valentin/logs
exec >>"$LOG" 2>&1
echo "=== strix-weekly $(date -Is) subscription=chatgpt budget=\$$BUDGET ==="

cd "$APP" || exit 1

systemctl --user start strix-chatgpt-proxy.service
for _ in $(seq 1 30); do
  curl -sf -o /dev/null --max-time 2 http://127.0.0.1:48100/health && break
  sleep 1
done
curl -sf http://127.0.0.1:48100/health || {
  echo "ChatGPT proxy did not become healthy"
  exit 1
}

# An interrupted scan can leave the sandbox port occupied.
docker ps -aq --filter ancestor=ghcr.io/usestrix/strix-sandbox:1.1.0 \
  | xargs -r docker rm -f

export STRIX_LLM="openai/gpt-5.6-sol"
export LLM_API_KEY="chatgpt-oauth"
export LLM_API_BASE="http://127.0.0.1:48100/v1"
export STRIX_REASONING_EFFORT="medium"

strix -n -m standard \
  --scope-mode full \
  --target ./src \
  --max-budget-usd "$BUDGET" \
  --instruction "Authorized white-box security review of our local Next.js source only. Prioritize JWT and Firebase authentication, MCP bearer-token scoping, IDOR and broken authorization on API routes, secret exposure, injection, SSRF, and unsafe deserialization. Report concrete file:line findings. Do not access any live or remote application URL."

RUN=$(ls -dt "$APP"/strix_runs/*/ 2>/dev/null | head -1)
echo "run dir: $RUN"
python3 "$APP/scripts/strix-file-tickets.py" "$RUN"
echo "=== done $(date -Is) ==="
