#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp/home" VCC_EVIDENCE_DIR="$tmp/evidence" FLAG_TEST_DIR="$tmp"
mkdir -p "$tmp/bin" "$VCC_EVIDENCE_DIR/YPER4-999"
printf '999\n' > "$VCC_EVIDENCE_DIR/YPER4-999/pr"
cat > "$tmp/bin/gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FLAG_TEST_DIR/gh-log"
case "$1:$2" in
  pr:view)
    case "$*" in
      *'--json body'*) cat "$FLAG_TEST_DIR/body" ;;
      *'--json title'*) echo 'YPER4-999 [INFRA] Fixture' ;;
      *) echo '{"number":999,"title":"YPER4-999 [INFRA] Fixture","state":"MERGED","mergeCommit":{"oid":"abc123"},"baseRefName":"production"}' ;;
    esac ;;
  api:*/commits/abc123/status) echo 'Ignored Build Step' ;;
  api:*/pulls/999/files*) [ "${PR_READ_ERROR:-0}" = 0 ] || exit 1; cat "$FLAG_TEST_DIR/files" ;;
  *) echo 'unexpected gh call' >&2; exit 90 ;;
esac
SH
cat > "$tmp/bin/ht-flag" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[ "$*" = get ] || exit 90
printf 'read\n' >> "$FLAG_TEST_DIR/flag-log"
[ "${MODE_READ_ERROR:-0}" = 0 ] || exit 1
cat "$FLAG_TEST_DIR/flags"
SH
cat > "$tmp/bin/curl" <<'SH'
#!/usr/bin/env bash
exit 91
SH
chmod +x "$tmp/bin/"*
export PATH="$tmp/bin:$PATH" HT_FLAG_BIN="$tmp/bin/ht-flag"
echo '' > "$tmp/body"; echo '[[]]' > "$tmp/files"
check() {
  local want=$1 section=$2 expected=$3; shift 3
  local out status=0
  : > "$tmp/flag-log"; : > "$tmp/gh-log"
  out=$(jq -nc --arg section "$section" '{tool_input:{command:("vcc task move YPER4-999 --section \"" + $section + "\"")}}' |
    env "$@" "$here/ship-check" guard 2>&1) || status=$?
  [ "$status" = "$want" ] && [[ $out == *"$expected"* ]] || { echo "FAIL: $want $section $expected; got $status $out"; exit 1; }
  echo "ok $section $expected ${*:-}"
}
echo '{"flags":[{"key":"yper4-999-test","mode":"OWNER_AND_QA"}]}' > "$tmp/flags"
check 2 Done 'flags are not Everyone: yper4-999-test=OWNER_AND_QA'
check 0 Flags ''
[ ! -s "$tmp/flag-log" ] && [ ! -s "$tmp/gh-log" ]
check 0 Flags '' MODE_READ_ERROR=1 PR_READ_ERROR=1
for mode in OFF OWNER_ONLY; do
  jq --arg mode "$mode" '.flags[0].mode=$mode' "$tmp/flags" > "$tmp/new"; mv "$tmp/new" "$tmp/flags"
  check 2 Done "yper4-999-test=$mode"
done
jq '.flags[0].mode="EVERYONE"' "$tmp/flags" > "$tmp/new"; mv "$tmp/new" "$tmp/flags"
check 0 Done ''
check 2 Done 'live flag modes must be readable before Done' MODE_READ_ERROR=1
for data in 'invalid' '{}' '{"flags":null}' '{"flags":[{"key":"yper4-999-test"}]}' '{"flags":[{"key":"yper4-999-test","mode":"INVALID"}]}'; do
  echo "$data" > "$tmp/flags"; check 2 Done 'live flag modes must be readable before Done'
done
echo '{"flags":[{"key":"htpr-123-other","mode":"OWNER_AND_QA"},{"key":"yper4-9990-other","mode":"OWNER_AND_QA"}]}' > "$tmp/flags"
check 0 Done ''
echo 'Flag: htpr-123-other' > "$tmp/body"
check 2 Done 'htpr-123-other=OWNER_AND_QA'
echo '' > "$tmp/body"
echo '[[{"filename":"src/lib/flags/definitions/htpr-123-other.ts","status":"added","patch":"+defaultMode: EVERYONE"}]]' > "$tmp/files"
check 2 Done 'htpr-123-other=OWNER_AND_QA'
echo '[[{"filename":"src/component.tsx","status":"modified","patch":"+useFlag(\"htpr-123-other\")"}]]' > "$tmp/files"
check 2 Done 'htpr-123-other=OWNER_AND_QA'
jq '.flags[0].mode="EVERYONE"' "$tmp/flags" > "$tmp/new"; mv "$tmp/new" "$tmp/flags"
check 0 Done ''
check 2 Done 'live flag modes must be readable before Done' PR_READ_ERROR=1
echo '{"flags":[]}' > "$tmp/flags"
check 2 Done 'cannot read live mode for htpr-123-other'
echo '[[{"filename":"src/lib/flags/definitions/htpr-123-other.ts","status":"removed"}]]' > "$tmp/files"
check 0 Done ''
echo '[[],[{"filename":"src/page.tsx","patch":"+useFlag(\"htpr-123-other\")"}]]' > "$tmp/files"
check 2 Done 'cannot read live mode for htpr-123-other'
echo '[[]]' > "$tmp/files"
echo '{"flags":[{"key":"legacy-flag","ticketId":"YPER4-999","mode":"OWNER_AND_QA"}]}' > "$tmp/flags"
check 2 Done 'legacy-flag=OWNER_AND_QA'
echo '{"flags":[{"key":"legacy-flag","mode":"OWNER_AND_QA"}]}' > "$tmp/flags"
echo 'Flag: legacy-flag' > "$tmp/body"
check 2 Done 'legacy-flag=OWNER_AND_QA'
echo '' > "$tmp/body"
cat > "$tmp/bin/hypertask" <<'SH'
#!/usr/bin/env bash
[ "$*" = 'tasks get YPER4-999 --json' ] || exit 90
echo '{"success":true,"tasks":[{"section":"Done"}]}'
SH
chmod +x "$tmp/bin/hypertask"
echo '{"flags":[{"key":"yper4-999-test","mode":"OWNER_AND_QA"}]}' > "$tmp/flags"
if "$here/ship-check" done YPER4-999 > "$tmp/output" 2>&1; then exit 1; fi
grep -q 'flags are not Everyone' "$tmp/output"
echo '{"flags":[{"key":"yper4-999-test","mode":"EVERYONE"}]}' > "$tmp/flags"
"$here/ship-check" done YPER4-999 | grep -q 'done ok'
# Synthetic keys from this PR's fixtures, docs, and unchanged context are not rollout requirements.
echo '' > "$tmp/body"
echo '{"flags":[{"key":"htpr-1-a","mode":"OFF"}]}' > "$tmp/flags"
jq -nc --rawfile patch "$here/ht-flags-sweep.test.sh" '[[{filename:".claude/skills/ship/scripts/ht-flags-sweep.test.sh",status:"added",patch:($patch | split("\n") | map("+" + .) | join("\n"))}]]' > "$tmp/files"
check 0 Done ''
jq -nc '[[{filename:"src/example.test.tsx",patch:"+useFlag(\"htpr-2-fixture\")"},{filename:"docs/flags.md",patch:"+useFlag(\"htpr-3-example\")"},{filename:"src/page.tsx",patch:" useFlag(\"htpr-4-context\")\n-useFlag(\"htpr-5-removed\")\n+const message = \"htpr-6-not-a-flag\";"}]]' > "$tmp/files"
check 0 Done ''
jq -nc '[[{filename:"src/page.tsx",patch:"+useFlag(\n+  \"htpr-8-multiline\"\n+); const sample = \"htpr-9-not-a-flag\";"}]]' > "$tmp/files"
echo '{"flags":[{"key":"htpr-8-multiline","mode":"OWNER_AND_QA"}]}' > "$tmp/flags"
check 2 Done 'htpr-8-multiline=OWNER_AND_QA'
jq '.flags[0].mode="EVERYONE"' "$tmp/flags" > "$tmp/new"; mv "$tmp/new" "$tmp/flags"
check 0 Done ''
jq -nc '[[{filename:"src/page.tsx",patch:"+import { FLAG } from \"@/lib/flags/definitions/htpr-10-imported\";"}]]' > "$tmp/files"
check 2 Done 'cannot read live mode for htpr-10-imported'
echo 'Canonical flag: https://app.hypertask.ai/admin/flags/htpr-7-linked' > "$tmp/body"
echo '[[]]' > "$tmp/files"
check 2 Done 'cannot read live mode for htpr-7-linked'
echo 'All tests passed: offline Done/Flags guard (fixture patches ignored, live references enforced)'
