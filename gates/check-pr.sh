#!/usr/bin/env bash
set -euo pipefail
export GH_TOKEN=$(gh-app-token)
json=$(gh pr view ci-runner-4/hyci-82 --repo hypertask-ai/hypertask --json number,title,isDraft,autoMergeRequest,headRefOid,url)
num=$(jq -r .number <<<"$json"); title=$(jq -r .title <<<"$json")
auto=$(jq -r .autoMergeRequest <<<"$json")
[[ $title == HYCI-82* ]] || { echo "title is not the ticket: $title"; exit 1; }
[[ $auto == null ]] || { echo "auto-merge is on"; exit 1; }
echo "G5 ok: PR open with ticket title and auto-merge off ($(jq -r .url <<<"$json"))"
