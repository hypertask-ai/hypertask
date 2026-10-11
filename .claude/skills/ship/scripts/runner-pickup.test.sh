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
  "inbox list") [ -z "${FAKE_INBOX_FAIL:-}" ] || exit 1; [ -n "${FAKE_INBOX:-}" ] && cat "$FAKE_INBOX" || echo '{"success":true,"agent_notifications":[]}' ;;
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

# Inbox read failure: tickets still queued, pending messages still retried, no backoff; board failure unchanged.
rm -f "$inbox" "$RUNNER_INBOX_DIR"/runner-3.backoff.json; : > "$FAKE_LOG"
cat > "$T/deliver" <<'EOS'
#!/usr/bin/env bash
cat >> "$FAKE_DELIVERED"; exit 0
EOS
chmod +x "$T/deliver"; export FAKE_DELIVERED=$T/delivered RUNNER_DELIVER=$T/deliver
printf '%s\n' '{"text":"pending hello"}' > "$RUNNER_INBOX_DIR/runner-3.pending.jsonl"
FAKE_INBOX_FAIL=1 "$SCRIPT" run 3 2>/dev/null; rc=$?
eq "inbox read failure: tick succeeds" "$rc" "0"
eq "inbox read failure: tickets file still updated" "$(jq -r '[.items[].ticket]|sort|join(",")' "$inbox")" "YPER4-302"
eq "inbox read failure: pending message retried" "$(cat "$FAKE_DELIVERED" 2>/dev/null)" "pending hello"
[ ! -e "$RUNNER_INBOX_DIR/runner-3.backoff.json" ] && ok "inbox read failure: no backoff" || bad "inbox failure wrote backoff"
FAKE_FAIL=1 "$SCRIPT" run 3 2>/dev/null; rc=$?
eq "board read failure still fails the tick" "$rc" "1"
eq "board read failure still backs off" "$(jq -r .fails "$RUNNER_INBOX_DIR/runner-3.backoff.json")" "1"
rm -f "$RUNNER_INBOX_DIR"/runner-3.backoff.json

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

# ---- YPER4-284: board events reach the session through the hook, exactly once ----
jq -c '.items|=map(.delivered=true)' "$inbox" > "$inbox.x" && mv "$inbox.x" "$inbox"
ev() { jq -nc --arg id "$2" --arg t "$3" '{id:$id, ts:1, text:$t, delivered:false}' >> "$RUNNER_INBOX_DIR/$1.events.jsonl"; }
undelivered() { jq -s 'map(select(.delivered|not))|length' "$RUNNER_INBOX_DIR/$1.events.jsonl"; }
ctx() { jq -r '.hookSpecificOutput | "\(.hookEventName)|\(.additionalContext)"'; }
ev runner-3 e1 'Board event for Runner 3: Valentin Yeo commented "one"'
ev runner-3 e2 'Board event for Runner 3: Valentin Yeo commented "two"'
out=$(SHIP_SESSION_PID=4242 hook 'RUNNER 3' "$pl" post)
case "$(ctx <<<"$out")" in
  'PostToolUse|Board events for RUNNER 3, delivered by the events hook'*$'\n1) Board event for Runner 3: Valentin Yeo commented "one"\n2) Board event for Runner 3: Valentin Yeo commented "two"') ok "post: both events as PostToolUse additionalContext";;
  *) bad "post output: $out";;
esac
eq "post: events marked delivered" "$(undelivered runner-3)" "0"
eq "post: second call is silent (exactly once)" "$(hook 'RUNNER 3' "$pl" post)" ""
eq "every run refreshes the hook-alive marker with the session pid" "$(jq -r .pid "$RUNNER_INBOX_DIR/runner-3.hook-alive")" "4242"
ev runner-3 e3 'three'
eq "prompt: event as UserPromptSubmit additionalContext" "$(hook 'RUNNER 3' "$pl" prompt | ctx | tail -1)" "1) three"
ev runner-3 e4 'four'
printf -- '- [ ] G1: open work\n  CHECK: true\n' > "$T/work/.unlazy/s-abcdef12/GATES.md"
out=$(hook 'RUNNER 3' '{"session_id":"abcdef123456","cwd":"'$T'/work","stop_hook_active":true}')
eq "stop: events block even with an unmet gate and stop_hook_active" "$(jq -r .decision <<<"$out")|$(jq -r .reason <<<"$out" | tail -1)" "block|1) four"
eq "stop: second stop is silent" "$(hook 'RUNNER 3' "$pl")" ""
ev runner-3 e5 'five'
eq "non-runner session name gets nothing" "$(hook 'HTPR-1 | something' "$pl" post)|$(hook 'RUNNER' "$pl" prompt)" "|"
eq "and the runner's event stays queued" "$(undelivered runner-3)" "1"
eq "another runner does not take runner 3's event" "$(hook 'RUNNER 5' "$pl" post)|$(undelivered runner-3)" "|1"
hook 'RUNNER 3' "$pl" post > /dev/full 2>/dev/null
eq "output write fails: event is not marked, it comes again" "$(undelivered runner-3)" "1"
eq "and the retry hands it over" "$(hook 'RUNNER 3' "$pl" post | ctx | tail -1)" "1) five"
ev infra-manager i1 'for the manager'; ev speed-runner s1 'for speed'
eq "INFRA MANAGER gets its own slot" "$(hook 'INFRA MANAGER' "$pl" post | ctx | tail -1)" "1) for the manager"
eq "SPEED RUNNER gets its own slot" "$(hook 'SPEED RUNNER | perf' "$pl" prompt | ctx | tail -1)" "1) for speed"
# Waiter (asyncRewake): wakes with exit 2 only for a new event, once, one per session.
wait_hook() { echo "$pl" | SHIP_SESSION_NAME="$1" SHIP_SESSION_PID="$2" RUNNER_EVENTS_POLL=0.1 RUNNER_EVENTS_WAIT_MAX="${3:-1}" "$HOOK" wait; }
sleep 300 & LIVE=$!
eq "empty inbox: waiter does not wake (exit 0, no output)" "$(wait_hook 'RUNNER 3' "$LIVE" 2>&1; echo "rc=$?")" "rc=0"
( sleep 0.5; ev runner-3 w1 'wake up' ) &
out=$(wait_hook 'RUNNER 3' "$LIVE" 5 2>&1 >/dev/null; echo "rc=$?")
case "$out" in *$'\n1) wake up\nrc=2') ok "new event: waiter prints it on stderr and exits 2";; *) bad "waiter: $out";; esac
eq "woken event marked delivered" "$(undelivered runner-3)" "0"
eq "after delivery: no second wake for the same event" "$(wait_hook 'RUNNER 3' "$LIVE" 2>&1; echo "rc=$?")" "rc=0"
eq "hooks after the wake see nothing" "$(hook 'RUNNER 3' "$pl" post)$(hook 'RUNNER 3' "$pl")" ""
wait_hook 'RUNNER 3' "$LIVE" 3 >/dev/null 2>&1 & W1=$!; sleep 0.3
start=$(date +%s%N); wait_hook 'RUNNER 3' "$LIVE" 3 >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && [ $(( ($(date +%s%N) - start) / 1000000 )) -lt 1000 ] && ok "second waiter for the same session leaves at once" || bad "second waiter rc=$rc"
pkill -P "$W1" 2>/dev/null; kill "$W1" 2>/dev/null; wait "$W1" 2>/dev/null  # the hook is a child of the background pipeline
start=$(date +%s); wait_hook 'RUNNER 3' 999999999 30 >/dev/null 2>&1; rc=$?
[ "$rc" = 0 ] && [ $(( $(date +%s) - start )) -lt 3 ] && ok "waiter of a dead session leaves without a wake" || bad "dead-session waiter rc=$rc"
[ ! -e "$RUNNER_INBOX_DIR/runner-3.waiter.999999999.lock" ] && ok "a dead session's waiter removes its lock file" || bad "dead-session waiter lock left behind"
# Slot ownership: a waiter whose slot another live session has taken consumes nothing and leaves without a wake.
sleep 300 & OTHER=$!
( sleep 0.6; printf '{"pid":%s,"ts":%s}\n' "$OTHER" "$(date +%s)" > "$RUNNER_INBOX_DIR/runner-3.hook-alive"; ev runner-3 own1 'not yours' ) &
out=$(wait_hook 'RUNNER 3' "$LIVE" 4 2>&1; echo "rc=$?")
eq "waiter whose slot was taken by another pid: exit 0, nothing printed" "$out" "rc=0"
eq "and it consumed nothing" "$(undelivered runner-3)" "1"
hookp() { echo "$pl" | SHIP_SESSION_NAME="RUNNER 3" SHIP_SESSION_PID="$LIVE" "$HOOK" "$1"; }
eq "prompt/post/stop of the displaced session emit nothing" "$(hookp post)$(hookp prompt)$(hookp stop)" ""
eq "and consumed nothing either" "$(undelivered runner-3)" "1"
kill "$OTHER" 2>/dev/null; sleep 0.2; hookp post >/dev/null  # owner gone: this session takes the slot back and gets the event
eq "when the owner is gone the session takes the slot over" "$(undelivered runner-3)" "0"
# A backlog over 9,000 characters goes out in several calls, whole events, each exactly once.
pad=$(printf 'x%.0s' $(seq 500)); for i in $(seq 1 30); do ev runner-3 "big-$i" "event-$i $pad"; done
c1=$(hook 'RUNNER 3' "$pl" post | ctx); c2=$(hook 'RUNNER 3' "$pl" post | ctx); c3=$(hook 'RUNNER 3' "$pl" post | ctx)
[ "${#c1}" -le 9000 ] && [ "${#c2}" -le 9000 ] && [ -n "$c2" ] && ok "backlog split: each call under 9,000 characters (${#c1}, ${#c2})" || bad "backlog sizes ${#c1} ${#c2}"
eq "every backlog event handed over exactly once, in order, nothing left" "$(printf '%s\n%s\n' "$c1" "$c2" | grep -o 'event-[0-9]*' | tr '\n' ' ')|$c3|$(undelivered runner-3)" "$(for i in $(seq 1 30); do printf 'event-%s ' "$i"; done)||0"
ev runner-3 huge "huge-start $(printf 'y%.0s' $(seq 12000)) huge-end"; ev runner-3 after-huge 'small after huge'
c1=$(hook 'RUNNER 3' "$pl" post | ctx); c2=$(hook 'RUNNER 3' "$pl" post | ctx)
case "$c1" in *huge-start*'[cut by the events hook: this event was '*' characters]') [ "${#c1}" -le 9000 ] && ok "one event over the limit is cut with a note (${#c1})" || bad "cut event too long ${#c1}";; *) bad "huge event: ${c1:0:200}";; esac
eq "the event after it comes on the next call" "$(tail -1 <<<"$c2")|$(undelivered runner-3)" "1) small after huge|0"
eq "waiter ignores a non-runner session" "$(ev runner-3 w2 x; wait_hook 'HTPR-9' "$LIVE" 2>&1; echo "rc=$?")|$(undelivered runner-3)" "rc=0|1"
kill "$LIVE" 2>/dev/null
# The new-ticket handover keeps its gate: one undelivered ticket, an unmet gate, only events are handed over.
jq -c '.items|=map(.delivered=false)' "$inbox" > "$inbox.x" && mv "$inbox.x" "$inbox"
out=$(hook 'RUNNER 3' "$pl")
case "$(jq -r .reason <<<"$out")" in *'New ticket'*) bad "ticket handed over despite an unmet gate";; *'1) x') ok "unmet gate holds the ticket, not the event";; *) bad "gate split: $out";; esac

# Install: copies files, merges hooks once, enables the timer through a fake systemctl.
mkdir -p "$T/bin"; printf '#!/bin/sh\necho "$@" >> "%s/systemctl.log"\n' "$T" > "$T/bin/systemctl"; chmod +x "$T/bin/systemctl"
export RUNNER_PICKUP_UNIT_DIR=$T/units RUNNER_PICKUP_SETTINGS=$T/settings.json
for i in 1 2; do PATH="$T/bin:$PATH" "$SCRIPT" install 3 >/dev/null 2>&1; done
eq "install registers each hook once" "$(jq -r '[(.hooks.Stop|length), (.hooks.UserPromptSubmit|length), (.hooks.PostToolUse|length), (.hooks.SessionStart|length)]|join(",")' "$T/settings.json")" "2,2,1,1"
eq "the waiters run with asyncRewake and the longest safe timeout (2000000 s) (Stop, SessionStart, UserPromptSubmit)" "$(jq -c '[.hooks.Stop[], .hooks.SessionStart[], .hooks.UserPromptSubmit[] | .hooks[] | select(.command|endswith(" wait")) | [.asyncRewake, .timeout]]' "$T/settings.json")" '[[true,2000000],[true,2000000],[true,2000000]]'
wt() { jq -c '[.hooks.Stop[], .hooks.SessionStart[], .hooks.UserPromptSubmit[] | .hooks[] | select(.command|endswith(" wait")) | .timeout]' "$T/settings.json"; }
for old in 604800 86400; do
  jq --argjson o "$old" '.hooks |= with_entries(.value |= map(.hooks |= map(if (.command|endswith(" wait")) then .timeout = $o else . end)))' "$T/settings.json" > "$T/s.x" && mv "$T/s.x" "$T/settings.json"
  PATH="$T/bin:$PATH" "$SCRIPT" install 3 >/dev/null 2>&1
  eq "install upgrades existing $old s waiter entries to 2000000" "$(wt)" '[2000000,2000000,2000000]'
done
[ -f "$T/units/runner-pickup@.timer" ] && [ -x "$HOME/.local/lib/hypertask/runner-pickup/runner-inbox-stop.sh" ] && ok "install copies units and hook" || bad "install files"
grep -q 'enable --now runner-pickup@3.timer' "$T/systemctl.log" && ok "install enables the timer" || bad "enable"

echo "$passes passed, $fails failed"
[ "$fails" = 0 ] && echo "ALL PASS"
exit "$fails"
