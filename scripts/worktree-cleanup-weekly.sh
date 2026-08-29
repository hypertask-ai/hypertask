#!/usr/bin/env bash
#
# Remove only agent worktrees that carry an explicit CLEANUP_READY lease.
#
# A lease is issued by the session or supervisor after the PR is merged,
# production is healthy, and the worktree is clean:
#
#   scripts/worktree-cleanup-weekly.sh --mark-ready /absolute/worktree/path
#
# The weekly invocation is intentionally conservative. It removes neither a
# merely closed PR branch nor an unleased worktree, and it never uses an
# unconditional force flag. Every GitHub and remote-ref query must succeed
# before cleanup starts; each candidate is queried again immediately before it
# is removed. A removed-worktree marker is written into the lease before
# branch cleanup can continue, so an arbitrary missing path cannot authorize
# deletion of a branch. Session supervisors must hold the per-worktree lock
# while using a worktree; cleanup also renames a candidate into a private
# quarantine path before removal so the original path cannot be re-entered.
set -Eeuo pipefail
umask 077

REPO_DIR="${REPO_DIR:-/home/valentin/projects/hypertasks}"
REPO_SLUG="${REPO_SLUG:-valentinyeo/hypertasks}"
BASE_BRANCH="${BASE_BRANCH:-staging}"
REMOTE="${REMOTE:-origin}"
STATE_DIR="${STATE_DIR:-}"
LEASE_DIR="${LEASE_DIR:-}"
QUARANTINE_DIR="${QUARANTINE_DIR:-}"
MARKER_KEY_FILE="${MARKER_KEY_FILE:-}"
LOCK_FILE="${LOCK_FILE:-}"
LOG_FILE="${LOG_FILE:-}"
PROC_ROOT="${PROC_ROOT:-/proc}"
LEASE_TTL_SECONDS="${LEASE_TTL_SECONDS:-2592000}"
MIN_MERGED_AGE_SECONDS="${MIN_MERGED_AGE_SECONDS:-1209600}"
DRY_RUN="${DRY_RUN:-0}"
GH_BIN="${GH_BIN:-gh}"
GIT_BIN="${GIT_BIN:-git}"
LS_BIN="${LS_BIN:-ls}"
ID_BIN="${ID_BIN:-id}"
MARK_READY_REQUESTED=0
[[ "${1:-}" == "--mark-ready" ]] && MARK_READY_REQUESTED=1

NOW=$(date +%s)
CURRENT_UID=$($ID_BIN -u)
CURRENT_GID=$($ID_BIN -g)
CURRENT_USER=$($ID_BIN -un)
TMP_DIR=""
WORKTREE_LOCK_FD=""
declare -A PRIVATE_GROUP_CACHE=()

log() {
  printf '%s %s\n' "$(date -Is)" "$*"
}

fatal() {
  log "ABORT: $*"
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  worktree-cleanup-weekly.sh [--dry-run]
  worktree-cleanup-weekly.sh --mark-ready /absolute/worktree/path

The marker command records CLEANUP_READY evidence in the configured state
directory. It does not claim that merge or production verification occurred;
the caller must invoke it only after those checks have completed.
EOF
}

ensure_private_dir() {
  local dir=$1 owner mode_text mode
  [[ -d "$dir" && ! -L "$dir" ]] || fatal "directory is missing or a symlink: $dir"
  owner=$(stat -c '%u' -- "$dir") || fatal "cannot inspect directory owner: $dir"
  [[ "$owner" == "$CURRENT_UID" ]] || fatal "directory is not owned by the current user: $dir"
  mode_text=$(stat -c '%a' -- "$dir") || fatal "cannot inspect directory mode: $dir"
  mode=$((8#$mode_text))
  (( (mode & 022) == 0 )) || fatal "directory is group/world-writable: $dir"
}

ensure_output_target() {
  local file=$1 owner mode_text mode
  [[ ! -L "$file" ]] || fatal "output target is a symlink: $file"
  [[ ! -e "$file" ]] && return 0
  [[ -f "$file" ]] || fatal "output target is not a regular file: $file"
  owner=$(stat -c '%u' -- "$file") || fatal "cannot inspect output owner: $file"
  [[ "$owner" == "$CURRENT_UID" ]] || fatal "output is not owned by the current user: $file"
  mode_text=$(stat -c '%a' -- "$file") || fatal "cannot inspect output mode: $file"
  mode=$((8#$mode_text))
  (( (mode & 022) == 0 )) || fatal "output is group/world-writable: $file"
}

check_group_is_private_to_current_user() {
  local gid=$1 name passwd_rows group_row members member member_gid user_gids
  local -a group_members=()
  [[ "$gid" == "$CURRENT_GID" ]] || return 1
  passwd_rows=$(getent passwd) || return 1
  while IFS=: read -r name _; do
    [[ "$name" == "$CURRENT_USER" ]] && continue
    user_gids=$($ID_BIN -G "$name") || return 1
    for member_gid in $user_gids; do
      [[ "$member_gid" != "$gid" ]] || return 1
    done
  done <<<"$passwd_rows"
  group_row=$(getent group "$gid") || return 1
  members=${group_row##*:}
  IFS=, read -ra group_members <<<"$members"
  for member in "${group_members[@]}"; do
    [[ -z "$member" || "$member" == "$CURRENT_USER" ]] || return 1
  done
}

group_is_private_to_current_user() {
  local gid=$1 cached=${PRIVATE_GROUP_CACHE[$1]-}
  [[ "$cached" != "private" ]] || return 0
  [[ "$cached" != "shared" ]] || return 1
  if check_group_is_private_to_current_user "$gid"; then
    PRIVATE_GROUP_CACHE[$gid]=private
    return 0
  fi
  PRIVATE_GROUP_CACHE[$gid]=shared
  return 1
}

ensure_private_path_ancestors() {
  local target current remainder component mode_text mode owner group access_text
  for target in "$@"; do
    [[ "$target" == /* ]] || fatal "configured path must be absolute: $target"
    current="/"
    remainder=${target#/}
    while [[ -n "$remainder" ]]; do
      if [[ "$remainder" == */* ]]; then
        component=${remainder%%/*}
        remainder=${remainder#*/}
      else
        component=$remainder
        remainder=""
      fi
      [[ -n "$component" ]] || continue
      if [[ "$current" == "/" ]]; then
        current="/$component"
      else
        current="$current/$component"
      fi
      [[ ! -L "$current" ]] || fatal "configured path has a symlinked ancestor: $current"
      [[ -e "$current" ]] || break
      [[ -d "$current" ]] || fatal "configured path ancestor is not a directory: $current"
      mode_text=$(stat -c '%a' -- "$current") || fatal "cannot inspect path ancestor: $current"
      mode=$((8#$mode_text))
      # Shared sticky directories such as /tmp are safe parents for private
      # state. A private primary group is also safe because no other account
      # can use its group-write bit.
      if (( (mode & 0002) != 0 && (mode & 01000) == 0 )); then
        fatal "configured path ancestor is world-writable: $current"
      fi
      if (( (mode & 0020) != 0 && (mode & 01000) == 0 )); then
        owner=$(stat -c '%u' -- "$current") || fatal "cannot inspect path owner: $current"
        group=$(stat -c '%g' -- "$current") || fatal "cannot inspect path group: $current"
        access_text=$(LC_ALL=C "$LS_BIN" -ld -- "$current") \
          || fatal "cannot inspect path ACL: $current"
        access_text=${access_text%% *}
        [[ ${#access_text} -eq 10 ]] \
          || fatal "configured path ancestor has an extended ACL: $current"
        if [[ "$owner" != "$CURRENT_UID" ]] || ! group_is_private_to_current_user "$group"; then
          fatal "configured path ancestor is writable by another group: $current"
        fi
      fi
    done
  done
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

repo_root=$($GIT_BIN -C "$REPO_DIR" rev-parse --show-toplevel 2>/dev/null) \
  || fatal "not a git repository: $REPO_DIR"
repo_root=$(realpath -e -- "$repo_root") || fatal "cannot resolve repository root"
configured_root=$(realpath -e -- "$REPO_DIR") || fatal "cannot resolve REPO_DIR"
[[ "$repo_root" == "$configured_root" ]] || fatal "REPO_DIR is not the repository root"
git_common_dir=$($GIT_BIN -C "$REPO_DIR" rev-parse --git-common-dir 2>/dev/null) \
  || fatal "cannot resolve repository common directory"
if [[ "$git_common_dir" != /* ]]; then
  git_common_dir="$REPO_DIR/$git_common_dir"
fi
git_common_dir=$(realpath -e -- "$git_common_dir") \
  || fatal "cannot resolve repository common directory"

STATE_DIR="${STATE_DIR:-$git_common_dir/hypertask-worktree-cleanup}"
LEASE_DIR="${LEASE_DIR:-$STATE_DIR/leases}"
QUARANTINE_DIR="${QUARANTINE_DIR:-$STATE_DIR/quarantine}"
MARKER_KEY_FILE="${MARKER_KEY_FILE:-$STATE_DIR/marker.key}"
LOCK_FILE="${LOCK_FILE:-$STATE_DIR/cleanup.lock}"
LOG_FILE="${LOG_FILE:-$STATE_DIR/worktree-cleanup-$(date +%F).log}"

LOG_DIR=$(dirname -- "$LOG_FILE")
LOCK_DIR=$(dirname -- "$LOCK_FILE")
KEY_DIR=$(dirname -- "$MARKER_KEY_FILE")
ensure_private_path_ancestors "$STATE_DIR" "$LEASE_DIR" "$QUARANTINE_DIR" "$KEY_DIR" "$LOG_DIR" "$LOCK_DIR"
mkdir -p "$STATE_DIR" "$LEASE_DIR" "$QUARANTINE_DIR" "$KEY_DIR" "$LOG_DIR" "$LOCK_DIR"
ensure_private_dir "$STATE_DIR"
ensure_private_dir "$LEASE_DIR"
ensure_private_dir "$QUARANTINE_DIR"
ensure_private_dir "$KEY_DIR"
ensure_private_dir "$LOG_DIR"
ensure_private_dir "$LOCK_DIR"
chmod 700 "$STATE_DIR" "$LEASE_DIR" "$QUARANTINE_DIR"
ensure_output_target "$LOG_FILE"
ensure_output_target "$LOCK_FILE"

command -v openssl >/dev/null 2>&1 || fatal "OpenSSL is unavailable"
[[ ! -L "$MARKER_KEY_FILE" ]] || fatal "marker key is a symlink"
if [[ ! -e "$MARKER_KEY_FILE" ]]; then
  marker_key_temp=$(mktemp "$KEY_DIR/.marker-key.XXXXXX") || fatal "cannot create marker key"
  chmod 600 "$marker_key_temp"
  if ! openssl rand -hex 32 | tr -d '\n' >"$marker_key_temp"; then
    rm -f -- "$marker_key_temp"
    fatal "cannot generate marker key"
  fi
  mv -f -- "$marker_key_temp" "$MARKER_KEY_FILE"
fi
[[ -f "$MARKER_KEY_FILE" && ! -L "$MARKER_KEY_FILE" ]] \
  || fatal "marker key is missing or a symlink"
[[ "$(stat -c '%u' -- "$MARKER_KEY_FILE")" == "$CURRENT_UID" ]] \
  || fatal "marker key is not owned by the current user"
marker_key_mode=$((8#$(stat -c '%a' -- "$MARKER_KEY_FILE")))
(( (marker_key_mode & 077) == 0 )) || fatal "marker key is readable by another user"
MARKER_KEY=$(<"$MARKER_KEY_FILE")
[[ "$MARKER_KEY" =~ ^[0-9a-f]{64}$ ]] || fatal "marker key has an invalid format"
exec >>"$LOG_FILE" 2>&1
exec 9>"$LOCK_FILE"
chmod 600 "$LOCK_FILE"
if ! flock -n 9; then
  log "another cleanup run holds $LOCK_FILE; leaving everything unchanged"
  if (( MARK_READY_REQUESTED == 1 )); then
    exit 75
  fi
  exit 0
fi

[[ "${1:-}" != "--dry-run" ]] || DRY_RUN=1
log "=== worktree-cleanup-weekly start repo=$REPO_DIR dry_run=$DRY_RUN ==="

cleanup_tmp() {
  if [[ -n "$TMP_DIR" && -d "$TMP_DIR" ]]; then
    rm -rf -- "$TMP_DIR"
  fi
}
trap cleanup_tmp EXIT

lease_id() {
  printf '%s' "$1" | sha256sum | awk '{print $1}'
}

marker_payload() {
  printf 'CLEANUP_READY\nformat=1\npath=%s\nbranch=%s\ntip=%s\nissued_at=%s\nremoved_at=%s\n' \
    "$1" "$2" "$3" "$4" "$5"
}

marker_mac() {
  marker_payload "$@" \
    | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$MARKER_KEY" -binary \
    | od -An -v -tx1 | tr -d ' \n'
}

verify_removed_marker() {
  local path=$1 branch=$2 tip=$3 issued_at=$4 removed_at=$5 removed_mac=$6 expected
  expected=$(marker_mac "$path" "$branch" "$tip" "$issued_at" "$removed_at") || return 1
  [[ "$removed_mac" == "$expected" ]]
}

remote_marker_payload() {
  printf 'CLEANUP_READY\nformat=1\npath=%s\nbranch=%s\ntip=%s\nissued_at=%s\nremoved_at=%s\nremote_deleted_at=%s\n' \
    "$1" "$2" "$3" "$4" "$5" "$6"
}

remote_marker_mac() {
  remote_marker_payload "$@" \
    | openssl dgst -sha256 -mac HMAC -macopt "hexkey:$MARKER_KEY" -binary \
    | od -An -v -tx1 | tr -d ' \n'
}

verify_remote_marker() {
  local path=$1 branch=$2 tip=$3 issued_at=$4 removed_at=$5 remote_deleted_at=$6
  local remote_deleted_mac=$7 expected
  expected=$(remote_marker_mac \
    "$path" "$branch" "$tip" "$issued_at" "$removed_at" "$remote_deleted_at") || return 1
  [[ "$remote_deleted_mac" == "$expected" ]]
}

lease_file_for() {
  printf '%s/%s.lease\n' "$LEASE_DIR" "$(lease_id "$1")"
}

worktree_lock_file_for() {
  printf '%s/%s.lock\n' "$LEASE_DIR" "$(lease_id "$1")"
}

check_secure_file() {
  local file=$1 mode_text mode
  [[ -f "$file" && ! -L "$file" ]] || return 1
  [[ "$(stat -c '%u' -- "$file")" == "$CURRENT_UID" ]] || return 1
  mode_text=$(stat -c '%a' -- "$file")
  mode=$((8#$mode_text))
  (( (mode & 077) == 0 )) || return 1
}

acquire_worktree_lock() {
  local branch=$1 file fd
  file=$(worktree_lock_file_for "$branch")
  [[ ! -L "$file" ]] || return 1
  if [[ -e "$file" ]]; then
    check_secure_file "$file" || return 1
  fi
  exec {fd}>>"$file" || return 1
  chmod 600 -- "$file" || { exec {fd}>&-; return 1; }
  if ! flock -n "$fd"; then
    exec {fd}>&-
    return 1
  fi
  WORKTREE_LOCK_FD=$fd
}

release_worktree_lock() {
  local fd
  [[ -n "$WORKTREE_LOCK_FD" ]] || return 0
  fd=$WORKTREE_LOCK_FD
  flock -u "$fd" || true
  exec {fd}>&-
  WORKTREE_LOCK_FD=""
}

parse_lease() {
  local file=$1 line key value first="" format="" path="" branch="" tip="" issued_at=""
  local removed_at="" removed_mac="" remote_deleted_at="" remote_deleted_mac=""
  local -A seen=()

  check_secure_file "$file" || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "$first" ]]; then
      first=$line
      continue
    fi
    [[ "$line" == *=* ]] || return 1
    key=${line%%=*}
    value=${line#*=}
    [[ -n "$key" && -z "${seen[$key]+yes}" ]] || return 1
    seen[$key]=1
    case "$key" in
      format) format=$value ;;
      path) path=$value ;;
      branch) branch=$value ;;
      tip) tip=$value ;;
      issued_at) issued_at=$value ;;
      removed_at) removed_at=$value ;;
      removed_mac) removed_mac=$value ;;
      remote_deleted_at) remote_deleted_at=$value ;;
      remote_deleted_mac) remote_deleted_mac=$value ;;
      *) return 1 ;;
    esac
  done <"$file"

  [[ "$first" == "CLEANUP_READY" && "$format" == "1" ]] || return 1
  [[ -n "$path" && "$path" == /* ]] || return 1
  [[ -n "$branch" ]] || return 1
  [[ "$tip" =~ ^[0-9a-f]{40}$ ]] || return 1
  [[ "$issued_at" =~ ^[0-9]+$ ]] || return 1
  (( issued_at <= NOW + 300 )) || return 1
  if [[ -z "$removed_at" ]]; then
    (( NOW - issued_at <= LEASE_TTL_SECONDS )) || return 1
  fi
  if [[ -n "$removed_at" || -n "$removed_mac" ]]; then
    [[ -n "$removed_at" && "$removed_mac" =~ ^[0-9a-f]{64}$ ]] || return 1
    [[ "$removed_at" =~ ^[0-9]+$ ]] || return 1
    (( removed_at >= issued_at )) || return 1
    (( removed_at <= NOW + 300 )) || return 1
    verify_removed_marker "$path" "$branch" "$tip" "$issued_at" "$removed_at" "$removed_mac" \
      || return 1
  else
    [[ -z "$removed_mac" ]] || return 1
  fi
  if [[ -n "$remote_deleted_at" || -n "$remote_deleted_mac" ]]; then
    [[ -n "$removed_at" && "$remote_deleted_at" =~ ^[0-9]+$ \
      && "$remote_deleted_mac" =~ ^[0-9a-f]{64}$ ]] || return 1
    (( remote_deleted_at >= removed_at )) || return 1
    (( remote_deleted_at <= NOW + 300 )) || return 1
    verify_remote_marker "$path" "$branch" "$tip" "$issued_at" "$removed_at" \
      "$remote_deleted_at" "$remote_deleted_mac" || return 1
  else
    [[ -z "$remote_deleted_mac" ]] || return 1
  fi
  [[ "$(basename "$file")" == "$(lease_id "$path").lease" ]] || return 1

  LEASE_PATH=$path
  LEASE_BRANCH=$branch
  LEASE_TIP=$tip
  LEASE_ISSUED_AT=$issued_at
  LEASE_REMOVED_AT=$removed_at
  LEASE_REMOVED_MAC=$removed_mac
  LEASE_REMOTE_DELETED_AT=$remote_deleted_at
  LEASE_REMOTE_DELETED_MAC=$remote_deleted_mac
}

backup_ref_for_lease() {
  local lease_file=$1 id
  id=$(basename -- "$lease_file" .lease)
  [[ "$id" =~ ^[0-9a-f]{64}$ ]] || return 1
  printf 'refs/hypertask-cleanup/%s\n' "$id"
}

backup_tip() {
  local lease_file=$1 ref status
  ref=$(backup_ref_for_lease "$lease_file") || return 1
  if $GIT_BIN -C "$REPO_DIR" show-ref --verify --quiet "$ref"; then
    $GIT_BIN -C "$REPO_DIR" rev-parse --verify "$ref" \
      || fatal "cleanup backup-ref query failed: $ref"
    return 0
  else
    status=$?
  fi
  (( status == 1 )) || fatal "cleanup backup-ref query failed: $ref"
}

ensure_backup_ref() {
  local lease_file=$1 tip=$2 ref current
  ref=$(backup_ref_for_lease "$lease_file") || return 1
  current=$(backup_tip "$lease_file")
  [[ -z "$current" || "$current" == "$tip" ]] || return 1
  if [[ -z "$current" ]]; then
    $GIT_BIN -C "$REPO_DIR" update-ref "$ref" "$tip" "" || return 1
  fi
  [[ "$(backup_tip "$lease_file")" == "$tip" ]]
}

path_is_registered() {
  local target=$1 expected_branch=$2 line path="" branch="" found=1 worktree_output
  worktree_output=$($GIT_BIN -C "$REPO_DIR" worktree list --porcelain) \
    || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "worktree "*)
        if [[ "$path" == "$target" && "$branch" == "$expected_branch" ]]; then
          found=0
          break
        fi
        path=${line#worktree }
        branch=""
        ;;
      "branch refs/heads/"*)
        branch=${line#branch refs/heads/}
        ;;
      "")
        if [[ "$path" == "$target" && "$branch" == "$expected_branch" ]]; then
          found=0
          break
        fi
        ;;
    esac
  done <<<"$worktree_output"
  if [[ "$path" == "$target" && "$branch" == "$expected_branch" ]]; then
    found=0
  fi
  return "$found"
}

branch_is_registered() {
  local expected_branch=$1 line worktree_output
  worktree_output=$($GIT_BIN -C "$REPO_DIR" worktree list --porcelain) \
    || fatal "worktree registration query failed"
  while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ "$line" == "branch refs/heads/$expected_branch" ]]; then
      return 0
    fi
  done <<<"$worktree_output"
  return 1
}

worktree_branch_for_path() {
  local target=$1 line path="" branch="" worktree_output
  worktree_output=$($GIT_BIN -C "$REPO_DIR" worktree list --porcelain) \
    || return 1
  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      "worktree "*)
        if [[ "$path" == "$target" ]]; then
          printf '%s\n' "$branch"
          return 0
        fi
        path=${line#worktree }
        branch=""
        ;;
      "branch refs/heads/"*) branch=${line#branch refs/heads/} ;;
      "")
        if [[ "$path" == "$target" ]]; then
          printf '%s\n' "$branch"
          return 0
        fi
        ;;
    esac
  done <<<"$worktree_output"
  if [[ "$path" == "$target" ]]; then
    printf '%s\n' "$branch"
    return 0
  fi
  return 1
}

path_is_in_use() {
  local target=$1 cwd
  while IFS= read -r cwd || [[ -n "$cwd" ]]; do
    if [[ "$cwd" == "$target" || "$cwd" == "$target/"* ]]; then
      return 0
    fi
  done <"$TMP_DIR/live-cwds"
  return 1
}

restore_quarantined_worktree() {
  local quarantine=$1 original=$2
  [[ ! -e "$original" && ! -L "$original" ]] || return 1
  $GIT_BIN -C "$REPO_DIR" worktree move -- "$quarantine" "$original"
}

quarantine_worktree() {
  local path=$1 branch=$2 quarantine
  quarantine=$(printf '%s/%s' "$QUARANTINE_DIR" "$(lease_id "$path")")
  [[ ! -e "$quarantine" && ! -L "$quarantine" ]] || return 1
  $GIT_BIN -C "$REPO_DIR" worktree move -- "$path" "$quarantine" || return 1

  refresh_live_cwds
  if path_is_in_use "$path" || path_is_in_use "$quarantine" \
      || ! path_is_registered "$quarantine" "$branch" \
      || ! status_is_clean "$quarantine"; then
    log "quarantined worktree became live, changed, or unregistered: $path"
    if ! restore_quarantined_worktree "$quarantine" "$path"; then
      fatal "cannot restore quarantined worktree: $path"
    fi
    return 1
  fi
  QUARANTINED_PATH=$quarantine
}

refresh_live_cwds() {
  local proc cwd cwd_link
  : >"$TMP_DIR/live-cwds"
  for proc in "$PROC_ROOT"/[0-9]*/cwd; do
    [[ -e "$proc" ]] || continue
    if ! cwd_link=$(readlink -- "$proc" 2>/dev/null); then
      [[ ! -e "$proc" ]] && continue
      fatal "cannot inspect process cwd: $proc"
    fi
    # A process may keep a deleted directory as cwd. It cannot be using an
    # existing candidate path, so it is safe to omit that unreachable path.
    [[ "$cwd_link" == *' (deleted)' ]] && continue
    if ! cwd=$(realpath -e -- "$cwd_link" 2>/dev/null); then
      [[ ! -e "$proc" ]] && continue
      fatal "cannot resolve process cwd: $proc"
    fi
    printf '%s\n' "$cwd" >>"$TMP_DIR/live-cwds"
  done
}

status_is_clean() {
  local path=$1 status ignored ignored_file
  status=$($GIT_BIN -C "$path" status --porcelain=v1 --untracked-files=all 2>/dev/null) || return 1
  [[ -z "$status" ]] || return 1
  ignored_file=$(mktemp) || return 1
  if ! $GIT_BIN -C "$path" status --porcelain=v1 -z --untracked-files=normal \
      --ignored=matching >"$ignored_file" 2>/dev/null; then
    rm -f -- "$ignored_file"
    return 1
  fi
  while IFS= read -r -d '' ignored; do
    case "$ignored" in
      "!! node_modules/"|"!! .next/"|"!! tsconfig.tsbuildinfo") ;;
      *) rm -f -- "$ignored_file"; return 1 ;;
    esac
  done <"$ignored_file"
  rm -f -- "$ignored_file"
}

local_tip() {
  local branch=$1 status
  if $GIT_BIN -C "$REPO_DIR" show-ref --verify --quiet "refs/heads/$branch"; then
    $GIT_BIN -C "$REPO_DIR" rev-parse --verify "refs/heads/$branch" \
      || fatal "local-ref query failed for $branch"
    return 0
  else
    status=$?
  fi
  (( status == 1 )) || fatal "local-ref query failed for $branch"
}

remote_tip() {
  local branch=$1 output oid ref extra
  if ! output=$($GIT_BIN -C "$REPO_DIR" ls-remote --heads "$REMOTE" "refs/heads/$branch"); then
    fatal "remote-ref query failed for $branch"
  fi
  [[ -z "$output" ]] && return 0
  [[ "$(wc -l <<<"$output")" -eq 1 ]] \
    || fatal "unexpected multiple remote-ref rows for $branch"
  read -r oid ref extra <<<"$output"
  [[ -z "${extra:-}" && "$ref" == "refs/heads/$branch" && "$oid" =~ ^[0-9a-f]{40}$ ]] \
    || fatal "unexpected remote-ref response for $branch"
  printf '%s\n' "$oid"
}

query_prs() {
  local branch=$1 output
  if ! output=$($GH_BIN pr list \
      --repo "$REPO_SLUG" \
      --state all \
      --head "$branch" \
      --limit 100 \
      --json number,state,mergedAt,headRefName,headRefOid,baseRefName); then
    fatal "GitHub PR query failed for branch $branch"
  fi
  if ! printf '%s' "$output" | jq -e '
      type == "array" and
      all(.[];
        (.state | type) == "string" and
        (.headRefName | type) == "string" and
        (.headRefOid | type) == "string" and
        (.baseRefName | type) == "string" and
        ((.mergedAt == null) or (.mergedAt | type) == "string")
      )' >/dev/null; then
    fatal "GitHub PR query returned invalid JSON for branch $branch"
  fi
  PR_JSON=$output
}

query_open_prs() {
  local branch=$1 failure_mode=${2:-fatal} output
  if ! output=$($GH_BIN pr list \
      --repo "$REPO_SLUG" \
      --state open \
      --head "$branch" \
      --limit 1 \
      --json number); then
    if [[ "$failure_mode" == "preserve" ]]; then
      log "GitHub open-PR post-delete query failed: $branch"
      return 1
    fi
    fatal "GitHub open-PR query failed for branch $branch"
  fi
  if ! printf '%s' "$output" | jq -e '
      type == "array" and
      length <= 1 and
      all(.[]; (.number | type) == "number")' >/dev/null; then
    if [[ "$failure_mode" == "preserve" ]]; then
      log "GitHub open-PR post-delete query returned invalid JSON: $branch"
      return 1
    fi
    fatal "GitHub open-PR query returned invalid JSON for branch $branch"
  fi
  OPEN_PR_JSON=$output
}

no_open_pr_is_proven() {
  printf '%s' "$OPEN_PR_JSON" | jq -e 'length == 0' >/dev/null
}

preload_remote_refs() {
  local output line oid ref extra branch
  if ! output=$($GIT_BIN -C "$REPO_DIR" ls-remote --heads "$REMOTE"); then
    fatal "remote-ref preload failed"
  fi
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -n "$line" ]] || continue
    read -r oid ref extra <<<"$line"
    [[ -z "${extra:-}" && "$ref" == refs/heads/* && "$oid" =~ ^[0-9a-f]{40}$ ]] \
      || fatal "unexpected remote-ref preload response"
    branch=${ref#refs/heads/}
    PRELOADED_REMOTE_TIPS[$branch]=$oid
  done <<<"$output"
}

preloaded_remote_tip() {
  printf '%s\n' "${PRELOADED_REMOTE_TIPS[$1]-}"
}

preload_prs() {
  local output
  if ! output=$($GH_BIN pr list \
      --repo "$REPO_SLUG" \
      --state all \
      --limit 1000 \
      --json number,state,mergedAt,headRefName,headRefOid,baseRefName); then
    fatal "GitHub PR preload failed"
  fi
  if ! printf '%s' "$output" | jq -e '
      type == "array" and
      all(.[];
        (.state | type) == "string" and
        (.headRefName | type) == "string" and
        (.headRefOid | type) == "string" and
        (.baseRefName | type) == "string" and
        ((.mergedAt == null) or (.mergedAt | type) == "string")
      )' >/dev/null; then
    fatal "GitHub PR preload returned invalid JSON"
  fi
  PRELOADED_PR_JSON=$output
}

preloaded_query_prs() {
  local branch=$1
  PR_JSON=$(printf '%s' "$PRELOADED_PR_JSON" | jq -c --arg branch "$branch" \
    '[.[] | select(.headRefName == $branch)]') \
    || fatal "cannot filter preloaded GitHub PR data for branch $branch"
}

merged_tip_is_proven() {
  local branch=$1 tip=$2
  printf '%s' "$PR_JSON" | jq -e \
    --arg branch "$branch" \
    --arg tip "$tip" \
    --arg base "$BASE_BRANCH" \
    --argjson oldest "$((NOW - MIN_MERGED_AGE_SECONDS))" '
      (any(.[]; .state == "OPEN") | not) and
      any(.[];
        .state == "MERGED" and
        .mergedAt != null and
        (.mergedAt | fromdateiso8601) <= $oldest and
        .headRefName == $branch and
        .headRefOid == $tip and
        .baseRefName == $base
      )' >/dev/null
}

mark_ready() {
  local requested=$1 path branch tip lease_file temp
  [[ ! -L "$requested" ]] || fatal "worktree path is a symlink: $requested"
  path=$(realpath -e -- "$requested") || fatal "cannot resolve worktree: $requested"
  [[ "$path" != *$'\n'* && "$path" != *$'\r'* ]] \
    || fatal "worktree path contains a line break: $path"
  [[ "$path" != "$repo_root" ]] || fatal "the primary repository worktree cannot be leased"
  branch=$(worktree_branch_for_path "$path") || fatal "path is not a registered branch worktree: $path"
  [[ "$branch" != "$BASE_BRANCH" && "$branch" != "main" ]] || fatal "protected branch: $branch"
  acquire_worktree_lock "$branch" || fatal "worktree cleanup lock is busy or unsafe: $path"
  $GIT_BIN -C "$path" symbolic-ref --quiet --short HEAD >/dev/null \
    || fatal "worktree is detached: $path"
  status_is_clean "$path" || fatal "worktree is not clean: $path"
  tip=$($GIT_BIN -C "$path" rev-parse --verify HEAD) \
    || fatal "cannot read worktree tip: $path"
  [[ "$tip" =~ ^[0-9a-f]{40}$ ]] || fatal "invalid worktree tip: $tip"

  lease_file=$(lease_file_for "$path")
  temp=$(mktemp "$LEASE_DIR/.lease.XXXXXX")
  chmod 600 "$temp"
  printf 'CLEANUP_READY\nformat=1\npath=%s\nbranch=%s\ntip=%s\nissued_at=%s\n' \
    "$path" "$branch" "$tip" "$NOW" >"$temp"
  mv -f -- "$temp" "$lease_file"
  release_worktree_lock
  log "issued CLEANUP_READY lease path=$path branch=$branch tip=$tip"
}

mark_worktree_removed() {
  local lease_file=$1 removed_at removed_mac temp
  check_secure_file "$lease_file" || return 1
  parse_lease "$lease_file" || return 1
  [[ -z "$LEASE_REMOVED_AT" && -z "$LEASE_REMOVED_MAC" ]] || return 1
  removed_at=$NOW
  removed_mac=$(marker_mac "$LEASE_PATH" "$LEASE_BRANCH" "$LEASE_TIP" "$LEASE_ISSUED_AT" "$removed_at") \
    || return 1
  temp=$(mktemp "$LEASE_DIR/.lease.XXXXXX") || return 1
  chmod 600 "$temp" || { rm -f -- "$temp"; return 1; }
  if ! cat -- "$lease_file" >"$temp"; then
    rm -f -- "$temp"
    return 1
  fi
  if ! printf 'removed_at=%s\nremoved_mac=%s\n' "$removed_at" "$removed_mac" >>"$temp"; then
    rm -f -- "$temp"
    return 1
  fi
  if ! mv -f -- "$temp" "$lease_file"; then
    rm -f -- "$temp"
    return 1
  fi
}

mark_remote_deleted() {
  local lease_file=$1 remote_deleted_at remote_deleted_mac temp
  check_secure_file "$lease_file" || return 1
  parse_lease "$lease_file" || return 1
  [[ -n "$LEASE_REMOVED_AT" && -n "$LEASE_REMOVED_MAC" \
    && -z "$LEASE_REMOTE_DELETED_AT" && -z "$LEASE_REMOTE_DELETED_MAC" ]] || return 1
  remote_deleted_at=$NOW
  remote_deleted_mac=$(remote_marker_mac \
    "$LEASE_PATH" "$LEASE_BRANCH" "$LEASE_TIP" "$LEASE_ISSUED_AT" \
    "$LEASE_REMOVED_AT" "$remote_deleted_at") || return 1
  temp=$(mktemp "$LEASE_DIR/.lease.XXXXXX") || return 1
  chmod 600 "$temp" || { rm -f -- "$temp"; return 1; }
  if ! cat -- "$lease_file" >"$temp" \
      || ! printf 'remote_deleted_at=%s\nremote_deleted_mac=%s\n' \
        "$remote_deleted_at" "$remote_deleted_mac" >>"$temp" \
      || ! mv -f -- "$temp" "$lease_file"; then
    rm -f -- "$temp"
    return 1
  fi
}

clear_remote_deleted() {
  local lease_file=$1 temp
  check_secure_file "$lease_file" || return 1
  parse_lease "$lease_file" || return 1
  [[ -n "$LEASE_REMOVED_AT" && -n "$LEASE_REMOVED_MAC" \
    && -n "$LEASE_REMOTE_DELETED_AT" && -n "$LEASE_REMOTE_DELETED_MAC" ]] || return 1
  temp=$(mktemp "$LEASE_DIR/.lease.XXXXXX") || return 1
  chmod 600 "$temp" || { rm -f -- "$temp"; return 1; }
  if ! printf 'CLEANUP_READY\nformat=1\npath=%s\nbranch=%s\ntip=%s\nissued_at=%s\nremoved_at=%s\nremoved_mac=%s\n' \
      "$LEASE_PATH" "$LEASE_BRANCH" "$LEASE_TIP" "$LEASE_ISSUED_AT" \
      "$LEASE_REMOVED_AT" "$LEASE_REMOVED_MAC" >"$temp" \
      || ! mv -f -- "$temp" "$lease_file"; then
    rm -f -- "$temp"
    return 1
  fi
}

if [[ "${1:-}" == "--mark-ready" ]]; then
  [[ $# -eq 2 ]] || { usage >&2; exit 2; }
  mark_ready "$2"
  exit 0
fi

if [[ $# -gt 1 || ( $# -eq 1 && "${1:-}" != "--dry-run" ) ]]; then
  usage >&2
  exit 2
fi
[[ "${1:-}" != "--dry-run" ]] || DRY_RUN=1

command -v "$GH_BIN" >/dev/null 2>&1 || fatal "GitHub CLI is unavailable: $GH_BIN"
command -v jq >/dev/null 2>&1 || fatal "jq is unavailable"
$GIT_BIN -C "$REPO_DIR" worktree list --porcelain >/dev/null \
  || fatal "cannot enumerate worktrees"

TMP_DIR=$(mktemp -d)
refresh_live_cwds
LEASE_LIST=$(find "$LEASE_DIR" -maxdepth 1 -type f -name '*.lease' -print | sort) \
  || fatal "cannot enumerate cleanup leases"

declare -A PRELOADED_REMOTE_TIPS=()
PRELOADED_PR_JSON='[]'
if [[ -n "$LEASE_LIST" ]]; then
  preload_remote_refs
  preload_prs
fi

declare -a CANDIDATE_FILES=()
declare -a CANDIDATE_PATHS=()
declare -a CANDIDATE_BRANCHES=()
declare -a CANDIDATE_TIPS=()
declare -a CANDIDATE_PHASES=()
declare -a CANDIDATE_REMOVED_AT=()
declare -a CANDIDATE_REMOVED_MAC=()
declare -a CANDIDATE_REMOTE_DELETED_AT=()
declare -a CANDIDATE_REMOTE_DELETED_MAC=()

candidate_count=0
while IFS= read -r lease_file || [[ -n "$lease_file" ]]; do
  [[ -n "$lease_file" ]] || continue
  if ! parse_lease "$lease_file"; then
    log "skipping invalid or expired lease: $lease_file"
    continue
  fi

  path=$LEASE_PATH
  branch=$LEASE_BRANCH
  tip=$LEASE_TIP
  removed_at=$LEASE_REMOVED_AT
  remote_deleted_at=$LEASE_REMOTE_DELETED_AT
  [[ "$branch" != "$BASE_BRANCH" && "$branch" != "main" ]] || {
    log "skipping protected branch lease: $branch"
    continue
  }
  $GIT_BIN -C "$REPO_DIR" check-ref-format --branch "$branch" >/dev/null 2>&1 || {
    log "skipping invalid branch lease: $branch"
    continue
  }

  phase=branch
  if [[ -e "$path" ]]; then
    [[ ! -L "$path" ]] || {
      log "skipping symlinked lease path: $path"
      continue
    }
    path=$(realpath -e -- "$path") || { log "skipping vanished lease path: $LEASE_PATH"; continue; }
    [[ -z "$removed_at" ]] || {
      log "skipping worktree path that reappeared after removal: $path"
      continue
    }
    path_is_registered "$path" "$branch" || {
      log "skipping path no longer registered to branch: $path"
      continue
    }
    [[ "$path" != "$repo_root" ]] || { log "skipping primary worktree lease"; continue; }
    current_tip=$($GIT_BIN -C "$path" rev-parse --verify HEAD 2>/dev/null || true)
    [[ "$current_tip" == "$tip" ]] || { log "skipping changed worktree tip: $path"; continue; }
    status_is_clean "$path" || { log "skipping dirty worktree: $path"; continue; }
    if path_is_in_use "$path"; then
      log "skipping live worktree: $path"
      continue
    fi
    phase=worktree
  elif [[ -d "$path" ]]; then
    log "skipping unreadable lease path: $LEASE_PATH"
    continue
  elif [[ -z "$removed_at" ]]; then
    log "skipping missing path without a script-issued removal marker: $LEASE_PATH"
    continue
  fi

  current_local_tip=$(local_tip "$branch")
  [[ -z "$current_local_tip" || "$current_local_tip" == "$tip" ]] || {
    log "skipping changed local branch tip: $branch"
    continue
  }
  current_remote_tip=$(preloaded_remote_tip "$branch")
  [[ -z "$current_remote_tip" || "$current_remote_tip" == "$tip" ]] || {
    log "skipping changed remote branch tip: $branch"
    continue
  }
  if [[ "$phase" == "branch" && -z "$current_remote_tip" ]]; then
    if [[ -n "$remote_deleted_at" ]]; then
      phase=tombstone
    else
      phase=restore
    fi
    [[ "$(backup_tip "$lease_file")" == "$tip" ]] || {
      log "skipping recovery lease without its exact backup ref: $branch"
      continue
    }
  elif [[ "$phase" == "branch" && -n "$remote_deleted_at" ]]; then
    phase=settle
    [[ "$(backup_tip "$lease_file")" == "$tip" ]] || {
      log "skipping recovery lease without its exact backup ref: $branch"
      continue
    }
  else
    preloaded_query_prs "$branch"
    merged_tip_is_proven "$branch" "$tip" || {
      log "skipping branch without a merged PR proof at the leased tip: $branch"
      continue
    }
  fi

  CANDIDATE_FILES[$candidate_count]=$lease_file
  CANDIDATE_PATHS[$candidate_count]=$path
  CANDIDATE_BRANCHES[$candidate_count]=$branch
  CANDIDATE_TIPS[$candidate_count]=$tip
  CANDIDATE_PHASES[$candidate_count]=$phase
  CANDIDATE_REMOVED_AT[$candidate_count]=$removed_at
  CANDIDATE_REMOVED_MAC[$candidate_count]=$LEASE_REMOVED_MAC
  CANDIDATE_REMOTE_DELETED_AT[$candidate_count]=$remote_deleted_at
  CANDIDATE_REMOTE_DELETED_MAC[$candidate_count]=$LEASE_REMOTE_DELETED_MAC
  candidate_count=$((candidate_count + 1))
done <<<"$LEASE_LIST"

log "preflight candidates=$candidate_count"

revalidate_candidate() {
  local index=$1 path=${CANDIDATE_PATHS[$1]} branch=${CANDIDATE_BRANCHES[$1]} tip=${CANDIDATE_TIPS[$1]}
  local phase=${CANDIDATE_PHASES[$1]} removed_at=${CANDIDATE_REMOVED_AT[$1]}
  local current_tip current_local_tip current_remote_tip

  if [[ "$phase" == "restore" || "$phase" == "tombstone" ]]; then
    [[ ! -e "$path" && ! -L "$path" && "$removed_at" =~ ^[0-9]+$ ]] || return 1
    current_local_tip=$(local_tip "$branch")
    [[ -z "$current_local_tip" || "$current_local_tip" == "$tip" ]] || return 1
    [[ "$(backup_tip "${CANDIDATE_FILES[$index]}")" == "$tip" ]] || return 1
    [[ -z "$(remote_tip "$branch")" ]] || return 1
    if [[ "$phase" == "tombstone" ]]; then
      query_open_prs "$branch"
    fi
    return
  fi

  if [[ "$phase" == "settle" ]]; then
    [[ ! -e "$path" && ! -L "$path" && "$removed_at" =~ ^[0-9]+$ ]] || return 1
    [[ "$(backup_tip "${CANDIDATE_FILES[$index]}")" == "$tip" ]] || return 1
    [[ "$(remote_tip "$branch")" == "$tip" ]]
    return
  fi

  if [[ "$phase" == "worktree" ]]; then
    refresh_live_cwds
    [[ -e "$path" ]] || return 1
    path_is_registered "$path" "$branch" || return 1
    current_tip=$($GIT_BIN -C "$path" rev-parse --verify HEAD 2>/dev/null || true)
    [[ "$current_tip" == "$tip" ]] || return 1
    status_is_clean "$path" || return 1
    path_is_in_use "$path" && return 1
  else
    [[ ! -e "$path" && ! -L "$path" ]] || return 1
    if path_is_registered "$path" "$branch"; then
      return 1
    fi
    branch_is_registered "$branch" && return 1
    [[ "$removed_at" =~ ^[0-9]+$ ]] || return 1
  fi

  current_local_tip=$(local_tip "$branch")
  [[ -z "$current_local_tip" || "$current_local_tip" == "$tip" ]] || return 1
  current_remote_tip=$(remote_tip "$branch")
  [[ -z "$current_remote_tip" || "$current_remote_tip" == "$tip" ]] || return 1
  query_prs "$branch"
  query_open_prs "$branch"
  no_open_pr_is_proven && merged_tip_is_proven "$branch" "$tip"
}

for ((i = 0; i < candidate_count; i++)); do
  lease_file=${CANDIDATE_FILES[$i]}
  path=${CANDIDATE_PATHS[$i]}
  branch=${CANDIDATE_BRANCHES[$i]}
  tip=${CANDIDATE_TIPS[$i]}
  phase=${CANDIDATE_PHASES[$i]}

  if ! acquire_worktree_lock "$branch"; then
    log "worktree cleanup lock is busy or unsafe; preserving lease: $path"
    continue
  fi
  if ! parse_lease "$lease_file" \
      || [[ "$LEASE_PATH" != "$path" \
        || "$LEASE_BRANCH" != "$branch" \
        || "$LEASE_TIP" != "$tip" \
        || "$LEASE_REMOVED_AT" != "${CANDIDATE_REMOVED_AT[$i]}" \
        || "$LEASE_REMOVED_MAC" != "${CANDIDATE_REMOVED_MAC[$i]}" \
        || "$LEASE_REMOTE_DELETED_AT" != "${CANDIDATE_REMOTE_DELETED_AT[$i]}" \
        || "$LEASE_REMOTE_DELETED_MAC" != "${CANDIDATE_REMOTE_DELETED_MAC[$i]}" ]] \
      || ! revalidate_candidate "$i"; then
    log "candidate changed or lost cleanup proof before action: $branch"
    release_worktree_lock
    continue
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    if [[ "$phase" == "restore" || "$phase" == "tombstone" ]]; then
      log "dry-run would restore remote branch=$branch tip=$tip"
    elif [[ "$phase" == "settle" ]]; then
      log "dry-run would clear restored remote state branch=$branch tip=$tip"
    else
      log "dry-run would remove worktree=$path branch=$branch tip=$tip phase=$phase"
    fi
    release_worktree_lock
    continue
  fi

  # A missing remote after script-issued worktree removal is restored before
  # merge or open-PR filters can discard the recovery lease.
  if [[ "$phase" == "restore" ]]; then
    backup_ref=$(backup_ref_for_lease "$lease_file") || fatal "invalid cleanup backup ref: $lease_file"
    if ! GIT_TERMINAL_PROMPT=0 $GIT_BIN -C "$REPO_DIR" push \
        --force-with-lease="refs/heads/$branch:" "$REMOTE" \
        "$backup_ref:refs/heads/$branch"; then
      log "remote restoration retry was refused; retaining cleanup lease: $branch"
      release_worktree_lock
      continue
    fi
    log "restored remote branch before retrying cleanup: $branch"
    release_worktree_lock
    continue
  fi

  if [[ "$phase" == "tombstone" ]]; then
    if branch_is_registered "$branch" || ! no_open_pr_is_proven; then
      backup_ref=$(backup_ref_for_lease "$lease_file") \
        || fatal "invalid cleanup backup ref: $lease_file"
      if GIT_TERMINAL_PROMPT=0 $GIT_BIN -C "$REPO_DIR" push \
          --force-with-lease="refs/heads/$branch:" "$REMOTE" \
          "$backup_ref:refs/heads/$branch"; then
        clear_remote_deleted "$lease_file" \
          || fatal "restored remote branch but could not clear deletion state: $branch"
        log "restored remote branch after it became live: $branch"
      else
        log "remote restoration was refused; retaining cleanup recovery state: $branch"
      fi
    else
      log "retaining deleted-branch recovery state: $branch"
    fi
    release_worktree_lock
    continue
  fi

  if [[ "$phase" == "settle" ]]; then
    clear_remote_deleted "$lease_file" \
      || fatal "could not clear restored remote deletion state: $branch"
    log "cleared remote deletion state after branch restoration: $branch"
    release_worktree_lock
    continue
  fi

  if [[ "$phase" == "worktree" ]]; then
    original_path=$path
    if ! quarantine_worktree "$path" "$branch"; then
      log "worktree quarantine refused; preserving lease: $path"
      release_worktree_lock
      continue
    fi
    CANDIDATE_PATHS[$i]=$QUARANTINED_PATH
    path=$QUARANTINED_PATH
    if ! revalidate_candidate "$i"; then
      log "quarantined worktree proof changed before removal; restoring: $original_path"
      if ! restore_quarantined_worktree "$path" "$original_path"; then
        fatal "cannot restore quarantined worktree: $original_path"
      fi
      CANDIDATE_PATHS[$i]=$original_path
      release_worktree_lock
      continue
    fi
    if ! $GIT_BIN -C "$REPO_DIR" worktree remove -- "$path"; then
      log "quarantined worktree removal refused; restoring: $original_path"
      if ! restore_quarantined_worktree "$path" "$original_path"; then
        fatal "cannot restore quarantined worktree: $original_path"
      fi
      CANDIDATE_PATHS[$i]=$original_path
      release_worktree_lock
      continue
    fi
    log "removed leased worktree: $original_path"
    if ! mark_worktree_removed "$lease_file"; then
      fatal "worktree removed but removal state could not be persisted; manual recovery required: $branch"
    fi
    CANDIDATE_PHASES[$i]=branch
    CANDIDATE_REMOVED_AT[$i]=$NOW
    phase=branch
  fi

  # The worktree removal changes the local Git view, so obtain a fresh proof
  # before deleting either ref. A regular branch delete and a regular remote
  # delete are intentional: both refuse an unexpected concurrent change.
  if ! revalidate_candidate "$i"; then
    log "branch proof changed after worktree removal; preserving branch: $branch"
    release_worktree_lock
    continue
  fi
  if branch_is_registered "$branch"; then
    log "branch is checked out in another worktree; preserving branch: $branch"
    release_worktree_lock
    continue
  fi
  if ! ensure_backup_ref "$lease_file" "$tip"; then
    log "cleanup backup ref could not be created; preserving branch: $branch"
    release_worktree_lock
    continue
  fi
  backup_ref=$(backup_ref_for_lease "$lease_file") \
    || fatal "invalid cleanup backup ref: $lease_file"
  if [[ -n "$(local_tip "$branch")" ]]; then
    if ! $GIT_BIN -C "$REPO_DIR" update-ref -d "refs/heads/$branch" "$tip"; then
      log "local branch compare-and-delete refused; preserving branch: $branch"
      release_worktree_lock
      continue
    fi
    log "deleted merged local branch at leased tip: $branch"
  fi

  # update-ref does not protect a branch that becomes checked out between the
  # registration check and deletion. Restore the expected ref if that race won.
  if branch_is_registered "$branch"; then
    if [[ -z "$(local_tip "$branch")" ]]; then
      $GIT_BIN -C "$REPO_DIR" update-ref "refs/heads/$branch" "$tip" "" \
        || fatal "cannot restore branch checked out during cleanup: $branch"
    fi
    log "branch became checked out during cleanup; restored local ref: $branch"
    release_worktree_lock
    continue
  fi

  current_remote_tip=$(remote_tip "$branch")
  if [[ -n "$current_remote_tip" ]]; then
    [[ "$current_remote_tip" == "$tip" ]] || {
      log "remote branch tip changed; preserving remote branch: $branch"
      release_worktree_lock
      continue
    }
    if branch_is_registered "$branch"; then
      log "branch was recreated before remote deletion; preserving remote branch: $branch"
      release_worktree_lock
      continue
    fi
    if ! GIT_TERMINAL_PROMPT=0 $GIT_BIN -C "$REPO_DIR" push \
        --force-with-lease="refs/heads/$branch:$tip" "$REMOTE" ":refs/heads/$branch"; then
      log "remote branch compare-and-delete refused; preserving remote branch: $branch"
      release_worktree_lock
      continue
    fi
    log "deleted merged remote branch at leased tip: $branch"
    if ! query_open_prs "$branch" preserve \
        || branch_is_registered "$branch" \
        || ! no_open_pr_is_proven; then
      if GIT_TERMINAL_PROMPT=0 $GIT_BIN -C "$REPO_DIR" push \
          --force-with-lease="refs/heads/$branch:" "$REMOTE" \
          "$backup_ref:refs/heads/$branch"; then
        log "branch became live during remote deletion; restored remote branch: $branch"
      else
        log "remote restoration was refused; retaining cleanup lease: $branch"
      fi
      release_worktree_lock
      continue
    fi
    if ! mark_remote_deleted "$lease_file"; then
      fatal "remote branch deleted but recovery state could not be persisted: $branch"
    fi
    log "retained cleanup recovery state and backup ref: $branch"
  fi
  release_worktree_lock
done

log "=== worktree-cleanup-weekly done ==="
