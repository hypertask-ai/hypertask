#!/usr/bin/env bash
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }

source_dir=$(cd "$(dirname "$0")" && pwd)
getent passwd aireviewer >/dev/null || useradd --create-home --shell /usr/sbin/nologin aireviewer
getent passwd htreviewrunner >/dev/null || { echo "Create the review-only htreviewrunner service account first." >&2; exit 1; }
getent passwd reviewdispatch >/dev/null || useradd --system --create-home --shell /usr/sbin/nologin reviewdispatch

install -d -m 755 /etc/hypertask-ai-review /usr/local/libexec
install -d -o reviewdispatch -g reviewdispatch -m 700 \
  /var/lib/hypertask-ai-review \
  /var/lib/hypertask-ai-review/locks \
  /var/lib/hypertask-ai-review/dispatched \
  /var/lib/hypertask-ai-review/completed
# The shipped review-schema.json requires confidence/evidence as nullable fields so strict
# JSON-schema mode is satisfied. Reviewer hosts keep the OLD /etc copy until this script
# re-runs; old-schema wrapper output simply omits confidence/evidence, which normalizeReview
# treats exactly like null/omitted. Do not break on either schema version.
install -m 644 "$source_dir/review-schema.json" /etc/hypertask-ai-review/review-schema.json
install -o root -g aireviewer -m 750 "$source_dir/codex-review" /usr/local/libexec/hypertask-codex-subscription-review
install -o root -g aireviewer -m 750 "$source_dir/claude-review" /usr/local/libexec/hypertask-claude-subscription-review
install -m 755 "$source_dir/codex-entrypoint" /usr/local/bin/hypertask-codex-subscription-review
install -m 755 "$source_dir/claude-entrypoint" /usr/local/bin/hypertask-claude-subscription-review
# hax review wrapper (HTPR-7115): the prompt arrives on stdin and hax -p reads it from stdin too.
# Never pass the prompt as an argument: big diffs hit "Argument list too long". Both files are
# root:root 0755 because the entrypoint runs the libexec wrapper as the valentin user via sudo.
# The sudoers rule allowing that is NOT in ./sudoers and is not managed here; it already exists
# on the VPS. This script does not add or change it.
install -o root -g root -m 755 "$source_dir/hax-review" /usr/local/libexec/hypertask-hax-valentin-review
install -o root -g root -m 755 "$source_dir/hax-entrypoint" /usr/local/bin/hypertask-hax-subscription-review
install -o root -g reviewdispatch -m 750 "$source_dir/dispatch-review" /usr/local/libexec/hypertask-dispatch-review
install -o root -g reviewdispatch -m 750 "$source_dir/dispatch-scan" /usr/local/libexec/hypertask-dispatch-scan
# The dispatcher makes its calls on hypertask-ai/hypertask with the review GitHub App's own token (YPER4-286).
# That also needs two files set up outside the repo, never committed:
#   /etc/hypertask-ai-review/review-app.pem  the App key from `stack-key github-app GITHUB_APP_REVIEW_PRIVATE_KEY_FILE`, owner reviewdispatch, mode 600
#   /etc/hypertask-ai-review/review-app.env  APP_ID and INSTALLATION_ID lines, root:reviewdispatch, mode 640
# Without them the scripts fall back to reviewer-curl.conf.
install -o root -g reviewdispatch -m 750 "$source_dir/review-app-token" /usr/local/libexec/hypertask-review-app-token
install -m 644 "$source_dir/hypertask-ai-review-dispatch.service" /etc/systemd/system/hypertask-ai-review-dispatch.service
install -m 644 "$source_dir/hypertask-ai-review-dispatch.timer" /etc/systemd/system/hypertask-ai-review-dispatch.timer
install -m 440 "$source_dir/sudoers" /etc/sudoers.d/hypertask-ai-review

visudo -cf /etc/sudoers.d/hypertask-ai-review
systemctl daemon-reload
systemctl enable --now hypertask-ai-review-dispatch.timer
