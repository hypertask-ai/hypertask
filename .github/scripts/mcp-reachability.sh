#!/usr/bin/env bash
set -euo pipefail

CHECK_DIR=$(mktemp -d)
trap 'rm -rf "$CHECK_DIR"' EXIT
FAILURES=""

notify() {
  if [ -n "${TG_TOKEN:-}" ] && [ -n "${TG_CHAT:-}" ]; then
    curl -s --max-time 20 -o /dev/null "https://api.telegram.org/bot$TG_TOKEN/sendMessage" \
      -d chat_id="$TG_CHAT" --data-urlencode text="$1" 2>/dev/null || true
  fi
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
      -w '%{http_code}' "$@" "$url") || status=000
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
      esac
    fi
    echo "[$attempt] $url: status=$status, x-vercel-mitigated=${mitigated:-none}, valid=$valid"
    if [ "$valid" = "true" ]; then return 0; fi
    if [ "$attempt" -lt 3 ]; then sleep 2; fi
  done
  FAILURES+="$url: status=$status, x-vercel-mitigated=${mitigated:-none} (expected $expected with valid $check metadata)"$'\n'
}

probe "https://mcp.hypertask.ai/mcp" 401 initialize \
  -X POST -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"prod-health","version":"1.0"}}}'
probe "https://mcp.hypertask.ai/.well-known/oauth-protected-resource" 200 resource
probe "https://app.hypertask.ai/.well-known/oauth-authorization-server" 200 authorization

if [ -n "$FAILURES" ]; then
  MSG="🔴 hypertasks: MCP reachability check failed.
${FAILURES}Likely fix: the Vercel firewall system bypass for mcp.hypertask.ai on project hypertasks-prod."
  notify "$MSG"
  echo "::error::$MSG"
  exit 1
fi

echo "MCP reachability checks passed."
