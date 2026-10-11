#!/usr/bin/env bash
# Offline helper guard tests with fake credentials and CLI.
set -euo pipefail
vcc=$(cd "$(dirname "$0")" && pwd)/vcc
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
printf 'hypertask\n' >> "$VCC_TEST_TRACE"
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
  [ "$status" = 0 ] || fail "expected stub success, got $status: $*"
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
for args in "activity" "activity --help" "activity list X-1"; do
  run bash "$vcc" $args
  [ "$status" = 1 ] || fail "expected exit 1, got $status: vcc $args"
  [[ $(< "$T/err") == "vcc activity: "* ]] || fail "missing vcc activity error: vcc $args"
  [[ $(< "$VCC_TEST_TRACE") != *hypertask* ]] || fail "fell through to CLI: vcc $args"
done
allowed bash "$vcc" tasks get X-1
printf 'ok unknown activity subcommands fail in vcc\n'
printf 'vcc helper guard tests passed\n'
