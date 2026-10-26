#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
E=$(mktemp -d)
trap 'rm -rf "$E"' EXIT
mkdir -p "$E/bin" "$E/source" "$E/evidence/YPER4-999"
git -C "$E/source" init -q
git -C "$E/source" -c user.name=Fixture -c user.email=fixture@example.test commit --allow-empty -qm engine
sha=$(git -C "$E/source" rev-parse HEAD)
head=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
export VCC_EVIDENCE_DIR="$E/evidence" FIXTURE="$E" MERGE_SHA="$sha"
export SHIP_REPO=hypertask-ai/reviewer SHIP_BASE=main SHIP_DEPLOY=none
printf '999\n' > "$E/evidence/YPER4-999/pr"
cat > "$E/bin/gh" <<'MOCK'
#!/usr/bin/env bash
case "$1:$2" in
  pr:view) printf '{"number":999,"title":"YPER4-999 [INFRA] Fixture","state":"MERGED","mergeCommit":{"oid":"%s"},"baseRefName":"main"}\n' "$MERGE_SHA" ;;
  release:view) exit 1 ;;
  release:list) printf '%s\n' "${RELEASES:-[]}" ;;
  api:repos/*/compare/*) echo behind ;;
  api:repos/hypertask-ai/reviewer/actions/runs/101) cat "$FIXTURE/ci.json" ;;
  api:repos/hypertask-ai/reviewer/actions/runs/202) cat "$FIXTURE/review.json" ;;
  api:repos/hypertask-ai/reviewer/actions/runs/101/jobs*) cat "$FIXTURE/ci-jobs.json" ;;
  api:repos/hypertask-ai/reviewer/actions/runs/202/jobs*) cat "$FIXTURE/review-jobs.json" ;;
  api:repos/hypertask-ai/hypertask/commits/*/statuses*) cat "$FIXTURE/statuses.json" ;;
  api:repos/hypertask-ai/reviewer/actions/runs\?*) cat "$FIXTURE/runs.json" ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$E/bin/gh"
export PATH="$E/bin:$PATH"
proof="$E/evidence/YPER4-999/live-proof"
write_proof() {
  printf 'sha: %s\nsource: %s\ncheck: reviewer-workflow\nci: https://github.com/hypertask-ai/reviewer/actions/runs/101\nreview: https://github.com/hypertask-ai/reviewer/actions/runs/202\ntarget: https://github.com/hypertask-ai/hypertask/pull/1658\nhead: %s\n' "$sha" "$E/source" "$head" > "$proof"
}
jq -n --arg sha "$sha" '{id:101,head_sha:$sha,head_branch:"main",path:".github/workflows/ci.yml",event:"push",status:"completed",conclusion:"success"}' > "$E/ci.json"
jq -n --arg sha "$sha" --arg head "$head" '{id:202,head_sha:$sha,head_branch:"main",path:".github/workflows/review.yml",name:("Review hypertasks PR #1658 @ " + $head),event:"repository_dispatch",status:"completed",conclusion:"success"}' > "$E/review.json"
printf '{"jobs":[{"name":"test","conclusion":"success","status":"completed"}]}\n' > "$E/ci-jobs.json"
printf '{"jobs":[{"conclusion":"success","status":"completed","steps":[{"name":"Review pull request with GPT-6.1 Sol high","conclusion":"success"}]}]}\n' > "$E/review-jobs.json"
printf '[{"id":2,"context":"ai-review","state":"success","target_url":"https://github.com/hypertask-ai/reviewer/actions/runs/202"},{"id":1,"context":"claude-review","state":"success","target_url":"https://github.com/hypertask-ai/reviewer/actions/runs/202"}]\n' > "$E/statuses.json"
jq -n --arg sha "$sha" '{workflow_runs:[{head_sha:$sha,head_branch:"main",path:".github/workflows/ci.yml",event:"push",status:"completed",conclusion:"success",html_url:"https://github.com/hypertask-ai/reviewer/actions/runs/101"},{head_sha:$sha,path:".github/workflows/review.yml",event:"repository_dispatch",status:"completed",conclusion:"failure"}]}' > "$E/runs.json"
check() {
  local want=$1 label=$2 out code=0
  out=$(./ship-check deployed YPER4-999 2>&1) || code=$?
  if [[ $code != "$want" ]] || { [[ $want == 0 ]] && [[ $out != 'deployed ok (reviewer workflow proof,'* ]]; }; then
    printf 'FAIL %s: expected %s, got %s: %s\n' "$label" "$want" "$code" "$out"
    exit 1
  fi
  printf 'ok %s\n' "$label"
}
write_proof
check 0 'exact-engine CI and intended live review survive unrelated CONCERNS'
rm "$proof"
check 1 'missing proof rejected'
write_proof
for change in \
  's/^sha:.*/sha: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/' \
  's/^head:.*/head: bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/' \
  's@/pull/1658@/pull/1665@' \
  's@runs/202@runs/999@' \
  's@runs/101@runs/999@' \
  '/^review:/d' \
  '/^target:/d' \
  's@check: reviewer-workflow@check: shell anything@'; do
  sed -i "$change" "$proof"
  check 1 "proof mismatch: $change"
  write_proof
done
for file in ci review; do
  cp "$E/$file.json" "$E/original.json"
  for change in '.head_sha = "other"' '.head_branch = "feature"' '.path = ".github/workflows/other.yml"' '.event = "pull_request"' '.status = "queued"' '.conclusion = "failure"' '.conclusion = "cancelled"' 'del(.id)'; do
    jq "$change" "$E/original.json" > "$E/$file.json"
    check 1 "$file run rejected: $change"
  done
  cp "$E/original.json" "$E/$file.json"
done
for file in ci-jobs review-jobs; do
  cp "$E/$file.json" "$E/original.json"
  for change in '.jobs = []' '.jobs[0].conclusion = "skipped"' '.jobs[0].conclusion = "failure"'; do
    jq "$change" "$E/original.json" > "$E/$file.json"
    check 1 "$file rejected: $change"
  done
  cp "$E/original.json" "$E/$file.json"
done
cp "$E/statuses.json" "$E/original.json"
for change in 'map(.state = "failure")' 'map(.target_url = "https://github.com/hypertask-ai/reviewer/actions/runs/999")' '.[0:1]' '[]'; do
  jq "$change" "$E/original.json" > "$E/statuses.json"
  check 1 "published verdict rejected: $change"
done
cp "$E/original.json" "$E/statuses.json"
check 0 'valid proof still passes after rejected evidence'
RELEASES='[{"tagName":"v1"}]' check 1 'existing release cannot use reviewer exception'
SHIP_REPO=hypertask-ai/other check 1 'other repositories cannot use reviewer exception'
SHIP_BASE=production check 1 'other bases cannot use reviewer exception'
printf 'reviewer deployment checks passed\n'
