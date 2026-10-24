#!/usr/bin/env bash
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
export HOME="$tmp" SWEEP_TEST_DIR="$tmp"
mkdir -p "$tmp/bin"
cat > "$tmp/bin/vcc" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$SWEEP_TEST_DIR/calls"
case "$1:$2" in
  task:list)
    [ "$*" = 'task list --project 15 --section Flags --limit 100 --json' ] || exit 90
    cat "$SWEEP_TEST_DIR/tasks" ;;
  task:get) jq -nc --arg section "${SWEEP_SECTION:-Flags}" '{success:true,tasks:[{section:$section}]}' ;;
  task:move) [ "$*" = 'task move HTPR-1 --section Done' ] || exit 91 ;;
  *) exit 92 ;;
esac
SH
cat > "$tmp/bin/ht-flag" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
[ "$*" = get ] || exit 93
printf 'flags\n' >> "$SWEEP_TEST_DIR/calls"
[ "${FLAGS_ERROR:-0}" = 0 ] || exit 1
cat "$SWEEP_TEST_DIR/flags"
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
  "$here/ht-flags-sweep" "$@" > "$tmp/output" 2>&1
  [ "$(grep -c '^task list ' "$tmp/calls")" = 1 ]
  [ "$(grep -c '^flags$' "$tmp/calls")" = 1 ]
}
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
: > "$tmp/calls"
if FLAGS_ERROR=1 "$here/ht-flags-sweep" --go > "$tmp/output" 2>&1; then exit 1; fi
! grep -q '^task move ' "$tmp/calls"
echo '{"flags":[{"key":"htpr-1-a","mode":"UNKNOWN"}]}' > "$tmp/flags"
if "$here/ht-flags-sweep" --go > "$tmp/output" 2>&1; then exit 1; fi
! grep -q '^task move ' "$tmp/calls"
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
echo 'All tests passed: ht-flags-sweep dry-run, all-Everyone, one-list, errors, timer'
