#!/usr/bin/env bash
# Offline helper guard tests with fake credentials and CLI.
set -euo pipefail
vcc=$(cd "$(dirname "$0")" && pwd)/vcc
ship_check=$(cd "$(dirname "$vcc")/../../ship/scripts" && pwd)/ship-check
T=$(mktemp -d)
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/tmp" "$T/bin" "$T/home/.config/hypertask-agents/credentials" "$T/proc"
if [ -z "${VCC_TICKET_LINT:-}" ]; then
  export VCC_TICKET_LINT="$T/ticket-lint"
  cat > "$VCC_TICKET_LINT" <<'STUB'
import pathlib, sys
text = sys.stdin.read()
old = pathlib.Path(sys.argv[sys.argv.index("--old") + 1]).read_text()
for marker in ("Next:", "src/app/page.tsx", "new_code", "thirteen.", "Plain version:"):
    if marker in text and marker not in old:
        print("ticket-lint: rejected fixture", file=sys.stderr)
        sys.exit(1)
STUB
fi
export TMPDIR="$T/tmp"
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
if [[ "${1:-} ${2:-}" = 'tasks get' || "${1:-} ${2:-}" = 'task get' ]] && [ -n "${VCC_TEST_TASK:-}" ]; then
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
if [ "${VCC_TEST_ACTIVITY:-0}" != 1 ]; then
  printf 'unexpected network request\n' >&2
  exit 92
fi
out='' data='' url=${!#}
while [ "$#" -gt 0 ]; do
  case "$1" in --output) out=$2; shift ;; --data) data=$2; shift ;; esac
  shift
done
printf '%s\t%s\n' "$url" "$data" >> "$VCC_TEST_TRACE"
case "$url" in
  */agents/runs) printf '{"success":true,"run":{"id":"fixture-run"}}' > "$out" ;;
  */agents/runs/fixture-run) printf '{"success":true,"run":{"status":"active"}}' > "$out" ;;
  */activities) printf '{"success":true,"activity":{"id":"stub:activity"}}' > "$out" ;;
  */tasks/waiting-on|*/tasks/clear-approved-blocker) printf '{"success":true,"task":{"waitingOnUserId":null,"blockerCommentId":null}}' > "$out" ;;
  *) exit 92 ;;
esac
printf '200'
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

refused env VCC_HELPER=1 bash "$vcc" comment add X-1 --kind qa --text hi
refused env VCC_HELPER=1 bash "$vcc" task move X-1 --section Done
refused env VCC_HELPER=1 bash "$vcc" activity add X-1 x
refused env VCC_HELPER=1 bash "$vcc" task assign X-1 --self
refused env VCC_HELPER=1 bash "$vcc" pages create --task X-1
refused env VCC_HELPER=1 bash "$vcc" comment add X-1 --kind qa --text hi --help
refused env VCC_HELPER=1 bash "$vcc" --project 15 task move X-1 --section Done
refused env VCC_HELPER=1 bash "$vcc"
printf 'ok explicit helper writes blocked before credentials\n'

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
  refused launch_hax "$marker" comment add X-1 --kind qa --text hi
  allowed launch_hax "$marker" tasks get X-1
  printf 'ok live hax ancestor %s blocks writes and allows reads\n' "$marker"
done
refused env -u VCC_HELPER_PROC_ROOT "$T/bin/hax" -p -c '
  IFS= read -r comm < "/proc/$$/comm"
  [ "$comm" = hax ] || exit 93
  /bin/bash "$VCC_TEST_BIN" "$@"
  exit $?
' hax comment add X-1 --kind qa --text hi
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
  jq -n --arg text "$1" '{success:true,comments:[{id:"new",text:$text,createdAt:"2026-10-20T12:00:00Z"}]}' > "$VCC_TEST_COMMENTS"
}
review_refused() {
  local reason=$1; shift
  run bash "$vcc" "$@"
  [ "$status" = 5 ] || fail "expected exit 5, got $status: $*: $(cat "$T/err")"
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
[ -z "$(find "$TMPDIR" -type f -print -quit)" ] || fail 'passthrough leaked a response file'
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
  [ "$status" = 5 ] || fail "expected exit 5, got $status: $*: $(cat "$T/err")"
  [ ! -s "$T/out" ] || fail 'Question refusal produced stdout'
  [[ $(< "$T/err") == *"$reason"* ]] || fail "missing Question refusal reason: $reason"
  [[ $(< "$T/err") == *'rewrite it for a product owner (pospeak)'* ]] || fail 'missing product-owner guidance'
  [[ ! $(< "$VCC_TEST_TRACE") =~ hypertask\ (comment|comments|task|tasks)\ (add|create|update) ]] || fail 'refused human write reached CLI'
}
plain='<p>Question: <strong>Keep it?</strong></p><p>My recommendation: yes.</p><p>Why: less work.</p><p>Yes: keep it.</p><p>No: remove it.</p>'
inline_why='<p>Question: <strong>Keep it?</strong></p><p>My recommendation: yes. Why: less work.</p><p>Yes: keep it.</p><p>No: remove it.</p>'
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
late='<p>Question: <strong>Keep it?</strong></p><p>Why: less work.</p><p>My recommendation: yes.</p><p>Yes: keep it.</p><p>No: remove it.</p>'
question_refused 'right under' comment add X-1 --kind question --text "$late"
fixture "$late"
review_refused 'right under' task move X-1 --section 'Valentin Review'
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
question_refused 'cannot read --file' comment add X-1 --kind question --file "$T/missing.html"
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
question_refused OAuth comment add X-1 --kind question --markdown --text "$markdown
OAuth"
question_refused 'links' comment add X-1 --kind question --markdown --text "$markdown
[Details](https://example.test/help)"
printf 'ok singular/plural, text/body/file, equals options, and Markdown forms\n'

for kind in qa done; do
  for subcommand in comment comments; do
    question_refused 'shared ticket-lint' "$subcommand" add X-1 --kind "$kind" --text 'Next: src/app/page.tsx'
    allowed bash "$vcc" "$subcommand" add X-1 --kind "$kind" --text '<p>Ready to try.</p>'
  done
done
question_refused 'cannot read --file' comment add X-1 --kind=qa --file "$T/missing.html"
printf 'ok human comments share ticket-lint\n'

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
<p>Next: on your 👍, RUNNER 4 finishes the list. claude --resume fe0bb917-b08d-465a-a586-2224a26af002</p>
FIXTURE
)
question_refused 'My recommendation:' comment add X-1 --kind question --text "$old_question_7508_295851"
fixture "$old_question_7508_295851"
review_refused 'My recommendation:' task move X-1 --section 'Valentin Review'
question_refused 'shared ticket-lint' comment add X-1 --kind question --text "$rewrite_7508_303933"
fixture "$rewrite_7508_303933"
allowed bash "$vcc" task move X-1 --section 'Valentin Review'
printf 'ok historical long rewrite refuses shared lint\n'

for action in 'task create' 'tasks create' 'task update' 'tasks update'; do
  read -r noun verb <<< "$action"
  question_refused 'shared ticket-lint' "$noun" "$verb" X-1 --title 'src/app/page.tsx'
  question_refused 'shared ticket-lint' "$noun" create --description 'One two three four five six seven eight nine ten eleven twelve thirteen.'
done
printf '<p>Ready to try.</p>' > "$T/description.html"
allowed bash "$vcc" task create --title 'Readable questions' --description-file "$T/description.html"
question_refused 'cannot read --description-file' task create --description-file "$T/missing.html"
export VCC_TEST_TASK="$T/task.json"
printf '{"success":true,"tasks":[{"id":123,"description":"<p>old_code</p>","blockerCommentId":null}]}' > "$VCC_TEST_TASK"
allowed bash "$vcc" task update X-1 --description '<p>old_code</p><p>Ready to try.</p>'
question_refused 'shared ticket-lint' task update X-1 --description '<p>old_code</p><p>new_code</p>'
question_refused 'shared ticket-lint' comment add X-1 --kind qa --text 'One two three four five six seven eight nine ten eleven twelve thirteen.'
export VCC_TEST_ACTIVITY=1
for subcommand in comment comments; do
  run bash "$vcc" "$subcommand" add X-1 --text 'Next: src/app/page.tsx' --json
  [ "$status" = 0 ] || fail 'agent comment did not route'
  [[ $(< "$T/out") == 'stub:activity' ]] || fail 'agent activity was not saved'
  [[ $(< "$VCC_TEST_TRACE") != *'hypertask comment'* ]] || fail 'agent note reached people comments'
  [[ $(< "$VCC_TEST_TRACE") == *'"text":"Next: src/app/page.tsx"'* ]] || fail 'agent content changed'
done
question_refused 'attachments need' comment add X-1 --text 'Agent note.' --attach screenshot.png
question_refused 'replies need' comment add X-1 --text 'A reply.' --reply-to-comment-id 123
question_refused 'human mentions need' comment add X-1 --text "$question"
run bash "$vcc" task waiting-on X-1 --user 6
[ "$status" = 5 ] || fail 'waiting without marked Question was accepted'
printf '{"success":true,"tasks":[{"id":123,"blockerCommentId":"new"}]}' > "$VCC_TEST_TASK"
fixture "$plain"
allowed bash "$vcc" task waiting-on X-1 --user 6
fixture '<p>Ready to try.</p>'
run bash "$vcc" task waiting-on X-1 --user 6
[ "$status" = 5 ] || fail 'marked non-Question accepted'
run bash "$vcc" task waiting-on X-1 --user none
[ "$status" = 0 ] || fail 'clear failed'
[[ $(< "$VCC_TEST_TRACE") == *'"userId":null,"blockerCommentId":null'* ]] || fail 'clear did not clear both blocker fields'
printf '{"commentId":42,"text":"Question","editedAt":null,"reactionId":"human-yes"}' > "$T/approval.json"
run bash "$vcc" task waiting-on X-1 --user none --approval-file "$T/approval.json"
[ "$status" = 0 ] || fail 'conditional clear failed'
[[ $(< "$VCC_TEST_TRACE") == *'/tasks/clear-approved-blocker'* ]] || fail 'conditional clear used unsafe old endpoint'
[[ $(< "$VCC_TEST_TRACE") == *'"approvedClear":{"commentId":42'* ]] || fail 'approval snapshot missing'
unset VCC_TEST_ACTIVITY VCC_TEST_TASK
question_refused 'shared ticket-lint' --json comment add X-1 --kind qa --text 'Next: src/app/page.tsx'
question_refused 'shared ticket-lint' --human task create --description 'Next: src/app/page.tsx'
question_refused 'shared ticket-lint' --project 15 --json comment --kind qa add X-1 --text 'Next: src/app/page.tsx'
question_refused 'shared ticket-lint' comment -kind qa add X-1 -text 'Next: src/app/page.tsx'
question_refused 'shared ticket-lint' --description 'Next: src/app/page.tsx' task create
printf 'ok shared human lint and agent routing\n'
export VCC_VOICE_BYPASS_LOG="$T/bypass.log"
run env VCC_VOICE_BYPASS='error collector raw evidence' SHIP_SESSION_NAME='RUNNER 8' bash "$vcc" task create --title 'src/app/page.tsx' --description 'Next: src/app/page.tsx'
[ "$status" = 0 ] || fail "voice bypass did not reach CLI: $(cat "$T/err")"
[ "$(wc -l < "$T/bypass.log")" = 1 ] || fail 'voice bypass not logged once'
grep -q $'\tRUNNER 8\terror collector raw evidence$' "$T/bypass.log" || fail 'voice bypass log missing session or reason'
run env VCC_VOICE_BYPASS='  ' bash "$vcc" task create --title 'src/app/page.tsx'
[ "$status" = 5 ] || fail 'blank voice bypass skipped the lint'
run env VCC_VOICE_BYPASS='raw evidence' bash "$vcc" comment add X-1 --kind question --text 'Is this fine'
[ "$status" = 5 ] || fail 'voice bypass skipped the Question check'
unset VCC_VOICE_BYPASS_LOG
printf 'ok VCC_VOICE_BYPASS skips only the shared lint, needs a reason, and is logged\n'
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
python3 "$(dirname "$vcc")/blocker-sweep.test.py"
printf 'vcc helper guard tests passed\n'
