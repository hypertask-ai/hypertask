#!/usr/bin/env bash
set -euo pipefail

# A root-run updater must not resolve executables from a caller-controlled path.
if ((EUID == 0)); then
  PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
  export PATH
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repository_root=$(cd -- "$script_dir/../.." && pwd)
manifest="$repository_root/.github/actions/action-archive-cache-manifest.txt"
cache_dir=/opt/github-actions/action-archive-cache
install_services=false
declare -a requested_services=()

usage() {
  cat <<'EOF'
Usage: install-action-archive-cache.sh [options]

Populate the immutable GitHub Actions runner archive cache.

Options:
  --manifest PATH       Action manifest (default: repository manifest)
  --cache-dir PATH      Cache root (default: /opt/github-actions/action-archive-cache)
  --install-services    Install systemd drop-ins and restart runner services
  --service UNIT        Limit installation to this service (repeatable)
  --help                Show this help
EOF
}

while (($#)); do
  case "$1" in
    --manifest)
      manifest=${2:?--manifest requires a path}
      shift 2
      ;;
    --cache-dir)
      cache_dir=${2:?--cache-dir requires a path}
      shift 2
      ;;
    --install-services)
      install_services=true
      shift
      ;;
    --service)
      requested_services+=("${2:?--service requires a unit name}")
      shift 2
      ;;
    --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

[[ -f "$manifest" ]] || { echo "Manifest not found: $manifest" >&2; exit 66; }
[[ "$cache_dir" = /* ]] || { echo "Cache directory must be absolute: $cache_dir" >&2; exit 64; }

validate_archive() {
  local archive=$1
  gzip -t -- "$archive" >/dev/null 2>&1 || return 1
  tar -tzf "$archive" \
    | awk -F/ '
        BEGIN { bad = 0 }
        /^\// { bad = 1 }
        /(^|\/)\.\.($|\/)/ { bad = 1 }
        NF && $1 != "" { roots[$1] = 1 }
        END {
          count = 0
          for (root in roots) count++
          if (bad || count != 1) exit 1
        }
      '
}

declare -a owner_args=()
if ((EUID == 0)); then
  owner_args=(-o root -g root)
fi

install -d "${owner_args[@]}" -m 0755 -- "$cache_dir"
exec 9>"$cache_dir/.populate.lock"
flock 9
chmod 0644 "$cache_dir/.populate.lock"
if ((EUID == 0)); then chown root:root "$cache_dir/.populate.lock"; fi

declare -A seen=()
while read -r repository sha release_line _; do
  [[ -n "${repository:-}" ]] || continue
  [[ "$repository" = \#* ]] && continue
  [[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] \
    || { echo "Invalid action repository: $repository" >&2; exit 65; }
  [[ "$sha" =~ ^[0-9a-f]{40}$ ]] \
    || { echo "Invalid action commit for $repository: $sha" >&2; exit 65; }
  [[ -z "${seen[$repository]:-}" ]] \
    || { echo "Duplicate action repository in manifest: $repository" >&2; exit 65; }
  seen[$repository]=1

  cache_name=${repository//\//_}
  action_dir="$cache_dir/$cache_name"
  archive="$action_dir/$sha.tar.gz"
  install -d "${owner_args[@]}" -m 0755 -- "$action_dir"

  if [[ -f "$archive" ]] && validate_archive "$archive"; then
    chmod 0444 "$archive"
    if ((EUID == 0)); then chown root:root "$archive"; fi
    echo "ready $repository@$sha ($release_line)"
    continue
  fi

  if [[ -e "$archive" ]]; then
    quarantine="$archive.invalid.$(date -u +%Y%m%dT%H%M%SZ).$$"
    mv -- "$archive" "$quarantine"
    chmod 0400 "$quarantine"
    echo "quarantined invalid cache entry: $quarantine" >&2
  fi

  temporary=$(mktemp "$action_dir/.${sha}.tar.gz.XXXXXX")
  cleanup_temporary() { rm -f -- "$temporary"; }
  trap cleanup_temporary EXIT
  curl --fail --silent --show-error --location \
    --retry 3 --retry-all-errors \
    --output "$temporary" \
    "https://codeload.github.com/$repository/tar.gz/$sha"
  validate_archive "$temporary" \
    || { echo "Downloaded archive failed validation: $repository@$sha" >&2; exit 65; }
  chmod 0444 "$temporary"
  mv -- "$temporary" "$archive"
  if ((EUID == 0)); then chown root:root "$archive"; fi
  trap - EXIT
  echo "cached $repository@$sha ($release_line)"
done < "$manifest"

if ((${#seen[@]} == 0)); then
  echo "Manifest contains no actions: $manifest" >&2
  exit 65
fi

if ! $install_services; then
  exit 0
fi

if ((EUID != 0)); then
  echo "--install-services must run as root" >&2
  exit 77
fi

declare -a services=()
if ((${#requested_services[@]})); then
  services=("${requested_services[@]}")
else
  while IFS= read -r unit_file; do
    services+=("$(basename "$unit_file")")
  done < <(find /etc/systemd/system -maxdepth 1 -type f \
    -name 'actions.runner.*.service' -print | sort)
fi

((${#services[@]})) || { echo "No GitHub Actions runner services found" >&2; exit 69; }

for service in "${services[@]}"; do
  [[ "$service" =~ ^actions\.runner\.[A-Za-z0-9_.@-]+\.service$ ]] \
    || { echo "Refusing unexpected service name: $service" >&2; exit 64; }
  [[ -f "/etc/systemd/system/$service" ]] \
    || { echo "Runner service not found: $service" >&2; exit 69; }
  drop_in_dir="/etc/systemd/system/$service.d"
  install -d -o root -g root -m 0755 "$drop_in_dir"
  drop_in=$(mktemp "$drop_in_dir/.action-archive-cache.conf.XXXXXX")
  printf '[Service]\nEnvironment=ACTIONS_RUNNER_ACTION_ARCHIVE_CACHE=%s\n' "$cache_dir" > "$drop_in"
  install -o root -g root -m 0644 "$drop_in" "$drop_in_dir/action-archive-cache.conf"
  rm -f "$drop_in"
done

systemctl daemon-reload
for service in "${services[@]}"; do
  systemctl restart "$service"
  systemctl is-active --quiet "$service"
  echo "active $service"
done
