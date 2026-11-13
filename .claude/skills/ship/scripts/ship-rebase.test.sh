#!/usr/bin/env bash
# Offline tests for ship-rebase: dirty refusal, clean rebase, real conflict.
set -uo pipefail
here=$(cd "$(dirname "$0")" && pwd)
root=$(mktemp -d)
trap 'rm -rf "$root"' EXIT
export HOME="$root/home" GIT_CONFIG_GLOBAL="$root/gitconfig"
mkdir -p "$HOME"
git config --file "$GIT_CONFIG_GLOBAL" user.email runner@example.com
git config --file "$GIT_CONFIG_GLOBAL" user.name Runner
git config --file "$GIT_CONFIG_GLOBAL" init.defaultBranch production
git config --file "$GIT_CONFIG_GLOBAL" advice.detachedHead false
failures=0
pass() { printf 'ok   %s\n' "$1"; }
fail() { printf 'FAIL %s: %s\n' "$1" "$2"; failures=$((failures + 1)); }
expect() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected [$3], got [$2]"; fi; }
expect_contains() { if [[ $2 == *"$3"* ]]; then pass "$1"; else fail "$1" "output did not contain [$3]: $2"; fi; }

git init --quiet --bare "$root/origin.git"
git clone --quiet "$root/origin.git" "$root/seed" 2>/dev/null
cd "$root/seed" || exit 1
printf 'one\n' > shared.txt
git add shared.txt && git commit --quiet -m base
git push --quiet origin production
git branch --quiet -M production

git clone --quiet "$root/origin.git" "$root/work" 2>/dev/null
cd "$root/work" || exit 1
git checkout --quiet -b runner-1/hyci-352
printf 'one\nfeature\n' > shared.txt
git commit --quiet -am feature
printf 'new\n' > mine.txt
git add mine.txt && git commit --quiet -m mine

cd "$root/seed" || exit 1
printf 'two\n' > other.txt
git add other.txt && git commit --quiet -m other
git push --quiet origin production

cd "$root/work" || exit 1
printf 'scratch\n' > dirty.txt
out=$("$here/ship-rebase" --remote origin --base production 2>&1); code=$?
expect "refuses a dirty worktree" "$code" 1
expect_contains "names the dirty refusal" "$out" "uncommitted changes"
rm dirty.txt

out=$("$here/ship-rebase" --remote origin --base production 2>&1); code=$?
expect "rebases cleanly" "$code" 0
expect_contains "reports the rebase" "$out" "rebased runner-1/hyci-352"
if git merge-base --is-ancestor "$(git rev-parse origin/production)" HEAD; then
  pass "puts the base commit under the branch"
else
  fail "puts the base commit under the branch" "origin/production is not an ancestor"
fi

out=$("$here/ship-rebase" 2>&1); code=$?
expect "says up to date" "$code" 0
expect_contains "reports up to date" "$out" "already up to date"

cd "$root/seed" || exit 1
printf 'two\nconflict from base\n' > shared.txt
git commit --quiet -am base-change
git push --quiet origin production
cd "$root/work" || exit 1
printf 'one\nconflict from branch\n' > shared.txt
git commit --quiet -am branch-change
before=$(git rev-parse HEAD)
out=$("$here/ship-rebase" 2>&1); code=$?
expect "stops on a real conflict" "$code" 2
expect_contains "names the conflicted file" "$out" "shared.txt"
expect "leaves the branch alone" "$(git rev-parse HEAD)" "$before"
expect "leaves no rebase in progress" "$(git status --porcelain --untracked-files=no)" ""

out=$("$here/ship-rebase" --nope 2>&1); code=$?
expect "usage exit" "$code" 3

if [ "$failures" -gt 0 ]; then
  printf '%d failure(s)\n' "$failures"
  exit 1
fi
printf 'ship-rebase: all tests passed\n'
