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

# Merges, per command segment. PR 822 was retitled; pin the invalid-title fixture.
gh() {
  if [[ ${1:-} == pr && ${2:-} == view && ${3:-} == 822 && "$*" == *'--json title'* ]]; then
    echo 'Invalid PR title'
  else command gh "$@"; fi
}
export -f gh
G 2 $M 822 -R hypertask-ai/hypertask
G 2 FOO=1 $M 822 -R hypertask-ai/hypertask
G 0 $M 809 -R hypertask-ai/hypertask
G 2 $M 809 -R hypertask-ai/hypertask '&&' $M 822 -R hypertask-ai/hypertask
G 0 grep "$M" notes.txt
unset -f gh

# A bound PR that is still open blocks the merged gate.
read -r opr ot < <(gh pr list -R hypertask-ai/hypertask --state open --json number,title --jq '[.[] | select(.title | test("^(HTPR|HYFA|YPER4)-[0-9]+ "))][0] | "\(.number) \(.title | split(" ")[0])"')
./ship-check bind "$ot" "$opr" >/dev/null; ./ship-check merged "$ot" | grep -q 'OPEN, not merged' && ok "open bound PR #$opr blocks merged gate" || bad "open bound PR not blocking"

# PR 838 changed only skills; Vercel skipped merge ec45678a2 without a deployment.
sha838=$(gh pr view 838 -R hypertask-ai/hypertask --json mergeCommit --jq .mergeCommit.oid)
[[ $sha838 == ec45678a2* ]] && ok "PR 838 merge ec45678a2" || bad "PR 838 merge changed"
./ship-check bind YPER4-122 838 >/dev/null && ok "bind skipped-build PR 838" || bad "bind PR 838"
out=$(./ship-check deployed YPER4-122)
[ "$out" = 'deployed ok (no app build needed)' ] && ok "Ignored Build Step accepted" || bad "skipped build: $out"

# A skipped build on another check, an unsuccessful Vercel check, or an older
# skipped status must not bypass the real deployment requirement.
mkdir -p "$E/mock-bin" "$E/YPER4-999"; echo 838 > "$E/YPER4-999/pr"
cat > "$E/mock-bin/gh" <<'MOCK'
#!/usr/bin/env bash
case "$1:$2" in
  pr:view) echo '{"number":838,"title":"YPER4-999 [INFRA] Fixture","state":"MERGED","mergeCommit":{"oid":"ec45678a2"},"baseRefName":"production"}' ;;
  api:*/status) printf '%s' "$STATUS_FIXTURE" | jq -r "$4" ;;
  api:*/deployments\?*) echo '[]' | jq -r "$4" ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$E/mock-bin/gh"
for statuses in \
  '[{"context":"Other check","state":"success","description":"Ignored Build Step"}]' \
  '[{"context":"Vercel","state":"failure","description":"Ignored Build Step"}]' \
  '[{"context":"Vercel","state":"pending","description":"Ignored Build Step"}]' \
  '[{"context":"Vercel","state":"success","description":"Build completed"},{"context":"Vercel","state":"success","description":"Ignored Build Step"}]'; do
  out=$(PATH="$E/mock-bin:$PATH" STATUS_FIXTURE="{\"statuses\":$statuses}" ./ship-check deployed YPER4-999)
  [ "$?" != 0 ] && [[ $out == 'FAIL: no Production deployment'* ]] \
    && ok "non-skipped/latest-success status still requires deployment" || bad "deployment bypass: $out"
done

# Non-app repos without releases may deploy through a Publish or Deploy workflow.
cat > "$E/mock-bin/gh" <<'MOCK'
#!/usr/bin/env bash
case "$1:$2" in
  pr:view) echo '{"number":838,"title":"YPER4-999 [INFRA] Fixture","state":"MERGED","mergeCommit":{"oid":"ec45678a2"},"baseRefName":"master"}' ;;
  release:view) [ -n "${RELEASE_TAG:-}" ] && echo "$RELEASE_TAG" ;;
  release:list) [ "${RELEASE_ERROR:-0}" = 0 ] || exit 1; echo "${RELEASES_FIXTURE:-[]}" ;;
  api:*/compare/*) [ "${COMPARE_ERROR:-0}" = 0 ] || exit 1; echo "${COMPARE_FIXTURE:-behind}" ;;
  run:list)
    [[ "$*" == 'run list -R hypertask-ai/analytics --commit ec45678a2 --json workflowName,conclusion,headSha' ]] || exit 1
    [ "${RUN_ERROR:-0}" = 0 ] || exit 1; echo "$RUNS_FIXTURE" ;;
  *) exit 1 ;;
esac
MOCK
publish='[{"workflowName":"Publish hypertask.app","conclusion":"success","headSha":"ec45678a2"}]'
D() {
  local want=$1 expected=$2 out got; shift 2
  out=$(env PATH="$E/mock-bin:$PATH" SHIP_REPO=hypertask-ai/analytics SHIP_BASE=master RUNS_FIXTURE="$publish" "$@" ./ship-check deployed YPER4-999); got=$?
  [ "$got" = "$want" ] && [[ $out == "$expected"* ]] && ok "$out" || bad "want $want $expected got $got $out"
}
D 0 'deployed ok (workflow)'
D 0 'deployed ok (workflow)' RUNS_FIXTURE='[{"workflowName":"Production Deploy site","conclusion":"success","headSha":"ec45678a2"}]'
for runs in \
  '[]' \
  '[{"workflowName":"Tests","conclusion":"success","headSha":"ec45678a2"}]' \
  '[{"workflowName":"Publish hypertask.app","conclusion":"failure","headSha":"ec45678a2"}]' \
  '[{"workflowName":"Publish hypertask.app","conclusion":null,"headSha":"ec45678a2"}]' \
  '[{"workflowName":"Deploy site","conclusion":"cancelled","headSha":"ec45678a2"}]' \
  '[{"workflowName":"Publish hypertask.app","conclusion":"success","headSha":"different"}]'; do
  D 1 'FAIL: no successful Publish or Deploy workflow' RUNS_FIXTURE="$runs"
done
D 1 'FAIL: could not read workflow runs' RUN_ERROR=1
D 1 'FAIL: could not read releases' RELEASE_ERROR=1
D 1 'FAIL: no release found' RELEASES_FIXTURE='[{"tagName":"v1"}]'
for comparison in ahead identical; do
  D 0 'deployed ok (release v1)' RELEASE_TAG=v1 COMPARE_FIXTURE="$comparison"
done
D 1 'FAIL: latest release' RELEASE_TAG=v1 COMPARE_FIXTURE=behind
D 1 'FAIL: latest release' RELEASE_TAG=v1 COMPARE_FIXTURE=diverged
D 1 'FAIL: could not compare' RELEASE_TAG=v1 COMPARE_ERROR=1

# Duplicates: HTPR-6823 was fixed by HTPR-6801's merged PR 837.
./ship-check duplicate HTPR-6823 HTPR-6801 830 >/dev/null && bad "duplicate accepted another ticket's PR" || ok "duplicate rejects a PR of another ticket"
./ship-check duplicate HTPR-6823 HTPR-6801 837 >/dev/null && ok "duplicate binds HTPR-6823 to PR 837" || bad "duplicate bind"
./ship-check merged HTPR-6823 | grep -q 'merged ok' && ok "duplicate passes the merged gate" || bad "duplicate merged gate"
./ship-check deployed HTPR-6823 | grep -q 'deployed ok' && ok "duplicate passes the deployed gate" || bad "duplicate deployed gate"
G 2 vcc task move HTPR-6823 $DONE

# A merged fix whose original ticket was deleted (cli PR 97, HTPR-6482) still counts on the duplicate path (YPER4-137).
CLI='SHIP_REPO=hypertask-ai/cli SHIP_BASE=main'
env $CLI ./ship-check duplicate HTPR-6810 HTPR-6482 97 >/dev/null && ok "duplicate binds to a merged PR of a deleted ticket" || bad "duplicate with deleted original"
env $CLI ./ship-check pr HTPR-6810 | grep -q 'title ok' && ok "duplicate pr gate passes with a deleted original" || bad "duplicate pr gate with deleted original"
env $CLI ./ship-check merged HTPR-6810 | grep -q 'merged ok' && ok "duplicate merged gate passes with a deleted original" || bad "duplicate merged gate with deleted original"
# HTPR-6482 now opens as HTPR-6810 (old numbers follow a board move, HTPR-6839), so point PR 97 at a number that never existed.
gh() {
  if [[ ${1:-} == pr && ${2:-} == view && ${3:-} == 97 ]]; then
    command gh "$@" | sed 's/HTPR-6482/HTPR-9999999/'
  else command gh "$@"; fi
}
export -f gh
env $CLI ./ship-check title 97 >/dev/null && bad "title accepted a PR whose ticket is gone" || ok "title (merge guard) still needs the ticket to exist"
unset -f gh

# Older merged PRs put the type first ("[BUGFIX] HTPR-6501 ..."); the duplicate path accepts that order (YPER4-140).
# cli PR 87 was since retitled, so pin its old title.
gh() {
  if [[ ${1:-} == pr && ${2:-} == view && ${3:-} == 87 ]]; then
    command gh "$@" | sed 's/HTPR-6501 \[BUGFIX\] /[BUGFIX] HTPR-6501 /'
  else command gh "$@"; fi
}
export -f gh
env $CLI ./ship-check duplicate HTPR-6807 HTPR-6482 87 >/dev/null && bad "old-order title of another ticket accepted" || ok "old-order title must name the fixing ticket"
env $CLI ./ship-check duplicate HTPR-6807 HTPR-6501 87 >/dev/null && ok "duplicate binds to an old-order PR title" || bad "duplicate with old-order title"
env $CLI ./ship-check pr HTPR-6807 | grep -q 'title ok' && ok "duplicate pr gate passes with an old-order title" || bad "duplicate pr gate with old-order title"
env $CLI ./ship-check merged HTPR-6807 | grep -q 'merged ok' && ok "duplicate merged gate passes with an old-order title" || bad "duplicate merged gate with old-order title"
./ship-check bind HTPR-6807 87 >/dev/null 2>&1 && bad "bind accepted an old-order title" || ok "bind still needs the new title order"
unset -f gh

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
echo "failures: $fails"; [ "$fails" = 0 ] && echo 'All ship-check tests passed'
