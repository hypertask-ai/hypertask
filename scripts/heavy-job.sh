#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then echo 'Usage: scripts/heavy-job.sh COMMAND [ARG ...]' >&2; exit 2; fi
if [ "${CI:-}" = true ] || [ "${GITHUB_ACTIONS+x}" = x ]; then exec "$@"; fi

slots=${HT_HEAVY_SLOTS:-$(( $(nproc) / 6 ))}
if [ -z "${HT_HEAVY_SLOTS:-}" ] && [ "$slots" -lt 2 ]; then slots=2; fi
if [[ ! $slots =~ ^[1-9][0-9]*$ ]]; then echo 'HT_HEAVY_SLOTS must be a positive integer.' >&2; exit 2; fi
lock_dir="${XDG_RUNTIME_DIR:-${HOME}/.cache}/ht-heavy"
if [ -L "$lock_dir" ]; then echo 'Refusing symlink heavy-job lock directory.' >&2; exit 2; fi
(umask 077; mkdir -p "$lock_dir")
if [ -L "$lock_dir" ] || [ ! -d "$lock_dir" ] || [ ! -O "$lock_dir" ]; then
  echo 'Heavy-job lock directory must be owned by the current user and not a symlink.' >&2
  exit 2
fi
chmod 700 "$lock_dir"
# Never unlink slot files: every worktree must lock the same inodes.
waiting=false
while :; do
  for ((slot=0; slot<slots; slot++)); do
    if [ -L "$lock_dir/slot-$slot" ]; then echo 'Refusing symlink heavy-job slot.' >&2; exit 2; fi
    exec 8>>"$lock_dir/slot-$slot"
    if flock -n 8; then
      # The command inherits the lock, including if this wrapper is interrupted.
      exec "$@"
    fi
    exec 8>&-
  done
  if [ "$waiting" = false ]; then
    printf 'waiting for a heavy-job slot, %s in use\n' "$slots" >&"${HT_HEAVY_WAIT_FD:-2}"
    waiting=true
  fi
  sleep 0.2
done
