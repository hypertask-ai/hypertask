#!/usr/bin/env bash
# YPER4-984: the drift check used to live inline in prod-health.yml, where only a
# cron could start it. The scheduled production watch is its own chained workflow
# now, and a manual prod-health dispatch still runs the same check, so one body
# serves both and the two cannot drift apart.
set -uo pipefail

api() { curl -s -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com$1"; }

TIP=$(git rev-parse HEAD)
DRIFT_DIR="${RUNNER_TEMP:-/tmp}/drift-$$"
mkdir -p "$DRIFT_DIR"

# What users hit. The newest READY row is only a guess at live
# (HTPR-6511).
fetch_live_version() {
  rm -f "$DRIFT_DIR/version.json" "$DRIFT_DIR/version.h"
  version_code=$(curl -s -o "$DRIFT_DIR/version.json" -D "$DRIFT_DIR/version.h" -w '%{http_code}' --max-time 30 \
    "https://app.hypertask.ai/api/version") || version_code=000
  version_challenged=no
  if grep -qi '^x-vercel-mitigated: *challenge' "$DRIFT_DIR/version.h" 2>/dev/null; then
    version_challenged=yes
  fi
  LIVE=$(jq -r '.buildId // empty' "$DRIFT_DIR/version.json" 2>/dev/null) || LIVE=""
}

fetch_live_version

if [ "$version_code" != "200" ] || [ "$version_challenged" = "yes" ] || [ -z "$LIVE" ]; then
  echo "/api/version unverifiable (status $version_code, challenged=$version_challenged); falling back to Vercel production target"
  LIVE=$(api "/v9/projects/$PROJECT_ID?teamId=$TEAM_ID" \
    | jq -r '.targets.production.meta.githubCommitSha // empty') || LIVE=""
fi

if [ -z "$LIVE" ]; then
  echo "No live production SHA from /api/version or Vercel target; nothing to compare."
  exit 0
fi

echo "production tip: $TIP"
echo "live deploy: $LIVE"
[ "$TIP" = "$LIVE" ] && { echo "Production is on the production tip."; exit 0; }

# A deploy in flight is normal: the tip is only a problem once its own
# build has had time to finish, so ignore a tip pushed in the last 15
# minutes and only complain about a live commit that is genuinely older.
AGE=$(( $(date +%s) - $(git log -1 --format=%ct "$TIP") ))
[ "$AGE" -lt 900 ] && { echo "Staging tip is ${AGE}s old; a deploy is probably still in flight."; exit 0; }

if git merge-base --is-ancestor "$LIVE" "$TIP" 2>/dev/null; then
  # Commits the deploy ignore-step skips (docs, .github) never
  # build, so being "behind" by only those is the expected steady state.
  if node scripts/vercel-ignore-build.cjs --between "$LIVE" "$TIP"; then
    echo "Live deploy is behind only by non-building commits (docs/CI); nothing to promote."
    exit 0
  fi
  # A build that failed, or is still running, is not drift: the health
  # job already alarms it (cause deploy-build) and the live site
  # correctly keeps the last good deploy. Reporting both filed two
  # tickets for one broken build (YPER4-969). A canceled build has no
  # other alarm, so it still counts as drift.
  TIP_STATE=$(api "/v6/deployments?projectId=$PROJECT_ID&teamId=$TEAM_ID&target=production&limit=20" \
    | jq -r --arg sha "$TIP" 'if (.deployments | type) == "array" then
          ([.deployments[] | select(.meta.githubCommitSha == $sha)]
            | (map(select(.state == "READY")) + .) | .[0].state // "NOTFOUND")
        else "UNKNOWN" end') || TIP_STATE="UNKNOWN"
  echo "tip deploy state: $TIP_STATE"
  case "$TIP_STATE" in
    ERROR)
      echo "The production build for ${TIP:0:9} failed; the build alarm covers it, so this is not drift."
      exit 0 ;;
    QUEUED|BUILDING|INITIALIZING)
      echo "The production build for ${TIP:0:9} is still $TIP_STATE; a deploy is in flight."
      exit 0 ;;
  esac
  BEHIND=$(git rev-list --count "$LIVE..$TIP" 2>/dev/null || echo "?")

  MSG="🔴 hypertasks: production is serving ${LIVE:0:9}, which is $BEHIND commit(s) BEHIND the production tip ${TIP:0:9}. Alert only; no deployment was promoted."
else
  MSG="🔴 hypertasks: production is serving ${LIVE:0:9}, which is not an ancestor of the production tip ${TIP:0:9}. The live app is on a commit that is not on production at all."
fi

node .github/scripts/production-alert.mjs setup deploy-drift "$MSG" || true
echo "::error::$MSG"
exit 1
