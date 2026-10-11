#!/usr/bin/env bash
# runner-inbox-stop.sh stop|prompt|post|wait: hand board events and new tickets to a named session as its own message,
# never typed into its input box (YPER4-244, YPER4-284). Inert unless the session is named "RUNNER <n>", "INFRA MANAGER"
# or "SPEED RUNNER". Never touches the network.
#   prompt (UserPromptSubmit) and post (PostToolUse): pending board events as additionalContext, so a busy session sees
#          them between tool calls; prompt also hands a RUNNER its next assigned ticket.
#   stop   (Stop): pending board events, and for an idle RUNNER its next ticket, as decision "block".
#   wait   (Stop, SessionStart and UserPromptSubmit, with "asyncRewake": true): waits in the background until a board
#          event lands in the inbox, prints it on stderr and exits 2, which wakes the idle session
#          (code.claude.com/docs/en/hooks, asyncRewake). It never exits 2 without a new event, keeps one waiter per
#          session, runs up to 7 days (the installer's hook timeout is
#          604800 s; any later prompt, session start or turn end starts a new one), leaves quietly before its timeout and removes its lock file once the session is gone. The
#          UserPromptSubmit entry restarts it after a turn stopped with Esc (no Stop hook runs then).
# Board events come from runner-deliver through $STATE/<slot>.events.jsonl (slot runner-<n>, infra-manager, speed-runner).
# Each event is handed over once: the hook writes its output first and only then marks the event delivered, so a crash
# in between repeats an event instead of losing it. One call hands over at most about 9,000 characters of whole events
# (a single longer event is cut with a note); the rest wait for the next call. Every run refreshes $STATE/<slot>.hook-alive with the session pid;
# runner-deliver only uses the inbox for a session whose marker names its pid and whose slot is in events-hook.enabled.
# The new-ticket handover keeps its old rules: not on a Stop that is already a hook continuation, and not while the
# session's unlazy ledger has an unmet gate. Board events are not held back by either.
set -uo pipefail
mode=${1:-stop}
STATE=${RUNNER_INBOX_DIR:-$HOME/.local/state/runner-inbox}
SESSIONS=${RUNNER_PICKUP_SESSIONS_DIR:-$HOME/.claude/sessions}
POLL=${RUNNER_EVENTS_POLL:-2}
WAIT_MAX=${RUNNER_EVENTS_WAIT_MAX:-604000} # below the 604800 s (7 day) timeout the installer sets, so the waiter is never cancelled
KEEP=300                                   # delivered event ids kept for dedupe
# Events per hook call stay under this many characters (Claude Code moves additionalContext over 10,000 to a file);
# 600 are left for the new-ticket line.
MAXCHARS=$(( ${RUNNER_EVENTS_MAX_CHARS:-9000} - 600 ))
payload=$(cat 2>/dev/null || true)
active=$(jq -r '.stop_hook_active // false' <<<"$payload" 2>/dev/null)

# Prints "<pid>\x1f<name>" for the Claude session this hook runs under (user-given name, text after " | " dropped).
session_info() {
  if [ -n "${SHIP_SESSION_NAME:-}" ]; then printf '%s\037%s' "${SHIP_SESSION_PID:-}" "$SHIP_SESSION_NAME"; return; fi
  local pid=$$ f st
  while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
    f=$SESSIONS/$pid.json
    if [ -f "$f" ]; then printf '%s\037%s' "$pid" "$(jq -r 'select(.nameSource == "user") | .name // empty' "$f" 2>/dev/null)"; return; fi
    # Parent pid from /proc: ps costs about 90 ms a call here, and post runs on every tool call of every session.
    if read -r st < "/proc/$pid/stat" 2>/dev/null; then read -r _ pid _ <<<"${st##*) }"
    else pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' '); fi
  done
}
IFS=$'\037' read -r spid name < <(session_info; echo)
name=${name%% | *}
runner=""
case "$name" in
  "INFRA MANAGER") slot=infra-manager ;;
  "SPEED RUNNER") slot=speed-runner ;;
  *) [[ $name =~ ^RUNNER\ ([1-9][0-9]*)$ ]] || exit 0; runner=${BASH_REMATCH[1]}; slot=runner-$runner ;;
esac
mkdir -p "$STATE" 2>/dev/null || exit 0
events=$STATE/$slot.events.jsonl
if [[ $spid =~ ^[0-9]+$ ]]; then
  printf '{"pid":%s,"ts":%s,"mode":"%s"}\n' "$spid" "$(date +%s)" "$mode" > "$STATE/$slot.hook-alive.$$" 2>/dev/null \
    && mv "$STATE/$slot.hook-alive.$$" "$STATE/$slot.hook-alive" 2>/dev/null
fi

# Sets msg to the oldest undelivered events that fit in $MAXCHARS (whole events; a single longer event is cut with a note)
# and taken to their count; the rest stay pending for the next call. Call with the events lock held.
msg=""; taken=0
events_take() {
  local out; msg=""; taken=0
  [ -s "$events" ] || return 0
  out=$(jq -rs --arg who "$name" --argjson lim "$MAXCHARS" '
    ("Board events for \($who), delivered by the events hook (not typed by anyone at the keyboard):\n") as $head
    | ($lim - ($head | length)) as $room
    | reduce (map(select(.delivered | not)) | .[]) as $e ({lines: [], len: 0, k: 0, done: false};
        if .done then . else
          ("\(.k + 1)) \($e.text)") as $l
          | if .len + ($l | length) + 1 <= $room then .lines += [$l] | .len += ($l | length) + 1 | .k += 1
            elif .k == 0 then .lines = [$l[0:($room - 120)] + "\n[cut by the events hook: this event was \($l | length) characters]"] | .k = 1 | .done = true
            else .done = true end
        end)
    | "\(.k)\n" + (if .k > 0 then $head + (.lines | join("\n")) else "" end)' "$events" 2>/dev/null) || return 0
  taken=${out%%$'\n'*}; msg=${out#*$'\n'}
  [[ $taken =~ ^[0-9]+$ ]] && [ "$taken" -gt 0 ] || { taken=0; msg=""; }
}
# Marks the $taken oldest undelivered events delivered; keeps every pending event and the last $KEEP delivered ids.
# Call with the events lock held, after the output is written.
events_mark() {
  [ -s "$events" ] && [ "$taken" -gt 0 ] || return 0
  jq -cs --argjson k "$taken" --argjson keep "$KEEP" '
    reduce range(0; length) as $i ({a: ., n: 0};
      if (.a[$i].delivered | not) and .n < $k then .a[$i].delivered = true | .n += 1 else . end)
    | .a | (map(select(.delivered)) | .[-$keep:]) + map(select(.delivered | not)) | .[]' "$events" > "$events.tmp.$$" 2>/dev/null \
    && mv "$events.tmp.$$" "$events" 2>/dev/null || rm -f "$events.tmp.$$"
}

if [ "$mode" = wait ]; then
  # One waiter per session; a waiter whose session is gone or that nears its timeout leaves without a wake.
  # Waits up to 0.5 s so runner-deliver's brief probe of this lock never makes a starting waiter leave.
  exec 7>>"$STATE/$slot.waiter.${spid:-x}.lock"; flock -w 0.5 7 || exit 0
  start=$(date +%s)
  while :; do
    if [[ $spid =~ ^[0-9]+$ ]] && ! kill -0 "$spid" 2>/dev/null; then rm -f "$STATE/$slot.waiter.$spid.lock"; exit 0; fi
    if [ $(( $(date +%s) - start )) -ge "$WAIT_MAX" ]; then
      # A hook cannot renew itself; the next prompt, session start or turn end starts a new waiter, and until then
      # runner-deliver logs "no live waiter" for each event. Logged here so the gap is visible.
      printf '%s waiter for %s (pid %s) reached its time limit: idle session not wakeable until its next activity\n' "$(date -Is)" "$slot" "$spid" >> "$STATE/typing-fallback.log" 2>/dev/null
      exit 0
    fi
    if [ -s "$events" ] && grep -q '"delivered":false' "$events" 2>/dev/null; then
      exec 8>"$STATE/$slot.events.lock"; flock -x 8
      events_take
      # Mark and wake only when the write succeeded; otherwise the events stay pending.
      if [ -n "$msg" ] && printf '%s\n' "$msg" >&2; then events_mark; exit 2; fi
      flock -u 8; exec 8>&-
    fi
    sleep "$POLL"
  done
fi

# Board events (any mode), taken under the events lock that is held until they are marked.
exec 8>"$STATE/$slot.events.lock"; flock -x 8
events_take

# A RUNNER's next assigned ticket (prompt and stop only, with the old guards).
ticket=""; inbox=$STATE/runner-$runner.json
ticket_ok() {
  [ -n "$runner" ] && [ "$mode" != post ] && [ -s "$inbox" ] || return 1
  [ "$mode" != stop ] || [ "$active" != true ] || return 1
  # Idle means no unmet gate in this session's unlazy ledger (unchecked and not abandoned).
  local sid cwd ledger id
  sid=$(jq -r '.session_id // empty' <<<"$payload" 2>/dev/null); cwd=$(jq -r '.cwd // empty' <<<"$payload" 2>/dev/null)
  for ledger in "${cwd:-$PWD}/.unlazy/s-${sid:0:8}/GATES.md" "$HOME/.local/state/unlazy/sessions/${sid:0:8}/GATES.md"; do
    [ -n "$sid" ] && [ -f "$ledger" ] || continue
    while IFS= read -r id; do
      grep -qE "^ABANDON: $id( |:|$)" "$ledger" || return 1
    done < <(grep -E '^- \[ \] ' "$ledger" | sed -E 's/^- \[ \] ([^:]+):.*/\1/')
  done
  return 0
}
if ticket_ok; then
  exec 9>"$STATE/runner-$runner.lock"; flock -x 9
  item=$(jq -c '[.items[] | select(.delivered | not)] | first // empty' "$inbox" 2>/dev/null)
  if [ -n "$item" ]; then
    ticket=$(jq -r .ticket <<<"$item")
    tmsg="New ticket assigned to you on the board: $(jq -r .title <<<"$item") $(jq -r .url <<<"$item"). Run /ship $ticket."
    msg=${msg:+$msg$'\n\n'}$tmsg
  fi
fi
[ -n "$msg" ] || exit 0

case "$mode" in
  prompt) jq -n --arg m "$msg" '{hookSpecificOutput: {hookEventName: "UserPromptSubmit", additionalContext: $m}}' ;;
  post) jq -n --arg m "$msg" '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $m}}' ;;
  *) jq -n --arg m "$msg" '{decision: "block", reason: $m}' ;;
esac || exit 0
events_mark
if [ -n "$ticket" ]; then
  jq -c --arg t "$ticket" '.items |= map(if .ticket == $t then .delivered = true else . end)' "$inbox" > "$inbox.tmp" && mv "$inbox.tmp" "$inbox"
fi
exit 0
