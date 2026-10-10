#!/usr/bin/env bash
# runner-inbox-stop.sh stop|prompt: hand an idle RUNNER session the next ticket assigned to its agent (YPER4-244).
# Inert unless the session is named "RUNNER <n>", the stop is not already a hook continuation and the unlazy ledger
# has no unmet gate. Each queued ticket is delivered once, then marked delivered. Never touches the network.
set -uo pipefail
mode=${1:-stop}
STATE=${RUNNER_INBOX_DIR:-$HOME/.local/state/runner-inbox}
payload=$(cat 2>/dev/null || true)
[ "$(jq -r '.stop_hook_active // false' <<<"$payload" 2>/dev/null)" != true ] || exit 0

session_name() {
  [ -z "${SHIP_SESSION_NAME:-}" ] || { printf '%s' "$SHIP_SESSION_NAME"; return; }
  local pid=$$ f
  while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
    f=$HOME/.claude/sessions/$pid.json
    if [ -f "$f" ]; then jq -r 'select(.nameSource == "user") | .name // empty' "$f" 2>/dev/null; return; fi
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
  done
}
name=$(session_name); name=${name%% | *}
[[ $name =~ ^RUNNER\ ([1-9][0-9]*)$ ]] || exit 0
n=${BASH_REMATCH[1]}
inbox=$STATE/runner-$n.json
[ -s "$inbox" ] || exit 0

# Idle means no unmet gate in this session's unlazy ledger (unchecked and not abandoned).
sid=$(jq -r '.session_id // empty' <<<"$payload" 2>/dev/null); cwd=$(jq -r '.cwd // empty' <<<"$payload" 2>/dev/null)
for ledger in "${cwd:-$PWD}/.unlazy/s-${sid:0:8}/GATES.md" "$HOME/.local/state/unlazy/sessions/${sid:0:8}/GATES.md"; do
  [ -n "$sid" ] && [ -f "$ledger" ] || continue
  while IFS= read -r id; do
    grep -qE "^ABANDON: $id( |:|$)" "$ledger" || exit 0
  done < <(grep -E '^- \[ \] ' "$ledger" | sed -E 's/^- \[ \] ([^:]+):.*/\1/')
done

exec 8>"$STATE/runner-$n.lock"; flock -x 8
item=$(jq -c '[.items[] | select(.delivered | not)] | first // empty' "$inbox" 2>/dev/null)
[ -n "$item" ] || exit 0
ticket=$(jq -r .ticket <<<"$item")
jq -c --arg t "$ticket" '.items |= map(if .ticket == $t then .delivered = true else . end)' "$inbox" > "$inbox.tmp" && mv "$inbox.tmp" "$inbox" || exit 0
msg="New ticket assigned to you on the board: $(jq -r .title <<<"$item") $(jq -r .url <<<"$item"). Run /ship $ticket."
if [ "$mode" = prompt ]; then
  jq -n --arg m "$msg" '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $m}}'
else
  jq -n --arg m "$msg" '{decision: "block", reason: $m}'
fi
