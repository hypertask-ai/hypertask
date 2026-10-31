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
if [ "${VCC_TEST_ACTIVITY:-}" = 1 ] && [ "${1:-} ${2:-}" = 'tasks get' ]; then
  printf '{"tasks":[{"id":7}]}\n'; exit 0
fi
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
if [ "${VCC_TEST_ACTIVITY:-}" != 1 ]; then printf 'unexpected network request\n' >&2; exit 92; fi
/bin/cat > /dev/null
method='' out='' data='' url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --request) method=$2; shift ;;
    --output) out=$2; shift ;;
    --data) data=$2; shift ;;
    --header|--config|--connect-timeout|--max-time|--write-out) shift ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
path=${url#https://app.hypertask.ai/api/mcp/}
printf 'curl %s %s\n' "$method" "$path" >> "$VCC_TEST_TRACE"
case "$path" in
  agents/runs) printf '{"success":true,"run":{"id":"run-1"}}' > "$out" ;;
  agents/runs/run-1/activities) printf '%s' "$data" > "$(dirname "$VCC_TEST_TRACE")/activity.json"; printf '{"success":true,"activity":{"id":"act-1"}}' > "$out" ;;
  agents/runs/run-1) printf '{"success":true,"run":{"status":"active"}}' > "$out" ;;
  *) exit 92 ;;
esac
printf 200
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

allowed env HAX_PROVIDER=codex HAX_MODEL=gpt-6.1-sol HAX_EFFORT=high bash "$vcc" comment add X-1 --kind qa --text hi
[[ $(< "$T/out") == 'stub: <comment> <add> <X-1> <--kind> <qa> <--text> <hi>' ]] || fail 'write arguments changed'
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
allowed launch_hax 'prompt containing -p' comment add X-1 --kind qa --text hi
allowed launch_hax interactive comment add X-1 --kind qa --text hi
printf 'ok hax without an exact prompt argument remains a runner\n'

# Unknown activity subcommands stop in vcc with its usage, never reach the CLI.
for args in "activity" "activity --help" "activity list X-1"; do
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
voice_refused() {
  local reason=$1; shift
  run "$@"
  [ "$status" = 5 ] || fail "expected voice exit 5, got $status: $*: $(cat "$T/err")"
  [ ! -s "$T/out" ] || fail 'voice refusal produced stdout'
  [[ $(< "$T/err") == 'vcc: Human lane refused'* ]] || fail "wrong voice refusal: $(cat "$T/err")"
  [[ $(< "$T/err") == *"$reason"* ]] || fail "missing voice reason $reason: $(cat "$T/err")"
  [[ $(< "$T/err") == *'vcc activity add'* ]] || fail 'voice refusal must point at the agent lane'
  [[ $(< "$VCC_TEST_TRACE") != *hypertask* ]] || fail 'refused text reached CLI'
}
plain='<p>Question: <strong>Keep it?</strong></p><p>Yes: keep it.</p><p>No: remove it.</p><p>My recommendation: yes.</p><p>Why: less work.</p>'
inline_why='<p>Question: <strong>Keep it?</strong></p><p>Yes: keep it.</p><p>No: remove it.</p><p>My recommendation: yes. Why: less work.</p>'
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

for word in 'src/app/page.tsx' '/api/' '/api/boards' 'page.ts' 'page.tsx' 'page.js' 'NOTES.md' endpoint ROUTE bearer OAuth prefilter regex schema migration CodeQL 'token audience' CI 'PR #123' PR123 '#123'; do
  text="$plain<p>$word</p>"
  question_refused "$word" comment add X-1 --kind question --text "$text"
  fixture "$text"
  review_refused "$word" task move X-1 --section 'Valentin Review'
done
question_refused CI comment add X-1 --kind question --text "$plain<p>CI and OAuth</p>"
[[ $(< "$T/err") == *OAuth* ]] || fail 'did not name every developer word'
for text in   "$plain<p>Decide in Circle, with ci and circles.</p>"   "$plain<p><a href="https://example.test/src/app/page.tsx/api/OAuth/CI#123">Details</a></p>"   "$plain<p><a href="https://example.test/123">PR #123</a></p>"   "$plain<p><a href="https://example.test/123"><strong>#123</strong></a></p>"; do
  allowed bash "$vcc" comment add X-1 --kind question --text "$text"
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
markdown='Question: **Keep it?**

Yes: keep it.
No: remove it.
My recommendation: yes. Why: less work.'
allowed bash "$vcc" comment add X-1 --kind question --markdown --text "$markdown"
[[ $(< "$T/out") == "stub: <comment> <add> <X-1> <--kind> <question> <--markdown> <--text> <$markdown>" ]] || fail 'Markdown arguments changed'
printf '%s\n' "$markdown" > "$T/question.md"
allowed bash "$vcc" comments add X-1 --kind=question --markdown "--file=$T/question.md"
question_refused 'My recommendation:' comment add X-1 --kind question --markdown --body "${markdown/My recommendation:/Suggestion:}"
question_refused 'Question:' comment add X-1 --kind question --markdown --text "${markdown/Keep it?/Keep it.}"
question_refused OAuth comment add X-1 --kind question --markdown --text "$markdown
OAuth"
allowed bash "$vcc" comment add X-1 --kind question --markdown --text "$markdown
[PR #123](https://example.test/api/OAuth/CI)"
printf 'ok singular/plural, text/body/file, equals options, and Markdown forms\n'


agent_detail_refused() {
  run bash "$vcc" "$@"
  [ "$status" = 5 ] || fail "agent detail not refused: $*: $status"
  [ ! -s "$T/out" ] || fail 'agent detail refusal produced stdout'
  [[ $(< "$T/err") == 'vcc: agent detail belongs in vcc activity add' ]] || fail "wrong agent detail refusal: $*"
  [[ $(< "$VCC_TEST_TRACE") != *hypertask* && $(< "$VCC_TEST_TRACE") != *'identity lookup'* ]] || fail 'agent detail reached identity or board'
}
people_file_refused() {
  run bash "$vcc" "$@"
  [ "$status" = 5 ] || fail "people file not refused: $*: $status"
  [ ! -s "$T/out" ] || fail 'people file refusal produced stdout'
  [[ $(< "$T/err") == 'vcc: cannot read people content file' ]] || fail "wrong people file refusal: $*"
  [[ $(< "$VCC_TEST_TRACE") != *hypertask* && $(< "$VCC_TEST_TRACE") != *'identity lookup'* ]] || fail 'people file reached identity or board'
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
voice_refused 'over 8 words' bash "$vcc" comment add X-1 --kind question --text "$rewrite_7508_303933"
fixture "$rewrite_7508_303933"
allowed bash "$vcc" task move X-1 --section 'Valentin Review'
printf 'ok verbatim old Question refuses; long rewrite refuses on add and passes newest review\n'

long='<p>This change makes the board load much faster for every single user.</p>'
for kind in qa done; do
  voice_refused 'over 8 words' bash "$vcc" comment add X-1 --kind "$kind" --text "$long"
done
voice_refused 'over 8 words' bash "$vcc" comment add X-1 --kind question --text "${plain/Why: less work./Why: this makes the board load much faster for every user.}"
voice_refused 'over 8 words' bash "$vcc" comments add X-1 --text "<p><span data-type=\"mention\" data-id=\"Valentin Yeo\">Valentin Yeo</span> This change makes the board load much faster for every user.</p>"
voice_refused 'over 8 words' bash "$vcc" comment add X-1 --markdown --text '@Valentin Yeo this change makes the board load much faster for everyone.'
for mention in '--mentions 6' '--mentions=6' 'html' 'digit'; do
  case "$mention" in
    '--mentions 6') args=(--mentions 6 --text 'Done.') ;;
    '--mentions=6') args=(--mentions=6 --text 'Done.') ;;
    html) args=(--text '<span data-type = "mention">Valentin</span> Done.') ;;
    digit) args=(--text '@6 Done.') ;;
  esac
  allowed bash "$vcc" comment add X-1 "${args[@]}"
  case "$mention" in
    '--mentions 6') args=(--mentions 6 --text "$long") ;;
    '--mentions=6') args=(--mentions=6 --text "$long") ;;
    html) args=(--text "<span data-type = \"mention\">Valentin</span> $long") ;;
    digit) args=(--text "@6 $long") ;;
  esac
  voice_refused 'over 8 words' bash "$vcc" comment add X-1 "${args[@]}"
done
voice_refused 'over 8 words' bash "$vcc" comment add X-1 --reply-to-comment-id 9 --text "$long"
voice_refused 'over 8 words' bash "$vcc" comment add X-1 --attach shot.png --text "$long"
voice_refused 'over 8 words' bash "$vcc" --json comment add X-1 --kind=done "--text=$long"
for word in 'src/app/page.tsx' '/api/boards' 'OAuth' 'CI' 'PR #123' 'use_board_tabs' 'boardTabs' 'render()' 'config.json'; do
  voice_refused "$word" bash "$vcc" comment add X-1 --kind qa --text "<p>Fixed. See $word now.</p>"
done
agent_detail_refused comment add X-1 --kind qa --text '<p>Fixed. See ~/projects/app/x now.</p>'
voice_refused 'code formatting' bash "$vcc" comment add X-1 --kind done --text '<p>Fixed <code>it</code>.</p>'
printf '%s\n' "$long" > "$T/long.html"
voice_refused 'over 8 words' bash "$vcc" comment add X-1 --kind qa --file "$T/long.html"
people_file_refused comment add X-1 --kind=qa --file "$T/missing.html"
printf 'ok qa, done, question, mention, reply and attach comments refuse long sentences and code words\n'

ok_done='<p>Done: board loads fast now.</p><p>Live: yes, for everyone. Proof: <a href="https://app.hypertask.ai/project-15/7852">YPER4-7852 screenshot of the board loading fast today</a>.</p><ul><li>Tested on phone and laptop.</li></ul>'
allowed bash "$vcc" comment add X-1 --kind done --text "$ok_done"
[[ $(< "$T/out") == "stub: <comment> <add> <X-1> <--kind> <done> <--text> <$ok_done>" ]] || fail 'human lane arguments changed'
allowed bash "$vcc" comment add X-1 --kind qa --markdown --text 'QA: passed on phone. See [the long proof link label here today](https://example.test/a/b/c.tsx) and YPER4-12 too.'
allowed bash "$vcc" comment add X-1 --kind qa --text '<p>Works on iPhone and macOS. Decide in Circle, with ci.</p>'
allowed bash "$vcc" task create --project 15 --title 'Chat lost after reload' --description '<p>Valentin asked: &quot;still ignored on every ticket at the moment pls enforce this&quot;.</p>'
allowed bash "$vcc" comment add X-1 --kind qa --markdown --text 'He said “description pospeak comments pospeak agent lane do what you want”. Done.'
printf 'ok short pospeak comments pass; links and ticket refs do not count as words, nor do quotes\n'

voice_refused 'over 8 words' bash "$vcc" task create --project 15 --title 'Make the board load much faster for every single user today' --description '<p>Short.</p>'
voice_refused 'use_board_tabs' bash "$vcc" task create --project 15 --title 'Fix use_board_tabs'
voice_refused 'over 8 words' bash "$vcc" task create --project 15 --title 'Board loads slowly' --description "$long"
voice_refused 'over 8 words' bash "$vcc" tasks update X-1 "--description=$long"
voice_refused 'over 8 words' bash "$vcc" task update X-1 --title 'Board loads slowly' --description-file "$T/long.html"
people_file_refused task create --project 15 --title 'Board loads slowly' --description-file "$T/missing.html"
voice_refused 'src/app/page.tsx' bash "$vcc" --json task create --project 15 --title 'Board loads slowly' --markdown --description 'Problem: slow in src/app/page.tsx.'
desc='<p>Problem: board loads slowly.</p><p>Fix: load less at start.</p><p>Done when: board opens in one second.</p><p>Risk: low.</p><p>Decision: none.</p>'
allowed bash "$vcc" task create --project 15 --title 'Board loads slowly on phone' --description "$desc"
printf '%s\n' "$desc" > "$T/desc.html"
allowed bash "$vcc" task update X-1 --description-file "$T/desc.html"
allowed bash "$vcc" task update X-1 --priority high --labels 'src/app/page.tsx'
printf 'ok task titles and descriptions follow the human-lane rule\n'

mkdir -p "$HOME/.local/state"
allowed env VCC_VOICE_BYPASS='error report evidence' SHIP_SESSION_NAME='Error Collector' bash "$vcc" task create --project 15 --title 'api: TypeError in src/app/page.tsx loadBoard() failed again' --description "$long"
grep -q $'\tError Collector\ttitle\terror report evidence$' "$HOME/.local/state/vcc/voice-bypass.log" || fail 'bypass not logged'
[ "$(wc -l < "$HOME/.local/state/vcc/voice-bypass.log")" = 1 ] || fail 'bypass logged more than once per call'
printf 'ok VCC_VOICE_BYPASS skips the lint and is logged once\n'

rerouted() {
  local expected=$1; shift
  VCC_TEST_ACTIVITY=1 run "$@"
  [ "$status" = 0 ] || fail "reroute failed $status: $*: $(cat "$T/err" "$VCC_TEST_TRACE")"
  if [[ " $* " == *" --json "* ]]; then
    [ "$(jq -er .activity.id "$T/out")" = act-1 ] || fail 'JSON receipt missing activity id'
  else
    [ "$(< "$T/out")" = act-1 ] || fail "reroute did not print the activity id: $(cat "$T/out")"
  fi
  [[ $(< "$T/err") == 'vcc: no --kind, @mention or reply target: sent to the agent lane (vcc activity add X-1)'* ]] || fail "missing reroute notice: $(cat "$T/err")"
  [[ $(< "$VCC_TEST_TRACE") != *'hypertask comment'* ]] || fail 'untyped comment reached the visible thread'
  grep -qF "curl POST agents/runs/run-1/activities" "$VCC_TEST_TRACE" || fail 'no activity write'
  [ "$(jq -r .text "$T/activity.json")" = "$expected" ] || fail "activity text changed: $(cat "$T/activity.json")"
}
for detail in 'tmux attach -t runner-8' 'claude --resume session' 'codex resume session' 'hax --resume=session' \
  'Helpers: none' 'Branch/PR: none' 'Outputs: evidence' 'Gates: 3 met' 'GATES.md' '.unlazy/session' '/home/valentin/file' '~/notes'; do
  rerouted "$detail" bash "$vcc" comment add X-1 --text "$detail"
done
rm -rf "$HOME/.local/state/vcc-runs"
for option in --dry-run --improve --improve=polish --project=15; do
  run env VCC_TEST_ACTIVITY=1 bash "$vcc" comment add X-1 --text hi "$option"
  [ "$status" = 2 ] || fail "unsupported reroute option accepted: $option"
  [ ! -s "$VCC_TEST_TRACE" ] || fail "unsupported reroute option accessed CLI or network: $option"
  [ ! -s "$T/out" ] || fail "unsupported reroute option produced output: $option"
done
for placement in before-command before-ticket; do
  if [ "$placement" = before-command ]; then
    args=(--dry-run comment add X-1 --text hi)
  else
    args=(comment add --dry-run X-1 --text hi)
  fi
  run env VCC_TEST_ACTIVITY=1 bash "$vcc" "${args[@]}"
  [ "$status" = 2 ] || fail "unsupported reroute option accepted: $placement"
  [ ! -s "$VCC_TEST_TRACE" ] || fail "unsupported reroute option accessed CLI or network: $placement"
  [ ! -s "$T/out" ] || fail "unsupported reroute option produced output: $placement"
done
allowed bash "$vcc" comment add X-1 --kind qa --text hi --dry-run --improve
[[ $(< "$T/out") == 'stub: <comment> <add> <X-1> <--kind> <qa> <--text> <hi> <--dry-run> <--improve>' ]] || fail 'human options changed'
rerouted 'hi' bash "$vcc" comment add X-1 --text hi
rerouted 'src/app/page.tsx /api/ CI OAuth PR #123' bash "$vcc" comments add X-1 --text 'src/app/page.tsx /api/ CI OAuth PR #123'
rerouted $'Claimed. Session working it now.\nNext: resume abc & co' bash "$vcc" --json comment add X-1 --text '<p><strong>Claimed.</strong> Session working it now.</p><p>Next: resume abc &amp; co</p>'
printf '%s\n' '**Status** long agent note about src/x.ts' > "$T/note.md"
rerouted '**Status** long agent note about src/x.ts' bash "$vcc" comment add X-1 --markdown "--file=$T/note.md"
rerouted 'hi' launch_hax interactive comment add X-1 --text hi
allowed bash "$vcc" comment add 75994 --project 15 --text hi
rerouted 'See PR 12 (https://github.com/o/r/pull/12) now.' bash "$vcc" comment add X-1 --text '<p>See <a href="https://github.com/o/r/pull/12">PR 12</a> now.</p>'
allowed bash "$vcc" comment add X-1 --text hi --help
[[ $(< "$T/out") == "stub: <comment> <add> <X-1> <--text> <hi> <--help>" ]] || fail 'help must reach the CLI, never an agent-lane write'
allowed bash "$vcc" task create --project 15 --title 'Make the board load much faster for every single user today' -h
printf 'ok untyped agent comments are rerouted to vcc activity add\n'
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
