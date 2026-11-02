#!/usr/bin/env bash
# YPER4-984: the Pusher status check used to live inline in prod-health.yml. The
# scheduled production watch and the push path both run it, so the body lives
# here and neither copy can drift.
set -uo pipefail

STATUS_JSON=$(curl -s --max-time 15 "https://status.pusher.com/api/v2/status.json") || STATUS_JSON=""
INDICATOR=$(echo "$STATUS_JSON" | jq -r '.status.indicator // empty') || INDICATOR=""
DESCRIPTION=$(echo "$STATUS_JSON" | jq -r '.status.description // "unknown"') || DESCRIPTION="unknown"

if [ -z "$INDICATOR" ]; then
  echo "::warning::Could not read Pusher status page; skipping"
  exit 0
fi

echo "Pusher status: $INDICATOR ($DESCRIPTION)"

if [ "$INDICATOR" = "none" ]; then
  echo "Pusher is operational."
  exit 0
fi

# Also surface which Channels component is affected, for a useful alert.
COMPONENTS_JSON=$(curl -s --max-time 15 "https://status.pusher.com/api/v2/components.json") || COMPONENTS_JSON=""
AFFECTED=$(echo "$COMPONENTS_JSON" | jq -r '[.components[]? | select(.name | test("Channels"; "i")) | select(.status != "operational") | "\(.name): \(.status)"] | join(", ")') || AFFECTED=""
[ -z "$AFFECTED" ] && AFFECTED="no Channels component reported as degraded"

case "$INDICATOR" in
  critical|major)
    echo "Pusher (live board/task updates) is reporting '$INDICATOR' — $DESCRIPTION. Affected: $AFFECTED. https://status.pusher.com"
    echo "::error::Pusher status is $INDICATOR: $DESCRIPTION ($AFFECTED)"
    exit 1
    ;;
  minor)
    echo "Pusher (live board/task updates) is reporting '$INDICATOR' — $DESCRIPTION. Affected: $AFFECTED. https://status.pusher.com"
    echo "::warning::Pusher status is $INDICATOR: $DESCRIPTION ($AFFECTED)"
    exit 0
    ;;
  *)
    echo "::warning::Pusher status is unrecognized indicator '$INDICATOR': $DESCRIPTION"
    exit 0
    ;;
esac
