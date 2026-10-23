#!/usr/bin/env bash
set -euo pipefail

# --exclusive: only one full test run or next build at a time on the box (YPER4-339).
exclusive=false
if [ "${1:-}" = --exclusive ]; then exclusive=true; shift; fi
if [ "$#" -eq 0 ]; then echo 'Usage: scripts/heavy-job.sh [--exclusive] COMMAND [ARG ...]' >&2; exit 2; fi
if [ "${CI:-}" = true ] || [ "${GITHUB_ACTIONS+x}" = x ]; then exec "$@"; fi

check_disk() {
  local critical="${HOME}/.local/state/disk-guard/critical" mtime used
  if [ -f "$critical" ] && mtime=$(stat -c %Y "$critical" 2>/dev/null); then
    if [ $(( $(date +%s) - mtime )) -lt 1800 ]; then
      echo 'Disk guard: disk is critical (>=90% used). Refusing a new heavy job; check ~/.local/state/disk-guard/status.json.' >&2
      exit 75
    fi
  fi
  used=$(df -P / 2>/dev/null | awk 'NR == 2 {gsub(/%/, "", $5); print $5}') || return 0
  if [[ "$used" =~ ^[0-9]+$ ]] && [ "$used" -ge 90 ]; then
    echo 'Disk guard: disk is critical (>=90% used). Refusing a new heavy job; check ~/.local/state/disk-guard/status.json.' >&2
    exit 75
  fi
}
check_disk

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
niceness=${HT_HEAVY_NICE:-19}
if [[ ! $niceness =~ ^(1?[0-9])$ ]]; then echo 'HT_HEAVY_NICE must be 0 to 19.' >&2; exit 2; fi
if [ "$exclusive" = true ]; then
  if [ -L "$lock_dir/exclusive" ]; then echo 'Refusing symlink heavy-job exclusive lock.' >&2; exit 2; fi
  exec 7>>"$lock_dir/exclusive"
  if ! flock -n 7; then
    printf 'waiting for the one full test run or build slot\n' >&"${HT_HEAVY_WAIT_FD:-2}"
    flock 7
  fi
fi
# Never unlink slot files: every worktree must lock the same inodes.
waiting=false
while :; do
  check_disk
  for ((slot=0; slot<slots; slot++)); do
    if [ -L "$lock_dir/slot-$slot" ]; then echo 'Refusing symlink heavy-job slot.' >&2; exit 2; fi
    exec 8>>"$lock_dir/slot-$slot"
    if flock -n 8; then
      check_disk
      # The command inherits the locks, including if this wrapper is interrupted.
      if command -v ionice >/dev/null 2>&1; then set -- ionice -c3 "$@"; fi
      if command -v nice >/dev/null 2>&1; then set -- nice -n "$niceness" "$@"; fi
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
