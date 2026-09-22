#!/bin/bash
# The host owns credentials and browser probes. Strix sees source snapshots only.
set -euo pipefail
umask 077
export PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
MODE=assessment
for argument in "$@"; do
  if [ "$argument" = --live-only ]; then MODE=live; fi
done
STATE=${STRIX_ASSESSMENT_STATE:-$HOME/.local/state/strix/$MODE}
export STRIX_ASSESSMENT_STATE="$STATE"
mkdir -p "$STATE" "$HOME/.local/state/strix"
exec 9>"$HOME/.local/state/strix/$MODE.lock"
flock -n 9 || { echo 'Strix assessment is already running'; exit 1; }
export STRIX_RUNNER_ID="$(date +%s)-$$"
NETWORK=""
cleanup() {
  code=$?
  trap - EXIT
  if [ -n "$NETWORK" ]; then
    docker ps -aq --filter "network=$NETWORK" | xargs -r docker rm -f || code=1
    docker network rm "$NETWORK" >/dev/null 2>&1 || code=1
  fi
  python3 - "$STATE/latest.json" "$code" <<'PY'
import json,os,sys,tempfile
from pathlib import Path
path=Path(sys.argv[1])
data=json.loads(path.read_text()) if path.exists() else {}
code=int(sys.argv[2])
if data.get('runner_id')!=os.environ['STRIX_RUNNER_ID']:
    if code==0:
        raise SystemExit(0)
    output=tempfile.mkdtemp(prefix='setup-failed-',dir=path.parent)
    data=dict(status='running',output=output,runner_id=os.environ['STRIX_RUNNER_ID'],error='Runner setup failed before assessment started')
if data['status']=='running' or (code not in (0,2) and data['status']=='completed'):
        data.update(status='failed',exit_code=int(sys.argv[2]))
        for target in [Path(data['output'])/'assessment.json',path]:
            temporary=target.with_suffix('.tmp')
            temporary.write_text(json.dumps(data,indent=2)+'\n');temporary.replace(target)
PY
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "$MODE" = assessment ]; then
  systemctl --user start strix-chatgpt-proxy.service
  curl --fail --silent --show-error --retry 10 --retry-connrefused --retry-delay 1 --max-time 10 http://127.0.0.1:48100/health >/dev/null
  NETWORK="strix-assess-$(date +%s)-$$"
  docker network create --internal "$NETWORK" >/dev/null
fi
export STRIX_DOCKER_SANDBOX_NETWORK="$NETWORK"
export STRIX_IMAGE=ghcr.io/usestrix/strix-sandbox:1.1.0
export STRIX_LLM=openai/gpt-5.6-sol LLM_API_KEY=chatgpt-oauth LLM_API_BASE=http://127.0.0.1:48100/v1
export STRIX_REASONING_EFFORT=medium STRIX_TELEMETRY=false
export STRIX_SANDBOX_MEM_LIMIT=6g STRIX_SANDBOX_CPUS=3 STRIX_SANDBOX_PIDS_LIMIT=512
export STRIX_OAUTH_FIXTURE="${STRIX_OAUTH_FIXTURE:-$HOME/.config/strix/oauth-fixture.json}"
timeout --signal=TERM --kill-after=60 "${STRIX_ASSESSMENT_TIMEOUT:-3600}" python3 "$SCRIPT_DIR/strix-assess.py" "$@"
