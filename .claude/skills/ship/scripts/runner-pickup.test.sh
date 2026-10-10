#!/usr/bin/env bash
# Offline tests for runner-pickup and the runner-inbox-stop hook, using a fake vcc (no network, no GitHub).
cd "$(dirname "$0")" || exit 1
HERE=$PWD; HOOK=$HERE/../../../hooks/runner-inbox-stop.sh; SCRIPT=$HERE/runner-pickup
fails=0; passes=0
ok() { echo "ok   $*"; passes=$((passes+1)); }; bad() { echo "FAIL $*"; fails=$((fails+1)); }
eq() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (want '$3' got '$2')"; }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export RUNNER_PICKUP_TMUX=/nonexistent-tmux RUNNER_PICKUP_SESSIONS_DIR=$T/nosessions
export RUNNER_INBOX_DIR=$T/inbox HOME=$T/home RUNNER_PICKUP_RATE_MARKER=$T/none
mkdir -p "$HOME"
export FAKE_TASKS=$T/tasks.json FAKE_LOG=$T/vcc.log RUNNER_PICKUP_VCC=$T/vcc
cat > "$T/vcc" <<'EOF'
#!/usr/bin/env bash
echo "$SHIP_SESSION_NAME|$*" >> "$FAKE_LOG"
case "$1 $2" in
  "task list") [ -z "${FAKE_FAIL:-}" ] || exit 1; cat "$FAKE_TASKS" ;;
  "inbox list") [ -n "${FAKE_INBOX:-}" ] && cat "$FAKE_INBOX" || echo '{"success":true,"agent_notifications":[]}' ;;
  "activity add") exit 0 ;;
  *) exit 9 ;;
esac
EOF
chmod +x "$T/vcc"
NOWISO=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
task() { # ticket section agent project
  jq -n --arg t "$1" --arg s "$2" --arg a "$3" --argjson p "$4" --arg now "$NOWISO" \
    '{ticketNumber:$t, uniqueIndex:($t|capture("-(?<n>[0-9]+)").n|tonumber), title:("Title of "+$t), section:$s, projectId:$p, createdAt:$now, updatedAt:$now,
      assignees:[{id:6, agent:{id:"x", displayName:$a}}]}'
}
write_tasks() { printf '{"success":true,"tasks":[%s]}\n' "$(IFS=,; echo "$*")" > "$FAKE_TASKS"; }
write_tasks "$(task YPER4-300 Todo 'Runner 3' 4060)" "$(task YPER4-301 'In Progress' 'Runner 3' 4060)" "$(task HTPR-400 Todo 'Runner 4' 15)" "$(task HTPR-401 Done 'Runner 3' 15)" "$(task YPER4-302 Backlog 'Runner 3' 4060)"
inbox=$RUNNER_INBOX_DIR/runner-3.json
activity() { grep -c '|activity add' "$FAKE_LOG" 2>/dev/null || true; }

# Tick 1: only this runner's unclaimed tickets are queued, no activity line yet.
"$SCRIPT" run 3 2>/dev/null
eq "queues unclaimed tickets of this runner only" "$(jq -r '[.items[].ticket]|sort|join(",")' "$inbox")" "YPER4-300,YPER4-302"
eq "item carries the full URL" "$(jq -r '.items[]|select(.ticket=="YPER4-300").url' "$inbox")" "https://app.hypertask.ai/detail/project-4060/300"
eq "identity used for the read" "$(head -1 "$FAKE_LOG")" "RUNNER 3|task list --assigned-to me --status Normal --sort updatedAt:desc --limit 100 --json"
eq "no activity line on first sight" "$(activity)" "0"
eq "exactly one board read per tick" "$(grep -c '|task list' "$FAKE_LOG")" "1"
# Tick 2: still undelivered -> one activity line each; tick 3: no more lines (idempotent).
"$SCRIPT" run 3 2>/dev/null
eq "one activity line per undelivered ticket on tick 2" "$(activity)" "2"
grep -q 'activity add YPER4-300 Queued for Runner 3' "$FAKE_LOG" && ok "activity line names the runner" || bad "activity line text"
"$SCRIPT" run 3 2>/dev/null
eq "idempotent: no extra activity lines" "$(activity)" "2"
eq "idempotent: no duplicate items" "$(jq '.items|length' "$inbox")" "2"
# A claimed ticket leaves the inbox.
write_tasks "$(task YPER4-300 'In Progress' 'Runner 3' 4060)" "$(task YPER4-302 Backlog 'Runner 3' 4060)"
"$SCRIPT" run 3 2>/dev/null
eq "claimed ticket dropped" "$(jq -r '[.items[].ticket]|join(",")' "$inbox")" "YPER4-302"

# Errors: backoff file, no tight retry, capped growth.
export FAKE_FAIL=1; : > "$FAKE_LOG"
"$SCRIPT" run 3 2>/dev/null; rc=$?
eq "failed read exits non-zero" "$rc" "1"
eq "backoff file written" "$(jq -r .fails "$RUNNER_INBOX_DIR/runner-3.backoff.json")" "1"
"$SCRIPT" run 3 2>/dev/null; rc=$?
eq "second run inside backoff does not call the board" "$(grep -c '|task list' "$FAKE_LOG")" "1"
RUNNER_PICKUP_NOW=$(( $(date +%s) + 400 )) "$SCRIPT" run 3 2>/dev/null
eq "after the delay it retries and the delay doubles" "$(jq -r .fails "$RUNNER_INBOX_DIR/runner-3.backoff.json")" "2"
for i in 1 2 3 4 5 6 7 8; do RUNNER_PICKUP_NOW=$(( $(date +%s) + 100000 * i )) "$SCRIPT" run 3 2>/dev/null; done
until=$(jq -r .until "$RUNNER_INBOX_DIR/runner-3.backoff.json")
[ $((until - $(date +%s) - 800000)) -le 3600 ] && ok "backoff delay capped at 3600s" || bad "cap"
unset FAKE_FAIL
RUNNER_PICKUP_MAX_AGE_DAYS=100000 RUNNER_PICKUP_NOW=$(( $(date +%s) + 2000000 )) "$SCRIPT" run 3 2>/dev/null
[ ! -e "$RUNNER_INBOX_DIR/runner-3.backoff.json" ] && ok "success clears backoff" || bad "backoff not cleared"
grep -rqE 'api\.github|\bgh +(api|pr)|git +(fetch|pull|push)' "$SCRIPT" "$HOOK" && bad "script touches GitHub" || ok "no GitHub calls in script or hook"

# Hook.
hook() { echo "$2" | SHIP_SESSION_NAME="$1" "$HOOK" "${3:-stop}"; }
pl='{"session_id":"abcdef123456","cwd":"'$T'/work"}'
mkdir -p "$T/work"
jq -c '.items|=map(.delivered=false)' "$inbox" > "$inbox.x" && mv "$inbox.x" "$inbox"
eq "non-runner session: silent" "$(hook 'HTPR-1 | something' "$pl")" ""
eq "unnamed session: silent" "$(hook '' "$pl")" ""
eq "stop_hook_active: silent" "$(hook 'RUNNER 3' '{"session_id":"abcdef123456","stop_hook_active":true}')" ""
eq "another runner: silent" "$(hook 'RUNNER 5' "$pl")" ""
mkdir -p "$T/work/.unlazy/s-abcdef12"
printf -- '- [ ] G1: open work\n  CHECK: true\n' > "$T/work/.unlazy/s-abcdef12/GATES.md"
eq "busy runner (unmet gate): silent and still queued" "$(hook 'RUNNER 3' "$pl")|$(jq '[.items[]|select(.delivered|not)]|length' "$inbox")" "|1"
printf -- '- [ ] G1: open work\n  CHECK: true\nABANDON: G1 waiting for Valentin\n' > "$T/work/.unlazy/s-abcdef12/GATES.md"
out=$(hook 'RUNNER 3' "$pl")
eq "idle runner: blocks with the full title and URL" "$(jq -r .decision <<<"$out")" "block"
case "$(jq -r .reason <<<"$out")" in
  "New ticket assigned to you on the board: Title of YPER4-302 https://app.hypertask.ai/detail/project-4060/302. Run /ship YPER4-302.") ok "reason text";;
  *) bad "reason text: $(jq -r .reason <<<"$out")";;
esac
eq "delivered once: second stop is silent" "$(hook 'RUNNER 3' "$pl")" ""
eq "item marked delivered" "$(jq -r '.items[0].delivered' "$inbox")" "true"
before=$(activity); RUNNER_PICKUP_MAX_AGE_DAYS=100000 "$SCRIPT" run 3 2>/dev/null
eq "delivered item is not requeued or announced" "$(activity)" "$before"
jq -c '.items|=map(.delivered=false)' "$inbox" > "$inbox.x" && mv "$inbox.x" "$inbox"
eq "prompt mode adds context instead of blocking" "$(hook 'RUNNER 3' "$pl" prompt | jq -r .hookSpecificOutput.hookEventName)" "UserPromptSubmit"

# Install: copies files, merges hooks once, enables the timer through a fake systemctl.
mkdir -p "$T/bin"; printf '#!/bin/sh\necho "$@" >> "%s/systemctl.log"\n' "$T" > "$T/bin/systemctl"; chmod +x "$T/bin/systemctl"
export RUNNER_PICKUP_UNIT_DIR=$T/units RUNNER_PICKUP_SETTINGS=$T/settings.json
for i in 1 2; do PATH="$T/bin:$PATH" "$SCRIPT" install 3 >/dev/null 2>&1; done
eq "install registers Stop and UserPromptSubmit once" "$(jq -r '[(.hooks.Stop|length), (.hooks.UserPromptSubmit|length)]|join(",")' "$T/settings.json")" "1,1"
[ -f "$T/units/runner-pickup@.timer" ] && [ -x "$HOME/.local/lib/hypertask/runner-pickup/runner-inbox-stop.sh" ] && ok "install copies units and hook" || bad "install files"
grep -q 'enable --now runner-pickup@3.timer' "$T/systemctl.log" && ok "install enables the timer" || bad "enable"

echo "$passes passed, $fails failed"
[ "$fails" = 0 ] && echo "ALL PASS"
exit "$fails"
