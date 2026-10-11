#!/usr/bin/env bash
# Offline test for YPER4-247: npm ci in a worktree must never empty the main checkout's node_modules.
cd "$(dirname "$0")/.."; repo=$PWD; fails=0
ok() { echo "ok   $*"; }; bad() { echo "FAIL $*"; fails=$((fails+1)); }
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir -p "$T/lib/dep" "$T/main"
echo '{"name":"dep","version":"1.0.0","main":"i.js"}' > "$T/lib/dep/package.json"; echo 'module.exports=1' > "$T/lib/dep/i.js"
echo '{"name":"t","version":"1.0.0","dependencies":{"dep":"file:../lib/dep"}}' > "$T/main/package.json"
(cd "$T/main" && npm install --offline --no-audit --no-fund >/dev/null 2>&1) || { bad 'setup npm install'; exit 1; }
# A real (non-link) file so the content check exercises hardlinks.
mkdir -p "$T/main/node_modules/real"; echo 'keep-me' > "$T/main/node_modules/real/f.txt"
mkdir -p "$T/main/node_modules/.prisma/client" "$T/main/node_modules/.cache" "$T/main/node_modules/@prisma/client"
echo 'gen' > "$T/main/node_modules/.prisma/client/index.js"; echo c > "$T/main/node_modules/.cache/c"; echo p > "$T/main/node_modules/@prisma/client/index.js"
count() { find "$1" | wc -l; }
before=$(count "$T/main/node_modules")
for d in wt wt2; do mkdir "$T/$d"; cp "$T/main/package.json" "$T/main/package-lock.json" "$T/$d/"; done

# Hardlinked copy: npm ci leaves main intact.
"$repo/scripts/worktree-node-modules.sh" "$T/main" "$T/wt" || bad 'helper failed'
[ ! -L "$T/wt/node_modules" ] && [ -d "$T/wt/node_modules" ] && ok 'copy is a real directory' || bad 'copy is not a real directory'
[ "$(stat -c %h "$T/main/node_modules/real/f.txt")" -ge 2 ] && ok 'files are hardlinked' || bad 'files are not hardlinked'
# Generated and cache folders are real copies; an in-place append must not reach main.
printf x >> "$T/wt/node_modules/.prisma/client/index.js"; printf x >> "$T/wt/node_modules/@prisma/client/index.js"
[ "$(cat "$T/main/node_modules/.prisma/client/index.js")" = gen ] && [ "$(cat "$T/main/node_modules/@prisma/client/index.js")" = p ] && ok 'in-place write in .prisma and @prisma/client does not reach main' || bad 'in-place write reached main'
[ "$(stat -c %h "$T/main/node_modules/.cache/c")" = 1 ] && ok '.cache is a real copy' || bad '.cache is shared'
[ "$(stat -c %h "$T/main/node_modules/real/f.txt")" -ge 2 ] && ok 'plain package file still shares its inode' || bad 'plain package file lost its hardlink'
(cd "$T/wt" && npm ci --offline --no-audit --no-fund >/dev/null 2>&1) || bad 'npm ci in worktree failed'
[ "$(count "$T/main/node_modules")" = "$before" ] && ok "main node_modules intact ($before entries)" || bad 'main node_modules changed'
[ "$(cat "$T/main/node_modules/real/f.txt")" = keep-me ] && ok 'main file content unchanged' || bad 'main file content changed'


# Idempotent, and replaces a symlink without touching its target.
"$repo/scripts/worktree-node-modules.sh" "$T/main" "$T/wt" && ok 'second run is a no-op' || bad 'second run failed'
ln -s "$T/main/node_modules" "$T/wt2/node_modules"
"$repo/scripts/worktree-node-modules.sh" "$T/main" "$T/wt2" || bad 'helper failed on symlink'
[ ! -L "$T/wt2/node_modules" ] && [ "$(count "$T/main/node_modules")" = "$before" ] && ok 'symlink replaced by a copy, target untouched' || bad 'symlink handling broke'
"$repo/scripts/worktree-node-modules.sh" "$T/main" "$T/main" 2>/dev/null && bad 'helper accepted main as worktree' || ok 'refuses main as worktree'

# Backstop: premerge-local refuses a symlinked node_modules (before any setup or Docker).
mkdir -p "$T/pm/scripts"; cp "$repo/scripts/premerge-local.sh" "$T/pm/scripts/"
ln -s "$T/main/node_modules" "$T/pm/node_modules"
out=$(bash "$T/pm/scripts/premerge-local.sh" up 2>&1); rc=$?
if [ "$rc" != 0 ] && grep -q 'is a symlink' <<<"$out"; then ok 'premerge-local refuses symlinked node_modules'; else bad "premerge-local did not refuse (rc=$rc)"; fi
[ "$(count "$T/main/node_modules")" = "$before" ] && ok 'main still intact after guard' || bad 'main changed after guard'
echo "fails=$fails"; exit "$fails"
