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
./ship-check merged HTPR-6370 | grep -q 'OPEN, not merged' && echo "ok   newer open PR blocks merged gate" || { echo "FAIL newer open PR not blocking"; fails=$((fails+1)); }
sha=$(gh pr view 809 -R hypertask-ai/hypertask --json mergeCommit --jq .mergeCommit.oid)
D=$(mktemp -d); mkdir -p "$D/HTPR-6570"; : > "$D/HTPR-6570/a.png"
printf 'Feature map: .claude/skills/verify-qa/reference/feature-map/my-tasks.md\nDoctor: sha deadbeef0 deployment success\n## Cases\n- PASS: x -> a.png\n' > "$D/HTPR-6570/proof.md"
VCC_EVIDENCE_DIR=$D ./ship-check proof HTPR-6570 >/dev/null && { echo "FAIL stale proof accepted"; fails=$((fails+1)); } || echo "ok   stale proof rejected"
sed -i "s/deadbeef0/${sha:0:9}/" "$D/HTPR-6570/proof.md"
VCC_EVIDENCE_DIR=$D ./ship-check proof HTPR-6570 >/dev/null && { echo "FAIL empty screenshot accepted"; fails=$((fails+1)); } || echo "ok   empty screenshot rejected"
printf 'png' > "$D/HTPR-6570/a.png"
VCC_EVIDENCE_DIR=$D ./ship-check proof HTPR-6570 >/dev/null && echo "ok   fresh proof accepted" || { echo "FAIL fresh proof rejected"; fails=$((fails+1)); }
rm -rf "$D"
echo "failures: $fails"; [ "$fails" = 0 ]
