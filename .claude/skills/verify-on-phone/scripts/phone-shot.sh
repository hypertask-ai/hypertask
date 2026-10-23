#!/usr/bin/env bash
# Screenshot a URL at a real phone viewport (390x844, mobile UA), signed in.
#
# Playwright loads the auth state, viewport and user agent before navigation.
#
# Run `phone-shot.sh --help` for usage and examples.
set -euo pipefail

SELF="phone-shot"

shq() {  # print args as a paste-able shell command line
  local a
  for a in "$@"; do printf " '%s'" "${a//\'/\'\\''}"; done
}

die() {
  printf 'ERROR: %s Do this next: %s\n' "$1" "$2" >&2
  exit "${3:-1}"
}

require_abs() {  # value, label, next-step
  case "$1" in
    /*) ;;
    *) die "$2 must be an absolute path, got '$1'." "$3" ;;
  esac
}

show_help() {
  cat <<'EOF'
phone-shot.sh - take a signed-in screenshot at a real phone viewport
(390x844, iPhone user agent) and refuse to call it evidence when the browser
landed somewhere other than the page you asked for.

Usage:
  phone-shot.sh <url> <absolute out.png> [--state <absolute path>]
                [--allow-redirect] [--dry-run] [--help]
                [--viewport WxH] [--theme <porcelain|graphite|amoled|dia>]

  <url>             full https:// URL, scheme included.
  <out.png>         ABSOLUTE path for the PNG. A relative path is rejected,
                    because the browser session does not share your cwd.
  --state           auth state JSON. Optional. When omitted, the shot
                    uses ~/.config/hypertask-videos/storageState-qa.json
                    (user 985, sees Owner + QA flags). Pass
                    ~/.config/hypertask-videos/storageState-qa-normal.json
                    (user 2343) for the flag-off path. Never Valentin's
                    account.
  --allow-redirect  downgrade "landed on a different path" from a failure to a
                    warning. Only for flows that redirect on purpose, and the
                    success line then says UNVERIFIED.
  --dry-run         print the exact Playwright command and take no shot.
  --viewport        viewport size, default 390x844. Widths of 800 or more
                    use a desktop user agent (for example 1440x900).
  --theme           set the theme cookie before loading the page.

It exits non-zero when the state file is missing, when the browser lands on a
login page, when it lands on a path other than the one requested (unless
--allow-redirect), or when no PNG was written. A screenshot of the wrong page
is worse than no screenshot.

Examples:
  # Prove a fix on the production board at phone width:
  phone-shot.sh https://app.hypertask.ai/detail/project-15/6471 \
    /home/valentin/shots/HTPR-6471-after.png

  # A login flow that is meant to redirect, rehearsed first:
  phone-shot.sh https://app.hypertask.ai/ /home/valentin/shots/home.png \
    --allow-redirect --dry-run
EOF
}

case "${1:-}" in
  --help|-h|help) show_help; exit 0 ;;
esac

[ "$#" -ge 2 ] || die "phone-shot.sh needs a URL and an absolute output path, got $# argument(s)." "Run 'phone-shot.sh --help' and copy one of the two examples."

URL="$1"
OUT="$2"
shift 2

# Default is the QA login that sees Owner + QA flags. --state overrides it
# (use the plain account for a flag-off check). Never Valentin's file.
DEFAULT_STATE="${HOME}/.config/hypertask-videos/storageState-qa.json"
STATE_FILE=""
DRY_RUN="no"
ALLOW_REDIRECT="no"
VIEWPORT="390x844"
THEME=""
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) show_help; exit 0 ;;
    --state) STATE_FILE="${2:?}"; shift 2 ;;
    --viewport) VIEWPORT="${2:?}"; shift 2 ;;
    --theme) THEME="${2:?}"; shift 2 ;;
    --allow-redirect) ALLOW_REDIRECT="yes"; shift ;;
    --dry-run) DRY_RUN="yes"; shift ;;
    *) die "$SELF does not know the argument '$1'." "Run 'phone-shot.sh --help' for the accepted flags." ;;
  esac
done

case "$URL" in
  http://*|https://*) ;;
  *) die "'$URL' has no scheme, so Playwright cannot open it." "Re-run with the full URL, for example https://app.hypertask.ai/detail/project-15/6471." ;;
esac

require_abs "$OUT" "The output path" "Re-run with the full path, for example \"\$PWD/after.png\". The browser session does not share your working directory."
if [ -z "$STATE_FILE" ]; then
  STATE_FILE="$DEFAULT_STATE"
fi
case "$STATE_FILE" in
  *storageState-valentin.json)
    die "That state file is Valentin's own browser session." "Pass --state ~/.config/hypertask-videos/storageState-qa.json, or storageState-qa-normal.json for the flag-off path." ;;
esac
require_abs "$STATE_FILE" "--state" "Re-run with the full path, for example --state \"\$HOME/.config/hypertask-videos/storageState-qa.json\"."

if [[ ! "$VIEWPORT" =~ ^[1-9][0-9]{0,4}x[1-9][0-9]{0,4}$ ]]; then
  die "Invalid viewport '$VIEWPORT'." "Pass --viewport WxH, for example 390x844 or 1440x900."
fi
case "$THEME" in
  ""|porcelain|graphite|amoled|dia) ;;
  *) die "Unknown theme '$THEME'." "Pass --theme porcelain, graphite, amoled, or dia." ;;
esac
UA_LABEL="iPhone"
if [ "${VIEWPORT%x*}" -ge 800 ]; then
  UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
  UA_LABEL="desktop"
fi

REQ_PATH="${URL#*://*/}"
NODE_ARGS=("$SCRIPT_DIR/phone-shot.mjs" "$URL" "$OUT" "$STATE_FILE" "$UA" "$VIEWPORT" "$ALLOW_REDIRECT" "$REQ_PATH" "$THEME")
OUT_DIR="$(dirname "$OUT")"

if [ "$DRY_RUN" = "yes" ]; then
  printf 'DRY RUN: state file: %s\n' "$STATE_FILE"
  printf 'DRY RUN: mkdir -p %q\n' "$OUT_DIR"
  printf 'DRY RUN: nice -n 19 node'
  shq "${NODE_ARGS[@]}"
  printf '\n'
  printf 'DRY RUN OK: would write %s at %s, redirect check %s.\n' "$OUT" "$VIEWPORT" \
    "$([ "$ALLOW_REDIRECT" = yes ] && echo 'downgraded to a warning' || echo 'fatal')"
  exit 0
fi

[ -f "$STATE_FILE" ] \
  || die "There is no reusable auth state at $STATE_FILE, so the shot would be of a logged-out page." "Follow the login recipe in .claude/skills/verify-qa/SKILL.md 'Logins' to write that file, then re-run."

mkdir -p "$OUT_DIR" \
  || die "Could not create the output directory $OUT_DIR." "Pick a path you can write to, for example under \$HOME, and re-run."

LANDED="$(nice -n 19 node "${NODE_ARGS[@]}")" || exit 1

REDIRECTED="no"
case "$LANDED" in
  *"$REQ_PATH"*) ;;
  *) REDIRECTED="yes" ;;
esac

[ -s "$OUT" ] \
  || die "No screenshot bytes were written to $OUT." "Run the Playwright command from --dry-run by hand and read the error."

BYTES="$(wc -c <"$OUT" | tr -d ' ')"
printf '%s: saved.\n' "$SELF"
printf '  file:     %s (%s bytes)\n' "$OUT" "$BYTES"
printf '  viewport: %s, %s user agent\n' "$VIEWPORT" "$UA_LABEL"
printf '  url:      %s\n' "$LANDED"
if [ "$REDIRECTED" = "yes" ]; then
  printf '  status:   UNVERIFIED - redirected away from %s, allowed by --allow-redirect\n' "$URL"
else
  printf '  status:   landed on the requested path\n'
fi
printf 'Now open the PNG and check it shows the state the ticket asks for, not just "a page".\n'
