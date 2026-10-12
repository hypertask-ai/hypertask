#!/bin/sh
# Proves the commit-time key scan blocks a fake key, lets clean commits through, keeps a repo's
# own hooks running and covers husky repos. Runs in a throwaway HOME.
set -u
src=$(cd "$(dirname "$0")" && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
leaks=$(command -v gitleaks || echo "$HOME/.local/bin/gitleaks")
mkdir -p "$tmp/home/.local/bin"; ln -s "$leaks" "$tmp/home/.local/bin/gitleaks"
export HOME="$tmp/home" XDG_CONFIG_HOME="$tmp/home/xdg" GIT_CONFIG_NOSYSTEM=1
git config --global user.email t@example.com; git config --global user.name test
git config --global init.defaultBranch main
fail=0
ok() { echo "ok - $1"; }
bad() { echo "not ok - $1"; fail=1; }
# A random AWS-shaped id; ids ending in EXAMPLE are allowlisted by gitleaks.
fake="AKIA$(LC_ALL=C tr -dc 'A-Z2-7' </dev/urandom | head -c 16)"

# An existing init.sh whose last line is a comment without a newline.
mkdir -p "$XDG_CONFIG_HOME/husky"; printf 'export CUSTOM_INIT=1\n# last line' > "$XDG_CONFIG_HOME/husky/init.sh"
sh "$src/install" >/dev/null || bad "install runs"
[ "$(git config --global core.hooksPath)" = "$XDG_CONFIG_HOME/git/hooks" ] && ok "global hooks path set" || bad "global hooks path set"
sh "$src/install" >/dev/null && ok "install is rerunnable" || bad "install is rerunnable"
grep -q CUSTOM_INIT "$XDG_CONFIG_HOME/husky/init.sh" && ok "existing husky init.sh kept" || bad "existing husky init.sh kept"
[ "$(grep -c 'YPER4-324' "$XDG_CONFIG_HOME/husky/init.sh")" = 1 ] && ok "husky init line added once" || bad "husky init line added once"

git init -q "$tmp/repo"; cd "$tmp/repo"
echo hello > a.txt; git add a.txt
git commit -qm clean 2>/dev/null && ok "clean commit passes" || bad "clean commit passes"
echo "aws_access_key_id = $fake" > b.txt; git add b.txt
if git commit -qm leak 2>"$tmp/err"; then bad "fake key blocked"; else ok "fake key blocked"; fi
grep -q "looks like a key" "$tmp/err" && ok "blocked by the scan itself" || bad "blocked by the scan itself"
grep -q "$fake" "$tmp/err" && bad "value hidden in output" || ok "value hidden in output"
git reset -q --hard
# The shape that leaked in agent-fleet 6ac2c153; the default rules alone miss it.
cf="$(LC_ALL=C tr -dc 'A-Za-z0-9_-' </dev/urandom | head -c 40)"
echo "| CF API token | in ~/.bashrc (value \`$cf\`) |" > notes.md; git add notes.md
if git commit -qm leak 2>/dev/null; then bad "Cloudflare token in markdown blocked"; else ok "Cloudflare token in markdown blocked"; fi
git reset -q --hard

printf '#!/bin/sh\necho ran > "%s/own"\n' "$tmp" > .git/hooks/post-commit; chmod +x .git/hooks/post-commit
echo two >> a.txt; git commit -qam two
[ -f "$tmp/own" ] && ok "repo's own hook still runs" || bad "repo's own hook still runs"

# A repo path with a space, whose .gitleaks.toml allowlists the fake key.
git init -q "$tmp/my repo"; cd "$tmp/my repo"
printf '[extend]\nuseDefault = true\n[allowlist]\nregexes = ['"'''%s'''"']\n' "$fake" > .gitleaks.toml
echo "aws_access_key_id = $fake" > b.txt; git add .gitleaks.toml b.txt
git commit -qm allowed 2>/dev/null && ok "repo .gitleaks.toml allowlist applies" || bad "repo .gitleaks.toml allowlist applies"

# Husky v9 sets a local hooks path and sources init.sh before each hook (copy of its .husky/_/h).
git init -q "$tmp/husky"; cd "$tmp/husky"
mkdir -p .husky/_
cat > .husky/_/h <<'H'
#!/usr/bin/env sh
n=$(basename "$0")
s=$(dirname "$(dirname "$0")")/$n
[ ! -f "$s" ] && exit 0
i="${XDG_CONFIG_HOME:-$HOME/.config}/husky/init.sh"
[ -f "$i" ] && . "$i"
sh -e "$s" "$@"
H
printf '#!/usr/bin/env sh\n. "$(dirname "$0")/h"\n' > .husky/_/pre-commit
echo 'true' > .husky/pre-commit; chmod +x .husky/_/h .husky/_/pre-commit
git config core.hooksPath .husky/_
echo "aws_access_key_id = $fake" > c.txt; git add c.txt
if git commit -qm leak 2>/dev/null; then bad "husky repo blocks fake key"; else ok "husky repo blocks fake key"; fi
git rm -q --cached c.txt; echo clean > d.txt; git add d.txt
git commit -qm clean 2>/dev/null && ok "husky repo clean commit passes" || bad "husky repo clean commit passes"

exit $fail
