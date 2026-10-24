#!/usr/bin/env bash
set -euo pipefail
trap 'printf "sweep test failed at line %s\n" "$LINENO" >&2' ERR
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp" SWEEP_TEST_DIR="$tmp" VCC_EVIDENCE_DIR="$tmp/evidence"
mkdir -p "$tmp/bin"
cat > "$tmp/bin/vcc" <<'PY_STUB'
#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path

root = Path(os.environ["SWEEP_TEST_DIR"])
args = sys.argv[1:]
with (root / "calls").open("a") as log:
    log.write(" ".join(args) + "\n")
with (root / "json-calls").open("a") as log:
    log.write(json.dumps([os.environ.get("SHIP_SESSION_NAME"), args]) + "\n")
def value(name):
    return args[args.index(name) + 1]
def load(name, default):
    return json.loads((root / name).read_text()) if (root / name).exists() else default
def save(name, data):
    (root / name).write_text(json.dumps(data))
result = {"success": True}
action = tuple(args[:2])
if action == ("task", "list"):
    assert args == ["task", "list", "--project", "15", "--section", "Flags", "--limit", "100", "--json"]
    result = load("tasks", {})
elif action == ("task", "get"):
    if os.environ.get("SWEEP_GET_ERROR") == "1":
        sys.exit(1)
    if os.environ.get("SWEEP_MODE_OFF_AFTER_LIST") == "1":
        flags = load("flags", {})
        for flag in flags["flags"]:
            if flag["key"] == "htpr-1-a":  # gitleaks:allow
                flag["mode"] = "OFF"
        save("flags", flags)
    tasks = load("tasks", {})["tasks"]
    task = next(t for t in tasks if t["ticketNumber"] == args[2]).copy()
    task["section"] = os.environ.get("SWEEP_SECTION", task["section"])
    if os.environ.get("SWEEP_REOPEN") == "1":
        task["section"] = (root / "section").read_text().strip()
        (root / "section").write_text("In Progress\n")
    seen = load("seen", [])
    if "SWEEP_CURRENT_DESCRIPTION" in os.environ and args[2] not in seen:
        task["description"] = os.environ["SWEEP_CURRENT_DESCRIPTION"]
        board = load("tasks", {})
        next(t for t in board["tasks"] if t["ticketNumber"] == args[2])["description"] = task["description"]
        save("tasks", board)
        save("seen", seen + [args[2]])
    result["tasks"] = [task]
elif action == ("task", "move"):
    assert args[:2] == ["task", "move"] and args[3:] == ["--section", "Done"]
    assert any(t["ticketNumber"] == args[2] for t in load("tasks", {})["tasks"])
elif action == ("task", "update"):
    if os.environ.get("SWEEP_WRITE_ERROR") == "1":
        result["success"] = False
    elif os.environ.get("SWEEP_IGNORE_WRITE") != "1":
        board = load("tasks", {})
        task = next(t for t in board["tasks"] if t["ticketNumber"] == args[2])
        labels = task.setdefault("labels", [])
        if "--remove-labels" in args:
            task["labels"] = labels = [l for l in labels if l["name"] not in value("--remove-labels").split(",")]
        if "--add-label" in args:
            labels.append({"name": value("--add-label")})
        if "--description" in args:
            task["description"] = value("--description")
        save("tasks", board)
elif action == ("comment", "list"):
    comments = load("comments", {}).get(args[2], [])
    result.update(comments=comments, total=len(comments))
    if os.environ.get("SWEEP_COMMENT_PAGES") == "1":
        result.update(comments=comments[1:] if "--cursor" in args else comments[:1])
        if "--cursor" not in args:
            result["nextCursor"] = "second"
    if os.environ.get("SWEEP_COMMENT_INCOMPLETE") == "1":
        result["has_more"] = True
    if os.environ.get("SWEEP_COMMENT_REPEAT") == "1":
        result["nextCursor"] = "same"
elif action == ("comment", "add"):
    comments = load("comments", {})
    comments.setdefault(args[2], []).append({"text": value("--text")})
    save("comments", comments)
elif action == ("labels", "list"):
    labels = load("labels", [])
    result.update(labels=[{"name": name} for name in labels], total=len(labels))
elif action == ("labels", "create"):
    labels = load("labels", [])
    labels.append(value("--name"))
    save("labels", labels)
else:
    sys.exit(92)
print(json.dumps(result))
PY_STUB
cat > "$tmp/bin/ht-flag" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[ "$*" = get ] || exit 93
printf 'flags\n' >> "$SWEEP_TEST_DIR/calls"
[ "${FLAGS_ERROR:-0}" = 0 ] || exit 1
cat "$SWEEP_TEST_DIR/flags"
SH
cat > "$tmp/bin/gh" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
case "$1:$2" in
  pr:list) echo '[{"number":10,"title":"HTPR-1 [FEATURE] Example","createdAt":"2026-10-24"}]' ;;
  pr:view) printf '%s\n' "${SWEEP_PR_BODY:-}" ;;
  api:*) [ "${SWEEP_PR_ERROR:-0}" = 0 ] || exit 1; printf '%s\n' "${SWEEP_PR_FILES:-[[]]}" ;;
  *) exit 95 ;;
esac
SH
cat > "$tmp/bin/curl" <<'SH'
#!/usr/bin/env bash
exit 94
SH
chmod +x "$tmp/bin/"*
export PATH="$tmp/bin:$PATH" HT_FLAG_BIN="$tmp/bin/ht-flag"
cat > "$tmp/tasks" <<'JSON'
{"success":true,"total":7,"tasks":[
 {"ticketNumber":"HTPR-1","section":"Flags"},
 {"ticketNumber":"HTPR-2","section":"Flags"},
 {"ticketNumber":"HTPR-3","section":"Flags"},
 {"ticketNumber":"HTPR-4","section":"Flags"},
 {"ticketNumber":"HTPR-5","section":"Flags","description":"Flag: htpr-50-shared"},
 {"ticketNumber":"HTPR-6","section":"In Progress"},
 {"ticketNumber":"HTPR-7","section":"Flags","description":"Flag: htpr-70-missing"}
]}
JSON
cat > "$tmp/flags" <<'JSON'
{"flags":[
 {"key":"htpr-1-a","mode":"EVERYONE"},{"key":"htpr-1-b","mode":"EVERYONE"},
 {"key":"htpr-2-a","mode":"EVERYONE"},{"key":"htpr-2-b","mode":"OWNER_AND_QA"},
 {"key":"htpr-3-a","mode":"OFF"},{"key":"htpr-50-shared","mode":"OWNER_ONLY"},
 {"key":"htpr-6-a","mode":"EVERYONE"},{"key":"htpr-10-not-one","mode":"OFF"}
]}
JSON
run() {
  : > "$tmp/calls"
  : > "$tmp/json-calls"
  echo '[]' > "$tmp/seen"
  "$here/ht-flags-sweep" "$@" > "$tmp/output" 2>&1 || { cat "$tmp/output"; return 1; }
  [ "$(grep -c '^task list ' "$tmp/calls")" = 1 ]
}
regression_stale_modes() {
  SWEEP_MODE_OFF_AFTER_LIST=1 run --go
  if grep -q '^task move ' "$tmp/calls"; then echo 'FAIL: stale Everyone mode completed ticket'; exit 1; fi
  grep -q 'htpr-1-a=OFF' "$tmp/output"
  echo 'ok fresh flag modes before each completion'
}
regression_pr_flags() {
  for source in body definition code; do
    local body='' files='[[]]'
    case "$source" in
      body) body='Flag: htpr-50-shared' ;;
      definition) files='[[{"filename":"src/lib/flags/definitions/htpr-50-shared.ts","status":"added"}]]' ;;
      code) files='[[{"filename":"src/page.tsx","patch":"+useFlag(\"htpr-50-shared\")"}]]' ;;
    esac
    SWEEP_PR_BODY="$body" SWEEP_PR_FILES="$files" run --go
    if grep -q '^task move ' "$tmp/calls"; then echo "FAIL: PR-only $source flag ignored"; exit 1; fi
    grep -q 'htpr-50-shared=OWNER_ONLY' "$tmp/output"
    cp "$tmp/flags" "$tmp/saved-flags"
    jq '.flags |= map(if .key == "htpr-50-shared" then .mode="EVERYONE" else . end)' "$tmp/flags" > "$tmp/new"; mv "$tmp/new" "$tmp/flags" # gitleaks:allow
    SWEEP_PR_BODY="$body" SWEEP_PR_FILES="$files" run --go
    grep -q '^task move HTPR-1 --section Done$' "$tmp/calls"
    mv "$tmp/saved-flags" "$tmp/flags"
  done
  echo 'ok sweep enforces PR-only body, definition and code flags'
}
triage_fixture() {
  local description=${1:-'<html><body><p>Behind htpr-50-shared, never Everyone. Original content stays.</p></body></html>'}
  jq -nc --arg description "$description" '{success:true,total:1,tasks:[{ticketNumber:"HTPR-90",url:"https://app.hypertask.ai/detail/project-15/90",projectId:15,status:"Normal",section:"Flags",description:$description,labels:[{name:"Bug"},{name:"flag:off"},{name:"flag:everyone"}]}]}' > "$tmp/tasks"
  echo '{"flags":[{"key":"htpr-50-shared","mode":"OWNER_ONLY","kind":"feature","ticketId":"HTPR-50"}]}' > "$tmp/flags" # gitleaks:allow
  echo '{}' > "$tmp/comments"
  echo '[]' > "$tmp/labels"
}
no_writes() {
  if grep -qE '^task (move|update) |^comment add |^labels create ' "$tmp/calls"; then
    echo 'FAIL: unexpected board write'; cat "$tmp/calls"; exit 1
  fi
}
triage_cases() {
  export SHIP_SESSION_NAME='SWEEP TEST RUNNER'
  triage_fixture
  run
  no_writes
  grep -q 'Expected exactly one state label: flag:owner-only' "$tmp/output"
  grep -q 'Missing flag card link: https://app.hypertask.ai/admin/flags/htpr-50-shared' "$tmp/output"
  for pair in 'EVERYONE flag:everyone' 'OWNER_ONLY flag:owner-only' 'OWNER_AND_QA flag:qa-only' 'OFF flag:off' 'internal flag:internal'; do
    read -r mode label <<< "$pair"
    triage_fixture
    if [ "$mode" = internal ]; then
      jq '.flags[0].kind="internal"' "$tmp/flags" > "$tmp/new"
    else
      jq --arg mode "$mode" '.flags[0].mode=$mode' "$tmp/flags" > "$tmp/new"
    fi
    mv "$tmp/new" "$tmp/flags"
    run --go
    jq -e --arg label "$label" '.tasks[0].labels == [{name:"Bug"},{name:$label}] and (.tasks[0].description == "<html><body><p>Behind htpr-50-shared, never Everyone. Original content stays.</p><p>Flag: <a href=\"https://app.hypertask.ai/admin/flags/htpr-50-shared\">htpr-50-shared</a></p></body></html>")' "$tmp/tasks" >/dev/null
    jq -se 'all(.[]; .[0] == "SWEEP TEST RUNNER") and any(.[]; .[1][0:2] == ["task","update"]) and all(.[]; (.[1] | index("--labels")) == null)' "$tmp/json-calls" >/dev/null
    [ "$(grep -c '^task update ' "$tmp/calls")" = 1 ]
    run --go
    ! grep -qE '^task update |^comment add |^labels create ' "$tmp/calls"
  done
  echo 'ok triage all modes/internal, runner identity, preservation, and idempotence'

  for registry in ticketId ticketUrl prefix; do
    triage_fixture '<p>Existing description.</p>'
    case "$registry" in
      ticketId) jq '.flags[0].ticketId="HTPR-90"' "$tmp/flags" > "$tmp/new" ;;
      ticketUrl) jq '.flags[0].ticketUrl="https://app.hypertask.ai/detail/project-15/90"' "$tmp/flags" > "$tmp/new" ;;
      prefix) jq '.flags[0].key="htpr-90-owned"' "$tmp/flags" > "$tmp/new" ;; # gitleaks:allow
    esac
    mv "$tmp/new" "$tmp/flags"
    run --go
    jq -e '."HTPR-90" | length == 1 and (.[0].text | contains("Please declare the flag key"))' "$tmp/comments" >/dev/null
    jq -e '.tasks[0].description | startswith("<p>Existing description.</p>") and contains("<a href=")' "$tmp/tasks" >/dev/null
    run --go
    ! grep -qE '^task update |^comment add |^labels create ' "$tmp/calls"
  done
  triage_fixture '<p>Shared signup change.</p>'
  echo '{"HTPR-90":[{"commentText":"Behind htpr-50-shared."}]}' > "$tmp/comments"
  run --go
  jq -e '.tasks[0].labels == [{name:"Bug"},{name:"flag:owner-only"}]' "$tmp/tasks" >/dev/null
  echo 'ok registry ID/URL/prefix and comment fallback request a declaration once'

  for description in '<p>No flag declared.</p>' '<p>htpr-9999-removed-flag</p>' '<p>htpr-50-shared and htpr-2-other</p>'; do
    triage_fixture "$description"
    jq '.flags += [{key:"htpr-2-other",mode:"OWNER_ONLY",ticketId:"HTPR-2"}]' "$tmp/flags" > "$tmp/new"; mv "$tmp/new" "$tmp/flags" # gitleaks:allow
    run --go
    ! grep -qE '^task (update|move) |^labels create ' "$tmp/calls"
    grep -q '^comment add HTPR-90 ' "$tmp/calls"
    run --go
    no_writes
    jq -e '."HTPR-90" | length == 1' "$tmp/comments" >/dev/null
  done
  for ticket in HTPR-7549 HTPR-7550 HTPR-7551; do
    triage_fixture '<p>htpr-7511-retired-signup</p>'
    jq --arg ticket "$ticket" '.tasks[0].ticketNumber=$ticket' "$tmp/tasks" > "$tmp/new"; mv "$tmp/new" "$tmp/tasks"
    jq --arg ticket "$ticket" '.flags=[{key:(($ticket | ascii_downcase)+"-replacement"),ticketId:$ticket,mode:"OWNER_ONLY"}]' "$tmp/flags" > "$tmp/new"; mv "$tmp/new" "$tmp/flags"
    run --go
    ! grep -qE '^task (update|move) |^labels create ' "$tmp/calls"
    grep -q 'cannot read live mode for htpr-7511-retired-signup' "$tmp/output"
  done
  triage_fixture '<p>Unclear rollout.</p>'
  jq '.flags=[{key:"htpr-90-one",ticketId:"HTPR-90",mode:"OFF"},{key:"htpr-90-two",ticketId:"HTPR-90",mode:"OWNER_ONLY"}]' "$tmp/flags" > "$tmp/new"; mv "$tmp/new" "$tmp/flags" # gitleaks:allow
  run --go
  grep -q 'Multiple flag keys; declare one governing flag' "$tmp/output"
  ! grep -q '^task update ' "$tmp/calls"
  jq '.tasks[0].description="Flag: htpr-90-two"' "$tmp/tasks" > "$tmp/new"; mv "$tmp/new" "$tmp/tasks"
  run --go
  jq -e '.tasks[0].labels == [{name:"Bug"},{name:"flag:owner-only"}] and (.tasks[0].description | contains("/admin/flags/htpr-90-two"))' "$tmp/tasks" >/dev/null
  ! grep -q '^task move ' "$tmp/calls"
  echo 'ok missing/unknown/multiple/retired flags never get guessed labels; declaration governs label only'

  for href in 'https://app.hypertask.ai/admin/flags/htpr-50-shared' '/admin/flags/htpr-50-shared'; do
    triage_fixture "<p><a href='$href'>htpr-50-shared</a></p>"
    jq '.tasks[0].labels=[{name:"Bug"},{name:"flag:owner-only"}]' "$tmp/tasks" > "$tmp/new"; mv "$tmp/new" "$tmp/tasks"
    run
    no_writes
    ! grep -q 'HTPR-90 triage:' "$tmp/output"
    run --go
    no_writes
  done
  triage_fixture '<p>https://app.hypertask.ai/admin/flags/htpr-50-shared</p>'
  run
  grep -q 'Missing flag card link' "$tmp/output"
  no_writes
  echo 'ok clickable absolute/relative anchors and bare URL negative control'

  triage_fixture '<p>Undeclared.</p>'
  echo '{"HTPR-90":[{"text":"Earlier comment"},{"text":"Flags triage: Please declare the flag key and current state on this ticket."}]}' > "$tmp/comments"
  SWEEP_COMMENT_PAGES=1 run --go
  no_writes
  grep -q -- '--cursor second' "$tmp/calls"
  for failure in SWEEP_COMMENT_INCOMPLETE SWEEP_COMMENT_REPEAT FLAGS_ERROR; do
    triage_fixture
    if (export "$failure=1"; run --go); then echo "FAIL: accepted $failure"; exit 1; fi
    no_writes
  done
  for failure in SWEEP_WRITE_ERROR SWEEP_IGNORE_WRITE; do
    triage_fixture
    if (export "$failure=1"; run --go); then echo "FAIL: accepted $failure"; exit 1; fi
    ! grep -q '^task move ' "$tmp/calls"
  done
  for metadata in '.success=false' '.total=2' '.has_more=true' '.nextCursor="second"'; do
    triage_fixture
    jq "$metadata" "$tmp/tasks" > "$tmp/new"; mv "$tmp/new" "$tmp/tasks"
    if run --go; then echo "FAIL: accepted incomplete board $metadata"; exit 1; fi
    [ "$(grep -c '^task list ' "$tmp/calls")" = 1 ]
    no_writes
  done
  triage_fixture
  SWEEP_SECTION=Done run --go
  no_writes
  echo 'ok comment pagination, repeated/incomplete reads, failed/unpersisted writes, incomplete board, moved ticket'
}
case "${1:-}" in
  --triage-only) triage_cases; exit ;;
  --stale-only) regression_stale_modes; exit ;;
  --pr-only) regression_pr_flags; exit ;;
esac
run
! grep -q '^task move ' "$tmp/calls"
grep -q 'would move HTPR-1 from Flags to Done' "$tmp/output"
run --go
[ "$(grep '^task move ' "$tmp/calls")" = 'task move HTPR-1 --section Done' ]
grep -q 'moved HTPR-1' "$tmp/output"
for ticket in HTPR-2 HTPR-3 HTPR-4 HTPR-5 HTPR-7; do grep -q "leave $ticket in Flags" "$tmp/output"; done
SWEEP_SECTION='Valentin Review' run --go
! grep -q '^task move ' "$tmp/calls"
grep -q 'no longer in Flags' "$tmp/output"
# The first per-ticket snapshot says Flags; a concurrent reopening changes the next read.
echo Flags > "$tmp/section"
SWEEP_REOPEN=1 run --go
if grep -q '^task move ' "$tmp/calls"; then echo 'FAIL: reopening overwritten'; exit 1; fi
grep -q 'no longer in Flags' "$tmp/output"
echo 'ok sweep skips reopening after eligibility snapshot'
cp "$tmp/tasks" "$tmp/saved-tasks"
SWEEP_CURRENT_DESCRIPTION='Flag: htpr-50-shared' run --go
if grep -q '^task move ' "$tmp/calls"; then echo 'FAIL: current flag reference ignored'; exit 1; fi
grep -q 'htpr-50-shared=OWNER_ONLY' "$tmp/output"
mv "$tmp/saved-tasks" "$tmp/tasks"
: > "$tmp/calls"
if SWEEP_GET_ERROR=1 "$here/ht-flags-sweep" --go > "$tmp/output" 2>&1; then exit 1; fi
if grep -q '^task move ' "$tmp/calls"; then exit 1; fi
: > "$tmp/calls"
if FLAGS_ERROR=1 "$here/ht-flags-sweep" --go > "$tmp/output" 2>&1; then exit 1; fi
! grep -q '^task move ' "$tmp/calls"
regression_pr_flags
: > "$tmp/calls"
if SWEEP_PR_ERROR=1 "$here/ht-flags-sweep" --go > "$tmp/output" 2>&1; then exit 1; fi
! grep -q '^task move ' "$tmp/calls"
regression_stale_modes
echo '{"flags":[{"key":"htpr-1-a","mode":"UNKNOWN"}]}'  > "$tmp/flags"
if run --go; then echo 'FAIL: invalid flags accepted'; exit 1; fi
! grep -qE '^task (move|update) |^comment add |^labels create ' "$tmp/calls"
grep -q 'invalid live flag list' "$tmp/output"
jq '.total=101' "$tmp/tasks" > "$tmp/new"; mv "$tmp/new" "$tmp/tasks"
: > "$tmp/calls"
if "$here/ht-flags-sweep" --go > "$tmp/output" 2>&1; then exit 1; fi
[ "$(grep -c '^task list ' "$tmp/calls")" = 1 ]
! grep -q '^task move ' "$tmp/calls"
grep -q 'incomplete or invalid' "$tmp/output"
grep -qx 'OnCalendar=daily' "$here/ht-flags-sweep.timer"
grep -qx 'Persistent=true' "$here/ht-flags-sweep.timer"
grep -q 'ExecStart=.*ht-flags-sweep --go$' "$here/ht-flags-sweep.service"
grep -q '^Environment="PATH=%h/.local/bin:' "$here/ht-flags-sweep.service"
# Verify unit syntax without starting or installing anything.
systemd-analyze --user --recursive-errors=no verify "$here/ht-flags-sweep.service" "$here/ht-flags-sweep.timer" > "$tmp/unit-output" 2>&1 || { cat "$tmp/unit-output"; exit 1; }
triage_cases
echo 'All tests passed: ht-flags-sweep dry-run, all-Everyone, one-list, errors, timer, HTPR-7789 triage'
