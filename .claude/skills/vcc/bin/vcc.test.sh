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
printf 'Fixture\t%s\n' "$HOME/.config/hypertask-agents/credentials/valentins-claude-code-agent-token"
STUB
chmod +x "$T/bin/"* "$HOME/.agents/skills/ship/scripts/ship-identity"
printf '%s\n' 'vcc: helpers never write to the board; report to your runner' > "$T/refusal"
cat > "$HOME/.agents/skills/ship/scripts/ship-check" <<'STUB'
#!/usr/bin/env bash
exit 0
STUB
chmod +x "$HOME/.agents/skills/ship/scripts/ship-check"


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

for option in --help -h --h --help=true -h=true --version -V --V --version=true -V=true; do
  allowed bash "$vcc" task waiting-on X-1 --user none "$option"
  [[ $(< "$T/out") == "stub: <task> <waiting-on> <X-1> <--user> <none> <$option>" ]] || fail 'help changed waiting-on arguments'
  [[ $(< "$VCC_TEST_TRACE") != *'hypertask tasks get'* ]] || fail 'help read the blocked ticket'
  allowed bash "$vcc" comment add X-1 --text hi "$option"
  [[ $(< "$T/out") == "stub: <comment> <add> <X-1> <--text> <hi> <$option>" ]] || fail 'help routed a comment to activity'
  allowed bash "$vcc" "$option" task waiting-on X-1 --user none
  allowed bash "$vcc" activity add X-1 hi "$option"
  allowed bash "$vcc" task move X-1 --section Done "$option"
done
for option in -h -V; do
  allowed bash "$vcc" comment add X-1 --kind qa --text 'Outputs: private' "$option"
  [[ $(< "$T/out") == "stub: <comment> <add> <X-1> <--kind> <qa> <--text> <Outputs: private> <$option>" ]] || fail 'help changed refused content arguments'
  refused env VCC_HELPER=1 bash "$vcc" comment add X-1 --kind qa --text 'Outputs: private' "$option"
  allowed bash "$vcc" task update X-1 --description 'Outputs: private' "$option"
  [[ $(< "$T/out") == "stub: <task> <update> <X-1> <--description> <Outputs: private> <$option>" ]] || fail 'help changed refused description arguments'
  refused env VCC_HELPER=1 bash "$vcc" task update X-1 --description 'Outputs: private' "$option"
done
for value in --help -h --version -V; do
  allowed bash "$vcc" comment add X-1 --kind qa --text "$value"
  [[ $(< "$T/out") == "stub: <comment> <add> <X-1> <--kind> <qa> <--text> <$value>" ]] || fail 'option values changed'
done
for option in --help=false --h= --version=no --V=0 -h=false -V=no; do
  refused env VCC_HELPER=1 bash "$vcc" comment add X-1 --text hi "$option"
  run bash "$vcc" comment add X-1 --kind qa --text 'Outputs: private' "$option"
  [ "$status" = 5 ] || fail "invalid help bypassed content guard: $option"
  [[ $(< "$VCC_TEST_TRACE") != *hypertask* ]] || fail 'invalid help reached CLI'
done
printf 'ok help and version bypass mutation dispatch\n'

cp "$T/bin/curl" "$T/curl-original"
cat > "$T/bin/curl" <<'STUB'
#!/usr/bin/env bash
method='' output='' data=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --request) method=$2; shift ;;
    --output) output=$2; shift ;;
    --data) data=$2; shift ;;
  esac
  shift
done
if [ "$method" = GET ]; then
  printf '%s' '{"success":true,"run":{"status":"active"}}' > "$output"
else
  printf '%s' "$data" > "$VCC_TEST_ACTIVITY"
  printf '%s' '{"success":true,"activity":{"id":"fixture-activity"}}' > "$output"
fi
printf 200
STUB
export VCC_TEST_ACTIVITY="$T/activity"
mkdir -p "$HOME/.local/state/vcc-runs/fixture"
printf 'fixture-run\n' > "$HOME/.local/state/vcc-runs/fixture/X-1"
for value in --help -h --version -V; do
  refused env VCC_HELPER=1 bash "$vcc" activity add X-1 "$value"
  run bash "$vcc" activity add X-1 "$value"
  [ "$status" = 0 ] || fail "activity text failed: $value"
  [ "$(< "$T/out")" = fixture-activity ] || fail "activity did not dispatch: $value"
  [ "$(jq -r '.text' "$VCC_TEST_ACTIVITY")" = "$value" ] || fail "activity text changed: $value"
  allowed bash "$vcc" activity add X-1 "$value" --help
  [[ $(< "$T/out") == "stub: <activity> <add> <X-1> <$value> <--help>" ]] || fail 'trailing help changed activity arguments'
  refused env VCC_HELPER=1 bash "$vcc" activity add X-1 "$value" --help
done
mv "$T/curl-original" "$T/bin/curl"
printf 'ok help-like activity text stays literal\n'

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
for args in "activity" "activity list X-1"; do
  run bash "$vcc" $args
  [ "$status" = 1 ] || fail "expected exit 1, got $status: vcc $args"
  [[ $(< "$T/err") == "vcc activity: "* ]] || fail "missing vcc activity error: vcc $args"
  [[ $(< "$VCC_TEST_TRACE") != *hypertask* ]] || fail "fell through to CLI: vcc $args"
done
allowed bash "$vcc" tasks get X-1
printf 'ok unknown activity subcommands fail in vcc\n'
question='<p><span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span> Question: <strong>Remove the board tab row from My Tasks?</strong></p><p>My recommendation: yes.</p><p>Why: two rows of tabs confuse you.</p><p>Yes: a runner builds it behind a flag.</p><p>No: both rows stay.</p>'
export VCC_TEST_COMMENTS="$T/comments.json"
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
fixture '<p>Question: <strong>Keep it?</strong></p><p>My recommendation: yes.</p><p>Why: less work.</p><p>Yes: keep it.</p><p>No: remove it.</p>'
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
  '<p>Question: <strong>Keep it?</strong></p><p>My recommendation: yes.</p><p>Why: less work.</p>' \
  '<p>Question: <strong>Keep it?</strong></p><p>Yes: keep it.</p>' \
  '<p>Question: <strong>Keep it?</strong></p><p>No: remove it.</p>' \
  '<p>Question: Keep it?</p><p>Yes: keep it.</p><p>No: remove it.</p>' \
  '<p>Question: <strong>Keep it.</strong></p><p>Yes: keep it.</p><p>No: remove it.</p>' \
  '<p>Status: Question: <strong>Keep it?</strong></p><p>Yes: keep it.</p><p>No: remove it.</p>' \
  '<p>Question: note. Question: <strong>Keep it?</strong></p><p>Yes: keep it.</p><p>No: remove it.</p>'; do
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
plain='<p>Question: <strong>Keep it?</strong></p><p>My recommendation: yes.</p><p>Why: less work.</p><p>Yes: keep it.</p><p>No: remove it.</p>'
inline_why='<p>Question: <strong>Keep it?</strong></p><p>My recommendation: yes. Why: less work.</p><p>Yes: keep it.</p><p>No: remove it.</p>'
multiline_question=$'<p>Question: <strong>\nKeep it?\n</strong></p>\n<p>My recommendation: yes.</p>\n<p>Why: less work.</p>\n<p>Yes: keep it.</p>\n<p>No: remove it.</p>'
multiline_mention=${question/Question:/Question:$'\n'}
hardbreak_question=${plain/Keep it?/Keep<br>it?}
listed_question="<ul><li>$question</li></ul>"
quoted_question="<blockquote>$question</blockquote>"
quoted_context="<blockquote>Context.</blockquote>$plain"
for text in "$plain" "$inline_why" "$question" "$multiline_question" "$multiline_mention" "$hardbreak_question" "$listed_question" "$quoted_question" "$quoted_context"; do
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

for text in \
  "<p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>$plain" \
  "<ul><li>One.</li><li>Two.</li><li>Three.</li><li>Four.</li></ul>$plain" \
  "<p>One.<br>Two.<br/>Three.<br />Four.</p>$plain"; do
  question_refused '3 lines' comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused '3 lines' task move X-1 --section 'Valentin Review'
done
for text in \
  "<p>One.</p><p>Two.</p><p>Three.</p>$plain" \
  "<ul><li>One.</li><li>Two.</li><li>Three.</li></ul>$plain"; do
  allowed bash "$vcc" comment add X-1 --kind question --text "$text"
done
for count in 1 2 3 4; do
  bullets='<ul>'
  for ((i=0; i<count; i++)); do bullets+='<li><p>Context.</p></li>'; done
  bullets+='</ul>'
  text="$bullets$question"
  if [ "$count" -le 3 ]; then
    allowed bash "$vcc" comment add X-1 --kind question --text "$text"
    fixture "$text"
    allowed bash "$vcc" task move X-1 --section 'Valentin Review'
  else
    question_refused '3 lines' comment add X-1 --kind question --text "$text"
    fixture "$text"
    review_refused '3 lines' task move X-1 --section 'Valentin Review'
  fi
done
printf 'ok bullet-prefaced mentioned Questions through dispatch and review\n'
late='<p>Question: <strong>Keep it?</strong></p><p>Why: less work.</p><p>My recommendation: yes.</p><p>Yes: keep it.</p><p>No: remove it.</p>'
question_refused 'right under' comment add X-1 --kind question --text "$late"
fixture "$late"
review_refused 'right under' task move X-1 --section 'Valentin Review'
for text in \
  "<p>Question: Earlier?</p><p>My recommendation: yes.</p><p>One.</p><p>Two.</p>$plain" \
  "<p>Question: Earlier?</p><p>My recommendation: yes.</p>$late"; do
  question_refused 'only one Question:' comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused 'only one Question:' task move X-1 --section 'Valentin Review'
done
question_refused '3 lines' comment add X-1 --kind question --text "<p>Question: Earlier?</p><p>My recommendation: yes.</p><p>One.</p><p>Two.</p>$plain"
question_refused 'right under' comment add X-1 --kind question --text "<p>Question: Earlier?</p><p>My recommendation: yes.</p>$late"
for link in \
  '<a href="https://linear.app/docs">Linear</a>' \
  'https://notion.so/help' \
  'www.google.com' \
  '<a href="//example.test/help">Help</a>'; do
  question_refused 'links' comment add X-1 --kind question --text "$plain<p>$link</p>"
  fixture "$plain<p>$link</p>"
  review_refused 'links' task move X-1 --section 'Valentin Review'
done
question_refused '3 lines' comment add X-1 --kind question --markdown --text "One.
Two.
Three.
Four.
Question: **Keep it?**
My recommendation: yes.
Why: less work.
Yes: keep it.
No: remove it."
mention='<span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span> '
for text in \
  "${late/Question:/$mention Question:}" \
  "<p>One.</p><p>Two.</p><p>Three.</p><p>Four.</p>$question"; do
  question_refused '' comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused '' task move X-1 --section 'Valentin Review'
done
old_question_7980_325102=$(cat <<'FIXTURE'
<p><strong>Billing release still needs separate approval.</strong></p><p>Terms approved; release approval remains excluded.</p><p>Linear: explains billing adjustments. <a href="https://linear.app/docs/billing-and-plans">https://linear.app/docs/billing-and-plans</a></p><p>Notion: explains plan-change charges. <a href="https://www.notion.com/help/upgrade-or-downgrade-your-plan">https://www.notion.com/help/upgrade-or-downgrade-your-plan</a></p><p>Jira: publishes purchase rules. <a href="https://www.atlassian.com/licensing/purchase-licensing">https://www.atlassian.com/licensing/purchase-licensing</a></p><p>Google: explains billing commitments. <a href="https://support.google.com/a/answer/1247360">https://support.google.com/a/answer/1247360</a></p><p>Our approved terms remain unchanged.</p><p>Release audience: owner and designated tester only.</p><p>Everyone else keeps existing billing.</p><p>Required browser checks previously failed.</p><p>Checks must pass before merging and deployment.</p><p>Live verification follows deployment.</p><p>My recommendation: Approve this limited release.</p><p>Why: Validate billing without exposing everyone.</p><p>Yes: Authorize release after required checks pass.</p><p>No: Keep billing release held.</p><p><a href="https://github.com/hypertask-ai/hypertask/pull/2275">https://github.com/hypertask-ai/hypertask/pull/2275</a></p><p>Question: <strong>Authorize billing release after required checks pass?</strong></p><p>For <span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span></p>
FIXTURE
)
question_refused 'links' comment add X-1 --kind question --text "$old_question_7980_325102"
fixture "$old_question_7980_325102"
review_refused 'links' task move X-1 --section 'Valentin Review'
printf 'ok short question format enforced through comment dispatch and review moves\n'

for word in 'src/app/page.tsx' '/api/' '/api/boards' 'page.ts' 'page.tsx' 'page.js' 'NOTES.md' endpoint ROUTE bearer OAuth prefilter regex schema migration CodeQL 'token audience' CI 'PR #123' PR123 '#123'; do
  text="$plain<p>$word</p>"
  question_refused "$word" comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused "$word" task move X-1 --section 'Valentin Review'
done
question_refused CI comment add X-1 --kind question --text "$plain<p>CI and OAuth</p>"
[[ $(< "$T/err") == *OAuth* ]] || fail 'did not name every developer word'
allowed bash "$vcc" comment add X-1 --kind question --text "$plain<p>We can decide in Circle, with ci and circles.</p>"
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
markdown='Question: **Keep it?**

My recommendation: yes. Why: less work.

Yes: keep it.

No: remove it.'
allowed bash "$vcc" comment add X-1 --kind question --markdown --text "$markdown"
[[ $(< "$T/out") == "stub: <comment> <add> <X-1> <--kind> <question> <--markdown> <--text> <$markdown>" ]] || fail 'Markdown arguments changed'
printf '%s\n' "$markdown" > "$T/question.md"
allowed bash "$vcc" comments add X-1 --kind=question --markdown "--file=$T/question.md"
question_refused 'My recommendation:' comment add X-1 --kind question --markdown --body "${markdown/My recommendation:/Suggestion:}"
question_refused 'Question:' comment add X-1 --kind question --markdown --text "${markdown/Keep it?/Keep it.}"
markdown_context=$'Question: Earlier?\nMy recommendation: yes.\nOne.\nTwo.\n'"$markdown"
markdown_detached=$'Question: Earlier?\nMy recommendation: yes.\nQuestion: **Keep it?**\nWhy: less work.\nMy recommendation: yes.\nYes: keep it.\nNo: remove it.'
for text in "$markdown_context" "$markdown_detached"; do
  question_refused 'only one Question:' comment add X-1 --kind question --markdown --text "$text"
done
question_refused '3 lines' comment add X-1 --kind question --markdown --text "$markdown_context"
question_refused 'right under' comment add X-1 --kind question --markdown --text "$markdown_detached"
question_refused OAuth comment add X-1 --kind question --markdown --text "$markdown
OAuth"
question_refused 'links' comment add X-1 --kind question --markdown --text "$markdown
[Details](https://example.test/help)"
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
for option in --help --h --help=true --h=true --version --V --version=true --V=true -h -V; do
  agent_detail_refused comment add X-1 --kind qa --text 'Outputs: private' -- "$option"
  agent_detail_refused task update X-1 --description 'Outputs: private' -- "$option"
done
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
<p><strong>Plain version: this ticket makes sure an AI agent only sees the boards it was given, not every board its owner can see.</strong></p>
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
printf 'vcc helper guard tests passed\n'
