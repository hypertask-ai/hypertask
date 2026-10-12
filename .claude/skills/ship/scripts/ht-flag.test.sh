#!/usr/bin/env bash
set -euo pipefail
script="$(cd "$(dirname "$0")" && pwd)/ht-flag"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp"
mkdir -p "$HOME/.agents/skills/ship/scripts"
cat > "$HOME/.agents/skills/ship/scripts/ship-identity" <<'SH'
#!/usr/bin/env bash
printf 'dry-run must not access identity\n' >&2
exit 1
SH
chmod +x "$HOME/.agents/skills/ship/scripts/ship-identity"
reason='https://app.hypertask.ai/detail/project-4060/215#comment-123'
key='htpr-6136-figma-connect'

"$script" get --dry-run | jq -e '.method == "GET" and .url == "https://app.hypertask.ai/api/mcp/flags" and .body == null' >/dev/null
HT_BASE_URL=http://localhost:3000/ "$script" --dry-run get "$key" | jq -e --arg key "$key" '.url == ("http://localhost:3000/api/mcp/flags?key=" + $key)' >/dev/null
for pair in 'off OFF' 'everyone EVERYONE' 'owner-qa OWNER_AND_QA' 'only-me OWNER_ONLY' 'OFF OFF' 'EVERYONE EVERYONE' 'OWNER_AND_QA OWNER_AND_QA' 'OWNER_ONLY OWNER_ONLY'; do
  read -r input expected <<< "$pair"
  "$script" set "$key" "$input" --reason "$reason" --dry-run | jq -e --arg mode "$expected" --arg reason "$reason" --arg key "$key" \
    '.method == "PATCH" and .body == {key:$key,mode:$mode,reason:$reason}' >/dev/null
done
"$script" set "$key" off --reason 'https://app.hypertask.ai/page/approval' --dry-run | jq -e '.body.reason == "https://app.hypertask.ai/page/approval"' >/dev/null

reject() {
  if "$script" "$@" --dry-run >"$tmp/output" 2>&1; then
    printf 'unexpected success: %s\n' "$*" >&2
    exit 1
  fi
}
reject
reject delete "$key"
reject get ''
reject get 'Bad Key'
reject get "$key" extra
reject set "$key" on --reason "$reason"
reject set "$key" off
reject set '' off --reason "$reason"
reject set "$key" off --reason ''
reject set "$key" off --reason 'http://app.hypertask.ai/detail/project-4060/215'
reject set "$key" off --reason 'https://evil.test/detail/project-4060/215'
reject set "$key" off --reason 'https://app.hypertask.ai.evil.test/detail/project-4060/215'
reject set "$key" off --reason 'https://app.hypertask.ai@evil.test/detail/project-4060/215'
reject set "$key" off --reason 'https://app.hypertask.ai/admin/flags'
reject set "$key" off --reason 'https://app.hypertask.ai/detail/../admin/flags'
reject set "$key" off --reason "https://app.hypertask.ai/page/$(printf '%0500d' 0)"
mkdir -p "$tmp/bin"
printf 'offline-test-credential\n' > "$tmp/credential"
cat > "$HOME/.agents/skills/ship/scripts/ship-identity" <<'SH'
#!/usr/bin/env bash
printf 'Runner 3\t%s/credential\n' "$HOME"
SH
cat > "$tmp/bin/curl" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
config=$(cat)
[ "$config" = 'header = "Authorization: Bearer offline-test-credential"' ] || exit 1
[[ "$*" != *offline-test-credential* ]] || exit 1
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then output=$2; shift; fi
  shift
done
printf '%s\n' "${TEST_RESPONSE:-{\"flag\":{\"mode\":\"OFF\"}}}" > "$output"
printf '%s' "${TEST_STATUS:-200}"
SH
chmod +x "$tmp/bin/curl"
export PATH="$tmp/bin:$PATH"
"$script" set "$key" off --reason "$reason" > "$tmp/output" 2>&1
jq -e '.flag.mode == "OFF"' "$tmp/output" >/dev/null
if TEST_STATUS=403 TEST_RESPONSE='{"error":"Forbidden"}' "$script" get > "$tmp/output" 2>&1; then
  printf 'non-2xx must fail\n' >&2
  exit 1
fi
rg -q 'Forbidden' "$tmp/output"
if rg -q 'offline-test-credential' "$tmp/output"; then
  printf 'credential leaked\n' >&2
  exit 1
fi
printf 'ht-flag tests passed\n'
