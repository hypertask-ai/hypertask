#!/usr/bin/env bash
# Offline tests for ship-claim (YPER4-264): decision from saved comments, and the full flow with stub vcc/hypertask.
cd "$(dirname "$0")" || exit 1
unset SHIP_SESSION_NAME CLAUDE_CODE_SESSION_ID CODEX_SESSION_ID CODEX_THREAD_ID
fails=0; passes=0
ok() { echo "ok   $*"; passes=$((passes+1)); }; bad() { echo "FAIL $*"; fails=$((fails+1)); }
eq() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (want '$3' got '$2')"; }
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
export HOME="$D"
ME="sess-mine-1234"
# c <id> <time> <agent id> <agent name> <html>
c() { jq -n --argjson i "$1" --arg t "$2" --arg a "$3" --arg n "$4" --arg x "$5" \
  '{id:$i, createdAt:$t, agent:{id:$a, displayName:$n}, text:$x}'; }
claim() { echo "<p><strong>Claimed.</strong></p><p>Next: go. Resume this Claude session: claude --resume $1</p>"; }
mk() { printf '{"success":true,"comments":[%s]}\n' "$(IFS=,; echo "$*")" > "$D/c.json"; }
decide() { ./ship-claim decide "$ME" "$D/c.json" "${1:-}" | cut -f1,2; }

mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "earlier other claim -> step back" "$(decide)" "$(printf 'LOSE\tRUNNER 7')"

mk "$(c 10 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claim $ME)")" "$(c 11 2026-10-11T10:00:12.000Z a1 'RUNNER 7' "$(claim other-sess)")"
eq "ours earliest -> proceed" "$(decide)" WIN

mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")" "$(c 11 2026-10-11T10:05:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "same agent twice -> proceed" "$(decide)" WIN

mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' '<p>Claimed. Session working it now. Claim id: [--resume]</p>')" \
   "$(c 11 2026-10-11T10:05:00.000Z a2 'RUNNER 3' "<p>Claimed. Session working it now. Claim id: [$ME]</p>")"
eq "earlier claim with a flag as its id -> proceed" "$(decide)" WIN

mk "$(c 5 2026-10-10T08:00:00.000Z b1 'Product Bot' '<p>Blocked: waiting on a decision.</p>')" \
   "$(c 6 2026-10-10T08:01:00.000Z b1 'Product Bot' '<p>Plan and progress notes.</p>')" \
   "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "old non-Claimed comments ignored" "$(decide)" WIN

mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "tie -> lower comment id wins (other)" "$(decide)" "$(printf 'LOSE\tRUNNER 7')"
mk "$(c 12 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "tie -> lower comment id wins (ours)" "$(decide)" WIN

mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" \
   "$(c 11 2026-10-11T10:01:00.000Z a1 'RUNNER 7' '<p><strong>Stepping back: RUNNER 9 claimed this first.</strong></p><p>Next: go on. Resume this Claude session: claude --resume other-sess</p>')" \
   "$(c 12 2026-10-11T10:02:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "claimant that stepped back is ignored" "$(decide)" WIN

mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")"
eq "own claim missing -> NOOURS" "$(decide)" NOOURS

# Review fixes: stale window, assignees, shared identity, malformed input.
mk "$(c 10 2026-10-11T00:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
echo a1 > "$D/idle"
eq "old claim, claimant has recent activity -> LOSE" "$(decide)" "$(printf 'LOSE\tRUNNER 7')"
eq "old claim, claimant idle -> WIN" "$(decide "$D/idle")" WIN
mk "$(c 10 2026-10-11T04:30:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "claim 5.5 h before ours counts even if idle listed" "$(decide "$D/idle")" "$(printf 'LOSE\tRUNNER 7')"
mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "shared identity: other session's earlier claim wins" "$(decide)" "$(printf 'LOSE\tRUNNER 3')"
mk "$(c 10 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claim $ME)")" "$(c 11 2026-10-11T10:00:20.000Z a2 'RUNNER 3' "$(claim other-sess)")"
eq "shared identity: ours earliest -> proceed" "$(decide)" WIN
echo 'not json' > "$D/bad.json"; ./ship-claim decide $ME "$D/bad.json" >/dev/null 2>&1; eq "malformed JSON -> exit 2" "$?" 2
./ship-claim decide $ME "$D/missing.json" >/dev/null 2>&1; eq "missing file -> exit 2" "$?" 2
./ship-claim decide $ME "$D/c.json" "$D/no-such-idle" >/dev/null 2>&1; eq "decide failure propagates -> exit 2" "$?" 2

# Hand-over and unassigned claimers (YPER4-269).
R8=dd6ef685-07cc-474e-b4f8-e96ccccc706b
decide8() { ./ship-claim decide "$R8" "$1" "${2:-}" "${3:-}" | cut -f1,2; }
dec() { ./ship-claim decide "$ME" "$D/c.json" /dev/null "${1:-}" | cut -f1,2; }
echo c5fc66c9-c13c-44cd-bd13-0bfc54f02638 > "$D/asg-r8"
eq "Y243 replay: R3 handed over, R8 claims -> WIN" "$(decide8 fixtures/ship-claim-y243-comments.json)" WIN
eq "Y243 replay with only R8 assigned -> WIN" "$(decide8 fixtures/ship-claim-y243-comments.json "" "$D/asg-r8")" WIN
jq '.comments |= map(select(.id != 278773))' fixtures/ship-claim-y243-comments.json > "$D/nohand.json"
eq "Y243 without the hand-over, R3 still assigned -> LOSE" "$(decide8 "$D/nohand.json")" "$(printf 'LOSE\tRunner 3')"
eq "Y243 without the hand-over, R3 unassigned -> WIN" "$(decide8 "$D/nohand.json" "" "$D/asg-r8")" WIN
echo a2 > "$D/asg-b"; echo a1 > "$D/asg-a"
mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "A claimed, A unassigned, B claims -> B first" "$(dec "$D/asg-b")" WIN
eq "A claimed, A still assigned, no hand-over -> B steps back" "$(dec "$D/asg-a")" "$(printf 'LOSE\tRUNNER 7')"
eq "assigned list unknown -> old behaviour, B steps back" "$(dec)" "$(printf 'LOSE\tRUNNER 7')"
mk "$(c 10 2026-10-11T09:59:30.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "A claimed seconds ago, not assigned yet -> B steps back" "$(dec "$D/asg-b")" "$(printf 'LOSE\tRUNNER 7')"
mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" \
   "$(c 11 2026-10-11T09:30:00.000Z a1 'RUNNER 7' '<p>Progress: tests are green, opening the PR.</p>')" \
   "$(c 12 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "A's later unrelated comment -> A still first" "$(dec "$D/asg-a")" "$(printf 'LOSE\tRUNNER 7')"
for w in 'Handed over to RUNNER 3: all yours' 'Released this ticket' 'Unclaimed.' 'Stepping back: I am out'; do
  mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" \
     "$(c 11 2026-10-11T09:30:00.000Z a1 'RUNNER 7' "<p><strong>$w</strong></p>")" \
     "$(c 12 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
  eq "hand-over wording '$w' -> B first" "$(dec)" WIN
done
mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" \
   "$(c 11 2026-10-11T09:30:00.000Z a2 'RUNNER 3' '<p><strong>Handing over to RUNNER 5</strong></p>')" \
   "$(c 12 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "someone else's hand-over does not cancel A's claim" "$(dec)" "$(printf 'LOSE\tRUNNER 7')"

# Codex and hax runners resume through a tmux attach line, so every claim, hand-over and step-back
# carries its own claim id plus its runner's resume line (YPER4-931).
H5='tmux attach -t ht-hax-runner-5 (hax RUNNER 5)'
L3='tmux attach -t ht-hax-runner-3 (hax RUNNER 3)'
L7='tmux attach -t ht-hax-runner-7 (hax RUNNER 7)'
L9='tmux attach -t ht-hax-runner-9 (hax RUNNER 9)'
claimid() { echo "<p><strong>Claimed.</strong> Claim id: [$1]</p><p>Next: go. Resume: ${2:-$H5}</p>"; }
stepback() { echo "<p><strong>Stepping back: RUNNER 9 claimed this first.</strong> Claim id: [$1]</p><p>Next: go on. Resume: ${2:-$H5}</p>"; }
oldclaim() { echo "<p><strong>Claimed.</strong></p><p>Next: go. Resume: $1</p>"; }
decideS() { ./ship-claim decide "$1" "$D/c.json" "" "" "${2:-}" | cut -f1,2; }
mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claimid codex-sess-7 "$L7")")" \
   "$(c 11 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claimid $ME "$L3")")"
eq "two Codex runners, earliest claim wins" "$(decide)" "$(printf 'LOSE\tRUNNER 7')"
mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claimid codex-sess-7 "$L7")")" \
   "$(c 11 2026-10-11T10:00:02.000Z a2 'RUNNER 3' "$(claimid codex-sess-3 "$L3")")" \
   "$(c 12 2026-10-11T10:00:05.000Z a1 'RUNNER 7' "$(stepback codex-sess-7 "$L7")")" \
   "$(c 13 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claimid $ME "$L3")")"
eq "a step-back cancels only its own claim" "$(decide)" "$(printf 'LOSE\tRUNNER 3')"
mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claimid codex-sess-7 "$L7")")" \
   "$(c 11 2026-10-11T10:00:02.000Z a2 'RUNNER 3' "$(claimid $ME "$L3")")" \
   "$(c 12 2026-10-11T10:00:05.000Z a1 'RUNNER 7' "$(stepback codex-sess-7 "$L7")")"
eq "another session's step-back leaves our claim standing" "$(decide)" WIN
mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claimid active-other)")" \
   "$(c 11 2026-10-11T10:00:02.000Z a2 'RUNNER 3' "$(claimid $ME)")" \
   "$(c 12 2026-10-11T10:00:05.000Z a1 'RUNNER 7' "$(stepback active-other)")"
eq "a step-back never retires another live claim id" "$(decideS $ME '')" WIN
mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(oldclaim "$H5")")" \
   "$(c 11 2026-10-11T10:05:00.000Z a2 'RUNNER 3' "$(claimid $ME)")"
eq "own earlier session's claim is ours by its resume line" "$(decideS $ME "$H5")" WIN
eq "without the resume line the earlier claim competes" "$(decideS $ME '')" "$(printf 'LOSE\tRUNNER 3')"
mk "$(c 10 2026-10-11T09:00:00.000Z a2 'RUNNER 3' "$(oldclaim "$H5")")" \
   "$(c 11 2026-10-11T09:05:00.000Z a2 'RUNNER 3' "$(claimid $ME)")" \
   "$(c 12 2026-10-11T09:06:00.000Z a2 'RUNNER 3' "$(stepback $ME)")" \
   "$(c 13 2026-10-11T09:10:00.000Z a3 'RUNNER 4' "$(claimid third-sess)")"
eq "own step-back retires the resume-adopted older claim" "$(decideS third-sess '')" WIN
mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 7' "$(oldclaim "$L7")")" \
   "$(c 11 2026-10-11T09:02:00.000Z a2 'RUNNER 3' "$(stepback other-session)")" \
   "$(c 12 2026-10-11T09:05:00.000Z a2 'RUNNER 3' "$(claimid $ME)")"
eq "another agent's older claim survives our step-back" "$(decideS $ME '')" "$(printf 'LOSE\tRUNNER 7')"
mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 7' "$(claimid active-other)")" \
   "$(c 11 2026-10-11T09:05:00.000Z a2 'RUNNER 3' "$(claimid $ME)")"
eq "two live claim ids compete even on one resume line" "$(decideS $ME "$H5")" "$(printf 'LOSE\tRUNNER 7')"
mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 7' "$(claimid active-1 "$L7")")" \
   "$(c 11 2026-10-11T09:05:00.000Z a1 'RUNNER 7' '<p><strong>Released this ticket</strong></p>')" \
   "$(c 12 2026-10-11T09:10:00.000Z a2 'RUNNER 3' "$(claimid $ME "$L3")")"
eq "a sessionless release retires a new claim of its own agent" "$(decide)" WIN
mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 7' "$(claimid active-1 "$L7")")" \
   "$(c 11 2026-10-11T09:05:00.000Z a1 'RUNNER 7' '<p><strong>Released this ticket</strong> Claim id: active-1</p>')" \
   "$(c 12 2026-10-11T09:10:00.000Z a2 'RUNNER 3' "$(claimid $ME "$L3")")"
eq "a released session stops competing" "$(decide)" WIN
# A claim id is the whole resume command, so a restarted runner keeps the id its previous session used,
# while another runner's claim still competes and a release only retires what it names.
mk "$(c 10 2026-10-11T09:00:00.000Z a2 'RUNNER 3' "$(oldclaim "$H5")")" \
   "$(c 11 2026-10-11T09:05:00.000Z a2 'RUNNER 3' "$(claimid "$H5")")"
eq "a restarted runner keeps its claim id" "$(decideS "$H5" "$H5")" WIN
mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 7' "$(claimid "$L7")")" \
   "$(c 11 2026-10-11T09:05:00.000Z a2 'RUNNER 3' "$(claimid "$L3")")"
eq "another runner's claim still competes" "$(decideS "$L3")" "$(printf 'LOSE\tRUNNER 7')"
mk "$(c 10 2026-10-11T09:00:00.000Z a2 'RUNNER 3' "$(claimid "$L3")")" \
   "$(c 11 2026-10-11T09:02:00.000Z a2 'RUNNER 3' "<p><strong>Handed over to RUNNER 9: all yours.</strong></p><p>Resume: $L9</p>")" \
   "$(c 12 2026-10-11T09:05:00.000Z a5 'RUNNER 9' "$(claimid "$L9")")"
eq "a release with a different resume line keeps the claim" "$(decideS "$L9")" "$(printf 'LOSE\tRUNNER 3')"
mk "$(c 10 2026-10-11T09:00:00.000Z a2 'RUNNER 3' "$(claimid "$H5")")" \
   "$(c 11 2026-10-11T09:02:00.000Z a2 'RUNNER 3' "<p><strong>Handed over to RUNNER 9: all yours.</strong></p><p>Resume: $H5</p>")" \
   "$(c 12 2026-10-11T09:10:00.000Z a5 'RUNNER 9' "$(claimid "$L9")")"
eq "a resume-only handover retires the tagged claim it names" "$(decideS "$L9")" WIN
mk "$(c 10 2026-10-11T09:00:00.000Z a2 'RUNNER 3' "$(claimid "$L3")")" \
   "$(c 11 2026-10-11T09:02:00.000Z a1 'RUNNER 7' "$(claimid "$L7")")" \
   "$(c 12 2026-10-11T09:10:00.000Z a5 'RUNNER 9' "$(claimid "$L9")")"
eq "another runner's step-back never retires a claim" "$(decideS "$L9")" "$(printf 'LOSE\tRUNNER 3')"
mk "$(c 10 2026-10-11T09:00:00.000Z a2 'RUNNER 3' "$(claimid "$L3")")" \
   "$(c 11 2026-10-11T09:02:00.000Z a2 'RUNNER 3' "$(stepback "$L3")")" \
   "$(c 12 2026-10-11T09:10:00.000Z a5 'RUNNER 9' "$(claimid "$L9")")"
eq "a step-back retires its own runner's claims for any reader" "$(decideS "$L9")" WIN
mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 15' "$(claimid '15)')")" \
   "$(c 11 2026-10-11T10:00:09.000Z a2 'RUNNER 5' "$(claimid '5)')")"
eq "claim ids compare exactly, so 5) never matches 15)" "$(decideS '5)')" "$(printf 'LOSE\tRUNNER 15')"
mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 7' "$(oldclaim "$L7")")" \
   "$(c 11 2026-10-11T09:02:00.000Z a2 'RUNNER 3' "$(stepback "" "$L3")")" \
   "$(c 12 2026-10-11T09:10:00.000Z a5 'RUNNER 9' "$(oldclaim "$L9")")"
eq "a legacy step-back never retires another runner's claim" "$(decideS "$L9" "$L9")" "$(printf 'LOSE\tRUNNER 7')"

# Full flow with stubs.
cat > "$D/vcc" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
if [ "$1 $2" = "activity add" ] && [[ "$4" == Takeover:* ]] && [ -n "${FAKE_HANDOFF_FAIL:-}" ]; then exit 1; fi
if [ "$1 $2" = "task assign" ] && [ -n "${FAKE_ASSIGN_FAIL:-}" ]; then exit 1; fi
if [ "$1 $2" = "task assign" ] && [ -n "${FAKE_NOT_MEMBER:-}" ]; then echo "Agent is not a member of this board" >&2; exit 1; fi
if [ "$1 $2" = "activity add" ] && [ -n "${FAKE_SHARED_ACTIVITY:-}" ]; then
  jq --arg id "new-activity-$(jq '.activities | length' "$FAKE_AGENT_LOG")" --arg text "$4" --arg now "$(date -u +%FT%TZ)" '.activities += [{id:$id,createdAt:$now,agentId:"a2",agentName:"RUNNER 3",text:$text}]' "$FAKE_AGENT_LOG" > "$FAKE_AGENT_LOG.next"
  mv "$FAKE_AGENT_LOG.next" "$FAKE_AGENT_LOG"
  jq -r '.activities[-1].id' "$FAKE_AGENT_LOG"
fi
if [ "$1 $2" = "activity last" ]; then
  [ -z "${FAKE_ACTIVITY_FAIL:-}" ] || exit 1
  if [ -n "${FAKE_SHARED_ACTIVITY:-}" ]; then
    jq -r '.activities | max_by(.createdAt) | [.createdAt, .agentName] | @tsv' "$FAKE_AGENT_LOG"; exit
  fi
  [ -z "${FAKE_ACTIVITY:-}" ] || printf '%s\tx\n' "$FAKE_ACTIVITY"
fi
exit 0
EOF
cat > "$D/hypertask" <<'EOF'
#!/usr/bin/env bash
if [ "$1 $2" = "tasks get" ]; then [ -n "${FAKE_TASK:-}" ] && cat "$FAKE_TASK"; exit; fi
cat "$FAKE_COMMENTS"
EOF
cat > "$D/ht" <<'EOF'
#!/usr/bin/env bash
if [[ "$2" == /mcp/tasks\?* ]] && [ -n "${FAKE_RELATED:-}" ]; then cat "$FAKE_RELATED"; exit; fi
[[ "$1 $2" == 'GET /mcp/tasks/YPER4-999/agent-activity?limit=100'* || "$1 $2" == 'GET /mcp/tasks/YPER4-243/agent-activity?limit=100'* || "$1 $2" == 'GET /mcp/tasks/HYCI-30/agent-activity?limit=100'* ]] || exit 1
if [ -n "${FAKE_AGENT_LOG:-}" ]; then
  offset=0; [[ "$2" == *'&offset='* ]] && offset=${2##*&offset=}
  [ -z "${FAKE_REPEAT_ACTIVITY:-}" ] || offset=0
  jq --argjson offset "$offset" '.activities |= .[$offset:$offset+100]' "$FAKE_AGENT_LOG"
else echo '{"success":true,"activities":[]}'; fi
EOF
chmod +x "$D/vcc" "$D/hypertask" "$D/ht"
export SHIP_CLAIM_HT=$D/ht
export FAKE_LOG=$D/log FAKE_COMMENTS=$D/c.json SHIP_CLAIM_VCC=$D/vcc SHIP_CLAIM_HYPERTASK=$D/hypertask SHIP_CLAIM_RESUME="claude --resume $ME"

mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claim $ME)")"
: > "$D/log"; out=$(./ship-claim YPER4-999); rc=$?
eq "flow step back exit code" "$rc" 3
[[ $out == *"Do NOT start work"* ]] && ok "flow step back message" || bad "message: $out"
grep -q '^task unassign YPER4-999 --self' "$D/log" && ok "flow unassigns self" || bad "no unassign"
grep -q 'Stepping back: RUNNER 7 claimed this first' "$D/log" && ok "flow posts step-back note" || bad "no note"
grep -q '^activity add YPER4-999 Claimed\.' "$D/log" && grep -q '^task assign YPER4-999 --self' "$D/log" && grep -q '^task move YPER4-999 --section In Progress' "$D/log" \
  && ok "flow claims in the agent log (assign, activity, move)" || bad "claim writes missing"

CLAIMKEY="claude --resume $ME"
mk "$(c 11 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claimid "$CLAIMKEY")")"
: > "$D/log"; ./ship-claim YPER4-999 >/dev/null; eq "flow: claim id finds its own claim" "$?" 0
grep -qF "Claim id: [$CLAIMKEY]" "$D/log" && ok "flow claim carries its claim id" || bad "claim id missing from claim text"

mk
jq -n --arg text "$(claim "$ME")" '{success:true,activities:[{id:"bbbb-uuid",createdAt:"2026-10-11T10:00:09.000Z",agentId:"a2",agentName:"RUNNER 3",text:$text}]}' > "$D/activities.json"
FAKE_AGENT_LOG=$D/activities.json ./ship-claim YPER4-999 >/dev/null; eq "flow: our claim only in log -> proceed" "$?" 0
jq --arg text "$(claim other-sess)" '.activities += [{id:"aaaa-uuid",createdAt:"2026-10-11T10:00:00.000Z",agentId:"a1",agentName:"RUNNER 7",text:$text}]' "$D/activities.json" > "$D/earlier.json"
FAKE_AGENT_LOG=$D/earlier.json ./ship-claim YPER4-999 >/dev/null; eq "flow: earlier other log claim -> step back" "$?" 3
jq '.activities |= map(.createdAt = "2026-10-11T10:00:09.000Z")' "$D/earlier.json" > "$D/tie.json"
FAKE_AGENT_LOG=$D/tie.json ./ship-claim YPER4-999 >/dev/null; eq "flow: UUID tie uses id string -> step back" "$?" 3
jq '.activities += [{id:"cccc-uuid",createdAt:"2026-10-11T10:00:05.000Z",agentId:"a1",agentName:"RUNNER 7",text:"Handed over: RUNNER 7 released this ticket."}]' "$D/earlier.json" > "$D/released.json"
FAKE_AGENT_LOG=$D/released.json ./ship-claim YPER4-999 >/dev/null; eq "flow: earlier log claim released in the log -> proceed" "$?" 0
jq --arg text "$(claim other-sess)" '.activities = [.activities[0]] + [range(100) | {id:("heartbeat-" + tostring),createdAt:"2026-10-11T10:00:08.000Z",agentId:"a1",agentName:"RUNNER 7",text:"Working."}] + [{id:"older-claim",createdAt:"2026-10-11T10:00:00.000Z",agentId:"a1",agentName:"RUNNER 7",text:$text}]' "$D/activities.json" > "$D/paged.json"
FAKE_AGENT_LOG=$D/paged.json ./ship-claim YPER4-999 >/dev/null; eq "flow: competing claim beyond 100 activities -> step back" "$?" 3
out=$(FAKE_REPEAT_ACTIVITY=1 FAKE_AGENT_LOG=$D/paged.json ./ship-claim YPER4-999 2>&1); rc=$?
eq "flow: repeated activity page refuses ownership" "$rc" 2
[[ $out == *'cannot read complete agent log'* ]] && ok "repeated page names incomplete history" || bad "repeated page error: $out"
if [ "$fails" = 0 ]; then echo "ship-claim log-claim ok"; fi

# Failed membership must not publish any claim or move.
: > "$D/log"
out=$(FAKE_ASSIGN_FAIL=1 ./ship-claim YPER4-999 2>&1); rc=$?
eq "assignment failure stops the claim" "$rc" 2
if grep -qE '^(comment|activity) add |^task move ' "$D/log"; then bad "failed assignment published a claim"; else ok "failed assignment leaves comments and log untouched"; fi

# A CI ticket (HYCI) claims in one command when the board accepts the member.
mk "$(c 12 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
: > "$D/log"; out=$(./ship-claim HYCI-30); rc=$?
eq "CI ticket claim in one command" "$rc" 0
grep -q '^task assign HYCI-30 --self' "$D/log" && grep -q '^task move HYCI-30 --section In Progress' "$D/log" \
  && ok "CI ticket claims through the same steps" || bad "CI claim wrote nothing"

# The read-only hold check reads a CI ticket too.
out=$(SHIP_CLAIM_GH=$D/hold-gh HOLD_OPEN='[]' SHIP_CLAIM_HYPERTASK=$D/hold-ht HOLD_BOARD=$D/board.json ./ship-claim hold HYCI-30 2>&1); rc=$?
[[ $out != *'usage: ship-claim hold'* ]] && ok "hold reads a CI ticket" || bad "hold refused a CI ticket: $out"

# A board that refuses the member names the board and the member, and writes nothing else.
mk
: > "$D/log"; out=$(FAKE_NOT_MEMBER=1 ./ship-claim HYCI-30 2>&1); rc=$?
eq "member refusal stops the claim" "$rc" 4
[[ $out == *'board 11514 (Hypertask CI)'* && $out == *'does not list member'* ]] \
  && ok "refusal names the board and the missing member" || bad "unclear refusal: $out"
grep -qE '^(comment|activity) add |^task move ' "$D/log" && bad "member refusal published a claim" || ok "member refusal writes nothing"

# Hand-over replay through the full flow (task read via the stub).
cp fixtures/ship-claim-y243-comments.json "$D/c.json"
SHIP_CLAIM_RESUME="claude --resume $R8" FAKE_TASK=$PWD/fixtures/ship-claim-y243-task.json ./ship-claim YPER4-243 >/dev/null; eq "flow: Y243 replay -> proceed" "$?" 0
SHIP_CLAIM_RESUME="claude --resume $R8" ./ship-claim YPER4-243 >/dev/null; eq "flow: Y243 replay, task read fails -> still proceeds (hand-over)" "$?" 0

mk "$(c 10 2026-10-11T09:00:00.000Z a1 'RUNNER 2' "$(claim other-sess)")" \
   "$(c 11 2026-10-11T09:10:00.000Z a1 'RUNNER 2' '<p>Question: <strong>Add the four new models?</strong></p>')" \
   "$(c 12 2026-10-11T09:30:00.000Z a1 'RUNNER 2' '<p>Handed over to RUNNER 3.</p>')" \
   "$(c 13 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
: > "$D/log"; out=$(./ship-claim YPER4-999); rc=$?
eq "takeover with existing question succeeds" "$rc" 0
[[ $out == *'https://app.hypertask.ai/detail/project-4060/999#comment-11'* && $out == *'Add the four new models?'* ]] \
  && ok "takeover shows original question and link" || bad "takeover omitted existing question: $out"
grep -q '^activity add YPER4-999 Takeover:.*comment-11' "$D/log" \
  && ok "takeover records question handoff in agent lane" || bad "takeover handoff missing"
eq "takeover creates no people comments" "$(grep -c '^comment add ' "$D/log")" 0
grep -q 'comment update\|--kind question' "$D/log" && bad "takeover changed or repeated the question" || ok "takeover leaves original question unchanged"
out=$(FAKE_HANDOFF_FAIL=1 ./ship-claim YPER4-999 2>&1); rc=$?
eq "failed takeover handoff stops work" "$rc" 2
[[ $out == *'takeover handoff failed'* && $out != *'Start work.'* ]] \
  && ok "failed handoff never authorizes work" || bad "handoff failure output: $out"
printf '{"tasks":[{"projectId":42}]}' > "$D/takeover-task.json"
out=$(FAKE_TASK=$D/takeover-task.json ./ship-claim YPER4-999)
[[ $out == *'https://app.hypertask.ai/detail/project-42/999#comment-11'* ]] \
  && ok "takeover uses the board returned by the API" || bad "wrong question board: $out"

# Old competing claim in the full flow: activity decides.
mk "$(c 10 2026-10-11T00:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
FAKE_ACTIVITY=$(date -u -d '-1 hour' +%FT%TZ) ./ship-claim YPER4-999 >/dev/null; eq "flow: old claim with recent activity -> step back" "$?" 3
FAKE_ACTIVITY=$(date -u -d '-9 hours' +%FT%TZ) ./ship-claim YPER4-999 >/dev/null; eq "flow: old claim, idle claimant -> proceed" "$?" 0
FAKE_ACTIVITY_FAIL=1 ./ship-claim YPER4-999 >/dev/null; eq "flow: activity read failure -> step back" "$?" 3
for age in 9 1; do
  mk
  jq -n --arg old "$(date -u -d '-10 hours' +%FT%TZ)" --arg last "$(date -u -d "-$age hours" +%FT%TZ)" --arg text "$(claim other-sess)" '{success:true,activities:[{id:"old-claim",createdAt:$old,agentId:"a2",agentName:"RUNNER 3",text:$text},{id:"heartbeat",createdAt:$last,agentId:"a2",agentName:"RUNNER 3",text:"Working."}]}' > "$D/shared.json"
  : > "$D/log"
  FAKE_SHARED_ACTIVITY=1 FAKE_AGENT_LOG=$D/shared.json ./ship-claim YPER4-999 >/dev/null 2>&1; rc=$?
  if [ "$age" = 9 ]; then
    eq "flow: own new claim does not revive an idle shared session" "$rc" 0
    FAKE_SHARED_ACTIVITY=1 FAKE_AGENT_LOG=$D/shared.json ./ship-claim YPER4-999 >/dev/null 2>&1
    eq "flow: retry claims do not revive an idle shared session" "$?" 0
    jq -e '.activities | any(.[]; .text | startswith("Takeover:"))' "$D/shared.json" >/dev/null \
      && ok "flow: takeover records persist across retries" || bad "takeover record not persisted"
  else
    eq "flow: active shared session remains protected" "$rc" 3
    FAKE_SHARED_ACTIVITY=1 FAKE_AGENT_LOG=$D/shared.json ./ship-claim YPER4-999 >/dev/null 2>&1
    eq "flow: retries still protect an active shared session" "$?" 3
    jq -e '.activities | any(.[]; .text | startswith("Stepping back:"))' "$D/shared.json" >/dev/null \
      && ok "flow: step-back records persist across retries" || bad "step-back record not persisted"
    jq --arg last "$(date -u -d '-9 hours' +%FT%TZ)" '(.activities[] | select(.id == "heartbeat").createdAt) = $last' "$D/shared.json" > "$D/shared.next"
    mv "$D/shared.next" "$D/shared.json"
    FAKE_SHARED_ACTIVITY=1 FAKE_AGENT_LOG=$D/shared.json ./ship-claim YPER4-999 >/dev/null 2>&1
    eq "flow: own step-backs do not revive a now-idle shared session" "$?" 0
  fi
  grep -q unassign "$D/log" && bad "shared identity recovery called unassign" || ok "shared identity recovery preserves assignment"
done

# Same agent identity, different session: lose without unassigning.
mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claim $ME)")"
: > "$D/log"; ./ship-claim YPER4-999 >/dev/null 2>&1; eq "flow: same-agent loss exits 3" "$?" 3
grep -q unassign "$D/log" && bad "same-agent loss called unassign" || ok "same-agent loss does not unassign"
grep -q 'Stepping back' "$D/log" && ok "same-agent loss still posts the note" || bad "no note"
mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
: > "$D/log"; out=$(./ship-claim YPER4-999); rc=$?
eq "flow winner exit code" "$rc" 0
grep -q unassign "$D/log" && bad "winner unassigned" || ok "winner stays assigned"

mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(oldclaim 'codex resume argsess')")"
unset SHIP_CLAIM_RESUME; : > "$D/log"; ./ship-claim YPER4-999 "codex resume argsess" >/dev/null; eq "resume command as 2nd argument" "$?" 0
grep -q 'codex resume argsess' "$D/log" && ok "argument lands in the claim comment" || bad "argument missing in comment"
env -u CLAUDE_CODE_SESSION_ID -u CODEX_SESSION_ID -u CODEX_THREAD_ID ./ship-claim YPER4-999 >/dev/null 2>"$D/err"; eq "no resume id anywhere -> exit 2" "$?" 2
grep -q 'pass the resume command' "$D/err" && ok "clear error names the argument" || bad "error text"
./ship-claim bogus >/dev/null 2>&1; eq "bad ticket -> exit 2" "$?" 2


jq -n '{success:true,tasks:[{id:8020,ticketNumber:"HTPR-8020",projectId:15,status:"Normal",labels:[{name:"Error Log"}],description:"<p>Routes: /api/mcp/projects</p><p>First seen: 2026-10-26T08:55:00Z</p><p>Error root: /api/mcp/projects | prisma-validation:project:unknown-argument:updatedAt</p>"}]}' > "$D/alert.json"
jq '.tasks[0].id=8019 | .tasks[0].ticketNumber="HTPR-8019" | .total=1' "$D/alert.json" > "$D/related.json"
: > "$D/log"
FAKE_TASK="$D/alert.json" FAKE_RELATED="$D/related.json" ./ship-claim HTPR-8020 "codex resume argsess" > "$D/related-out"
eq "related open root stops a second claim" "$?" 3
[ ! -s "$D/log" ] && ok "related alert check runs before all board writes" || bad "related alert wrote a claim"
grep -q 'https://app.hypertask.ai/detail/project-15/8019' "$D/related-out" && ok "related alert names the existing full link" || bad "missing related link"

jq '.tasks[0].id=8022 | .tasks[0].ticketNumber="HTPR-8022"' "$D/related.json" > "$D/later.json"
FAKE_RELATED="$D/later.json" node ./error-collector/claim-incident.mjs < "$D/alert.json" > "$D/canonical-out"
eq "earliest root remains claimable with a later duplicate" "$?" 0

cat > "$D/hold-gh" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "$HOLD_READS"
case " $* " in
  *' --state open '*) [ -z "${HOLD_OPEN_FAIL:-}" ] || exit 1; cat "$HOLD_OPEN" ;;
  *' --state merged '*) [ -z "${HOLD_MERGED_FAIL:-}" ] || exit 1; cat "$HOLD_MERGED" ;;
  *) exit 1 ;;
esac
EOF
cat > "$D/hold-ht" <<'EOF'
#!/usr/bin/env bash
if [ "$1 $2" = 'tasks list' ] && [[ " $* " != *' --status '* ]]; then
  project=15; [[ " $* " == *' --project 4060 '* ]] && project=4060
  jq --argjson project "$project" '[.tasks[] | select(.projectId == $project) | .labels = (.labels // [])] | {success:true,total:length,tasks:.}' "$HOLD_BOARD"
  exit
fi
if [ "$1 $2" = 'tasks get' ] && [ "$3" = 'YPER4-999' ]; then
  printf '{"success":true,"tasks":[{"ticketNumber":"YPER4-999","projectId":4060,"section":"Todo","labels":[],"assignees":[]}]}'
  exit
fi
if [ "$1 $2" != 'tasks list' ]; then exec "$HOLD_ORIGINAL_HT" "$@"; fi
printf '%s\n' "$*" >> "$HOLD_READS"
[ -z "${HOLD_BOARD_FAIL:-}" ] || exit 1
if [[ " $* " == *' --project 4060 '* ]] && [ -n "${HOLD_INFRA:-}" ]; then cat "$HOLD_INFRA"; exit; fi
if [[ " $* " == *' --offset 100 '* ]]; then cat "$HOLD_BOARD_PAGE2"; else cat "$HOLD_BOARD"; fi
EOF
chmod +x "$D/hold-gh" "$D/hold-ht"
export RUNNER_INBOX_DIR=$D/inbox
export HOLD_READS=$D/hold-reads HOLD_OPEN=$D/open.json HOLD_MERGED=$D/merged.json HOLD_BOARD=$D/board.json HOLD_BOARD_PAGE2=$D/page2.json HOLD_ORIGINAL_HT=$D/hypertask
export SHIP_CLAIM_GH=$D/hold-gh SHIP_CLAIM_HYPERTASK=$D/hold-ht SHIP_CLAIM_RESUME="claude --resume $ME"
mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 6' "$(claim $ME)")"
printf '[]' > "$HOLD_OPEN"
printf '[{"number":42,"title":"HTPR-123 [BUGFIX] Existing work"}]' > "$HOLD_MERGED"
jq -n '{success:true,total:1,tasks:[{ticketNumber:"HTPR-123",projectId:15,uniqueIndex:123,section:"QA",assignees:[{agent:{id:"r6",displayName:"Runner 6"}}]}]}' > "$HOLD_BOARD"
: > "$D/log"; out=$(SHIP_SESSION_NAME='RUNNER 6' ./ship-claim YPER4-999 2>&1); rc=$?
eq "merged but not Done refuses a new claim" "$rc" 4
[[ $out == *'https://app.hypertask.ai/detail/project-15/123'* && $out == *'live QA'* && $out == *'Done'* ]] && ok "hold names unfinished ticket and next step" || bad "unclear hold: $out"
[ ! -s "$D/log" ] && ok "completion hold runs before every board write" || bad "hold allowed a board write"
for section in 'In Progress' 'AI Review'; do
  jq --arg s "$section" '.tasks[0].section=$s' "$HOLD_BOARD" > "$D/next"; mv "$D/next" "$HOLD_BOARD"
  SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null; eq "merged $section work holds" "$?" 4
done
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold HTPR-123 >/dev/null; eq "resuming the unfinished ticket stays allowed" "$?" 0
jq '.tasks += [.tasks[0] | .ticketNumber="HTPR-124" | .uniqueIndex=124] | .total=2' "$HOLD_BOARD" > "$D/next"; mv "$D/next" "$HOLD_BOARD"
printf '[{"number":42,"title":"HTPR-123 [BUGFIX] Existing work"},{"number":43,"title":"HTPR-124 [BUGFIX] Other unfinished work"}]' > "$HOLD_MERGED"
for ticket in HTPR-123 HTPR-124; do
  SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold "$ticket" >/dev/null; eq "resuming $ticket succeeds despite other unfinished merged work" "$?" 0
done
: > "$D/log"; SHIP_SESSION_NAME='RUNNER 6' ./ship-claim YPER4-999 >/dev/null; eq "two unfinished merged tickets still hold new claims" "$?" 4
[ ! -s "$D/log" ] && ok "multiple unfinished tickets prevent new claim writes" || bad "multiple unfinished tickets wrote a claim"
printf '[{"number":99,"headRefName":"runner6/htpr-456","title":"HTPR-456 [BUGFIX] Open work","isDraft":false}]' > "$HOLD_OPEN"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold HTPR-456 >/dev/null; eq "open PR resumption survives other merged work" "$?" 0
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold HTPR-123 >/dev/null; eq "merged work resumption survives another open PR" "$?" 0
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null; eq "mixed open and merged work still holds new claims" "$?" 4
printf '[]' > "$HOLD_OPEN"
jq '.tasks=[.tasks[0]] | .total=1' "$HOLD_BOARD" > "$D/next"; mv "$D/next" "$HOLD_BOARD"
printf '[{"number":42,"title":"HTPR-123 [BUGFIX] Existing work"}]' > "$HOLD_MERGED"
for section in Done 'Flag: Everyone' 'Flag: Only Me + QA' 'Flag: Off'; do
  jq --arg s "$section" '.tasks[0].section=$s' "$HOLD_BOARD" > "$D/next"; mv "$D/next" "$HOLD_BOARD"
  SHIP_SESSION_NAME='RUNNER 6' ./ship-claim YPER4-999 >/dev/null; eq "settled $section work permits the next claim" "$?" 0
done
jq -e '.["6"]["YPER4-999"].admission == true' "$RUNNER_INBOX_DIR/domain-ownership.json" >/dev/null && ok "unassigned fake claim retains reservation" || bad "fake claim lost reservation"
export RUNNER_INBOX_DIR=$D/inbox-later
jq '.tasks[0].section="QA" | .tasks[0].assignees[0].agent.displayName="Runner 16"' "$HOLD_BOARD" > "$D/next"; mv "$D/next" "$HOLD_BOARD"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null; eq "another runner never holds this runner" "$?" 0
jq '.tasks[0].assignees[0].agent.displayName="RUNNER 6"' "$HOLD_BOARD" > "$D/next"; mv "$D/next" "$HOLD_BOARD"
printf '[]' > "$HOLD_MERGED"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null; eq "unmerged assigned task does not create a completion hold" "$?" 0
printf '[{"number":43,"title":"HTPR-1234 [BUGFIX] Different ticket"}]' > "$HOLD_MERGED"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null; eq "merged title must match the entire ticket number" "$?" 0
printf '[{"number":42,"title":"HTPR-123 [BUGFIX] Existing work"}]' > "$HOLD_MERGED"
for failure in HOLD_OPEN_FAIL HOLD_BOARD_FAIL HOLD_MERGED_FAIL; do
  : > "$D/log"; env SHIP_SESSION_NAME='RUNNER 6' "$failure=1" ./ship-claim YPER4-999 >/dev/null 2>&1
  eq "$failure refuses the claim" "$?" 4
  [ ! -s "$D/log" ] && ok "$failure refuses before board writes" || bad "$failure wrote to board"
done
cp "$HOLD_BOARD" "$D/valid-board"; cp "$HOLD_OPEN" "$D/valid-open"; cp "$HOLD_MERGED" "$D/valid-merged"
for file in "$HOLD_BOARD" "$HOLD_OPEN" "$HOLD_MERGED"; do
  printf '{}' > "$file"
  SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null 2>&1; rc=$?; eq "malformed $(basename "$file") refuses" "$rc" 4
  cp "$D/valid-board" "$HOLD_BOARD"; cp "$D/valid-open" "$HOLD_OPEN"; cp "$D/valid-merged" "$HOLD_MERGED"
done
jq '.total=101 | .tasks=[range(100) | {ticketNumber:("HTPR-"+(.+1000|tostring)),section:"Done",assignees:[]}]' "$HOLD_BOARD" > "$D/next"; mv "$D/next" "$HOLD_BOARD"
jq '.tasks[0].projectId=4060 | .tasks[0].ticketNumber="YPER4-123" | .tasks[0].uniqueIndex=123 | .total=101' "$D/valid-board" > "$HOLD_BOARD_PAGE2"
printf '[{"number":42,"title":"YPER4-123 [INFRA] Existing work"}]' > "$HOLD_MERGED"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null; eq "unfinished work on a later board page still holds" "$?" 4
printf '{"success":true,"total":101,"tasks":[]}' > "$HOLD_BOARD_PAGE2"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null 2>&1; eq "truncated board page refuses" "$?" 4
cp "$D/valid-board" "$HOLD_BOARD"
jq '.total=101' "$HOLD_BOARD" > "$D/next"; mv "$D/next" "$HOLD_BOARD"
jq '.total=101' "$HOLD_BOARD" > "$HOLD_BOARD_PAGE2"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null 2>&1; eq "duplicate tickets during paging refuse" "$?" 4
jq '.total=100' "$HOLD_BOARD_PAGE2" > "$D/next"; mv "$D/next" "$HOLD_BOARD_PAGE2"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null 2>&1; eq "changed total during paging refuses" "$?" 4
printf '{"success":true,"total":0,"tasks":[]}' > "$HOLD_BOARD"
jq '.tasks[0].projectId=4060 | .tasks[0].ticketNumber="YPER4-123"' "$D/valid-board" > "$D/infra.json"
HOLD_INFRA=$D/infra.json SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null; eq "merged work on board 4060 also holds" "$?" 4
cp "$D/valid-board" "$HOLD_BOARD"
jq '.tasks[0].projectId=null' "$HOLD_BOARD" > "$D/next"; mv "$D/next" "$HOLD_BOARD"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null 2>&1; eq "unusable assigned ticket link refuses" "$?" 4
cp "$D/valid-board" "$HOLD_BOARD"
jq '[range(300)|{number:.,headRefName:"other/work",title:"Other work",isDraft:false}]' -n > "$HOLD_OPEN"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null 2>&1; eq "saturated open PR list refuses" "$?" 4
printf '[]' > "$HOLD_OPEN"
jq '[range(100)|{number:.,title:"Other work"}]' -n > "$HOLD_MERGED"
SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-999 >/dev/null 2>&1; eq "saturated merged PR list refuses" "$?" 4
printf '[{"number":42,"title":"HTPR-123 [BUGFIX] Existing work"}]' > "$HOLD_MERGED"
printf '[{"number":99,"headRefName":"runner6/htpr-456","title":"HTPR-456 [BUGFIX] Open work","isDraft":false}]' > "$HOLD_OPEN"
: > "$D/log"; out=$(SHIP_SESSION_NAME='RUNNER 6' ./ship-claim YPER4-999); rc=$?; eq "existing open-PR hold is preserved" "$rc" 4
[[ $out == *'still has open PRs'* && $out == *'/pull/99'* ]] && ok "open-PR hold still names its PR" || bad "wrong open-PR refusal: $out"
[ ! -s "$D/log" ] && ok "open-PR hold still precedes board writes" || bad "open-PR hold wrote to board"
printf '[{"number":99,"headRefName":"runner6/yper4-999","title":"YPER4-999 [INFRA] Existing open work","isDraft":false}]' > "$HOLD_OPEN"
: > "$D/log"; SHIP_SESSION_NAME='RUNNER 6' ./ship-claim YPER4-999 >/dev/null; eq "actual claim dispatch resumes an open PR despite merged work" "$?" 0
jq -e '.["6"]["HTPR-123"].protected == true' "$RUNNER_INBOX_DIR/domain-ownership.json" >/dev/null && ok "uppercase Runner 6 assignment imported" || bad "uppercase assignment not imported"
grep -q '^task move YPER4-999 --section In Progress' "$D/log" && ok "recognized open work reaches the claim move" || bad "open resumption failed to write"
printf '[]' > "$HOLD_OPEN"
jq '.tasks += [.tasks[0] | .ticketNumber="YPER4-999" | .projectId=4060 | .uniqueIndex=999] | .total=2' "$HOLD_BOARD" > "$D/next"; mv "$D/next" "$HOLD_BOARD"
printf '[{"number":42,"title":"HTPR-123 [BUGFIX] Existing work"},{"number":99,"title":"YPER4-999 [INFRA] Existing merged work"}]' > "$HOLD_MERGED"
: > "$D/log"; SHIP_SESSION_NAME='RUNNER 6' ./ship-claim YPER4-999 >/dev/null; eq "actual claim dispatch resumes merged work despite another unfinished ticket" "$?" 0
grep -q '^task move YPER4-999 --section In Progress' "$D/log" && ok "recognized merged work reaches the claim move" || bad "merged resumption failed to write"
: > "$HOLD_READS"; SHIP_SESSION_NAME='HT Product Lead' ./ship-claim hold YPER4-999 >/dev/null; eq "non-runner identity remains unaffected" "$?" 0
[ ! -s "$HOLD_READS" ] && ok "non-runner performs no hold reads" || bad "non-runner accessed hold services"
if [ "$fails" = 0 ]; then echo 'ship-claim completion-hold ok'; fi

# Queue brake and infra first (YPER4-880), on the same hold stubs.
export HOLD_INFRA=$D/infra.json
prs() { jq -n --argjson n "$1" --argjson d "${2:-0}" \
  '[range($n) | {number: ., headRefName: "cursor/x\(.)", title: "X \(.)", isDraft: (. < $d)}]' > "$HOLD_OPEN"; }
prs_own() { jq -n --argjson n "$1" --arg own "$2" --arg tk "$3" \
  '[range($n) | {number: ., headRefName: "cursor/x\(.)", title: "X \(.)", isDraft: false}]
   + [{number: 999, headRefName: $own, title: "\($tk) [INFRA] own open work", isDraft: false}]' > "$HOLD_OPEN"; }
free_infra() { jq -n --arg tk "$1" --arg ti "$2" \
  '{success:true,total:1,tasks:[{ticketNumber:$tk,title:$ti,section:"Backlog",projectId:4060,uniqueIndex:1,agent:null,assignees:[]}]}' > "$HOLD_INFRA"; }
empty_infra() { printf '{"success":true,"total":0,"tasks":[]}' > "$HOLD_INFRA"; }
prs_adopt() { jq -n --argjson n "$1" --arg tk "$2" \
  '[range($n) | {number: ., headRefName: "cursor/x\(.)", title: "X \(.)", isDraft: false}]
   + [{number: 999, headRefName: ("cursor/" + ($tk | ascii_downcase) + "-adopt"), title: "\($tk) [BUGFIX] Adopted work", isDraft: false}]' > "$HOLD_OPEN"; }
holdrc() { SHIP_SESSION_NAME="$1" ./ship-claim hold "$2" >"$D/hold-out" 2>&1; echo $?; }
printf '{"success":true,"total":0,"tasks":[]}' > "$HOLD_BOARD"; printf '[]' > "$HOLD_MERGED"; printf '[]' > "$HOLD_OPEN"
empty_infra
printf '[{"number":98,"headRefName":"ci-runner-6/yper4-777","title":"YPER4-777 [INFRA] CI work","isDraft":false}]' > "$HOLD_OPEN"
eq "CI team branch never holds this runner" "$(holdrc 'RUNNER 6' HTPR-1)" 0
printf '[{"number":99,"headRefName":"runner6/htpr-456","title":"HTPR-456 [BUGFIX] Open work","isDraft":false},{"number":98,"headRefName":"ci-runner-6/yper4-777","title":"YPER4-777 [INFRA] CI work","isDraft":false}]' > "$HOLD_OPEN"
eq "own branch still holds beside a CI team branch" "$(holdrc 'RUNNER 6' HTPR-1)" 4
prs 5;  eq "queue 5, app ticket -> normal" "$(holdrc 'RUNNER 6' HTPR-1)" 0
prs 20; eq "queue exactly 20 -> normal" "$(holdrc 'RUNNER 6' HTPR-1)" 0
prs 21; eq "queue 21, app ticket -> hold" "$(holdrc 'RUNNER 6' HTPR-1)" 4
grep -q 'queue full: infra only (21 open non-draft PRs > 20)' "$D/hold-out" && ok "queue brake message" || bad "queue brake message: $(cat "$D/hold-out")"
prs 21; eq "queue 21, YPER4 ticket -> allowed" "$(holdrc 'RUNNER 6' YPER4-2)" 0
prs 25 10; eq "drafts do not count toward the brake" "$(holdrc 'RUNNER 6' HTPR-1)" 0
prs 21; eq "no runner name -> no brake" "$(SHIP_SESSION_NAME= ./ship-claim hold HTPR-1 >/dev/null 2>&1; echo $?)" 0
prs 5; free_infra YPER4-4 free
eq "free infra ticket waits -> app hold" "$(holdrc 'RUNNER 6' HTPR-1)" 4
grep -q 'infra first: free Fleet Infra tickets wait (YPER4-4)' "$D/hold-out" && ok "infra first names the ticket" || bad "infra first message: $(cat "$D/hold-out")"
eq "free infra ticket waits -> that YPER4 ticket allowed" "$(holdrc 'RUNNER 6' YPER4-4)" 0
prs 5; free_infra YPER4-5 'do not touch: held by valentin'
eq "'do not touch' Backlog ticket never blocks an app claim" "$(holdrc 'RUNNER 6' HTPR-1)" 0
free_infra YPER4-6 'held'; jq '.tasks[0].agent={id:"a1"}' "$HOLD_INFRA" > "$D/next"; mv "$D/next" "$HOLD_INFRA"
eq "assigned Backlog infra ticket never blocks an app claim" "$(holdrc 'RUNNER 6' HTPR-1)" 0
free_infra YPER4-7 'assigned to an agent assignee'; jq '.tasks[0].assignees=[{agent:{id:"a1",displayName:"Runner 16"}}]' "$HOLD_INFRA" > "$D/next"; mv "$D/next" "$HOLD_INFRA"
eq "agent-assigned Backlog infra ticket never blocks an app claim" "$(holdrc 'RUNNER 6' HTPR-1)" 0
prs 5; empty_infra
cat > "$D/ht4060fail" <<'EOF'
#!/usr/bin/env bash
case " $* " in *' --project 4060 '*) exit 1 ;; esac
exec "$HOLD_ORIGINAL_HT" "$@"
EOF
chmod +x "$D/ht4060fail"
eq "board 4060 read fails -> app hold" "$(SHIP_CLAIM_HYPERTASK=$D/ht4060fail SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold HTPR-1 >/dev/null 2>&1; echo $?)" 4
eq "board 4060 read fails -> every claim held" "$(SHIP_CLAIM_HYPERTASK=$D/ht4060fail SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-2 >/dev/null 2>&1; echo $?)" 4
prs 5; eq "PR read fails -> hold" "$(HOLD_OPEN_FAIL=1 SHIP_SESSION_NAME='RUNNER 6' ./ship-claim hold YPER4-2 >/dev/null 2>&1; echo $?)" 4
prs_own 21 runner6/htpr-7-x HTPR-7
eq "own open app PR ticket, queue full -> allowed" "$(holdrc 'RUNNER 6' HTPR-7)" 0
eq "own open app PR, other app ticket -> hold" "$(holdrc 'RUNNER 6' HTPR-8)" 4
prs_own 5 runner6/yper4-9 YPER4-9
eq "own open PR, other YPER4 ticket -> hold" "$(holdrc 'RUNNER 6' YPER4-2)" 4
eq "own open PR ticket itself -> allowed" "$(holdrc 'RUNNER 6' YPER4-9)" 0
prs_adopt 21 HTPR-3
eq "queue full, ticket with an open PR -> adoption allowed" "$(holdrc 'RUNNER 6' HTPR-3)" 0
eq "queue full, different app ticket -> still held" "$(holdrc 'RUNNER 6' HTPR-4)" 4
free_infra YPER4-4 free; prs_adopt 5 HTPR-3
eq "free infra waits, ticket with an open PR -> adoption allowed" "$(holdrc 'RUNNER 6' HTPR-3)" 0
prs 5; empty_infra
prs_own 5 runner16/htpr-7-x HTPR-7
eq "runner 1 never matches runner 16 branch names" "$(holdrc 'RUNNER 1' HTPR-1)" 0
eq "runner 16 own PR holds runner 16" "$(holdrc 'RUNNER 16' HTPR-1)" 4
printf '[]' > "$HOLD_OPEN"; empty_infra

echo "$passes passed, $fails failed"; [ "$fails" = 0 ]
