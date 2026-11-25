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
# The commit that read a git commit SHA as a key: a SHA in a record and in a GitHub URL is not a
# key, and inherited files copied to a new path must commit (HYCI-405).
sha=$(git rev-parse HEAD)
printf '  "sources": ["sourcegraph"],\n  "previousCommit": "%s"\n' "$sha" > .brain-record.json
git add .brain-record.json
git commit -qm sha-record 2>/dev/null && ok "git commit SHA in a record passes" || bad "git commit SHA in a record passes"
git reset -q --hard; rm -f .brain-record.json
printf 'Source: [x](https://github.com/cloudflare/security-audit-skill/tree/%s) at commit `%s`.\n' "$sha" "$sha" > UPSTREAM.md
git add UPSTREAM.md
git commit -qm sha-url 2>/dev/null && ok "git commit SHA in a GitHub URL passes" || bad "git commit SHA in a GitHub URL passes"
git reset -q --hard; rm -f UPSTREAM.md
printf 'token: %s\n' "$sha" > hex-key.txt; git add hex-key.txt
if git commit -qm hex 2>/dev/null; then bad "hex key outside a commit context blocked"; else ok "hex key outside a commit context blocked"; fi
git reset -q --hard; rm -f hex-key.txt
# A real 40-hex key described with 'at' is not a commit SHA, so it still blocks (the keyword
# makes the sourcegraph rule fire, as it would on a line naming a real key's source).
printf 'Datadog app key at `%s`, per sourcegraph\n' "$sha" > dd.md; git add dd.md
if git commit -qm dd 2>/dev/null; then bad "40-hex key after 'at' blocks"; else ok "40-hex key after 'at' blocks"; fi
git reset -q --hard; rm -f dd.md

# A key trufflehog proves still works (a stub stands in for the live check).
mkdir -p "$tmp/stub"; printf '#!/bin/sh\necho "{\\"DetectorName\\":\\"Cloudflare\\"}"\nexit 183\n' > "$tmp/stub/trufflehog"
chmod +x "$tmp/stub/trufflehog"; echo "harmless text" > live.txt; git add live.txt
if PATH="$tmp/stub:$PATH" git commit -qm live 2>"$tmp/err"; then bad "working key blocked"; else
  grep -q Cloudflare "$tmp/err" && ok "working key blocked, type named" || bad "working key blocked, type named"; fi
git reset -q --hard
# A package lockfile repeats the same package's 32-character peer hash per peer set, and
# trufflehog's Alchemy detector reads those as keys (HYCI-405). The lockfile must commit.
mkdir -p "$tmp/stub-lock"; printf '#!/bin/sh\necho "{\\"SourceMetadata\\":{\\"Data\\":{\\"Filesystem\\":{\\"file\\":\\"%s/pnpm-lock.yaml\\",\\"line\\":5048}}},\\"DetectorName\\":\\"Alchemy\\",\\"Raw\\":\\"0123456789abcdef0123456789abcdef\\"}"\nexit 183\n' '$2' > "$tmp/stub-lock/trufflehog"
chmod +x "$tmp/stub-lock/trufflehog"; echo "lockfile: 1" > pnpm-lock.yaml; git add pnpm-lock.yaml
if PATH="$tmp/stub-lock:$PATH" git commit -qm lockfile 2>"$tmp/err"; then ok "lockfile Alchemy false hit passes"; else bad "lockfile Alchemy false hit passes"; fi
git reset -q --hard; rm -f pnpm-lock.yaml
# The same hit in a source file is a real finding and still blocks.
mkdir -p "$tmp/stub-src"; printf '#!/bin/sh\necho "{\\"SourceMetadata\\":{\\"Data\\":{\\"Filesystem\\":{\\"file\\":\\"%s/src/keys.ts\\",\\"line\\":3}}},\\"DetectorName\\":\\"Alchemy\\",\\"Raw\\":\\"0123456789abcdef0123456789abcdef\\"}"\nexit 183\n' '$2' > "$tmp/stub-src/trufflehog"
chmod +x "$tmp/stub-src/trufflehog"
mkdir -p src; echo "key" > src/keys.ts; git add src/keys.ts
if PATH="$tmp/stub-src:$PATH" git commit -qm src 2>/dev/null; then bad "Alchemy hit in a source file blocked"; else ok "Alchemy hit in a source file blocked"; fi
git reset -q --hard; rm -rf src
# An Alchemy hit in a lockfile whose value is not a 32-hex peer hash is not the proven shape.
mkdir -p "$tmp/stub-lock-long"; printf '#!/bin/sh\necho "{\\"SourceMetadata\\":{\\"Data\\":{\\"Filesystem\\":{\\"file\\":\\"%s/pnpm-lock.yaml\\",\\"line\\":5048}}},\\"DetectorName\\":\\"Alchemy\\",\\"Raw\\":\\"%s\\"}"\nexit 183\n' '$2' "$sha" > "$tmp/stub-lock-long/trufflehog"
chmod +x "$tmp/stub-lock-long/trufflehog"; echo "lockfile: 2" > pnpm-lock.yaml; git add pnpm-lock.yaml
if PATH="$tmp/stub-lock-long:$PATH" git commit -qm locklong 2>/dev/null; then bad "Alchemy hit with a key-shaped value in a lockfile blocks"; else ok "Alchemy hit with a key-shaped value in a lockfile blocks"; fi
git reset -q --hard; rm -f pnpm-lock.yaml
# A trufflehog hit on a commit SHA quoted in a GitHub URL is not a key (HYCI-405).
mkdir -p "$tmp/stub-sha"; printf '#!/bin/sh\necho "{\\"SourceMetadata\\":{\\"Data\\":{\\"Filesystem\\":{\\"file\\":\\"%s/UPSTREAM.md\\",\\"line\\":1}}},\\"DetectorName\\":\\"Cloudflare\\",\\"Raw\\":\\"%s\\"}"\nexit 183\n' '$2' "$sha" > "$tmp/stub-sha/trufflehog"
chmod +x "$tmp/stub-sha/trufflehog"
printf 'Source: [x](https://github.com/o/r/tree/%s)\n' "$sha" > UPSTREAM.md; git add UPSTREAM.md
if PATH="$tmp/stub-sha:$PATH" git commit -qm sha-url-tr 2>/dev/null; then ok "trufflehog commit SHA in a GitHub URL passes"; else bad "trufflehog commit SHA in a GitHub URL passes"; fi
git reset -q --hard; rm -f UPSTREAM.md
# The same SHA in a line that does not quote it as a commit is a bare 40-hex key.
printf 'value: %s\n' "$sha" > key.txt; git add key.txt
if PATH="$tmp/stub-sha:$PATH" git commit -qm sha-bare 2>/dev/null; then bad "trufflehog bare 40-hex value blocks"; else ok "trufflehog bare 40-hex value blocks"; fi
git reset -q --hard; rm -f key.txt
# Trufflehog exiting 183 with an unreadable report blocks instead of passing.
mkdir -p "$tmp/stub-empty"; printf '#!/bin/sh\nexit 183\n' > "$tmp/stub-empty/trufflehog"
chmod +x "$tmp/stub-empty/trufflehog"; echo "harmless" > empty.txt; git add empty.txt
if PATH="$tmp/stub-empty:$PATH" git commit -qm empty 2>/dev/null; then bad "unreadable trufflehog report blocks"; else ok "unreadable trufflehog report blocks"; fi
git reset -q --hard; rm -f empty.txt

# A symlink replaced by a regular file (a type change) is scanned too.
ln -s a.txt link; git add link; git commit -qm link
rm link; echo "harmless text" > link; git add link
if PATH="$tmp/stub:$PATH" git commit -qm typechange 2>/dev/null; then bad "type-changed file scanned"; else ok "type-changed file scanned"; fi
git reset -q --hard
start=$(date +%s); echo three >> a.txt; git commit -qam timing
echo "# one commit took $(( $(date +%s) - start ))s"

printf '#!/bin/sh\necho ran > "%s/own"\n' "$tmp" > .git/hooks/post-commit; chmod +x .git/hooks/post-commit
echo two >> a.txt; git commit -qam two
[ -f "$tmp/own" ] && ok "repo's own hook still runs" || bad "repo's own hook still runs"

# A repo path with a space, whose .gitleaks.toml allowlists the fake key.
git init -q "$tmp/my repo"; cd "$tmp/my repo"
printf '[extend]\nuseDefault = true\n[allowlist]\nregexes = ['"'''%s'''"']\n' "$fake" > .gitleaks.toml
echo "aws_access_key_id = $fake # trufflehog:ignore" > b.txt; git add .gitleaks.toml b.txt
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
