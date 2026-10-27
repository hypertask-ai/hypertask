#!/bin/bash
# wait for PR 2143 to merge, then for that merge commit to reach prod READY
cd /home/valentin/projects/ht-feedback
for i in $(seq 1 60); do
  st=$(gh pr view 2143 --json state --jq .state 2>/dev/null)
  [ "$st" = "MERGED" ] && break
  [ "$st" = "CLOSED" ] && echo "PR CLOSED UNMERGED" && exit 1
  sleep 45
done
git fetch -q origin staging
SHA=$(git rev-parse origin/staging)
echo "MERGED sha=${SHA:0:9}"
set -a; . ~/.config/val-staging/credentials.env; set +a
unset VERCEL_PROJECT_ID VERCEL_ORG_ID
for i in $(seq 1 60); do
  d=$(curl -s "https://api.vercel.com/v6/deployments?projectId=prj_oEok2iMNFPzj6AWe1KQBaIAcPaAf&target=production&limit=3" -H "Authorization: Bearer $VERCEL_TOKEN")
  ok=$(jq -r --arg s "$SHA" '.deployments[] | select(.meta.githubCommitSha==$s) | (.state // .readyState)' <<<"$d" 2>/dev/null | head -1)
  [ "$ok" = "READY" ] && echo "DEPLOY READY" && exit 0
  [ "$ok" = "ERROR" ] && echo "DEPLOY ERROR" && exit 1
  sleep 45
done
echo "TIMED OUT"
