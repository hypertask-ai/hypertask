#!/usr/bin/env bash
# Gives a worktree its own node_modules as a hardlinked copy (cp -al) of the main checkout's.
# Never a symlink: `npm ci` in a worktree whose node_modules is a symlink empties the shared
# install (YPER4-247). Hardlinks are safe because npm removes and rewrites files, it does not
# truncate them in place. Idempotent: a real directory already there is left alone.
# Usage: scripts/worktree-node-modules.sh <main checkout> <worktree>
set -euo pipefail
if [ "$#" -ne 2 ]; then echo 'Usage: worktree-node-modules.sh <main checkout> <worktree>' >&2; exit 2; fi
main=$1 wt=$2
src="${main%/}/node_modules" dst="${wt%/}/node_modules"
[ -d "$wt" ] || { echo "worktree-node-modules: no such worktree: $wt" >&2; exit 1; }
if [ "$(cd "$main" && pwd -P)" = "$(cd "$wt" && pwd -P)" ]; then
  echo 'worktree-node-modules: main checkout and worktree are the same directory' >&2; exit 1
fi
if [ -L "$dst" ]; then rm "$dst"; fi   # remove only the link itself, never through it
if [ -d "$dst" ]; then exit 0; fi
if [ -L "$src" ] || [ ! -d "$src" ]; then
  echo "worktree-node-modules: $src is not a real directory; run npm ci in the main checkout first" >&2; exit 1
fi
cp -al "$src" "$dst" || {
  rm -rf "$dst"   # dst was created by this cp just now, a partial copy of real files only
  echo 'worktree-node-modules: hardlink copy failed (different filesystem?). Run npm ci in the worktree instead.' >&2; exit 1
}
# Tools that write inside node_modules in place (prisma generate writes node_modules/.prisma/client,
# the default output here; caches) must not share inodes with main: give these real copies.
for sub in .prisma .cache @prisma/client; do
  if [ -d "$src/$sub" ] && [ ! -L "$src/$sub" ]; then
    rm -rf "${dst:?}/$sub"
    cp -a "$src/$sub" "$dst/$sub"
  fi
done
