#!/bin/sh
set -eu
src=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/bin" "$tmp/home"
export HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/home/xdg" GIT_CONFIG_NOSYSTEM=1
export GH_REPO=hypertask-ai/not-the-origin
export TEST_CHECKOUT="$tmp/my repo" TEST_ORIGIN=git@github.com:hypertask-ai/target.git
export TEST_VISIBILITY=PUBLIC TEST_GH_FAIL=0
cat > "$tmp/bin/gh" <<'SH'
#!/bin/sh
set -eu
[ "$PWD" = "$TEST_CHECKOUT" ]
[ "$#" = 7 ]
[ "$1" = repo ] && [ "$2" = view ] && [ "$3" = "$TEST_ORIGIN" ]
[ "$4" = --json ] && [ "$5" = visibility ] && [ "$6" = --jq ] && [ "$7" = .visibility ]
[ "$TEST_GH_FAIL" = 0 ] || exit 1
printf '%s\n' "$TEST_VISIBILITY"
SH
chmod +x "$tmp/bin/gh"
export PATH="$tmp/bin:$PATH"
git init -q "$TEST_CHECKOUT"
git -C "$TEST_CHECKOUT" remote add origin "$TEST_ORIGIN"
git -C "$TEST_CHECKOUT" remote add upstream https://github.com/hypertask-ai/other.git
out="$TEST_CHECKOUT/.github/workflows/gitleaks.yml"

sh "$src/install-workflow" "$TEST_CHECKOUT"
cmp "$src/gitleaks.yml" "$out"
echo 'ok - PUBLIC is byte-identical and uses checkout origin, not upstream or GH_REPO'
grep -qxF '  push:' "$out"
grep -qxF '    branches: [main, master, production]' "$out"
grep -qxF '  pull_request:' "$out"
grep -qxF '    name: secret-scan' "$out"
grep -qxF "    if: github.event_name != 'push' || !github.event.deleted" "$out"
grep -qxF '  group: gitleaks-${{ github.event.pull_request.number || github.ref }}' "$out"
grep -qxF "  cancel-in-progress: \${{ github.event_name == 'pull_request' }}" "$out"
echo 'ok - every PR reports secret-scan, only default-branch pushes scan, and only superseded PR runs cancel'

for TEST_VISIBILITY in PRIVATE INTERNAL; do
  export TEST_VISIBILITY
  sh "$src/install-workflow" "$TEST_CHECKOUT"
  grep -qxF '    runs-on: [self-hosted, ci-fast]' "$out"
  sed 's/^    runs-on: \[self-hosted, ci-fast\]$/    runs-on: ubuntu-latest/' "$out" > "$tmp/normalized"
  cmp "$src/gitleaks.yml" "$tmp/normalized"
  echo "ok - $TEST_VISIBILITY changes only runs-on"
done

TEST_VISIBILITY=PUBLIC; export TEST_VISIBILITY
sh "$src/install-workflow" "$TEST_CHECKOUT" >/dev/null
cmp "$src/gitleaks.yml" "$out"
echo 'ok - reinstall restores public template'

cp "$out" "$tmp/before"
for TEST_VISIBILITY in UNKNOWN '' private; do
  export TEST_VISIBILITY
  if sh "$src/install-workflow" "$TEST_CHECKOUT" >"$tmp/stdout" 2>"$tmp/stderr"; then
    echo 'not ok - unknown visibility accepted'; exit 1
  fi
  grep -q 'unknown repository visibility; refusing' "$tmp/stderr"
  cmp "$tmp/before" "$out"
done
echo 'ok - unknown, empty and malformed visibility refuse without overwriting'

TEST_GH_FAIL=1; export TEST_GH_FAIL
if sh "$src/install-workflow" "$TEST_CHECKOUT" >"$tmp/stdout" 2>"$tmp/stderr"; then
  echo 'not ok - unreadable visibility accepted'; exit 1
fi
grep -q 'cannot read origin repository visibility; refusing' "$tmp/stderr"
cmp "$tmp/before" "$out"
rm "$out"
if sh "$src/install-workflow" "$TEST_CHECKOUT" >"$tmp/stdout" 2>"$tmp/stderr"; then
  echo 'not ok - unreadable visibility created workflow'; exit 1
fi
[ ! -e "$out" ]
echo 'ok - GitHub failure preserves existing workflow and creates no new workflow'

TEST_GH_FAIL=0; export TEST_GH_FAIL
git -C "$TEST_CHECKOUT" remote remove origin
if sh "$src/install-workflow" "$TEST_CHECKOUT" >"$tmp/stdout" 2>"$tmp/stderr"; then
  echo 'not ok - missing origin accepted'; exit 1
fi
grep -q 'cannot read checkout origin; refusing' "$tmp/stderr"
[ ! -e "$out" ]
echo 'ok - missing origin refuses'

if sh "$src/install-workflow" >"$tmp/stdout" 2>"$tmp/stderr"; then
  echo 'not ok - missing checkout accepted'; exit 1
fi
grep -q 'Usage: install-workflow' "$tmp/stderr"
echo 'ok - missing checkout shows usage'
echo 'all workflow installer tests passed'
