#!/usr/bin/env bash
set -euo pipefail

CHECK_DIR=$(mktemp -d)
trap 'rm -rf "$CHECK_DIR"' EXIT
FAILURES=""
LIVE_FAILURE=false

notify() {
  node .github/scripts/production-alert.mjs "$1" "$2" "$3" || true
}

probe() {
  local url="$1" expected="$2" check="$3"
  shift 3
  local attempt status mitigated valid
  for attempt in 1 2 3; do
    # Curl may leave files untouched on connection failure; never reuse a response.
    : > "$CHECK_DIR/headers"
    : > "$CHECK_DIR/body"
    status=$(curl -s --max-time 20 -D "$CHECK_DIR/headers" -o "$CHECK_DIR/body" \
      -w '%{http_code}' "$@" "$url" 2>/dev/null) || status=000
    mitigated=$(awk 'tolower($0) ~ /^x-vercel-mitigated:/ {sub(/^[^:]*:[ \t]*/, ""); sub(/\r$/, ""); print length($0) ? $0 : "(empty)"}' "$CHECK_DIR/headers")
    valid=false
    if [ "$status" = "$expected" ] && ! grep -qi '^x-vercel-mitigated:' "$CHECK_DIR/headers"; then
      case "$check" in
        initialize)
          if grep -qi '^www-authenticate:.*resource_metadata=' "$CHECK_DIR/headers"; then valid=true; fi
          ;;
        resource)
          if jq -e '.resource == "https://mcp.hypertask.ai/mcp"' "$CHECK_DIR/body" >/dev/null 2>&1; then valid=true; fi
          ;;
        authorization)
          if jq -e '.token_endpoint | type == "string" and length > 0' "$CHECK_DIR/body" >/dev/null 2>&1; then valid=true; fi
          ;;
        app)
          valid=true
          ;;
        firewall)
          # MCP clients cannot solve the platform challenge, so mcp.hypertask.ai
          # needs an all-sources system bypass (stored as 0.0.0.0/0 and ::/0).
          # The other hosts are covered by the live probes above.
          if jq -e '
            [.result[] | select(.Domain == "mcp.hypertask.ai" and .Action == "bypass")] as $entries |
            any($entries[]; .Ip == "0.0.0.0/0") and any($entries[]; .Ip == "::/0")
          ' "$CHECK_DIR/body" >/dev/null 2>&1; then valid=true; fi
          ;;
      esac
    fi
    echo "[$attempt] $url: status=$status, x-vercel-mitigated=${mitigated:-none}, valid=$valid"
    if [ "$valid" = "true" ]; then return 0; fi
    if [ "$attempt" -lt 3 ]; then sleep 2; fi
  done
  if [ "$check" != "firewall" ]; then LIVE_FAILURE=true; fi
  FAILURES+="$url: status=$status, x-vercel-mitigated=${mitigated:-none} (expected $expected with valid $check response)"$'\n'
}

probe "https://mcp.hypertask.ai/mcp" 401 initialize \
  -X POST -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"prod-health","version":"1.0"}}}'
probe "https://mcp.hypertask.ai/.well-known/oauth-protected-resource" 200 resource
probe "https://app.hypertask.ai/.well-known/oauth-authorization-server" 200 authorization
probe "https://api.hypertask.ai/api/mcp/tasks" 401 app
probe "https://app.hypertask.ai/api/mcp/tasks" 401 app
probe "https://app.hypertask.ai/api/ai-chat/all-sessions" 401 app
# Live unauthenticated POST {} returns 401 from the app, not a platform challenge.
probe "https://app.hypertask.ai/api/ai/chat/stream" 401 app \
  -X POST -H 'content-type: application/json' -d '{}'

if [ -n "${VERCEL_TOKEN:-}" ]; then
  PROJECT_ID=${PROJECT_ID:-prj_oEok2iMNFPzj6AWe1KQBaIAcPaAf}
  TEAM_ID=${TEAM_ID:-team_yureFlJZ6ibwebaOOkKc5whs}
  probe "https://api.vercel.com/v1/security/firewall/bypass?projectId=$PROJECT_ID&teamId=$TEAM_ID" 200 firewall \
    -H "Authorization: Bearer $VERCEL_TOKEN"
else
  echo "No VERCEL_TOKEN; skipped firewall bypass setting guard."
fi

if [ -n "$FAILURES" ]; then
  MSG="🔴 hypertasks: API reachability check failed.
${FAILURES}Likely fix: the Vercel firewall system bypass for the affected host on project hypertasks-prod. Ensure all-sources bypass entries for mcp.hypertask.ai."
  if $LIVE_FAILURE; then notify live api-reachability "$MSG"; else notify setup firewall-settings "$MSG"; fi
  echo "::error::$MSG"
  exit 1
fi

echo "API reachability checks passed."
