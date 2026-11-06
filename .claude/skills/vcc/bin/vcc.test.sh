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
printf 'Fixture\t%s\n' "$HOME/.config/hypertask-agents/credentials/valentins-claude-code-agent-token"
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

for args in 'activity --help' 'activity add --help' 'activity add X-1 --help' 'activity list X-1 --help'; do
  run bash "$vcc" $args
  [ "$status" = 0 ] || fail "help failed: vcc $args"
  [[ $(< "$T/out") == 'usage: vcc activity '* ]] || fail "missing activity help: vcc $args"
  [ ! -s "$VCC_TEST_TRACE" ] || fail "help accessed credentials or board: vcc $args"
done
for args in 'activity' 'activity unknown X-1' 'activity add X-1 --text note' 'activity add X-1 --typo' 'activity list X-1 --bad'; do
  run bash "$vcc" $args
  [ "$status" = 1 ] || fail "expected exit 1, got $status: vcc $args"
  [[ $(< "$T/err") == 'usage: vcc activity '* ]] || fail "missing activity usage: vcc $args"
  [ ! -s "$VCC_TEST_TRACE" ] || fail "invalid syntax accessed credentials or board: vcc $args"
done
allowed bash "$vcc" tasks get X-1
printf 'ok activity help and invalid options never access credentials or board\n'
question='<p><span data-type="mention" class="mention" data-id="Valentin Yeo" data-label="name-6">Valentin Yeo</span> Question: <strong>Remove the board tab row from My Tasks?</strong></p><p>My recommendation: yes.</p><p>Why: two rows of tabs confuse you.</p><p>Yes: a runner builds it behind a flag.</p><p>No: both rows stay.</p>'
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
for text in   "$plain<p>We can decide in Circle, with ci and circles.</p>"   "$plain<p><a href="https://example.test/src/app/page.tsx/api/OAuth/CI#123">Details</a></p>"   "$plain<p><a href="https://example.test/123">PR #123</a></p>"   "$plain<p><a href="https://example.test/123"><strong>#123</strong></a></p>"; do
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
mkdir -p "$HOME/.local/bin"
ln -s "$T/bin/hypertask" "$HOME/.local/bin/hypertask"
allowed env PATH=/usr/bin:/bin bash "$vcc" --version
printf 'ok installed CLI recovered when launcher omits local bin from PATH\n'

export VCC_TEST_TASK="$T/task.json"
cat > "$T/bin/hypertask" <<'STUB'
#!/usr/bin/env bash
[ "${HT_TOKEN:-}" = fixture-token ] || exit 91
printf 'hypertask %s %s\n' "${1:-}" "${2:-}" >> "$VCC_TEST_TRACE"
[ "$1 $2" = 'tasks get' ] || exit 92
exec /bin/cat "$VCC_TEST_TASK"
STUB
cat > "$T/bin/curl" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
method='' output='' data='' url=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --request) method=$2; shift ;;
    --output) output=$2; shift ;;
    --data) data=$2; shift ;;
    https://*) url=$1 ;;
  esac
  shift
done
printf '%s %s %s\n' "$method" "$url" "$data" >> "$VCC_TEST_TRACE"
case "$url" in
  */agent-activity\?*)
    printf '%s' "${VCC_TEST_ACTIVITY_RESPONSE:-}" > "$output" ;;
  */agents/runs)
    [ "$method" = POST ] && [ "$data" = '{"taskId":42,"source":"runtime"}' ] || exit 93
    printf '%s' '{"success":true,"run":{"id":"fixture-run"}}' > "$output" ;;
  */agents/runs/fixture-run/activities)
    [ "$method" = POST ] && [ "$data" = '{"type":"thought","text":"Fixture note"}' ] || exit 94
    printf '%s' '{"success":true,"activity":{"id":"fixture-note"}}' > "$output" ;;
  *) exit 95 ;;
esac
printf '%s' "${VCC_TEST_ACTIVITY_CODE:-200}"
STUB
chmod +x "$T/bin/curl"
export VCC_TEST_ACTIVITY_RESPONSE='{"success":true,"activities":[{"createdAt":"2026-11-02T12:00:00Z","agentName":"Fixture Agent","text":"Full note\nNext step","id":"note-1"}]}'
run bash "$vcc" activity last X-1
[ "$status" = 0 ] || fail "last failed: $(cat "$T/err")"
[ "$(< "$T/out")" = $'2026-11-02T12:00:00Z\tFixture Agent\tFull note\\nNext step' ] || fail 'last dropped or changed note text'
[[ $(< "$VCC_TEST_TRACE") == *'GET https://app.hypertask.ai/api/mcp/tasks/X-1/agent-activity?limit=1'* ]] || fail 'last did not read the ticket route'
[[ $(< "$VCC_TEST_TRACE") != *POST* ]] || fail 'last wrote to the board'

for suffix in '' '--json'; do
  run bash "$vcc" activity list X-1 $suffix
  [ "$status" = 0 ] || fail "list failed: $(cat "$T/err")"
  jq -e '.activities[0].text == "Full note\nNext step" and .activities[0].id == "note-1"' "$T/out" >/dev/null || fail 'list lost note content or metadata'
  [[ $(< "$VCC_TEST_TRACE") == *'agent-activity?limit=100'* ]] || fail 'list did not request history'
  [[ $(< "$VCC_TEST_TRACE") != *POST* ]] || fail 'list wrote to the board'
done
run env VCC_HELPER=1 bash "$vcc" activity list X-1 --json
[ "$status" = 0 ] || fail 'helper could not read activity history'
run env VCC_ACTIVITY_AGENT_ID=agent-123 bash "$vcc" activity last X-1
[ "$status" = 0 ] || fail 'claimant read failed'
[[ $(< "$VCC_TEST_TRACE") == *'limit=1&agent_id=agent-123'* ]] || fail 'claimant filter was lost'
run env VCC_TEST_ACTIVITY_RESPONSE='{"success":true,"activities":[]}' bash "$vcc" activity last X-1
[ "$status" = 0 ] && [ ! -s "$T/out" ] || fail 'empty last was not empty success'
run env VCC_TEST_ACTIVITY_CODE=403 VCC_TEST_ACTIVITY_RESPONSE='{"success":false,"error":"Forbidden"}' bash "$vcc" activity list X-1
[ "$status" != 0 ] && [ ! -s "$T/out" ] || fail 'forbidden history did not fail closed'
run env VCC_TEST_ACTIVITY_CODE=404 bash "$vcc" activity last X-1
[ "$status" = 4 ] || fail 'last lost the unavailable-route exit contract'
printf 'ok activity reads preserve text, history, caller filters and denied access\n'

printf '%s' '{"tasks":[{"id":42,"ticketNumber":"X-1"}]}' > "$VCC_TEST_TASK"
run bash "$vcc" activity list 42 --json
[ "$status" = 0 ] || fail 'numeric task history failed'
[[ $(< "$VCC_TEST_TRACE") == *'hypertask tasks get'* && $(< "$VCC_TEST_TRACE") == *'/tasks/X-1/agent-activity?'* ]] || fail 'numeric task reference did not resolve'
run bash "$vcc" activity add 42 'Fixture note'
[ "$status" = 0 ] || fail "numeric task add failed: $(cat "$T/err")"
[ "$(< "$T/out")" = fixture-note ] || fail 'activity add returned no note ID'
[[ $(< "$VCC_TEST_TRACE") == *'POST https://app.hypertask.ai/api/mcp/agents/runs/fixture-run/activities'* ]] || fail 'activity add did not write the note'
printf '%s' '{"tasks":[]}' > "$VCC_TEST_TASK"
run bash "$vcc" activity add 99 'Fixture note'
[ "$status" != 0 ] || fail 'unresolved numeric task was accepted'
[[ $(< "$VCC_TEST_TRACE") != *POST* ]] || fail 'unresolved numeric task wrote a note'
printf 'ok numeric task references resolve for reads and writes and fail closed\n'
printf 'vcc helper guard tests passed\n'
