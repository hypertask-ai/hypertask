#!/usr/bin/env bash
# Live tests for ship-check against real tickets (needs gh and hypertask auth).
cd "$(dirname "$0")"; fails=0
G() { local want=$1; shift; echo "{\"tool_input\":{\"command\":$(jq -Rn --arg c "$*" '$c')}}" | ./ship-check guard >/dev/null 2>&1; local got=$?; [ "$got" = "$want" ] && echo "ok   $got <- $*" || { echo "FAIL want $want got $got <- $*"; fails=$((fails+1)); }; }
DONE='--section "Done"'
G 2 vcc task move '"HTPR-6570"' $DONE
G 2 vcc task move "'HTPR-6570'" --section Done
G 2 echo hi '&&' vcc task move HTPR-6570 --section=Done
G 0 vcc task move YPER4-118 $DONE
G 0 vcc task move HTPR-6570 --section '"In Progress"'
G 2 gh pr merge 822 -R hypertask-ai/hypertask
G 0 grep "gh pr merge" notes.txt
G 2 SHIP_BASE=production vcc task move HTPR-6570 $DONE
G 2 FOO=1 gh pr merge 822 -R hypertask-ai/hypertask
G 2 vcc task move YPER4-118 $DONE '&&' vcc task move HTPR-6570 $DONE
read -r opr ot < <(gh pr list -R hypertask-ai/hypertask --state open --json number,title --jq '[.[] | select(.title | test("^(HTPR|HYFA|YPER4)-[0-9]+ "))][0] | "\(.number) \(.title | split(" ")[0])"')
E=$(mktemp -d); VCC_EVIDENCE_DIR=$E ./ship-check bind "$ot" "$opr" >/dev/null
VCC_EVIDENCE_DIR=$E ./ship-check merged "$ot" | grep -q 'OPEN, not merged' && echo "ok   open bound PR #$opr blocks merged gate" || { echo "FAIL open bound PR not blocking"; fails=$((fails+1)); }; rm -rf "$E"
sha=$(gh pr view 809 -R hypertask-ai/hypertask --json mergeCommit --jq .mergeCommit.oid)
D=$(mktemp -d); R=$D/HTPR-6570/2026-10-01-qa-run-1; mkdir -p "$R"; : > "$R/a.png"
P() { VCC_EVIDENCE_DIR=$D ./ship-check proof HTPR-6570 >/dev/null; }
T() { if P; then [ "$1" = pass ] && echo "ok   $2" || { echo "FAIL $2"; fails=$((fails+1)); }; else [ "$1" = fail ] && echo "ok   $2" || { echo "FAIL $2"; fails=$((fails+1)); }; fi; }
VCC_EVIDENCE_DIR=$D ./ship-check bind HTPR-6570 809 >/dev/null || { echo "FAIL bind"; fails=$((fails+1)); }
VCC_EVIDENCE_DIR=$D ./ship-check bind HTPR-6570 822 >/dev/null && { echo "FAIL bind to wrong PR accepted"; fails=$((fails+1)); } || echo "ok   bind to another ticket's PR rejected"
printf 'Feature map: .claude/skills/verify-qa/reference/feature-map/my-tasks.md\nDoctor: sha deadbeef0 deployment success\nRun: 2026-10-01-qa-run-1\n## Cases\n- PASS: x -> a.png\n' > "$D/HTPR-6570/proof.md"
T fail "stale proof rejected"
sed -i "s/deadbeef0/${sha:0:9}/" "$D/HTPR-6570/proof.md"
T fail "empty screenshot rejected"
printf 'png' > "$R/a.png"; T pass "fresh proof accepted"
echo '- PASS: y -> missing output.png' >> "$D/HTPR-6570/proof.md"; T fail "malformed PASS line rejected"
sed -i '$d' "$D/HTPR-6570/proof.md"; echo '- PASS: z -> old.png' >> "$D/HTPR-6570/proof.md"; printf 'png' > "$D/HTPR-6570/old.png"
T fail "evidence outside the current run rejected"
rm -rf "$D"
echo "failures: $fails"; [ "$fails" = 0 ]
