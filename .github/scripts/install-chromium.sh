#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' \
  'https://archive.ubuntu.com/ubuntu/' \
  'https://azure.archive.ubuntu.com/ubuntu/' \
  'https://mirrors.edge.kernel.org/ubuntu/' \
  | sudo tee /etc/apt/apt-mirrors.txt > /dev/null
npx playwright install --with-deps chromium
if [ "${1:-}" = with-strace ]; then
  sudo apt-get update -o Acquire::Retries=3
  sudo apt-get install -y -o Acquire::Retries=3 strace
fi
