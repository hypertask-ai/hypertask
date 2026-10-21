#!/usr/bin/env bash
# Live tests for ship-check against real tickets (needs gh and hypertask auth).
cd "$(dirname "$0")"; fails=0; passes=0
ok() { echo "ok   $*"; passes=$((passes+1)); }; bad() { echo "FAIL $*"; fails=$((fails+1)); }
E=$(mktemp -d); export VCC_EVIDENCE_DIR=$E
trap 'rm -rf "$E"' EXIT
export PREMERGE_STATUS_STATE="$E/publisher-state"
# Live fixtures may read GitHub, but tests never publish real commit statuses.
real_gh=$(command -v gh); mkdir -p "$E/read-bin"
printf '#!/usr/bin/env bash\nif [[ $1 == api && $2 == */statuses/* ]]; then exit 0; fi\nexec %q "$@"\n' "$real_gh" > "$E/read-bin/gh"
chmod +x "$E/read-bin/gh"; export PATH="$E/read-bin:$PATH"
G() { local want=$1; shift; echo "{\"tool_input\":{\"command\":$(jq -Rn --arg c "$*" '$c')}}" | ./ship-check guard >/dev/null 2>&1; local got=$?; [ "$got" = "$want" ] && ok "$got <- $*" || bad "want $want got $got <- $*"; }
DONE='--section "Done"'
M='gh pr merge'

if [ "${1:-}" != --premerge-only ]; then
# Concatenated assignment fragments cannot bypass missing Done evidence.
for prefix in 'FOO=pre"fix"' "FOO='a'b\"c\""; do
  G 2 "$prefix vcc task move YPER4-999 $DONE"
  G 2 "$prefix vcc tasks move 'YPER4-999' $DONE"
done
# Unsupported assignment prefixes fail closed, with an actionable message.
for prefix in 'FOO="unterminated' '1FOO=bad' 'FOO=pre\ fix'; do
  for protected in "vcc task move YPER4-999 $DONE" "$M 999"; do
    out=$(jq -Rn --arg c "$prefix $protected" '{tool_input:{command:$c}}' | ./ship-check guard 2>&1); got=$?
    [ "$got" = 2 ] && [[ $out == *'cannot parse the leading environment assignments'* ]] \
      && ok "unparseable prefix blocked: $prefix $protected" || bad "prefix bypass: $got $out"
  done
done

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
  elif [[ ${1:-} == pr && ${2:-} == view && ${3:-} == 838 && "$*" == *'--json headRefOid,baseRefName,state'* ]]; then
    command gh pr view 838 -R hypertask-ai/hypertask --json headRefOid --jq .headRefOid # Pin the skills-only fixture as open.
  elif [[ ${1:-} == api && ${2:-} == */check-runs\?* ]]; then
    echo '{"check_runs":[{"id":1,"name":"ci-tests","status":"completed","conclusion":"success"}]}'
  else command gh "$@"; fi
}
export -f gh
if gh api 'repos/hypertask-ai/hypertask/commits/fixture/check-runs?per_page=100' --paginate | jq -e '.check_runs[0].conclusion == "success"' >/dev/null; then
  ok 'merge fixtures have passing ci-tests'
else bad 'merge fixture CI stub failed'; fi
G 2 $M 822 -R hypertask-ai/hypertask
G 2 FOO=1 $M 822 -R hypertask-ai/hypertask
for prefix in 'FOO=pre"fix"' "FOO='a'b\"c\""; do
  G 2 "$prefix $M 822 -R hypertask-ai/hypertask"
  SHIP_CHECK_PLAIN_QA_STATE=/nonexistent AGENT_TOKEN= HYPERTASKS_JWT_TOKEN= G 2 "$prefix $M 809 -R hypertask-ai/hypertask"
  G 0 "$prefix $M 838 -R hypertask-ai/hypertask"
done
SHIP_CHECK_PLAIN_QA_STATE=/nonexistent AGENT_TOKEN= HYPERTASKS_JWT_TOKEN= G 2 $M 809 -R hypertask-ai/hypertask # No live modes or premerge evidence.
G 0 $M 838 -R hypertask-ai/hypertask # Skills-only PR, no product flag reads.
G 2 $M 838 -R hypertask-ai/hypertask '&&' $M 822 -R hypertask-ai/hypertask
G 0 grep "$M" notes.txt
unset -f gh

# Repo scope is determined from the hook cwd, not the guard process cwd.
for repo in app foreign cli no-origin slack mixed; do git init -q "$E/$repo"; done
git -C "$E/mixed" remote add origin https://github.com/Hypertask-AI/hypertask.git
git -C "$E/slack" remote add origin https://github.com/valentinyeo/ht-slack.git
git -C "$E/app" remote add origin https://github.com/hypertask-ai/hypertask.git
git -C "$E/foreign" remote add origin git@github.com:valentinyeo/endless-testing.git
git -C "$E/cli" remote add origin ssh://git@github.com/hypertask-ai/cli.git
export SCOPE_LOG="$E/scope-log"
mkdir -p "$E/scope-bin"
cat > "$E/scope-bin/gh" <<'MOCK'
#!/usr/bin/env bash
prev=""
for arg in "$@"; do
  [ "$prev" != -R ] || printf '%s\n' "$arg" >> "$SCOPE_LOG"
  prev=$arg
done
echo 'Invalid PR title'
MOCK
chmod +x "$E/scope-bin/gh"
R() {
  local want=$1 cwd=$2 repo=$3 cmd=$4 out got; shift 4
  : > "$SCOPE_LOG"
  out=$(jq -nc --arg c "$cmd" --arg d "$cwd" '{tool_input:{command:$c},cwd:$d}' \
    | env -u SHIP_REPO PATH="$E/scope-bin:$PATH" "$@" ./ship-check guard 2>&1); got=$?
  if [ "$got" = "$want" ] && [ "$(cat "$SCOPE_LOG")" = "$repo" ]; then ok "repo scope: $got $cmd"
  else bad "repo scope: want $want $repo got $got $(cat "$SCOPE_LOG") $out"; fi
  if [[ $repo == hypertask-ai/hypertask && ( $cwd == "$E/no-origin" || -z $cwd ) ]]; then
    if [[ $out == *'Target repo could not be resolved'* && $out == *'-R owner/repo or SHIP_REPO=owner/repo'* ]]; then
      ok 'unresolved target has actionable diagnostic'
    else bad "unresolved target diagnostic: $out"; fi
  fi
}
R 0 "$E/app" '' "$M 20 -R valentinyeo/endless-testing --squash"
R 2 "$E/foreign" hypertask-ai/hypertask "$M 822 -R hypertask-ai/hypertask"
R 0 "$E/foreign" '' "echo YPER4-197 && $M 20 --squash"
R 2 "$E/cli" hypertask-ai/cli "$M 822"
R 2 "$E/slack" hypertask-ai/slack "$M 822"
R 2 "$E/mixed" hypertask-ai/hypertask "$M 822"
R 2 "$E/foreign" hypertask-ai/hypertask "cd $E/app && $M 822"
R 2 "$E/foreign" hypertask-ai/hypertask "pushd $E/app; $M 822"
R 2 "$E/foreign" hypertask-ai/hypertask "builtin cd $E/app && $M 822"
R 2 "$E/foreign" hypertask-ai/hypertask "command cd $E/app; $M 822"
R 2 "$E/app" hypertask-ai/hypertask "$M 822 --squash <<< 'https://github.com/valentinyeo/endless-testing/pull/20'"
R 2 "$E/app" hypertask-ai/hypertask "$M 822 --body https://github.com/valentinyeo/endless-testing/pull/20"
R 0 "$E/foreign" '' "cd $E/app && $M 20 -R valentinyeo/endless-testing"
R 2 "$E/foreign" '' "$M https://github.com/hypertask-ai/hypertask/pull/822"
R 0 "$E/app" '' "$M https://github.com/valentinyeo/endless-testing/pull/20"
R 2 "$E/app" hypertask-ai/slack "$M 822 -R valentinyeo/ht-slack"
R 2 "$E/foreign" valentinyeo/endless-testing "SHIP_REPO=valentinyeo/endless-testing $M 822"
R 2 "$E/foreign" valentinyeo/endless-testing "$M 822" SHIP_REPO=valentinyeo/endless-testing
R 2 "$E/app" valentinyeo/endless-testing "$M 822 -R valentinyeo/endless-testing" SHIP_REPO=hypertask-ai/cli
R 2 "$E/app" hypertask-ai/cli "SHIP_REPO=valentinyeo/endless-testing $M 822 -R hypertask-ai/cli"
R 2 "$E/no-origin" hypertask-ai/hypertask "$M 822"
R 2 '' hypertask-ai/hypertask "$M 822"
R 2 "$E/app" hypertask-ai/hypertask "$M 822"
R 2 "$E/app" hypertask-ai/hypertask "$M 822 # -R valentinyeo/endless-testing"
for flag in '-Rvalentinyeo/endless-testing' '--repo=valentinyeo/endless-testing' '--repo "valentinyeo/endless-testing"'; do
  R 0 "$E/app" '' "$M 20 $flag"
done
for flag in '-R"hypertask-ai/hypertask"' '--repo=hypertask-ai/hypertask' '--repo "github.com/hypertask-ai/hypertask"'; do
  R 2 "$E/foreign" hypertask-ai/hypertask "$M 822 $flag"
done
for odd in '-R' '--repo=' '-R --repo valentinyeo/endless-testing' "-R \"\$UNKNOWN\"" '-R "unterminated'; do
  R 2 "$E/app" hypertask-ai/hypertask "$M 822 $odd"
done
R 2 "$E/foreign" hypertask-ai/hypertask "$M 20 -R valentinyeo/endless-testing && $M 822 -R hypertask-ai/hypertask"
R 0 "$E/foreign" '' "SHIP_REPO=hypertask-ai/cli echo hi && $M 20"
R 2 "$E/foreign" '' "$M 20 && vcc task move YPER4-999 $DONE"

# No real open PR is needed to test the unmerged gate.
gh() {
  if [[ ${1:-} == pr && ${2:-} == view && ${3:-} == 809 && "$*" == *'--json number,title,state,mergeCommit,baseRefName'* ]]; then
    command gh "$@" | jq '.state = "OPEN"'
  else command gh "$@"; fi
}
export -f gh
./ship-check merged HTPR-6570 | grep -q 'OPEN, not merged' && ok 'open bound PR blocks merged gate' || bad 'open bound PR not blocking'
unset -f gh

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

# Bindings keep their repository and base when ledger commands omit the environment.
binding_tests() {
  local HOME PATH=$PATH BIND_EXPECT_REPO SHIP_REPO SHIP_BASE
  unset SHIP_REPO SHIP_BASE
  export HOME="$E/bind-home" PATH="$E/bind-bin:$PATH" BIND_EXPECT_REPO=hypertask-ai/analytics
  mkdir -p "$HOME" "$E/bind-bin"
  cat > "$E/bind-bin/gh" <<'MOCK'
#!/usr/bin/env bash
[[ $1 == pr && $2 == view && $3 == 163 && $4 == -R && $5 == "$BIND_EXPECT_REPO" ]] || exit 1
case "$7" in
  title) echo 'YPER4-531 [INFRA] Fixture' ;;
  number,title,state,mergeCommit,baseRefName)
    printf '{"number":163,"title":"YPER4-531 [INFRA] Fixture","state":"MERGED","mergeCommit":{"oid":"ec45678a2"},"baseRefName":"%s"}\n' "${BIND_PR_BASE:-master}" ;;
  *) exit 1 ;;
esac
MOCK
  cat > "$E/bind-bin/hypertask" <<'MOCK'
#!/usr/bin/env bash
[[ $1 == tasks && $2 == get && $3 == YPER4-531 ]] || exit 1
echo '{"success":true,"tasks":[{"section":"Done"}]}'
MOCK
  chmod +x "$E/bind-bin/gh" "$E/bind-bin/hypertask"
  B() {
    local want=$1 expected=$2 out got; shift 2
    out=$(env "$@" ./ship-check pr YPER4-531); got=$?
    [ "$got" = "$want" ] && [[ $out == "$expected"* ]] && ok "binding: $*" || bad "binding: want $want $expected got $got $out ($*)"
  }
  SHIP_REPO=hypertask-ai/analytics SHIP_BASE=master ./ship-check bind YPER4-531 163 >/dev/null \
    && ok 'bind analytics PR' || bad 'bind analytics PR'
  [ "$(cat "$E/YPER4-531/pr")" = 163 ] && [ "$(cat "$E/YPER4-531/repo")" = hypertask-ai/analytics ] && [ "$(cat "$E/YPER4-531/base")" = master ] \
    && ok 'binding records PR, repo and base' || bad 'binding lost repo/base'
  B 0 'title ok'
  ./ship-check merged YPER4-531 | grep -qx 'merged ok' && ok 'merged restores analytics repo/base' || bad 'merged lost analytics binding'
  B 1 'FAIL:' BIND_EXPECT_REPO=hypertask-ai/docs
  B 0 'title ok' SHIP_REPO=hypertask-ai/docs BIND_EXPECT_REPO=hypertask-ai/docs
  B 0 'title ok' SHIP_BASE=main BIND_PR_BASE=main
  B 1 'FAIL:' SHIP_BASE=main
  mkdir -p "$E/bind-legacy/YPER4-531"; echo 163 > "$E/bind-legacy/YPER4-531/pr"
  B 0 'title ok' VCC_EVIDENCE_DIR="$E/bind-legacy" BIND_EXPECT_REPO=hypertask-ai/hypertask BIND_PR_BASE=production
  B 0 'title ok' VCC_EVIDENCE_DIR="$E/bind-legacy" SHIP_REPO=hypertask-ai/analytics SHIP_BASE=master
  SHIP_REPO=hypertask-ai/docs SHIP_BASE=main BIND_EXPECT_REPO=hypertask-ai/docs ./ship-check bind YPER4-531 163 >/dev/null \
    && [ "$(cat "$E/YPER4-531/repo")" = hypertask-ai/docs ] && [ "$(cat "$E/YPER4-531/base")" = main ] \
    && ok 'rebind replaces saved repo/base' || bad 'rebind lost repo/base'
}
binding_tests

# Only analytics/master may use its exact production publishing run without a release.
cat > "$E/mock-bin/gh" <<'MOCK'
#!/usr/bin/env bash
case "$1:$2" in
  pr:view) printf '{"number":838,"title":"YPER4-999 [INFRA] Fixture","state":"MERGED","mergeCommit":{"oid":"ec45678a2"},"baseRefName":"%s"}\n' "$SHIP_BASE" ;;
  release:view) [ -n "${RELEASE_TAG:-}" ] && echo "$RELEASE_TAG" ;;
  release:list) [ "${RELEASE_ERROR:-0}" = 0 ] || exit 1; echo "${RELEASES_FIXTURE:-[]}" ;;
  api:*/compare/*) [ "${COMPARE_ERROR:-0}" = 0 ] || exit 1; echo "${COMPARE_FIXTURE:-behind}" ;;
  api:*/actions/workflows/*)
    [[ "$2" == 'repos/hypertask-ai/analytics/actions/workflows/deploy.yml/runs?head_sha=ec45678a2&per_page=100' ]] || exit 1
    [ "${RUN_ERROR:-0}" = 0 ] || exit 1; echo "$RUNS_FIXTURE" ;;
  api:*/actions/runs/*)
    [[ "$2" == 'repos/hypertask-ai/analytics/actions/runs/123/jobs?per_page=100' ]] || exit 1
    [ "${JOBS_ERROR:-0}" = 0 ] || exit 1; echo "$JOBS_FIXTURE" ;;
  *) exit 1 ;;
esac
MOCK
publish='{"workflow_runs":[{"id":123,"name":"Publish hypertask.app","path":".github/workflows/deploy.yml","event":"push","head_branch":"master","conclusion":"success","head_sha":"ec45678a2"}]}'
D() {
  local want=$1 expected=$2 out got; shift 2
  out=$(env PATH="$E/mock-bin:$PATH" SHIP_REPO=hypertask-ai/analytics SHIP_BASE=master RUNS_FIXTURE="$publish" JOBS_FIXTURE='{"jobs":[{"name":"deploy","conclusion":"success"}]}' "$@" ./ship-check deployed YPER4-999); got=$?
  [ "$got" = "$want" ] && [[ $out == "$expected"* ]] && ok "$out" || bad "want $want $expected got $got $out"
}
D 0 'deployed ok (workflow)'
D 0 'deployed ok (workflow)' RUNS_FIXTURE="$(jq '.workflow_runs[0].event = "workflow_dispatch"' <<<"$publish")"
for change in \
  '.head_sha = "different"' \
  '.conclusion = "failure"' \
  '.conclusion = null | .status = "in_progress"' \
  '.path = ".github/workflows/other.yml"'; do
  runs=$(jq ".workflow_runs[0] |= (.event = \"workflow_dispatch\" | $change)" <<<"$publish")
  D 1 'FAIL: no successful production publishing run' RUNS_FIXTURE="$runs"
done
D 1 'FAIL: no successful production publishing run' RUNS_FIXTURE='{"workflow_runs":[]}'
for change in \
  '.name = "Deploy Preview"' \
  '.name = "Publish validation"' \
  '.path = ".github/workflows/preview.yml"' \
  '.path = ".github/workflows/validation.yml"' \
  '.event = "pull_request"' \
  '.event = "schedule"' \
  '.head_branch = "preview"' \
  '.conclusion = "failure"' \
  '.conclusion = null' \
  '.conclusion = "cancelled"' \
  '.head_sha = "different"' \
  'del(.path)' \
  'del(.event)'; do
  runs=$(jq ".workflow_runs[0] |= ($change)" <<<"$publish")
  D 1 'FAIL: no successful production publishing run' RUNS_FIXTURE="$runs"
done
for jobs in \
  '{"jobs":[]}' \
  '{"jobs":[{"name":"deploy","conclusion":"skipped"}]}' \
  '{"jobs":[{"name":"deploy","conclusion":"failure"}]}' \
  '{"jobs":[{"name":"deploy","conclusion":null}]}' \
  '{"jobs":[{"name":"validate","conclusion":"success"}]}'; do
  D 1 'FAIL: no successful production deploy job' JOBS_FIXTURE="$jobs"
done
D 1 'FAIL: could not read publishing jobs' JOBS_ERROR=1
D 1 'FAIL: could not read workflow runs' RUN_ERROR=1
D 1 'FAIL: could not read publishing workflow identity' RUNS_FIXTURE='invalid'
D 1 'FAIL: could not read releases' RELEASE_ERROR=1
D 1 'FAIL: no release found' RELEASES_FIXTURE='[{"tagName":"v1"}]'
D 1 'FAIL: no release found' SHIP_BASE=main
D 1 'FAIL: no release found' SHIP_REPO=hypertask-ai/cli SHIP_BASE=main
D 1 'FAIL: no release found' SHIP_REPO=hypertask-ai/other
for comparison in ahead identical; do
  D 0 'deployed ok (release v1)' RELEASE_TAG=v1 COMPARE_FIXTURE="$comparison" RUN_ERROR=1
  D 0 'deployed ok (release v1)' SHIP_REPO=hypertask-ai/cli SHIP_BASE=main RELEASE_TAG=v1 COMPARE_FIXTURE="$comparison" RUN_ERROR=1
done
D 1 'FAIL: latest release' RELEASE_TAG=v1 COMPARE_FIXTURE=behind
D 1 'FAIL: latest release' RELEASE_TAG=v1 COMPARE_FIXTURE=diverged
D 1 'FAIL: could not compare' RELEASE_TAG=v1 COMPARE_ERROR=1

# Docs/main deploys to Cloudflare Pages without releases.
cat > "$E/mock-bin/gh" <<'MOCK'
#!/usr/bin/env bash
case "$1:$2" in
  pr:view) printf '{"number":838,"title":"YPER4-999 [INFRA] Fixture","state":"MERGED","mergeCommit":{"oid":"ec45678a2"},"baseRefName":"%s"}\n' "$SHIP_BASE" ;;
  release:view) exit 1 ;;
  release:list) [ "${RELEASE_ERROR:-0}" = 0 ] || exit 1; echo "${RELEASES_FIXTURE:-[]}" ;;
  api:*/actions/workflows/*)
    [[ "$2" == 'repos/hypertask-ai/docs/actions/workflows/deploy.yml/runs?head_sha=ec45678a2&per_page=100' ]] || exit 1
    [ "${RUN_ERROR:-0}" = 0 ] || exit 1; echo "$RUNS_FIXTURE" ;;
  api:*/actions/runs/*)
    [[ "$2" == 'repos/hypertask-ai/docs/actions/runs/456/jobs?per_page=100' ]] || exit 1
    [ "${JOBS_ERROR:-0}" = 0 ] || exit 1; echo "$JOBS_FIXTURE" ;;
  *) exit 1 ;;
esac
MOCK
docs_publish='{"workflow_runs":[{"id":456,"name":"Build and Deploy","path":".github/workflows/deploy.yml","event":"push","head_branch":"main","conclusion":"success","head_sha":"ec45678a2"}]}'
DD() {
  local want=$1 expected=$2 out got; shift 2
  out=$(env PATH="$E/mock-bin:$PATH" SHIP_REPO=hypertask-ai/docs SHIP_BASE=main RUNS_FIXTURE="$docs_publish" JOBS_FIXTURE='{"jobs":[{"name":"Build and deploy to Cloudflare Pages","conclusion":"success"}]}' "$@" ./ship-check deployed YPER4-999); got=$?
  if [ "$got" = "$want" ] && [[ $out == "$expected"* ]]; then ok "docs: $out"
  else bad "docs: want $want $expected got $got $out"; fi
}
DD 0 'deployed ok (workflow)'
DD 0 'deployed ok (workflow)' RUNS_FIXTURE="$(jq '.workflow_runs[0].event = "workflow_dispatch"' <<<"$docs_publish")"
for change in \
  '.head_sha = "different"' \
  '.conclusion = "failure"' \
  '.conclusion = null | .status = "in_progress"' \
  '.path = ".github/workflows/other.yml"'; do
  runs=$(jq ".workflow_runs[0] |= (.event = \"workflow_dispatch\" | $change)" <<<"$docs_publish")
  DD 1 'FAIL: no successful production publishing run' RUNS_FIXTURE="$runs"
done
DD 1 'FAIL: no successful production publishing run' RUNS_FIXTURE='{"workflow_runs":[]}'
for change in \
  '.name = "Publish hypertask.app"' \
  '.path = ".github/workflows/preview.yml"' \
  '.event = "pull_request"' \
  '.event = "schedule"' \
  '.head_branch = "master"' \
  '.conclusion = "failure"' \
  '.conclusion = null' \
  '.conclusion = "cancelled"' \
  '.head_sha = "different"'; do
  runs=$(jq ".workflow_runs[0] |= ($change)" <<<"$docs_publish")
  DD 1 'FAIL: no successful production publishing run' RUNS_FIXTURE="$runs"
done
for jobs in \
  '{"jobs":[]}' \
  '{"jobs":[{"name":"Build and deploy to Cloudflare Pages","conclusion":"skipped"}]}' \
  '{"jobs":[{"name":"Build and deploy to Cloudflare Pages","conclusion":"failure"}]}' \
  '{"jobs":[{"name":"Build and deploy to Cloudflare Pages","conclusion":null}]}' \
  '{"jobs":[{"name":"deploy","conclusion":"success"}]}'; do
  DD 1 'FAIL: no successful production deploy job' JOBS_FIXTURE="$jobs"
done
DD 1 'FAIL: could not read publishing jobs' JOBS_ERROR=1
DD 1 'FAIL: could not read workflow runs' RUN_ERROR=1
DD 1 'FAIL: could not read publishing workflow identity' RUNS_FIXTURE='invalid'
DD 1 'FAIL: could not read releases' RELEASE_ERROR=1
DD 1 'FAIL: no release found' RELEASES_FIXTURE='[{"tagName":"v1"}]'
DD 1 'FAIL: no release found' SHIP_BASE=master
DD 1 'FAIL: no release found' SHIP_REPO=hypertask-ai/other

# Docs completion gate: isolated bound PR, docs PR and comments, never board-state dependent.
mkdir -p "$E/docs-bin"
cat > "$E/docs-bin/gh" <<'MOCK'
#!/usr/bin/env bash
case "$1:$2" in
  pr:view)
    [[ $* == *'-R hypertask-ai/hypertask'* ]] || exit 1
    if [[ $* == *'--json title --jq'* ]]; then echo "YPER4-388 [${DOCS_TYPE:-FEATURE}] Fixture"
    else printf '{"number":888,"title":"YPER4-388 [%s] Fixture","state":"MERGED","mergeCommit":{"oid":"app-merge"},"baseRefName":"production"}\n' "${DOCS_TYPE:-FEATURE}"; fi ;;
  pr:list)
    [[ $* == *'-R hypertask-ai/docs --base main --state merged'* && $* == *'YPER4-388 in:title'* ]] || exit 1
    printf '%s\n' "${DOCS_PRS:-[]}" ;;
  api:repos/hypertask-ai/docs/actions/workflows/deploy.yml/runs\?*)
    [[ $2 == *'head_sha=ec45678a2&per_page=100' ]] || exit 1
    printf '%s\n' "$RUNS_FIXTURE" ;;
  api:repos/hypertask-ai/docs/actions/runs/456/jobs\?*) printf '%s\n' "$JOBS_FIXTURE" ;;
  api:repos/hypertask-ai/hypertask/commits/app-merge/status) echo 'Ignored Build Step' ;;
  *) exit 1 ;;
esac
MOCK
cat > "$E/docs-bin/hypertask" <<'MOCK'
#!/usr/bin/env bash
[[ $1 == comment && $2 == list && $3 == "${DOCS_TICKET:-YPER4-388}" ]] || exit 1
if [ -n "${DOCS_COMMENTS:-}" ]; then printf '%s\n' "$DOCS_COMMENTS"
else echo '{"comments":[]}'; fi
MOCK
chmod +x "$E/docs-bin/gh" "$E/docs-bin/hypertask"
mkdir -p "$E/YPER4-388"; echo 888 > "$E/YPER4-388/pr"
docs_pr='[{"number":42,"title":"YPER4-388 [FEATURE] Fixture docs","state":"MERGED","baseRefName":"main","mergeCommit":{"oid":"ec45678a2"}}]'
DC() {
  local want=$1 expected=$2 mode=$3 out got; shift 3
  if [ "$mode" = guard ]; then
    out=$(echo '{"tool_input":{"command":"vcc task move YPER4-388 --section \"Done\""}}' | env PATH="$E/docs-bin:$PATH" RUNS_FIXTURE="$docs_publish" JOBS_FIXTURE='{"jobs":[{"name":"Build and deploy to Cloudflare Pages","conclusion":"success"}]}' "$@" ./ship-check guard 2>&1); got=$?
  else
    out=$(env PATH="$E/docs-bin:$PATH" RUNS_FIXTURE="$docs_publish" JOBS_FIXTURE='{"jobs":[{"name":"Build and deploy to Cloudflare Pages","conclusion":"success"}]}' "$@" ./ship-check docs "${DOCS_TICKET:-YPER4-388}" 2>&1); got=$?
  fi
  if [ "$got" = "$want" ] && [[ $out == *"$expected"* ]]; then ok "docs gate $mode: $expected"
  else bad "docs gate $mode: want $want $expected got $got $out"; fi
}
DC 1 'FAIL: [FEATURE] ticket YPER4-388 has no merged and deployed docs PR' docs
DC 0 'docs ok (docs PR 42)' docs DOCS_PRS="$docs_pr"
DC 0 'docs ok (not needed for [BUGFIX])' docs DOCS_TYPE=BUGFIX
DC 1 'FAIL: [IMPROVE]' docs DOCS_TYPE=IMPROVE
DC 0 'docs ok (docs PR 42)' docs DOCS_TYPE=IMPROVE DOCS_PRS="$docs_pr"
DC 1 'FAIL: [FEATURE]' docs DOCS_PRS="$docs_pr" RUNS_FIXTURE='{"workflow_runs":[]}'
DC 1 'FAIL: [FEATURE]' docs DOCS_PRS="$docs_pr" JOBS_FIXTURE='{"jobs":[{"name":"Build and deploy to Cloudflare Pages","conclusion":"skipped"}]}'
for change in '.title = "YPER4-3880 [FEATURE] Other"' '.baseRefName = "preview"' '.state = "OPEN"'; do
  DC 1 'FAIL: [FEATURE]' docs DOCS_PRS="$(jq ".[0] |= ($change)" <<<"$docs_pr")"
done
DC 0 'docs ok (no user-visible change)' docs DOCS_COMMENTS='{"comments":[{"text":"<p><strong>No user-visible change:</strong> internal tooling only.</p>"}]}'
for text in 'No user-visible change: ' '<p>No user-visible change: &nbsp;</p>' 'Note: No user-visible change: internal tooling'; do
  DC 1 'FAIL: [FEATURE]' docs DOCS_COMMENTS="$(jq -n --arg text "$text" '{comments:[{text:$text}]}')"
done
DC 2 'Merge a docs PR titled with YPER4-388 or post a No user-visible change:' guard
DC 0 '' guard DOCS_PRS="$docs_pr"
DC 0 '' guard DOCS_TYPE=BUGFIX
DC 0 '' guard DOCS_COMMENTS='{"comments":[{"text":"No user-visible change: internal tooling only."}]}'
DC 2 'Merge a docs PR titled with YPER4-388' guard DOCS_TYPE=IMPROVE
# Duplicate path: the docs PR is titled with the fixing ticket; the comment exemption stays on the duplicate.
mkdir -p "$E/YPER4-390"; echo 888 > "$E/YPER4-390/pr"; echo YPER4-388 > "$E/YPER4-390/duplicate-of"
DOCS_TICKET=YPER4-390 DC 0 'docs ok (docs PR 42)' docs DOCS_PRS="$docs_pr"
DOCS_TICKET=YPER4-390 DC 1 'titled with YPER4-388' docs
DOCS_TICKET=YPER4-390 DC 0 'docs ok (no user-visible change)' docs DOCS_COMMENTS='{"comments":[{"text":"No user-visible change: duplicate of a docs-free fix."}]}'

# Manual worker deployments must bind the only active version to the full merge SHA.
mkdir -p "$E/worker-bin" "$E/worker-checkout/workers/docs-agent"
cat > "$E/worker-bin/gh" <<'MOCK'
#!/usr/bin/env bash
case "$1:$2" in
  pr:view)
    if [[ $* == *'--json title --jq'* ]]; then echo 'YPER4-999 [INFRA] Fixture'; exit; fi
    printf '{"number":838,"title":"YPER4-999 [INFRA] Fixture","state":"MERGED","mergeCommit":{"oid":"%s"},"baseRefName":"%s"}\n' "$WORKER_SHA" "$SHIP_BASE" ;;
  release:view) [ -n "${RELEASE_TAG:-}" ] && echo "$RELEASE_TAG" ;;
  release:list) [ "${RELEASE_ERROR:-0}" = 0 ] || exit 1; echo "${RELEASES_FIXTURE:-[]}" ;;
  api:*/compare/*) echo identical ;;
  *) exit 1 ;;
esac
MOCK
export XDG_CACHE_HOME="$E/worker-cache" NPX_LOG="$E/npx-log" FAKE_WRANGLER_MARKER="$E/fake-wrangler-invoked"
worker_config="$E/worker-checkout/workers/docs-agent/wrangler.toml"
printf 'name = "docs-agent_fixture"\naccount_id = "0123456789abcdef0123456789abcdef"\n' > "$worker_config"
cat > "$E/worker-bin/npx" <<'MOCK'
#!/usr/bin/env bash
jq -cn --arg cwd "$PWD" --arg account_id "${CLOUDFLARE_ACCOUNT_ID:-}" \
  '$ARGS.positional as $args | {cwd: $cwd, args: $args, account_id: $account_id}' --args -- "$@" >> "$NPX_LOG" || exit 1
# Model npx's vulnerable local executable lookup so the old implementation fails this regression.
if [[ -x node_modules/.bin/wrangler ]]; then exec node_modules/.bin/wrangler "$@"; fi
[[ $PWD == "${XDG_CACHE_HOME:-$HOME/.cache}/ship-check-wrangler" && $PWD != "$SHIP_CHECKOUT/"* ]] || exit 1
[[ ${CLOUDFLARE_ACCOUNT_ID:-} == 0123456789abcdef0123456789abcdef ]] || exit 1
case "$*" in
  "--yes wrangler@3.114.17 deployments status --name ${EXPECTED_WORKER_NAME:-docs-agent_fixture} --json")
    [ "${WRANGLER_ERROR:-0}" = 0 ] || exit 1; echo "$DEPLOYMENT_FIXTURE" ;;
  "--yes wrangler@3.114.17 versions view worker-version --name ${EXPECTED_WORKER_NAME:-docs-agent_fixture} --json")
    [ "${VERSION_ERROR:-0}" = 0 ] || exit 1; echo "$VERSION_FIXTURE" ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$E/worker-bin/"*
worker_sha=f2619e33637f2577b609be8b52234910ee61b802
worker_deployment='{"versions":[{"version_id":"worker-version","percentage":100}]}'
worker_version="{\"annotations\":{\"workers/message\":\"$worker_sha\"}}"
W() {
  local want=$1 expected=$2 out got; shift 2
  : > "$NPX_LOG"
  out=$(env PATH="$E/worker-bin:$PATH" SHIP_REPO=valentinyeo/agent-fleet SHIP_BASE=htpr-5009-mdx-write-guard-v2 SHIP_CHECKOUT="$E/worker-checkout" SHIP_WORKER=workers/docs-agent WORKER_SHA="$worker_sha" DEPLOYMENT_FIXTURE="$worker_deployment" VERSION_FIXTURE="$worker_version" "$@" ./ship-check deployed YPER4-999); got=$?
  if [ "$got" = "$want" ] && [[ $out == "$expected"* ]]; then ok "worker: $out"
  else bad "worker: want $want $expected got $got $out"; fi
}
W 0 'deployed ok (worker worker-version)'
jq -se --arg cwd "$XDG_CACHE_HOME/ship-check-wrangler" '
  length == 2 and all(.[]; .cwd == $cwd and .account_id == "0123456789abcdef0123456789abcdef")
  and .[0].args == ["--yes", "wrangler@3.114.17", "deployments", "status", "--name", "docs-agent_fixture", "--json"]
  and .[1].args == ["--yes", "wrangler@3.114.17", "versions", "view", "worker-version", "--name", "docs-agent_fixture", "--json"]
' "$NPX_LOG" >/dev/null && ok 'worker pinned npx cwd, args and account recorded' || bad 'worker npx invocation not isolated'
W 0 'deployed ok (worker worker-version)' XDG_CACHE_HOME= HOME="$E/worker-home"
W 0 'deployed ok (worker worker-version)' VERSION_FIXTURE="{\"annotations\":{\"workers/tag\":\"${worker_sha:0:12}\"}}"
W 1 'FAIL: worker version worker-version does not match merge' VERSION_FIXTURE='{"annotations":{"workers/message":"wrong","workers/tag":"wrong"}}'
W 1 'FAIL: worker version worker-version does not match merge' VERSION_FIXTURE="{\"annotations\":{\"workers/message\":\"${worker_sha:0:12}\",\"workers/tag\":\"$worker_sha\"}}"
W 1 'FAIL: worker version worker-version does not match merge' VERSION_FIXTURE='{}'
W 1 'FAIL: worker version worker-version does not match merge' VERSION_FIXTURE='invalid'
W 1 'FAIL: worker deployment must have exactly one version at 100%' DEPLOYMENT_FIXTURE='{"versions":[{"version_id":"worker-version","percentage":50},{"version_id":"other-version","percentage":50}]}'
W 1 'FAIL: worker deployment must have exactly one version at 100%' DEPLOYMENT_FIXTURE='{"versions":[{"version_id":"worker-version","percentage":100},{"version_id":"other-version","percentage":0}]}'
W 1 'FAIL: worker deployment must have exactly one version at 100%' DEPLOYMENT_FIXTURE='{"versions":[{"version_id":"worker-version","percentage":99}]}'
W 1 'FAIL: worker deployment must have exactly one version at 100%' DEPLOYMENT_FIXTURE='{"versions":[]}'
W 1 'FAIL: worker deployment must have exactly one version at 100%' DEPLOYMENT_FIXTURE='invalid'
W 1 'FAIL: could not read worker deployment' WRANGLER_ERROR=1
W 1 'FAIL: could not read worker version' VERSION_ERROR=1
W 1 'FAIL: no release found' SHIP_WORKER=
W 1 'FAIL: could not read releases' RELEASE_ERROR=1
W 1 'FAIL: no release found' RELEASES_FIXTURE='[{"tagName":"v1"}]'
W 1 'FAIL: set SHIP_CHECKOUT' SHIP_CHECKOUT=
W 1 'FAIL: SHIP_WORKER must be a relative worker directory' SHIP_WORKER=../worker
W 1 'FAIL: SHIP_WORKER must be a relative worker directory' SHIP_WORKER=/worker
W 0 'deployed ok (release v1)' RELEASE_TAG=v1 WRANGLER_ERROR=1

# A checkout-local fake would forge matching deployment data, but must never run.
mkdir -p "$E/worker-checkout/workers/docs-agent/node_modules/.bin"
cat > "$E/worker-checkout/workers/docs-agent/node_modules/.bin/wrangler" <<'MOCK'
#!/usr/bin/env bash
touch "$FAKE_WRANGLER_MARKER"
if [[ $* == *'deployments status'* ]]; then
  echo '{"versions":[{"version_id":"worker-version","percentage":100}]}'
else
  printf '{"annotations":{"workers/message":"%s"}}\n' "$WORKER_SHA"
fi
MOCK
chmod +x "$E/worker-checkout/workers/docs-agent/node_modules/.bin/wrangler"
control=$(WORKER_SHA="$worker_sha" "$E/worker-checkout/workers/docs-agent/node_modules/.bin/wrangler" deployments status --json)
[ -f "$FAKE_WRANGLER_MARKER" ] && [ "$control" = "$worker_deployment" ] \
  && ok 'fake wrangler positive control forges deployment and touches marker' || bad 'fake wrangler control not effective'
rm -f "$FAKE_WRANGLER_MARKER"
W 0 'deployed ok (worker worker-version)'
W 1 'FAIL: could not read worker deployment' WRANGLER_ERROR=1
W 1 'FAIL: worker version worker-version does not match merge' VERSION_FIXTURE='{}'
[ ! -e "$FAKE_WRANGLER_MARKER" ] && ok 'checkout fake never invoked; mock alone decides deployment' || bad 'checkout fake wrangler invoked'

cp "$worker_config" "$E/valid-wrangler.toml"
W 1 'FAIL: could not read worker wrangler.toml' SHIP_WORKER=missing
for config in \
  '' \
  'account_id = "0123456789abcdef0123456789abcdef"' \
  'name = "docs-agent_fixture"' \
  $'name = "bad.name"\naccount_id = "0123456789abcdef0123456789abcdef"' \
  $'name = "bad name"\naccount_id = "0123456789abcdef0123456789abcdef"' \
  $'name = ""\naccount_id = "0123456789abcdef0123456789abcdef"' \
  $'name = "docs-agent_fixture"\naccount_id = "0123456789ABCDEF0123456789ABCDEF"' \
  $'name = "docs-agent_fixture"\naccount_id = "0123456789abcdef0123456789abcde"' \
  $'name = "docs-agent_fixture"\naccount_id = "0123456789abcdef0123456789abcdef0"' \
  $'name = "docs-agent_fixture"\naccount_id = "not-an-account"' \
  $'[env.production]\nname = "docs-agent_fixture"\naccount_id = "0123456789abcdef0123456789abcdef"'; do
  printf '%s\n' "$config" > "$worker_config"
  W 1 'FAIL: '
  [ ! -s "$NPX_LOG" ] && ok 'invalid worker identity rejected before npx' || bad 'invalid identity reached npx'
done
printf 'name = "$(touch %s)"\naccount_id = "0123456789abcdef0123456789abcdef"\n' "$FAKE_WRANGLER_MARKER" > "$worker_config"
W 1 'FAIL: invalid worker name or account_id'
[ ! -e "$FAKE_WRANGLER_MARKER" ] && ok 'wrangler.toml parsed only as data' || bad 'wrangler.toml executed'
cp "$E/valid-wrangler.toml" "$worker_config"
echo 'name = "duplicate"' >> "$worker_config"
W 1 'FAIL: duplicate worker name'
cp "$E/valid-wrangler.toml" "$worker_config"
echo 'account_id = "0123456789abcdef0123456789abcdef"' >> "$worker_config"
W 1 'FAIL: duplicate worker account_id'
printf "  name = 'other_worker-2' # comment\naccount_id = '0123456789abcdef0123456789abcdef' # comment\n[vars]\nname = 'ignored'" > "$worker_config"
W 0 'deployed ok (worker worker-version)' EXPECTED_WORKER_NAME=other_worker-2
cp "$E/valid-wrangler.toml" "$worker_config"
W 1 'FAIL: invalid merge sha' WORKER_SHA=short
W 1 'FAIL: neutral wrangler directory must be outside SHIP_CHECKOUT' XDG_CACHE_HOME="$E/worker-checkout/cache"
for entry in package.json node_modules; do
  touch "$XDG_CACHE_HOME/ship-check-wrangler/$entry"
  W 1 'FAIL: neutral wrangler directory must be empty'
  rm -f "$XDG_CACHE_HOME/ship-check-wrangler/$entry"
done
for entry in package.json node_modules .git; do
  touch "$XDG_CACHE_HOME/$entry"
  W 1 'FAIL: neutral wrangler directory must be outside checkouts and local npm packages'
  rm -f "$XDG_CACHE_HOME/$entry"
done
mkdir -p "$E/linked-cache"
ln -s "$E/worker-checkout/workers/docs-agent" "$E/linked-cache/ship-check-wrangler"
W 1 'FAIL: unsafe neutral wrangler directory' XDG_CACHE_HOME="$E/linked-cache"
W 1 'FAIL: unsafe neutral wrangler directory' XDG_CACHE_HOME=relative-cache

# Done guards use segment worker settings, including ship-gates' quoted paths.
(
  export PATH="$E/worker-bin:$PATH" SHIP_REPO=valentinyeo/agent-fleet SHIP_BASE=htpr-5009-mdx-write-guard-v2
  export SHIP_CHECKOUT= SHIP_WORKER= WORKER_SHA="$worker_sha" DEPLOYMENT_FIXTURE="$worker_deployment" VERSION_FIXTURE="$worker_version"
  worker_env="SHIP_REPO=$SHIP_REPO SHIP_BASE=$SHIP_BASE"
  worker_cmd="$worker_env SHIP_CHECKOUT=$E/worker-checkout SHIP_WORKER=workers/docs-agent vcc task move YPER4-999 $DONE"
  G 0 "$worker_cmd"
  G 2 "$worker_env SHIP_CHECKOUT=$E/worker-checkout vcc task move YPER4-999 $DONE"
  G 2 "$worker_env SHIP_CHECKOUT=$E/worker-checkout vcc task move YPER4-999 $DONE # SHIP_WORKER=workers/docs-agent"
  G 2 "$worker_env SHIP_CHECKOUT=$E/worker-checkout vcc task move YPER4-999 $DONE SHIP_WORKER=workers/docs-agent"
  G 2 "$worker_env SHIP_WORKER=workers/docs-agent vcc task move YPER4-999 $DONE # SHIP_CHECKOUT=$E/worker-checkout"
  for prefix in 'FOO=pre"fix"' "FOO='a'b\"c\""; do
    G 0 "$prefix $worker_cmd"
    VERSION_FIXTURE='{}' G 2 "$prefix $worker_cmd"
  done
  G 2 "$worker_cmd && $worker_env SHIP_CHECKOUT=$E/worker-checkout vcc task move YPER4-999 $DONE"
  G 2 "$worker_cmd && $worker_env SHIP_WORKER=workers/docs-agent vcc task move YPER4-999 $DONE"
  mkdir -p "$E/worker checkout/workers/docs agent"
  cp "$worker_config" "$E/worker checkout/workers/docs agent/wrangler.toml"
  for quote in "'" '"'; do
    quoted_cmd="SHIP_REPO=${quote}$SHIP_REPO${quote} SHIP_BASE=${quote}$SHIP_BASE${quote} SHIP_CHECKOUT=${quote}$E/worker checkout${quote} SHIP_WORKER=${quote}workers/docs agent${quote} vcc task move YPER4-999 $DONE"
    G 0 "$quoted_cmd"
    VERSION_FIXTURE='{}' G 2 "$quoted_cmd"
    G 2 "$quoted_cmd && $worker_env SHIP_CHECKOUT=${quote}$E/worker checkout${quote} vcc task move YPER4-999 $DONE"
    G 2 "$quoted_cmd && $worker_env SHIP_WORKER=${quote}workers/docs agent${quote} vcc task move YPER4-999 $DONE"
  done
  mixed_cmd="SHIP_REPO=valentinyeo/'agent-'\"fleet\" SHIP_BASE=htpr-5009-'mdx-write-'\"guard-v2\" SHIP_CHECKOUT=$E/'worker '\"checkout\" SHIP_WORKER=workers/'docs '\"agent\" vcc task move YPER4-999 $DONE"
  G 0 "$mixed_cmd"
  VERSION_FIXTURE='{}' G 2 "$mixed_cmd"
  G 0 "$worker_env SHIP_CHECKOUT=$E/worker-checkout SHIP_WORKER=wrong SHIP_WORKER=workers/docs-agent vcc task move YPER4-999 $DONE"
  export SHIP_CHECKOUT="$E/worker-checkout" SHIP_WORKER=workers/docs-agent
  G 0 vcc task move YPER4-999 $DONE
  for suffix in SHIP_REPO=hypertask-ai/other SHIP_BASE=wrong SHIP_CHECKOUT=/nonexistent SHIP_WORKER=wrong; do
    G 0 "vcc task move YPER4-999 $DONE # $suffix"
    G 0 "vcc task move YPER4-999 $DONE $suffix"
  done
  G 2 "$worker_env SHIP_WORKER='' vcc task move YPER4-999 $DONE"
  G 2 "$worker_env SHIP_CHECKOUT=\"\" vcc task move YPER4-999 $DONE"
) > "$E/worker-guard-results"
cat "$E/worker-guard-results"
passes=$((passes + $(grep -c '^ok   ' "$E/worker-guard-results")))
fails=$((fails + $(grep -c '^FAIL ' "$E/worker-guard-results")))

# Generated worker CHECKs must carry the settings and remain safe to approve again.
python3 - "$PWD/ship-gates" "$HOME/.agents/skills/unlazy" "$E" <<'PY'
import os, pathlib, subprocess, sys
script, unlazy, tmp = sys.argv[1:]
p = pathlib.Path(tmp)
home = p / 'gate-home'
ship = home / '.agents/skills/ship/scripts'
ship.mkdir(parents=True)
(home / '.agents/skills/unlazy').symlink_to(unlazy, target_is_directory=True)
check = ship / 'ship-check'
check.write_text('''#!/usr/bin/env python3
import os, sys
assert os.environ['SHIP_REPO'] == 'valentinyeo/agent-fleet'
assert os.environ['SHIP_BASE'] == 'htpr-5009-mdx-write-guard-v2'
assert os.environ['SHIP_CHECKOUT'] == '/tmp/worker checkout'
assert os.environ['SHIP_WORKER'] == 'workers/docs agent'
print(dict(ticket='ticket ok', deeper='deeper ok', pr='title ok', merged='merged ok',
           deployed='deployed ok (worker fixture)', docs='docs ok', done='done ok', cleaned='cleaned ok')[sys.argv[1]])
''')
check.chmod(0o755)
repo = p / 'gate-repo'
repo.mkdir()
approval = p / 'gate-approvals'
approval.mkdir(mode=0o700)
env = dict(os.environ, HOME=str(home), UNLAZY_APPROVAL_DIR=str(approval),
           CLAUDE_CODE_SESSION_ID='worker-gates-fixture', SHIP_REPO='valentinyeo/agent-fleet',
           SHIP_BASE='htpr-5009-mdx-write-guard-v2', SHIP_CHECKOUT='/tmp/worker checkout',
           SHIP_WORKER='workers/docs agent')
for _ in range(2):
    r = subprocess.run(['bash', script, 'YPER4-999'], cwd=repo, env=env, text=True, capture_output=True)
    assert r.returncode == 0 and 'ALL MET' in r.stderr, r.stdout + r.stderr
ledger = repo / '.unlazy/s-worker-g/GATES.md'
text = ledger.read_text()
prefix = "SHIP_REPO=valentinyeo/agent-fleet SHIP_BASE=htpr-5009-mdx-write-guard-v2 SHIP_CHECKOUT='/tmp/worker checkout' SHIP_WORKER='workers/docs agent' "
assert text.count('  CHECK: ' + prefix) == 8
assert text.count('automatic-evidence=v1') == 8
assert 'YPER4-999.docs:' in text
for worker in ['/absolute', '../outside', "workers/a';touch bad"]:
    r = subprocess.run(['bash', script, 'YPER4-999'], cwd=repo,
                       env=dict(env, SHIP_WORKER=worker), text=True, capture_output=True)
    assert r.returncode != 0 and 'SHIP_WORKER must be a relative worker directory' in r.stderr
    assert ledger.read_text() == text
print('worker CHECK persistence passed')
PY
[ "$?" = 0 ] && ok 'worker CHECK persistence and validation' || bad 'worker CHECK persistence and validation'

# Duplicates: HTPR-6823 was fixed by HTPR-6801's merged PR 837.
./ship-check duplicate HTPR-6823 HTPR-6801 830 >/dev/null && bad "duplicate accepted another ticket's PR" || ok "duplicate rejects a PR of another ticket"
mkdir -p "$E/HTPR-6823" && echo 999 > "$E/HTPR-6823/dropped"
./ship-check duplicate HTPR-6823 HTPR-6801 837 >/dev/null && ok "duplicate binds HTPR-6823 to PR 837" || bad "duplicate bind"
[ ! -e "$E/HTPR-6823/dropped" ] && ok "duplicate clears a stale dropped record" || bad "duplicate kept a dropped record"
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

fi

# Released-flag premerge guard: deterministic GitHub and live-mode boundaries.
mkdir -p "$E/flag-bin" "$E/flag-source" "$E/flag-http" "$E/YPER4-999"
cat > "$E/flag-bin/gh" <<'MOCK'
#!/usr/bin/env python3
import base64, json, os, sys, urllib.parse
args = sys.argv[1:]
if os.environ.get('FLAG_LOG'):
    with open(os.environ['FLAG_LOG'], 'a') as log:
        log.write(json.dumps(args) + '\n')
if args[:2] == ['api', '-i'] and '/pulls?' in args[2]:
    if os.environ.get('FLAG_LIST_ERROR'):
        sys.exit(1)
    if args[3:] == ['-H', 'If-None-Match: "fixture"']:
        print('HTTP/2.0 304 Not Modified\r\nEtag: "fixture"\r\n\r\n')
        sys.exit(1)
    print('HTTP/2.0 200 OK\r\nEtag: "fixture"\r\n\r\n' + json.dumps([{'number': 999, 'title': 'YPER4-999 [BUGFIX] Fixture', 'head': {'sha': 'a' * 40}}]))
    sys.exit(0)
if args[:2] == ['pr', 'view']:
    if args[args.index('--json') + 1] == 'headRefOid,baseRefName,state':
        if os.environ.get('FLAG_HEAD_ERROR'):
            sys.exit(1)
        calls = sum('headRefOid' in line for line in open(os.environ['FLAG_LOG'])) if os.environ.get('FLAG_LOG') else 1
        if os.environ.get('FLAG_PR_STATE', 'OPEN') != 'OPEN' or os.environ.get('FLAG_BASE', 'production') != 'production' or (os.environ.get('FLAG_BASE_RACE') and calls > 1):
            sys.exit(0)
        if os.environ.get('FLAG_ASSERT_LOCK'):
            import fcntl
            with open(os.environ['PREMERGE_STATUS_STATE'] + '/publish.lock', 'w') as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    pass
                else:
                    sys.exit(1)
        print('c' * 40 if os.environ.get('FLAG_HEAD_RACE') and calls > 1 else os.environ.get('FLAG_HEAD', 'a' * 40))
        sys.exit(0)
    title = 'YPER4-999 [' + os.environ.get('FLAG_TYPE', 'BUGFIX') + '] Fixture'
    if args[args.index('--json') + 1] == 'title':
        print(title)
    else:
        print(json.dumps({'number': 999, 'title': title, 'state': os.environ.get('FLAG_PR_STATE', 'OPEN'), 'mergeCommit': {'oid': 'a' * 40}, 'baseRefName': 'production'}))
    sys.exit(0)
if any('/contents/' in a for a in args):
    # YPER4-251: the contents API is never called; files come from local git. The call is logged above and fails the run.
    sys.exit(99)
if args[0] != 'api':
    sys.exit(1)
url = args[1]
# Keep this suite focused on premerge evidence, with a passing current-head CI check.
if url.endswith('/pulls/999') and '--jq' in args:
    print(os.environ.get('FLAG_HEAD', 'a' * 40))
    sys.exit(0)
if '/check-runs?' in url:
    print(json.dumps({'check_runs': [{'id': 1, 'name': 'ci-tests', 'status': 'completed', 'conclusion': 'success'}]}))
    sys.exit(0)
if os.environ.get('FLAG_ASSERT_FRESH') and '/pulls/' in url:
    assert urllib.parse.parse_qs(urllib.parse.urlsplit(url).query).get('premerge'), 'mutable PR read must be fresh'
if os.environ.get('FLAG_ASSERT_LOCK'):
    import fcntl
    with open(os.environ['PREMERGE_STATUS_STATE'] + '/publish.lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            pass
        else:
            sys.exit(1)
if '/statuses/' in url:
    if os.environ.get('FLAG_BLOCK_POST'):
        with open(os.environ['FLAG_BLOCK_POST'] + '/ready', 'w') as ready:
            ready.write('ready')
        with open(os.environ['FLAG_BLOCK_POST'] + '/release') as release:
            release.read()
    sys.exit(1 if os.environ.get('FLAG_POST_ERROR') else 0)
if os.environ.get('FLAG_GH_ERROR'):
    sys.exit(1)
if '/files?' in url:
    assert '--paginate' in args
    if os.environ.get('FLAG_FILES_ERROR'):
        sys.exit(1)
    file = {'filename': os.environ.get('FLAG_FILE', 'src/components/card.tsx'), 'status': os.environ.get('FLAG_STATUS', 'modified')}
    if file['status'] == 'renamed':
        file['previous_filename'] = os.environ.get('FLAG_PREVIOUS_FILE', 'src/components/old-card.tsx')
    files = [file]
    files.extend({'filename': path, 'status': 'modified'} for path in filter(None, os.environ.get('FLAG_EXTRA_FILES', '').split(',')))
    files.extend({'filename': f'docs/file-{i}.md', 'status': 'modified'} for i in range(int(os.environ.get('FLAG_PADDING', '0'))))
    for path in filter(None, os.environ.get('FLAG_REMOVED_DEFINITION', '').split(',')):
        files.append({'filename': path, 'status': 'removed'})
    print(json.dumps(files))
    if os.environ.get('FLAG_PAGE2'):
        print(json.dumps([{'filename': os.environ.get('FLAG_PAGE2_FILE', 'AGENTS.md'), 'status': 'modified'}]))
else:
    print(json.dumps({'head': {'sha': os.environ.get('FLAG_HEAD', 'a' * 40)}, 'base': {'sha': os.environ.get('FLAG_BASE_SHA', 'b' * 40)}, 'title': 'YPER4-999 [BUGFIX] Fixture', 'changed_files': int(os.environ.get('FLAG_COUNT', '1'))}))
MOCK
# Fake git for the local PR source cache: `fetch` marks the cache filled, `show <sha>:<path>` serves FLAG_SOURCE files.
cat > "$E/flag-bin/fakegit" <<'MOCK'
#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if os.environ.get('FLAG_LOG'):
    with open(os.environ['FLAG_LOG'], 'a') as log:
        log.write(json.dumps(['git'] + args) + '\n')
if args[:2] == ['init', '--bare']:
    os.makedirs(args[-1], exist_ok=True)
    open(args[-1] + '/HEAD', 'w').close()
    sys.exit(0)
cache, cmd, rest = args[1], args[2], args[3:]
marker = cache + '/filled'
if cmd == 'fetch':
    if os.environ.get('FLAG_FETCH_ERROR'):
        sys.exit(1)
    open(marker, 'w').close()
    sys.exit(0)
if cmd == 'cat-file':
    sys.exit(0 if os.path.exists(marker) else 1)
if cmd == 'ls-tree':
    if os.environ.get('FLAG_SOURCE_ERROR'):
        sys.exit(1)
    ref, path = rest[-2], rest[-1]
    if path.rstrip('/') != 'src/lib/flags/definitions':
        sys.exit(1)
    folder = os.environ['FLAG_SOURCE'] + '/flags-' + ('base' if ref == os.environ.get('FLAG_BASE_SHA', 'b' * 40) else 'head')
    sys.stdout.write(''.join('100644 blob %s\t%s/%s\0' % ('0' * 40, path.rstrip('/'), n) for n in sorted(os.listdir(folder))))
    sys.exit(0)
if cmd == 'show':
    if os.environ.get('FLAG_SOURCE_ERROR'):
        sys.exit(1)
    ref, path = rest[0].split(':', 1)
    if ref.startswith('refs/premerge/production'):
        sys.stdout.write(open('ship-check').read())
        sys.exit(0)
    if path.startswith('src/lib/flags/definitions/'):
        name = 'flags-' + ('base' if ref == os.environ.get('FLAG_BASE_SHA', 'b' * 40) else 'head') + '/' + path.rsplit('/', 1)[1]
        sys.stdout.write(open(os.environ['FLAG_SOURCE'] + '/' + name).read())
        sys.exit(0)
    if path == 'src/lib/flags/releaseRisk.ts':
        risk = os.environ['FLAG_SOURCE'] + '/risk-' + ('base' if ref == os.environ.get('FLAG_BASE_SHA', 'b' * 40) else 'head')
        if not os.path.exists(risk):
            sys.exit(128)
        sys.stdout.write(open(risk).read())
        sys.exit(0)
    name = {'src/lib/flags.ts': 'registry', 'src/lib/flags/definitions.ts': 'definitions', 'src/lib/flags/keys.ts': 'keys'}.get(path, 'base' if ref == 'b' * 40 else 'head')
    if name == 'keys' and ref == 'a' * 40 and os.path.exists(os.environ['FLAG_SOURCE'] + '/keys-head'):
        name = 'keys-head'
    sys.stdout.write(open(os.environ['FLAG_SOURCE'] + '/' + name).read())
    sys.exit(0)
sys.exit(1)
MOCK
cat > "$E/flag-bin/hypertask" <<'MOCK'
#!/usr/bin/env bash
echo '{"success":true,"tasks":[{"id":1}]}'
MOCK
cat > "$E/flag-http/sitecustomize.py" <<'MOCK'
import io, os, urllib.request
def live(request, timeout):
    if request.full_url == 'https://app.hypertask.ai/api/flags':
        assert request.get_header('Cookie') == 'session=plain'
        if not os.environ.get('FLAG_PUBLIC'):
            raise OSError('no plain QA view')
        return io.BytesIO(os.environ['FLAG_PUBLIC'].encode())
    assert request.full_url == 'https://app.hypertask.ai/api/admin/flags'
    assert request.get_header('Authorization') == 'Bearer fixture'
    if os.environ.get('FLAG_HTTP_ERROR'):
        raise OSError('unreachable')
    return io.BytesIO(os.environ.get('FLAG_HTTP', '{"flags":[{"key":"htpr-1-released","mode":"EVERYONE"}]}').encode())
urllib.request.urlopen = live
MOCK
chmod +x "$E/flag-bin/gh" "$E/flag-bin/hypertask" "$E/flag-bin/fakegit"
export SHIP_GIT="$E/flag-bin/fakegit" SHIP_GIT_CACHE="$E/git-cache" GH_PAUSE_FILE="$E/no-pause"
printf '{"cookies":[{"name":"session","value":"plain","domain":"app.hypertask.ai"}]}' > "$E/plain-state.json"
export SHIP_CHECK_PLAIN_QA_STATE="$E/plain-state.json"
printf 'export const RELEASED_FLAG = "htpr-1-released";\n' > "$E/flag-source/keys"
printf 'const FEATURE_FLAG_DEFINITIONS = [{ key: RELEASED_FLAG } ] as const;\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n' > "$E/flag-source/registry"
printf 'const released = useFlag(RELEASED_FLAG);\n' > "$E/flag-source/base"
cp "$E/flag-source/base" "$E/flag-source/head"
F() {
  local want=$1 expected=$2 out got; shift 2
  out=$(echo '{"tool_input":{"command":"gh pr merge 999"}}' | env PATH="$E/flag-bin:$PATH" PYTHONPATH="$E/flag-http" FLAG_SOURCE="$E/flag-source" SHIP_CHECK_PLAIN_QA_STATE="$E/plain-state.json" AGENT_TOKEN=fixture HYPERTASKS_JWT_TOKEN= "$@" ./ship-check guard 2>&1); got=$?
  if [ "$got" = "$want" ] && [[ $out == *"$expected"* ]]; then ok "released flag: $want $expected $*"
  else bad "released flag: want $want $expected got $got $out"; fi
}
F 2 'record a browser click-through'
for type in BUGFIX INFRA REFACTOR FEATURE; do F 2 'record a browser click-through' FLAG_TYPE="$type"; done
F 0 '' FLAG_HTTP='{"flags":[{"key":"htpr-1-released","mode":"OWNER_AND_QA"}]}'
F 0 '' FLAG_HTTP='{"flags":[{"key":"htpr-1-released","mode":"OFF"}]}'
F 2 'registry defaults cannot prove' FLAG_HTTP_ERROR=1
F 2 'registry defaults cannot prove' AGENT_TOKEN=
# The base registry may keep runtime defaults while definitions live in their own module.
cp "$E/flag-source/registry" "$E/flag-source/definitions"
printf 'const DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n' > "$E/flag-source/registry"
F 0 '' FLAG_HTTP='{"flags":[{"key":"htpr-1-released","mode":"OWNER_AND_QA"}]}'
F 2 'record a browser click-through'
F 2 'registry defaults cannot prove' FLAG_HTTP_ERROR=1
printf 'export type FeatureFlagKind = "feature";\n' > "$E/flag-source/definitions"
F 2 'cannot resolve flag registry defaults'
printf 'const FEATURE_FLAG_DEFINITIONS = [{ key: RELEASED_FLAG } ] as const;\nconst DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n' > "$E/flag-source/registry"
F 0 '' FLAG_HTTP='{"flags":[{"key":"htpr-1-released","mode":"OWNER_AND_QA"}]}'
rm "$E/flag-source/definitions"
# Without the owner-only endpoint, the plain QA account's view decides: on for it means on for Everyone.
F 2 'record a browser click-through' AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":true}}'
F 0 '' AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":false}}'
F 2 'registry defaults cannot prove' AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":"yes"}}'
# A dynamic read forces evidence; NOT_EVERYONE is accepted only where the plain QA read shows the flag off.
printf 'const released = useFlag(RELEASED_FLAG);\nconst other = useFlag(dynamicKey);\n' > "$E/flag-source/head"
printf 'Commit: %s\nAccount: 985 QA\nFlags: htpr-1-released=NOT_EVERYONE\nBoard: http://127.0.0.1:3100/projects/project-1\nBuild: http://127.0.0.1:3100\nClick: PASS opens\nRecording: v.webm\n' "$(printf 'a%.0s' {1..40})" > "$E/YPER4-999/premerge.md"; printf x > "$E/YPER4-999/v.webm"
F 0 '' FLAG_STATUS=added AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":false}}'
F 2 'expected Flags: htpr-1-released=EVERYONE' FLAG_STATUS=added AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":true}}'
F 2 'expected Flags: htpr-1-released=EVERYONE' FLAG_STATUS=added
rm "$E/YPER4-999/premerge.md" "$E/YPER4-999/v.webm"; cp "$E/flag-source/base" "$E/flag-source/head"
# A flag the PR adds itself is not in the base registry and starts unreleased.
printf 'const added = useFlag("htpr-2-new");\n' > "$E/flag-source/head"
F 2 'unresolved flag reads' FLAG_STATUS=added AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":true}}' # not defined by the PR
printf 'export const RELEASED_FLAG = "htpr-1-released";\nexport const NEW_FLAG = "htpr-2-new";\n' > "$E/flag-source/keys-head"
F 0 '' FLAG_STATUS=added AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":true}}'
rm "$E/flag-source/keys-head"
cp "$E/flag-source/base" "$E/flag-source/head"
sed -i 's/OWNER_AND_QA/EVERYONE/' "$E/flag-source/registry"
F 2 'record a browser click-through' FLAG_HTTP_ERROR=1
F 2 'record a browser click-through' AGENT_TOKEN=
F 2 'record a browser click-through' FLAG_HTTP='invalid'
F 2 'record a browser click-through' FLAG_HTTP='{"flags":[{"key":"htpr-1-released","mode":"invalid"}]}'
F 0 '' FLAG_HTTP='{"flags":[{"key":"htpr-1-released","mode":"OWNER_ONLY"}]}'
# Exact head, account, flag states and a recording are required.
head=$(printf 'a%.0s' {1..40})
premerge="$E/YPER4-999/premerge.md"
cat > "$premerge" <<RECORD
Commit: $head
Account: 985 QA
Flags: htpr-1-released=EVERYONE
Board: https://app.hypertask.ai/projects/project-7283
Build: http://localhost:3000
Click: PASS card opens the expected title and body and stays open
Recording: click.webm
RECORD
F 2 'recording must be non-empty'
printf 'recording fixture' > "$E/YPER4-999/click.webm"
F 0 ''
F 2 'live flag modes unavailable' FLAG_HTTP_ERROR=1
# Hookless commands use the same current-head guard; merged records stay valid.
P() {
  local want=$1 mode=$2 id=$3 out got; shift 3
  out=$(env PATH="$E/flag-bin:$PATH" PYTHONPATH="$E/flag-http" FLAG_SOURCE="$E/flag-source" AGENT_TOKEN=fixture HYPERTASKS_JWT_TOKEN= "$@" ./ship-check "$mode" "$id" 2>&1); got=$?
  if [ "$got" = "$want" ]; then ok "manual $mode: $got"
  else bad "manual $mode: want $want got $got $out"; fi
}
echo 999 > "$E/YPER4-999/pr"
P 0 premerge 999
P 0 pr YPER4-999
# Use the seed's board path and premerge-local's actual print block, not a hand-written URL.
board_line=$(node - "$(cd ../../../.. && pwd)" <<'JS'
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = process.argv[2];
const seed = fs.readFileSync(root + '/scripts/seed-browser-smoke.mjs', 'utf8');
const board_path = seed.match(/board_path=([^\\]+)\\n/)[1].replace('${board.id}', '7283');
const script = fs.readFileSync(root + '/scripts/premerge-local.sh', 'utf8');
const start = script.indexOf("printf 'Build URL:");
const print = script.slice(start, script.indexOf("\n# Keep the owning run alive", start));
const result = spawnSync('bash', ['-c', print], { encoding: 'utf8', env: {
  ...process.env, url: 'http://127.0.0.1:3100', board_path,
  BROWSER_SMOKE_STATE_FILE: '/unused', account: '985', flags: 'htpr-1-released=EVERYONE',
}, stdio: ['ignore', 'pipe', 'pipe', 'pipe'] });
if (result.status !== 0) throw new Error(result.stderr);
console.log(result.output[3].split('\n').find(line => line.startsWith('Board:')));
JS
)
[ -n "$board_line" ] || bad 'premerge-local emitted no Board line'
BOARD_LINE="$board_line" node - "$premerge" <<'JS'
const fs = require('node:fs');
fs.writeFileSync(process.argv[2], fs.readFileSync(process.argv[2], 'utf8').replace(/^Board:.*$/m, () => process.env.BOARD_LINE));
JS
P 0 premerge 999
cp "$premerge" "$E/record"
# The new layout resolves readers and changed definition files without a committed index.
cp "$E/flag-source/keys" "$E/keys-legacy"; cp "$E/flag-source/registry" "$E/registry-legacy"
mkdir -p "$E/flag-source/flags-base" "$E/flag-source/flags-head"
printf 'export * from "./definitions/index.generated";\n' > "$E/flag-source/keys"
printf 'export const RELEASED_FLAG = "htpr-1-released";\nexport default { key: RELEASED_FLAG, kind: "bugfix", shippedOn: "2026-10-10", description: "Fixture" } as const;\n' > "$E/flag-source/flags-base/htpr-1-released.ts"
cp "$E/flag-source/flags-base/htpr-1-released.ts" "$E/flag-source/flags-head/htpr-1-released.ts"
printf 'const DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n' > "$E/flag-source/registry"
printf 'export const FEATURE_FLAG_DEFINITIONS = FLAG_DEFINITIONS;\n' > "$E/flag-source/definitions"
F 0 ''
F 2 'record a browser click-through' FLAG_HTTP_ERROR=1
F 0 '' FLAG_FILE=src/lib/flags/definitions/htpr-1-released.ts FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
sed 's/Commit:.*/Commit: deadbeef/' "$E/record" > "$premerge"
F 2 'must name PR head sha' FLAG_FILE=src/lib/flags/definitions/htpr-1-released.ts FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
cp "$E/record" "$premerge"
# A new bugfix flag defaults to Everyone, so it is released on merge and needs its own click state.
printf 'export const NEW_FIX_FLAG = "htpr-9-newfix";\nexport default { key: NEW_FIX_FLAG, kind: "bugfix", shippedOn: "2026-10-10", description: "Fixture" } as const;\n' > "$E/flag-source/flags-head/htpr-9-newfix.ts"
F 2 'expected Flags: htpr-9-newfix=EVERYONE' FLAG_FILE=src/lib/flags/definitions/htpr-9-newfix.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
sed 's/^Flags:.*/&, htpr-9-newfix=EVERYONE/' "$E/record" > "$premerge"
F 0 '' FLAG_FILE=src/lib/flags/definitions/htpr-9-newfix.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
# New eligible definitions must explicitly declare Everyone; existing definitions keep their modes.
for kind in feature improvement ''; do
  printf 'export const NEW_FEATURE_FLAG = "htpr-8-newfeature";\nexport default { key: NEW_FEATURE_FLAG, %s shippedOn: "2026-10-20", description: "Fixture" } as const;\n' "${kind:+kind: \"$kind\",}" > "$E/flag-source/flags-head/htpr-8-newfeature.ts"
  F 2 'new flag htpr-8-newfeature must set defaultMode: "EVERYONE"' FLAG_FILE=src/lib/flags/definitions/htpr-8-newfeature.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
done
printf 'export const NEW_FEATURE_FLAG = "htpr-8-newfeature";\nexport default { key: NEW_FEATURE_FLAG, kind: "feature", shippedOn: "2026-10-20", description: "Fixture", releaseRisk: { risk: "new", reason: "No highRisk: category applies" } } as const;\n' > "$E/flag-source/flags-head/htpr-8-newfeature.ts"
F 2 'must set defaultMode: "EVERYONE"' FLAG_FILE=src/lib/flags/definitions/htpr-8-newfeature.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
printf 'export const NEW_FEATURE_FLAG = "htpr-8-newfeature";\n/* highRisk: access */\nexport default { key: NEW_FEATURE_FLAG, kind: "feature", // kind: "internal"\n shippedOn: "2026-10-20", description: "Fixture" } as const;\n' > "$E/flag-source/flags-head/htpr-8-newfeature.ts"
F 2 'must set defaultMode: "EVERYONE"' FLAG_FILE=src/lib/flags/definitions/htpr-8-newfeature.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
printf 'export const NEW_FEATURE_FLAG = "htpr-8-newfeature";\nexport default { key: NEW_FEATURE_FLAG, kind: "feature", defaultMode: "EVERYONE", shippedOn: "2026-10-20", description: "Fixture" } as const;\n' > "$E/flag-source/flags-head/htpr-8-newfeature.ts"
F 2 'expected Flags: htpr-8-newfeature=EVERYONE' FLAG_FILE=src/lib/flags/definitions/htpr-8-newfeature.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
sed 's/^Flags:.*/&, htpr-8-newfeature=EVERYONE/' "$premerge" > "$E/feature-record"
cp "$premerge" "$E/before-feature-record"; cp "$E/feature-record" "$premerge"
F 0 '' FLAG_FILE=src/lib/flags/definitions/htpr-8-newfeature.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
cp "$E/before-feature-record" "$premerge"
printf 'export const NEW_FEATURE_FLAG = "htpr-8-newfeature";\nexport default { key: NEW_FEATURE_FLAG, kind: "feature", defaultMode: "OWNER_AND_QA", shippedOn: "2026-10-20", description: "Fixture", releaseRisk: { risk: "new", reason: "Fixture", highRisk: "access" } } as const;\n' > "$E/flag-source/flags-head/htpr-8-newfeature.ts"
F 0 '' FLAG_FILE=src/lib/flags/definitions/htpr-8-newfeature.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
sed -i 's/OWNER_AND_QA/EVERYONE/' "$E/flag-source/flags-head/htpr-8-newfeature.ts"
F 2 'may not default to Everyone' FLAG_FILE=src/lib/flags/definitions/htpr-8-newfeature.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
printf 'export const NEW_FEATURE_FLAG = "htpr-8-newfeature";\nexport default { key: NEW_FEATURE_FLAG, kind: "internal", shippedOn: "2026-10-20", description: "Fixture" } as const;\n' > "$E/flag-source/flags-head/htpr-8-newfeature.ts"
F 0 '' FLAG_FILE=src/lib/flags/definitions/htpr-8-newfeature.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
sed -i 's/kind: "internal"/kind: "internal", defaultMode: "EVERYONE"/' "$E/flag-source/flags-head/htpr-8-newfeature.ts"
F 2 'may not default to Everyone' FLAG_FILE=src/lib/flags/definitions/htpr-8-newfeature.ts FLAG_STATUS=added FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
rm "$E/flag-source/flags-head/htpr-8-newfeature.ts"
printf 'export const RELEASED_FLAG = "htpr-1-released";\nexport default { key: RELEASED_FLAG, kind: "feature", shippedOn: "2026-10-10", description: "Fixture" } as const;\n' > "$E/flag-source/flags-base/htpr-1-released.ts"
cp "$E/flag-source/flags-base/htpr-1-released.ts" "$E/flag-source/flags-head/htpr-1-released.ts"
F 0 ''
# YPER4-251: a registry of several per-flag files is listed and read through local git, with 0 contents API calls.
for d in base head; do printf 'export const OTHER_FLAG = "htpr-2-other";\nexport default { key: OTHER_FLAG, kind: "bugfix", shippedOn: "2026-10-10", description: "Fixture" } as const;\n' > "$E/flag-source/flags-$d/htpr-2-other.ts"; done
: > "$E/status-log"
F 0 '' FLAG_LOG="$E/status-log"
python3 - "$E/status-log" <<'PY' && ok 'per-flag directory: 0 contents calls, listed through git' || bad 'per-flag directory used the contents API or skipped git'
import json, sys
calls = [json.loads(l) for l in open(sys.argv[1])]
assert not any('/contents/' in a for c in calls for a in c), 'contents API called'
assert any(c[0] == 'git' and 'ls-tree' in c for c in calls), 'directory not listed through git'
assert sum(c[0] == 'git' and 'show' in c and any('definitions/htpr-' in a for a in c) for c in calls) >= 2, 'per-flag files not read through git'
PY
rm "$E/flag-source/flags-base/htpr-2-other.ts" "$E/flag-source/flags-head/htpr-2-other.ts"
cp "$E/record" "$premerge"; rm "$E/flag-source/flags-head/htpr-9-newfix.ts"
cp "$E/keys-legacy" "$E/flag-source/keys"; cp "$E/registry-legacy" "$E/flag-source/registry"
rm "$E/flag-source/definitions"

for change in \
  's/^Commit:.*/Commit: deadbeef/|must name PR head sha' \
  '/^Account:/d|missing Account:' \
  's/^Account:.*/Account: /|missing Account:' \
  '/^Flags:/d|missing Flags:; expected Flags: htpr-1-released=EVERYONE' \
  's/=EVERYONE/=OFF/|expected Flags: htpr-1-released=EVERYONE' \
  's/=EVERYONE/=EVERYONE-invalid/|expected Flags: htpr-1-released=EVERYONE' \
  '/^Board:/d|missing Board:' \
  's@^Board:.*@Board: http://127.0.0.1:3100/demo@|real board URL' \
  's@^Board:.*@Board: http://127.0.0.1:3100/project?surface=board@|real board URL' \
  's@^Board:.*@Board: http://127.0.0.1:3100/project?id=0@|real board URL' \
  's@^Board:.*@Board: http://127.0.0.1:3100/project?id=1\&id=2@|real board URL' \
  '/^Build:/d|missing Build:' \
  's/Click: PASS/Click: FAIL/|missing passing click' \
  '/^Recording:/d|missing passing click' \
  's/click.webm/..\/record/|recording must be non-empty' \
  's/click.webm/missing.webm/|recording must be non-empty'; do
  sed "${change%%|*}" "$E/record" > "$premerge"
  F 2 "${change#*|}"
done
cp "$E/record" "$premerge"
# premerge-local records only released flags. Live non-Everyone flags may be omitted.
printf 'const released = useFlag(RELEASED_FLAG);\nconst other = useFlag("htpr-2-other");\n' > "$E/flag-source/head"
for mode in OFF OWNER_ONLY OWNER_AND_QA; do
  live_modes="{\"flags\":[{\"key\":\"htpr-1-released\",\"mode\":\"EVERYONE\"},{\"key\":\"htpr-2-other\",\"mode\":\"$mode\"}]}"
  F 0 '' FLAG_HTTP="$live_modes"
  sed 's/htpr-1-released=EVERYONE/htpr-1-released=EVERYONE, htpr-2-other=EVERYONE/' "$E/record" > "$premerge"
  F 2 "expected Flags: htpr-2-other=$mode" FLAG_HTTP="$live_modes"
  sed "s/htpr-2-other=EVERYONE/htpr-2-other=$mode/" "$premerge" > "$E/matching-record"
  cp "$E/matching-record" "$premerge"
  F 0 '' FLAG_HTTP="$live_modes"
  cp "$E/record" "$premerge"
done
F 0 '' AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":true,"htpr-2-other":false}}'
F 2 'expected Flags: htpr-2-other=EVERYONE' FLAG_HTTP='{"flags":[{"key":"htpr-1-released","mode":"EVERYONE"},{"key":"htpr-2-other","mode":"EVERYONE"}]}'
F 2 'live state unknown for htpr-2-other'
F 2 'live flag modes unavailable' FLAG_HTTP_ERROR=1
F 2 'live flag modes unavailable' AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":true,"htpr-2-other":"unknown"}}'
sed 's/htpr-1-released=EVERYONE/htpr-1-released=EVERYONE, htpr-2-other=EVERYONE/' "$E/record" > "$premerge"
F 2 'expected Flags: htpr-2-other=NOT_EVERYONE' AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":true,"htpr-2-other":false}}'
sed 's/htpr-2-other=EVERYONE/htpr-2-other=NOT_EVERYONE/' "$premerge" > "$E/matching-record"
cp "$E/matching-record" "$premerge"
F 0 '' AGENT_TOKEN= FLAG_PUBLIC='{"flags":{"htpr-1-released":true,"htpr-2-other":false}}'
# Unknown live keys are still allowed only for a flag newly defined by this PR.
printf 'export const RELEASED_FLAG = "htpr-1-released";\nexport const NEW_FLAG = "htpr-2-other";\n' > "$E/flag-source/keys-head"
sed 's/htpr-2-other=NOT_EVERYONE/htpr-2-other=OWNER_AND_QA/' "$premerge" > "$E/matching-record"
cp "$E/matching-record" "$premerge"
F 0 ''
rm "$E/flag-source/keys-head"
cp "$E/record" "$premerge"
# Whole files, server reads, literals, removed reads and renames are covered.
printf 'const released = isFeatureEnabled(\n  "htpr-1-released", userId);\n' > "$E/flag-source/base"
printf 'const changed = 1;\n' > "$E/flag-source/head"
rm "$premerge"
P 1 premerge 999
P 1 pr YPER4-999
P 0 pr YPER4-999 FLAG_PR_STATE=MERGED FLAG_GH_ERROR=1
F 2 'record a browser click-through'
F 2 'record a browser click-through' FLAG_STATUS=removed
F 2 'record a browser click-through' FLAG_STATUS=renamed
F 2 'record a browser click-through' FLAG_STATUS=renamed FLAG_FILE=docs/card.md
F 0 '' FLAG_STATUS=added
printf 'import { useFlag as enabled } from "@/hooks/useFlag";\nconst released = enabled(RELEASED_FLAG);\n' > "$E/flag-source/head"
F 2 'record a browser click-through' FLAG_STATUS=added
F 2 'record a browser click-through' FLAG_STATUS=added FLAG_COUNT=2 FLAG_PAGE2=1
printf 'const released = useFlag(dynamicKey);\n' > "$E/flag-source/head"
F 2 'unresolved flag reads' FLAG_STATUS=added
printf 'const released = useFlag("htpr-2-new");\n' > "$E/flag-source/head"
F 2 'unresolved flag reads' FLAG_STATUS=added
printf 'export const RELEASED_FLAG = "htpr-1-released";\nexport const NEW_FLAG = "htpr-2-new";\n' > "$E/flag-source/keys-head"
F 0 '' FLAG_STATUS=added # A flag the PR defines starts unreleased.
rm "$E/flag-source/keys-head"
F 2 'cannot read the PR diff' FLAG_GH_ERROR=1
F 2 'cannot read the PR diff' FLAG_SOURCE_ERROR=1
F 2 'complete PR diff' FLAG_COUNT=2
F 0 '' FLAG_FILE=AGENTS.md
F 0 '' SHIP_REPO=hypertask-ai/cli SHIP_BASE=main FLAG_GH_ERROR=1
printf 'export function useFlag(key: string) { return true; }\n' > "$E/flag-source/base"
cp "$E/flag-source/base" "$E/flag-source/head"
F 0 ''

# Required current-head commit status: assert the exact API endpoint and payload.
# Control the lock oracle: the same metadata call works unlocked only when assertion is disabled.
env FLAG_ASSERT_LOCK=1 PREMERGE_STATUS_STATE="$PREMERGE_STATUS_STATE" "$E/flag-bin/gh" pr view 999 --json headRefOid,baseRefName,state >/dev/null 2>&1 \
  && bad 'unlocked publisher accepted by lock oracle' || ok 'lock oracle rejects an unlocked publisher'
"$E/flag-bin/gh" pr view 999 --json headRefOid,baseRefName,state >/dev/null 2>&1 \
  && ok 'lock oracle positive control' || bad 'lock oracle control failed'
S() {
  local want=$1 state=$2 description=$3 got out; shift 3
  : > "$E/status-log"
  out=$(env PATH="$E/flag-bin:$PATH" PYTHONPATH="$E/flag-http" FLAG_SOURCE="$E/flag-source" FLAG_LOG="$E/status-log" FLAG_ASSERT_LOCK=1 FLAG_ASSERT_FRESH=1 AGENT_TOKEN=fixture HYPERTASKS_JWT_TOKEN= "$@" ./ship-check premerge-status 999 2>&1); got=$?
  if [ "$got" = "$want" ] && python3 - "$E/status-log" "$state" "$description" <<'PY'
import json, os, sys
calls = [json.loads(line) for line in open(sys.argv[1])]
posts = [c for c in calls if c[0] == 'api' and '/statuses/' in c[1]]
if sys.argv[2] == 'none':
    assert not posts
else:
    assert len(posts) == 1, posts
    call = posts[0]
    assert call[1] == 'repos/hypertask-ai/hypertask/statuses/' + 'a' * 40, call
    assert '--method' in call and call[call.index('--method') + 1] == 'POST'
    assert 'context=premerge-evidence' in call and 'state=' + sys.argv[2] in call, call
    description = next(c.removeprefix('description=') for c in call if c.startswith('description='))
    assert len(description) <= 140 and sys.argv[3] in description, call
    if 'removed-everyone' in sys.argv[3]:
        assert description == sys.argv[3], call
    if sys.argv[2] != 'success' or os.environ.get('EXPECT_NO_REMOVED_EVERYONE'):
        assert 'removed-everyone' not in description, call
PY
  then ok "status: ${PREMERGE_CASE:+$PREMERGE_CASE: }$state $description"; else bad "status: ${PREMERGE_CASE:+$PREMERGE_CASE: }$state got $got $out"; fi
}
C() { local PREMERGE_CASE=$1; shift; S "$@"; }
printf 'const released = useFlag(RELEASED_FLAG);\n' > "$E/flag-source/base"; cp "$E/flag-source/base" "$E/flag-source/head"
C server_only_released_flag_without_record 0 success 'no screen files changed' FLAG_FILE=src/app/api/x/route.ts FLAG_EXTRA_FILES=src/lib/server.ts FLAG_COUNT=2 FLAG_HTTP_ERROR=1 FLAG_SOURCE_ERROR=1
C server_plus_component_without_record 1 failure 'record a browser click-through' FLAG_FILE=src/app/api/x/route.ts FLAG_EXTRA_FILES=src/lib/server.ts,src/components/card.tsx FLAG_COUNT=3
C file_list_read_error_fails_closed 1 failure 'cannot read the PR diff' FLAG_FILE=src/app/api/x/route.ts FLAG_FILES_ERROR=1
C incomplete_file_list_fails_closed 1 failure 'complete PR diff' FLAG_FILE=src/app/api/x/route.ts FLAG_COUNT=2
C css_requires_click 1 failure 'record a browser click-through' FLAG_FILE=src/lib/server.ts FLAG_EXTRA_FILES=assets/theme.css FLAG_COUNT=2
C api_route_is_not_screen 0 success 'no screen files changed' FLAG_FILE=src/app/api/x/route.ts
for path in src/app/page.tsx src/app/layout.tsx src/app/apiary/card.tsx src/styles/theme.ts assets/theme.scss public/icon.svg tailwind.config.ts; do
  C "screen_path_$path" 1 failure 'record a browser click-through' FLAG_FILE=src/lib/server.ts FLAG_EXTRA_FILES="$path" FLAG_COUNT=2
done
C screen_rename_outside_still_requires_click 1 failure 'record a browser click-through' FLAG_FILE=docs/card.tsx FLAG_STATUS=renamed
C screen_on_page_two_requires_click 1 failure 'record a browser click-through' FLAG_FILE=src/lib/server.ts FLAG_PADDING=99 FLAG_PAGE2=1 FLAG_PAGE2_FILE=src/components/card.tsx FLAG_COUNT=101
C server_only_two_pages_without_record 0 success 'no screen files changed' FLAG_FILE=src/lib/server.ts FLAG_PADDING=99 FLAG_PAGE2=1 FLAG_COUNT=101 FLAG_HTTP_ERROR=1
printf 'const released = useFlag(dynamicKey);\n' > "$E/flag-source/head"
C server_unknown_read_needs_no_modes 0 success 'no screen files changed' FLAG_FILE=src/lib/server.ts FLAG_HTTP_ERROR=1
C screen_unknown_read_requires_click 1 failure 'record a browser click-through'
printf 'const plain = 1;\n' > "$E/flag-source/base"; cp "$E/flag-source/base" "$E/flag-source/head"
S 0 success 'no released flag touched'
# YPER4-251: one premerge-status run never touches the contents API and stays within a small fixed API budget.
API_BUDGET() {
  python3 - "$E/status-log" "$1" <<'PY' && ok "$2" || bad "$2"
import json, sys
calls = [json.loads(line) for line in open(sys.argv[1])]
api = [c for c in calls if c[0] in ('api', 'pr')]
assert not any('/contents/' in a for c in calls for a in c), 'contents API called'
assert len(api) <= int(sys.argv[2]), (len(api), api)
assert any(c[0] == 'git' and 'show' in c for c in calls), 'source was not read through local git'
assert sum(c[0] == 'git' and 'fetch' in c for c in calls) <= 1, 'more than one git fetch per run'
PY
}
API_BUDGET 6 'premerge-status: no contents API call, at most 6 API calls per PR'
S 1 failure 'cannot read the PR diff' FLAG_FETCH_ERROR=1 SHIP_GIT_CACHE="$E/git-cache-cold"
S 1 failure 'cannot read the PR diff' FLAG_GH_ERROR=1
S 1 failure 'cannot read the PR diff' FLAG_SOURCE_ERROR=1
S 1 failure 'complete PR diff' FLAG_COUNT=2
S 1 failure 'unchanged PR head' FLAG_HEAD_RACE=1
S 1 none '' FLAG_HEAD_ERROR=1
S 1 none '' FLAG_HEAD=invalid
S 1 none '' FLAG_BASE=main
S 1 none '' FLAG_PR_STATE=MERGED
S 1 none '' FLAG_PR_STATE=CLOSED
S 1 failure 'unchanged PR head' FLAG_BASE_RACE=1
S 1 success 'no released flag touched' FLAG_POST_ERROR=1 # POST failure must still return nonzero.
F 2 'cannot post premerge-evidence' FLAG_POST_ERROR=1
printf 'const released = useFlag(RELEASED_FLAG);\n' > "$E/flag-source/base"; cp "$E/flag-source/base" "$E/flag-source/head"
S 1 failure 'htpr-1-released: record'
cp "$E/record" "$premerge"
EXPECT_NO_REMOVED_EVERYONE=1 S 0 success 'click record ok' # No definition deleted: no removed-everyone.
API_BUDGET 6 'premerge-status with a released flag: no contents API call, at most 6 API calls'
# A surviving released flag still needs its click when another definition is deleted.
printf 'export * from "./definitions/index.generated";\n' > "$E/flag-source/keys"
printf 'const DEFAULT_FEATURE_FLAG_MODE = "OWNER_AND_QA";\n' > "$E/flag-source/registry"
printf 'export const FEATURE_FLAG_DEFINITIONS = FLAG_DEFINITIONS;\n' > "$E/flag-source/definitions"
for d in base head; do
  printf 'export const OTHER_FLAG = "htpr-2-other";\nexport default { key: OTHER_FLAG, kind: "bugfix" } as const;\n' > "$E/flag-source/flags-$d/htpr-2-other.ts"
done
rm "$E/flag-source/flags-head/htpr-1-released.ts"
printf 'const removed = useFlag("htpr-1-released");\nconst other = useFlag("htpr-2-other");\n' > "$E/flag-source/base"
printf 'const other = useFlag("htpr-2-other");\n' > "$E/flag-source/head"
removal=(FLAG_REMOVED_DEFINITION=src/lib/flags/definitions/htpr-1-released.ts FLAG_COUNT=2 'FLAG_HTTP={"flags":[{"key":"htpr-1-released","mode":"EVERYONE"},{"key":"htpr-2-other","mode":"EVERYONE"}]}')
cp "$premerge" "$E/before-removal-record"
rm "$premerge"
printf 'const removed = useFlag("htpr-1-released");\n' > "$E/flag-source/base"
printf 'const plain = 1;\n' > "$E/flag-source/head"
C screen_removal_everyone_without_record 0 success 'flag removal on Everyone: htpr-1-released' "${removal[@]}"
C screen_removal_everyone_plain_qa_without_record 0 success 'flag removal on Everyone: htpr-1-released' "${removal[@]}" AGENT_TOKEN= 'FLAG_PUBLIC={"flags":{"htpr-1-released":true}}'
C screen_removal_owner_qa_without_record 1 failure 'record a browser click-through' "${removal[@]}" 'FLAG_HTTP={"flags":[{"key":"htpr-1-released","mode":"OWNER_AND_QA"}]}'
C screen_removal_live_unavailable 1 failure 'live flag modes unavailable' "${removal[@]}" FLAG_HTTP_ERROR=1
C screen_removal_unknown_live_key 1 failure 'live state unknown' "${removal[@]}" 'FLAG_HTTP={"flags":[{"key":"htpr-2-other","mode":"EVERYONE"}]}'
printf 'const unknown = useFlag(dynamicKey);\n' > "$E/flag-source/head"
C screen_removal_unresolved_read_requires_click 1 failure 'record a browser click-through' "${removal[@]}"
printf 'const other = useFlag("htpr-2-other");\n' > "$E/flag-source/head"
C screen_removal_surviving_released_flag_requires_click 1 failure 'record a browser click-through' "${removal[@]}"
cp "$E/before-removal-record" "$premerge"
printf 'const removed = useFlag("htpr-1-released");\nconst other = useFlag("htpr-2-other");\n' > "$E/flag-source/base"
sed 's/htpr-1-released=EVERYONE/htpr-2-other=EVERYONE/' "$E/record" > "$premerge"
S 0 success 'click record ok | removed-everyone: htpr-1-released' "${removal[@]}"
EXPECT_NO_REMOVED_EVERYONE=1 S 0 success 'click record ok' "${removal[@]}" 'FLAG_HTTP={"flags":[{"key":"htpr-1-released","mode":"OFF"},{"key":"htpr-2-other","mode":"EVERYONE"}]}'
EXPECT_NO_REMOVED_EVERYONE=1 S 0 success 'click record ok' "${removal[@]}" AGENT_TOKEN= 'FLAG_PUBLIC={"flags":{"htpr-1-released":false,"htpr-2-other":true}}'
S 0 success 'click record ok | removed-everyone: htpr-1-released' "${removal[@]}" AGENT_TOKEN= 'FLAG_PUBLIC={"flags":{"htpr-1-released":true,"htpr-2-other":true}}'
S 1 failure 'unchanged PR head' "${removal[@]}" FLAG_HEAD_RACE=1
P 0 premerge 999 "${removal[@]}"
F 0 '' "${removal[@]}"
# removed-everyone requires every deleted key, sorted, not merely one released key.
for d in base head; do
  printf 'export const UNTOUCHED_FLAG = "htpr-4-untouched";\nexport default { key: UNTOUCHED_FLAG, kind: "bugfix" } as const;\n' > "$E/flag-source/flags-$d/htpr-4-untouched.ts"
done
mv "$E/flag-source/flags-head/htpr-2-other.ts" "$E/other-definition"
multiple=(FLAG_REMOVED_DEFINITION=src/lib/flags/definitions/htpr-2-other.ts,src/lib/flags/definitions/htpr-1-released.ts FLAG_COUNT=3)
S 0 success 'flag removal on Everyone: htpr-1-released,htpr-2-other' "${removal[@]}" "${multiple[@]}"
EXPECT_NO_REMOVED_EVERYONE=1 S 0 success 'click record ok' "${removal[@]}" "${multiple[@]}" 'FLAG_HTTP={"flags":[{"key":"htpr-1-released","mode":"EVERYONE"},{"key":"htpr-2-other","mode":"OFF"}]}'
EXPECT_NO_REMOVED_EVERYONE=1 S 0 success 'click record ok' "${removal[@]}" "${multiple[@]}" AGENT_TOKEN= 'FLAG_PUBLIC={"flags":{"htpr-1-released":true,"htpr-2-other":false}}'
S 1 failure 'live state unknown' "${multiple[@]}"
mv "$E/other-definition" "$E/flag-source/flags-head/htpr-2-other.ts"
rm "$E/flag-source/flags-"{base,head}/htpr-4-untouched.ts
sed 's/htpr-1-released=EVERYONE/htpr-2-other=EVERYONE/' "$E/record" > "$premerge"
cp "$E/flag-source/base" "$E/before-long-base"
cp "$E/flag-source/head" "$E/flag-source/base"
# removed-everyone is omitted, never truncated, when the entire description exceeds 140.
for length in 140 141; do
  prefix='click record ok | removed-everyone: '
  key="htpr-3-$(printf '%*s' "$((length - ${#prefix} - 7))" '' | tr ' ' x)"
  path="src/lib/flags/definitions/$key.ts"
  printf 'export const LONG_FLAG = "%s";\nexport default { key: LONG_FLAG, kind: "bugfix" } as const;\n' "$key" > "$E/flag-source/flags-base/$key.ts"
  if [ "$length" = 140 ]; then
    S 0 success "$prefix$key" FLAG_FILE="$path" FLAG_STATUS=removed FLAG_EXTRA_FILES=src/components/card.tsx FLAG_COUNT=2 "FLAG_HTTP={\"flags\":[{\"key\":\"$key\",\"mode\":\"EVERYONE\"},{\"key\":\"htpr-1-released\",\"mode\":\"EVERYONE\"},{\"key\":\"htpr-2-other\",\"mode\":\"EVERYONE\"}]}"
  else
    EXPECT_NO_REMOVED_EVERYONE=1 S 0 success 'click record ok' FLAG_FILE="$path" FLAG_STATUS=removed FLAG_EXTRA_FILES=src/components/card.tsx FLAG_COUNT=2 "FLAG_HTTP={\"flags\":[{\"key\":\"$key\",\"mode\":\"EVERYONE\"},{\"key\":\"htpr-1-released\",\"mode\":\"EVERYONE\"},{\"key\":\"htpr-2-other\",\"mode\":\"EVERYONE\"}]}"
  fi
  rm "$E/flag-source/flags-base/$key.ts"
done
cp "$E/before-long-base" "$E/flag-source/base"
sed -i 's/htpr-2-other=EVERYONE/htpr-2-other=OFF/' "$premerge"
S 1 failure 'expected Flags: htpr-2-other=EVERYONE' "${removal[@]}"
cp "$E/record" "$premerge"
S 1 failure 'expected Flags: htpr-2-other=EVERYONE' "${removal[@]}"
sed '/^Flags:/d' "$E/record" > "$premerge"
S 1 failure 'missing Flags:; expected Flags: htpr-2-other=EVERYONE' "${removal[@]}"
# Definition-only diffs change no screen and need no click record.
S 0 success 'no screen files changed' FLAG_FILE=src/lib/flags/definitions/htpr-1-released.ts FLAG_STATUS=removed
printf 'Flags: \n' >> "$premerge"
S 0 success 'no screen files changed' FLAG_FILE=src/lib/flags/definitions/htpr-1-released.ts FLAG_STATUS=removed
S 0 success 'no screen files changed' FLAG_FILE=src/lib/flags/definitions/htpr-1-released.ts FLAG_STATUS=removed FLAG_HTTP_ERROR=1
sed -i 's/Commit:.*/Commit: deadbeef/' "$premerge"
S 0 success 'no screen files changed' FLAG_FILE=src/lib/flags/definitions/htpr-1-released.ts FLAG_STATUS=removed
sed '/^Flags:/d; s/Click: PASS/Click: FAIL/' "$E/record" > "$premerge"
S 0 success 'no screen files changed' FLAG_FILE=src/lib/flags/definitions/htpr-1-released.ts FLAG_STATUS=removed
rm "$premerge"
S 0 success 'no screen files changed' FLAG_FILE=src/lib/flags/definitions/htpr-1-released.ts FLAG_STATUS=removed
# A key that survives in the head registry is never exempt, even if GitHub reports a deleted file.
cp "$E/flag-source/flags-base/htpr-1-released.ts" "$E/flag-source/flags-head/htpr-1-released.ts"
sed 's/htpr-1-released=EVERYONE/htpr-2-other=EVERYONE/' "$E/record" > "$premerge"
S 1 failure 'expected Flags: htpr-1-released=EVERYONE' "${removal[@]}"
rm "$E/flag-source/flags-base/htpr-2-other.ts" "$E/flag-source/flags-head/htpr-2-other.ts" "$E/flag-source/definitions"
cp "$E/keys-legacy" "$E/flag-source/keys"; cp "$E/registry-legacy" "$E/flag-source/registry"
printf 'const released = useFlag(RELEASED_FLAG);\n' > "$E/flag-source/base"; cp "$E/flag-source/base" "$E/flag-source/head"
cp "$E/record" "$premerge"
sed -i 's/Click: PASS/Click: FAIL/' "$premerge"
S 1 failure 'missing passing click'
sed -i 's/Click: FAIL/Click: PASS/' "$premerge"
: > "$E/status-log"
P 0 pr YPER4-999 FLAG_LOG="$E/status-log"
python3 - "$E/status-log" <<'PY' && ok 'pr gate posts status' || bad 'pr gate omitted status'
import json, sys
assert any('context=premerge-evidence' in json.loads(l) for l in open(sys.argv[1]))
PY

if [ "${1:-}" = --premerge-only ]; then
  echo "$passes passed, $fails failed"
  [ "$fails" = 0 ] && echo 'premerge ship-check tests passed'
  exit "$((fails > 0))"
fi

# The sweep uses one list call, skips unchanged heads and notices changed/deleted evidence.
W() {
  local want=$1 posts=$2 out got; shift 2
  : > "$E/status-log"
  out=$(env PATH="$E/flag-bin:$PATH" PYTHONPATH="$E/flag-http" FLAG_SOURCE="$E/flag-source" FLAG_LOG="$E/status-log" PREMERGE_STATUS_STATE="$E/sweep-state" AGENT_TOKEN=fixture HYPERTASKS_JWT_TOKEN= "$@" python3 ./premerge-evidence.py 2>&1); got=$?
  if [ "$got" = "$want" ] && python3 - "$E/status-log" "$posts" <<'PY'
import json, sys
calls = [json.loads(line) for line in open(sys.argv[1])]
assert sum(c[:2] == ['api', '-i'] for c in calls) == 1
assert sum(c[0] == 'api' and '/statuses/' in c[1] for c in calls) == int(sys.argv[2]), calls
PY
  then ok "sweep: $posts posts"; else bad "sweep: want $want $posts posts got $got $out"; fi
}
W 0 1
W 0 0
sed -i 's/Click: PASS/Click: FAIL/' "$premerge"
W 0 1
W 0 0 FLAG_ROLLUP=FAILURE
sed -i 's/Click: FAIL/Click: PASS/' "$premerge"
W 0 1 FLAG_ROLLUP=FAILURE
printf 'changed recording' > "$E/YPER4-999/click.webm"
W 0 1
rm "$E/YPER4-999/click.webm"
W 0 1
W 0 0 FLAG_ROLLUP=FAILURE
python3 - "$E/sweep-state/cache.json" <<'PY'
import json, sys
path = sys.argv[1]; cache = json.load(open(path)); cache['999']['checked'] = 0
json.dump(cache, open(path, 'w'))
PY
W 0 1 FLAG_ROLLUP=FAILURE
W 1 0 FLAG_LIST_ERROR=1
python3 - "$E/sweep-state/cache.json" <<'PY'
import json, sys
path = sys.argv[1]; cache = json.load(open(path)); cache['999']['checked'] = 0
json.dump(cache, open(path, 'w'))
PY
W 0 1 FLAG_POST_ERROR=1
W 0 1 FLAG_POST_ERROR=1
W 1 1 FLAG_POST_ERROR=1
W 0 1

# YPER4-251: a sweep makes no GitHub call at all while the shared pause epoch is in the future.
SWEEP_LOG() {
  : > "$E/status-log"
  env PATH="$E/flag-bin:$PATH" PYTHONPATH="$E/flag-http" FLAG_SOURCE="$E/flag-source" FLAG_LOG="$E/status-log" PREMERGE_STATUS_STATE="$E/sweep-state" AGENT_TOKEN=fixture HYPERTASKS_JWT_TOKEN= "$@" python3 ./premerge-evidence.py >/dev/null 2>&1
}
echo $(( $(date +%s) + 3600 )) > "$E/pause-until"
SWEEP_LOG GH_PAUSE_FILE="$E/pause-until"; got=$?
[ "$got" = 0 ] && [ ! -s "$E/status-log" ] && ok 'sweep exits with no calls while paused' || bad "sweep ran while paused: $got $(cat "$E/status-log")"
echo $(( $(date +%s) - 10 )) > "$E/pause-until"
SWEEP_LOG GH_PAUSE_FILE="$E/pause-until"; got=$?
[ "$got" = 0 ] && grep -q '"api", "-i"' "$E/status-log" && ok 'sweep runs once the pause epoch has passed' || bad "sweep stayed idle after pause: $got"
# An unchanged head is skipped: only the one list call and the rules fetch, no per-PR reads and no contents API.
SWEEP_LOG FLAG_ROLLUP=FAILURE # warm the cache with the status the record really has
SWEEP_LOG FLAG_ROLLUP=FAILURE; got=$?
python3 - "$E/status-log" <<'PY' && [ "$got" = 0 ] && ok 'sweep skips an unchanged head: one list call, no per-PR calls' || bad 'sweep re-checked an unchanged head'
import json, sys
calls = [json.loads(line) for line in open(sys.argv[1])]
api = [c for c in calls if c[0] in ('api', 'pr')]
assert [c[:2] for c in api] == [['api', '-i']], api
assert not any('/contents/' in a for c in calls for a in c)
PY

# YPER4-251: the real local-git source layer (no fakes): one fetch, git show, missing path, directory listing, offline re-read.
python3 - ./ship-check <<'PY' && ok 'local git source layer: fetch once, show, ls-tree, missing path' || bad 'local git source layer'
import json, os, re, subprocess, sys, tempfile
from pathlib import Path
text = open(sys.argv[1]).read()
layer = text[text.index('# PR files come from a local bare cache'):text.index('def constants(text):')]
root = Path(tempfile.mkdtemp())
origin = root / 'origin'
env = dict(os.environ, GIT_AUTHOR_NAME='t', GIT_AUTHOR_EMAIL='t@t', GIT_COMMITTER_NAME='t', GIT_COMMITTER_EMAIL='t@t')
def run(*args, cwd=origin):
    return subprocess.run(args, cwd=cwd, env=env, capture_output=True, text=True, check=True).stdout.strip()
origin.mkdir()
run('git', 'init', '-q')
(origin / 'src/lib/flags/definitions').mkdir(parents=True)
(origin / 'src/lib/flags/keys.ts').write_text('base\n')
run('git', 'add', '-A'); run('git', 'commit', '-qm', 'base'); base = run('git', 'rev-parse', 'HEAD')
(origin / 'src/lib/flags/definitions/htpr-1-x.ts').write_text('export const X = "htpr-1-x";\n')
(origin / 'src/lib/flags/keys.ts').write_text('head\n')
run('git', 'add', '-A'); run('git', 'commit', '-qm', 'head'); head = run('git', 'rev-parse', 'HEAD')
run('git', 'update-ref', 'refs/pull/7/head', head)
os.environ.update(SHIP_GIT='git', SHIP_GIT_CACHE=str(root / 'cache'), SHIP_GIT_REMOTE=str(origin))
ns = dict(json=json, os=os, re=re, subprocess=subprocess, Path=Path, repo='hypertask-ai/hypertask')
exec(layer, ns)
ns['prepare']('7', head, base)
assert ns['source']('src/lib/flags/keys.ts', head) == 'head\n'
assert ns['source']('src/lib/flags/keys.ts', base) == 'base\n'
assert ns['listdir']('src/lib/flags/definitions', head) == [{'name': 'htpr-1-x.ts', 'path': 'src/lib/flags/definitions/htpr-1-x.ts', 'type': 'file'}]
assert ns['listdir']('src/lib/flags/definitions', base) == []
try:
    ns['source']('src/nope.ts', head); raise SystemExit('missing path was served')
except ValueError:
    pass
subprocess.run(['rm', '-rf', str(origin)], check=True)  # cached: a second prepare must not need the network
ns['prepare']('7', head, base)
try:
    ns['prepare']('8', 'c' * 40); raise SystemExit('unknown sha accepted')
except ValueError:
    pass
PY

# Dropped path (YPER4-257): Valentin decided against a ticket, its PR is closed unmerged. Fakes: PR state and comments.
mkdir -p "$E/drop-bin"
cat > "$E/drop-bin/gh" <<'MOCK'
#!/usr/bin/env bash
# pr view <n> ... : state comes from $DROP_DIR/state-<n>; the title names YPER4-777.
[[ $1 == pr && $2 == view ]] || exit 1
st=$(cat "$DROP_DIR/state-$3") || exit 1
case "$*" in
  *'--json title,state,baseRefName'*) echo "$st production YPER4-777 [INFRA] Dropped fixture" ;;
  *'--json number,title,state,mergeCommit,baseRefName'*)
    sha=null; [ "$st" = MERGED ] && sha='{"oid":"abc123"}'
    echo "{\"number\":$3,\"title\":\"YPER4-777 [INFRA] Dropped fixture\",\"state\":\"$st\",\"mergeCommit\":$sha,\"baseRefName\":\"production\"}" ;;
  *'--json title'*) echo "YPER4-777 [INFRA] Dropped fixture" ;;
  *) exit 1 ;;
esac
MOCK
cat > "$E/drop-bin/hypertask" <<'MOCK'
#!/usr/bin/env bash
if [[ $1 == comment && $2 == list ]]; then cat "$DROP_DIR/comments"
elif [[ $1 == tasks && $2 == get ]]; then echo '{"success":true,"tasks":[{"section":"Done"}]}'
else exit 1; fi
MOCK
chmod +x "$E/drop-bin/gh" "$E/drop-bin/hypertask"
export DROP_DIR="$E/drop"; mkdir -p "$DROP_DIR"
D() { PATH="$E/drop-bin:$PATH" ./ship-check "$@"; }
echo '{"success":true,"comments":[{"text":"<p>Agent note, no decision here.</p>"}]}' > "$DROP_DIR/comments"
echo CLOSED > "$DROP_DIR/state-901"; echo OPEN > "$DROP_DIR/state-902"; echo MERGED > "$DROP_DIR/state-903"
D dropped YPER4-777 901 >/dev/null && bad "dropped accepted without a decision comment" || ok "dropped refuses a ticket without a quoted dated decision"
echo '{"success":true,"comments":[{"text":"<p>Valentin decided on 2026-10-10 not to ship this.</p>"}]}' > "$DROP_DIR/comments"
D dropped YPER4-777 901 >/dev/null && bad "dropped accepted an unquoted decision" || ok "dropped refuses a decision without a quote"
echo '{"success":true,"comments":[{"text":"<p>Valentin, 2026-10-10: &quot;ship it&quot;.</p>"}]}' > "$DROP_DIR/comments"
D dropped YPER4-777 901 >/dev/null && bad "dropped accepted an unrelated quoted decision" || ok "dropped refuses a quoted decision without Decided against:"
echo '{"success":true,"comments":[{"text":"<p>No &quot;Decided against:&quot; record exists. Valentin, 2026-10-10: &quot;ship it&quot;.</p>"}]}' > "$DROP_DIR/comments"
D dropped YPER4-777 901 >/dev/null && bad "dropped accepted Decided against: mid-comment" || ok "dropped needs the comment to start with Decided against:"
echo '{"success":true,"comments":[{"text":"<p>Decided against: awaiting Valentin, 2026-10-10, see <a href=\"https://example.com\">link</a>.</p>"}]}' > "$DROP_DIR/comments"
D dropped YPER4-777 901 >/dev/null && bad "dropped accepted attribute quotes as a quote" || ok "dropped ignores quotes inside HTML attributes"
echo '{"success":true,"comments":[{"text":"<p>Decided against: awaiting Valentin, 2026-10-10. Button label: &quot;Cancel&quot;.</p>"}]}' > "$DROP_DIR/comments"
D dropped YPER4-777 901 >/dev/null && bad "dropped accepted an unrelated quotation" || ok "dropped needs the quote right after Valentin and the date"
echo '{"success":true,"comments":[{"text":"<p><strong>Decided against: Valentin, 2026-10-10, in chat: &quot;release them instead&quot;</strong></p>"}]}' > "$DROP_DIR/comments"
D dropped YPER4-777 901 >/dev/null && ok "dropped accepts a short note after the date" || bad "dropped refused a note after the date"
rm -f "$E/YPER4-777/dropped" "$E/YPER4-777/pr"
echo '{"success":true,"comments":[{"text":"<p>Decided against: Valentin, 2026-10-10: &quot;drop it, not needed&quot;.</p>"}]}' > "$DROP_DIR/comments"
D dropped YPER4-777 902 >/dev/null && bad "dropped accepted an open PR" || ok "dropped refuses an open PR"
D dropped YPER4-777 903 >/dev/null && bad "dropped accepted a merged PR" || ok "dropped refuses a merged PR"
[ ! -e "$E/YPER4-777/dropped" ] && ok "refused dropped writes no record" || bad "refused dropped wrote a record"
out=$(D dropped YPER4-777 901); [ "$out" = 'recorded YPER4-777 as dropped (PR 901 closed unmerged)' ] && ok "dropped records a closed unmerged PR" || bad "dropped: $out"
[ "$(cat "$E/YPER4-777/pr")" = 901 ] && [ "$(cat "$E/YPER4-777/dropped")" = 901 ] && ok "dropped binds the PR" || bad "dropped record"
for x in merged deployed proof docs; do
  D $x YPER4-777 | grep -q "$x ok (dropped: PR 901 closed unmerged)" && ok "dropped passes $x" || bad "dropped $x"
done
D pr YPER4-777 | grep -q 'title ok' && ok "dropped passes pr" || bad "dropped pr"
echo '{"tool_input":{"command":"vcc task move YPER4-777 --section \"Done\""}}' | PATH="$E/drop-bin:$PATH" ./ship-check guard >/dev/null 2>&1 \
  && ok "guard allows Done for a dropped ticket" || bad "guard blocks Done for a dropped ticket"
echo MERGED > "$DROP_DIR/state-901"
D merged YPER4-777 >/dev/null && bad "dropped passed merged after the PR merged" || ok "dropped merged gate fails once the PR is merged"
echo OPEN > "$DROP_DIR/state-901"
D deployed YPER4-777 >/dev/null && bad "dropped passed deployed after the PR reopened" || ok "dropped deployed gate fails once the PR reopens"
echo CLOSED > "$DROP_DIR/state-901"
D bind YPER4-777 901 >/dev/null && [ ! -e "$E/YPER4-777/dropped" ] && ok "bind clears dropped" || bad "bind did not clear dropped"

# nochange path (YPER4-272): infra ticket solved with no code change. Stubs for gh, hypertask and a local origin.
NC="$E/nc"; mkdir -p "$NC/bin" "$NC/work"
git init -q --bare "$NC/origin.git"; git clone -q "$NC/origin.git" "$NC/work" 2>/dev/null
git -C "$NC/work" -c user.name=t -c user.email=t@t commit -q --allow-empty -m init
git -C "$NC/work" push -q origin HEAD:refs/heads/production 2>/dev/null
cat > "$NC/bin/gh" <<'MOCK'
#!/usr/bin/env bash
if [[ $1 == pr && $2 == list ]]; then cat "$NC/prs"
elif [[ $1 == api && $2 == */compare/* ]]; then cat "$NC/ahead"
else exit 1; fi
MOCK
cat > "$NC/bin/hypertask" <<'MOCK'
#!/usr/bin/env bash
[[ $1 == comment && $2 == list ]] && cat "$NC/comments" || exit 1
MOCK
chmod +x "$NC/bin/gh" "$NC/bin/hypertask"; export NC
N() { SHIP_CHECKOUT="$NC/work" PATH="$NC/bin:$PATH" ./ship-check "$@"; }
echo '[]' > "$NC/prs"; echo 0 > "$NC/ahead"
echo '{"success":true,"comments":[{"text":"<p>Looking at it.</p>"}]}' > "$NC/comments"
N nochange YPER4-901 >/dev/null && bad "nochange accepted a ticket with no comment" || ok "nochange refuses a ticket with no comment"
echo '{"success":true,"comments":[{"text":"<p><strong>Resolved without a change:</strong> the setting was already right.</p>"}]}' > "$NC/comments"
N nochange YPER4-901 >/dev/null && bad "nochange accepted an opener without evidence" || ok "nochange refuses an opener with no evidence"
echo '{"success":true,"comments":[{"text":"<p>Note: https://example.com/x</p><p><strong>Resolved without a change:</strong> fine.</p>"}]}' > "$NC/comments"
N nochange YPER4-901 >/dev/null && bad "nochange accepted evidence in another comment" || ok "nochange needs the opener and evidence in one comment"
echo '{"success":true,"comments":[{"text":"<p><strong>Resolved without a change:</strong> checked https://example.com/run/1 .</p>"}]}' > "$NC/comments"
N nochange FOO-901 >/dev/null && bad "nochange accepted a non-ticket id" || ok "nochange refuses a non-ticket id (FOO-901)"
N nochange HTPR-901x >/dev/null && bad "nochange accepted a malformed id" || ok "nochange refuses a malformed id (HTPR-901x)"
N nochange HTPR-901 | grep -q 'nochange ok' && ok "nochange accepts HTPR with a resolution comment" || bad "nochange HTPR"
echo '{"success":true,"comments":[{"text":"<p>Looking at it.</p>"}]}' > "$NC/comments"
N nochange HTPR-901 >/dev/null && bad "nochange HTPR accepted no comment" || ok "nochange HTPR refuses a ticket with no comment"
echo '{"success":true,"comments":[{"text":"<p><strong>Resolved without a change:</strong> checked https://example.com/run/1 .</p>"}]}' > "$NC/comments"
rm -f "$E/HTPR-901/nochange"
echo '[{"number":5,"title":"YPER4-901 [INFRA] a fix"}]' > "$NC/prs"
N nochange YPER4-901 >/dev/null && bad "nochange accepted an open PR" || ok "nochange refuses an open PR"
echo '[{"number":6,"title":"YPER4-9010 [INFRA] other ticket"}]' > "$NC/prs"
git -C "$NC/work" push -q origin HEAD:refs/heads/r3/yper4-901-fix 2>/dev/null; echo 2 > "$NC/ahead"
N nochange YPER4-901 >/dev/null && bad "nochange accepted an unmerged remote branch" || ok "nochange refuses an origin branch ahead of base"

# deeper gate (YPER4-435): a Deeper: activity with the four parts and a runnable proof gate in the session scope.
DP="$E/deeper"; mkdir -p "$DP/bin" "$DP/repo/.unlazy/s-abcd1234/gates"
printf '#!/usr/bin/env bash\n[[ $1 == GET && $2 == /mcp/tasks/YPER4-902/agent-activity* ]] && cat "$DP/acts" || exit 1\n' > "$DP/bin/ht"
chmod +x "$DP/bin/ht"; export DP
DE() { (cd "$DP/repo" && env -u CODEX_SESSION_ID -u CODEX_THREAD_ID CLAUDE_CODE_SESSION_ID="${DSID-abcd1234-full}" PATH="$DP/bin:$PATH" "$OLDPWD/ship-check" deeper "$@"); }
act() { jq -nc --arg t "$1" '{success:true,activities:[{type:"thought",text:"Claimed.",createdAt:"2026-10-17T10:00:00Z"},{type:"thought",text:$t,createdAt:"2026-10-17T11:00:00Z"}]}' > "$DP/acts"; }
full='Deeper: field: release engineering | raw source: ship-check source | method: stub tests | outside proof: CI run | breaks if: another suite turns red | proof gate: YPER4-902.deeper-ci'
gate=$'- [ ] YPER4-902.deeper-ci: CI is green\n  CHECK: gh run list --limit 1\n  EXPECT: success\n'
printf '%s' "$gate" > "$DP/repo/.unlazy/s-abcd1234/gates/extra.md"
act "$full"; DE YPER4-902 | grep -qx 'deeper ok' && ok "deeper passes with all parts and a runnable proof gate" || bad "deeper pass: $(DE YPER4-902)"
DSID=otherses-full DE YPER4-902 | grep -q 'a manual note does not count' && ok "deeper ignores another session's proof gate" || bad "deeper used another session's scope"
DSID= DE YPER4-902 | grep -q "needs this session's id" && ok "deeper refuses without a session id" || bad "deeper without session id"
echo '{"success":true,"activities":[]}' > "$DP/acts"
DE YPER4-902 | grep -q 'no agent activity starting with "Deeper:"' && ok "deeper refuses a ticket with no Deeper: activity" || bad "deeper no activity"
act "${full/ | method: stub tests/}"; DE YPER4-902 | grep -q 'no "method:" part' && ok "deeper refuses a missing part" || bad "deeper missing part"
act "${full/ | breaks if: another suite turns red/}"; DE YPER4-902 | grep -q 'no "breaks if:" part' && ok "deeper refuses a Deeper: activity without breaks if" || bad "deeper missing breaks if"
act "${full/YPER4-902.deeper-ci/YPER4-903.deeper-ci}"; DE YPER4-902 | grep -q 'must name its proof gate' && ok "deeper refuses another ticket's proof gate" || bad "deeper wrong ticket gate"
act "$full"; printf -- '- [ ] YPER4-902.deeper-ci: CI is green\n  EVIDENCE: I looked at it\n' > "$DP/repo/.unlazy/s-abcd1234/gates/extra.md"
DE YPER4-902 | grep -q 'a manual note does not count' && ok "deeper refuses a manual proof gate" || bad "deeper manual gate"
printf -- '- [ ] YPER4-902.deeper-cix: other\n  CHECK: true\n  EXPECT: x\n- [ ] YPER4-902.deeper-ci: CI is green\n  EVIDENCE: manual\n' > "$DP/repo/.unlazy/s-abcd1234/gates/extra.md"
DE YPER4-902 | grep -q 'a manual note does not count' && ok "deeper does not borrow another gate's CHECK" || bad "deeper borrowed CHECK"
printf '%s' "$gate" > "$DP/repo/.unlazy/s-abcd1234/GATES.md"; rm "$DP/repo/.unlazy/s-abcd1234/gates/extra.md"
DE YPER4-902 | grep -q 'a manual note does not count' && ok "deeper needs the proof gate outside the generated GATES.md" || bad "deeper read GATES.md"
DE 'YPER4-902;x' | grep -q 'needs a ticket id' && ok "deeper refuses a malformed ticket id" || bad "deeper malformed id"
echo 0 > "$NC/ahead"
G 2 vcc task move YPER4-901 $DONE
echo '[{"number":6,"title":"YPER4-9010 [INFRA] other ticket"}]' > "$NC/prs"
N nochange YPER4-901 | grep -q 'nochange ok' && ok "nochange passes (bold opener plus URL)" || bad "nochange pass case"
echo '{"success":true,"comments":[{"text":"<p>Resolved without a change: <pre>curl -s x</pre></p>"}]}' > "$NC/comments"
N nochange YPER4-901 | grep -q 'nochange ok' && ok "nochange passes with a pre block" || bad "nochange pre case"
# Each must print what its ship-gates EXPECT line matches (pr expects "title ok").
for x in merged:merged deployed:deployed proof:proof pr:title docs:docs; do
  N ${x%%:*} YPER4-901 | grep -q "^${x#*:} ok" && ok "nochange passes ${x%%:*}" || bad "nochange ${x%%:*}"
done
N cleaned YPER4-901 >/dev/null && bad "nochange cleaned ignored an origin branch" || ok "nochange cleaned fails while an origin branch exists"
git -C "$NC/work" push -q origin :refs/heads/r3/yper4-901-fix 2>/dev/null
git -C "$NC/work" branch -q r3/yper4-901-local 2>/dev/null
N cleaned YPER4-901 >/dev/null && bad "nochange cleaned ignored a local branch" || ok "nochange cleaned fails while a local branch exists"
git -C "$NC/work" worktree add -q "$NC/wt901" -b r3/yper4-901-wt 2>/dev/null
git -C "$NC/work" branch -q -D r3/yper4-901-local
N cleaned YPER4-901 >/dev/null && bad "nochange cleaned ignored a worktree" || ok "nochange cleaned fails while a worktree branch exists"
git -C "$NC/work" worktree remove --force "$NC/wt901"; git -C "$NC/work" branch -q -D r3/yper4-901-wt
N cleaned YPER4-901 | grep -q 'cleaned ok' && ok "nochange cleaned passes once nothing is left" || bad "nochange cleaned clean case"
# Number boundary: a branch of YPER4-9010 is not a branch of YPER4-901.
git -C "$NC/work" push -q origin HEAD:refs/heads/r3/yper4-9010-other 2>/dev/null; echo 3 > "$NC/ahead"
N nochange YPER4-901 | grep -q 'nochange ok' && ok "nochange ignores a branch of YPER4-9010" || bad "nochange matched yper4-9010"
N cleaned YPER4-901 | grep -q 'cleaned ok' && ok "nochange cleaned ignores a branch of YPER4-9010" || bad "cleaned matched yper4-9010"
git -C "$NC/work" push -q origin :refs/heads/r3/yper4-9010-other 2>/dev/null; echo 0 > "$NC/ahead"
echo '{"tool_input":{"command":"vcc task move YPER4-901 --section \"Done\""}}' | SHIP_CHECKOUT="$NC/work" PATH="$NC/bin:$PATH" ./ship-check guard >/dev/null 2>&1 \
  && ok "guard allows Done after nochange" || bad "guard blocks Done after nochange"
G 2 vcc task move YPER4-902 $DONE
# The marker is only a record: a PR that appears after the pass blocks Done again.
echo '[{"number":7,"title":"YPER4-901 [INFRA] late fix"}]' > "$NC/prs"
echo '{"tool_input":{"command":"vcc task move YPER4-901 --section \"Done\""}}' | SHIP_CHECKOUT="$NC/work" PATH="$NC/bin:$PATH" ./ship-check guard >/dev/null 2>&1 \
  && bad "guard allowed Done after a PR appeared" || ok "guard blocks Done when a PR appears after nochange"
echo '[]' > "$NC/prs"
# HTPR guard: Done is blocked without nochange, allowed after it, and the id boundary holds (htpr-901 vs htpr-9010).
rm -f "$E/HTPR-901/nochange"
echo '{"tool_input":{"command":"vcc task move HTPR-901 --section \"Done\""}}' | SHIP_CHECKOUT="$NC/work" PATH="$NC/bin:$PATH" ./ship-check guard >/dev/null 2>&1 \
  && bad "guard allowed Done for HTPR without nochange" || ok "guard blocks Done for HTPR without nochange"
git -C "$NC/work" push -q origin HEAD:refs/heads/r3/htpr-9010-other 2>/dev/null; echo 3 > "$NC/ahead"
N nochange HTPR-901 | grep -q 'nochange ok' && ok "nochange ignores a branch of HTPR-9010" || bad "nochange matched htpr-9010"
git -C "$NC/work" push -q origin :refs/heads/r3/htpr-9010-other 2>/dev/null
git -C "$NC/work" push -q origin HEAD:refs/heads/r3/htpr-901-fix 2>/dev/null
N nochange HTPR-901 >/dev/null && bad "nochange HTPR ignored its own branch" || ok "nochange HTPR refuses its own branch ahead of base"
git -C "$NC/work" push -q origin :refs/heads/r3/htpr-901-fix 2>/dev/null; echo 0 > "$NC/ahead"
echo '{"tool_input":{"command":"vcc task move HTPR-901 --section \"Done\""}}' | SHIP_CHECKOUT="$NC/work" PATH="$NC/bin:$PATH" ./ship-check guard >/dev/null 2>&1 \
  && ok "guard allows Done for HTPR after nochange" || bad "guard blocks Done for HTPR after nochange"
# Empty evidence does not count.
for body in '<code></code>' '<pre> </pre>' '<pre><code>&nbsp;</code></pre>'; do
  jq -n --arg b "<p><strong>Resolved without a change:</strong> done</p>$body" '{success:true,comments:[{text:$b}]}' > "$NC/comments"
  N nochange YPER4-901 >/dev/null && bad "nochange accepted empty evidence $body" || ok "nochange refuses empty evidence $body"
done
jq -n '{success:true,comments:[{text:"<p><strong>Resolved without a change:</strong> done</p><pre><code>ok 3 checks</code></pre>"}]}' > "$NC/comments"
N nochange YPER4-901 | grep -q 'nochange ok' && ok "nochange accepts a pre/code block with output" || bad "nochange refused real output"
echo 830 > "$E/YPER4-901/pr"
N merged YPER4-901 >/dev/null && bad "nochange survived a bound PR" || ok "a bound PR ends the nochange pass"

# Current-head ci-tests merge gate. The incident fixture retains its real production SHA.
export CI_FIXTURE_DIR="$PWD/fixtures/yper4-312" CI_CALL_LOG="$E/ci-calls"
export CI_HEAD CI_PR_RUNS CI_BASE_RUNS CI_LOG
CI_HEAD=$(jq -r '.check_runs[0].head_sha' "$CI_FIXTURE_DIR/pr-1392-failure.check-runs.json")
CI_PR_RUNS=$(cat "$CI_FIXTURE_DIR/pr-1392-failure.check-runs.json")
CI_BASE_RUNS=$(jq '.check_runs[0].conclusion = "success"' "$CI_FIXTURE_DIR/production.check-runs.json")
CI_LOG=$(cat "$CI_FIXTURE_DIR/pr-1392-failure.log")
gh() {
  printf '%s\n' "$*" >> "$CI_CALL_LOG"
  [[ -z ${CI_GH_ERROR:-} || $* != *"$CI_GH_ERROR"* ]] || return 1
  case "$1:$2" in
    pr:view)
      if [[ $* == *'--json title'* ]]; then echo 'HTPR-6971 [FEATURE] Fixture'
      else echo "$CI_HEAD"; fi ;;
    api:*/pulls/1392)
      if [[ $* == *'--jq .head.sha'* ]]; then echo "$CI_HEAD"; else return 1; fi ;;
    api:*/commits/production/check-runs\?*) printf '%s\n' "$CI_BASE_RUNS" ;;
    api:*/check-runs\?*)
      [[ $2 == "repos/"*"/commits/$CI_HEAD/check-runs?per_page=100&filter=all" && $* == *--paginate* ]] || return 1
      printf '%s\n' "$CI_PR_RUNS" ;;
    api:*/actions/jobs/114565456089/logs) cat "$CI_FIXTURE_DIR/production.log" ;;
    api:*/actions/jobs/*/logs) printf '%s\n' "$CI_LOG" ;;
    api:*/pulls/1392/files\?*) echo '[]' ;;
    api:*/pulls/1392\?*)
      jq -n --arg sha "$CI_HEAD" '{head:{sha:$sha},base:{sha:$sha},title:"HTPR-6971 [FEATURE] Fixture",changed_files:0}' ;;
    api:*/statuses/*) return 0 ;;
    *) return 1 ;;
  esac
}
hypertask() { echo '{"success":true,"tasks":[{"id":6971}]}'; }
export -f gh hypertask
if [ "$(gh api repos/hypertask-ai/hypertask/pulls/1392 --jq .head.sha)" = "$CI_HEAD" ]; then ok 'CI stub returns recorded head'
else bad 'CI stub head changed'; fi
if hypertask tasks get HTPR-6971 --json | jq -e '.success' >/dev/null; then ok 'CI ticket stub passes'
else bad 'CI ticket stub failed'; fi
ci_test_path=$(printenv PATH)
# Python premerge subprocesses also use the exported gh stub, never live APIs.
mkdir -p "$E/ci-bin"
printf '#!/usr/bin/env bash\ngh "$@"\n' > "$E/ci-bin/gh"
chmod +x "$E/ci-bin/gh"
CI() {
  local want=$1 expected=$2 out got; shift 2
  : > "$CI_CALL_LOG"
  out=$(echo '{"tool_input":{"command":"gh pr merge 1392"}}' | env PATH="$E/ci-bin:$ci_test_path" SHIP_GIT=/bin/true SHIP_GIT_CACHE="$E/ci-cache" "$@" ./ship-check guard 2>&1); got=$?
  if [ "$got" = "$want" ] && [[ $out == *"$expected"* ]]; then ok "ci-tests: $expected"
  else bad "ci-tests: want $want $expected got $got $out"; fi
  if [ "$want" = 0 ] && [[ $* != *SHIP_REPO=* ]]; then
    if grep -q '/statuses/' "$CI_CALL_LOG"; then ok 'passing CI proceeds to premerge status'
    else bad 'passing CI never reached premerge status'; fi
  elif [ "$want" = 2 ]; then
    if grep -q '/statuses/' "$CI_CALL_LOG"; then bad 'nonpassing CI reached premerge status'
    else ok 'nonpassing CI stops before premerge status'; fi
  fi
  if [ "$expected" = 'tests/htpr-6971-chat-history-paging.test.cjs:774:1' ]; then
    printf '1392 fixture block: %s\n' "$out"
  fi
}
CI 2 'tests/htpr-6971-chat-history-paging.test.cjs:774:1'
CI 2 'production ci-tests is green, so this PR broke it'
CI 2 'production ci-tests is also red (Ctrl+J globally opens Compose' CI_BASE_RUNS="$(cat "$CI_FIXTURE_DIR/production.check-runs.json")"
CI 0 '' CI_PR_RUNS="$(jq '.check_runs[0].conclusion = "success"' <<<"$CI_PR_RUNS")"
# A newer skipped or neutral run never hides the failed one (ci-tests.yml warns about this bypass).
for conclusion in neutral skipped; do
  CI 2 "ci-tests $conclusion on head" CI_PR_RUNS="$(jq --arg c "$conclusion" '.check_runs[0] |= (.id += 1 | .conclusion = $c)' <<<"$CI_PR_RUNS")
$CI_PR_RUNS"
done
# Deliberately reverse page order: the maximum id wins, not API array order.
rerun=$(jq '.check_runs[0] |= (.id += 1 | .conclusion = "success")' <<<"$CI_PR_RUNS")
CI 0 '' CI_PR_RUNS="$rerun
$CI_PR_RUNS"
# The real PR 1392 head: green at 19:22, then production went red at 20:19 before the merge.
CI 2 "passed before that on an older production; rerun ci-tests on head c587e4b" \
  CI_HEAD=c587e4b7a53a840eed609f371829397c71214ef7 \
  CI_PR_RUNS="$(cat "$CI_FIXTURE_DIR/pr-1392-head.check-runs.json")" \
  CI_BASE_RUNS="$(cat "$CI_FIXTURE_DIR/production.check-runs.json")"
# A rerun after production went red is current: the PR's own result decides.
CI 0 '' CI_HEAD=c587e4b7a53a840eed609f371829397c71214ef7 \
  CI_PR_RUNS="$(jq '.check_runs[0].started_at = "2026-10-11T21:00:00Z"' "$CI_FIXTURE_DIR/pr-1392-head.check-runs.json")" \
  CI_BASE_RUNS="$(cat "$CI_FIXTURE_DIR/production.check-runs.json")"
for status in queued in_progress; do
  CI 2 "ci-tests has not finished on head ${CI_HEAD:0:7}" CI_PR_RUNS="$(jq --arg s "$status" '.check_runs[0] |= (.status = $s | .conclusion = null)' <<<"$CI_PR_RUNS")"
done
for conclusion in failure cancelled timed_out action_required stale; do
  CI 2 "ci-tests $conclusion on head" CI_PR_RUNS="$(jq --arg c "$conclusion" '.check_runs[0].conclusion = $c' <<<"$CI_PR_RUNS")"
done
for endpoint in /pulls/1392 '/commits/'"$CI_HEAD" /commits/production; do
  CI 2 'cannot read ci-tests for PR 1392; retry' CI_GH_ERROR="$endpoint"
done
CI 2 'cannot read ci-tests for PR 1392; retry' CI_PR_RUNS=invalid
CI 2 'ci-tests is missing on head c587e4b; wait for the current-head run, or retrigger it' CI_HEAD=c587e4b7a53a840eed609f371829397c71214ef7 CI_PR_RUNS='{"check_runs":[]}'
CI 0 '' SHIP_REPO=hypertask-ai/cli SHIP_BASE=main CI_PR_RUNS='{"check_runs":[]}'
CI 0 '' SHIP_REPO=hypertask-ai/verify SHIP_BASE=app-suite CI_PR_RUNS='{"check_runs":[]}'
# Another repo never reads ci-tests, so a GitHub API error there cannot block its merge.
: > "$CI_CALL_LOG"
out=$(env SHIP_REPO=hypertask-ai/cli CI_GH_ERROR=check-runs ./ship-check ci-tests 1392); got=$?
if [ "$got" = 0 ] && [ -z "$out" ] && ! grep -q 'check-runs\|/pulls/' "$CI_CALL_LOG"; then ok 'other repo skips ci-tests API reads'
else bad "other repo API error: $got $out"; fi
CI 2 'see https://github.com/hypertask-ai/hypertask/actions/runs/38176733942/job/114581508375' CI_GH_ERROR=/logs
CI 2 'see https://github.com/hypertask-ai/hypertask/actions/runs/38176733942/job/114581508375' CI_LOG='no test identifiers'
CI 2 'tests/tap-control.test.cjs:42:1' CI_LOG=$'2026-10-11T21:53:04Z not ok 1 - TAP control\n2026-10-11T21:53:04Z   location: /home/runner/tests/tap-control.test.cjs:42:1\n  error: AssertionError'
CI 2 'named TAP failure' CI_LOG='not ok 1 - named TAP failure'
CI 2 'tests/stack-control.test.cjs:12:4' CI_LOG=$'Error: assertion\n    at TestContext.<anonymous> (/home/runner/tests/stack-control.test.cjs:12:4)'
CI 2 '(one; two; three)' CI_LOG=$'not ok 1 - one\nnot ok 2 - two\nnot ok 3 - three\nnot ok 4 - four'
CI 0 '' CI_PR_RUNS="$(jq '.check_runs[0].name = "other-check"' <<<"$CI_PR_RUNS")
$rerun"
out=$(./ship-check ci-tests 1392); got=$?
if [ "$got" = 1 ] && [[ $out == *tests/htpr-6971-chat-history-paging.test.cjs:774:1* ]]; then ok 'ci-tests subcommand rejects recorded failure'
else bad "ci-tests subcommand: $got $out"; fi
out=$(env SHIP_REPO=hypertask-ai/cli CI_PR_RUNS='{"check_runs":[]}' ./ship-check ci-tests 1392); got=$?
if [ "$got" = 0 ] && [ -z "$out" ]; then ok 'no ci-tests in other repo passes silently'
else bad "other repo: $got $out"; fi
unset -f gh hypertask
unset CI_FIXTURE_DIR CI_CALL_LOG CI_HEAD CI_PR_RUNS CI_BASE_RUNS CI_LOG

python3 ./premerge-evidence.test.py && ok 'poster regressions' || bad 'poster regressions'
echo "$passes passed, $fails failed"; [ "$fails" = 0 ] && echo 'ALL PASS: All ship-check tests passed'
