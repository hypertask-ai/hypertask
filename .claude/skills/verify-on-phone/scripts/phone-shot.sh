#!/usr/bin/env bash
# Screenshot a URL at a real phone viewport (390x844, mobile UA), signed in.
#
# Viewport is set with `agent-browser set viewport`, then the page is reloaded,
# because `set viewport` after load does not re-lay-out an already-rendered
# page. All calls share one named session so the state, UA and viewport apply
# to the same browser as the screenshot.
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

  <url>             full https:// URL, scheme included.
  <out.png>         ABSOLUTE path for the PNG. A relative path is rejected,
                    because the browser session does not share your cwd.
  --state           auth state JSON. Defaults to
                    $HT_PRODUCTION_STORAGE_STATE_FILE, then
                    ~/.config/hypertask-videos/storageState-valentin.json.
                    Use this agent's OWN state file; borrowing another
                    agent's credentials is banned.
  --allow-redirect  downgrade "landed on a different path" from a failure to a
                    warning. Only for flows that redirect on purpose, and the
                    success line then says UNVERIFIED.
  --dry-run         print the exact agent-browser calls and take no shot.

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

STATE_FILE="${HT_PRODUCTION_STORAGE_STATE_FILE:-$HOME/.config/hypertask-videos/storageState-valentin.json}"
DRY_RUN="no"
ALLOW_REDIRECT="no"
SESSION="phone-shot"
UA="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) show_help; exit 0 ;;
    --state) STATE_FILE="${2:?}"; shift 2 ;;
    --allow-redirect) ALLOW_REDIRECT="yes"; shift ;;
    --dry-run) DRY_RUN="yes"; shift ;;
    *) die "$SELF does not know the argument '$1'." "Run 'phone-shot.sh --help' for the accepted flags." ;;
  esac
done

case "$URL" in
  http://*|https://*) ;;
  *) die "'$URL' has no scheme, so agent-browser cannot open it." "Re-run with the full URL, for example https://app.hypertask.ai/detail/project-15/6471." ;;
esac

require_abs "$OUT" "The output path" "Re-run with the full path, for example \"\$PWD/after.png\". The browser session does not share your working directory."
require_abs "$STATE_FILE" "--state" "Re-run with the full path to the auth state JSON, or unset --state to use \$HT_PRODUCTION_STORAGE_STATE_FILE."

OUT_DIR="$(dirname "$OUT")"

if [ "$DRY_RUN" = "yes" ]; then
  printf 'DRY RUN: state file: %s\n' "$STATE_FILE"
  printf 'DRY RUN: mkdir -p %q\n' "$OUT_DIR"
  printf 'DRY RUN: agent-browser --session %q --state %q --user-agent <iphone-ua> open %q\n' "$SESSION" "$STATE_FILE" "$URL"
  printf 'DRY RUN: agent-browser --session %q set viewport 390 844\n' "$SESSION"
  printf 'DRY RUN: agent-browser --session %q reload\n' "$SESSION"
  printf 'DRY RUN: agent-browser --session %q screenshot %q\n' "$SESSION" "$OUT"
  printf 'DRY RUN: agent-browser --session %q get url   # must not be a login page, and must contain the requested path\n' "$SESSION"
  printf 'DRY RUN OK: would write %s at 390x844, redirect check %s.\n' "$OUT" \
    "$([ "$ALLOW_REDIRECT" = yes ] && echo 'downgraded to a warning' || echo 'fatal')"
  exit 0
fi

[ -f "$STATE_FILE" ] \
  || die "There is no reusable auth state at $STATE_FILE, so the shot would be of a logged-out page." "Follow the login recipe in ~/projects/hypertasks/AGENTS.md 'Repository Workflow' and openwiki/auth.md to write that file, then re-run."

mkdir -p "$OUT_DIR" \
  || die "Could not create the output directory $OUT_DIR." "Pick a path you can write to, for example under \$HOME, and re-run."

agent-browser --session "$SESSION" --state "$STATE_FILE" --user-agent "$UA" open "$URL" >/dev/null \
  || die "agent-browser could not open $URL." "Run 'agent-browser --session $SESSION open $URL' by hand to read the real error. If the browser is wedged, close the session and retry."
agent-browser --session "$SESSION" set viewport 390 844 >/dev/null \
  || die "agent-browser could not set the 390x844 viewport, so the shot would be desktop width." "Run 'agent-browser --session $SESSION set viewport 390 844' by hand and read the error."
agent-browser --session "$SESSION" reload >/dev/null \
  || die "agent-browser could not reload after the viewport change, so the page is still laid out at the old width." "Run 'agent-browser --session $SESSION reload' by hand and read the error."
agent-browser --session "$SESSION" screenshot "$OUT" >/dev/null \
  || die "agent-browser could not write the screenshot to $OUT." "Check the directory is writable and re-run. If the page never settled, open the URL by hand first."

LANDED="$(agent-browser --session "$SESSION" get url 2>/dev/null || true)"
case "$LANDED" in
  *login*|*signin*|*sign-in*)
    die "The browser landed on a login page ($LANDED), so the auth state at $STATE_FILE is stale and the shot is not evidence." "Refresh that state file with the login recipe in openwiki/auth.md, then re-run." ;;
esac

# A redirect away from the requested path means the shot is of some other
# screen. A screenshot of the wrong page is worse than none.
REQ_PATH="${URL#*://*/}"
REDIRECTED="no"
case "$LANDED" in
  *"$REQ_PATH"*) ;;
  *) REDIRECTED="yes" ;;
esac

if [ "$REDIRECTED" = "yes" ] && [ "$ALLOW_REDIRECT" != "yes" ]; then
  die "Asked for $URL but the browser landed on $LANDED, so $OUT shows a different screen." "Check this account has access to that page. If the redirect is expected, re-run with --allow-redirect and say so when you post the shot."
fi

[ -s "$OUT" ] \
  || die "No screenshot bytes were written to $OUT." "Run the agent-browser calls by hand with --dry-run's command list and find which one produced nothing."

BYTES="$(wc -c <"$OUT" | tr -d ' ')"
printf '%s: saved.\n' "$SELF"
printf '  file:     %s (%s bytes)\n' "$OUT" "$BYTES"
printf '  viewport: 390x844, iPhone user agent\n'
printf '  url:      %s\n' "$LANDED"
if [ "$REDIRECTED" = "yes" ]; then
  printf '  status:   UNVERIFIED - redirected away from %s, allowed by --allow-redirect\n' "$URL"
else
  printf '  status:   landed on the requested path\n'
fi
printf 'Now open the PNG and check it shows the state the ticket asks for, not just "a page".\n'
