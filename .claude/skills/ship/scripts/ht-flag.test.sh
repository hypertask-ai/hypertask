#!/usr/bin/env bash
set -euo pipefail
trap 'printf "ht-flag test failed at line %s\n" "$LINENO" >&2' ERR
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
for bad_reason in \
  'https://app.hypertask.ai/detail/project-4060/215' \
  'https://app.hypertask.ai/page/approval#comment-123' \
  'https://evil.test/detail/project-4060/215#comment-123' \
  'https://app.hypertask.ai.evil.test/detail/project-4060/215#comment-123' \
  'https://app.hypertask.ai@evil.test/detail/project-4060/215#comment-123' \
  'https://app.hypertask.ai/detail/project-4060/215?extra=1#comment-123' \
  'https://app.hypertask.ai/detail/project-4060/215#comment-0' \
  'https://app.hypertask.ai/detail/project-4060/215#comment-1000000000' \
  'https://app.hypertask.ai/detail/project-1000000000/215#comment-123' \
  'https://app.hypertask.ai/detail/project-4060/1000000000#comment-123' \
  "${reason}junk" "${reason}?extra=1" "${reason}/extra" "${reason}#extra"; do
  reject set "$key" off --reason "$bad_reason"
  grep -qE 'clear yes from Valentin within 7 days:.*thumbs up on a switch question.*ticket yes after exactly one switch question.*in-chat record.*HT Product Lead.*#comment-<id>.*questions name Switch <flag-key> to <mode>' "$tmp/output"
done
reject set "$key" off --reason 'https://app.hypertask.ai/page/approval'
reject set "$key" off --reason 'https://app.hypertask.ai/detail/project-4060/215/extra'
reject set "$key" off --reason 'https://app.hypertask.ai/detail/project-4060/2147483648'
reject set "$key" off --reason 'http://app.hypertask.ai/detail/project-4060/215'
reject set "$key" off --reason 'https://evil.test/detail/project-4060/215'
reject set "$key" off --reason 'https://app.hypertask.ai.evil.test/detail/project-4060/215'
reject set "$key" off --reason 'https://app.hypertask.ai@evil.test/detail/project-4060/215'
reject set "$key" off --reason 'https://app.hypertask.ai/admin/flags'
reject set "$key" off --reason 'https://app.hypertask.ai/detail/../admin/flags'
reject set "$key" off --reason "https://app.hypertask.ai/page/$(printf '%0500d' 0)"
ai_review='https://github.com/hypertask-ai/hypertask/pull/123'
live_qa='https://qa.example.test/pass'
independent='Checked independently'
"$script" review "$key" everyone --ai-review "$ai_review" --independent "$independent" --live-qa "$live_qa" --dry-run |
  jq -e --arg key "$key" --arg ai "$ai_review" --arg text "$independent" --arg qa "$live_qa" \
    '.method == "POST" and .url == "https://app.hypertask.ai/api/mcp/flags/reviews" and .body == {key:$key,mode:"EVERYONE",aiReviewUrl:$ai,independentReview:$text,liveQaUrl:$qa,inboxCycle:"passed"}' >/dev/null
"$script" set "$key" everyone --review 42 --dry-run | jq -e '.method == "PATCH" and .body.review == 42 and .body.mode == "EVERYONE" and (.body | has("reason") | not)' >/dev/null
"$script" set "$key" off --failure "$live_qa" --dry-run | jq -e --arg qa "$live_qa" '.body.failure == $qa and .body.mode == "OFF"' >/dev/null
reject set "$key" off --review 42
reject set "$key" everyone --failure "$live_qa"
reject set "$key" everyone --review 0
reject set "$key" everyone --review 1.5
reject set "$key" everyone --review 9007199254740992
for failure_reason in 'Emergency safety stop' 'http://qa.test/fail' "$(printf '%0300d' 0)"; do
  "$script" set "$key" off --failure "$failure_reason" --dry-run |
    jq -e --arg reason "$failure_reason" '.body.failure == $reason and .body.mode == "OFF"' >/dev/null
done
for failure_reason in '' ' ' $'\t\n' "$(printf '%0301d' 0)"; do
  reject set "$key" off --failure "$failure_reason"
done
reject set "$key" everyone --review 42 --reason "$reason"
reject review "$key" off --ai-review "$ai_review" --independent "$independent" --live-qa "$live_qa"
reject review "$key" everyone --ai-review https://github.com/other/repo/pull/123 --independent "$independent" --live-qa "$live_qa"
reject review "$key" everyone --ai-review "$ai_review" --independent ' ' --live-qa "$live_qa"
reject review "$key" everyone --ai-review "$ai_review" --independent "$independent" --live-qa http://qa.test/pass
reject review "$key" everyone --ai-review "$ai_review" --independent "$independent"
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
expected='header = "Authorization: Bearer offline-test-credential"'
if [ -n "${TEST_GRANT:-}" ]; then expected+=$'\n'"header = \"X-Manager-Grant: $TEST_GRANT\""; fi
[ "$config" = "$expected" ] || exit 1
[[ "$*" != *offline-test-credential* ]] || exit 1
[[ -z "${TEST_GRANT:-}" || "$*" != *"$TEST_GRANT"* ]] || exit 1
output=''
method=GET
while [ "$#" -gt 0 ]; do
  if [ "$1" = --output ]; then output=$2; shift; fi
  if [ "$1" = --request ]; then method=$2; shift; fi
  shift
done
if [ "${TEST_TIMEOUT:-}" = 1 ] && [ "$method" = PATCH ]; then exit 28; fi
if [ "${TEST_TIMEOUT:-}" = 1 ]; then printf '%s' "$TEST_STATE"; exit 0; fi
if [ -n "${TEST_RESPONSE:-}" ]; then
  printf '%s\n' "$TEST_RESPONSE" > "$output"
else
  printf '%s\n' '{"flag":{"mode":"OFF"}}' > "$output"
fi
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
grep -qE 'Forbidden' "$tmp/output"
if grep -qE 'offline-test-credential' "$tmp/output"; then
  printf 'credential leaked\n' >&2
  exit 1
fi
TEST_STATUS=201 TEST_RESPONSE='{"review":{"id":42}}' "$script" review "$key" everyone --ai-review "$ai_review" --independent "$independent" --live-qa "$live_qa" > "$tmp/output" 2>&1
grep -qE '^review 42$' "$tmp/output"
for api_error in 'The review must be recorded by a different agent' 'Failure-Off is not allowed for high-risk flags'; do
  if [[ $api_error == *high-risk* ]]; then
    switch_args=(off --failure "$live_qa")
  else
    switch_args=(everyone --review 42)
  fi
  if TEST_STATUS=403 TEST_RESPONSE="$(jq -nc --arg error "$api_error" '{error:$error}')" "$script" set "$key" "${switch_args[@]}" > "$tmp/output" 2>&1; then
    printf 'API refusal must fail\n' >&2
    exit 1
  fi
  grep -qE "$api_error" "$tmp/output"
done
grant_value=$(printf 'g%.0s' $(seq 1 43))
printf '{"session":"s","token":"%s"}\n' "$grant_value" > "$tmp/receipt.json"
HT_MANAGER_GRANT_FILE="$tmp/receipt.json" TEST_GRANT="$grant_value" "$script" set "$key" off --reason "$reason" > "$tmp/output" 2>&1
! grep -q "$grant_value" "$tmp/output"
printf '{"session":"s","token":"short"}\n' > "$tmp/receipt.json"
if HT_MANAGER_GRANT_FILE="$tmp/receipt.json" "$script" set "$key" off --reason "$reason" > "$tmp/output" 2>&1; then
  printf 'malformed grant must fail\n' >&2
  exit 1
fi
grep -q 'malformed' "$tmp/output"
if TEST_TIMEOUT=1 TEST_STATE="$(jq -nc --arg key "$key" '{flags:[{key:$key,mode:"OFF"}]}')" "$script" set "$key" off --reason "$reason" > "$tmp/output" 2>&1; then
  printf 'timeout must fail\n' >&2
  exit 1
fi
grep -q "timed out; $key is now OFF (requested OFF)" "$tmp/output"
if TEST_TIMEOUT=1 TEST_STATE='not json' "$script" set "$key" off --reason "$reason" > "$tmp/output" 2>&1; then
  printf 'unknown state must fail\n' >&2
  exit 1
fi
grep -q 'switch state is unknown' "$tmp/output"
printf 'ht-flag tests passed\n'
