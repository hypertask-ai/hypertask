#!/bin/bash
# Weekly Strix pentest of the Hypertask dev env. Cron: Sun 03:00.
# Boots hypertasks-dev, runs Strix against it, files each finding as a
# ticket on board 15, tears the dev server down.
# ponytail: one script, no orchestration layer. Add retries when a run
# actually fails for a reason other than budget exhaustion.
set -uo pipefail

DEV=/home/valentin/projects/hypertasks-dev
LOG=/home/valentin/logs/strix-weekly-$(date +%F).log
BUDGET=${STRIX_BUDGET:-50}
mkdir -p /home/valentin/logs
exec >>"$LOG" 2>&1
echo "=== strix-weekly $(date -Is) budget=\$$BUDGET ==="

cd "$DEV" || exit 1

# --- boot dev server on :3000 if not already up -------------------------
STARTED_SERVER=0
if ! curl -sf -o /dev/null --max-time 5 http://127.0.0.1:3000/api/health 2>/dev/null \
   && ! curl -sf -o /dev/null --max-time 5 http://127.0.0.1:3000/ 2>/dev/null; then
  echo "starting dev server..."
  nohup npm run dev >/tmp/strix-devserver.log 2>&1 &
  STARTED_SERVER=$!
  for _ in $(seq 1 60); do
    curl -sf -o /dev/null --max-time 5 http://127.0.0.1:3000/ && break
    sleep 5
  done
fi
curl -sf -o /dev/null --max-time 10 http://127.0.0.1:3000/ || { echo "dev server never came up, aborting"; exit 1; }

# --- run strix ----------------------------------------------------------
export STRIX_LLM="openai/gpt-5.4"
export LLM_API_KEY=$(grep -oE "AI_GATEWAY_API_KEY=\S+" /home/valentin/projects/hypertasks/.env.local | head -1 | cut -d= -f2)
export LLM_API_BASE="https://ai-gateway.vercel.sh/v1"

BEFORE=$(ls -d "$DEV"/strix_runs/*/ 2>/dev/null | wc -l)

strix -n \
  --target http://172.17.0.1:3000 \
  --max-budget-usd "$BUDGET" \
  --instruction "Grey-box test of a Next.js task-management app on the DEV environment (isolated branch database, throwaway data, safe to mutate). Prioritise: broken access control and IDOR on /api routes (BOTH src/app/api and the legacy src/pages/api router, which is the weaker surface), unauthenticated endpoints that read or mutate data, auth and session weaknesses (forgeable cookies, JWT audience confusion, session fixation), privilege escalation across board membership boundaries, and SSRF in any server-side URL fetch. Enumerate every route file under src/pages/api and src/app/api and check each one for a session gate and a membership check. Report each finding with a concrete curl reproduction. Do not attempt destructive DoS."

# --- collect findings ---------------------------------------------------
RUN=$(ls -dt "$DEV"/strix_runs/*/ 2>/dev/null | head -1)
echo "run dir: $RUN"

python3 /home/valentin/projects/hypertasks/scripts/strix-file-tickets.py "$RUN"

# --- teardown -----------------------------------------------------------
if [ "$STARTED_SERVER" != "0" ]; then
  pkill -f "next-server.*3000" 2>/dev/null
  kill "$STARTED_SERVER" 2>/dev/null
fi
echo "=== done $(date -Is) ==="
