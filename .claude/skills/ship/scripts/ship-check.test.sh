#!/usr/bin/env bash
# Live tests for ship-check against real tickets (needs gh and hypertask auth).
cd "$(dirname "$0")"; fails=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails+1)); }
E=$(mktemp -d); export VCC_EVIDENCE_DIR=$E
G() { local want=$1; shift; echo "{\"tool_input\":{\"command\":$(jq -Rn --arg c "$*" '$c')}}" | ./ship-check guard >/dev/null 2>&1; local got=$?; [ "$got" = "$want" ] && ok "$got <- $*" || bad "want $want got $got <- $*"; }
DONE='--section "Done"'
M='gh pr merge'

# Binding is required, and must match the ticket.
G 2 vcc task move YPER4-118 $DONE
./ship-check bind YPER4-118 830 >/dev/null && ok "bind YPER4-118 to 830" || bad "bind YPER4-118"
./ship-check bind HTPR-6570 809 >/dev/null && ok "bind HTPR-6570 to 809" || bad "bind HTPR-6570"
./ship-check bind HTPR-6570 822 >/dev/null && bad "bind to another ticket's PR accepted" || ok "bind to another ticket's PR rejected"

# Done moves, per command segment.
G 0 vcc task move YPER4-118 $DONE
G 2 vcc task move '"HTPR-6570"' $DONE
G 2 vcc task move "'HTPR-6570'" --section Done
G 2 echo hi '&&' vcc task move HTPR-6570 --section=Done
G 2 SHIP_BASE=production vcc task move HTPR-6570 $DONE
G 2 vcc task move YPER4-118 $DONE '&&' vcc task move HTPR-6570 $DONE
G 0 vcc task move HTPR-6570 --section '"In Progress"'

# Merges, per command segment.
G 2 $M 822 -R hypertask-ai/hypertask
G 2 FOO=1 $M 822 -R hypertask-ai/hypertask
G 0 $M 809 -R hypertask-ai/hypertask
G 2 $M 809 -R hypertask-ai/hypertask '&&' $M 822 -R hypertask-ai/hypertask
G 0 grep "$M" notes.txt

# A bound PR that is still open blocks the merged gate.
read -r opr ot < <(gh pr list -R hypertask-ai/hypertask --state open --json number,title --jq '[.[] | select(.title | test("^(HTPR|HYFA|YPER4)-[0-9]+ "))][0] | "\(.number) \(.title | split(" ")[0])"')
./ship-check bind "$ot" "$opr" >/dev/null; ./ship-check merged "$ot" | grep -q 'OPEN, not merged' && ok "open bound PR #$opr blocks merged gate" || bad "open bound PR not blocking"

# Proof contract.
sha=$(gh pr view 809 -R hypertask-ai/hypertask --json mergeCommit --jq .mergeCommit.oid)
R=$E/HTPR-6570/2026-10-01-qa-run-1; mkdir -p "$R"; : > "$R/a.png"
T() { if ./ship-check proof HTPR-6570 >/dev/null; then [ "$1" = pass ] && ok "$2" || bad "$2"; else [ "$1" = fail ] && ok "$2" || bad "$2"; fi; }
printf 'Feature map: .claude/skills/verify-qa/reference/feature-map/my-tasks.md\nDoctor: sha deadbeef0 deployment success\nRun: 2026-10-01-qa-run-1\n## Cases\n- PASS: x -> a.png\n' > "$E/HTPR-6570/proof.md"
T fail "stale proof rejected"
sed -i "s/deadbeef0/${sha:0:9}/" "$E/HTPR-6570/proof.md"
T fail "empty screenshot rejected"
printf 'png' > "$R/a.png"; T pass "fresh proof accepted"
echo '- PASS: y -> missing output.png' >> "$E/HTPR-6570/proof.md"; T fail "malformed PASS line rejected"
sed -i '$d' "$E/HTPR-6570/proof.md"; echo '- PASS: z -> old.png' >> "$E/HTPR-6570/proof.md"; printf 'png' > "$E/HTPR-6570/old.png"
T fail "evidence outside the current run rejected"
sed -i '$d' "$E/HTPR-6570/proof.md"; mkdir -p "$E/x"; printf 'png' > "$E/x/a.png"; sed -i 's/^Run: .*/Run: ..\/..\/x/' "$E/HTPR-6570/proof.md"
T fail "run folder outside the ticket rejected"

rm -rf "$E"
echo "failures: $fails"; [ "$fails" = 0 ]
