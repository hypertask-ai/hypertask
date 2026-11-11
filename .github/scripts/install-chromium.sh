#!/usr/bin/env bash
# HYCI-279: the browser check needs Chromium's system packages, and those packages
# come from one Ubuntu mirror name. When that one name stopped resolving, all four
# browser shards failed on a download we do not control. This writes the first
# mirror that answers, then retries the install once before giving up.
set -uo pipefail

SUITE="${UBUNTU_SUITE:-noble}"
MIRROR_FILE="${APT_MIRROR_FILE:-/etc/apt/apt-mirrors.txt}"
RETRY_SLEEP="${RETRY_SLEEP:-20}"
ATTEMPTS=2
MIRROR_ANSWERED=0

# archive.ubuntu.com comes first so the common case keeps the mirror the runner
# image already used; the other two are full Ubuntu mirrors.
MIRRORS=(
  "https://archive.ubuntu.com/ubuntu/"
  "https://azure.archive.ubuntu.com/ubuntu/"
  "https://mirrors.edge.kernel.org/ubuntu/"
)

probe() {
  curl -fsS --max-time 10 --connect-timeout 5 -o /dev/null "$1/dists/$SUITE/InRelease"
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
  npx playwright install --with-deps chromium || return 1
  sudo apt-get update -o Acquire::Retries=3 || return 1
  sudo apt-get install -y -o Acquire::Retries=3 strace || return 1
}

for ((attempt = 1; attempt <= ATTEMPTS; attempt++)); do
  choose_mirror
  if install_deps; then
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
