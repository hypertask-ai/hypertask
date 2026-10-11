#!/usr/bin/env bash
# Offline tests for ship-claim (YPER4-264): decision from saved comments, and the full flow with stub vcc/hypertask.
cd "$(dirname "$0")" || exit 1
fails=0; passes=0
ok() { echo "ok   $*"; passes=$((passes+1)); }; bad() { echo "FAIL $*"; fails=$((fails+1)); }
eq() { [ "$2" = "$3" ] && ok "$1" || bad "$1 (want '$3' got '$2')"; }
D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
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

# Full flow with stubs.
cat > "$D/vcc" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
if [ "$1 $2" = "activity last" ]; then
  [ -z "${FAKE_ACTIVITY_FAIL:-}" ] || exit 1
  [ -z "${FAKE_ACTIVITY:-}" ] || printf '%s\tx\n' "$FAKE_ACTIVITY"
fi
exit 0
EOF
cat > "$D/hypertask" <<'EOF'
#!/usr/bin/env bash
if [ "$1 $2" = "tasks get" ]; then [ -n "${FAKE_TASK:-}" ] && cat "$FAKE_TASK"; exit; fi
cat "$FAKE_COMMENTS"
EOF
chmod +x "$D/vcc" "$D/hypertask"
export FAKE_LOG=$D/log FAKE_COMMENTS=$D/c.json SHIP_CLAIM_VCC=$D/vcc SHIP_CLAIM_HYPERTASK=$D/hypertask SHIP_CLAIM_RESUME="claude --resume $ME"

mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claim $ME)")"
: > "$D/log"; out=$(./ship-claim YPER4-999); rc=$?
eq "flow step back exit code" "$rc" 3
[[ $out == *"Do NOT start work"* ]] && ok "flow step back message" || bad "message: $out"
grep -q '^task unassign YPER4-999 --self' "$D/log" && ok "flow unassigns self" || bad "no unassign"
grep -q 'Stepping back: RUNNER 7 claimed this first' "$D/log" && ok "flow posts step-back note" || bad "no note"
grep -q '^comment add YPER4-999 .*Claimed\.' "$D/log" && grep -q '^task assign YPER4-999 --self' "$D/log" && grep -q '^task move YPER4-999 --section In Progress' "$D/log" \
  && ok "flow claims first (comment, assign, move)" || bad "claim writes missing"

# Hand-over replay through the full flow (task read via the stub).
cp fixtures/ship-claim-y243-comments.json "$D/c.json"
SHIP_CLAIM_RESUME="claude --resume $R8" FAKE_TASK=$PWD/fixtures/ship-claim-y243-task.json ./ship-claim YPER4-243 >/dev/null; eq "flow: Y243 replay -> proceed" "$?" 0
SHIP_CLAIM_RESUME="claude --resume $R8" ./ship-claim YPER4-243 >/dev/null; eq "flow: Y243 replay, task read fails -> still proceeds (hand-over)" "$?" 0

# Old competing claim in the full flow: activity decides.
mk "$(c 10 2026-10-11T00:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
FAKE_ACTIVITY=$(date -u -d '-1 hour' +%FT%TZ) ./ship-claim YPER4-999 >/dev/null; eq "flow: old claim with recent activity -> step back" "$?" 3
FAKE_ACTIVITY=$(date -u -d '-9 hours' +%FT%TZ) ./ship-claim YPER4-999 >/dev/null; eq "flow: old claim, idle claimant -> proceed" "$?" 0
FAKE_ACTIVITY_FAIL=1 ./ship-claim YPER4-999 >/dev/null; eq "flow: activity read failure -> step back" "$?" 3
# Same agent identity, different session: lose without unassigning.
mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim other-sess)")" "$(c 11 2026-10-11T10:00:09.000Z a2 'RUNNER 3' "$(claim $ME)")"
: > "$D/log"; ./ship-claim YPER4-999 >/dev/null 2>&1; eq "flow: same-agent loss exits 3" "$?" 3
grep -q unassign "$D/log" && bad "same-agent loss called unassign" || ok "same-agent loss does not unassign"
grep -q 'Stepping back' "$D/log" && ok "same-agent loss still posts the note" || bad "no note"
mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
: > "$D/log"; out=$(./ship-claim YPER4-999); rc=$?
eq "flow winner exit code" "$rc" 0
grep -q unassign "$D/log" && bad "winner unassigned" || ok "winner stays assigned"

mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim argsess)")"
unset SHIP_CLAIM_RESUME; : > "$D/log"; ./ship-claim YPER4-999 "codex resume argsess" >/dev/null; eq "resume command as 2nd argument" "$?" 0
grep -q 'codex resume argsess' "$D/log" && ok "argument lands in the claim comment" || bad "argument missing in comment"
env -u CLAUDE_CODE_SESSION_ID -u CODEX_SESSION_ID -u CODEX_THREAD_ID ./ship-claim YPER4-999 >/dev/null 2>"$D/err"; eq "no resume id anywhere -> exit 2" "$?" 2
grep -q 'pass the resume command' "$D/err" && ok "clear error names the argument" || bad "error text"
./ship-claim bogus >/dev/null 2>&1; eq "bad ticket -> exit 2" "$?" 2

echo "$passes passed, $fails failed"; [ "$fails" = 0 ]
