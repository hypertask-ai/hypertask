#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -eq 0 ]; then echo 'Usage: scripts/heavy-job.sh COMMAND [ARG ...]' >&2; exit 2; fi
if [ "${CI:-}" = true ] || [ "${GITHUB_ACTIONS+x}" = x ]; then exec "$@"; fi

slots=${HT_HEAVY_SLOTS:-$(( $(nproc) / 6 ))}
if [ -z "${HT_HEAVY_SLOTS:-}" ] && [ "$slots" -lt 2 ]; then slots=2; fi
if [[ ! $slots =~ ^[1-9][0-9]*$ ]]; then echo 'HT_HEAVY_SLOTS must be a positive integer.' >&2; exit 2; fi
lock_dir="${XDG_RUNTIME_DIR:-/tmp}/ht-heavy"
mkdir -p "$lock_dir"
# Never unlink slot files: every worktree must lock the same inodes.
waiting=false
while :; do
  for ((slot=0; slot<slots; slot++)); do
    exec 8>"$lock_dir/slot-$slot"
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
