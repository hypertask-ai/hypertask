#!/usr/bin/env bash
# Offline helper guard tests with fake credentials and CLI.
set -euo pipefail
vcc=$(cd "$(dirname "$0")" && pwd)/vcc
ship_check=$(cd "$(dirname "$vcc")/../../ship/scripts" && pwd)/ship-check
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/home/.config/hypertask-agents/credentials" "$T/proc"
export HOME="$T/home" PATH="$T/bin:$PATH" VCC_HELPER_PROC_ROOT="$T/proc"
export VCC_TEST_BIN="$vcc" VCC_TEST_TRACE="$T/trace"
unset VCC_HELPER HAX_TRANSCRIPT HAX_SUBAGENT_DEPTH
printf 'fixture-token\n' > "$HOME/.config/hypertask-agents/credentials/valentins-claude-code-agent-token"
cat > "$T/bin/hypertask" <<'STUB'
#!/usr/bin/env bash
[ "${HT_TOKEN:-}" = fixture-token ] || exit 91
printf 'hypertask %s %s\n' "${1:-}" "${2:-}" >> "$VCC_TEST_TRACE"
if [ "${1:-} ${2:-}" = 'comments list' ]; then
  exec /bin/cat "${VCC_TEST_COMMENTS:-/missing-comments-fixture}"
fi
if [ "${1:-} ${2:-}" = 'tasks get' ] && [ -n "${VCC_TEST_TASK:-}" ]; then
  exec /bin/cat "$VCC_TEST_TASK"
fi
printf 'stub:'; printf ' <%s>' "$@"; printf '\n'
STUB
cat > "$T/bin/cat" <<'STUB'
#!/usr/bin/env bash
printf 'token read\n' >> "$VCC_TEST_TRACE"
exec /bin/cat "$@"
STUB
cat > "$T/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf 'unexpected network request\n' >&2
exit 92
STUB
mkdir -p "$HOME/.agents/skills/ship/scripts"
cat > "$HOME/.agents/skills/ship/scripts/ship-identity" <<'STUB'
#!/usr/bin/env bash
printf 'identity lookup\n' >> "$VCC_TEST_TRACE"
printf '%s\t%s\n' "${VCC_TEST_IDENTITY:-Fixture}" "$HOME/.config/hypertask-agents/credentials/valentins-claude-code-agent-token"
STUB
chmod +x "$T/bin/"* "$HOME/.agents/skills/ship/scripts/ship-identity"
printf '%s\n' 'vcc: helpers never write to the board; report to your runner' > "$T/refusal"
cat > "$HOME/.agents/skills/ship/scripts/ship-check" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$HOME/.agents/skills/ship/scripts/ship-check"
cat > "$T/bin/ticket-lint" <<'STUB'
#!/usr/bin/env bash
printf 'ticket-lint %s\n' "$*" >> "$VCC_TEST_TRACE"
if /bin/cat | grep -q LINTFAIL; then printf 'ticket-lint: rejected.\n  - LINTFAIL found\n' >&2; exit 1; fi
STUB
chmod +x "$T/bin/ticket-lint"
export VCC_TICKET_LINT="$T/bin/ticket-lint"
cat > "$T/bin/blocker-review" <<'STUB'
#!/usr/bin/env bash
# Stand-in for the shared gate: runners are refused, Chief Of Staff and leads pass.
[ "${1:-}" = --gate ] || exit 64
who=''; board=''
while [ "$#" -gt 0 ]; do
  case "$1" in --who) who=$2; shift ;; --board) board=$2; shift ;; esac
  shift
done
printf 'gate who=%s board=%s\n' "$who" "$board" >> "$VCC_TEST_TRACE"
case "$who" in
  Runner*) printf 'blocker-review gate: %s may not make Valentin the blocker.\n' "$who" >&2; exit 3 ;;
esac
STUB
chmod +x "$T/bin/blocker-review"
export VCC_BLOCKER_REVIEW="$T/bin/blocker-review"


fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
run() {
  : > "$VCC_TEST_TRACE"
  status=0
  "$@" > "$T/out" 2> "$T/err" || status=$?
}
refused() {
  run "$@"
  [ "$status" = 3 ] || fail "expected exit 3, got $status: $*"
  cmp -s "$T/refusal" "$T/err" || fail "wrong refusal message: $*"
  [ ! -s "$T/out" ] || fail "refusal produced stdout: $*"
  [ ! -s "$VCC_TEST_TRACE" ] || fail "refusal accessed credentials or CLI: $*"
}
allowed() {
  run "$@"
  [ "$status" = 0 ] || fail "expected stub success, got $status: $*: $(cat "$T/out" "$T/err" "$VCC_TEST_TRACE")"
  [ ! -s "$T/err" ] || fail "allowed command produced stderr: $*"
  [[ $(< "$T/out") == stub:* ]] || fail "command did not reach CLI: $*"
  [[ $(< "$VCC_TEST_TRACE") == *hypertask* ]] || fail "CLI trace missing: $*"
}

refused env VCC_HELPER=1 bash "$vcc" comment add X-1 --text hi
refused env VCC_HELPER=1 bash "$vcc" task move X-1 --section Done
refused env VCC_HELPER=1 bash "$vcc" activity add X-1 x
refused env VCC_HELPER=1 bash "$vcc" task assign X-1 --self
refused env VCC_HELPER=1 bash "$vcc" pages create --task X-1
refused env VCC_HELPER=1 bash "$vcc" comment add X-1 --text hi --help
refused env VCC_HELPER=1 bash "$vcc" --project 15 task move X-1 --section Done
refused env VCC_HELPER=1 bash "$vcc"
printf 'ok explicit helper writes blocked before credentials\n'

login_refused() {
  run "$@"
  [ "$status" = 2 ] || fail "runner without a board login was not refused: $* ($status) $(cat "$T/err")"
  [[ $(< "$T/err") == 'vcc: '* ]] || fail "wrong login refusal message: $*"
  [[ $(< "$VCC_TEST_TRACE") != *hypertask* ]] || fail "refused runner reached the board: $*"
}
login_refused env SHIP_SESSION_NAME='RUNNER 8' bash "$vcc" comment add X-1 --text hi
login_refused env SHIP_SESSION_NAME='SPEED RUNNER' bash "$vcc" task move X-1 --section 'In Progress'
login_refused env SHIP_SESSION_NAME='RUNNER 8 | HTPR-1 | fix' bash "$vcc" activity add X-1 'note'
allowed env SHIP_SESSION_NAME='HTPR-1 | fix' bash "$vcc" comment add X-1 --text hi
printf ' \n\n' > "$HOME/.config/hypertask-agents/credentials/valentins-claude-code-agent-token"
run env SHIP_SESSION_NAME='Valentins Claude Code' bash "$vcc" comment add X-1 --text hi
[ "$status" = 2 ] || fail 'empty board login was not refused'
printf 'fixture-token\n' > "$HOME/.config/hypertask-agents/credentials/valentins-claude-code-agent-token"
printf 'ok runner writes refused without its own board login\n'

for command in get list search last; do
  allowed env VCC_HELPER=1 bash "$vcc" tasks "$command" X-1
  [[ $(< "$T/out") == "stub: <tasks> <$command> <X-1>" ]] || fail 'read arguments changed'
done
for command in --help help --version; do
  allowed env VCC_HELPER=1 bash "$vcc" "$command"
done
printf 'ok helper reads and help reach stub\n'

allowed env HAX_PROVIDER=codex HAX_MODEL=gpt-6.1-sol HAX_EFFORT=high bash "$vcc" comment add X-1 --text hi
[[ $(< "$T/out") == 'stub: <comment> <add> <X-1> <--text> <hi>' ]] || fail 'write arguments changed'
printf 'ok runner write reaches stub without helper markers or ancestors\n'

# A copied Bash binary retains comm=hax; only these live proc entries are exposed.
cp /bin/bash "$T/bin/hax"
launch_hax() {
  local marker=$1; shift
  "$T/bin/hax" -c '
    IFS= read -r comm < "/proc/$$/comm"
    [ "$comm" = hax ] || exit 93
    ln -s "/proc/$$" "$VCC_HELPER_PROC_ROOT/$$"
    if [ "${VCC_TEST_NESTED:-}" = 1 ]; then
      /bin/bash -c '\''
        ln -s "/proc/$$" "$VCC_HELPER_PROC_ROOT/$$"
        /bin/bash "$VCC_TEST_BIN" "$@"
        status=$?
        rm "$VCC_HELPER_PROC_ROOT/$$"
        exit "$status"
      '\'' nested "$@"
    else
      /bin/bash "$VCC_TEST_BIN" "$@"
    fi
    status=$?
    rm "$VCC_HELPER_PROC_ROOT/$$"
    exit "$status"
  ' "$marker" "$@"
}
for marker in -p --prompt --print; do
  refused launch_hax "$marker" comment add X-1 --text hi
  allowed launch_hax "$marker" tasks get X-1
  printf 'ok live hax ancestor %s blocks writes and allows reads\n' "$marker"
done
refused env -u VCC_HELPER_PROC_ROOT "$T/bin/hax" -p -c '
  IFS= read -r comm < "/proc/$$/comm"
  [ "$comm" = hax ] || exit 93
  /bin/bash "$VCC_TEST_BIN" "$@"
  exit $?
' hax comment add X-1 --text hi
printf 'ok default /proc ancestry blocks helper writes\n'
export VCC_TEST_NESTED=1
refused launch_hax -p activity add X-1 x
unset VCC_TEST_NESTED
printf 'ok hax grandparent blocks activity writes\n'

# Prompt text containing -p is not a separate helper argument.
allowed launch_hax 'prompt containing -p' comment add X-1 --text hi
allowed launch_hax interactive comment add X-1 --text hi
printf 'ok hax without an exact prompt argument remains a runner\n'

# Unknown activity subcommands stop in vcc with its usage, never reach the CLI.
for args in "activity" "activity --help" "activity bogus X-1"; do
  run bash "$vcc" $args
  [ "$status" = 1 ] || fail "expected exit 1, got $status: vcc $args"
  [[ $(< "$T/err") == "vcc activity: "* ]] || fail "missing vcc activity error: vcc $args"
  [[ $(< "$VCC_TEST_TRACE") != *hypertask* ]] || fail "fell through to CLI: vcc $args"
done
allowed bash "$vcc" tasks get X-1
printf 'ok unknown activity subcommands fail in vcc\n'
cat > "$T/bin/curl" <<'STUB'
#!/usr/bin/env bash
cat >/dev/null
url= out=
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out=$2; shift 2 ;;
    https://*) url=$1; shift ;;
    *) shift ;;
  esac
done
printf 'curl %s\n' "$url" >> "$VCC_TEST_TRACE"
printf '%s\n' '{"success":true,"activities":[{"createdAt":"2026-11-07T00:00:00Z","agentName":"Runner 12","text":"older note"},{"createdAt":"2026-11-07T01:00:00Z","agentName":"Runner 12","text":"newer\nnote"}]}' > "$out"
printf '200'
STUB
chmod +x "$T/bin/curl"
run bash "$vcc" activity list X-1
[ "$status" = 0 ] || fail "activity list failed: $(cat "$T/err")"
[[ $(< "$VCC_TEST_TRACE") == *'agent-activity?limit=20'* ]] || fail "activity list used the wrong limit"
[[ $(< "$T/out") == *'older note'* && $(< "$T/out") == *'newer note'* ]] || fail "activity list dropped a row: $(cat "$T/out")"
run bash "$vcc" activity last X-1
[ "$status" = 0 ] || fail "activity last failed: $(cat "$T/err")"
[[ $(< "$VCC_TEST_TRACE") == *'agent-activity?limit=1'* ]] || fail "activity last stopped using limit 1"
printf 'ok activity list returns every note and last stays the newest read\n'
cat > "$T/bin/curl" <<'STUB'
#!/usr/bin/env bash
printf 'unexpected network request\n' >&2
exit 92
STUB
chmod +x "$T/bin/curl"
question='<p><strong>What this is:</strong> the row of board tabs above your task list.</p><p><span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span> Question: <strong>Remove the board tab row from My Tasks?</strong></p><p>My recommendation: yes.</p><p>Why: two rows of tabs confuse you.</p><p>Yes: a runner builds it behind a flag.</p><p>No: both rows stay.</p>'
export VCC_TEST_COMMENTS="$T/comments.json" VCC_TEST_TASK="$T/task.json"
task_fixture() { jq -n --arg d "$1" '{tasks:[{id:1,description:$d}]}' > "$VCC_TEST_TASK"; }
task_fixture '<p>Problem</p><p>Fix</p><p>Done when</p><p>Risk: low.</p><p>Decision: none.</p>'
fixture() {
  jq -n --arg text "$1" '{comments:[{id:"new",text:$text,createdAt:"2026-10-20T12:00:00Z"}]}' > "$VCC_TEST_COMMENTS"
}
review_refused() {
  local reason=$1; shift
  run bash "$vcc" "$@"
  [ "$status" = 5 ] || fail "expected exit 5, got $status: $*"
  [[ $(< "$T/err") == 'vcc: Valentin Review needs one plain Question comment first:'* ]] || fail "wrong review refusal: $*"
  [ -z "$reason" ] || [[ $(< "$T/err") == *"$reason"* ]] || fail "missing review refusal reason: $reason"
  [ ! -s "$T/out" ] || fail "review refusal produced stdout: $*"
  [[ $(< "$VCC_TEST_TRACE") == *'hypertask comments list'* ]] || fail 'comments were not read'
  [[ $(< "$VCC_TEST_TRACE") != *'hypertask task move'* && $(< "$VCC_TEST_TRACE") != *'hypertask tasks move'* ]] || fail 'refused move reached CLI'
}

fixture "$question"
jq '.comments += [{id:"old",text:"<p>Older status note.</p>",createdAt:"2026-10-19T12:00:00Z"}]' "$VCC_TEST_COMMENTS" > "$T/newest.json"
mv "$T/newest.json" "$VCC_TEST_COMMENTS"
allowed bash "$vcc" task move YPER4-512 --section 'Valentin Review'
[[ $(< "$T/out") == 'stub: <task> <move> <YPER4-512> <--section> <Valentin Review>' ]] || fail 'review move arguments changed'
[[ $(< "$VCC_TEST_TRACE") == *'hypertask comments list'* ]] || fail 'review move skipped comments'
allowed bash "$vcc" tasks move YPER4-512 '--section=  vAlEnTiN ReViEw  '
[[ $(< "$T/out") == 'stub: <tasks> <move> <YPER4-512> <--section=  vAlEnTiN ReViEw  >' ]] || fail 'equals section arguments changed'
fixture '<p><strong>What this is:</strong> the setting that keeps the board tidy.</p><p>Question: <strong>Keep it?</strong></p><p>My recommendation: yes.</p><p>Why: less work.</p><p>Yes: keep it.</p><p>No: remove it.</p>'
allowed bash "$vcc" task move YPER4-512 --section 'Valentin Review'
allowed bash "$vcc" task move --section 'Valentin Review' YPER4-512
[[ $(< "$VCC_TEST_TRACE") == *'hypertask comments list'* ]] || fail 'section before ticket skipped comments'
printf 'ok newest Question with or without mention allows both section forms\n'

rm "$VCC_TEST_COMMENTS"
allowed bash "$vcc" task move YPER4-512 --section 'In Progress'
[[ $(< "$VCC_TEST_TRACE") != *'hypertask comments list'* ]] || fail 'unrelated move read comments'
allowed bash "$vcc" task get YPER4-512 --section 'Valentin Review'
[[ $(< "$VCC_TEST_TRACE") != *'hypertask comments list'* ]] || fail 'unrelated call read comments'
printf 'ok other moves and non-move calls never read comments\n'

fixture '<p>A plain status note.</p>'
review_refused '' task move YPER4-512 --section 'Valentin Review'
review_refused '' tasks move YPER4-512 '--section=Valentin Review'
jq --arg text "$question" '.comments += [{id:"old",text:$text,createdAt:"2026-10-19T12:00:00Z"}]' "$VCC_TEST_COMMENTS" > "$T/older.json"
mv "$T/older.json" "$VCC_TEST_COMMENTS"
review_refused '' task move YPER4-512 --section 'Valentin Review'
printf 'ok newest status note refuses even with an older Question\n'

for text in \
  '<p><strong>What this is:</strong> the setting that keeps the board tidy.</p><p>Question: <strong>Keep it?</strong></p><p>My recommendation: yes.</p><p>Why: less work.</p>' \
  '<p><strong>What this is:</strong> the setting that keeps the board tidy.</p><p>Question: <strong>Keep it?</strong></p><p>Yes: keep it.</p>' \
  '<p><strong>What this is:</strong> the setting that keeps the board tidy.</p><p>Question: <strong>Keep it?</strong></p><p>No: remove it.</p>' \
  '<p><strong>What this is:</strong> the setting that keeps the board tidy.</p><p>Question: Keep it?</p><p>Yes: keep it.</p><p>No: remove it.</p>' \
  '<p><strong>What this is:</strong> the setting that keeps the board tidy.</p><p>Question: <strong>Keep it.</strong></p><p>Yes: keep it.</p><p>No: remove it.</p>' \
  '<p><strong>What this is:</strong> the setting that keeps the board tidy.</p><p>Status: Question: <strong>Keep it?</strong></p><p>Yes: keep it.</p><p>No: remove it.</p>' \
  '<p><strong>What this is:</strong> the setting that keeps the board tidy.</p><p>Question: note. Question: <strong>Keep it?</strong></p><p>Yes: keep it.</p><p>No: remove it.</p>'; do
  fixture "$text"
  review_refused '' task move YPER4-512 --section 'Valentin Review'
done
printf 'ok malformed Questions refuse without both choice paragraphs and an immediate bold question\n'
printf '{"comments":[]}\n' > "$VCC_TEST_COMMENTS"
review_refused '' task move YPER4-512 --section 'Valentin Review'

rm "$VCC_TEST_COMMENTS"
review_refused 'cannot read comments' task move YPER4-512 --section 'Valentin Review'
for json in '' 'not json' '{}' '{"comments":{}}' '{"comments":[{"text":"Question:","createdAt":null}]}'; do
  printf '%s\n' "$json" > "$VCC_TEST_COMMENTS"
  review_refused 'cannot parse comments' task move YPER4-512 --section 'Valentin Review'
done
printf 'ok unreadable or malformed comments fail closed\n'


question_refused() {
  local reason=$1; shift
  run bash "$vcc" "$@"
  [ "$status" = 5 ] || fail "expected exit 5, got $status: $*"
  [ ! -s "$T/out" ] || fail 'Question refusal produced stdout'
  [[ $(< "$T/err") == *"$reason"* ]] || fail "missing Question refusal reason: $reason"
  [[ $(< "$T/err") == *'rewrite it for a product owner (pospeak)'* ]] || fail 'missing product-owner guidance'
  [[ $(< "$VCC_TEST_TRACE") != *hypertask* ]] || fail 'refused Question reached CLI'
}
plain='<p><strong>What this is:</strong> the setting that keeps the board tidy.</p><p>Question: <strong>Keep it?</strong></p><p>My recommendation: yes.</p><p>Why: less work.</p><p>Yes: keep it.</p><p>No: remove it.</p>'
inline_why='<p><strong>What this is:</strong> the setting that keeps the board tidy.</p><p>Question: <strong>Keep it?</strong></p><p>My recommendation: yes. Why: less work.</p><p>Yes: keep it.</p><p>No: remove it.</p>'
for text in "$plain" "$inline_why" "$question"; do
  allowed bash "$vcc" comment add X-1 --kind question --text "$text"
  [[ $(< "$T/out") == "stub: <comment> <add> <X-1> <--kind> <question> <--text> <$text>" ]] || fail 'Question arguments changed'
  fixture "$text"
  allowed bash "$vcc" task move X-1 --section 'Valentin Review'
done
for part in 'Yes:' 'No:' 'My recommendation:' 'Why:'; do
  text=$(printf '%s' "$plain" | sed "s|<p>$part[^<]*</p>||")
  question_refused "$part" comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused "$part" task move X-1 --section 'Valentin Review'
done
question_refused 'Question:' comment add X-1 --kind question --text "${plain/Keep it?/Keep it.}"
printf 'ok required Question parts and shared review validation\n'

label='<p><strong>What this is:</strong> the setting that keeps the board tidy.</p>'
shape='<strong>What this is:</strong>'
no_label="${plain/$label/}"
question_refused 'What this is:' comment add X-1 --kind question --text "$no_label"
fixture "$no_label"
review_refused 'What this is:' task move X-1 --section 'Valentin Review'
late_label="${plain/$label/}<p>$shape the setting that keeps the board tidy.</p>"
question_refused 'What this is:' comment add X-1 --kind question --text "$late_label"
empty_label="${plain/$shape the setting that keeps the board tidy./$shape}"
question_refused 'What this is:' comment add X-1 --kind question --text "$empty_label"
for context in '&#32;' '&#x20;' '&#X20;' '&#160;' '&#32;&#x20;&#160;' '&#9;' '&#10;' '&#11;' '&#12;' '&#13;' '&#00009;' '&#00010;' '&#x000A;' '&#X000d;' '&#9&#xA' '&#8192;&#x200A;&#8239;&#xFEFF;' '&#8203;' '&#x200B;' '&Tab;&NewLine;&ensp;&emsp;&thinsp;&ZeroWidthSpace;'; do
  text="${plain/$shape the setting that keeps the board tidy./"$shape$context"}"
  question_refused 'What this is:' comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused 'What this is:' task move X-1 --section 'Valentin Review'
done
for context in $'\u200b' $'\u00a0\u1680\u2000\u200a\u202f\u3000\ufeff' $'\u0085\u200b\u2028\u2029\u205f'; do
  text="${plain/$shape the setting that keeps the board tidy./"$shape$context"}"
  question_refused 'What this is:' comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused 'What this is:' task move X-1 --section 'Valentin Review'
done
context=$'\u200b<strong>設定を確認。</strong>'
text="${plain/$shape the setting that keeps the board tidy./"$shape$context"}"
allowed bash "$vcc" comment add X-1 --kind question --text "$text"
fixture "$text"
allowed bash "$vcc" task move X-1 --section 'Valentin Review'
context='&#0009;the&#X000A;setting&#160;works'
text="${plain/$shape the setting that keeps the board tidy./"$shape$context"}"
allowed bash "$vcc" comment add X-1 --kind question --text "$text"
fixture "$text"
allowed bash "$vcc" task move X-1 --section 'Valentin Review'
for prefix in 'Leading text' '<div>Leading text</div>' '<p></p>Leading text'; do
  text="$prefix$plain"
  question_refused 'What this is:' comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused 'What this is:' task move X-1 --section 'Valentin Review'
done
allowed bash "$vcc" comment add X-1 --kind question --text "  <div><p></p>$plain</div>"
printf 'ok a Question needs What this is: first, with words after it\n'

for word in 'src/app/page.tsx' '/api/' '/api/boards' 'page.ts' 'page.tsx' 'page.js' 'NOTES.md' endpoint ROUTE bearer OAuth prefilter regex schema migration CodeQL 'token audience' CI 'PR #123' PR123 '#123'; do
  text="$plain<p>$word</p>"
  question_refused "$word" comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused "$word" task move X-1 --section 'Valentin Review'
done
question_refused CI comment add X-1 --kind question --text "$plain<p>CI and OAuth</p>"
[[ $(< "$T/err") == *OAuth* ]] || fail 'did not name every developer word'
allowed bash "$vcc" comment add X-1 --kind question --text "$plain<p>We can decide in Circle, with ci and circles.</p>"
for link in '<a href="https://example.test">Details</a>' 'https://example.test' 'www.example.test' '<a href="/detail/project-15/1">Details</a>'; do
  question_refused 'no outside links' comment add X-1 --kind question --text "$plain<p>$link</p>"
  fixture "$plain<p>$link</p>"
  review_refused 'no outside links' task move X-1 --section 'Valentin Review'
done
question_refused '#456' comment add X-1 --kind question --text "$plain<p><a href="https://example.test/123">PR #123</a> #456</p>"
question_refused OAuth comment add X-1 --kind question --text "$plain<p><a href="https://example.test/123">OAuth</a></p>"
printf 'ok visible developer words and unlinked references refuse without CI substring or href false positives\n'

for subcommand in comment comments; do
  for option in --text --body --text= --body=; do
    if [[ $option == *= ]]; then
      allowed bash "$vcc" "$subcommand" add X-1 --kind=question "$option$plain"
      [[ $(< "$T/out") == "stub: <$subcommand> <add> <X-1> <--kind=question> <$option$plain>" ]] || fail 'equals body arguments changed'
      question_refused 'My recommendation:' "$subcommand" add X-1 --kind=question "$option${plain/<p>My recommendation: yes.<\/p>/}"
    else
      allowed bash "$vcc" "$subcommand" add X-1 --kind question "$option" "$plain"
      [[ $(< "$T/out") == "stub: <$subcommand> <add> <X-1> <--kind> <question> <$option> <$plain>" ]] || fail 'body arguments changed'
      question_refused 'My recommendation:' "$subcommand" add X-1 --kind question "$option" "${plain/<p>My recommendation: yes.<\/p>/}"
    fi
  done
done
printf '%s\n' "$plain" > "$T/question.html"
allowed bash "$vcc" comments add X-1 --kind question --file "$T/question.html"
[[ $(< "$T/out") == "stub: <comments> <add> <X-1> <--kind> <question> <--file> <$T/question.html>" ]] || fail 'file arguments changed'
allowed bash "$vcc" comment add X-1 --kind=question "--file=$T/question.html"
printf '%s\n' "${plain/<p>My recommendation: yes.<\/p>/}" > "$T/question.html"
question_refused 'My recommendation:' comment add X-1 --kind question --file "$T/question.html"
question_refused 'My recommendation:' comments add X-1 --kind=question "--file=$T/question.html"
run bash "$vcc" comment add X-1 --kind question --file "$T/missing.html"
[ "$status" = 5 ] || fail 'missing Question file must fail closed'
markdown='What this is: the setting that keeps the board tidy.

Question: **Keep it?**

My recommendation: yes. Why: less work.
Yes: keep it.
No: remove it.'
allowed bash "$vcc" comment add X-1 --kind question --markdown --text "$markdown"
[[ $(< "$T/out") == "stub: <comment> <add> <X-1> <--kind> <question> <--markdown> <--text> <$markdown>" ]] || fail 'Markdown arguments changed'
for context in $'\u200b' $'\u00a0\u200b\u3000\ufeff' '&#9;&#xA;&#160;' '&Tab;&NewLine;&emsp;' '[](https://example.test)' '[&#32;](https://example.test)' '*' '_' '**' '* _ **' '`' '```' '* _ ` **' '[*](https://example.test)' '<em>_</em>'; do
  text="${markdown/the setting that keeps the board tidy./"$context"}"
  question_refused 'What this is:' comment add X-1 --kind question --markdown --text "$text"
done
for context in $'\u200b**設定を確認。**' $'\u00a0*the setting* stays.' '*the setting* keeps the board tidy.' '_the setting_ keeps the board tidy.' '**the setting** keeps the board tidy.' '`the setting` keeps the board tidy.' '<em>the setting</em> stays.' '設定を確認。' 'Keep version 1.2, A/B, and C++.'; do
  text="${markdown/the setting that keeps the board tidy./"$context"}"
  allowed bash "$vcc" comment add X-1 --kind question --markdown --text "$text"
done
context='&#9;See [the setting](https://example.test)&#x20;here.'
text="${markdown/the setting that keeps the board tidy./"$context"}"
question_refused 'no outside links' comment add X-1 --kind question --markdown --text "$text"
question_refused '#123' comment add X-1 --kind question --markdown --text "$text #123"
question_refused '#35' comment add X-1 --kind question --markdown --text "$text &#35;123"
printf '%s\n' "$markdown" > "$T/question.md"
question_refused 'What this is:' comment add X-1 --kind question --markdown --text "${markdown/What this is: the setting that keeps the board tidy./Question: **Keep it?**}"
allowed bash "$vcc" comments add X-1 --kind=question --markdown "--file=$T/question.md"
question_refused 'My recommendation:' comment add X-1 --kind question --markdown --body "${markdown/My recommendation:/Suggestion:}"
question_refused 'Question:' comment add X-1 --kind question --markdown --text "${markdown/Keep it?/Keep it.}"
question_refused OAuth comment add X-1 --kind question --markdown --text "$markdown
OAuth"
question_refused 'no outside links' comment add X-1 --kind question --markdown --text "$markdown
[PR #123](https://example.test/api/OAuth/CI)"
for suffix in '<p>Extra.</p>' '<div>Extra.</div>' '<li><p>Extra.</p></li>' '<br>Extra.<br>'; do
  context='<p><strong>What this is:</strong> the setting that keeps the board tidy.</p>'
  for ((n=1; n<8; n++)); do context+="$suffix"; done
  text="${plain/$label/$context}"
  allowed bash "$vcc" comment add X-1 --kind question --text "$text"
  text="${plain/$label/$context$suffix}"
  question_refused 'at most 8 context lines' comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused 'at most 8 context lines' task move X-1 --section 'Valentin Review'
done
context='What this is: the setting that keeps the board tidy.'
for ((n=1; n<8; n++)); do context+=$'\nExtra.'; done
text="${markdown/What this is: the setting that keeps the board tidy./$context}"
allowed bash "$vcc" comment add X-1 --kind question --markdown --text "$text"
question_refused 'at most 8 context lines' comment add X-1 --kind question --markdown --text "${markdown/What this is: the setting that keeps the board tidy./$context$'\nExtra.'}"
for text in "${plain/<p>My recommendation: yes.<\/p>/}<p>My recommendation: yes.</p>" "${plain/<p>My recommendation: yes.<\/p>/<p>Extra.</p><p>My recommendation: yes.</p>}"; do
  question_refused 'must be right under' comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused 'must be right under' task move X-1 --section 'Valentin Review'
done
text="${plain/<p>Question:/<p>Question: note.</p><p>Question:}"
question_refused 'only one Question:' comment add X-1 --kind question --text "$text"
fixture "$text"
review_refused 'only one Question:' task move X-1 --section 'Valentin Review'
text="${plain/Keep it?/Keep it?<\/strong> Question: <strong>Remove it?}"
question_refused 'only one Question:' comment add X-1 --kind question --text "$text"
fixture "$text"
review_refused 'only one Question:' task move X-1 --section 'Valentin Review'
question_refused 'only one Question:' comment add X-1 --kind question --markdown --text "${markdown/Keep it?/Keep it?** Question: **Remove it?}"
question_refused 'only one Question:' comment add X-1 --kind question --markdown --text "${markdown/Question: **Keep it?**/Question: summary$'\n'Question: **Keep it?**}"
question_refused 'must be right under' comment add X-1 --kind question --markdown --text "${markdown/My recommendation: yes. Why: less work./Extra.$'\n'My recommendation: yes. Why: less work.}"
for context in '<ul><li><p>What this is: the setting that keeps the board tidy.</p></li></ul>' '<blockquote>What this is: the setting that keeps the board tidy.</blockquote>'; do
  allowed bash "$vcc" comment add X-1 --kind question --text "${plain/$label/$context}"
done
printf 'ok short context, immediate recommendation, one question and no links enforced with allowed controls\n'
printf 'ok singular/plural, text/body/file, equals options, and Markdown forms\n'

for kind in qa done ''; do
  for subcommand in comment comments; do
    args=("$subcommand" add X-1 --text 'src/app/page.tsx /api/ CI OAuth PR #123')
    [ -z "$kind" ] || args+=(--kind "$kind")
    allowed bash "$vcc" "${args[@]}"
    expected='stub:'
    printf -v expected '%s <%s>' "$expected" "${args[0]}"
    for arg in "${args[@]:1}"; do expected+=" <$arg>"; done
    [[ $(< "$T/out") == "$expected" ]] || fail 'non-question arguments changed'
  done
done
printf 'ok qa, done, and untyped comments forward code words unchanged\n'

agent_detail_refused() {
  run bash "$vcc" "$@"
  [ "$status" = 5 ] || fail "agent detail not refused: $*: $status"
  [[ $(< "$T/err") == 'vcc: agent detail belongs in vcc activity add' ]] || fail "wrong agent detail refusal: $*"
  [[ $(< "$VCC_TEST_TRACE") != *hypertask* && $(< "$VCC_TEST_TRACE") != *'identity lookup'* ]] || fail 'agent detail reached identity or board'
}
for detail in 'tmux attach -t runner-8' 'claude --resume session' 'codex resume session' 'hax --resume=session' \
  'Helpers: none' 'Branch/PR: none' 'Outputs: evidence' 'Gates: 3 met' 'GATES.md' '.unlazy/session' '/home/valentin/file' '~/notes'; do
  for kind in question qa done; do
    agent_detail_refused comment add X-1 --kind "$kind" --text "$plain<p>$detail</p>"
    printf '%s\n' "$plain<p>$detail</p>" > "$T/people.html"
    agent_detail_refused comments add X-1 "--kind=$kind" "--file=$T/people.html"
  done
  for operation in create update; do
    agent_detail_refused task "$operation" X-1 --description "$detail"
    agent_detail_refused tasks "$operation" X-1 "--description-file=$T/people.html"
  done
  agent_detail_refused comment add X-1 --text "<span data-type=\"mention\">Valentin Yeo</span> $detail"
  agent_detail_refused comment add X-1 --mentions 6 --body "$detail"
  allowed bash "$vcc" comment add X-1 --text "$detail"
done
allowed bash "$vcc" comment add X-1 --kind question --text "$plain"
allowed bash "$vcc" task update X-1 --description '<p>Settings now works.</p>'
allowed bash "$vcc" task create --title 'Clearer settings' --description '<p>Nothing to decide.</p>'
agent_detail_refused comment add X-1 --kind qa --text '<p><strong>Helpers</strong>: none</p>'
agent_detail_refused --json comment add X-1 --kind qa --text 'tmux attach -t runner-8'
agent_detail_refused --project 15 task update X-1 --description 'Outputs: private'
run bash "$vcc" comment add X-1 --kind=qa --file "$T/missing.html"
[ "$status" = 5 ] || fail 'unreadable people content must fail closed'
printf '<p>Settings now works.</p>\n' > "$T/plain.html"
allowed bash "$vcc" task update X-1 --description 'tmux attach -t runner-8' --description-file "$T/plain.html"
agent_detail_refused task update X-1 --description 'Safe text' --description-file "$T/people.html"
agent_detail_refused comments add X-1 --kind=qa '--body=Outputs: private'
agent_detail_refused tasks create '--description=Gates: 3 met' --title 'Plain title'
agent_detail_refused comment add X-1 --text '<span data-type = "mention">Valentin Yeo</span> Helpers: none'
agent_detail_refused comment add X-1 --kind qa --text '<p><a href="/home/valentin/result">Proof</a></p>'
printf 'agent detail boundary verified\n'


old_question_7508_295851=$(cat <<'FIXTURE'
<p><span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span> Question: <strong>Should HT Product Lead check and approve the agent-access exceptions, with you deciding only the changes that hide data from people?</strong></p><p>Why: some of the 81 agent board reads here are already protected by a check just above them; marking them reviewed changes nothing in the app.</p><p>Yes: HT Product Lead reviews those code checks; changes that hide a board, ticket or comment from a person still come to you, one question per batch.</p><p>No: each batch of them comes to you too.</p><p>Next: claude --resume ce05d8aa-af47-49c9-8593-c7d186e29d77</p>
FIXTURE
)

rewrite_7508_303933=$(cat <<'FIXTURE'
<p><strong>What this is:</strong> this ticket makes sure an AI agent only sees the boards it was given, not every board its owner can see.</p>
<p>What it is about: there are 81 places in the app where an agent reads board content. Each one should check &quot;is this agent allowed on this board?&quot;. Many already check it a few lines earlier, so they are safe today and only need to be marked as checked. The others need a real fix.</p>
<p>Why it needs you: a real fix can make something disappear for someone, for example a board an agent could see by mistake. Taking access away is your call. Marking already-safe places as checked changes nothing anyone sees.</p>
<p>Question: <strong>Can I (HT Product Lead) sign off the places that are already safe, so you only decide the fixes that take access away from someone?</strong></p>
<p>My recommendation: yes. Why: those sign-offs change nothing for any user, and asking you 81 times would hold the security fix up for days. Everything that takes access away still comes to you as one plain question per batch.</p>
<p>Yes: I sign off the already-safe places; fixes that take access away come to you in batches. (My recommendation, 👍 this comment.)</p>
<p>No: every batch comes to you, including the ones that change nothing.</p>
<p>Next: on your 👍, RUNNER 4 finishes the list.</p>
FIXTURE
)
agent_detail_refused comment add X-1 --kind question --text "$old_question_7508_295851"
fixture "$old_question_7508_295851"
review_refused 'My recommendation:' task move X-1 --section 'Valentin Review'
allowed bash "$vcc" comment add X-1 --kind question --text "$rewrite_7508_303933"
fixture "$rewrite_7508_303933"
allowed bash "$vcc" task move X-1 --section 'Valentin Review'
printf 'ok verbatim old Question refuses and real rewrite passes comment add and newest review\n'
lint_refused() {
  local what=$1; shift
  run bash "$vcc" "$@"
  [ "$status" = 5 ] || fail "expected lint exit 5, got $status: $*"
  [[ $(< "$T/err") == "vcc: $what refused by the house ticket rules"* ]] || fail "wrong lint refusal: $(< "$T/err")"
  [[ $(< "$T/err") == *'LINTFAIL found'* ]] || fail 'lint reason not shown'
  [[ $(< "$VCC_TEST_TRACE") != *'hypertask task create'* && $(< "$VCC_TEST_TRACE") != *'hypertask task move'* && $(< "$VCC_TEST_TRACE") != *'hypertask comment add'* ]] || fail 'lint refusal reached CLI'
}
lint_refused 'Ticket description' task create --project 4060 --title T --description '<p>LINTFAIL</p>'
printf '<p>LINTFAIL</p>' > "$T/desc.md"
lint_refused 'Ticket description' task create --project 4060 --title T --description-file "$T/desc.md"
lint_refused 'Ticket description' task update YPER4-1 '--description=LINTFAIL'
allowed bash "$vcc" task create --project 4060 --title T --description '<p>Problem</p>'
[[ $(< "$VCC_TEST_TRACE") == *'ticket-lint --shape -'* ]] || fail 'description skipped shape lint'
allowed bash "$vcc" task update YPER4-1 --title 'New title'
[[ $(< "$VCC_TEST_TRACE") != *'ticket-lint'* ]] || fail 'title-only update ran description lint'
lint_refused 'Question' comment add YPER4-1 --kind question --text "$question<p>LINTFAIL</p>"
fixture "$question<p>LINTFAIL</p>"
lint_refused 'Valentin Review move (YPER4-512 Question)' task move YPER4-512 --section 'Valentin Review'
fixture "$question"
task_fixture '<p>LINTFAIL</p>'
lint_refused 'Valentin Review move (YPER4-512 description)' task move YPER4-512 --section 'Valentin Review'
run env VCC_TICKET_LINT=/missing bash "$vcc" task create --project 4060 --title T --description x
[ "$status" = 5 ] && [[ $(< "$T/err") == *'ticket-lint missing'* ]] || fail 'missing lint did not refuse'
printf 'ok descriptions, Questions and Valentin Review moves pass the house ticket lint\n'
unset VCC_TEST_TASK
cat > "$HOME/.agents/skills/ship/scripts/ship-check" <<'STUB'
#!/usr/bin/env bash
printf 'completion %s\n' "$*" >> "$VCC_TEST_TRACE"
[ "${VCC_TEST_COMPLETE:-missing}" = passed ] || exit 2
STUB
chmod +x "$HOME/.agents/skills/ship/scripts/ship-check"
for provider in codex anthropic grok; do
  run env HAX_PROVIDER="$provider" bash "$vcc" task move YPER4-864 --section Done
  [ "$status" = 2 ] || fail "incomplete $provider move not refused: $status"
  [[ $(< "$VCC_TEST_TRACE") != *'hypertask task move'* ]] || fail 'incomplete Done reached CLI'
  allowed env HAX_PROVIDER="$provider" VCC_TEST_COMPLETE=passed bash "$vcc" task move YPER4-864 --section Done
  [[ $(< "$VCC_TEST_TRACE") == *'completion move YPER4-864 Done'* ]] || fail 'completion check skipped'
done
for args in \
  'tasks update YPER4-864 --section=10413' \
  'task move --section Done YPER4-864' \
  '--json task move YPER4-864 --section Done' \
  'task move YPER4-864 --to Done' \
  'task move YPER4-864 --to-section 10413' \
  '--human task move YPER4-864 --section Done' \
  'task move YPER4-864 -section=Done'; do
  run bash "$vcc" $args
  [ "$status" = 2 ] || fail "alternate move bypassed completion: $args"
  [[ $(< "$VCC_TEST_TRACE") != *'hypertask task move'* && $(< "$VCC_TEST_TRACE") != *'hypertask tasks update'* ]] || fail 'alternate Done reached CLI'
done
rm "$HOME/.agents/skills/ship/scripts/ship-check"
run bash "$vcc" task move YPER4-864 --section Done
[ "$status" = 2 ] || fail 'missing checker must fail closed'
[[ $(< "$VCC_TEST_TRACE") != *hypertask* ]] || fail 'missing checker reached CLI'
printf 'ok completion enforced for every provider before board write\n'
ln -s "$ship_check" "$HOME/.agents/skills/ship/scripts/ship-check"
export VCC_EVIDENCE_DIR="$T/evidence"
cat > "$T/bin/hypertask" <<'STUB'
#!/usr/bin/env bash
printf 'hypertask %s %s\n' "${1:-}" "${2:-}" >> "$VCC_TEST_TRACE"
[ "${HT_TOKEN:-}" = fixture-token ] || exit 91
case "$1 $2" in
  'tasks get') printf '{"tasks":[{"ticketNumber":"%s","boardId":4060}]}\n' "${VCC_TEST_TICKET:-YPER4-864}" ;;
  'section list')
    sections='{"sections":[{"id":10413,"section_title":"Shipped","isDone":true},{"id":10411,"section_title":"In Progress","isDone":false}]}'
    printf '%s\n' "${VCC_TEST_SECTIONS:-$sections}" ;;
  *) printf 'stub:'; printf ' <%s>' "$@"; printf '\n' ;;
esac
STUB
cat > "$T/bin/gh" <<'STUB'
#!/usr/bin/env bash
printf 'gh %s\n' "$*" >> "$VCC_TEST_TRACE"
case "$*" in
  *'--json title --jq .title') printf '%s [INFRA] Fixture\n' "${VCC_TEST_TICKET:-YPER4-864}" ;;
  *'--json number,title,state,mergeCommit,baseRefName')
    printf '{"number":1,"title":"%s [INFRA] Fixture","state":"%s","mergeCommit":{"oid":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"baseRefName":"production"}\n' "${VCC_TEST_TICKET:-YPER4-864}" "${VCC_TEST_PR_STATE:-MERGED}" ;;
  'api '*'/commits/'*'/status '*) printf '\n' ;;
  'api '*'/deployments?sha='*) printf '1\n' ;;
  'api '*'/deployments/1/statuses '*) printf '%s\n' "${VCC_TEST_DEPLOY:-success}" ;;
  *) exit 91 ;;
esac
STUB
chmod +x "$T/bin/gh"
completion_refused() {
  run "$@"
  [ "$status" = 2 ] || fail "real completion guard allowed missing proof: $* ($status) $(cat "$T/err")"
  [[ $(< "$VCC_TEST_TRACE") != *'hypertask task move'* && $(< "$VCC_TEST_TRACE") != *'hypertask tasks update'* ]] || fail 'refused move reached CLI'
}
completion_refused bash "$vcc" task move YPER4-864 --section Done
completion_refused env VCC_TEST_SECTIONS='{"sections":[{"id":10413,"section_title":"Shipped"}]}' bash "$vcc" task move YPER4-864 --section=10413
allowed env VCC_TEST_SECTIONS='{"sections":[{"id":10411,"section_title":"In Progress"}]}' bash "$vcc" task move YPER4-864 --section=10411
mkdir -p "$VCC_EVIDENCE_DIR/YPER4-864"
printf '1\n' > "$VCC_EVIDENCE_DIR/YPER4-864/pr"
completion_refused env VCC_TEST_PR_STATE=OPEN bash "$vcc" task move YPER4-864 --section Done
completion_refused env VCC_TEST_DEPLOY=pending bash "$vcc" task move YPER4-864 --section Done
allowed bash "$vcc" task move YPER4-864 --section Done
allowed bash "$vcc" tasks update YPER4-864 --section=10413
allowed bash "$vcc" task move --section Shipped YPER4-864
allowed bash "$vcc" task move 80196 --section Done
[[ $(< "$T/out") == 'stub: <task> <move> <80196> <--section> <Done>' ]] || fail 'numeric ref arguments changed'
allowed bash "$vcc" task update YPER4-864 --title 'Done --section Done'
allowed bash "$vcc" task move YPER4-864 --section Done --section 'In Progress'
allowed bash "$vcc" --json task move YPER4-864 --section Done
allowed bash "$vcc" task move YPER4-864 --section 'In Progress'
completion_refused env VCC_TEST_SECTIONS=broken bash "$vcc" task move YPER4-864 --section=10413
mkdir -p "$VCC_EVIDENCE_DIR/HTPR-999"
printf '1\n' > "$VCC_EVIDENCE_DIR/HTPR-999/pr"
completion_refused env VCC_TEST_TICKET=HTPR-999 bash "$vcc" task move HTPR-999 --section Done
printf 'ok real checker requires merged PR, successful deploy, and app QA proof\n'
cat > "$T/bin/hypertask" <<'STUB'
#!/usr/bin/env bash
printf 'hypertask %s %s\n' "${1:-}" "${2:-}" >> "$VCC_TEST_TRACE"
[ "${HT_TOKEN:-}" = fixture-token ] || exit 91
if [ "${1:-} ${2:-}" = 'tasks get' ]; then
  printf '%s\n' '{"tasks":[{"id":42,"projectId":15,"uniqueIndex":8740}]}'
  exit 0
fi
printf 'stub:'; printf ' <%s>' "$@"; printf '\n'
STUB
chmod +x "$T/bin/hypertask"
cat > "$T/bin/curl" <<'STUB'
#!/usr/bin/env bash
url="${*: -1}"
data="" out="" prev=""
for arg in "$@"; do
  [ "$prev" = --data ] && data=$arg
  [ "$prev" = --output ] && out=$arg
  prev=$arg
done
printf 'curl %s %s\n' "$url" "$data" >> "$VCC_TEST_TRACE"
if [[ $url == *"/activities" ]]; then
  printf '%s' '{"success":true,"activity":{"id":"act-1"}}' > "$out"
elif [[ $url == */agents/runs/run-1 ]]; then
  printf '%s' '{"success":true,"run":{"id":"run-1","status":"active"}}' > "$out"
elif [[ $url == */agents/runs ]]; then
  printf '%s' '{"success":true,"run":{"id":"run-1","status":"active"}}' > "$out"
else
  printf 'unexpected %s\n' "$url" >&2
  exit 92
fi
printf '200'
STUB
chmod +x "$T/bin/curl"
run bash "$vcc" activity add HTPR-8740 --text 'parked note'
[ "$status" = 0 ] || fail "documented --text was rejected: $(cat "$T/err")"
[ "$(cat "$T/out")" = act-1 ] || fail "activity id missing"
grep -q 'parked note' "$VCC_TEST_TRACE" || fail '--text body was not posted'
run bash "$vcc" activity add HTPR-8740 --text='second note'
[ "$status" = 0 ] || fail "--text= was rejected: $(cat "$T/err")"
grep -q 'second note' "$VCC_TEST_TRACE" || fail '--text= body was not posted'
run bash "$vcc" activity add HTPR-8740 'positional note'
[ "$status" = 0 ] || fail "positional text broke: $(cat "$T/err")"
run bash "$vcc" activity add HTPR-8740 --note hi
[ "$status" = 1 ] || fail "unknown option was accepted"
grep -q 'add needs one non-empty text argument' "$T/err" || fail "wrong rejection: $(cat "$T/err")"
printf 'ok activity add accepts the documented text option\n'
note_posted() {
  local label=$1 expected=$2
  shift 2
  : > "$VCC_TEST_TRACE"
  run bash "$vcc" "$@"
  [ "$status" = 0 ] || fail "$label rejected: $(cat "$T/err")"
  grep -F -q -- "$expected" "$VCC_TEST_TRACE" || fail "$label body was not posted: $(cat "$VCC_TEST_TRACE")"
}
note_posted 'HTPR-8899 --text' 'HTPR-8899 note' activity add HTPR-8899 --text 'HTPR-8899 note'
note_posted 'HTPR-8897 positional' 'HTPR-8897 note' activity add HTPR-8897 'HTPR-8897 note'
note_posted 'HTPR-8888 --text' 'HTPR-8888 note' activity add HTPR-8888 --text 'HTPR-8888 note'
note_posted 'HTPR-8884 flag before ticket' 'HTPR-8884 note' activity add --text 'HTPR-8884 note' HTPR-8884
note_posted 'HTPR-8865 --body' 'HTPR-8865 note' activity add HTPR-8865 --body 'HTPR-8865 note'
note_posted 'HTPR-8864 --text before ticket' 'HTPR-8864 note' activity add --text 'HTPR-8864 note' HTPR-8864
note_posted 'HTPR-8835 --body before ticket' 'HTPR-8835 note' activity add --body 'HTPR-8835 note' HTPR-8835
note_posted 'HTPR-8834 --text=' 'HTPR-8834 note' activity add HTPR-8834 --text='HTPR-8834 note'
note_posted 'HTPR-8831 --body=' 'HTPR-8831 note' activity add --body='HTPR-8831 note' HTPR-8831
note_posted 'HTPR-8805 --body after ticket' 'HTPR-8805 note' activity add HTPR-8805 --body 'HTPR-8805 note'
run bash "$vcc" activity add HTPR-8740 --text
[ "$status" = 1 ] || fail "activity add posted a missing --text value"
grep -q 'add needs one non-empty text argument' "$T/err" || fail "missing --text error changed: $(cat "$T/err")"
run bash "$vcc" activity add HTPR-8740 'both notes' --text 'and a flag'
[ "$status" = 1 ] || fail "activity add accepted two notes"
grep -q 'add needs one non-empty text argument' "$T/err" || fail "two-note error changed: $(cat "$T/err")"
run bash "$vcc" activity --help
[ "$status" = 1 ] || fail "activity help should still be a usage error"
grep -q -- '--text' "$T/err" && grep -q -- '--body' "$T/err" || fail "activity usage omitted the documented text options: $(cat "$T/err")"
run bash "$vcc" activity list HTPR-8740 --text 'not a filter'
[ "$status" = 1 ] || fail "activity list accepted a text option"
grep -q 'list needs only a ticket number' "$T/err" || fail "list extra-arg error changed: $(cat "$T/err")"
printf 'ok activity add accepts --text and --body in either order\n'
(
  set -euo pipefail
  home="$T/local-shell"
  mkdir -p "$home/.local/bin" "$home/.config/hypertask-agents/credentials" "$home/.agents/skills/ship/scripts" "$T/decoy"
  printf 'fixture-token\n' > "$home/.config/hypertask-agents/credentials/valentins-claude-code-agent-token"
  cat > "$home/.agents/skills/ship/scripts/ship-identity" <<'STUB'
#!/bin/sh
printf 'Fixture\t%s/.config/hypertask-agents/credentials/valentins-claude-code-agent-token\n' "$HOME"
STUB
  chmod +x "$home/.agents/skills/ship/scripts/ship-identity"
  cat > "$home/.local/bin/hypertask" <<'STUB'
#!/bin/sh
[ "${HT_TOKEN:-}" = fixture-token ] || exit 91
printf 'local %s\n' "$*"
STUB
  chmod +x "$home/.local/bin/hypertask"
  cat > "$T/decoy/hypertask" <<'STUB'
#!/bin/sh
printf 'decoy %s\n' "$*"
exit 9
STUB
  chmod +x "$T/decoy/hypertask"
  out=$(env -u SHIP_SESSION_NAME HOME="$home" PATH="$T/decoy:/usr/bin:/bin" bash "$vcc" projects list)
  [ "$out" = 'local projects list' ]
)
printf 'ok board wrapper finds hypertask in the local command folder\n'
# Only Chief Of Staff and the board lead may make Valentin the blocker (YPER4-1376).
export VCC_TEST_COMMENTS="$T/comments.json" VCC_TEST_TASK="$T/task.json"
rm -f "$HOME/.agents/skills/ship/scripts/ship-check"
printf '#!/usr/bin/env bash\nexit 0\n' > "$HOME/.agents/skills/ship/scripts/ship-check"
chmod +x "$HOME/.agents/skills/ship/scripts/ship-check"
cat > "$T/bin/hypertask" <<'STUB'
#!/usr/bin/env bash
[ "${HT_TOKEN:-}" = fixture-token ] || exit 91
printf 'hypertask %s %s\n' "${1:-}" "${2:-}" >> "$VCC_TEST_TRACE"
case "${1:-} ${2:-}" in
  'section list') printf '{"sections":[{"id":31019,"section_title":"Agent Blocked"},{"id":10412,"section_title":"Valentin Review"}]}\n'; exit 0 ;;
  'comments list') exec /bin/cat "$VCC_TEST_COMMENTS" ;;
  'tasks get') exec /bin/cat "$VCC_TEST_TASK" ;;
esac
printf 'stub:'; printf ' <%s>' "$@"; printf '\n'
STUB
gate_refused() {
  run env VCC_TEST_IDENTITY='Runner 3' bash "$vcc" "$@"
  [ "$status" = 5 ] || fail "runner was not refused (status $status): $*"
  [[ $(< "$T/err") == 'vcc: '*' refused'* ]] || fail "wrong gate refusal: $*: $(cat "$T/err")"
  [[ $(< "$T/err") == *'may not make Valentin the blocker'* ]] || fail "gate reason missing: $*"
  [[ $(< "$VCC_TEST_TRACE") != *waiting-on* && $(< "$VCC_TEST_TRACE") != *' add'* && $(< "$VCC_TEST_TRACE") != *' move'* && $(< "$VCC_TEST_TRACE") != *' update'* && $(< "$VCC_TEST_TRACE") != *' create'* ]] || fail "refused gate reached the write: $*"
}
gate_allowed() {
  run env VCC_TEST_IDENTITY="$1" bash "$vcc" "${@:2}"
  [ "$status" = 0 ] || fail "$1 refused ($status): ${*:2}: $(cat "$T/err")"
  [[ $(< "$VCC_TEST_TRACE") == *"gate who=$1"* ]] || fail "gate not asked for $1: ${*:2}"
}
fixture "$question"
task_fixture '<p>Problem</p><p>Fix</p><p>Done when</p><p>Risk: low.</p><p>Decision: none.</p>'
jq '.tasks[0].boardId = 15' "$VCC_TEST_TASK" > "$T/task15.json"
mv "$T/task15.json" "$VCC_TEST_TASK"
gate_refused comment add X-1 --kind question --text "$question"
gate_refused --project 15 --json comment add X-1 --kind=question --text="$question"
gate_refused tasks waiting-on X-1 --user 6
gate_refused task waiting-on X-1 --user me
gate_refused task move X-1 --section 'Valentin Review'
gate_refused task move X-1 'valentin review'
gate_refused task update X-1 --section='Valentin Review'
gate_refused task create --project 15 --title 'x' --section 'Valentin Review'
for who in 'Chief Of Staff' 'HT Product Lead'; do
  gate_allowed "$who" comment add X-1 --kind question --text "$question"
  gate_allowed "$who" task waiting-on X-1 --user 6
  gate_allowed "$who" task move X-1 --section 'Valentin Review'
  [[ $(< "$VCC_TEST_TRACE") == *'board=15'* ]] || fail 'gate did not look up the ticket board'
done
run env VCC_TEST_IDENTITY='Runner 3' bash "$vcc" task waiting-on X-1 --user none --reason 'not his'
[ "$status" = 0 ] || fail 'a runner clearing the blocker was refused'
run env VCC_TEST_IDENTITY='Runner 3' bash "$vcc" comment add X-1 --text 'agent lane note'
[ "$status" = 0 ] || fail 'a plain note was refused'
run env VCC_TEST_IDENTITY='Runner 3' bash "$vcc" task move X-1 --section 'In Progress'
[ "$status" = 0 ] || fail 'a normal move was refused'
run env VCC_TEST_IDENTITY='Runner 3' bash "$vcc" task waiting-on X-1 --user 123
[ "$status" = 0 ] || fail 'handing a ticket to another person was refused'
# A section id is looked up by name first.
gate_refused task update X-1 --section 10412
run env VCC_TEST_IDENTITY='Runner 3' bash "$vcc" task update X-1 --section 31019
[ "$status" = 0 ] || fail 'a move by section id to another column was refused'
gate_allowed 'Chief Of Staff' task update X-1 --section 10412
printf 'ok only Chief Of Staff and the board lead make Valentin the blocker\n'
printf 'vcc helper guard tests passed\n' 
