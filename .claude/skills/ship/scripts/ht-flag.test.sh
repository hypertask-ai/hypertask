#!/usr/bin/env bash
set -euo pipefail
trap 'printf "ht-flag test failed at line %s\n" "$LINENO" >&2' ERR
script="$(cd "$(dirname "$0")" && pwd)/ht-flag"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp" VCC_EVIDENCE_DIR="$tmp/evidence"
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
reject set "$key" off --failure http://qa.test/fail
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
[ "$config" = 'header = "Authorization: Bearer offline-test-credential"' ] || exit 1
[[ "$*" != *offline-test-credential* ]] || exit 1
output=''
method=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = --request ]; then method=$2; shift
  elif [ "$1" = --output ]; then output=$2; shift; fi
  shift
done
if [ "$method" = GET ] && [ -n "${TEST_FLAGS:-}" ]; then
  printf '%s\n' "$TEST_FLAGS" > "$output"
  if [ "${TEST_REOPEN:-0}" = 1 ]; then printf 'In Progress\n' > "$HOME/section"; fi
elif [ -n "${TEST_RESPONSE:-}" ]; then
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
cat > "$tmp/bin/vcc" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[ "$SHIP_SESSION_NAME" = 'Runner 3' ] || exit 92
printf '%s\n' "$*" >> "$HOME/vcc-log"
case "$1:$2" in
  task:get)
    if [ "${TEST_REREAD_ERROR:-0}" = 1 ] && [ "$(grep -c '^task get ' "$HOME/vcc-log")" = 2 ]; then exit 1; fi
    section=${TEST_SECTION:-Flags}
    if [ -f "$HOME/section" ]; then section=$(cat "$HOME/section"); fi
    jq -nc --arg section "$section" --arg url "${TEST_TASK_URL:-}" '{success:true,tasks:[{section:$section,url:$url}]}' ;;
  task:move) [ "$*" = 'task move HTPR-6136 --section Done' ] || exit 93; [ "${TEST_MOVE_ERROR:-0}" = 0 ] ;;
  *) exit 94 ;;
esac
SH
cat > "$tmp/bin/gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[ "$SHIP_SESSION_NAME" = 'Runner 3' ] || exit 95
case "$1:$2" in
  pr:list) echo '[{"number":10,"title":"HTPR-6136 [FEATURE] Example","createdAt":"2026-10-24"}]' ;;
  pr:view) printf '%s\n' "${TEST_PR_BODY:-}" ;;
  api:*) [ "${TEST_PR_ERROR:-0}" = 0 ] || exit 1; printf '%s\n' "${TEST_PR_FILES:-[[]]}" ;;
  *) exit 96 ;;
esac
SH
chmod +x "$tmp/bin/vcc" "$tmp/bin/gh"
export TEST_RESPONSE='{"flag":{"key":"htpr-6136-figma-connect","mode":"EVERYONE","ticketId":"HTPR-6136"}}'
export TEST_FLAGS='{"flags":[{"key":"htpr-6136-figma-connect","mode":"EVERYONE"}]}'
regression_pending() {
  : > "$HOME/vcc-log"
  TEST_FLAGS='{"flags":[{"key":"htpr-6136-figma-connect","mode":"EVERYONE"},{"key":"htpr-6136-another","mode":"OWNER_AND_QA"}]}' "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1 # gitleaks:allow
  if grep -q '^task move ' "$HOME/vcc-log"; then echo 'FAIL: pending sibling completed'; exit 1; fi
  grep -q 'htpr-6136-another=OWNER_AND_QA' "$tmp/output"
  echo 'ok successful switch with pending sibling returns success'
}
regression_pr_flags() {
  for source in body definition code; do
    local body='' files='[[]]'
    case "$source" in
      body) body='Flag: htpr-50-shared' ;;
      definition) files='[[{"filename":"src/lib/flags/definitions/htpr-50-shared.ts","status":"added"}]]' ;;
      code) files='[[{"filename":"src/page.tsx","patch":"+useFlag(\"htpr-50-shared\")"}]]' ;;
    esac
    : > "$HOME/vcc-log"
    TEST_PR_BODY="$body" TEST_PR_FILES="$files" TEST_FLAGS='{"flags":[{"key":"htpr-6136-figma-connect","mode":"EVERYONE"},{"key":"htpr-50-shared","mode":"OFF"}]}' "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1 # gitleaks:allow
    if grep -q '^task move ' "$HOME/vcc-log"; then echo "FAIL: PR-only $source flag ignored"; exit 1; fi
    grep -q 'htpr-50-shared=OFF' "$tmp/output"
    : > "$HOME/vcc-log"
    TEST_PR_BODY="$body" TEST_PR_FILES="$files" TEST_FLAGS='{"flags":[{"key":"htpr-6136-figma-connect","mode":"EVERYONE"},{"key":"htpr-50-shared","mode":"EVERYONE"}]}' "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1 # gitleaks:allow
    grep -q '^task move HTPR-6136 --section Done$' "$HOME/vcc-log"
  done
  echo 'ok ht-flag enforces PR-only body, definition and code flags'
}
regression_url_flag() {
  local owned='{"flags":[{"key":"htpr-6136-figma-connect","mode":"EVERYONE"},{"key":"legacy-url-flag","mode":"OFF","ticketUrl":"https://app.hypertask.ai/detail/project-4060/6136"}]}'
  : > "$HOME/vcc-log"
  TEST_TASK_URL='/detail/project-4060/6136' TEST_FLAGS="$owned" "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1 # gitleaks:allow
  if grep -q '^task move ' "$HOME/vcc-log"; then echo 'FAIL: URL-owned flag ignored'; exit 1; fi
  grep -q 'legacy-url-flag=OFF' "$tmp/output"
  : > "$HOME/vcc-log"
  TEST_TASK_URL='/detail/project-4060/6136' TEST_FLAGS='{"flags":[{"key":"htpr-6136-figma-connect","mode":"EVERYONE"},{"key":"legacy-url-flag","mode":"EVERYONE","ticketUrl":"https://app.hypertask.ai/detail/project-4060/6136"}]}' "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1 # gitleaks:allow
  grep -q '^task move HTPR-6136 --section Done$' "$HOME/vcc-log"
  echo 'ok ht-flag enforces flags owned only through ticketUrl'
}
case "${1:-}" in
  --pending-only) regression_pending; exit ;;
  --pr-only) regression_pr_flags; exit ;;
  --url-flag) regression_url_flag; exit ;;
esac
: > "$HOME/vcc-log"
"$script" set "$key" everyone --reason "$reason" > "$tmp/output" 2>&1
[ "$(cat "$HOME/vcc-log")" = $'task get HTPR-6136 --json\ntask get HTPR-6136 --json\ntask move HTPR-6136 --section Done' ]
grep -q 'moved HTPR-6136 from Flags to Done' "$tmp/output"
# --review uses the same post-switch path, and owner can be inferred from the key.
: > "$HOME/vcc-log"
TEST_RESPONSE='{"flag":{"key":"htpr-6136-figma-connect","mode":"EVERYONE"}}' "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1
grep -q '^task move HTPR-6136 --section Done$' "$HOME/vcc-log"
# Reopening during the live flag-list request must not be overwritten.
: > "$HOME/vcc-log"
TEST_REOPEN=1 "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1
if grep -q '^task move ' "$HOME/vcc-log"; then echo 'FAIL: reopening overwritten'; exit 1; fi
grep -q 'no longer in Flags' "$tmp/output"
rm "$HOME/section"
echo 'ok ht-flag skips reopening during live flag read'
: > "$HOME/vcc-log"
if TEST_REREAD_ERROR=1 "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1; then exit 1; fi
if grep -q '^task move ' "$HOME/vcc-log"; then exit 1; fi
grep -q 'cannot reread' "$tmp/output"
for section in 'In Progress' 'Valentin Review' Done; do
  : > "$HOME/vcc-log"
  TEST_SECTION="$section" "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1
  [ "$(cat "$HOME/vcc-log")" = 'task get HTPR-6136 --json' ]
done
regression_pending
regression_pr_flags
regression_url_flag
: > "$HOME/vcc-log"
if TEST_PR_ERROR=1 "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1; then exit 1; fi
! grep -q '^task move ' "$HOME/vcc-log"
for flags in \
  '{"flags":[]}' '{"flags":null}'; do
  : > "$HOME/vcc-log"
  if TEST_FLAGS="$flags" "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1; then
    echo 'must not finish a ticket with pending or unreadable flags'; exit 1
  fi
  [ "$(cat "$HOME/vcc-log")" = 'task get HTPR-6136 --json' ]
done
: > "$HOME/vcc-log"
if TEST_MOVE_ERROR=1 "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1; then
  echo 'move failure must be visible'; exit 1
fi
grep -q 'flag is Everyone, but moving HTPR-6136' "$tmp/output"
: > "$HOME/vcc-log"
TEST_RESPONSE='{"flag":{"mode":"OFF"}}' "$script" set "$key" off --reason "$reason" >/dev/null
[ ! -s "$HOME/vcc-log" ]
if TEST_STATUS=403 "$script" set "$key" everyone --review 42 > "$tmp/output" 2>&1; then exit 1; fi
[ ! -s "$HOME/vcc-log" ]
"$script" set "$key" everyone --review 42 --dry-run >/dev/null
[ ! -s "$HOME/vcc-log" ]
printf 'All tests passed: ht-flag tests passed\n'
