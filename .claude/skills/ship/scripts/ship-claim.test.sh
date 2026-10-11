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
decide() { ./ship-claim decide "$ME" "$D/c.json"; }

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
   "$(c 11 2026-10-11T10:01:00.000Z a1 'RUNNER 7' '<p><strong>Stepping back: RUNNER 9 claimed this first.</strong></p>')" \
   "$(c 12 2026-10-11T10:02:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
eq "claimant that stepped back is ignored" "$(decide)" WIN

mk "$(c 10 2026-10-11T10:00:00.000Z a1 'RUNNER 7' "$(claim other-sess)")"
eq "own claim missing -> NOOURS" "$(decide)" NOOURS

# Full flow with stubs.
cat > "$D/vcc" <<'EOF'
#!/usr/bin/env bash
echo "$*" >> "$FAKE_LOG"
EOF
cat > "$D/hypertask" <<'EOF'
#!/usr/bin/env bash
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

mk "$(c 10 2026-10-11T10:00:00.000Z a2 'RUNNER 3' "$(claim $ME)")"
: > "$D/log"; out=$(./ship-claim YPER4-999); rc=$?
eq "flow winner exit code" "$rc" 0
grep -q unassign "$D/log" && bad "winner unassigned" || ok "winner stays assigned"

./ship-claim bogus >/dev/null 2>&1; eq "bad ticket -> exit 2" "$?" 2

echo "$passes passed, $fails failed"; [ "$fails" = 0 ]
