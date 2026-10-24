#!/usr/bin/env bash
set -uo pipefail
gate_tmp=$(mkdir -p "${RUNNER_TEMP:-/tmp}" && mktemp -d "${RUNNER_TEMP:-/tmp}/feature-flag-publish.XXXXXX") || exit 2
trap 'rm -rf "$gate_tmp"' EXIT
export GH_API_NO_WAIT=1
source .github/scripts/github-api-retry.sh
gh_api_failed=${EVALUATION_FAILED:-0}
failures=0

publish_status_if_current() {
  local record="$1"
  local number head_sha state evaluated_at newer_final evaluated_fingerprint fingerprint title base_sha labels head_pr_count
  number=$(jq -er '.pr_number' <<<"$record") || return 1
  head_sha=$(jq -er '.head_sha' <<<"$record") || return 1
  evaluated_at=$(jq -er '.evaluated_at' <<<"$record") || return 1
  evaluated_fingerprint=$(jq -r '.fingerprint // ""' <<<"$record") || return 1
  if ! jq -e '
    .payload.context == "feature-flag-gate" and
    (.payload.state == "success" or .payload.state == "failure" or .payload.state == "error")
  ' <<<"$record" >/dev/null; then
    echo "skip #$number: prepared status is not a final feature-flag-gate verdict"
    return 0
  fi
  state=$(jq -r '.payload.state' <<<"$record") || return 1
  gh_api "repos/$REPO/pulls/$number" >"$gate_tmp/current.json" || return 1
  if ! jq -e --arg sha "$head_sha" '
    .state == "open" and .base.ref == "production" and .head.sha == $sha
  ' "$gate_tmp/current.json" >/dev/null; then
    echo "skip #$number: pull request head or base moved before status publication"
    return 0
  fi
  title=$(jq -er '.title' "$gate_tmp/current.json") || return 1
  base_sha=$(jq -er '.base.sha' "$gate_tmp/current.json") || return 1
  labels=$(jq -c '[.labels[]?.name // empty] | sort' "$gate_tmp/current.json") || return 1
  gh_api --paginate --slurp "repos/$REPO/pulls?state=open&base=production&per_page=100" >"$gate_tmp/heads.json" || return 1
  head_pr_count=$(jq -er --arg sha "$head_sha" '[flatten[] | select(.head.sha == $sha)] | length' "$gate_tmp/heads.json") || return 1
  fingerprint="ffg=$base_sha.$(printf '%s\n%s' "$title" "$labels" | sha256sum | cut -c1-16).heads=$head_pr_count"
  if [ -n "$evaluated_fingerprint" ] && [ "$evaluated_fingerprint" != "$fingerprint" ]; then
    echo "skip #$number: evaluation inputs changed before status publication"
    return 0
  fi
  jq --arg target_url "$RUN_URL${fingerprint:+#$fingerprint}" '.payload | .target_url = $target_url' <<<"$record" >"$gate_tmp/payload.json" || return 1
  gh_api --paginate --slurp "repos/$REPO/commits/$head_sha/statuses?per_page=100" >"$gate_tmp/latest-statuses.json" || return 1
  if [ -z "$evaluated_fingerprint" ] && [ "$state" = "error" ]; then
    newer_final=$(jq -r --arg evaluated_at "$evaluated_at" --arg fingerprint "$fingerprint" '
      any(flatten[];
        .context == "feature-flag-gate" and
        (.state == "success" or .state == "failure" or .state == "error") and
        (.created_at | fromdateiso8601) >= ($evaluated_at | fromdateiso8601) and
        ((.target_url // "" | split("#")[1:] | join("#")) == $fingerprint)
      )
    ' "$gate_tmp/latest-statuses.json") || return 1
    if [ "$newer_final" = "true" ]; then
      echo "skip #$number: final with the current fingerprint was created after evaluation started"
      return 0
    fi
  fi
  if jq -e --arg fingerprint "$fingerprint" --arg state "$state" '
    flatten | map(select(.context == "feature-flag-gate"))[0] as $current |
    ($current.state == "success" or $current.state == "failure") and
    $current.state == $state and
    ($current.target_url // "" | split("#")[1:] | join("#")) == $fingerprint
  ' "$gate_tmp/latest-statuses.json" >/dev/null; then
    echo "skip #$number: final feature-flag-gate status has the same fingerprint and state"
    return 0
  fi
  gh_api -X POST "repos/$REPO/statuses/$head_sha" --input "$gate_tmp/payload.json" >/dev/null
}

jq -c --arg head_sha "$PUBLISH_HEAD_SHA" '.[] | select(.head_sha == $head_sha)' <<<"$PREPARED_STATUSES" >"$gate_tmp/statuses.jsonl" || exit 2
while IFS= read -r record; do
  if ! publish_status_if_current "$record"; then
    echo "::error::Cannot publish prepared feature-flag-gate status."
    failures=$((failures + 1))
  fi
done <"$gate_tmp/statuses.jsonl"
if [ "$failures" -gt 0 ]; then exit 2; fi
