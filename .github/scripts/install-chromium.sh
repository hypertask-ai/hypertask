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
RETRY_SLEEP="${RETRY_SLEEP:-20}"
ATTEMPTS=2
MIRROR_ANSWERED=0

MIRRORS=(
  "https://archive.ubuntu.com/ubuntu/"
  "https://azure.archive.ubuntu.com/ubuntu/"
  "https://mirrors.edge.kernel.org/ubuntu/"
)

APT_TIMEOUT_OPTS=(
  -o Acquire::http::Timeout=5
  -o Acquire::https::Timeout=5
  -o Acquire::ftp::Timeout=5
  -o Acquire::Retries=0
)

probe() {
  curl -fsS --max-time 6 --connect-timeout 3 -o /dev/null "$1/dists/$SUITE/InRelease"
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
    echo "::warning::Ubuntu mirror did not answer: $mirror"
  done
  echo "::warning::No Ubuntu mirror answered; trying the runner's own package sources"
  return 0
}

install_deps() {
  npx playwright install chromium || return 1
  npx playwright install --with-deps chromium || return 1
  if ! command -v strace > /dev/null; then
    sudo apt-get update "${APT_TIMEOUT_OPTS[@]}" || return 1
    sudo apt-get install -y "${APT_TIMEOUT_OPTS[@]}" strace || return 1
  fi
}

if ! printf 'Acquire::http::Timeout "5";\nAcquire::https::Timeout "5";\nAcquire::ftp::Timeout "5";\nAcquire::Retries "0";\n' |
  sudo tee "$APT_CONF_FILE" > /dev/null; then
  echo "::error::Could not configure short apt timeouts"
  exit 1
fi

for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
  choose_mirror
  if install_deps; then
    echo "::notice::Chromium and its system packages are ready"
    exit 0
  fi
  echo "::warning::Chromium install attempt $attempt of $ATTEMPTS failed"
  if ((attempt == ATTEMPTS)); then
    break
  fi
  if ((MIRROR_ANSWERED == 0)); then
    echo "::error::No Ubuntu mirror answered and the install failed; not retrying into a dead network"
    exit 1
  fi
  sleep "$RETRY_SLEEP"
done

echo "::error::Chromium and its system packages could not be installed after $ATTEMPTS attempts"
exit 1
