#!/usr/bin/env bash
set -uo pipefail

if [[ "${1:-}" != "--run" ]]; then
  started=$SECONDS
  timeout -k 5 "${CHROMIUM_INSTALL_TIMEOUT:-110}" bash "${BASH_SOURCE[0]}" --run
  status=$?
  if ((status == 124 || status == 137)); then
    echo "::error::Chromium installation timed out after $((SECONDS - started))s; check this runner's outside network"
    exit 1
  fi
  exit "$status"
fi

SUITE="${UBUNTU_SUITE:-noble}"
MIRROR_FILE="${APT_MIRROR_FILE:-/etc/apt/apt-mirrors.txt}"
APT_CONF_FILE="${APT_CONF_FILE:-/etc/apt/apt.conf.d/99-ci-timeouts}"
BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"
RETRY_SLEEP="${RETRY_SLEEP:-20}"
PROBE_TIMEOUT="${PROBE_TIMEOUT:-6}"
ATTEMPTS=2
MIRROR_ANSWERED=0
STARTED=$SECONDS

if [[ -n "${UBUNTU_MIRRORS:-}" ]]; then
  read -r -a MIRRORS <<< "$UBUNTU_MIRRORS"
else
  MIRRORS=(
    "https://archive.ubuntu.com/ubuntu/"
    "https://azure.archive.ubuntu.com/ubuntu/"
    "https://mirrors.edge.kernel.org/ubuntu/"
  )
fi

APT_TIMEOUT_OPTS=(
  -o Acquire::http::Timeout=5
  -o Acquire::https::Timeout=5
  -o Acquire::ftp::Timeout=5
  -o Acquire::Retries=0
)

probe() {
  curl -fsS --max-time "$PROBE_TIMEOUT" --connect-timeout 3 -o /dev/null "$1/dists/$SUITE/InRelease"
}

choose_mirror() {
  local mirror
  MIRROR_ANSWERED=0
  for mirror in "${MIRRORS[@]}"; do
    if probe "$mirror"; then
      if printf '%s\n' "$mirror" | sudo tee "$MIRROR_FILE" > /dev/null; then
        echo "Chromium packages come from $mirror"
      else
        echo "::warning::Could not point apt at $mirror; leaving the runner's own package sources"
      fi
      MIRROR_ANSWERED=1
      return 0
    fi
    echo "::warning::Ubuntu mirror did not answer within ${PROBE_TIMEOUT}s: $mirror"
  done
  echo "::warning::No Ubuntu mirror answered; trying the runner's own package sources with short timeouts"
  return 0
}

install_once() {
  npx playwright install --with-deps chromium || return 1
  sudo apt-get update "${APT_TIMEOUT_OPTS[@]}" || return 1
  sudo apt-get install -y "${APT_TIMEOUT_OPTS[@]}" strace || return 1
}

write_apt_timeouts() {
  if printf 'Acquire::http::Timeout "5";\nAcquire::https::Timeout "5";\nAcquire::ftp::Timeout "5";\nAcquire::Retries "0";\n' |
    sudo tee "$APT_CONF_FILE" > /dev/null; then
    return 0
  fi
  echo "::warning::Could not write $APT_CONF_FILE; apt keeps its long timeouts"
}

cached_chromium() {
  local binary
  binary=$(find "$BROWSERS_PATH" -maxdepth 4 -type f -name chrome 2>/dev/null | head -n 1)
  [[ -n "$binary" ]] || return 1
  if ldd "$binary" 2>/dev/null | grep -q "not found"; then
    return 1
  fi
  "$binary" --version > /dev/null 2>&1 || return 1
  printf '%s\n' "$binary"
}

system_packages_ready() {
  npx playwright install-deps --dry-run chromium > /dev/null 2>&1
}

if binary=$(cached_chromium) && command -v strace > /dev/null && system_packages_ready; then
  echo "::notice::Chromium is cached at $binary with its system packages installed; skipping apt ($((SECONDS - STARTED))s)"
  exit 0
fi

write_apt_timeouts

for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
  choose_mirror
  if install_once; then
    echo "::notice::Chromium ready in $((SECONDS - STARTED))s"
    exit 0
  fi
  echo "::warning::Chromium install attempt $attempt of $ATTEMPTS failed after $((SECONDS - STARTED))s"
  if ((attempt == ATTEMPTS)); then
    break
  fi
  if ((MIRROR_ANSWERED == 0)); then
    echo "::error::Chromium failed in $((SECONDS - STARTED))s: no Ubuntu mirror answered within ${PROBE_TIMEOUT}s each, so this machine has no outside network"
    exit 1
  fi
  sleep "$RETRY_SLEEP"
done

echo "::error::Chromium and its system packages could not be installed after $ATTEMPTS attempts in $((SECONDS - STARTED))s"
exit 1
